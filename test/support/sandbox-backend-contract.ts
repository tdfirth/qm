import { test } from "node:test";
import assert from "node:assert/strict";
import type { WorkspaceLayer } from "../../src/types.ts";
import { supportsProcessSessions, type Sandbox } from "../../src/sandbox/sandbox.ts";
import { pollProcess } from "../../src/sandbox/process-poll.ts";
import { mintCapabilityToken, EGRESS_PROXY_AUD } from "../../src/auth/capability-token.ts";

interface SandboxBackendContract {
  make(extra?: Record<string, unknown>): Sandbox;
  scope: string;
  layers: WorkspaceLayer[];
  execScripts(): string[];
}

export function sandboxBackendContract({ make, scope, layers, execScripts }: SandboxBackendContract): void {
  test("provision runs commands with env and cwd", async () => {
    const sandbox = make();
    const h = await sandbox.provision(layers, { env: { MY_VAR: "v1" } });
    assert.equal(h.coldStart, true);
    const r = await sandbox.run(h, "pwd; echo VAR=$MY_VAR");
    assert.equal(r.code, 0);
    assert.match(r.stdout, /workspace/);
    assert.match(r.stdout, /VAR=v1/);
  });

  test("an already-aborted signal never executes a command", async () => {
    const sandbox = make();
    const handle = await sandbox.provision(layers);
    const before = execScripts().length;
    const signal = AbortSignal.abort();
    await assert.rejects(sandbox.run(handle, "echo must-not-run", { signal }), /aborted/i);
    assert.equal(execScripts().length, before);
  });

  test("streams and exit codes are exact", async () => {
    const sandbox = make();
    const h = await sandbox.provision(layers);
    const r = await sandbox.run(h, "echo out; echo err >&2; exit 3");
    assert.equal(r.code, 3);
    assert.equal(r.stdout.trim(), "out");
    assert.equal(r.stderr.trim(), "err");
  });

  test("file roundtrip incl. large binary and missing file", async () => {
    const sandbox = make();
    const h = await sandbox.provision(layers);
    await sandbox.writeFile(h, "a/b.txt", "hello\n");
    assert.equal(await sandbox.readFile(h, "a/b.txt"), "hello\n");
    assert.equal(await sandbox.readFile(h, "nope.txt"), null);
    const big = Buffer.alloc(200 * 1024);
    for (let i = 0; i < big.length; i++) big[i] = (i * 7) % 256;
    await sandbox.writeFileBytes(h, "big.bin", big);
    const back = await sandbox.readFileBytes(h, "big.bin");
    assert.ok(back && Buffer.from(back).equals(big));
    const huge = Buffer.alloc(1300 * 1024);
    for (let i = 0; i < huge.length; i++) huge[i] = (i * 13) % 256;
    await sandbox.writeFileBytes(h, "huge.bin", huge);
    const hugeBack = await sandbox.readFileBytes(h, "huge.bin");
    assert.ok(hugeBack && Buffer.from(hugeBack).equals(huge));
  });

  test("empty file roundtrip", async () => {
    const sandbox = make();
    const h = await sandbox.provision(layers);
    await sandbox.writeFileBytes(h, "empty.bin", Buffer.alloc(0));
    const back = await sandbox.readFileBytes(h, "empty.bin");
    assert.ok(back);
    assert.equal(back.length, 0);
  });

  test("listDir and removeDir", async () => {
    const sandbox = make();
    const h = await sandbox.provision(layers);
    await sandbox.writeFile(h, "d/one.txt", "1");
    await sandbox.writeFile(h, "d/e/two.txt", "2");
    const listed = await sandbox.listDir(h, "d");
    assert.deepEqual(listed.sort(), ["d/e/two.txt", "d/one.txt"]);
    await sandbox.removeDir(h, "d");
    assert.equal(await sandbox.readFile(h, "d/one.txt"), null);
  });

  test("process sessions capability works end to end", async () => {
    const sandbox = make();
    assert.ok(supportsProcessSessions(sandbox));
    if (!supportsProcessSessions(sandbox)) return;
    const h = await sandbox.provision(layers);
    const { processId } = await sandbox.startProcess(h, "echo one; echo two");
    const { output, status } = await pollProcess(sandbox, h, processId, { deadlineMs: 5_000, waitMs: 100 });
    assert.equal(status.state, "exited");
    assert.match(output, /one/);
    assert.match(output, /two/);
  });

  test("force-through proxy env is set when a proxy url and token are present", async () => {
    const s = make({ egressProxyUrl: "https://proxy.example.com" });
    const token = await mintCapabilityToken(
      { actorId: "tester", scopeId: scope, aud: EGRESS_PROXY_AUD, exp: Date.now() + 600_000 },
      "secret",
    );
    const h = await s.provision(layers, { egressToken: token });
    const r = await s.run(h, "echo PROXY=$HTTPS_PROXY");
    assert.match(r.stdout, /PROXY=https?:\/\/[^ ]*proxy\.example\.com/);
  });

  test("no proxy env without a proxy url", async () => {
    const sandbox = make();
    const h = await sandbox.provision(layers, { egressToken: "ignored" });
    assert.equal(h.env?.HTTPS_PROXY, undefined);
  });

  test("large command output survives intact", async () => {
    const sandbox = make();
    const h = await sandbox.provision(layers);
    const r = await sandbox.run(h, "python3 -c \"print('x' * (900 * 1024), end='')\"");
    assert.equal(r.code, 0);
    assert.equal(r.stdout.length, 900 * 1024);
    assert.equal(r.stdout, "x".repeat(900 * 1024));
  });
}
