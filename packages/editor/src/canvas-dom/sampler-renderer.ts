/**
 * SamplerRenderer — N×M cell grid with skeleton-upfront +
 * upgrade-on-click + LRU iframe demote.
 *
 * Canonical capability boundary doc — referenced by T1 #6 thumbnail
 * (same skeleton-then-engage pattern) and T2 #5 overlay (peer-element
 * focus routing reuses the upgrade flow). Read this if you're adding
 * new composition kinds that involve many cell-like surfaces.
 *
 * ─── The render pattern ──────────────────────────────────────
 *
 * Each cell starts as a static `<svg>` (the SVG skeleton exporter
 * shipped in #11). No iframe, no JS context, ~525 bytes per cell. A
 * 20-cell sampler costs ~10KB total before any user engagement.
 *
 * On click → that cell upgrades:
 *   1. host.dataset.state = 'upgrading'
 *   2. SVG removed, createDOMCanvas mounted in same host element
 *   3. host.dataset.state = 'live'
 *   4. Original click forwarded into iframe contentDocument once loaded
 *      (synthetic click at same coords) — triggers selection inside
 *   5. setFocused(hostId) → reframe:composition-focus event fires →
 *      shell subscribers (right panel, layers rail) update for this cell
 *
 * LRU demote when active iframe count exceeds MAX_ACTIVE_IFRAMES (5):
 *   - Track lastFocusedAt: Map<hostId, timestamp>
 *   - On 6th upgrade: find oldest non-currently-focused cell → demote
 *   - Demote = canvas.destroy() + replace iframe with fresh skeleton SVG
 *     (re-export from cell SceneGraph in memory — byte-deterministic)
 *   - Currently-focused cell exempt from demote eviction
 *
 * State preserved across demote/upgrade cycle:
 *   - SceneGraph reference (sampler keeps cells: SceneGraph[] in memory)
 *   - scene.annotations (live on the SceneGraph)
 *   - Per-scene history (on disk, survives)
 *
 * State lost on demote:
 *   - In-flight inspector edits (accepted loss for v1)
 *   - Iframe scroll position (irrelevant — cells fixed-bbox)
 *
 * ─── Capability boundaries (DO NOT cross without explicit signal) ───
 *
 * Phase 0 (now):
 *   - Upgrade ONLY on explicit click. NO auto-upgrade on intersection,
 *     NO prefetch heuristic. User engagement = the only signal.
 *   - Demote eviction = LRU only, capped at MAX_ACTIVE_IFRAMES.
 *     No "user navigated away" demote — would thrash mount/unmount on
 *     rapid focus-flip between two cells.
 *   - Demote NOT triggered by focus loss, ONLY by cap exceeded. Currently
 *     focused cell is NEVER demoted (would yank the user's editing
 *     context mid-action).
 *
 * Future (when signals appear):
 *   - Auto-upgrade nearby cells based on intersection prediction
 *   - Per-cell prefetch on hover (300ms debounce)
 *   - Real DOM unmount when N > 50 (current path keeps SVG in DOM,
 *     just not iframe — fine up to several hundred cells)
 *
 * ─── Multi-mount registry integration ─────────────────────────
 *
 * Each upgraded cell registers under hostId = `${samplerId}-cell-${i}`.
 * Same focus-bridge pattern as Flow / Variants: click on iframe →
 * setFocused → reframe:composition-focus event with detail
 * { hostId, sceneId, brand, compositionKind: 'sampler' }. Shell
 * subscribers in platform-bootstrap update [data-session] so right-panel
 * + layers rail resolve the focused cell.
 *
 * Off-screen cells (skeleton OR iframe) get visibility:hidden +
 * opacity:0 via IntersectionObserver — but NOT display:none. Same Flow
 * lesson: display:none breaks iframe Yoga measurements at mount and
 * pins zoom to 0.25× forever. Visibility gating preserves contentWindow
 * continuity.
 */

import { createDOMCanvas } from './dom-canvas.js';
import { onFocusChange, setFocused, type HostId } from './registry.js';

export interface SamplerCellDescriptor {
  /** Scene slug (project-stable identifier). */
  sceneId: string;
  /** Optional caption shown above the cell. */
  label?: string;
  /** Pre-fetched SVG skeleton markup for the initial render. */
  skeletonSvg: string;
}

export interface SamplerGridDescriptor {
  columns: number;
  rows?: number;
  gap?: number;
  cellWidth?: number;
  cellHeight?: number;
  labels?: string[];
}

export interface SamplerRendererOptions {
  host: HTMLElement;
  samplerId: string;
  cells: SamplerCellDescriptor[];
  grid: SamplerGridDescriptor;
  /** Forwarded to each upgraded canvas's onSelect. */
  onCanvasSelect?: (sceneId: string, ids: string[]) => void;
  /** Called whenever the LRU pool changes (upgrade or demote). For tests + diagnostics. */
  onPoolChange?: (snapshot: { active: string[]; focused: string | null }) => void;
}

export interface SamplerRendererHandle {
  /** Map of hostId → live canvas handle (only entries currently upgraded). */
  readonly canvases: ReadonlyMap<string, ReturnType<typeof createDOMCanvas>>;
  /** Manually upgrade a cell (e.g. from a programmatic test probe). */
  upgrade(cellIndex: number): void;
  /** Manually demote a cell (test helper). */
  demote(cellIndex: number): void;
  /** Snapshot of LRU state at the moment of call. */
  inspectPool(): { active: string[]; focused: string | null; skeleton: string[] };
  destroy(): void;
}

/** Hard cap on simultaneously-upgraded iframes. Past this, LRU evicts. */
export const MAX_ACTIVE_IFRAMES = 5;

const DEFAULT_GAP = 16;
const INTERSECTION_BUFFER_PX = 300;

export function mountSamplerRenderer(opts: SamplerRendererOptions): SamplerRendererHandle {
  const { host, samplerId, cells, grid } = opts;
  if (cells.length < 4) {
    throw new Error('mountSamplerRenderer requires at least 4 cells');
  }
  if (grid.columns < 1) {
    throw new Error('mountSamplerRenderer requires grid.columns >= 1');
  }

  // Preserve #reframe-viewport for the shell composition-focus subscriber
  // — same fix as flow-renderer.ts. Without preservation, the shell reads
  // null on focus events and shows "No scene open".
  const preservedViewport = host.querySelector('#reframe-viewport') as HTMLElement | null;
  host.innerHTML = '';
  if (preservedViewport) {
    preservedViewport.style.display = 'none';
    host.appendChild(preservedViewport);
  }

  // Outer scrollable wrapper. Contains the grid; intersection root.
  const scrollWrap = document.createElement('div');
  scrollWrap.className = 'rfd-sampler-scroll';
  scrollWrap.style.cssText = [
    'position:relative',
    'width:100%',
    'height:100%',
    'overflow:auto',
    'background:var(--surface-base, #fafafa)',
  ].join(';');
  host.appendChild(scrollWrap);

  // The CSS grid itself.
  const gap = grid.gap ?? DEFAULT_GAP;
  const gridEl = document.createElement('div');
  gridEl.className = 'rfd-sampler-grid';
  gridEl.dataset.samplerId = samplerId;
  const cellWidth = grid.cellWidth ?? 360;
  const cellHeight = grid.cellHeight ?? 480;
  gridEl.style.cssText = [
    'display:grid',
    `grid-template-columns:repeat(${grid.columns}, ${cellWidth}px)`,
    `gap:${gap}px`,
    `padding:${gap}px`,
    'box-sizing:border-box',
  ].join(';');
  scrollWrap.appendChild(gridEl);

  // Cell host elements.
  const cellHosts: HTMLElement[] = [];
  const ownedHostIds = new Set<HostId>();
  const canvases = new Map<string, ReturnType<typeof createDOMCanvas>>();
  /** Last-focused timestamp per hostId — drives LRU eviction order. */
  const lastFocusedAt = new Map<string, number>();
  /** Memoized skeleton SVG per cell index (for re-creation on demote). */
  const skeletonByIndex = new Map<number, string>();

  let currentFocusedHostId: string | null = null;

  cells.forEach((cell, i) => {
    const hostId = `${samplerId}-cell-${i}`;
    const cellHost = document.createElement('div');
    cellHost.className = 'rfd-sampler-cell';
    cellHost.dataset.samplerCell = hostId;
    cellHost.dataset.cellIndex = String(i);
    cellHost.dataset.sceneId = cell.sceneId;
    cellHost.dataset.state = 'skeleton';
    cellHost.style.cssText = [
      'position:relative',
      `width:${cellWidth}px`,
      `height:${cellHeight}px`,
      'background:#fff',
      'border:1px solid var(--border-subtle, #e0e0e0)',
      'border-radius:6px',
      'overflow:hidden',
      'cursor:pointer',
      'transition:border-color 120ms ease, box-shadow 120ms ease',
    ].join(';');

    // Optional caption (shown above each cell when grid.labels set).
    if (grid.labels?.[i]) {
      const caption = document.createElement('div');
      caption.className = 'rfd-sampler-caption';
      caption.style.cssText = [
        'position:absolute',
        'top:0',
        'left:0',
        'right:0',
        'padding:6px 10px',
        "font:500 11px/1.2 'JetBrains Mono', ui-monospace, monospace",
        'color:#525252',
        'background:rgba(255,255,255,0.92)',
        'border-bottom:1px solid #e0e0e0',
        'pointer-events:none',
        'z-index:2',
      ].join(';');
      caption.textContent = grid.labels[i];
      cellHost.appendChild(caption);
    }

    // Initial skeleton paint.
    skeletonByIndex.set(i, cell.skeletonSvg);
    paintSkeleton(cellHost, cell.skeletonSvg);

    // Cell host catches the first click (before any upgraded iframe
    // intercepts). Once iframe is mounted, the iframe's own click
    // handlers take over — this listener still fires (capture:false on
    // host) but does nothing because state !== 'skeleton'.
    cellHost.addEventListener('click', (e) => {
      if (cellHost.dataset.state === 'skeleton') {
        e.preventDefault();
        e.stopPropagation();
        upgrade(i, { x: e.clientX, y: e.clientY });
      }
      // Already 'live' → cell click also promotes focus through registry.
      else if (cellHost.dataset.state === 'live') {
        setFocused(hostId);
      }
    });

    gridEl.appendChild(cellHost);
    cellHosts.push(cellHost);
    ownedHostIds.add(hostId);
  });

  // ─── IntersectionObserver — visibility gating only ─────────
  // Off-screen cells get visibility:hidden + opacity:0 (NOT display:none,
  // see Flow lesson). Hysteresis buffer keeps cells just outside the
  // viewport pre-painted to avoid flicker when scrolling fast.
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const cellEl = entry.target as HTMLElement;
        if (entry.isIntersecting) {
          cellEl.style.visibility = 'visible';
          cellEl.style.opacity = '1';
        } else {
          cellEl.style.visibility = 'hidden';
          cellEl.style.opacity = '0';
        }
      }
    },
    {
      root: scrollWrap,
      rootMargin: `${INTERSECTION_BUFFER_PX}px`,
      threshold: 0,
    },
  );
  for (const cellHost of cellHosts) io.observe(cellHost);

  // ─── Upgrade / demote / focus ──────────────────────────────

  function paintSkeleton(cellHost: HTMLElement, svg: string): void {
    // Strip previous content but keep optional caption (always at top, has
    // class). Caption is preserved because grid.labels never change post-mount.
    const caption = cellHost.querySelector('.rfd-sampler-caption');
    cellHost.innerHTML = '';
    if (caption) cellHost.appendChild(caption);
    const wrap = document.createElement('div');
    wrap.className = 'rfd-sampler-skeleton';
    wrap.style.cssText = [
      'position:absolute',
      'inset:0',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'overflow:hidden',
    ].join(';');
    // Inline SVG (already includes <svg> root). Scale to fit cell.
    wrap.innerHTML = svg;
    const svgEl = wrap.querySelector('svg');
    if (svgEl) {
      svgEl.style.maxWidth = '100%';
      svgEl.style.maxHeight = '100%';
      svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    }
    cellHost.appendChild(wrap);
    cellHost.dataset.state = 'skeleton';
  }

  function upgrade(cellIndex: number, clickAt?: { x: number; y: number }): void {
    const cellHost = cellHosts[cellIndex];
    if (!cellHost) return;
    if (cellHost.dataset.state === 'live') {
      // Already upgraded — just refresh focus.
      setFocused(`${samplerId}-cell-${cellIndex}`);
      return;
    }
    const cell = cells[cellIndex];
    const hostId = `${samplerId}-cell-${cellIndex}`;

    // Cap check BEFORE mounting the new iframe. If we're at MAX, evict the
    // oldest non-focused cell first. The to-be-mounted cell is exempt
    // (we're about to focus it), and the currently-focused cell (if any)
    // is exempt unconditionally.
    if (canvases.size >= MAX_ACTIVE_IFRAMES) {
      const evicted = pickEviction(hostId);
      if (evicted !== null) {
        demote(evicted);
      }
    }

    cellHost.dataset.state = 'upgrading';
    // Remove skeleton wrapper (preserve caption).
    const caption = cellHost.querySelector('.rfd-sampler-caption');
    cellHost.innerHTML = '';
    if (caption) cellHost.appendChild(caption);
    const canvasHost = document.createElement('div');
    canvasHost.className = 'rfd-sampler-canvas';
    canvasHost.style.cssText = 'position:absolute;inset:0;';
    cellHost.appendChild(canvasHost);

    const canvas = createDOMCanvas({
      container: canvasHost,
      sceneId: cell.sceneId,
      hostId,
      compositionKind: 'sampler',
      onSelect: (ids) => opts.onCanvasSelect?.(cell.sceneId, ids),
    });
    canvases.set(hostId, canvas);
    lastFocusedAt.set(hostId, Date.now());
    cellHost.dataset.state = 'live';

    // Promote focus through the registry — fires reframe:composition-focus
    // for shell subscribers. Same path as Flow / Variants.
    setFocused(hostId);

    // If the upgrade was triggered by a click, forward a synthetic click
    // into the iframe at the same coordinates. The iframe needs a moment
    // to load — defer to next tick. Fail-soft: best-effort, no error if
    // the iframe contentDocument isn't ready (user can re-click).
    if (clickAt) {
      const cellRect = cellHost.getBoundingClientRect();
      const localX = clickAt.x - cellRect.left;
      const localY = clickAt.y - cellRect.top;
      requestAnimationFrame(() => {
        try {
          const iframe = canvasHost.querySelector('iframe');
          const doc = (iframe as HTMLIFrameElement | null)?.contentDocument;
          if (doc) {
            const target = doc.elementFromPoint(localX, localY);
            if (target) {
              target.dispatchEvent(new MouseEvent('click', {
                bubbles: true, cancelable: true, view: doc.defaultView ?? window,
              }));
            }
          }
        } catch { /* fail-soft */ }
      });
    }

    notifyPool();
  }

  function pickEviction(incomingHostId: string): number | null {
    // Find the oldest-focused cell that is NOT the incoming one and NOT
    // the currently-focused one. Returns its cellIndex or null if no
    // eligible victim (degenerate — cap reached but only the focused cell
    // is upgraded, which means caps wasn't actually exceeded).
    let oldestHostId: string | null = null;
    let oldestTs = Infinity;
    for (const [hid, ts] of lastFocusedAt) {
      if (hid === incomingHostId) continue;
      if (hid === currentFocusedHostId) continue;
      if (ts < oldestTs) {
        oldestTs = ts;
        oldestHostId = hid;
      }
    }
    if (!oldestHostId) return null;
    const m = oldestHostId.match(/-cell-(\d+)$/);
    if (!m) return null;
    return parseInt(m[1], 10);
  }

  function demote(cellIndex: number): void {
    const cellHost = cellHosts[cellIndex];
    if (!cellHost) return;
    const hostId = `${samplerId}-cell-${cellIndex}`;
    if (cellHost.dataset.state !== 'live') return;
    const canvas = canvases.get(hostId);
    if (canvas) {
      try { canvas.destroy(); }
      catch (err) { console.warn('[sampler-renderer] demote destroy threw', err); }
      canvases.delete(hostId);
    }
    lastFocusedAt.delete(hostId);
    const skeleton = skeletonByIndex.get(cellIndex);
    if (skeleton) paintSkeleton(cellHost, skeleton);
    notifyPool();
  }

  function notifyPool(): void {
    if (!opts.onPoolChange) return;
    opts.onPoolChange({
      active: Array.from(canvases.keys()),
      focused: currentFocusedHostId,
    });
  }

  // ─── Focus event subscription ──────────────────────────────
  // When a user clicks INSIDE an upgraded iframe, dom-canvas's own
  // focus-bridge fires setFocused(hostId). We listen to update the LRU
  // timestamp + currentFocusedHostId. Other focus events (other
  // compositions on the page) are ignored.
  const unsubscribeFocus = onFocusChange((hostId) => {
    if (hostId === null) {
      currentFocusedHostId = null;
      return;
    }
    if (!ownedHostIds.has(hostId)) return;
    currentFocusedHostId = hostId;
    lastFocusedAt.set(hostId, Date.now());
    notifyPool();
  });

  return {
    canvases,
    upgrade: (i) => upgrade(i),
    demote: (i) => demote(i),
    inspectPool: () => ({
      active: Array.from(canvases.keys()),
      focused: currentFocusedHostId,
      skeleton: cellHosts
        .map((el, i) => (el.dataset.state === 'skeleton' ? `${samplerId}-cell-${i}` : null))
        .filter((x): x is string => x !== null),
    }),
    destroy: () => {
      io.disconnect();
      unsubscribeFocus();
      for (const canvas of canvases.values()) {
        try { canvas.destroy(); }
        catch (err) { console.warn('[sampler-renderer] destroy threw', err); }
      }
      canvases.clear();
      lastFocusedAt.clear();
      skeletonByIndex.clear();
      ownedHostIds.clear();
      host.innerHTML = '';
    },
  };
}
