import { parseScopeId } from "../../types.ts";
import { parseBotLedger } from "../../surface-cache/channel-policy-store.ts";
import { badRequest, conflict, forbidden, notFound, sendJson } from "../http.ts";
import { audit, isObj, stringField } from "./shared.ts";
import { type ApiCtx, type Route } from "./route.ts";

const MAX_ORDERS_CHARS = 20_000;

function channelContainer(scope: string): string | undefined {
  const { kind, ref } = parseScopeId(scope);
  return ref && (kind === "channel" || kind === "group") ? ref : undefined;
}

async function memberScope(ctx: ApiCtx, principalId: string, scope: string): Promise<boolean> {
  const contexts = await ctx.app.listContexts(principalId);
  return contexts.some((c) => c.scopeId === scope);
}

export async function getContextPolicy(ctx: ApiCtx): Promise<void> {
  const { res, deps, url } = ctx;
  const principalId = (url.searchParams.get("principalId") ?? "").trim();
  const scope = (url.searchParams.get("scope") ?? "").trim();
  if (!principalId || !scope) return badRequest(res, "principalId and scope required");
  const container = channelContainer(scope);
  if (!container) return badRequest(res, "ambient policy applies to channel and group scopes only");
  if (!deps.channelPolicy) return notFound(res, "not available on this deployment");
  if (!(await memberScope(ctx, principalId, scope))) return forbidden(res);
  const p = await deps.channelPolicy.get(container);
  return sendJson(res, 200, {
    policy: {
      orders: p?.orders ?? "",
      bots: p?.bots ?? {},
      ambientEnabled: p?.ambientEnabled ?? null,
      updatedAt: p?.updatedAt ?? 0,
    },
  });
}

export async function setContextPolicy(ctx: ApiCtx): Promise<void> {
  const { res, deps, body } = ctx;
  const b = isObj(body) ? body : {};
  const principalId = stringField(b, "principalId");
  const scope = stringField(b, "scope");
  if (!principalId || !scope) return badRequest(res, "principalId and scope required");
  const container = channelContainer(scope);
  if (!container) return badRequest(res, "ambient policy applies to channel and group scopes only");
  if (!deps.channelPolicy) return notFound(res, "not available on this deployment");
  if (!(await memberScope(ctx, principalId, scope))) return forbidden(res);
  if (typeof b.orders !== "string") return badRequest(res, "orders (string) required");
  if (b.orders.length > MAX_ORDERS_CHARS)
    return badRequest(
      res,
      `standing order is capped at ${MAX_ORDERS_CHARS} characters — it is rendered into every ambient judgment`,
    );
  const parsed = parseBotLedger(b.bots ?? {});
  if ("error" in parsed) return badRequest(res, parsed.error);
  if (b.ambientEnabled !== undefined && b.ambientEnabled !== null && typeof b.ambientEnabled !== "boolean")
    return badRequest(res, "ambientEnabled must be a boolean or null (null = default rule)");
  const current = await deps.channelPolicy.get(container);
  if (typeof b.baseUpdatedAt === "number" && (current?.updatedAt ?? 0) !== b.baseUpdatedAt) {
    return conflict(res, "this channel's policy changed since you loaded it — reload and re-apply your edit");
  }
  const p = await deps.channelPolicy.set(container, b.orders, {
    setBy: principalId,
    bots: parsed.bots,
    ambientEnabled: b.ambientEnabled as boolean | null | undefined,
  });
  audit(deps, { principalId, action: "surface.policy.set", resource: container, scopeLabel: scope });
  return sendJson(res, 200, {
    policy: { orders: p.orders, bots: p.bots, ambientEnabled: p.ambientEnabled ?? null, updatedAt: p.updatedAt },
  });
}

export const contextPolicyRoutes: ReadonlyArray<Route<ApiCtx>> = [
  { method: "GET", path: "/v1/contexts/policy", auth: "source", handle: getContextPolicy },
  { method: "PUT", path: "/v1/contexts/policy", auth: "source", handle: setContextPolicy },
];
