import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBranding, sanitizeBranding } from "../src/resolution/branding.ts";
import { scopeId } from "../src/types.ts";

const ORG = scopeId("org", "acme");

test("sanitizeBranding strips template braces and control characters from every field", () => {
  assert.deepEqual(sanitizeBranding({ selfLabel: "{{straylight}}", orgName: "Acme {{Corp}}" }), {
    selfLabel: "straylight",
    orgName: "Acme Corp",
  });
  assert.deepEqual(sanitizeBranding({ selfLabel: "a<b>\u0000c", mark: '"{Q}"' }), { selfLabel: "abc", mark: "Q" });
  assert.equal(sanitizeBranding({ selfLabel: "x".repeat(80) })?.selfLabel?.length, 40);
  assert.equal(sanitizeBranding({ selfLabel: "x".repeat(39) + "💚💚" })?.selfLabel, "x".repeat(39) + "💚");
  assert.doesNotMatch(
    sanitizeBranding({ selfLabel: "💚".repeat(50) })?.selfLabel ?? "",
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/,
  );
  assert.deepEqual(sanitizeBranding({ accent: "#6366f1" }), { accent: "#6366f1" });
  assert.equal(sanitizeBranding({ accent: "#abcde" }), undefined);
  assert.equal(sanitizeBranding({ accent: "#aabbccddee" }), undefined);
  assert.equal(sanitizeBranding({}), undefined);
  assert.equal(sanitizeBranding({ selfLabel: "  ", orgName: "{{}}" }), undefined);
});

test("sanitizeBranding accepts only https mark image urls that cannot break out of a CSS declaration", () => {
  assert.deepEqual(sanitizeBranding({ markUrl: "https://cdn.example.com/icon.png" }), {
    markUrl: "https://cdn.example.com/icon.png",
  });
  assert.equal(sanitizeBranding({ markUrl: "http://cdn.example.com/icon.png" }), undefined);
  assert.equal(sanitizeBranding({ markUrl: "javascript:alert(1)" }), undefined);
  assert.equal(sanitizeBranding({ markUrl: 'https://a/");background:url("evil' }), undefined);
  assert.equal(sanitizeBranding({ markUrl: "https://a/x;color:red" }), undefined);
  assert.equal(sanitizeBranding({ markUrl: "https://a/</style><script>alert(1)</script>" }), undefined);
  assert.equal(sanitizeBranding({ markUrl: "https://a/ b" }), undefined);
  assert.equal(sanitizeBranding({ markUrl: `https://a/${"x".repeat(500)}` }), undefined);
});

test("resolveBranding prefers the store per field and fills the rest from the default", async () => {
  const config = { getBrandingDurable: async () => ({ selfLabel: "storebot" }) };
  assert.deepEqual(await resolveBranding(config, ORG, { selfLabel: "envbot", orgName: "Env Org" }), {
    selfLabel: "storebot",
    orgName: "Env Org",
  });
  assert.deepEqual(await resolveBranding(undefined, ORG, { selfLabel: "envbot" }), { selfLabel: "envbot" });
  assert.deepEqual(await resolveBranding({ getBrandingDurable: async () => null }, ORG), {});
});

test("resolveBranding degrades to the default identity when the durable read fails", async () => {
  const config = {
    getBrandingDurable: async (): Promise<never> => {
      throw new Error("postgres hiccup");
    },
  };
  assert.deepEqual(await resolveBranding(config, ORG, { selfLabel: "envbot" }), { selfLabel: "envbot" });
  assert.deepEqual(await resolveBranding(config, ORG), {});
});

test("resolveBranding sanitizes stored values that predate write-side sanitization", async () => {
  const config = { getBrandingDurable: async () => ({ selfLabel: "{{legacy}}", orgName: "Acme <{Corp}>" }) };
  assert.deepEqual(await resolveBranding(config, ORG), { selfLabel: "legacy", orgName: "Acme Corp" });
});

test("branding validates imported theme colors and preserves the organization default", async () => {
  const palette = {
    name: "Night",
    source: "vscode",
    background: { r: 20, g: 24, b: 32 },
    foreground: { r: 240, g: 240, b: 240 },
    ansi: Array(16).fill(null),
  };
  const theme = { mode: "custom", palette };
  assert.deepEqual(sanitizeBranding({ theme })?.theme, theme);
  assert.equal(
    sanitizeBranding({ theme: { ...theme, palette: { ...palette, button: { r: "red;}", g: 0, b: 0 } } } }),
    undefined,
  );
  assert.equal(
    sanitizeBranding({
      theme: { ...theme, palette: { ...palette, syntax: { keyword: { r: Infinity, g: 0, b: 0 } } } },
    }),
    undefined,
  );
  assert.equal(sanitizeBranding({ theme: { mode: "custom" } }), undefined);
  assert.deepEqual(sanitizeBranding({ theme: { mode: "system", palette } })?.theme, { mode: "system" });
  const branding = sanitizeBranding({ theme });
  assert.deepEqual((await resolveBranding({ getBrandingDurable: async () => branding ?? null }, ORG)).theme, theme);
});

test("uploaded logos accept bounded PNG data and reject active image formats", () => {
  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk1kAAAAASUVORK5CYII=";
  assert.equal(sanitizeBranding({ markUrl: png })?.markUrl, png);
  for (const markUrl of [
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:text/html;base64,aGk=",
    "data:image/png;base64,iVBORw0KGgo" + "A".repeat(131072),
    png + '";color:red',
  ])
    assert.equal(sanitizeBranding({ markUrl }), undefined);
});
