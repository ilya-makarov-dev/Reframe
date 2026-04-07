/**
 * Reframe Standalone Engine — Font System
 *
 * Font loading via Google Fonts API, system fonts, and bundled fonts.
 * No CanvasKit dependency at this level — provider is injected.
 */

import type { SceneGraph } from './scene-graph';

// ─── Types ──────────────────────────────────────────────────────

export interface FontInfo {
  family: string;
  fullName: string;
  style: string;
  postscriptName: string;
}

/**
 * Callback to register a loaded font with the rendering backend.
 * Implementations: CanvasKit TypefaceFontProvider, browser FontFace, etc.
 */
export type FontRegistrar = (family: string, style: string, data: ArrayBuffer) => void;

// ─── State ──────────────────────────────────────────────────────

const loadedFamilies = new Map<string, ArrayBuffer>();
const googleFontsCache = new Map<string, Record<string, string>>();
const googleFontsFailed = new Set<string>();

let fontRegistrar: FontRegistrar | null = null;
let cjkFallbackFamily: string | null = null;
let cjkFallbackPromise: Promise<string | null> | null = null;

// ─── Initialization ─────────────────────────────────────────────

export function setFontRegistrar(registrar: FontRegistrar | null): void {
  fontRegistrar = registrar;
}

// ─── Weight / Style Mapping ─────────────────────────────────────

const WEIGHT_MAP: Record<string, number> = {
  thin: 100, hairline: 100,
  extralight: 200, ultralight: 200,
  light: 300,
  regular: 400, normal: 400, '': 400,
  medium: 500,
  semibold: 600, demibold: 600,
  bold: 700,
  extrabold: 800, ultrabold: 800,
  black: 900, heavy: 900,
};

const WEIGHT_TO_STYLE: Record<number, string> = {
  100: 'Thin', 200: 'ExtraLight', 300: 'Light',
  400: 'Regular', 500: 'Medium', 600: 'SemiBold',
  700: 'Bold', 800: 'ExtraBold', 900: 'Black',
};

export function styleToWeight(style: string): number {
  const lower = style.toLowerCase().replace(/[\s-_]/g, '').replace('italic', '');
  for (const [key, weight] of Object.entries(WEIGHT_MAP)) {
    if (lower.includes(key) && key !== '') return weight;
  }
  return 400;
}

export function weightToStyle(weight: number, italic = false): string {
  // Snap to nearest 100
  const snapped = Math.round(weight / 100) * 100;
  const base = WEIGHT_TO_STYLE[snapped] ?? 'Regular';
  return italic ? `${base} Italic` : base;
}

export function styleToVariant(style: string): string {
  const weight = styleToWeight(style);
  const isItalic = /italic/i.test(style);
  if (weight === 400 && !isItalic) return 'regular';
  if (weight === 400 && isItalic) return 'italic';
  return isItalic ? `${weight}italic` : `${weight}`;
}

export function normalizeFontFamily(family: string): string {
  return family.replace(/\s*Variable$/i, '');
}

// ─── Font Cache ─────────────────────────────────────────────────

function cacheKey(family: string, style: string): string {
  return `${normalizeFontFamily(family)}|${style || 'Regular'}`;
}

export function isFontLoaded(family: string): boolean {
  const prefix = `${normalizeFontFamily(family)}|`;
  for (const key of loadedFamilies.keys()) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

export function getLoadedFontData(family: string, style: string): ArrayBuffer | null {
  return loadedFamilies.get(cacheKey(family, style)) ?? null;
}

export function markFontLoaded(family: string, style: string, data: ArrayBuffer): void {
  const key = cacheKey(family, style);
  loadedFamilies.set(key, data);
  fontRegistrar?.(normalizeFontFamily(family), style, data);
}

// ─── Variable Font Detection ────────────────────────────────────

export function isVariableFont(data: ArrayBuffer): boolean {
  const view = new DataView(data);
  if (data.byteLength < 12) return false;

  const numTables = view.getUint16(4);
  for (let i = 0; i < numTables; i++) {
    const offset = 12 + i * 16;
    if (offset + 4 > data.byteLength) break;

    const tag = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );
    if (tag === 'fvar') return true;
  }
  return false;
}

// ─── Google Fonts ───────────────────────────────────────────────

const GOOGLE_FONTS_API = 'https://www.googleapis.com/webfonts/v1/webfonts';
const GOOGLE_FONTS_KEY = 'AIzaSyAPcbKiHmMOQRMYyATi95veNFkXtY30lnA';

async function fetchGoogleFontFiles(family: string): Promise<Record<string, string> | null> {
  const normalized = normalizeFontFamily(family);
  if (googleFontsCache.has(normalized)) return googleFontsCache.get(normalized)!;
  if (googleFontsFailed.has(normalized)) return null;

  try {
    const url = `${GOOGLE_FONTS_API}?family=${encodeURIComponent(normalized)}&key=${GOOGLE_FONTS_KEY}`;
    const res = await fetch(url);
    if (!res.ok) {
      googleFontsFailed.add(normalized);
      return null;
    }
    const json = await res.json();
    const item = json?.items?.[0];
    if (!item?.files) {
      googleFontsFailed.add(normalized);
      return null;
    }
    googleFontsCache.set(normalized, item.files);
    return item.files;
  } catch {
    googleFontsFailed.add(normalized);
    return null;
  }
}

async function fetchGoogleFont(family: string, style = 'Regular'): Promise<ArrayBuffer | null> {
  const files = await fetchGoogleFontFiles(family);
  if (!files) return null;

  const variant = styleToVariant(style);
  const url = files[variant] ?? files['regular'] ?? Object.values(files)[0];
  if (!url) return null;

  try {
    const res = await fetch(url.replace('http:', 'https:'));
    if (!res.ok) return null;
    return res.arrayBuffer();
  } catch {
    return null;
  }
}

// ─── System Fonts (Browser Font Access API) ─────────────────────

export async function queryFonts(): Promise<FontInfo[]> {
  if (typeof globalThis === 'undefined') return [];
  const g = globalThis as any;
  if (!g.queryLocalFonts) return [];

  try {
    const fonts: any[] = await g.queryLocalFonts();
    return fonts.map((f: any) => ({
      family: f.family,
      fullName: f.fullName,
      style: f.style,
      postscriptName: f.postscriptName,
    }));
  } catch {
    return [];
  }
}

let localFontsCache: FontInfo[] | null = null;

async function findLocalFont(family: string, style = 'Regular'): Promise<ArrayBuffer | null> {
  if (!localFontsCache) {
    localFontsCache = await queryFonts();
  }
  if (localFontsCache.length === 0) return null;

  const normalized = normalizeFontFamily(family);
  const match = localFontsCache.find(
    f => f.family === normalized && f.style.toLowerCase() === style.toLowerCase()
  ) ?? localFontsCache.find(f => f.family === normalized);

  if (!match) return null;

  try {
    const g = globalThis as any;
    if (!g.queryLocalFonts) return null;
    const fonts: any[] = await g.queryLocalFonts({ postscriptNames: [match.postscriptName] });
    if (fonts.length === 0) return null;
    const blob: Blob = await fonts[0].blob();
    return blob.arrayBuffer();
  } catch {
    return null;
  }
}

// ─── Bundled Fonts ──────────────────────────────────────────────

const BUNDLED_FONTS: Record<string, string> = {
  'Inter|Regular': '/fonts/Inter-Regular.ttf',
  'Inter|Bold': '/fonts/Inter-Bold.ttf',
};

export function registerBundledFont(key: string, url: string): void {
  BUNDLED_FONTS[key] = url;
}

async function fetchBundledFont(key: string): Promise<ArrayBuffer | null> {
  const url = BUNDLED_FONTS[key];
  if (!url) return null;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return res.arrayBuffer();
  } catch {
    return null;
  }
}

// ─── Main Loader ────────────────────────────────────────────────

/**
 * Load a font by family and style. Tries:
 * 1. Cache
 * 2. Local system fonts (Font Access API)
 * 3. Google Fonts API
 * 4. Bundled fonts
 *
 * Returns font data or null.
 */
export async function loadFont(
  family: string,
  style = 'Regular',
): Promise<ArrayBuffer | null> {
  const key = cacheKey(family, style);

  // 1. Cache
  const cached = loadedFamilies.get(key);
  if (cached) return cached;

  // 2. Local
  let data = await findLocalFont(family, style);

  // 3. Google Fonts
  if (!data) {
    data = await fetchGoogleFont(family, style);
  }

  // 4. Bundled
  if (!data) {
    data = await fetchBundledFont(key);
  }

  if (data) {
    markFontLoaded(family, style, data);
  }

  return data;
}

/**
 * Ensure a font with specific weight is loaded.
 */
export async function ensureNodeFont(family: string, weight: number): Promise<void> {
  const style = weightToStyle(weight);
  await loadFont(family, style);
}

// ─── Font Collection from Scene Graph ───────────────────────────

/**
 * Collect all font family+style pairs used by a set of nodes.
 */
export function collectFontKeys(
  graph: SceneGraph,
  nodeIds: string[],
): Array<[string, string]> {
  const keys = new Set<string>();

  for (const id of nodeIds) {
    const node = graph.getNode(id);
    if (!node || node.type !== 'TEXT') continue;

    const baseKey = `${node.fontFamily}|${weightToStyle(node.fontWeight, node.italic)}`;
    keys.add(baseKey);

    for (const run of node.styleRuns) {
      const runFamily = run.style.fontFamily ?? node.fontFamily;
      const runWeight = run.style.fontWeight ?? node.fontWeight;
      const runItalic = run.style.italic ?? node.italic;
      keys.add(`${runFamily}|${weightToStyle(runWeight, runItalic)}`);
    }
  }

  return [...keys].map(k => k.split('|') as [string, string]);
}

/**
 * List all available font families from all sources.
 */
export async function listFamilies(): Promise<string[]> {
  const families = new Set<string>();

  // From loaded cache
  for (const key of loadedFamilies.keys()) {
    families.add(key.split('|')[0]);
  }

  // From local fonts
  const local = await queryFonts();
  for (const f of local) {
    families.add(f.family);
  }

  return [...families].sort();
}

// ─── CJK Fallback ───────────────────────────────────────────────

export function getCJKFallbackFamily(): string | null {
  return cjkFallbackFamily;
}

export function setCJKFallbackFamily(family: string): void {
  cjkFallbackFamily = family;
}

export async function ensureCJKFallback(): Promise<string | null> {
  if (cjkFallbackFamily) return cjkFallbackFamily;
  if (cjkFallbackPromise) return cjkFallbackPromise;

  cjkFallbackPromise = (async () => {
    // Try Google Fonts CJK
    const family = 'Noto Sans SC';
    const data = await loadFont(family, 'Regular');
    if (data) {
      cjkFallbackFamily = family;
      return family;
    }
    return null;
  })();

  return cjkFallbackPromise;
}
