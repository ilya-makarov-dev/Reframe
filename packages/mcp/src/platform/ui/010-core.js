
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
    agentPanelLoaded: false,
    agentSessionId: null, // for --resume multi-turn
    agentChatId: null,    // current in-flight chat id (for cancel)
    agentReader: null,    // ReadableStream reader for the active SSE response
    agentToolMap: {},     // tool_use id → DOM element (for inline tool_result wiring)
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
