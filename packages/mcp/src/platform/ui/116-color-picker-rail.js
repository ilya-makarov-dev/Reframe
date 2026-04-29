  // ── Phase 1 UI-5b — Color picker rail ──────────────────────────
  //
  // Popover anchored to a color-typed inspector field. Three rows:
  //   1) Brand palette — fetched from /platform/api/brand/tokens?slug=
  //      Click a swatch → setColor + bind tokenBindings.<engineKey>
  //   2) Scene-used   — distinct hexes harvested from the live tree.
  //      Click → setColor (literal hex), tokenBindings.<engineKey> = null
  //      to unbind any prior binding.
  //   3) Custom       — hex input + native <input type="color">.
  //      Same unbind-on-commit semantics as Scene-used.
  //
  // Mounting:
  //   mountColorPickerRail(anchorEl, opts) — opts = { sceneId, nodeId,
  //   currentValue, prop, engineKey, onChange }.
  //   `engineKey` maps the CSS prop → node.meta.tokenBindings sub-key:
  //     background  → fill
  //     color       → text          (typography role binding)
  //     border-color→ stroke
  //   Renderer at field-render time knows which engine key applies and
  //   passes it explicitly — keeps server-side translation table at zero.
  //
  // Outside-click + Escape close. Closing without a swatch click
  // calls onChange(null) — UI keeps existing value.
  //
  // Visual polish parity with UI-5a edit ring: 1 px solid #2b74ff +
  // soft 3 px glow + drop shadow.

  var COLOR_PICKER_RAIL_ID = 'rfd-color-picker-rail';
  var BRAND_PALETTE_CACHE = {}; // slug → palette[]
  var BRAND_PALETTE_INFLIGHT = {}; // slug → Promise

  function getActiveBrandSlug() {
    // The Platform UI keeps the active brand slug on the project manifest
    // (`window.__reframeProject.activeBrand` after StoreSync hydration).
    // Falls back to localStorage which the dashboard switcher mirrors.
    try {
      var p = window.__reframeProject || window.__REFRAME_BOOT__ && window.__REFRAME_BOOT__.project;
      if (p && (p.activeBrand || p.active_brand)) return String(p.activeBrand || p.active_brand);
    } catch (_) {}
    try {
      var ls = localStorage.getItem('reframe-active-brand');
      if (ls) return ls;
    } catch (_) {}
    return null;
  }

  async function fetchBrandPalette(slug) {
    if (!slug) return [];
    if (BRAND_PALETTE_CACHE[slug]) return BRAND_PALETTE_CACHE[slug];
    if (BRAND_PALETTE_INFLIGHT[slug]) return BRAND_PALETTE_INFLIGHT[slug];
    var p = (async function() {
      try {
        var resp = await fetch('/platform/api/brand/tokens?slug=' + encodeURIComponent(slug), { cache: 'no-store' });
        if (!resp.ok) return [];
        var json = await resp.json();
        var arr = Array.isArray(json && json.palette) ? json.palette : [];
        BRAND_PALETTE_CACHE[slug] = arr;
        return arr;
      } catch (_) {
        return [];
      } finally {
        delete BRAND_PALETTE_INFLIGHT[slug];
      }
    })();
    BRAND_PALETTE_INFLIGHT[slug] = p;
    return p;
  }

  function harvestSceneColors(maxN) {
    // Walk the canvas iframe's rendered DOM looking for inline-style
    // background/color/border-color values. Cap to the most-used N.
    // Keeps a strict order: most-used first, ties broken by first-seen.
    var iframe = document.querySelector('.rfd-canvas-viewport iframe');
    var doc = iframe && iframe.contentDocument;
    if (!doc) return [];
    var counts = Object.create(null);
    var firstSeen = Object.create(null);
    var idx = 0;
    var nodes = doc.querySelectorAll('[data-reframe-inode]');
    var hexRe = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/;
    function rgbToHex(r, g, b) {
      function h(n) { var s = Number(n).toString(16); return s.length === 1 ? '0' + s : s; }
      return '#' + h(r) + h(g) + h(b);
    }
    nodes.forEach(function(n) {
      var s = doc.defaultView.getComputedStyle(n);
      ['background-color', 'color', 'border-top-color'].forEach(function(prop) {
        var v = s.getPropertyValue(prop);
        if (!v || v === 'rgba(0, 0, 0, 0)' || v === 'transparent') return;
        var m = v.match(hexRe);
        if (!m) return;
        var hex = rgbToHex(m[1], m[2], m[3]).toLowerCase();
        // Skip pure white/black noise — too generic to surface as "used".
        if (hex === '#ffffff' || hex === '#000000') return;
        counts[hex] = (counts[hex] || 0) + 1;
        if (firstSeen[hex] == null) firstSeen[hex] = idx++;
      });
    });
    var keys = Object.keys(counts).sort(function(a, b) {
      var d = counts[b] - counts[a];
      if (d !== 0) return d;
      return firstSeen[a] - firstSeen[b];
    });
    return keys.slice(0, maxN || 8);
  }

  function isValidHex(s) {
    return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(s || '').trim());
  }
  function normalizeHex(s) {
    var t = String(s || '').trim().toLowerCase();
    if (!t) return '';
    if (t[0] !== '#') t = '#' + t;
    var m = t.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
    if (!m) return '';
    var h = m[1];
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    return '#' + h;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function buildSwatchHtml(hex, name, role, source) {
    return '<button type="button" class="rfd-cp-swatch" data-source="' + source + '" '
      + 'data-hex="' + escapeHtml(hex) + '" '
      + (name ? 'data-name="' + escapeHtml(name) + '" ' : '')
      + (role ? 'data-role="' + escapeHtml(role) + '" ' : '')
      + 'title="' + escapeHtml(name ? name + ' — ' + hex : hex) + '" '
      + 'style="background:' + escapeHtml(hex) + '"></button>';
  }

  function closeColorPickerRail() {
    var el = document.getElementById(COLOR_PICKER_RAIL_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
    document.removeEventListener('mousedown', onOutsideMouseDown, true);
    document.removeEventListener('keydown', onEscapeKey, true);
  }

  var __activeRail = null;

  function onOutsideMouseDown(e) {
    if (!__activeRail) return;
    var t = e.target;
    if (__activeRail.root.contains(t)) return;
    if (__activeRail.anchor && __activeRail.anchor.contains(t)) return;
    closeColorPickerRail();
    __activeRail = null;
  }
  function onEscapeKey(e) {
    if (e.key !== 'Escape') return;
    if (!__activeRail) return;
    e.stopPropagation();
    closeColorPickerRail();
    __activeRail = null;
  }

  // Position the popover below-right of the anchor; flip up if clipped.
  function positionRail(root, anchor) {
    var aR = anchor.getBoundingClientRect();
    var rR = root.getBoundingClientRect();
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var left = Math.min(Math.max(8, aR.left), vw - rR.width - 8);
    var topBelow = aR.bottom + 6;
    var topAbove = aR.top - rR.height - 6;
    var top = (topBelow + rR.height + 8 > vh && topAbove >= 8) ? topAbove : topBelow;
    root.style.left = left + 'px';
    root.style.top = top + 'px';
  }

  function mountColorPickerRail(anchorEl, opts) {
    closeColorPickerRail(); // single instance
    opts = opts || {};
    var sceneId = opts.sceneId;
    var nodeId = opts.nodeId;
    var prop = opts.prop;
    var engineKey = opts.engineKey;
    var currentHex = normalizeHex(opts.currentValue) || '#000000';
    var onChange = typeof opts.onChange === 'function' ? opts.onChange : function() {};

    var root = document.createElement('div');
    root.id = COLOR_PICKER_RAIL_ID;
    root.setAttribute('data-rfd-color-picker', '1');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Color picker');
    root.style.cssText = [
      'position:fixed', 'left:0', 'top:0', 'width:280px',
      'background:#fff', 'border:1px solid #2b74ff', 'border-radius:6px',
      'box-shadow:0 0 0 3px rgba(43,116,255,0.15), 0 4px 12px rgba(0,0,0,0.08)',
      'padding:12px', 'z-index:9999',
      'font-family:-apple-system,system-ui,sans-serif', 'font-size:12px',
      'color:#1a1d24',
    ].join(';');

    root.innerHTML =
      '<div class="rfd-cp-row" data-row="brand">'
        + '<div class="rfd-cp-row-label">Brand palette</div>'
        + '<div class="rfd-cp-row-grid" data-grid="brand"><div class="rfd-cp-empty">Loading…</div></div>'
      + '</div>'
      + '<div class="rfd-cp-row" data-row="scene">'
        + '<div class="rfd-cp-row-label">Used in scene</div>'
        + '<div class="rfd-cp-row-grid" data-grid="scene"></div>'
      + '</div>'
      + '<div class="rfd-cp-row" data-row="custom">'
        + '<div class="rfd-cp-row-label">Custom</div>'
        + '<div class="rfd-cp-custom-row">'
          + '<input class="rfd-cp-hex" type="text" value="' + escapeHtml(currentHex) + '" '
              + 'aria-label="Hex color" placeholder="#rrggbb" maxlength="7">'
          + '<input class="rfd-cp-native" type="color" value="' + escapeHtml(currentHex) + '" '
              + 'aria-label="Native color picker">'
        + '</div>'
        + '<div class="rfd-cp-hex-error" style="display:none;color:#d04040;font-size:11px;margin-top:4px">Invalid hex</div>'
      + '</div>';

    document.body.appendChild(root);
    positionRail(root, anchorEl);
    __activeRail = { root: root, anchor: anchorEl };

    // Brand palette load (async)
    var slug = getActiveBrandSlug();
    var brandGrid = root.querySelector('[data-grid="brand"]');
    if (!slug) {
      brandGrid.innerHTML = '<div class="rfd-cp-empty">No brand loaded</div>';
    } else {
      fetchBrandPalette(slug).then(function(palette) {
        if (!palette || palette.length === 0) {
          brandGrid.innerHTML = '<div class="rfd-cp-empty">Brand has no tokens</div>';
          return;
        }
        var html = '';
        palette.forEach(function(t) {
          html += buildSwatchHtml(t.hex, t.name, t.role || 'other', 'brand');
        });
        brandGrid.innerHTML = html;
      });
    }

    // Scene-used row populates synchronously from the live tree.
    var sceneGrid = root.querySelector('[data-grid="scene"]');
    var sceneHexes = harvestSceneColors(8);
    if (sceneHexes.length === 0) {
      sceneGrid.innerHTML = '<div class="rfd-cp-empty">No colors in scene</div>';
    } else {
      var sceneHtml = '';
      sceneHexes.forEach(function(h) { sceneHtml += buildSwatchHtml(h, h, '', 'scene'); });
      sceneGrid.innerHTML = sceneHtml;
    }

    // Wire swatch clicks (event delegation).
    root.addEventListener('click', function(e) {
      var btn = e.target && e.target.closest && e.target.closest('.rfd-cp-swatch');
      if (!btn) return;
      var hex = btn.getAttribute('data-hex');
      var source = btn.getAttribute('data-source');
      var tokenName = btn.getAttribute('data-name');
      if (!hex) return;
      var patch = {};
      patch[prop] = hex;
      // Engine-direct wire shape: tokenBindings: { fill: 'primary' } when
      // brand swatch clicked, or tokenBindings: { fill: null } when
      // scene-used clicked (explicit unbind).
      if (engineKey) {
        patch.tokenBindings = {};
        patch.tokenBindings[engineKey] = (source === 'brand' && tokenName) ? tokenName : null;
      }
      try { onChange(patch); } catch (_) {}
      closeColorPickerRail();
      __activeRail = null;
    });

    // Custom hex input — live preview on valid input + commit on Enter/blur.
    var hexInput = root.querySelector('.rfd-cp-hex');
    var hexError = root.querySelector('.rfd-cp-hex-error');
    var nativeInput = root.querySelector('.rfd-cp-native');
    function commitHex(raw) {
      var v = normalizeHex(raw);
      if (!v) {
        if (hexError) hexError.style.display = '';
        return;
      }
      if (hexError) hexError.style.display = 'none';
      var patch = {};
      patch[prop] = v;
      if (engineKey) {
        patch.tokenBindings = {};
        patch.tokenBindings[engineKey] = null; // custom = unbind
      }
      try { onChange(patch); } catch (_) {}
      closeColorPickerRail();
      __activeRail = null;
    }
    hexInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); commitHex(hexInput.value); }
    });
    hexInput.addEventListener('input', function() {
      // Validity hint only — commit happens on Enter/blur.
      if (hexInput.value && !isValidHex(hexInput.value)) {
        hexError.style.display = '';
      } else {
        hexError.style.display = 'none';
      }
    });
    nativeInput.addEventListener('input', function() {
      hexInput.value = nativeInput.value;
    });
    nativeInput.addEventListener('change', function() {
      commitHex(nativeInput.value);
    });

    // Outside-click + Escape lifecycle
    document.addEventListener('mousedown', onOutsideMouseDown, true);
    document.addEventListener('keydown', onEscapeKey, true);

    // Reposition on viewport resize / scroll.
    var reposition = function() { if (__activeRail && __activeRail.root) positionRail(__activeRail.root, __activeRail.anchor); };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    // Best-effort cleanup hook on close
    var prevClose = closeColorPickerRail;
    var wrappedClose = function() {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      prevClose();
    };
    // Replace global ref so subsequent open() doesn't leak
    closeColorPickerRail = wrappedClose;

    return {
      close: function() { wrappedClose(); __activeRail = null; },
      getRoot: function() { return root; },
    };
  }

  // Expose for use by 110-properties / 120-widgets.
  window.reframeMountColorPickerRail = mountColorPickerRail;
  window.reframeCloseColorPickerRail = function() { closeColorPickerRail(); __activeRail = null; };
