import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { scopeId } from "../src/types.ts";
import { mintCapabilityToken, CAPABILITY_TTL_MS } from "../src/auth/capability-token.ts";
import { startApi } from "./support/api.ts";

const SECRET = "reach-thread-secret".repeat(3);
const TS = "1723497600.123456";

describe("POST /v1/reach with threadTs", () => {
  const api = startApi({ signingSecret: SECRET }, () => ({ signingSecret: SECRET }));
  const { built } = api;

  const cap = async (actorId: string) =>
    await mintCapabilityToken(
      { actorId, scopeId: scopeId("personal", actorId), exp: Date.now() + CAPABILITY_TTL_MS },
      SECRET,
    );

  const post = async (body: unknown, actorId = "U-carol") =>
    api.post("/v1/reach", body, { "x-agent-capability": await cap(actorId) });

  before(async () => {
    await built.app.upsertDirectory([
      { principalId: "U-carol", displayName: "Carol", type: "internal" },
      { principalId: "U-alice", displayName: "Alice", type: "internal" },
    ]);
    await built.app.upsertChannels([{ channelId: "C-eng", name: "eng" }]);
  });

  after(api.close);

  it("threads a channel post: the delivery target carries channel:threadTs", async () => {
    const res = await post({ channel: "eng", text: "in the thread", threadTs: TS });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { deliveryId: string };
    const d = (await built.app.pendingDeliveries("slack")).find((x) => x.id === body.deliveryId);
    assert.ok(d, "delivery enqueued for the slack surface");
    assert.equal(d!.destination.target, `C-eng:${TS}`);
  });

  it("an unthreaded channel post keeps a bare channel target", async () => {
    const res = await post({ channel: "eng", text: "top level" });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { deliveryId: string };
    const d = (await built.app.pendingDeliveries("slack")).find((x) => x.id === body.deliveryId);
    assert.equal(d!.destination.target, "C-eng");
  });

  it("threads a DM to a person without changing its principal target", async () => {
    const res = await post({ recipient: "Alice", text: "in the DM thread", threadTs: TS });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { deliveryId: string };
    const d = (await built.app.pendingDeliveries("principal")).find((x) => x.id === body.deliveryId);
    assert.ok(d, "delivery enqueued for the principal surface");
    assert.equal(d!.destination.target, "U-alice");
    assert.equal(d!.destination.threadTs, TS);
  });

  it("rejects a malformed threadTs", async () => {
    const res = await post({ channel: "eng", text: "hi", threadTs: "not-a-ts" });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { message: string };
    assert.match(body.message, /threadTs must be/);
  });

  it("rejects threadTs combined with react or delete", async () => {
    const r1 = await post({ channel: "eng", react: { ts: TS, emoji: "eyes" }, threadTs: TS });
    assert.equal(r1.status, 400);
    const r2 = await post({ channel: "eng", delete: { ts: TS }, threadTs: TS });
    assert.equal(r2.status, 400);
  });
});
