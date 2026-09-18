import assert from "node:assert/strict";
import test from "node:test";
import { brandName, copyText } from "../src/ui.ts";
import { withDom } from "./dom-fixture.ts";

test("brand name defaults to QM", () => {
  const { restore } = withDom("", { matchMedia: false, globals: ["document"] });
  try {
    assert.equal(brandName(), "QM");
  } finally {
    restore();
  }
});

test("brand name follows the server-injected deployment label", () => {
  const { restore } = withDom('<meta name="brand-self-label" content="qm">', {
    matchMedia: false,
    globals: ["document"],
  });
  try {
    assert.equal(brandName(), "qm");
  } finally {
    restore();
  }
});

test("rapid copy feedback toggles a class and never rewrites the button markup", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { document, restore } = withDom('<button><svg data-icon="copy"></svg><span>Copy URL</span></button>', {
    matchMedia: false,
    globals: [],
    define: () => ({ navigator: { clipboard: { writeText: async () => {} } } }),
  });
  try {
    const button = document.querySelector("button") as HTMLButtonElement;
    const original = button.innerHTML;
    await copyText("first", button);
    await copyText("second", button);
    assert.ok(button.classList.contains("copied"));
    assert.equal(button.innerHTML, original);
    t.mock.timers.tick(1199);
    assert.ok(button.classList.contains("copied"), "the second copy restarts the feedback window");
    t.mock.timers.tick(1);
    assert.ok(!button.classList.contains("copied"));
  } finally {
    restore();
  }
});
