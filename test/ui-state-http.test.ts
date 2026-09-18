import "./support/auto-fake-sprites.ts";

import { test } from "node:test";
import assert from "node:assert/strict";
import { startApi, tmpDir } from "./support/api.ts";

function start() {
  return startApi({ dataDir: tmpDir("ui-state-http-") }, (built) => ({
    admin: built.admin,
    auditLog: built.auditLog,
    uiState: built.uiState,
  }));
}

const json = async (r: Response): Promise<any> => r.json();

test("ui-state stores and returns a per-user record, isolated by principal", async () => {
  const s = start();
  try {
    const empty = await json(await s.get(`/v1/ui-state?principalId=U1&key=split-canvas`));
    assert.equal(empty.value, null, "nothing stored yet");
    assert.equal(empty.updatedAt, 0);

    const layout = { v: 2, active: true, layout: { grid: {} }, updatedAt: 1111 };
    const put = await s.put(`/v1/ui-state`, { principalId: "U1", key: "split-canvas", value: layout, updatedAt: 1111 });
    assert.equal(put.status, 200);

    const got = await json(await s.get(`/v1/ui-state?principalId=U1&key=split-canvas`));
    assert.deepEqual(got.value, layout, "the stored layout round-trips");
    assert.equal(got.updatedAt, 1111);

    const other = await json(await s.get(`/v1/ui-state?principalId=U2&key=split-canvas`));
    assert.equal(other.value, null, "another user's state is separate");

    const stale = await s.put(`/v1/ui-state`, {
      principalId: "U1",
      key: "split-canvas",
      value: { old: true },
      updatedAt: 42,
    });
    assert.equal((await json(stale)).ok, false, "a stale write is refused");
    const kept = await json(await s.get(`/v1/ui-state?principalId=U1&key=split-canvas`));
    assert.deepEqual(kept.value, layout, "the newer record survives a stale overwrite attempt");
  } finally {
    await s.close();
  }
});

test("ui-state rejects bad keys and oversized values", async () => {
  const s = start();
  try {
    const badKey = await s.get(`/v1/ui-state?principalId=U1&key=No%20Good!`);
    assert.equal(badKey.status, 400);

    const noValue = await s.put(`/v1/ui-state`, { principalId: "U1", key: "split-canvas" });
    assert.equal(noValue.status, 400);

    const huge = await s.put(`/v1/ui-state`, { principalId: "U1", key: "split-canvas", value: "x".repeat(140000) });
    assert.equal(huge.status, 413);
  } finally {
    await s.close();
  }
});

test("ui-state measures the cap in bytes, races atomically, and clamps future clocks", async () => {
  const s = start();
  try {
    const emoji = await s.put(`/v1/ui-state`, {
      principalId: "U3",
      key: "split-canvas",
      value: "\u{1F991}".repeat(20000),
    });
    assert.equal(emoji.status, 413, "a value under the UTF-16 length cap but over the byte cap is refused");

    const race = (updatedAt: number, tag: string) =>
      s.put(`/v1/ui-state`, { principalId: "U3", key: "race", value: { tag }, updatedAt });
    for (let i = 0; i < 20; i++) {
      const base = (i + 1) * 10;
      await Promise.all([race(base + 2, "newer"), race(base + 1, "older")]);
      const got = await json(await s.get(`/v1/ui-state?principalId=U3&key=race`));
      assert.deepEqual(got.value, { tag: "newer" }, "concurrent writes settle on the newest record");
      assert.equal(got.updatedAt, base + 2);
    }

    const farFuture = Date.now() + 365 * 24 * 3600 * 1000;
    await s.put(`/v1/ui-state`, { principalId: "U3", key: "skewed", value: { v: 1 }, updatedAt: farFuture });
    const skewed = await json(await s.get(`/v1/ui-state?principalId=U3&key=skewed`));
    assert.ok(skewed.updatedAt < Date.now() + 600000, "a far-future client clock is clamped near server time");

    const catchUp = await json(
      await s.put(`/v1/ui-state`, {
        principalId: "U3",
        key: "skewed",
        value: { v: 2 },
        updatedAt: skewed.updatedAt + 1,
      }),
    );
    assert.equal(catchUp.ok, true, "other devices are not locked out for the skew duration");
  } finally {
    await s.close();
  }
});
