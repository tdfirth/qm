import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { withDom } from "./dom-fixture.ts";

const { dom } = withDom("<!doctype html><body></body>", {
  url: "http://localhost/",
  matchMedia: false,
  globals: ["window", "document", "HTMLElement", "Node", "customElements"],
});

const { html, render } = await import("lit");
const { Archive, Link, X } = await import("lucide");
const { icon } = await import("../src/ui.ts");
const style = document.createElement("style");
style.textContent = readFileSync(new URL("../src/shell.css", import.meta.url), "utf8");
document.head.append(style);

for (const [label, glyph] of [
  ["Archive session", Archive],
  ["Share session", Link],
  ["Close pane", X],
] as const) {
  test(`${label} keeps pointer targeting on the button across icon redraws`, () => {
    const host = document.createElement("div");
    host.className = "dv-tab dv-active-tab";
    document.body.append(host);
    const view = () =>
      html`<span class="split-tab-actions"
        ><button class="icon-btn subtle split-tab-close" type="button" aria-label=${label}>
          ${icon(glyph, 13)}
        </button></span
      >`;
    render(view(), host);
    const button = host.querySelector("button")!;
    const before = button.querySelector("svg")!;
    assert.equal(dom.window.getComputedStyle(before).pointerEvents, "none");
    render(view(), host);
    const after = button.querySelector("svg")!;
    assert.equal(host.querySelector("button"), button);
    assert.notEqual(after, before);
    assert.equal(before.isConnected, false);
    assert.equal(dom.window.getComputedStyle(after).pointerEvents, "none");
    for (const child of after.children) assert.equal(dom.window.getComputedStyle(child).pointerEvents, "none");
    assert.notEqual(dom.window.getComputedStyle(button).pointerEvents, "none");
    host.remove();
  });
}
