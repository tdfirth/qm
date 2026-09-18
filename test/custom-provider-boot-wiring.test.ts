import "./support/auto-fake-sprites.ts";

import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { buildApp, serverDeps } from "../src/wiring.ts";
import { serveApp, tmpDir } from "./support/api.ts";
import { testConfig } from "./support/test-config.ts";
import { defaultModelForHarness } from "../src/model/pi-models.ts";
import { setCustomProviders } from "../src/model/custom-providers.ts";

const ADMIN = { "content-type": "application/json", "x-admin-actor": "admin-alice@default-org" };

afterEach(() => setCustomProviders([]));

test("serverDeps wires the custom-provider store and resolves a custom boot default lazily", async () => {
  const config = testConfig({ dataDir: tmpDir("custom-provider-boot-"), harness: "pi", modelId: "acme-large" });
  const built = buildApp(config, { modelCredentialFetch: async () => new Response(null, { status: 200 }) });
  const deps = serverDeps(config, built);
  assert.equal(deps.customProviders, built.customProviders);
  assert.equal(deps.refreshCustomProviders, built.refreshCustomProviders);
  assert.equal(deps.baseModelDefault, "acme-large");

  const srv = serveApp(built.app, deps);
  try {
    assert.notEqual(defaultModelForHarness("pi", deps.baseModelDefault), "acme-large");

    const list = await srv.get("/v1/admin/custom-providers", ADMIN);
    assert.equal(list.status, 200);

    const put = await srv.put(
      "/v1/admin/custom-providers/acme-gateway",
      {
        name: "Acme Gateway",
        protocol: "openai",
        baseUrl: "https://llm.acme.internal/v1",
        models: [{ id: "acme-large", name: "Acme Large" }],
        apiKey: "sk-acme-secret",
        validate: false,
      },
      ADMIN,
    );
    assert.equal(put.status, 200);

    assert.equal(defaultModelForHarness("pi", deps.baseModelDefault), "acme-large");

    const runtime = await srv.get(
      "/v1/runtime-config?principalId=admin-alice@default-org&scopeId=personal:admin-alice@default-org",
      ADMIN,
    );
    assert.equal(runtime.status, 200);
    const body = (await runtime.json()) as {
      effective: { modelId: string };
      modelsByHarness: Record<string, string[]>;
      modelCatalog: Record<string, { name: string; provider: string }>;
    };
    assert.equal(body.effective.modelId, "acme-large");
    assert.ok(body.modelsByHarness.pi?.includes("acme-large"));
    assert.equal(body.modelCatalog["acme-large"]?.provider, "acme-gateway");
  } finally {
    await srv.close();
  }
});
