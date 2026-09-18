import type { AuditLog } from "../../src/audit/audit-log.ts";
import type { DeployProvider } from "../../src/deploy/deploy-provider.ts";

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
