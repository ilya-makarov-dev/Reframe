/**
 * Tweak panel HTML + CSS generators (T2 #26).
 *
 * Floating top-right panel injected into bundle exports when
 * `tweakable: true` and the brand DESIGN.md declares a `## Tweak
 * Surface` section. Pure-DOM markup + scoped CSS — no framework
 * dependency, runs anywhere a browser opens the .html.
 *
 * ─── Why a separate file from bundle.ts ─────────────────────
 *
 * bundle.ts is already 300+ lines covering font + image inlining +
 * pipeline orchestration. Panel HTML/CSS is a self-contained concern
 * with its own taste decisions (positioning, control styling, label
 * layout). Future Variant 2 schema-driven controls (dropdowns, toggles,
 * derived values) extend THIS file, not bundle.ts.
 *
 * ─── Determinism ────────────────────────────────────────────
 *
 * Same TweakDef[] + same initialValues → byte-identical HTML + CSS
 * output. Defs iterate in array order (no sort), values map by tokenPath.
 * Bundle export deterministic guarantee survives.
 */

import type { TweakDef } from '../design-system/types.js';

/** Convert tokenPath like 'color/primary' to '--reframe-color-primary'. */
export function varNameForToken(path: string): string {
  return '--reframe-' + path.replace(/\//g, '-');
}

/** Escape a string for safe inclusion in an HTML attribute value. */
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Resolved initial values per tweak def — keyed by tokenPath. Caller
 * (bundle.ts) builds this map from the DesignSystem before invoking
 * panel generation. Values are strings: hex for color, numeric string
 * for range (without unit — unit is appended at runtime).
 */
export type InitialValues = Record<string, string>;

/**
 * Build the panel HTML markup. Returns a single self-contained
 * <div id="reframe-tweak-surface"> block ready to append before </body>.
 */
export function generatePanelHtml(defs: TweakDef[], initial: InitialValues): string {
  const items: string[] = [];
  for (const def of defs) {
    const initialValue = initial[def.tokenPath] ?? '';
    if (def.type === 'color') {
      items.push(
        `<label>` +
          `<span>${escapeAttr(def.label)}</span>` +
          `<input type="color" data-token="${escapeAttr(def.tokenPath)}" value="${escapeAttr(initialValue)}">` +
        `</label>`,
      );
    } else if (def.type === 'range') {
      const min = def.min ?? 0;
      const max = def.max ?? 1;
      const step = def.step ?? 1;
      const unit = def.unit ?? '';
      // Output element shows the live value next to the label.
      items.push(
        `<label>` +
          `<span>${escapeAttr(def.label)} <output>${escapeAttr(initialValue)}</output>${escapeAttr(unit)}</span>` +
          `<input type="range" data-token="${escapeAttr(def.tokenPath)}" data-unit="${escapeAttr(unit)}" min="${min}" max="${max}" step="${step}" value="${escapeAttr(initialValue)}">` +
        `</label>`,
      );
    }
  }
  return (
    `<div id="reframe-tweak-surface" class="reframe-tweak-collapsed">\n` +
    `  <button class="reframe-tweak-toggle" aria-label="Toggle tweak panel" title="Customize">⚙</button>\n` +
    `  <div class="reframe-tweak-controls">\n` +
    `    <h3>Customize</h3>\n` +
    `    ${items.join('\n    ')}\n` +
    `    <button class="reframe-tweak-reset" type="button">Reset to default</button>\n` +
    `  </div>\n` +
    `</div>`
  );
}

/**
 * Build the panel CSS — neutral functional styling deliberately NOT
 * brand-themed. Panel must read as a "tweak control overlay", not as
 * part of the design (recursive theming would be confusing — the panel
 * is for adjusting brand tokens, including its own color if it used
 * them). Future signal may want panel-as-brand-element.
 */
export function generatePanelCss(): string {
  return `
#reframe-tweak-surface {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 99999;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 13px;
  color: #111;
}
#reframe-tweak-surface.reframe-tweak-collapsed .reframe-tweak-controls {
  display: none;
}
#reframe-tweak-surface .reframe-tweak-toggle {
  display: block;
  width: 40px;
  height: 40px;
  border-radius: 20px;
  background: rgba(20, 20, 30, 0.85);
  color: #fff;
  border: none;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  margin-left: auto;
}
#reframe-tweak-surface .reframe-tweak-toggle:hover {
  background: rgba(20, 20, 30, 1);
}
#reframe-tweak-surface .reframe-tweak-controls {
  background: #fff;
  padding: 16px 18px;
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
  min-width: 240px;
  margin-top: 8px;
}
#reframe-tweak-surface .reframe-tweak-controls h3 {
  margin: 0 0 12px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #666;
}
#reframe-tweak-surface .reframe-tweak-controls label {
  display: block;
  margin: 12px 0;
}
#reframe-tweak-surface .reframe-tweak-controls label span {
  display: block;
  margin-bottom: 6px;
  font-weight: 500;
}
#reframe-tweak-surface .reframe-tweak-controls input {
  width: 100%;
  box-sizing: border-box;
}
#reframe-tweak-surface .reframe-tweak-controls input[type="color"] {
  height: 32px;
  padding: 0;
  border: 1px solid #ddd;
  border-radius: 6px;
  cursor: pointer;
}
#reframe-tweak-surface .reframe-tweak-controls input[type="range"] {
  margin: 4px 0;
}
#reframe-tweak-surface .reframe-tweak-reset {
  margin-top: 12px;
  padding: 8px 14px;
  background: #f4f4f5;
  border: 1px solid #e4e4e7;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  color: #444;
  width: 100%;
}
#reframe-tweak-surface .reframe-tweak-reset:hover {
  background: #ececef;
}
`;
}

/**
 * Generate the `:root { ... }` CSS block carrying initial values for
 * all tweakable tokens. This is what the runtime mutates via
 * setProperty('--reframe-...', newValue). When localStorage is empty,
 * the scene renders these defaults.
 */
export function generateRootVarsCss(defs: TweakDef[], initial: InitialValues): string {
  const lines: string[] = [];
  for (const def of defs) {
    const value = initial[def.tokenPath];
    if (value === undefined) continue;
    const varName = varNameForToken(def.tokenPath);
    const unit = def.type === 'range' ? (def.unit ?? '') : '';
    lines.push(`  ${varName}: ${value}${unit};`);
  }
  if (lines.length === 0) return '';
  return `:root {\n${lines.join('\n')}\n}\n`;
}
