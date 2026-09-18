import {
  CUSTOM_PROVIDER_PROTOCOLS,
  type CustomProviderSpec,
  type CustomProviderProtocol,
} from "../../../model/custom-providers.ts";
import { badRequest, notFound, sendJson } from "../../http.ts";
import type { ApiCtx } from "../route.ts";
import { audit, authorizeAdmin, orgScope } from "../shared.ts";

async function actor(ctx: ApiCtx) {
  const scope = orgScope(ctx.deps);
  return authorizeAdmin(ctx, scope);
}

/**
 * Key validation against the registered endpoint, protocol-appropriate.
 * A gateway may not implement a models listing, so callers can skip
 * with {"validate": false} — the registration is admin-only either way.
 */
async function validateKey(
  ctx: ApiCtx,
  protocol: CustomProviderProtocol,
  baseUrl: string,
  apiKey: string,
): Promise<boolean> {
  const url = protocol === "anthropic" ? `${baseUrl}/v1/models` : `${baseUrl}/models`;
  const headers: Record<string, string> =
    protocol === "anthropic"
      ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
      : { authorization: `Bearer ${apiKey}` };
  try {
    const response = await (ctx.deps.modelCredentialFetch ?? fetch)(url, {
      headers,
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function getCustomProviders(ctx: ApiCtx): Promise<void> {
  const authorized = await actor(ctx);
  if (!authorized) return;
  if (!ctx.deps.customProviders) return notFound(ctx.res);
  audit(ctx.deps, {
    principalId: authorized.id,
    action: "custom-providers.read",
    resource: "custom-providers",
    scopeLabel: orgScope(ctx.deps),
  });
  return sendJson(ctx.res, 200, { providers: await ctx.deps.customProviders.statuses() });
}

export async function putCustomProvider(ctx: ApiCtx): Promise<void> {
  const authorized = await actor(ctx);
  if (!authorized) return;
  if (!ctx.deps.customProviders) return notFound(ctx.res);
  const id = ctx.params.provider;
  if (!id) return notFound(ctx.res);
  const body = ctx.body as {
    name?: unknown;
    protocol?: unknown;
    baseUrl?: unknown;
    models?: unknown;
    apiKey?: unknown;
    validate?: unknown;
  };
  if (typeof body.name !== "string" || typeof body.protocol !== "string" || typeof body.baseUrl !== "string") {
    return badRequest(ctx.res, "name, protocol, and baseUrl are required");
  }
  if (!(CUSTOM_PROVIDER_PROTOCOLS as readonly string[]).includes(body.protocol)) {
    return badRequest(ctx.res, `protocol must be one of ${CUSTOM_PROVIDER_PROTOCOLS.join(", ")}`);
  }
  const spec: CustomProviderSpec = {
    id,
    name: body.name,
    protocol: body.protocol as CustomProviderProtocol,
    baseUrl: body.baseUrl.trim().replace(/\/+$/, ""),
    models: Array.isArray(body.models) ? (body.models as CustomProviderSpec["models"]) : [],
  };
  const apiKey = typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : undefined;
  const shouldValidate = body.validate !== false && apiKey !== undefined;
  if (shouldValidate && !(await validateKey(ctx, spec.protocol, spec.baseUrl, apiKey!))) {
    return sendJson(ctx.res, 400, {
      error: "invalid_api_key",
      message: `${spec.baseUrl} rejected this API key (pass "validate": false to skip for endpoints without a models listing)`,
    });
  }
  try {
    await ctx.deps.customProviders.upsert(spec, apiKey, authorized.id);
  } catch (e) {
    return badRequest(ctx.res, (e as Error).message);
  }
  await ctx.deps.refreshCustomProviders?.();
  audit(ctx.deps, {
    principalId: authorized.id,
    action: "custom-providers.update",
    resource: id,
    scopeLabel: orgScope(ctx.deps),
  });
  const status = (await ctx.deps.customProviders.statuses()).find((item) => item.id === id);
  return sendJson(ctx.res, 200, { ok: true, status });
}

export async function deleteCustomProvider(ctx: ApiCtx): Promise<void> {
  const authorized = await actor(ctx);
  if (!authorized) return;
  if (!ctx.deps.customProviders) return notFound(ctx.res);
  const id = ctx.params.provider;
  if (!id) return notFound(ctx.res);
  const removed = await ctx.deps.customProviders.delete(id, authorized.id);
  if (!removed) return notFound(ctx.res);
  await ctx.deps.refreshCustomProviders?.();
  audit(ctx.deps, {
    principalId: authorized.id,
    action: "custom-providers.delete",
    resource: id,
    scopeLabel: orgScope(ctx.deps),
  });
  return sendJson(ctx.res, 200, { ok: true });
}
