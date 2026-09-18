import "./support/auto-fake-sprites.ts";

import { test } from "node:test";
import assert from "node:assert/strict";
import { startApi, tmpDir } from "./support/api.ts";

const start = () => startApi({ dataDir: tmpDir("apival-") });

const post = (base: string, path: string, body: string) =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body });

test("malformed request bodies are 400", async () => {
  const s = start();
  try {
    assert.equal((await post(s.base, "/v1/turns", JSON.stringify({ text: "hi" }))).status, 400);
    assert.equal((await post(s.base, "/v1/turns", "{not json")).status, 400);
    assert.equal((await post(s.base, "/v1/grants", JSON.stringify({ path: "x" }))).status, 400);
    assert.equal((await post(s.base, "/v1/deployments", JSON.stringify({ entrypoint: "x" }))).status, 400);
    assert.equal((await post(s.base, "/v1/crons", JSON.stringify({ action: "x" }))).status, 400);
  } finally {
    await s.close();
  }
});

test("unknown resources are 404, not silent 200 or 500", async () => {
  const s = start();
  try {
    assert.equal((await post(s.base, "/v1/deployments/nope/rollback", JSON.stringify({ version: 1 }))).status, 404);
    assert.equal((await post(s.base, "/v1/deployments/nope/archive", "")).status, 404);
    assert.equal((await post(s.base, "/v1/crons/nope/disable", "")).status, 404);
    assert.equal((await fetch(`${s.base}/v1/sessions/nope?viewer=someone`)).status, 404);
    assert.equal((await fetch(`${s.base}/v1/sessions/nope`)).status, 400);
    assert.equal((await fetch(`${s.base}/v1/unknown-route`)).status, 404);
  } finally {
    await s.close();
  }
});
