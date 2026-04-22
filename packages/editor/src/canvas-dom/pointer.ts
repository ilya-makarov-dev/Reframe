/**
 * Pointer → INode mapping for the DOM canvas.
 *
 * The browser renders the scene as real HTML inside an iframe. Our
 * `exportToHtml({dataAttributes: true})` exporter stamps `data-reframe-inode="<INode id>"`
 * on every element, so hit-testing is just `document.elementFromPoint` + a
 * walk up the ancestor chain looking for `data-reframe-inode`.
 *
 * Additionally we promote the hit target to the first "meaningful parent" —
 * same pattern we use on the OP canvas (see 160-init.js `reframe:canvas-select`
 * handler): clicking the text inside a button selects the button, not the
 * leaf TEXT node. The `isMeaningful(id)` predicate is caller-supplied so the
 * host page can plug in its own LAYERS visibility logic.
 */

export interface HitTestResult {
  /** INode id of the element hit (after promotion). */
  nodeId: string;
  /** Iframe-local coords of the hit, in CSS px. */
  x: number;
  y: number;
}

export interface HitTestOptions {
  /**
   * Returns `true` if the given nodeId is a candidate for direct selection.
   * When `false`, the matcher walks up the parentId chain until it finds
   * one that returns `true`. Default: always true (select leaf).
   */
  isMeaningful?: (nodeId: string) => boolean;
  /** Max promotion hops (default 8) before falling back to the leaf. */
  maxPromotionHops?: number;
}

/**
 * Hit-test at iframe-local coords. Returns the id of the first element
 * with a `data-reframe-inode` attribute, optionally promoted up to a "meaningful"
 * ancestor. Returns null if the point is outside any inode-tagged element.
 */
export function hitTest(
  iframeDoc: Document,
  x: number,
  y: number,
  opts: HitTestOptions = {},
): HitTestResult | null {
  const el = iframeDoc.elementFromPoint(x, y);
  if (!el) return null;

  let cur: Element | null = el;
  let hops = 0;
  const max = opts.maxPromotionHops ?? 8;
  // Climb to first element with data-reframe-inode.
  while (cur && !cur.getAttribute?.('data-reframe-inode')) {
    cur = cur.parentElement;
  }
  if (!cur) return null;

  let nodeId = cur.getAttribute('data-reframe-inode')!;
  // Promote to first meaningful ancestor.
  if (opts.isMeaningful) {
    while (hops < max && cur && cur.getAttribute('data-reframe-inode') && !opts.isMeaningful(cur.getAttribute('data-reframe-inode')!)) {
      cur = cur.parentElement;
      // Skip non-element nodes; find next data-reframe-inode up.
      while (cur && !cur.getAttribute?.('data-reframe-inode')) {
        cur = cur.parentElement;
      }
      hops++;
    }
    if (cur?.getAttribute('data-reframe-inode')) nodeId = cur.getAttribute('data-reframe-inode')!;
  }

  return { nodeId, x, y };
}

/**
 * Translate viewport (parent-document) coords into iframe-local coords,
 * accounting for the zoom/pan CSS transform applied to the iframe wrapper.
 */
export function viewportToIframeCoords(
  iframe: HTMLIFrameElement,
  viewportX: number,
  viewportY: number,
  zoom: number,
  panX: number,
  panY: number,
): { x: number; y: number } {
  // The iframe's bounding rect is already post-transform. We need the
  // pre-transform (scene-space) coords: subtract iframe origin, divide by
  // zoom, then subtract pan.
  const rect = iframe.getBoundingClientRect();
  const localPostTransform = {
    x: viewportX - rect.left,
    y: viewportY - rect.top,
  };
  // rect is post-transform so localPostTransform is already in scene px
  // scaled by the browser. We DON'T divide by zoom here because the iframe's
  // rect already reflects the scaled size. elementFromPoint inside the
  // iframe doc sees unscaled coords — that's what we want.
  void zoom; void panX; void panY;
  return localPostTransform;
}
