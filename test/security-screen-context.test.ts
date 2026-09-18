import "./support/auto-fake-sprites.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/wiring.ts";
import { serveApp } from "./support/api.ts";
import { testConfig } from "./support/test-config.ts";
import type { SecurityScreener } from "../src/security/security-screener.ts";

for (const surface of ["web", "slack", "swarm"]) {
  test(`HTTP ${surface} tool screening carries current request on every output chunk`, async () => {
    const calls: Parameters<SecurityScreener["classify"]>[0][] = [];
    const built = buildApp(testConfig({ securityPosture: "auto" }), {
      securityScreener: {
        provider: "context-spy",
        shadow: false,
        async classify(input) {
          calls.push(input);
          return { verdict: { decision: "auto" }, score: 0, threshold: 0.7 };
        },
      },
    });
    const server = serveApp(built.app, {}, "127.0.0.1");
    const request = `!screened-run printf '%s' "$(printf 'x%.0s' $(seq 1 20000)) quoted transcript"`;
    try {
      for (const text of ["earlier private conversation", request]) {
        const response = await server.post("/v1/turns", {
          surface,
          actor: { externalId: "U1" },
          conversation: { kind: "dm", threadRef: `${surface}-context` },
          text,
          ...(surface === "swarm" ? { triggered: true, securityScreenData: "assigned task" } : { liveActor: true }),
        });
        assert.equal(response.status, 200);
        const result = (await response.json()) as { status: string; reply?: string };
        assert.equal(result.status, "ok");
      }
      const outputs = calls.filter((call) => call.hook === "tool_response");
      assert.ok(outputs.length >= 3);
      for (const call of outputs) {
        assert.deepEqual(call.metadata?.request, {
          origin: surface === "swarm" ? "automation" : "human",
          text: request,
          truncated: false,
        });
        assert.match(call.payload, /tool_result:execute/);
        assert.doesNotMatch(JSON.stringify(call), /earlier private conversation/);
      }
    } finally {
      await server.close();
    }
  });
}
