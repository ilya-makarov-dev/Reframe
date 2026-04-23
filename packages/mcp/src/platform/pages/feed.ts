// Feed page — the NEW Platform UI home (Phase 8.0).
//
// Entire surface authored as artifacts (.reframe/ui/*.panel.html).
// This file is data plumbing only: enumerates real session data
// (scenes, brands, videos), builds card configs, composes the feed
// shell with hero-prompt + jobs-ticker + grid of cards.
//
// MJ-shape: prompt hero at top, jobs ticker, infinite grid of
// heterogeneous cards. Click card → drilldown route per type.

import type { PlatformContext } from '../router.js';
import { renderPanelAsync, loadPanelArtifacts } from '../panel-registry.js';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ─── HTML wrapper ─────────────────────────────────────────────────

const DOC_CSS = `
  html, body { margin:0; padding:0; height:100vh; overflow:hidden; background:#0a0a0e; color:#e8e8ec; }
  * { box-sizing:border-box; }
  iframe { color-scheme: light; }

  /* Card hover reveals the action overlay */
  [data-intent-role$="-card/root"] {
    transition: border-color 160ms, transform 160ms, box-shadow 160ms;
  }
  [data-intent-role$="-card/root"]:hover {
    border-color: #2f2f3a !important;
    transform: translateY(-2px);
    box-shadow: 0 12px 32px -14px rgba(0,0,0,0.55);
  }
  [data-intent-role="scene-card/root"]:hover .rf-card-hover,
  [data-intent-role$="-card/root"]:hover [data-intent-role$="/hover-overlay"] {
    opacity: 1 !important;
  }
  [data-intent-role^="feed-shell/nav-"]:hover {
    background: #14141c !important;
    color: #e8e8ec !important;
  }
  [data-intent-role^="feed-shell/filter-"]:hover {
    background: #16161d !important;
    border-color: #2f2f3a !important;
    color: #e8e8ec !important;
  }
  [data-intent-role="hero-prompt/send"]:hover { transform: translateY(-1px); box-shadow: 0 6px 18px -4px rgba(99,91,255,0.6); }
  [data-intent-role^="hero-prompt/quick-"]:hover {
    border-color: #3a3a44 !important;
    color: #e8e8ec !important;
  }
  [data-intent-role^="scene-card/hover-"]:hover {
    background: rgba(40,40,52,0.98) !important;
    border-color: #3a3a44 !important;
  }
  [data-intent-role="scene-card/hover-export"]:hover {
    background: rgba(99,91,255,1) !important;
  }

  /* Nicer scrollbar on the feed body */
  [data-intent-role="feed-shell/body"]::-webkit-scrollbar { width: 10px; }
  [data-intent-role="feed-shell/body"]::-webkit-scrollbar-track { background: transparent; }
  [data-intent-role="feed-shell/body"]::-webkit-scrollbar-thumb { background: #1c1c25; border-radius: 5px; }
  [data-intent-role="feed-shell/body"]::-webkit-scrollbar-thumb:hover { background: #23232b; }

  .rf-gesture-pressed { opacity: 0.8; transform: scale(0.98); transition: all 120ms; }
`;

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Slot hydration (nesting-aware) ───────────────────────────────

function hydrateSlot(html: string, slotName: string, inner: string): string {
  const openRe = new RegExp(`<[a-z]+[^>]*data-mount-slot="${slotName}"[^>]*>`, 'i');
  const openMatch = openRe.exec(html);
  if (!openMatch) return html;
  const tagMatch = /^<([a-z]+)/i.exec(openMatch[0]);
  const tag = tagMatch ? tagMatch[1].toLowerCase() : 'div';
  const openEnd = openMatch.index + openMatch[0].length;
  const openTag = `<${tag}`;
  const closeTag = `</${tag}>`;
  let depth = 1;
  let i = openEnd;
  while (i < html.length && depth > 0) {
    const nextOpen = html.indexOf(openTag, i);
    const nextClose = html.indexOf(closeTag, i);
    if (nextClose === -1) return html;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + openTag.length;
    } else {
      depth--;
      if (depth === 0) {
        return html.slice(0, openEnd) + inner + html.slice(nextClose);
      }
      i = nextClose + closeTag.length;
    }
  }
  return html;
}

// ─── Brand loader ─────────────────────────────────────────────────

interface BrandPreview {
  slug: string;
  name: string;
  typeface: string;
  sample: string;
  colors: Array<{ role: string; hex: string }>;
  tokenCount: number;
  age: string;
}

// NOTE: the per-dir brand loader now lives as `loadBrandPreviewFromDir`
// below, so both the pack and legacy brand directory can share the
// same extraction logic without duplicating the DESIGN.md parsing.

function listBrands(projectDir: string): BrandPreview[] {
  const seen = new Set<string>();
  const out: BrandPreview[] = [];

  // 1. Pack-installed brands — first-class, versioned
  const packsBrandDir = join(projectDir, '.reframe', 'packs', 'brand');
  if (existsSync(packsBrandDir)) {
    for (const slug of readdirSync(packsBrandDir)) {
      const d = join(packsBrandDir, slug);
      try { if (!statSync(d).isDirectory()) continue; } catch { continue; }
      const preview = loadBrandPreviewFromDir(slug, join(d, 'DESIGN.md'));
      if (preview) { seen.add(slug); out.push(preview); }
    }
  }

  // 2. Legacy brands at `.reframe/brands/<slug>/DESIGN.md`
  const legacyDir = join(projectDir, '.reframe', 'brands');
  if (existsSync(legacyDir)) {
    for (const slug of readdirSync(legacyDir)) {
      if (seen.has(slug)) continue;
      const d = join(legacyDir, slug);
      try { if (!statSync(d).isDirectory()) continue; } catch { continue; }
      const preview = loadBrandPreviewFromDir(slug, join(d, 'DESIGN.md'));
      if (preview) out.push(preview);
    }
  }

  return out;
}

function loadBrandPreviewFromDir(slug: string, mdPath: string): BrandPreview | null {
  if (!existsSync(mdPath)) return null;
  try {
    const md = readFileSync(mdPath, 'utf-8');
    const hexes: string[] = [];
    const roleColors: Array<{ role: string; hex: string }> = [];
    const hexRe = /\*\*([^*]+)\*\*[^#]*#([0-9a-fA-F]{6})/g;
    let m: RegExpExecArray | null;
    while ((m = hexRe.exec(md)) && roleColors.length < 8) {
      const hex = '#' + m[2];
      if (!hexes.includes(hex)) { hexes.push(hex); roleColors.push({ role: m[1].trim(), hex }); }
    }
    if (roleColors.length === 0) {
      const raw = md.match(/#[0-9a-fA-F]{6}/g) ?? [];
      for (const c of raw.slice(0, 6)) {
        if (!hexes.includes(c)) { hexes.push(c); roleColors.push({ role: 'color', hex: c }); }
      }
    }
    const fontMatch = md.match(/Inter|Söhne|Geist|Outfit|Cabinet|Roboto|SF Pro|Helvetica|Playfair|Space Grotesk|Grotesk|JetBrains/i);
    const typeface = fontMatch ? fontMatch[0] : 'System';
    const h1 = md.match(/^#\s+(.+)$/m);
    const name = h1 ? h1[1].replace(/—|-.*$/, '').trim() : slug;
    const taglines: Record<string, string> = {
      ferrari: 'Pure speed.',
      'linear.app': 'Built for builders.',
      stripe: 'Payments, designed.',
      airbnb: 'Belong anywhere.',
      default: 'Your brand in motion.',
    };
    const sample = taglines[slug.toLowerCase()] ?? taglines.default;
    const st = statSync(mdPath);
    const age = humanAge(Date.now() - st.mtimeMs);
    return { slug, name, typeface, sample, colors: roleColors, tokenCount: roleColors.length, age };
  } catch {
    return null;
  }
}

// ─── Video enumeration ────────────────────────────────────────────

function listVideos(projectDir: string): Array<{ path: string; mtime: number; sceneId?: string; sceneName?: string }> {
  const dir = join(projectDir, '.reframe', 'exports');
  if (!existsSync(dir)) return [];
  const out: Array<{ path: string; mtime: number; sceneId?: string; sceneName?: string }> = [];
  for (const sub of readdirSync(dir)) {
    const mp4 = join(dir, sub, 'out.mp4');
    if (existsSync(mp4)) {
      const st = statSync(mp4);
      out.push({ path: mp4, mtime: st.mtimeMs });
    }
  }
  return out;
}

// ─── Helpers ──────────────────────────────────────────────────────

function humanAge(ms: number): string {
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

// data-bind-attr="style:X" replaces the whole inline style attribute,
// so every property the element needs (layout + paint) must be in the
// bound value. These helpers keep the author-side binding entries
// self-contained.

function brandPreviewStyle(hex: string): string {
  return `flex:1; padding:20px 18px; display:flex; flex-direction:column; justify-content:center; gap:4px; color:#e8e8ec; position:relative; overflow:hidden; background:linear-gradient(135deg, ${hex}33, ${hex}0a), #0f0f14;`;
}
function brandSampleStyle(font: string): string {
  return `font-size:22px; font-weight:600; letter-spacing:-0.02em; line-height:1.1; font-family:'${font}', Inter, system-ui, sans-serif;`;
}
function swatchStyle(hex: string): string {
  return `flex:1; background:${hex}; min-height:40px;`;
}

// ─── Render entry ─────────────────────────────────────────────────

export async function renderFeedPage(
  ctx: PlatformContext,
  filter: string = 'all',
): Promise<string> {
  const projectDir = ctx.projectDir;
  if (!projectDir) {
    return `<!DOCTYPE html><body style="background:#0a0a0e;color:#e8e8ec;font-family:system-ui;padding:40px">
      <h1>No project initialized</h1>
      <p>Run <code>reframe project init</code> and return to <a href="/platform" style="color:#635BFF">/platform</a>.</p>
    </body>`;
  }

  loadPanelArtifacts(projectDir);

  const activeBrand = (ctx as any).activeBrand ?? 'none';
  const activeSize = '1440px';

  // ─── Build card configs from real data ──────────────────────────

  type CardConfig = { type: string; ts: number; artifact: string; config: Record<string, unknown> };
  const cards: CardConfig[] = [];

  // Scenes
  for (const s of ctx.sessionScenes) {
    const width = (s as any).width ?? 1440;
    const height = (s as any).height ?? 900;
    cards.push({
      type: 'scene',
      ts: Date.now(),
      artifact: 'scene-card',
      config: {
        type: 'scene',
        sceneId: s.id,
        slug: s.slug ?? s.id,
        name: s.name ?? s.slug ?? s.id,
        size: `${width}×${height}`,
        nodes: (s as any).nodes ?? 0,
        age: (s as any).age ?? 'just now',
        brand: activeBrand,
        previewUrl: `/preview/${s.id}`,
      },
    });
  }

  // Brands
  const brands = listBrands(projectDir);
  for (const b of brands) {
    const primary = b.colors[0]?.hex ?? '#635BFF';
    cards.push({
      type: 'brand',
      ts: Date.now() - 86400_000,
      artifact: 'brand-card',
      config: {
        type: 'brand',
        brandSlug: b.slug,
        brandName: b.name,
        typeface: b.typeface,
        sampleText: b.sample,
        colors: b.colors.map(c => ({
          ...c,
          swatchStyle: swatchStyle(c.hex),
        })),
        token_count: b.tokenCount,
        age: b.age,
        previewStyle: brandPreviewStyle(primary),
        sampleStyle: brandSampleStyle(b.typeface),
      },
    });
  }

  // One synthetic variants card — demonstrates the UI when user has
  // run `reframe_edit op=vary`. We build this from the first scene so
  // the shape renders even without a real variants directory.
  if (ctx.sessionScenes.length > 0) {
    const base = ctx.sessionScenes[0];
    const thumbs: Array<{ previewUrl: string }> = [];
    for (const s of ctx.sessionScenes.slice(0, 8)) {
      thumbs.push({ previewUrl: `/preview/${s.id}` });
    }
    cards.push({
      type: 'variants',
      ts: Date.now() - 3600_000,
      artifact: 'variants-card',
      config: {
        type: 'variants',
        cardId: `variants-${base.id}`,
        sourceSceneId: base.id,
        sourceName: base.name ?? base.slug ?? base.id,
        count: thumbs.length,
        age: '1h ago',
        brand: activeBrand,
        variants: thumbs,
      },
    });
  }

  // Videos
  const videos = listVideos(projectDir);
  for (const v of videos) {
    cards.push({
      type: 'video',
      ts: v.mtime,
      artifact: 'video-card',
      config: {
        type: 'video',
        cardId: `video-${v.mtime}`,
        sourceSceneId: v.sceneId ?? 's?',
        sourceName: v.sceneName ?? 'Scene',
        durationSec: 15,
        age: humanAge(Date.now() - v.mtime),
        brand: activeBrand,
        posterUrl: '',
        videoUrl: '/static/video-smoke.mp4', // served via static handler if wired
      },
    });
  }

  // Synthetic site card — assembled from first 4 scenes as pages, so the
  // site-card shape shows in the feed even without a real SITE.md yet.
  if (ctx.sessionScenes.length >= 4) {
    const pages = ctx.sessionScenes.slice(0, 4).map((s, i) => ({
      slug: s.slug ?? s.id,
      label: (s.name ?? s.slug ?? s.id).slice(0, 12).toLowerCase(),
      previewUrl: `/preview/${s.id}`,
    }));
    cards.push({
      type: 'site',
      ts: Date.now() - 2 * 86400_000,
      artifact: 'site-card',
      config: {
        type: 'site',
        cardId: 'site-demo',
        siteName: 'demo.site',
        siteSlug: 'demo',
        pageCount: pages.length,
        age: '2d ago',
        brand: activeBrand,
        pages,
      },
    });
  }

  // Optional filter
  const filtered = filter === 'all' ? cards : cards.filter(c => c.type === filter);
  // Newest first
  filtered.sort((a, b) => b.ts - a.ts);

  // ─── Compose artifacts ──────────────────────────────────────────

  const shell = await renderPanelAsync('feed-shell', {
    __raw: true,
    activeBrand,
    activeSize,
    navCurrent: 'feed',
    filterActive: filter,
    cardCount: filtered.length,
    runningJobs: 0,
    queuedJobs: 0,
  }, { projectDir });

  // Hero prompt: reference chips start empty for cold load; after a
  // user picks a frame from a drilldown the server writes a session
  // ref that surfaces as chips here. variantCount defaults to 4 (the
  // MJ-shape default — every prompt spawns 4 siblings).
  const refs: Array<Record<string, unknown>> = [];
  const heroHtml = (await renderPanelAsync('hero-prompt', {
    __raw: true,
    activeBrand,
    activeSize,
    variantCount: 4,
    refs,
    placeholder: 'a pricing page for a developer tool, 3 tiers, usage bar · a promo video of the last one · rebrand s17 as Airbnb',
  }, { projectDir })).html;

  const tickerHtml = (await renderPanelAsync('jobs-ticker', {
    __raw: true,
    runningJobs: 0,
    queuedJobs: 0,
    jobs: [],
  }, { projectDir })).html;

  // Render each card via its own artifact
  const cardHtmlParts: string[] = [];
  for (const c of filtered) {
    try {
      const r = await renderPanelAsync(c.artifact, { __raw: true, ...c.config }, { projectDir });
      cardHtmlParts.push(r.html);
    } catch (e) {
      cardHtmlParts.push(
        `<div style="padding:20px;background:#2a1414;border:1px solid #3a2020;border-radius:8px;color:#ffb4b4;font-size:12px">
           card render failed for ${escape(c.artifact)}: ${escape(String((e as any)?.message ?? e))}
         </div>`,
      );
    }
  }
  const gridHtml = cardHtmlParts.join('\n');

  let body = shell.html;
  body = hydrateSlot(body, 'hero-prompt', heroHtml);
  body = hydrateSlot(body, 'jobs-ticker', tickerHtml);
  if (gridHtml) body = hydrateSlot(body, 'feed-grid', gridHtml);

  const assets = Date.now();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>reframe</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>${DOC_CSS}</style>
  <script>try { var t=localStorage.getItem('reframe-theme'); if(t) document.documentElement.setAttribute('data-theme',t); } catch(_){}</script>
</head>
<body>
  ${body}
  <script src="/platform/ui/055-agent-runtime.js?v=${assets}" defer></script>
</body>
</html>`;
}
