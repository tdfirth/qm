import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";
import type { Agent } from "@earendil-works/pi-agent-core";
import type { ComposerSurface, ConvCtx } from "../src/conv-types.ts";
import type { SuggestedActivity } from "../../chassis/src/suggested-activities.ts";
import { NoopResizeObserver, withDom } from "./dom-fixture.ts";

test("activity selection fills and persists an editable draft without sending or overwriting work", async () => {
  const { dom, restore } = withDom('<!doctype html><div id="app"></div><main></main>', {
    url: "http://localhost/",
    pretendToBeVisual: true,
    globals: [
      "window",
      "document",
      "location",
      "localStorage",
      "navigator",
      "HTMLElement",
      "HTMLTextAreaElement",
      "Element",
      "Node",
      "customElements",
    ],
    define: (window) => ({
      getComputedStyle: window.getComputedStyle.bind(window),
      requestAnimationFrame: window.requestAnimationFrame.bind(window),
      cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
      ResizeObserver: NoopResizeObserver,
      fetch: async (input: RequestInfo | URL) => {
        assert.ok(String(input).startsWith("/api/runtime-config"), "activity selection must not submit a turn");
        return Response.json({
          scopeId: "personal:tester",
          approvedHarnesses: ["pi"],
          modelsByHarness: { pi: ["test-model"] },
          modelCatalog: {
            "test-model": {
              id: "test-model",
              name: "Test model",
              label: "Test model",
              buttonLabel: "Test model",
              provider: "anthropic",
              api: "anthropic-messages",
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 10000,
              maxTokens: 1000,
            },
          },
          effective: { harnessId: "pi", modelId: "test-model" },
          orgDefault: { harnessId: "pi", modelId: "test-model", revision: 1 },
          scopeOverride: null,
          upgradeAvailable: false,
          fastModeModelIds: [],
        });
      },
    }),
  });
  const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom" });
  let composer: ComposerSurface | undefined;
  try {
    const { appState } = await vite.ssrLoadModule("/src/shell-state.ts");
    const { createComposerSurface } = await vite.ssrLoadModule("/src/composer.ts");
    const { suggestedActivities } = await vite.ssrLoadModule("/src/suggested-activities.ts");
    const { storedDraft, newChatDraftKey } = await vite.ssrLoadModule("/src/drafts.ts");
    const { render, html } = await vite.ssrLoadModule("lit");
    const activities: SuggestedActivity[] = Array.from({ length: 4 }, (_, i) => ({
      id: `idea-${i}`,
      title: i === 0 ? "<img src=x onerror=alert(1)>" : `Activity ${i}`,
      prompt: `Draft request ${i}`,
      icon: ["🛠️", "yc", "app", "app"][i]!,
    }));
    appState.me = { user: "tester", org: "test", suggestedActivities: activities };
    const host = document.querySelector<HTMLElement>("main")!;
    const agentState = { isStreaming: false, messages: [] };
    const agent = { state: agentState } as unknown as Agent;
    const draw = () =>
      render(
        html`${suggestedActivities(appState.me.suggestedActivities, (activity: SuggestedActivity) => composer!.fillSuggestedPrompt(activity.prompt, agent), Boolean(composer!.state.draft || composer!.state.attachments.length))}${composer!.composerForm(agent)}`,
        host,
      );
    const ctx = {
      pane: false,
      chat: {
        state: {
          agent,
          host,
          threadRef: "web:tester:suggestions",
          sessionId: null,
          scopeId: null,
          resolvingApprovals: new Set(),
        },
        activePendingApprovals: () => [],
        hasUnresolvedApproval: () => false,
        hasLiveRun: () => false,
        isStopping: () => false,
        drawActiveChat: draw,
      },
    } as unknown as ConvCtx;
    composer = createComposerSurface(ctx);
    ctx.composer = composer!;
    await composer!.refreshRuntimeSelection(null, agent);
    draw();
    assert.equal(host.querySelectorAll(".suggested-activity").length, 3);
    assert.equal(host.querySelector(".suggested-activity-title")?.textContent, activities[0].title);
    assert.equal(host.querySelector("img"), null);
    const region = host.querySelector(".suggested-activities")!;
    assert.equal(host.querySelector(".suggested-activity-yc")?.textContent, "Y");
    assert.match(host.querySelector(".suggested-activity-icon")?.textContent ?? "", /🛠️/);
    host.querySelector<HTMLButtonElement>(".suggested-activity")!.click();
    await new Promise<void>((resolve) => dom.window.requestAnimationFrame(() => resolve()));
    assert.equal(composer!.state.draft, "Draft request 0");
    assert.equal(storedDraft("web:tester:suggestions"), "Draft request 0");
    assert.equal(storedDraft(newChatDraftKey("tester")), "Draft request 0");
    assert.equal(document.activeElement, host.querySelector("textarea"));
    assert.equal(host.querySelector(".suggested-activities"), region);
    assert.equal(region.getAttribute("aria-hidden"), "true");
    assert.ok(region.hasAttribute("inert"));
    assert.equal(host.querySelectorAll(".suggested-activity:enabled").length, 0);
    assert.deepEqual(agent.state.messages, []);
    composer!.fillSuggestedPrompt("replacement", agent);
    assert.equal(composer!.state.draft, "Draft request 0");
    const input = host.querySelector<HTMLTextAreaElement>("textarea")!;
    input.value = "";
    input.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true }));
    assert.equal(host.querySelectorAll(".suggested-activity:enabled").length, 3);
    assert.equal(region.getAttribute("aria-hidden"), "false");
    assert.equal(region.hasAttribute("inert"), false);
    input.value = "My own draft";
    input.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true }));
    assert.equal(host.querySelector(".suggested-activities"), region);
    assert.equal(region.getAttribute("aria-hidden"), "true");
    assert.ok(region.hasAttribute("inert"));
    assert.equal(host.querySelectorAll(".suggested-activity:enabled").length, 0);
    assert.equal(storedDraft(newChatDraftKey("tester")), "My own draft");
    composer!.state.draft = "";
    composer!.state.processingFiles = true;
    composer!.fillSuggestedPrompt("replacement", agent);
    assert.equal(composer!.state.draft, "");
    composer!.state.processingFiles = false;
    composer!.state.attachments.push({} as never);
    composer!.fillSuggestedPrompt("replacement", agent);
    assert.equal(composer!.state.draft, "");
    composer!.state.attachments.length = 0;
    agentState.isStreaming = true;
    composer!.fillSuggestedPrompt("replacement", agent);
    assert.equal(composer!.state.draft, "");
    appState.me.suggestedActivities = undefined;
    draw();
    assert.equal(host.querySelector(".suggested-activities"), null);
  } finally {
    composer?.dispose();
    await vite.close();
    restore();
  }
});
