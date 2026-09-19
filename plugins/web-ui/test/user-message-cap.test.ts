import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../src/shell.css", import.meta.url), "utf8");
const chat = readFileSync(new URL("../src/chat.ts", import.meta.url), "utf8");
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
  assert.match(fn, /<img class="user-image-attachment" src=\$\{src\} alt="" loading="lazy"/);
  assert.doesNotMatch(fn, /chipBadge\(FileImage|tip\(|download|title=/);
});

test("images a user attached render as passive images on the share page", () => {
  const files = shared.match(/message\.attachments\.map\(\(file\) => \{[\s\S]*?\n\s*\}\)\}/)?.[0] ?? "";
  const userImage = files.match(/if \(message\.role === "user"[\s\S]*?\n\s*\}/)?.[0] ?? "";
  assert.match(userImage, /class="user-image-attachment"/);
  assert.match(userImage, /alt=""/);
  assert.doesNotMatch(userImage, /<a|chipBadge|file\.name|title=|download/);
});

test("both transcript renderers provide an accessible control and an observable inner body", () => {
  for (const source of [chat, shared]) {
    assert.match(source, /pin-content/);
    assert.match(source, /class="pin-toggle" type="button" hidden aria-expanded="false"/);
  }
  assert.match(shared, /viewport\.sync\(document\.querySelector<HTMLElement>\("\.chat-scroll"\)\)/);
  assert.match(css, /\.deleted-bubble > \.pin-content > :not\(\.revision-badge\) \{\s*text-decoration: line-through;/);
});
