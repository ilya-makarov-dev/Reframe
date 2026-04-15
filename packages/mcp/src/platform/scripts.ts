/**
 * Platform — client JS islands.
 *
 * Phase 8 rebuild: removes the old 8-tool ribbon + capture-click
 * machinery and replaces it with the Preview Bridge + SVG annotation
 * overlay + verb chip bar. Flow:
 *
 *   1. iframe loads → inject script posts {type:'reframe:ready'}
 *   2. user hovers → iframe posts {type:'reframe:hover', inode, bbox}
 *   3. parent draws hover-outline on SVG
 *   4. user clicks → iframe posts {type:'reframe:click', inode, bbox}
 *   5. parent updates selection + shows verb chip bar near the node
 *   6. user clicks a chip (or presses hotkey) → gesture is built →
 *      POST /platform/api/gesture → core runs translateGesture +
 *      creates thread/annotation/intent → stream refreshes
 *
 * All coordinates coming from the iframe are in iframe-document space
 * (1440×900 for desktop). SVG overlay uses viewBox matching those
 * dimensions so we can feed raw coords directly.
 */

export const PLATFORM_JS = `
(function() {
  'use strict';

  // ── State ──────────────────────────────────────────────
  const state = {
    currentSceneSlug: null,
    currentViewport: 'desktop',
    // Edit mode — when OFF (default), the preview is a live interactive
    // preview. Hover states, link clicks, scroll — all native iframe
    // behaviour. When ON, the gesture layer activates: hover outlines
    // track nodes, clicks select + open chip bar, verbs respond to
    // hotkeys. Toggle via header button or "E" key. Marks (persistent
    // annotations) remain visible + clickable in BOTH modes.
    editMode: false,
    hover: { inode: null, bbox: null },
    selection: { inode: null, bbox: null, tag: null },
    // Measurement cache: inode → { bbox, style, tag, className, role, text }
    // Populated via reframe:measurements message from the inject script.
    measurements: new Map(),
    // Currently-rendered annotations on this scene.
    annotations: [],
    // Keyboard focus on a specific mark id (for Tab cycling).
    focusedMarkId: null,
    // Verb submode state machine. null = no active mode. Rich modes:
    // { kind:'echo'|'drag', source }
    // { kind:'lasso', polygon:[[x,y]...], active:bool }
    // { kind:'brush', macro, anchors:Set, active:bool }
    // { kind:'drag-live', source, delta:{dx,dy} }
    // { kind:'resonance', seed, axes:Set, matches:[] }
    // { kind:'pin-pick', target }
    // { kind:'re-anchor', annotationId }
    mode: null,
    sectionsLoaded: false,
    varyPanelLoaded: false,
  };

  const VIEWPORT_DIMS = {
    original: { w: 1440, h: 2000 }, // overridden at runtime from data-orig-w/h
    desktop: { w: 1440, h: 900 },
    tablet:  { w: 768,  h: 1024 },
    mobile:  { w: 375,  h: 812 },
  };

  // ── DOM helpers ────────────────────────────────────────
  function $(s, root) { return (root || document).querySelector(s); }
  function $$(s, root) { return Array.from((root || document).querySelectorAll(s)); }

  function escape(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function flash(message, kind) {
    const el = document.createElement('div');
    el.className = 'flash' + (kind ? ' ' + kind : '');
    el.textContent = message;
    document.body.appendChild(el);
    requestAnimationFrame(function() { el.classList.add('show'); });
    setTimeout(function() {
      el.classList.remove('show');
      setTimeout(function() { el.remove(); }, 300);
    }, 2400);
  }

  async function api(path, body) {
    try {
      const res = await fetch(path, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'request failed (' + res.status + ')');
      }
      return await res.json();
    } catch (e) {
      flash('API error: ' + e.message, 'error');
      throw e;
    }
  }

  // ── Debounce helpers ──────────────────────────────────
  // Platform UI used to call refreshStream/refreshAnnotations/refreshAudit
  // synchronously on every SSE event. A single user action (e.g. applying
  // a brand) typically fires 3-5 events in a burst — the old code would
  // re-run N × (api calls + DOM rebuild + iframe reload) per burst,
  // producing 2-3s of perceptible lag. Debouncing coalesces bursts into
  // a single refresh per burst.
  function debounce(fn, ms) {
    var t = null;
    var wrapped = function() {
      var args = arguments;
      if (t) clearTimeout(t);
      t = setTimeout(function() { t = null; fn.apply(null, args); }, ms);
    };
    wrapped.flush = function() { if (t) { clearTimeout(t); t = null; fn(); } };
    wrapped.cancel = function() { if (t) { clearTimeout(t); t = null; } };
    return wrapped;
  }

  // Debounced refreshers — created after the base functions are defined.
  // These vars are reassigned in bindStreamInput/init path.
  var debouncedRefreshViewports = null;
  var debouncedRefreshStream = null;
  var debouncedRefreshAnnotations = null;
  var debouncedRefreshAudit = null;

  // ── SSE subscription ──────────────────────────────────
  function subscribeSSE() {
    if (!window.EventSource) return;
    try {
      const es = new EventSource('/events');
      es.addEventListener('message', function(ev) {
        try { handleEvent(JSON.parse(ev.data)); } catch (_) {}
      });
      es.addEventListener('error', function() { /* auto-reconnects */ });
    } catch (_) {}
  }

  function handleEvent(ev) {
    // Kick the debounced refreshers — multiple events in <Nms coalesce
    // into a single refresh cycle. Each SSE kind triggers only the
    // refreshers that actually depend on it.
    switch (ev.type) {
      case 'scene:saved':
      case 'scene:deleted':
      case 'scene:session-changed':
        // Targeted refresh — only reload the iframe whose scene
        // actually changed. On canvas there are N artboard iframes,
        // and reloading ALL of them on every keystroke makes the page
        // flash. The server now emits ev.sceneId with the event so we
        // can be surgical. Falls back to "refresh all" if no sceneId
        // is present (older events, scene-page callers).
        if (ev.sceneId) {
          refreshViewportById(ev.sceneId);
        } else if (debouncedRefreshViewports) {
          debouncedRefreshViewports();
        }
        if (debouncedRefreshStream) debouncedRefreshStream();
        if (debouncedRefreshAnnotations) debouncedRefreshAnnotations();
        if (debouncedRefreshAudit) debouncedRefreshAudit();
        break;
      case 'intent:updated':
        if (debouncedRefreshStream) debouncedRefreshStream();
        if (debouncedRefreshAnnotations) debouncedRefreshAnnotations();
        break;
      case 'annotation:updated':
        if (debouncedRefreshAnnotations) debouncedRefreshAnnotations();
        if (debouncedRefreshStream) debouncedRefreshStream();
        break;
      case 'design-system:updated':
        if (debouncedRefreshViewports) debouncedRefreshViewports();
        break;
    }
  }

  // Immediate (non-debounced) version — used to synchronously cache-bust
  // iframes. The debounced wrapper is installed during init.
  function refreshViewports() {
    $$('.viewport-frame iframe').forEach(function(iframe) {
      reloadIframePreservingScroll(iframe);
    });
  }

  // Reload a single iframe without losing its scroll position. Setting
  // iframe.src re-parses the document and scrolls to (0,0); we capture
  // the current scroll before, and restore it on load.
  function reloadIframePreservingScroll(iframe) {
    if (!iframe || !iframe.src) return;
    var savedX = 0, savedY = 0;
    try {
      var w = iframe.contentWindow;
      if (w) { savedX = w.scrollX || 0; savedY = w.scrollY || 0; }
    } catch (_) {}
    const url = new URL(iframe.src, location.origin);
    url.searchParams.set('t', Date.now().toString());
    function onLoad() {
      iframe.removeEventListener('load', onLoad);
      try {
        var w2 = iframe.contentWindow;
        if (w2 && (savedX || savedY)) w2.scrollTo(savedX, savedY);
      } catch (_) {}
    }
    iframe.addEventListener('load', onLoad);
    iframe.src = url.pathname + url.search;
  }

  // Reload only iframes rendering a specific scene. On the project
  // canvas, each .canvas-artboard has data-scene-id pointing at its
  // session scene id — we match on that and only cache-bust the one
  // that actually changed. Scene pages fall through to refresh-all.
  function refreshViewportById(sceneId) {
    if (!sceneId) { refreshViewports(); return; }
    var hit = false;
    $$('.canvas-artboard[data-scene-id="' + sceneId + '"]').forEach(function(ab) {
      var iframe = ab.querySelector('iframe');
      if (iframe) { reloadIframePreservingScroll(iframe); hit = true; }
    });
    if (hit) return;
    // Not on canvas — fall back to refreshing all viewport-frame
    // iframes (scene page has one; it matches the edited scene by
    // definition since there's only one).
    refreshViewports();
  }

  // ── Preview bridge (iframe → parent messages) ────────
  //
  // On the project canvas there are N artboard iframes, each rendering
  // a different scene. A postMessage from any of them needs to be
  // routed to that scene id — not the single viewport-frame
  // data-session which, on canvas, points at the project owner. We
  // walk every iframe element, compare contentWindow to event.source
  // and read the parent canvas-artboard data-scene-id attribute. On
  // scene pages (single iframe) this returns null and callers fall
  // back to the old data-session lookup, so nothing regresses.
  function findCanvasSceneIdFromEvent(event) {
    try {
      var srcWin = event && event.source;
      if (!srcWin) return null;
      var frames = document.querySelectorAll('iframe');
      for (var i = 0; i < frames.length; i++) {
        if (frames[i].contentWindow === srcWin) {
          var artboard = frames[i].closest && frames[i].closest('.canvas-artboard');
          if (artboard) return artboard.getAttribute('data-scene-id');
          return null;
        }
      }
    } catch (_) {}
    return null;
  }

  function bindPreviewBridge() {
    window.addEventListener('message', function(event) {
      const data = event.data || {};
      if (data.source !== 'reframe-preview') return;
      // Stamp the event with the originating artboard's scene id so
      // downstream handlers (onPreviewClick → showPropsForNode) hit the
      // right scene instead of the first .viewport-frame on the page.
      data.__canvasSceneId = findCanvasSceneIdFromEvent(event);
      switch (data.type) {
        case 'reframe:ready':
          // Sync annotation mode (iframe-side link-blocking + crosshair
          // cursor) with our edit mode state.
          postToIframe({ type: 'reframe:setMode', annotationMode: state.editMode });
          postToIframe({ type: 'reframe:measure-all' });
          break;
        case 'reframe:hover':
          // Only process hover in edit mode — in view mode the preview
          // should feel native, no overlays fighting the content.
          if (state.editMode) onPreviewHover(data);
          break;
        case 'reframe:click':
          // Same story: clicks inside the iframe only become selections
          // when the user is explicitly in edit mode.
          if (state.editMode) onPreviewClick(data);
          break;
        case 'reframe:cancel':
          onPreviewCancel();
          break;
        case 'reframe:contextmenu':
          onPreviewContextMenu(data);
          break;
        case 'reframe:scroll':
          repositionChipBar();
          renderAllAnnotations();
          break;
        case 'reframe:measurements':
          onMeasurements(data.measurements || []);
          break;
      }
    });
  }

  function onMeasurements(list) {
    state.measurements.clear();
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (m && m.inode) state.measurements.set(m.inode, m);
    }
    // Re-render persistent marks — bboxes may have shifted.
    renderAllAnnotations();
    // Re-render audit badges with updated bbox positions.
    if (auditFindings.length > 0) {
      var frame = $('.viewport-frame');
      var sid = frame ? frame.getAttribute('data-session') : null;
      if (sid) renderAuditBadges(sid);
    }
    // Update the live resonance match set if that mode is active.
    if (state.mode && state.mode.kind === 'resonance') {
      recomputeResonance();
    }
  }

  function requestRemeasure() {
    postToIframe({ type: 'reframe:measure-all' });
  }

  function postToIframe(message) {
    $$('.viewport-frame iframe').forEach(function(iframe) {
      if (!iframe.contentWindow) return;
      try {
        iframe.contentWindow.postMessage({ source: 'reframe-host', ...message }, '*');
      } catch (_) {}
    });
  }

  function onPreviewHover(data) {
    state.hover.inode = data.inode || null;
    state.hover.bbox = data.bbox || null;
    drawHoverOutline();
  }

  function onPreviewClick(data) {
    if (!data.inode) {
      clearSelection();
      return;
    }
    // In a verb submode, clicks accumulate state for the in-progress gesture.
    if (state.mode) {
      handleModeClick(data);
      return;
    }
    state.selection.inode = data.inode;
    state.selection.bbox = data.bbox || null;
    state.selection.tag = data.tag || '';
    // Overlay + chip bar — these are tuned for single-iframe scene
    // pages. On canvas they silently no-op (no .viewport-frame
    // .annotations SVG) or float on the wrong coords, so we skip the
    // chip bar entirely when the click came from a canvas artboard.
    drawSelectOutline();
    var onCanvas = !!data.__canvasSceneId;
    if (!onCanvas) showChipBar();
    // Show Properties Inspector for the selected node. Canvas clicks
    // use the per-artboard scene id stamped by bindPreviewBridge;
    // scene pages fall back to the single .viewport-frame data-session.
    var sessionId = data.__canvasSceneId || null;
    if (!sessionId) {
      var frame = $('.viewport-frame');
      sessionId = frame ? frame.getAttribute('data-session') : null;
    }
    if (sessionId) {
      showPropsForNode(data.inode, sessionId);
    }
  }

  function onPreviewCancel() {
    if (state.mode) {
      exitMode('cancelled');
      return;
    }
    clearSelection();
  }

  function onPreviewContextMenu(data) {
    if (!data.inode) return;
    // First select the node so context menu actions target it.
    state.selection.inode = data.inode;
    state.selection.bbox = data.bbox || null;
    state.selection.tag = data.tag || '';
    drawSelectOutline();
    drawSelectionHandles();
    var frame = $('.viewport-frame');
    var sessionId = frame ? frame.getAttribute('data-session') : null;
    if (sessionId) showPropsForNode(data.inode, sessionId);
    // Position context menu at the iframe's screen position + node bbox.
    var iframe = frame ? frame.querySelector('iframe') : null;
    if (iframe) {
      var iframeRect = iframe.getBoundingClientRect();
      var dims = VIEWPORT_DIMS[state.currentViewport];
      var sx = iframeRect.width / dims.w;
      var sy = iframeRect.height / dims.h;
      var screenX = iframeRect.left + ((data.bbox ? data.bbox.x + data.bbox.w : 0) * sx);
      var screenY = iframeRect.top + ((data.bbox ? data.bbox.y : 0) * sy);
      showContextMenu(screenX, screenY);
    }
  }

  function clearSelection() {
    state.selection.inode = null;
    state.selection.bbox = null;
    state.selection.tag = null;
    drawSelectOutline();
    hideChipBar();
    clearPropsPanel();
  }

  // ── SVG overlay drawing ──────────────────────────────
  function drawHoverOutline() {
    const svg = $('.viewport-frame .annotations');
    if (!svg) return;
    const rect = $('.hover-outline', svg);
    if (!rect) return;
    const h = state.hover;
    if (!h.inode || !h.bbox) {
      rect.classList.add('hidden');
      return;
    }
    rect.classList.remove('hidden');
    rect.setAttribute('x', h.bbox.x);
    rect.setAttribute('y', h.bbox.y);
    rect.setAttribute('width', h.bbox.w);
    rect.setAttribute('height', h.bbox.h);
  }

  function drawSelectOutline() {
    const svg = $('.viewport-frame .annotations');
    if (!svg) return;
    const rect = $('.select-outline', svg);
    if (!rect) return;
    const s = state.selection;
    if (!s.inode || !s.bbox) {
      rect.classList.add('hidden');
      return;
    }
    rect.classList.remove('hidden');
    rect.setAttribute('x', s.bbox.x);
    rect.setAttribute('y', s.bbox.y);
    rect.setAttribute('width', s.bbox.w);
    rect.setAttribute('height', s.bbox.h);
  }

  // ── Verb chip bar ─────────────────────────────────────
  function renderChipBar() {
    const bar = $('.verb-chip-bar');
    if (!bar) return;
    const tag = state.selection.tag || 'node';
    const inode = state.selection.inode || '';
    const shortInode = inode.length > 12 ? inode.slice(0, 12) + '…' : inode;
    bar.innerHTML =
      '<button class="verb-chip" data-verb="ask"       title="Ask a question (a)">Ask<span class="kbd-hint">a</span></button>' +
      '<button class="verb-chip" data-verb="echo"      title="Echo style from another node (e)">Echo<span class="kbd-hint">e</span></button>' +
      '<button class="verb-chip" data-verb="pin"       title="Pin a reference (p)">Pin<span class="kbd-hint">p</span></button>' +
      '<button class="verb-chip" data-verb="rule"      title="Attach a standing rule (r)">Rule<span class="kbd-hint">r</span></button>' +
      '<button class="verb-chip" data-verb="drag"      title="Move this node (m)">Drag<span class="kbd-hint">m</span></button>' +
      '<button class="verb-chip" data-verb="resonance" title="Find similar nodes (s)">Resonance<span class="kbd-hint">s</span></button>' +
      '<button class="verb-chip" data-verb="lasso"     title="Multi-select region (l)">Lasso<span class="kbd-hint">l</span></button>' +
      '<button class="verb-chip" data-verb="brush"     title="Paint with macro (b)">Brush<span class="kbd-hint">b</span></button>' +
      '<button class="verb-chip" data-verb="time"      title="Scrub history (t)">Time<span class="kbd-hint">t</span></button>' +
      '<span class="verb-chip anchor-label">' + escape('<' + tag + '> ' + shortInode) + '</span>';
    bindChips();
  }

  function bindChips() {
    $$('.verb-chip[data-verb]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const verb = btn.getAttribute('data-verb');
        handleVerb(verb);
      });
    });
  }

  function showChipBar() {
    // Selection now uses canvas handles + right-click context menu.
    // No floating toolbar. Draw resize handles + padding zones on SVG.
    drawSelectionHandles();
  }

  function hideChipBar() {
    clearSelectionHandles();
  }

  // ── Selection handles (canvas-native, no toolbar) ────
  // 4 corner resize handles + padding zones on SVG overlay.
  // Right-click context menu for actions + AI verbs.

  function drawSelectionHandles() {
    var svg = $('.viewport-frame .annotations');
    if (!svg) return;
    var s = state.selection;
    if (!s.inode || !s.bbox) return;
    clearSelectionHandles();
    var b = s.bbox;
    var hs = 8;
    var corners = [
      { cls: 'nw', x: b.x - hs/2,       y: b.y - hs/2 },
      { cls: 'ne', x: b.x + b.w - hs/2, y: b.y - hs/2 },
      { cls: 'sw', x: b.x - hs/2,       y: b.y + b.h - hs/2 },
      { cls: 'se', x: b.x + b.w - hs/2, y: b.y + b.h - hs/2 },
    ];
    var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'selection-handles');
    for (var i = 0; i < corners.length; i++) {
      var c = corners[i];
      var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('class', 'resize-handle ' + c.cls);
      rect.setAttribute('x', String(c.x));
      rect.setAttribute('y', String(c.y));
      rect.setAttribute('width', String(hs));
      rect.setAttribute('height', String(hs));
      rect.setAttribute('rx', '1');
      g.appendChild(rect);
    }
    svg.appendChild(g);

    // AI trigger — small clickable icon below the SE corner handle.
    // Shows "✦" that opens the AI verb picker on click. This is the
    // ONE discoverable entry point for AI verbs on the canvas (the
    // other is right-click context menu).
    var htmlLayer = $('.annotation-marks-html');
    if (htmlLayer) {
      // Remove old trigger.
      var old = htmlLayer.querySelector('.ai-trigger');
      if (old) old.remove();
      // Position in screen coords below SE corner.
      var scr = bboxToScreen(b);
      var trigger = document.createElement('div');
      trigger.className = 'ai-trigger';
      trigger.innerHTML = '\u2726';
      trigger.title = 'AI tools (right-click for more)';
      trigger.style.left = (scr.left + scr.width - 4) + 'px';
      trigger.style.top = (scr.top + scr.height + 6) + 'px';
      trigger.addEventListener('click', function(e) {
        e.stopPropagation();
        showAiVerbPicker(trigger);
      });
      htmlLayer.appendChild(trigger);
    }
  }

  function showAiVerbPicker(anchorEl) {
    // Remove existing.
    var old = $('.ai-verb-panel');
    if (old) old.remove();
    var panel = document.createElement('div');
    panel.className = 'ai-verb-panel';
    panel.innerHTML =
      '<button class="avp-item" data-verb="ask">\u2726 Ask</button>' +
      '<button class="avp-item" data-verb="echo">\u2726 Echo</button>' +
      '<button class="avp-item" data-verb="pin">\u2726 Pin</button>' +
      '<button class="avp-item" data-verb="rule">\u2726 Rule</button>' +
      '<button class="avp-item" data-verb="brush">\u2726 Brush</button>';
    // Position below the trigger.
    var rect = anchorEl.getBoundingClientRect();
    panel.style.position = 'fixed';
    panel.style.left = rect.left + 'px';
    panel.style.top = (rect.bottom + 4) + 'px';
    document.body.appendChild(panel);
    // Bind.
    panel.querySelectorAll('[data-verb]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        panel.remove();
        handleVerb(btn.getAttribute('data-verb'));
      });
    });
    // Close on outside click.
    setTimeout(function() {
      document.addEventListener('click', function closePanel() {
        panel.remove();
        document.removeEventListener('click', closePanel);
      });
    }, 10);
  }

  function clearSelectionHandles() {
    var svg = $('.viewport-frame .annotations');
    if (svg) {
      var existing = svg.querySelector('.selection-handles');
      if (existing) existing.remove();
    }
    // Also remove the AI trigger icon.
    var htmlLayer = $('.annotation-marks-html');
    if (htmlLayer) {
      var trigger = htmlLayer.querySelector('.ai-trigger');
      if (trigger) trigger.remove();
    }
    // And any open verb picker.
    var picker = $('.ai-verb-panel');
    if (picker) picker.remove();
  }

  // ── Right-click context menu ────────────────────────
  function bindContextMenu() {
    // Bind on the SVG annotation layer AND the HTML marks layer —
    // these sit on top of the iframe so their contextmenu fires
    // (iframe is cross-origin, its contextmenu doesn't propagate).
    var targets = [
      $('.viewport-frame .annotations'),
      $('.viewport-frame .annotation-marks-html'),
      $('.viewport-frame'),
    ];
    targets.forEach(function(el) {
      if (!el) return;
      el.addEventListener('contextmenu', function(e) {
        if (!state.editMode || !state.selection.inode) return;
        e.preventDefault();
        e.stopPropagation();
        showContextMenu(e.clientX, e.clientY);
      });
    });
    // Close on any left click outside.
    document.addEventListener('click', function() { closeContextMenu(); });
    // Also close on Escape.
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeContextMenu();
    });
  }

  function showContextMenu(x, y) {
    closeContextMenu();
    var menu = document.createElement('div');
    menu.className = 'context-menu show';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.innerHTML =
      '<div class="ctx-item" data-ctx="add-frame">Add frame<span class="shortcut">child</span></div>' +
      '<div class="ctx-item" data-ctx="add-text">Add text<span class="shortcut">child</span></div>' +
      '<div class="ctx-item" data-ctx="duplicate">Duplicate<span class="shortcut">\u2318D</span></div>' +
      '<div class="ctx-item danger" data-ctx="delete">Delete<span class="shortcut">\u232B</span></div>' +
      '<div class="ctx-sep"></div>' +
      '<div class="ctx-item ai-verb" data-ctx="ask">\u2726 Ask about this\u2026</div>' +
      '<div class="ctx-item ai-verb" data-ctx="echo">\u2726 Echo from\u2026</div>' +
      '<div class="ctx-item ai-verb" data-ctx="pin">\u2726 Pin reference</div>' +
      '<div class="ctx-item ai-verb" data-ctx="rule">\u2726 Set rule</div>' +
      '<div class="ctx-item ai-verb" data-ctx="brush">\u2726 Brush with macro</div>' +
      '<div class="ctx-sep"></div>' +
      '<div class="ctx-item" data-ctx="wrap">Wrap in container</div>' +
      '<div class="ctx-item" data-ctx="extract">Extract component</div>';
    document.body.appendChild(menu);
    // Clamp to viewport.
    var rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';
    // Bind items.
    menu.querySelectorAll('[data-ctx]').forEach(function(item) {
      item.addEventListener('click', function(e) {
        e.stopPropagation();
        var action = item.getAttribute('data-ctx');
        closeContextMenu();
        handleContextAction(action);
      });
    });
    // Prevent menu itself from closing on its own click.
    menu.addEventListener('click', function(e) { e.stopPropagation(); });
  }

  function closeContextMenu() {
    var existing = $('.context-menu');
    if (existing) existing.remove();
  }

  async function handleContextAction(action) {
    var frame = $('.viewport-frame');
    var sessionId = frame ? frame.getAttribute('data-session') : null;
    var nodeId = state.selection.inode;
    if (!sessionId || !nodeId) return;

    switch (action) {
      case 'ask':     handleVerb('ask'); break;
      case 'echo':    handleVerb('echo'); break;
      case 'pin':     handleVerb('pin'); break;
      case 'rule':    handleVerb('rule'); break;
      case 'brush':   handleVerb('brush'); break;
      case 'duplicate': {
        try {
          var res = await api('/platform/api/node/duplicate', { sceneId: sessionId, nodeId: nodeId });
          if (res.ok) {
            flash('Duplicated', 'success');
            refreshLayersTree();
          }
        } catch (_) {}
        break;
      }
      case 'delete': {
        try {
          await api('/platform/api/node/delete', { sceneId: sessionId, nodeId: nodeId });
          flash('Deleted', 'success');
          clearSelection();
          refreshLayersTree();
        } catch (_) {}
        break;
      }
      case 'wrap': {
        try {
          var res = await api('/platform/api/node/wrap', { sceneId: sessionId, nodeId: nodeId });
          if (res.ok) {
            flash('Wrapped in container', 'success');
            refreshLayersTree();
          }
        } catch (_) {}
        break;
      }
      case 'extract': {
        flash('Extract component: use reframe_project extract_component via AI');
        break;
      }
      case 'add-frame': {
        try {
          var res = await api('/platform/api/node/add', { sceneId: sessionId, parentId: nodeId, type: 'FRAME', name: 'Frame' });
          if (res.ok) { flash('Frame added', 'success'); refreshLayersTree(); }
        } catch (_) {}
        break;
      }
      case 'add-text': {
        try {
          var res = await api('/platform/api/node/add', { sceneId: sessionId, parentId: nodeId, type: 'TEXT', name: 'Text' });
          if (res.ok) { flash('Text added', 'success'); refreshLayersTree(); }
        } catch (_) {}
        break;
      }
    }
  }

  function repositionChipBar() {
    const bar = $('.verb-chip-bar');
    const frame = $('.viewport-frame');
    if (!bar || !frame || !state.selection.bbox) return;
    // Convert iframe-doc coords → screen space within the frame.
    // The iframe is scaled by the ratio of frame size / iframe-doc size.
    const dims = VIEWPORT_DIMS[state.currentViewport];
    const scaleX = frame.clientWidth / dims.w;
    const scaleY = frame.clientHeight / dims.h;
    const b = state.selection.bbox;
    const top = b.y * scaleY + b.h * scaleY + 8;  // below the node
    const left = b.x * scaleX;
    // Clamp within frame so chip bar doesn't escape the viewport.
    const barW = bar.offsetWidth || 240;
    const maxLeft = frame.clientWidth - barW - 8;
    bar.style.top = top + 'px';
    bar.style.left = Math.max(8, Math.min(left, maxLeft)) + 'px';
    // If the chip bar would go below the frame, flip it above the node.
    if (top + bar.offsetHeight > frame.clientHeight) {
      const above = b.y * scaleY - bar.offsetHeight - 8;
      bar.style.top = Math.max(8, above) + 'px';
    }
  }

  // ── Verb handlers ─────────────────────────────────────
  async function handleVerb(verb) {
    if (!state.selection.inode) return;
    switch (verb) {
      case 'ask':       return handleAsk();
      case 'rule':      return handleRule();
      case 'echo':      return enterMode({ kind: 'echo', source: null });
      case 'drag':      return enterMode({ kind: 'drag-live', source: state.selection.inode, origin: null, delta: { dx: 0, dy: 0 }, active: false });
      case 'pin':       return handlePin();
      case 'lasso':     return enterMode({ kind: 'lasso', polygon: [], active: false });
      case 'brush':     return handleBrushEnter();
      case 'resonance': return handleResonanceEnter();
      case 'time':      return handleTime();
      default: flash('Verb "' + verb + '" not wired yet', 'error');
    }
  }

  // ════════════════════════════════════════════════════════
  // VerbPanels — inline glass panels replacing ALL prompt() calls.
  // Each verb gets a purpose-built panel that floats near the node.
  // ════════════════════════════════════════════════════════

  function showVerbPanel(verb, html, onSubmit) {
    // Remove any existing verb panel.
    closeVerbPanel();
    var frame = $('.viewport-frame') || $('.main') || document.querySelector('.app') || document.body;
    var panel = document.createElement('div');
    panel.className = 'verb-panel show';
    panel.setAttribute('data-verb-panel', verb);
    panel.innerHTML =
      '<div class="verb-panel-head">' +
        '<span class="verb-panel-title">' + escape(verb) + '</span>' +
        '<button class="verb-panel-close">\u00D7</button>' +
      '</div>' +
      html +
      '<div class="verb-panel-submit">' +
        '<button class="btn btn-ghost btn-sm" data-vp-action="cancel">Cancel</button>' +
        '<button class="btn btn-primary btn-sm" data-vp-action="submit">Apply</button>' +
      '</div>';
    frame.appendChild(panel);
    // Position near selected node.
    positionVerbPanel(panel);
    // Bind close + cancel + submit.
    panel.querySelector('.verb-panel-close').addEventListener('click', closeVerbPanel);
    panel.querySelector('[data-vp-action="cancel"]').addEventListener('click', closeVerbPanel);
    panel.querySelector('[data-vp-action="submit"]').addEventListener('click', function() {
      if (onSubmit) onSubmit(panel);
      closeVerbPanel();
    });
    // Focus first input if any.
    var firstInput = panel.querySelector('input, select, textarea');
    if (firstInput) setTimeout(function() { firstInput.focus(); }, 50);
    // Enter = submit in single-input panels.
    panel.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
        e.preventDefault();
        if (onSubmit) onSubmit(panel);
        closeVerbPanel();
      }
      if (e.key === 'Escape') { closeVerbPanel(); }
    });
  }

  function closeVerbPanel() {
    var existing = $('[data-verb-panel]');
    if (existing) existing.remove();
  }

  function positionVerbPanel(panel) {
    if (!state.selection.bbox) return;
    var frame = $('.viewport-frame');
    if (!frame) return;
    var dims = VIEWPORT_DIMS[state.currentViewport];
    var sx = frame.clientWidth / dims.w;
    var sy = frame.clientHeight / dims.h;
    var b = state.selection.bbox;
    // Position to the right of the node, vertically centered.
    var left = b.x * sx + b.w * sx + 12;
    var top = b.y * sy;
    // If would overflow right edge, put to the left instead.
    if (left + 300 > frame.clientWidth) {
      left = b.x * sx - 300 - 12;
    }
    panel.style.left = Math.max(8, left) + 'px';
    panel.style.top = Math.max(8, top) + 'px';
  }

  // ── Ask verb panel ─────────────────────────────────
  function handleAsk() {
    showVerbPanel('Ask',
      '<input class="ask-input" type="text" placeholder="Ask about this node\u2026" data-vp-field="text">' +
      '<div class="ask-hint">Enter to submit \u00B7 Esc to cancel</div>',
      function(panel) {
        var input = panel.querySelector('[data-vp-field="text"]');
        var text = input ? input.value.trim() : '';
        if (!text) return;
        submitGesture({
          kind: 'ask',
          at: new Date().toISOString(),
          sceneSlug: state.currentSceneSlug,
          author: { kind: 'human', id: 'platform-ui' },
          anchor: state.selection.inode,
          text: text,
        });
      }
    );
  }

  // ── Rule verb panel ────────────────────────────────
  function handleRule() {
    var commonRules = [
      'min-contrast', 'min-height-44', 'min-font-size',
      'brand-only', 'max-width', 'no-shrink-mobile',
      'spacing-grid', 'touch-target', 'text-overflow',
    ];
    var options = commonRules.map(function(r) {
      return '<option value="' + escape(r) + '">' + escape(r) + '</option>';
    }).join('');

    showVerbPanel('Rule',
      '<select class="rule-select" data-vp-field="rule">' +
        '<option value="">Select a rule\u2026</option>' +
        options +
        '<option value="__custom">Custom\u2026</option>' +
      '</select>' +
      '<input class="rule-value-input" type="text" placeholder="Custom rule name" data-vp-field="custom-rule" style="display:none">' +
      '<input class="rule-value-input" type="text" placeholder="Value (optional)" data-vp-field="value" style="display:none">' +
      '<label class="rule-enforced"><input type="checkbox" data-vp-field="enforced" checked> Standing order (audit enforces)</label>',
      function(panel) {
        var selectEl = panel.querySelector('[data-vp-field="rule"]');
        var valueEl = panel.querySelector('[data-vp-field="value"]');
        var enforcedEl = panel.querySelector('[data-vp-field="enforced"]');
        var rule = selectEl ? selectEl.value : '';
        if (rule === '__custom') {
          // Custom rule: read from a hidden input that appears when Custom is selected.
          var customInput = panel.querySelector('[data-vp-field="custom-rule"]');
          rule = customInput ? customInput.value.trim() : '';
        }
        if (!rule) return;
        var valStr = valueEl ? valueEl.value.trim() : '';
        var value = undefined;
        if (valStr) {
          var asNum = Number(valStr);
          value = isNaN(asNum) ? valStr : asNum;
        }
        submitGesture({
          kind: 'rule',
          at: new Date().toISOString(),
          sceneSlug: state.currentSceneSlug,
          author: { kind: 'human', id: 'platform-ui' },
          anchor: state.selection.inode,
          rule: rule,
          value: value,
          enforced: enforcedEl ? enforcedEl.checked : true,
        });
      }
    );
    // Show value input when a rule is selected + custom input when Custom chosen.
    var select = $('[data-verb-panel] .rule-select');
    var valInput = $('[data-verb-panel] [data-vp-field="value"]');
    var customInput = $('[data-verb-panel] [data-vp-field="custom-rule"]');
    if (select) {
      select.addEventListener('change', function() {
        if (valInput) valInput.style.display = select.value ? '' : 'none';
        if (customInput) customInput.style.display = select.value === '__custom' ? '' : 'none';
      });
    }
  }

  // ── Echo verb panel (axis picker after two-click) ──
  function handleEchoAxis(fromAnchor, toAnchor) {
    var axes = ['visual-style', 'structure', 'role', 'all'];
    var html = '<div class="echo-step">Echo from <strong>' + escape(String(fromAnchor).slice(-8)) + '</strong> to <strong>' + escape(String(toAnchor).slice(-8)) + '</strong></div>' +
      '<div class="echo-axes">' +
        axes.map(function(ax, i) {
          return '<button class="echo-axis' + (i === 0 ? ' active' : '') + '" data-axis="' + escape(ax) + '">' + escape(ax) + '</button>';
        }).join('') +
      '</div>';
    showVerbPanel('Echo', html, function(panel) {
      var activeAxis = panel.querySelector('.echo-axis.active');
      var axis = activeAxis ? activeAxis.getAttribute('data-axis') : 'visual-style';
      submitGesture({
        kind: 'echo',
        at: new Date().toISOString(),
        sceneSlug: state.currentSceneSlug,
        author: { kind: 'human', id: 'platform-ui' },
        fromAnchor: fromAnchor,
        toAnchor: toAnchor,
        axis: axis,
      });
    });
    // Bind axis buttons to toggle active state.
    $$('[data-verb-panel] .echo-axis').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        $$('[data-verb-panel] .echo-axis').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
      });
    });
  }

  // ── Pin verb panel (tabs: Image / URL / Brand / Node) ─
  function handlePin() {
    var tabs = ['Image', 'URL', 'Brand', 'Node'];
    showVerbPanel('Pin',
      '<div class="pin-tabs">' +
        tabs.map(function(t, i) {
          return '<button class="pin-tab' + (i === 0 ? ' active' : '') + '" data-pin-type="' + escape(t.toLowerCase()) + '">' + escape(t) + '</button>';
        }).join('') +
      '</div>' +
      '<input class="pin-input" type="text" placeholder="Image URL\u2026" data-vp-field="source">' +
      '<input class="pin-input" type="text" placeholder="Note (optional)" data-vp-field="note" style="margin-top:6px">',
      function(panel) {
        var activeTab = panel.querySelector('.pin-tab.active');
        var type = activeTab ? activeTab.getAttribute('data-pin-type') : 'url';
        var sourceEl = panel.querySelector('[data-vp-field="source"]');
        var noteEl = panel.querySelector('[data-vp-field="note"]');
        var source = sourceEl ? sourceEl.value.trim() : '';
        var note = noteEl ? noteEl.value.trim() : undefined;
        if (!source && type !== 'node') return;
        var reference = null;
        if (type === 'image') reference = { type: 'image', url: source };
        else if (type === 'url') reference = { type: 'url', url: source };
        else if (type === 'brand') reference = { type: 'brand', brand: source };
        else if (type === 'node') {
          // Enter pin-pick mode — next click on preview = source node.
          closeVerbPanel();
          enterMode({ kind: 'pin-pick', target: state.selection.inode });
          flash('Click a source node', 'success');
          return;
        }
        submitGesture({
          kind: 'pin',
          at: new Date().toISOString(),
          sceneSlug: state.currentSceneSlug,
          author: { kind: 'human', id: 'platform-ui' },
          anchor: state.selection.inode,
          reference: reference,
          note: note || undefined,
        });
      }
    );
    // Tab switching.
    $$('[data-verb-panel] .pin-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        $$('[data-verb-panel] .pin-tab').forEach(function(t) { t.classList.remove('active'); });
        tab.classList.add('active');
        var type = tab.getAttribute('data-pin-type');
        var srcInput = $('[data-verb-panel] [data-vp-field="source"]');
        if (srcInput) {
          srcInput.placeholder = type === 'image' ? 'Image URL\u2026'
            : type === 'url' ? 'URL\u2026'
            : type === 'brand' ? 'Brand slug (stripe / linear)\u2026'
            : 'Click to select node';
          if (type === 'node') srcInput.style.display = 'none';
          else srcInput.style.display = '';
        }
      });
    });
  }

  // ── Brush verb panel (macro list) ──────────────────
  async function handleBrushEnter() {
    // Fetch available macros from the project.
    var macros = [];
    try {
      var res = await api('/platform/api/intent/list');
      // Actually macros aren't in the intent list — they're in the project.
      // For now: hardcode common + allow custom input.
    } catch (_) {}
    var commonMacros = ['brutalize', 'darkmode', 'soften', 'appleify', 'linearize'];
    var listHtml = '<div class="macro-list">' +
      commonMacros.map(function(m) {
        return '<button class="macro-item" data-macro-name="' + escape(m) + '">' +
          escape(m) +
          '<span class="macro-ops">preset</span>' +
        '</button>';
      }).join('') +
    '</div>' +
    '<input class="pin-input" type="text" placeholder="Or type a custom macro name\u2026" data-vp-field="custom-macro">';
    showVerbPanel('Brush', listHtml, function(panel) {
      var customInput = panel.querySelector('[data-vp-field="custom-macro"]');
      var macro = customInput ? customInput.value.trim() : '';
      if (!macro) return;
      var anchors = new Set();
      if (state.selection.inode) anchors.add(state.selection.inode);
      enterMode({ kind: 'brush', macro: macro, anchors: anchors, active: false });
    });
    // Click a macro-item → fill custom input + auto-submit.
    $$('[data-verb-panel] .macro-item').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var name = btn.getAttribute('data-macro-name');
        if (!name) return;
        closeVerbPanel();
        var anchors = new Set();
        if (state.selection.inode) anchors.add(state.selection.inode);
        enterMode({ kind: 'brush', macro: name, anchors: anchors, active: false });
      });
    });
  }

  // ── Resonance (already has its own panel — keep it) ──
  function handleResonanceEnter() {
    var seed = state.selection.inode;
    enterMode({
      kind: 'resonance',
      seed: seed,
      axes: new Set(['role', 'style']),
      matches: [],
    });
    recomputeResonance();
    showResonancePanel();
  }

  // ── Time (deferred to Phase H: timeline scrubber) ──
  function handleTime() {
    flash('Use the timeline scrubber in the bottom bar');
  }

  // ── Submode state machine ────────────────────────────
  // Modes are entered via chip click (or keyboard) and drive subsequent
  // clicks on the preview until a completion condition fires (second
  // click, Enter, or Escape). They're the rich-gesture layer — one level
  // above "prompt for everything".

  function enterMode(mode) {
    state.mode = mode;
    showBanner();
    hideChipBar();
    // Gesture modes need pointer events on the SVG overlay.
    const svg = $('.viewport-frame .annotations');
    if (svg && (mode.kind === 'lasso' || mode.kind === 'brush' || mode.kind === 'drag-live')) {
      svg.classList.add('gesture-active');
    }
  }

  function exitMode(reason) {
    state.mode = null;
    hideBanner();
    // Clean up any in-progress gesture artifacts.
    clearLassoPath();
    clearDragGhost();
    clearResonancePreview();
    const svgGroup = $('.annotation-marks-svg');
    if (svgGroup) {
      svgGroup.querySelectorAll('.brush-preview').forEach(function(el) { el.remove(); });
    }
    const svg = $('.viewport-frame .annotations');
    if (svg) svg.classList.remove('gesture-active');
    // Hide resonance panel if we were in that mode.
    const resoPanel = $('.resonance-panel');
    if (resoPanel) resoPanel.remove();
    if (reason === 'cancelled') flash('Cancelled', 'error');
  }

  function showBanner() {
    const bar = $('.mode-banner');
    if (!bar || !state.mode) return;
    bar.innerHTML = bannerContent(state.mode);
    bar.classList.add('show');
  }

  function hideBanner() {
    const bar = $('.mode-banner');
    if (bar) bar.classList.remove('show');
  }

  function updateBanner() {
    const bar = $('.mode-banner');
    if (!bar || !state.mode) return;
    bar.innerHTML = bannerContent(state.mode);
  }

  function bannerContent(mode) {
    switch (mode.kind) {
      case 'echo': {
        const step = mode.source ? 'Click the TARGET node' : 'Click the SOURCE node';
        return '<span class="label">Echo</span><span class="hint">' + step + '</span><span class="counter">Esc to cancel</span>';
      }
      case 'drag-live': {
        return '<span class="label">Drag</span><span class="hint">Press and drag to move · drop on target</span><span class="counter">Esc to cancel</span>';
      }
      case 'lasso': {
        const count = lassoContainedAnchors(mode.polygon || []).length;
        return '<span class="label">Lasso</span><span class="hint">Draw around nodes · release to select</span><span class="counter">' + count + ' inside</span>';
      }
      case 'brush': {
        const count = mode.anchors ? mode.anchors.size : 0;
        return '<span class="label">Brush: ' + escape(mode.macro) + '</span><span class="hint">Drag across nodes · Enter to submit</span><span class="counter">' + count + '</span>';
      }
      case 'resonance': {
        return '<span class="label">Resonance</span><span class="hint">Pick axes in the panel · Apply to submit</span><span class="counter">' + (mode.matches || []).length + ' matches</span>';
      }
      case 'pin-pick': {
        return '<span class="label">Pin</span><span class="hint">Click a source node to reference</span><span class="counter">Esc to cancel</span>';
      }
      case 're-anchor': {
        return '<span class="label">Re-anchor</span><span class="hint">Click a new anchor node</span><span class="counter">Esc to cancel</span>';
      }
      default:
        return '<span class="label">Mode</span>';
    }
  }

  async function handleModeClick(data) {
    const m = state.mode;
    if (!m) return;
    const inode = data.inode;
    if (!inode) return;

    if (m.kind === 'echo') {
      if (!m.source) {
        m.source = inode;
        updateBanner();
        return;
      }
      // Second click = target → show axis picker panel.
      var fromA = m.source;
      var toA = inode;
      exitMode();
      handleEchoAxis(fromA, toA);
      return;
    }

    // Lasso / brush / drag-live are handled by the SVG pointer substrate,
    // not by iframe click bubbling. Those modes intentionally ignore
    // handleModeClick.
    if (m.kind === 'lasso' || m.kind === 'brush' || m.kind === 'drag-live') {
      return;
    }

    if (m.kind === 'pin-pick') {
      var pinTarget = m.target;
      var pinSource = inode;
      exitMode();
      // Show inline aspect picker via VerbPanel.
      var axes = ['style', 'structure', 'all'];
      showVerbPanel('Pin (node ref)',
        '<div class="echo-step">Reference <strong>' + escape(String(pinSource).slice(-8)) + '</strong> on <strong>' + escape(String(pinTarget).slice(-8)) + '</strong></div>' +
        '<div class="echo-axes">' +
          axes.map(function(ax, i) {
            return '<button class="echo-axis' + (i === 0 ? ' active' : '') + '" data-axis="' + escape(ax) + '">' + escape(ax) + '</button>';
          }).join('') +
        '</div>',
        function(panel) {
          var activeAxis = panel.querySelector('.echo-axis.active');
          var aspect = activeAxis ? activeAxis.getAttribute('data-axis') : 'style';
          submitGesture({
            kind: 'pin',
            at: new Date().toISOString(),
            sceneSlug: state.currentSceneSlug,
            author: { kind: 'human', id: 'platform-ui' },
            anchor: pinTarget,
            reference: { type: 'node', anchor: pinSource, aspect: aspect },
          });
        }
      );
      $$('[data-verb-panel] .echo-axis').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          $$('[data-verb-panel] .echo-axis').forEach(function(b) { b.classList.remove('active'); });
          btn.classList.add('active');
        });
      });
      return;
    }

    if (m.kind === 're-anchor') {
      const annotationId = m.annotationId;
      exitMode();
      try {
        await api('/platform/api/annotations/re-anchor', {
          annotationId: annotationId,
          newAnchor: inode,
        });
        flash('Re-anchored → active', 'success');
        refreshOrphans();
      } catch (_) {}
      return;
    }
  }

  async function commitMode() {
    const m = state.mode;
    if (!m) return;
    if (m.kind === 'lasso') {
      const anchors = lassoContainedAnchors(m.polygon || []);
      if (anchors.length === 0) { exitMode(); return; }
      const snapshot = anchors.slice();
      const polySnap = (m.polygon || []).slice();
      exitMode();
      await submitGesture({
        kind: 'lasso',
        at: new Date().toISOString(),
        sceneSlug: state.currentSceneSlug,
        author: { kind: 'human', id: 'platform-ui' },
        points: polySnap.map(function(p) { return [p[0], p[1]]; }),
        containedAnchors: snapshot,
      });
      return;
    }
    if (m.kind === 'brush') {
      const arr = Array.from(m.anchors || []);
      if (arr.length === 0) { exitMode(); return; }
      const macro = m.macro;
      exitMode();
      await submitGesture({
        kind: 'brush',
        at: new Date().toISOString(),
        sceneSlug: state.currentSceneSlug,
        author: { kind: 'human', id: 'platform-ui' },
        anchors: arr,
        macro: macro,
      });
      return;
    }
    if (m.kind === 'resonance') {
      const matches = m.matches || [];
      const axes = Array.from(m.axes || []);
      const seed = m.seed;
      exitMode();
      if (!seed || matches.length === 0) {
        flash('No matches — try fewer axes', 'error');
        return;
      }
      await submitGesture({
        kind: 'resonance',
        at: new Date().toISOString(),
        sceneSlug: state.currentSceneSlug,
        author: { kind: 'human', id: 'platform-ui' },
        seed: seed,
        axes: axes,
        matches: matches,
      });
      return;
    }
    exitMode();
  }

  // ════════════════════════════════════════════════════════
  // Phase 8.7+ — Persistent annotation rendering
  // ════════════════════════════════════════════════════════

  // ── Geometry helpers (mirror of packages/core/src/gestures/geometry.ts) ──
  function pointInPolygon(x, y, polygon) {
    if (!polygon || polygon.length < 3) return false;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0], yi = polygon[i][1];
      const xj = polygon[j][0], yj = polygon[j][1];
      const intersect = ((yi > y) !== (yj > y)) &&
        (x < ((xj - xi) * (y - yi)) / ((yj - yi) + 1e-9) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function bboxCenterInPolygon(bbox, polygon) {
    return pointInPolygon(bbox.x + bbox.w / 2, bbox.y + bbox.h / 2, polygon);
  }

  function pointInBBox(x, y, b) {
    return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
  }

  function hitTestInnermost(x, y) {
    let best = null;
    let bestArea = Infinity;
    state.measurements.forEach(function(m) {
      const b = m.bbox;
      if (!pointInBBox(x, y, b)) return;
      const area = b.w * b.h;
      if (area > 0 && area < bestArea) { best = m.inode; bestArea = area; }
    });
    return best;
  }

  function lassoContainedAnchors(polygon) {
    const out = [];
    state.measurements.forEach(function(m) {
      if (bboxCenterInPolygon(m.bbox, polygon)) out.push(m.inode);
    });
    return out;
  }

  function matchesResonanceAxes(seed, cand, axes) {
    for (let i = 0; i < axes.length; i++) {
      const ax = axes[i];
      if (ax === 'tag' && seed.tag !== cand.tag) return false;
      if (ax === 'class' && (seed.className || '') !== (cand.className || '')) return false;
      if (ax === 'role' && (seed.role || '') !== (cand.role || '')) return false;
      if (ax === 'style') {
        const s = seed.style || {}, c = cand.style || {};
        if (s.bg !== c.bg || s.fs !== c.fs || s.fw !== c.fw) return false;
      }
      if (ax === 'content' && (seed.text || '') !== (cand.text || '')) return false;
      if (ax === 'position') {
        const s = seed.style || {}, c = cand.style || {};
        if (s.display !== c.display) return false;
        const ws = seed.bbox.w, wc = cand.bbox.w;
        if (ws === 0 || wc === 0) { if (ws !== wc) return false; }
        else {
          const ratio = Math.abs(ws - wc) / Math.max(ws, wc);
          if (ratio > 0.05) return false;
        }
      }
    }
    return true;
  }

  // Screen-space coordinate conversion: iframe-doc units → frame pixels.
  function bboxToScreen(bbox) {
    const dims = VIEWPORT_DIMS[state.currentViewport];
    const frame = $('.viewport-frame');
    if (!frame) return { left: 0, top: 0, width: 0, height: 0 };
    const sx = frame.clientWidth / dims.w;
    const sy = frame.clientHeight / dims.h;
    return {
      left: bbox.x * sx,
      top: bbox.y * sy,
      width: bbox.w * sx,
      height: bbox.h * sy,
    };
  }

  // Convert pointer event to iframe-doc coords over the SVG overlay.
  function svgCoordsFromEvent(e) {
    const svg = $('.viewport-frame .annotations');
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const dims = VIEWPORT_DIMS[state.currentViewport];
    return {
      x: ((e.clientX - rect.left) / rect.width) * dims.w,
      y: ((e.clientY - rect.top) / rect.height) * dims.h,
    };
  }

  // ── Annotation fetch ──────────────────────────────────
  async function refreshAnnotations() {
    if (!state.currentSceneSlug) return;
    try {
      const res = await api('/platform/api/annotations/list?status=active&sceneSlug=' +
        encodeURIComponent(state.currentSceneSlug));
      state.annotations = res.annotations || [];
      renderAllAnnotations();
    } catch (_) {}
  }

  // ── Renderer entry point — dispatches per kind ──────
  function renderAllAnnotations() {
    const svgGroup = $('.annotation-marks-svg');
    const htmlLayer = $('.annotation-marks-html');
    if (!svgGroup && !htmlLayer) return;
    const svgParts = [];
    const htmlParts = [];
    for (let i = 0; i < state.annotations.length; i++) {
      const ann = state.annotations[i];
      const p = ann.payload;
      if (!p) continue;
      switch (p.kind) {
        case 'comment':           renderCommentMark(ann, svgParts, htmlParts); break;
        case 'pin':               renderPinMark(ann, svgParts, htmlParts); break;
        case 'rule':              renderRuleMark(ann, svgParts, htmlParts); break;
        case 'echo-arrow':        renderEchoArrow(ann, svgParts, htmlParts); break;
        case 'region':            renderRegionMark(ann, svgParts, htmlParts); break;
        case 'brush-stroke':      renderBrushStrokeMark(ann, svgParts, htmlParts); break;
        case 'reference':         renderReferenceMark(ann, svgParts, htmlParts); break;
        case 'resonance-overlay': renderResonanceOverlayMark(ann, svgParts, htmlParts); break;
        case 'ghost-proposal':    renderGhostProposal(ann, svgParts, htmlParts); break;
      }
    }
    if (svgGroup) svgGroup.innerHTML = svgParts.join('');
    if (htmlLayer) {
      htmlLayer.innerHTML = htmlParts.join('');
      bindMarkInteractions();
    }
  }

  function getBBox(inode) {
    const m = state.measurements.get(inode);
    return m ? m.bbox : null;
  }

  // ── Per-kind renderers ────────────────────────────────
  // Build the meta line shown inside any tooltip: author + relative time.
  function tooltipMeta(ann) {
    const authorKind = (ann.author && ann.author.kind) || 'human';
    const authorName = (ann.author && ann.author.id) || authorKind;
    const rel = formatRelativeTime(ann.createdAt);
    return '<span class="tip-meta">' + escape(authorName) + ' · ' + escape(rel) + '</span>';
  }

  // Normalized author class for mark styling (ring color, hue tint).
  function authorClass(ann) {
    const kind = (ann.author && ann.author.kind) || 'human';
    return 'author-' + kind;
  }

  function renderCommentMark(ann, svgOut, htmlOut) {
    const bbox = getBBox(ann.anchor);
    if (!bbox) return;
    const scr = bboxToScreen(bbox);
    const left = scr.left + scr.width - 6;
    const top = scr.top - 6;
    const text = escape((ann.payload.text || '').slice(0, 120));
    htmlOut.push(
      '<div class="mark mark-comment ' + authorClass(ann) + '" data-ann="' + escape(ann.id) + '" tabindex="0" style="left:' + left + 'px;top:' + top + 'px">' +
        '<div class="mark-dot comment"></div>' +
        '<div class="mark-tooltip">' + text + tooltipMeta(ann) + '</div>' +
      '</div>'
    );
  }

  function renderPinMark(ann, svgOut, htmlOut) {
    const bbox = getBBox(ann.anchor);
    if (!bbox) return;
    const scr = bboxToScreen(bbox);
    const style = ann.payload.style || 'default';
    const left = scr.left + scr.width - 6;
    const top = scr.top - 6;
    const note = escape((ann.payload.note || 'pin').slice(0, 120));
    htmlOut.push(
      '<div class="mark mark-pin mark-style-' + escape(style) + ' ' + authorClass(ann) + '" data-ann="' + escape(ann.id) + '" tabindex="0" style="left:' + left + 'px;top:' + top + 'px">' +
        '<div class="mark-diamond"></div>' +
        '<div class="mark-tooltip">' + note + tooltipMeta(ann) + '</div>' +
      '</div>'
    );
  }

  function renderRuleMark(ann, svgOut, htmlOut) {
    const bbox = getBBox(ann.anchor);
    if (!bbox) return;
    const scr = bboxToScreen(bbox);
    const enforced = !!ann.payload.enforced;
    const rule = escape(ann.payload.rule || '');
    const value = ann.payload.value !== undefined ? ' = ' + escape(String(ann.payload.value)) : '';
    const left = scr.left + 4;
    const top = scr.top - 10;
    htmlOut.push(
      '<div class="mark mark-rule ' + (enforced ? 'enforced' : 'oneshot') + ' ' + authorClass(ann) + '" data-ann="' + escape(ann.id) + '" tabindex="0" style="left:' + left + 'px;top:' + top + 'px">' +
        '<div class="mark-shield">§</div>' +
        '<div class="mark-tooltip">' + rule + value + (enforced ? ' · enforced' : '') + tooltipMeta(ann) + '</div>' +
      '</div>'
    );
  }

  function renderEchoArrow(ann, svgOut, htmlOut) {
    const from = getBBox(ann.payload.fromAnchor);
    const to = getBBox(ann.payload.toAnchor);
    if (!from || !to) return;
    const x1 = from.x + from.w / 2;
    const y1 = from.y + from.h / 2;
    const x2 = to.x + to.w / 2;
    const y2 = to.y + to.h / 2;
    // Quadratic curve for a bit of arc — more legible than a straight line.
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2 - 40;
    svgOut.push(
      '<g class="mark-echo" data-ann="' + escape(ann.id) + '">' +
        '<path d="M' + x1 + ',' + y1 + ' Q' + mx + ',' + my + ' ' + x2 + ',' + y2 + '" fill="none" />' +
        '<circle cx="' + x2 + '" cy="' + y2 + '" r="6" />' +
      '</g>'
    );
    const scr = bboxToScreen({ x: mx - 30, y: my - 8, w: 60, h: 16 });
    htmlOut.push(
      '<div class="mark mark-echo-label" data-ann="' + escape(ann.id) + '" style="left:' + scr.left + 'px;top:' + scr.top + 'px">' +
        'Echo · ' + escape(ann.payload.axis || '') +
      '</div>'
    );
  }

  function renderRegionMark(ann, svgOut, htmlOut) {
    const points = ann.payload.points || [];
    if (points.length < 3) return;
    const pointsStr = points.map(function(p) { return p[0] + ',' + p[1]; }).join(' ');
    svgOut.push(
      '<polygon class="mark-region" data-ann="' + escape(ann.id) + '" points="' + pointsStr + '" />'
    );
  }

  function renderBrushStrokeMark(ann, svgOut, htmlOut) {
    const anchors = ann.payload.anchors || [];
    if (anchors.length === 0) return;
    // Outline each hit node + connect centers with thin line.
    let outlines = '';
    let path = '';
    let first = true;
    for (let i = 0; i < anchors.length; i++) {
      const b = getBBox(anchors[i]);
      if (!b) continue;
      outlines += '<rect x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h + '" rx="2" />';
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      path += (first ? 'M' : 'L') + cx + ',' + cy + ' ';
      first = false;
    }
    svgOut.push(
      '<g class="mark-brush" data-ann="' + escape(ann.id) + '">' +
        outlines +
        (path ? '<path d="' + path + '" fill="none" />' : '') +
      '</g>'
    );
  }

  function renderReferenceMark(ann, svgOut, htmlOut) {
    const bbox = getBBox(ann.anchor);
    if (!bbox) return;
    const scr = bboxToScreen(bbox);
    const src = ann.payload.source || {};
    const type = src.type || '?';
    const summary = type === 'brand' ? src.brand
                  : type === 'url'   ? src.url
                  : type === 'image' ? (src.url || 'image')
                  : type === 'node'  ? (src.anchor || '').slice(-8)
                  : '';
    const left = scr.left + 2;
    const top = scr.top + 2;
    htmlOut.push(
      '<div class="mark mark-reference ' + authorClass(ann) + '" data-ann="' + escape(ann.id) + '" tabindex="0" style="left:' + left + 'px;top:' + top + 'px">' +
        '<div class="mark-ref-tag">' + escape(type) + '</div>' +
        '<div class="mark-tooltip">' + escape(String(summary)) + tooltipMeta(ann) + '</div>' +
      '</div>'
    );
  }

  function renderResonanceOverlayMark(ann, svgOut, htmlOut) {
    const matches = ann.payload.matches || [];
    for (let i = 0; i < matches.length; i++) {
      const b = getBBox(matches[i]);
      if (!b) continue;
      svgOut.push(
        '<rect class="mark-resonance-match" x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h + '" rx="2" />'
      );
    }
    const seed = getBBox(ann.payload.seed);
    if (seed) {
      svgOut.push(
        '<rect class="mark-resonance-seed" x="' + seed.x + '" y="' + seed.y + '" width="' + seed.w + '" height="' + seed.h + '" rx="2" />'
      );
    }
  }

  function renderGhostProposal(ann, svgOut, htmlOut) {
    const bbox = getBBox(ann.anchor);
    if (!bbox) return;
    const scr = bboxToScreen(bbox);
    const changes = ann.payload.changes || [];

    // SVG layer — the "ghost" breathing outline on the target + any
    // geometric diffs (move arrow, before/after rects, text strike-through).
    svgOut.push(
      '<rect class="mark-ghost" data-ann="' + escape(ann.id) + '" x="' + bbox.x + '" y="' + bbox.y + '" width="' + bbox.w + '" height="' + bbox.h + '" rx="3" />'
    );

    // Render each DiffChange on the SVG when it has a geometric dimension.
    for (let i = 0; i < changes.length; i++) {
      const c = changes[i];
      if (c.kind === 'move') {
        // Draw a dashed outline at the ORIGIN position + an arrow to the
        // TARGET position. The origin box uses the current bbox (the
        // node hasn't moved yet) and the target is origin + delta.
        const ox = bbox.x + (c.from.x - c.to.x);
        const oy = bbox.y + (c.from.y - c.to.y);
        svgOut.push(
          '<rect class="diff-origin" x="' + ox + '" y="' + oy + '" width="' + bbox.w + '" height="' + bbox.h + '" rx="3" />' +
          '<line class="diff-arrow" x1="' + (ox + bbox.w / 2) + '" y1="' + (oy + bbox.h / 2) + '" x2="' + (bbox.x + bbox.w / 2) + '" y2="' + (bbox.y + bbox.h / 2) + '" />'
        );
      } else if (c.kind === 'resize') {
        // Dashed outline at the OLD dimensions, centered on the same origin.
        svgOut.push(
          '<rect class="diff-origin" x="' + bbox.x + '" y="' + bbox.y + '" width="' + c.from.w + '" height="' + c.from.h + '" rx="3" />'
        );
      }
    }

    // HTML panel — floating Accept/Dismiss bar + typed diff chips.
    const left = scr.left + scr.width + 8;
    const top = scr.top;
    const summary = escape((ann.payload.summary || '').slice(0, 80));
    const intentId = escape(ann.payload.intentId || '');
    const chips = changes.length > 0 ? renderDiffChips(changes) : '';
    htmlOut.push(
      '<div class="mark mark-ghost-panel" data-ann="' + escape(ann.id) + '" data-intent="' + intentId + '" style="left:' + left + 'px;top:' + top + 'px">' +
        '<div class="ghost-summary">' + summary + '</div>' +
        chips +
        '<div class="ghost-actions">' +
          '<button class="btn btn-primary btn-sm" data-ghost-action="accept" data-ann="' + escape(ann.id) + '" data-intent="' + intentId + '">Accept</button>' +
          '<button class="btn btn-ghost btn-sm" data-ghost-action="dismiss" data-ann="' + escape(ann.id) + '">Dismiss</button>' +
        '</div>' +
      '</div>'
    );
  }

  // Render DiffChange[] as inline chips inside the ghost panel.
  function renderDiffChips(changes) {
    if (!changes || changes.length === 0) return '';
    const parts = [];
    for (let i = 0; i < changes.length; i++) {
      const c = changes[i];
      if (c.kind === 'color') {
        parts.push(
          '<div class="diff-chip diff-color">' +
            '<span class="diff-prop">' + escape(c.property || 'color') + '</span>' +
            '<span class="diff-swatch" style="background:' + escape(c.from) + '"></span>' +
            '<span class="diff-arrow-glyph">→</span>' +
            '<span class="diff-swatch" style="background:' + escape(c.to) + '"></span>' +
          '</div>'
        );
      } else if (c.kind === 'text') {
        parts.push(
          '<div class="diff-chip diff-text">' +
            '<span class="diff-from">' + escape(String(c.from || '').slice(0, 40)) + '</span>' +
            '<span class="diff-arrow-glyph">→</span>' +
            '<span class="diff-to">' + escape(String(c.to || '').slice(0, 40)) + '</span>' +
          '</div>'
        );
      } else if (c.kind === 'move') {
        const dx = Math.round(c.to.x - c.from.x);
        const dy = Math.round(c.to.y - c.from.y);
        parts.push(
          '<div class="diff-chip diff-move">' +
            '<span class="diff-prop">move</span>' +
            '<span class="diff-vector">' + (dx >= 0 ? '+' : '') + dx + ', ' + (dy >= 0 ? '+' : '') + dy + '</span>' +
          '</div>'
        );
      } else if (c.kind === 'resize') {
        parts.push(
          '<div class="diff-chip diff-resize">' +
            '<span class="diff-prop">resize</span>' +
            '<span class="diff-from">' + Math.round(c.from.w) + '×' + Math.round(c.from.h) + '</span>' +
            '<span class="diff-arrow-glyph">→</span>' +
            '<span class="diff-to">' + Math.round(c.to.w) + '×' + Math.round(c.to.h) + '</span>' +
          '</div>'
        );
      } else if (c.kind === 'style') {
        parts.push(
          '<div class="diff-chip diff-style">' +
            '<span class="diff-prop">' + escape(c.property) + '</span>' +
            '<span class="diff-from">' + escape(String(c.from).slice(0, 24)) + '</span>' +
            '<span class="diff-arrow-glyph">→</span>' +
            '<span class="diff-to">' + escape(String(c.to).slice(0, 24)) + '</span>' +
          '</div>'
        );
      } else if (c.kind === 'replace') {
        parts.push('<div class="diff-chip diff-replace">' + escape(c.summary) + '</div>');
      } else {
        parts.push('<div class="diff-chip diff-unknown">' + escape(c.kind || '?') + '</div>');
      }
    }
    return '<div class="diff-chips">' + parts.join('') + '</div>';
  }

  function bindMarkInteractions() {
    // Click a mark → scroll the stream to its thread (via annotation id).
    $$('.annotation-marks-html .mark[data-ann]').forEach(function(el) {
      el.addEventListener('click', function(e) {
        if (e.target && e.target.tagName === 'BUTTON') return;
        const id = el.getAttribute('data-ann');
        if (!id) return;
        scrollStreamTo(id);
      });
    });
    // Ghost accept / dismiss buttons.
    $$('.mark-ghost-panel button[data-ghost-action]').forEach(function(btn) {
      btn.addEventListener('click', async function(e) {
        e.stopPropagation();
        const action = btn.getAttribute('data-ghost-action');
        const annId = btn.getAttribute('data-ann');
        const intentId = btn.getAttribute('data-intent');
        if (action === 'accept' && intentId) {
          try {
            await api('/platform/api/intent/accept', { intentId: intentId });
            await api('/platform/api/annotate-transition', { annotationId: annId, toStatus: 'dismissed' });
            flash('Proposal accepted', 'success');
            refreshStream();
            refreshAnnotations();
          } catch (_) {}
        } else if (action === 'dismiss' && annId) {
          try {
            await api('/platform/api/annotate-transition', { annotationId: annId, toStatus: 'dismissed' });
            refreshAnnotations();
          } catch (_) {}
        }
      });
    });
  }

  function scrollStreamTo(annId) {
    // Find the annotation, resolve its thread, open thread panel.
    const ann = state.annotations.find(function(a) { return a.id === annId; });
    if (!ann || !ann.threadId) { flash('No thread for this mark', 'error'); return; }
    openThreadPanel(ann.threadId);
  }

  // ════════════════════════════════════════════════════════
  // Thread detail panel
  // ════════════════════════════════════════════════════════

  async function openThreadPanel(threadId) {
    try {
      const data = await api('/platform/api/threads/get?id=' + encodeURIComponent(threadId));
      if (!data.ok || !data.thread) { flash('Thread not found', 'error'); return; }
      renderThreadPanel(data);
      const panel = $('[data-thread-panel]');
      if (panel) panel.classList.remove('hidden');
      const stream = $('.stream');
      if (stream) stream.style.display = 'none';
    } catch (_) {}
  }

  function closeThreadPanel() {
    const panel = $('[data-thread-panel]');
    if (panel) panel.classList.add('hidden');
    const stream = $('.stream');
    if (stream) stream.style.display = '';
  }

  function renderThreadPanel(data) {
    const panel = $('[data-thread-panel]');
    if (!panel) return;
    const t = data.thread;
    const intents = data.intents || [];
    const annotations = data.annotations || [];

    // Title: prefer explicit thread title, then anchor, then thread id.
    const titleEl = panel.querySelector('[data-field="title"]');
    if (titleEl) titleEl.textContent = t.title || ('@' + (t.anchor || '')) || t.id;

    const metaEl = panel.querySelector('[data-field="meta"]');
    if (metaEl) {
      metaEl.innerHTML =
        '<span class="status-tag ' + escape(t.status) + '">' + escape(t.status.toUpperCase()) + '</span>' +
        escape(t.anchor || '') +
        (t.sceneSlug ? ' · ' + escape(t.sceneSlug) : '') +
        ' · ' + escape(formatRelativeTime(t.updatedAt));
    }

    // Merge intents + annotations into a single chronological event list.
    const events = [];
    for (let i = 0; i < intents.length; i++) {
      const it = intents[i];
      events.push({ at: it.createdAt, kind: 'intent', author: it.author || { kind: 'human' }, data: it });
    }
    for (let i = 0; i < annotations.length; i++) {
      const a = annotations[i];
      events.push({ at: a.createdAt, kind: 'annotation', author: a.author || { kind: 'human' }, data: a });
    }
    events.sort(function(x, y) { return x.at < y.at ? -1 : x.at > y.at ? 1 : 0; });

    const bodyEl = panel.querySelector('[data-field="body"]');
    if (bodyEl) {
      if (events.length === 0) {
        bodyEl.innerHTML =
          '<div class="thread-event">' +
            '<div class="event-body muted">Empty thread.</div>' +
          '</div>';
      } else {
        bodyEl.innerHTML = events.map(renderThreadEvent).join('');
      }
    }

    // Thread-level actions
    const actionsEl = panel.querySelector('[data-field="actions"]');
    if (actionsEl) {
      const canResolve = t.status === 'active';
      const canReopen = t.status === 'resolved' || t.status === 'orphaned';
      const canArchive = t.status !== 'archived';
      actionsEl.innerHTML =
        (canResolve ? '<button class="btn btn-primary btn-sm" data-thread-action="resolve" data-id="' + escape(t.id) + '">Resolve</button>' : '') +
        (canReopen ? '<button class="btn btn-secondary btn-sm" data-thread-action="reopen" data-id="' + escape(t.id) + '">Reopen</button>' : '') +
        (canArchive ? '<button class="btn btn-ghost btn-sm" data-thread-action="archive" data-id="' + escape(t.id) + '">Archive</button>' : '');
      actionsEl.querySelectorAll('button[data-thread-action]').forEach(function(btn) {
        btn.addEventListener('click', async function() {
          const action = btn.getAttribute('data-thread-action');
          const id = btn.getAttribute('data-id');
          if (!id || !action) return;
          const toStatus = action === 'resolve' ? 'resolved'
                         : action === 'reopen'  ? 'active'
                         : action === 'archive' ? 'archived'
                         : null;
          if (!toStatus) return;
          try {
            await api('/platform/api/threads/transition', {
              threadId: id,
              toStatus: toStatus,
              resolution: action === 'resolve' ? 'resolved by user' : undefined,
            });
            flash('Thread ' + action + 'd', 'success');
            // Refresh the thread detail view with new state + refresh stream.
            openThreadPanel(id);
            refreshStream();
            refreshAnnotations();
          } catch (_) {}
        });
      });
    }

    // Bind close button
    const closeBtn = panel.querySelector('.close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', closeThreadPanel);
    }
  }

  function renderThreadEvent(ev) {
    const authorKind = (ev.author && ev.author.kind) || 'human';
    const authorName = (ev.author && ev.author.id) || authorKind;
    const time = formatRelativeTime(ev.at);
    let kindTag = '';
    let body = '';
    if (ev.kind === 'intent') {
      const it = ev.data;
      kindTag = 'intent · ' + escape(String(it.status));
      const parts = (it.parts || []).map(function(p) { return escape(describePart(p)); }).join(' · ');
      body = parts || '<span class="muted">(empty)</span>';
    } else {
      const a = ev.data;
      kindTag = 'annotation · ' + escape(String(a.payload.kind));
      body = escape(describeAnnotationPayload(a.payload));
    }
    const accentLeft = ev.kind === 'annotation' && ev.data.payload && ev.data.payload.kind === 'ghost-proposal';
    return '<div class="thread-event' + (accentLeft ? ' accent-left' : '') + '">' +
      '<div class="event-head">' +
        '<span class="author ' + escape(authorKind) + '">' + escape(authorName) + '</span>' +
        '<span class="kind-tag">' + kindTag + '</span>' +
        '<span class="time">' + escape(time) + '</span>' +
      '</div>' +
      '<div class="event-body">' + body + '</div>' +
    '</div>';
  }

  function describeAnnotationPayload(p) {
    if (!p) return '';
    switch (p.kind) {
      case 'comment':           return '"' + (p.text || '') + '"';
      case 'pin':               return 'pinned' + (p.note ? ': ' + p.note : '');
      case 'echo-arrow':        return 'echo ' + (p.fromAnchor || '?') + ' → ' + (p.toAnchor || '?') + ' (axis: ' + (p.axis || '?') + ')';
      case 'region':            return 'region · ' + ((p.anchors || []).length) + ' nodes';
      case 'brush-stroke':      return 'brush "' + (p.macro || '') + '" over ' + ((p.anchors || []).length) + ' nodes';
      case 'reference':         return 'reference ' + (p.source ? p.source.type + ': ' + (p.source.brand || p.source.url || p.source.anchor || '?') : '?');
      case 'rule':              return 'rule "' + (p.rule || '') + '"' + (p.value !== undefined ? ' = ' + JSON.stringify(p.value) : '') + (p.enforced ? ' (enforced)' : '');
      case 'ghost-proposal':    return 'proposal: ' + (p.summary || '');
      case 'resonance-overlay': return 'resonance · ' + ((p.matches || []).length) + ' matches along [' + ((p.axes || []).join(',')) + ']';
      default: return p.kind;
    }
  }

  function formatRelativeTime(iso) {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    if (isNaN(then)) return '';
    const diff = Date.now() - then;
    const s = Math.floor(diff / 1000);
    if (s < 5) return 'just now';
    if (s < 60) return s + 's ago';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    const d = Math.floor(h / 24);
    if (d < 7) return d + 'd ago';
    return iso.slice(0, 10);
  }

  // ════════════════════════════════════════════════════════
  // Phase 8.9 — Rich pointer substrate for Lasso / Brush / Drag
  // ════════════════════════════════════════════════════════

  function bindGesturePointerSubstrate() {
    const svg = $('.viewport-frame .annotations');
    if (!svg) return;
    svg.addEventListener('pointerdown', onSubstrateDown);
    svg.addEventListener('pointermove', onSubstrateMove);
    svg.addEventListener('pointerup', onSubstrateUp);
    svg.addEventListener('pointercancel', onSubstrateUp);
  }

  function onSubstrateDown(e) {
    if (!state.editMode) return;
    var m = state.mode;
    // Canvas drag disabled — section reorder is handled via Sections panel.
    // Direct canvas manipulation (M key → drag) still available for advanced use.
    if (!m) return;
    if (m.kind === 'lasso' || m.kind === 'brush' || m.kind === 'drag-live') {
      e.preventDefault();
      const p = svgCoordsFromEvent(e);
      if (m.kind === 'lasso') {
        m.polygon = [[p.x, p.y]];
        m.active = true;
        drawLassoPath(m.polygon);
      } else if (m.kind === 'brush') {
        m.active = true;
        if (!m.anchors) m.anchors = new Set();
        const hit = hitTestInnermost(p.x, p.y);
        if (hit) m.anchors.add(hit);
        drawBrushHighlights(m);
        updateBanner();
      } else if (m.kind === 'drag-live') {
        m.origin = p;
        m.delta = { dx: 0, dy: 0 };
        m.active = true;
        drawDragGhost(m);
      }
      try { e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId); } catch (_) {}
    }
  }

  function onSubstrateMove(e) {
    const m = state.mode;
    if (!m || !m.active) return;
    const p = svgCoordsFromEvent(e);
    if (m.kind === 'lasso') {
      // Only append if pointer moved enough — avoids 1000-point polygons.
      const last = m.polygon[m.polygon.length - 1];
      const dx = p.x - last[0], dy = p.y - last[1];
      if (dx * dx + dy * dy > 64) {
        m.polygon.push([p.x, p.y]);
        drawLassoPath(m.polygon);
      }
    } else if (m.kind === 'brush') {
      const hit = hitTestInnermost(p.x, p.y);
      if (hit && !m.anchors.has(hit)) {
        m.anchors.add(hit);
        drawBrushHighlights(m);
        updateBanner();
      }
    } else if (m.kind === 'drag-live') {
      m.delta = { dx: p.x - m.origin.x, dy: p.y - m.origin.y };
      drawDragGhost(m);
    }
  }

  async function onSubstrateUp(e) {
    const m = state.mode;
    if (!m || !m.active) return;
    if (m.kind === 'lasso') {
      clearLassoPath();
      // Auto-close + auto-commit at pointerup.
      await commitMode();
    } else if (m.kind === 'brush') {
      m.active = false;
      // Don't auto-commit brush — user may want multiple strokes before
      // Enter. Banner instructs "Enter to submit".
    } else if (m.kind === 'drag-live') {
      clearDragGhost();
      var dx = m.delta.dx;
      var dy = m.delta.dy;
      var source = m.source;
      var origBbox = m.origBbox || { x: 0, y: 0 };
      exitMode();
      // Only apply if actually moved (> 2px threshold)
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        var frame = $('.viewport-frame');
        var sessionId = frame ? frame.getAttribute('data-session') : null;
        if (sessionId) {
          try {
            // Move by updating x/y position
            var newX = Math.round(origBbox.x + dx);
            var newY = Math.round(origBbox.y + dy);
            await api('/platform/api/node/edit', {
              sceneId: sessionId,
              nodeId: source,
              props: { x: String(newX), y: String(newY) },
            });
            requestRemeasure();
          } catch (_) {
            flash('Move failed', 'error');
          }
        }
      }
    }
  }

  function drawLassoPath(polygon) {
    const svgGroup = $('.annotation-marks-svg');
    if (!svgGroup) return;
    // Strip any existing in-progress lasso preview before redrawing.
    const existing = svgGroup.querySelector('.lasso-preview');
    if (existing) existing.remove();
    if (polygon.length < 2) return;
    const d = polygon.map(function(p, i) { return (i === 0 ? 'M' : 'L') + p[0] + ',' + p[1]; }).join(' ');
    const preview = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    preview.setAttribute('class', 'lasso-preview');
    preview.setAttribute('d', d + ' Z');
    preview.setAttribute('fill', 'none');
    svgGroup.appendChild(preview);
  }

  function clearLassoPath() {
    const svgGroup = $('.annotation-marks-svg');
    if (!svgGroup) return;
    const existing = svgGroup.querySelector('.lasso-preview');
    if (existing) existing.remove();
  }

  function drawBrushHighlights(mode) {
    const svgGroup = $('.annotation-marks-svg');
    if (!svgGroup) return;
    // Remove in-progress brush preview before redrawing.
    const existing = svgGroup.querySelectorAll('.brush-preview');
    existing.forEach(function(el) { el.remove(); });
    mode.anchors.forEach(function(inode) {
      const b = getBBox(inode);
      if (!b) return;
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('class', 'brush-preview');
      rect.setAttribute('x', b.x);
      rect.setAttribute('y', b.y);
      rect.setAttribute('width', b.w);
      rect.setAttribute('height', b.h);
      rect.setAttribute('rx', '2');
      svgGroup.appendChild(rect);
    });
  }

  function drawDragGhost(mode) {
    const svgGroup = $('.annotation-marks-svg');
    if (!svgGroup) return;
    const existing = svgGroup.querySelector('.drag-ghost');
    if (existing) existing.remove();
    const b = getBBox(mode.source);
    if (!b) return;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('class', 'drag-ghost');
    rect.setAttribute('x', b.x + mode.delta.dx);
    rect.setAttribute('y', b.y + mode.delta.dy);
    rect.setAttribute('width', b.w);
    rect.setAttribute('height', b.h);
    rect.setAttribute('rx', '2');
    svgGroup.appendChild(rect);
  }

  function clearDragGhost() {
    const svgGroup = $('.annotation-marks-svg');
    if (!svgGroup) return;
    const existing = svgGroup.querySelector('.drag-ghost');
    if (existing) existing.remove();
  }

  // ════════════════════════════════════════════════════════
  // Phase 8.10 — Resonance live matching
  // ════════════════════════════════════════════════════════

  function recomputeResonance() {
    const m = state.mode;
    if (!m || m.kind !== 'resonance') return;
    const seed = state.measurements.get(m.seed);
    if (!seed) { m.matches = []; return; }
    const axes = Array.from(m.axes || []);
    const matches = [];
    state.measurements.forEach(function(cand) {
      if (cand.inode === m.seed) return;
      if (matchesResonanceAxes(seed, cand, axes)) matches.push(cand.inode);
    });
    m.matches = matches;
    drawResonancePreview(seed, matches);
    updateResonancePanel();
  }

  function drawResonancePreview(seed, matches) {
    const svgGroup = $('.annotation-marks-svg');
    if (!svgGroup) return;
    svgGroup.querySelectorAll('.resonance-preview').forEach(function(el) { el.remove(); });
    // Seed outline
    const seedRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    seedRect.setAttribute('class', 'resonance-preview resonance-seed');
    seedRect.setAttribute('x', seed.bbox.x);
    seedRect.setAttribute('y', seed.bbox.y);
    seedRect.setAttribute('width', seed.bbox.w);
    seedRect.setAttribute('height', seed.bbox.h);
    seedRect.setAttribute('rx', '2');
    svgGroup.appendChild(seedRect);
    // Match tints
    for (let i = 0; i < matches.length; i++) {
      const m = state.measurements.get(matches[i]);
      if (!m) continue;
      const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      r.setAttribute('class', 'resonance-preview resonance-match');
      r.setAttribute('x', m.bbox.x);
      r.setAttribute('y', m.bbox.y);
      r.setAttribute('width', m.bbox.w);
      r.setAttribute('height', m.bbox.h);
      r.setAttribute('rx', '2');
      svgGroup.appendChild(r);
    }
  }

  function clearResonancePreview() {
    const svgGroup = $('.annotation-marks-svg');
    if (!svgGroup) return;
    svgGroup.querySelectorAll('.resonance-preview').forEach(function(el) { el.remove(); });
  }

  function showResonancePanel() {
    const frame = $('.viewport-frame');
    if (!frame) return;
    let panel = $('.resonance-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'resonance-panel';
      frame.appendChild(panel);
    }
    panel.classList.add('show');
    updateResonancePanel();
  }

  function updateResonancePanel() {
    const panel = $('.resonance-panel');
    const m = state.mode;
    if (!panel || !m || m.kind !== 'resonance') return;
    const axisList = ['tag', 'class', 'role', 'style', 'content', 'position'];
    const checkboxes = axisList.map(function(ax) {
      const on = m.axes.has(ax);
      return '<label class="ax-chip' + (on ? ' on' : '') + '">' +
        '<input type="checkbox" data-axis="' + ax + '"' + (on ? ' checked' : '') + '>' +
        ax + '</label>';
    }).join('');
    panel.innerHTML =
      '<div class="panel-head">Resonance<span class="count">' + (m.matches || []).length + ' matches</span></div>' +
      '<div class="axes">' + checkboxes + '</div>' +
      '<div class="panel-actions">' +
        '<button class="btn btn-primary btn-sm" data-reso-action="commit">Apply</button>' +
        '<button class="btn btn-ghost btn-sm" data-reso-action="cancel">Cancel</button>' +
      '</div>';
    panel.querySelectorAll('input[data-axis]').forEach(function(input) {
      input.addEventListener('change', function() {
        const ax = input.getAttribute('data-axis');
        if (input.checked) m.axes.add(ax); else m.axes.delete(ax);
        recomputeResonance();
      });
    });
    panel.querySelectorAll('button[data-reso-action]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const action = btn.getAttribute('data-reso-action');
        if (action === 'commit') { commitMode(); hideResonancePanel(); }
        else { exitMode('cancelled'); hideResonancePanel(); }
      });
    });
  }

  function hideResonancePanel() {
    const panel = $('.resonance-panel');
    if (panel) panel.remove();
    clearResonancePreview();
  }

  async function submitGesture(gesture) {
    try {
      const result = await api('/platform/api/gesture', { gesture: gesture });
      if (result && result.ok) {
        const parts = [gesture.kind];
        if (result.annotation) parts.push('annotation:' + result.annotation.kind);
        if (result.intent) parts.push('intent:queued');
        flash(parts.join(' → '), 'success');
        refreshStream();
      }
    } catch (_) {}
  }

  // ── Activity stream ──────────────────────────────────
  async function refreshStream() {
    const listEl = $('.stream-list');
    const headMeta = $('.stream-head .meta');
    if (!listEl) return;
    try {
      const data = await api('/platform/api/intent/list');
      const intents = data.intents || [];
      // Parallel: fetch orphaned annotations so the strip surfaces them.
      let orphanedHtml = '';
      try {
        const ann = await api('/platform/api/annotations/list?status=orphaned' +
          (state.currentSceneSlug ? '&sceneSlug=' + encodeURIComponent(state.currentSceneSlug) : ''));
        orphanedHtml = renderOrphanStrip(ann.annotations || []);
      } catch (_) {}
      listEl.innerHTML = orphanedHtml + renderStreamContent(intents);
      bindStreamActions();
      bindOrphanActions();
      if (headMeta) {
        var aiIntents = intents.filter(function(i) { return !isMechanicalIntent(i); });
        const sceneName = headMeta.firstChild ? headMeta.firstChild.textContent.split(' · ')[0] : 'this scene';
        headMeta.textContent = sceneName + ' · ' + aiIntents.length + (aiIntents.length === 1 ? ' item' : ' items');
      }
    } catch (_) {}
  }

  // Orphaned annotations get a dedicated strip at the top of the stream
  // because they are **events requiring user decision** — not mere history.
  function renderOrphanStrip(orphans) {
    if (!orphans || orphans.length === 0) return '';
    const items = orphans.map(function(o) {
      const reason = o.orphanedReason || 'anchor removed';
      const kind = o.payload ? o.payload.kind : '?';
      const preview = describePayloadShort(o.payload);
      return '<div class="orphan-item">' +
        '<span class="kind">' + escape(kind) + '</span>' +
        '<span class="body">' + escape(preview) + ' — ' + escape(reason) + '</span>' +
        '<button class="btn btn-secondary btn-sm" data-orphan-action="re-anchor" data-id="' + escape(o.id) + '">Re-anchor</button>' +
        '<button class="btn btn-ghost btn-sm" data-orphan-action="dismiss" data-id="' + escape(o.id) + '">Dismiss</button>' +
      '</div>';
    }).join('');
    return '<div class="orphan-strip">' +
      '<div class="title">Orphaned markers (' + orphans.length + ')</div>' +
      items +
      '</div>';
  }

  function describePayloadShort(p) {
    if (!p) return '';
    switch (p.kind) {
      case 'comment':           return '"' + (p.text || '').slice(0, 40) + '"';
      case 'pin':               return 'pin' + (p.note ? ': ' + p.note.slice(0, 30) : '');
      case 'echo-arrow':        return 'echo ' + (p.axis || '');
      case 'region':            return 'region ' + ((p.anchors || []).length) + ' nodes';
      case 'brush-stroke':      return 'brush ' + (p.macro || '');
      case 'reference':         return 'ref ' + (p.source ? p.source.type : '?');
      case 'rule':              return 'rule: ' + (p.rule || '');
      case 'ghost-proposal':    return 'ghost: ' + (p.summary || '').slice(0, 40);
      case 'resonance-overlay': return 'resonance ' + ((p.matches || []).length) + ' matches';
      default: return p.kind;
    }
  }

  function bindOrphanActions() {
    $$('.orphan-item button[data-orphan-action]').forEach(function(btn) {
      btn.addEventListener('click', async function(e) {
        e.stopPropagation();
        const action = btn.getAttribute('data-orphan-action');
        const id = btn.getAttribute('data-id');
        if (!id) return;
        if (action === 're-anchor') {
          // Enter re-anchor mode: next click on preview picks the new anchor.
          enterMode({ kind: 're-anchor', annotationId: id });
          flash('Click a new anchor node in the preview', 'success');
        } else if (action === 'dismiss') {
          try {
            await api('/platform/api/annotate-transition', {
              annotationId: id,
              toStatus: 'dismissed',
              reason: 'user dismissed orphan',
            });
            flash('Dismissed', 'success');
            refreshStream();
            refreshAnnotations();
          } catch (_) {}
        }
      });
    });
  }

  async function refreshOrphans() {
    // Trigger a stream refresh which re-renders the orphan strip.
    refreshStream();
  }

  // Mechanical intent kinds that should not clutter the activity stream.
  var MECHANICAL_KINDS = { move: 1, select: 1 };

  function isMechanicalIntent(intent) {
    var parts = intent.parts || [];
    if (parts.length === 0) return false;
    for (var i = 0; i < parts.length; i++) {
      if (!MECHANICAL_KINDS[parts[i].kind]) return false;
    }
    return true;
  }

  function renderStreamContent(intents) {
    // Filter out mechanical operations (move/resize) — only show AI-relevant intents.
    var filtered = intents.filter(function(i) { return !isMechanicalIntent(i); });
    if (!filtered.length) {
      return '<div class="stream-empty">' +
        '<div class="headline">No activity yet.</div>' +
        '<div class="body">Tell the agent what to do, or ask about a node in the preview.</div>' +
        '</div>';
    }
    return filtered.map(renderStreamCard).join('');
  }

  function renderStreamCard(intent) {
    const id = escape(String(intent.id || ''));
    const status = String(intent.status || 'draft');
    const partsDesc = (intent.parts || []).map(describePart).filter(Boolean).slice(0, 4).join(' · ');
    return '<div class="stream-card ' + status + '" data-id="' + id + '">' +
      '<div class="head">' +
        '<span>' + statusTitle(status) + '</span>' +
        '<span class="id">' + escape(String(intent.id || '').slice(-8)) + '</span>' +
      '</div>' +
      (partsDesc ? '<div class="body">' + escape(partsDesc) + '</div>' : '') +
      (cardActions(intent) ? '<div class="actions">' + cardActions(intent) + '</div>' : '') +
    '</div>';
  }

  function statusTitle(s) {
    return ({
      draft: 'Draft intent',
      queued: 'Queued',
      processing: 'Agent thinking…',
      proposed: 'Proposal — review',
      accepted: 'Accepted',
      rejected: 'Rejected',
      refined: 'Refined',
      archived: 'Archived',
    })[s] || s;
  }

  function cardActions(intent) {
    const id = escape(String(intent.id || ''));
    if (intent.status === 'draft') {
      return '<button class="btn btn-primary btn-sm" data-action="commit" data-id="' + id + '">Commit</button>' +
             '<button class="btn btn-ghost btn-sm" data-action="discard" data-id="' + id + '">Discard</button>';
    }
    if (intent.status === 'proposed') {
      return '<button class="btn btn-primary btn-sm" data-action="accept" data-id="' + id + '">Accept</button>' +
             '<button class="btn btn-ghost btn-sm" data-action="reject" data-id="' + id + '">Reject</button>';
    }
    if (intent.status === 'queued') {
      return '<button class="btn btn-secondary btn-sm" data-action="process" data-id="' + id + '">Process</button>';
    }
    return '';
  }

  function describePart(p) {
    if (!p) return '';
    switch (p.kind) {
      case 'select':      return (p.nodes || []).length + ' node(s)';
      case 'text':        return '"' + (p.value || '').slice(0, 40) + '"';
      case 'annotate':    return p.shape + ' (' + ((p.points || []).length) + 'pts)';
      case 'ref-brand':   return 'brand: ' + p.brand;
      case 'ref-image':   return 'image';
      case 'ref-node':    return 'ref-node ' + (p.nodeId || '').slice(-8);
      case 'apply-macro': return 'macro: ' + p.macro;
      case 'direction':   return p.value;
      case 'degree':      return p.value;
      case 'preserve':    return 'keep: ' + (p.keys || []).join(',');
      case 'constraint':  return 'rule: ' + p.rule;
      case 'move':        return p.delta ? 'move ' + p.delta.dx + ',' + p.delta.dy : 'move';
      case 'undo':        return 'undo ' + p.steps + ' step(s)';
      case 'query':       return 'query: ' + (p.selector || '').slice(0, 40);
      default:            return p.kind;
    }
  }

  function bindStreamActions() {
    $$('.stream-card button[data-action]').forEach(function(btn) {
      btn.addEventListener('click', async function(e) {
        e.stopPropagation();
        const action = btn.getAttribute('data-action');
        const id = btn.getAttribute('data-id');
        if (!action || !id) return;
        try {
          if (action === 'commit') {
            await api('/platform/api/intent/commit', { intentId: id });
          } else if (action === 'discard') {
            await api('/platform/api/intent/reject', { intentId: id, reason: 'discarded' });
          } else if (action === 'accept') {
            await api('/platform/api/intent/accept', { intentId: id });
          } else if (action === 'reject') {
            await api('/platform/api/intent/reject', { intentId: id, reason: 'user rejected' });
          } else if (action === 'process') {
            await api('/platform/api/intent/mark-processing', { intentId: id });
          }
          refreshStream();
        } catch (_) {}
      });
    });
  }

  // ── Macro apply buttons (macros page) ────────────────
  // ── Brand picker in global toolbar ─────────────────────────────────
  function bindBrandPicker() {
    var pickerBtn = $('[data-brand-picker-btn]');
    var pickerMenu = $('[data-brand-picker-menu]');
    if (!pickerBtn || !pickerMenu) return;

    pickerBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      var isHidden = pickerMenu.classList.contains('hidden');
      pickerMenu.classList.toggle('hidden');
      if (isHidden) {
        // Fetch brands
        fetch('/platform/api/brands')
          .then(function(r) { return r.json(); })
          .then(function(data) {
            var brands = data.brands || data || [];
            if (!Array.isArray(brands)) brands = [];
            var items = brands.map(function(b) {
              var name = typeof b === 'string' ? b : b.name || b.slug || '';
              return '<button class="brand-picker-item" style="display:block;width:100%;text-align:left;padding:8px 12px;border:none;background:transparent;border-radius:6px;cursor:pointer;font-size:13px;color:var(--text-base);font-family:var(--sans)" data-brand-apply="' + name + '">' + name + '</button>';
            }).join('');
            if (items) {
              pickerMenu.innerHTML = '<div style="padding:4px 8px;font-size:10px;font-weight:500;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em">Apply brand</div>' + items;
              pickerMenu.querySelectorAll('[data-brand-apply]').forEach(function(btn) {
                btn.addEventListener('click', function() {
                  var brand = btn.getAttribute('data-brand-apply');
                  pickerMenu.classList.add('hidden');
                  // Apply brand via rebrand API
                  var sid = state.currentSceneId || document.querySelector('[data-session]')?.getAttribute('data-session');
                  if (!sid || !brand) return;
                  var label = $('[data-brand-picker-label]');
                  if (label) label.textContent = brand;
                  fetch('/platform/api/rebrand/apply', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sceneId: sid, brand: brand })
                  }).then(function() {
                    // Refresh preview
                    var iframe = document.querySelector('.viewport-frame iframe');
                    if (iframe) iframe.src = iframe.src.split('?')[0] + '?t=' + Date.now();
                  });
                });
              });
            }
          })
          .catch(function() {});
      }
    });

    // Close on outside click
    document.addEventListener('click', function() { pickerMenu.classList.add('hidden'); });
  }

  // ── Command Palette (Cmd+K) ────────────────────────────────────────
  var commandPaletteEl = null;

  function toggleCommandPalette() {
    if (commandPaletteEl) {
      commandPaletteEl.remove();
      commandPaletteEl = null;
      return;
    }

    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding-top:20vh;backdrop-filter:blur(4px)';
    overlay.addEventListener('click', function(e) { if (e.target === overlay) { overlay.remove(); commandPaletteEl = null; } });

    var palette = document.createElement('div');
    palette.style.cssText = 'width:560px;background:var(--surface-elevated);border:1px solid var(--border);border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,0.2);overflow:hidden';

    var input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Type a command...';
    input.style.cssText = 'width:100%;padding:16px 20px;border:none;outline:none;background:transparent;font-size:16px;color:var(--text-base);font-family:var(--sans)';
    input.setAttribute('autofocus', '');

    var results = document.createElement('div');
    results.style.cssText = 'max-height:320px;overflow-y:auto;padding:8px';

    var commands = [
      { icon: '\uD83C\uDFA8', label: 'Design from scratch', desc: 'AI writes full page from your brief', action: function() { var btn = document.querySelector('[data-kind="describe"]'); if(btn) btn.click(); } },
      { icon: '\uD83E\uDDF1', label: 'Build from blocks', desc: 'Pick sections from block library', action: function() { window.location.href = '/platform/blocks'; } },
      { icon: '\uD83D\uDD04', label: 'Rebrand', desc: 'Paste HTML, apply any brand', action: function() { var btn = document.querySelector('[data-kind="html"]'); if(btn) btn.click(); } },
      { icon: '\uD83D\uDCCA', label: 'Quality audit', desc: 'Check design quality (37 rules + 8 metrics)', action: function() { var tab = document.querySelector('[data-tab="quality"]'); if(tab) tab.click(); } },
      { icon: '\uD83D\uDCE6', label: 'Batch export', desc: 'N brands \u00D7 M viewports \u00D7 K formats', action: function() { window.location.href = '/platform/batch'; } },
      { icon: '\uD83C\uDFAD', label: 'Switch brand', desc: 'Apply a different brand to this design', action: function() { var tab = document.querySelector('[data-tab="rebrand"]'); if(tab) tab.click(); } },
      { icon: '\uD83C\uDFB2', label: 'Generate variants', desc: 'Density \u00D7 Radius \u00D7 Shadows grid', action: function() { var tab = document.querySelector('[data-tab="vary"]'); if(tab) tab.click(); } },
      { icon: '\u2B07\uFE0F', label: 'Export HTML', desc: 'Static HTML with inline styles', action: function() { var btn = document.querySelector('[data-format="html"]'); if(btn) btn.click(); } },
      { icon: '\uD83D\uDDBC\uFE0F', label: 'Export PNG', desc: 'Raster image via CanvasKit', action: function() { var btn = document.querySelector('[data-format="png"]'); if(btn) btn.click(); } },
      { icon: '\uD83D\uDCC4', label: 'Export PDF', desc: 'Print-ready PDF document', action: function() { var btn = document.querySelector('[data-format="pdf"]'); if(btn) btn.click(); } },
      { icon: '\u269B\uFE0F', label: 'Export React', desc: 'TSX with TypeScript annotations', action: function() { var btn = document.querySelector('[data-format="react"]'); if(btn) btn.click(); } },
      { icon: '\uD83C\uDF10', label: 'Export Site', desc: 'Multi-page app with routing', action: function() { var btn = document.querySelector('[data-format="site"]'); if(btn) btn.click(); } },
      { icon: '\uD83D\uDD11', label: 'Tokens', desc: 'View/export design tokens (DTCG)', action: function() { var tab = document.querySelector('[data-tab="tokens"]'); if(tab) tab.click(); } },
      { icon: '\uD83D\uDD0C', label: 'API docs', desc: 'Headless render API reference', action: function() { window.location.href = '/platform/api-docs'; } },
    ];

    function renderResults(filter) {
      var q = (filter || '').toLowerCase();
      var filtered = q ? commands.filter(function(c) { return c.label.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q); }) : commands;
      results.innerHTML = filtered.map(function(cmd, i) {
        return '<div class="cmd-item" data-cmd-idx="' + commands.indexOf(cmd) + '" style="display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:8px;cursor:pointer;transition:background 0.1s' + (i === 0 ? ';background:var(--surface-sunken)' : '') + '">'
          + '<span style="font-size:18px;width:24px;text-align:center">' + cmd.icon + '</span>'
          + '<div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:500;color:var(--text-base)">' + cmd.label + '</div>'
          + '<div style="font-size:12px;color:var(--text-muted)">' + cmd.desc + '</div></div>'
          + '</div>';
      }).join('');

      results.querySelectorAll('.cmd-item').forEach(function(item) {
        item.addEventListener('click', function() {
          var idx = parseInt(item.getAttribute('data-cmd-idx') || '0');
          overlay.remove();
          commandPaletteEl = null;
          if (commands[idx]) commands[idx].action();
        });
        item.addEventListener('mouseenter', function() {
          results.querySelectorAll('.cmd-item').forEach(function(i) { i.style.background = 'transparent'; });
          item.style.background = 'var(--surface-sunken)';
        });
      });
    }

    input.addEventListener('input', function() { renderResults(input.value); });
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') { overlay.remove(); commandPaletteEl = null; }
      if (e.key === 'Enter') {
        var active = results.querySelector('.cmd-item[style*="surface-sunken"]') || results.querySelector('.cmd-item');
        if (active) active.click();
      }
    });

    palette.appendChild(input);
    palette.appendChild(results);
    overlay.appendChild(palette);
    document.body.appendChild(overlay);
    commandPaletteEl = overlay;
    renderResults('');
    setTimeout(function() { input.focus(); }, 50);
  }

  // ── Variant strip: show scene variants as thumbnails below preview ──
  function bindVariantStrip() {
    var strip = $('[data-variant-strip]');
    var items = $('[data-variant-items]');
    if (!strip || !items) return;

    // Fetch quality score for a scene (cached per session)
    var qualityCache = {};
    function getQuality(sceneId, cb) {
      if (qualityCache[sceneId] !== undefined) { cb(qualityCache[sceneId]); return; }
      fetch('/platform/api/aesthetic/' + sceneId)
        .then(function(r) { return r.json(); })
        .then(function(data) {
          var score = data.ok ? data.overall : null;
          qualityCache[sceneId] = score;
          cb(score);
        })
        .catch(function() { qualityCache[sceneId] = null; cb(null); });
    }

    function qualityColor(score) {
      if (score === null || score === undefined) return 'var(--text-muted)';
      if (score >= 80) return '#22c55e';
      if (score >= 60) return '#eab308';
      if (score >= 30) return '#f97316';
      return '#ef4444';
    }

    // Fetch all scenes and populate variant strip
    function refreshVariantStrip() {
      fetch('/api/scenes')
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (!data.scenes || data.scenes.length < 2) {
            strip.style.display = 'none';
            return;
          }
          strip.style.display = 'block';

          var currentSession = state.currentSceneId || document.querySelector('[data-session]')?.getAttribute('data-session');

          items.innerHTML = data.scenes.map(function(scene) {
            var isActive = scene.id === currentSession;
            return '<div class="variant-card' + (isActive ? ' variant-active' : '') + '" data-variant-scene="' + scene.id + '" style="'
              + 'display:inline-flex;flex-direction:column;gap:6px;padding:6px;border-radius:8px;cursor:pointer;min-width:140px;flex-shrink:0;'
              + 'border:2px solid ' + (isActive ? 'var(--accent)' : 'transparent') + ';'
              + 'background:' + (isActive ? 'rgba(var(--accent-rgb,0,113,227),0.06)' : 'var(--surface)') + ';'
              + 'transition:all 0.15s">'
              + '<div style="width:136px;height:80px;border-radius:4px;overflow:hidden;background:var(--surface-sunken);position:relative">'
              + '<img src="/thumbnail/' + scene.id + '.png?scale=1" loading="lazy" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display=&quot;none&quot;">'
              + '<span class="variant-quality-badge" data-vq-scene="' + scene.id + '" style="position:absolute;top:4px;right:4px;padding:2px 6px;border-radius:4px;background:rgba(0,0,0,0.6);color:#fff;font-size:10px;font-weight:600;font-family:var(--mono);display:none"></span>'
              + '</div>'
              + '<div style="font-size:11px;font-weight:500;color:var(--text-base);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:136px">' + (scene.name || scene.id) + '</div>'
              + '<div style="font-size:10px;color:var(--text-muted)">' + (scene.size || '') + ' \u00B7 ' + (scene.nodes || '?') + ' nodes</div>'
              + '</div>';
          }).join('');

          // Fetch quality scores for each variant
          data.scenes.forEach(function(scene) {
            getQuality(scene.id, function(score) {
              var badge = document.querySelector('[data-vq-scene="' + scene.id + '"]');
              if (badge && score !== null) {
                badge.textContent = score + '%';
                badge.style.display = 'block';
                badge.style.color = qualityColor(score);
              }
            });
          });

          // Click handler: switch main preview to clicked variant
          items.querySelectorAll('[data-variant-scene]').forEach(function(card) {
            card.addEventListener('click', function() {
              var sceneId = card.getAttribute('data-variant-scene');
              if (!sceneId) return;
              var iframe = document.querySelector('.viewport-frame iframe');
              if (iframe) iframe.src = '/preview/' + sceneId + '?t=' + Date.now();
              items.querySelectorAll('.variant-card').forEach(function(c) {
                c.style.border = '2px solid transparent';
                c.style.background = 'var(--surface)';
                c.classList.remove('variant-active');
              });
              card.style.border = '2px solid var(--accent)';
              card.style.background = 'rgba(var(--accent-rgb,0,113,227),0.06)';
              card.classList.add('variant-active');
              state.currentSceneId = sceneId;
              // Update floating quality badge for new active scene
              refreshQualityBadge(sceneId);
            });
          });

          // Populate floating quality badge for current scene
          if (currentSession) refreshQualityBadge(currentSession);
        })
        .catch(function() { strip.style.display = 'none'; });
    }

    // Floating quality badge on the viewport
    function refreshQualityBadge(sceneId) {
      var badge = $('[data-quality-badge]');
      if (!badge) return;
      getQuality(sceneId, function(score) {
        if (score !== null) {
          badge.querySelector('[data-quality-badge-score]').textContent = score + '% Quality';
          badge.style.display = 'block';
          badge.style.background = 'rgba(0,0,0,0.75)';
          badge.style.color = qualityColor(score);
        } else {
          badge.style.display = 'none';
        }
      });

      // Click badge → open quality tab
      badge.onclick = function() {
        var tab = document.querySelector('[data-tab="quality"]');
        if (tab) tab.click();
      };
    }

    // Also fetch badge for initial scene on load
    var initSid = state.currentSceneId || document.querySelector('[data-session]')?.getAttribute('data-session');
    if (initSid) {
      setTimeout(function() { refreshQualityBadge(initSid); }, 500);
    }

    refreshVariantStrip();
    var origHandleEvent = handleEvent;
    handleEvent = function(ev) {
      origHandleEvent(ev);
      if (ev.type === 'session:scenes' || ev.type === 'scene:saved' || ev.type === 'scene:deleted') {
        qualityCache = {}; // invalidate on changes
        refreshVariantStrip();
      }
    };
  }

  // ── Pipeline stepper interactivity ──
  function bindPipelineStepper() {
    var steps = $$('.pipeline-step');
    if (steps.length === 0) return;

    steps.forEach(function(step) {
      step.addEventListener('click', function() {
        var target = step.getAttribute('data-step');
        if (!target) return;

        // Update active state
        steps.forEach(function(s) {
          s.style.background = 'transparent';
          s.style.color = 'var(--text-muted)';
          s.classList.remove('active');
        });
        step.style.background = 'var(--accent)';
        step.style.color = 'var(--on-accent)';
        step.classList.add('active');

        // Switch right panel based on step
        var tabMap = {
          generate: 'sections',
          review: 'quality',
          refine: 'rebrand',
          ship: null, // triggers export dropdown
        };

        var tabName = tabMap[target];
        if (tabName) {
          // Click the corresponding right panel tab
          var tab = document.querySelector('[data-tab="' + tabName + '"]');
          if (tab) tab.click();
        }

        if (target === 'ship') {
          // Open export dropdown
          var exportBtn = document.querySelector('[data-export-dropdown] .export-btn');
          if (exportBtn) exportBtn.click();
        }
      });
    });
  }

  function bindBatchExport() {
    var btn = $('[data-batch-generate]');
    if (!btn) return;
    btn.addEventListener('click', function() {
      var scenes = $$('[data-batch-scenes] input:checked').map(function(el) { return el.value; });
      var formats = $$('[data-batch-formats] input:checked').map(function(el) { return el.value; });
      var brands = $$('[data-batch-brands] input:checked').map(function(el) { return el.value; });
      var viewports = $$('[data-batch-viewports] input:checked').map(function(el) {
        return { name: el.value, width: parseInt(el.getAttribute('data-w') || '1440'), height: parseInt(el.getAttribute('data-h') || '900') };
      });

      if (scenes.length === 0 || formats.length === 0) {
        var status = $('[data-batch-status]');
        if (status) status.textContent = 'Select at least one scene and one format.';
        return;
      }

      var statusEl = $('[data-batch-status]');
      if (statusEl) statusEl.textContent = 'Generating...';
      btn.disabled = true;

      // For each scene, call batch API
      var allResults = [];
      var pending = scenes.length;
      scenes.forEach(function(sceneId) {
        var body = JSON.stringify({
          sceneId: sceneId,
          formats: formats,
          brands: brands.length > 0 ? brands : undefined,
          viewports: viewports.length > 0 ? viewports : undefined,
        });
        fetch('/api/render/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.results) allResults = allResults.concat(data.results);
            pending--;
            if (pending <= 0) {
              btn.disabled = false;
              if (statusEl) statusEl.textContent = allResults.length + ' files generated.';
              var resultsEl = $('[data-batch-results]');
              if (resultsEl) {
                resultsEl.innerHTML = allResults.map(function(r) {
                  return '<div>' + (r.brand || '') + ' ' + (r.viewport || '') + ' ' + r.format + ' \u2014 ' + (r.size > 0 ? Math.round(r.size / 1024) + 'KB' : 'ERR') + '</div>';
                }).join('');
              }
            }
          })
          .catch(function() { pending--; });
      });
    });
  }

  function bindMacroApplyBtns() {
    const pageEl = $('[data-macro-current-scene]');
    const sceneSlug = pageEl ? (pageEl.getAttribute('data-macro-current-scene') || null) : null;
    $$('.macro-apply-btn[data-macro]').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        const macro = btn.getAttribute('data-macro');
        if (!macro) return;
        try {
          await api('/platform/api/intent/add', {
            parts: [{ kind: 'apply-macro', macro: macro }],
            sceneSlug: sceneSlug,
          });
          flash('Macro "' + macro + '" queued', 'success');
        } catch (_) {}
      });
    });
  }

  // ── Clear queue button ───────────────────────────────
  function bindStreamClearBtn() {
    const btn = $('.stream-clear-btn[data-action="clear-queue"]');
    if (!btn) return;
    btn.addEventListener('click', async function() {
      if (!confirm('Clear all active intents? Archive is preserved.')) return;
      try {
        await api('/platform/api/intent/clear', {});
        flash('Queue cleared', 'success');
        refreshStream();
      } catch (_) {}
    });
  }

  // ── Stream input ─────────────────────────────────────
  function bindStreamInput() {
    const input = $('.stream-input input');
    if (!input) return;
    input.addEventListener('keydown', async function(e) {
      if (e.key !== 'Enter') return;
      const value = input.value.trim();
      if (!value) return;
      try {
        await api('/platform/api/intent/add', {
          parts: [{ kind: 'text', value: value }],
          sceneSlug: state.currentSceneSlug,
        });
        input.value = '';
        flash('Intent added', 'success');
        refreshStream();
      } catch (_) {}
    });
  }

  // ── Fit original viewport to available space ────────
  function fitOriginalViewport() {
    if (state.currentViewport !== 'original') return;
    var frame = $('.viewport-frame.original');
    if (!frame) return;
    var iframe = frame.querySelector('iframe');
    if (!iframe) return;

    var od = VIEWPORT_DIMS.original;
    // Available space: the .viewport-area parent minus toolbar/label
    var area = frame.parentElement;
    if (!area) return;
    var availW = area.clientWidth - 32; // 16px padding each side
    var availH = window.innerHeight - 240; // header + toolbar + label + margins
    if (availH < 300) availH = 300;

    // Scale to fit both width and height
    var scaleX = availW / od.w;
    var scaleY = availH / od.h;
    var scale = Math.min(scaleX, scaleY, 1); // never upscale

    var frameW = Math.floor(od.w * scale);
    var frameH = Math.floor(od.h * scale);

    frame.style.width = frameW + 'px';
    frame.style.height = frameH + 'px';
    iframe.style.width = od.w + 'px';
    iframe.style.height = od.h + 'px';
    iframe.style.transform = 'scale(' + scale + ')';

    // Update SVG viewBox
    var svg = frame.querySelector('.annotations');
    if (svg) svg.setAttribute('viewBox', '0 0 ' + od.w + ' ' + od.h);
  }

  // ── Viewport switcher with hover-to-preview ─────────
  function bindViewportSwitcher() {
    // Hover preview: hovering a viewport button temporarily resizes the
    // frame via CSS class swap. The transition on .viewport-frame width/
    // height animates the resize smoothly so the user sees content
    // reflow in real time. Leaving hover reverts to the active viewport.
    $$('.vp-btn').forEach(function(btn) {
      btn.addEventListener('mouseenter', function() {
        var vp = btn.getAttribute('data-vp');
        if (!vp || vp === state.currentViewport) return;
        $$('.viewport-frame').forEach(function(frame) {
          frame.classList.remove('original', 'desktop', 'tablet', 'mobile');
          frame.classList.add(vp);
        });
        var svg = $('.viewport-frame .annotations');
        if (svg) {
          var d = VIEWPORT_DIMS[vp] || VIEWPORT_DIMS.desktop;
          svg.setAttribute('viewBox', '0 0 ' + d.w + ' ' + d.h);
        }
      });
      btn.addEventListener('mouseleave', function() {
        // Revert to the actual current viewport.
        $$('.viewport-frame').forEach(function(frame) {
          frame.classList.remove('original', 'desktop', 'tablet', 'mobile');
          frame.classList.add(state.currentViewport);
        });
        var svg = $('.viewport-frame .annotations');
        if (svg) {
          var d = VIEWPORT_DIMS[state.currentViewport];
          svg.setAttribute('viewBox', '0 0 ' + d.w + ' ' + d.h);
        }
      });
    });

    $$('.vp-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const vp = btn.getAttribute('data-vp');
        if (!vp || !VIEWPORT_DIMS[vp]) return;
        state.currentViewport = vp;
        $$('.vp-btn').forEach(function(b) { b.classList.toggle('active', b === btn); });
        $$('.viewport-frame').forEach(function(frame) {
          frame.classList.remove('original', 'desktop', 'tablet', 'mobile');
          frame.classList.add(vp);
        });
        // Update SVG viewBox to match new iframe dims.
        const svg = $('.viewport-frame .annotations');
        if (svg) {
          const d = VIEWPORT_DIMS[vp];
          svg.setAttribute('viewBox', '0 0 ' + d.w + ' ' + d.h);
        }
        clearSelection();
        // Force remeasurement after layout settles — iframe has new dims.
        if (vp === 'original') setTimeout(fitOriginalViewport, 50);
        setTimeout(requestRemeasure, 200);
        // Update label below frame.
        const label = $('.viewport-label');
        if (label) {
          const od = VIEWPORT_DIMS.original;
          const dims = vp === 'original' ? od.w + ' × ' + od.h : vp === 'desktop' ? '1440 × 900' : vp === 'tablet' ? '768 × 1024' : '375 × 812';
          const name = vp.charAt(0).toUpperCase() + vp.slice(1);
          const brandSpan = label.querySelector('.brand');
          const brand = brandSpan ? brandSpan.textContent : 'no brand';
          label.innerHTML =
            '<span>' + name + '</span>' +
            '<span class="sep">·</span>' +
            '<span>' + dims + '</span>' +
            '<span class="sep">·</span>' +
            '<span class="brand">' + escape(brand) + '</span>';
        }
      });
    });
  }

  // ── Empty state launcher (dashboard) ─────────────────
  // ── Resizable panels (sidebar + right panel drag handles) ────
  //
  // Both panel widths are CSS custom properties on .body; we update
  // them in place as the user drags. Values persist to localStorage so
  // a refresh keeps the layout. Min/max clamps live here — design
  // decision, not CSS, so we can show percentages / snapped values in
  // a future polish pass.
  function bindResizablePanels() {
    var body = $('.body');
    if (!body) return;

    var SIDEBAR_MIN = 160;
    var SIDEBAR_MAX = 520;
    var RIGHT_MIN = 240;
    var RIGHT_MAX = 640;

    // Restore saved widths
    try {
      var savedSidebar = localStorage.getItem('reframe.panel.sidebar');
      if (savedSidebar) {
        var sn = parseInt(savedSidebar, 10);
        if (!isNaN(sn) && sn >= SIDEBAR_MIN && sn <= SIDEBAR_MAX) {
          body.style.setProperty('--sidebar-w', sn + 'px');
        }
      }
      var savedRight = localStorage.getItem('reframe.panel.right');
      if (savedRight) {
        var rn = parseInt(savedRight, 10);
        if (!isNaN(rn) && rn >= RIGHT_MIN && rn <= RIGHT_MAX) {
          body.style.setProperty('--right-w', rn + 'px');
        }
      }
    } catch (_) {}

    $$('[data-panel-resize]').forEach(function(handle) {
      var kind = handle.getAttribute('data-panel-resize'); // "sidebar" | "right"
      handle.addEventListener('mousedown', function(e) {
        e.preventDefault();
        handle.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        var startX = e.clientX;
        var rect = body.getBoundingClientRect();
        var computed = getComputedStyle(body);
        var startSidebar = parseFloat(computed.getPropertyValue('--sidebar-w')) || 220;
        var startRight = parseFloat(computed.getPropertyValue('--right-w')) || 340;

        function onMove(mv) {
          var dx = mv.clientX - startX;
          if (kind === 'sidebar') {
            var w = startSidebar + dx;
            if (w < SIDEBAR_MIN) w = SIDEBAR_MIN;
            if (w > SIDEBAR_MAX) w = SIDEBAR_MAX;
            // Also don't let sidebar eat more than ~60% of viewport
            if (w > rect.width * 0.6) w = rect.width * 0.6;
            body.style.setProperty('--sidebar-w', w + 'px');
          } else {
            // Right panel grows when dragging LEFT, so dx is inverted.
            var w2 = startRight - dx;
            if (w2 < RIGHT_MIN) w2 = RIGHT_MIN;
            if (w2 > RIGHT_MAX) w2 = RIGHT_MAX;
            if (w2 > rect.width * 0.6) w2 = rect.width * 0.6;
            body.style.setProperty('--right-w', w2 + 'px');
          }
        }
        function onUp() {
          handle.classList.remove('dragging');
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          // Persist
          try {
            var computed2 = getComputedStyle(body);
            if (kind === 'sidebar') {
              localStorage.setItem('reframe.panel.sidebar', parseFloat(computed2.getPropertyValue('--sidebar-w')) + '');
            } else {
              localStorage.setItem('reframe.panel.right', parseFloat(computed2.getPropertyValue('--right-w')) + '');
            }
          } catch (_) {}
        }
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });

      // Double-click resets to default
      handle.addEventListener('dblclick', function() {
        if (kind === 'sidebar') {
          body.style.removeProperty('--sidebar-w');
          try { localStorage.removeItem('reframe.panel.sidebar'); } catch (_) {}
        } else {
          body.style.removeProperty('--right-w');
          try { localStorage.removeItem('reframe.panel.right'); } catch (_) {}
        }
      });
    });
  }

  // ── Project canvas (pan/zoom surface) ────────────────
  //
  // Figma-style canvas view for /platform/project/:slug. Artboards are
  // absolutely-positioned iframes inside a world div that gets panned
  // and zoomed via a single CSS transform. Interactions:
  //   - wheel               → zoom anchored on cursor
  //   - cmd+wheel / trackpad pinch → also zoom
  //   - space+drag          → pan (Figma convention)
  //   - middle-mouse drag   → pan
  //   - 0                   → fit to screen
  //   - 1                   → actual size (100%)
  //   - +/-                 → zoom step
  //   - Esc                 → back to dashboard
  //
  // Iframes are lazy-loaded via IntersectionObserver: only artboards
  // currently in the visible viewport get their src set. This keeps a
  // 50-variant project viable (otherwise ~3MB of HTML + compositor death).
  function bindCanvas() {
    var viewport = $('[data-canvas-viewport]');
    if (!viewport) return;
    var world = $('[data-canvas-world]');
    if (!world) return;
    // Prefer the new viewport-area.canvas-mode wrapper; fall back to the
    // legacy .canvas-page if some page still uses it.
    var page = viewport.closest('.viewport-area.canvas-mode') || viewport.closest('.canvas-page');
    if (!page) return;
    var contentW = parseFloat(page.getAttribute('data-content-w') || '0') || 1440;
    var contentH = parseFloat(page.getAttribute('data-content-h') || '0') || 900;

    var state = { scale: 1, tx: 0, ty: 0, spaceDown: false, panning: false };
    var MIN_SCALE = 0.05;
    var MAX_SCALE = 3;

    function apply() {
      world.style.transform = 'translate(' + state.tx + 'px,' + state.ty + 'px) scale(' + state.scale + ')';
      var label = $('[data-canvas-zoom-level]');
      if (label) label.textContent = Math.round(state.scale * 100) + '%';
    }

    function clampScale(s) {
      return Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
    }

    // Initial/reset view: show content at 100% native scale, centered
    // horizontally. If the content is taller than the viewport, align
    // the top with a small padding so the user can pan down to see
    // the rest. Never shrink content below 100% by default — user
    // explicitly pressing Fit-to-screen or "0" still calls fitAll().
    function initialView() {
      var vw = viewport.clientWidth;
      var vh = viewport.clientHeight;
      state.scale = 1;
      state.tx = (vw - contentW) / 2;
      if (contentH > vh) {
        state.ty = 40; // top-align with small breathing room
      } else {
        state.ty = (vh - contentH) / 2;
      }
      apply();
    }

    // True fit-to-screen — scales content to fit completely within
    // the viewport. Bound to the zoom "fit" button and the 0 key. Caps
    // at 100% so small content doesn't get scaled up artificially.
    function fitAll() {
      var vw = viewport.clientWidth;
      var vh = viewport.clientHeight;
      var pad = 40;
      var sx = (vw - pad * 2) / contentW;
      var sy = (vh - pad * 2) / contentH;
      state.scale = clampScale(Math.min(sx, sy, 1));
      state.tx = (vw - contentW * state.scale) / 2;
      state.ty = (vh - contentH * state.scale) / 2;
      apply();
    }

    // Back-compat alias — the old name was used widely in this file.
    var fitToScreen = initialView;

    function zoomAtPoint(newScale, px, py) {
      newScale = clampScale(newScale);
      // Keep the point (px, py) in viewport coords fixed under the cursor.
      // world coord = (px - tx) / scale  →  should remain constant
      var worldX = (px - state.tx) / state.scale;
      var worldY = (py - state.ty) / state.scale;
      state.scale = newScale;
      state.tx = px - worldX * state.scale;
      state.ty = py - worldY * state.scale;
      apply();
    }

    // Wheel → zoom (cmd/ctrl+wheel or trackpad pinch recognized as ctrl+wheel)
    viewport.addEventListener('wheel', function(e) {
      e.preventDefault();
      var rect = viewport.getBoundingClientRect();
      var px = e.clientX - rect.left;
      var py = e.clientY - rect.top;
      if (e.ctrlKey || e.metaKey) {
        // Pinch or cmd+wheel — precise zoom
        var delta = -e.deltaY * 0.01;
        zoomAtPoint(state.scale * (1 + delta), px, py);
      } else if (e.shiftKey) {
        // Shift+wheel → horizontal pan
        state.tx -= e.deltaY;
        apply();
      } else {
        // Plain wheel → vertical pan (like a normal scroll surface)
        // — unless you want to also zoom, in which case swap with cmd.
        // Figma defaults to pan on scroll; we follow that.
        state.tx -= e.deltaX;
        state.ty -= e.deltaY;
        apply();
      }
    }, { passive: false });

    // Space-to-pan (Figma convention)
    window.addEventListener('keydown', function(e) {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.code === 'Space' && !state.spaceDown) {
        state.spaceDown = true;
        viewport.classList.add('space-down');
        e.preventDefault();
      } else if (e.key === '0') {
        fitAll();
      } else if (e.key === '1') {
        var rect = viewport.getBoundingClientRect();
        zoomAtPoint(1, rect.width / 2, rect.height / 2);
      } else if (e.key === '+' || e.key === '=') {
        var r = viewport.getBoundingClientRect();
        zoomAtPoint(state.scale * 1.2, r.width / 2, r.height / 2);
      } else if (e.key === '-' || e.key === '_') {
        var r2 = viewport.getBoundingClientRect();
        zoomAtPoint(state.scale / 1.2, r2.width / 2, r2.height / 2);
      } else if (e.key === 'Escape') {
        window.location.href = '/platform';
      }
    });
    window.addEventListener('keyup', function(e) {
      if (e.code === 'Space') {
        state.spaceDown = false;
        viewport.classList.remove('space-down');
      }
    });

    // ── Artboard selection + drag ──────────────────────
    //
    // Figma-style behavior:
    //   · the LABEL BAR above the frame is the drag handle — mousedown
    //     there selects + optionally drags the whole artboard
    //   · the iframe body is fully interactive — clicks/scrolls inside
    //     the scene work naturally, nothing intercepts them
    //   · click on empty canvas → deselect + pan
    //   · space-bar / middle-click → pan regardless
    //   · Escape → deselect
    //
    // No hit overlay, no double-click-to-enter — those proved fiddly.
    // Grabbing the title bar is the one universal Figma convention, and
    // it keeps the scene itself untouched for normal interaction.
    function deselectAll() {
      $$('.canvas-artboard.selected').forEach(function(a) { a.classList.remove('selected'); });
    }

    // Drag to pan OR drag an artboard — decided on mousedown target.
    viewport.addEventListener('mousedown', function(e) {
      if (e.button !== 0 && e.button !== 1) return;

      // Clicks on floating chrome (toolbar buttons, zoom widget) must not
      // start a pan or a selection — let the button handle its own click.
      if (e.target.closest && (
        e.target.closest('.canvas-tools-float') ||
        e.target.closest('.canvas-zoom-float') ||
        e.target.closest('button') ||
        e.target.closest('[data-canvas-action]')
      )) return;

      // Middle-click / space+drag → always pan.
      var forcePan = state.spaceDown || e.button === 1;

      // Label bar = drag handle. Only mousedowns that land on the label
      // start an artboard drag. Clicks on the iframe body pass through to
      // the scene (pointer-events: auto on the iframe).
      var label = e.target.closest && e.target.closest('.canvas-artboard-label');
      var artboard = label ? label.closest('.canvas-artboard') : null;

      // Open-in-isolation link (if any artboard still has one) — let it work.
      if (e.target.closest && e.target.closest('.canvas-artboard-open')) return;

      // ── Pan branch ──
      if (forcePan || !artboard) {
        // Clicking on empty canvas also clears selection.
        if (!artboard && !forcePan) deselectAll();
        e.preventDefault();
        state.panning = true;
        viewport.classList.add('panning');
        var startX = e.clientX;
        var startY = e.clientY;
        var startTx = state.tx;
        var startTy = state.ty;
        function onMovePan(mv) {
          state.tx = startTx + (mv.clientX - startX);
          state.ty = startTy + (mv.clientY - startY);
          apply();
        }
        function onUpPan() {
          state.panning = false;
          viewport.classList.remove('panning');
          window.removeEventListener('mousemove', onMovePan);
          window.removeEventListener('mouseup', onUpPan);
        }
        window.addEventListener('mousemove', onMovePan);
        window.addEventListener('mouseup', onUpPan);
        return;
      }

      // ── Artboard branch (label grab) ──
      e.preventDefault();
      deselectAll();
      artboard.classList.add('selected');

      var startX = e.clientX;
      var startY = e.clientY;
      var startLeft = parseFloat(artboard.style.left || '0') || 0;
      var startTop = parseFloat(artboard.style.top || '0') || 0;
      var moved = false;
      var dragThreshold = 3; // px before we commit to a drag

      function onMoveAb(mv) {
        var dx = mv.clientX - startX;
        var dy = mv.clientY - startY;
        if (!moved && (Math.abs(dx) > dragThreshold || Math.abs(dy) > dragThreshold)) {
          moved = true;
          artboard.classList.add('dragging');
        }
        if (moved) {
          // Screen delta → world delta: divide by current zoom.
          artboard.style.left = (startLeft + dx / state.scale) + 'px';
          artboard.style.top  = (startTop  + dy / state.scale) + 'px';
        }
      }
      function onUpAb() {
        artboard.classList.remove('dragging');
        window.removeEventListener('mousemove', onMoveAb);
        window.removeEventListener('mouseup', onUpAb);
      }
      window.addEventListener('mousemove', onMoveAb);
      window.addEventListener('mouseup', onUpAb);
    });

    // Escape clears current selection (doesn't navigate away — that's
    // the outer keydown handler a few lines up, which still fires if
    // nothing was selected).
    window.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        var anySel = document.querySelector('.canvas-artboard.selected');
        if (anySel) { deselectAll(); e.stopPropagation(); }
      }
    }, true);

    // Toolbar buttons
    $$('[data-canvas-action]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var action = btn.getAttribute('data-canvas-action');
        var rect = viewport.getBoundingClientRect();
        if (action === 'fit') fitAll();
        else if (action === 'zoom-in') zoomAtPoint(state.scale * 1.2, rect.width / 2, rect.height / 2);
        else if (action === 'zoom-out') zoomAtPoint(state.scale / 1.2, rect.width / 2, rect.height / 2);
        else if (action === 'zoom-100') zoomAtPoint(1, rect.width / 2, rect.height / 2);
      });
    });

    // Initial fit — run on next frame so viewport has its real size.
    requestAnimationFrame(fitToScreen);
    window.addEventListener('resize', fitToScreen);

    // After an iframe finishes loading, read the actual rendered content
    // height and resize the artboard wrapper to match. Scene dimensions
    // stored at compile time (1440x1080) are the DECLARED root size,
    // but a full landing page naturally extends beyond that — iframes
    // default to showing scrollbars in the clipped area, which looks
    // like a cropped "window" instead of the whole artboard. Measuring
    // scrollHeight via contentDocument gives us the true height so we
    // can show the scene edge-to-edge.
    function resizeArtboardToContent(iframe, artboard) {
      try {
        var doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
        if (!doc || !doc.body) return;
        // Force the body to NOT scroll — we want natural height to flow
        // out instead of being clipped inside the iframe. Once the body
        // overflows we'll expand the artboard to match.
        try {
          doc.documentElement.style.overflow = 'hidden';
          doc.body.style.overflow = 'hidden';
        } catch (_) {}
        var contentH = Math.max(
          doc.body.scrollHeight,
          doc.documentElement ? doc.documentElement.scrollHeight : 0
        );
        var contentWidth = Math.max(
          doc.body.scrollWidth,
          doc.documentElement ? doc.documentElement.scrollWidth : 0
        );
        var declaredH = parseFloat(artboard.getAttribute('data-artboard-h') || '0') || 0;
        var declaredW = parseFloat(artboard.getAttribute('data-artboard-w') || '0') || 0;
        // Only grow — never shrink below declared (scenes with shorter
        // actual content than declared should keep the declared size).
        if (contentH > declaredH && contentH > 0) {
          artboard.style.height = contentH + 'px';
          // Bump the world content bounds so fitAll accounts for it.
          var newContentH = parseFloat(artboard.style.top || '0') + contentH;
          if (newContentH > contentH) contentH = newContentH;
          if (newContentH > (parseFloat(page.getAttribute('data-content-h') || '0') || 0)) {
            page.setAttribute('data-content-h', String(newContentH));
          }
        }
        if (contentWidth > declaredW && contentWidth > 0) {
          artboard.style.width = contentWidth + 'px';
        }
      } catch (_) {
        // Cross-origin or not-yet-loaded — ignore, fallback to declared dims
      }
    }

    function wireIframeLoad(iframe, artboard) {
      iframe.addEventListener('load', function() {
        resizeArtboardToContent(iframe, artboard);
        // Some browsers compute layout asynchronously — re-measure after
        // the next frame to catch late reflows (fonts, images).
        requestAnimationFrame(function() {
          resizeArtboardToContent(iframe, artboard);
        });
      });
    }

    // Lazy iframe loading via IntersectionObserver. Viewport is the
    // world itself, but IntersectionObserver observes against the
    // viewport element (which is what the user actually sees). We use
    // a rootMargin so artboards just outside the visible area
    // preload, and loaded iframes stay in place (we don't unload
    // them — trading memory for instant re-visits). Each iframe gets
    // a load listener that measures actual content height after
    // render and grows the artboard accordingly.
    if ('IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (!entry.isIntersecting) return;
          var artboard = entry.target;
          var iframe = artboard.querySelector('iframe[data-lazy-src]');
          if (iframe) {
            wireIframeLoad(iframe, artboard);
            iframe.src = iframe.getAttribute('data-lazy-src');
            iframe.removeAttribute('data-lazy-src');
            artboard.classList.add('loaded');
          }
        });
      }, {
        root: viewport,
        rootMargin: '400px',
        threshold: 0,
      });
      $$('.canvas-artboard').forEach(function(a) { observer.observe(a); });
    } else {
      // Fallback — load everything (older browser / non-IO environment)
      $$('.canvas-artboard').forEach(function(artboard) {
        var iframe = artboard.querySelector('iframe[data-lazy-src]');
        if (iframe) {
          wireIframeLoad(iframe, artboard);
          iframe.src = iframe.getAttribute('data-lazy-src');
          iframe.removeAttribute('data-lazy-src');
        }
        artboard.classList.add('loaded');
      });
    }
  }

  // ── Dashboard scenario tabs ──────────────────────────
  // Top-row pills (All / Originals / Variants / Brand rebrands / Drafts)
  // filter the scene grid. Pure client-side — each card has a
  // data-scenarios attribute computed server-side (e.g. all + variants
  // + brands), and we toggle display:none based on which pill is active.
  function bindScenarioTabs() {
    var tabs = $$('.overview-scenario');
    if (tabs.length === 0) return;
    var cards = $$('.overview-grid .overview-card-wrap');
    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        var scenario = tab.getAttribute('data-scenario') || 'all';
        tabs.forEach(function(t) {
          var on = t === tab;
          t.classList.toggle('active', on);
          t.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        cards.forEach(function(card) {
          var scenarios = (card.getAttribute('data-scenarios') || '').split(/\s+/);
          var match = scenario === 'all' || scenarios.indexOf(scenario) !== -1;
          card.style.display = match ? '' : 'none';
        });
      });
    });
  }

  // ── Custom confirm modal ────────────────────────────
  // Replaces native window.confirm() with a themed modal. Returns a
  // Promise so callers can await the user choice. ESC cancels, Enter
  // confirms. Cancel button has focus by default for destructive
  // actions so keyboard users don't accidentally fire them.
  function customConfirm(opts) {
    return new Promise(function(resolve) {
      var backdrop = document.createElement('div');
      backdrop.className = 'confirm-backdrop';
      var isDanger = opts.kind === 'danger';
      backdrop.innerHTML =
        '<div class="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">' +
          '<div class="confirm-icon ' + (isDanger ? 'danger' : '') + '">' +
            (isDanger
              ? '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M5 6l1 14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-14M10 11v6M14 11v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
              : '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.6"/><path d="M12 8v4M12 16h.01" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>') +
          '</div>' +
          '<h2 class="confirm-title" id="confirm-title">' + (opts.title || 'Are you sure?') + '</h2>' +
          (opts.message ? '<p class="confirm-message">' + opts.message + '</p>' : '') +
          '<div class="confirm-actions">' +
            '<button class="confirm-btn confirm-cancel" type="button">' + (opts.cancelText || 'Cancel') + '</button>' +
            '<button class="confirm-btn ' + (isDanger ? 'confirm-danger' : 'confirm-primary') + '" type="button">' + (opts.confirmText || 'Confirm') + '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(backdrop);

      // Trigger the enter-animation on next frame (CSS transitions only
      // fire after the element is in the DOM).
      requestAnimationFrame(function() { backdrop.classList.add('visible'); });

      var cancelBtn = backdrop.querySelector('.confirm-cancel');
      var confirmBtn = backdrop.querySelector('.confirm-btn:not(.confirm-cancel)');

      function cleanup(result) {
        backdrop.classList.remove('visible');
        document.removeEventListener('keydown', onKey);
        setTimeout(function() {
          backdrop.parentNode && backdrop.parentNode.removeChild(backdrop);
        }, 180);
        resolve(result);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); cleanup(false); }
        else if (e.key === 'Enter') { e.preventDefault(); cleanup(true); }
      }
      cancelBtn.addEventListener('click', function() { cleanup(false); });
      confirmBtn.addEventListener('click', function() { cleanup(true); });
      backdrop.addEventListener('click', function(e) {
        if (e.target === backdrop) cleanup(false);
      });
      document.addEventListener('keydown', onKey);
      // Focus cancel by default for destructive actions (safer) — user
      // has to deliberately tab or click to the red button.
      setTimeout(function() { cancelBtn.focus(); }, 0);
    });
  }

  // ── Dashboard: delete project (all variants) ─────────
  function bindOverviewProjectDelete() {
    $$('.overview-grid [data-action="delete-project"]').forEach(function(btn) {
      btn.addEventListener('click', function(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var wrap = btn.closest('.overview-card-wrap');
        if (!wrap) return;
        var projectSlug = wrap.getAttribute('data-project-slug') || '';
        var name = wrap.getAttribute('data-project-name') || 'this project';
        if (!projectSlug) return;

        customConfirm({
          kind: 'danger',
          title: 'Delete project?',
          message: '<strong>' + name + '</strong> and all its variants will be removed \u2014 from the current session and from disk. This cannot be undone.',
          confirmText: 'Delete project',
          cancelText: 'Keep',
        }).then(function(ok) {
          if (!ok) return;

          btn.setAttribute('disabled', 'true');
          btn.style.opacity = '0.5';

          // Fetch the scene list, filter by project grouping, delete each.
          // We compute membership client-side by matching the owner slug
          // and derived variants — simpler to delete from the scene list
          // returned by the server which has the same grouping logic.
          fetch('/scenes').then(function(r) { return r.json(); }).then(function(scenes) {
            // Match members: owner slug == projectSlug, or derived
            // variants share the common prefix of the owner.
            var prefix = projectSlug.split(/[-_]/)[0].toLowerCase();
            var toDelete = scenes.filter(function(s) {
              var slug = (s.slug || '').toLowerCase();
              return slug === projectSlug.toLowerCase() || slug.indexOf(prefix) === 0;
            });
            var deletes = toDelete.map(function(s) {
              return fetch('/scenes/remove', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sceneId: s.id }),
              }).then(function(r) { return r.json(); });
            });
            return Promise.all(deletes);
          }).then(function() {
            wrap.style.transition = 'opacity 160ms, transform 160ms';
            wrap.style.opacity = '0';
            wrap.style.transform = 'scale(0.96)';
            setTimeout(function() {
              wrap.parentNode && wrap.parentNode.removeChild(wrap);
            }, 180);
          }).catch(function(err) {
            btn.removeAttribute('disabled');
            btn.style.opacity = '';
            flash('Delete failed: ' + err, 'error');
          });
        });
      });
    });
  }

  // ── Dashboard: delete scene button ───────────────────
  // Each overview card has a hover-revealed delete button. Clicking it
  // opens a themed confirm modal, POSTs to /scenes/remove (which
  // deletes from both the session store and the project on disk via
  // io.deleteScene), then removes the card from the DOM. SSE
  // 'scene:deleted' also fires so any other open dashboards stay in sync.
  function bindOverviewDelete() {
    $$('.overview-grid [data-action="delete-scene"]').forEach(function(btn) {
      btn.addEventListener('click', function(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var wrap = btn.closest('.overview-card-wrap');
        if (!wrap) return;
        var sceneId = wrap.getAttribute('data-scene-id') || '';
        var name = wrap.getAttribute('data-scene-name') || 'this scene';
        if (!sceneId) return;

        customConfirm({
          kind: 'danger',
          title: 'Delete scene?',
          message: '<strong>' + name + '</strong> will be removed from this project \u2014 both from the current session and from disk. This cannot be undone.',
          confirmText: 'Delete',
          cancelText: 'Keep',
        }).then(function(ok) {
          if (!ok) return;

          // Disable the button during the round-trip so repeated clicks
          // can't fire multiple deletes.
          btn.setAttribute('disabled', 'true');
          btn.style.opacity = '0.5';

          fetch('/scenes/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sceneId: sceneId }),
          })
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (data && data.ok) {
                // Animate out, then remove
                wrap.style.transition = 'opacity 160ms, transform 160ms';
                wrap.style.opacity = '0';
                wrap.style.transform = 'scale(0.96)';
                setTimeout(function() {
                  wrap.parentNode && wrap.parentNode.removeChild(wrap);
                  updateScenarioCounts();
                }, 180);
              } else {
                btn.removeAttribute('disabled');
                btn.style.opacity = '';
                flash('Delete failed: ' + (data && data.error || 'unknown'), 'error');
              }
            })
            .catch(function(err) {
              btn.removeAttribute('disabled');
              btn.style.opacity = '';
              flash('Delete failed: ' + err, 'error');
            });
        });
      });
    });
  }

  // Re-count scenes in each scenario bucket and update the pill labels
  // after a card is removed.
  function updateScenarioCounts() {
    var cards = $$('.overview-grid .overview-card-wrap');
    var counts = { all: 0, originals: 0, variants: 0, brands: 0, drafts: 0 };
    cards.forEach(function(card) {
      var scenarios = (card.getAttribute('data-scenarios') || '').split(/\s+/);
      scenarios.forEach(function(s) {
        if (counts[s] !== undefined) counts[s]++;
      });
    });
    $$('.overview-scenario').forEach(function(tab) {
      var kind = tab.getAttribute('data-scenario') || 'all';
      var countEl = tab.querySelector('.count');
      if (countEl && counts[kind] !== undefined) countEl.textContent = String(counts[kind]);
    });
    // Update the subtitle "N scenes in this project"
    var sub = $('.overview-subtitle');
    if (sub && counts.all >= 0) {
      var brand = sub.textContent && sub.textContent.indexOf(' · ') >= 0 ? sub.textContent.split(' · ')[1] : '';
      sub.textContent = counts.all + ' scene' + (counts.all === 1 ? '' : 's') + ' in this project' + (brand ? ' · ' + brand : '');
    }
  }

  function bindEmptyLauncher() {
    $$('.empty-path').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var kind = btn.getAttribute('data-kind');
        if (kind === 'describe') {
          showVerbPanel('Describe a scene',
            '<input class="ask-input" type="text" placeholder="Describe what you want to create\u2026" data-vp-field="text">' +
            '<div class="ask-hint">The AI agent will design it for you</div>',
            function(panel) {
              var input = panel.querySelector('[data-vp-field="text"]');
              var text = input ? input.value.trim() : '';
              if (!text) return;
              api('/platform/api/intent/add', {
                parts: [{ kind: 'scope', value: 'project' }, { kind: 'text', value: text }, { kind: 'explore', count: 1 }],
              }).then(function() { flash('Intent queued', 'success'); location.reload(); }).catch(function() {});
            }
          );
        } else if (kind === 'url') {
          showVerbPanel('Import from URL',
            '<input class="ask-input" type="url" placeholder="https://example.com" data-vp-field="url">' +
            '<div class="ask-hint">Extract design system and import the page</div>',
            function(panel) {
              var input = panel.querySelector('[data-vp-field="url"]');
              var url = input ? input.value.trim() : '';
              if (!url) return;
              flash('Importing\u2026', 'info');
              api('/platform/api/import', { url: url })
                .then(function(data) {
                  if (data && data.slug) {
                    flash('Imported! Redirecting\u2026', 'success');
                    location.href = '/platform/scene/' + data.slug;
                  } else {
                    flash('Import failed', 'error');
                  }
                })
                .catch(function() { flash('Import failed', 'error'); });
            }
          );
        } else if (kind === 'brand') {
          openBrandBrowser();
        } else if (kind === 'html') {
          showVerbPanel('Paste HTML',
            '<textarea class="ask-input" style="height:160px;resize:vertical;font-family:var(--mono);font-size:12px" data-vp-field="html" placeholder="Paste your full HTML here\u2026"></textarea>' +
            '<div style="margin-top:12px"><label style="font-size:12px;color:var(--text-muted)">Brand (optional):</label>' +
            '<input class="ask-input" type="text" placeholder="e.g. stripe, airbnb, linear" data-vp-field="brand" style="margin-top:4px;font-size:13px"></div>' +
            '<div class="ask-hint">Compiles HTML into a scene. Add brand to auto-rebrand.</div>',
            function(panel) {
              var textarea = panel.querySelector('[data-vp-field="html"]');
              var brandInput = panel.querySelector('[data-vp-field="brand"]');
              var html = textarea ? textarea.value.trim() : '';
              var brand = brandInput ? brandInput.value.trim() : '';
              if (!html) return;
              flash('Compiling\u2026', 'info');
              var body = { html: html };
              if (brand) body.brand = brand;
              api('/platform/api/import', body)
                .then(function(data) {
                  if (data && data.slug) {
                    flash('Compiled! Redirecting\u2026', 'success');
                    location.href = '/platform/scene/' + data.slug;
                  } else {
                    flash('Compile failed', 'error');
                  }
                })
                .catch(function() { flash('Compile failed', 'error'); });
            }
          );
        } else if (kind === 'audit') {
          showVerbPanel('Quality Audit',
            '<textarea class="ask-input" style="height:160px;resize:vertical;font-family:var(--mono);font-size:12px" data-vp-field="html" placeholder="Paste HTML to audit\u2026"></textarea>' +
            '<div class="ask-hint">Compiles and runs 37 audit rules + 8 aesthetic quality metrics.</div>',
            function(panel) {
              var textarea = panel.querySelector('[data-vp-field="html"]');
              var html = textarea ? textarea.value.trim() : '';
              if (!html) return;
              flash('Auditing\u2026', 'info');
              api('/platform/api/import', { html: html })
                .then(function(data) {
                  if (data && data.slug) {
                    flash('Audit complete! Redirecting\u2026', 'success');
                    // Redirect and auto-open quality tab
                    location.href = '/platform/scene/' + data.slug + '?tab=quality';
                  } else {
                    flash('Audit failed', 'error');
                  }
                })
                .catch(function() { flash('Audit failed', 'error'); });
            }
          );
        } else if (kind === 'blocks') {
          window.location.href = '/platform/blocks';
        } else if (kind === 'create-canvas') {
          // Create an empty canvas (1440x900 frame) and navigate to it.
          flash('Creating canvas\u2026', 'info');
          api('/platform/api/import', {
            html: '<div style="width:1440px;min-height:900px;background:#f5f5f4"></div>',
          }).then(function(data) {
            if (data && data.slug) {
              // Navigate directly to project page (scene route redirects anyway)
              location.href = '/platform/project/' + data.slug;
            } else {
              flash('Failed to create canvas', 'error');
            }
          }).catch(function(e) { flash('Failed: ' + e.message, 'error'); });
        }
      });
    });
  }

  // ── Keyboard shortcuts ───────────────────────────────
  function bindKeyboard() {
    document.addEventListener('keydown', function(e) {
      const tag = (e.target || {}).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      // In a gesture submode (lasso/brush/drag/echo/etc): Enter commits,
      // Escape cancels. These are "already inside edit mode plus a verb".
      if (state.mode) {
        if (e.key === 'Enter') { commitMode(); e.preventDefault(); return; }
        if (e.key === 'Escape') { exitMode('cancelled'); e.preventDefault(); return; }
        return;
      }

      // Thread panel open → Escape closes it before anything else.
      const threadPanelOpen = $('[data-thread-panel]') && !$('[data-thread-panel]').classList.contains('hidden');
      if (threadPanelOpen && e.key === 'Escape') {
        closeThreadPanel();
        e.preventDefault();
        return;
      }

      // Command-K: open/close command palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggleCommandPalette();
        return;
      }

      // "E" toggles edit mode globally (view ↔ edit). This is the PRIMARY
      // hotkey — everything else lives inside edit mode. When already in
      // edit mode with a selection, "e" maps to the Echo verb instead
      // (the two don't conflict because selection gates verb hotkeys).
      if (e.key === 'e' && !state.selection.inode) {
        setEditMode(!state.editMode);
        e.preventDefault();
        return;
      }

      // Tab / Shift+Tab — cycle focus through visible annotation marks.
      // Works in BOTH modes — marks are persistent, user can scan them
      // even when not editing.
      if (e.key === 'Tab' && !threadPanelOpen) {
        if (cycleMarkFocus(e.shiftKey ? -1 : 1)) {
          e.preventDefault();
          return;
        }
      }
      // Enter on a focused mark → open its thread.
      if (e.key === 'Enter' && state.focusedMarkId) {
        e.preventDefault();
        scrollStreamTo(state.focusedMarkId);
        return;
      }

      // Cmd+Z = undo.
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoLastOp();
        return;
      }
      // Cmd+D = duplicate selected node.
      if ((e.metaKey || e.ctrlKey) && e.key === 'd' && state.selection.inode) {
        e.preventDefault();
        handleContextAction('duplicate');
        return;
      }
      // Delete / Backspace = delete selected node.
      if ((e.key === 'Delete' || e.key === 'Backspace') && state.editMode && state.selection.inode) {
        e.preventDefault();
        handleContextAction('delete');
        return;
      }

      // Verb hotkeys — only fire in edit mode with a selected node.
      if (state.editMode && state.selection.inode) {
        const hotkeys = {
          a: 'ask',
          e: 'echo',
          p: 'pin',
          r: 'rule',
          m: 'drag',
          s: 'resonance',
          l: 'lasso',
          b: 'brush',
          t: 'time',
        };
        if (hotkeys[e.key]) { handleVerb(hotkeys[e.key]); e.preventDefault(); return; }
      }

      if (e.key === 'Escape') {
        clearMarkFocus();
        if (state.selection.inode) {
          clearSelection();
        } else if (state.editMode) {
          // Empty selection + Escape → leave edit mode entirely.
          setEditMode(false);
        }
        return;
      }
    });
  }

  function cycleMarkFocus(dir) {
    const els = $$('.annotation-marks-html .mark[data-ann]');
    if (els.length === 0) return false;
    const ids = els.map(function(el) { return el.getAttribute('data-ann'); });
    let idx = ids.indexOf(state.focusedMarkId);
    idx = (idx + dir + ids.length) % ids.length;
    if (idx < 0) idx = ids.length - 1;
    state.focusedMarkId = ids[idx];
    els.forEach(function(el) { el.classList.remove('focused'); });
    els[idx].classList.add('focused');
    return true;
  }

  function clearMarkFocus() {
    state.focusedMarkId = null;
    $$('.annotation-marks-html .mark.focused').forEach(function(el) { el.classList.remove('focused'); });
  }

  // ── Right panel tabs (Sections / Design / Rebrand / Vary / Activity) ───────────
  function bindRightTabs() {
    $$('.right-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        var target = tab.getAttribute('data-tab');
        if (!target) return;
        $$('.right-tab').forEach(function(t) { t.classList.toggle('active', t === tab); });
        // Hide all panels, then show target with correct display mode
        $$('[data-panel]').forEach(function(panel) {
          panel.style.display = 'none';
          panel.classList.add('hidden');
        });
        var targetPanel = $('[data-panel="' + target + '"]');
        if (targetPanel) {
          // Design panel needs block (vertical stacking), sections/ai use flex
          targetPanel.style.display = target === 'design' ? 'block' : 'flex';
          targetPanel.classList.remove('hidden');
        }
        // Auto-fetch sections when tab activates
        if (target === 'sections' && !state.sectionsLoaded) {
          fetchSections();
        }
        // Lazy-init variations panel on first activation
        if (target === 'vary' && !state.varyPanelLoaded) {
          initVaryPanel();
        }
        // Quality tab: fetch aesthetic score
        if (target === 'quality') {
          var analyzeBtn = $('[data-quality-analyze]');
          if (analyzeBtn && !analyzeBtn._bound) {
            analyzeBtn._bound = true;
            analyzeBtn.addEventListener('click', function() {
              var sid = state.currentSceneId || document.querySelector('[data-session]')?.getAttribute('data-session');
              if (!sid) return;
              analyzeBtn.textContent = 'Analyzing...';
              analyzeBtn.disabled = true;
              fetch('/platform/api/aesthetic/' + sid)
                .then(function(r) { return r.json(); })
                .then(function(data) {
                  if (!data.ok) { analyzeBtn.textContent = 'Error'; return; }
                  var scoreEl = $('[data-quality-score]');
                  if (scoreEl) {
                    scoreEl.innerHTML = '<div style="font-size:48px;font-weight:800;color:var(--accent)">' + data.overall + '%</div>'
                      + '<div class="t-caption" style="color:var(--text-muted)">' + data.overallRating + '</div>';
                  }
                  var metricsEl = $('[data-quality-metrics]');
                  if (metricsEl && data.metrics) {
                    metricsEl.innerHTML = data.metrics.map(function(m) {
                      var filled = Math.round(m.score / 10);
                      var bar = '\u2588'.repeat(filled) + '\u2591'.repeat(10 - filled);
                      var color = m.score >= 60 ? 'var(--text-base)' : m.score >= 30 ? '#d4a017' : '#e74c3c';
                      return '<div style="display:flex;align-items:center;gap:8px;font-size:13px">'
                        + '<span style="width:80px;color:var(--text-muted)">' + m.name + '</span>'
                        + '<span style="font-family:var(--mono);color:' + color + '">' + bar + '</span>'
                        + '<span style="width:32px;text-align:right;font-weight:600">' + m.score + '%</span>'
                        + '</div>';
                    }).join('');
                  }
                  analyzeBtn.textContent = 'Re-analyze';
                  analyzeBtn.disabled = false;
                  // Also fetch Brand Fidelity from audit endpoint
                  fetch('/platform/api/audit?sceneId=' + sid)
                    .then(function(r) { return r.json(); })
                    .then(function(auditData) {
                      var bfEl = $('[data-brand-fidelity-score]');
                      var bfBreak = $('[data-brand-fidelity-breakdown]');
                      if (bfEl && auditData.brandFidelity) {
                        var bf = auditData.brandFidelity;
                        bfEl.innerHTML = '<div style="font-size:36px;font-weight:800;color:var(--accent)">' + bf.score + '</div>'
                          + '<div class="t-caption" style="color:var(--text-muted)">' + bf.rating + '</div>';
                        if (bfBreak) {
                          var dims = bf.breakdown;
                          bfBreak.innerHTML = Object.keys(dims).map(function(k) {
                            var val = Math.round(dims[k] * 100);
                            var label = k.replace(/([A-Z])/g, ' $1').replace(/^./, function(c) { return c.toUpperCase(); });
                            var color = val >= 70 ? 'var(--text-base)' : val >= 40 ? '#d4a017' : '#e74c3c';
                            return '<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0">'
                              + '<span style="color:var(--text-muted)">' + label + '</span>'
                              + '<span style="font-weight:600;color:' + color + '">' + val + '%</span>'
                              + '</div>';
                          }).join('');
                        }
                      } else if (bfEl) {
                        bfEl.innerHTML = '<div class="t-caption" style="color:var(--text-muted)">No brand loaded</div>';
                      }
                    }).catch(function() {});
                })
                .catch(function() { analyzeBtn.textContent = 'Analyze Quality'; analyzeBtn.disabled = false; });
            });
          }
        }
        // Tokens tab: fetch token list
        if (target === 'tokens') {
          var sid = state.currentSceneId || document.querySelector('[data-session]')?.getAttribute('data-session');
          if (sid) {
            fetch('/platform/api/tokens/' + sid)
              .then(function(r) { return r.json(); })
              .then(function(data) {
                var tree = $('[data-tokens-tree]');
                if (!tree || !data.ok) return;
                if (data.count === 0) {
                  tree.innerHTML = '<div class="t-caption" style="color:var(--text-muted);padding:16px;text-align:center">No tokens defined.</div>';
                  return;
                }
                tree.innerHTML = data.tokens.map(function(t) {
                  var swatch = t.type === 'COLOR' && typeof t.value === 'string' && t.value.startsWith('#')
                    ? '<span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:' + t.value + ';border:1px solid var(--border);vertical-align:middle;margin-right:6px"></span>'
                    : '';
                  return '<div style="display:flex;align-items:center;gap:4px;font-size:12px;padding:3px 0">'
                    + swatch
                    + '<span style="color:var(--text-base);font-family:var(--mono)">' + t.name + '</span>'
                    + '<span style="margin-left:auto;color:var(--text-muted)">' + (typeof t.value === 'string' ? t.value : JSON.stringify(t.value)) + '</span>'
                    + '</div>';
                }).join('');
              })
              .catch(function() {});
          }
        }
      });
    });

    // Auto-open tab from URL ?tab= param (e.g. from audit redirect)
    try {
      var params = new URLSearchParams(window.location.search);
      var autoTab = params.get('tab');
      if (autoTab) {
        var targetTab = document.querySelector('[data-tab="' + autoTab + '"]');
        if (targetTab) {
          setTimeout(function() { targetTab.click(); }, 300);
        }
      }
    } catch(e) {}
  }

  // ── Rebrand panel ──────────────────────────────────────────
  function getCurrentSessionId() {
    var el = $('[data-session]');
    return el ? el.getAttribute('data-session') : null;
  }

  function setRebrandStatus(text, isError) {
    var el = $('[data-rebrand-status]');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = isError ? 'var(--error, #f3727f)' : 'var(--text-muted)';
  }

  function bindRebrandPanel() {
    var applyBtn = $('[data-rebrand-apply]');
    var select = $('[data-rebrand-select]');
    if (applyBtn && select) {
      applyBtn.addEventListener('click', function() {
        var brand = select.value;
        var sceneId = getCurrentSessionId();
        if (!brand || !sceneId) {
          setRebrandStatus('Select a brand', true);
          return;
        }
        setRebrandStatus('Applying ' + brand + '…');
        fetch('/platform/api/rebrand/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sceneId: sceneId, brand: brand }),
        })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.ok) {
              setRebrandStatus('✓ ' + data.brand + ': ' + data.rebranded + ' nodes rebranded, ' + data.bindings + ' bindings');
              refreshViewports();
            } else {
              setRebrandStatus('Error: ' + (data.error || 'rebrand failed'), true);
            }
          })
          .catch(function(err) {
            setRebrandStatus('Network error: ' + err, true);
          });
      });
    }

    // Mode switcher (light/dark)
    $$('[data-mode-switch]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var mode = btn.getAttribute('data-mode-switch');
        var sceneId = getCurrentSessionId();
        if (!mode || !sceneId) return;
        fetch('/platform/api/variations/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sceneId: sceneId, kind: 'mode', value: mode }),
        })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.ok) {
              $$('[data-mode-switch]').forEach(function(b) {
                b.style.background = b === btn ? 'var(--accent)' : 'var(--surface)';
                b.style.color = b === btn ? 'var(--on-accent)' : 'var(--text-base)';
              });
              refreshViewports();
            }
          });
      });
    });
  }

  // ── Variations panel ───────────────────────────────────────
  function initVaryPanel() {
    state.varyPanelLoaded = true;
    fetch('/platform/api/variations/presets')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.ok) return;
        renderVaryControls(data.presets);
        renderVaryGridAxes(data.presets);
      })
      .catch(function(err) { console.error('presets fetch failed', err); });
  }

  function renderVaryControls(presets) {
    var container = $('[data-vary-controls]');
    if (!container) return;
    var html = '';
    html += '<div class="t-caption" style="color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px">Quick apply</div>';
    html += '<div class="t-body" style="color:var(--text-muted);font-size:12px;margin-bottom:8px">Click a preset to apply it in-place on the current scene.</div>';

    Object.keys(presets).forEach(function(kind) {
      var preset = presets[kind];
      if (kind === 'mode') return; // mode handled in rebrand panel
      html += '<div data-vary-axis-group="' + kind + '" style="display:flex;flex-direction:column;gap:6px">';
      html += '<div class="t-caption" style="color:var(--text-base);font-weight:600">' + preset.label + '</div>';
      if (preset.description) {
        html += '<div class="t-body" style="color:var(--text-muted);font-size:11px">' + preset.description + '</div>';
      }
      if (preset.kind === 'slider') {
        html += '<div style="display:flex;align-items:center;gap:8px">';
        html += '<input type="range" data-vary-slider="' + kind + '" min="' + preset.min + '" max="' + preset.max + '" step="' + preset.step + '" value="' + preset.default + '" style="flex:1">';
        html += '<span data-vary-slider-value="' + kind + '" style="min-width:32px;font-size:12px;color:var(--text-muted)">' + preset.default + '</span>';
        html += '<button data-vary-apply="' + kind + '" class="btn-apply" style="padding:4px 10px;background:var(--accent);color:var(--on-accent);border:none;border-radius:4px;cursor:pointer;font-size:12px">Apply</button>';
        html += '</div>';
      } else if (preset.kind === 'enum') {
        html += '<div style="display:flex;flex-wrap:wrap;gap:6px">';
        preset.options.forEach(function(opt) {
          html += '<button data-vary-preset="' + kind + '" data-vary-value="' + opt.value + '" class="btn-preset" style="padding:6px 10px;background:var(--surface);color:var(--text-base);border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:12px">' + opt.label + '</button>';
        });
        html += '</div>';
      }
      html += '</div>';
    });

    container.innerHTML = html;

    // Bind slider value display + apply buttons
    $$('[data-vary-slider]').forEach(function(slider) {
      var kind = slider.getAttribute('data-vary-slider');
      var valueEl = $('[data-vary-slider-value="' + kind + '"]');
      slider.addEventListener('input', function() {
        if (valueEl) valueEl.textContent = slider.value;
      });
    });
    $$('[data-vary-apply]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var kind = btn.getAttribute('data-vary-apply');
        var slider = $('[data-vary-slider="' + kind + '"]');
        if (slider) applyVariation(kind, parseFloat(slider.value));
      });
    });
    $$('[data-vary-preset]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var kind = btn.getAttribute('data-vary-preset');
        var value = btn.getAttribute('data-vary-value');
        applyVariation(kind, value);
      });
    });
  }

  function applyVariation(kind, value) {
    var sceneId = getCurrentSessionId();
    if (!sceneId || !kind) return;
    fetch('/platform/api/variations/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sceneId: sceneId, kind: kind, value: value }),
    })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.ok) {
          refreshViewports();
        } else {
          console.error('variation failed', data.error);
        }
      });
  }

  function renderVaryGridAxes(presets) {
    var container = $('[data-vary-grid-axes]');
    if (!container) return;
    var html = '';

    // Brand axis (checkboxes from current brands list)
    var brandsList = (window).__REFRAME_BRANDS__ || [];
    if (brandsList.length > 0) {
      html += '<div><div class="t-caption" style="color:var(--text-muted);margin-bottom:4px">Brand</div><div style="display:flex;flex-wrap:wrap;gap:6px">';
      brandsList.forEach(function(b) {
        html += '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px"><input type="checkbox" data-vary-grid="brand" value="' + b + '">' + b + '</label>';
      });
      html += '</div></div>';
    }

    // Density (multi-value slider buttons)
    html += '<div><div class="t-caption" style="color:var(--text-muted);margin-bottom:4px">Density values</div><div style="display:flex;flex-wrap:wrap;gap:6px">';
    ['0.7','0.85','1.0','1.15','1.3'].forEach(function(v) {
      html += '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px"><input type="checkbox" data-vary-grid="density" value="' + v + '">' + v + '</label>';
    });
    html += '</div></div>';

    // Radius strategies
    html += '<div><div class="t-caption" style="color:var(--text-muted);margin-bottom:4px">Radius</div><div style="display:flex;flex-wrap:wrap;gap:6px">';
    ['sharp','editorial','soft','pill'].forEach(function(v) {
      html += '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px"><input type="checkbox" data-vary-grid="radius" value="' + v + '">' + v + '</label>';
    });
    html += '</div></div>';

    // Typography presets
    html += '<div><div class="t-caption" style="color:var(--text-muted);margin-bottom:4px">Typography</div><div style="display:flex;flex-wrap:wrap;gap:6px">';
    ['dramatic','flat','editorial','technical','friendly'].forEach(function(v) {
      html += '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px"><input type="checkbox" data-vary-grid="typography" value="' + v + '">' + v + '</label>';
    });
    html += '</div></div>';

    // Shadows
    html += '<div><div class="t-caption" style="color:var(--text-muted);margin-bottom:4px">Shadows</div><div style="display:flex;flex-wrap:wrap;gap:6px">';
    ['flat','subtle','normal','dramatic'].forEach(function(v) {
      html += '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px"><input type="checkbox" data-vary-grid="shadows" value="' + v + '">' + v + '</label>';
    });
    html += '</div></div>';

    // Modes
    html += '<div><div class="t-caption" style="color:var(--text-muted);margin-bottom:4px">Mode</div><div style="display:flex;flex-wrap:wrap;gap:6px">';
    ['light','dark'].forEach(function(v) {
      html += '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px"><input type="checkbox" data-vary-grid="mode" value="' + v + '">' + v + '</label>';
    });
    html += '</div></div>';

    container.innerHTML = html;
  }

  function bindVaryGridButton() {
    var btn = $('[data-vary-grid-generate]');
    if (!btn) return;
    btn.addEventListener('click', function() {
      var sceneId = getCurrentSessionId();
      if (!sceneId) return;
      // Collect selected values from checkboxes
      var axes = {};
      ['brand','density','radius','typography','shadows','mode'].forEach(function(axis) {
        var values = [];
        $$('[data-vary-grid="' + axis + '"]:checked').forEach(function(cb) {
          var v = cb.value;
          if (axis === 'density') v = parseFloat(v);
          values.push(v);
        });
        if (values.length > 0) axes[axis] = values;
      });
      if (Object.keys(axes).length === 0) {
        setVaryGridStatus('Select at least one axis value', true);
        return;
      }
      var total = 1;
      Object.keys(axes).forEach(function(k) { total *= axes[k].length; });
      setVaryGridStatus('Generating ' + total + ' variants…');
      fetch('/platform/api/variations/grid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneId: sceneId, axes: axes }),
      })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.ok) {
            setVaryGridStatus('✓ Generated ' + data.generated.length + ' variants');
            renderVaryGridResults(data.generated);
          } else {
            setVaryGridStatus('Error: ' + (data.error || 'grid failed'), true);
          }
        })
        .catch(function(err) {
          setVaryGridStatus('Network error: ' + err, true);
        });
    });
  }

  function setVaryGridStatus(text, isError) {
    var el = $('[data-vary-grid-status]');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = isError ? 'var(--error, #f3727f)' : 'var(--text-muted)';
  }

  function renderVaryGridResults(generated) {
    var container = $('[data-vary-grid-results]');
    if (!container) return;
    if (!generated || generated.length === 0) {
      container.innerHTML = '';
      return;
    }
    var html = generated.map(function(v) {
      return '<a href="/platform/scene/' + v.sceneId + '" style="padding:6px 10px;background:var(--surface);border:1px solid var(--border);border-radius:4px;font-size:12px;color:var(--text-base);text-decoration:none;display:block">' +
        '<span style="color:var(--text-muted)">' + v.sceneId + '</span> · ' + v.label +
        '</a>';
    }).join('');
    container.innerHTML = html;
  }

  // ── Sections panel ─────────────────────────────────────
  var SECTION_ICONS = {
    nav: '◫', hero: '▣', section: '▧', content: '▦',
    stats: '▤', filters: '▥', cta: '◉', footer: '▨',
    background: '◻', heading: '▬', default: '□'
  };

  function fetchSections() {
    var sceneId = state.currentSceneSlug;
    if (!sceneId) return;
    // Use sessionId from page data attribute
    var el = $('[data-session]');
    var sessionId = el ? el.getAttribute('data-session') : sceneId;
    fetch('/platform/api/scene/sections?sceneId=' + encodeURIComponent(sessionId))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.ok) return;
        state.sectionsLoaded = true;
        renderSections(data.sections);
      })
      .catch(function(err) { console.error('sections fetch failed', err); });
  }

  function renderSections(sections) {
    var container = $('#sections-list');
    if (!container) return;
    if (!sections || sections.length === 0) {
      container.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted)" class="t-body">No sections found. Compile a page first.</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < sections.length; i++) {
      var s = sections[i];
      var icon = SECTION_ICONS[s.role] || SECTION_ICONS['default'];
      html += '<div class="section-card" data-node-id="' + s.nodeId + '" data-index="' + i + '"'
        + ' data-bx="' + s.bounds.x + '" data-by="' + s.bounds.y + '" data-bw="' + s.bounds.w + '" data-bh="' + s.bounds.h + '"'
        + ' draggable="true">'
        + '<div class="section-card-header">'
        + '<span class="section-icon">' + icon + '</span>'
        + '<span class="section-role t-caption">' + escapeHtml(s.role.toUpperCase()) + '</span>'
        + '<span class="section-dims t-caption" style="margin-left:auto;color:var(--text-muted)">' + s.bounds.w + '×' + s.bounds.h + '</span>'
        + '</div>'
        + '<div class="section-card-name t-body">' + escapeHtml(s.name) + '</div>'
        + (s.textPreview ? '<div class="section-card-preview t-caption" style="color:var(--text-muted)">' + escapeHtml(s.textPreview) + '</div>' : '')
        + '<div class="section-card-meta t-caption" style="color:var(--text-muted)">' + s.childCount + ' nodes</div>'
        + '</div>';
    }
    container.innerHTML = html;

    // Bind click → highlight in preview
    $$('.section-card').forEach(function(card) {
      card.addEventListener('click', function() {
        $$('.section-card').forEach(function(c) { c.classList.remove('selected'); });
        card.classList.add('selected');
        var nodeId = card.getAttribute('data-node-id');
        highlightSectionInPreview(nodeId);
      });
    });

    // Drag and drop reorder
    bindSectionDrag();
  }

  function highlightSectionInPreview(nodeId) {
    // Scroll the element into view in the iframe
    postToIframe({ type: 'reframe:highlight', inode: nodeId });

    // Draw a selection outline on the SVG overlay using the section's bounds
    var card = $('.section-card[data-node-id="' + nodeId + '"]');
    if (!card) return;
    // Get bounds from the sections data stored on the card
    var bx = parseFloat(card.getAttribute('data-bx') || '0');
    var by = parseFloat(card.getAttribute('data-by') || '0');
    var bw = parseFloat(card.getAttribute('data-bw') || '0');
    var bh = parseFloat(card.getAttribute('data-bh') || '0');
    if (bw > 0 && bh > 0) {
      drawSectionHighlight(bx, by, bw, bh);
    }
  }

  function drawSectionHighlight(x, y, w, h) {
    var outline = $('.select-outline');
    if (!outline) return;
    outline.setAttribute('x', String(x));
    outline.setAttribute('y', String(y));
    outline.setAttribute('width', String(w));
    outline.setAttribute('height', String(h));
    outline.classList.remove('hidden');
  }

  function clearSectionHighlight() {
    var outline = $('.select-outline');
    if (outline) outline.classList.add('hidden');
  }

  function bindSectionDrag() {
    var dragSrc = null;
    $$('.section-card').forEach(function(card) {
      card.addEventListener('dragstart', function(e) {
        dragSrc = card;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', card.getAttribute('data-index'));
      });
      card.addEventListener('dragend', function() {
        card.classList.remove('dragging');
        $$('.section-card').forEach(function(c) { c.classList.remove('drag-over'); });
        dragSrc = null;
      });
      card.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        card.classList.add('drag-over');
      });
      card.addEventListener('dragleave', function() {
        card.classList.remove('drag-over');
      });
      card.addEventListener('drop', function(e) {
        e.preventDefault();
        card.classList.remove('drag-over');
        if (!dragSrc || dragSrc === card) return;
        // Reorder in DOM
        var container = $('#sections-list');
        if (container) {
          var cards = Array.from(container.children);
          var fromIdx = cards.indexOf(dragSrc);
          var toIdx = cards.indexOf(card);
          if (fromIdx < toIdx) {
            container.insertBefore(dragSrc, card.nextSibling);
          } else {
            container.insertBefore(dragSrc, card);
          }
          // Collect new order and send to server
          var order = Array.from(container.children).map(function(c) {
            return c.getAttribute('data-node-id');
          }).filter(Boolean);
          reorderSections(order);
        }
      });
    });
  }

  function reorderSections(order) {
    var el = $('[data-session-id]');
    var sessionId = el ? el.getAttribute('data-session-id') : '';
    fetch('/platform/api/scene/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sceneId: sessionId, order: order })
    }).catch(function(err) { console.error('reorder failed', err); });
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Properties Inspector ────────────────────────────
  // Fetches CSS-named properties for the selected node and renders
  // editable controls. Every change fires POST /platform/api/node/edit
  // → engine applies → SSE → preview reloads. Real-time direct editing.

  var currentPropsNodeId = null;

  async function showPropsForNode(inode, sessionId) {
    if (!inode || !sessionId) {
      clearPropsPanel();
      return;
    }
    currentPropsNodeId = inode;
    // Properties inspector populates in background; user stays on Activity tab.
    // To see properties, click the "Design" tab manually — supervision first.
    try {
      var res = await api('/platform/api/node/get?sceneId=' + encodeURIComponent(sessionId) + '&nodeId=' + encodeURIComponent(inode));
      if (!res.ok || !res.props) return;
      renderPropsPanel(res.props, sessionId, inode);
    } catch (_) {}
  }

  function clearPropsPanel() {
    currentPropsNodeId = null;
    var panel = $('[data-panel="design"]');
    if (!panel) return;
    // Show scene-level dashboard instead of empty state.
    var frame = $('.viewport-frame');
    var sessionId = frame ? frame.getAttribute('data-session') : null;
    if (sessionId) {
      renderSceneDashboard(panel, sessionId);
    } else {
      panel.innerHTML =
        '<div class="props-empty">' +
          '<div class="headline">No scene loaded.</div>' +
          '<div class="body">Open a scene from the sidebar.</div>' +
        '</div>';
    }
  }

  async function renderSceneDashboard(panel, sessionId) {
    // Fetch root node props for scene-level info. We use a plain fetch
    // (not the api() helper) because nodeId="root" is a best-effort
    // guess — real root ids are per-scene UUIDs, so a 404 is normal on
    // first load. api() would toast "API error: node root not found"
    // before the catch could swallow it; plain fetch stays silent.
    var sceneInfo = '';
    try {
      var resp = await fetch('/platform/api/node/get?sceneId=' + encodeURIComponent(sessionId) + '&nodeId=root');
      if (!resp.ok) throw new Error('no root');
      var store = await resp.json();
      if (!store.ok) throw new Error('no root');
      var p = store.props || {};
      var bgColor = p.background || '#FFFFFF';
      sceneInfo =
        '<div class="props-identity">' +
          '<div class="node-name">Canvas<span class="node-type">' + escape(p.type || 'frame') + '</span></div>' +
          '<div class="node-parent">Scene root \u2014 edit dimensions, background</div>' +
        '</div>' +
        '<div class="props-section">' +
          '<div class="props-section-header">Dimensions</div>' +
          '<div class="props-section-body">' +
            '<div class="prop-pair">' +
              '<div class="prop-compact"><span class="prop-compact-label">W</span>' +
                '<input class="prop-compact-input" type="number" value="' + (p.width || 1440) + '" data-prop="width" data-scene="' + escape(sessionId) + '" data-node="root" step="1"></div>' +
              '<div class="prop-compact"><span class="prop-compact-label">H</span>' +
                '<input class="prop-compact-input" type="number" value="' + (p.height || 900) + '" data-prop="height" data-scene="' + escape(sessionId) + '" data-node="root" step="1"></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="props-section">' +
          '<div class="props-section-header">Background</div>' +
          '<div class="props-section-body">' +
            '<div class="fill-row">' +
              '<div class="fill-swatch" style="background:' + escape(bgColor) + '" data-prop="background" data-scene="' + escape(sessionId) + '" data-node="root"></div>' +
              '<input class="fill-hex" type="text" value="' + escape(bgColor) + '" data-prop="background" data-scene="' + escape(sessionId) + '" data-node="root">' +
            '</div>' +
          '</div>' +
        '</div>';
    } catch (_) {
      sceneInfo = '<div class="props-identity"><div class="node-name">Scene</div></div>';
    }

    // Audit summary.
    var auditHtml = '';
    if (auditFindings.length > 0) {
      var errors = auditFindings.filter(function(f) { return f.severity === 'error'; }).length;
      var warnings = auditFindings.filter(function(f) { return f.severity === 'warning'; }).length;
      var topFindings = auditFindings.slice(0, 3).map(function(f) {
        return '<div class="scene-dash-finding ' + escape(f.severity) + '">' +
          '<span class="finding-dot"></span>' +
          escape(f.rule) + (f.nodeName ? ' on ' + escape(f.nodeName) : '') +
        '</div>';
      }).join('');
      auditHtml =
        '<div class="props-section">' +
          '<div class="props-section-header">Audit</div>' +
          '<div class="props-section-body">' +
            '<div class="scene-dash-audit-score">' +
              (errors > 0 ? '<span class="score-bad">' + errors + ' error' + (errors > 1 ? 's' : '') + '</span>' : '') +
              (warnings > 0 ? '<span class="score-warn">' + warnings + ' warning' + (warnings > 1 ? 's' : '') + '</span>' : '') +
              (errors === 0 && warnings === 0 ? '<span class="score-ok">All clean</span>' : '') +
            '</div>' +
            topFindings +
          '</div>' +
        '</div>';
    }

    // Export quick buttons.
    var exportHtml =
      '<div class="props-section">' +
        '<div class="props-section-header">Export</div>' +
        '<div class="props-section-body">' +
          '<div class="scene-dash-exports">' +
            '<button class="scene-dash-export-btn" data-format="html">HTML</button>' +
            '<button class="scene-dash-export-btn" data-format="react">React</button>' +
            '<button class="scene-dash-export-btn" data-format="svg">SVG</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    // Engine actions — one-click access to powerful engine ops.
    var engineHtml =
      '<div class="props-section">' +
        '<div class="props-section-header">Engine</div>' +
        '<div class="props-section-body">' +
          '<div class="scene-dash-exports">' +
            '<button class="scene-dash-export-btn" data-engine="auto-fix" title="Run audit \u2192 auto-fix \u2192 re-audit">Auto-fix</button>' +
            '<button class="scene-dash-export-btn" data-engine="define-tokens" title="Bind all colors/fonts to brand tokens">Tokens</button>' +
            '<button class="scene-dash-export-btn" data-engine="show-source" title="View source HTML">Source</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    // Hint.
    var hintHtml =
      '<div class="scene-dash-hint">' +
        'Click a node to edit \u00B7 E for edit mode \u00B7 Right-click for AI' +
      '</div>';

    panel.innerHTML = sceneInfo + auditHtml + exportHtml + engineHtml + hintHtml;

    // Bind editable canvas settings (W/H inputs + background swatch/hex).
    bindPropInputs();

    // Bind export buttons.
    panel.querySelectorAll('.scene-dash-export-btn[data-format]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var format = btn.getAttribute('data-format');
        if (format) showExportPreview(sessionId, format);
      });
    });
    // Bind engine action buttons.
    panel.querySelectorAll('.scene-dash-export-btn[data-engine]').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var action = btn.getAttribute('data-engine');
        if (action === 'auto-fix') {
          flash('Running audit auto-fix\u2026');
          try {
            var res = await api('/platform/api/scene/auto-fix', { sceneId: sessionId, maxRounds: 3 });
            if (res.ok) flash('Fixed ' + res.fixed + ' issue(s) in ' + res.rounds + ' round(s)', 'success');
            setTimeout(refreshAudit, 300);
          } catch (_) {}
        } else if (action === 'define-tokens') {
          try {
            var res = await api('/platform/api/scene/define-tokens', { sceneId: sessionId });
            if (res.ok) flash('Bound ' + res.bound + ' token(s)', 'success');
          } catch (_) {}
        } else if (action === 'show-source') {
          try {
            var res = await api('/platform/api/scene/source?sceneId=' + encodeURIComponent(sessionId));
            if (res.ok && res.source) {
              showVerbPanel('Source HTML',
                '<textarea class="ask-input" style="height:200px;resize:vertical;font-family:var(--mono);font-size:11px;line-height:1.5" readonly>' + escape(res.source) + '</textarea>' +
                '<div class="ask-hint">Source file: .reframe/src/' + escape(res.slug || '') + '.html</div>',
                function() {}
              );
            } else {
              flash('No source HTML found');
            }
          } catch (_) {}
        }
      });
    });
  }

  function renderPropsPanel(props, sessionId, nodeId) {
    var panel = $('[data-panel="design"]');
    if (!panel) return;

    // Friendly display name.
    var rawName = (props.name || '').toLowerCase();
    var FRIENDLY = {
      div:'Container',span:'Span',section:'Section',header:'Header',
      footer:'Footer',main:'Main',nav:'Nav',article:'Article',
      aside:'Aside',button:'Button',a:'Link',p:'Paragraph',
      h1:'Heading 1',h2:'Heading 2',h3:'Heading 3',img:'Image',
    };
    var displayName = FRIENDLY[rawName] || props.name || '?';
    var typeBadge = (props.type || '').toLowerCase();

    var html = '';

    // ── Identity ──
    html += '<div class="props-identity">' +
      '<div class="node-name">' + escape(displayName) +
        ' <span class="node-type">' + escape(typeBadge) + '</span>' +
      '</div>' +
      (props.role ? '<div class="node-parent">' + escape(props.role) + '</div>' : '') +
    '</div>';

    // ── Size (2-column: W+H side by side, X+Y below) ──
    html += '<div class="props-section">' +
      '<div class="props-section-header" data-collapse-toggle>Size<span class="chevron">\u25BC</span></div>' +
      '<div class="props-section-body">' +
        '<div class="prop-pair">' +
          propCompact('W', 'width', props.width, sessionId, nodeId) +
          propCompact('H', 'height', props.height, sessionId, nodeId) +
        '</div>' +
        '<div class="prop-pair">' +
          propCompact('X', 'x', props.x, sessionId, nodeId) +
          propCompact('Y', 'y', props.y, sessionId, nodeId) +
        '</div>' +
      '</div>' +
    '</div>';

    // ── Layout (direction toggle + gap + padding box) ──
    var isFlexRow = props.display === 'flex-row';
    var isFlexCol = props.display === 'flex-col';
    var directionToggle = (isFlexRow || isFlexCol)
      ? '<div class="layout-direction">' +
          '<button class="dir-btn' + (isFlexRow ? ' active' : '') + '" data-prop="display" data-val="flex-row" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '" title="Row">\u2550</button>' +
          '<button class="dir-btn' + (isFlexCol ? ' active' : '') + '" data-prop="display" data-val="flex-col" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '" title="Column">\u2551</button>' +
          (props.gap != null ? propCompact('Gap', 'gap', props.gap, sessionId, nodeId) : '') +
        '</div>'
      : '';

    var pt = props['padding-top'] || 0;
    var pr = props['padding-right'] || 0;
    var pb = props['padding-bottom'] || 0;
    var pl = props['padding-left'] || 0;
    html += '<div class="props-section">' +
      '<div class="props-section-header" data-collapse-toggle>Layout<span class="chevron">\u25BC</span></div>' +
      '<div class="props-section-body">' +
        directionToggle +
        '<div class="spacing-box">' +
          '<div></div>' +
          '<input class="spacing-val" value="' + pt + '" data-prop="padding-top" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '" title="Padding top">' +
          '<div></div>' +
          '<input class="spacing-val" value="' + pl + '" data-prop="padding-left" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '" title="Padding left">' +
          '<div class="spacing-center">' + escape(props.width + '\u00D7' + props.height) + '</div>' +
          '<input class="spacing-val" value="' + pr + '" data-prop="padding-right" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '" title="Padding right">' +
          '<div></div>' +
          '<input class="spacing-val" value="' + pb + '" data-prop="padding-bottom" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '" title="Padding bottom">' +
          '<div></div>' +
        '</div>' +
      '</div>' +
    '</div>';

    // ── Fill (big swatch + hex + opacity + token) ──
    var bgHex = props.background || '#FFFFFF';
    var bgOpacity = props['background-opacity'] != null ? Math.round(props['background-opacity'] * 100) : 100;
    var tokenBind = props['token-bindings']?.fill;
    var tokenEl = tokenBind
      ? '<span class="prop-token">\u25C6 ' + escape(tokenBind) + '</span>'
      : '<span class="prop-token prop-token-unbound">\u25C7</span>';
    html += '<div class="props-section">' +
      '<div class="props-section-header" data-collapse-toggle>Fill<span class="chevron">\u25BC</span></div>' +
      '<div class="props-section-body">' +
        '<div class="fill-row">' +
          '<div class="fill-swatch" style="background:' + escape(bgHex) + '" data-prop="background" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '"></div>' +
          '<input class="fill-hex" type="text" value="' + escape(bgHex) + '" data-prop="background" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '">' +
          '<span class="fill-opacity">' + bgOpacity + '%</span>' +
          tokenEl +
        '</div>' +
      '</div>' +
    '</div>';

    // ── Typography (font dropdown + compact row of 4 values) ──
    if (props['font-size'] != null || props.type === 'TEXT') {
      var colorHex = props.color || '';
      html += '<div class="props-section">' +
        '<div class="props-section-header" data-collapse-toggle>Type<span class="chevron">\u25BC</span></div>' +
        '<div class="props-section-body">' +
          '<input class="type-font-input" type="text" value="' + escape(props['font-family'] || 'Inter') + '" data-prop="font-family" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '" placeholder="Font family">' +
          '<div class="type-row">' +
            propCompact('Size', 'font-size', props['font-size'] || 16, sessionId, nodeId) +
            propCompact('Wt', 'font-weight', props['font-weight'] || 400, sessionId, nodeId) +
            propCompact('LH', 'line-height', props['line-height'] || '', sessionId, nodeId) +
            propCompact('LS', 'letter-spacing', props['letter-spacing'] || 0, sessionId, nodeId) +
          '</div>' +
          (colorHex ? '<div class="fill-row" style="margin-top:8px">' +
            '<div class="fill-swatch" style="background:' + escape(colorHex) + '" data-prop="color" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '"></div>' +
            '<input class="fill-hex" type="text" value="' + escape(colorHex) + '" data-prop="color" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '">' +
            '<span class="fill-opacity">Text</span>' +
          '</div>' : '') +
        '</div>' +
      '</div>';
    }

    // ── Effects (radius slider + opacity slider) ──
    var radius = props['border-radius'] || 0;
    var opacity = props.opacity != null ? props.opacity : 1;
    html += '<div class="props-section">' +
      '<div class="props-section-header" data-collapse-toggle>Effects<span class="chevron">\u25BC</span></div>' +
      '<div class="props-section-body">' +
        '<div class="effect-row">' +
          '<span class="effect-label">Radius</span>' +
          '<input class="effect-slider" type="range" min="0" max="48" value="' + radius + '" data-prop="border-radius" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '">' +
          '<span class="effect-value" data-for="border-radius">' + radius + '</span>' +
        '</div>' +
        '<div class="effect-row">' +
          '<span class="effect-label">Opacity</span>' +
          '<input class="effect-slider" type="range" min="0" max="1" step="0.01" value="' + opacity + '" data-prop="opacity" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '">' +
          '<span class="effect-value" data-for="opacity">' + Math.round(opacity * 100) + '%</span>' +
        '</div>' +
      '</div>' +
    '</div>';

    // ── States (hover/active/focus/disabled) ──
    var stateNames = ['hover', 'active', 'focus', 'disabled'];
    var existingStates = props.states || {};
    var stateItems = stateNames.map(function(sn) {
      var has = !!existingStates[sn];
      var stateOverrides = has ? existingStates[sn] : null;
      var overrideCount = stateOverrides ? Object.keys(stateOverrides).length : 0;
      return '<div class="state-item">' +
        '<span class="state-name">' + escape(sn) + '</span>' +
        (has
          ? '<span class="state-badge on">' + overrideCount + ' override' + (overrideCount !== 1 ? 's' : '') + '</span>' +
            '<button class="state-edit-btn" data-state="' + escape(sn) + '" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '">Edit</button>'
          : '<button class="state-add-btn" data-state="' + escape(sn) + '" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '">+ Add</button>') +
      '</div>';
    }).join('');
    html += '<div class="props-section">' +
      '<div class="props-section-header" data-collapse-toggle>States<span class="chevron">\u25BC</span></div>' +
      '<div class="props-section-body">' + stateItems + '</div>' +
    '</div>';

    // ── Animation ──
    var animPresets = ['fadeIn','slideInUp','slideInLeft','popIn','bounce','shimmer','scaleIn','typewriter'];
    var presetBtns = animPresets.map(function(p) {
      return '<button class="anim-preset-btn" data-preset="' + escape(p) + '" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '">' + escape(p) + '</button>';
    }).join('');
    html += '<div class="props-section">' +
      '<div class="props-section-header" data-collapse-toggle>Animation<span class="chevron">\u25BC</span></div>' +
      '<div class="props-section-body"><div class="anim-grid">' + presetBtns + '</div></div>' +
    '</div>';

    // ── Grid (if applicable) ──
    if (props['grid-columns'] || props['grid-col-gap'] != null) {
      html += '<div class="props-section">' +
        '<div class="props-section-header" data-collapse-toggle>Grid<span class="chevron">\u25BC</span></div>' +
        '<div class="props-section-body">' +
          '<div class="prop-pair">' +
            propCompact('ColGap', 'grid-col-gap', props['grid-col-gap'] || 0, sessionId, nodeId) +
            propCompact('RowGap', 'grid-row-gap', props['grid-row-gap'] || 0, sessionId, nodeId) +
          '</div>' +
        '</div>' +
      '</div>';
    }

    // ── Responsive ──
    var responsiveRules = props.responsive || [];
    html += '<div class="props-section collapsed">' +
      '<div class="props-section-header" data-collapse-toggle>Responsive<span class="chevron">\u25BC</span></div>' +
      '<div class="props-section-body">' +
        (responsiveRules.length > 0
          ? responsiveRules.map(function(r) { return '<div class="responsive-rule">\u2264' + (r.maxWidth || '?') + 'px</div>'; }).join('')
          : '<div class="scene-dash-hint">No breakpoint overrides</div>') +
      '</div>' +
    '</div>';

    // ── Stroke details ──
    if (props['stroke-weight'] != null || props['border-color']) {
      var strokeColor = props['border-color'] || '#000000';
      html += '<div class="props-section">' +
        '<div class="props-section-header" data-collapse-toggle>Stroke<span class="chevron">\u25BC</span></div>' +
        '<div class="props-section-body">' +
          '<div class="fill-row" style="margin-bottom:8px">' +
            '<div class="fill-swatch" style="background:' + escape(strokeColor) + '" data-prop="border-color" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '"></div>' +
            '<input class="fill-hex" type="text" value="' + escape(strokeColor) + '" data-prop="border-color" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '">' +
          '</div>' +
          '<div class="prop-pair">' +
            propCompact('Wt', 'stroke-weight', props['stroke-weight'] || 0, sessionId, nodeId) +
            propCompact('Align', 'stroke-align', props['stroke-align'] || 'INSIDE', sessionId, nodeId) +
          '</div>' +
          '<div class="prop-pair">' +
            propCompact('Cap', 'stroke-cap', props['stroke-cap'] || 'NONE', sessionId, nodeId) +
            propCompact('Join', 'stroke-join', props['stroke-join'] || 'MITER', sessionId, nodeId) +
          '</div>' +
        '</div>' +
      '</div>';
    }

    // ── OpenType features ──
    if (props['font-features'] || props['font-size'] != null) {
      var feats = props['font-features'] || [];
      var commonFeats = ['tnum', 'ss01', 'ss02', 'cv01', 'cv11', 'lnum', 'onum', 'salt', 'liga'];
      var featChips = commonFeats.map(function(f) {
        var on = feats.indexOf(f) >= 0;
        return '<button class="feat-chip' + (on ? ' on' : '') + '" data-feat="' + escape(f) + '" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '">' + escape(f) + '</button>';
      }).join('');
      html += '<div class="props-section collapsed">' +
        '<div class="props-section-header" data-collapse-toggle>OpenType<span class="chevron">\u25BC</span></div>' +
        '<div class="props-section-body"><div class="feat-grid">' + featChips + '</div></div>' +
      '</div>';
    }

    // ── Corner smoothing ──
    var smoothing = props['corner-smoothing'] || 0;
    html += '<div class="props-section collapsed">' +
      '<div class="props-section-header" data-collapse-toggle>Corner smoothing<span class="chevron">\u25BC</span></div>' +
      '<div class="props-section-body">' +
        '<div class="effect-row">' +
          '<span class="effect-label">Smooth</span>' +
          '<input class="effect-slider" type="range" min="0" max="1" step="0.05" value="' + smoothing + '" data-prop="corner-smoothing" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '">' +
          '<span class="effect-value">' + Math.round(smoothing * 100) + '%</span>' +
        '</div>' +
      '</div>' +
    '</div>';

    // ── Constraints ──
    if (props['min-width'] != null || props['max-width'] != null) {
      html += '<div class="props-section collapsed">' +
        '<div class="props-section-header" data-collapse-toggle>Constraints<span class="chevron">\u25BC</span></div>' +
        '<div class="props-section-body">' +
          '<div class="prop-pair">' +
            propCompact('MinW', 'min-width', props['min-width'] || '', sessionId, nodeId) +
            propCompact('MaxW', 'max-width', props['max-width'] || '', sessionId, nodeId) +
          '</div>' +
          '<div class="prop-pair">' +
            propCompact('MinH', 'min-height', props['min-height'] || '', sessionId, nodeId) +
            propCompact('MaxH', 'max-height', props['max-height'] || '', sessionId, nodeId) +
          '</div>' +
        '</div>' +
      '</div>';
    }

    panel.innerHTML = html;
    bindPropInputs();
    bindStatesAndAnimation(sessionId, nodeId);
  }

  function bindStatesAndAnimation(sessionId, nodeId) {
    // State add buttons.
    $$('.state-add-btn[data-state]').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var stateName = btn.getAttribute('data-state');
        var scene = btn.getAttribute('data-scene');
        var node = btn.getAttribute('data-node');
        if (!stateName || !scene || !node) return;
        try {
          await api('/platform/api/node/state', { sceneId: scene, nodeId: node, stateName: stateName, props: {} });
          flash('State ' + stateName + ' added', 'success');
          showPropsForNode(node, scene);
        } catch (_) {}
      });
    });
    // State edit buttons — open a VerbPanel with common state overrides.
    $$('.state-edit-btn[data-state]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var stateName = btn.getAttribute('data-state');
        var scene = btn.getAttribute('data-scene');
        var node = btn.getAttribute('data-node');
        if (!stateName || !scene || !node) return;
        showVerbPanel('Edit ' + stateName + ' state',
          '<div class="prop-pair">' +
            '<div class="prop-compact"><span class="prop-compact-label">bg</span>' +
              '<input class="prop-compact-input" type="text" value="" data-state-prop="background" placeholder="#hex"></div>' +
            '<div class="prop-compact"><span class="prop-compact-label">opacity</span>' +
              '<input class="prop-compact-input" type="number" value="" data-state-prop="opacity" placeholder="0-1" step="0.1"></div>' +
          '</div>' +
          '<div class="prop-pair">' +
            '<div class="prop-compact"><span class="prop-compact-label">scale</span>' +
              '<input class="prop-compact-input" type="number" value="" data-state-prop="scaleX" placeholder="1" step="0.05"></div>' +
            '<div class="prop-compact"><span class="prop-compact-label">radius</span>' +
              '<input class="prop-compact-input" type="number" value="" data-state-prop="cornerRadius" placeholder="px"></div>' +
          '</div>',
          function(panel) {
            var overrides = {};
            panel.querySelectorAll('[data-state-prop]').forEach(function(input) {
              var prop = input.getAttribute('data-state-prop');
              var val = input.value.trim();
              if (!prop || !val) return;
              overrides[prop] = isNaN(Number(val)) ? val : Number(val);
            });
            if (Object.keys(overrides).length === 0) return;
            api('/platform/api/node/state', {
              sceneId: scene,
              nodeId: node,
              stateName: stateName,
              props: overrides,
            }).then(function() {
              flash(stateName + ' state updated', 'success');
              showPropsForNode(node, scene);
            }).catch(function() {});
          }
        );
      });
    });
    // Animation preset buttons.
    $$('.anim-preset-btn[data-preset]').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var preset = btn.getAttribute('data-preset');
        var scene = btn.getAttribute('data-scene');
        var node = btn.getAttribute('data-node');
        if (!preset || !scene || !node) return;
        try {
          await api('/platform/api/node/animate', { sceneId: scene, nodeId: node, preset: preset });
          flash('Animation: ' + preset, 'success');
          // Refresh viewport to show the animation.
          refreshViewports();
        } catch (_) {}
      });
    });
    // OpenType feature toggle chips.
    $$('.feat-chip[data-feat]').forEach(function(chip) {
      chip.addEventListener('click', async function() {
        var feat = chip.getAttribute('data-feat');
        var scene = chip.getAttribute('data-scene');
        var node = chip.getAttribute('data-node');
        if (!feat || !scene || !node) return;
        chip.classList.toggle('on');
        // Collect all active features.
        var activeFeats = [];
        chip.parentElement.querySelectorAll('.feat-chip.on').forEach(function(c) {
          activeFeats.push(c.getAttribute('data-feat'));
        });
        editNodeProp(scene, node, 'font-features', activeFeats);
      });
    });
  }

  // ── Compact input for 2-column pairs (W+H, Size+Weight, etc) ──
  function propCompact(label, name, value, sessionId, nodeId) {
    return '<div class="prop-compact">' +
      '<span class="prop-compact-label">' + escape(label) + '</span>' +
      '<input class="prop-compact-input" type="number" value="' + escape(String(value)) + '" ' +
        'data-prop="' + escape(name) + '" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '" step="1">' +
    '</div>';
  }

  function bindPropInputs() {
    // Section collapse toggles.
    $$('[data-collapse-toggle]').forEach(function(header) {
      header.addEventListener('click', function() {
        header.parentElement.classList.toggle('collapsed');
      });
    });
    // Compact number inputs + font input + hex input.
    $$('.prop-compact-input, .spacing-val, .fill-hex, .type-font-input').forEach(function(input) {
      input.addEventListener('change', function() {
        var prop = input.getAttribute('data-prop');
        var scene = input.getAttribute('data-scene');
        var node = input.getAttribute('data-node');
        if (!prop || !scene || !node) return;
        var val = input.type === 'number' ? Number(input.value) : input.value;
        editNodeProp(scene, node, prop, val);
      });
      // Enter = commit.
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { input.blur(); }
      });
    });
    // Direction toggle buttons.
    $$('.dir-btn[data-prop]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var prop = btn.getAttribute('data-prop');
        var val = btn.getAttribute('data-val');
        var scene = btn.getAttribute('data-scene');
        var node = btn.getAttribute('data-node');
        if (!prop || !val || !scene || !node) return;
        $$('.dir-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        editNodeProp(scene, node, prop, val);
      });
    });
    // Effect sliders (radius, opacity).
    $$('.effect-slider[data-prop]').forEach(function(slider) {
      slider.addEventListener('input', function() {
        var valueEl = slider.parentElement.querySelector('.effect-value');
        var prop = slider.getAttribute('data-prop');
        if (prop === 'opacity') {
          if (valueEl) valueEl.textContent = Math.round(Number(slider.value) * 100) + '%';
        } else {
          if (valueEl) valueEl.textContent = String(Math.round(Number(slider.value)));
        }
      });
      slider.addEventListener('change', function() {
        var prop = slider.getAttribute('data-prop');
        var scene = slider.getAttribute('data-scene');
        var node = slider.getAttribute('data-node');
        if (!prop || !scene || !node) return;
        editNodeProp(scene, node, prop, Number(slider.value));
      });
    });
    // Fill swatch click → open native color picker.
    $$('.fill-swatch[data-prop]').forEach(function(swatch) {
      swatch.addEventListener('click', function() {
        var prop = swatch.getAttribute('data-prop');
        var scene = swatch.getAttribute('data-scene');
        var node = swatch.getAttribute('data-node');
        if (!prop || !scene || !node) return;
        var picker = document.createElement('input');
        picker.type = 'color';
        var hexInput = swatch.parentElement && swatch.parentElement.querySelector('.fill-hex');
        if (hexInput) picker.value = hexInput.value;
        picker.style.cssText = 'position:absolute;opacity:0;pointer-events:none';
        document.body.appendChild(picker);
        picker.addEventListener('input', function() {
          swatch.style.background = picker.value;
          if (hexInput) hexInput.value = picker.value;
        });
        picker.addEventListener('change', function() {
          editNodeProp(scene, node, prop, picker.value);
          picker.remove();
        });
        picker.click();
      });
    });
  }

  async function editNodeProp(sceneId, nodeId, prop, value) {
    var edits = {};
    edits[prop] = value;
    try {
      var res = await api('/platform/api/node/edit', {
        sceneId: sceneId,
        nodeId: nodeId,
        props: edits,
      });
      if (res.ok && res.props) {
        // Update swatch if color changed.
        var swatch = $('.prop-swatch[data-prop="' + prop + '"]');
        if (swatch && (prop === 'background' || prop === 'color')) {
          swatch.style.background = res.props[prop] || value;
        }
        // If OP CanvasKit is active, notify it to re-hydrate this node
        // so the canvas reflects the property change without full reload.
        var ckCanvas = document.getElementById('reframe-viewport');
        if (ckCanvas) {
          window.dispatchEvent(new CustomEvent('reframe:prop-changed', {
            detail: { sceneId: sceneId, nodeId: nodeId, prop: prop, value: value, props: res.props },
          }));
        }
      }
    } catch (_) {}
  }

  // ── Inline Audit — real 23-rule findings on the preview ──
  // Fetches per-node audit findings from the engine, renders badges
  // on the HTML annotation layer, and shows a popover with fix
  // suggestion + one-click auto-fix button on hover/click.

  var auditFindings = [];

  async function refreshAudit() {
    var frame = $('.viewport-frame');
    var sessionId = frame ? frame.getAttribute('data-session') : null;
    if (!sessionId) return;
    try {
      var res = await api('/platform/api/audit?sceneId=' + encodeURIComponent(sessionId));
      if (!res.ok) return;
      auditFindings = res.findings || [];
      // Update header audit badge.
      var badge = $('.pill.success, .pill.danger');
      if (badge) {
        badge.className = 'pill ' + (res.score < 70 ? 'danger' : 'success');
        badge.innerHTML = '<span class="dot"></span>AUDIT ' + res.score;
      }
      renderAuditBadges(sessionId);
    } catch (_) {}
  }

  function renderAuditBadges(sessionId) {
    var htmlLayer = $('.annotation-marks-html');
    if (!htmlLayer) return;
    // Remove previous audit badges.
    htmlLayer.querySelectorAll('.audit-badge').forEach(function(el) { el.remove(); });
    // Group findings by nodeId.
    var byNode = {};
    for (var i = 0; i < auditFindings.length; i++) {
      var f = auditFindings[i];
      if (!f.nodeId) continue;
      if (!byNode[f.nodeId]) byNode[f.nodeId] = [];
      byNode[f.nodeId].push(f);
    }
    // Render one badge per node that has findings.
    for (var nodeId in byNode) {
      var findings = byNode[nodeId];
      var bbox = getBBox(nodeId);
      if (!bbox) continue;
      var scr = bboxToScreen(bbox);
      var worstSeverity = 'info';
      for (var j = 0; j < findings.length; j++) {
        if (findings[j].severity === 'error') worstSeverity = 'error';
        else if (findings[j].severity === 'warning' && worstSeverity !== 'error') worstSeverity = 'warning';
      }
      var badgeColor = worstSeverity === 'error' ? 'var(--danger)' : worstSeverity === 'warning' ? 'var(--warning)' : 'var(--text-tertiary)';
      // Badge position: top-left of node bbox.
      var left = scr.left - 4;
      var top = scr.top - 4;
      var popoverItems = findings.map(function(f) {
        var fixBtn = f.fix
          ? '<button class="audit-fix-btn" data-scene="' + escape(sessionId) + '" data-node="' + escape(f.nodeId) + '" data-prop="' + escape(f.fix.property) + '" data-suggested="' + escape(f.fix.suggested) + '">Fix</button>'
          : '';
        var fixPreview = f.fix
          ? '<div class="audit-fix-preview"><span class="audit-from">' + escape(f.fix.current) + '</span> \u2192 <span class="audit-to">' + escape(f.fix.suggested) + '</span></div>'
          : '';
        return '<div class="audit-finding ' + escape(f.severity) + '">' +
          '<div class="audit-finding-head">' +
            '<span class="audit-severity">' + escape(f.severity) + '</span>' +
            '<span class="audit-rule">' + escape(f.rule) + '</span>' +
            fixBtn +
          '</div>' +
          '<div class="audit-message">' + escape(f.message) + '</div>' +
          fixPreview +
        '</div>';
      }).join('');

      var badge = '<div class="audit-badge severity-' + escape(worstSeverity) + '" style="left:' + left + 'px;top:' + top + 'px;border-color:' + badgeColor + '" tabindex="0">' +
        '<span class="audit-badge-dot" style="background:' + badgeColor + '">' + findings.length + '</span>' +
        '<div class="audit-popover">' + popoverItems + '</div>' +
      '</div>';
      htmlLayer.insertAdjacentHTML('beforeend', badge);
    }
    // Bind fix buttons.
    htmlLayer.querySelectorAll('.audit-fix-btn').forEach(function(btn) {
      btn.addEventListener('click', async function(e) {
        e.stopPropagation();
        var scene = btn.getAttribute('data-scene');
        var node = btn.getAttribute('data-node');
        var prop = btn.getAttribute('data-prop');
        var suggested = btn.getAttribute('data-suggested');
        if (!scene || !node || !prop || !suggested) return;
        try {
          await api('/platform/api/audit/fix', {
            sceneId: scene,
            nodeId: node,
            property: prop,
            suggested: suggested,
          });
          flash('Fixed: ' + prop, 'success');
          // Re-audit after fix.
          setTimeout(refreshAudit, 300);
        } catch (_) {}
      });
    });
  }

  // ── Undo via Cmd+Z ────────────────────────────────
  async function undoLastOp() {
    var sceneSlug = state.currentSceneSlug;
    if (!sceneSlug) return;
    // Find the session id for this scene. We get it from the viewport frame.
    var frame = $('.viewport-frame');
    var sessionId = frame ? frame.getAttribute('data-session') : null;
    if (!sessionId) return;
    try {
      var res = await api('/platform/api/undo', { sceneId: sessionId });
      if (res.ok && res.undone) {
        flash('Undo: ' + (res.op ? res.op.type : '?'), 'success');
        // Re-fetch props if we have a selection.
        if (currentPropsNodeId && sessionId) {
          showPropsForNode(currentPropsNodeId, sessionId);
        }
      } else {
        flash('Nothing to undo');
      }
    } catch (_) {}
  }

  // ── History dropdown (top header) ────────────────────
  //
  // Replaces the old Activity tab (intent queue) with a Git-style
  // revision log. Each entry is an op from /platform/api/ops. Click
  // "Revert to here" on any entry → we repeatedly call /platform/api/undo
  // until we've undone enough ops to land at that revision.
  //
  // History data is pulled from the server on open + after every edit
  // (subscribed to SSE scene:saved via the debounced refreshTimeline).
  function bindHistoryDropdown() {
    var wrap = $('[data-history-dropdown]');
    if (!wrap) return;
    var btn = wrap.querySelector('.history-btn');
    var panel = wrap.querySelector('[data-history-panel]');
    var list = wrap.querySelector('[data-history-list]');
    var sub = wrap.querySelector('[data-history-sub]');
    var countBadge = wrap.querySelector('[data-history-count]');
    var clearBtn = wrap.querySelector('[data-action="history-clear"]');
    if (!btn || !panel || !list || !sub) return;

    function getSessionId() {
      var frame = $('.viewport-frame');
      return frame ? frame.getAttribute('data-session') : null;
    }

    function closePanel() {
      panel.classList.add('hidden');
    }
    function togglePanel() {
      if (panel.classList.contains('hidden')) {
        panel.classList.remove('hidden');
        loadHistory();
      } else {
        closePanel();
      }
    }

    async function loadHistory() {
      var sessionId = getSessionId();
      if (!sessionId) {
        list.innerHTML = '<div class="history-empty">Open a scene to see revisions.</div>';
        sub.textContent = '';
        return;
      }
      sub.textContent = 'Loading\u2026';
      try {
        // Load ops log + saved snapshots in parallel.
        var ops = [];
        var snaps = [];
        var results = await Promise.all([
          api('/platform/api/ops?sceneId=' + encodeURIComponent(sessionId)).catch(function() { return { ops: [] }; }),
          api('/platform/api/history/snapshots?sceneId=' + encodeURIComponent(sessionId)).catch(function() { return { snapshots: [] }; }),
        ]);
        ops = (results[0] && results[0].ops) || [];
        snaps = (results[1] && results[1].snapshots) || [];
        renderHistoryList(ops, snaps);
        // Badge = total snapshot + op count (sense of "history size")
        var total = ops.length + snaps.length;
        if (countBadge) {
          if (total > 0) {
            countBadge.textContent = String(total);
            countBadge.classList.remove('hidden');
          } else {
            countBadge.classList.add('hidden');
          }
        }
        var parts = [];
        if (snaps.length > 0) parts.push(snaps.length + ' save' + (snaps.length === 1 ? '' : 's'));
        if (ops.length > 0) parts.push(ops.length + ' edit' + (ops.length === 1 ? '' : 's'));
        sub.textContent = parts.length > 0 ? parts.join(' \u00B7 ') : 'No history yet';
      } catch (err) {
        list.innerHTML = '<div class="history-empty">Failed to load: ' + err + '</div>';
        sub.textContent = '';
      }
    }

    function formatOpLabel(op, idx) {
      // The ops returned by /platform/api/ops are lightweight summaries
      // ({ id, type, nodeId, timestamp }). Make the type human-readable.
      var type = (op.type || 'edit').replace(/_/g, ' ');
      var label = type.charAt(0).toUpperCase() + type.slice(1);
      var tail = op.nodeId ? ' @' + op.nodeId.slice(-6) : '';
      return { label: label, tail: tail, index: idx };
    }

    function formatTimestamp(ts) {
      if (!ts) return '';
      var t = new Date(ts);
      if (isNaN(t.getTime())) return '';
      var now = Date.now();
      var diff = now - t.getTime();
      if (diff < 60000) return 'just now';
      if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
      if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
      return t.toLocaleDateString();
    }

    function renderHistoryList(ops, snaps) {
      var html = '';

      // ── SAVES section (user checkpoints) ──
      if (snaps && snaps.length > 0) {
        html += '<div class="history-section-head">Saves</div>';
        for (var s = 0; s < snaps.length; s++) {
          var snap = snaps[s];
          var ts2 = formatTimestamp(snap.createdAt);
          html += '<div class="history-entry save" data-snapshot-id="' + escape(snap.id) + '">' +
            '<div class="history-entry-dot save-dot"></div>' +
            '<div class="history-entry-body">' +
              '<div class="history-entry-label">' + escape(snap.label) + '</div>' +
              '<div class="history-entry-meta">' + snap.nodeCount + ' nodes \u00B7 rev ' + snap.revision + (ts2 ? ' \u00B7 ' + ts2 : '') + '</div>' +
            '</div>' +
            '<div class="history-entry-actions">' +
              '<button class="history-restore-btn" data-action="restore-snapshot" title="Load this save">Restore</button>' +
              '<button class="history-snap-delete" data-action="delete-snapshot" title="Delete this save" aria-label="Delete">\u00D7</button>' +
            '</div>' +
          '</div>';
        }
      }

      // ── EDITS section (auto ops log) ──
      if (ops && ops.length > 0) {
        html += '<div class="history-section-head">Edits</div>';
        // Current state marker at the top of edits
        html += '<div class="history-entry current">' +
          '<div class="history-entry-dot"></div>' +
          '<div class="history-entry-body">' +
            '<div class="history-entry-label">Current state</div>' +
            '<div class="history-entry-meta">HEAD \u00B7 ' + ops.length + ' op' + (ops.length === 1 ? '' : 's') + ' applied</div>' +
          '</div>' +
        '</div>';
        for (var i = ops.length - 1; i >= 0; i--) {
          var op = ops[i];
          var fmt = formatOpLabel(op, i);
          var ts = formatTimestamp(op.timestamp);
          // Revert button: undo all ops AFTER this one (count = ops.length - 1 - i)
          var undoCount = ops.length - 1 - i;
          html += '<div class="history-entry" data-op-index="' + i + '" data-undo-count="' + undoCount + '">' +
            '<div class="history-entry-dot"></div>' +
            '<div class="history-entry-body">' +
              '<div class="history-entry-label">' + escape(fmt.label) + '<span class="history-entry-tail">' + escape(fmt.tail) + '</span></div>' +
              '<div class="history-entry-meta">rev ' + (i + 1) + (ts ? ' \u00B7 ' + ts : '') + '</div>' +
            '</div>' +
            (undoCount > 0 ? '<button class="history-revert-btn" data-action="revert-to-rev" title="Undo ' + undoCount + ' later op' + (undoCount === 1 ? '' : 's') + ' to return here">Revert</button>' : '<span class="history-entry-latest">latest</span>') +
          '</div>';
        }
      }

      if (!html) {
        html = '<div class="history-empty">No history yet. Click <strong>Save current state</strong> below to create a checkpoint.</div>';
      }
      list.innerHTML = html;

      // Revert-to-revision (atomic server call, not loop)
      list.querySelectorAll('[data-action="revert-to-rev"]').forEach(function(revertBtn) {
        revertBtn.addEventListener('click', async function(ev) {
          ev.stopPropagation();
          var entry = revertBtn.closest('.history-entry');
          if (!entry) return;
          var targetIdx = parseInt(entry.getAttribute('data-op-index') || '-1', 10);
          var undoCount = parseInt(entry.getAttribute('data-undo-count') || '0', 10);
          if (undoCount <= 0) return;

          var ok = await customConfirm({
            kind: 'danger',
            title: 'Revert to this revision?',
            message: 'Undo <strong>' + undoCount + ' operation' + (undoCount === 1 ? '' : 's') + '</strong> applied after this point. Tip: click <strong>Save current state</strong> first if you want to keep the current version.',
            confirmText: 'Revert',
            cancelText: 'Cancel',
          });
          if (!ok) return;

          var sessionId = getSessionId();
          if (!sessionId) return;
          revertBtn.textContent = 'Reverting\u2026';
          revertBtn.setAttribute('disabled', 'true');
          try {
            await api('/platform/api/history/revert-to', { sceneId: sessionId, targetIndex: targetIdx });
            await loadHistory();
            if (debouncedRefreshViewports) debouncedRefreshViewports();
            if (debouncedRefreshAudit) debouncedRefreshAudit();
          } catch (err) {
            flash('Revert failed: ' + err, 'error');
            revertBtn.textContent = 'Revert';
            revertBtn.removeAttribute('disabled');
          }
        });
      });

      // Restore snapshot
      list.querySelectorAll('[data-action="restore-snapshot"]').forEach(function(restoreBtn) {
        restoreBtn.addEventListener('click', async function(ev) {
          ev.stopPropagation();
          var entry = restoreBtn.closest('.history-entry');
          var snapId = entry && entry.getAttribute('data-snapshot-id');
          if (!snapId) return;
          var sessionId = getSessionId();
          if (!sessionId) return;

          var ok = await customConfirm({
            kind: 'danger',
            title: 'Restore this save?',
            message: 'The current scene state will be replaced. Tip: click <strong>Save current state</strong> first if you want to keep the current version before loading.',
            confirmText: 'Restore',
            cancelText: 'Cancel',
          });
          if (!ok) return;

          restoreBtn.textContent = 'Restoring\u2026';
          restoreBtn.setAttribute('disabled', 'true');
          try {
            await api('/platform/api/history/restore', { sceneId: sessionId, snapshotId: snapId });
            await loadHistory();
            if (debouncedRefreshViewports) debouncedRefreshViewports();
            if (debouncedRefreshAudit) debouncedRefreshAudit();
            flash('Restored', 'success');
          } catch (err) {
            flash('Restore failed: ' + err, 'error');
            restoreBtn.textContent = 'Restore';
            restoreBtn.removeAttribute('disabled');
          }
        });
      });

      // Delete snapshot
      list.querySelectorAll('[data-action="delete-snapshot"]').forEach(function(delBtn) {
        delBtn.addEventListener('click', async function(ev) {
          ev.stopPropagation();
          var entry = delBtn.closest('.history-entry');
          var snapId = entry && entry.getAttribute('data-snapshot-id');
          if (!snapId) return;
          var sessionId = getSessionId();
          if (!sessionId) return;
          try {
            await api('/platform/api/history/snapshot-delete', { sceneId: sessionId, snapshotId: snapId });
            await loadHistory();
          } catch (_) {}
        });
      });
    }

    btn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      togglePanel();
    });

    // Click-outside to close
    document.addEventListener('click', function(ev) {
      if (panel.classList.contains('hidden')) return;
      if (!wrap.contains(ev.target)) closePanel();
    });
    // Escape to close
    document.addEventListener('keydown', function(ev) {
      if (ev.key === 'Escape' && !panel.classList.contains('hidden')) closePanel();
    });

    // Save current state button — creates a snapshot
    var saveBtn = wrap.querySelector('[data-action="history-save"]');
    if (saveBtn) {
      saveBtn.addEventListener('click', async function() {
        var sessionId = getSessionId();
        if (!sessionId) return;
        // Prompt for optional label via a custom prompt modal. Simpler
        // to use window.prompt for now since this is a cheap internal
        // tool — can theme it later if needed.
        var label = window.prompt('Name this save (optional):', '');
        if (label === null) return; // cancelled
        saveBtn.setAttribute('disabled', 'true');
        try {
          var res = await api('/platform/api/history/save', { sceneId: sessionId, label: label });
          if (res && res.ok) {
            flash('Saved: ' + (res.snapshot && res.snapshot.label), 'success');
            await loadHistory();
          } else {
            flash('Save failed', 'error');
          }
        } catch (err) {
          flash('Save failed: ' + err, 'error');
        } finally {
          saveBtn.removeAttribute('disabled');
        }
      });
    }

    // Clear history button
    if (clearBtn) {
      clearBtn.addEventListener('click', async function() {
        var sessionId = getSessionId();
        if (!sessionId) return;
        var ok = await customConfirm({
          kind: 'danger',
          title: 'Clear revision history?',
          message: 'All recorded ops will be discarded. The scene will be re-compiled from its source HTML the next time you edit. This cannot be undone.',
          confirmText: 'Clear history',
          cancelText: 'Cancel',
        });
        if (!ok) return;
        try {
          // There is no direct /platform endpoint for history_clear yet;
          // we fall through to reframe_project via the MCP bridge if the
          // user has a project. If nothing works, we just flash an error.
          var r = await fetch('/platform/api/history/clear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sceneId: sessionId }),
          });
          if (r.ok) {
            await loadHistory();
            flash('History cleared', 'success');
            if (debouncedRefreshViewports) debouncedRefreshViewports();
          } else {
            flash('Clear failed', 'error');
          }
        } catch (_) {
          flash('Clear failed', 'error');
        }
      });
    }

    // Refresh count badge on SSE scene:saved so the user sees the revision
    // counter climb without opening the panel.
    if (window.EventSource) {
      try {
        var es = new EventSource('/events');
        es.addEventListener('message', function(ev) {
          try {
            var data = JSON.parse(ev.data);
            if (data.type === 'scene:saved' || data.type === 'scene:session-changed') {
              // Debounce — only refresh the count, not full panel
              setTimeout(function() {
                var sessionId = getSessionId();
                if (!sessionId) return;
                api('/platform/api/ops?sceneId=' + encodeURIComponent(sessionId)).then(function(res) {
                  var ops = (res && res.ops) || [];
                  if (countBadge) {
                    if (ops.length > 0) {
                      countBadge.textContent = String(ops.length);
                      countBadge.classList.remove('hidden');
                    } else {
                      countBadge.classList.add('hidden');
                    }
                  }
                  // If panel is open, refresh the list too
                  if (!panel.classList.contains('hidden')) loadHistory();
                }).catch(function() {});
              }, 400);
            }
          } catch (_) {}
        });
      } catch (_) {}
    }
  }

  // ── Header toolbar: Undo/Redo, Tool modes, Export ─────
  function bindHeaderToolbar() {
    // Undo / Redo buttons
    var undoBtn = $('[data-action="undo"]');
    var redoBtn = $('[data-action="redo"]');
    if (undoBtn) undoBtn.addEventListener('click', undoLastOp);
    if (redoBtn) redoBtn.addEventListener('click', function() {
      flash('Redo: use Cmd+Z to undo further back');
      // Full redo stack requires server-side state — deferred to
      // timeline scrubber which gives visual access to any point.
    });

    // Tool mode selector (Select / Move / Lasso)
    $$('.tool-mode[data-tool-mode]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var mode = btn.getAttribute('data-tool-mode');
        $$('.tool-mode').forEach(function(b) { b.classList.toggle('active', b === btn); });
        // Set edit mode ON for Move/Lasso, keep current for Select.
        if (mode === 'move' || mode === 'lasso') {
          setEditMode(true);
          if (mode === 'lasso') {
            enterMode({ kind: 'lasso', polygon: [], active: false });
          } else {
            // Move mode = drag-live ready.
            if (state.selection.inode) {
              enterMode({ kind: 'drag-live', source: state.selection.inode, origin: null, delta: { dx: 0, dy: 0 }, active: false });
            }
          }
        }
      });
    });

    // Export dropdown toggle
    var exportBtn = $('.export-btn');
    var exportMenu = $('.export-menu');
    if (exportBtn && exportMenu) {
      exportBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        exportMenu.classList.toggle('hidden');
      });
      // Close on outside click.
      document.addEventListener('click', function() {
        if (exportMenu) exportMenu.classList.add('hidden');
      });
      // Export format buttons → open split-preview overlay.
      exportMenu.querySelectorAll('button[data-format]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var format = btn.getAttribute('data-format');
          exportMenu.classList.add('hidden');
          if (!format) return;
          var frame = $('.viewport-frame');
          var sessionId = frame ? frame.getAttribute('data-session') : null;
          if (!sessionId) { flash('No scene to export', 'error'); return; }
          showExportPreview(sessionId, format);
        });
      });
    }
  }

  // ── Edit mode toggle ─────────────────────────────────
  function setEditMode(on) {
    if (state.editMode === on) return;
    state.editMode = !!on;
    // Tell the iframe whether to block link navigation + show crosshair.
    postToIframe({ type: 'reframe:setMode', annotationMode: state.editMode });
    // Reflect on the shell so CSS can style accordingly (viewport frame
    // accent ring, EDIT pill in header, chip bar visibility).
    const app = $('.app');
    if (app) app.classList.toggle('edit-mode', state.editMode);
    // Leaving edit mode → drop any active submode + selection + hide
    // the floating chip bar. We want view mode to be truly quiet.
    if (!state.editMode) {
      if (state.mode) exitMode();
      clearSelection();
      clearMarkFocus();
      // Also drop any in-progress hover outline.
      state.hover.inode = null;
      state.hover.bbox = null;
      drawHoverOutline();
    }
    flash(state.editMode ? 'Edit mode on' : 'Edit mode off', state.editMode ? 'success' : undefined);
  }

  function bindEditToggle() {
    // The Edit button was removed from the floating canvas palette —
    // edit mode needs a per-scene surface and the canvas is multi-iframe.
    // Selector stays as a safety net in case some page still ships it.
    const btn = $('[data-edit-toggle]');
    if (!btn) return;
    btn.addEventListener('click', function() {
      setEditMode(!state.editMode);
    });
  }

  // ── Project overview health bar ──────────────────────
  async function refreshOverviewHealth() {
    var healthBar = $('[data-health-bar]');
    if (!healthBar) return;
    try {
      var res = await api('/platform/api/project/health');
      if (!res.ok) return;
      var s = res.summary;
      healthBar.innerHTML =
        '<div class="health-item"><span class="health-dot ok"></span><span class="health-label">AUDIT</span> ' +
          s.clean + ' clean' +
          (s.warn > 0 ? ' \u00B7 ' + s.warn + ' warn' : '') +
          (s.fail > 0 ? ' \u00B7 ' + s.fail + ' fail' : '') +
        '</div>' +
        '<div class="health-item"><span class="health-dot neutral"></span><span class="health-label">RESPONSIVE</span> ' +
          s.responsive + '/' + s.total + ' scenes' +
        '</div>' +
        '<div class="health-item"><span class="health-dot neutral"></span><span class="health-label">AI</span> ' +
          s.totalThreads + ' thread' + (s.totalThreads === 1 ? '' : 's') +
        '</div>' +
        (s.activeBrand ? '<div class="health-item"><span class="health-dot ok"></span><span class="health-label">BRAND</span> ' + escape(s.activeBrand) + '</div>' : '');
    } catch (_) {
      healthBar.innerHTML = '<span class="health-loading">Health data unavailable</span>';
    }
  }

  // ── Export split-preview overlay ──────────────────────
  function showExportPreview(sessionId, format) {
    var previewUrl = '/preview/' + sessionId;
    var exportUrl = '/preview/' + sessionId + '.' + format;
    var isCode = (format === 'react' || format === 'tsx');

    var overlay = document.createElement('div');
    overlay.className = 'export-preview show';
    overlay.innerHTML =
      '<div class="export-preview-panel">' +
        '<div class="export-preview-head">' +
          '<span class="title">Export preview</span>' +
          '<span class="format-tag">' + escape(format.toUpperCase()) + '</span>' +
          '<a class="btn btn-primary btn-sm download-btn" href="' + escape(exportUrl) + '" target="_blank" download>Download</a>' +
          '<button class="close-btn">\u00D7</button>' +
        '</div>' +
        '<div class="export-preview-body">' +
          '<div class="export-preview-left"><iframe src="' + escape(previewUrl) + '"></iframe></div>' +
          '<div class="export-preview-right">' +
            (isCode
              ? '<iframe src="' + escape(exportUrl) + '"></iframe>'
              : '<iframe src="' + escape(exportUrl) + '"></iframe>') +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('.close-btn').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  }

  // ── Layers tree (sidebar) ─────────────────────────────
  // Fetches the node tree of the current scene and renders it as a
  // clickable hierarchy in the sidebar. Click a layer → selects that
  // node in the viewport + shows Properties Inspector.

  async function refreshLayersTree() {
    var container = $('[data-layers-tree]');
    if (!container) return;
    var frame = $('.viewport-frame');
    var sessionId = frame ? frame.getAttribute('data-session') : null;
    if (!sessionId) {
      container.innerHTML = '<div class="sidebar-empty">No scene</div>';
      return;
    }
    try {
      var res = await api('/platform/api/scene/tree?sceneId=' + encodeURIComponent(sessionId));
      if (!res.ok || !res.tree) {
        container.innerHTML = '<div class="sidebar-empty">Failed to load</div>';
        return;
      }
      container.innerHTML = renderLayerNode(res.tree, 0);
      bindLayerClicks(sessionId);
    } catch (_) {
      container.innerHTML = '<div class="sidebar-empty">Error</div>';
    }
  }

  function renderLayerNode(node, depth) {
    if (!node) return '';

    // Absorb single-TEXT-child into parent: if this node has exactly
    // one child of type TEXT, show the text inline and skip the child.
    var absorbedText = '';
    var effectiveChildren = node.children || [];
    if (effectiveChildren.length === 1 && effectiveChildren[0].type === 'TEXT') {
      absorbedText = effectiveChildren[0].text || effectiveChildren[0].name || '';
      effectiveChildren = []; // Don't render the child separately.
    }
    // Also absorb own text if this IS a TEXT node with no children.
    if (node.type === 'TEXT' && effectiveChildren.length === 0) {
      absorbedText = node.text || node.name || '';
    }

    // Determine display name: semantic role > meaningful name > tag.
    var rawName = (node.name || '').toLowerCase();
    var displayName = node.name || '?';
    // If name is just a generic HTML tag, try to make it more meaningful.
    // e.g. "div" with children → "Container", "section" → "Section"
    var FRIENDLY = {
      div: 'Container', span: 'Span', section: 'Section',
      header: 'Header', footer: 'Footer', main: 'Main',
      nav: 'Nav', article: 'Article', aside: 'Aside',
      ul: 'List', ol: 'List', li: 'Item',
      a: 'Link', img: 'Image', p: 'Paragraph',
      h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3',
      h4: 'Heading 4', h5: 'Heading 5', h6: 'Heading 6',
      button: 'Button', input: 'Input', form: 'Form',
    };
    if (FRIENDLY[rawName]) displayName = FRIENDLY[rawName];
    // TEXT nodes without absorbed text → show "Text"
    if (node.type === 'TEXT' && !absorbedText) displayName = 'Text';

    var indent = depth * 16;
    var hasChildren = effectiveChildren.length > 0;
    var collapsed = depth >= 2 && hasChildren; // Auto-collapse deep levels.
    var toggleIcon = hasChildren
      ? '<span class="layer-toggle">' + (collapsed ? '\u25B8' : '\u25BE') + '</span>'
      : '<span class="layer-toggle-spacer"></span>';

    // Type badge — small, subtle, right-aligned.
    var typeBadge = node.type === 'TEXT' ? '' :
      '<span class="layer-badge">' + escape(rawName) + '</span>';

    // Text preview inline (absorbed from child or own text).
    var textEl = absorbedText
      ? '<span class="layer-text">\u201C' + escape(absorbedText.slice(0, 24)) + (absorbedText.length > 24 ? '\u2026' : '') + '\u201D</span>'
      : '';

    var html = '<div class="layer-item" data-layer-node="' + escape(node.id) + '" style="padding-left:' + (4 + indent) + 'px">' +
      toggleIcon +
      '<span class="layer-name">' + escape(displayName) + '</span>' +
      textEl +
      typeBadge +
    '</div>';

    if (hasChildren) {
      html += '<div class="layer-children' + (collapsed ? ' collapsed' : '') + '" data-layer-group>';
      for (var i = 0; i < effectiveChildren.length; i++) {
        html += renderLayerNode(effectiveChildren[i], depth + 1);
      }
      html += '</div>';
    }
    return html;
  }

  function bindLayerClicks(sessionId) {
    $$('[data-layer-node]').forEach(function(el) {
      el.addEventListener('click', function(e) {
        // If click was on the toggle arrow → expand/collapse, don't select.
        if (e.target && e.target.classList && e.target.classList.contains('layer-toggle')) {
          var group = el.nextElementSibling;
          if (group && group.hasAttribute('data-layer-group')) {
            group.classList.toggle('collapsed');
            // Update arrow direction.
            e.target.textContent = group.classList.contains('collapsed') ? '\u25B8' : '\u25BE';
          }
          return;
        }
        var nodeId = el.getAttribute('data-layer-node');
        if (!nodeId) return;
        $$('[data-layer-node]').forEach(function(e) { e.classList.remove('selected'); });
        el.classList.add('selected');
        state.selection.inode = nodeId;
        state.selection.tag = '';
        state.selection.bbox = null;
        var m = state.measurements.get(nodeId);
        if (m) {
          state.selection.bbox = m.bbox;
          state.selection.tag = m.tag || '';
          drawSelectOutline();
          if (state.editMode) showSelectionToolbar();
        }
        showPropsForNode(nodeId, sessionId);
        postToIframe({ type: 'reframe:highlight', inode: nodeId });
      });
    });
  }

  // ── Sidebar actions (New scene, Switch brand) ────────
  function bindSidebarActions() {
    var newSceneBtn = $('[data-action="new-scene"]');
    if (newSceneBtn) {
      newSceneBtn.addEventListener('click', function() {
        showVerbPanel('New scene',
          '<textarea class="ask-input" style="height:80px;resize:vertical;font-family:var(--mono);font-size:12px" data-vp-field="html" placeholder="Paste HTML here\u2026"></textarea>' +
          '<div class="ask-hint">Paste your HTML \u00B7 the engine will compile it into a scene</div>',
          function(panel) {
            var textarea = panel.querySelector('[data-vp-field="html"]');
            var html = textarea ? textarea.value.trim() : '';
            if (!html) { flash('Paste HTML to create a scene'); return; }
            api('/platform/api/intent/add', {
              parts: [{ kind: 'text', value: 'compile this HTML: ' + html.slice(0, 500) }],
            }).then(function() {
              flash('Intent queued \u2014 agent will compile', 'success');
            }).catch(function() {});
          }
        );
      });
    }
    var switchBrandBtn = $('[data-action="switch-brand"]');
    if (switchBrandBtn) {
      switchBrandBtn.addEventListener('click', openBrandBrowser);
    }
  }

  // ── Timeline scrubber (bottom bar) ───────────────────
  // Fetches ops history and renders dots on the timeline track.
  // Drag the handle to scrub through history (undo to that point).

  var timelineOps = [];

  async function refreshTimeline() {
    var frame = $('.viewport-frame');
    var sessionId = frame ? frame.getAttribute('data-session') : null;
    if (!sessionId) return;
    try {
      var res = await api('/platform/api/ops?sceneId=' + encodeURIComponent(sessionId));
      timelineOps = res.ops || [];
      renderTimelineDots();
    } catch (_) {}
  }

  function renderTimelineDots() {
    var opsContainer = $('.bottom-bar .timeline-ops');
    if (!opsContainer) return;
    if (timelineOps.length === 0) {
      opsContainer.innerHTML = '';
      return;
    }
    opsContainer.innerHTML = timelineOps.map(function(op) {
      return '<div class="timeline-op" title="' + escape(op.type + (op.nodeId ? ' @' + op.nodeId.slice(-6) : '')) + '"></div>';
    }).join('');
    // Position handle at the end (current state = latest op).
    var handle = $('.bottom-bar .timeline-handle');
    if (handle) handle.style.right = '0';
  }

  function bindTimelineScrubber() {
    var track = $('.bottom-bar .timeline-track');
    var handle = $('.bottom-bar .timeline-handle');
    if (!track || !handle) return;

    var dragging = false;

    handle.addEventListener('pointerdown', function(e) {
      dragging = true;
      e.preventDefault();
      try { handle.setPointerCapture(e.pointerId); } catch (_) {}
    });
    document.addEventListener('pointermove', function(e) {
      if (!dragging) return;
      var rect = track.getBoundingClientRect();
      var x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      var pct = x / rect.width;
      handle.style.left = (pct * 100) + '%';
      handle.style.right = 'auto';
      // Show tooltip with op index.
      var idx = Math.round(pct * (timelineOps.length - 1));
      if (idx >= 0 && idx < timelineOps.length) {
        handle.title = 'Op ' + (idx + 1) + '/' + timelineOps.length + ': ' + (timelineOps[idx].type || '?');
      }
    });
    document.addEventListener('pointerup', function() {
      if (!dragging) return;
      dragging = false;
      // On release: undo everything after the drop point.
      var rect = track.getBoundingClientRect();
      var pct = parseFloat(handle.style.left) / 100;
      if (isNaN(pct)) return;
      var targetIdx = Math.round(pct * (timelineOps.length - 1));
      var undoCount = timelineOps.length - 1 - targetIdx;
      if (undoCount > 0) {
        (async function() {
          for (var i = 0; i < undoCount; i++) {
            await undoLastOp();
          }
          refreshTimeline();
        })();
      }
    });

    // Click on audit summary → refresh audit.
    var auditSummary = $('.bottom-bar .audit-summary');
    if (auditSummary) {
      auditSummary.addEventListener('click', refreshAudit);
    }
  }

  // ── Brand browser overlay ────────────────────────────
  async function openBrandBrowser() {
    var existing = $('.brand-browser');
    if (existing) { existing.classList.add('show'); return; }
    // Fetch brands.
    var brands = [];
    try {
      var res = await api('/platform/api/brands');
      brands = res.brands || [];
    } catch (_) {}
    // Build overlay.
    var overlay = document.createElement('div');
    overlay.className = 'brand-browser show';
    var cardsHtml = brands.length === 0
      ? '<div style="padding:40px;text-align:center;color:var(--text-tertiary)">No brands registered. Use reframe_design to load one.</div>'
      : brands.map(function(b) {
          return '<button class="brand-card" data-brand-slug="' + escape(b.slug || b.name || '') + '">' +
            '<div class="brand-name">' + escape(b.name || b.slug || '?') + '</div>' +
            '<div class="brand-font">' + escape(b.slug || '') + '</div>' +
          '</button>';
        }).join('');
    overlay.innerHTML =
      '<div class="brand-browser-panel">' +
        '<div class="brand-browser-head">' +
          '<span class="title">Switch brand</span>' +
          '<button class="close-btn">\u00D7</button>' +
        '</div>' +
        '<div class="brand-browser-search">' +
          '<input type="text" placeholder="Search brands\u2026">' +
        '</div>' +
        '<div class="brand-browser-grid">' + cardsHtml + '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    // Close.
    overlay.querySelector('.close-btn').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    // Search.
    var searchInput = overlay.querySelector('.brand-browser-search input');
    if (searchInput) {
      searchInput.addEventListener('input', function() {
        var q = searchInput.value.toLowerCase();
        overlay.querySelectorAll('.brand-card').forEach(function(card) {
          var name = card.getAttribute('data-brand-slug') || '';
          card.style.display = name.indexOf(q) >= 0 ? '' : 'none';
        });
      });
      searchInput.focus();
    }
    // Brand card click → switch.
    overlay.querySelectorAll('.brand-card').forEach(function(card) {
      card.addEventListener('click', async function() {
        var slug = card.getAttribute('data-brand-slug');
        if (!slug) return;
        try {
          await api('/platform/api/brand/switch', { slug: slug });
          flash('Brand: ' + slug, 'success');
          overlay.remove();
          // Re-render preview with new brand tokens.
          refreshViewports();
          // Update sidebar brand label.
          var brandLabel = $('.brand-label');
          if (brandLabel) brandLabel.textContent = slug;
        } catch (_) {}
      });
    });
  }

  // ── Theme toggle ─────────────────────────────────────
  function bindThemeToggle() {
    const btn = $('[data-theme-toggle]');
    if (!btn) return;
    btn.addEventListener('click', function() {
      const current = document.documentElement.getAttribute('data-theme');
      // Cycle: (unset/system) → light → dark → unset → ...
      let next;
      if (current === 'light') next = 'dark';
      else if (current === 'dark') next = null;
      else next = 'light';
      if (next) {
        document.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem('reframe-theme', next); } catch (_) {}
      } else {
        document.documentElement.removeAttribute('data-theme');
        try { localStorage.removeItem('reframe-theme'); } catch (_) {}
      }
      flash('Theme: ' + (next || 'system'));
      // Re-render annotations — accent colors shifted, marks need repaint.
      renderAllAnnotations();
    });
  }

  // ── Init ─────────────────────────────────────────────
  function init() {
    const appEl = $('.app');
    if (appEl) state.currentSceneSlug = appEl.getAttribute('data-scene') || null;
    // Initialize original viewport dims from scene data
    var vpFrame = $('.viewport-frame');
    if (vpFrame) {
      var ow = parseInt(vpFrame.getAttribute('data-orig-w') || '1440', 10);
      var oh = parseInt(vpFrame.getAttribute('data-orig-h') || '2000', 10);
      VIEWPORT_DIMS.original = { w: ow, h: oh };
      state.currentViewport = 'original';
    }
    // Install debounced refreshers — SSE bursts (3-5 events per user
    // action) are now coalesced into one refresh cycle. Timings tuned so
    // the UI feels responsive but doesn't thrash the network:
    //   viewports  500ms — iframe reloads are expensive (full scene re-export)
    //   annotations 300ms — cheap DOM update, should feel immediate
    //   stream     800ms — intent/annotation list is background context
    //   audit     1000ms — audit is the heaviest (full graph walk + rules)
    debouncedRefreshViewports   = debounce(refreshViewports, 500);
    debouncedRefreshAnnotations = debounce(refreshAnnotations, 300);
    debouncedRefreshStream      = debounce(refreshStream, 800);
    debouncedRefreshAudit       = debounce(refreshAudit, 1000);

    // When CanvasKit canvas is present, skip old interaction handlers
    // that would conflict with OP editor's pointer/wheel events.
    var hasCanvasKit = !!document.getElementById('reframe-viewport');

    subscribeSSE();
    if (hasCanvasKit) {
      // ── Bridge OP canvas selection → platform properties panel ──
      // OP viewport dispatches 'reframe:canvas-select' when user clicks
      // a node on the CanvasKit canvas. Wire it to showPropsForNode so
      // the right-panel Design tab populates correctly.
      window.addEventListener('reframe:canvas-select', function(evt) {
        var detail = evt.detail || {};
        var nodeId = detail.nodeId;
        var frame = $('.viewport-frame') || document.getElementById('reframe-viewport');
        var sessionId = frame ? (frame.getAttribute('data-session') || frame.dataset.session) : null;
        if (!sessionId) {
          // Fallback: try to find session from any scene slug in the app
          var appEl = $('.app');
          sessionId = appEl ? appEl.getAttribute('data-scene') : null;
        }
        if (nodeId && sessionId) {
          // Auto-switch to Design tab so user sees properties
          var designTab = $('[data-tab="design"]');
          if (designTab && !designTab.classList.contains('active')) {
            $$('.right-tab').forEach(function(t) { t.classList.remove('active'); });
            designTab.classList.add('active');
            $$('[data-panel]').forEach(function(p) { p.classList.add('hidden'); });
            var designPanel = $('[data-panel="design"]');
            if (designPanel) designPanel.classList.remove('hidden');
          }
          showPropsForNode(nodeId, sessionId);
        } else {
          clearPropsPanel();
        }
      });
      // Bridge canvas changes → persist to server + refresh properties.
      // When user drags or resizes on OP canvas, persist the change to
      // the reframe INode graph via POST /platform/api/node/edit so the
      // data survives page reload and stays in sync with audit/export.
      function getCanvasSessionId() {
        var frame = $('.viewport-frame') || document.getElementById('reframe-viewport');
        return frame ? (frame.getAttribute('data-session') || frame.dataset.session) : null;
      }

      window.addEventListener('reframe:node-moved', function(evt) {
        var detail = evt.detail || {};
        var sessionId = getCanvasSessionId();
        if (!detail.nodeId || !sessionId) return;
        // Persist position to server (fire-and-forget)
        api('/platform/api/node/edit', {
          sceneId: sessionId,
          nodeId: detail.nodeId,
          props: { x: detail.x, y: detail.y },
        }).catch(function() {});
        // Refresh properties panel if this node is selected
        if (currentPropsNodeId === detail.nodeId) {
          showPropsForNode(detail.nodeId, sessionId);
        }
      });

      window.addEventListener('reframe:node-resized', function(evt) {
        var detail = evt.detail || {};
        var sessionId = getCanvasSessionId();
        if (!detail.nodeId || !sessionId) return;
        // Persist size + position to server
        var edits = { width: detail.width, height: detail.height };
        if (detail.x != null) edits.x = detail.x;
        if (detail.y != null) edits.y = detail.y;
        api('/platform/api/node/edit', {
          sceneId: sessionId,
          nodeId: detail.nodeId,
          props: edits,
        }).catch(function() {});
        if (currentPropsNodeId === detail.nodeId) {
          showPropsForNode(detail.nodeId, sessionId);
        }
      });
      // OP canvas is always in "edit mode" — set state so CSS classes work
      state.editMode = true;
      var appEl2 = $('.app');
      if (appEl2) appEl2.classList.add('edit-mode');
    } else {
      bindPreviewBridge();
      bindGesturePointerSubstrate();
      bindViewportSwitcher();
      bindCanvas();
      bindEditToggle();
      bindTimelineScrubber();
    }
    bindStreamActions();
    bindStreamInput();
    bindEmptyLauncher();
    bindOverviewDelete();
    bindOverviewProjectDelete();
    bindHistoryDropdown();
    bindResizablePanels();
    bindKeyboard();
    bindThemeToggle();
    bindRightTabs();
    bindRebrandPanel();
    bindVaryGridButton();
    bindStreamClearBtn();
    bindMacroApplyBtns();
    bindHeaderToolbar();
    bindSidebarActions();
    bindContextMenu();
    bindBatchExport();
    bindVariantStrip();
    bindPipelineStepper();
    bindBrandPicker();
    refreshAnnotations();
    // Run audit + timeline after measurements arrive (deferred —
    // measurements come async via postMessage from the inject script).
    //
    // Auto-enable edit mode on SCENE pages only. On the project canvas
    // (multi-iframe pan/zoom) the edit-mode hover/click overlays are
    // wired for a single iframe at a known layout — they don't work on
    // multiple artboards at arbitrary world-coord positions, and worse,
    // preview-inject.ts calls preventDefault() on every pointerdown in
    // annotation mode, which kills native interaction inside the iframe.
    // Canvas users want to click/scroll inside scenes natively; the
    // Edit tool in the floating palette still lets them opt-in manually.
    var onCanvas = !!document.querySelector('[data-canvas-viewport]');
    if (!onCanvas) {
      setTimeout(function() {
        state.editMode = false; // ensure setEditMode detects change
        setEditMode(true);
        // Suppress the flash notification on auto-start
      }, 500);
    }
    // Fit original viewport to available space (skip on CanvasKit pages).
    if (!hasCanvasKit) {
      setTimeout(fitOriginalViewport, 100);
      window.addEventListener('resize', fitOriginalViewport);
    }
    setTimeout(function() { refreshAudit(); refreshTimeline(); refreshLayersTree(); }, 600);
    // Reposition chip bar + re-render marks on window resize.
    window.addEventListener('resize', function() {
      repositionChipBar();
      renderAllAnnotations();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;
