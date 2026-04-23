// Phase 4.0 — Inspector ← canvas selection glue.
//
// Listens to the Platform UI selection system (canvas-select event +
// .viewport-frame scene context) and mounts the `inspector` panel into
// right-panel whenever a node is selected. On deselection / clear, the
// inspector auto-unmounts so the default property pane (or empty state)
// returns.
//
// Fires a POST /platform/api/panel-mount with { sceneId, nodeId } — the
// inspector composer looks up the full InspectorTarget server-side from
// the live SceneGraph in the session store, so there's no duplicated
// target-building here. Keeps the client thin; every inspector data
// decision lives in one place (the composer registry).
//
// Debounced to ~60ms to avoid hammering mount on rapid selection flips
// during drag/marquee operations.
//
// Respects a kill-switch (`window.__reframeInspectorAutoMount === false`)
// so advanced users / other panels (e.g. variant-picker taking over the
// slot) can suppress autolaunch temporarily.

(function() {
  'use strict';

  if (window.__reframeInspectorAutolaunchLoaded) return;
  window.__reframeInspectorAutolaunchLoaded = true;

  var lastSentAt = 0;
  var pendingTimer = null;
  var lastFingerprint = null;

  function schedule(sceneId, nodeId) {
    var fp = String(sceneId) + '|' + String(nodeId);
    if (fp === lastFingerprint && Date.now() - lastSentAt < 500) {
      // Same node, very recently — skip. Prevents remount on rapid drag.
      return;
    }
    lastFingerprint = fp;
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    pendingTimer = setTimeout(function() {
      pendingTimer = null;
      doMount(sceneId, nodeId);
    }, 60);
  }

  function doMount(sceneId, nodeId) {
    if (window.__reframeInspectorAutoMount === false) return;
    lastSentAt = Date.now();
    try {
      fetch('/platform/api/panel-mount', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          panel: 'inspector',
          slot: 'right-panel',
          config: { sceneId: sceneId, nodeId: nodeId },
        }),
      }).catch(function() {});
    } catch (_) {}
  }

  function doUnmount() {
    if (window.__reframeInspectorAutoMount === false) return;
    lastFingerprint = null;
    try {
      fetch('/platform/api/panel-unmount', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ panel: 'inspector', slot: 'right-panel' }),
      }).catch(function() {});
    } catch (_) {}
  }

  // The selection system dispatches `reframe:ui-state-changed` whenever
  // state.selection.inode changes (see 010-core.js persistUiState). We
  // bridge off that OR directly off the custom events the bridge emits.
  // Fall back to polling state.selection (exposed on a global state
  // object in 010) every 250ms as safety net.
  var lastInode = null;
  var lastScene = null;

  function resolveCurrentSelection() {
    // 010-core.js sets window.__reframeSelection on every selection
    // mutation (persistUiState). It exposes { inode, sceneId } — everything
    // we need to mount the inspector against the live SceneGraph in the
    // session store.
    try {
      var sel = window.__reframeSelection;
      if (sel && sel.inode && sel.sceneId) {
        return { sceneId: sel.sceneId, nodeId: sel.inode };
      }
    } catch (_) {}
    return null;
  }

  function tick() {
    var sel = resolveCurrentSelection();
    if (sel && sel.nodeId && sel.sceneId) {
      if (sel.nodeId !== lastInode || sel.sceneId !== lastScene) {
        lastInode = sel.nodeId;
        lastScene = sel.sceneId;
        schedule(sel.sceneId, sel.nodeId);
      }
    } else {
      if (lastInode) {
        lastInode = null;
        lastScene = null;
        doUnmount();
      }
    }
  }

  function start() {
    // Event-driven: listen to the UI state-change event that 010-core
    // dispatches after selection mutation.
    window.addEventListener('reframe:ui-state-changed', tick);
    // Safety poll — a few selection paths (bridge-initiated, context-
    // menu navigate, history replay) don't dispatch ui-state-changed
    // consistently. Polling ensures we never get stuck on a stale
    // inspector target. 250ms is below the perceptual threshold for
    // inspector-follows-click.
    setInterval(tick, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
