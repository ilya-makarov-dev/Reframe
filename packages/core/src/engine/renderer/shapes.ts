/**
 * Reframe Standalone Engine — Shape & Path Creation
 *
 * Creates CanvasKit paths from SceneNode geometry.
 */

import type { ICanvasKit, IRPath } from './types';
import type { SceneNode } from '../types';

// ─── Rect Helpers ───────────────────────────────────────────────

export function nodeRect(ck: ICanvasKit, node: SceneNode): Float32Array {
  return ck.LTRBRect(0, 0, node.width, node.height);
}

export function hasRadius(node: SceneNode): boolean {
  if (node.independentCorners) {
    return (
      node.topLeftRadius > 0 ||
      node.topRightRadius > 0 ||
      node.bottomRightRadius > 0 ||
      node.bottomLeftRadius > 0
    );
  }
  return node.cornerRadius > 0;
}

// ─── RRect Creation ─────────────────────────────────────────────

export function makeRRect(ck: ICanvasKit, node: SceneNode): Float32Array {
  const rect = nodeRect(ck, node);

  if (node.independentCorners) {
    const tl = node.topLeftRadius;
    const tr = node.topRightRadius;
    const br = node.bottomRightRadius;
    const bl = node.bottomLeftRadius;
    // CanvasKit RRect: [x, y, right, bottom, tlx, tly, trx, try, brx, bry, blx, bly]
    return new Float32Array([
      0, 0, node.width, node.height,
      tl, tl, tr, tr, br, br, bl, bl,
    ]);
  }

  return ck.RRectXY(rect, node.cornerRadius, node.cornerRadius);
}

// ─── Shape Path Creation ────────────────────────────────────────

/**
 * Create a path representing the node's shape.
 */
export function makeNodeShapePath(ck: ICanvasKit, node: SceneNode): IRPath {
  const path = new ck.Path();
  const rect = nodeRect(ck, node);

  switch (node.type) {
    case 'ELLIPSE':
      if (node.arcData) {
        const oval = rect;
        const startDeg = (node.arcData.startingAngle * 180) / Math.PI;
        const endDeg = (node.arcData.endingAngle * 180) / Math.PI;
        let sweepDeg = endDeg - startDeg;
        if (sweepDeg < 0) sweepDeg += 360;

        if (node.arcData.innerRadius > 0) {
          // Donut arc
          path.addArc(oval, startDeg, sweepDeg);
          const innerR = node.arcData.innerRadius;
          const cx = node.width / 2;
          const cy = node.height / 2;
          const innerPath = new ck.Path();
          innerPath.addOval(ck.LTRBRect(
            cx - cx * innerR, cy - cy * innerR,
            cx + cx * innerR, cy + cy * innerR,
          ));
          path.op(innerPath, ck.PathOp.Difference);
          innerPath.delete();
        } else if (Math.abs(sweepDeg - 360) < 0.01) {
          path.addOval(oval);
        } else {
          path.addArc(oval, startDeg, sweepDeg);
          path.close();
        }
      } else {
        path.addOval(rect);
      }
      break;

    case 'STAR':
    case 'POLYGON':
      makePolygonPath(ck, path, node);
      break;

    case 'LINE':
      path.moveTo(0, 0);
      path.lineTo(node.width, 0);
      break;

    default:
      if (hasRadius(node)) {
        path.addRRect(makeRRect(ck, node));
      } else {
        path.addRect(rect);
      }
      break;
  }

  return path;
}

// ─── Polygon / Star Path ────────────────────────────────────────

function makePolygonPath(ck: ICanvasKit, path: IRPath, node: SceneNode): void {
  const n = node.pointCount || 3;
  const isStar = node.type === 'STAR';
  const cx = node.width / 2;
  const cy = node.height / 2;
  const rx = node.width / 2;
  const ry = node.height / 2;
  const totalPoints = isStar ? n * 2 : n;
  const angleOffset = -Math.PI / 2;

  for (let i = 0; i < totalPoints; i++) {
    const angle = angleOffset + (2 * Math.PI * i) / totalPoints;
    const isInnerPoint = isStar && i % 2 === 1;
    const rad = isInnerPoint ? node.starInnerRadius : 1;
    const px = cx + rx * rad * Math.cos(angle);
    const py = cy + ry * rad * Math.sin(angle);

    if (i === 0) path.moveTo(px, py);
    else path.lineTo(px, py);
  }

  path.close();
}

// ─── Clip Node Shape ────────────────────────────────────────────

export function clipNodeShape(
  ck: ICanvasKit,
  canvas: { clipPath: Function; clipRRect: Function; clipRect: Function },
  node: SceneNode,
): void {
  if (node.type === 'ELLIPSE') {
    const path = new ck.Path();
    path.addOval(nodeRect(ck, node));
    canvas.clipPath(path, ck.ClipOp.Intersect, true);
    path.delete();
  } else if (hasRadius(node)) {
    canvas.clipRRect(makeRRect(ck, node), ck.ClipOp.Intersect, true);
  } else {
    canvas.clipRect(nodeRect(ck, node), ck.ClipOp.Intersect, true);
  }
}
