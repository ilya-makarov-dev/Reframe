
(function() {
  'use strict';

  // ── Persisted state restore ────────────────────────────
  // Keyed by project slug so two open projects don't trample each
  // other. Server inlines the slug at render time via data-scene on
  // `.app`; read it once here, use it for both read + write.
  const REFRAME_UI_STATE_KEY = (function() {
    try {
      var el = document.querySelector('.app[data-scene]') || document.getElementById('app');
      var slug = el && el.getAttribute ? el.getAttribute('data-scene') : '';
      return 'reframe.ui.state.' + (slug || '_');
    } catch (_) { return 'reframe.ui.state._'; }
  })();
  function loadPersistedState() {
    try {
      var raw = localStorage.getItem(REFRAME_UI_STATE_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};
      // Validate the persisted id against the current scene's layers
      // tree. Ids are session-scoped for variant scenes (OP `0:xxx`
      // format), so a persisted id from a previous session may be a
      // ghost. We can't reach into the scene graph this early — but
      // the boot payload carries the active layer tree. If the id is
      // absent there, drop it and fall back to "no selection".
      try {
        var boot = window.__REFRAME_BOOT__;
        var knownIds = new Set();
        var walk = function(n) { if (!n) return; if (n.id) knownIds.add(n.id); (n.children||[]).forEach(walk); };
        if (boot && boot.tree) walk(boot.tree);
        if (typeof parsed.selectionInode === 'string'
            && knownIds.size > 0
            && !knownIds.has(parsed.selectionInode)) {
          parsed.selectionInode = null;
        }
      } catch (_) {}
      return parsed;
    } catch (_) {}
    return {};
  }
  const _persisted = loadPersistedState();
  // Call after any mutation of `state.selection.inode` or
  // `state.currentViewport`. Cheap — just a JSON.stringify of two
  // scalars. Silently no-ops in private mode / quota-exceeded browsers
  // (the feature is a UX nicety, not a correctness primitive).
  function persistUiState() {
    try {
      localStorage.setItem(REFRAME_UI_STATE_KEY, JSON.stringify({
        currentViewport: state.currentViewport,
        selectionInode: state.selection && state.selection.inode,
        selectionTag: state.selection && state.selection.tag,
      }));
    } catch (_) {}
    // Let the chip bar (and any other passive UI watchers) redraw
    // without having to wire a bespoke callback into every caller. Any
    // module that cares can subscribe to `reframe:ui-state-changed`.
    try {
      window.dispatchEvent(new CustomEvent('reframe:ui-state-changed'));
    } catch (_) {}
  }
  // expose to other modules — the bundle runs in a single IIFE
  // scope, so this lands as a plain reference rather than a global.

  // ── State ──────────────────────────────────────────────
  const state = {
    currentSceneSlug: null,
    // Viewport mode — persisted so the user doesn't drop back to
    // desktop on every reload after setting Preview → Mobile. The chip
    // bar + the macro toolbar both read this value to drive their UI.
    currentViewport: _persisted.currentViewport || 'desktop',
    // Edit mode — when OFF (default), the preview is a live interactive
    // preview. Hover states, link clicks, scroll — all native iframe
    // behaviour. When ON, the gesture layer activates: hover outlines
    // track nodes, clicks select + open chip bar, verbs respond to
    // hotkeys. Toggle via header button or "E" key. Marks (persistent
    // annotations) remain visible + clickable in BOTH modes.
    editMode: false,
    hover: { inode: null, bbox: null },
    // Selection — inode persists across reload so the user returns to
    // the same node they left. bbox + tag are measurement-derived and
    // get re-hydrated by the postMessage `reframe:measurements` pump
    // after the iframe loads, so we don't need to persist them.
    selection: {
      inode: _persisted.selectionInode || null,
      bbox: null,
      tag: _persisted.selectionTag || null,
    },
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

  // ── Boot payload accessor ───────────────────────────────
  // The editor shell inlines `window.__REFRAME_BOOT__` so clients skip
  // the initial fetch waterfall (audit, tree, annotations, tokens,
  // agent health, scene root). Each consumer calls `bootScene(sceneId)`
  // to get pre-hydrated data for its section; if null, it falls back
  // to the legacy fetch path. After the first use we MARK the payload
  // as consumed (per-section) so subsequent SSE-driven refreshes go
  // straight to the network — the inlined data is only ever valid at
  // page load. `consumeBootSection` returns the value once and nulls
  // it so stale data can't be served on the second call.
  function bootScene(sceneId) {
    var b = window.__REFRAME_BOOT__;
    if (!b || !b.scenes) return null;
    // Default to the active scene when the caller doesn't know which
    // id it's looking at yet (early init paths).
    var id = sceneId || b.activeSceneId;
    if (!id) return null;
    return b.scenes[id] || null;
  }
  function consumeBootSection(sceneId, section) {
    var scene = bootScene(sceneId);
    if (!scene) return null;
    var v = scene[section];
    if (v === undefined || v === null) return null;
    // Null out so a later refresh on the same section skips the stale
    // snapshot. We keep the scene record — other sections may still
    // be unconsumed.
    scene[section] = null;
    return v;
  }
  function bootAgent() {
    var b = window.__REFRAME_BOOT__;
    return (b && b.agent) || null;
  }

  // ── DOM helpers ────────────────────────────────────────
  function $(s, root) { return (root || document).querySelector(s); }
  function $$(s, root) { return Array.from((root || document).querySelectorAll(s)); }

  function escape(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Toast system.
  //   flash('saved')                            → neutral info, auto-dismiss ~2.4s
  //   flash('ok', 'success')                    → success tint, auto-dismiss
  //   flash('warn', 'warning')                  → warning tint, auto-dismiss
  //   flash('failed', 'error')                  → error tint, STICKY (manual × to dismiss)
  //   flash('done', 'success', { duration: 5000 })       → explicit duration
  //   flash('need a redo', 'error', { action: { label: 'Retry', onClick: fn } })
  //                                             → clickable action inside the toast
  //   flash('queued', 'info', { sticky: true }) → force stick even for info
  //
  // Multiple toasts stack vertically in a fixed container so a fast burst
  // (save + compile + audit) doesn't overwrite itself. Auto-dismiss shows
  // a thin countdown bar along the bottom; the bar is the source of truth
  // — CSS animation drives visual countdown, matching JS setTimeout.
  function flash(message, kind, opts) {
    opts = opts || {};
    var type = kind || 'info';
    var sticky = opts.sticky != null ? !!opts.sticky : (type === 'error');
    var duration = Number(opts.duration) > 0 ? Number(opts.duration) : 2400;

    var host = document.getElementById('reframe-flash-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'reframe-flash-host';
      host.className = 'flash-host';
      document.body.appendChild(host);
    }

    var el = document.createElement('div');
    el.className = 'flash flash--' + type + (sticky ? ' flash--sticky' : '');
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');

    var msg = document.createElement('span');
    msg.className = 'flash-msg';
    msg.textContent = message;
    el.appendChild(msg);

    if (opts.action && opts.action.label && typeof opts.action.onClick === 'function') {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'flash-action';
      btn.textContent = opts.action.label;
      btn.addEventListener('click', function() {
        try { opts.action.onClick(); } catch (_) {}
        dismiss();
      });
      el.appendChild(btn);
    }

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'flash-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';
    close.addEventListener('click', dismiss);
    el.appendChild(close);

    var timerHandle = null;
    var dismissed = false;
    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      if (timerHandle) { clearTimeout(timerHandle); timerHandle = null; }
      el.classList.remove('show');
      setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
    }

    if (!sticky) {
      var bar = document.createElement('div');
      bar.className = 'flash-countdown';
      bar.style.animationDuration = duration + 'ms';
      el.appendChild(bar);
      timerHandle = setTimeout(dismiss, duration);
    }

    host.appendChild(el);
    requestAnimationFrame(function() { el.classList.add('show'); });
    return { dismiss: dismiss, el: el };
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
        // Phase 1 UI-4 — refresh the LAYERS tree so visibility / lock /
        // rename edits flip the row icons in real time. Without this
        // the layers panel stayed pinned to import-time state because
        // refreshLayersTree() was only called from explicit gesture
        // paths (020-selection.js add-frame / add-text), never from
        // the generic scene mutation channel. Function is internally
        // debounced (~120ms) so multiple events coalesce.
        if (typeof refreshLayersTree === 'function') refreshLayersTree();
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
        case 'reframe:iframe-error':
          onIframeError(data);
          break;
        case 'reframe:rects':
          // Watched-selector broadcast. Fan out to subscribers via a
          // window event so multiple consumers (future pin overlay,
          // comment bubbles) can react without a central registry.
          try {
            window.dispatchEvent(new CustomEvent('reframe:iframe-rects', {
              detail: { sceneId: data.__canvasSceneId, entries: data.entries || [] },
            }));
          } catch (_) { /* CustomEvent unsupported */ }
          break;
      }
    });
  }

  // Iframe runtime errors → non-modal toast. Errors from scene code
  // (bad inline script, broken font fetch, thrown promise in a data
  // viz) are otherwise invisible. We throttle to one toast per unique
  // message per 30s so a repeating error doesn't blanket the screen —
  // the iframe's console still has the full stream for debugging.
  //
  // Designer-facing copy: raw JS exceptions are intimidating ("Uncaught
  // TypeError: Cannot read property 'foo' of undefined") and rarely
  // actionable for someone who didn't write the code. Translate the
  // common ones to plain language while keeping the original available
  // via the toast's hover-title.
  var _iframeErrorSeen = Object.create(null);
  function humanizeError(raw, kind) {
    var s = String(raw || '');
    if (!s) return 'Something went wrong in the preview.';
    if (kind === 'unhandledrejection') {
      return 'The scene kicked off an async task that failed: ' + s;
    }
    // Common React/JS patterns with designer-friendly re-phrasings.
    var m;
    if (/Cannot read propert(?:y|ies) .+ of (?:undefined|null)/.test(s)) {
      m = s.match(/propert(?:y|ies) ['"]?([^'"]+)['"]? of/);
      var prop = m ? m[1] : 'something';
      return 'Scene code tried to read "' + prop + '" from a value that wasn\'t there.';
    }
    if (/is not (?:a )?function/.test(s)) {
      m = s.match(/(\S+)\s+is not/);
      return 'Scene code called ' + (m ? m[1] : 'something') + ' like a function, but it wasn\'t one.';
    }
    if (/Failed to (?:fetch|load)/i.test(s) || /net::/i.test(s)) {
      return 'Scene couldn\'t load a resource (font, image, or script). Check the URL.';
    }
    if (/Content Security Policy|Refused to (?:load|execute)/i.test(s)) {
      return 'A browser security rule blocked scene content — likely an inline script or remote asset.';
    }
    if (/SyntaxError/i.test(s)) {
      return 'Scene has a syntax error in its inline script — check the last edit.';
    }
    if (/ResizeObserver loop/i.test(s)) {
      // Non-actionable browser noise — silenced upstream but add a floor.
      return '';
    }
    // Fallback — strip noisy prefixes designers don't care about.
    return s.replace(/^(Uncaught\s+)?(?:\w+Error)\s*:\s*/, '').slice(0, 180);
  }
  function onIframeError(data) {
    if (!data || typeof data.message !== 'string') return;
    var humanized = humanizeError(data.message, data.kind);
    if (!humanized) return; // filter known non-actionable noise
    var key = (data.kind || 'error') + ':' + humanized;
    var now = Date.now();
    if (_iframeErrorSeen[key] && (now - _iframeErrorSeen[key]) < 30000) return;
    _iframeErrorSeen[key] = now;
    var loc = '';
    if (data.source) {
      var src = data.source.split('/').pop();
      loc = ' · ' + src + (typeof data.lineno === 'number' ? ':' + data.lineno : '');
    }
    var toast = flash('Scene error' + loc + ': ' + humanized, 'error');
    // Keep the raw message accessible via title for anyone who wants the
    // exact exception — the humanized copy is the headline, raw is the
    // footnote. flash() returns {dismiss, el} so this is safe when the
    // implementation permits.
    if (toast && toast.el && toast.el.setAttribute) {
      toast.el.setAttribute('title', data.message);
    }
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
    // Persist any concrete id — loadPersistedState at boot validates
    // that the id actually matches a node in the current scene before
    // restoring. Previous version over-filtered to `h:*` + `s\d+:*`
    // which happened to exclude the `0:*` ids the variant-scene
    // classifier emits for nodes missing stable hash ids, so selection
    // appeared to never persist on those scenes.
    if (typeof data.inode === 'string' && data.inode) persistUiState();
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
    if (typeof data.inode === 'string' && data.inode) persistUiState();
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
    // Deliberately do NOT persist null here. clearSelection fires on
    // canvas-blur, iframe reload, and various transient lifecycle
    // points that are not a user intent to "forget my selection" —
    // persisting null on those wipes the reload-restore we just did
    // three lines earlier in boot. The user's last explicit selection
    // should survive noise. It only gets overwritten when the user
    // actively selects a new node (onPreviewSelect / LAYERS click /
    // canvas-select, all of which DO persist).
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
