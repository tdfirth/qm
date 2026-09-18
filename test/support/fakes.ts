import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOrchestrator, type Orchestrator, type OrchestratorDeps } from "../../src/core/orchestrator.ts";
import { createIdentityService } from "../../src/identity/identity-service.ts";
import { createMemoryConfigStore } from "../../src/resolution/config-store.ts";
import { createAclStore } from "../../src/acl/acl-store.ts";
import { createResolutionService } from "../../src/resolution/resolution-service.ts";
import { createMemorySessionStore } from "../../src/sessions/memory-session-store.ts";
import { createLocalWorkspaceStore } from "../../src/workspace/workspace-store.ts";
import { createMemoryFileArtifactStore } from "../../src/files/file-artifact-store.ts";
import { createMemoryDurableByteStore } from "../../src/files/durable-byte-store.ts";
import { createMemoryService } from "../../src/memory/memory-service.ts";
import { createModelGateway } from "../../src/model/model-gateway.ts";
import { createAuditLog, type AuditLog } from "../../src/audit/audit-log.ts";
import { createRateLimiter } from "../../src/ratelimit/rate-limiter.ts";
import { createDeployStore } from "../../src/deploy/deploy-store.ts";
import { createDockerDeployProvider } from "../../src/deploy/docker-deploy-provider.ts";
import { createDeployService } from "../../src/deploy/deploy-service.ts";
import type { DeployProvider } from "../../src/deploy/deploy-provider.ts";
import type { Sandbox } from "../../src/sandbox/sandbox.ts";

const ORG = "default-org";

export function nullAuditLog(): AuditLog {
  return { record() {}, events: async () => [], tail: async () => [] };
}

export function fakeDeployProvider(port: number): DeployProvider {
  return {
    profile: { managedScaleToZero: false },
    apply: async () => ({ host: "127.0.0.1", port }),
    destroy: async () => {},
  };
}

export function unreachableSandbox(why: string): Sandbox {
  const unreached = () => {
    throw new Error(why);
  };
  return {
    profile: { backend: "fake", writablePersistence: "snapshot_to_workspace", processSessions: false },
    provision: unreached as never,
    run: unreached as never,
    readFile: unreached as never,
    writeFile: unreached as never,
    writeFileBytes: unreached as never,
    readFileBytes: unreached as never,
    listDir: unreached as never,
    removeDir: unreached as never,
    teardown: unreached as never,
  };
}

export function testOrchestrator<O extends Partial<OrchestratorDeps> & Pick<OrchestratorDeps, "harness" | "sandbox">>(
  overrides: O,
): O & OrchestratorDeps & { orchestrator: Orchestrator } {
  const config = overrides.config ?? createMemoryConfigStore(ORG);
  const acl = overrides.acl ?? createAclStore();
  const auditLog = overrides.auditLog ?? createAuditLog();
  const workspace = overrides.workspace ?? createLocalWorkspaceStore(mkdtempSync(join(tmpdir(), "qm-orchestrator-")));
  const defaults: Omit<OrchestratorDeps, "harness" | "sandbox"> = {
    identity: createIdentityService(),
    resolution: createResolutionService(ORG, config, acl),
    sessions: createMemorySessionStore(),
    workspace,
    files: createMemoryFileArtifactStore(createMemoryDurableByteStore()),
    modelGateway: createModelGateway(),
    auditLog,
    rateLimiter: createRateLimiter({ maxPerWindow: 1000, windowMs: 60_000 }),
    memory: createMemoryService(workspace),
    deploy: createDeployService({
      deployStore: createDeployStore(),
      provider: createDockerDeployProvider(),
      deployDir: join(tmpdir(), "qm-orchestrator-deploy"),
      auditLog,
      acl,
    }),
    acl,
  };
  const deps = { ...defaults, ...overrides } as O & OrchestratorDeps;
  return { ...deps, orchestrator: createOrchestrator(deps) };
}
