import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { createDurableTasks } from "../src/durable/tasks.ts";
import { createSlackIngress, slackIngressKey } from "../src/slack/task-ingress.ts";
import { createHttpEventsReceiver } from "../src/slack/http-events.ts";

test("Slack acceptance persists a complete interaction before its worker runs and deduplicates redelivery", async () => {
  const tasks = createDurableTasks({ queue: "ingress-test" });
  const ingress = createSlackIngress(tasks);
  const body = {
    type: "block_actions",
    trigger_id: "trigger-1",
    user: { id: "U1" },
    actions: [{ action_id: "hilo_allow_once", value: "approval-1" }],
  };
  let executed = 0;
  ingress.register("bot-1", async (received, gate) => {
    assert.deepEqual(received, body);
    executed++;
    gate.persisted();
  });
  await ingress.accept("bot-1", body);
  await ingress.accept("bot-1", body);
  assert.equal(executed, 0);
  const task = await tasks.spawn(
    "slack.ingest",
    { account: "bot-1", body },
    { idempotencyKey: slackIngressKey("bot-1", body) },
  );
  const worker = tasks.start({ pollIntervalMs: 1 });
  try {
    await tasks.result(task.taskId);
    assert.equal(executed, 1);
  } finally {
    await worker.stop();
    await tasks.close();
  }
});

test("source identities isolate otherwise identical Slack events", () => {
  const body = { type: "event_callback", event_id: "Ev1" };
  assert.notEqual(slackIngressKey("first", body), slackIngressKey("second", body));
  assert.notEqual(slackIngressKey("first", body), slackIngressKey("first", { ...body, event_id: "Ev2" }));
});

test("HTTP interaction ACK waits for the durable commit and failed acceptance remains retryable", async () => {
  let release: (() => void) | undefined;
  let fail = false;
  const persisted = new Promise<void>((resolve) => {
    release = resolve;
  });
  const accepted: Record<string, unknown>[] = [];
  const secret = "test-ingress-signature";
  const receiver = createHttpEventsReceiver({
    signingSecret: secret,
    port: 0,
    accept: async (body) => {
      await persisted;
      if (fail) throw new Error("database unavailable");
      accepted.push(body);
    },
  });
  await receiver.start(0 as never);
  const address = receiver.server.address();
  assert.ok(address && typeof address === "object");
  const body = {
    type: "block_actions",
    trigger_id: "click-1",
    user: { id: "U1" },
    actions: [{ action_id: "hilo_allow_once", value: "approval-1" }],
  };
  const raw = new URLSearchParams({ payload: JSON.stringify(body) }).toString();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${raw}`).digest("hex")}`;
  const send = () =>
    fetch(`http://127.0.0.1:${address.port}/slack/events`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": signature,
      },
      body: raw,
    });
  try {
    let replied = false;
    const response = send().then((result) => {
      replied = true;
      return result;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    assert.equal(replied, false);
    release!();
    assert.equal((await response).status, 200);
    assert.deepEqual(accepted, [body]);
    fail = true;
    assert.equal((await send()).status, 503);
  } finally {
    await receiver.stop();
  }
});
