/**
 * Safe resize wrapper — guards against zero/negative dimensions and swallows host API errors.
 * Used across guide-scaler post-processing.
 */
import type { INode } from '../../host';

export function safeResize(node: INode, w: number, h: number): void {
  try {
    node.resize(Math.max(0.01, w), Math.max(0.01, h));
  } catch (_) {}
}
