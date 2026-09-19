import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../src/shell.css", import.meta.url), "utf8");
const chat = readFileSync(new URL("../src/chat.ts", import.meta.url), "utf8");
const composer = readFileSync(new URL("../src/composer.ts", import.meta.url), "utf8");
const shared = readFileSync(new URL("../src/shared-session.ts", import.meta.url), "utf8");

test("only the collapsed pinned prompt is capped and overflow clips instead of nesting scrollbars", () => {
  const bubble =
    css.match(
      /\.message-stack\s+\.user-row:not\(:has\(~ \.user-row\)\):not\(\.pin-expanded\)\s+\.user-bubble\s+>\s+\.pin-content \{[^}]*\}/,
    )?.[0] ?? "";
  assert.match(bubble, /-webkit-line-clamp: 6;/);
  assert.match(bubble, /overflow: hidden;/);
  assert.doesNotMatch(css, /\.user-bubble > (?:markdown-block|\.slack-wire-text)\s*\{/);
  const base = css.match(/\n\.user-bubble \{[^}]*\}/)?.[0] ?? "";
  assert.doesNotMatch(base, /max-height|flex/);
});

test("the scroller is the size container the cap measures", () => {
  assert.match(css, /\n\.chat-scroll \{[^}]*container-type: size;/);
  assert.match(css, /\n\.readonly-chat \.custom-chat-shell \{[^}]*flex-direction: column;/);
  assert.match(css, /\n\.readonly-chat \.chat-scroll \{[^}]*flex: 1;/);
  assert.doesNotMatch(chat, /--chat-viewport/);
});

test("images a user attached render as passive images in the live chat", () => {
  const fn = chat.match(/function userAttachmentBadge\([\s\S]*?\n {2}\}/)?.[0] ?? "";
  assert.match(fn, /startsWith\("image\/"\)/);
  assert.match(fn, /a\.preview\?\.startsWith\("data:image\/"\)/);
  assert.match(fn, /<img class="user-image-attachment" src=\$\{src\} alt="Attached image" loading="lazy"/);
  assert.match(fn, /if \(browserRenderableImage\(a\.mimeType\) && src\)/);
  assert.match(fn, /return imageChip\(a\.fileName, a\.size, artifactHref \?\? localContentUrl\(a\)\);/);
  assert.doesNotMatch(fn, /const dataUrl|artifactHref \?\? dataUrl/);
  assert.doesNotMatch(fn, /chipBadge\(FileImage|tip\(|download|title=/);
});

test("local image previews are bounded before they reach an image element", () => {
  const preview = composer.match(/async function boundedImagePreview\([\s\S]*?\n {2}\}/)?.[0] ?? "";
  const staged = composer.match(/function stagedAttachment\([\s\S]*?\n {2}\}/)?.[0] ?? "";
  assert.match(composer, /const IMAGE_PREVIEW_EDGE = 512;/);
  assert.match(composer, /const IMAGE_PREVIEW_SOURCE_BYTES = 10_000_000;/);
  assert.match(composer, /const IMAGE_PREVIEW_BYTES = 1_000_000;/);
  assert.match(preview, /canvas\.width = Math\.max/);
  assert.match(preview, /canvas\.height = Math\.max/);
  assert.match(preview, /preview\.size > IMAGE_PREVIEW_BYTES/);
  assert.match(staged, /attachment\.preview\?\.startsWith\("data:image\/"\)/);
  assert.doesNotMatch(staged, /attachment\.content/);
});

test("images a user attached render as passive images on the share page", () => {
  const files = shared.match(/message\.attachments\.map\(\(file\) => \{[\s\S]*?\n\s*\}\)\}/)?.[0] ?? "";
  const userImage = files.match(/if \(message\.role === "user"[\s\S]*?\n\s*\}/)?.[0] ?? "";
  assert.match(userImage, /class="user-image-attachment"/);
  assert.match(userImage, /alt="Attached image"/);
  assert.doesNotMatch(userImage, /<a|chipBadge|file\.name|title=|download/);
  assert.match(files, /const inlineImage = browserRenderableImage\(file\.mimetype\);/);
  assert.match(files, /return chipBadge\([\s\S]*?inlineImage \? FileImage : File/);
});

test("both transcript renderers provide an accessible control and an observable inner body", () => {
  for (const source of [chat, shared]) {
    assert.match(source, /pin-content/);
    assert.match(source, /class="pin-toggle" type="button" hidden aria-expanded="false"/);
  }
  assert.match(shared, /viewport\.sync\(document\.querySelector<HTMLElement>\("\.chat-scroll"\)\)/);
  assert.match(css, /\.deleted-bubble > \.pin-content > :not\(\.revision-badge\) \{\s*text-decoration: line-through;/);
});
