import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexAppServer } from "../src/harness/codex-app-server.ts";

const cases = [
  { name: "U+2028 inside strings", text: "before\u2028after", ending: "\n", fragmented: false },
  { name: "U+2029 inside strings", text: "before\u2029after", ending: "\n", fragmented: false },
  { name: "split UTF-8 and CRLF frames", text: '界🙂\u2028\u2029\n\r\\quoted"', ending: "\r\n", fragmented: true },
  { name: "an unterminated final frame at EOF", text: "before\u2028after", ending: "", fragmented: true },
];

test("Codex responses do not wait for ordered notification callbacks", { timeout: 3000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "qm-codex-notification-concurrency-"));
  const binary = join(dir, "codex");
  writeFileSync(
    binary,
    `#!${process.execPath}
const readline = require("node:readline");
readline.createInterface({ input: process.stdin }).on("line", line => {
  const message = JSON.parse(line);
  process.stdout.write(JSON.stringify({ method: "progress", params: 1 }) + "\\n");
  process.stdout.write(JSON.stringify({ method: "progress", params: 2 }) + "\\n");
  process.stdout.write(JSON.stringify({ id: message.id, result: { value: "ready" } }) + "\\n");
});
`,
  );
  chmodSync(binary, 0o755);
  const release = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  const started: unknown[] = [];
  const completed: unknown[] = [];
  const server = new CodexAppServer({
    binaryPath: binary,
    cwd: dir,
    onNotification: async (_method, params) => {
      started.push(params);
      if (params === 1) await release.promise;
      completed.push(params);
      if (params === 2) second.resolve();
    },
    onRequest: async () => ({}),
  });
  t.after(async () => {
    release.resolve();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const result = await server.request(
    "probe",
    {},
    (value): value is { value: string } =>
      !!value && typeof value === "object" && (value as { value?: unknown }).value === "ready",
    AbortSignal.timeout(1000),
  );
  assert.deepEqual(result, { value: "ready" });
  assert.deepEqual(started, [1]);
  assert.deepEqual(completed, []);
  release.resolve();
  await second.promise;
  assert.deepEqual(started, [1, 2]);
  assert.deepEqual(completed, [1, 2]);
  assert.equal(server.error(), null);
});

test("Codex notification failures propagate after an unrelated response settles", { timeout: 3000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "qm-codex-notification-failure-"));
  const binary = join(dir, "codex");
  writeFileSync(
    binary,
    `#!${process.execPath}
const readline = require("node:readline");
const send = message => process.stdout.write(JSON.stringify(message) + "\\n");
const input = readline.createInterface({ input: process.stdin });
input.on("line", line => {
  const message = JSON.parse(line);
  send({ method: "progress" });
  send({ id: message.id, result: "ready" });
});
send({ method: "fixture/ready" });
`,
  );
  chmodSync(binary, 0o755);
  const release = Promise.withResolvers<void>();
  const ready = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<void>();
  const events: string[] = [];
  const server = new CodexAppServer({
    binaryPath: binary,
    cwd: dir,
    onNotification: async (method) => {
      if (method === "fixture/ready") {
        events.push("ready");
        ready.resolve();
        return;
      }
      events.push("notification started");
      await release.promise;
      events.push("notification failed");
      throw new Error("notification failed");
    },
    onRequest: async () => ({}),
  });
  server.process.once("close", () => closed.resolve());
  t.after(async () => {
    release.resolve();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await ready.promise;
  assert.equal(await server.request("probe", {}, AbortSignal.timeout(250)), "ready");
  events.push("response settled");
  assert.equal(server.error(), null);
  assert.deepEqual(events, ["ready", "notification started", "response settled"]);
  release.resolve();
  await closed.promise;
  assert.equal(server.error()?.message, "Codex app-server exited (SIGTERM)");
  assert.deepEqual(events, ["ready", "notification started", "response settled", "notification failed"]);
});

test("Codex tool requests do not block other calls, notifications, or RPC responses", { timeout: 3000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "qm-codex-tool-concurrency-"));
  const binary = join(dir, "codex");
  writeFileSync(
    binary,
    `#!${process.execPath}
const readline = require("node:readline");
const send = message => process.stdout.write(JSON.stringify(message) + "\\n");
readline.createInterface({ input: process.stdin }).on("line", line => {
  const message = JSON.parse(line);
  if (message.method === "start") {
    send({ id: "first", method: "item/tool/call" });
    send({ id: "second", method: "item/tool/call" });
    send({ id: "third", method: "item/tool/call" });
    send({ method: "progress", params: 1 });
    send({ method: "progress", params: 2 });
    send({ id: message.id, result: "started" });
  } else if (message.method === "nested") send({ id: message.id, result: "nested reply" });
  else if (["first", "second", "third"].includes(message.id)) send({ method: "tool/replied", params: message });
});
`,
  );
  chmodSync(binary, 0o755);
  const release = Promise.withResolvers<void>();
  const firstDone = Promise.withResolvers<void>();
  const notificationsDone = Promise.withResolvers<void>();
  const calls: number[] = [];
  const notifications: unknown[] = [];
  const replies: unknown[] = [];
  const server: CodexAppServer = new CodexAppServer({
    binaryPath: binary,
    cwd: dir,
    onNotification: async (method, params) => {
      if (method === "progress") {
        await Promise.resolve();
        notifications.push(params);
        if (params === 2) notificationsDone.resolve();
      } else {
        replies.push(params);
        if ((params as { id: string }).id === "first") firstDone.resolve();
      }
    },
    onRequest: async () => {
      const index = calls.length;
      calls.push(index);
      if (index === 0) {
        assert.equal(await server.request("nested"), "nested reply");
        await release.promise;
      }
      if (index === 2) throw new Error("tool failed");
      return index;
    },
  });
  t.after(async () => {
    release.resolve();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  assert.equal(await server.request("start", {}, AbortSignal.timeout(1000)), "started");
  assert.deepEqual(calls, [0, 1, 2]);
  await notificationsDone.promise;
  assert.deepEqual(notifications, [1, 2]);
  release.resolve();
  await firstDone.promise;
  assert.deepEqual(replies, [
    { id: "second", result: 1 },
    { id: "third", error: { code: -32000, message: "tool failed" } },
    { id: "first", result: 0 },
  ]);
  assert.equal(server.error(), null);
});

for (const fails of [false, true]) {
  test(`Codex tolerates an in-flight tool ${fails ? "failure" : "result"} after transport close`, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "qm-codex-tool-close-"));
    const binary = join(dir, "codex");
    writeFileSync(
      binary,
      `#!${process.execPath}
const readline = require("node:readline");
readline.createInterface({ input: process.stdin }).on("line", line => {
  const request = JSON.parse(line);
  process.stdout.write(JSON.stringify({ id: "tool", method: "item/tool/call" }) + "\\n");
  process.stdout.write(JSON.stringify({ id: request.id, result: "started" }) + "\\n");
});
`,
    );
    chmodSync(binary, 0o755);
    const release = Promise.withResolvers<void>();
    const finished = Promise.withResolvers<void>();
    const server = new CodexAppServer({
      binaryPath: binary,
      cwd: dir,
      onNotification: () => {},
      onRequest: async () => {
        await release.promise;
        finished.resolve();
        if (fails) throw new Error("late failure");
        return "late result";
      },
    });
    t.after(async () => {
      release.resolve();
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    });
    assert.equal(await server.request("start", {}, AbortSignal.timeout(1000)), "started");
    await server.close();
    const error = server.error();
    release.resolve();
    await finished.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(server.error(), error);
  });
}

for (const { name, text, ending, fragmented } of cases) {
  test(`Codex JSON-RPC preserves ${name}`, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "qm-codex-framing-"));
    const binary = join(dir, "codex");
    writeFileSync(
      binary,
      `#!${process.execPath}
const readline = require("node:readline");
readline.createInterface({ input: process.stdin }).on("line", line => {
  const request = JSON.parse(line);
  const text = ${JSON.stringify(text)};
  const data = Buffer.from(
    JSON.stringify({ method: "rawResponseItem/completed", params: { output: text } }) + "\\n" +
    JSON.stringify({ id: request.id, result: { text } }) + ${JSON.stringify(ending)}
  );
  const split = ${fragmented} ? data.indexOf(Buffer.from(JSON.stringify(text).slice(1, -1))) + 1 : data.length;
  process.stdout.write(data.subarray(0, split));
  setTimeout(() => {
    process.stdout.write(data.subarray(split));
    if (${ending === ""}) process.stdout.end();
  }, 20);
});
`,
    );
    chmodSync(binary, 0o755);
    const notifications: unknown[] = [];
    const server: CodexAppServer = new CodexAppServer({
      binaryPath: binary,
      cwd: dir,
      onNotification: (_method, params) => {
        notifications.push(params);
      },
      onRequest: async () => ({}),
    });
    t.after(async () => {
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    });
    assert.deepEqual(await server.request("test"), { text });
    assert.deepEqual(notifications, [{ output: text }]);
    if (ending) assert.deepEqual(await server.request("test"), { text });
    assert.equal(server.error(), null);
  });
}

test("a waiting tool cannot block another thread's RPC response or tool call", { timeout: 5000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "qm-codex-wait-"));
  const binary = join(dir, "codex");
  writeFileSync(
    binary,
    `#!${process.execPath}
const readline = require("node:readline");
const send = value => process.stdout.write(JSON.stringify(value) + "\\n");
readline.createInterface({ input: process.stdin }).on("line", line => {
  const message = JSON.parse(line);
  if (message.method === "start") {
    send({ id: message.id, result: {} });
    send({ id: "parent-wait", method: "item/tool/call", params: { threadId: "parent" } });
  } else if (message.method === "child/start") {
    send({ method: "child/started", params: {} });
    send({ id: message.id, result: { started: true } });
    send({ id: "child-message", method: "item/tool/call", params: { threadId: "child" } });
  } else if (message.id === "parent-wait") {
    send({ method: "parent/completed", params: message.result });
  }
});
`,
  );
  chmodSync(binary, 0o755);
  const childMessage = Promise.withResolvers<void>();
  const parentCompleted = Promise.withResolvers<unknown>();
  const notifications: string[] = [];
  const server: CodexAppServer = new CodexAppServer({
    binaryPath: binary,
    cwd: dir,
    onNotification: (method, params) => {
      notifications.push(method);
      if (method === "parent/completed") parentCompleted.resolve(params);
    },
    onRequest: async (_method, params) => {
      if ((params as { threadId: string }).threadId === "child") {
        childMessage.resolve();
        return {};
      }
      const started = await server.request("child/start");
      await childMessage.promise;
      return started;
    },
  });
  t.after(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await server.request("start");
  assert.deepEqual(await parentCompleted.promise, { started: true });
  assert.deepEqual(notifications, ["child/started", "parent/completed"]);
});
