import assert from "node:assert/strict";
import { test } from "node:test";
import { VirtualConsole } from "jsdom";
import { createServer } from "vite";
import { DOM_GLOBALS, withDom } from "./dom-fixture.ts";

test("dismiss toast undoes the correct item and failed dismissals do not offer undo", async () => {
  const domErrors: Error[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => domErrors.push(error));
  const { restore } = withDom('<!doctype html><div id="app"></div><main id="main"></main>', {
    url: "http://localhost/web-ui/",
    virtualConsole,
    globals: [...DOM_GLOBALS, "Node"],
    define: (window) => ({ getComputedStyle: window.getComputedStyle.bind(window), fetch: globalThis.fetch }),
  });
  const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom" });
  try {
    await vite.ssrLoadModule("/src/shell.ts");
    const { setItemStatus, toInboxItem, inboxState, resetInboxState } = await vite.ssrLoadModule("/src/inbox.ts");
    const entry = {
      id: "item-1",
      loopId: "loop-1",
      state: "held",
      source: "gmail",
      sourcePayload: { title: "Example", from: "Sam", snippet: "Hello" },
      thread: [],
    };
    const item = toInboxItem(entry);
    inboxState.items = [item];
    const actions: string[] = [];
    globalThis.fetch = async (_url, options) => {
      const { kind } = JSON.parse(String(options?.body));
      actions.push(kind);
      return Response.json({ item: { ...entry, state: kind === "dismiss" ? "dismissed" : "held" } });
    };
    assert.equal(await setItemStatus(item, "dismissed"), true);
    const toast = document.querySelector(".action-toast")!;
    assert.match(toast.textContent!, /Dismissed from inbox/);
    const undo = toast.querySelector<HTMLButtonElement>("button")!;
    undo.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(actions, ["dismiss", "reopen"]);
    assert.equal(inboxState.items[0].status, "open");
    assert.equal(document.querySelector(".action-toast"), null);
    globalThis.fetch = async () => {
      throw new Error("Offline");
    };
    assert.equal(await setItemStatus(item, "dismissed"), false);
    assert.equal(document.querySelector(".action-toast"), null);
    assert.equal(inboxState.items[0].status, "open");
    resetInboxState();
    assert.deepEqual(domErrors, []);
  } finally {
    await vite.close();
    restore();
  }
});
