/**
 * Image inliner — `<img src>` and `style="background-image: url(...)"`.
 *
 * URL classification (Refinement 2 / Pin Concern B):
 *   absolute (https://...)         → fetch + inline as data: URI
 *   relative (./local.png)         → keep as-is + warn
 *   server-relative (/assets/foo)  → keep as-is + warn
 *   data: URI                      → no-op (already inline)
 *   blob: URL                      → keep as-is + warn (volatile session-scoped)
 *
 * No `baseUrl?` option in Phase 0 — narrow surface. "My CMS uses relative
 * URLs" is a future signal.
 *
 * SVG images take the same path as raster: encoded as
 * `data:image/svg+xml;base64,...`. Smart inline-as-<svg> would save ~33%
 * overhead but complicates debug-readability — uniform rules win.
 */

import type { ResourceFetcher } from './inline-fonts.js';
import { defaultFetcher } from './inline-fonts.js';

// ─── Types ────────────────────────────────────────────────────

export interface ImageInlineOptions {
  fetchTimeout?: number;
  failOnFetchError?: boolean;
  fetcher?: ResourceFetcher;
  /**
   * Project root used for the brand-mark special-case (Week 5 #21).
   * URLs matching `/platform/api/brand/<slug>/mark/<variant>` are read
   * directly from `<projectDir>/.reframe/brands/<slug>/marks/<variant>.svg`
   * instead of fetched over HTTP — bundles are portable artifacts that
   * shouldn't depend on the sidecar being live. Omit for no-op.
   */
  projectDir?: string;
}

export interface ImageInlineResult {
  /** HTML with all eligible image URLs replaced. */
  html: string;
  warnings: string[];
  inlinedCount: number;
}

export type UrlClass = 'absolute' | 'relative' | 'server-relative' | 'data' | 'blob' | 'unknown';

// ─── URL classification ──────────────────────────────────────

export function classifyUrl(url: string): UrlClass {
  if (!url) return 'unknown';
  if (url.startsWith('data:')) return 'data';
  if (url.startsWith('blob:')) return 'blob';
  if (/^https?:\/\//i.test(url)) return 'absolute';
  if (url.startsWith('/')) return 'server-relative';
  if (/^\.{1,2}\//.test(url) || !url.includes(':')) return 'relative';
  return 'unknown';
}

// ─── MIME inference ──────────────────────────────────────────

function mimeFromUrl(url: string): string {
  const m = url.match(/\.([a-z0-9]+)(?:\?|$)/i);
  const ext = m?.[1]?.toLowerCase() ?? '';
  switch (ext) {
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    case 'avif': return 'image/avif';
    case 'svg': return 'image/svg+xml';
    case 'ico': return 'image/x-icon';
    default: return 'application/octet-stream';
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  // eslint-disable-next-line no-undef
  return btoa(bin);
}

function textToBytes(s: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return Buffer.from(s, 'utf8');
  return new TextEncoder().encode(s);
}

// ─── Brand-mark URL resolution (Week 5 #21) ──────────────────

/**
 * Match `/platform/api/brand/<slug>/mark/<variant>`. Slug + variant are
 * alnum + dash; same character class the endpoint accepts.
 */
const BRAND_MARK_PATTERN = /^\/platform\/api\/brand\/([A-Za-z0-9_-]+)\/mark\/([A-Za-z0-9_-]+)$/;

/**
 * Try to read a brand-mark SVG directly from the project's brands
 * directory. Returns the SVG text on success, null when:
 *   - URL doesn't match the brand-mark pattern
 *   - projectDir not provided
 *   - file doesn't exist
 *   - read failed
 *
 * Synchronous on purpose — local file I/O is fast enough for the
 * exporter's already-async pipeline; avoiding the await keeps the
 * resolveUrl branching simple.
 */
function tryResolveBrandMark(url: string, projectDir: string | undefined): string | null {
  if (!projectDir) return null;
  const m = url.match(BRAND_MARK_PATTERN);
  if (!m) return null;
  // Lazy require — keeps pure-browser callers (none today, but future-proof)
  // out of the node:fs dependency.
  let fs: typeof import('node:fs');
  let path: typeof import('node:path');
  try {
    fs = require('node:fs');
    path = require('node:path');
  } catch { return null; }
  const filePath = path.join(projectDir, '.reframe', 'brands', m[1], 'marks', `${m[2]}.svg`);
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

// ─── Main inliner ────────────────────────────────────────────

/**
 * Walk HTML for `<img src>` and `style="...background-image: url(...)..."`
 * patterns. Each URL is classified; absolute URLs are fetched and inlined
 * as data: URIs. Other classes are left untouched with warnings.
 *
 * Per-call resource cache: same URL referenced N times is fetched once,
 * base64'd once, all references resolve to the same data: string.
 */
export async function inlineImages(
  html: string,
  options: ImageInlineOptions = {},
): Promise<ImageInlineResult> {
  const fetcher = options.fetcher ?? defaultFetcher(options.fetchTimeout ?? 10_000);
  const warnings: string[] = [];
  const cache = new Map<string, string>(); // url -> data: URI
  let inlinedCount = 0;

  async function resolveUrl(url: string, source: string): Promise<string> {
    const cls = classifyUrl(url);
    if (cls === 'data') return url;

    // Brand-mark special-case (Week 5 #21): server-relative URLs matching
    // /platform/api/brand/<slug>/mark/<variant> resolve directly from the
    // project's brands directory instead of going over HTTP. Bundles are
    // portable artifacts — they shouldn't 404 just because the sidecar
    // isn't running when the user opens the .html later.
    const brandMark = tryResolveBrandMark(url, options.projectDir);
    if (brandMark) {
      if (cache.has(url)) return cache.get(url)!;
      const dataUri = `data:image/svg+xml;base64,${bytesToBase64(textToBytes(brandMark))}`;
      cache.set(url, dataUri);
      inlinedCount++;
      return dataUri;
    }
    // Pattern matched but file missing → graceful: keep URL + warn,
    // never crash the export.
    if (BRAND_MARK_PATTERN.test(url)) {
      warnings.push(`Brand mark "${url}" (${source}) — file not found under projectDir, keeping external.`);
      return url;
    }

    if (cls === 'absolute') {
      if (cache.has(url)) return cache.get(url)!;
      try {
        const bytes = await fetcher.fetchBinary(url);
        const mime = mimeFromUrl(url);
        const dataUri = `data:${mime};base64,${bytesToBase64(bytes)}`;
        cache.set(url, dataUri);
        inlinedCount++;
        return dataUri;
      } catch (err: any) {
        const msg = `Failed to inline image ${url} (${source}): ${err?.message ?? err}. Keeping external.`;
        warnings.push(msg);
        if (options.failOnFetchError) throw new Error(msg);
        return url;
      }
    }
    if (cls === 'relative') {
      warnings.push(`Relative URL "${url}" (${source}) unresolvable in bundle context — kept as-is.`);
      return url;
    }
    if (cls === 'server-relative') {
      warnings.push(`Server-relative URL "${url}" (${source}) unresolvable in bundle context — kept as-is.`);
      return url;
    }
    if (cls === 'blob') {
      warnings.push(`blob: URL "${url}" (${source}) cannot be inlined (volatile session-scoped) — kept as-is.`);
      return url;
    }
    warnings.push(`Unknown URL scheme "${url}" (${source}) — kept as-is.`);
    return url;
  }

  // Collect all url-bearing matches first, resolve them, then do a single
  // string-replace pass. Doing it inline with replaceAll-async is awkward;
  // collect-then-replace is straightforward + deterministic.

  // <img src="..."> — also handles unquoted/single-quoted variants.
  const imgPattern = /<img\s+([^>]*?)src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))([^>]*)>/gi;
  // style="...url(...)..." — caught both for <element style> and inline @style blocks.
  const stylePattern = /style\s*=\s*"([^"]*)"/gi;
  // background[-image] in @style block: url(...)
  const bgUrlPattern = /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;

  // Phase 1: collect URLs.
  const seenUrls = new Set<string>();
  const collect = (s: string, pat: RegExp, idx: number): void => {
    let m: RegExpExecArray | null;
    pat.lastIndex = 0;
    while ((m = pat.exec(s)) !== null) {
      const u = m[idx];
      if (u) seenUrls.add(u);
    }
  };
  // imgPattern has src capture across groups 2/3/4 (depending on quote style)
  let im: RegExpExecArray | null;
  imgPattern.lastIndex = 0;
  while ((im = imgPattern.exec(html)) !== null) {
    const u = im[2] ?? im[3] ?? im[4];
    if (u) seenUrls.add(u);
  }
  let sm: RegExpExecArray | null;
  stylePattern.lastIndex = 0;
  while ((sm = stylePattern.exec(html)) !== null) {
    collect(sm[1], bgUrlPattern, 1);
  }

  // Phase 2: resolve each URL once (cache covers dedup).
  const resolved = new Map<string, string>();
  for (const url of seenUrls) {
    resolved.set(url, await resolveUrl(url, '<img>/style'));
  }

  // Phase 3: rewrite the HTML.
  let out = html;
  // Replace <img src="..."> srcs.
  out = out.replace(imgPattern, (_full, pre, dq, sq, uq, post) => {
    const orig = dq ?? sq ?? uq;
    const next = resolved.get(orig) ?? orig;
    const quote = dq !== undefined ? '"' : sq !== undefined ? "'" : '"';
    return `<img ${pre}src=${quote}${next}${quote}${post}>`;
  });
  // Replace style="...url(...)..." occurrences.
  out = out.replace(stylePattern, (_full, body) => {
    const newBody = body.replace(bgUrlPattern, (_m: string, u: string) => {
      const next = resolved.get(u) ?? u;
      // Preserve a quoting style that's safe inside the outer double-quoted style attr.
      const safeQuote = next.includes("'") ? '"' : "'";
      // Escape any embedded double quotes from data: URIs (rare but defensive).
      const safeUrl = safeQuote === '"' ? next.replace(/"/g, '&quot;') : next;
      return `url(${safeQuote}${safeUrl}${safeQuote})`;
    });
    return `style="${newBody}"`;
  });

  return { html: out, warnings, inlinedCount };
}
