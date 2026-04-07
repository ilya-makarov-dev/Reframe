/**
 * Letterbox-aware geometry + anti-bleed: strips paints/blurs that smear into pillar/letterbox bars
 * without nuking gradients, images, small CTA solids, or glow layers.
 */

import { type INode, NodeType, MIXED, type IPaint } from '../../host';

/** Bounds of direct children in parent coords */
export function getChildrenBounds(
    container: INode
): { x: number; y: number; width: number; height: number } | null {
    const children = (container.children ?? []).filter((c: INode) => !c.removed);
    if (children.length === 0) return null;
    let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
    for (const c of children) {
        const x = c.x;
        const y = c.y;
        const w = c.width;
        const h = c.height;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Axis-aligned union of all descendants in root-local coordinates (frame origin).
 * Handles real vector/clip bounding boxes better than a single Group's x/y/width.
 * Non-rotated root: children's absoluteBoundingBox minus root bbox.
 */
export function getDescendantUnionBoundsInRootLocal(root: INode): {
    x: number;
    y: number;
    width: number;
    height: number;
} | null {
    const r = root.absoluteBoundingBox;
    if (!r) return null;
    let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
    const visit = (n: INode) => {
        if (n !== root && 'absoluteBoundingBox' in n && n.absoluteBoundingBox) {
            const b = n.absoluteBoundingBox;
            const x1 = b.x - r.x;
            const y1 = b.y - r.y;
            const x2 = x1 + b.width;
            const y2 = y1 + b.height;
            minX = Math.min(minX, x1, x2);
            minY = Math.min(minY, y1, y2);
            maxX = Math.max(maxX, x1, x2);
            maxY = Math.max(maxY, y1, y2);
        }
        if (n.type === NodeType.Instance) return;
        if (n.children) {
            for (const c of n.children) {
                if (!('removed' in c && c.removed)) visit(c);
            }
        }
    };
    for (const c of root.children ?? []) {
        if (!('removed' in c && c.removed)) visit(c);
    }
    if (!Number.isFinite(minX) || maxX - minX < 1 || maxY - minY < 1) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Node coordinates in root frame coordinate system (like guide-scaler getBoundsInFrame). */
function boundsInRootFrame(node: INode, root: INode): { x: number; y: number; w: number; h: number } {
    let x = node.x;
    let y = node.y;
    const w = node.width;
    const h = node.height;
    let p: INode | null = node.parent;
    while (p && p !== root) {
        x += p.x;
        y += p.y;
        p = p.parent;
    }
    return { x, y, w, h };
}

function walkSceneTree(node: INode, visit: (n: INode) => void): void {
    visit(node);
    if (node.children && node.type !== NodeType.Instance) {
        for (const c of node.children) {
            if (!('removed' in c && c.removed)) walkSceneTree(c, visit);
        }
    }
}

const BLEED_STRIP_NODE_TYPES = new Set<string>([
    'RECTANGLE',
    'ELLIPSE',
    'POLYGON',
    'STAR',
    'FRAME',
    'VECTOR'
]);

/** Don't clear all fills: engine often has solid + IMAGE — clearing removes the image too. */
function fillsContainVisibleImage(fills: readonly IPaint[]): boolean {
    for (const f of fills) {
        if ('visible' in f && f.visible === false) continue;
        if (f.type === 'IMAGE') return true;
    }
    return false;
}

function fillsContainVisibleGradient(fills: readonly IPaint[]): boolean {
    for (const f of fills) {
        if ('visible' in f && f.visible === false) continue;
        const t = f.type;
        if (
            t === 'GRADIENT_LINEAR' ||
            t === 'GRADIENT_RADIAL' ||
            t === 'GRADIENT_ANGULAR' ||
            t === 'GRADIENT_DIAMOND'
        ) {
            return true;
        }
    }
    return false;
}

/** Blur layer — usually glare/glow; clearing fills or removing blur kills the palette (9:16→16:9). */
function nodeHasVisibleBlurEffect(node: INode): boolean {
    if (!('effects' in node)) return false;
    const eff = node.effects;
    if ((eff as unknown) === MIXED || !Array.isArray(eff)) return false;
    for (const e of eff) {
        if (e.visible === false) continue;
        if (e.type === 'LAYER_BLUR' || e.type === 'BACKGROUND_BLUR') return true;
    }
    return false;
}

/** Don't touch fill/blur during anti-bleed — otherwise Linear gradients, button gradients, ellipse highlights disappear. */
function preserveBleedingNodePaint(node: INode, fills: readonly IPaint[] | typeof MIXED): boolean {
    if ((fills as unknown) === MIXED || !Array.isArray(fills) || fills.length === 0) {
        return nodeHasVisibleBlurEffect(node);
    }
    return (
        fillsContainVisibleImage(fills) ||
        fillsContainVisibleGradient(fills) ||
        nodeHasVisibleBlurEffect(node)
    );
}

/** Only visible SOLID fills (no IMAGE/gradient) — typical CTA button fill. */
function fillsAreVisibleSolidOnly(fills: readonly IPaint[]): boolean {
    let anyVisible = false;
    for (const f of fills) {
        if ('visible' in f && f.visible === false) continue;
        if (f.type !== 'SOLID') return false;
        anyVisible = true;
    }
    return anyVisible;
}

/**
 * Black/colored RECT and small FRAME with SOLID often geometrically overlap letterbox strips;
 * old anti-bleed cleared fills → button shape exists in layers but invisible.
 * Large solid panels (>20% of frame) can still be cleared.
 */
function preserveCompactSolidBleedCandidate(
    node: INode,
    fills: readonly IPaint[],
    root: INode
): boolean {
    if (!BLEED_STRIP_NODE_TYPES.has(node.type)) return false;
    if (!fillsAreVisibleSolidOnly(fills)) return false;
    const b = boundsInRootFrame(node, root);
    const nodeArea = Math.max(b.w * b.h, 1);
    const frameArea = Math.max(root.width * root.height, 1);
    if (nodeArea / frameArea > 0.2) return false;
    return true;
}

function shouldPreserveFillsAgainstLetterboxStrip(
    node: INode,
    root: INode,
    fills: readonly IPaint[] | typeof MIXED
): boolean {
    if (preserveBleedingNodePaint(node, fills)) return true;
    if ((fills as unknown) === MIXED || !Array.isArray(fills) || fills.length === 0) return false;
    return preserveCompactSolidBleedCandidate(node, fills, root);
}

/**
 * Descendant layers with gradient/image that geometrically overlap letterbox strips create bleed artifacts.
 * Root Frame is not traversed (node === root) — its fill is not cleared here.
 */
export function stripBleedingPaintOutsideLetterbox(
    root: INode,
    offX: number,
    offY: number,
    scaledW: number,
    scaledH: number,
    newWidth: number,
    newHeight: number
): { clearedFills: number; strippedBlurs: number } {
    const contentR = offX + scaledW;
    const contentB = offY + scaledH;
    const horizBars = offX > 2 || offX + scaledW < newWidth - 2;
    const vertBars = offY > 2 || offY + scaledH < newHeight - 2;
    let clearedFills = 0;
    let strippedBlurs = 0;

    walkSceneTree(root, node => {
        if (node === root || node.removed) return;
        if (!BLEED_STRIP_NODE_TYPES.has(node.type)) return;

        const b = boundsInRootFrame(node, root);
        const bleedsH = b.x < offX - 1 || b.x + b.w > contentR + 1;
        const bleedsV = b.y < offY - 1 || b.y + b.h > contentB + 1;
        const bleedsIntoBars = (horizBars && bleedsH) || (vertBars && bleedsV);
        if (!bleedsIntoBars) return;

        const ix1 = Math.max(b.x, offX);
        const iy1 = Math.max(b.y, offY);
        const ix2 = Math.min(b.x + b.w, contentR);
        const iy2 = Math.min(b.y + b.h, contentB);
        const innerArea = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
        const nodeArea = Math.max(b.w * b.h, 1);
        if (nodeArea < 600) return;
        if (innerArea / nodeArea > 0.88) return;

        if ('fills' in node) {
            const f = node.fills;
            if ((f as unknown) !== MIXED && Array.isArray(f) && f.length > 0) {
                if (!shouldPreserveFillsAgainstLetterboxStrip(node, root, f)) {
                    try {
                        node.fills = [];
                        clearedFills += 1;
                    } catch (_) {}
                }
            }
        }
        if ('effects' in node && horizBars && bleedsH) {
            const f = 'fills' in node ? node.fills! : MIXED;
            if (shouldPreserveFillsAgainstLetterboxStrip(node, root, f)) {
                return;
            }
            if ((node.effects as unknown) !== MIXED && node.effects!.length > 0) {
                const kept = node.effects!.filter(
                    (e: any) => e.type !== 'LAYER_BLUR' && e.type !== 'BACKGROUND_BLUR'
                );
                if (kept.length < node.effects!.length) {
                    try {
                        node.effects = kept;
                        strippedBlurs += 1;
                    } catch (_) {}
                }
            }
        }
    });

    return { clearedFills, strippedBlurs };
}
