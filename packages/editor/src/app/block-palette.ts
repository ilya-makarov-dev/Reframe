/**
 * Floating Agent Insert (chat-first) — replaces the old Constructor.
 *
 * The user clicks "+" or hits Cmd+P → a single floating modal opens
 * with ONE input (text, paste, image drop). They describe what they
 * want; AI:
 *   1. Reads the active brand DESIGN.md
 *   2. Reads what's already on the page
 *   3. Picks ONE of:
 *      - INSERT a pre-built block from the 80-block catalog (preferred)
 *      - GENERATE fresh HTML (last resort)
 *      - COMPOSE a full page (when scene is empty)
 *   4. If image attached → uses Read tool to inspect it before deciding
 *
 * The 80-block catalog is the AI's vocabulary, NOT the user's burden.
 * Power users can still see it via "Browse library ↗" (collapsed by
 * default) or Cmd+Shift+P to open the palette in browse mode.
 *
 * Events:
 *   'reframe:open-block-palette'   { x?, y?, mode? }    → mount
 *   'reframe:open-empty-wizard'                          → mount with full-page hint
 *   'reframe:ask-agent' { nodeId, x, y }                 → reused for auto-refine
 */

interface BlockListItem {
  id: string;
  name: string;
  category: string;
  source: 'block' | 'section';
  description?: string;
  keywords: string[];
}

interface BlocksResponse {
  ok: boolean;
  total: number;
  categories: string[];
  items: BlockListItem[];
  byCategory: Record<string, BlockListItem[]>;
}

let active: HTMLDivElement | null = null;
let cache: BlocksResponse | null = null;
let pendingImageDataUrl: string | null = null;

/** Install global listeners. Idempotent. */
export function initBlockPalette(): void {
  window.addEventListener('reframe:open-block-palette', ((e: CustomEvent) => {
    mount({ mode: e.detail?.mode || 'chat' });
  }) as EventListener);
  window.addEventListener('reframe:open-empty-wizard', (() => {
    mount({ mode: 'chat', emptyHint: true });
  }) as EventListener);
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
      if (inField) return;
      e.preventDefault();
      // Shift+Cmd+P → open in browse-library mode for power users.
      mount({ mode: e.shiftKey ? 'browse' : 'chat' });
    }
    if (e.key === 'Escape' && active) unmount();
  });
}

interface MountOpts {
  mode: 'chat' | 'browse';
  emptyHint?: boolean;
}

async function mount(opts: MountOpts): Promise<void> {
  if (active) unmount();

  const sceneId =
    document.querySelector<HTMLCanvasElement>('canvas[data-session]')?.getAttribute('data-session') ||
    document.querySelector('[data-session]')?.getAttribute('data-session') ||
    '';

  const W = 520;
  const H = opts.mode === 'browse' ? 580 : 360;

  const div = document.createElement('div');
  div.id = 'reframe-block-palette';
  div.style.cssText = [
    'position:fixed',
    `left:${(window.innerWidth - W) / 2}px`,
    `top:${Math.max(80, (window.innerHeight - H) / 2 - 60)}px`,
    `width:${W}px`,
    `max-height:${H}px`,
    'z-index:10000',
    'background:var(--surface-elevated, #1a1a1a)',
    'border:1px solid var(--border, #333)',
    'border-radius:12px',
    'box-shadow:0 20px 60px rgba(0,0,0,0.6)',
    'display:flex',
    'flex-direction:column',
    'overflow:hidden',
    'font-family:inherit',
    'font-size:13px',
    'color:var(--text-primary, #e5e5e5)',
  ].join(';');

  const placeholder = opts.emptyHint
    ? 'Describe a page... e.g. "SaaS landing for crypto"'
    : 'What goes here? Paste or drop an image, or just describe...';

  div.innerHTML = `
    <div style="padding:12px 14px;display:flex;align-items:center;gap:10px">
      <span style="font-size:16px">\u2728</span>
      <div style="flex:1;font-weight:600;font-size:13px">
        ${opts.emptyHint ? 'Start with...' : 'What do you want?'}
      </div>
      <button data-palette-close style="background:transparent;border:none;color:var(--text-muted,#888);cursor:pointer;font-size:16px;padding:0 4px">\u2715</button>
    </div>

    <!-- Chat input + image dropzone (the default mode) -->
    <div data-chat-area style="display:${opts.mode === 'chat' ? 'flex' : 'none'};flex-direction:column;padding:0 14px 12px;gap:8px">
      <div data-image-preview style="display:none;position:relative">
        <img data-image-thumb style="max-width:100%;max-height:120px;border-radius:6px;border:1px solid var(--border,#333);display:block">
        <button data-image-remove type="button" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,.7);color:#fff;border:none;border-radius:50%;width:20px;height:20px;cursor:pointer;font-size:11px">\u2715</button>
      </div>

      <div data-dropzone style="position:relative">
        <textarea data-chat-input rows="3"
          placeholder="${placeholder}"
          style="width:100%;box-sizing:border-box;padding:10px;background:var(--surface,#0e0e0e);color:inherit;border:1px solid var(--border,#333);border-radius:6px;resize:vertical;font-family:inherit;font-size:13px;outline:none;line-height:1.4"></textarea>
        <input data-image-file type="file" accept="image/*" style="display:none">
      </div>

      <div data-chat-status style="display:none;font-size:11px;color:var(--text-muted,#888);min-height:14px"></div>

      <div style="display:flex;align-items:center;gap:8px">
        <button data-image-pick type="button" title="Attach image"
          style="padding:6px 10px;background:transparent;border:1px solid var(--border,#333);border-radius:5px;color:var(--text-muted,#888);cursor:pointer;font-size:12px">
          \uD83D\uDCCE
        </button>
        <span data-context-hint style="flex:1;font-size:10px;color:var(--text-muted,#888)"></span>
        <button data-palette-toggle-browse type="button"
          style="padding:5px 9px;background:transparent;border:1px solid var(--border,#333);border-radius:5px;color:var(--text-muted,#888);cursor:pointer;font-size:11px">
          Browse 80 blocks
        </button>
        <button data-chat-send type="button"
          style="padding:7px 14px;background:var(--accent,#f15a29);color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:12px;font-weight:600">
          Ask AI \u2192
        </button>
      </div>
    </div>

    <!-- Browse library mode (default hidden, expanded via toggle) -->
    <div data-browse-area style="display:${opts.mode === 'browse' ? 'flex' : 'none'};flex-direction:column;flex:1;overflow:hidden;border-top:1px solid var(--border,#333)">
      <div style="padding:10px 14px;border-bottom:1px solid var(--border,#333)">
        <input data-browse-input type="text" placeholder="Search blocks\u2026"
          style="width:100%;box-sizing:border-box;padding:6px 8px;background:var(--surface,#0e0e0e);color:inherit;border:1px solid var(--border,#333);border-radius:5px;font-size:11px;outline:none">
        <div data-browse-categories style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px"></div>
      </div>
      <div data-browse-list style="flex:1;overflow-y:auto;padding:8px 14px"></div>
    </div>
  `;

  document.body.appendChild(div);
  active = div;
  pendingImageDataUrl = null;

  // Outside-click dismiss.
  const dismiss = (e: PointerEvent) => {
    if (!div.contains(e.target as Node)) unmount();
  };
  setTimeout(() => document.addEventListener('pointerdown', dismiss), 0);
  (div as any).__cleanup = () => document.removeEventListener('pointerdown', dismiss);

  // ── Setup chat area ──
  setupChatArea(div, sceneId, opts);

  // ── Setup browse area (lazy when toggled) ──
  if (opts.mode === 'browse') {
    setupBrowseArea(div, sceneId);
  }

  // Focus input
  const input = div.querySelector<HTMLTextAreaElement>('[data-chat-input]');
  if (input) setTimeout(() => input.focus(), 0);

  div.querySelector<HTMLButtonElement>('[data-palette-close]')?.addEventListener('click', unmount);
}

function unmount(): void {
  if (!active) return;
  try { (active as any).__cleanup?.(); } catch { /* ignore */ }
  active.remove();
  active = null;
  pendingImageDataUrl = null;
}

// ─── Chat area ─────────────────────────────────────────────

function setupChatArea(root: HTMLDivElement, sceneId: string, opts: MountOpts): void {
  const input = root.querySelector<HTMLTextAreaElement>('[data-chat-input]')!;
  const sendBtn = root.querySelector<HTMLButtonElement>('[data-chat-send]')!;
  const status = root.querySelector<HTMLDivElement>('[data-chat-status]')!;
  const imagePick = root.querySelector<HTMLButtonElement>('[data-image-pick]')!;
  const imageFile = root.querySelector<HTMLInputElement>('[data-image-file]')!;
  const imagePreview = root.querySelector<HTMLDivElement>('[data-image-preview]')!;
  const imageThumb = root.querySelector<HTMLImageElement>('[data-image-thumb]')!;
  const imageRemove = root.querySelector<HTMLButtonElement>('[data-image-remove]')!;
  const browseToggle = root.querySelector<HTMLButtonElement>('[data-palette-toggle-browse]')!;
  const browseArea = root.querySelector<HTMLDivElement>('[data-browse-area]')!;
  const ctxHint = root.querySelector<HTMLSpanElement>('[data-context-hint]')!;

  // Show light context hint
  ctxHint.textContent = sceneId
    ? `On scene · ${opts.emptyHint ? 'empty' : 'will append section'}`
    : 'No scene';

  // ── Image handling ──
  const setImage = (dataUrl: string | null) => {
    pendingImageDataUrl = dataUrl;
    if (dataUrl) {
      imageThumb.src = dataUrl;
      imagePreview.style.display = '';
    } else {
      imageThumb.removeAttribute('src');
      imagePreview.style.display = 'none';
    }
  };
  const readFileAsDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  imagePick.addEventListener('click', () => imageFile.click());
  imageFile.addEventListener('change', async () => {
    const f = imageFile.files?.[0];
    if (!f) return;
    if (f.size > 4 * 1024 * 1024) {
      status.style.display = '';
      status.textContent = 'Image too large (max 4 MB)';
      return;
    }
    setImage(await readFileAsDataUrl(f));
  });
  imageRemove.addEventListener('click', () => setImage(null));

  // Drag & drop on the textarea
  input.addEventListener('dragover', (e) => { e.preventDefault(); });
  input.addEventListener('drop', async (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f && f.type.startsWith('image/')) {
      setImage(await readFileAsDataUrl(f));
    }
  });
  // Paste image
  input.addEventListener('paste', async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of Array.from(items)) {
      if (it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) {
          e.preventDefault();
          setImage(await readFileAsDataUrl(f));
          break;
        }
      }
    }
  });

  // ── Browse toggle ──
  browseToggle.addEventListener('click', () => {
    const wasOpen = browseArea.style.display !== 'none';
    if (wasOpen) {
      browseArea.style.display = 'none';
      browseToggle.textContent = 'Browse 80 blocks';
    } else {
      browseArea.style.display = 'flex';
      browseToggle.textContent = 'Hide library';
      setupBrowseArea(root, sceneId);
    }
  });

  // ── Send ──
  const submit = () => {
    const text = input.value.trim();
    if (!text && !pendingImageDataUrl) {
      status.style.display = '';
      status.textContent = 'Type something or attach an image';
      return;
    }
    sendBtn.disabled = true;
    sendBtn.textContent = 'Working\u2026';
    input.disabled = true;
    status.style.display = '';
    status.textContent = '\u2026';
    runSmartInsert(text, sceneId, pendingImageDataUrl, status, () => {
      // Done → close prompt; canvas updates flow via SSE.
      setTimeout(unmount, 400);
    });
  };
  sendBtn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });
}

function runSmartInsert(
  prompt: string,
  sceneId: string,
  imageDataUrl: string | null,
  statusEl: HTMLDivElement,
  onDone: () => void,
): void {
  fetch('/api/agent/insert-smart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, sceneId, image: imageDataUrl }),
  }).then(async (resp) => {
    if (!resp.ok || !resp.body) throw new Error('HTTP ' + resp.status);
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      buf += decoder.decode(r.value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const ev = parseSseBlock(block);
        if (!ev) continue;
        switch (ev.type) {
          case 'session_start':
            statusEl.textContent = 'AI thinking\u2026';
            break;
          case 'tool_use':
            statusEl.innerHTML = `\u25CF ${ev.toolName?.replace('mcp__', '').replace(/_/g, ' ') || 'tool'}\u2026`;
            break;
          case 'inserted':
            statusEl.innerHTML = `\u2713 inserted <strong>${ev.blockId?.split(':').pop() || 'section'}</strong>`;
            // Auto-open Ask Agent on the new section to refine
            if (ev.newSectionId) {
              setTimeout(() => {
                window.dispatchEvent(new CustomEvent('reframe:ask-agent', {
                  detail: {
                    nodeId: ev.newSectionId,
                    x: window.innerWidth / 2 - 220,
                    y: window.innerHeight - 200,
                  },
                }));
              }, 600);
            }
            onDone();
            return;
          case 'composed':
            statusEl.innerHTML = `\u2713 composed <strong>${ev.blocks?.length || 0}</strong> sections`;
            window.dispatchEvent(new CustomEvent('reframe:open-scene', {
              detail: { sceneId: ev.sceneId },
            }));
            onDone();
            return;
          case 'error':
            statusEl.textContent = 'Error: ' + (ev.message || 'unknown');
            return;
        }
      }
    }
  }).catch((err) => {
    statusEl.textContent = 'Error: ' + (err?.message || err);
  });
}

// ─── Browse area (power-user library) ──────────────────────

function setupBrowseArea(root: HTMLDivElement, sceneId: string): void {
  const list = root.querySelector<HTMLDivElement>('[data-browse-list]')!;
  const cats = root.querySelector<HTMLDivElement>('[data-browse-categories]')!;
  const input = root.querySelector<HTMLInputElement>('[data-browse-input]')!;

  if (list.dataset.loaded === '1') return;
  list.dataset.loaded = '1';

  list.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted,#888);font-size:11px">Loading\u2026</div>`;

  loadCatalog().then((catalog) => {
    if (!catalog) {
      list.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted,#888);font-size:11px">No catalog</div>`;
      return;
    }
    let activeCategory: string | null = null;

    const renderCats = () => {
      cats.innerHTML = `
        <button data-cat="" type="button" style="padding:2px 7px;font-size:10px;background:${activeCategory === null ? 'var(--accent,#f15a29)' : 'var(--surface,#0e0e0e)'};color:${activeCategory === null ? '#fff' : 'var(--text-muted,#888)'};border:1px solid var(--border,#333);border-radius:4px;cursor:pointer">all</button>
        ${catalog.categories.map((c) => `
          <button data-cat="${escapeHtml(c)}" type="button" style="padding:2px 7px;font-size:10px;background:${activeCategory === c ? 'var(--accent,#f15a29)' : 'var(--surface,#0e0e0e)'};color:${activeCategory === c ? '#fff' : 'var(--text-muted,#888)'};border:1px solid var(--border,#333);border-radius:4px;cursor:pointer">${escapeHtml(c)}</button>
        `).join('')}
      `;
      cats.querySelectorAll<HTMLButtonElement>('[data-cat]').forEach((b) => {
        b.addEventListener('click', () => {
          activeCategory = b.dataset.cat || null;
          renderCats();
          renderList();
        });
      });
    };

    const renderList = () => {
      const q = input.value.trim().toLowerCase();
      let items = catalog.items;
      if (activeCategory) items = items.filter((i) => i.category === activeCategory);
      if (q) items = items.filter((i) => i.keywords.some((k) => k.toLowerCase().includes(q)) || i.name.toLowerCase().includes(q));
      if (items.length === 0) {
        list.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted,#888);font-size:11px">No matches</div>`;
        return;
      }
      list.innerHTML = items.map((it) => `
        <button data-block-id="${escapeHtml(it.id)}" type="button" style="
          width:100%;text-align:left;padding:6px 9px;margin-bottom:3px;
          background:var(--surface,#0e0e0e);color:inherit;
          border:1px solid var(--border,#333);border-radius:5px;cursor:pointer;
          display:flex;align-items:center;gap:8px;font-family:inherit;
        ">
          <span style="display:inline-block;font-size:9px;padding:1px 5px;border-radius:3px;background:var(--accent,#f15a29);color:#fff">${escapeHtml(it.category)}</span>
          <span style="flex:1;font-size:11px">${escapeHtml(it.name)}</span>
        </button>
      `).join('');
      list.querySelectorAll<HTMLButtonElement>('[data-block-id]').forEach((b) => {
        b.addEventListener('click', () => {
          const id = b.dataset.blockId!;
          directInsert(id, sceneId);
        });
      });
    };

    renderCats();
    renderList();
    input.addEventListener('input', renderList);
  });
}

function directInsert(blockId: string, sceneId: string): void {
  if (!sceneId) return;
  fetch('/api/agent/insert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blockId, sceneId }),
  }).then(async (r) => {
    const j = await r.json().catch(() => ({}));
    if (j.ok) {
      unmount();
      if (j.newSectionId) {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('reframe:ask-agent', {
            detail: {
              nodeId: j.newSectionId,
              x: window.innerWidth / 2 - 220,
              y: window.innerHeight - 200,
            },
          }));
        }, 600);
      }
    }
  });
}

async function loadCatalog(): Promise<BlocksResponse | null> {
  if (cache) return cache;
  try {
    const r = await fetch('/api/agent/blocks');
    if (!r.ok) return null;
    const j: BlocksResponse = await r.json();
    if (j.ok) {
      cache = j;
      return j;
    }
    return null;
  } catch {
    return null;
  }
}

function parseSseBlock(raw: string): any | null {
  let evName = '';
  let dataStr = '';
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('event:')) evName = line.slice(6).trim();
    else if (line.startsWith('data:')) dataStr = line.slice(5).trim();
  }
  if (!evName || !dataStr) return null;
  try {
    const data = JSON.parse(dataStr);
    return { ...data, type: evName };
  } catch { return null; }
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c]);
}
