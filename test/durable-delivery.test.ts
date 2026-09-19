import { createSlackCoreClient } from "../src/api/slack-core-client.ts";
import { createMemoryAdvisoryLock } from "../src/persistence/advisory-lock.ts";
import { createMemoryMap } from "../src/persistence/durable-map.ts";
import { createSurfaceToolDeps } from "../src/core/orchestrator/surface-tools.ts";
import { turnPostKeys } from "../src/core/orchestrator/turn-helpers.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { DurableTaskDeferred } from "../src/durable/tasks.ts";
import { createDeliveryStore } from "../src/delivery/delivery-store.ts";
import { createDeliveryDispatcher, type DeliveryTaskContext } from "../src/delivery/task-delivery.ts";
import { createSlackDeliveryHandler } from "../src/slack/task-delivery.ts";
import { uploadDurableAttachment } from "../src/slack/attachments.ts";
import { createWebDeliveryHandler } from "../src/delivery/web-transcript-delivery.ts";
import { createMemorySessionStore } from "../src/sessions/memory-session-store.ts";
import { runResultDelivery } from "../src/delivery/run-result-delivery.ts";
import type { Delivery } from "../src/types.ts";
import type { Run } from "../src/runs/run-store.ts";

function checkpoints(after?: (key: string) => void): DeliveryTaskContext {
  const saved = new Map<string, unknown>();
  return {
    async step<T>(key: string, execute: () => Promise<T>): Promise<T> {
      if (saved.has(key)) return structuredClone(saved.get(key)) as T;
      const value = await execute();
      after?.(key);
      saved.set(key, structuredClone(value));
      return value;
    },
  };
}

test("durable delivery retries only unfinished effects and does not expire accepted work", async () => {
  const spawned: string[] = [];
  const store = createDeliveryStore({
    maxAgeMs: 0,
    scheduler: {
      spawnDelivery: async (id) => {
        spawned.push(id);
      },
    },
  });
  const delivery = await store.enqueue({
    destination: { type: "slack", target: "C1" },
    text: "answer",
    idempotencyKey: "result",
  });
  const dispatcher = createDeliveryDispatcher(store);
  let posts = 0;
  let fail = true;
  dispatcher.register(["slack"], async (_delivery, context) => {
    await context.step("post", async () => {
      posts++;
      return "posted";
    });
    if (fail) throw new Error("worker exited after posting");
  });
  const context = checkpoints();
  await assert.rejects(dispatcher.execute(delivery.id, context), /worker exited/);
  assert.equal((await store.get(delivery.id))?.deliveredAt, null);
  assert.deepEqual(await store.claimPending("slack", 1), []);
  assert.equal((await store.get(delivery.id))?.expiredAt, undefined);
  fail = false;
  await dispatcher.execute(delivery.id, context);
  assert.equal(posts, 1);
  assert.notEqual((await store.get(delivery.id))?.deliveredAt, null);
  assert.deepEqual(spawned, [delivery.id]);
});

test("a missing surface keeps delivery outstanding for a worker with the adapter", async () => {
  const store = createDeliveryStore();
  const delivery = await store.enqueue({
    destination: { type: "slack", target: "C1" },
    text: "answer",
    idempotencyKey: "missing-adapter",
  });
  await assert.rejects(createDeliveryDispatcher(store).execute(delivery.id, checkpoints()), DurableTaskDeferred);
  assert.equal((await store.get(delivery.id))?.deliveredAt, null);
});

test("an attachment reconciles a completed share after losing the step receipt", async () => {
  let allocations = 0;
  let transfers = 0;
  let shares = 0;
  let shared = false;
  let crash = true;
  const context = checkpoints((key) => {
    if (key.endsWith(":share") && crash) {
      crash = false;
      throw new Error("lost receipt");
    }
  });
  const client = {
    files: {
      getUploadURLExternal: async () => {
        allocations++;
        return { file_id: "F1", upload_url: "https://example.test/upload" };
      },
      completeUploadExternal: async () => {
        shares++;
        shared = true;
        return {};
      },
      info: async () => {
        if (!shared) throw { data: { error: "file_deleted" } };
        return { file: { shares: { private: { C1: [{ ts: "200.001" }] } } } };
      },
    },
  };
  const transfer = (async () => {
    transfers++;
    return new Response("ok");
  }) as typeof fetch;
  const execute = () =>
    uploadDurableAttachment(
      context,
      "file",
      client,
      "C1",
      "100.001",
      { name: "answer.txt", sizeBytes: 6, mimetype: "text/plain", blobId: "b1" },
      { readBlob: async () => Buffer.from("answer"), readFileArtifact: async () => Buffer.from("answer") },
      transfer,
    );
  await assert.rejects(execute(), /lost receipt/);
  assert.deepEqual(await execute(), { fileId: "F1", messageTs: "200.001" });
  assert.deepEqual({ allocations, transfers, shares }, { allocations: 1, transfers: 1, shares: 1 });
});

test("an expired Slack upload ticket is replaced from its durable artifact on retry", async () => {
  let allocations = 0;
  let blobReads = 0;
  let artifactReads = 0;
  let shares = 0;
  let shared = false;
  const context = checkpoints();
  const client = {
    files: {
      getUploadURLExternal: async () => ({ file_id: `F${++allocations}`, upload_url: "https://example.test/upload" }),
      completeUploadExternal: async ({ files }: { files: Array<{ id: string }> }) => {
        if (files[0]!.id === "F1") throw { data: { error: "file_not_found" } };
        shares++;
        shared = true;
      },
      info: async ({ file }: { file: string }) => {
        if (file === "F1" || !shared) throw { data: { error: "file_deleted" } };
        return { file: { shares: { private: { C1: [{ ts: "200.001" }] } } } };
      },
    },
  };
  const execute = () =>
    uploadDurableAttachment(
      context,
      "file",
      client,
      "C1",
      undefined,
      {
        name: "answer.txt",
        sizeBytes: 6,
        mimetype: "text/plain",
        blobId: "b1",
        artifactId: "artifact1",
        artifactViewerId: "U1",
      },
      {
        readBlob: async () => {
          if (++blobReads > 1) throw new Error("blob expired");
          return Buffer.from("answer");
        },
        readFileArtifact: async () => {
          artifactReads++;
          return Buffer.from("answer");
        },
      },
      (async () => new Response("ok")) as typeof fetch,
    );
  await assert.rejects(execute(), /expired before completion/);
  assert.deepEqual(await execute(), { fileId: "F2", messageTs: "200.001" });
  assert.deepEqual(await execute(), { fileId: "F2", messageTs: "200.001" });
  assert.deepEqual({ allocations, artifactReads, shares }, { allocations: 2, artifactReads: 1, shares: 1 });
});

test("a missing approval card is delivered from its durable request", async () => {
  const posts: Array<Record<string, unknown>> = [];
  const client = {
    conversations: {
      open: async () => ({ channel: { id: "D1" } }),
      history: async () => ({ messages: posts }),
      replies: async () => ({ messages: posts }),
    },
    chat: {
      postMessage: async (message: Record<string, unknown>) => {
        posts.push({ ...message, ts: String(posts.length + 1) });
        return { ts: String(posts.length) };
      },
    },
  };
  const core = {
    getApproval: async () => ({
      requestId: "a1",
      command: "deploy",
      reason: "needs approval",
      request: {
        surface: "slack",
        actor: { externalId: "U1" },
        conversation: { kind: "channel" },
        deliveryTarget: "C1:100.001",
        text: "deploy",
      },
    }),
  };
  const execute = createSlackDeliveryHandler({
    core: core as never,
    client,
    clientForIdentity: () => client,
    threads: { mark() {} },
  });
  const delivery: Delivery = {
    id: "d1",
    idempotencyKey: "approval-delivery",
    destination: { type: "slack", target: "C1:100.001", approvalRequestIds: ["a1"] },
    text: "",
    createdAt: 1,
    deliveredAt: null,
  };
  await execute(delivery, checkpoints());
  await execute(delivery, checkpoints());
  assert.equal(posts.length, 2);
  assert.equal(posts[0]!.channel, "D1");
  assert.equal(posts[1]!.channel, "C1");
});

test("approval-only run results retain a durable delivery obligation", () => {
  const delivery = runResultDelivery({
    id: "r1",
    status: "done",
    request: {
      surface: "slack",
      surfaceTools: true,
      deliveryTarget: "C1",
      actor: { id: "U1", type: "internal" },
      conversation: { kind: "dm", threadRef: "t1", audience: [] },
      origin: { kind: "human" },
    },
    result: { status: "pending_approval", pendingApprovals: [{ requestId: "a1", command: "deploy", reason: "ask" }] },
  } as unknown as Run);
  assert.deepEqual(delivery?.destination.approvalRequestIds, ["a1"]);
});

test("web delivery is recorded without a browser and stays idempotent beyond the old scan limit", async () => {
  const sessions = createMemorySessionStore();
  const session = await sessions.getOrCreateByThread("web:one", "dm", "personal:U1");
  const delivery: Delivery = {
    id: "d1",
    destination: { type: "web", target: "web:one" },
    text: "durable answer",
    idempotencyKey: "web-result",
    createdAt: 1,
    deliveredAt: null,
  };
  let notifications = 0;
  const execute = createWebDeliveryHandler(sessions, () => {
    notifications++;
  });
  await execute(delivery, checkpoints());
  const { lease } = await sessions.acquireLease(session.id, "turn");
  for (let i = 0; i < 220; i++)
    await sessions.append(lease!, { type: "user", payload: { text: `later ${i}` }, scopeLabel: session.scopeId });
  await sessions.releaseLease(lease!);
  await execute(delivery, checkpoints());
  const entries = await sessions.getEntries(session.id);
  assert.equal(
    entries.filter((entry) => (entry.payload as { deliveryKey?: string }).deliveryKey === "web-result").length,
    1,
  );
  assert.equal(notifications, 2);
});

test("a terminal delivery waits for an in-flight progress edit and fences later progress", async () => {
  const run = { id: "r-order", status: "running", request: {}, result: {} } as unknown as Run;
  const core = createSlackCoreClient({
    advisoryLock: createMemoryAdvisoryLock(),
    agentRequests: createMemoryMap(),
    runs: { get: async () => run, onTerminal: () => () => {} },
  } as any);
  const entered = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const writes: string[] = [];
  const progress = core.runProgress!(run.id, async () => {
    entered.resolve();
    await finish.promise;
    writes.push("progress");
  });
  await entered.promise;
  run.status = "done";
  const handler = createSlackDeliveryHandler({
    core,
    client: {
      chat: {
        update: async () => {
          writes.push("final");
          return {};
        },
      },
    },
    clientForIdentity: () => null,
    threads: { mark() {} },
  });
  const store = createDeliveryStore();
  const delivery = await store.enqueue({
    destination: { type: "slack", target: "C1", editRef: "1.1" },
    text: "done",
    idempotencyKey: `run:${run.id}`,
  });
  const final = handler(delivery, checkpoints());
  const late = core.runProgress!(run.id, async () => {
    writes.push("late");
  });
  finish.resolve();
  await Promise.all([progress, final, late]);
  assert.deepEqual(writes, ["progress", "final"]);
});

test("resuming a surface turn does not overwrite a prior explicit post that consumed its progress message", async () => {
  const deliveries = createDeliveryStore();
  const context = {
    deps: { deliveries, runs: { get: async () => ({ deliveryState: { editRef: "1.1" } }) } },
    input: { surfaceTools: true, runId: "r-surface" },
    actor: { id: "u1" },
    conversation: {},
    session: { id: "s1" },
    defaultDestination: { type: "slack", target: "C1" },
    postProvenance: (key: string) => ({ fireKey: key }),
    spine: { surfaceOutboundCount: 0 },
  };
  const keys = turnPostKeys("r-surface");
  const first = createSurfaceToolDeps({ ...context, postKeys: keys } as any)!;
  assert.equal((await first.post!("first answer"))?.ok, true);
  const resumedKeys = turnPostKeys("r-surface");
  resumedKeys.seed(1);
  const resumed = createSurfaceToolDeps({ ...context, postKeys: resumedKeys } as any)!;
  assert.equal((await resumed.post!("next answer"))?.ok, true);
  assert.equal((await deliveries.getByKey(keys.key(context.defaultDestination, 0)))?.destination.editRef, "1.1");
  assert.equal((await deliveries.getByKey(keys.key(context.defaultDestination, 1)))?.destination.editRef, undefined);
});

test("delivery adapters are isolated by Slack account and release their registrations", async () => {
  const store = createDeliveryStore();
  const dispatcher = createDeliveryDispatcher(store);
  const delivered: string[] = [];
  dispatcher.register(["slack"], async () => {
    delivered.push("default");
  });
  const unregister = dispatcher.register(
    ["slack"],
    async () => {
      delivered.push("staff");
    },
    "staff",
  );
  const row = await store.enqueue({
    destination: { type: "slack", target: "C1", slackAccount: "staff" },
    text: "answer",
    idempotencyKey: "account-route",
  });
  await dispatcher.execute(row.id, checkpoints());
  assert.deepEqual(delivered, ["staff"]);
  unregister();
  const next = await store.enqueue({
    destination: row.destination,
    text: "next",
    idempotencyKey: "account-route-next",
  });
  await assert.rejects(dispatcher.execute(next.id, checkpoints()), DurableTaskDeferred);
});

test("a known completed upload waits for delayed visibility without completing or allocating again", async () => {
  const context = checkpoints();
  let allocations = 0;
  let completions = 0;
  let visible = false;
  const client = {
    files: {
      getUploadURLExternal: async () => ({ file_id: `F${++allocations}`, upload_url: "https://example.test/upload" }),
      completeUploadExternal: async () => {
        if (++completions > 1) throw { data: { error: "file_not_found" } };
      },
      info: async () => ({ file: { shares: visible ? { private: { C1: [{ ts: "2.1" }] } } : {} } }),
    },
  };
  const execute = () =>
    uploadDurableAttachment(
      context,
      "file",
      client,
      "C1",
      undefined,
      { name: "x", mimetype: "text/plain", sizeBytes: 1, blobId: "b" },
      { readBlob: async () => Buffer.from("x"), readFileArtifact: async () => Buffer.from("x") },
      (async () => new Response("ok")) as typeof fetch,
    );
  await assert.rejects(execute(), DurableTaskDeferred);
  visible = true;
  assert.deepEqual(await execute(), { fileId: "F1", messageTs: "2.1" });
  assert.deepEqual({ allocations, completions }, { allocations: 1, completions: 1 });
});

test("an uncertain completed upload keeps the same file when its one-shot ticket disappears", async () => {
  let loseReceipt = true;
  const context = checkpoints((key) => {
    if (key === "file:complete" && loseReceipt) {
      loseReceipt = false;
      throw new Error("lost completion receipt");
    }
  });
  let allocations = 0;
  let completions = 0;
  let visible = false;
  const client = {
    files: {
      getUploadURLExternal: async () => ({ file_id: `F${++allocations}`, upload_url: "https://example.test/upload" }),
      completeUploadExternal: async () => {
        if (++completions > 1) throw { data: { error: "file_not_found" } };
      },
      info: async () => ({ file: { shares: visible ? { private: { C1: [{ ts: "2.1" }] } } : {} } }),
    },
  };
  const execute = () =>
    uploadDurableAttachment(
      context,
      "file",
      client,
      "C1",
      undefined,
      { name: "x", mimetype: "text/plain", sizeBytes: 1, blobId: "b" },
      { readBlob: async () => Buffer.from("x"), readFileArtifact: async () => Buffer.from("x") },
      (async () => new Response("ok")) as typeof fetch,
    );
  await assert.rejects(execute(), /lost completion receipt/);
  await assert.rejects(
    execute(),
    (error: unknown) => error instanceof DurableTaskDeferred && /uncertain/.test(error.message),
  );
  assert.equal(allocations, 1);
  visible = true;
  assert.deepEqual(await execute(), { fileId: "F1", messageTs: "2.1" });
  assert.deepEqual({ allocations, completions }, { allocations: 1, completions: 2 });
});
