/**
 * Single-file portable HTML bundle.
 *
 * Goal: user downloads one .html, opens in any browser, scene renders
 * fully without external requests. Foundation for #20 stateful prototype,
 * #26 always-on tweaks, #6 thumbnail.
 *
 * ─── Format ─────────────────────────────────────────────────
 *
 * Plain HTML. NO gzip — that's a transport-layer concern (server
 * Content-Encoding); browsers don't decompress arbitrary gzip from a
 * .html file. Output is debug-readable text with base64'd fonts and
 * images embedded inline.
 *
 * ─── Pipeline ───────────────────────────────────────────────
 *
 *   1. exportToHtml(scene) — produce full HTML doc (existing exporter
 *      already collects used (family, weight) via SceneGraph walk and
 *      requests only those weights from Google Fonts URL).
 *   2. Walk SceneGraph for TEXT nodes — collect (family, weight, style)
 *      tuples as a SAFETY NET for user-imported HTML carrying a
 *      kitchen-sink Google Fonts link (`wght@100;200;...;900`). Used as
 *      a subset filter in the font inliner.
 *   3. Find <link href="https://fonts.googleapis.com/..."> entries.
 *      For each: fetch CSS, filter @font-face by used variants, fetch
 *      each woff2, base64 + emit @font-face with data URI, replace the
 *      <link> with the resulting <style> block. SRI / crossorigin attrs
 *      were on the original <link> — they vanish along with it (the
 *      replacement <style> doesn't carry them, and anything we leave
 *      external retains its integrity untouched).
 *   4. Walk HTML for image URLs (<img src> + style="...background-image:
 *      url(...)..."). Classify each: absolute → fetch + inline; relative
 *      / server-relative / blob → keep + warn; data → no-op.
 *   5. Return { html, warnings, inlinedAssets }.
 *
 * ─── Determinism ────────────────────────────────────────────
 *
 * Given stable network responses (mocked or cached), bundle(scene) twice
 * produces byte-identical output. Sources of stability:
 *   - SceneGraph traversal order is deterministic
 *   - per-call resource cache (same URL → same base64, regardless of
 *     reference count)
 *   - base64 encoding is deterministic from input bytes
 *   - @font-face block ordering: traversal order from the parsed CSS
 *     (Google Fonts response is itself deterministic for a given URL)
 *
 * ─── Annotations ────────────────────────────────────────────
 *
 * Annotations (#1) ride for free: html.ts already emits annotation
 * <span> overlays + the Caveat font link. Both flow through this
 * pipeline unchanged — Caveat gets inlined like any other Google font,
 * spans render exactly as in live mode.
 *
 * ─── No tweak slots ─────────────────────────────────────────
 *
 * Phase 0 emits a clean static bundle. #26 Always-on tweaks lands later
 * and extends bundle output by injecting <script> + <input> controls at
 * end of <body>. No reserved slots, placeholder comments, or "tweakable"
 * markers in this output — the extension just appends.
 */

import type { SceneGraph } from '../engine/scene-graph.js';
import { exportToHtml } from './html.js';
import {
  inlineGoogleFontCss,
  isGoogleFontUrl,
  type UsedVariant,
  type ResourceFetcher,
  type FontInlineResult,
} from './inline-fonts.js';
import { inlineImages } from './inline-images.js';
import { ANNOTATION_FONT } from '../engine/annotation.js';

// ─── Public API ──────────────────────────────────────────────

export interface BundleOptions {
  /** Inline font @font-face data URIs. Default true. */
  inlineFonts?: boolean;
  /** Inline image data URIs. Default true. */
  inlineImages?: boolean;
  /** Fail (throw) on any fetch error vs best-effort warning. Default false. */
  failOnFetchError?: boolean;
  /** Per-resource fetch timeout in ms. Default 10s. */
  fetchTimeout?: number;
  /** Test override — deterministic mock fetcher. */
  fetcher?: ResourceFetcher;
  /**
   * Project root for the brand-mark special-case (Week 5 #21).
   * URLs matching /platform/api/brand/<slug>/mark/<variant> resolve from
   * `.reframe/brands/<slug>/marks/<variant>.svg` directly (no HTTP fetch).
   * Required when scenes reference brand marks; harmless when they don't.
   */
  projectDir?: string;
}

export interface BundleResult {
  html: string;
  warnings: string[];
  inlinedAssets: { fonts: number; images: number };
}

/**
 * Render a SceneGraph to a single-file portable HTML bundle.
 *
 * Async because the inliners issue network fetches for fonts and images.
 * Best-effort by default — failed fetches degrade gracefully and emit
 * warnings; the produced HTML still loads (with fallback chains for
 * fonts, external src for images).
 */
export async function exportSceneGraphToBundle(
  graph: SceneGraph,
  rootId: string,
  options: BundleOptions = {},
): Promise<BundleResult> {
  const inlineFontsOpt = options.inlineFonts !== false;
  const inlineImagesOpt = options.inlineImages !== false;

  // Step 1: produce full HTML via the existing exporter.
  // fullDoc:true gives us the complete <html><head><body> with the Google
  // Fonts <link> already emitted.
  const baseHtml = exportToHtml(graph, rootId, { fullDocument: true });

  let html = baseHtml;
  const warnings: string[] = [];
  let fontsInlined = 0;
  let imagesInlined = 0;

  // Step 2: collect used variants from SceneGraph as a safety subset
  // filter. html.ts already restricts via URL; this guards against
  // user-imported HTML whose Google Fonts <link> requests every weight.
  const usedVariants = inlineFontsOpt ? collectUsedVariants(graph, rootId) : [];

  // Step 3: font inlining.
  if (inlineFontsOpt) {
    const result = await inlineFontsInHtml(html, {
      usedVariants,
      fetcher: options.fetcher,
      fetchTimeout: options.fetchTimeout,
      failOnFetchError: options.failOnFetchError,
    });
    html = result.html;
    fontsInlined = result.facesEmitted;
    warnings.push(...result.warnings);
  }

  // Step 4: image inlining.
  if (inlineImagesOpt) {
    const result = await inlineImages(html, {
      fetcher: options.fetcher,
      fetchTimeout: options.fetchTimeout,
      failOnFetchError: options.failOnFetchError,
      projectDir: options.projectDir,
    });
    html = result.html;
    imagesInlined = result.inlinedCount;
    warnings.push(...result.warnings);
  }

  return {
    html,
    warnings,
    inlinedAssets: { fonts: fontsInlined, images: imagesInlined },
  };
}

// ─── Variant walker ──────────────────────────────────────────

/**
 * Walk SceneGraph TEXT nodes, collect (family, weight, style) tuples.
 *
 * Normalization (Refinement 1):
 *   - fontWeight: 'bold' → 700, 'normal' / absent → 400, numeric pass-through
 *   - italic boolean → 'italic' / 'normal' style
 *
 * Scene-level annotations always include Caveat @ 500 (hard-coded by
 * html.ts annotation emission), but ONLY if scene actually has annotations.
 * Skip Caveat entirely otherwise.
 */
export function collectUsedVariants(graph: SceneGraph, rootId: string): UsedVariant[] {
  const set = new Map<string, UsedVariant>();
  const key = (v: UsedVariant) => `${v.family}|${v.weight}|${v.style}`;

  function walk(id: string): void {
    const n = graph.getNode(id);
    if (!n) return;
    if (n.type === 'TEXT' && n.fontFamily) {
      const v = normalizeVariant({
        family: n.fontFamily,
        weight: (n as any).fontWeight,
        italic: (n as any).italic,
      });
      set.set(key(v), v);
    }
    if (n.childIds?.length) for (const c of n.childIds) walk(c);
  }
  walk(rootId);

  // Annotation font (Caveat 500 today) — only when scene has annotations.
  // Family/weight/style from the canonical engine binding so changes there
  // propagate without hand-syncing this file.
  if (graph.annotations && graph.annotations.length > 0) {
    const annoFont: UsedVariant = {
      family: ANNOTATION_FONT.family,
      weight: ANNOTATION_FONT.weight,
      style: ANNOTATION_FONT.style,
    };
    set.set(key(annoFont), annoFont);
  }

  return [...set.values()];
}

function normalizeVariant(input: {
  family: string;
  weight?: number | string;
  italic?: boolean;
}): UsedVariant {
  let weight: number;
  if (typeof input.weight === 'number') weight = input.weight;
  else if (input.weight === 'bold') weight = 700;
  else if (input.weight === 'normal' || input.weight === undefined || input.weight === null) weight = 400;
  else {
    const parsed = parseInt(String(input.weight), 10);
    weight = Number.isFinite(parsed) ? parsed : 400;
  }
  const style: 'normal' | 'italic' = input.italic ? 'italic' : 'normal';
  return { family: input.family, weight, style };
}

// ─── Font link replacement ───────────────────────────────────

/**
 * Find every Google Fonts <link href="https://fonts.googleapis.com/..."
 * rel="stylesheet"> in the HTML, fetch + inline, replace each with the
 * resulting <style> block. Non-Google CDN <link>s log a warning and stay
 * as external links (no break, just no inline benefit).
 *
 * Also drops <link rel="preconnect" href="https://fonts.gstatic.com|googleapis.com">
 * elements — they're hints for external CDN, irrelevant once content is
 * inline. Leaving them wouldn't break anything but would be dead markup.
 */
async function inlineFontsInHtml(
  html: string,
  opts: {
    usedVariants: UsedVariant[];
    fetcher?: ResourceFetcher;
    fetchTimeout?: number;
    failOnFetchError?: boolean;
  },
): Promise<{ html: string; facesEmitted: number; warnings: string[] }> {
  const warnings: string[] = [];
  let facesEmitted = 0;
  let out = html;

  // Match a stylesheet <link> that points at fonts.googleapis.com — must
  // carry an actual CSS path (`/css2?...`), not a bare hostname (which is
  // what `rel="preconnect"` hints use). Filtering by URL pathname is more
  // robust than requiring `rel="stylesheet"` which may be omitted.
  const linkRe = /<link\s+([^>]*?)href\s*=\s*"(https:\/\/fonts\.googleapis\.com\/css2?[^"]*)"([^>]*)>/gi;
  // Find all matches first (regex iteration + collect), then resolve in
  // sequence + apply replacements deterministically.
  const matches: Array<{ full: string; pre: string; href: string; post: string }> = [];
  let m: RegExpExecArray | null;
  linkRe.lastIndex = 0;
  while ((m = linkRe.exec(html)) !== null) {
    matches.push({ full: m[0], pre: m[1], href: m[2], post: m[3] });
  }

  for (const match of matches) {
    if (!isGoogleFontUrl(match.href)) {
      warnings.push(`Skipping non-Google font CDN link: ${match.href}`);
      continue;
    }
    const result: FontInlineResult = await inlineGoogleFontCss(match.href, {
      usedVariants: opts.usedVariants,
      fetcher: opts.fetcher,
      fetchTimeout: opts.fetchTimeout,
      failOnFetchError: opts.failOnFetchError,
    });
    facesEmitted += result.facesEmitted;
    warnings.push(...result.warnings);
    // Replace the original <link> with the inlined <style> (or empty if
    // every fetch failed — fallback chain handles render).
    out = out.split(match.full).join(result.styleBlock);
  }

  // Drop now-orphan <link rel="preconnect" href="https://fonts.gstatic.com">
  // and "https://fonts.googleapis.com" elements — they're hints for the
  // external CDN, redundant once everything is inline.
  out = out.replace(
    /<link\s+[^>]*rel\s*=\s*"preconnect"[^>]*href\s*=\s*"https:\/\/fonts\.(?:gstatic|googleapis)\.com"[^>]*>/gi,
    '',
  );
  // Same with rel/href in reversed attribute order.
  out = out.replace(
    /<link\s+[^>]*href\s*=\s*"https:\/\/fonts\.(?:gstatic|googleapis)\.com"[^>]*rel\s*=\s*"preconnect"[^>]*>/gi,
    '',
  );

  return { html: out, facesEmitted, warnings };
}

// ─── Re-export for callers that want the variant walker directly ─
export type { UsedVariant } from './inline-fonts.js';
