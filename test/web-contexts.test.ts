import "./support/auto-fake-sprites.ts";

import { test } from "node:test";
import assert from "node:assert/strict";
import type { ContextSummary } from "../src/api/app.ts";
import { type Served, startApi, tmpDir } from "./support/api.ts";
import { dmTurn, turnRequest } from "./support/turns.ts";

const start = () => startApi({ dataDir: tmpDir("webctx-") });

const contexts = async (srv: Served, principalId: string): Promise<ContextSummary[]> => {
  const res = await srv.get(`/v1/contexts?principalId=${encodeURIComponent(principalId)}`);
  assert.equal(res.status, 200);
  return ((await res.json()) as { contexts: ContextSummary[] }).contexts;
};

const webTurn = (srv: Served, actor: string, conversation: unknown, text = "hi") =>
  srv.post("/v1/turns", { surface: "web", actor: { externalId: actor }, conversation, text });

test("GET /v1/contexts: personal always; public channels and current private memberships", async () => {
  const s = start();
  try {
    const before = await contexts(s, "alice");
    assert.equal(before.length, 1);
    assert.equal(before[0]!.scopeId, "personal:alice");
    assert.equal(before[0]!.kind, "personal");

    await s.built.app.upsertChannels(
      [
        { channelId: "C1", name: "eng", isPrivate: false },
        { channelId: "C2", name: "sekrit", isPrivate: true },
      ],
      [{ channelId: "C2", principalId: "alice" }],
    );

    const alice = await contexts(s, "alice");
    assert.deepEqual(alice.map((c) => c.scopeId).sort(), ["channel:C1", "channel:C2", "personal:alice"]);
    assert.equal(alice[0]!.kind, "personal", "personal sorts first");
    assert.equal(alice.find((c) => c.scopeId === "channel:C2")!.isPrivate, true);

    const bob = await contexts(s, "bob");
    assert.deepEqual(
      bob.map((c) => c.scopeId).sort(),
      ["channel:C1", "personal:bob"],
      "public rooms remain usable without stale-session authority",
    );
  } finally {
    await s.close();
  }
});

test("web turns into a shared scope are membership-checked; sessions then count toward the context", async () => {
  const s = start();
  try {
    await s.built.app.upsertDirectory([
      { principalId: "alice", displayName: "Alice", type: "internal" },
      { principalId: "bob", displayName: "Bob", type: "internal" },
    ]);
    await s.built.app.upsertChannels(
      [
        { channelId: "C1", name: "eng", isPrivate: false },
        { channelId: "C2", name: "sekrit", isPrivate: true },
      ],
      [{ channelId: "C2", principalId: "alice" }],
    );

    const aliceOk = await webTurn(s, "alice", { kind: "channel", threadRef: "web:alice:t1", channelRef: "C2" });
    assert.equal(aliceOk.status, 200);
    const bobNo = await webTurn(s, "bob", { kind: "channel", threadRef: "web:bob:t1", channelRef: "C2" });
    assert.equal(bobNo.status, 403);
    assert.equal((await webTurn(s, "bob", { kind: "channel", threadRef: "web:bob:t2", channelRef: "C1" })).status, 200);

    assert.equal((await webTurn(s, "bob", { kind: "channel", threadRef: "web:bob:t3", channelRef: "C9" })).status, 403);
    assert.equal((await webTurn(s, "bob", { kind: "group", threadRef: "web:bob:t4" })).status, 403);

    const bob = await contexts(s, "bob");
    assert.ok(bob.some((c) => c.scopeId === "channel:C1"));

    const alice = await contexts(s, "alice");
    const c2 = alice.find((c) => c.scopeId === "channel:C2")!;
    assert.equal(c2.sessionCount, 1);
    assert.ok((c2.lastActivityAt ?? 0) > 0);
    const aliceSessions = await s.built.app.listSessions("alice");
    const expected = Math.max(
      ...aliceSessions.filter((x) => x.scopeId === "channel:C2").map((x) => x.lastActivityAt ?? x.createdAt),
    );
    assert.equal(
      c2.lastActivityAt,
      expected,
      "context recency is derived from session lastActivityAt, not a separate signal",
    );
  } finally {
    await s.close();
  }
});

test("a web turn carrying fastMode on a non-fast model is accepted; dispatch masks the flag", async () => {
  const s = start();
  try {
    const res = await s.post(
      `/v1/turns`,
      dmTurn("hi", { externalId: "alice" }, "web:alice:fast1", {
        surface: "web",
        model: "claude-fable-5",
        fastMode: true,
      }),
    );
    assert.equal(res.status, 200);
  } finally {
    await s.close();
  }
});

test("prior participation never authorizes a shared scope after directory membership is absent", async () => {
  const s = start();
  try {
    const slack = await s.post(
      `/v1/turns`,
      turnRequest(
        "hello",
        { externalId: "alice" },
        { kind: "group", threadRef: "grp:G1:1", channelRef: "G1" },
        { surface: "slack" },
      ),
    );
    assert.equal(slack.status, 200);

    assert.equal(
      (await webTurn(s, "alice", { kind: "group", threadRef: "web:alice:g1", channelRef: "G1" })).status,
      403,
    );
    assert.equal((await webTurn(s, "bob", { kind: "group", threadRef: "web:bob:g1", channelRef: "G1" })).status, 403);

    const alice = await contexts(s, "alice");
    assert.equal(
      alice.find((c) => c.scopeId === "group:G1"),
      undefined,
    );
  } finally {
    await s.close();
  }
});

test("a web turn can't pair an authorized scope claim with a thread living elsewhere", async () => {
  const s = start();
  try {
    await s.built.app.upsertChannels(
      [{ channelId: "C2", name: "sekrit", isPrivate: true }],
      [
        { channelId: "C2", principalId: "alice" },
        { channelId: "C2", principalId: "carol" },
      ],
    );

    assert.equal((await webTurn(s, "alice", { kind: "dm", threadRef: "web:alice:p1" })).status, 200);
    assert.equal(
      (await webTurn(s, "alice", { kind: "channel", threadRef: "web:alice:t1", channelRef: "C2" })).status,
      200,
    );

    assert.equal(
      (await webTurn(s, "carol", { kind: "channel", threadRef: "web:alice:t1", channelRef: "C2" })).status,
      200,
    );

    assert.equal((await webTurn(s, "carol", { kind: "dm", threadRef: "web:alice:t1" })).status, 403);
    assert.equal(
      (await webTurn(s, "carol", { kind: "channel", threadRef: "web:alice:p1", channelRef: "C2" })).status,
      403,
    );
    assert.equal(
      (await webTurn(s, "alice", { kind: "channel", threadRef: "web:alice:p1", channelRef: "C2" })).status,
      403,
    );

    assert.equal(
      (await webTurn(s, "carol", { kind: "channel", threadRef: "web:alice:default", channelRef: "C2" })).status,
      403,
    );
    assert.equal((await webTurn(s, "alice", { kind: "dm", threadRef: "web:alice:default" })).status, 200);
  } finally {
    await s.close();
  }
});

test("directory push stores the workspace URL; /v1/directory/meta serves it", async () => {
  const s = start();
  try {
    const before = await s.get(`/v1/directory/meta`);
    assert.equal(before.status, 200);
    assert.deepEqual(await before.json(), { workspaceUrl: null });

    const push = await s.post(`/v1/directory`, {
      members: [{ principalId: "alice", displayName: "Alice", type: "internal" }],
      workspaceUrl: "https://acme.slack.com/",
    });
    assert.equal(push.status, 200);

    const after = (await (await s.get(`/v1/directory/meta`)).json()) as { workspaceUrl: string | null };
    assert.equal(after.workspaceUrl, "https://acme.slack.com", "stored normalized, trailing slash dropped");
  } finally {
    await s.close();
  }
});
