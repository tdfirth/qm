import { deriveConnectorKey } from "../src/connectors/connector-client-store.ts";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { CONTROL_PLANE_AUD } from "../src/auth/capability-token.ts";
import { capMinter, type Served, serveApp, startApi } from "./support/api.ts";
import { createBrowserSessionStore, type StoredBrowserSession } from "../src/connectors/browser-session-store.ts";
import { createMemoryMap } from "../src/persistence/durable-map.ts";
import { createDirectoryStore } from "../src/directory/directory-store.ts";

const SECRET = "emoji-route-secret".repeat(3);
const ACTOR = "U_E1";
const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]).toString("base64");

describe("POST /v1/emoji", async () => {
  const sessions = createBrowserSessionStore({
    sessions: createMemoryMap<StoredBrowserSession>(),
    key: deriveConnectorKey(Buffer.alloc(32, 1)),
  });
  const directory = createDirectoryStore();
  const api = startApi({ signingSecret: SECRET }, (built) => ({
    signingSecret: SECRET,
    browserSessionStore: sessions,
    directory,
    config: built.config,
  }));
  const bare = serveApp(api.built.app, { signingSecret: SECRET });

  const capFor = capMinter(SECRET, { aud: CONTROL_PLANE_AUD });

  before(async () => {
    await sessions.put(ACTOR, JSON.stringify({ cookies: [] }));
    await directory.setWorkspaceUrl("https://acme.slack.com/");
  });

  after(async () => {
    await api.close();
    await bare.close();
  });

  const post = (srv: Served, body: unknown, headers: Record<string, string> = {}) =>
    srv.post("/v1/emoji", body, headers);

  it("401 without a capability token", async () => {
    assert.equal((await post(api, { name: "x", image: PNG_B64 })).status, 401);
    assert.equal((await post(api, { name: "x", image: PNG_B64 }, { "x-agent-capability": "garbage" })).status, 401);
  });

  it("404 not_supported when no session store is wired", async () => {
    const res = await post(bare, { name: "x", image: PNG_B64 }, { "x-agent-capability": await capFor(ACTOR) });
    assert.equal(res.status, 404);
    assert.equal(((await res.json()) as any).error, "not_supported");
  });

  it("400 bad_request when name or image is missing", async () => {
    assert.equal((await post(api, { name: "x" }, { "x-agent-capability": await capFor(ACTOR) })).status, 400);
    assert.equal((await post(api, { image: PNG_B64 }, { "x-agent-capability": await capFor(ACTOR) })).status, 400);
  });

  it("422 {ok:false} with a clear error on an invalid name (a real result, not a crash)", async () => {
    const res = await post(api, { name: "Bad Name", image: PNG_B64 }, { "x-agent-capability": await capFor(ACTOR) });
    assert.equal(res.status, 422);
    const got = (await res.json()) as any;
    assert.equal(got.ok, false);
    assert.match(got.error, /isn't a valid emoji name/);
  });

  it("422 {ok:false} session-expired when the stored session can't authenticate", async () => {
    const res = await post(api, { name: "partyparrot", image: PNG_B64 }, { "x-agent-capability": await capFor(ACTOR) });
    assert.equal(res.status, 422);
    const got = (await res.json()) as any;
    assert.equal(got.ok, false);
    assert.match(got.error, /session .* has expired/i);
  });
});
