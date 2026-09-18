import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli, tmp, rmDir, writeConfig } from "./harness.ts";

function scaffold(label: string): string {
  const dir = tmp(label);
  const r = runCli(["init", dir, "--org", "acme"]);
  assert.equal(r.code, 0, `init failed: ${r.out}`);
  return dir;
}

test("check passes on a scaffolded deployment and reports what it found", () => {
  const dir = scaffold("check-ok");
  try {
    const r = runCli(["check"], { cwd: dir });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /check passed/);
    assert.match(r.out, /example-tool/);
    assert.match(r.out, /greet/);
  } finally {
    rmDir(dir);
  }
});

test("check and secrets push include an operator-supplied OpenAI fallback", () => {
  const dir = tmp("openai-fallback");
  const fly = join(dir, "fly-fake");
  const log = join(dir, "fly.log");
  const fallback = "sk-synthetic-openai-fallback";
  const envLines = [
    `ANTHROPIC_API_KEY=sk-ant-synthetic-required`,
    `OPENAI_API_KEY=${fallback}`,
    `CAPABILITY_SECRET=${"capability".repeat(4)}`,
    `CONNECTOR_SECRET_KEY=${"connector".repeat(4)}`,
    `CORE_SIGNING_SECRET=${"core-signing".repeat(3)}`,
    `PORTAL_IDENTITY_SECRET=${"identity".repeat(4)}`,
    `SKILL_SIGNING_SECRET=${"skill-signing".repeat(3)}`,
    "PUBLIC_API_URL=https://core.example.test",
  ];
  try {
    writeConfig(dir, {
      orgId: "acme",
      target: "fly",
      region: "sjc",
      flyOrg: "personal",
      modelProvider: "anthropic",
      env: {
        core: {
          HARNESS: "pi",
          SNAPSHOT_STORE: "s3",
          TRANSFER_STORE: "s3",
          S3_BUCKET: "synthetic-bucket",
          S3_REGION: "auto",
        },
      },
    });
    writeFileSync(join(dir, ".env"), envLines.join("\n"));
    writeFileSync(log, "");
    writeFileSync(
      fly,
      `#!/usr/bin/env node\nconst fs = require("node:fs");\nconst a = process.argv.slice(2).join(" ");\nconst v = fs.readFileSync(0, "utf8");\nfs.appendFileSync(${JSON.stringify(log)}, a + "\\t" + v + "\\n");\nif (a.startsWith("status ")) process.stdout.write("{}");\n`,
    );
    chmodSync(fly, 0o755);

    const checked = runCli(["check"], { cwd: dir, withRepoEnv: false });
    assert.equal(checked.code, 0, checked.out);
    assert.match(checked.out, /optional secrets: .*OPENAI_API_KEY/);

    const pushed = runCli(["secrets", "push"], {
      cwd: dir,
      withRepoEnv: false,
      env: { FLY_BIN: fly, OPENAI_API_KEY: undefined },
    });
    assert.equal(pushed.code, 0, pushed.out);
    assert.doesNotMatch(pushed.out, new RegExp(fallback));
    const calls = readFileSync(log, "utf8");
    assert.match(calls, /secrets set --stage -a acme-core OPENAI_API_KEY=-\tsk-synthetic-openai-fallback/);

    writeFileSync(join(dir, ".env"), envLines.filter((line) => !line.startsWith("OPENAI_API_KEY=")).join("\n"));
    const missingFallback = runCli(["secrets", "push"], {
      cwd: dir,
      withRepoEnv: false,
      env: { FLY_BIN: fly, OPENAI_API_KEY: undefined },
    });
    assert.equal(missingFallback.code, 0, missingFallback.out);
    assert.match(missingFallback.out, /OPENAI_API_KEY: optional, not supplied/);
  } finally {
    rmDir(dir);
  }
});

test("check and secrets push honor an aliased OpenAI fallback", () => {
  const dir = tmp("openai-alias-fallback");
  const fly = join(dir, "fly-fake");
  const log = join(dir, "fly.log");
  const fallback = "sk-synthetic-aliased-openai-fallback";
  const canonical = "sk-synthetic-canonical-openai-fallback";
  const required = [
    `ANTHROPIC_API_KEY=sk-ant-synthetic-required`,
    `CAPABILITY_SECRET=${"capability".repeat(4)}`,
    `CONNECTOR_SECRET_KEY=${"connector".repeat(4)}`,
    `CORE_SIGNING_SECRET=${"core-signing".repeat(3)}`,
    `PORTAL_IDENTITY_SECRET=${"identity".repeat(4)}`,
    `SKILL_SIGNING_SECRET=${"skill-signing".repeat(3)}`,
    "PUBLIC_API_URL=https://core.example.test",
  ];
  try {
    writeConfig(dir, {
      orgId: "acme",
      target: "fly",
      region: "sjc",
      flyOrg: "personal",
      modelProvider: "anthropic",
      secretEnv: { core: { OPENAI_API_KEY: "MY_OPENAI_KEY" } },
      env: {
        core: {
          HARNESS: "pi",
          SNAPSHOT_STORE: "s3",
          TRANSFER_STORE: "s3",
          S3_BUCKET: "synthetic-bucket",
          S3_REGION: "auto",
        },
      },
    });
    writeFileSync(join(dir, ".env"), required.join("\n"));
    writeFileSync(log, "");
    writeFileSync(
      fly,
      `#!/usr/bin/env node\nconst fs = require("node:fs");\nconst a = process.argv.slice(2).join(" ");\nconst v = fs.readFileSync(0, "utf8");\nfs.appendFileSync(${JSON.stringify(log)}, a + "\\t" + v + "\\n");\nif (a.startsWith("status ")) process.stdout.write("{}");\n`,
    );
    chmodSync(fly, 0o755);

    const missingCheck = runCli(["check"], { cwd: dir, withRepoEnv: false });
    assert.equal(missingCheck.code, 0, missingCheck.out);
    assert.match(missingCheck.out, /MY_OPENAI_KEY/);
    assert.doesNotMatch(missingCheck.out, new RegExp(fallback));

    const missingPush = runCli(["secrets", "push"], {
      cwd: dir,
      withRepoEnv: false,
      env: { FLY_BIN: fly, OPENAI_API_KEY: undefined, MY_OPENAI_KEY: undefined },
    });
    assert.equal(missingPush.code, 1);
    assert.match(missingPush.out, /MY_OPENAI_KEY/);
    assert.doesNotMatch(missingPush.out, new RegExp(fallback));

    writeFileSync(join(dir, ".env"), [...required, `OPENAI_API_KEY=${canonical}`].join("\n"));
    const canonicalOnlyPush = runCli(["secrets", "push"], {
      cwd: dir,
      withRepoEnv: false,
      env: { FLY_BIN: fly, OPENAI_API_KEY: undefined, MY_OPENAI_KEY: undefined },
    });
    assert.equal(canonicalOnlyPush.code, 1);
    assert.match(canonicalOnlyPush.out, /MY_OPENAI_KEY/);
    assert.doesNotMatch(canonicalOnlyPush.out, new RegExp(canonical));

    writeFileSync(join(dir, ".env"), [...required, `MY_OPENAI_KEY=${fallback}`].join("\n"));
    const checked = runCli(["check"], { cwd: dir, withRepoEnv: false });
    assert.equal(checked.code, 0, checked.out);
    assert.doesNotMatch(checked.out, new RegExp(fallback));

    const pushed = runCli(["secrets", "push"], {
      cwd: dir,
      withRepoEnv: false,
      env: { FLY_BIN: fly, OPENAI_API_KEY: undefined, MY_OPENAI_KEY: undefined },
    });
    assert.equal(pushed.code, 0, pushed.out);
    assert.doesNotMatch(pushed.out, new RegExp(fallback));
    const calls = readFileSync(log, "utf8");
    assert.match(calls, /secrets set --stage -a acme-core OPENAI_API_KEY=-\tsk-synthetic-aliased-openai-fallback/);
    assert.doesNotMatch(calls, new RegExp(canonical));
  } finally {
    rmDir(dir);
  }
});

test("check fails on a malformed tool descriptor (invalid JSON)", () => {
  const dir = scaffold("check-badjson");
  try {
    writeFileSync(join(dir, "sandbox", "tools", "example-tool", "tool.json"), "{ not json");
    const r = runCli(["check"], { cwd: dir });
    assert.equal(r.code, 1);
    assert.match(r.out, /check failed/);
  } finally {
    rmDir(dir);
  }
});

test("check fails on a tool descriptor missing its id", () => {
  const dir = scaffold("check-noid");
  try {
    writeFileSync(join(dir, "sandbox", "tools", "example-tool", "tool.json"), JSON.stringify({ advertise: "x" }));
    const r = runCli(["check"], { cwd: dir });
    assert.equal(r.code, 1);
    assert.match(r.out, /check failed/);
  } finally {
    rmDir(dir);
  }
});

test("check fails on a config plugin that resolves to neither a source folder nor an image", () => {
  const dir = tmp("check-badplugin");
  try {
    writeConfig(dir, { orgId: "acme", target: "docker", plugins: [{ name: "widget" }] });
    const r = runCli(["check"], { cwd: dir });
    assert.equal(r.code, 1);
    assert.match(r.out, /check failed/);
    assert.match(r.out, /widget/);
  } finally {
    rmDir(dir);
  }
});

test("--sandbox-dir validates a sandbox layer kept outside the deployment dir", () => {
  const layerSrc = scaffold("check-layer-src");
  const dep = tmp("check-layer-dep");
  try {
    writeConfig(dep, { orgId: "acme", target: "docker" });
    const r = runCli(["check", "--sandbox-dir", join(layerSrc, "sandbox")], { cwd: dep });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /example-tool/);
  } finally {
    rmDir(layerSrc);
    rmDir(dep);
  }
});

test("check with no config in the directory is a clear error", () => {
  const dir = tmp("check-noconfig");
  try {
    const r = runCli(["check"], { cwd: dir });
    assert.equal(r.code, 1);
    assert.match(r.out, /qm\.config\.json/);
  } finally {
    rmDir(dir);
  }
});
