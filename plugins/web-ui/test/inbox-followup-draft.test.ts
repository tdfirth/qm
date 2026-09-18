import assert from "node:assert/strict";
import { test } from "node:test";
import { VirtualConsole } from "jsdom";
import { createServer } from "vite";
import { DOM_GLOBALS, withDom } from "./dom-fixture.ts";

test("a failed inbox followup preserves edits made while the request was pending", async () => {
  const domErrors: Error[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => domErrors.push(error));
  const { dom, restore } = withDom('<!doctype html><div id="app"></div><main id="main"></main>', {
    url: "http://localhost/web-ui/",
    virtualConsole,
    globals: [...DOM_GLOBALS, "Node"],
    define: (window) => ({ getComputedStyle: window.getComputedStyle.bind(window), fetch: globalThis.fetch }),
  });
  const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom" });
  try {
    await vite.ssrLoadModule("/src/shell.ts");
    const { askAgent, chatTpl, toInboxItem } = await vite.ssrLoadModule("/src/inbox.ts");
    const { render } = await vite.ssrLoadModule("lit");
    const host = dom.window.document.getElementById("main")!;
    for (const edited of [undefined, "New instruction", ""]) {
      const item = toInboxItem({
        id: `item-${String(edited)}`,
        loopId: "loop-1",
        state: "held",
        source: "slack",
        sourcePayload: { title: "Conversation", from: "Sam", snippet: "Please send the update" },
        thread: [],
      });
      let rejectRequest!: (error: Error) => void;
      globalThis.fetch = () =>
        new Promise<Response>((_, reject) => {
          rejectRequest = reject;
        });
      const request = askAgent(item, "Original instruction");
      render(chatTpl(item), host);
      const box = host.querySelector<HTMLTextAreaElement>(".inbox-chat-input")!;
      assert.equal(box.disabled, false);
      if (edited !== undefined) {
        box.value = edited;
        box.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      }
      rejectRequest(new Error("Request failed"));
      await request;
      render(chatTpl(item), host);
      assert.equal(
        host.querySelector<HTMLTextAreaElement>(".inbox-chat-input")!.value,
        edited ?? "Original instruction",
      );
    }
    assert.deepEqual(domErrors, []);
  } finally {
    await vite.close();
    restore();
  }
});
