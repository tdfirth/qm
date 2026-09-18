import "./support/auto-fake-sprites.ts";

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/wiring.ts";
import { scopeId, type TurnRequest } from "../src/types.ts";
import { testConfig } from "./support/test-config.ts";
import { sleep } from "../src/util/async.ts";
import { waitFor } from "./support/settle.ts";
import { channelTurn, turnRequest } from "./support/turns.ts";

function freshApp() {
  const dataDir = mkdtempSync(join(tmpdir(), "ap-pollsilence-"));
  return buildApp(testConfig({ dataDir }));
}

function monitorFire(text: string, channel: string, root: string, fireKey: string): TurnRequest {
  return turnRequest(
    text,
    { externalId: "U1" },
    { kind: "channel", threadRef: `ch:${channel}:${root}`, channelRef: channel },
    {
      surface: "monitor",
      triggered: true,
      surfaceTools: true,
      addressed: true,
      triggerDestination: {
        type: "slack",
        target: `slack:${channel}:${root}`,
        audienceScopeId: scopeId("channel", channel),
      },
      idempotencyKey: fireKey,
      async: false,
    },
  );
}

async function slackDeliveries(deliveries: { pending(type: string): Promise<unknown[]> }): Promise<any[]> {
  return (await deliveries.pending("slack")) as any[];
}

test("poll fire: narration before a tool call is NOT auto-posted as an ack when the turn ends silently", async () => {
  const built = freshApp();
  built.runtime.start();
  try {
    const res = await built.app.turn(
      monitorFire("!preamble-then-quiet Still queued — silent.", "C-watch", "800.1", "monitor:m1:f1"),
    );
    assert.equal(res.status, "silent", "the model finished silently — the turn is silent");
    await sleep(300);
    assert.deepEqual(
      (await slackDeliveries(built.deliveries)).map((d) => d.text),
      [],
      "no mid-turn narration leaks to the surface on a background fire that ends silent",
    );
  } finally {
    await built.runtime.stop();
  }
});

test("poll fire: a closing reply whose final line is a silence marker is not direct-delivered", async () => {
  const built = freshApp();
  built.runtime.start();
  try {
    const res = await built.app.turn(
      monitorFire("!narrate-no-update Still queued behind the newer deploy.", "C-watch2", "801.1", "monitor:m1:f2"),
    );
    assert.equal(res.status, "silent", "a marker-terminated poll reply resolves to silent");
    await sleep(300);
    assert.deepEqual(
      (await slackDeliveries(built.deliveries)).map((d) => d.text),
      [],
      "the narration + [no-update] reply must not be posted to Slack",
    );
  } finally {
    await built.runtime.stop();
  }
});

test("poll fire: a genuine report is still delivered exactly once, buffered to the end of the turn", async () => {
  const built = freshApp();
  built.runtime.start();
  try {
    const res = await built.app.turn(
      monitorFire("!preamble Deploy finished — all green.", "C-watch3", "802.1", "monitor:m1:f3"),
    );
    assert.equal(res.status, "silent", "surfaceTools turn: delivery happens via the surface, result is silent");
    await sleep(300);
    const texts = (await slackDeliveries(built.deliveries)).map((d) => d.text);
    assert.equal(texts.length, 1, `exactly one delivery, buffered to turn end (got: ${JSON.stringify(texts)})`);
    assert.match(texts[0]!, /Deploy finished — all green\./, "the full report text is delivered");
    assert.match(texts[0]!, /All clear — nothing broke\./, "the trailing reply text is included");
  } finally {
    await built.runtime.stop();
  }
});

test("interactive mention: the first-block ack still posts immediately (unchanged)", async () => {
  const built = freshApp();
  built.runtime.start();
  try {
    await built.app.turn(
      channelTurn("!preamble On it — checking.", { externalId: "U1" }, "C-live", "900.1", {
        deliveryTarget: "slack:C-live:900.1",
        liveActor: true,
        async: true,
      }),
    );
    await waitFor(
      async () => (await slackDeliveries(built.deliveries)).find((d) => d.text === "On it — checking."),
      Boolean,
      5_000,
    );
  } finally {
    await built.runtime.stop();
  }
});
