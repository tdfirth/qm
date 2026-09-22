// Local demonstration of framed sign-in through QM's real app gateway.
//
//   node embed-demo.ts          (Node 23+, or add --experimental-strip-types on 22)
//
// Then, in Chrome:
//   1. http://demo.localhost:4103/login      — sets portal_session (Lax) + portal_session_x (None)
//   2. http://127.0.0.1:4102/                — the ALLOWED embedder: frame renders, <img> probe is 401
//   3. http://127.0.0.1:4104/                — an UNLISTED embedder: browser refuses the frame (CSP)
//
// Assumes Chrome: *.localhost resolves to loopback and counts as a secure context, so a
// Secure cookie sticks over http; and 127.0.0.1 is a different site from demo.localhost.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createApp } from "./src/api/app.ts";
import { createInsecureTestServer } from "./src/api/server.ts";
import { createDeployStore } from "./src/deploy/deploy-store.ts";
import { createDeployService } from "./src/deploy/deploy-service.ts";
import type { DeployProvider } from "./src/deploy/deploy-provider.ts";
import { createAclStore } from "./src/acl/acl-store.ts";
import { createDirectoryStore } from "./src/directory/directory-store.ts";
import { createIdentityService } from "./src/identity/identity-service.ts";
import { createMemorySessionStore } from "./src/sessions/memory-session-store.ts";
import { scopeId } from "./src/types.ts";
import type { AuditEvent } from "./src/audit/audit-log.ts";

const GATE_PORT = 4101;
const ALLOWED_EMBEDDER_PORT = 4102;
const LOGIN_PORT = 4103;
const UNLISTED_EMBEDDER_PORT = 4104;
const APP_HOST = "demo.localhost";
const SECRET = "embed-demo-session-secret";

const auditLog = {
  record(e: AuditEvent) {
    console.log(`[audit] ${e.action} ${e.resource ?? ""} ${e.status ?? ""}`);
  },
  async recordOnce(_k: string, e: AuditEvent) {
    console.log(`[audit] ${e.action} ${e.resource ?? ""} ${e.status ?? ""}`);
  },
  events: async () => [],
  tail: async () => [],
};

function mintPortalSession(sub: string): string {
  const key = createHmac("sha256", SECRET).update("portal.session.v1").digest();
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({ k: "session", sub, org: "demo", iat: now, exp: now + 3600 })).toString(
    "base64url",
  );
  return `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`;
}

// The "QM app": shows what it received, so you can see the session cookies never reach it.
const upstream = createServer((req, res) => {
  if (req.url?.startsWith("/probe")) {
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end("probe");
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><body style="font:14px system-ui;padding:12px;background:#e6ffed">
    <b>✅ Rendered inside the frame.</b>
    <p>Cookie header the app saw: <code>${req.headers.cookie ?? "(none)"}</code></p>
    <p>(both session cookies stripped by the gateway)</p></body>`);
});
upstream.listen(0, "127.0.0.1", async () => {
  const upstreamPort = (upstream.address() as AddressInfo).port;
  const provider: DeployProvider = {
    profile: { managedScaleToZero: false },
    apply: async () => ({ host: "127.0.0.1", port: upstreamPort }),
    destroy: async () => {},
  };
  const deploy = createDeployService({
    deployStore: createDeployStore(),
    provider,
    auditLog,
    acl: createAclStore(),
    deployDir: mkdtempSync(join(tmpdir(), "embed-demo-")),
  });
  const app = createApp({
    deploy,
    acl: createAclStore(),
    directory: createDirectoryStore(),
    sessions: createMemorySessionStore(),
    identity: createIdentityService(),
  } as unknown as Parameters<typeof createApp>[0]);
  const d = await app.deploy({
    ownerScopeId: scopeId("personal", "U1"),
    createdBy: "U1",
    entrypoint: "x",
    files: [],
    name: "demo",
  });
  const allowed = `http://127.0.0.1:${ALLOWED_EMBEDDER_PORT}`;
  await app.setDeploymentEmbedAncestors(d.id, [allowed]);

  // QM's real gateway, serving demo.localhost.
  const gate = createInsecureTestServer(app, {
    deployAppsDomain: "localhost",
    deployGateSecret: "gate-secret",
    auditLog,
    deployAppsSessionSecret: SECRET,
    deployAppsLoginUrl: `http://${APP_HOST}:${LOGIN_PORT}`,
  });
  gate.listen(GATE_PORT, "127.0.0.1");

  // Stand-in for the portal's login: issues the same two cookies the portal would.
  createServer((req, res) => {
    const clear = req.url?.startsWith("/logout");
    const token = clear ? "" : mintPortalSession("U1");
    const age = clear ? "Max-Age=0" : "Max-Age=3600";
    res.setHeader("set-cookie", [
      `portal_session=${token}; HttpOnly; SameSite=Lax; Path=/; ${age}`,
      `portal_session_x=${token}; HttpOnly; SameSite=None; Secure; Path=/; ${age}`,
    ]);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><body style="font:14px system-ui;padding:16px">
      <h3>${clear ? "Signed out" : "Signed in as U1"}</h3>
      <p>Set on <code>${APP_HOST}</code>: <code>portal_session</code> (SameSite=Lax) and <code>portal_session_x</code> (SameSite=None; Secure).</p>
      <p>Check DevTools → Application → Cookies → ${APP_HOST} to confirm both are present.</p>
      <p>Now open the <a href="${allowed}/">allowed embedder</a> or the <a href="http://127.0.0.1:${UNLISTED_EMBEDDER_PORT}/">unlisted embedder</a>.
      <a href="/logout">Sign out</a></p></body>`);
  }).listen(LOGIN_PORT, "127.0.0.1");

  const embedderPage = (port: number, listed: boolean) => `<!doctype html>
<body style="font:14px system-ui;padding:16px;max-width:720px">
<h3>Embedder on 127.0.0.1:${port} — ${listed ? "ON" : "NOT on"} the app's embedAncestors</h3>
<p>Top-level site is 127.0.0.1; the app is ${APP_HOST}. Cross-site, so the Lax cookie is withheld and only the None twin can authenticate.</p>
<p><b>Frame document</b> (Sec-Fetch-Dest: iframe) — ${listed ? "expect the green app" : "expect the browser to REFUSE it: frame-ancestors only lists :" + ALLOWED_EMBEDDER_PORT}:</p>
<iframe src="http://${APP_HOST}:${GATE_PORT}/" style="width:100%;height:150px;border:2px solid #888"></iframe>
<p><b>Cross-site &lt;img&gt; probe</b> (Sec-Fetch-Dest: image) — expect 401 every time, exactly as Lax behaved:
<img src="http://${APP_HOST}:${GATE_PORT}/probe.png" onerror="this.replaceWith(Object.assign(document.createElement('b'),{textContent:'❌ img blocked (gateway answered 401 — the twin is not honoured for subresources)'}))" onload="this.replaceWith(Object.assign(document.createElement('b'),{textContent:'⚠️ img LOADED — unexpected'}))"></p>
<p><a href="http://${APP_HOST}:${LOGIN_PORT}/login">sign in</a> · <a href="http://${APP_HOST}:${LOGIN_PORT}/logout">sign out</a> · <a href="http://127.0.0.1:${listed ? UNLISTED_EMBEDDER_PORT : ALLOWED_EMBEDDER_PORT}/">other embedder</a></p>
</body>`;
  createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(embedderPage(ALLOWED_EMBEDDER_PORT, true));
  }).listen(ALLOWED_EMBEDDER_PORT, "127.0.0.1");
  createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(embedderPage(UNLISTED_EMBEDDER_PORT, false));
  }).listen(UNLISTED_EMBEDDER_PORT, "127.0.0.1");

  console.log(`
embed demo up:
  1. sign in:            http://${APP_HOST}:${LOGIN_PORT}/login
  2. allowed embedder:   ${allowed}/            (frame renders; img probe 401)
  3. unlisted embedder:  http://127.0.0.1:${UNLISTED_EMBEDDER_PORT}/            (browser refuses the frame)
  gateway (QM code):     http://${APP_HOST}:${GATE_PORT}/
Ctrl-C to stop.`);
});
