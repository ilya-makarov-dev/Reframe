/**
 * Auto token binding — match every node's colors/fonts to the nearest design
 * token and record the binding in `node.meta.tokenBindings`. Combined with an
 * exporter that reads those bindings, this is what makes "change one token,
 * re-skin the whole project" actually work: a `#635BFF` fill becomes
 * `fillRole: "primary"`, and the HTML exporter can then emit
 * `var(--color-primary)` instead of the hardcoded hex.
 *
 * This is intentionally lenient: within tolerance, we bind; outside, we leave
 * the literal value alone. No destructive rewriting — the original color stays
 * on the node for graceful fallback.
 */

import type { SceneGraph } from '../engine/scene-graph';
import type { TokenBindings, NodeMeta } from '../engine/types';
import type { DesignSystem } from '../design-system/types';

// ─── Public API ─────────────────────────────────────────────

export interface AutoBindOptions {
  /** Euclidean RGB distance tolerance (0-441). Default 30 — empirical sweet spot. */
  colorTolerance?: number;
  /** Absolute tolerance for font size matching, in px. Default 2. */
  fontSizeTolerance?: number;
  /** Whether to also bind corner radii to borderRadiusScale. Default true. */
  bindRadii?: boolean;
}

export interface AutoBindResult {
  /** Nodes that received at least one binding. */
  boundNodes: string[];
  /** Nodes the walker visited but couldn't match to any token within tolerance. */
  skippedNodes: string[];
  /** Per-token usage counts, useful for audit and debugging. */
  usage: Map<string, number>;
}

export function autoBindTokens(
  graph: SceneGraph,
  rootId: string,
  ds: DesignSystem,
  options: AutoBindOptions = {},
): AutoBindResult {
  const colorTol = options.colorTolerance ?? 30;
  const fontTol = options.fontSizeTolerance ?? 2;
  const bindRadii = options.bindRadii !== false;

  // Build a flat palette: role name → RGB. We blend the shortcut fields
  // (primary/background/text/accent) into the same map as the role map, so
  // a naive nearest-neighbor search treats them uniformly. Later roles win
  // over earlier ones only on tied distance — but ties are rare in practice.
  const palette: Array<{ role: string; rgb: RGB }> = [];
  function pushColor(role: string, hex: string | undefined): void {
    if (!hex) return;
    const rgb = hexToRgb(hex);
    if (rgb) palette.push({ role, rgb });
  }
  pushColor('primary', ds.colors.primary);
  pushColor('background', ds.colors.background);
  pushColor('text', ds.colors.text);
  pushColor('accent', ds.colors.accent);
  if (ds.colors.roles) {
    for (const [role, hex] of ds.colors.roles) {
      pushColor(role, hex);
    }
  }

  // Font-family palette — two slots max: primary + secondary. Exact-match
  // only; font matching on nearest is meaningless.
  const primaryFont = ds.typography.primaryFont;
  const secondaryFont = ds.typography.secondaryFont;

  const boundNodes: string[] = [];
  const skippedNodes: string[] = [];
  const usage = new Map<string, number>();

  // Phase 5b Bug #5: palette lookup by role name for variant-hint bypass.
  const paletteByRole = new Map<string, RGB>();
  for (const entry of palette) paletteByRole.set(entry.role, entry.rgb);

  const visit = (nodeId: string): void => {
    const node = graph.getNode(nodeId);
    if (!node) return;

    const binding: TokenBindings = {};

    // Phase 5b Bug #5: variant hint bypass. If the HTML importer captured
    // `data-reframe-variant="primary"` (or class-name hint) into
    // node.meta.variant, that's an explicit author declaration that this
    // node IS the primary button — bind regardless of colour distance.
    //
    // This fixes dark-mode swaps (light `#5e6ad2` vs dark `#0c0f2d` for the
    // same role are both "primary" but far in RGB space), Linear ↔ Stripe
    // primary swaps, and any brand variation where the literal hex diverges
    // from the tolerance window.
    const variantHint = node.meta?.variant;
    const semanticRole = (node as any).semanticRole;
    const hintedRole =
      // Explicit variant hint always wins for interactive elements
      (variantHint && paletteByRole.has(variantHint) && variantHint)
      // Buttons/CTAs with no variant still hint toward "cta" or "primary"
      || (semanticRole === 'cta' && (paletteByRole.has('cta') ? 'cta'
           : paletteByRole.has('primary') ? 'primary' : undefined))
      || undefined;

    // ── Fill binding ──
    // Only SOLID fills are bindable — gradients and images need a separate
    // strategy that we defer to a later phase.
    const fill0 = node.fills?.[0] as any;
    if (fill0 && fill0.type === 'SOLID' && fill0.color) {
      const nodeRgb: RGB = {
        r: Math.round((fill0.color.r ?? 0) * 255),
        g: Math.round((fill0.color.g ?? 0) * 255),
        b: Math.round((fill0.color.b ?? 0) * 255),
      };
      // Cascading tolerance: hard match → normal → loose (with hint).
      // A variant hint bypasses distance entirely for its own role.
      const hardMatch = nearest(nodeRgb, palette, 5);
      if (hardMatch) {
        binding.fill = hardMatch;
      } else if (hintedRole) {
        // Author said "this is primary" — trust them even at distance 120.
        binding.fill = hintedRole;
      } else {
        const normal = nearest(nodeRgb, palette, colorTol);
        if (normal) binding.fill = normal;
      }
    } else if (hintedRole && !fill0) {
      // Node has no fill but the role hint maps to a color role — bind
      // symbolically so exporters can still emit `background: var(--color-X)`
      // against a node that originally had no background. This is useful for
      // <a class="primary"> anchors whose CSS color is on the text, not fill.
      binding.fill = hintedRole;
    }

    // ── Stroke binding ── (same approach as fill)
    const stroke0 = node.strokes?.[0] as any;
    if (stroke0 && stroke0.type === 'SOLID' && stroke0.color) {
      const rgb: RGB = {
        r: Math.round((stroke0.color.r ?? 0) * 255),
        g: Math.round((stroke0.color.g ?? 0) * 255),
        b: Math.round((stroke0.color.b ?? 0) * 255),
      };
      const hard = nearest(rgb, palette, 5);
      const match = hard ?? nearest(rgb, palette, colorTol);
      if (match) binding.stroke = match;
    }

    // ── Font size binding ──
    // Only bind on TEXT nodes with an explicit fontSize. Match against the
    // typography hierarchy — the nearest role within fontSizeTolerance wins.
    if (node.type === 'TEXT' && typeof node.fontSize === 'number' && node.fontSize > 0) {
      let best: { role: string; dist: number } | null = null;
      for (const rule of ds.typography.hierarchy) {
        const d = Math.abs(rule.fontSize - node.fontSize);
        if (!best || d < best.dist) best = { role: rule.role, dist: d };
      }
      if (best && best.dist <= fontTol) binding.fontSize = best.role;
    }

    // ── Font family binding ──
    if (node.type === 'TEXT' && node.fontFamily) {
      if (primaryFont && node.fontFamily === primaryFont) binding.fontFamily = 'primary';
      else if (secondaryFont && node.fontFamily === secondaryFont) binding.fontFamily = 'secondary';
    }

    // ── Corner radius binding ──
    // Match to the closest entry in borderRadiusScale. We store the scale
    // INDEX (stringified) as the "token name" — semantic roles aren't defined
    // for radii, just a scale.
    if (bindRadii && typeof node.cornerRadius === 'number' && node.cornerRadius > 0) {
      const scale = ds.layout?.borderRadiusScale ?? [];
      if (scale.length > 0) {
        let bestIdx = -1;
        let bestDist = Infinity;
        for (let i = 0; i < scale.length; i++) {
          const d = Math.abs(scale[i] - node.cornerRadius);
          if (d < bestDist) { bestDist = d; bestIdx = i; }
        }
        if (bestIdx >= 0 && bestDist <= 2) binding.cornerRadius = String(bestIdx);
      }
    }

    if (Object.keys(binding).length > 0) {
      // Write back to the node's meta. Preserve existing meta fields — we're
      // only adding/replacing tokenBindings, not overwriting sourceTag etc.
      const newMeta: NodeMeta = { ...(node.meta ?? {}), tokenBindings: binding };
      graph.updateNode(nodeId, { meta: newMeta } as any);
      boundNodes.push(nodeId);
      for (const v of Object.values(binding)) {
        if (typeof v === 'string') usage.set(v, (usage.get(v) ?? 0) + 1);
      }
    } else {
      skippedNodes.push(nodeId);
    }

    for (const cid of node.childIds) visit(cid);
  };

  visit(rootId);

  return { boundNodes, skippedNodes, usage };
}

// ─── Helpers ────────────────────────────────────────────────

interface RGB { r: number; g: number; b: number; }

/**
 * Parse #rrggbb or #rgb into an RGB struct (0-255 per channel). Returns null
 * on anything else — named colors, rgba(), hsl() etc. are out of scope
 * because the importer already normalized fills to SOLID {r,g,b}.
 */
function hexToRgb(hex: string): RGB | null {
  if (typeof hex !== 'string') return null;
  let h = hex.trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return { r, g, b };
}

/**
 * Euclidean RGB distance. Not perceptually accurate (CIEDE2000 is better) but
 * fast, dependency-free, and good enough for the obvious "match brand primary"
 * case that drives 90% of auto-bind value.
 */
function colorDistance(a: RGB, b: RGB): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function nearest(rgb: RGB, palette: Array<{ role: string; rgb: RGB }>, tolerance: number): string | null {
  let best: { role: string; dist: number } | null = null;
  for (const { role, rgb: tokenRgb } of palette) {
    const d = colorDistance(rgb, tokenRgb);
    if (!best || d < best.dist) best = { role, dist: d };
  }
  return best && best.dist <= tolerance ? best.role : null;
}
