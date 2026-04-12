/**
 * Project canvas page — /platform/project/:slug
 *
 * Uses the same shell as the single-scene page (top header with tools,
 * left sidebar nav, right panel with 4 tabs), just swaps the centre
 * viewport for a pan/zoom canvas containing all scenes of the project
 * at their native size.
 *
 * No intermediate "open this project" button, no duplicate breadcrumb
 * inside the main area — the top header crumb already says where you
 * are, and the sidebar already shows the nav context. The canvas just
 * IS the project editor.
 */

import { renderShell, renderSidebar, renderCanvasTools } from '../layout.js';
import { renderScenePageRightPanel } from './scene.js';
import type { ProjectGroup, SceneLike } from '../project-grouping.js';

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface CanvasData {
  project: ProjectGroup;
  allScenesCount: number;
  activeBrand?: string;
  brands?: string[];
}

/**
 * Pack artboards into a grid, respecting native dimensions. Returns
 * artboards with computed (x, y) canvas coordinates. Row-based packing
 * with automatic wrap at a target row width.
 */
function packArtboards(
  scenes: SceneLike[],
  options: { gap: number; rowTargetWidth: number } = { gap: 120, rowTargetWidth: 6400 },
): Array<{ scene: SceneLike; x: number; y: number }> {
  const { gap, rowTargetWidth } = options;
  const rows: Array<{ items: Array<{ scene: SceneLike; width: number; height: number }>; height: number }> = [];
  let currentRow: (typeof rows)[0] = { items: [], height: 0 };
  let currentRowWidth = 0;

  for (const scene of scenes) {
    const w = scene.width ?? 1440;
    const h = scene.height ?? 900;
    if (currentRow.items.length > 0 && currentRowWidth + gap + w > rowTargetWidth) {
      rows.push(currentRow);
      currentRow = { items: [], height: 0 };
      currentRowWidth = 0;
    }
    currentRow.items.push({ scene, width: w, height: h });
    currentRow.height = Math.max(currentRow.height, h);
    currentRowWidth += (currentRow.items.length > 1 ? gap : 0) + w;
  }
  if (currentRow.items.length > 0) rows.push(currentRow);

  const result: Array<{ scene: SceneLike; x: number; y: number }> = [];
  let y = 0;
  for (const row of rows) {
    let x = 0;
    for (const item of row.items) {
      result.push({ scene: item.scene, x, y });
      x += item.width + gap;
    }
    y += row.height + gap;
  }
  return result;
}

export function renderProjectCanvas(data: CanvasData): string {
  const p = data.project;
  const packed = packArtboards(p.members);
  const owner = p.members[0];

  // Compute content bounds for fit-to-screen calculation.
  let maxX = 0;
  let maxY = 0;
  for (const item of packed) {
    const w = item.scene.width ?? 1440;
    const h = item.scene.height ?? 900;
    if (item.x + w > maxX) maxX = item.x + w;
    if (item.y + h > maxY) maxY = item.y + h;
  }

  // Render artboards as absolutely-positioned wrappers holding a lazy
  // iframe placeholder. The iframe src is set by IntersectionObserver
  // in scripts.ts when the artboard enters the visible viewport.
  // No per-artboard "open in isolation" link — canvas IS the editor,
  // there's no separate isolated-scene mode to navigate to. The label
  // stays above each artboard for identification.
  const artboards = packed.map(item => {
    const w = item.scene.width ?? 1440;
    const h = item.scene.height ?? 900;
    const displayName = item.scene.name || item.scene.slug;
    return `<div class="canvas-artboard" style="left:${item.x}px;top:${item.y}px;width:${w}px;height:${h}px"
      data-scene-id="${escape(item.scene.id)}"
      data-scene-slug="${escape(item.scene.slug)}"
      data-artboard-w="${w}" data-artboard-h="${h}">
      <div class="canvas-artboard-label">
        <span class="canvas-artboard-name">${escape(displayName)}</span>
        <span class="canvas-artboard-dims">${w}\u00D7${h}</span>
      </div>
      <div class="canvas-artboard-frame">
        <iframe data-lazy-src="/preview/${escape(item.scene.id)}" loading="lazy" tabindex="-1" scrolling="no"></iframe>
      </div>
    </div>`;
  }).join('');

  // Main area — viewport-area in canvas mode. The empty toolbar strip
  // was removed; zoom controls float as a standalone button group over
  // the canvas (top-right corner). The canvas fills the whole main
  // region edge-to-edge for maximum workspace.
  const main = `
    <div class="viewport-area canvas-mode" data-content-w="${maxX}" data-content-h="${maxY}">
      <div class="viewport-frame canvas-viewport" data-viewport="canvas" data-canvas-viewport data-session="${escape(owner.id)}">
        <div class="canvas-world" data-canvas-world>
          ${artboards}
        </div>
        <!-- Zoom controls — floating top-right -->
        <div class="canvas-zoom-float" role="toolbar" aria-label="Canvas zoom">
          <button class="canvas-tool" data-canvas-action="zoom-out" title="Zoom out (-)">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>
          <span class="canvas-zoom-level" data-canvas-zoom-level>100%</span>
          <button class="canvas-tool" data-canvas-action="zoom-in" title="Zoom in (+)">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7h8M7 3v8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>
          <button class="canvas-tool" data-canvas-action="fit" title="Fit to screen (0)">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4V2h2M12 4V2h-2M2 10v2h2M12 10v2h-2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button class="canvas-tool" data-canvas-action="zoom-100" title="Actual size (1)">
            <span style="font-size:10px;font-weight:600">1:1</span>
          </button>
        </div>
        <!-- Interaction tools — floating bottom-center -->
        ${renderCanvasTools()}
      </div>
    </div>`;

  // Same hidden stub bottom-bar as scene page (DOM anchor for legacy scripts).
  const bottomBar = `<div class="bottom-bar hidden">
    <div class="timeline-track" style="display:none">
      <div class="timeline-ops"></div>
      <div class="timeline-handle" style="right:0"></div>
    </div>
  </div>`;

  // Expose brand list to client-side vary grid UI, same as scene page.
  const brandsJson = JSON.stringify(data.brands || []);
  const brandsScript = `<script>window.__REFRAME_BRANDS__=${brandsJson};</script>`;

  return renderShell({
    title: `reframe \u00B7 ${p.name}`,
    // sceneSlug enables the top header's tool-mode buttons, undo/redo,
    // history dropdown, export dropdown. It points at the project
    // owner (the canonical original scene) so right-panel operations
    // have a default target.
    sceneSlug: owner.slug,
    crumb: p.name,
    crumbMeta: `${p.members.length} scene${p.members.length === 1 ? '' : 's'}`,
    main: main + bottomBar + brandsScript,
    sidebar: renderSidebar({
      current: 'project-canvas',
      activeBrand: data.activeBrand,
    }),
    rightPanel: renderScenePageRightPanel({ brands: data.brands ?? [], activeBrand: data.activeBrand }),
    activeBrand: data.activeBrand,
  });
}
