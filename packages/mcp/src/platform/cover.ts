/**
 * Procedural project covers.
 *
 * When a scene's rasterized thumbnail is unavailable (CanvasKit not yet
 * initialized, export failed, or cold-start slow) the dashboard needs
 * *something* behind the card. A broken-image icon or a scaled iframe
 * hack both look amateur. Instead we render a deterministic, brand-
 * aware SVG cover from the scene id + name + optional brand slug.
 *
 * The output is pure SVG (no fonts loaded, no external refs) so it
 * renders instantly as a CSS background-image or <img src>.
 */

const BRAND_PALETTES: Record<string, [string, string, string]> = {
  // [primary, secondary, accent-tint]
  stripe:    ['#635bff', '#00d4ff', '#ffffff'],
  linear:    ['#5e6ad2', '#8a94e6', '#f4f5f8'],
  airbnb:    ['#ff385c', '#ff7385', '#fff0f3'],
  vercel:    ['#111111', '#434343', '#00d4ff'],
  notion:    ['#37352f', '#6b6a64', '#e9e5e2'],
  spotify:   ['#1db954', '#0f7a37', '#eafff0'],
  github:    ['#0969da', '#1f2328', '#dbeafe'],
  figma:     ['#f24e1e', '#a259ff', '#fff2ed'],
  arc:       ['#ff6b4a', '#6e5bff', '#ffeae3'],
  supabase:  ['#3ecf8e', '#0e1a13', '#e5fff1'],
  raycast:   ['#ff6363', '#1a1a1a', '#ffe0e0'],
  loom:      ['#625df5', '#c2bfff', '#eeedff'],
  apple:     ['#1d1d1f', '#86868b', '#f5f5f7'],
  ferrari:   ['#ff2800', '#1a0a08', '#ffe1dc'],
  nike:      ['#111111', '#757575', '#f5f5f5'],
};

function hash(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function paletteFor(brandSlug: string | undefined, seed: string): [string, string, string] {
  if (brandSlug) {
    const key = brandSlug.toLowerCase().replace(/^inspired by\s+/, '').trim();
    if (BRAND_PALETTES[key]) return BRAND_PALETTES[key];
  }
  // Procedural palette from seed. Pick a rich hue, create a darker
  // companion and a near-white accent. HSL → sRGB.
  const h = hash(seed) % 360;
  const h2 = (h + 32) % 360;
  return [`hsl(${h} 68% 52%)`, `hsl(${h2} 55% 22%)`, `hsl(${h} 60% 94%)`];
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function initials(name: string): string {
  const clean = name.replace(/[-_]+/g, ' ').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '·';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export interface CoverOptions {
  name: string;
  sceneId: string;
  brand?: string;
  width?: number;
  height?: number;
  variants?: number;
}

/**
 * Render a deterministic SVG cover. Size is viewBox-normalized 800×500
 * (16:10, matching `.overview-thumb aspect-ratio`). Safe to inline as
 * a `url("data:image/svg+xml,…")` background or serve as a file.
 */
export function renderCoverSvg(opts: CoverOptions): string {
  const { name, sceneId } = opts;
  const brand = (opts.brand || '').replace(/^inspired by\s+/i, '').trim();
  const [c1, c2, tint] = paletteFor(brand || undefined, sceneId || name);
  const h = hash(sceneId || name);

  // Procedural geometry — three rotated/shifted circles + a thin arc.
  // Positions are pseudo-random but bounded to the right half so the
  // left-side typography stays legible.
  const angle = (h % 360);
  const rBig = 170 + ((h >> 4) % 80);
  const cxBig = 620 + ((h >> 9) % 120);
  const cyBig = 100 + ((h >> 13) % 320);
  const rSmall = 60 + ((h >> 17) % 30);
  const cxSmall = 540 + ((h >> 21) % 60);
  const cySmall = 380 + ((h >> 25) % 40);

  const display = name || 'untitled';
  const shortName = display.length > 22 ? display.slice(0, 21) + '…' : display;
  const init = initials(display);
  const subtitle = brand
    ? brand.toUpperCase()
    : (opts.width && opts.height ? `${opts.width}×${opts.height}` : 'REFRAME');
  const variantLine = opts.variants && opts.variants > 1
    ? `${opts.variants} scenes`
    : 'scene';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" role="img" aria-label="${escape(display)}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${c1}"/>
      <stop offset="1" stop-color="${c2}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.82" cy="0.15" r="0.85">
      <stop offset="0" stop-color="${tint}" stop-opacity="0.35"/>
      <stop offset="1" stop-color="${tint}" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M40 0 L0 0 0 40" fill="none" stroke="rgba(255,255,255,0.045)" stroke-width="1"/>
    </pattern>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="18"/>
    </filter>
  </defs>

  <rect width="800" height="500" fill="url(#g)"/>
  <g transform="rotate(${angle} 400 250)" opacity="0.55">
    <circle cx="${cxBig}" cy="${cyBig}" r="${rBig}" fill="${tint}" opacity="0.09" filter="url(#soft)"/>
    <circle cx="${cxSmall}" cy="${cySmall}" r="${rSmall}" fill="${tint}" opacity="0.14"/>
  </g>
  <rect width="800" height="500" fill="url(#grid)"/>
  <rect width="800" height="500" fill="url(#glow)"/>

  <g transform="translate(48 46)">
    <rect x="0" y="0" rx="13" ry="13" width="108" height="26" fill="rgba(255,255,255,0.14)" stroke="rgba(255,255,255,0.22)"/>
    <text x="54" y="17.5" text-anchor="middle" font-family="'Geist','Inter',system-ui,sans-serif" font-size="10.5" font-weight="600" fill="#fff" letter-spacing="0.16em">${escape(subtitle)}</text>
  </g>

  <g transform="translate(700 48)">
    <circle cx="0" cy="18" r="22" fill="rgba(255,255,255,0.14)" stroke="rgba(255,255,255,0.22)"/>
    <text x="0" y="23" text-anchor="middle" font-family="'Geist','Inter',system-ui,sans-serif" font-size="14" font-weight="600" fill="#fff" letter-spacing="0.02em">${escape(init)}</text>
  </g>

  <text x="48" y="330" font-family="'Geist','Inter',system-ui,sans-serif" font-size="${shortName.length > 14 ? 46 : 58}" font-weight="600" fill="#fff" letter-spacing="-0.025em">${escape(shortName)}</text>
  <text x="48" y="372" font-family="'JetBrains Mono','ui-monospace',monospace" font-size="12" fill="rgba(255,255,255,0.7)" letter-spacing="0.14em">${escape(variantLine.toUpperCase())}</text>

  <g transform="translate(48 430)" opacity="0.85">
    <rect x="0" y="0" width="36" height="3" rx="1.5" fill="#fff"/>
    <rect x="44" y="0" width="14" height="3" rx="1.5" fill="rgba(255,255,255,0.45)"/>
    <rect x="66" y="0" width="22" height="3" rx="1.5" fill="rgba(255,255,255,0.45)"/>
  </g>
</svg>`;
}

/** Lowercase slug → palette existence check (exported for tests). */
export function hasBrandPalette(slug: string): boolean {
  return BRAND_PALETTES[slug.toLowerCase()] !== undefined;
}
