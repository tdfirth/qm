import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { CAPABILITY_TTL_MS, CONTROL_PLANE_AUD, mintCapabilityToken } from "../src/auth/capability-token.ts";
import type { MemoryRevision, MemoryService } from "../src/memory/memory-service.ts";
import { scopeId, type ScopeId } from "../src/types.ts";
import { buildApp } from "../src/wiring.ts";
import { serveApp, tmpDir } from "./support/api.ts";
import { testConfig } from "./support/test-config.ts";

const SECRET = "memory-history-route-secret".repeat(3);

describe("agent memory history and restore", () => {
  const built = buildApp(testConfig({ dataDir: tmpDir("memory-history-routes-"), signingSecret: SECRET }));
  const revisions = new Map<ScopeId, MemoryRevision[]>();
  const memory: MemoryService = {
    ...built.memory,
    async replace(scope, content, author) {
      await built.memory.replace(scope, content, author);
      const history = revisions.get(scope) ?? [];
      history.push({
        revision: String(history.length + 1),
        content: await built.memory.read(scope),
        operation: "replace",
        ...(author ? { author } : {}),
        at: Date.now(),
      });
      revisions.set(scope, history);
    },
    async history(scope, limit = 30) {
      return (revisions.get(scope) ?? []).toReversed().slice(0, limit);
    },
    async restore(scope, revision, expectedRevision, author) {
      const history = revisions.get(scope) ?? [];
      if (String(history.length) !== expectedRevision) return false;
      const target = history.find((entry) => entry.revision === revision);
      if (!target) return false;
      await this.replace(scope, target.content, author);
      return true;
    },
  };
  const server = serveApp(built.app, { signingSecret: SECRET, memory });
  after(server.close);

  const capFor = (actorId: string, write: ScopeId, orgWrite?: ScopeId) =>
    mintCapabilityToken(
      {
        actorId,
        scopeId: scopeId("personal", actorId),
        aud: CONTROL_PLANE_AUD,
        exp: Date.now() + CAPABILITY_TTL_MS,
        memory: { write, read: [write], ...(orgWrite ? { orgWrite } : {}) },
      },
      SECRET,
    );
  const get = (path: string, token?: string) => server.get(path, token ? { "x-agent-capability": token } : {});
  const post = (path: string, body: unknown, token?: string) =>
    server.post(path, body, token ? { "x-agent-capability": token } : {});
  const put = (path: string, body: unknown, token: string) => server.put(path, body, { "x-agent-capability": token });

  it("lists versions after writes and restores a prior version", async () => {
    const mine = scopeId("personal", "U1");
    const token = await capFor("U1", mine);
    assert.equal((await put("/v1/memory/self", { content: "first version" }, token)).status, 200);
    assert.equal((await put("/v1/memory/self", { content: "second version" }, token)).status, 200);

    const history = await get("/v1/memory/history", token);
    assert.equal(history.status, 200);
    const { revisions } = (await history.json()) as {
      revisions: Array<{ revision: string; content: string }>;
    };
    assert.equal(revisions.length, 2);
    assert.equal(revisions[0]?.content, "second version\n");
    assert.equal(revisions[1]?.content, "first version\n");

    const restored = await post(
      "/v1/memory/restore",
      { revision: revisions[1]?.revision, expectedRevision: revisions[0]?.revision },
      token,
    );
    assert.equal(restored.status, 200);
    assert.equal(await memory.read(mine), "first version\n");
  });

  it("does not expose or restore another principal's notebook", async () => {
    const token = await capFor("U2", scopeId("personal", "U2"));
    assert.equal((await get("/v1/memory/history?principalId=U1", token)).status, 404);
    assert.equal(
      (await post("/v1/memory/restore", { principalId: "U1", revision: "1", expectedRevision: "2" }, token)).status,
      404,
    );
  });

  it("binds org history and restore to the token's org write scope", async () => {
    const mine = scopeId("personal", "A1");
    const org = scopeId("org", "default-org");
    const token = await capFor("A1", mine, org);
    assert.equal((await put("/v1/memory/self", { content: "first org version", scope: "org" }, token)).status, 200);
    assert.equal((await put("/v1/memory/self", { content: "second org version", scope: "org" }, token)).status, 200);

    const history = await get("/v1/memory/history?scope=org", token);
    assert.equal(history.status, 200);
    const { revisions } = (await history.json()) as { revisions: Array<{ revision: string }> };
    const restored = await post(
      "/v1/memory/restore",
      { scope: "org", revision: revisions[1]?.revision, expectedRevision: revisions[0]?.revision },
      token,
    );
    assert.equal(restored.status, 200);
    assert.equal(await memory.read(org), "first org version\n");

    const personalOnly = await capFor("U3", scopeId("personal", "U3"));
    assert.equal((await get("/v1/memory/history?scope=org", personalOnly)).status, 404);
    assert.equal(
      (await post("/v1/memory/restore", { scope: "org", revision: "1", expectedRevision: "2" }, personalOnly)).status,
      404,
    );
  });

  it("requires authentication", async () => {
    assert.equal((await get("/v1/memory/history")).status, 401);
    assert.equal((await post("/v1/memory/restore", { revision: "1", expectedRevision: "2" })).status, 401);
  });
});
