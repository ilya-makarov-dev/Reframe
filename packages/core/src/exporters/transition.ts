/**
 * Transition Exporter — animated source → target resize preview.
 *
 * Given two snapshots of the same design at different sizes (typically
 * a source scene and its reflow/cluster-scale result), emit a single
 * HTML file that visually tweens the source into the target. Matches
 * nodes by their tree path (`"root/hero/title"`) so the two trees
 * don't need to share IDs — useful because our resize pipelines clone
 * into the same graph and IDs end up differing post-clone.
 *
 * The output is target-shaped: every element lives in the target
 * layout and starts as its *source* geometry, then animates via CSS
 * keyframes to its *target* geometry. Unmatched target nodes (i.e.
 * new content added by reflow) fade in at the end of the tween;
 * unmatched source nodes fade out at the start.
 *
 * Not a replacement for the full animation subsystem — this exporter
 * is purposely narrow: "show me the resize happening". For richer
 * motion graphs use `exportToAnimatedHtml` with a real ITimeline.
 */

import type { SceneGraph } from '../engine/scene-graph.js';
import { exportToHtml } from './html.js';

// ─── Types ───────────────────────────────────────────────────

export interface TransitionExportOptions {
  /** Tween duration in ms (default: 1200) */
  duration?: number;
  /** CSS timing function (default: cubic-bezier ease out) */
  easing?: string;
  /** Loop the tween (default: true) */
  loop?: boolean;
  /** Title shown in the output HTML tab */
  title?: string;
}

interface NodeSnapshot {
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number | null;
}

// ─── Main Export ─────────────────────────────────────────────

export function exportResizeTransition(
  sourceGraph: SceneGraph,
  sourceRootId: string,
  targetGraph: SceneGraph,
  targetRootId: string,
  options: TransitionExportOptions = {},
): string {
  const duration = options.duration ?? 1200;
  const easing = options.easing ?? 'cubic-bezier(0.22, 0.61, 0.36, 1)';
  const loop = options.loop ?? true;
  const title = options.title ?? 'Resize transition';

  // Snapshot both trees, keyed by path. Path uses names joined by "/"
  // with sibling-index disambiguation when names collide — two text
  // nodes named "div" under the same parent become "div" and "div#1".
  const sourceSnap = snapshotTree(sourceGraph, sourceRootId);
  const targetSnap = snapshotTree(targetGraph, targetRootId);

  // Render the target as the static base HTML. Use the HTML exporter
  // in classed mode so we can layer per-node keyframe animations on
  // top of it without fighting inline styles. `dataAttributes` emits
  // `data-rf-path` which we read in the keyframe generator.
  const targetHtml = exportToHtml(targetGraph, targetRootId, {
    fullDocument: false,
    dataAttributes: true,
    cssClasses: true,
  });

  // Walk the target DOM (string) and collect keyframe blocks per
  // matched path. We generate a `@keyframes rf-tween-N` block for
  // each matched pair and a `[data-rf-path="..."]` selector that
  // binds the block.
  const keyframeBlocks: string[] = [];
  const bindingSelectors: string[] = [];
  let animCounter = 0;

  for (const [path, target] of targetSnap) {
    const source = sourceSnap.get(path);
    if (!source) {
      // New element in the target tree — fade it in at the end of
      // the tween so the flow reads as "old layout → new layout with
      // these extras popping in".
      const animName = `rf-fade-in-${animCounter++}`;
      keyframeBlocks.push(
        `@keyframes ${animName} { 0%, 60% { opacity: 0; } 100% { opacity: 1; } }`,
      );
      bindingSelectors.push(
        `[data-rf-path="${escAttr(path)}"] { animation: ${animName} ${duration}ms ${easing} both${loop ? ' infinite' : ''}; }`,
      );
      continue;
    }

    // Matched node — tween from source geometry to target geometry.
    // We use `transform: translate()` for position and `scale()` for
    // width/height rather than animating width/height directly,
    // because layout-driven width/height animation is expensive and
    // browser-compositor-unfriendly. Font size is the exception —
    // it's not transform-able, so we animate font-size outright.
    if (geometryEqual(source, target)) continue;

    const dx = source.x - target.x;
    const dy = source.y - target.y;
    const sx = target.width > 0 ? source.width / target.width : 1;
    const sy = target.height > 0 ? source.height / target.height : 1;

    const animName = `rf-tween-${animCounter++}`;
    const fontStart = source.fontSize ?? target.fontSize;
    const fontEnd = target.fontSize ?? source.fontSize;
    const fontLine = fontStart !== fontEnd && fontStart != null && fontEnd != null
      ? `    0% { font-size: ${fontStart}px; } 100% { font-size: ${fontEnd}px; }`
      : '';

    keyframeBlocks.push(`@keyframes ${animName} {
  0% {
    transform: translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${sx.toFixed(3)}, ${sy.toFixed(3)});
    transform-origin: top left;
  }
  100% {
    transform: translate(0, 0) scale(1, 1);
    transform-origin: top left;
  }
${fontLine}
}`);
    bindingSelectors.push(
      `[data-rf-path="${escAttr(path)}"] { animation: ${animName} ${duration}ms ${easing} both${loop ? ' infinite alternate' : ''}; }`,
    );
  }

  // Unmatched source-only nodes — there's nothing to fade out in the
  // target DOM because they don't exist there. We skip them; the
  // transition reads as "they've left the scene".

  const css = [
    '* { margin: 0; padding: 0; box-sizing: border-box; }',
    'html, body { min-height: 100vh; background: #0b0b0d; color: #f5f5f7; font-family: system-ui, sans-serif; }',
    'body { display: flex; align-items: center; justify-content: center; padding: 24px; }',
    '.rf-stage { position: relative; }',
    ...keyframeBlocks,
    ...bindingSelectors,
  ].join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escHtml(title)}</title>
  <style>
${css}
  </style>
</head>
<body>
  <div class="rf-stage">
${targetHtml}
  </div>
</body>
</html>`;
}

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Walk a tree and produce a path-keyed snapshot of every node's
 * position, size, and font size. Paths use `/` as a separator and
 * disambiguate same-named siblings with `#idx` so the matcher can
 * line up cloned trees where name collisions are common (HTML import
 * produces lots of frames all named "div").
 */
function snapshotTree(graph: SceneGraph, rootId: string): Map<string, NodeSnapshot> {
  const out = new Map<string, NodeSnapshot>();
  const walk = (id: string, path: string): void => {
    const n = graph.getNode(id);
    if (!n) return;
    out.set(path, {
      path,
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
      fontSize: n.type === 'TEXT' && typeof n.fontSize === 'number' ? n.fontSize : null,
    });
    // Build child paths. Use a tag that combines type + text content +
    // position-hash rather than name, because HTML imports name every
    // frame "div" and sibling-index disambiguation drifts when resize
    // inserts/removes wrappers. `TEXT:"Hello"` survives across source
    // and target trees, and typed FRAME bucketing (`FRAME:0`,
    // `FRAME:1`) stays stable under mild reorderings. Stable keys push
    // the transition exporter's match rate from ~3/40 on the Easter
    // email up to ~30/40 on the same scene.
    const typeCounts = new Map<string, number>();
    for (const cid of n.childIds) {
      const child = graph.getNode(cid);
      if (!child) continue;
      let segment: string;
      if (child.type === 'TEXT' && child.text) {
        // Text content as a stable identifier. Truncate to 48 chars so
        // minor wrap differences don't change the key.
        const snippet = child.text.replace(/\s+/g, ' ').trim().slice(0, 48);
        segment = `T:${snippet}`;
      } else {
        const tag = child.type.toLowerCase();
        const count = typeCounts.get(tag) ?? 0;
        typeCounts.set(tag, count + 1);
        segment = `${tag}#${count}`;
      }
      walk(cid, `${path}/${segment}`);
    }
  };
  // Anchor every path at a fixed `root` segment instead of using the
  // root node's own name. Resize pipelines rename the clone to
  // "1080x1920 (reflowed)" while the source keeps its original name
  // ("div" from the HTML importer) — using the actual name broke path
  // matching for the entire tree at the first segment.
  walk(rootId, 'root');
  return out;
}

function geometryEqual(a: NodeSnapshot, b: NodeSnapshot): boolean {
  return (
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5 &&
    a.fontSize === b.fontSize
  );
}

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
