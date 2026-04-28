/**
 * Google Fonts inliner.
 *
 * Phase 0 scope: GOOGLE FONTS ONLY. Recognized via strict hostname
 * equality (`fonts.googleapis.com` for the CSS index, `fonts.gstatic.com`
 * for the woff2 binaries). Other CDNs (Adobe Fonts, fonts.bunny.net,
 * self-hosted services) → log warning, leave external. No future
 * "Google-compatible mirror" allowlist — narrow surface, future signal.
 *
 * Self-hosted @font-face blocks already inline in the input HTML are
 * pass-through untouched: they're already delivery-ready.
 *
 * Subset by actual use (Pin 9): the Google Fonts URL constructed by
 * html.ts already restricts weights via `wght@N;M` — we trust that. As a
 * safety net for user-imported HTML carrying kitchen-sink links
 * (e.g. `wght@100;200;...;900`), we also accept a `usedVariants` set and
 * filter @font-face blocks by it. Filter is a SUBSET intersect: blocks
 * matching used variants are kept; everything else dropped.
 *
 * Annotations Caveat font is hard-coded by html.ts; the inliner doesn't
 * special-case it — same code path inlines it as any other Google font.
 */

import { stripSriAttrs } from './sri-strip.js';

// ─── Types ────────────────────────────────────────────────────

export interface UsedVariant {
  /** Family name as it appears in CSS, e.g. "Inter", "Caveat", "Roboto Mono". */
  family: string;
  /** Numeric weight 100–900. */
  weight: number;
  /** "normal" | "italic". */
  style: 'normal' | 'italic';
}

export interface FontInlineResult {
  /** Replacement <style> block markup (or empty if all fetches failed). */
  styleBlock: string;
  /** Number of @font-face blocks emitted. */
  facesEmitted: number;
  warnings: string[];
}

export interface FontFetchOptions {
  /** Per-resource timeout in ms. Default 10s. */
  fetchTimeout?: number;
  /** When true, throw on any fetch failure. Default false (best-effort). */
  failOnFetchError?: boolean;
  /** Optional URL whitelist for variant subsetting. Empty = inline all. */
  usedVariants?: UsedVariant[];
  /**
   * Override fetcher (tests). Signature mirrors a minimal fetch surface:
   * given a URL, return the response body as a string (CSS) or Uint8Array
   * (binary). Tests provide deterministic mocks; production uses
   * built-in fetch with the same shape.
   */
  fetcher?: ResourceFetcher;
}

export interface ResourceFetcher {
  fetchText(url: string): Promise<string>;
  fetchBinary(url: string): Promise<Uint8Array>;
}

// ─── URL classification ──────────────────────────────────────

/**
 * Strict equality check — `fonts.googleapis.com` (CSS index) or
 * `fonts.gstatic.com` (woff2 binary). Anything else returns false.
 * Substring matches like "myfont.fonts.googleapis.com.evil.com" are
 * rejected because URL.hostname returns the full host.
 */
export function isGoogleFontUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'fonts.googleapis.com' || host === 'fonts.gstatic.com';
  } catch {
    return false;
  }
}

// ─── Default fetcher (uses global fetch) ─────────────────────

export function defaultFetcher(timeoutMs: number): ResourceFetcher {
  async function withTimeout<T>(p: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`fetch timeout after ${timeoutMs}ms`)), timeoutMs);
      p.then((v) => { clearTimeout(t); resolve(v); },
             (e) => { clearTimeout(t); reject(e); });
    });
  }
  return {
    async fetchText(url) {
      // Google Fonts serves DIFFERENT CSS based on User-Agent — modern
      // browsers get woff2 src URLs, generic UAs get TTF or broken
      // formats. Use a realistic Chrome UA to land in the woff2 path.
      const resp = await withTimeout(fetch(url, { headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      } }));
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.text();
    },
    async fetchBinary(url) {
      const resp = await withTimeout(fetch(url));
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = await resp.arrayBuffer();
      return new Uint8Array(buf);
    },
  };
}

// ─── @font-face parsing ──────────────────────────────────────

interface FontFaceBlock {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  /** First woff2 src URL found in the block. Other formats ignored. */
  woff2Url: string | null;
  /** Optional unicode-range — preserved verbatim when emitting. */
  unicodeRange?: string;
}

/**
 * Parse a Google Fonts CSS payload into @font-face blocks. Tolerates the
 * format Google emits: ASCII-quoted family, numeric weight, single src
 * with format('woff2'). Doesn't try to be a general CSS parser.
 */
export function parseFontFaceBlocks(css: string): FontFaceBlock[] {
  const blocks: FontFaceBlock[] = [];
  // Match @font-face { ...properties... } — properties may contain nested
  // braces in url() in some CSS, but Google's output is brace-clean.
  const re = /@font-face\s*\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const body = m[1];
    const family = matchProp(body, 'font-family')?.replace(/^['"]|['"]$/g, '') ?? '';
    const weightRaw = matchProp(body, 'font-weight') ?? '400';
    const styleRaw = matchProp(body, 'font-style') ?? 'normal';
    const unicodeRange = matchProp(body, 'unicode-range');
    // src: url(<woff2-url>) format('woff2');  — also handle url('...') quoted
    const srcMatch = body.match(/src:\s*url\(['"]?([^'")]+)['"]?\)\s*format\(['"]woff2['"]\)/i);
    const woff2Url = srcMatch?.[1] ?? null;

    if (!family) continue;
    blocks.push({
      family,
      weight: parseInt(weightRaw, 10) || 400,
      style: styleRaw.trim().toLowerCase() === 'italic' ? 'italic' : 'normal',
      woff2Url,
      unicodeRange,
    });
  }
  return blocks;
}

function matchProp(body: string, prop: string): string | undefined {
  const re = new RegExp(`${prop}\\s*:\\s*([^;]+);?`, 'i');
  const m = body.match(re);
  return m?.[1]?.trim();
}

function isVariantUsed(block: FontFaceBlock, used: UsedVariant[]): boolean {
  if (used.length === 0) return true; // no filter → keep all
  return used.some((v) =>
    v.family === block.family && v.weight === block.weight && v.style === block.style
  );
}

// ─── base64 ──────────────────────────────────────────────────

function bytesToBase64(bytes: Uint8Array): string {
  // Node and browser both have Buffer / btoa; prefer Buffer when available
  // (faster for large inputs) but fall back to btoa for non-Node runtimes.
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  // eslint-disable-next-line no-undef
  return btoa(bin);
}

// ─── Main inliner ────────────────────────────────────────────

/**
 * Fetch a Google Fonts CSS, inline its woff2 sources as base64 data URIs,
 * filter by `usedVariants` (when provided), return a <style> block ready
 * to drop into <head>. Failed fetches degrade gracefully — affected
 * @font-face entries are skipped, warnings collected.
 *
 * The caller is responsible for removing the original <link> element from
 * the markup; this function only produces the replacement <style>. Use
 * `stripSriAttrs` from sri-strip.ts when constructing the surrounding
 * markup if the original carried integrity/crossorigin attrs that the
 * caller wants to preserve elsewhere.
 */
export async function inlineGoogleFontCss(
  cssUrl: string,
  options: FontFetchOptions = {},
): Promise<FontInlineResult> {
  const warnings: string[] = [];
  if (!isGoogleFontUrl(cssUrl)) {
    warnings.push(`Skipping non-Google font CDN: ${cssUrl}. Phase 0 inlines Google Fonts only.`);
    return { styleBlock: '', facesEmitted: 0, warnings };
  }

  const fetcher = options.fetcher ?? defaultFetcher(options.fetchTimeout ?? 10_000);
  const used = options.usedVariants ?? [];

  let css: string;
  try {
    css = await fetcher.fetchText(cssUrl);
  } catch (err: any) {
    const msg = `Failed to inline font CSS from ${cssUrl}: ${err?.message ?? err}. Falling back to system font.`;
    warnings.push(msg);
    if (options.failOnFetchError) throw new Error(msg);
    return { styleBlock: '', facesEmitted: 0, warnings };
  }

  const blocks = parseFontFaceBlocks(css);
  const kept = blocks.filter((b) => isVariantUsed(b, used));
  const dropped = blocks.length - kept.length;
  if (dropped > 0 && used.length > 0) {
    warnings.push(`Dropped ${dropped} unused font variant(s) from ${cssUrl} (subset by scene usage).`);
  }

  const emittedBlocks: string[] = [];
  let facesEmitted = 0;

  for (const block of kept) {
    if (!block.woff2Url) {
      warnings.push(`@font-face for ${block.family} @ ${block.weight}/${block.style} has no woff2 src; skipped.`);
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = await fetcher.fetchBinary(block.woff2Url);
    } catch (err: any) {
      const msg = `Failed to fetch woff2 ${block.woff2Url}: ${err?.message ?? err}. ${block.family} @ ${block.weight}/${block.style} not inlined.`;
      warnings.push(msg);
      if (options.failOnFetchError) throw new Error(msg);
      continue;
    }
    const base64 = bytesToBase64(bytes);
    const lines: string[] = [
      `  font-family: '${block.family}';`,
      `  font-style: ${block.style};`,
      `  font-weight: ${block.weight};`,
      `  font-display: swap;`,
      `  src: url('data:font/woff2;base64,${base64}') format('woff2');`,
    ];
    if (block.unicodeRange) lines.push(`  unicode-range: ${block.unicodeRange};`);
    emittedBlocks.push(`@font-face {\n${lines.join('\n')}\n}`);
    facesEmitted++;
  }

  if (facesEmitted === 0) {
    return { styleBlock: '', facesEmitted: 0, warnings };
  }

  return {
    styleBlock: `<style data-reframe-inlined-fonts="${escapeAttr(cssUrl)}">\n${emittedBlocks.join('\n\n')}\n</style>`,
    facesEmitted,
    warnings,
  };
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// ─── Export sri-strip pass-through for caller convenience ────
export { stripSriAttrs };
