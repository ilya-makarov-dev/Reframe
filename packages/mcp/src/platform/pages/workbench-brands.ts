/**
 * Brand Workbench page — Phase 3 Brief 3a Pin #1.
 *
 * /platform/workbench/brands — first canonical "domain workbench" surface.
 * Pattern proven here is what Phase 3.5 skill-bus retroactively routes
 * through; subsequent workbenches (typography, motion, components,
 * tokens) inherit this shape.
 *
 * Layout:
 *   ┌─ catalog mode (no slug in querystring) ─────────────────┐
 *   │  search + grid of brand cards                            │
 *   └──────────────────────────────────────────────────────────┘
 *   ┌─ workbench mode (?slug=<brand>) ─────────────────────────┐
 *   │ ← Back  | brand detail (palette/typography/...)          │
 *   │         | live preview iframe + scenes-using strip       │
 *   │         | apply-to-active-scene button                   │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Render is server-side; interaction (apply, scene-switch) lives in the
 * platform-ui.js bundle's bindBrandWorkbench() binder.
 */

import type { BrandCatalogEntry, SceneRef } from '../api/brand-workbench-service.js';
import type { DesignSystem } from '../../../../core/src/design-system/types.js';

export interface WorkbenchBrandsData {
  /** Workbench mode when set — show brand detail + preview. Catalog mode otherwise. */
  selectedSlug?: string;
  /** Catalog entries — always populated, even in workbench mode (Back navigates to grid). */
  catalog: BrandCatalogEntry[];
  /** Parsed DS for the selected brand (workbench mode only). */
  selectedDS?: DesignSystem;
  /** Raw DESIGN.md text for the selected brand. The palette renderer
   *  walks this directly so it picks up roles the parser's heuristic
   *  passes skipped (colon-inside-bold lines like `**Background:**`
   *  the workbench still wants editable). */
  selectedRawMd?: string;
  /** Scenes pinned to the selected brand (workbench mode only). */
  scenesUsing?: SceneRef[];
  /** Active scene id, used for the preview iframe + Apply button context. */
  activeSceneId?: string;
  /** Project default brand slug — for the "active in N" badge logic. */
  projectDefault?: string | null;
  /** Phase 3 Brief 3d Pin #1 — discovered brand mark variants for the
   *  selected brand (workbench mode only). Empty array when the brand
   *  has no marks/ directory. */
  markVariants?: string[];
  /** Default variant slug — surfaced in the Brand Mark section + catalog
   *  card logo display. Null when the brand has no marks. */
  defaultMarkVariant?: string | null;
  /** Discovered marks for catalog cards keyed by brand slug. Lets the
   *  catalog grid render logos without an N+1 fetch per card. */
  catalogMarks?: Record<string, { defaultVariant: string | null }>;
}

function brandInitials(name: string): string {
  if (!name) return '?';
  const words = name.split(/[\s—\-/]+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderCatalogCard(entry: BrandCatalogEntry, markInfo?: { defaultVariant: string | null }): string {
  const swatches = entry.swatches.slice(0, 6).map((hex) =>
    `<span class="bw-swatch" style="background:${escape(hex)}" title="${escape(hex)}"></span>`
  ).join('');
  // Phase 3 Brief 3d Pin #3 — brand logo on card. Falls back to font
  // sample (3a behavior) when no marks/ exist; further falls back to
  // initials when the brand has neither marks nor a parsed primary font.
  let head: string;
  if (markInfo?.defaultVariant) {
    head = `<img class="bw-card-logo" src="/platform/api/brand/${encodeURIComponent(entry.slug)}/mark/${encodeURIComponent(markInfo.defaultVariant)}" alt="${escape(entry.name)} logo" loading="lazy">`;
  } else if (entry.primaryFont) {
    head = `<div class="bw-card-font" style="font-family:'${escape(entry.primaryFont)}',sans-serif">Aa</div>`;
  } else {
    head = `<div class="bw-card-font bw-card-font--missing" aria-hidden="true">${escape(brandInitials(entry.name))}</div>`;
  }
  const usageBadge = entry.scenesUsing > 0
    ? `<span class="bw-card-usage">active in ${entry.scenesUsing} scene${entry.scenesUsing === 1 ? '' : 's'}</span>`
    : entry.isProjectDefault
      ? '<span class="bw-card-usage bw-card-usage--default">project default</span>'
      : '';
  const directionTag = entry.isDirection
    ? '<span class="bw-card-tag">direction</span>'
    : '';
  return `<a class="bw-card" href="/platform/workbench/brands?slug=${encodeURIComponent(entry.slug)}" data-brand-slug="${escape(entry.slug)}">
    <div class="bw-card-head">
      ${head}
      ${directionTag}
    </div>
    <div class="bw-card-swatches">${swatches}</div>
    <div class="bw-card-name">${escape(entry.name)}</div>
    ${usageBadge}
  </a>`;
}

function renderCatalogMode(data: WorkbenchBrandsData): string {
  const cards = data.catalog.map((e) =>
    renderCatalogCard(e, data.catalogMarks?.[e.slug])
  ).join('');
  return `<header class="bw-page-head">
    <h1 class="bw-title">Brand workbench</h1>
    <p class="bw-lead">Catalog of ${data.catalog.length} brand${data.catalog.length === 1 ? '' : 's'}. Click any card to open its workbench — palette, typography, vocab, components, plus live preview against the active scene.</p>
  </header>
  <div class="bw-toolbar">
    <input type="search" class="bw-search" placeholder="Filter brands…" data-bw-filter aria-label="Filter brands">
    <a class="bw-secondary" href="/platform">← Back to dashboard</a>
  </div>
  <div class="bw-catalog-grid" data-bw-grid>${cards}</div>`;
}

function renderPaletteSection(ds: DesignSystem, rawMd?: string): string {
  // Walk the raw text bullet anchors first when we have it — this surfaces
  // every role the designer actually declared in DESIGN.md (including the
  // colon-inside-bold lines the parser's first-pass regex skips). Falls
  // back to the parsed DS shape for synthesised fixtures with no raw text.
  const rows: Array<{ name: string; hex: string; group: string }> = [];
  const seenRoles = new Set<string>();

  if (rawMd) {
    const bulletRe = /^\s*[-*]\s*\*\*([^*]+?)\*\*[^`]*`(#[0-9a-fA-F]{3,8})`/gmi;
    let m: RegExpExecArray | null;
    // Limit to the first `## Color Palette ...` section so we don't
    // sweep up typography stack lines that share the bullet shape.
    const paletteMatch = rawMd.match(/## (?:Color Palette|Colors|Color)[\s\S]*?(?=\n## |$)/i);
    const scope = paletteMatch ? paletteMatch[0] : '';
    while ((m = bulletRe.exec(scope)) !== null) {
      const role = m[1].trim().replace(/:$/, '').trim().toLowerCase().replace(/\s+/g, '-');
      if (seenRoles.has(role)) continue;
      seenRoles.add(role);
      rows.push({ name: role, hex: m[2].toLowerCase(), group: 'roles' });
    }
  }

  // If raw-text walk yielded nothing, fall to the parsed DS heuristic.
  if (rows.length === 0) {
    const colors = ds.colors as any;
    const push = (group: string, name: string, val: any) => {
      if (typeof val !== 'string') return;
      const hex = val.toLowerCase().trim();
      if (!/^#[0-9a-f]{3,8}$/.test(hex)) return;
      if (seenRoles.has(name)) return;
      seenRoles.add(name);
      rows.push({ name, hex, group });
    };
    if (colors) {
      push('roles', 'primary', colors.primary);
      push('roles', 'accent', colors.accent);
      push('roles', 'background', colors.background);
      push('roles', 'surface', colors.surface);
      push('roles', 'text', colors.text);
      push('roles', 'muted', colors.muted);
      if (Array.isArray(colors.palette)) {
        colors.palette.forEach((p: any, i: number) => {
          if (typeof p === 'string') push('palette', `palette ${i + 1}`, p);
          else if (p && typeof p === 'object') push('palette', p.name || `palette ${i + 1}`, p.hex);
        });
      }
      if (colors.scale && typeof colors.scale === 'object') {
        for (const [k, v] of Object.entries(colors.scale)) {
          push('scale', k, typeof v === 'string' ? v : (v as any)?.hex);
        }
      }
    }
  }
  // Honest framing per Pin #7 — empty palette is a real state for some
  // catalog brands (Brutalist / Editorial). Surface a CTA inline so the
  // designer can seed the palette without leaving the workbench.
  if (rows.length === 0) {
    return `<div class="bw-section-empty bw-empty-with-action">
      <p>No palette tokens declared yet.</p>
      <button class="bw-btn bw-btn--primary" data-bw-add-token>+ Add first token</button>
    </div>`;
  }
  const html = rows.map(r =>
    `<div class="bw-token-row" data-token-role="${escape(r.name)}">
      <input type="color" class="bw-token-color-input" value="${escape(r.hex)}" data-bw-token-color data-bw-token-role="${escape(r.name)}" aria-label="Edit ${escape(r.name)}" />
      <span class="bw-token-name">${escape(r.name)}</span>
      <span class="bw-token-hex" data-bw-token-hex>${escape(r.hex)}</span>
      <button class="bw-token-edit" data-bw-token-trigger="${escape(r.name)}" title="Open color picker">edit</button>
    </div>`
  ).join('');
  return `<div class="bw-token-list" data-bw-token-list>${html}
    <div class="bw-token-add-row">
      <button class="bw-btn bw-btn--ghost" data-bw-add-token>+ Add token</button>
    </div>
  </div>`;
}

function renderTypographySection(ds: DesignSystem): string {
  const t = ds.typography as any;
  if (!t) {
    return `<div class="bw-section-empty bw-empty-with-action">
      <p>No typography declared yet.</p>
      <button class="bw-btn bw-btn--primary" data-bw-add-typo>+ Set fonts</button>
    </div>`;
  }
  const primary = t.primaryFont || '';
  const secondary = t.secondaryFont || '';
  // Editable inputs — blur or Enter commits via /workbench/edit-typography.
  return `<div class="bw-typo" data-bw-typo>
    <div class="bw-typo-row">
      <span class="bw-typo-label">Display</span>
      <input class="bw-typo-input" data-bw-typo-field="primaryFont" type="text" value="${escape(primary)}" placeholder="'Inter', sans-serif" aria-label="Display font stack" />
    </div>
    <div class="bw-typo-row">
      <span class="bw-typo-label">Body</span>
      <input class="bw-typo-input" data-bw-typo-field="secondaryFont" type="text" value="${escape(secondary)}" placeholder="'Inter', sans-serif" aria-label="Body font stack" />
    </div>
    <div class="bw-typo-row">
      <span class="bw-typo-label">Display preview</span>
      <span class="bw-typo-sample" data-bw-typo-preview="primaryFont" style="font-family:${primary ? `'${escape(primary)}'` : 'inherit'},sans-serif">${escape(primary || '— set font above —')}</span>
    </div>
  </div>`;
}

function renderVocabSection(ds: DesignSystem): string {
  const vocab = (ds as any).vocabulary;
  const powerWords: string[] = (vocab?.powerWords ?? []) as string[];
  const industryTerms: string[] = (vocab?.industryTerms ?? []) as string[];
  const style = vocab?.style ?? { weight: 600, color: 'accent', decoration: 'none' };

  // Editable pills — clicking the × removes (POSTs new array minus the
  // pill); the trailing input + button adds a term to the relevant list.
  const renderPills = (words: string[], list: 'power' | 'industry'): string => words.map((w) =>
    `<span class="bw-tag bw-tag--editable${list === 'industry' ? ' bw-tag--muted' : ''}" data-bw-vocab-pill data-bw-vocab-list="${list}" data-bw-vocab-word="${escape(w)}">${escape(w)} <button class="bw-tag-x" data-bw-vocab-remove aria-label="Remove ${escape(w)}">×</button></span>`
  ).join('');

  return `<div class="bw-vocab" data-bw-vocab>
    <div class="bw-vocab-row">
      <span class="bw-vocab-label">Power words</span>
      <div class="bw-tag-list" data-bw-vocab-tags="power">
        ${renderPills(powerWords, 'power')}
        <span class="bw-vocab-add">
          <input class="bw-vocab-add-input" type="text" placeholder="+ add" data-bw-vocab-add-input="power" maxlength="40" aria-label="Add power word">
        </span>
      </div>
    </div>
    <div class="bw-vocab-row">
      <span class="bw-vocab-label">Industry terms</span>
      <div class="bw-tag-list" data-bw-vocab-tags="industry">
        ${renderPills(industryTerms, 'industry')}
        <span class="bw-vocab-add">
          <input class="bw-vocab-add-input" type="text" placeholder="+ add" data-bw-vocab-add-input="industry" maxlength="40" aria-label="Add industry term">
        </span>
      </div>
    </div>
    <div class="bw-vocab-row">
      <span class="bw-vocab-label">Style</span>
      <div class="bw-vocab-style-row">
        <label class="bw-vocab-style-field">
          <span>Weight</span>
          <select data-bw-vocab-style="weight">
            ${[300, 400, 500, 600, 700, 800].map(w =>
              `<option value="${w}"${w === Number(style.weight) ? ' selected' : ''}>${w}</option>`
            ).join('')}
          </select>
        </label>
        <label class="bw-vocab-style-field">
          <span>Color</span>
          <select data-bw-vocab-style="color">
            ${['accent', 'text-high', 'text-low'].map(c =>
              `<option value="${c}"${c === style.color ? ' selected' : ''}>${c}</option>`
            ).join('')}
          </select>
        </label>
        <label class="bw-vocab-style-field">
          <span>Decoration</span>
          <select data-bw-vocab-style="decoration">
            ${['none', 'underline', 'highlight'].map(d =>
              `<option value="${d}"${d === style.decoration ? ' selected' : ''}>${d}</option>`
            ).join('')}
          </select>
        </label>
      </div>
    </div>
  </div>`;
}

function renderMarkSection(slug: string, variants: string[], defaultVariant: string | null): string {
  // Phase 3 Brief 3d Pin #2 — Brand Mark section. Drag-drop SVG zone +
  // discovered variants strip + selected-variant preview. Drag handler
  // POSTs to /api/brand/<slug>/mark/<variant> with multipart body.
  const stripHtml = variants.length === 0
    ? '<div class="bw-mark-empty">No brand marks uploaded yet.</div>'
    : `<ul class="bw-mark-strip" data-bw-mark-strip>${variants.map((v) =>
        `<li><button class="bw-mark-chip${v === defaultVariant ? ' active' : ''}" data-bw-mark-variant="${escape(v)}">${escape(v)}${v === defaultVariant ? ' <span class="bw-mark-default">★</span>' : ''}</button></li>`
      ).join('')}</ul>`;

  const previewVariant = defaultVariant || variants[0] || '';
  const previewSrc = previewVariant
    ? `/platform/api/brand/${encodeURIComponent(slug)}/mark/${encodeURIComponent(previewVariant)}`
    : '';

  return `<div class="bw-mark-block" data-bw-mark-block data-bw-slug="${escape(slug)}">
    ${stripHtml}
    <div class="bw-mark-preview" data-bw-mark-preview>
      ${previewSrc
        ? `<img class="bw-mark-image" data-bw-mark-image src="${escape(previewSrc)}" alt="${escape(previewVariant)}" loading="lazy">`
        : '<div class="bw-mark-preview-empty" aria-hidden="true">—</div>'}
    </div>
    <label class="bw-mark-drop" data-bw-mark-drop>
      <input type="file" accept="image/svg+xml,.svg" data-bw-mark-file class="bw-mark-file-input">
      <span class="bw-mark-drop-text">Drag SVG here, or <strong>click to browse</strong></span>
      <span class="bw-mark-drop-hint">Variant name = filename stem · ≤ 200 KB</span>
    </label>
    <div class="bw-mark-status" data-bw-mark-status></div>
  </div>`;
}

function renderRemixModal(slug: string): string {
  // Hidden by default — toggled visible by client binder when designer
  // clicks Remix. Form posts to /api/workbench/clone-brand.
  const suggested = `${slug}-personal`;
  return `<dialog class="bw-remix-modal" data-bw-remix-modal>
    <form method="dialog" class="bw-remix-form" data-bw-remix-form data-bw-source-slug="${escape(slug)}">
      <header class="bw-remix-head">
        <h2 class="bw-remix-title">Remix ${escape(slug)}</h2>
        <p class="bw-remix-lead">Creates a new brand catalog entry that inherits this brand's DESIGN.md + marks. Edits to the new brand don't touch the source.</p>
      </header>
      <label class="bw-remix-field">
        <span>New slug</span>
        <input type="text" data-bw-remix-input value="${escape(suggested)}" pattern="^[a-z][a-z0-9\-]*$" required autocomplete="off" spellcheck="false">
        <span class="bw-remix-hint">lowercase + dash only · must start with a letter</span>
      </label>
      <label class="bw-remix-checkbox">
        <input type="checkbox" data-bw-remix-copy-marks checked>
        <span>Copy brand marks (logos)</span>
      </label>
      <div class="bw-remix-error" data-bw-remix-error hidden></div>
      <footer class="bw-remix-foot">
        <button type="button" class="bw-btn" data-bw-remix-cancel>Cancel</button>
        <button type="submit" class="bw-btn bw-btn--primary" data-bw-remix-submit>Remix</button>
      </footer>
    </form>
  </dialog>`;
}

function renderWorkbenchMode(data: WorkbenchBrandsData): string {
  const slug = data.selectedSlug!;
  const entry = data.catalog.find(e => e.slug === slug);
  const ds = data.selectedDS;
  const name = entry?.name || slug;
  const scenesUsing = data.scenesUsing ?? [];
  const previewSceneId = data.activeSceneId || (scenesUsing[0]?.id ?? '');
  const previewSrc = previewSceneId
    ? `/api/render/${encodeURIComponent(previewSceneId)}?format=html&brand=${encodeURIComponent(slug)}`
    : '';

  // Apply dropdown — virtualSlug routing per executor gotcha #1: distinguish
  // "set as project default" (this virtual project) from "set as global default"
  // (the manifest-level fallback for new projects). Workbench surfaces both
  // explicitly so designers don't accidentally leak a brand across siblings.
  const applyBtn = `<div class="bw-apply" data-bw-apply data-bw-slug="${escape(slug)}" data-bw-active-scene="${escape(previewSceneId)}">
    <button class="bw-btn bw-btn--primary" data-bw-apply-action="scene"${previewSceneId ? '' : ' disabled'}>Apply to active scene</button>
    <details class="bw-apply-more">
      <summary class="bw-btn">More ▾</summary>
      <div class="bw-apply-menu">
        <button class="bw-menu-item" data-bw-apply-action="project">Set as project default</button>
        <button class="bw-menu-item" data-bw-apply-action="global">Set as global default</button>
      </div>
    </details>
  </div>`;

  const sceneStrip = scenesUsing.length === 0
    ? '<div class="bw-scenes-empty">No scenes using this brand yet.</div>'
    : `<ul class="bw-scenes-strip" data-bw-scenes>${scenesUsing.map(s =>
        `<li><button class="bw-scene-chip${s.id === previewSceneId ? ' active' : ''}" data-bw-scene-id="${escape(s.id)}">${escape(s.name || s.slug)}</button></li>`
      ).join('')}</ul>`;

  const previewIframe = previewSrc
    ? `<iframe class="bw-preview-frame" data-bw-preview src="${escape(previewSrc)}" title="Live preview" sandbox="allow-same-origin allow-scripts" loading="lazy"></iframe>`
    : '<div class="bw-preview-empty">No active scene to preview. Open a scene to see brand applied.</div>';

  return `<header class="bw-workbench-head">
    <a class="bw-back" href="/platform/workbench/brands">← Back to catalog</a>
    <h1 class="bw-title">${escape(name)}</h1>
    <div class="bw-head-meta">
      <span class="bw-slug-tag">${escape(slug)}</span>
      ${entry?.isDirection ? '<span class="bw-card-tag">direction</span>' : ''}
      ${entry?.scenesUsing ? `<span class="bw-meta-pill">active in ${entry.scenesUsing} scene${entry.scenesUsing === 1 ? '' : 's'}</span>` : ''}
    </div>
    <div class="bw-head-actions">
      <label class="bw-follow-toggle" title="When on, the workbench pivots to the brand of whichever scene the designer focuses next">
        <input type="checkbox" data-bw-follow-scene>
        <span>Follow active scene</span>
      </label>
      ${applyBtn}
      <button class="bw-btn" data-bw-remix data-bw-source-slug="${escape(slug)}" title="Clone this brand to a new slug — keeps source unchanged">Remix</button>
    </div>
  </header>
  <div class="bw-workbench-body" data-bw-body data-bw-slug="${escape(slug)}">
    <section class="bw-detail">
      <details class="bw-section" open>
        <summary class="bw-section-head">Palette</summary>
        ${ds ? renderPaletteSection(ds, data.selectedRawMd) : '<div class="bw-section-empty">DESIGN.md missing or failed to parse.</div>'}
      </details>
      <details class="bw-section" open>
        <summary class="bw-section-head">Typography</summary>
        ${ds ? renderTypographySection(ds) : ''}
      </details>
      <details class="bw-section">
        <summary class="bw-section-head">Vocab</summary>
        ${ds ? renderVocabSection(ds) : ''}
      </details>
      <details class="bw-section" data-bw-mark-section>
        <summary class="bw-section-head">Brand Mark</summary>
        ${renderMarkSection(slug, data.markVariants ?? [], data.defaultMarkVariant ?? null)}
      </details>
      <details class="bw-section">
        <summary class="bw-section-head">Components <span class="bw-section-meta">read-only</span></summary>
        <div class="bw-section-empty">Component spec viewer ships in Phase 3c.</div>
      </details>
      <details class="bw-section" open>
        <summary class="bw-section-head">Skill actions</summary>
        <div class="bw-skills" data-bw-skills data-bw-slug="${escape(slug)}">
          <button class="bw-skill" data-bw-skill="reframe-brand" data-bw-skill-action="vocalise" data-bw-skill-context-kind="brand-load" title="Generate brand voice signature">/vocalise</button>
          <button class="bw-skill" data-bw-skill="reframe-critic" data-bw-skill-action="verify-fidelity" data-bw-skill-context-kind="brand-edit" title="Audit brand fidelity post-edit">/verify-fidelity</button>
          <button class="bw-skill" data-bw-skill="reframe-brand" data-bw-skill-action="extract" data-bw-skill-context-kind="brand-extract" title="Extract brand spec from a URL">/extract from URL</button>
        </div>
        <div class="bw-skill-log" data-bw-skill-log>
          <span class="bw-skill-log-label">Recent skill activity</span>
          <div class="bw-skill-log-entries" data-bw-skill-log-entries></div>
        </div>
      </details>
    </section>
    <section class="bw-preview">
      <div class="bw-preview-shell">${previewIframe}</div>
      <div class="bw-preview-foot">
        <span class="bw-preview-label">Scenes using this brand</span>
        ${sceneStrip}
      </div>
    </section>
  </div>
  ${renderRemixModal(slug)}`;
}

export function renderWorkbenchBrandsPage(data: WorkbenchBrandsData): string {
  const main = data.selectedSlug
    ? renderWorkbenchMode(data)
    : renderCatalogMode(data);

  // Self-contained <html> wrapper. Pulls platform-ui.css for layout styles
  // + platform-ui.js for the binders (bindBrandWorkbench wires Apply +
  // scene-switch + scoped SSE re-render).
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>reframe · brand workbench</title>
  <link rel="dns-prefetch" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,400&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/platform/style.css?v=${Date.now()}">
  <script src="/platform/theme-init.js?v=${Date.now()}"></script>
</head>
<body class="bw-page" data-page="workbench-brands"${data.selectedSlug ? ` data-bw-slug="${escape(data.selectedSlug)}"` : ''}${data.activeSceneId ? ` data-active-scene-id="${escape(data.activeSceneId)}"` : ''}>
  <main class="bw-main">${main}</main>
  <script src="/platform/app.js?v=${Date.now()}"></script>
</body>
</html>`;
}
