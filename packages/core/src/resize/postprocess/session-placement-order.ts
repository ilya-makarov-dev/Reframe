import type { BannerElementType, GuideElement } from '../contracts/types';

/**
 * Slot application order in exact-session / cross-master: not just master top.
 * Otherwise logo (often higher by Y) matches before button and steals the button candidate by dist² —
 * then slots "swap" and layout breaks.
 */
export const EXACT_SESSION_STABLE_ORDER_PRIORITY: Record<BannerElementType, number> = {
  background: 0,
  title: 1,
  description: 2,
  disclaimer: 3,
  ageRating: 4,
  button: 5,
  logo: 6,
  other: 7
};

export function compareExactSessionStableOrder(
  a: { slotType: BannerElementType; element: GuideElement },
  b: { slotType: BannerElementType; element: GuideElement }
): number {
  const af = a.element.fill ? 0 : 1;
  const bf = b.element.fill ? 0 : 1;
  if (af !== bf) return af - bf;
  const pa = EXACT_SESSION_STABLE_ORDER_PRIORITY[a.slotType] ?? 50;
  const pb = EXACT_SESSION_STABLE_ORDER_PRIORITY[b.slotType] ?? 50;
  if (pa !== pb) return pa - pb;
  const at = a.element.top ?? 0;
  const bt = b.element.top ?? 0;
  if (at !== bt) return at - bt;
  return (a.element.left ?? 0) - (b.element.left ?? 0);
}
