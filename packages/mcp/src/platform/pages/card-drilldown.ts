// Card drilldown — MJ-style expanded picker view.
//
// URL: /platform/card/:id
// For scene ids (s1, s2, ...): picks 4 candidate siblings (the scene
// itself + 3 nearby in the store) and shows them as a 4-frame picker.
// For variants-<id> / video-<id> / site-<id>: unpack the group.
//
// Right side: tool rail with MJ-style iterate actions — inpaint ·
// vary strong · vary subtle · upscale · remix · rebrand · animate ·
// export. Bottom: lineage (parent/child cards).
//
// Everything is artifact-authored (.reframe/ui/card-expand.panel.html).
// This file is data plumbing only.

import type { PlatformContext } from '../router.js';
import { renderPanelAsync, loadPanelArtifacts } from '../panel-registry.js';

const DOC_CSS = `
  html, body { margin:0; padding:0; height:100vh; overflow:hidden; background:#0a0a0e; color:#e8e8ec; }
  * { box-sizing:border-box; }
  iframe { color-scheme: light; }
  [data-intent-role="card-expand/back"]:hover { color:#e8e8ec !important; }
  [data-intent-role="card-expand/frame"]:hover {
    border-color: #2f2f3a !important;
    transform: translateY(-1px);
    transition: all 160ms;
  }
  [data-intent-role="card-expand/frame-pick"]:hover,
  [data-intent-role="card-expand/frame-upscale"]:hover {
    background: #14141c !important;
    color: #e8e8ec !important;
  }
  [data-intent-role^="card-expand/tool-"]:hover {
    border-color: #3a3a44 !important;
    background: #16161d !important;
  }
  [data-intent-role="card-expand/lineage-link"]:hover {
    border-color: #23232b !important;
    color: #e8e8ec !important;
    background: #13131a;
  }
  .rf-gesture-pressed { opacity: 0.8; transform: scale(0.98); transition: all 120ms; }
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
      if (depth === 0) return html.slice(0, openEnd) + inner + html.slice(nextClose);
      i = nextClose + closeTag.length;
    }
  }
  return html;
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Frame enumeration ────────────────────────────────────────────

interface FrameData {
  id: string;
  sceneId: string;
  previewUrl: string;
  size: string;
  badge: string;
  name: string;
}

function siblingScenes(ctx: PlatformContext, anchorId: string): FrameData[] {
  // For MVP: return the anchor + next 3 scenes in the store so the 4-up
  // picker layout renders meaningfully against real data. Phase 9+ will
  // actually generate N variants per prompt and persist them as a
  // proper sibling group — this is the UI substrate waiting for that
  // backend.
  const scenes = ctx.sessionScenes;
  const anchorIdx = scenes.findIndex(s => s.id === anchorId);
  if (anchorIdx === -1) return [];
  const picks = [scenes[anchorIdx]];
  for (let offset = 1; picks.length < 4 && offset < scenes.length; offset++) {
    const next = scenes[(anchorIdx + offset) % scenes.length];
    if (next && next.id !== anchorId) picks.push(next);
  }
  return picks.map((s, i) => {
    const width = (s as any).width ?? 1440;
    const height = (s as any).height ?? 900;
    return {
      id: `frame-${i + 1}`,
      sceneId: s.id,
      previewUrl: `/preview/${s.id}`,
      size: `${width}×${height}`,
      badge: `U${i + 1}`,
      name: s.name ?? s.slug ?? s.id,
    };
  });
}

// ─── Render entry ─────────────────────────────────────────────────

export async function renderCardDrilldownPage(
  ctx: PlatformContext,
  cardId: string,
): Promise<string> {
  const projectDir = ctx.projectDir;
  if (!projectDir) {
    return `<!DOCTYPE html><body style="background:#0a0a0e;color:#e8e8ec;font-family:system-ui;padding:40px">
      <h1>No project</h1><p><a href="/platform" style="color:#635BFF">← feed</a></p></body>`;
  }
  loadPanelArtifacts(projectDir);

  // Decide anchor scene id — cardId may be `s1` or `variants-s1` etc.
  let anchorId = cardId;
  let cardType = 'scene';
  let cardTitle = cardId;
  if (cardId.startsWith('variants-')) {
    anchorId = cardId.slice('variants-'.length);
    cardType = 'variants';
  } else if (cardId.startsWith('video-')) {
    anchorId = ctx.sessionScenes[0]?.id ?? 's1';
    cardType = 'video';
  } else if (cardId.startsWith('site-')) {
    anchorId = ctx.sessionScenes[0]?.id ?? 's1';
    cardType = 'site';
  }

  const frames = siblingScenes(ctx, anchorId);
  const primary = frames[0];
  if (primary) {
    cardTitle = primary.name;
  }

  // Synthesized prompt echo — until the agent backend is wired and
  // each card stores its spawning prompt. Stays informative instead of
  // showing an empty panel on the drilldown.
  const promptHints: Record<string, string> = {
    scene: 'Describe variants here. Your picks become references for the next prompt.',
    variants: 'Set of candidate layouts generated from one base. Pick one to continue narrowing.',
    video: 'A :15 promo compiled from the anchor scene with GSAP timeline.',
    site: 'Multi-page site assembled from scene references with shared brand tokens.',
  };

  // Lineage — shown empty for now but structurally ready for when we
  // start persisting parent/child pointers per card.
  const lineage: Array<{ relation: string; label: string; href: string }> = [];

  const activeBrand = (ctx as any).activeBrand ?? 'none';

  const html = await renderPanelAsync('card-expand', {
    __raw: true,
    cardId,
    cardType,
    title: cardTitle,
    brand: activeBrand,
    age: 'just now',
    focusedSceneId: primary?.sceneId ?? '',
    slug: primary?.sceneId ?? cardId,
    frames,
    promptText: promptHints[cardType] ?? promptHints.scene,
    lineage,
  }, { projectDir });

  const assets = Date.now();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>reframe · ${escape(cardTitle)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>${DOC_CSS}</style>
</head>
<body>
  ${html.html}
  <script src="/platform/ui/055-agent-runtime.js?v=${assets}" defer></script>
</body>
</html>`;
}
