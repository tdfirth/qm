import "./support/auto-fake-sprites.ts";

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createMemoryLedgerEventBus,
  createPostgresLedgerEventBus,
  type OwnedLedgerEvent,
} from "../src/loops/ledger-events.ts";
import { buildApp } from "../src/wiring.ts";
import { serveApp, tmpDir } from "./support/api.ts";
import { testConfig } from "./support/test-config.ts";

const PG = process.env.DATABASE_URL;
const pgSkip = PG ? false : "set DATABASE_URL to run the Postgres ledger-event bus test";

function event(over: Partial<OwnedLedgerEvent> = {}): OwnedLedgerEvent {
  return { loopId: "loop-1", itemId: "item-1", op: "ingest", at: 111, owner: "josh", ...over };
}

test("memory bus: subscribers receive emitted events and unsubscribe cleanly", () => {
  const bus = createMemoryLedgerEventBus();
  const got: OwnedLedgerEvent[] = [];
  const off = bus.subscribe((e) => got.push(e));
  bus.emit(event());
  bus.emit(event({ op: "action", at: 222 }));
  assert.deepEqual(
    got.map((e) => e.op),
    ["ingest", "action"],
  );
  off();
  bus.emit(event({ op: "reopen" }));
  assert.equal(got.length, 2, "an unsubscribed listener hears nothing");
});

test("[postgres] ledger events cross bus instances (pg_notify)", { skip: pgSkip }, async () => {
  const a = createPostgresLedgerEventBus(PG!);
  const b = createPostgresLedgerEventBus(PG!);
  try {
    const got: OwnedLedgerEvent[] = [];
    const ready = new Promise<void>((resolve) => {
      b.subscribe((e) => {
        if (e.loopId === "loop-xbus") {
          got.push(e);
          resolve();
        }
      });
    });
    const deadline = Date.now() + 5_000;
    for (;;) {
      a.emit(event({ loopId: "loop-xbus", itemId: "item-9", op: "shipped", at: 42, owner: "ada" }));
      const landed = await Promise.race([
        ready.then(() => true),
        new Promise((r) => setTimeout(r, 250)).then(() => false),
      ]);
      if (landed) break;
      if (Date.now() > deadline) assert.fail("event never crossed instances");
    }
    assert.equal(got[0]?.itemId, "item-9");
    assert.equal(got[0]?.op, "shipped");
    assert.equal(got[0]?.owner, "ada");
    assert.equal(got[0]?.at, 42);
  } finally {
    await a.close?.();
    await b.close?.();
  }
});

test("GET /v1/loop-items/events streams ledger writes as SSE frames, stamped with the loop owner", async () => {
  const built = buildApp(testConfig({ dataDir: tmpDir("ap-ledger-sse-"), orgId: "acme" }));
  built.runtime.start();
  const core = serveApp(built.app, { webhookReceiver: built.webhookReceiver });
  try {
    const res = await fetch(`${core.base}/v1/loop-items/events`, { signal: AbortSignal.timeout(15_000) });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);

    const { loop } = await built.loops.store.create({
      owner: "josh",
      createdBy: "josh",
      ownerScopeId: "personal:josh",
      name: "Sentry triage",
      playbook: "triage",
      successCondition: "fixed",
    });
    await built.loops.items.ingest([{ loopId: loop.id, dedupeKey: "SENTRY-1", sourcePayload: { issue: "SENTRY-1" } }]);

    const reader = res.body!.getReader();
    let buf = "";
    let frame: OwnedLedgerEvent | null = null;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && !frame) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += new TextDecoder().decode(value);
      for (const chunk of buf.split("\n\n")) {
        if (!chunk.includes("event: loop_item")) continue;
        const data = chunk
          .split("\n")
          .find((l) => l.startsWith("data: "))
          ?.slice("data: ".length);
        if (data) frame = JSON.parse(data) as OwnedLedgerEvent;
      }
    }
    await reader.cancel().catch(() => {});
    assert.ok(frame, "a ledger write reached the SSE stream");
    assert.equal(frame!.loopId, loop.id);
    assert.equal(frame!.op, "ingest");
    assert.equal(frame!.owner, "josh", "the frame carries the loop owner the BFF routes by");
  } finally {
    await core.close();
    await built.runtime.stop();
  }
});
