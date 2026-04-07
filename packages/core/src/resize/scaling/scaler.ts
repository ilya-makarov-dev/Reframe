import { type INode, NodeType, MIXED, type IFontName } from '../../host';
import { getHost } from '../../host/context';
import { BannerElementType } from '../contracts/types';
import { uniformScaleForLetterbox } from '../geometry/fit';

// Minimum font sizes by element type. Only used when scaleElement is called with elementType (guide).
// Cluster-scale calls scaleElement(..., undefined), where minSize is always 8.
const MIN_FONT_SIZES: Record<string, number> = {
  title: 18,
  description: 12,
  disclaimer: 10,
  ageRating: 10,
  /** Too low threshold produced microscopic label after cross-scale */
  button: 12
};

/**
 * Scales element (recursively for groups and frames) considering type and limits.
 */
export async function scaleElement(
  node: INode,
  scale: number,
  elementType?: BannerElementType,
  recursive: boolean = true
): Promise<void> {
  if (node.removed) return;

  // 1. Recursion for containers (groups, frames)
  // IMPORTANT: We do NOT recurse into INSTANCE since their children are read-only
  if (
    recursive &&
    (node.type === NodeType.Group ||
      node.type === NodeType.Frame ||
      node.type === NodeType.Component ||
      node.type === NodeType.BooleanOp)
  ) {
    for (const child of node.children!) {
      // First scale child content (recursively)
      await scaleElement(child, scale, elementType, true);

      // Then scale its position relative to parent
      if ('x' in child && 'y' in child) {
        child.x *= scale;
        child.y *= scale;
      }
    }
  }

  // 2. Scaling specific types
  if (node.type === NodeType.Text) {
    const len = node.characters!.length;
    if (len === 0) return;

    // Load fonts
    try {
      if (node.fontName === MIXED) {
        const uniqueFonts = new Set<string>();
        for (let i = 0; i < len; i++) {
          uniqueFonts.add(JSON.stringify(node.getRangeFontName!(i, i + 1)));
        }
        for (const f of uniqueFonts) {
          await getHost().loadFont(JSON.parse(f));
        }
      } else {
        await getHost().loadFont(node.fontName as IFontName);
      }
    } catch (_) {}

    const minSize = (elementType && MIN_FONT_SIZES[elementType]) || 8;

    // Apply new font size
    if (node.fontSize !== MIXED) {
      const newSize = Math.max((node.fontSize as number) * scale, minSize);
      node.fontSize = Math.round(newSize);
    } else {
      for (let i = 0; i < len; i++) {
        const currentSize = node.getRangeFontSize!(i, i + 1) as number;
        const newSize = Math.max(currentSize * scale, minSize);
        node.setRangeFontSize!(i, i + 1, Math.round(newSize));
      }
    }
  }

  // 3. Base resize
  // For INSTANCE we only resize the container itself (this is allowed),
  // the engine auto-scales content by internal constraints.
  if ('resize' in node && node.type !== NodeType.Group) {
    try {
      node.resize(node.width * scale, node.height * scale);
      scaleCornerRadius(node, scale);
    } catch (_) {}
  }
}

/** Remove constraints from subtree (except INSTANCE) so resize/rescale doesn't scatter layers. */
export function freezeConstraintsSubtree(node: INode): void {
  if ('constraints' in node && node.parent && node.parent.type !== NodeType.Instance) {
    try {
      node.constraints = { horizontal: 'MIN', vertical: 'MIN' };
    } catch (_) {}
  }
  if (node.children && node.type !== NodeType.Instance) {
    for (const c of node.children) {
      if (!('removed' in c && c.removed)) freezeConstraintsSubtree(c);
    }
  }
}

async function loadAllFontsForText(t: INode): Promise<void> {
  const len = t.characters!.length;
  if (len === 0) return;
  try {
    if (t.fontName === MIXED) {
      const seen = new Set<string>();
      for (let i = 0; i < len; i++) {
        seen.add(JSON.stringify(t.getRangeFontName!(i, i + 1)));
      }
      for (const f of seen) await getHost().loadFont(JSON.parse(f) as IFontName);
    } else {
      await getHost().loadFont(t.fontName as IFontName);
    }
  } catch (_) {}
}

/** Node bbox in button frame coordinates (as in guide-scaler). */
function getBoundsInButtonFrame(node: INode, buttonRoot: INode): { x: number; y: number; w: number; h: number } {
  if (!node || ('removed' in node && node.removed)) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  if (!buttonRoot || ('removed' in buttonRoot && buttonRoot.removed)) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  let x = 'x' in node ? Number(node.x) || 0 : 0;
  let y = 'y' in node ? Number(node.y) || 0 : 0;
  const w = 'width' in node ? node.width : 0;
  const h = 'height' in node ? node.height : 0;
  let p: INode | null = node.parent;
  while (p && p !== buttonRoot) {
    if ('x' in p) x += Number(p.x) || 0;
    if ('y' in p) y += Number(p.y) || 0;
    p = p.parent;
  }
  if (p !== buttonRoot) {
    return { x: 0, y: 0, w: Math.max(0, w), h: Math.max(0, h) };
  }
  return { x, y, w, h };
}

function setTopLeftInButtonFrame(node: INode, frame: INode, frameX: number, frameY: number): void {
  if (!node || ('removed' in node && node.removed)) return;
  if (node.parent === frame) {
    node.x = Math.round(frameX);
    node.y = Math.round(frameY);
  } else {
    const par = node.parent;
    if (!par) return;
    const pb = getBoundsInButtonFrame(par as INode, frame);
    node.x = Math.round(frameX - pb.x);
    node.y = Math.round(frameY - pb.y);
  }
}

function translateNodeInButtonFrame(node: INode, frame: INode, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  const b = getBoundsInButtonFrame(node, frame);
  setTopLeftInButtonFrame(node, frame, b.x + dx, b.y + dy);
}

function isProbableFullBleedButtonBg(node: INode, root: INode): boolean {
  if (!('width' in node) || !('height' in node)) return false;
  const nw = node.width;
  const nh = node.height;
  const fw = Math.max(root.width, 1);
  const fh = Math.max(root.height, 1);
  return nw >= fw * 0.88 && nh >= fh * 0.88;
}

/** All TEXT nodes under button; don't recurse into INSTANCE (has its own system). */
function collectTextsUnderButtonRoot(root: INode): INode[] {
  const out: INode[] = [];
  const walk = (n: INode): void => {
    if (n.removed) return;
    if (n.type === NodeType.Text) out.push(n);
    if (n.type === NodeType.Instance) return;
    if (n.children) {
      for (const c of n.children) walk(c);
    }
  };
  for (const c of root.children ?? []) walk(c);
  return out;
}

/**
 * Direct children of button that participate in centering: not full-bleed backgrounds, not instances.
 */
function collectForegroundLayersForCentering(root: INode): INode[] {
  const layers: INode[] = [];
  for (const c of root.children ?? []) {
    if (c.removed || c.type === NodeType.Instance) continue;
    if (isProbableFullBleedButtonBg(c, root)) continue;
    layers.push(c);
  }
  return layers;
}

async function applyButtonTypography(t: INode, fw: number, fh: number, fontTarget: number): Promise<void> {
  await loadAllFontsForText(t);
  try {
    if (t.fontSize !== MIXED) {
      const fs = t.fontSize as number;
      if (fs < fontTarget * 0.92) t.fontSize = fontTarget;
    } else {
      for (let i = 0; i < t.characters!.length; i++) {
        const r = t.getRangeFontSize!(i, i + 1) as number;
        if (r < fontTarget * 0.92) t.setRangeFontSize!(i, i + 1, fontTarget);
      }
    }
    t.textAlignHorizontal = 'CENTER';
    t.textAlignVertical = 'CENTER';
    if (t.textAutoResize === 'HEIGHT') {
      try {
        t.resize(Math.min(fw * 0.94, fw), Math.max(8, t.height));
      } catch (_) {}
    } else if (t.textAutoResize === 'WIDTH_AND_HEIGHT') {
      try {
        t.resize(Math.min(fw * 0.94, fw), Math.min(fh * 0.88, fh));
      } catch (_) {}
    }
  } catch (_) {}
}

/**
 * Center button content without forced typography.
 * Used when button was already cloned from Remember master
 * and we don't want to overwrite fontSize "by heuristic" (fh*0.30).
 */
function centerButtonLabelLayout(button: INode): void {
  if (!button || button.removed) return;
  if (button.type !== NodeType.Frame && button.type !== NodeType.Component && button.type !== NodeType.Group) return;
  if (!button.children || !('width' in button)) return;

  const root = button;

  // Set NONE so Auto Layout doesn't override positions.
  if ((root.type === NodeType.Frame || root.type === NodeType.Component) && 'layoutMode' in root) {
    try {
      root.layoutMode = 'NONE';
    } catch (_) {}
  }

  const layers = collectForegroundLayersForCentering(root);
  const texts = collectTextsUnderButtonRoot(root);
  const box = unionBboxInFrame(layers.length > 0 ? layers : texts, root);
  if (!box) return;

  const fw = Math.max(root.width, 1);
  const fh = Math.max(root.height, 1);

  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const dx = fw / 2 - cx;
  const dy = fh / 2 - cy;
  if (Math.abs(dx) < 0.25 && Math.abs(dy) < 0.25) return;

  const translateLayers = layers.length > 0 ? layers : texts;
  for (const n of translateLayers) {
    try {
      translateNodeInButtonFrame(n, root, dx, dy);
    } catch (_) {}
  }
}

function unionBboxInFrame(
  nodes: INode[],
  buttonRoot: INode
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const n of nodes) {
    const b = getBoundsInButtonFrame(n, buttonRoot);
    if (b.w <= 0 || b.h <= 0) continue;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * After rescale/scaleElement: NONE + typography of all TEXT + shift **all content** (icon+text, group etc.)
 * to button center. Full-frame backdrop excluded from bbox — relative positions preserved.
 */
export async function finalizeButtonLabelLayout(button: INode): Promise<void> {
  if (button.removed) return;
  if (button.type !== NodeType.Frame && button.type !== NodeType.Component && button.type !== NodeType.Group) return;
  if (!button.children || !('width' in button)) return;

  const root = button;
  if (
    (root.type === NodeType.Frame || root.type === NodeType.Component) &&
    'layoutMode' in root
  ) {
    try {
      root.layoutMode = 'NONE';
    } catch (_) {}
  }

  const fw = Math.max(root.width, 1);
  const fh = Math.max(root.height, 1);
  const fontTarget = Math.max(13, Math.min(44, Math.round(fh * 0.30)));

  const texts = collectTextsUnderButtonRoot(root);
  if (texts.length === 0) return;

  for (const t of texts) await applyButtonTypography(t, fw, fh, fontTarget);

  let layers = collectForegroundLayersForCentering(root);
  if (layers.length === 0) {
    layers = texts;
  }

  const box = unionBboxInFrame(layers, root);
  if (!box) return;

  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const dx = fw / 2 - cx;
  const dy = fh / 2 - cy;
  if (Math.abs(dx) < 0.25 && Math.abs(dy) < 0.25) return;

  for (const n of layers) {
    try {
      translateNodeInButtonFrame(n, root, dx, dy);
    } catch (_) {}
  }
}

/**
 * Button/badge: rescale when possible; otherwise NONE + scaleElement.
 * Always finalize at the end — geometric label centering (without fickle Auto Layout).
 */
export async function scaleButtonFrameUniform(
  node: INode,
  scale: number,
  opts?: { preserveTypography?: boolean }
): Promise<void> {
  return scaleButtonFrameUniformWithOptions(node, scale, opts);
}

async function scaleButtonFrameUniformWithOptions(
  node: INode,
  scale: number,
  opts?: { preserveTypography?: boolean }
): Promise<void> {
  if (node.removed || scale <= 0 || !Number.isFinite(scale)) return;
  const maybeRescale = node as INode & { rescale?: (s: number) => void };
  if (typeof maybeRescale.rescale === 'function') {
    try {
      maybeRescale.rescale(scale);
      if (opts?.preserveTypography) centerButtonLabelLayout(node);
      else await finalizeButtonLabelLayout(node);
      return;
    } catch (_) {}
  }
  if ((node.type === NodeType.Frame || node.type === NodeType.Component) && 'layoutMode' in node) {
    try {
      node.layoutMode = 'NONE';
    } catch (_) {}
  }
  freezeConstraintsSubtree(node);
  await scaleElement(node, scale, 'button', true);
  if (opts?.preserveTypography) centerButtonLabelLayout(node);
  else await finalizeButtonLabelLayout(node);
}

function scaleCornerRadius(node: INode, scale: number): void {
  if (!('cornerRadius' in node)) return;
  const r = (node as { cornerRadius?: number }).cornerRadius;
  if (typeof r !== 'number') return;
  (node as { cornerRadius: number }).cornerRadius = Math.max(0, Math.round(r * scale * 100) / 100);
}

/**
 * Stretches container (frame/group) with child scaling — guide only (background by semantics/geometry, not by name).
 * Called only from guide-scaler; cluster-scale doesn't use this function.
 * Rounding child x/y — to prevent ellipses/flares from drifting due to subpixels.
 */
function stretchChildren(container: INode, scaleX: number, scaleY: number): void {
  if (!container.children || container.type === NodeType.Instance) return;
  for (const child of container.children) {
    if (child.removed) continue;
    child.x = Math.round(child.x * scaleX);
    child.y = Math.round(child.y * scaleY);
    try {
      child.resize(child.width * scaleX, child.height * scaleY);
      scaleCornerRadius(child, Math.min(scaleX, scaleY));
    } catch (_) {}
    stretchChildren(child, scaleX, scaleY);
  }
}

/**
 * Fit background container (frame with children) to W*H. Guide-scaler only.
 * Cluster-scale doesn't use this function. Single scale (uniform), cover + center.
 */
export function stretchBackgroundToFill(node: INode, width: number, height: number): void {
  try {
    if (node.type === NodeType.Frame) {
      node.layoutMode = 'NONE';
    }
    const oldW = Math.max(1, node.width);
    const oldH = Math.max(1, node.height);
    const scaleX = width / oldW;
    const scaleY = height / oldH;
    const scale = Math.max(scaleX, scaleY);
    stretchChildren(node, scale, scale);
    const newW = Math.round(oldW * scale);
    const newH = Math.round(oldH * scale);
    node.resize(newW, newH);
  } catch (_) {}
}

/**
 * Nodes wider/taller than target frame (tw*th) — one uniform rescale each, bottom-up.
 * No "2x frame" cap (that produced exactly ~3993 at 1920); fit into actual tw/th.
 */
function clampOversizedNodesToTargetFrame(n: INode, tw: number, th: number): void {
  const margin = 1.012;
  const capW = Math.max(tw, 1) * margin;
  const capH = Math.max(th, 1) * margin;
  if (n.children && n.type !== NodeType.Instance) {
    const kids = [...n.children];
    for (const c of kids) {
      if (!c.removed) clampOversizedNodesToTargetFrame(c, tw, th);
    }
  }
  if (n.type === NodeType.Instance) return;
  const w = n.width;
  const h = n.height;
  if (w <= 0 || h <= 0) return;
  if (w <= capW && h <= capH) return;
  const r = Math.min(
    uniformScaleForLetterbox(w, h, capW, capH, 'contain'),
    1
  );
  if (r >= 0.999) return;
  try {
    if (n.rescale) {
      n.rescale(r);
    } else {
      n.resize(Math.max(1, Math.round(w * r)), Math.max(1, Math.round(h * r)));
    }
  } catch (_) {}
}

/**
 * Stretches container and entire child tree to exactly width*height (scaleX != scaleY).
 * IMPORTANT: before manual stretch, set constraints MIN on subtree — otherwise after root resize
 * the engine with SCALE re-stretches children and inflates leaves (Image etc.) to tens of thousands of px.
 */
export function stretchBackgroundNonUniformToFill(node: INode, width: number, height: number): void {
  try {
    if (node.type === NodeType.Frame) {
      node.layoutMode = 'NONE';
    }
    freezeConstraintsSubtree(node);
    const oldW = Math.max(1, node.width);
    const oldH = Math.max(1, node.height);
    const scaleX = width / oldW;
    const scaleY = height / oldH;
    stretchChildren(node, scaleX, scaleY);
    node.resize(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
    clampOversizedNodesToTargetFrame(node, width, height);
  } catch (_) {}
}

/**
 * Scales background to fill entire space (cover + center). For a single filled node without children.
 */
export function scaleToFill(node: INode, width: number, height: number): void {
  if ('resize' in node && 'width' in node && 'height' in node) {
    const scaleX = width / node.width;
    const scaleY = height / node.height;
    const scale = Math.max(scaleX, scaleY);
    const newWidth = node.width * scale;
    const newHeight = node.height * scale;
    try {
      node.resize(newWidth, newHeight);
      scaleCornerRadius(node, scale);
      node.x = Math.round((width - newWidth) / 2);
      node.y = Math.round((height - newHeight) / 2);
    } catch (_) {}
  }
}

/**
 * Calculates the scale factor.
 */
export function calculateScale(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
): number {
  const scaleX = targetWidth / sourceWidth;
  const scaleY = targetHeight / sourceHeight;

  // Use larger factor to enlarge elements
  // Cap maximum enlargement at 10x (enough for any preview -> banner)
  const maxScale = Math.max(scaleX, scaleY);
  return Math.min(maxScale, 10);
}
