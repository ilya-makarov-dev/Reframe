/**
 * Hyperframes exporter — INode scene → hyperframes-compatible composition.
 *
 * Produces a directory with `index.html` that hyperframes' CLI (`npx
 * hyperframes render <dir>`) renders to MP4/WebM via headless Chromium +
 * FFmpeg. The HTML shape follows hyperframes' conventions:
 *
 *   <div id="stage"
 *        data-composition-id="<slug>"
 *        data-width="1440" data-height="900"
 *        data-start="0">
 *     <!-- scene tree emitted by reframe's HTML exporter, with a
 *          per-animated-node `data-start`/`data-duration`/`data-track-index`
 *          annotation and a GSAP bootstrap at the bottom -->
 *   </div>
 *
 * Mode A (implemented here): single-scene composition.
 *   - Scene root becomes `#stage`.
 *   - When `timeline` is supplied, each `INodeAnimation` becomes a GSAP
 *     tween targeting the node by id; keyframes → fromTo + set() chain.
 *   - When `timeline` is omitted, the composition is a single-frame static
 *     (`data-duration` omitted ⇒ spans composition).
 *
 * Mode B (multi-scene sequence / cross-page transitions) is a follow-up —
 * hyperframes' markup supports multiple track-indexed siblings, but
 * reframe's current model is one scene at a time.
 *
 * Hyperframes docs: https://github.com/heygen-com/hyperframes
 * Timing units: seconds (not ms, not frames). reframe's animation
 * durations live in ms, so we divide by 1000 at the seams.
 */

import type { SceneGraph } from '../engine/scene-graph.js';
import type { ITimeline, INodeAnimation, IKeyframe } from '../animation/types.js';
import { exportToHtml } from './html.js';

// ─── Types ──────────────────────────────────────────────────────

export interface HyperframesExportOptions {
  /** Composition id used as `data-composition-id` + filename slug. */
  compositionId?: string;
  /**
   * Total composition duration in seconds. If `timeline` is passed we
   * derive from its longest animation + delay (in ms) unless overridden.
   * Static compositions default to 3 s (single poster frame is fine at
   * any duration; hyperframes needs a positive number).
   */
  durationSeconds?: number;
  /** Override the composition width (default: scene root width). */
  width?: number;
  /** Override the composition height (default: scene root height). */
  height?: number;
  /**
   * GSAP CDN URL to inject. Set to `null` to skip (you'll need to
   * load GSAP yourself if you write `data-animate` elements without
   * a timeline). Default: pinned GSAP 3.12.5.
   */
  gsapUrl?: string | null;
  /**
   * Animation timeline. Each `INodeAnimation.nodeId` must match a node
   * id rendered into the HTML output. Missing ids are silently skipped
   * (exporter logs to console).
   */
  timeline?: ITimeline | null;
}

export interface HyperframesExportResult {
  /** Full composition HTML ready to drop into `<dir>/index.html`. */
  html: string;
  /** Composition id used. Useful when caller auto-generated one. */
  compositionId: string;
  /** Composition dimensions (same as what we emit on the root). */
  width: number;
  height: number;
  /** Duration in seconds — useful for callers wiring preview scrubbers. */
  durationSeconds: number;
  /** Count of animations that successfully emitted GSAP tweens. */
  animationsEmitted: number;
}

// ─── Helpers ────────────────────────────────────────────────────

/** Convert keyframe `properties` to a GSAP-compatible CSS-vars object. */
function keyframePropsToGsap(props: IKeyframe['properties']): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // GSAP accepts CSS prop names. Animatable reframe props map:
  if (props.opacity !== undefined) out.opacity = props.opacity;
  if (props.rotation !== undefined) out.rotation = props.rotation;
  // x/y: GSAP treats as translate (transform), matching CSS intuition.
  if (props.x !== undefined) out.x = props.x;
  if (props.y !== undefined) out.y = props.y;
  if (props.scaleX !== undefined) out.scaleX = props.scaleX;
  if (props.scaleY !== undefined) out.scaleY = props.scaleY;
  // Colors: hex string → GSAP handles `backgroundColor` + `color` directly.
  if (props.fillColor) out.backgroundColor = props.fillColor;
  return out;
}

function easingToGsap(ease: string | undefined): string {
  // reframe easing names → GSAP naming. GSAP also accepts raw cubic-beziers.
  if (!ease || ease === 'ease') return 'power1.inOut';
  if (ease === 'ease-in') return 'power2.in';
  if (ease === 'ease-out') return 'power2.out';
  if (ease === 'ease-in-out') return 'power2.inOut';
  if (ease === 'linear') return 'none';
  // Passthrough — GSAP parses cubic-bezier(a,b,c,d) directly.
  return ease;
}

/**
 * Emit a sub-timeline for one `INodeAnimation`, added to the outer
 * `master` timeline at the animation's delay. The master is created by
 * the caller and registered on `window.__timelines[compositionId]` so
 * hyperframes can seek frame-by-frame (see the `missing_timeline_registry`
 * lint in hyperframes CLI — without master timeline registration, render
 * falls back to wall-clock screenshot capture, not frame-deterministic).
 *
 * Targets the node's DOM id (set by html.ts via `data-id`) so selector
 * resolution happens at render time.
 */
function emitAnimation(anim: INodeAnimation): string | null {
  const targetId = anim.nodeId;
  if (!targetId) return null;
  const durSec = (anim.duration ?? 0) / 1000;
  const delaySec = (anim.delay ?? 0) / 1000;
  if (durSec <= 0) return null;

  const selector = `[data-id="${targetId.replace(/"/g, '\\"')}"]`;
  const kfs = anim.keyframes ?? [];
  if (kfs.length < 2) return null;

  const repeat = anim.iterations === Infinity ? -1
    : (anim.iterations != null && anim.iterations > 1) ? anim.iterations - 1 : 0;
  const yoyo = anim.direction === 'alternate' || anim.direction === 'alternate-reverse';

  const lines: string[] = [];
  lines.push(`(function(){`);
  lines.push(`  var sub = gsap.timeline({ repeat: ${repeat}, yoyo: ${yoyo} });`);
  const first = keyframePropsToGsap(kfs[0].properties);
  if (Object.keys(first).length > 0) {
    lines.push(`  sub.set(${JSON.stringify(selector)}, ${JSON.stringify(first)});`);
  }
  for (let i = 1; i < kfs.length; i++) {
    const prev = kfs[i - 1];
    const next = kfs[i];
    const segDur = Math.max(0, (next.offset - prev.offset)) * durSec;
    if (segDur === 0) continue;
    const toProps = keyframePropsToGsap(next.properties);
    const ease = easingToGsap(prev.easing as string | undefined);
    lines.push(
      `  sub.to(${JSON.stringify(selector)}, { duration: ${segDur}, ease: ${JSON.stringify(ease)}, ${Object.entries(toProps).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')} });`,
    );
  }
  // Add to master at the absolute delay — `+=delay` would stack relative
  // to previous adds; `absoluteDelay` here means composition-local time.
  lines.push(`  master.add(sub, ${delaySec});`);
  lines.push(`})();`);
  return lines.join('\n');
}

// ─── Main exporter ──────────────────────────────────────────────

export function exportToHyperframes(
  graph: SceneGraph,
  rootId: string,
  options: HyperframesExportOptions = {},
): HyperframesExportResult {
  const root = graph.getNode(rootId);
  if (!root) throw new Error(`exportToHyperframes: root node ${rootId} not found`);

  const width = options.width ?? root.width;
  const height = options.height ?? root.height;
  const compositionId = (options.compositionId ?? root.name ?? 'composition')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'composition';

  // Derive duration: timeline total (longest anim.delay + anim.duration, ms)
  // → seconds; else fall back to 3 s static poster.
  let durationSeconds = options.durationSeconds ?? 3;
  if (!options.durationSeconds && options.timeline?.animations?.length) {
    let maxMs = 0;
    for (const a of options.timeline.animations) {
      const endMs = (a.delay ?? 0) + (a.duration ?? 0);
      if (endMs > maxMs) maxMs = endMs;
    }
    if (maxMs > 0) durationSeconds = Math.ceil(maxMs / 1000);
  }

  // Inner scene — reuse the HTML exporter; it stamps `data-id` on every
  // element, which is what our GSAP selectors target.
  const inner = exportToHtml(graph, rootId, {
    fullDocument: false,
    dataAttributes: true,
  });

  // GSAP bootstrap — one script block per animation.
  const gsapUrl = options.gsapUrl === null
    ? null
    : (options.gsapUrl ?? 'https://unpkg.com/gsap@3.12.5/dist/gsap.min.js');
  let animationsEmitted = 0;
  const animBlocks: string[] = [];
  if (options.timeline?.animations?.length) {
    for (const anim of options.timeline.animations) {
      const block = emitAnimation(anim);
      if (block) {
        animBlocks.push(block);
        animationsEmitted++;
      }
    }
  }

  const scripts: string[] = [];
  if (gsapUrl) scripts.push(`  <script src="${gsapUrl}"></script>`);
  if (animBlocks.length > 0) {
    // Hyperframes scrubs the render by seeking a registered timeline
    // frame-by-frame (see their `missing_timeline_registry` lint). We
    // assemble ONE master `gsap.timeline({paused:true})` that combines
    // all node animations via `.add(subTl, delaySec)`, then register it
    // on `window.__timelines[compositionId]`. Each emitAnimation block
    // is wrapped to return its sub-timeline instead of playing. Without
    // this, hyperframes falls back to wall-clock screenshot capture —
    // works for simple GSAP but not frame-deterministic.
    scripts.push(`  <script>`);
    scripts.push(`    document.addEventListener('DOMContentLoaded', function() {`);
    scripts.push(`      var master = gsap.timeline({ paused: true });`);
    scripts.push(animBlocks.map(b => '      ' + b.split('\n').join('\n      ')).join('\n'));
    scripts.push(`      window.__timelines = window.__timelines || {};`);
    scripts.push(`      window.__timelines[${JSON.stringify(compositionId)}] = master;`);
    scripts.push(`    });`);
    scripts.push(`  </script>`);
  }

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(compositionId)}</title>
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #000; }
    #stage { position: relative; width: ${width}px; height: ${height}px; margin: 0 auto; overflow: hidden; }
  </style>
</head>
<body>
  <div id="stage" data-composition-id="${escapeHtml(compositionId)}" data-width="${width}" data-height="${height}" data-start="0" data-duration="${durationSeconds}">
${inner}
  </div>
${scripts.join('\n')}
</body>
</html>
`;

  return { html, compositionId, width, height, durationSeconds, animationsEmitted };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
