import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runnableServices } from "../src/services.ts";
import { loadConfigAt } from "../src/config.ts";
import { flyLogs } from "../src/backends/fly.ts";
import { setEnv } from "./support.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const configDir = join(repoRoot, "deploy", "stacks", "acme");
const { config } = loadConfigAt(join(configDir, "qm.config.jsonc"));

function captureFlyLogs(
  t: TestContext,
  service: string | undefined,
  opts: { follow?: boolean; tail?: number },
): string {
  setEnv(t, { FLY_BIN: "flyctl-does-not-exist-xyz" });
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]): void => void lines.push(a.join(" "));
  try {
    flyLogs(config, configDir, service, opts);
  } finally {
    console.log = orig;
  }
  return lines.join("\n");
}

test("no <service> prints a per-app tail for every service (the interleaved-all promise)", (t) => {
  const out = captureFlyLogs(t, undefined, {});
  for (const svc of runnableServices(config.services)) {
    assert.match(out, new RegExp(`logs -a qm-${svc} --no-tail`), `missing tail for ${svc}`);
  }
});

test("without --follow the command exits: --no-tail is passed", (t) => {
  const out = captureFlyLogs(t, "core", {});
  assert.match(out, /logs -a qm-core --no-tail/);
});

test("with --follow the command streams: --no-tail is NOT passed", (t) => {
  const out = captureFlyLogs(t, "core", { follow: true });
  assert.match(out, /logs -a qm-core/);
  assert.doesNotMatch(out, /--no-tail/);
});

test("--tail is acknowledged as docker-only (flyctl has no line count)", (t) => {
  assert.match(captureFlyLogs(t, "core", { tail: 50 }), /--tail is a docker-only line count/);
});
