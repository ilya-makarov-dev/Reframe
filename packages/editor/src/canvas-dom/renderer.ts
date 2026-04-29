import { captureCaret, restoreCaret } from './caret-preservation.js';

/**
 * Iframe-based scene renderer for the DOM canvas.
 *
 * Loads the server-exported HTML for a scene into a sandboxed iframe.
 * Subscribes to SSE `scene:session-changed` events and reloads on mutation.
 * Later Phase 2c will switch to incremental DOM patching for sub-16ms
 * re-render on single-prop edits; today it's full srcdoc reload (sufficient
 * for Phase 2 foundation where we're proving the approach).
 *
 * Why iframe + srcdoc (not inline DOM):
 *   1. CSS isolation — imported scene's global rules can't leak into
 *      editor chrome (`body { margin: 0 }` in a brand template would
 *      destroy the app shell otherwise).
 *   2. True 1:1 with HTML export — whatever renders here IS what
 *      `reframe_export format=html` produces. No renderer divergence.
 *   3. Safe pointer event boundary — iframe owns its own document's
 *      `elementFromPoint` without parent-layout leaking in.
 */

export interface SceneRendererOptions {
  container: HTMLElement;
  sceneId: string;
  /** URL fetched to get the scene HTML. Default: `/platform/api/export?sceneId=<id>&format=html&fullDocument=true&dataAttributes=true`. */
  sourceUrl?: string;
  /** Called after every iframe reload — host uses this to re-attach overlay sync. */
  onLoad?: (iframe: HTMLIFrameElement) => void;
  /** Called when SSE hints scene may have changed. Host decides whether to reload. */
  onSceneChange?: () => void;
}

export function createSceneRenderer(opts: SceneRendererOptions): {
  iframe: HTMLIFrameElement;
  reload: () => Promise<void>;
  destroy: () => void;
} {
  const iframe = document.createElement('iframe');
  // T3 #12 — paper-frame class. Visual treatment (shadow stack + border
  // + radius) applied via CSS in platform-ui.css. Class is on the
  // iframe directly, NOT a wrapper div — wrapping would require its
  // own absolute positioning to match the iframe's `position: absolute`
  // / left:0 / top:0 fill of its container, error-prone on multi-mount
  // (variants column / sampler cell). Direct styling is structurally
  // safe and visually identical for Phase 0.
  iframe.className = 'reframe-canvas-iframe';
  Object.assign(iframe.style, {
    position: 'absolute',
    left: '0', top: '0',
    background: 'white',
    // Border + box-shadow + border-radius come from .reframe-canvas-iframe
    // CSS class. Setting them inline here would shadow the class rule
    // (inline > class specificity), suppressing the paper-frame look.
    // Background kept inline as defensive fallback for cases where the
    // platform stylesheet hasn't loaded yet (defaults to white anyway).
    // Size is set by reload() once we know the scene dimensions.
  });
  iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-popups');
  opts.container.appendChild(iframe);

  // `/preview/<sceneId>` serves the scene as HTML via the sidecar's
  // cached exporter pipeline (`packages/mcp/src/http-server.ts`). Caller
  // can override via `sourceUrl` for sandbox / test fixtures.
  const sourceUrl = opts.sourceUrl
    ?? `/preview/${encodeURIComponent(opts.sceneId)}`;

  let reloadSeq = 0;

  /**
   * Full reload via `srcdoc` — flashes on big scenes (500KB editorial
   * ~100ms). Kept as fallback when the incremental patch can't diff
   * cleanly (structural changes: add/delete/reparent).
   */
  const reloadFull = async () => {
    const seq = ++reloadSeq;
    try {
      const res = await fetch(sourceUrl, { headers: { accept: 'text/html' } });
      if (!res.ok) throw new Error(`export fetch ${res.status}`);
      const html = await res.text();
      if (seq !== reloadSeq) return;
      iframe.srcdoc = html;
      iframe.onload = () => {
        if (seq !== reloadSeq) return;
        try {
          const doc = iframe.contentDocument;
          if (doc) {
            const root = doc.body.firstElementChild as HTMLElement | null;
            if (root) {
              const bbox = root.getBoundingClientRect();
              iframe.style.width = `${Math.ceil(bbox.width)}px`;
              iframe.style.height = `${Math.ceil(bbox.height)}px`;
            }
          }
        } catch { /* srcdoc same-origin */ }
        opts.onLoad?.(iframe);
      };
    } catch (err) {
      console.warn('[canvas-dom] scene fetch failed', err);
    }
  };

  /**
   * Incremental patch — fetch the fresh HTML, parse in-place, walk the
   * iframe's live document comparing nodes keyed by `data-reframe-inode`.
   * If the TREE SHAPE is unchanged (same id set, same parent-child
   * relations), only inline styles + text nodes change — patch in place
   * via attribute/textContent writes. No srcdoc swap → no flash → 60fps
   * even on 500KB scenes.
   *
   * Fall back to full reload when:
   *  - id set changes (add/delete/reparent)
   *  - iframe doc not ready
   *  - any parse/walk error
   */
  const reload = async () => {
    const seq = ++reloadSeq;
    const doc = iframe.contentDocument;
    if (!doc?.body?.firstElementChild) {
      return reloadFull();
    }
    try {
      const res = await fetch(sourceUrl, { headers: { accept: 'text/html' } });
      if (!res.ok) throw new Error(`export fetch ${res.status}`);
      const html = await res.text();
      if (seq !== reloadSeq) return;
      const parser = new DOMParser();
      const fresh = parser.parseFromString(html, 'text/html');
      const applied = tryIncrementalPatch(doc, fresh);
      if (!applied) {
        return reloadFull();
      }
      // Update iframe size + fire onLoad for host overlay refresh.
      const root = doc.body.firstElementChild as HTMLElement;
      const bbox = root.getBoundingClientRect();
      iframe.style.width = `${Math.ceil(bbox.width)}px`;
      iframe.style.height = `${Math.ceil(bbox.height)}px`;
      opts.onLoad?.(iframe);
    } catch (err) {
      console.warn('[canvas-dom] incremental patch failed, falling back to full reload', err);
      return reloadFull();
    }
  };

  /**
   * Attempt in-place patch. Returns true if successful, false if
   * structure diverged and caller should fall back to full reload.
   *
   * Keyed on `data-reframe-inode`. For every element in the live doc
   * that has a matching id in the fresh doc, we overwrite `style`, text
   * content, and `class`. Elements present in only one side → structural
   * change → abort.
   */
  function tryIncrementalPatch(liveDoc: Document, fresh: Document): boolean {
    const liveNodes = new Map<string, HTMLElement>();
    const freshNodes = new Map<string, HTMLElement>();
    liveDoc.querySelectorAll('[data-reframe-inode]').forEach(el => {
      const id = (el as HTMLElement).getAttribute('data-reframe-inode');
      if (id) liveNodes.set(id, el as HTMLElement);
    });
    fresh.querySelectorAll('[data-reframe-inode]').forEach(el => {
      const id = (el as HTMLElement).getAttribute('data-reframe-inode');
      if (id) freshNodes.set(id, el as HTMLElement);
    });
    // Any id in one side but not the other = structural change.
    if (liveNodes.size !== freshNodes.size) return false;
    for (const id of liveNodes.keys()) if (!freshNodes.has(id)) return false;

    // Walk & patch.
    for (const [id, liveEl] of liveNodes) {
      const freshEl = freshNodes.get(id)!;
      // Style attribute wholesale replace — cheap string compare first.
      const liveStyle = liveEl.getAttribute('style') ?? '';
      const freshStyle = freshEl.getAttribute('style') ?? '';
      if (liveStyle !== freshStyle) liveEl.setAttribute('style', freshStyle);
      // Class attribute for hover/state CSS selectors.
      const liveClass = liveEl.getAttribute('class') ?? '';
      const freshClass = freshEl.getAttribute('class') ?? '';
      if (liveClass !== freshClass) liveEl.setAttribute('class', freshClass);
      // Text: only patch when this element has a single text node (leaf
      // TEXT nodes in the INode tree render as <span> with one text
      // child). Don't touch container innerText — that'd destroy children.
      if (liveEl.children.length === 0 && freshEl.children.length === 0) {
        const liveText = liveEl.textContent ?? '';
        const freshText = freshEl.textContent ?? '';
        if (liveText !== freshText) liveEl.textContent = freshText;
      }
    }
    return true;
  }

  // SSE subscription. Scene-level events fire when server-side graph
  // mutates (agent edit, macro, rebrand, user via right-panel).
  //
  // TODO: multiplex /events subscription when sampler primitive lands
  // (N > 10 cells). Each SceneRenderer opens its own EventSource today —
  // fine for variants (N ≤ 5) and flow (N ≤ ~10 steps), but 20+ sampler
  // cells × per-cell EventSource = server connection pressure + client
  // reconnect storms on brief network blips. At that point, move to a
  // single shared EventSource per page with client-side sceneId routing.
  let es: EventSource | null = null;
  try {
    // SSE lives at top-level `/events` (see `http-server.ts:708`).
    // Same endpoint MCP client + 010-core.js use. Emits JSON per event.
    es = new EventSource('/events');
    es.addEventListener('message', (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data);
        if (data?.type === 'scene:session-changed' && (!data.sceneId || data.sceneId === opts.sceneId)) {
          opts.onSceneChange?.();
          // T3 #14 — preserve caret across the SSE-triggered reload.
          // If the user is mid-inline-edit when a property change
          // arrives from the inspector or another agent, the iframe
          // re-fetches and re-mounts the scene HTML; without capture/
          // restore the caret jumps to start (or vanishes entirely).
          // captureCaret returns null when there's no active selection
          // — common case is a no-op overhead.
          const beforeState = captureCaret(iframe.contentDocument, opts.sceneId);
          const wrappedOnLoad = beforeState
            ? () => { restoreCaret(iframe.contentDocument, beforeState); }
            : null;
          reload().then(() => {
            if (wrappedOnLoad) {
              // Restore happens AFTER the iframe.onload reset inside
              // reloadFull (which assigns srcdoc + reads bbox). Schedule
              // on next microtask so the reload's own onload finishes
              // first.
              Promise.resolve().then(wrappedOnLoad);
            }
          }).catch(() => { /* reload errors already logged inside */ });
        }
      } catch { /* non-JSON pings — ignore */ }
    });
  } catch { /* SSE not available in this sandbox — host can poll instead */ }

  reload();

  return {
    iframe,
    reload,
    destroy: () => {
      es?.close();
      iframe.remove();
    },
  };
}
