import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_FILENAME, loadConfigAt } from "../src/config.ts";
import { dockerUp } from "../src/backends/docker.ts";
import { setEnv, tempDir } from "./support.ts";

function makeDeployment(
  t: TestContext,
  config: Record<string, unknown>,
  setup: (dir: string) => void = () => {},
): string {
  const dir = tempDir(t, "qm-wiring-");
  writeFileSync(
    join(dir, CONFIG_FILENAME),
    JSON.stringify({
      contract: 1,
      orgId: "wiretest",
      publicUrl: "http://localhost:8080",
      target: "docker",
      services: ["core"],
      sandbox: {
        app: "wiretest-sandboxes",
      },
      ...config,
    }),
  );
  setup(dir);
  return dir;
}

function sandboxLayer(dir: string): void {
  mkdirSync(join(dir, "sandbox", "tools", "example-tool"), { recursive: true });
  writeFileSync(join(dir, "sandbox", "tools", "example-tool", "tool.json"), JSON.stringify({ id: "example-tool" }));
  writeFileSync(join(dir, "sandbox", "tools", "example-tool", "example-tool"), "#!/usr/bin/env bash\necho hi\n");
  chmodSync(join(dir, "sandbox", "tools", "example-tool", "example-tool"), 0o755);
  mkdirSync(join(dir, "sandbox", "skills", "greet"), { recursive: true });
  writeFileSync(join(dir, "sandbox", "skills", "greet", "SKILL.md"), "---\nname: greet\ndescription: x\n---\nbody\n");
}

async function plan(t: TestContext, configDir: string, opts: { sandboxDir?: string } = {}): Promise<string> {
  setEnv(t, { XDG_CONFIG_HOME: tempDir(t, "qm-xdg-") });
  const lines: string[] = [];
  const log = console.log,
    warn = console.warn;
  console.log = (...a: unknown[]): void => void lines.push(a.join(" "));
  console.warn = (...a: unknown[]): void => void lines.push(a.join(" "));
  try {
    const { config } = loadConfigAt(join(configDir, CONFIG_FILENAME));
    await dockerUp(config, configDir, { dryRun: true, ...(opts.sandboxDir ? { sandboxDir: opts.sandboxDir } : {}) });
  } finally {
    console.log = log;
    console.warn = warn;
  }
  return lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
}

test("local sandbox dry-run derives a deployment-scoped runnable image", async (t) => {
  const dir = makeDeployment(t, { sandbox: { backend: "local" } });
  const out = await plan(t, dir);
  assert.match(out, /sandbox: local image qm-wiretest-sandbox-local:latest/);
  assert.match(out, /LOCAL_SANDBOX_IMAGE/);
});

test("the deployment's sandbox/ skills + tools wire into the core via DEPLOYMENT_LAYER", async (t) => {
  const dir = makeDeployment(t, {}, sandboxLayer);
  const out = await plan(t, dir);
  assert.match(out, /DEPLOYMENT_LAYER/, "core env advertises DEPLOYMENT_LAYER");
  assert.match(out, new RegExp(`${join(dir, "sandbox")} → /layer \\(skills, tools\\)`));
  assert.doesNotMatch(
    out,
    /PLUGIN_SKILLS_DIRS/,
    "layer skills seed via the DEPLOYMENT_LAYER store, not PLUGIN_SKILLS_DIRS (which would replace the image's plugin defaults)",
  );
});

test("a bare deployment sets no DEPLOYMENT_LAYER and reports an empty layer", async (t) => {
  const dir = makeDeployment(t, {});
  const out = await plan(t, dir);
  assert.doesNotMatch(out, /DEPLOYMENT_LAYER/);
  assert.match(out, /no skills\/ or tools\/ in/);
});

test("--sandbox-dir sources the layer from a shared dir while config stays in the deployment dir", async (t) => {
  const dir = makeDeployment(t, {});
  const shared = tempDir(t, "qm-shared-");
  sandboxLayer(shared);
  const out = await plan(t, dir, { sandboxDir: join(shared, "sandbox") });
  assert.match(out, new RegExp(`${join(shared, "sandbox")} → /layer`));
});

test("sandbox.app/env/secretEnv become the core's FLY_* + FLY_RESIDENT_ENV_* env", async (t) => {
  const dir = makeDeployment(
    t,
    {
      sandbox: {
        app: "wire-sandboxes",
        env: { TZ: "UTC" },
        secretEnv: ["COMPANY_API_TOKEN"],
      },
    },
    (d) => writeFileSync(join(d, ".env"), "COMPANY_API_TOKEN=sek-ret\n"),
  );
  const out = await plan(t, dir);
  assert.match(out, /FLY_RESIDENT_ENV_TZ/);
  assert.match(out, /FLY_RESIDENT_ENV_COMPANY_API_TOKEN/);
});

test("a missing secretEnv value is warned, not invented", async (t) => {
  const dir = makeDeployment(t, {
    sandbox: {
      app: "s",
      secretEnv: ["NOPE_TOKEN"],
    },
  });
  const out = await plan(t, dir);
  assert.match(out, /sandbox.secretEnv "NOPE_TOKEN" has no value/);
});

test("model → PI_MODEL and host ports follow the offset map (core+0, portal+1, combined web-ui+2)", async (t) => {
  const dir = makeDeployment(t, { model: "claude-opus-4-8", services: ["core", "portal", "web-ui", "admin"] });
  const out = await plan(t, dir);
  assert.match(out, /PI_MODEL/);
  assert.match(out, /host :8080/);
  assert.match(out, /host :8081/);
  assert.match(out, /host :8082/);
  assert.doesNotMatch(out, /host :8083/);
});

test("QM_BASE_PORT overrides the host port base for one run", async (t) => {
  const dir = makeDeployment(t, { services: ["core"] });
  setEnv(t, { QM_BASE_PORT: "9000" });
  const out = await plan(t, dir);
  assert.match(out, /host :9000/);
});

test("source + image plugins both appear in the plan", async (t) => {
  const dir = makeDeployment(t, { plugins: [{ name: "linear", image: "ghcr.io/acme/linear:1" }] }, (d) => {
    mkdirSync(join(d, "plugins", "intercom"), { recursive: true });
    writeFileSync(join(d, "plugins", "intercom", "Dockerfile"), "FROM scratch\n");
  });
  const out = await plan(t, dir);
  assert.match(out, /plugin intercom: build plugins\/intercom\/Dockerfile/);
  assert.match(out, /plugin linear: pull ghcr\.io\/acme\/linear:1/);
});
