/**
 * Reframe Standalone Engine — Geometry & Transforms
 *
 * Pure math: rotation, bounding boxes, coordinate spaces.
 */

import type { Vector, Rect } from './types';

// ─── Angle Conversions ──────────────────────────────────────────

export function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function radToDeg(radians: number): number {
  return (radians * 180) / Math.PI;
}

// ─── Point Rotation ─────────────────────────────────────────────

/**
 * Rotate point (px,py) around center (cx,cy) by `rad` radians.
 */
export function rotatePoint(
  px: number, py: number,
  cx: number, cy: number,
  rad: number,
): Vector {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = px - cx;
  const dy = py - cy;
  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  };
}

// ─── Rotated Corners ────────────────────────────────────────────

/**
 * Compute the 4 corners of a rectangle centered at (cx,cy)
 * with half-width hw, half-height hh, rotated by `rotationDeg` degrees.
 */
export function rotatedCorners(
  cx: number, cy: number,
  hw: number, hh: number,
  rotationDeg: number,
): [Vector, Vector, Vector, Vector] {
  const rad = degToRad(rotationDeg);
  return [
    rotatePoint(cx - hw, cy - hh, cx, cy, rad), // top-left
    rotatePoint(cx + hw, cy - hh, cx, cy, rad), // top-right
    rotatePoint(cx + hw, cy + hh, cx, cy, rad), // bottom-right
    rotatePoint(cx - hw, cy + hh, cx, cy, rad), // bottom-left
  ];
}

// ─── Axis-Aligned Bounding Box of Rotated Rect ──────────────────

export interface RotatedBBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
}

/**
 * Compute axis-aligned bounding box of a rectangle at (x,y)
 * with dimensions (w,h), rotated by `rotationDeg` degrees.
 */
export function rotatedBBox(
  x: number, y: number,
  w: number, h: number,
  rotationDeg: number,
): RotatedBBox {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const corners = rotatedCorners(cx, cy, w / 2, h / 2, rotationDeg);

  let left = Infinity, right = -Infinity;
  let top = Infinity, bottom = -Infinity;

  for (const c of corners) {
    if (c.x < left) left = c.x;
    if (c.x > right) right = c.x;
    if (c.y < top) top = c.y;
    if (c.y > bottom) bottom = c.y;
  }

  return { left, right, top, bottom, centerX: cx, centerY: cy };
}

// ─── Absolute Position (walk parent chain) ──────────────────────

/**
 * Accumulate (x,y) up the parent chain.
 * `getNode` — lookup function, `stopType` — node type to stop at (e.g. 'CANVAS').
 */
export function computeAbsolutePosition(
  nodeId: string,
  getNode: (id: string) => { x: number; y: number; parentId: string | null; type: string } | undefined,
  stopType = 'CANVAS',
): Vector {
  let ax = 0;
  let ay = 0;
  let current = getNode(nodeId);

  while (current) {
    ax += current.x;
    ay += current.y;
    if (current.type === stopType || !current.parentId) break;
    current = getNode(current.parentId);
  }

  return { x: ax, y: ay };
}

/**
 * Compute absolute bounding box for a node.
 */
export function computeAbsoluteBounds(
  nodeId: string,
  getNode: (id: string) => { x: number; y: number; width: number; height: number; parentId: string | null; type: string } | undefined,
  stopType = 'CANVAS',
): Rect {
  const pos = computeAbsolutePosition(nodeId, getNode, stopType);
  const node = getNode(nodeId);
  return {
    x: pos.x,
    y: pos.y,
    width: node?.width ?? 0,
    height: node?.height ?? 0,
  };
}

// ─── Affine Transform Helpers ───────────────────────────────────

/**
 * 2x3 affine matrix: [[a, b, tx], [c, d, ty]]
 */
export type AffineMatrix = [[number, number, number], [number, number, number]];

/**
 * Build a 2x3 affine transform from position, rotation, and optional flip.
 */
export function buildAffineTransform(
  x: number, y: number,
  w: number, h: number,
  rotationDeg: number,
  flipX = false, flipY = false,
): AffineMatrix {
  const rad = degToRad(rotationDeg);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // Scale for flip
  const sx = flipX ? -1 : 1;
  const sy = flipY ? -1 : 1;

  // Rotation center
  const cx = w / 2;
  const cy = h / 2;

  const a = cos * sx;
  const b = -sin * sy;
  const c = sin * sx;
  const d = cos * sy;

  // Translation: position + rotation around center
  const tx = x + cx - (a * cx + b * cy);
  const ty = y + cy - (c * cx + d * cy);

  return [[a, b, tx], [c, d, ty]];
}
