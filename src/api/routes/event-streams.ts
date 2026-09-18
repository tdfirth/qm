import type { App } from "../app.ts";
import type { BaseCtx, Route } from "./route.ts";
import { canonicalPayload, verifyOrReject } from "../http.ts";
import type { SubscribeOptions } from "../../util/event-bus.ts";

const HEARTBEAT_MS = 25_000;

function sourceEventStream(
  path: string,
  event: string,
  subscribe: (app: App, cb: (event: unknown) => void, opts: SubscribeOptions) => () => void,
): Route<BaseCtx> {
  return {
    method: "GET",
    path,
    auth: "source",
    handle: async (ctx) => {
      const { req, res, app, secret, auth, url, pathname, method } = ctx;
      if (
        !(await verifyOrReject(
          req,
          res,
          secret,
          auth,
          canonicalPayload(method, pathname + url.search, ""),
          false,
          ctx.allowUnsignedSourceAuth,
        ))
      ) {
        req.resume();
        return;
      }
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      res.write(": open\n\n");
      const unsubscribe = subscribe(
        app,
        (payload) => {
          res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
        },
        { onResync: () => res.write(`event: ${event}_resync\ndata: {}\n\n`) },
      );
      const beat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
      beat.unref?.();
      req.on("close", () => {
        clearInterval(beat);
        unsubscribe();
      });
    },
  };
}

export const sessionStateRawRoutes: ReadonlyArray<Route<BaseCtx>> = [
  sourceEventStream("/v1/session-state/events", "session_state", (app, cb, opts) =>
    app.subscribeSessionStates(cb, opts),
  ),
];

export const loopItemEventsRawRoutes: ReadonlyArray<Route<BaseCtx>> = [
  sourceEventStream("/v1/loop-items/events", "loop_item", (app, cb, opts) => app.subscribeLedgerEvents(cb, opts)),
];
