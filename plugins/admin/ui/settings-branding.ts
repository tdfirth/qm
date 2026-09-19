import { pickerButton } from "./shared.ts";
import { saveFooter } from "./setting-controls.ts";
import { html, render } from "lit";
import { classMap } from "lit/directives/class-map.js";
import type { SettingsState } from "./settings.ts";
let config: any;
let catalog: any[] = [];
let loading: Promise<any[]> | null = null;
let themeError = "";
let query = "";
let choices: any[] = [];
let hover = -1;
let before: any;
let chosen = false;
let catalogStatus = "";
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const value = (e: Event) => (e.target as HTMLInputElement).value;
const dialog = () => document.getElementById("branding-theme-dialog") as HTMLDialogElement;
const fileClick = (id: string) => document.getElementById(id)?.click();
export function configureBranding(options: any) {
  config = options;
  dialog()?.replaceChildren();
}
function accent(s: SettingsState, color: string) {
  s.change("accent", color.trim());
  if (color && !/^#(?:[a-f0-9]{3}|[a-f0-9]{6})$/i.test(color.trim())) return;
  document.documentElement.style.setProperty("--brand-accent", color.trim() || "initial");
  applyAccent();
}
function preview(s: SettingsState, index: number) {
  if (!choices.length) return;
  hover = (index + choices.length) % choices.length;
  config.preview(choices[hover]);
  drawDialog(s);
  document.getElementById("branding-theme-option-" + hover)?.scrollIntoView({ block: "nearest" });
}
function choose(s: SettingsState) {
  if (!choices[hover]) return;
  s.change("theme", choices[hover]);
  chosen = true;
  dialog().close();
}
function drawDialog(s: SettingsState) {
  const palette = s.draft.theme?.palette;
  choices = [
    { mode: "light" },
    { mode: "dark" },
    { mode: "system" },
    ...catalog.map((palette) => ({ mode: "custom", palette })),
  ];
  if (palette && !catalog.some((p) => JSON.stringify(p) === JSON.stringify(palette)))
    choices.push({ mode: "custom", palette });
  choices = choices.filter((t) => (t.palette?.name || t.mode).toLowerCase().includes(query.toLowerCase()));
  render(
    html`<h2 id="branding-theme-title">Find your colors</h2>
      <input
        type="search"
        id="branding-theme-search"
        placeholder="Find a theme…"
        aria-label="Find a theme"
        aria-controls="branding-theme-options"
        aria-activedescendant=${hover >= 0 ? "branding-theme-option-" + hover : ""}
        .value=${query}
        @input=${(e: Event) => {
          query = value(e);
          hover = -1;
          drawDialog(s);
        }}
      />
      <p class="hint" id="branding-theme-catalog-status" role="status">${catalogStatus}</p>
      <div id="branding-theme-options" class="brand-theme-options" role="listbox" aria-label="Themes">
        ${
          choices.length
            ? choices.map(
                (theme, index) =>
                  html`<button
                    type="button"
                    role="option"
                    id=${"branding-theme-option-" + index}
                    aria-selected=${String(index === hover)}
                    @mouseenter=${() => preview(s, index)}
                    @focus=${() => preview(s, index)}
                    @click=${() => {
                      preview(s, index);
                      choose(s);
                    }}
                  >
                    <span class="brand-theme-dots" aria-hidden="true"
                      >${themeColors(theme).map((color) => html`<i style=${"background:" + color}></i>`)}</span
                    >${theme.palette?.name || title(theme.mode)}
                  </button>`,
              )
            : "No matching themes."
        }
      </div>
      <p class="hint">↑ ↓ preview · Enter choose · Esc cancel</p>
      <button type="button" id="branding-theme-cancel" @click=${() => dialog().close()}>Cancel</button>`,
    dialog(),
  );
}
async function openThemes(s: SettingsState) {
  before = config.currentPreview();
  chosen = false;
  query = "";
  hover = -1;
  drawDialog(s);
  dialog().onkeydown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      dialog().close();
      return;
    }
    if (
      ["ArrowDown", "ArrowUp", "Enter"].includes(event.key) &&
      (event.target as HTMLElement).id !== "branding-theme-cancel"
    ) {
      event.preventDefault();
      if (event.key === "Enter") choose(s);
      else preview(s, hover + (event.key === "ArrowDown" ? 1 : -1));
    }
  };
  dialog().onclose = () => {
    if (!chosen) config.preview(before);
  };
  dialog().showModal();
  document.getElementById("branding-theme-search")?.focus();
  if (!catalog.length) {
    catalogStatus = "Loading the iTerm2 theme collection…";
    drawDialog(s);
    try {
      loading ||= fetch(config.catalogUrl).then(async (response) => {
        if (!response.ok) throw new Error("Could not load themes. Close and reopen to retry.");
        const rows = await response.json();
        if (!Array.isArray(rows) || !rows.every(config.tools.isPalette))
          throw new Error("Could not read theme catalog.");
        return rows;
      });
      catalog = await loading;
    } catch (error) {
      loading = null;
      catalogStatus = error instanceof Error ? error.message : String(error);
      drawDialog(s);
      return;
    }
  }
  catalogStatus = catalog.length + " iTerm2 themes · search by name";
  if (dialog().open) drawDialog(s);
}
async function importTheme(s: SettingsState, e: Event) {
  const draft = s.draft;
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    if (file.size > 1024 * 1024) throw new Error("Choose a theme file smaller than 1 MB.");
    const theme = { mode: "custom", palette: config.tools.importTheme(file.name, await file.text()) };
    if (s.draft !== draft) return;
    s.change("theme", theme);
    config.preview(theme);
    themeError = "";
  } catch (error) {
    themeError = error instanceof Error ? error.message : "Could not read that theme.";
  }
  s.render();
}
async function importLogo(s: SettingsState, file?: File) {
  const draft = s.draft;
  if (!file) return;
  try {
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 5 * 1024 * 1024)
      throw new Error("Choose a PNG, JPEG, WebP or GIF smaller than 5 MB.");
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const image = canvas.toDataURL("image/png");
    if (image.length > 131072) throw new Error("This image is too detailed. Try a simpler logo.");
    if (s.draft !== draft) return;
    s.change("markUrl", image);
    themeError = "";
  } catch (error) {
    themeError = error instanceof Error ? error.message : "Could not read that image.";
  }
  s.render();
}

export function brandingCard(s: SettingsState) {
  return html`
    <section
      class=${classMap({ card: true, "sv-customize": true, "setting-row": true, hidden: !s.available, dirty: s.dirty })}
      id="card-branding"
    >
      <div class="head">
        <h2>Theme</h2>
        <p>Choose the organization’s default appearance. People can override it in their own Settings.</p>
        <p>
          Find more themes at
          <a href="https://iterm2colorschemes.com/" target="_blank" rel="noopener noreferrer">iTerm2 themes ↗</a>
          or
          <a href="https://vscodethemes.com/" target="_blank" rel="noopener noreferrer">VS Code themes ↗</a>.
        </p>
      </div>
      <div class="body brand-theme-controls">
        <div class="brand-theme-toolbar">
          ${pickerButton("branding-theme-open", s.draft.theme?.palette?.name || title(s.draft.theme?.mode || "system"), () => openThemes(s))}
        </div>
        <div class="brand-theme-import">
          <input
            type="file"
            id="branding-theme-file"
            @change=${(e: Event) => importTheme(s, e)}
            accept=".itermcolors,.plist,.json,.jsonc"
            hidden
          />
          <button type="button" id="branding-theme-import" @click=${() => fileClick("branding-theme-file")}>
            Import theme file
          </button>
        </div>
        <p class="hint">iTerm2 (.itermcolors) or VS Code (.json).</p>
        <span class="status" id="branding-theme-error" role="status">${themeError}</span>
      </div>
      <div class="head brand-setting-divider">
        <h2>Accent color</h2>
        <p>
          Colors buttons, selected options, focus rings, and the logo background. Preview changes here before applying.
        </p>
      </div>
      <div class="body brand-setting-divider">
        <div class="brand-accent-control">
          <input
            type="color"
            id="branding-accent-picker"
            aria-label="Choose accent color"
            .value=${/^#[a-f0-9]{6}$/i.test(s.draft.accent || "") ? s.draft.accent : "#4f46e5"}
            @input=${(e: Event) => accent(s, value(e))}
          />
          <input
            type="text"
            id="branding-accent"
            .value=${s.draft.accent || ""}
            @input=${(e: Event) => accent(s, value(e))}
            placeholder="Default"
            aria-label="Accent hex color"
          />
          <button type="button" id="branding-accent-reset" @click=${() => accent(s, "")}>Reset</button>
        </div>
      </div>
      <div class="head brand-setting-divider">
        <h2>Logo</h2>
        <p>Your organization’s logo in the web UI. Upload an image, drop it into the well, or use an image URL.</p>
      </div>
      <div class="body brand-setting-divider">
        <div
          class="brand-logo-well"
          id="branding-logo-well"
          @dragover=${(e: DragEvent) => e.preventDefault()}
          @drop=${(e: DragEvent) => {
            e.preventDefault();
            void importLogo(s, e.dataTransfer?.files[0]);
          }}
        >
          <img id="branding-logo-preview" src=${s.draft.markUrl || "./brand-mark.svg"} alt="Organization logo" />
          <div>
            <div class="brand-logo-actions">
              <button type="button" id="branding-logo-upload" @click=${() => fileClick("branding-logo-file")}>
                Choose image…
              </button>
              <button type="button" id="branding-logo-remove" @click=${() => s.change("markUrl", "")}>Remove</button>
            </div>
            <p class="hint">PNG, JPEG, WebP or GIF.</p>
          </div>
        </div>
        <input
          type="file"
          id="branding-logo-file"
          @change=${(e: Event) => {
            const input = e.target as HTMLInputElement;
            void importLogo(s, input.files?.[0]);
            input.value = "";
          }}
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
        />
        <label for="branding-mark-url">Image URL</label>
        <input
          type="url"
          id="branding-mark-url"
          .value=${s.draft.markUrl?.startsWith("data:") ? "" : s.draft.markUrl || ""}
          @input=${(e: Event) => s.change("markUrl", value(e).trim())}
          maxlength="500"
          placeholder="https://example.com/icon.png"
        />
      </div>
      ${saveFooter(s, "Apply appearance")}
    </section>
  `;
}

function themeColors(theme: any) {
  if (theme.palette) return Object.values(config.tools.themeTokens(theme.palette).vars).slice(0, 3);
  return theme.mode === "dark" ? ["#161b25", "#30394a", "#a4b9f5"] : ["#fff", "#e5e5e5", "#435d83"];
}

export function applyAccent() {
  const root = document.documentElement;
  for (const name of ["--cta", "--cta-hover", "--cta-foreground"]) root.style.removeProperty(name);
  const accent = getComputedStyle(root).getPropertyValue("--brand-accent").trim();
  if (!/^#(?:[a-f0-9]{3}|[a-f0-9]{6})$/i.test(accent)) return;
  const hex =
    accent.length === 4
      ? accent
          .slice(1)
          .split("")
          .map((c) => c + c)
          .join("")
      : accent.slice(1);
  const channels = [0, 2, 4].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  root.style.setProperty("--cta", accent);
  root.style.setProperty("--cta-hover", `color-mix(in srgb, ${accent} 88%, ${luminance > 0.179 ? "black" : "white"})`);
  root.style.setProperty("--cta-foreground", luminance > 0.179 ? "#000000" : "#ffffff");
}
