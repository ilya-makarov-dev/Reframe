import { type INode, type IPaint, MIXED } from '../../host';

import type { SessionSlotSnapshot } from './session-slots';

export function paintFingerprint(p: IPaint): number {
  if (p.type === 'SOLID') {
    return (p as any).color.r * 1000 + (p as any).color.g * 100 + (p as any).color.b * 10 + ((p as any).opacity || 1);
  }
  return p.type === 'IMAGE' ? 9999 : 5555;
}

export function compositeVisiblePaintsFingerprint(paints: readonly IPaint[] | symbol): number {
  if (paints === MIXED || !Array.isArray(paints)) return 0;
  let sum = 0;
  for (const p of paints) {
    if (p.visible !== false) sum += paintFingerprint(p);
  }
  return sum;
}

export function nodeFillStrokeKeys(n: INode): { fillK: number; strokeK: number } {
  let fK = 0;
  let sK = 0;
  if ('fills' in n) fK = compositeVisiblePaintsFingerprint(n.fills!);
  if ('strokes' in n) sK = compositeVisiblePaintsFingerprint(n.strokes!);
  return { fillK: fK, strokeK: sK };
}

export function sumLayerBlurRadius(n: INode): number {
  if (!('effects' in n)) return 0;
  const e = (n as any).effects;
  if (!Array.isArray(e)) return 0;
  let sum = 0;
  for (const ef of e) {
    if (ef.visible !== false && ef.type === 'LAYER_BLUR') sum += ef.radius;
  }
  return sum;
}

/** Visual signature for cross-matching decors (ellipses/blurs) */
export interface VisualLayerSig {
  type: INode['type'];
  fillKey: number;
  strokeKey: number;
  blurKey: number;
  areaRel: number;
}

export function extractVisualSignature(node: INode, frameW: number, frameH: number): VisualLayerSig | null {
  const b = node.width * node.height;
  const keys = nodeFillStrokeKeys(node);
  return {
    type: node.type,
    fillKey: keys.fillK,
    strokeKey: keys.strokeK,
    blurKey: sumLayerBlurRadius(node),
    areaRel: b / Math.max(frameW * frameH, 1)
  };
}

export function visualSigFromMasterOtherRow(row: SessionSlotSnapshot, _Rw: number, _Rh: number): VisualLayerSig | null {
  if (!row.visualSignature) return null;
  return row.visualSignature as VisualLayerSig;
}

export function visualSigFromAnyDecorNode(node: INode, frame: INode): VisualLayerSig {
  return extractVisualSignature(node, frame.width, frame.height)!;
}

export function visualSignatureDistance(a: VisualLayerSig, b: VisualLayerSig): number {
  if (a.type !== b.type) return 1000;
  let dist = 0;
  dist += Math.abs(a.fillKey - b.fillKey) > 0.1 ? 50 : 0;
  dist += Math.abs(a.strokeKey - b.strokeKey) > 0.1 ? 30 : 0;
  dist += Math.abs(a.blurKey - b.blurKey) > 0.1 ? 20 : 0;
  dist += Math.abs(Math.log(a.areaRel / b.areaRel)) * 10;
  return dist;
}

export function crossOtherDecorMatchDistance(
  masterRow: SessionSlotSnapshot,
  resultNode: INode,
  masterW: number,
  masterH: number,
  resultW: number,
  resultH: number
): number {
  const sigResult = extractVisualSignature(resultNode, resultW, resultH);
  const sigMaster = masterRow.visualSignature as VisualLayerSig;
  if (!sigResult || !sigMaster) return 500;
  return visualSignatureDistance(sigMaster, sigResult);
}
