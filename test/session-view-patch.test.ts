import "./support/auto-fake-sprites.ts";

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Session } from "../src/types.ts";
import { type Served, startApi, tmpDir } from "./support/api.ts";
import { dmTurn } from "./support/turns.ts";

function start() {
  return startApi({ dataDir: tmpDir("session-view-patch-") }, (built) => ({
    config: built.config,
    admin: built.admin,
    auditLog: built.auditLog,
  }));
}

async function newSession(srv: Served, threadRef: string): Promise<string> {
  const r = await srv.post("/v1/turns", dmTurn("hello", { externalId: "U1" }, threadRef));
  const body = (await r.json()) as { status: string; sessionId?: string };
  assert.equal(body.status, "ok");
  return body.sessionId!;
}

async function patch(
  srv: Served,
  id: string,
  body: Record<string, unknown>,
): Promise<{ status: number; session?: Session; message?: string }> {
  const r = await srv.post(`/v1/sessions/${encodeURIComponent(id)}`, body);
  const parsed = (await r.json()) as { session?: Session; message?: string };
  return { status: r.status, ...parsed };
}

test("POST /v1/sessions/:id pins and colors the viewer's row; null clears; casing normalizes", async () => {
  const srv = start();
  try {
    const id = await newSession(srv, "web:U1:pin-color");

    const pinned = await patch(srv, id, { principalId: "U1", pinned: true, color: "#AaBbCc" });
    assert.equal(pinned.status, 200);
    assert.equal(pinned.session?.pinned, true);
    assert.equal(pinned.session?.color, "#aabbcc", "color is normalized to lowercase");

    const cleared = await patch(srv, id, { principalId: "U1", pinned: false, color: null });
    assert.equal(cleared.status, 200);
    assert.ok(!cleared.session?.pinned);
    assert.equal(cleared.session?.color ?? null, null, "null clears the color");
  } finally {
    await srv.close();
  }
});

test("POST /v1/sessions/:id rejects malformed colors and non-boolean pins", async () => {
  const srv = start();
  try {
    const id = await newSession(srv, "web:U1:pin-color-bad");

    for (const color of ["red", "#fff", "#12345", "#gggggg", "url(x)", "#aabbcc;background:red", 42]) {
      const r = await patch(srv, id, { principalId: "U1", color });
      assert.equal(r.status, 400, `rejects ${JSON.stringify(color)}`);
    }
    const badPin = await patch(srv, id, { principalId: "U1", pinned: "yes" });
    assert.equal(badPin.status, 400);

    const empty = await patch(srv, id, { principalId: "U1" });
    assert.equal(empty.status, 400, "an empty patch is a bad request");

    const stranger = await patch(srv, id, { principalId: "intruder", pinned: true });
    assert.equal(stranger.status, 404, "a non-participant cannot touch the view");
  } finally {
    await srv.close();
  }
});
