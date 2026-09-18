import "./support/auto-fake-sprites.ts";

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import { createServer } from "../src/api/server.ts";
import { buildApp } from "../src/wiring.ts";
import type { QmConfig } from "../cli/src/config.ts";
import {
  CoreUnreachableError,
  httpDeploymentLayerTransport,
  syncDeploymentLayer,
  type DeploymentLayerTransport,
} from "../cli/src/deployment-layer.ts";
import { testConfig } from "./support/test-config.ts";

const SECRET = "cli-core-integration-secret".repeat(3);

async function unusedPort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function fixture(port: number) {
  const dir = mkdtempSync(join(tmpdir(), "qm-cli-core-"));
  mkdirSync(join(dir, "sandbox", "skills", "ready"), { recursive: true });
  writeFileSync(
    join(dir, "sandbox", "skills", "ready", "SKILL.md"),
    "---\nname: ready\ndescription: Deployment readiness integration.\n---\nReady.\n",
  );
  writeFileSync(join(dir, ".env"), `CORE_SIGNING_SECRET=${SECRET}\n`);
  const config: QmConfig = {
    contract: 1,
    orgId: "cli-core-integration",
    publicUrl: `http://127.0.0.1:${port}`,
    target: "docker",
    services: ["core"],
    plugins: [],
    skills: [],
    env: {},
    imageOverrides: {},
    sandbox: { app: "cli-core-integration-sandboxes" },
  };
  return { config, configDir: dir, sandboxDir: join(dir, "sandbox"), close: () => rmSync(dir, { recursive: true }) };
}

function core() {
  const built = buildApp(testConfig({ signingSecret: SECRET }));
  const server = createServer(built.app, {
    signingSecret: SECRET,
    deploymentLayer: built.deploymentLayerStore,
    auditLog: built.auditLog,
  });
  return { built, server };
}

async function listen(server: ReturnType<typeof createServer>, port: number): Promise<void> {
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
}

async function close(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

test("CLI readiness sync reaches the actual signed core route", async (t) => {
  await t.test("slow core readiness retries until a healthy sync applies", async () => {
    const port = await unusedPort();
    const f = fixture(port);
    const c = core();
    const start = sleep(150).then(() => listen(c.server, port));
    try {
      await syncDeploymentLayer({
        ...f,
        transport: httpDeploymentLayerTransport(),
        allowUnavailable: true,
        retryDelayMs: 50,
      });
      await start;
      const record = await c.built.deploymentLayerStore.get();
      assert.equal(record?.version, 1);
      assert.equal(await c.built.deploymentLayerStore.isApplied(record!.contentHash), true);
    } finally {
      await start;
      await close(c.server);
      f.close();
    }
  });

  await t.test("a healthy but slow core completes within the readiness window", async (t) => {
    const port = await unusedPort();
    const f = fixture(port);
    const c = core();
    const put = c.built.deploymentLayerStore.put.bind(c.built.deploymentLayerStore);
    t.mock.method(c.built.deploymentLayerStore, "put", async (...args: Parameters<typeof put>) => {
      await sleep(200);
      return put(...args);
    });
    await listen(c.server, port);
    try {
      await syncDeploymentLayer({ ...f, transport: httpDeploymentLayerTransport(), allowUnavailable: true });
      assert.equal((await c.built.deploymentLayerStore.get())?.version, 1);
    } finally {
      await close(c.server);
      f.close();
    }
  });

  await t.test("cancellation aborts an in-flight signed HTTP request", async (t) => {
    const port = await unusedPort();
    const f = fixture(port);
    const c = core();
    const put = c.built.deploymentLayerStore.put.bind(c.built.deploymentLayerStore);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const started = new Promise<void>((resolve) => (entered = resolve));
    t.mock.method(c.built.deploymentLayerStore, "put", async (...args: Parameters<typeof put>) => {
      entered();
      await blocked;
      return put(...args);
    });
    await listen(c.server, port);
    const controller = new AbortController();
    const pending = syncDeploymentLayer({
      ...f,
      transport: httpDeploymentLayerTransport(),
      allowUnavailable: true,
      signal: controller.signal,
    });
    try {
      await started;
      controller.abort();
      await assert.rejects(pending, /deployment layer sync was cancelled/);
    } finally {
      release();
      await close(c.server);
      f.close();
    }
  });

  await t.test("a lost acknowledgment retries the identical body without a second revision", async () => {
    const port = await unusedPort();
    const f = fixture(port);
    const c = core();
    await listen(c.server, port);
    const http = httpDeploymentLayerTransport();
    let lose = true;
    const transport: DeploymentLayerTransport = async (opts) => {
      const response = await http(opts);
      if (lose) {
        lose = false;
        throw new CoreUnreachableError("lost acknowledgment");
      }
      return response;
    };
    try {
      await syncDeploymentLayer({ ...f, transport, allowUnavailable: true });
      assert.equal((await c.built.deploymentLayerStore.get())?.version, 1);
    } finally {
      await close(c.server);
      f.close();
    }
  });
});
