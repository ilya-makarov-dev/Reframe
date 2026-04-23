// Agent-operable runtime — Phase 1.
//
// Makes INode-rendered panels LIVE in the browser:
//
//  (1) Listens for SSE events 'panel:mount', 'panel:unmount', 'token:changed'
//      and DOM-injects / DOM-removes / CSS-var-patches accordingly.
//
//  (2) Global click + input delegator that reads 'data-gesture-click' and
//      'data-gesture-input' attributes (emitted by the core HTML exporter
//      for INode nodes with onClick / onInput bindings) and POSTs to
//      /platform/api/agent-gesture with placeholder substitution.
//
// No build step — drop-in concatenated into platform-ui.js alongside the
// other 0xx-*.js modules. Self-contained IIFE, no imports, no globals
// except the exposed `window.__reframeAgentRuntime` for reentrancy
// protection and manual inspection from the devtools console.
//
// Safety net: all work is try/catch-wrapped. A bug in this module should
// never break the rest of the Platform UI — panel dispatch is best-effort.

(function() {
  'use strict';

  if (window.__reframeAgentRuntime) return; // already loaded
  var runtime = { mounted: Object.create(null), tokenOverrides: Object.create(null) };
  window.__reframeAgentRuntime = runtime;

  // ─── SSE subscription (second channel, multiplexed) ────────────
  function subscribeSSE() {
    if (!window.EventSource) return;
    try {
      var es = new EventSource('/events');
      es.addEventListener('message', function(ev) {
        try {
          var e = JSON.parse(ev.data);
          if (!e || typeof e !== 'object') return;
          if (e.type === 'panel:mount')    handleMount(e);
          else if (e.type === 'panel:unmount') handleUnmount(e);
          else if (e.type === 'token:changed') handleTokenChanged(e);
        } catch (_) {}
      });
    } catch (_) {}
  }

  // ─── Mount / unmount — DOM injection into [data-mount-slot] ─────
  function findSlot(name) {
    return document.querySelector('[data-mount-slot="' + cssEscape(name) + '"]');
  }

  function handleMount(e) {
    var slot = findSlot(e.slot);
    if (!slot) return;
    // Stash previous content so unmount restores the pre-mount UI
    // (activity stream / default panel).
    if (!runtime.mounted[e.slot]) {
      runtime.mounted[e.slot] = { previous: slot.innerHTML, panelName: e.panelName };
    } else {
      runtime.mounted[e.slot].panelName = e.panelName;
    }
    slot.innerHTML = '<div class="rf-agent-panel" data-panel-name="' + escapeAttr(e.panelName) + '">' + (e.html || '') + '</div>';
    // Apply any live token overrides accumulated before this panel mounted
    // so colors look right immediately.
    reapplyTokenOverrides(slot);
  }

  function handleUnmount(e) {
    var slot = findSlot(e.slot);
    if (!slot) return;
    var stash = runtime.mounted[e.slot];
    if (stash) {
      slot.innerHTML = stash.previous;
      delete runtime.mounted[e.slot];
    } else {
      slot.innerHTML = '';
    }
  }

  // ─── Token change → live CSS var + swatch patch ─────────────────
  function handleTokenChanged(e) {
    var varName = '--' + e.tokenName.replace(/\./g, '-');
    document.documentElement.style.setProperty(varName, e.value);
    runtime.tokenOverrides[e.tokenName] = e.value;
    // Also update any open brand-palette swatches' color previews that
    // show this token — the whole point of the fast-path is immediate
    // visual feedback.
    try {
      var previews = document.querySelectorAll('[data-intent-role="brand-palette/color-preview"]');
      for (var i = 0; i < previews.length; i++) {
        var preview = previews[i];
        var gestureAttr = preview.getAttribute('data-gesture-click');
        if (gestureAttr && gestureAttr.indexOf(e.tokenName) >= 0) {
          preview.style.background = e.value;
        }
      }
    } catch (_) {}
  }

  function reapplyTokenOverrides(scope) {
    var _ = scope; // not yet used — future: per-scope scoping of overrides
    for (var name in runtime.tokenOverrides) {
      if (Object.prototype.hasOwnProperty.call(runtime.tokenOverrides, name)) {
        document.documentElement.style.setProperty(
          '--' + name.replace(/\./g, '-'),
          runtime.tokenOverrides[name],
        );
      }
    }
  }

  // ─── Global gesture delegator (click + input) ───────────────────
  function dispatchGesture(tool, args, extras) {
    try {
      fetch('/platform/api/agent-gesture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: tool,
          args: args,
          value: extras.value,
          path: extras.path,
          id: extras.id,
        }),
      }).catch(function() {});
    } catch (_) {}
  }

  function substituteArgs(args, ctx) {
    var out = {};
    for (var k in args) {
      if (!Object.prototype.hasOwnProperty.call(args, k)) continue;
      var v = args[k];
      if (typeof v === 'string') {
        v = v.replace(/\{value\}/g, ctx.value == null ? '' : String(ctx.value));
        v = v.replace(/\{path\}/g, ctx.path == null ? '' : ctx.path);
        v = v.replace(/\{id\}/g, ctx.id == null ? '' : ctx.id);
      }
      out[k] = v;
    }
    return out;
  }

  function nearestGestureEl(startEl, attr) {
    var el = startEl;
    while (el && el.nodeType === 1) {
      if (el.hasAttribute && el.hasAttribute(attr)) return el;
      el = el.parentElement;
    }
    return null;
  }

  function onDocClick(ev) {
    try {
      var el = nearestGestureEl(ev.target, 'data-gesture-click');
      if (!el) return;
      var raw = el.getAttribute('data-gesture-click');
      if (!raw) return;
      var gesture = JSON.parse(raw);
      // Honor editableBy=locked as a hard guard (defence in depth — the
      // interactionCompliance audit already catches missing-role, but
      // client-side refuse ensures a stale DOM doesn't fire against the
      // server's will).
      var editable = el.getAttribute('data-intent-editable');
      if (editable === 'locked') return;
      var path = el.getAttribute('data-semantic-path');
      var id = el.getAttribute('data-id');
      var ctx = { value: undefined, path: path, id: id };
      var args = substituteArgs(gesture.args || {}, ctx);

      // Optimistic UI hint — apply a transient 'pressed' class for visual
      // affordance while the request is in flight.
      if (gesture.fastPath === 'optimistic-ui' || gesture.fastPath === 'local-state') {
        el.classList.add('rf-gesture-pressed');
        setTimeout(function() { el.classList.remove('rf-gesture-pressed'); }, 140);
      }

      dispatchGesture(gesture.tool, args, ctx);
    } catch (_) {}
  }

  function onDocInput(ev) {
    try {
      var el = nearestGestureEl(ev.target, 'data-gesture-input');
      if (!el) return;
      var raw = el.getAttribute('data-gesture-input');
      if (!raw) return;
      var gesture = JSON.parse(raw);
      var editable = el.getAttribute('data-intent-editable');
      if (editable === 'locked') return;
      var path = el.getAttribute('data-semantic-path');
      var id = el.getAttribute('data-id');
      // contenteditable text vs <input>: the HTML exporter emits TEXT
      // nodes as <p>/<span> tagged 'input'. Read from textContent first,
      // then .value as a fallback (future <input> integration).
      var value = (ev.target.value != null)
        ? ev.target.value
        : (el.textContent != null ? el.textContent : '');
      var ctx = { value: value, path: path, id: id };
      var args = substituteArgs(gesture.args || {}, ctx);
      dispatchGesture(gesture.tool, args, ctx);
    } catch (_) {}
  }

  function onDocKeydown(ev) {
    try {
      var target = ev.target;
      var el = nearestGestureEl(target, 'data-keybinding');
      if (!el) return;
      var raw = el.getAttribute('data-keybinding');
      if (!raw) return;
      var kb = JSON.parse(raw);
      if (!matchCombo(kb.combo, ev)) return;
      ev.preventDefault();
      var path = el.getAttribute('data-semantic-path');
      var id = el.getAttribute('data-id');
      var ctx = { value: undefined, path: path, id: id };
      var args = substituteArgs(kb.args || {}, ctx);
      dispatchGesture(kb.tool, args, ctx);
    } catch (_) {}
  }

  function matchCombo(combo, ev) {
    if (!combo) return false;
    var parts = combo.toLowerCase().split('+').map(function(p) { return p.trim(); });
    var key = parts[parts.length - 1];
    var wantMeta = parts.indexOf('cmd') >= 0 || parts.indexOf('meta') >= 0;
    var wantCtrl = parts.indexOf('ctrl') >= 0;
    var wantShift = parts.indexOf('shift') >= 0;
    var wantAlt = parts.indexOf('alt') >= 0 || parts.indexOf('opt') >= 0;
    var evKey = (ev.key || '').toLowerCase();
    if (evKey !== key && !(key === 'escape' && ev.keyCode === 27)) return false;
    if (wantMeta !== !!ev.metaKey && wantMeta && !ev.metaKey) return false;
    if (wantCtrl !== !!ev.ctrlKey && wantCtrl && !ev.ctrlKey) return false;
    if (wantShift && !ev.shiftKey) return false;
    if (wantAlt && !ev.altKey) return false;
    return true;
  }

  // ─── Helpers ──────────────────────────────────────────────────
  function cssEscape(s) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
    return String(s).replace(/["\\]/g, '\\$&');
  }
  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  // ─── Boot ─────────────────────────────────────────────────────
  function init() {
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('input', onDocInput, true);
    document.addEventListener('change', onDocInput, true);
    document.addEventListener('keydown', onDocKeydown, true);
    subscribeSSE();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
