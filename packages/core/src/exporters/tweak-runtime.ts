/**
 * Tweak panel runtime IIFE (T2 #26).
 *
 * Self-contained browser script that wires the panel inputs to CSS
 * variable mutations on :root + persists state to localStorage.
 * Keyed per pathname so multiple bundle .html files on same domain
 * keep independent tweak state.
 *
 * ─── Lifecycle ──────────────────────────────────────────────
 *
 *   1. DOMContentLoaded → query panel + inputs by id/data-token
 *   2. Restore from localStorage[`reframe-tweaks-<pathname>`]:
 *      apply each saved value to its CSS var, sync input + output
 *   3. Wire toggle button (collapse/expand)
 *   4. Wire each input's `input` event → setProperty + persist + sync output
 *   5. Wire reset button → clear localStorage + reload page
 *
 * ─── Why localStorage + reload, not in-place reset ──────────
 *
 * Reload is ONE line and 100% correct. In-place reset would need to
 * track each input's "default" separately and re-run every setProperty,
 * which adds 30 LoC and a bug surface for partial restores. The
 * cost — a flash of reflow on reload — is acceptable for a control
 * the user clicks deliberately.
 *
 * ─── Idempotent guard ───────────────────────────────────────
 *
 * `window.__reframeTweakRuntime` flag prevents double-initialization
 * if the IIFE somehow gets concatenated twice (defensive — bundle
 * exporter only injects once per export, but the guard makes the
 * runtime safe to re-include in any context).
 */

export const TWEAK_RUNTIME_SOURCE = `
(function() {
  if (window.__reframeTweakRuntime) return;
  window.__reframeTweakRuntime = true;

  function init() {
    var panel = document.getElementById('reframe-tweak-surface');
    if (!panel) return;  // bundle exporter without tweakable=true

    var STORAGE_KEY = 'reframe-tweaks-' + location.pathname;
    var root = document.documentElement;
    var toggle = panel.querySelector('.reframe-tweak-toggle');
    var inputs = panel.querySelectorAll('input[data-token]');
    var resetBtn = panel.querySelector('.reframe-tweak-reset');

    function syncOutput(input) {
      var label = input.closest('label');
      if (!label) return;
      var output = label.querySelector('output');
      if (output) output.textContent = input.value;
    }

    function applyValue(input, persist) {
      var tokenPath = input.getAttribute('data-token');
      var varName = '--reframe-' + tokenPath.replace(/\\//g, '-');
      var unit = input.getAttribute('data-unit') || '';
      var raw = input.value;
      var value = (input.type === 'range') ? (raw + unit) : raw;
      root.style.setProperty(varName, value);
      syncOutput(input);
      if (persist) {
        var current = {};
        try { current = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
        catch (e) { current = {}; }
        current[tokenPath] = raw;
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); }
        catch (e) { /* quota / disabled — silently no-op, runtime still works */ }
      }
    }

    // Restore from localStorage on mount.
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch (e) { saved = {}; }
    for (var i = 0; i < inputs.length; i++) {
      var input = inputs[i];
      var tokenPath = input.getAttribute('data-token');
      if (saved[tokenPath] !== undefined) {
        input.value = saved[tokenPath];
        applyValue(input, false);
      } else {
        // Sync output element to the initial value rendered into the
        // input — covers the case where no override has been saved yet.
        syncOutput(input);
      }
    }

    // Toggle visibility.
    if (toggle) {
      toggle.addEventListener('click', function() {
        panel.classList.toggle('reframe-tweak-collapsed');
      });
    }

    // Wire each input.
    for (var j = 0; j < inputs.length; j++) {
      (function(input) {
        input.addEventListener('input', function() { applyValue(input, true); });
      })(inputs[j]);
    }

    // Reset button — clear storage + hard reload to restore :root defaults.
    if (resetBtn) {
      resetBtn.addEventListener('click', function() {
        try { localStorage.removeItem(STORAGE_KEY); }
        catch (e) { /* no-op */ }
        location.reload();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;
