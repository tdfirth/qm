import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runSandboxBuild, type SandboxBuildOpts } from "../src/commands/sandbox.ts";
import type { QmConfig } from "../src/config.ts";
import { dockerConfig, tempDir } from "./support.ts";

const CONFIG = dockerConfig();

function sandboxDir(t: TestContext, setup: (sb: string) => void): string {
  const sb = join(tempDir(t, "qm-sbx-build-"), "sandbox");
  mkdirSync(sb, { recursive: true });
  setup(sb);
  return sb;
}

function tool(sb: string, id: string, descriptor: object, withExe = true): void {
  const td = join(sb, "tools", id);
  mkdirSync(td, { recursive: true });
  writeFileSync(join(td, "tool.json"), JSON.stringify(descriptor));
  if (withExe) {
    writeFileSync(join(td, id), "#!/usr/bin/env bash\necho hi\n");
    chmodSync(join(td, id), 0o755);
  }
}

function dryRun(opts: Omit<SandboxBuildOpts, "dryRun" | "config"> & { config?: QmConfig }): string {
  const lines: string[] = [];
  const log = console.log,
    warn = console.warn;
  console.log = (...a: unknown[]): void => void lines.push(a.join(" "));
  console.warn = (...a: unknown[]): void => void lines.push(a.join(" "));
  try {
    runSandboxBuild({ ...opts, config: opts.config ?? CONFIG, dryRun: true });
  } finally {
    console.log = log;
    console.warn = warn;
  }
  return lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
}

test("generates a Dockerfile that COPYs each tool executable onto PATH + bakes the presence check", (t) => {
  const sb = sandboxDir(t, (s) => tool(s, "example-tool", { id: "example-tool", install: { binary: "example-tool" } }));
  const out = dryRun({ sandboxDir: sb });
  assert.match(out, /FROM registry\.invalid\/qm\/qm-sandbox-base@sha256:a{64}/);
  assert.match(out, /COPY tools\/example-tool\/example-tool \/usr\/local\/bin\/example-tool/);
  assert.match(out, /command -v "\$b"/);
  assert.match(out, /'example-tool'/);
  assert.match(out, /acme-sandbox:local/);
});

test("--from overrides the base image for the generated Dockerfile", (t) => {
  const sb = sandboxDir(t, (s) => tool(s, "t", { id: "t" }));
  const out = dryRun({ sandboxDir: sb, from: "registry.fly.io/custom-base:v1" });
  assert.match(out, /FROM registry\.fly\.io\/custom-base:v1/);
});

test("a custom sandbox/Dockerfile owns the recipe; --from is warned-ignored; presence check appended", (t) => {
  const sb = sandboxDir(t, (s) => {
    tool(s, "apt-tool", { id: "apt-tool", install: { binary: "apt-tool" } }, false);
    writeFileSync(join(s, "Dockerfile"), "FROM my/base:1\nRUN apt-get install -y apt-tool\n");
  });
  const out = dryRun({ sandboxDir: sb, from: "registry.fly.io/ignored:1" });
  assert.match(out, /FROM my\/base:1/);
  assert.match(out, /--from is ignored/);
  assert.match(out, /command -v "\$b"/);
  assert.match(out, /'apt-tool'/);
});

test("custom Dockerfile provenance recognizes platform flags, aliases, lowercase, and stage reuse", (t) => {
  const sb = sandboxDir(t, (s) => {
    writeFileSync(
      join(s, "Dockerfile"),
      "from --platform=linux/arm64 my/base:1 AS build\nRUN true\nFROM build AS final\n",
    );
  });
  const out = dryRun({ sandboxDir: sb });
  assert.match(out, /base:\s+.*Dockerfile \(custom\)/);
  assert.match(out, /from --platform=linux\/arm64 my\/base:1 AS build/);
});

test("custom Dockerfiles must pin all but one distinct external base", (t) => {
  const sb = sandboxDir(t, (s) => {
    writeFileSync(join(s, "Dockerfile"), "FROM first/base:1 AS build\nFROM second/base:2\n");
  });
  assert.throws(() => dryRun({ sandboxDir: sb }), /multiple mutable external base images/);
});

test("--tag sets the image tag", (t) => {
  const sb = sandboxDir(t, (s) => tool(s, "t", { id: "t" }));
  const out = dryRun({ sandboxDir: sb, tag: "acme-sandbox:v2" });
  assert.match(out, /acme-sandbox:v2/);
});

test("a broken layer (tool with no executable and no Dockerfile) fails before building", (t) => {
  const sb = sandboxDir(t, (s) => tool(s, "x", { id: "x", install: { binary: "x" } }, false));
  assert.throws(() => dryRun({ sandboxDir: sb }), /sandbox check failed/);
});
