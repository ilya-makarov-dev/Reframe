/**
 * Floating Agent Prompt — anchored input that pops up at cursor when
 * the user right-clicks "Ask agent" on a node, or hits Cmd+K anywhere
 * on the canvas.
 *
 * Design principle (AI-native): the conversation lives WHERE the work
 * is. No sidebar, no separate panel. Selection → right-click → ask →
 * see the agent's tool calls inline as a status pill on the prompt
 * → canvas updates live via SSE. Prompt closes on completion or Esc.
 *
 * Lifecycle:
 *   1. window event 'reframe:ask-agent' { nodeId, x, y }  → mount()
 *   2. user types, hits Enter → POST /api/agent/chat with sceneId +
 *      a node-scoped prompt prefix
 *   3. SSE stream:
 *        - text          → render chip "thinking..." → fades after first tool_use
 *        - tool_use      → status pill "🔧 reframe_inspect..."
 *        - tool_result   → pill turns green
 *        - done          → close prompt (canvas already updated via SSE)
 *   4. Esc / outside click / done → unmount()
 *
 * The prompt is intentionally minimal: ONE input + status line. Long
 * conversations belong in a future history drawer, not here.
 */

interface AskEvent {
  nodeId: string | null;
  x: number;
  y: number;
  /** Optional initial text — the floating prompt opens with it already filled. */
  prefill?: string;
}

interface AgentSseEvent {
  type: string;
  text?: string;
  toolName?: string;
  preview?: string;
  ok?: boolean;
  reason?: string;
  message?: string;
  durationMs?: number;
  sessionId?: string;
}

let activePrompt: HTMLDivElement | null = null;
let activeAbort: AbortController | null = null;

/** Install the global handlers. Call once on app init. */
export function initAgentPrompt(): void {
  // Right-click "Ask agent" target
  window.addEventListener('reframe:ask-agent', ((e: CustomEvent<AskEvent>) => {
    mount(e.detail);
  }) as EventListener);

  // Global Cmd+K / Ctrl+K → open prompt centered, no node context
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      // Don't intercept inside text inputs / editors
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      e.preventDefault();
      // Use current selection if any (set by canvas onSelectionChanged event).
      const sel = (window as any).__reframeSelection?.nodeId ?? null;
      mount({
        nodeId: sel,
        x: window.innerWidth / 2 - 220,
        y: window.innerHeight / 2 - 60,
      });
    }
    if (e.key === 'Escape' && activePrompt) {
      unmount();
    }
  });

  // Track current canvas selection so Cmd+K can scope to it.
  window.addEventListener('reframe:canvas-select', ((e: CustomEvent) => {
    (window as any).__reframeSelection = e.detail || {};
  }) as EventListener);
}

function mount(detail: AskEvent): void {
  if (activePrompt) unmount();

  // Position: anchor near the click, but clamp to viewport so it never
  // ends up partially off-screen (right-click in bottom corner).
  const W = 460;
  const H = 110;
  const margin = 12;
  let left = Math.min(detail.x + 8, window.innerWidth - W - margin);
  let top = Math.min(detail.y + 8, window.innerHeight - H - margin);
  if (left < margin) left = margin;
  if (top < margin) top = margin;

  // Resolve scene id from the canvas data attribute (set by editor-shell).
  const sessionAttr =
    document.querySelector<HTMLCanvasElement>('canvas[data-session]')?.getAttribute('data-session') ||
    document.querySelector('[data-session]')?.getAttribute('data-session') ||
    '';

  // Resolve a friendly label for the node so the user sees what scope
  // they're typing into.
  let nodeLabel = '';
  if (detail.nodeId) {
    try {
      // Editor instance is exposed on window in dev for inspection; if
      // not available, fall back to id.
      const ed = (window as any).__reframeEditor;
      const node = ed?.getNode?.(detail.nodeId);
      const name = node?.name?.trim() || node?.type || '';
      nodeLabel = name ? `${name} · ${detail.nodeId.slice(-6)}` : detail.nodeId;
    } catch {
      nodeLabel = detail.nodeId;
    }
  }

  const div = document.createElement('div');
  div.id = 'reframe-agent-prompt';
  div.style.cssText = [
    'position:fixed',
    `left:${left}px`,
    `top:${top}px`,
    `width:${W}px`,
    'z-index:10000',
    'background:var(--surface-elevated, #1a1a1a)',
    'border:1px solid var(--border, #333)',
    'border-radius:10px',
    'box-shadow:0 12px 40px rgba(0,0,0,0.5)',
    'padding:10px',
    'font-family:inherit',
    'font-size:12px',
    'color:var(--text-primary, #e5e5e5)',
  ].join(';');

  div.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:11px;color:var(--text-muted,#888)">
      <span style="font-size:14px">\u2728</span>
      <span data-prompt-scope>${nodeLabel ? 'On <strong style="color:var(--text-primary,#fff)">' + escapeHtml(nodeLabel) + '</strong>' : 'On scene'}</span>
      <span style="margin-left:auto;font-size:10px;opacity:.6">Esc to close</span>
    </div>
    <textarea data-prompt-input rows="2" placeholder="e.g. make it playful, add a hover state, match the brand..." style="
      width:100%;box-sizing:border-box;padding:8px;
      background:var(--surface, #0e0e0e);color:inherit;
      border:1px solid var(--border,#333);border-radius:6px;
      resize:none;font-family:inherit;font-size:12px;outline:none;
    "></textarea>
    <div data-prompt-status style="display:none;margin-top:6px;font-size:11px;color:var(--text-muted,#888);min-height:14px"></div>
    <div style="display:flex;gap:6px;margin-top:8px;align-items:center">
      <span style="font-size:10px;color:var(--text-muted,#888)">Variants</span>
      <div data-variants-toggle style="display:inline-flex;border:1px solid var(--border,#333);border-radius:5px;overflow:hidden">
        <button data-vc="1" type="button" style="padding:3px 8px;font-size:10px;background:transparent;color:inherit;border:none;cursor:pointer;border-right:1px solid var(--border,#333)">1</button>
        <button data-vc="2" type="button" style="padding:3px 8px;font-size:10px;background:transparent;color:inherit;border:none;cursor:pointer;border-right:1px solid var(--border,#333)">2</button>
        <button data-vc="4" type="button" style="padding:3px 8px;font-size:10px;background:transparent;color:inherit;border:none;cursor:pointer">4</button>
      </div>
      <span style="font-size:10px;color:var(--text-muted,#888);margin-left:auto">\u23CE Send  \u00B7  Esc cancel</span>
      <button data-prompt-send style="
        padding:5px 12px;font-size:11px;font-weight:600;
        background:var(--accent,#f15a29);color:#fff;border:none;border-radius:5px;cursor:pointer;
      ">Ask</button>
    </div>
  `;

  document.body.appendChild(div);
  activePrompt = div;

  const input = div.querySelector<HTMLTextAreaElement>('[data-prompt-input]')!;
  const sendBtn = div.querySelector<HTMLButtonElement>('[data-prompt-send]')!;
  const status = div.querySelector<HTMLDivElement>('[data-prompt-status]')!;

  // Variant count toggle — Midjourney-style 1/2/4. Default loaded from
  // localStorage so the user's last choice sticks across prompts. The
  // active button gets accent color; others stay muted.
  let variantCount = readVariantCountPref();
  const vcBtns = div.querySelectorAll<HTMLButtonElement>('[data-vc]');
  const refreshVcUI = () => {
    vcBtns.forEach((b) => {
      const active = Number(b.dataset.vc) === variantCount;
      b.style.background = active ? 'var(--accent, #f15a29)' : 'transparent';
      b.style.color = active ? '#fff' : 'inherit';
      b.style.fontWeight = active ? '600' : '400';
    });
  };
  vcBtns.forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      variantCount = Number(b.dataset.vc) || 1;
      writeVariantCountPref(variantCount);
      refreshVcUI();
    });
  });
  refreshVcUI();

  // Pre-fill the textarea if the caller provided initial text (e.g. the
  // sticky AI bar in the Properties panel passes the user's typed text).
  if (detail.prefill) {
    input.value = detail.prefill;
  }

  setTimeout(() => input.focus(), 0);

  // Outside click → close (but not while waiting on the agent)
  const onDocPointer = (e: PointerEvent) => {
    if (!div.contains(e.target as Node) && !sendBtn.disabled) unmount();
  };
  setTimeout(() => document.addEventListener('pointerdown', onDocPointer), 0);
  div.dataset.dismissBound = '1';
  (div as any).__cleanup = () => document.removeEventListener('pointerdown', onDocPointer);

  // Submit handler
  const submit = () => {
    const text = input.value.trim();
    if (!text) return;
    if (!sessionAttr) {
      status.style.display = '';
      status.textContent = 'No active scene — open a project first';
      return;
    }
    sendBtn.disabled = true;
    sendBtn.textContent = variantCount > 1 ? `Generating ${variantCount}\u2026` : 'Working\u2026';
    input.disabled = true;
    runAgent(text, sessionAttr, detail.nodeId, variantCount, status, () => {
      // On done — close the prompt; canvas updates flow via SSE,
      // variants_ready event fires the gallery toast separately.
      unmount();
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

function unmount(): void {
  if (!activePrompt) return;
  try { (activePrompt as any).__cleanup?.(); } catch { /* ignore */ }
  activePrompt.remove();
  activePrompt = null;
  if (activeAbort) {
    try { activeAbort.abort(); } catch { /* ignore */ }
    activeAbort = null;
  }
}

/**
 * Stream agent events into the status line.
 * One conversation per prompt — no multi-turn from the floating UI
 * (that comes later via the history drawer).
 */
function runAgent(
  prompt: string,
  sceneId: string,
  nodeId: string | null,
  variantCount: number,
  statusEl: HTMLDivElement,
  onDone: () => void,
): void {
  statusEl.style.display = '';
  statusEl.textContent = '\u2026';

  // Scope the prompt to the selected node so claude doesn't have to
  // ask which one. We rely on the server-side preamble to inject scene
  // + brand context, and add a node hint here.
  const scopedPrompt = nodeId
    ? `Focus on node id "${nodeId}" in the active scene. ${prompt}`
    : prompt;

  const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  activeAbort = ctrl;

  fetch('/api/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: scopedPrompt, sceneId, nodeId, variants: variantCount }),
    signal: ctrl ? ctrl.signal : undefined,
  }).then(async (resp) => {
    if (!resp.ok || !resp.body) throw new Error('HTTP ' + resp.status);
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let lastTool = '';

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
            // Don't show "Thinking..." — claude isn't actively
            // thinking, it's just spinning up MCP. Keep the status
            // dots visible and let the first tool_use replace it.
            break;
          case 'text':
            // Most text is "I will now..." preamble. Skip it. Tool
            // calls + final canvas update are the real signal.
            // Only show very short text (likely the final confirm).
            if (ev.text && ev.text.length < 60) {
              statusEl.textContent = ev.text;
            }
            break;
          case 'tool_use':
            // Map noisy tool names to friendlier verbs the user cares about.
            lastTool = ev.toolName || 'tool';
            statusEl.innerHTML = friendlyToolStatus(lastTool, true);
            break;
          case 'tool_result':
            statusEl.innerHTML = friendlyToolStatus(lastTool, false);
            break;
          case 'variants_ready': {
            // The server completed the AI gen and produced engine-vary
            // alternatives. Show a toast offering the user to inspect
            // the gallery. We DON'T auto-switch the canvas — that
            // would yank the user out of context.
            const variants = (ev as any).variants as Array<{ sceneId: string; name: string; label: string }> | undefined;
            if (variants && variants.length > 1) {
              showVariantsToast(variants);
            }
            break;
          }
          case 'done':
            if (ev.reason === 'success') {
              statusEl.textContent = 'Done.';
              setTimeout(onDone, 400);
            } else if (ev.reason === 'error') {
              statusEl.textContent = 'Error: ' + (ev.message || 'unknown');
            }
            return;
          case 'error':
            statusEl.textContent = 'Error: ' + (ev.message || 'unknown');
            return;
        }
      }
    }
  }).catch((err) => {
    if (err && err.name === 'AbortError') return;
    statusEl.textContent = 'Error: ' + (err?.message || String(err));
  });
}

function parseSseBlock(raw: string): AgentSseEvent | null {
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
  } catch {
    return null;
  }
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c]);
}

// Preset chips were removed — they were a band-aid for "AI light".
// The /api/agent/preset/apply endpoint still exists server-side as an
// AI tool (claude can call it when intent maps cleanly to one of the
// engine transforms). Users just type intent in the textarea — the AI
// decides which transform fits.

/**
 * Render the status line for a tool call. Maps the raw MCP tool name
 * to a verb the user cares about ("editing" / "designing" / "checking").
 * `running` toggles between in-progress and completed wording.
 */
function friendlyToolStatus(toolName: string, running: boolean): string {
  const verbMap: Record<string, [string, string]> = {
    'mcp__reframe__reframe_edit':    ['editing\u2026', 'edited'],
    'mcp__reframe__reframe_compile': ['designing\u2026', 'designed'],
    'mcp__reframe__reframe_inspect': ['checking\u2026', 'checked'],
    'mcp__reframe__reframe_export':  ['exporting\u2026', 'exported'],
    'mcp__reframe__reframe_design':  ['loading brand\u2026', 'brand ready'],
    'mcp__reframe__reframe_project': ['saving\u2026', 'saved'],
  };
  const m = verbMap[toolName] || ['working\u2026', 'done'];
  const verb = running ? m[0] : m[1];
  const icon = running ? '\u25CF' : '\u2713';
  return `<span style="opacity:.8">${icon}</span>  ${verb}`;
}

// ─── Variant count preference (localStorage) ────────────────

const VC_PREF_KEY = 'reframe.agentPrompt.variants';

function readVariantCountPref(): number {
  try {
    const raw = localStorage.getItem(VC_PREF_KEY);
    const n = raw ? Number(raw) : 1;
    return n === 2 || n === 4 ? n : 1;
  } catch {
    return 1;
  }
}

function writeVariantCountPref(n: number): void {
  try { localStorage.setItem(VC_PREF_KEY, String(n)); } catch { /* ignore */ }
}

// ─── Variants toast ─────────────────────────────────────────

let activeToast: HTMLDivElement | null = null;

/**
 * Show a non-blocking toast at the top of the canvas saying "N variants
 * ready" with a row of clickable thumbnails (just labels for now). User
 * clicks one → the canvas switches to that scene. Click "Keep all" to
 * dismiss; click ✕ to discard the alternates.
 *
 * Toast is auto-dismissed when another toast replaces it.
 */
function showVariantsToast(variants: Array<{ sceneId: string; name: string; label: string }>): void {
  if (activeToast) {
    try { activeToast.remove(); } catch { /* ignore */ }
    activeToast = null;
  }

  const toast = document.createElement('div');
  toast.id = 'reframe-variants-toast';
  toast.style.cssText = [
    'position:fixed',
    'top:16px',
    'left:50%',
    'transform:translateX(-50%)',
    'z-index:9999',
    'background:var(--surface-elevated, #1a1a1a)',
    'border:1px solid var(--border, #333)',
    'border-radius:10px',
    'box-shadow:0 8px 30px rgba(0,0,0,0.5)',
    'padding:10px 12px',
    'display:flex',
    'align-items:center',
    'gap:10px',
    'font-family:inherit',
    'font-size:12px',
    'color:var(--text-primary, #e5e5e5)',
    'max-width:90vw',
  ].join(';');

  const chips = variants.map((v) => `
    <button data-variant-pick="${escapeHtml(v.sceneId)}" type="button" style="
      padding:4px 10px;font-size:11px;
      background:var(--surface,#0e0e0e);color:inherit;
      border:1px solid var(--border,#333);border-radius:5px;cursor:pointer;
    " title="${escapeHtml(v.name)}">${escapeHtml(v.label)}</button>
  `).join('');

  toast.innerHTML = `
    <span style="font-size:14px">\u2728</span>
    <span><strong>${variants.length}</strong> variants ready</span>
    <div style="display:flex;gap:4px;margin-left:6px">${chips}</div>
    <button data-toast-dismiss type="button" style="
      margin-left:6px;background:transparent;color:var(--text-muted,#888);
      border:none;cursor:pointer;font-size:14px;padding:0 4px;
    " title="Dismiss">\u2715</button>
  `;

  document.body.appendChild(toast);
  activeToast = toast;

  toast.querySelectorAll<HTMLButtonElement>('[data-variant-pick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sid = btn.dataset.variantPick;
      if (!sid) return;
      // Tell the editor to switch to this scene. The viewport loader
      // listens for this event (added in platform-bootstrap.ts).
      window.dispatchEvent(new CustomEvent('reframe:open-scene', { detail: { sceneId: sid } }));
      try { toast.remove(); } catch { /* ignore */ }
      activeToast = null;
    });
  });
  toast.querySelector<HTMLButtonElement>('[data-toast-dismiss]')?.addEventListener('click', () => {
    try { toast.remove(); } catch { /* ignore */ }
    activeToast = null;
  });

  // Auto-dismiss after 30s if untouched.
  setTimeout(() => {
    if (activeToast === toast) {
      try { toast.remove(); } catch { /* ignore */ }
      activeToast = null;
    }
  }, 30_000);
}
