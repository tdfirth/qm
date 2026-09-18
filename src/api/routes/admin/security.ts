import { badRequest, notFound, sendJson } from "../../http.ts";
import { audit, orgScope, orgAdmin } from "../shared.ts";

const MAX_FLAGS = 200;

export const listSecurityFlags = orgAdmin(async (ctx, actor) => {
  const scope = orgScope();
  const requested = Number(ctx.url.searchParams.get("limit") ?? 50);
  const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, MAX_FLAGS) : 50;
  const events = (await ctx.deps.auditLog?.tail({ limit: MAX_FLAGS })) ?? [];
  const flags = events
    .filter((event) => event.action === "security_posture.flagged" || event.action === "security_posture.quarantine")
    .slice(0, limit)
    .map((event) => ({
      at: event.at,
      principal: event.principalId,
      scope: event.scopeLabel,
      surface: event.resource,
      detail: event.detail,
    }));
  audit(ctx.deps, {
    principalId: actor.id,
    action: "security_posture.flags.read",
    resource: "security-flags",
    scopeLabel: scope,
  });
  sendJson(ctx.res, 200, { flags });
});

export const releaseSecurityTaint = orgAdmin(async (ctx, actor) => {
  const scope = orgScope();
  const sessionId = (ctx.body as { sessionId?: unknown } | null)?.sessionId;
  if (typeof sessionId !== "string" || !sessionId.trim()) {
    badRequest(ctx.res, "sessionId required");
    return;
  }
  const released = (await ctx.deps.sessions?.clearSecurityTaint(sessionId)) ?? false;
  if (!released) {
    notFound(ctx.res);
    return;
  }
  audit(ctx.deps, {
    principalId: actor.id,
    action: "security_posture.release",
    resource: sessionId,
    scopeLabel: scope,
    status: "ok",
  });
  sendJson(ctx.res, 200, { released: true, sessionId });
});
