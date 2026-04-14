/**
 * Platform — Scene page (/platform/scene/:slug).
 *
 * ONE subject per screen. The viewport frame is the hero — a single
 * centered viewport on warm canvas, with the museum-mount treatment.
 * Tablet and mobile are one click away via the switcher above the
 * frame, never simultaneous.
 *
 * Right panel holds 4 tabs (Sections / Design / Rebrand / Vary) that
 * act on the current scene. History and Export live in the top header
 * as dropdowns so the right panel stays focused on scene-scoped edits.
 *
 * No tool ribbon. The 8 tools become contextual hover-chips on selected
 * elements (phase 2). For now, the click-capture overlay is preserved
 * so the existing JS state machine continues to function via the "/"
 * key tool palette.
 */

import {
  renderShell,
  renderSidebar,
  renderCanvasTools,
  type SidebarSceneItem,
  type SidebarComponentItem,
  type SidebarMacroItem,
} from '../layout.js';

interface SceneData {
  slug: string;
  sessionId: string;
  name: string;
  width: number;
  height: number;
  sidebarScenes: SidebarSceneItem[];
  sidebarComponents: SidebarComponentItem[];
  sidebarMacros: SidebarMacroItem[];
  intents: any[];
  draftIntent: any | null;
  brands: string[];
  activeBrand?: string;
  auditScore: number;
  totalOps: number;
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Shared right-panel builder. The scene page and the project canvas
 * both show the same Sections / Design / Rebrand / Vary tab stack —
 * this helper keeps the markup in one place so both routes stay
 * synchronized when tabs are added or removed.
 */
export function renderScenePageRightPanel(data: Pick<SceneData, 'brands' | 'activeBrand'>): string {
  const threadPanelHtml = `<div class="thread-panel hidden" data-thread-panel>
    <div class="thread-panel-head">
      <div class="close-row">
        <button class="close-btn" data-action="close-thread">\u2190 Back</button>
      </div>
      <div class="title" data-field="title">Thread</div>
      <div class="meta" data-field="meta"></div>
    </div>
    <div class="thread-panel-body" data-field="body"></div>
    <div class="thread-panel-actions" data-field="actions"></div>
  </div>`;
  const brandsOptionsHtml = (data.brands || []).map(b => {
    const active = b === data.activeBrand ? ' selected' : '';
    return `<option value="${escape(b)}"${active}>${escape(b)}</option>`;
  }).join('');
  const rebrandPanelHtml = `
    <div data-panel="rebrand" style="display:none;flex:1;flex-direction:column;min-height:0;overflow-y:auto;padding:16px;gap:16px">
      <div>
        <div class="t-caption" style="color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.08em">Brand</div>
        <select data-rebrand-select style="width:100%;padding:8px 12px;background:var(--surface);color:var(--text-base);border:1px solid var(--border);border-radius:6px;font-size:14px">
          ${brandsOptionsHtml || '<option value="">No brands registered</option>'}
        </select>
        <div class="t-caption" data-rebrand-status style="color:var(--text-muted);margin-top:8px;min-height:16px"></div>
      </div>
      <button data-rebrand-apply class="btn-primary" style="padding:10px 16px;background:var(--accent);color:var(--on-accent);border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer">Apply brand</button>
      <div style="border-top:1px solid var(--border);padding-top:16px">
        <div class="t-caption" style="color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.08em">Mode</div>
        <div style="display:flex;gap:8px">
          <button data-mode-switch="light" class="btn-mode" style="flex:1;padding:8px;background:var(--surface);color:var(--text-base);border:1px solid var(--border);border-radius:6px;cursor:pointer">Light</button>
          <button data-mode-switch="dark" class="btn-mode" style="flex:1;padding:8px;background:var(--surface);color:var(--text-base);border:1px solid var(--border);border-radius:6px;cursor:pointer">Dark</button>
        </div>
      </div>
    </div>`;
  const varyPanelHtml = `
    <div data-panel="vary" style="display:none;flex:1;flex-direction:column;min-height:0;overflow-y:auto;padding:16px;gap:16px">
      <div data-vary-controls style="display:flex;flex-direction:column;gap:16px"></div>
      <div style="border-top:1px solid var(--border);padding-top:16px">
        <div class="t-caption" style="color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.08em">Grid generator</div>
        <div class="t-body" style="color:var(--text-muted);margin-bottom:12px;font-size:12px">Pick axis values to generate a Cartesian product of variants.</div>
        <div data-vary-grid-axes style="display:flex;flex-direction:column;gap:12px"></div>
        <button data-vary-grid-generate class="btn-primary" style="margin-top:12px;padding:10px 16px;background:var(--accent);color:var(--on-accent);border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;width:100%">Generate grid</button>
        <div data-vary-grid-status class="t-caption" style="color:var(--text-muted);margin-top:8px;min-height:16px"></div>
        <div data-vary-grid-results style="margin-top:12px;display:flex;flex-direction:column;gap:6px"></div>
      </div>
    </div>`;
  // Quality tab — aesthetic score radar + per-metric bars
  const qualityPanelHtml = `
    <div data-panel="quality" style="display:none;flex:1;flex-direction:column;min-height:0;overflow-y:auto;padding:16px;gap:16px">
      <div class="t-caption" style="color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em">Design Quality Score</div>
      <div data-quality-score style="text-align:center;padding:16px 0">
        <div class="t-caption" style="color:var(--text-muted)">Click "Analyze" to compute</div>
      </div>
      <button data-quality-analyze class="btn-primary" style="padding:10px 16px;background:var(--accent);color:var(--on-accent);border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;width:100%">Analyze Quality</button>
      <div data-quality-metrics style="display:flex;flex-direction:column;gap:8px;margin-top:8px"></div>
      <div style="border-top:1px solid var(--border);padding-top:16px;margin-top:16px">
        <div class="t-caption" style="color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">Brand Fidelity</div>
        <div data-brand-fidelity-score style="text-align:center;padding:8px 0">
          <div class="t-caption" style="color:var(--text-muted)">Click "Analyze" above to compute</div>
        </div>
        <div data-brand-fidelity-breakdown style="display:flex;flex-direction:column;gap:4px"></div>
      </div>
    </div>`;

  // Tokens tab — token tree with color swatches
  const tokensPanelHtml = `
    <div data-panel="tokens" style="display:none;flex:1;flex-direction:column;min-height:0;overflow-y:auto;padding:16px;gap:16px">
      <div class="t-caption" style="color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em">Design Tokens</div>
      <div data-tokens-tree style="display:flex;flex-direction:column;gap:4px">
        <div class="t-caption" style="color:var(--text-muted);padding:16px;text-align:center">No tokens defined. Use reframe_edit defineTokens to create tokens from a brand.</div>
      </div>
      <div style="border-top:1px solid var(--border);padding-top:12px;display:flex;gap:8px">
        <button data-tokens-export class="btn-sm" style="flex:1;padding:8px;background:var(--surface);color:var(--text-base);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:12px">Export DTCG</button>
        <button data-tokens-import class="btn-sm" style="flex:1;padding:8px;background:var(--surface);color:var(--text-base);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:12px">Import</button>
      </div>
    </div>`;

  return `
    <div class="right-tabs">
      <button class="right-tab active" data-tab="sections">Sections</button>
      <button class="right-tab" data-tab="design">Design</button>
      <button class="right-tab" data-tab="rebrand">Rebrand</button>
      <button class="right-tab" data-tab="vary">Vary</button>
      <button class="right-tab" data-tab="quality">Quality</button>
      <button class="right-tab" data-tab="tokens">Tokens</button>
    </div>
    <div class="sections-panel" data-panel="sections" style="display:flex;flex:1;flex-direction:column;min-height:0;overflow-y:auto;padding:12px">
      <div id="sections-list">
        <div class="sections-loading" style="padding:24px;text-align:center"><span class="t-caption" style="color:var(--text-muted)">Loading sections\u2026</span></div>
      </div>
    </div>
    <div class="props-panel hidden" data-panel="design" style="display:none">
      <div class="props-empty">
        <div class="headline">No selection.</div>
        <div class="body">Click a node in the preview to inspect and edit its properties.</div>
      </div>
    </div>
    ${rebrandPanelHtml}
    ${varyPanelHtml}
    ${qualityPanelHtml}
    ${tokensPanelHtml}
    ${threadPanelHtml}
  `;
}

export function renderScenePage(data: SceneData): string {
  const main = renderViewportHero(data);
  const rightPanel = renderScenePageRightPanel(data);

  // Same "generic tag name" guard as the sidebar — if the root's name
  // is something like "div", fall back to the slug for the breadcrumb.
  const GENERIC = new Set(['div', 'span', 'section', 'main', 'header', 'footer', 'article', 'aside', 'nav']);
  const displayName = GENERIC.has((data.name || '').toLowerCase()) ? data.slug : data.name;

  // The old bottom bar (audit chip + scene-meta line) is gone —
  // dimensions moved to the header crumb, audit lives inside the
  // inspect panel. The timeline track is preserved only as a DOM
  // anchor point for existing scripts.ts refs; it's empty.
  const bottomBar = `<div class="bottom-bar hidden">
    <div class="timeline-track" style="display:none">
      <div class="timeline-ops"></div>
      <div class="timeline-handle" style="right:0"></div>
    </div>
  </div>`;

  // Expose the brands list to client-side JS for the variations grid UI.
  const brandsJson = JSON.stringify(data.brands || []);
  const brandsScript = `<script>window.__REFRAME_BRANDS__=${brandsJson};</script>`;

  return renderShell({
    title: `reframe · ${displayName}`,
    sceneSlug: data.slug,
    crumb: displayName,
    crumbMeta: `${data.width} × ${data.height}`,
    main: main + bottomBar + brandsScript,
    sidebar: renderSidebar({
      current: 'scene',
      scenes: data.sidebarScenes,
      components: data.sidebarComponents,
      macros: data.sidebarMacros,
      activeBrand: data.activeBrand,
    }),
    rightPanel,
    activeBrand: data.activeBrand,
  });
}

/**
 * The hero element. Per the brand spec: single viewport, centered, on
 * warm paper, with hairline + inset bevel + long soft drop shadow.
 * The viewport switcher is above the frame, the caption is below.
 */
function renderViewportHero(data: SceneData): string {
  const sid = escape(data.sessionId);

  // The viewport toolbar only holds the viewport size switcher now —
  // the scene name moved out (it duplicated the top breadcrumb) and
  // the bottom meta line was removed (dimensions live in the header
  // crumb, brand is shown in the sidebar). The viewport becomes a
  // cleaner single-surface zone.
  return `
    <div class="pipeline-stepper" style="display:flex;align-items:center;justify-content:center;gap:0;padding:12px 40px;background:var(--surface-elevated);border-bottom:1px solid var(--border-subtle)">
      <div class="pipeline-step active" style="display:flex;align-items:center;gap:8px;padding:6px 16px;border-radius:6px;font-size:13px;font-weight:500;background:var(--accent);color:var(--on-accent);cursor:pointer" data-step="generate">
        <span style="font-size:14px">1</span> Generate
      </div>
      <div style="width:24px;height:1px;background:var(--border)"></div>
      <div class="pipeline-step" style="display:flex;align-items:center;gap:8px;padding:6px 16px;border-radius:6px;font-size:13px;font-weight:500;color:var(--text-muted);cursor:pointer" data-step="review">
        <span style="font-size:14px">2</span> Review
      </div>
      <div style="width:24px;height:1px;background:var(--border)"></div>
      <div class="pipeline-step" style="display:flex;align-items:center;gap:8px;padding:6px 16px;border-radius:6px;font-size:13px;font-weight:500;color:var(--text-muted);cursor:pointer" data-step="refine">
        <span style="font-size:14px">3</span> Refine
      </div>
      <div style="width:24px;height:1px;background:var(--border)"></div>
      <div class="pipeline-step" style="display:flex;align-items:center;gap:8px;padding:6px 16px;border-radius:6px;font-size:13px;font-weight:500;color:var(--text-muted);cursor:pointer" data-step="ship">
        <span style="font-size:14px">4</span> Ship
      </div>
    </div>

    <div class="viewport-area">
    <div class="viewport-toolbar">
      <div class="switcher" role="tablist">
        <button class="vp-btn active" data-vp="original" title="Original (${data.width}×${data.height})" aria-label="Original">
          ○
        </button>
        <button class="vp-btn" data-vp="desktop" title="Desktop (1440×900)" aria-label="Desktop">
          ${ICON_DESKTOP}
        </button>
        <button class="vp-btn" data-vp="tablet" title="Tablet (768×1024)" aria-label="Tablet">
          ${ICON_TABLET}
        </button>
        <button class="vp-btn" data-vp="mobile" title="Mobile (375×812)" aria-label="Mobile">
          ${ICON_MOBILE}
        </button>
      </div>
    </div>

    <div class="viewport-frame original" data-viewport="original" data-session="${sid}" data-orig-w="${data.width}" data-orig-h="${data.height}">
      <iframe src="/preview/${sid}" loading="lazy"></iframe>
      <svg class="annotations" viewBox="0 0 ${data.width} ${data.height}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <rect class="hover-outline hidden" x="0" y="0" width="0" height="0" rx="2" />
        <rect class="select-outline hidden" x="0" y="0" width="0" height="0" rx="2" />
        <g class="annotation-marks-svg"></g>
      </svg>
      <div class="annotation-marks-html"></div>
      <div class="mode-banner" role="status" aria-live="polite"></div>
      <div class="capture"></div>
      <!-- Quality badge: floating ambient score overlay -->
      <div class="quality-badge" data-quality-badge
        style="position:absolute;top:12px;right:12px;padding:6px 12px;border-radius:8px;background:rgba(0,0,0,0.7);backdrop-filter:blur(8px);color:#fff;font-size:12px;font-weight:600;font-family:var(--mono);z-index:10;cursor:pointer;transition:all 0.2s;display:none"
        title="Design quality score — click to see details">
        <span data-quality-badge-score>—</span>
      </div>
    </div>
    ${renderCanvasTools()}

    <!-- Variant strip: populated by JS after vary/adapt operations -->
    <div class="variant-strip" data-variant-strip style="display:none;padding:12px 20px;background:var(--surface-elevated);border-top:1px solid var(--border-subtle);overflow-x:auto;white-space:nowrap">
      <div class="variant-strip-label" style="font-size:11px;font-weight:500;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">Variants</div>
      <div class="variant-strip-items" data-variant-items style="display:flex;gap:12px;overflow-x:auto;padding-bottom:4px"></div>
    </div>
  </div>`;
}

// ── Custom viewport icons (1.5px ink stroke, no monitor stand, no
//    phone notch — just the rectangles at proportional aspect ratio).
//    Per the brand: this is the only custom icon set in the product.

const ICON_DESKTOP = `<svg width="16" height="14" viewBox="0 0 16 14" fill="none">
  <rect x="1.5" y="1.5" width="13" height="9" rx="1" stroke="currentColor" stroke-width="1.5"/>
</svg>`;

const ICON_TABLET = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
  <rect x="2.5" y="1.5" width="9" height="11" rx="1" stroke="currentColor" stroke-width="1.5"/>
</svg>`;

const ICON_MOBILE = `<svg width="12" height="14" viewBox="0 0 12 14" fill="none">
  <rect x="3" y="1.5" width="6" height="11" rx="1" stroke="currentColor" stroke-width="1.5"/>
</svg>`;
