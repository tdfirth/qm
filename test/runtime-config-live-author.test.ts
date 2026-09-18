import "./support/auto-fake-sprites.ts";

import { test } from "node:test";
import assert from "node:assert/strict";
import { capMinter, type Served, startApi, tmpDir } from "./support/api.ts";
import { CONTROL_PLANE_AUD, type CapabilityClaims } from "../src/auth/capability-token.ts";

const SECRET = "test-capability-secret";

function start() {
  return startApi(
    {
      dataDir: tmpDir("runtime-config-live-author-"),
      orgId: "default-org",
      capabilitySecret: SECRET,
      seedSkills: false,
    },
    (built) => ({ capabilitySecret: SECRET, config: built.config }),
  );
}

const token = (claims: Partial<CapabilityClaims>): Promise<string> =>
  capMinter(SECRET, { aud: CONTROL_PLANE_AUD })("alice@default-org", "group:C123", claims);

const put = (srv: Served, cap: string) =>
  srv.put("/v1/runtime-config", { harnessId: "pi", modelId: "claude-sonnet-5" }, { "x-agent-capability": cap });

test("runtime-config accepts a liveAuthor capability (a human replying in a thread)", async () => {
  const srv = start();
  try {
    await srv.built.directory.replaceGroups([{ groupId: "C123", principalId: "alice@default-org" }]);
    srv.built.config.setApprovedHarnesses(["pi"]);
    await srv.built.config.flushScope("org:default-org");
    const res = await put(srv, await token({ liveAuthor: true }));
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      effective: { harnessId: string; modelId: string; effortLevel: string; fastMode: boolean };
    };
    assert.deepEqual(body.effective, {
      harnessId: "pi",
      modelId: "claude-sonnet-5",
      effortLevel: "auto",
      fastMode: false,
    });
  } finally {
    await srv.close();
  }
});

test("runtime-config still refuses an automated trigger with neither liveActor nor liveAuthor", async () => {
  const srv = start();
  try {
    await srv.built.directory.replaceGroups([{ groupId: "C123", principalId: "alice@default-org" }]);
    srv.built.config.setApprovedHarnesses(["pi"]);
    await srv.built.config.flushScope("org:default-org");
    const res = await put(srv, await token({ triggered: true }));
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "live_actor_required" });
  } finally {
    await srv.close();
  }
});
