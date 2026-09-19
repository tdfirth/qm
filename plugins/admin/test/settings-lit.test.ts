import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";
import { JSDOM } from "jsdom";
const bundle = buildSync({
  entryPoints: [new URL("../ui/settings.ts", import.meta.url).pathname],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "settingsUI",
  platform: "browser",
}).outputFiles[0]!.text;
function setup() {
  const dom = new JSDOM(readFileSync(new URL("../public/index.html", import.meta.url), "utf8"), {
    runScripts: "outside-only",
  });
  dom.window.structuredClone = structuredClone;
  dom.window.eval(bundle + "; window.settingsUI=settingsUI; settingsUI.mountCards();");
  return dom;
}
const models = {
  baseModelDefault: "a",
  baseModelOptions: [{ id: "a", name: "Alpha" }],
  harnessDefault: "pi",
  harnessOptions: ["pi", "codex"],
  modelsByHarness: { pi: [{ id: "a", name: "Alpha" }], codex: [{ id: "b", name: "Beta" }] },
  thinkingLevelsByHarness: { pi: ["auto", "high"], codex: ["low"] },
  runtime: { harnessId: "pi", modelId: "a", effortLevel: "high", fastMode: true },
  fastModeHarnessIds: ["pi"],
  fastModeModelIds: ["a"],
  webuiModels: [],
};
test("runtime selection derives compatible model, reasoning, and fast mode from state", () => {
  const dom = setup();
  try {
    dom.window.eval("settingsUI.load(" + JSON.stringify(models) + ',"org:test","runtime")');
    const input = dom.window.document.getElementById("base-harness") as HTMLSelectElement;
    input.value = "codex";
    input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    assert.deepEqual(JSON.parse(String(dom.window.eval('JSON.stringify(settingsUI.collect("runtime"))'))), {
      harnessId: "codex",
      modelId: "b",
      effortLevel: "low",
      fastMode: false,
    });
    assert.equal((dom.window.document.querySelector('[data-save="runtime"]') as HTMLButtonElement).disabled, false);
  } finally {
    dom.window.close();
  }
});
test("model chips add and remove with stable keyed rendering", () => {
  const dom = setup();
  try {
    dom.window.eval("settingsUI.load(" + JSON.stringify(models) + ',"org:test","webui-models")');
    const select = dom.window.document.getElementById("webui-models-add") as HTMLSelectElement;
    select.value = "b";
    select.dispatchEvent(new dom.window.Event("change"));
    dom.window.document.getElementById("webui-models-add-button")!.click();
    assert.equal(dom.window.eval('settingsUI.collect("webui-models").ids.join()'), "b");
    dom.window.document.querySelector<HTMLButtonElement>('[aria-label="Remove b"]')!.click();
    assert.equal(dom.window.eval('settingsUI.states.get("webui-models").dirty'), false);
  } finally {
    dom.window.close();
  }
});
test("SOUL conflict keeps draft while replacing saved revision and version", () => {
  const dom = setup();
  try {
    dom.window.eval('settingsUI.load({soul:"old",soulVersion:1},"org:test","soul")');
    dom.window.document.getElementById("soul-edit")!.click();
    const input = dom.window.document.getElementById("soul") as HTMLTextAreaElement;
    input.value = "draft <img src=x>";
    input.dispatchEvent(new dom.window.Event("input"));
    dom.window.eval('settingsUI.refreshSoul({soul:"other",soulVersion:2})');
    assert.equal(input.value, "draft <img src=x>");
    assert.equal(dom.window.document.getElementById("soul-saved")!.textContent, "other");
    assert.equal(dom.window.eval('settingsUI.collect("soul").expectedVersion'), 2);
    assert.equal(dom.window.document.querySelector("#card-soul img"), null);
  } finally {
    dom.window.close();
  }
});
test("branding picker and URL update state and submitted saves preserve newer edits", () => {
  const dom = setup();
  try {
    dom.window.eval('settingsUI.load({branding:{}},"org:test","branding")');
    const input = dom.window.document.getElementById("branding-accent-picker") as HTMLInputElement;
    input.value = "#123456";
    input.dispatchEvent(new dom.window.Event("input"));
    assert.equal(dom.window.document.documentElement.style.getPropertyValue("--cta"), "#123456");
    assert.equal(dom.window.document.documentElement.style.getPropertyValue("--cta-foreground"), "#ffffff");
    input.value = "#eeeeee";
    input.dispatchEvent(new dom.window.Event("input"));
    assert.equal(dom.window.document.documentElement.style.getPropertyValue("--cta-foreground"), "#000000");
    dom.window.document.getElementById("branding-accent-reset")!.click();
    assert.equal(dom.window.document.documentElement.style.getPropertyValue("--cta"), "");
    assert.equal(dom.window.document.documentElement.style.getPropertyValue("--cta-foreground"), "");
    input.value = "#123456";
    input.dispatchEvent(new dom.window.Event("input"));
    dom.window.eval(
      'var body = settingsUI.collect("branding");settingsUI.states.get("branding").change("accent","#654321");settingsUI.commit("branding",body)',
    );
    assert.equal(dom.window.eval('settingsUI.states.get("branding").dirty'), true);
    assert.equal(input.value, "#654321");
  } finally {
    dom.window.close();
  }
});

test("credential editor derives broker capabilities and preserves write-only secrets", () => {
  const dom = setup();
  try {
    dom.window.eval(
      'settingsUI.configureCredentials({label: id => id,formatTime:String,edit(){},remove(){}}); settingsUI.loadCredentials([],[],[],[],"org:test"); settingsUI.credentialState.begin({slug:"service",name:"Service",host:"api.example.com",updatedAt:10,hasSecret:true,injection:{actor:true},grantees:["org:test"]})',
    );
    const doc = dom.window.document;
    const secret = doc.getElementById("sc-secret") as HTMLInputElement;
    assert.equal(secret.value, "");
    assert.equal(dom.window.eval('"secret" in settingsUI.credentialState.collect()'), false);
    assert.equal(dom.window.eval("settingsUI.credentialState.collect().injection.actor"), true);
    const host = doc.getElementById("sc-host") as HTMLInputElement;
    host.value = "changed.example.com";
    host.dispatchEvent(new dom.window.Event("input"));
    assert.equal(doc.getElementById("sc-cap-host")!.textContent, "changed.example.com and its subdomains");
    assert.equal((doc.getElementById("sc-save") as HTMLButtonElement).disabled, false);
    assert.equal(dom.window.eval("settingsUI.credentialState.collect().expectedUpdatedAt"), 10);
  } finally {
    dom.window.close();
  }
});

test("credential delivery transitions exclude narrower broker grants from env payloads", () => {
  const dom = setup();
  try {
    dom.window.eval(
      'settingsUI.loadCredentials([],[],[],[],"org:test"); settingsUI.credentialState.begin(null); settingsUI.credentialState.change("name","Example");settingsUI.credentialState.change("slug","example");settingsUI.credentialState.change("org",false);settingsUI.credentialState.change("people","person@example.com");settingsUI.credentialState.change("delivery","env");settingsUI.credentialState.change("envkey","EXAMPLE_KEY")',
    );
    assert.equal(dom.window.eval("settingsUI.credentialState.collect().grantees.join()"), "org:test");
    assert.equal(dom.window.eval("settingsUI.credentialState.collect().host"), "");
    assert.equal(dom.window.eval("settingsUI.credentialState.validate(settingsUI.credentialState.collect())"), "");
    dom.window.eval('settingsUI.credentialState.change("envkey","AGENT_SECRET")');
    assert.match(
      String(dom.window.eval("settingsUI.credentialState.validate(settingsUI.credentialState.collect())")),
      /reserved/,
    );
  } finally {
    dom.window.close();
  }
});

test("credential save acknowledges its submitted snapshot and retains newer edits", () => {
  const dom = setup();
  try {
    dom.window.eval(
      'settingsUI.loadCredentials([],[],[],[],"org:test"); settingsUI.credentialState.begin({slug:"test",name:"Old",host:"example.com",updatedAt:1,grantees:["org:test"]});settingsUI.credentialState.change("name","Submitted");window.submitted=settingsUI.credentialState.collect();settingsUI.credentialState.change("name","Newer draft");settingsUI.loadCredentials([{slug:"test",updatedAt:2}],[],[],[],"org:test");settingsUI.credentialState.commit(submitted)',
    );
    assert.equal(dom.window.eval("settingsUI.credentialState.collect().name"), "Newer draft");
    assert.equal(dom.window.eval("settingsUI.credentialState.collect().expectedUpdatedAt"), 2);
    assert.equal(dom.window.eval("settingsUI.credentialState.dirty"), true);
  } finally {
    dom.window.close();
  }
});

test("theme browsing mounts one dialog and keeps provisional previews separate from the saved draft", async () => {
  const dom = setup();
  try {
    dom.window.eval(`
      HTMLElement.prototype.scrollIntoView = function() {};
      HTMLDialogElement.prototype.showModal = function() {this.open=true;};
      HTMLDialogElement.prototype.close = function() {this.open=false;this.dispatchEvent(new Event("close"));};
      window.preview = null;
      window.fetch = async () => ({ok:true,json:async()=>[]});
      settingsUI.configureBranding({tools:{isPalette:()=>true},catalogUrl:"/themes",currentPreview:()=>preview,preview:theme=>{window.preview=theme;}});
      settingsUI.load({branding:{}},"org:test","branding");
    `);
    dom.window.document.getElementById("branding-theme-open")!.click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(dom.window.document.querySelectorAll("#branding-theme-title").length, 1);
    const dialog = dom.window.document.getElementById("branding-theme-dialog")!;
    dialog.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    assert.equal(dom.window.eval("preview.mode"), "light");
    assert.equal(dom.window.eval('settingsUI.collect("branding").theme.mode'), "system");
    dialog.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    assert.equal(dom.window.eval('settingsUI.collect("branding").theme.mode'), "light");
    assert.equal(dom.window.eval('settingsUI.states.get("branding").dirty'), true);
  } finally {
    dom.window.close();
  }
});
