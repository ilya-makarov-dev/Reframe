  function init() {
    // The scene-slug carrier is either `.app` (baseShell) or `#app`
    // (editor-shell). Both set data-scene to the current project slug.
    const appEl = $('.app') || document.getElementById('app');
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
        // Mirror selection into shared state so right-panel + chat chip
        // + persisted-reload all see the same thing. The OP canvas was
        // the one selection source that didn't write back; clicking on
        // canvas left LAYERS and the chip showing the *previous*
        // selection while the right panel rendered the new node.
        //
        // Guard: only write ids that actually live in the scene
        // (data-layer-node attrs). OP fires auto-selection events for
        // layout helpers / selection handles whose ids never appear
        // in LAYERS; without this guard those clobber a
        // LAYERS-click-persisted selection on every reload.
        if (nodeId && state && state.selection) {
          var knownInLayers = !!document.querySelector('[data-layer-node="' + CSS.escape(nodeId) + '"]');
          if (knownInLayers) {
            state.selection.inode = nodeId;
            state.selection.tag = state.selection.tag || '';
            try { persistUiState(); } catch (_) {}
          }
        }
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

      // Helper — true while StoreSync is rebuilding OP graph from a pull.
      // Canvas → server persist must be SKIPPED in that window.
      function isSyncing() {
        return !!(window).__reframeSyncing;
      }

      // Track whether the user has actually interacted with the canvas.
      // Until they have, ALL canvas-emitted events are part of the
      // initial layout/load and must NOT be persisted (the server
      // already has that state, persisting it back creates 404 floods
      // when ids don't line up). First real pointerdown flips this.
      var canvasUserInteracted = false;
      // Track active pointer-down state so the properties-panel
      // refresher can skip while a drag is live — re-rendering the
      // 300+ node panel 8x/sec mid-drag steals main-thread time from
      // canvas pointer handling and makes manipulation feel blocked.
      var canvasPointerDown = false;
      var cvsEl = document.getElementById('reframe-viewport');
      if (cvsEl) {
        cvsEl.addEventListener('pointerdown', function() {
          canvasUserInteracted = true;
          canvasPointerDown = true;
        }, { passive: true, capture: true });
        var clearPointerDown = function() { canvasPointerDown = false; };
        cvsEl.addEventListener('pointerup',   clearPointerDown, { passive: true, capture: true });
        cvsEl.addEventListener('pointercancel', clearPointerDown, { passive: true, capture: true });
        window.addEventListener('blur', clearPointerDown);
      }
      function shouldPersistCanvasChange() {
        // Suppress during sync OR before first real interaction.
        // Both flags are belt-and-suspenders — sync covers SSE pulls,
        // user-interaction covers initial load + Playwright synthetic
        // events that happen without a real pointerdown.
        return !isSyncing() && canvasUserInteracted;
      }

      // Translate OP node id → reframe id via the bridge. Returns null
      // if the OP node has no reframe counterpart (e.g. internal page
      // wrapper, OP layout helpers). Handlers MUST skip POST in that
      // case — otherwise we send unknown ids to the server, creating
      // 404 cascades + ERR_INSUFFICIENT_RESOURCES from request floods.
      function toRfId(opId) {
        if (!opId) return null;
        var bridge = (window).__reframeBridge;
        if (!bridge) return opId; // bridge missing → fall back to raw
        var mapped = bridge.opToReframeId && bridge.opToReframeId.get && bridge.opToReframeId.get(opId);
        if (mapped) return mapped;
        if (bridge.reframeToOpId && bridge.reframeToOpId.has && bridge.reframeToOpId.has(opId)) return opId;
        return null;
      }

      // ── REMOVED: per-event canvas → server POST handlers ──
      // StoreSync.doPush handles persistence via PUT /scenes/:id on a
      // 600ms debounce. Per-event POSTs were duplicate work that 404'd
      // on OP-only ids.
      //
      // Refresh the layer tree AFTER the store-sync push cycle has had
      // time to complete (600ms debounce + ~300ms network + SSE pull).
      // Shorter delays miss the updated tree from the server. The SSE
      // scene:session-changed handler already triggers its own refresh
      // on server mutation, so this is belt-and-suspenders.
      // refreshLayersTree is internally debounced (150-sidebar.js) so
      // N-node rebuilds coalesce into one /platform/api/scene/tree fetch.
      // Skip entirely while __reframeSyncing is true — the whole
      // pull-from-MCP rebuild is one logical change, and dispatching
      // refresh per synthesized node-created still wastes cycles on
      // the bridge layer even with the debounce downstream.
      function refreshTreeIfNotSyncing() {
        if (window.__reframeSyncing) return;
        refreshLayersTree();
      }
      window.addEventListener('reframe:node-created', refreshTreeIfNotSyncing);
      window.addEventListener('reframe:node-deleted', refreshTreeIfNotSyncing);
      window.addEventListener('reframe:node-reparented', refreshTreeIfNotSyncing);
      // Properties panel refresh on node-moved/resized — THROTTLED.
      // Every pointermove during drag fires multiple events. If we
      // refresh the panel (GET /api/node/get) on each one, the browser
      // queue fills with fetches and drag feels sluggish / blocked.
      // Debounce to 120ms — fast enough that values feel live, slow
      // enough that no single pointermove spawns a fetch.
      var propsRefreshTimer = null;
      function queuePropsRefresh() {
        if (propsRefreshTimer) clearTimeout(propsRefreshTimer);
        // Trailing debounce (300ms): run AFTER the burst settles, not
        // at the start. Previous leading-edge firing at 120ms caused a
        // panel re-render 8x/sec during drag — full innerHTML swap +
        // two fetches + re-binding hundreds of listeners competed with
        // canvas pointer handling, which is why users reported the
        // right panel "blocking" manipulations.
        propsRefreshTimer = setTimeout(function() {
          propsRefreshTimer = null;
          // Skip while the user is still dragging — panel can update
          // when the gesture ends.
          if (canvasPointerDown) return;
          // Skip if the user is typing in a panel input — a refresh
          // would blow away their half-typed value.
          var active = document.activeElement;
          if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')
              && active.closest && active.closest('[data-panel="design"]')) return;
          if (currentPropsNodeId) {
            showPropsForNode(currentPropsNodeId, getCanvasSessionId());
          }
        }, 300);
      }
      window.addEventListener('reframe:node-moved', function(evt) {
        var detail = evt.detail || {};
        if (currentPropsNodeId === toRfId(detail.nodeId)) queuePropsRefresh();
      });
      window.addEventListener('reframe:node-resized', function(evt) {
        var detail = evt.detail || {};
        if (currentPropsNodeId === toRfId(detail.nodeId)) queuePropsRefresh();
      });

      // OP canvas is always in "edit mode" — set state so CSS classes work
      state.editMode = true;
      var appEl2 = $('.app');
      if (appEl2) appEl2.classList.add('edit-mode');

      // Initial layers tree load for CanvasKit pages.
      // Wait a beat for scene hydration to finish before fetching tree.
      setTimeout(function() { refreshLayersTree(); }, 800);

      // Refresh layers tree on SSE scene changes. refreshLayersTree is
      // internally debounced (120ms) so a pull-from-MCP that dispatches
      // graph-changed + N synthesized node-created collapses into one
      // fetch of /platform/api/scene/tree.
      window.addEventListener('reframe:graph-changed', function() {
        refreshLayersTree();
      });
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
    bindMacroDropdowns();
    bindSidebarActions();
    bindContextMenu();
    bindInlinePopover();
    bindBottomChat();
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

    // ── Restore persisted UI state ──────────────────────────
    // If the previous session left a selection + viewport pinned,
    // re-apply them here so the user walks into the same workspace
    // they left. Both are fire-and-forget; if the persisted node id
    // doesn't exist in the current scene (e.g. source HTML changed
    // between runs), showPropsForNode's own 404 path falls back to
    // the scene dashboard — nothing breaks.
    setTimeout(function() {
      // Re-apply viewport macro if it was non-default. We dispatch
      // via the existing handleMacroAction path so the same code
      // (host width + margin) runs as a fresh user click, instead of
      // re-implementing the flex/block centering logic inline here.
      if (state.currentViewport && state.currentViewport !== 'desktop' && state.currentViewport !== 'original') {
        var vpBtn = document.querySelector('[data-macro-action="viewport"][data-vp="' + state.currentViewport + '"]');
        if (vpBtn && typeof vpBtn.click === 'function') vpBtn.click();
      }
      // Re-populate right panel from persisted selection. The OP
      // bridge may still be wiring on first try (CanvasKit graph hasn't
      // replayed yet), so we retry a handful of times over ~3s. Each
      // attempt is cheap (one GET /api/node/get). Stops early once the
      // props panel has contents that aren't the empty-state dashboard.
      function tryRestoreProps(attemptsLeft) {
        if (!state.selection || !state.selection.inode || attemptsLeft <= 0) return;
        var frame = document.querySelector('.viewport-frame') || document.getElementById('reframe-viewport');
        var sid = frame ? (frame.getAttribute('data-session') || frame.dataset.session) : null;
        if (!sid || typeof showPropsForNode !== 'function') {
          setTimeout(function() { tryRestoreProps(attemptsLeft - 1); }, 500);
          return;
        }
        showPropsForNode(state.selection.inode, sid);
        // Re-check after a moment — if the panel is still the empty
        // dashboard, the bridge probably hadn't indexed the id yet;
        // try again.
        setTimeout(function() {
          var panel = document.querySelector('[data-panel="design"]');
          var text = panel ? (panel.textContent || '') : '';
          if (text.indexOf('Select a node to inspect') !== -1) {
            tryRestoreProps(attemptsLeft - 1);
          }
        }, 400);
      }
      tryRestoreProps(6);
      // Also trigger LAYERS highlight fold-in.
      try { window.dispatchEvent(new CustomEvent('reframe:ui-state-changed')); } catch (_) {}
    }, 900);
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