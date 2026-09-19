import assert from "node:assert/strict";
import { test } from "node:test";
import { withDurableMemoryCapture, type MemoryCaptureBurst } from "../src/memory/durable-capture.ts";
import { createDurableTasks } from "../src/durable/tasks.ts";
import { createMemoryMap, createPostgresMap } from "../src/persistence/durable-map.ts";
import { sleep, withTimeout } from "../src/util/async.ts";
import { isolatedPostgres } from "./support/isolated-postgres.ts";

const input = (id: string) => ({
  scopeId: "personal:U1" as const,
  actorId: "U1",
  input: id,
  reply: `reply:${id}`,
  idempotencyKey: id,
});

test("durable memory preserves maximum burst size and deduplicates accepted turns", async () => {
  const tasks = createDurableTasks({ queue: "memory" });
  const captured: string[][] = [];
  const strategy = withDurableMemoryCapture(
    {
      onTurnEnd: async () => {
        throw new Error("batch adapter must be used");
      },
      captureBurst: async (batch) => {
        captured.push(batch.turns.map((turn) => turn.input));
      },
    },
    tasks,
    createMemoryMap(),
    60_000,
    2,
  );
  await strategy.onTurnEnd!(input("one"));
  await strategy.onTurnEnd!(input("two"));
  await strategy.onTurnEnd!(input("two"));
  tasks.start({ concurrency: 2 });
  try {
    await withTimeout(
      async () => {
        while (!captured.length) await sleep(10);
      },
      2000,
      "burst capture",
    );
    assert.deepEqual(captured, [["one", "two"]]);
  } finally {
    await tasks.close();
  }
});

test(
  "accepted memory capture and its batch survive worker replacement and extraction failure",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const db = await isolatedPostgres();
    let tasks = createDurableTasks({ databaseUrl: db.url, queue: "qm_capture_test" });
    let attempts = 0;
    const captured: string[][] = [];
    const firstMap = createPostgresMap<MemoryCaptureBurst>(tasks.pg!, "test_capture_bursts");
    const first = withDurableMemoryCapture(
      {
        onTurnEnd: async () => {},
        captureBurst: async () => {
          attempts++;
          throw new Error("provider unavailable");
        },
      },
      tasks,
      firstMap,
      0,
      10,
    );
    try {
      await first.onTurnEnd!(input("accepted"));
      tasks.start({ pollIntervalMs: 10 });
      await withTimeout(
        async () => {
          while (!attempts) await sleep(10);
        },
        2000,
        "first capture attempt",
      );
      await tasks.close();
      tasks = createDurableTasks({ databaseUrl: db.url, queue: "qm_capture_test" });
      withDurableMemoryCapture(
        {
          onTurnEnd: async () => {},
          captureBurst: async (batch) => {
            captured.push(batch.turns.map((turn) => turn.input));
          },
        },
        tasks,
        createPostgresMap<MemoryCaptureBurst>(tasks.pg!, "test_capture_bursts"),
        0,
        10,
      );
      tasks.start({ pollIntervalMs: 10 });
      await withTimeout(
        async () => {
          while (!captured.length) await sleep(10);
        },
        5000,
        "recovered capture",
      );
      assert.deepEqual(captured, [["accepted"]]);
    } finally {
      await tasks.close();
      await db.cleanup();
    }
  },
);

test("a lost batch completion receipt cannot consume a later capture on replay", async () => {
  const tasks = createDurableTasks({ queue: "memory" });
  const bursts = createMemoryMap<MemoryCaptureBurst>();
  const update = bursts.update!.bind(bursts);
  let injected = false;
  bursts.update = async (id, edit) => {
    let completing = false;
    const result = await update(id, (state) => {
      const next = edit(state);
      completing = !injected && Object.keys(state.active).length > 0 && Object.keys(next.active).length === 0;
      if (!completing) return next;
      return { ...next, pending: [{ id: "later", acceptedAt: Date.now(), params: input("later") }] };
    });
    if (completing) {
      injected = true;
      throw new Error("completion acknowledgement lost");
    }
    return result;
  };
  let taskId = "";
  const schedule = tasks.spawn.bind(tasks);
  tasks.spawn = async (name, params, options) => {
    const task = await schedule(name, params, options);
    taskId = task.taskId;
    return task;
  };
  const captured: string[][] = [];
  const strategy = withDurableMemoryCapture(
    {
      onTurnEnd: async () => {},
      captureBurst: async (batch) => {
        captured.push(batch.turns.map((turn) => turn.input));
      },
    },
    tasks,
    bursts,
    0,
  );
  await strategy.onTurnEnd!(input("first"));
  tasks.start();
  try {
    await withTimeout(() => tasks.result(taskId), 3000, "retried batch");
    assert.deepEqual(captured, [["first"]]);
    assert.deepEqual(
      (await bursts.all())[0]!.pending.map((event) => event.params.input),
      ["later"],
    );
    assert.deepEqual((await bursts.all())[0]!.active, {});
  } finally {
    await tasks.close();
  }
});
