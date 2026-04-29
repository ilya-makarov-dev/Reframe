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
  // Phase 1 UI-1 — single localStorage key holds the whole layout
  // preference shape. Earlier shipped two separate keys
  // ('reframe.panel.sidebar' / 'reframe.panel.right'); the v1 read
  // path migrates them over the first time. Future schema bumps
  // increment the `-v2` suffix rather than mutating the v1 shape.
  var LAYOUT_STORAGE_KEY = 'reframe-platform-ui-layout-v1';
  var LAYOUT_DEFAULTS = {
    leftPanelWidth: 320,
    rightPanelWidth: 360,
    leftPanelCollapsed: false,
  };
  var SIDEBAR_MIN = 240;
  var SIDEBAR_MAX = 600;
  var RIGHT_MIN = 280;
  var RIGHT_MAX = 560;
  var NARROW_VIEWPORT_BREAKPOINT = 1024;

  function clamp(n, lo, hi) {
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
  }

  function readLayoutPrefs() {
    try {
      var raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return {
            leftPanelWidth: typeof parsed.leftPanelWidth === 'number'
              ? clamp(parsed.leftPanelWidth, SIDEBAR_MIN, SIDEBAR_MAX)
              : LAYOUT_DEFAULTS.leftPanelWidth,
            rightPanelWidth: typeof parsed.rightPanelWidth === 'number'
              ? clamp(parsed.rightPanelWidth, RIGHT_MIN, RIGHT_MAX)
              : LAYOUT_DEFAULTS.rightPanelWidth,
            leftPanelCollapsed: parsed.leftPanelCollapsed === true,
          };
        }
      }
      // Soft migration from the pre-v1 two-key shape. Read once, never
      // again — the v1 write below replaces them on first save. Old
      // keys aren't deleted so a downgrade still finds its values.
      var oldSidebar = localStorage.getItem('reframe.panel.sidebar');
      var oldRight = localStorage.getItem('reframe.panel.right');
      if (oldSidebar || oldRight) {
        return {
          leftPanelWidth: oldSidebar
            ? clamp(parseInt(oldSidebar, 10) || LAYOUT_DEFAULTS.leftPanelWidth, SIDEBAR_MIN, SIDEBAR_MAX)
            : LAYOUT_DEFAULTS.leftPanelWidth,
          rightPanelWidth: oldRight
            ? clamp(parseInt(oldRight, 10) || LAYOUT_DEFAULTS.rightPanelWidth, RIGHT_MIN, RIGHT_MAX)
            : LAYOUT_DEFAULTS.rightPanelWidth,
          leftPanelCollapsed: false,
        };
      }
    } catch (_) {}
    return Object.assign({}, LAYOUT_DEFAULTS);
  }

  function writeLayoutPrefs(prefs) {
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(prefs));
    } catch (_) {}
  }

  function applyLayoutPrefs(body, prefs) {
    body.style.setProperty('--sidebar-w', prefs.leftPanelWidth + 'px');
    body.style.setProperty('--right-w', prefs.rightPanelWidth + 'px');
    if (prefs.leftPanelCollapsed) body.setAttribute('data-left-collapsed', 'true');
    else body.removeAttribute('data-left-collapsed');
  }

  function bindResizablePanels() {
    var body = $('.body');
    if (!body) return;

    var prefs = readLayoutPrefs();
    applyLayoutPrefs(body, prefs);

    $$('[data-panel-resize]').forEach(function(handle) {
      var kind = handle.getAttribute('data-panel-resize'); // "sidebar" | "right"
      handle.addEventListener('mousedown', function(e) {
        // Sidebar resize is suppressed while collapsed — uncollapse first.
        if (kind === 'sidebar' && body.getAttribute('data-left-collapsed') === 'true') return;
        e.preventDefault();
        handle.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        var startX = e.clientX;
        var rect = body.getBoundingClientRect();
        var computed = getComputedStyle(body);
        var startSidebar = parseFloat(computed.getPropertyValue('--sidebar-w')) || LAYOUT_DEFAULTS.leftPanelWidth;
        var startRight = parseFloat(computed.getPropertyValue('--right-w')) || LAYOUT_DEFAULTS.rightPanelWidth;

        function onMove(mv) {
          var dx = mv.clientX - startX;
          if (kind === 'sidebar') {
            var w = clamp(startSidebar + dx, SIDEBAR_MIN, SIDEBAR_MAX);
            // 60%-of-viewport floor — even within bounds, don't let the
            // sidebar starve the canvas at narrow widths.
            if (w > rect.width * 0.6) w = rect.width * 0.6;
            body.style.setProperty('--sidebar-w', w + 'px');
          } else {
            // Right panel grows when dragging LEFT, so dx is inverted.
            var w2 = clamp(startRight - dx, RIGHT_MIN, RIGHT_MAX);
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
          var computed2 = getComputedStyle(body);
          var current = readLayoutPrefs();
          if (kind === 'sidebar') {
            current.leftPanelWidth = parseFloat(computed2.getPropertyValue('--sidebar-w')) || current.leftPanelWidth;
          } else {
            current.rightPanelWidth = parseFloat(computed2.getPropertyValue('--right-w')) || current.rightPanelWidth;
          }
          writeLayoutPrefs(current);
        }
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });

      // Double-click resets the matching panel to its default width.
      handle.addEventListener('dblclick', function() {
        var current = readLayoutPrefs();
        if (kind === 'sidebar') current.leftPanelWidth = LAYOUT_DEFAULTS.leftPanelWidth;
        else current.rightPanelWidth = LAYOUT_DEFAULTS.rightPanelWidth;
        writeLayoutPrefs(current);
        applyLayoutPrefs(body, current);
      });
    });
  }

  // Phase 1 UI-1 — collapse toggle for the left panel. Single button
  // inside the sidebar (top-right area). State persisted under the
  // same v1 storage shape; CSS reads .body[data-left-collapsed] to
  // animate to the icon-rail width and back.
  function bindSidebarCollapse() {
    var body = $('.body');
    if (!body) return;
    var btn = $('[data-sidebar-collapse-toggle]');
    if (!btn) return;
    btn.addEventListener('click', function() {
      var current = readLayoutPrefs();
      current.leftPanelCollapsed = !current.leftPanelCollapsed;
      writeLayoutPrefs(current);
      applyLayoutPrefs(body, current);
      btn.setAttribute('aria-expanded', current.leftPanelCollapsed ? 'false' : 'true');
      btn.setAttribute('title', current.leftPanelCollapsed ? 'Expand panel' : 'Collapse panel');
      btn.setAttribute('aria-label', current.leftPanelCollapsed ? 'Expand panel' : 'Collapse panel');
    });
    // Initial state of the aria-expanded attr matches the stored
    // collapse state (applyLayoutPrefs set the data-attr; here we
    // mirror it to the toggle button).
    var prefs = readLayoutPrefs();
    btn.setAttribute('aria-expanded', prefs.leftPanelCollapsed ? 'false' : 'true');
  }

  // Phase 1 UI-1 — narrow-viewport guard. Below 1024px the editor
  // surfaces a notice (see CSS .reframe-narrow-viewport-toast).
  // We toggle a body class so the CSS rules can apply uniformly
  // across pages without each page re-implementing the breakpoint.
  function bindNarrowViewportGuard() {
    function check() {
      var narrow = window.innerWidth < NARROW_VIEWPORT_BREAKPOINT;
      document.body.classList.toggle('reframe-viewport-narrow', narrow);
    }
    check();
    window.addEventListener('resize', check);
  }
