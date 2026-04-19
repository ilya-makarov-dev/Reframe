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
        persistUiState();
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
