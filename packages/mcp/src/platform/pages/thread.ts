// Thread space — the NEW Platform UI entry point (Phase 7.0).
//
// Replaces the dashboard/editor-shell as the app's front door. Chat
// drives intent, outputs land as cards in an infinite-ish space.
//
// Renders 100% through Phase 6 panel artifacts:
//   - .reframe/ui/thread-space.panel.html      — the whole shell
//   - .reframe/ui/scene-card.panel.html        — one scene as a card
//
// There is NO TypeScript composer for this page. Every pixel is an
// artifact on disk — hot-reloadable, user-editable, agent-authorable.
// Demonstrates the self-hosting thesis end-to-end.

import type { PlatformContext } from '../router.js';
import { renderPanelAsync, loadPanelArtifacts } from '../panel-registry.js';

// ─── HTML document wrapper ──────────────────────────────────────

const DOC_CSS = `
  html, body { margin:0; padding:0; height:100vh; overflow:hidden; background:#0b0b0f; color:#e8e8ec; }
  * { box-sizing:border-box; }
  iframe { color-scheme: light; }
  [data-intent-role="scene-card/root"]:hover {
    border-color: #2f2f3a !important;
    transform: translateY(-1px);
  }
  [data-intent-role="thread-space/thread-entry"]:hover {
    background: #0f0f14;
  }
  [data-intent-role="thread-space/thread-entry"][data-current="true"] {
    background: #14141c;
    color: #e8e8ec !important;
  }
  .rf-gesture-pressed { opacity: 0.8; transform: scale(0.98); transition: all 120ms; }
`;

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Slot hydration ─────────────────────────────────────────────
// Replace the content of a server-emitted mount-slot div with the
// passed HTML. Matches EXACT mount-slot attribute — order-insensitive
// inside the opening tag, handles self-nested divs via non-greedy match
// up to the closing tag of THAT slot.

function hydrateSlot(html: string, slotName: string, inner: string): string {
  // Walk div nesting so the slot's MATCHING close is found — the prior
  // non-greedy regex stopped at the FIRST </div> inside, which wiped
  // only part of the slot if its authoring placeholder used any nested
  // divs (common for empty-states). Stays regex-free for the inner
  // walk so the parser is predictable.
  const openRe = new RegExp(
    `<div[^>]*data-mount-slot="${slotName}"[^>]*>`,
    'i',
  );
  const openMatch = openRe.exec(html);
  if (!openMatch) return html;
  const openEnd = openMatch.index + openMatch[0].length;
  // Scan forward, counting <div> opens and closes.
  let depth = 1;
  let i = openEnd;
  while (i < html.length && depth > 0) {
    const nextOpen = html.indexOf('<div', i);
    const nextClose = html.indexOf('</div>', i);
    if (nextClose === -1) return html; // malformed, bail
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + 4;
    } else {
      depth--;
      if (depth === 0) {
        // Replace everything between openEnd and nextClose with inner.
        return html.slice(0, openEnd) + inner + html.slice(nextClose);
      }
      i = nextClose + 6;
    }
  }
  return html;
}

// ─── Data building ──────────────────────────────────────────────

interface ThreadData {
  id: string;
  title: string;
  cardCount: number;
  scenes: Array<{
    sceneId: string;
    slug: string;
    name: string;
    size: string;
    nodes: number;
    age: string;
    brand: string;
    previewUrl: string;
  }>;
}

function ageOf(ctx: PlatformContext, sceneId: string): string {
  const scene = ctx.sessionScenes.find(s => s.id === sceneId);
  return (scene as any)?.age ?? 'just now';
}

function buildMainThread(ctx: PlatformContext): ThreadData {
  // For MVP: one "Main thread" that contains every session scene.
  // Phase 7.1 will split scenes across real threads backed by disk.
  const scenes = ctx.sessionScenes.map(s => {
    const width = (s as any).width ?? 1440;
    const height = (s as any).height ?? 900;
    return {
      sceneId: s.id,
      slug: s.slug ?? s.id,
      name: s.name ?? s.slug ?? s.id,
      size: `${width}×${height}`,
      nodes: (s as any).nodes ?? 0,
      age: (s as any).age ?? 'just now',
      brand: (ctx as any).activeBrand ?? 'no brand',
      previewUrl: `/preview/${s.id}`,
    };
  });
  return {
    id: 'main',
    title: 'Main thread',
    cardCount: scenes.length,
    scenes,
  };
}

// ─── Render entry ───────────────────────────────────────────────

export async function renderThreadPage(
  ctx: PlatformContext,
  threadId: string = 'main',
): Promise<string> {
  const projectDir = ctx.projectDir;
  if (!projectDir) {
    return `<!DOCTYPE html><body style="background:#0b0b0f;color:#e8e8ec;font-family:system-ui;padding:40px">
      <h1>No project initialized</h1>
      <p>Run <code>reframe project init</code> then return to <a href="/platform/thread" style="color:#635BFF">/platform/thread</a>.</p>
      <p><a href="/platform?fallback=1" style="color:#52525a">legacy dashboard →</a></p>
    </body>`;
  }

  // Ensure the artifact registry is populated — the bootstrap hook in
  // http-server fires on first buildPlatformContext, but an explicit
  // reload here makes `npm run dev` hot-reloads predictable.
  loadPanelArtifacts(projectDir);

  const thread = buildMainThread(ctx);
  const threads = [
    { id: 'main', title: thread.title, cardCount: thread.cardCount },
  ];

  // Compose the shell via the artifact + config. Shell runs in RAW mode
  // (bindings resolve, but no INode compile roundtrip) — the browser's
  // native flex engine handles full-viewport `width:100%; height:100vh`
  // layouts better than Yoga, which clamps the root to the first child's
  // width when top-level sizing is ambiguous.
  const shell = await renderPanelAsync('thread-space', {
    __raw: true,
    activeThreadId: threadId,
    activeThreadTitle: thread.title,
    activeThreadSubtitle: thread.cardCount > 0
      ? `${thread.cardCount} card${thread.cardCount === 1 ? '' : 's'}`
      : 'nothing yet',
    threads,
    brandBadge: (ctx as any).activeBrand ?? 'No brand',
  }, { projectDir });

  // Render every scene-card artifact separately and concat — they share
  // the same composer so the per-card layout is consistent without any
  // TypeScript glue.
  const cardsHtmlParts: string[] = [];
  for (const scene of thread.scenes) {
    try {
      const card = await renderPanelAsync('scene-card', { __raw: true, ...scene } as any, { projectDir });
      cardsHtmlParts.push(card.html);
    } catch (e) {
      cardsHtmlParts.push(
        `<div style="padding:20px;background:#2a1414;border:1px solid #3a2020;border-radius:8px;color:#ffb4b4;font-size:12px">
          scene-card render failed for ${escape(scene.slug)}: ${escape(String((e as any)?.message ?? e))}
        </div>`,
      );
    }
  }
  const cardsHtml = cardsHtmlParts.length > 0
    ? cardsHtmlParts.join('\n')
    // Leave the artifact's empty-state div in place by inserting nothing.
    : '';

  // Chat chrome — authored as an artifact so its theming stays aligned
  // with the thread-space shell. The streaming SSE behavior is wired in
  // platform-ui.js against any input carrying the expected data-intent-
  // role, so swapping chrome here doesn't touch behavior.
  let chatHtml = '';
  try {
    const chat = await renderPanelAsync('thread-chat', {
      __raw: true,
      scopeChips: [
        { label: `thread: ${thread.title}` },
        { label: `brand: ${(ctx as any).activeBrand ?? 'none'}` },
      ],
      placeholder: 'Tell reframe what to make…',
    }, { projectDir });
    chatHtml = chat.html;
  } catch (e) {
    // Fall back to artifact's inline fallback input; no hydration needed.
  }

  // Hydrate slots in the shell HTML.
  let body = shell.html;
  if (cardsHtml) body = hydrateSlot(body, 'cards-space', cardsHtml);
  if (chatHtml)  body = hydrateSlot(body, 'chat', chatHtml);

  const assets = Date.now();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>reframe · thread</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>${DOC_CSS}</style>
  <script>try { var t=localStorage.getItem('reframe-theme'); if(t) document.documentElement.setAttribute('data-theme',t); } catch(_){}</script>
</head>
<body>
  ${body}
  <!-- Intentionally do NOT load /platform/app.js here — it ships the
       legacy "Edit mode on" floating toggle + other editor-scoped
       widgets that don't belong on the thread surface. The agent-
       runtime dispatcher is loaded explicitly; everything else comes
       in when the user drills into a card and hits the editor. -->
  <script src="/platform/ui/055-agent-runtime.js?v=${assets}" defer></script>
</body>
</html>`;
}
