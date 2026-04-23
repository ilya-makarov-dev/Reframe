// Brands catalog — second-level surface. Renders brands-catalog
// artifact, hydrates with a grid of brand-card artifacts built from
// every brand in .reframe/brands/.

import type { PlatformContext } from '../router.js';
import { renderPanelAsync, loadPanelArtifacts } from '../panel-registry.js';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DOC_CSS = `
  html, body { margin:0; padding:0; height:100vh; overflow:hidden; background:#0a0a0e; color:#e8e8ec; }
  * { box-sizing:border-box; }
  [data-intent-role="brand-card/root"] {
    transition: border-color 160ms, transform 160ms;
  }
  [data-intent-role="brand-card/root"]:hover {
    border-color: #2f2f3a !important;
    transform: translateY(-2px);
  }
  [data-intent-role^="brands-catalog/nav-"]:hover {
    background: #14141c !important;
    color: #e8e8ec !important;
  }
`;

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

function humanAge(ms: number): string {
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function loadBrandPreviewFromMdPath(slug: string, mdPath: string) {
  if (!existsSync(mdPath)) return null;
  try {
    const md = readFileSync(mdPath, 'utf-8');
    const hexes: string[] = [];
    const roleColors: Array<{ role: string; hex: string }> = [];
    const hexRe = /\*\*([^*]+)\*\*[^#]*#([0-9a-fA-F]{6})/g;
    let m: RegExpExecArray | null;
    while ((m = hexRe.exec(md)) && roleColors.length < 8) {
      const hex = '#' + m[2];
      if (!hexes.includes(hex)) {
        hexes.push(hex);
        roleColors.push({ role: m[1].trim(), hex });
      }
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

function brandPreviewStyle(hex: string): string {
  return `flex:1; padding:20px 18px; display:flex; flex-direction:column; justify-content:center; gap:4px; color:#e8e8ec; position:relative; overflow:hidden; background:linear-gradient(135deg, ${hex}33, ${hex}0a), #0f0f14;`;
}
function brandSampleStyle(font: string): string {
  return `font-size:22px; font-weight:600; letter-spacing:-0.02em; line-height:1.1; font-family:'${font}', Inter, system-ui, sans-serif;`;
}
function swatchStyle(hex: string): string {
  return `flex:1; background:${hex}; min-height:40px;`;
}

export async function renderBrandsCatalogPage(ctx: PlatformContext): Promise<string> {
  const projectDir = ctx.projectDir;
  if (!projectDir) {
    return `<!DOCTYPE html><body style="background:#0a0a0e;color:#e8e8ec;font-family:system-ui;padding:40px">
      <h1>No project</h1><p><a href="/platform" style="color:#635BFF">← feed</a></p></body>`;
  }
  loadPanelArtifacts(projectDir);

  // Enumerate from both pack dir and legacy brands dir (packs win)
  const seen = new Set<string>();
  const brands: any[] = [];
  const sources = [
    join(projectDir, '.reframe', 'packs', 'brand'),
    join(projectDir, '.reframe', 'brands'),
  ];
  for (const srcDir of sources) {
    if (!existsSync(srcDir)) continue;
    for (const slug of readdirSync(srcDir)) {
      if (seen.has(slug)) continue;
      const d = join(srcDir, slug);
      try { if (!statSync(d).isDirectory()) continue; } catch { continue; }
      const preview = loadBrandPreviewFromMdPath(slug, join(d, 'DESIGN.md'));
      if (preview) { seen.add(slug); brands.push(preview); }
    }
  }

  const shell = await renderPanelAsync('brands-catalog', {
    __raw: true,
    projectBrandCount: brands.length,
  }, { projectDir });

  const cardHtmlParts: string[] = [];
  for (const b of brands) {
    try {
      const primary = b.colors[0]?.hex ?? '#635BFF';
      const r = await renderPanelAsync('brand-card', {
        __raw: true,
        type: 'brand',
        brandSlug: b.slug,
        brandName: b.name,
        typeface: b.typeface,
        sampleText: b.sample,
        colors: b.colors.map((c: any) => ({ ...c, swatchStyle: swatchStyle(c.hex) })),
        token_count: b.tokenCount,
        age: b.age,
        previewStyle: brandPreviewStyle(primary),
        sampleStyle: brandSampleStyle(b.typeface),
      }, { projectDir });
      cardHtmlParts.push(r.html);
    } catch {
      // skip broken brand
    }
  }

  let body = shell.html;
  if (cardHtmlParts.length > 0) {
    body = hydrateSlot(body, 'brand-grid', cardHtmlParts.join('\n'));
  }

  const assets = Date.now();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>reframe · brands</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>${DOC_CSS}</style>
</head>
<body>
  ${body}
  <script src="/platform/ui/055-agent-runtime.js?v=${assets}" defer></script>
</body>
</html>`;
}
