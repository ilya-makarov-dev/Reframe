export function layoutAspectSpread(w1: number, h1: number, w2: number, h2: number): number {
  const r1 = w1 / Math.max(h1, 1e-6);
  const r2 = w2 / Math.max(h2, 1e-6);
  const lo = Math.min(r1, r2);
  const hi = Math.max(r1, r2);
  return (hi - lo) / Math.max(lo, 1e-6);
}

export function aspectDeltaRelativeToTarget(
  srcW: number, srcH: number, targetW: number, targetH: number
): number {
  const arSource = srcW / Math.max(srcH, 1e-6);
  const arTarget = targetW / Math.max(targetH, 1e-6);
  return Math.abs(arSource - arTarget) / Math.max(arTarget, 0.01);
}
