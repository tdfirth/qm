import "./support/auto-fake-sprites.ts";

import { test } from "node:test";
import assert from "node:assert/strict";
import { createAclStore } from "../src/acl/acl-store.ts";
import { scopeId, type Grant } from "../src/types.ts";
import { startApi, tmpDir } from "./support/api.ts";

const owner = scopeId("personal", "U1");
const carol = scopeId("personal", "U2");
const org = scopeId("org", "default-org");
const grant = (over: Partial<Grant> = {}): Grant => ({
  ownerScopeId: owner,
  ref: "redline.md",
  granteeScopeId: carol,
  permission: "read",
  grantedBy: "U1",
  ...over,
});

test("revoke has the same owner check as grant: a non-owner cannot revoke a personal-scope grant", async () => {
  const acl = createAclStore();
  await acl.grant(grant());
  await assert.rejects(acl.revoke(owner, "redline.md", carol, "U2"), /only a manager/);
  assert.equal((await acl.grantsFor(owner, "redline.md")).length, 1, "the grant survives the rejected revoke");
  await acl.revoke(owner, "redline.md", carol, "U1");
  assert.equal((await acl.grantsFor(owner, "redline.md")).length, 0, "the owner can revoke");
});

test("org-owned grants have no single owner, so revoke is not owner-gated (same as grant)", async () => {
  const acl = createAclStore();
  await acl.grant(grant({ ownerScopeId: org, grantedBy: "admin" }));
  await acl.revoke(org, "redline.md", carol, "someone-else");
  assert.equal((await acl.grantsFor(org, "redline.md")).length, 0);
});

test("POST /v1/grants/revoke requires revokedBy and rejects a non-owner", async () => {
  const { built, post, close } = startApi({ dataDir: tmpDir("revoke-") });
  try {
    assert.equal((await post("/v1/grants", grant())).status, 200);

    const missing = await post("/v1/grants/revoke", { ownerScopeId: owner, ref: "redline.md", granteeScopeId: carol });
    assert.equal(missing.status, 400, "revokedBy is required");

    const forged = await post("/v1/grants/revoke", {
      ownerScopeId: owner,
      ref: "redline.md",
      granteeScopeId: carol,
      revokedBy: "U2",
    });
    assert.equal(forged.status, 400);
    assert.equal(((await forged.json()) as { error: string }).error, "revoke_failed");
    assert.equal((await built.acl.grantsFor(owner, "redline.md")).length, 1, "the grant survives");

    const legit = await post("/v1/grants/revoke", {
      ownerScopeId: owner,
      ref: "redline.md",
      granteeScopeId: carol,
      revokedBy: "U1",
    });
    assert.equal(legit.status, 200);
    assert.equal((await built.acl.grantsFor(owner, "redline.md")).length, 0);
  } finally {
    await close();
  }
});
