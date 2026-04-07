/**
 * Lottie JSON Exporter — Scene Graph + ITimeline → Lottie animation.
 *
 * Produces a valid Lottie JSON that plays in lottie-web, Telegram,
 * WhatsApp, After Effects, and any Lottie-compatible renderer.
 *
 * Lottie format spec: https://lottiefiles.github.io/lottie-docs/
 */

import type { SceneGraph } from '../engine/scene-graph.js';
import type { SceneNode, Color, Fill, Effect } from '../engine/types.js';
import type {
  ITimeline, INodeAnimation, IKeyframe,
  AnimatableProperties, Easing, EasingPreset,
} from '../animation/types.js';
import { computeDuration } from '../animation/timeline.js';

// ─── Options ───────────────────────────────────────────────────

export interface LottieExportOptions {
  /** Frames per second (default: 60) */
  fps?: number;
  /** Lottie format version (default: '5.7.4') */
  version?: string;
}

// ─── Main Export ───────────────────────────────────────────────

export function exportToLottie(
  graph: SceneGraph,
  rootId: string,
  timeline: ITimeline,
  options: LottieExportOptions = {},
): object {
  const root = graph.getNode(rootId);
  if (!root) throw new Error(`Node ${rootId} not found`);

  const fps = options.fps ?? 60;
  const totalMs = computeDuration(timeline);
  const totalFrames = Math.ceil((totalMs / 1000) * fps);

  // Build animation lookup: nodeId → INodeAnimation[]
  const animByNode = new Map<string, INodeAnimation[]>();
  for (const anim of timeline.animations) {
    const key = resolveNodeId(graph, rootId, anim);
    if (!key) continue;
    const list = animByNode.get(key) ?? [];
    list.push(anim);
    animByNode.set(key, list);
  }

  // Convert scene tree to Lottie layers (flattened, bottom-up)
  const layers = buildLayers(graph, root, rootId, animByNode, fps);

  return {
    v: options.version ?? '5.7.4',
    fr: fps,
    ip: 0,
    op: totalFrames,
    w: Math.round(root.width),
    h: Math.round(root.height),
    nm: root.name || 'reframe-animation',
    ddd: 0,
    assets: [],
    layers: layers.reverse(), // Lottie renders bottom layer first
  };
}

/** Export as JSON string */
export function exportToLottieString(
  graph: SceneGraph,
  rootId: string,
  timeline: ITimeline,
  options: LottieExportOptions = {},
): string {
  return JSON.stringify(exportToLottie(graph, rootId, timeline, options));
}

// ─── Layer Building ────────────────────────────────────────────

interface LottieLayer {
  ddd: number;
  ind: number;
  ty: number;
  nm: string;
  sr: number;
  ks: any;
  ao: number;
  ip: number;
  op: number;
  st: number;
  bm: number;
  shapes?: any[];
  t?: any;
}

let layerIndex = 0;

function buildLayers(
  graph: SceneGraph,
  node: SceneNode,
  rootId: string,
  animByNode: Map<string, INodeAnimation[]>,
  fps: number,
): any[] {
  layerIndex = 0;
  const layers: any[] = [];
  collectLayers(graph, node, rootId, animByNode, fps, layers, true);
  return layers;
}

function collectLayers(
  graph: SceneGraph,
  node: SceneNode,
  rootId: string,
  animByNode: Map<string, INodeAnimation[]>,
  fps: number,
  layers: any[],
  isRoot: boolean,
): void {
  if (!node.visible) return;

  const anims = animByNode.get(node.id);
  const layer = createLayer(node, anims, fps, isRoot);
  layers.push(layer);

  // Process children
  for (const childId of node.childIds) {
    const child = graph.getNode(childId);
    if (child) collectLayers(graph, child, rootId, animByNode, fps, layers, false);
  }
}

function createLayer(
  node: SceneNode,
  anims: INodeAnimation[] | undefined,
  fps: number,
  isRoot: boolean,
): any {
  const idx = layerIndex++;
  const isText = node.type === 'TEXT';

  // Determine layer type
  // 0 = precomp, 1 = solid, 2 = image, 3 = null, 4 = shape, 5 = text
  const ty = isText ? 5 : 4;

  const layer: any = {
    ddd: 0,
    ind: idx,
    ty,
    nm: node.name || `layer-${idx}`,
    sr: 1,
    ks: buildTransform(node, anims, fps, isRoot),
    ao: 0,
    ip: 0,
    op: 9999,
    st: 0,
    bm: 0,
  };

  if (isText) {
    layer.t = buildTextData(node);
  } else {
    layer.shapes = buildShapes(node);
  }

  // Clip mask: when clipsContent is true, add mask to clip children
  if (node.clipsContent && node.childIds?.length > 0) {
    layer.masksProperties = [{
      inv: false,
      mode: 'a', // additive mask
      pt: {
        k: {
          i: [[0,0],[0,0],[0,0],[0,0]],
          o: [[0,0],[0,0],[0,0],[0,0]],
          v: [[0,0],[node.width,0],[node.width,node.height],[0,node.height]],
          c: true,
        },
        a: 0,
      },
      o: { a: 0, k: 100 },
      x: { a: 0, k: 0 },
      nm: 'Clip',
    }];
  }

  return layer;
}

// ─── Transform (ks) ────────────────────────────────────────────

function buildTransform(
  node: SceneNode,
  anims: INodeAnimation[] | undefined,
  fps: number,
  isRoot: boolean,
): any {
  const x = isRoot ? 0 : node.x + node.width / 2;
  const y = isRoot ? 0 : node.y + node.height / 2;

  const ks: any = {
    o: buildAnimatedValue('opacity', anims, fps, node.opacity * 100, v => v * 100),
    r: buildAnimatedValue('rotation', anims, fps, node.rotation),
    p: buildAnimatedPosition(anims, fps, x, y),
    a: staticMultiValue([node.width / 2, node.height / 2, 0]),
    s: buildAnimatedScale(anims, fps),
  };

  return ks;
}

function buildAnimatedValue(
  prop: keyof AnimatableProperties,
  anims: INodeAnimation[] | undefined,
  fps: number,
  staticValue: number,
  transform?: (v: number) => number,
): any {
  if (!anims) return staticValue2(staticValue);

  const relevantAnim = anims.find(a =>
    a.keyframes.some(kf => kf.properties[prop] !== undefined)
  );
  if (!relevantAnim) return staticValue2(staticValue);

  return animatedValue(relevantAnim, prop, fps, staticValue, transform);
}

function buildAnimatedPosition(
  anims: INodeAnimation[] | undefined,
  fps: number,
  staticX: number,
  staticY: number,
): any {
  if (!anims) return staticMultiValue([staticX, staticY, 0]);

  const xAnim = anims.find(a => a.keyframes.some(kf => kf.properties.x !== undefined));
  const yAnim = anims.find(a => a.keyframes.some(kf => kf.properties.y !== undefined));

  if (!xAnim && !yAnim) return staticMultiValue([staticX, staticY, 0]);

  // Use the first animation that has position keyframes
  const posAnim = xAnim ?? yAnim;
  if (!posAnim) return staticMultiValue([staticX, staticY, 0]);

  const keyframes: any[] = [];
  for (let i = 0; i < posAnim.keyframes.length; i++) {
    const kf = posAnim.keyframes[i];
    const delay = posAnim.delay ?? 0;
    const frame = Math.round(((delay + kf.offset * posAnim.duration) / 1000) * fps);

    const kx = (kf.properties.x ?? 0) + staticX;
    const ky = (kf.properties.y ?? 0) + staticY;

    if (i < posAnim.keyframes.length - 1) {
      const bez = easingToBezier(kf.easing);
      keyframes.push({
        i: { x: bez[2], y: bez[3] },
        o: { x: bez[0], y: bez[1] },
        t: frame,
        s: [kx, ky, 0],
      });
    } else {
      keyframes.push({ t: frame, s: [kx, ky, 0] });
    }
  }

  return { a: 1, k: keyframes };
}

function buildAnimatedScale(
  anims: INodeAnimation[] | undefined,
  fps: number,
): any {
  if (!anims) return staticMultiValue([100, 100, 100]);

  const scaleAnim = anims.find(a =>
    a.keyframes.some(kf =>
      kf.properties.scaleX !== undefined || kf.properties.scaleY !== undefined
    )
  );
  if (!scaleAnim) return staticMultiValue([100, 100, 100]);

  const keyframes: any[] = [];
  for (let i = 0; i < scaleAnim.keyframes.length; i++) {
    const kf = scaleAnim.keyframes[i];
    const delay = scaleAnim.delay ?? 0;
    const frame = Math.round(((delay + kf.offset * scaleAnim.duration) / 1000) * fps);

    const sx = (kf.properties.scaleX ?? 1) * 100;
    const sy = (kf.properties.scaleY ?? 1) * 100;

    if (i < scaleAnim.keyframes.length - 1) {
      const bez = easingToBezier(kf.easing);
      keyframes.push({
        i: { x: [bez[2]], y: [bez[3]] },
        o: { x: [bez[0]], y: [bez[1]] },
        t: frame,
        s: [sx, sy, 100],
      });
    } else {
      keyframes.push({ t: frame, s: [sx, sy, 100] });
    }
  }

  return { a: 1, k: keyframes };
}

function animatedValue(
  anim: INodeAnimation,
  prop: keyof AnimatableProperties,
  fps: number,
  staticValue: number,
  transform?: (v: number) => number,
): any {
  const keyframes: any[] = [];

  for (let i = 0; i < anim.keyframes.length; i++) {
    const kf = anim.keyframes[i];
    const delay = anim.delay ?? 0;
    const frame = Math.round(((delay + kf.offset * anim.duration) / 1000) * fps);
    let val = (kf.properties[prop] as number) ?? staticValue;
    if (transform) val = transform(val);

    if (i < anim.keyframes.length - 1) {
      const bez = easingToBezier(kf.easing);
      keyframes.push({
        i: { x: [bez[2]], y: [bez[3]] },
        o: { x: [bez[0]], y: [bez[1]] },
        t: frame,
        s: [val],
      });
    } else {
      keyframes.push({ t: frame, s: [val] });
    }
  }

  return { a: 1, k: keyframes };
}

// ─── Shapes ────────────────────────────────────────────────────

function buildShapes(node: SceneNode): any[] {
  const shapes: any[] = [];

  // Rectangle shape
  if (node.type === 'ELLIPSE') {
    shapes.push({
      ty: 'el',
      d: 1,
      s: { a: 0, k: [node.width, node.height] },
      p: { a: 0, k: [node.width / 2, node.height / 2] },
      nm: 'Ellipse',
    });
  } else {
    shapes.push({
      ty: 'rc',
      d: 1,
      s: { a: 0, k: [node.width, node.height] },
      p: { a: 0, k: [node.width / 2, node.height / 2] },
      r: { a: 0, k: node.cornerRadius || 0 },
      nm: 'Rectangle',
    });
  }

  // Fill
  const solidFill = node.fills.find(f => f.visible && f.type === 'SOLID');
  if (solidFill) {
    shapes.push({
      ty: 'fl',
      c: { a: 0, k: [solidFill.color.r, solidFill.color.g, solidFill.color.b, solidFill.color.a] },
      o: { a: 0, k: solidFill.opacity * 100 },
      r: 1,
      bm: 0,
      nm: 'Fill',
    });
  }

  // Stroke
  const stroke = node.strokes.find(s => s.visible);
  if (stroke) {
    shapes.push({
      ty: 'st',
      c: { a: 0, k: [stroke.color.r, stroke.color.g, stroke.color.b, stroke.color.a] },
      o: { a: 0, k: stroke.opacity * 100 },
      w: { a: 0, k: stroke.weight },
      lc: 2,
      lj: 2,
      bm: 0,
      nm: 'Stroke',
    });
  }

  return shapes;
}

// ─── Text Data ─────────────────────────────────────────────────

function buildTextData(node: SceneNode): any {
  const textColor = node.fills?.find(f => f.visible && f.type === 'SOLID');
  const fc = textColor
    ? [textColor.color.r, textColor.color.g, textColor.color.b, textColor.color.a]
    : [0, 0, 0, 1];

  const justification = node.textAlignHorizontal === 'CENTER' ? 1
    : node.textAlignHorizontal === 'RIGHT' ? 2
    : node.textAlignHorizontal === 'JUSTIFIED' ? 3 : 0;

  return {
    d: {
      k: [{
        s: {
          s: node.fontSize || 16,
          f: node.fontFamily || 'Arial',
          t: node.text || '',
          j: justification,
          tr: 0,
          lh: node.lineHeight ?? (node.fontSize || 16) * 1.2,
          ls: node.letterSpacing || 0,
          fc,
        },
        t: 0,
      }],
    },
    p: {},
    m: { g: 1, a: { a: 0, k: [0, 0] } },
    a: [],
  };
}

// ─── Helpers ───────────────────────────────────────────────────

function staticValue2(value: number): any {
  return { a: 0, k: value };
}

function staticMultiValue(values: number[]): any {
  return { a: 0, k: values };
}

function resolveNodeId(graph: SceneGraph, rootId: string, anim: INodeAnimation): string | null {
  if (anim.nodeId) {
    if (graph.getNode(anim.nodeId)) return anim.nodeId;
  }
  if (anim.nodeName) {
    return findByName(graph, rootId, anim.nodeName);
  }
  return null;
}

function findByName(graph: SceneGraph, nodeId: string, name: string): string | null {
  const node = graph.getNode(nodeId);
  if (!node) return null;
  if (node.name === name) return node.id;
  for (const childId of node.childIds) {
    const found = findByName(graph, childId, name);
    if (found) return found;
  }
  return null;
}

/** Convert easing to Lottie bezier handles [outX, outY, inX, inY] */
function easingToBezier(easing: Easing | undefined): [number, number, number, number] {
  if (!easing) return [0.25, 0.1, 0.25, 1]; // CSS 'ease' default

  if (Array.isArray(easing)) return easing;

  if (typeof easing === 'string') {
    const MAP: Partial<Record<EasingPreset, [number, number, number, number]>> = {
      'linear': [0, 0, 1, 1],
      'ease': [0.25, 0.1, 0.25, 1],
      'ease-in': [0.42, 0, 1, 1],
      'ease-out': [0, 0, 0.58, 1],
      'ease-in-out': [0.42, 0, 0.58, 1],
      'ease-in-quad': [0.55, 0.085, 0.68, 0.53],
      'ease-out-quad': [0.25, 0.46, 0.45, 0.94],
      'ease-in-out-quad': [0.455, 0.03, 0.515, 0.955],
      'ease-in-cubic': [0.55, 0.055, 0.675, 0.19],
      'ease-out-cubic': [0.215, 0.61, 0.355, 1],
      'ease-in-out-cubic': [0.645, 0.045, 0.355, 1],
      'ease-in-expo': [0.95, 0.05, 0.795, 0.035],
      'ease-out-expo': [0.19, 1, 0.22, 1],
      'ease-in-out-expo': [1, 0, 0, 1],
      'ease-in-back': [0.6, -0.28, 0.735, 0.045],
      'ease-out-back': [0.175, 0.885, 0.32, 1.275],
      'ease-in-out-back': [0.68, -0.55, 0.265, 1.55],
    };
    return MAP[easing] ?? [0.25, 0.1, 0.25, 1];
  }

  // Spring → approximate cubic-bezier from spring config
  if (easing.type === 'spring') {
    const { stiffness = 100, damping = 10, mass = 1 } = easing;
    const zeta = damping / (2 * Math.sqrt(stiffness * mass));
    // Underdamped springs overshoot → ease-out-back style
    // Overdamped → ease-out style
    if (zeta < 1) {
      // Overshoot amount scales with underdamping
      const overshoot = Math.min(2, 1 + (1 - zeta) * 0.5);
      return [0.175, 0.885, 0.32, overshoot];
    }
    // Critically/overdamped → smooth ease-out
    return [0.25, 1, 0.35, 1];
  }

  return [0.25, 0.1, 0.25, 1];
}
