/**
 * Project canvas page — /platform/project/:slug
 *
 * Interactive CanvasKit canvas (via @open-pencil/core) rendering ALL
 * scenes of a project as artboards on one Skia surface. Selection,
 * drag, resize, text editing, zoom/pan — same as Figma.
 *
 * Same shell as the single-scene page (header tools, sidebar nav,
 * right panel with tabs). The canvas IS the project editor.
 */

import { renderShell, renderSidebar } from '../layout.js';
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

  // Artboard layout data — embedded as JSON for the CanvasKit bootstrap
  // to read. No iframes, no DOM fallback — canvas is the only renderer.
  const artboardData = packed.map(item => ({
    id: item.scene.id,
    slug: item.scene.slug,
    name: item.scene.name || item.scene.slug,
    x: item.x,
    y: item.y,
    w: item.scene.width ?? 1440,
    h: item.scene.height ?? 900,
  }));

  // Scene ID list for the CanvasKit bootstrap.
  const sceneIdList = p.members.map(m => m.id).join(',');

  // Main area — clean CanvasKit viewport, no old UI overlays
  const main = `
    <div style="position:relative;width:100%;height:100%;overflow:hidden">
      <canvas id="reframe-viewport" tabindex="0"
        style="position:absolute;inset:0;width:100%;height:100%;outline:none;cursor:default"
        data-project-scenes="${escape(sceneIdList)}"></canvas>
      <div class="mode-banner" role="status" aria-live="polite"
        style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2;color:#666;font-size:13px;pointer-events:none">
        Loading\u2026</div>
    </div>`;

  return renderShell({
    title: `reframe \u00B7 ${p.name}`,
    crumb: p.name,
    crumbMeta: `${p.members.length} scene${p.members.length === 1 ? '' : 's'}`,
    main,
    sidebar: renderSidebar({
      current: 'project-canvas',
      activeBrand: data.activeBrand,
    }),
    // No right panel or old tools — CanvasKit handles everything
    activeBrand: data.activeBrand,
  });
}
