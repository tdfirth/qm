import "./support/auto-fake-sprites.ts";

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/wiring.ts";
import { serveApp, tmpDir } from "./support/api.ts";
import { testConfig } from "./support/test-config.ts";

const ADMIN = { "content-type": "application/json", "x-admin-actor": "admin-alice@default-org" };

test("the org allowed-models list restricts the runtime-config picker and clearing restores the catalog", async () => {
  const modelCredentialFetch: typeof fetch = async () =>
    Response.json({
      data: [
        { id: "anthropic/claude-sonnet-4.5", name: "Anthropic: Claude Sonnet 4.5", supported_parameters: ["tools"] },
        { id: "deepseek/deepseek-chat-v3.1", name: "DeepSeek: DeepSeek V3.1", supported_parameters: ["tools"] },
      ],
    });
  const built = buildApp(
    testConfig({ dataDir: tmpDir("webui-model-allowlist-"), openrouterApiKey: "deployment-openrouter-key" }),
    { modelCredentialFetch },
  );
  const server = serveApp(built.app, {
    config: built.config,
    modelCredentials: built.modelCredentials,
    modelCredentialFetch,
    harnessId: "pi",
    providerKeys: { anthropic: false, openai: false, openrouter: true },
    admin: built.admin,
    auditLog: built.auditLog,
  });
  const runtimeModels = async (): Promise<string[]> => {
    const response = await server.get("/v1/runtime-config?principalId=alice&scopeId=personal%3Aalice");
    assert.equal(response.status, 200);
    return ((await response.json()) as { modelsByHarness: Record<string, string[]> }).modelsByHarness.pi!;
  };
  try {
    const unrestricted = await runtimeModels();
    assert.ok(unrestricted.includes("anthropic/claude-sonnet-4.5"));
    assert.ok(unrestricted.includes("deepseek/deepseek-chat-v3.1"));

    const saved = await server.put(
      "/v1/admin/scopes/org%3Adefault-org/webui-models",
      { ids: ["deepseek/deepseek-chat-v3.1", "openrouter/auto"] },
      ADMIN,
    );
    assert.equal(saved.status, 200);

    assert.deepEqual(await runtimeModels(), ["deepseek/deepseek-chat-v3.1", "openrouter/auto"]);

    const cleared = await server.put("/v1/admin/scopes/org%3Adefault-org/webui-models", { ids: [] }, ADMIN);
    assert.equal(cleared.status, 200);
    const restored = await runtimeModels();
    assert.ok(restored.includes("anthropic/claude-sonnet-4.5"));
    assert.ok(restored.includes("deepseek/deepseek-chat-v3.1"));
  } finally {
    await server.close();
  }
});
