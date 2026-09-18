import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createServer } from "vite";
import { activeSessionForDocumentTitle, documentTitle, PRODUCT_TITLE } from "../src/document-title.ts";
import { DOM_GLOBALS, NoopResizeObserver, timeoutFrames, withDom } from "./dom-fixture.ts";

const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("page titles retain the static product title", () => {
  assert.ok(index.includes(`<title>${PRODUCT_TITLE}</title>`));
  assert.equal(documentTitle("chats", "Quarterly planning", true), `Quarterly planning · ${PRODUCT_TITLE}`);
  assert.equal(documentTitle(), PRODUCT_TITLE);
});

test("chat and non-chat views have useful fallbacks", () => {
  assert.equal(documentTitle("chats"), `Chats · ${PRODUCT_TITLE}`);
  assert.equal(documentTitle("chats", null, true), `New chat · ${PRODUCT_TITLE}`);
  assert.equal(documentTitle("contexts"), `Projects · ${PRODUCT_TITLE}`);
  assert.equal(documentTitle("files"), `Files · ${PRODUCT_TITLE}`);
  assert.equal(documentTitle("keychain"), `Keychain · ${PRODUCT_TITLE}`);
});

test("active session selection follows conversation switches and title updates", () => {
  const sessions = [
    { id: "old", threadRef: "old-thread", title: "Old title" },
    { id: "new", threadRef: "new-thread", title: "New title" },
  ];
  const current: { openingKey: string | null; sessionId: string | null; threadRef: string | null } = {
    openingKey: null,
    sessionId: "old",
    threadRef: "old-thread",
  };

  assert.equal(activeSessionForDocumentTitle(sessions, current)?.title, "Old title");
  current.openingKey = "new";
  assert.equal(activeSessionForDocumentTitle(sessions, current)?.title, "New title");
  sessions[1].title = "Server-generated title";
  assert.equal(activeSessionForDocumentTitle(sessions, current)?.title, "Server-generated title");
  current.openingKey = null;
  current.sessionId = "new";
  assert.equal(activeSessionForDocumentTitle(sessions, current)?.title, "Server-generated title");
});

test("document title follows session switches, split-pane focus, and sign-out", async () => {
  const { dom, restore } = withDom('<!doctype html><div id="app"></div>', {
    url: "http://localhost/web-ui/",
    globals: [...DOM_GLOBALS, "Element", "Node", "Event", "PointerEvent", "MouseEvent", "customElements"],
    define: (window) => ({
      getComputedStyle: window.getComputedStyle.bind(window),
      ...timeoutFrames,
      ResizeObserver: NoopResizeObserver,
      fetch: globalThis.fetch,
    }),
  });
  const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom" });
  try {
    const { appState, signOut, syncDocumentTitle } = await vite.ssrLoadModule("/src/shell.ts");
    const { mainConversation } = await vite.ssrLoadModule("/src/conversations.ts");
    const { openSession, refreshSessions, sessionsState } = await vite.ssrLoadModule("/src/sessions.ts");
    const { mountRestoredCanvas, beginSessionDrag } = await vite.ssrLoadModule("/src/split.ts");
    const oldSession = { id: "old", threadRef: "web:old", scopeId: "personal:tester", title: "Old title" };
    const newSession = { id: "new", threadRef: "web:new", scopeId: "personal:tester", title: "New title" };
    sessionsState.list = [oldSession, newSession];
    appState.me = { user: "tester", org: "test" };
    appState.currentView = "chats";
    appState.mainEl = document.createElement("main");
    appState.listEl = document.createElement("aside");
    document.body.append(appState.listEl, appState.mainEl);
    mainConversation().state.sessionId = "old";
    mainConversation().state.threadRef = "web:old";
    syncDocumentTitle();
    assert.equal(document.title, `Old title · ${PRODUCT_TITLE}`);
    mainConversation().state.sessionId = "new";
    mainConversation().state.threadRef = "web:new";
    syncDocumentTitle();
    assert.equal(document.title, `New title · ${PRODUCT_TITLE}`);

    globalThis.fetch = async (input) => {
      const session = String(input).includes("/sessions/new") ? newSession : oldSession;
      return Response.json({
        scopeId: "personal:tester",
        approvedHarnesses: [],
        modelsByHarness: {},
        modelCatalog: {},
        effective: { harnessId: "pi", modelId: "" },
        session,
        entries: [],
        sessions: sessionsState.list,
        contexts: [],
      });
    };
    mountRestoredCanvas();
    await openSession(oldSession);
    beginSessionDrag(newSession);
    document
      .querySelector(".zone-right")!
      .dispatchEvent(new dom.window.Event("drop", { bubbles: true, cancelable: true }));
    assert.equal(document.title, `New title · ${PRODUCT_TITLE}`);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const paneTitles = () =>
      Array.from(document.querySelectorAll(".split-pane-title-text"), (node) => node.textContent?.trim());
    const refreshTitles = async (oldTitle: string, newTitle: string) => {
      globalThis.fetch = async () =>
        Response.json({
          sessions: [
            { ...oldSession, title: oldTitle },
            { ...newSession, title: newTitle },
          ],
        });
      assert.equal(await refreshSessions({ silent: true }), true);
    };
    const focusPane = (index: number) => {
      document
        .querySelectorAll(".dv-tab")
        .item(index)
        .dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true }));
    };
    assert.deepEqual(paneTitles(), ["Old title", "New title"]);
    await refreshTitles("", "New title");
    assert.deepEqual(paneTitles(), ["Web chat", "New title"]);
    assert.equal(document.title, `New title · ${PRODUCT_TITLE}`);
    await refreshTitles("Fallback for overloaded title model", "New title");
    assert.deepEqual(paneTitles(), ["Fallback for overloaded title model", "New title"]);
    focusPane(0);
    assert.equal(document.title, `Fallback for overloaded title model · ${PRODUCT_TITLE}`);
    await refreshTitles("Fallback for overloaded title model", "Fallback for OAuth callback");
    assert.deepEqual(paneTitles(), ["Fallback for overloaded title model", "Fallback for OAuth callback"]);
    assert.equal(document.title, `Fallback for overloaded title model · ${PRODUCT_TITLE}`);
    focusPane(1);
    assert.equal(document.title, `Fallback for OAuth callback · ${PRODUCT_TITLE}`);

    globalThis.fetch = async () => new Response(null, { status: 204 });
    await signOut();
    assert.equal(document.title, PRODUCT_TITLE);
    await new Promise((resolve) => setTimeout(resolve, 250));
  } finally {
    await vite.close();
    restore();
  }
});
