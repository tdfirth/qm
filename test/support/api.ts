import { mkdtempSync } from "node:fs";
import { createServer as createHttpServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo, Server as NetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { App } from "../../src/api/app.ts";
import { createInsecureTestServer, createServer } from "../../src/api/server.ts";
import type { Config } from "../../src/config.ts";
import { buildApp, type BuiltApp } from "../../src/wiring.ts";
import { testConfig } from "./test-config.ts";

type ServerOptions = NonNullable<Parameters<typeof createServer>[1]>;
type HeaderMap = Record<string, string>;

export interface Served<S extends NetServer = Server> {
  server: S;
  port: number;
  base: string;
  close: () => Promise<void>;
  get: (path: string, headers?: HeaderMap) => Promise<Response>;
  del: (path: string, headers?: HeaderMap) => Promise<Response>;
  post: (path: string, body: unknown, headers?: HeaderMap) => Promise<Response>;
  put: (path: string, body: unknown, headers?: HeaderMap) => Promise<Response>;
  patch: (path: string, body: unknown, headers?: HeaderMap) => Promise<Response>;
}

export interface Api extends Served {
  built: BuiltApp;
}

export const tmpDir = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix));

export function serve<S extends NetServer>(server: S, host = "localhost"): Served<S> {
  server.listen(0);
  const port = (server.address() as AddressInfo).port;
  const base = `http://${host}:${port}`;
  const bare =
    (method: string) =>
    (path: string, headers: HeaderMap = {}) =>
      fetch(base + path, { method, headers });
  const json =
    (method: string) =>
    (path: string, body: unknown, headers: HeaderMap = {}) =>
      fetch(base + path, {
        method,
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
  return {
    server,
    port,
    base,
    close: () => new Promise((resolve) => server.close(() => resolve())),
    get: bare("GET"),
    del: bare("DELETE"),
    post: json("POST"),
    put: json("PUT"),
    patch: json("PATCH"),
  };
}

export const stubHttp = (handler: RequestListener, host?: string): Served => serve(createHttpServer(handler), host);

export function serveApp(app: App, deps: ServerOptions = {}, host?: string): Served {
  return serve(deps.signingSecret ? createServer(app, deps) : createInsecureTestServer(app, deps), host);
}

export function startApi(
  overrides: Partial<Config> = {},
  deps: (built: BuiltApp, config: Config) => ServerOptions = () => ({}),
  host?: string,
): Api {
  const config = testConfig(overrides);
  const built = buildApp(config);
  return { built, ...serveApp(built.app, deps(built, config), host) };
}
