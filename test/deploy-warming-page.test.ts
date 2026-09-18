import { test } from "node:test";
import assert from "node:assert/strict";
import { serveApp, stubHttp } from "./support/api.ts";
import type { App } from "../src/api/app.ts";

function appWith(endpoint: Record<string, unknown>): App {
  return { reachDeployment: async () => ({ status: "ok", endpoint }) } as unknown as App;
}

test("/d/ proxy serves the warming page to a browser navigation when the deployment hangs", async () => {
  const held: import("node:net").Socket[] = [];
  const upstream = stubHttp((req) => {
    held.push(req.socket);
  });

  const server = serveApp(appWith({ host: "127.0.0.1", port: upstream.port }), {
    deployDialTimeoutMs: 200,
  });
  try {
    const res = await fetch(`${server.base}/d/some-id/`, {
      headers: { accept: "text/html,application/xhtml+xml", "sec-fetch-dest": "document" },
    });
    assert.equal(res.status, 503);
    assert.match(String(res.headers.get("content-type")), /text\/html/);
    assert.equal(res.headers.get("retry-after"), "2");
    const body = await res.text();
    assert.match(body, /starting up/i);
    assert.match(body, /location\.reload/);
  } finally {
    for (const s of held) s.destroy();
    await server.close();
    await upstream.close();
  }
});

test("/d/ proxy serves the warming page to a browser navigation when the deployment refuses connections", async () => {
  const upstream = stubHttp(() => {});
  const upstreamPort = upstream.port;
  await upstream.close();

  const server = serveApp(appWith({ host: "127.0.0.1", port: upstreamPort }));
  try {
    const res = await fetch(`${server.base}/d/some-id/`, { headers: { accept: "text/html" } });
    assert.equal(res.status, 503);
    assert.match(await res.text(), /starting up/i);
  } finally {
    await server.close();
  }
});

test("/d/ proxy keeps JSON gateway errors for non-document requests", async () => {
  const held: import("node:net").Socket[] = [];
  const upstream = stubHttp((req) => {
    held.push(req.socket);
  });

  const server = serveApp(appWith({ host: "127.0.0.1", port: upstream.port }), {
    deployDialTimeoutMs: 200,
  });
  try {
    const apiRes = await fetch(`${server.base}/d/some-id/api/data`, { headers: { accept: "application/json" } });
    assert.equal(apiRes.status, 504);
    assert.equal(((await apiRes.json()) as { error?: string }).error, "gateway_timeout");

    const postRes = await fetch(`${server.base}/d/some-id/`, {
      method: "POST",
      headers: { accept: "text/html", "content-type": "text/plain", "content-length": "2" },
      body: "hi",
    });
    assert.equal(postRes.status, 504);
    assert.equal(((await postRes.json()) as { error?: string }).error, "gateway_timeout");
  } finally {
    for (const s of held) s.destroy();
    await server.close();
    await upstream.close();
  }
});

test("a recently-healthy upstream keeps the full dial timeout for slow pages", async () => {
  let slow = false;
  const upstream = stubHttp((req, res) => {
    if (slow) setTimeout(() => res.end("slow-ok"), 300);
    else res.end("fast-ok");
  });

  const server = serveApp(appWith({ host: "127.0.0.1", port: upstream.port }), {
    deployDialTimeoutMs: 1000,
  });
  try {
    const first = await fetch(`${server.base}/d/some-id/`, { headers: { accept: "text/html" } });
    assert.equal(await first.text(), "fast-ok");
    slow = true;
    const second = await fetch(`${server.base}/d/some-id/`, { headers: { accept: "text/html" } });
    assert.equal(second.status, 200);
    assert.equal(await second.text(), "slow-ok");
  } finally {
    await server.close();
    await upstream.close();
  }
});
