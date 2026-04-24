  // ── Zoom pill — floating canvas zoom control ──
  //
  // Wiring for the .zoom-pill markup rendered by editor-shell-page.ts.
  // Reads the zoom API exposed by the DOM canvas editor bundle at
  // window.__reframeDOMCanvas.zoom (see packages/editor/src/canvas-dom/
  // dom-canvas.ts → public `.zoom` namespace). The pill stays dormant
  // until the editor bundle finishes mounting; a short poll covers the
  // async boot without a full event bus.
  //
  // Buttons:
  //   fit            → zoom.zoomToFit()         (uses captured scene bbox)
  //   −              → zoom.zoomOut()           (snap to previous level)
  //   level (100%)   → opens preset menu        (ZOOM_LEVELS × 100)
  //   +              → zoom.zoomIn()            (snap to next level)
  //   100%           → zoom.zoomTo100()         (hard reset)
  //
  // The preset menu renders `zoom.levels` (imported from zoom-pan.ts via
  // the public API), so picker stays in sync if the level set changes in
  // the engine. Label updates come from zoom.onChange so wheel / pinch
  // / keyboard zoom all reflect in the pill without extra wiring.

  function bindZoomPill() {
    var pill = $('[data-zoom-pill]');
    if (!pill) return;
    var levelBtn = pill.querySelector('[data-zoom-level]');
    var fitBtn   = pill.querySelector('[data-zoom-action="fit"]');
    var outBtn   = pill.querySelector('[data-zoom-action="out"]');
    var inBtn    = pill.querySelector('[data-zoom-action="in"]');
    var resetBtn = pill.querySelector('[data-zoom-action="100"]');
    if (!levelBtn) return;

    var unsubscribe = null;
    var menu = null;
    var currentZoom = 1;
    var levels = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4];

    function api() {
      // __reframeDOMCanvas is the editor bundle's public handle; it may
      // not exist yet on first paint. Return null and let callers no-op.
      return (window.__reframeDOMCanvas && window.__reframeDOMCanvas.zoom) || null;
    }

    function formatPct(z) {
      var pct = Math.round(z * 100);
      return pct + '%';
    }

    function renderLevel(z) {
      currentZoom = z;
      if (levelBtn) levelBtn.textContent = formatPct(z);
      if (!menu) return;
      var buttons = menu.querySelectorAll('button');
      buttons.forEach(function(b) {
        var v = parseFloat(b.getAttribute('data-zoom-preset') || '0');
        b.setAttribute('data-active', Math.abs(v - z) < 0.001 ? 'true' : 'false');
      });
    }

    function closeMenu() {
      if (!menu) return;
      menu.setAttribute('hidden', '');
      levelBtn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', onDocClick, true);
      document.removeEventListener('keydown', onMenuKey, true);
    }

    function openMenu() {
      var z = api();
      if (!z) return;
      if (!menu) {
        menu = document.createElement('div');
        menu.className = 'zoom-pill-menu';
        menu.setAttribute('role', 'menu');
        menu.innerHTML = levels.map(function(v) {
          return '<button type="button" role="menuitem" data-zoom-preset="' + v + '">' +
            formatPct(v) + '</button>';
        }).join('');
        pill.parentNode.appendChild(menu);
        menu.addEventListener('click', function(e) {
          var btn = e.target.closest('[data-zoom-preset]');
          if (!btn) return;
          var val = parseFloat(btn.getAttribute('data-zoom-preset'));
          var a = api();
          if (a) a.setZoom(val);
          closeMenu();
        });
      }
      menu.removeAttribute('hidden');
      levelBtn.setAttribute('aria-expanded', 'true');
      renderLevel(currentZoom);
      document.addEventListener('click', onDocClick, true);
      document.addEventListener('keydown', onMenuKey, true);
    }

    function onDocClick(e) {
      if (!menu) return;
      if (menu.contains(e.target) || levelBtn.contains(e.target)) return;
      closeMenu();
    }

    function onMenuKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMenu();
        levelBtn.focus();
      }
    }

    levelBtn.addEventListener('click', function() {
      if (menu && !menu.hasAttribute('hidden')) closeMenu();
      else openMenu();
    });
    if (fitBtn)   fitBtn.addEventListener('click', function()   { var a = api(); if (a) a.zoomToFit(); });
    if (outBtn)   outBtn.addEventListener('click', function()   { var a = api(); if (a) a.zoomOut(); });
    if (inBtn)    inBtn.addEventListener('click', function()    { var a = api(); if (a) a.zoomIn(); });
    if (resetBtn) resetBtn.addEventListener('click', function() { var a = api(); if (a) a.zoomTo100(); });

    // Poll for editor bundle readiness. The bundle loads as <script type="module">
    // which runs deferred, so window.__reframeDOMCanvas may not exist on
    // first bindZoomPill() call. 200ms × 30 attempts = 6s wall-clock cap;
    // after that we give up silently (label stays at "100%"). If the
    // editor eventually mounts later, the pill still works — buttons are
    // already wired via api() which re-reads window on each click.
    var attempts = 0;
    var wait = setInterval(function() {
      attempts++;
      var z = api();
      if (z) {
        clearInterval(wait);
        if (Array.isArray(z.levels) || (z.levels && z.levels.length)) {
          levels = z.levels.slice();
        }
        unsubscribe = z.onChange(renderLevel);
      } else if (attempts > 30) {
        clearInterval(wait);
      }
    }, 200);

    // Expose cleanup for hot-reload harnesses (and the rare embedded
    // scenario where Platform UI is mounted more than once).
    window.__reframeZoomPillCleanup = function() {
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      closeMenu();
    };
  }
