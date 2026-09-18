import { parseSuggestedActivities } from "../../../plugins/chassis/src/suggested-activities.ts";
import { badRequest, forbidden, notFound, sendJson } from "../http.ts";
import { isObj } from "./shared.ts";
import type { Route } from "./route.ts";

export const suggestedActivityRoutes: Route[] = [
  {
    method: "GET",
    path: "/v1/suggested-activities",
    auth: "source",
    handle: ({ res, deps }) => sendJson(res, 200, { enabled: Boolean(deps.suggestedActivities) }),
  },
  {
    method: "POST",
    path: "/v1/suggested-activities",
    auth: "source",
    handle: async ({ res, deps, body, actor }) => {
      if (!deps.suggestedActivities) return notFound(res);
      if (!isObj(body) || typeof body.principalId !== "string" || !body.principalId || body.principalId.length > 200) {
        return badRequest(res);
      }
      if (actor && actor.p !== body.principalId) return forbidden(res);
      let seeds;
      try {
        seeds = parseSuggestedActivities(JSON.stringify(body.seeds ?? []));
      } catch {
        return badRequest(res);
      }
      const timezone = body.timezone ?? "UTC";
      if (typeof timezone !== "string" || timezone.length > 100) return badRequest(res);
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: timezone });
      } catch {
        return badRequest(res);
      }
      return sendJson(res, 200, await deps.suggestedActivities.get(body.principalId, seeds, timezone));
    },
  },
];
