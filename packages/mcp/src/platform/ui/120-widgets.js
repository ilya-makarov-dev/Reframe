  // ── Detach from auto-layout (shared) ─────────────────────────────
  // Reparents the node to the canvas page and pins it with ABSOLUTE
  // positioning + FIXED sizing so Yoga stops reflowing it. Used by:
  //   - per-node [data-break-out] button in the properties panel
  //   - the top-bar "✂ Detach" button (applies to current selection)
  // Returns true on success, false if the editor/node isn't available.
  async function detachNodeFromLayout(sceneId, nodeId) {
    if (!sceneId || !nodeId) return false;
    var ed = window.__reframeEditor;
    if (!ed || !ed.getNode) return false;
    var node = ed.getNode(nodeId);
    if (!node) return false;

    var absPos = (ed.graph && ed.graph.getAbsolutePosition)
      ? ed.graph.getAbsolutePosition(nodeId)
      : { x: node.x || 0, y: node.y || 0 };

    // Client-side reparent to canvas page — instant visual effect so
    // the user isn't staring at a clipped/hidden frame while the
    // server round-trip runs.
    try {
      var pages = ed.graph && ed.graph.getPages && ed.graph.getPages();
      var pageId = (pages && pages[0] && pages[0].id) || null;
      if (pageId && node.parentId !== pageId && ed.reparentNodes) {
        ed.reparentNodes([nodeId], pageId);
      }
    } catch (_) {}

    // Server-side reparent FIRST, then sizing/position. The server's
    // /api/node/edit endpoint short-circuits when `parent-id` is in
    // props — it reparents and ignores other edits in that same POST.
    // So we split: one POST to reparent, then a POST per layout prop.
    // Without the reparent, SSE pulls back a graph where the node is
    // still under its original frame (with clipsContent) and it
    // vanishes when dragged outside those bounds.
    await editNodeProp(sceneId, nodeId, 'parent-id', 'root');

    editNodeProp(sceneId, nodeId, 'layoutPositioning', 'ABSOLUTE');
    editNodeProp(sceneId, nodeId, 'primaryAxisSizing', 'FIXED');
    editNodeProp(sceneId, nodeId, 'counterAxisSizing', 'FIXED');
    editNodeProp(sceneId, nodeId, 'layoutAlignSelf', 'AUTO');
    editNodeProp(sceneId, nodeId, 'layoutGrow', 0);
    editNodeProp(sceneId, nodeId, 'width', node.width);
    editNodeProp(sceneId, nodeId, 'height', node.height);
    editNodeProp(sceneId, nodeId, 'x', Math.round(absPos.x));
    editNodeProp(sceneId, nodeId, 'y', Math.round(absPos.y));
    return true;
  }

  // ── Brand token discovery (cached per scene) ─────────────────────
  // Fetches /platform/api/tokens/<sceneId> once per scene-revision and
  // caches the result. Used by the color popover to render real brand
  // chips (color.primary, color.accent, etc) with resolved values.
  var _tokenCache = {}; // { sceneId: { ts, tokens } }
  function fetchSceneTokens(sceneId) {
    if (!sceneId) return Promise.resolve([]);
    var cached = _tokenCache[sceneId];
    // 30s TTL — tokens don't change between scene-rev bumps; we just want
    // a coarse safety net so brand-switch invalidates eventually.
    if (cached && (Date.now() - cached.ts) < 30000) return Promise.resolve(cached.tokens);
    // Boot-payload prime: tokens are inlined with the shell, so the
    // first popover open doesn't wait on a network round-trip.
    var bootTokens = consumeBootSection(sceneId, 'tokens');
    if (bootTokens && bootTokens.length) {
      _tokenCache[sceneId] = { ts: Date.now(), tokens: bootTokens };
      return Promise.resolve(bootTokens);
    }
    return fetch('/platform/api/tokens/' + encodeURIComponent(sceneId))
      .then(function(r) { return r.ok ? r.json() : { tokens: [] }; })
      .then(function(j) {
        var tokens = (j && j.tokens) || [];
        _tokenCache[sceneId] = { ts: Date.now(), tokens: tokens };
        return tokens;
      })
      .catch(function() { return []; });
  }

  // ── Layout controls: direction icons + 9-cell alignment + gap + padding quad ──
  // Replaces the old ASCII direction toggle with proper SVG icons. Uses
  // OpenPencil's createAlignmentActions semantics — primary/counter axis
  // alignment maps to MIN/CENTER/MAX. The 9-cell grid is the most
  // discoverable alignment UI in the industry (Figma, Sketch, OP all use it).
  function renderLayoutControls(props, sessionId, nodeId) {
    var isFlexRow = props.display === 'flex-row';
    var isFlexCol = props.display === 'flex-col';
    var isNone = !isFlexRow && !isFlexCol;
    var de = function(s) { return escape(s); };
    var attrs = 'data-scene="' + de(sessionId) + '" data-node="' + de(nodeId) + '"';

    // 3 direction icons — horizontal / vertical / none (free positioning).
    var iconRow = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7h10M9 4l3 3-3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var iconCol = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M4 9l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var iconNone = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="2" width="10" height="10" rx="1" stroke="currentColor" stroke-width="1.4"/></svg>';

    // Break-out button — always visible. Detaches from parent
    // auto-layout (no-op if parent already has layoutMode=NONE).
    // Explicit Figma-style action: user clicks to free this frame
    // from its flex constraints so drag works.
    var breakOutHtml =
      '<button class="prop-text-btn" data-break-out="1" ' + attrs +
        ' title="Detach from parent auto-layout — position becomes absolute, preserves current size. Lets you free-drag the frame." ' +
        'style="margin-left:auto">Detach</button>';

    var dirHtml =
      '<div class="layout-direction-row" style="display:flex;gap:4px;align-items:center;margin-bottom:8px">' +
        '<button class="dir-btn' + (isFlexRow ? ' active' : '') + '" data-prop="display" data-val="flex-row" ' + attrs + ' title="Horizontal">' + iconRow + '</button>' +
        '<button class="dir-btn' + (isFlexCol ? ' active' : '') + '" data-prop="display" data-val="flex-col" ' + attrs + ' title="Vertical">' + iconCol + '</button>' +
        '<button class="dir-btn' + (isNone ? ' active' : '') + '" data-prop="display" data-val="block" ' + attrs + ' title="None">' + iconNone + '</button>' +
        (props.gap != null && !isNone ? '<div style="margin-left:8px">' + propCompact('Gap', 'gap', props.gap, sessionId, nodeId) + '</div>' : '') +
        breakOutHtml +
      '</div>';

    // 9-cell alignment grid — only meaningful when the container is flex.
    // Each cell sets primary + counter axis alignment in one click.
    // primary = main flex axis, counter = cross axis. For row layout:
    //   primary=MIN/CENTER/MAX → justify-content: flex-start/center/flex-end
    //   counter=MIN/CENTER/MAX → align-items: flex-start/center/flex-end
    var alignHtml = '';
    if (isFlexRow || isFlexCol) {
      var pAlign = (props['primary-axis-align'] || 'MIN').toUpperCase();
      var cAlign = (props['counter-axis-align'] || 'MIN').toUpperCase();
      // Mapping from cell index to (primary, counter) axis pair.
      // For ROW: primary = horizontal, counter = vertical
      // For COL: primary = vertical,   counter = horizontal
      var cells = [
        ['MIN','MIN'], ['CENTER','MIN'], ['MAX','MIN'],
        ['MIN','CENTER'], ['CENTER','CENTER'], ['MAX','CENTER'],
        ['MIN','MAX'], ['CENTER','MAX'], ['MAX','MAX'],
      ];
      // For COL we need to swap: clicking top-center should set
      // primary=MIN (top) counter=CENTER. The cells array above is for
      // ROW; for COL we transpose the meaning.
      var cellsHtml = cells.map(function(cell, idx) {
        var horizontal = cell[0]; // primary in ROW, counter in COL
        var vertical = cell[1];   // counter in ROW, primary in COL
        var primary = isFlexRow ? horizontal : vertical;
        var counter = isFlexRow ? vertical : horizontal;
        var isActive = pAlign === primary && cAlign === counter;
        return '<button class="align-cell' + (isActive ? ' active' : '') +
          '" data-primary="' + primary + '" data-counter="' + counter +
          '" ' + attrs + ' style="' +
          'width:14px;height:14px;border:1px solid ' + (isActive ? 'var(--accent,#f15a29)' : 'var(--border,#333)') +
          ';background:' + (isActive ? 'var(--accent,#f15a29)' : 'transparent') +
          ';border-radius:2px;cursor:pointer;padding:0' +
          '" title="' + primary + ' / ' + counter + '"></button>';
      }).join('');
      alignHtml =
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">' +
          '<span style="font-size:10px;color:var(--text-muted,#888);min-width:32px">Align</span>' +
          '<div style="display:grid;grid-template-columns:repeat(3, 14px);gap:2px">' + cellsHtml + '</div>' +
          '<span style="font-size:10px;color:var(--text-muted,#888);margin-left:auto">' + escape(pAlign.toLowerCase()) + ' / ' + escape(cAlign.toLowerCase()) + '</span>' +
        '</div>';
    }

    // Padding quad — same shape as old spacing-box but with link toggle
    // in the center cell (was a static W×H label).
    var pt = props['padding-top'] || 0;
    var pr = props['padding-right'] || 0;
    var pb = props['padding-bottom'] || 0;
    var pl = props['padding-left'] || 0;
    var allEqual = pt === pr && pr === pb && pb === pl;
    var paddingQuad =
      '<div class="spacing-box">' +
        '<div></div>' +
        '<input class="spacing-val" value="' + pt + '" data-prop="padding-top" ' + attrs + ' title="Padding top">' +
        '<div></div>' +
        '<input class="spacing-val" value="' + pl + '" data-prop="padding-left" ' + attrs + ' title="Padding left">' +
        '<div class="spacing-center">' +
          '<button class="prop-icon-btn padding-link-toggle' + (allEqual ? ' on' : '') + '" data-linked="' + (allEqual ? '1' : '0') + '" title="' + (allEqual ? 'Unlink padding' : 'Link all sides') + '">' +
            iconLink(allEqual) +
          '</button>' +
        '</div>' +
        '<input class="spacing-val" value="' + pr + '" data-prop="padding-right" ' + attrs + ' title="Padding right">' +
        '<div></div>' +
        '<input class="spacing-val" value="' + pb + '" data-prop="padding-bottom" ' + attrs + ' title="Padding bottom">' +
        '<div></div>' +
      '</div>';

    return dirHtml + alignHtml + paddingQuad;
  }

  // ── Shared link/unlink glyph (padding-link + aspect-lock) ────────
  // SVG chain icon — linked draws the full chain, unlinked breaks the
  // middle. 12×12 @ 1.4 stroke matches the dir-btn icons visually.
  function iconLink(linked) {
    if (linked) {
      return '<svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">' +
        '<path d="M5.2 8.8 8.8 5.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' +
        '<path d="M7.5 3.5 9 2a2.5 2.5 0 1 1 3.5 3.5L11 7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<path d="M6.5 10.5 5 12a2.5 2.5 0 1 1-3.5-3.5L3 7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>';
    }
    return '<svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">' +
      '<path d="M7.5 3.5 9 2a2.5 2.5 0 1 1 3.5 3.5L11 7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M6.5 10.5 5 12a2.5 2.5 0 1 1-3.5-3.5L3 7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M4 4.5 10 10.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity=".55"/>' +
      '</svg>';
  }

  // ── Shadow preview swatches (Phase 2) ────────────────────────────
  // Each shadow effect rendered as a small 24x24 box showing its actual
  // visual contribution — black box with the shadow applied. Click to
  // edit (future), drag to reorder (future). For MVP: visual list only.
  function renderShadowSwatches(props, sessionId, nodeId) {
    var shadows = (props.effects || []).filter(function(e) {
      return e && (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW');
    });
    if (shadows.length === 0) {
      return '<div style="margin-top:8px;font-size:10px;color:var(--text-muted,#888);' +
        'padding:6px;border:1px dashed var(--border,#333);border-radius:4px;text-align:center">' +
        'No shadows. Try ✨ <a href="javascript:void(0)" data-ai-shadow data-scene="' + escape(sessionId) +
        '" data-node="' + escape(nodeId) + '" style="color:var(--accent,#f15a29);text-decoration:none">Suggest depth</a>' +
        '</div>';
    }
    var swatches = shadows.map(function(s, i) {
      var off = (s.offset && (s.offset.x + 'px ' + s.offset.y + 'px')) || '0 0';
      var blur = (s.radius || 0) + 'px';
      var color = colorToCss(s.color) || 'rgba(0,0,0,0.25)';
      var shadowCss = (s.type === 'INNER_SHADOW' ? 'inset ' : '') + off + ' ' + blur + ' ' + color;
      return '<div class="shadow-swatch" title="Shadow ' + (i + 1) + '" ' +
        'style="width:30px;height:30px;background:#fff;border-radius:4px;box-shadow:' + shadowCss + ';flex:none"></div>';
    }).join('');
    return '<div style="margin-top:8px">' +
      '<div style="font-size:10px;color:var(--text-muted,#888);margin-bottom:4px">Shadows (' + shadows.length + ')</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' + swatches + '</div>' +
    '</div>';
  }

  function colorToCss(c) {
    if (!c) return null;
    if (typeof c === 'string') return c;
    if (typeof c.r === 'number') {
      var r = Math.round(c.r * 255), g = Math.round(c.g * 255), b = Math.round(c.b * 255);
      var a = c.a != null ? c.a : 1;
      return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    }
    return null;
  }

  // ── Compact input for 2-column pairs (W+H, Size+Weight, etc) ──
  function propCompact(label, name, value, sessionId, nodeId) {
    // Auto-detect input type — enum strings ("INSIDE", "MITER", "NONE")
    // can't be type="number" without browser spamming "cannot be parsed"
    // errors. Numeric values use number; everything else uses text.
    var stringVal = String(value);
    var isNumeric = stringVal !== '' && !isNaN(Number(stringVal));
    var inputType = isNumeric ? 'number' : 'text';
    var stepAttr = isNumeric ? ' step="1"' : '';
    // name + autocomplete=off silences the "form field should have an
    // id or name" accessibility warning — we had 800+ of those per
    // scene because every propCompact rendered a nameless input.
    return '<div class="prop-compact">' +
      '<span class="prop-compact-label">' + escape(label) + '</span>' +
      '<input class="prop-compact-input" type="' + inputType + '" value="' + escape(stringVal) + '" ' +
        'name="' + escape(name) + '" autocomplete="off" ' +
        'data-prop="' + escape(name) + '" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '"' + stepAttr + '>' +
    '</div>';
  }

  function bindPropInputs() {
    // Section collapse toggles.
    $$('[data-collapse-toggle]').forEach(function(header) {
      header.addEventListener('click', function() {
        header.parentElement.classList.toggle('collapsed');
      });
    });
    // Compact number inputs + font input + hex input.
    $$('.prop-compact-input, .spacing-val, .fill-hex, .type-font-input').forEach(function(input) {
      input.addEventListener('change', function() {
        var prop = input.getAttribute('data-prop');
        var scene = input.getAttribute('data-scene');
        var node = input.getAttribute('data-node');
        if (!prop || !scene || !node) return;
        var val = input.type === 'number' ? Number(input.value) : input.value;
        editNodeProp(scene, node, prop, val);
      });
      // Enter = commit.
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { input.blur(); }
      });
    });
    // Direction toggle buttons.
    $$('.dir-btn[data-prop]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var prop = btn.getAttribute('data-prop');
        var val = btn.getAttribute('data-val');
        var scene = btn.getAttribute('data-scene');
        var node = btn.getAttribute('data-node');
        if (!prop || !val || !scene || !node) return;
        $$('.dir-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        editNodeProp(scene, node, prop, val);
      });
    });
    // Effect sliders (radius, opacity).
    $$('.effect-slider[data-prop]').forEach(function(slider) {
      slider.addEventListener('input', function() {
        var valueEl = slider.parentElement.querySelector('.effect-value');
        var prop = slider.getAttribute('data-prop');
        if (prop === 'opacity') {
          if (valueEl) valueEl.textContent = Math.round(Number(slider.value) * 100) + '%';
        } else {
          if (valueEl) valueEl.textContent = String(Math.round(Number(slider.value)));
        }
      });
      slider.addEventListener('change', function() {
        var prop = slider.getAttribute('data-prop');
        var scene = slider.getAttribute('data-scene');
        var node = slider.getAttribute('data-node');
        if (!prop || !scene || !node) return;
        editNodeProp(scene, node, prop, Number(slider.value));
      });
    });
    // Fill swatch click → open native color picker.
    $$('.fill-swatch[data-prop]').forEach(function(swatch) {
      swatch.addEventListener('click', function() {
        var prop = swatch.getAttribute('data-prop');
        var scene = swatch.getAttribute('data-scene');
        var node = swatch.getAttribute('data-node');
        if (!prop || !scene || !node) return;
        var picker = document.createElement('input');
        picker.type = 'color';
        var hexInput = swatch.parentElement && swatch.parentElement.querySelector('.fill-hex');
        if (hexInput) picker.value = hexInput.value;
        picker.style.cssText = 'position:absolute;opacity:0;pointer-events:none';
        document.body.appendChild(picker);
        picker.addEventListener('input', function() {
          swatch.style.background = picker.value;
          if (hexInput) hexInput.value = picker.value;
        });
        picker.addEventListener('change', function() {
          editNodeProp(scene, node, prop, picker.value);
          picker.remove();
        });
        picker.click();
      });
    });

    // ── Figma-grade enhancements (Phase 1 polish) ─────────────────
    // All of these run AFTER the basic wiring above, transforming the
    // panel from "Excel of properties" into a proper Figma-style UI:
    //   1. Drag-to-change on label hover (Shift = ×10, Alt = /10)
    //   2. Color swatch → popover picker (HSL + hex + brand tokens)
    //   3. W/H lock-aspect chain icon between width/height inputs
    //   4. Section collapse persistence in localStorage
    //   5. Inline AI augments next to relevant fields
    enhanceDragToChange();
    enhanceColorPopover();
    enhanceAspectLock();
    enhanceCollapsePersist();
    enhanceAlignmentCells();
    enhancePaddingLink();
    enhanceStateClone();
    enhanceTokenUnbind();
    enhanceAnimationPreview();
    enhanceInlineAiHooks();
    // Break-out button — explicit Figma-style "detach from auto-layout".
    // Logic lives in detachNodeFromLayout() so the top-bar Detach button
    // can apply the same operation to multi-selection.
    $$('[data-break-out]').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var sceneId = btn.getAttribute('data-scene');
        var nodeId = btn.getAttribute('data-node');
        if (!sceneId || !nodeId) return;
        var ok = await detachNodeFromLayout(sceneId, nodeId);
        if (ok) flash('Detached — drag anywhere on canvas', 'success');
      });
    });
    // Silence a11y warnings: every <input> without name/id triggers
    // a browser issue. Our dynamically-rendered panel creates dozens
    // per scene → 800+ warnings. Backfill them after render.
    var panelEl = $('[data-panel="design"]');
    if (panelEl) {
      panelEl.querySelectorAll('input').forEach(function(inp) {
        if (!inp.getAttribute('name') && !inp.getAttribute('id')) {
          var n = inp.getAttribute('data-prop') || 'prop-' + Math.random().toString(36).slice(2, 7);
          inp.setAttribute('name', n);
        }
        if (!inp.getAttribute('autocomplete')) {
          inp.setAttribute('autocomplete', 'off');
        }
      });
    }
  }

  // ── Token unbind: click ✕ on a bound fill chip ─────────────────
  function enhanceTokenUnbind() {
    $$('.prop-token-unbind').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var prop = btn.getAttribute('data-prop');
        var sceneId = btn.getAttribute('data-scene');
        var nodeId = btn.getAttribute('data-node');
        if (!prop || !sceneId || !nodeId) return;
        // Server convention: <prop>__token = null clears the binding.
        editNodeProp(sceneId, nodeId, prop + '__token', null);
      });
    });
  }

  // ── Phase 2.4: Animation preset hover preview ─────────────────────
  // Each .anim-preset-btn gets a data-anim attribute (the preset name)
  // we already have. On hover, we toggle a CSS class that plays the
  // matching keyframe animation on the button itself, so the user sees
  // what each preset does before clicking.
  function enhanceAnimationPreview() {
    if (!document.getElementById('reframe-anim-preview-css')) {
      var style = document.createElement('style');
      style.id = 'reframe-anim-preview-css';
      // Each animation maps to a tasteful 600ms keyframe so the user
      // gets a sense of motion. Names mirror the engine's 8 presets.
      style.textContent = [
        '.anim-preview { animation-duration: 600ms; animation-iteration-count: 1; animation-fill-mode: both; }',
        '.anim-preview-fadeIn { animation-name: rfFade; }',
        '.anim-preview-slideInUp { animation-name: rfSlideUp; }',
        '.anim-preview-slideInLeft { animation-name: rfSlideLeft; }',
        '.anim-preview-popIn { animation-name: rfPop; }',
        '.anim-preview-bounce { animation-name: rfBounce; }',
        '.anim-preview-shimmer { animation-name: rfShimmer; }',
        '.anim-preview-scaleIn { animation-name: rfScale; }',
        '.anim-preview-typewriter { animation-name: rfTypewriter; }',
        '@keyframes rfFade { from{opacity:0} to{opacity:1} }',
        '@keyframes rfSlideUp { from{transform:translateY(10px);opacity:0} to{transform:translateY(0);opacity:1} }',
        '@keyframes rfSlideLeft { from{transform:translateX(-10px);opacity:0} to{transform:translateX(0);opacity:1} }',
        '@keyframes rfPop { 0%{transform:scale(.85);opacity:0} 60%{transform:scale(1.05)} 100%{transform:scale(1);opacity:1} }',
        '@keyframes rfBounce { 0%{transform:translateY(0)} 30%{transform:translateY(-6px)} 60%{transform:translateY(0)} 80%{transform:translateY(-3px)} 100%{transform:translateY(0)} }',
        '@keyframes rfShimmer { from{background-position:-30px 0} to{background-position:30px 0} }',
        '@keyframes rfScale { from{transform:scale(.6);opacity:0} to{transform:scale(1);opacity:1} }',
        '@keyframes rfTypewriter { from{width:0;overflow:hidden} to{width:100%;overflow:hidden} }',
      ].join('\n');
      document.head.appendChild(style);
    }
    $$('.anim-preset-btn[data-preset]').forEach(function(btn) {
      var preset = btn.getAttribute('data-preset');
      if (!preset) return;
      btn.addEventListener('mouseenter', function() {
        btn.classList.add('anim-preview', 'anim-preview-' + preset);
        // Auto-remove after the animation ends so re-hover replays.
        setTimeout(function() {
          btn.classList.remove('anim-preview', 'anim-preview-' + preset);
        }, 700);
      });
    });
  }

  // ── 9-cell alignment grid wiring ─────────────────────────────────
  // Each cell sets primary + counter axis alignment in one click.
  function enhanceAlignmentCells() {
    $$('.align-cell').forEach(function(cell) {
      cell.addEventListener('click', function() {
        var primary = cell.getAttribute('data-primary');
        var counter = cell.getAttribute('data-counter');
        var sceneId = cell.getAttribute('data-scene');
        var nodeId = cell.getAttribute('data-node');
        if (!primary || !counter || !sceneId || !nodeId) return;
        // Both fire as separate edits — server handles each as a prop update.
        editNodeProp(sceneId, nodeId, 'primary-axis-align', primary);
        editNodeProp(sceneId, nodeId, 'counter-axis-align', counter);
        // Visually mark active immediately for snappy feedback.
        $$('.align-cell').forEach(function(c) {
          c.classList.remove('active');
          c.style.background = 'transparent';
          c.style.borderColor = 'var(--border,#333)';
        });
        cell.classList.add('active');
        cell.style.background = 'var(--accent,#f15a29)';
        cell.style.borderColor = 'var(--accent,#f15a29)';
      });
    });
  }

  // ── Padding link toggle ──────────────────────────────────────────
  // When linked: editing any padding side updates ALL four. When not:
  // each side stays independent. State is per-render (no localStorage —
  // it's contextual to the node).
  function enhancePaddingLink() {
    var toggle = $('.padding-link-toggle');
    if (!toggle) return;
    toggle.addEventListener('click', function() {
      var linked = toggle.getAttribute('data-linked') === '1';
      linked = !linked;
      toggle.setAttribute('data-linked', linked ? '1' : '0');
      toggle.innerHTML = iconLink(linked);
      toggle.title = linked ? 'Unlink padding' : 'Link all sides';
      toggle.classList.toggle('on', linked);
    });
    // Wire ALL spacing-val inputs so when one changes and link is on,
    // all 4 update + persist.
    $$('.spacing-val').forEach(function(input) {
      input.addEventListener('change', function() {
        var linked = toggle.getAttribute('data-linked') === '1';
        if (!linked) return;
        var val = input.value;
        var sceneId = input.getAttribute('data-scene');
        var nodeId = input.getAttribute('data-node');
        if (!sceneId || !nodeId) return;
        // Update all 4 sides — input's own change handler fires for the
        // typed one; we explicitly persist the other 3.
        var sides = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'];
        sides.forEach(function(side) {
          if (side === input.getAttribute('data-prop')) return; // skip self
          var other = $('.spacing-val[data-prop="' + side + '"]');
          if (other) {
            other.value = val;
            editNodeProp(sceneId, nodeId, side, Number(val));
          }
        });
      });
    });
  }

  // ── State clone-from-base wiring ─────────────────────────────────
  // Click "⧉ Clone base" → server adds a state with sensible defaults
  // baked in (hover = 90% opacity + slight color shift, etc). For MVP
  // we just call editNodeProp with a state-add op; server resolves the
  // sensible defaults based on state name.
  function enhanceStateClone() {
    $$('.state-clone-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var state = btn.getAttribute('data-state');
        var sceneId = btn.getAttribute('data-scene');
        var nodeId = btn.getAttribute('data-node');
        if (!state || !sceneId || !nodeId) return;
        // Sensible defaults per state — matches what a designer would
        // expect when adding interaction states from scratch.
        var defaults;
        if (state === 'hover')    defaults = { opacity: 0.9 };
        else if (state === 'active')   defaults = { opacity: 0.85 };
        else if (state === 'focus')    defaults = { 'border-radius': 6 };
        else if (state === 'disabled') defaults = { opacity: 0.5 };
        else defaults = {};
        // Server stores under states.<name>; we send via a dedicated prop key.
        editNodeProp(sceneId, nodeId, 'state.' + state, defaults);
        btn.disabled = true;
        btn.textContent = 'Cloned';
      });
    });
  }

  // ── Phase 1.1: Drag-to-change on numeric input labels ────────────
  // Hover the label (W/H/X/Y/Wt/Size/Gap/etc) → cursor becomes ew-resize.
  // Mousedown + drag horizontally → value changes by 1 per pixel.
  // Shift modifier → ×10, Alt → /10. Releases on mouseup. Triggers a
  // 'change' event so existing input listeners (editNodeProp) fire.
  function enhanceDragToChange() {
    $$('.prop-compact-label, .spacing-label').forEach(function(label) {
      // Only labels that sit next to a number input are draggable.
      var pair = label.parentElement;
      if (!pair) return;
      var input = pair.querySelector('input[type="number"]');
      if (!input) return;
      label.style.cursor = 'ew-resize';
      label.style.userSelect = 'none';

      label.addEventListener('mousedown', function(e) {
        e.preventDefault();
        var startX = e.clientX;
        var startVal = Number(input.value) || 0;
        document.body.style.cursor = 'ew-resize';

        function onMove(ev) {
          var dx = ev.clientX - startX;
          var step = ev.shiftKey ? 10 : (ev.altKey ? 0.1 : 1);
          var newVal = startVal + dx * step;
          // Round to 2 decimals max to avoid float ugliness.
          input.value = String(Math.round(newVal * 100) / 100);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        function onUp() {
          document.body.style.cursor = '';
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          // Commit by firing change — existing handlers persist to server.
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });
  }

  // ── Phase 1.5: Color swatch → popover picker ─────────────────────
  // Replaces the native <input type=color> dialog with an inline popover
  // that has HSL slider + hex input + brand-token chips. Better UX than
  // the OS-level color picker (which is laggy and brand-blind).
  function enhanceColorPopover() {
    // We REPLACE the existing native-picker swatch handlers — find each
    // swatch, clone it (drops listeners), then attach our popover handler.
    $$('.fill-swatch[data-prop]').forEach(function(swatch) {
      var clone = swatch.cloneNode(true);
      swatch.parentNode.replaceChild(clone, swatch);
    });
    $$('.fill-swatch[data-prop]').forEach(function(swatch) {
      swatch.style.cursor = 'pointer';
      swatch.addEventListener('click', function(e) {
        e.stopPropagation();
        openColorPopover(swatch);
      });
    });
  }

  function openColorPopover(swatch) {
    // Close any existing popover.
    var existing = document.getElementById('reframe-color-popover');
    if (existing) existing.remove();

    var prop = swatch.getAttribute('data-prop');
    var sceneId = swatch.getAttribute('data-scene');
    var nodeId = swatch.getAttribute('data-node');
    var hexInput = swatch.parentElement && swatch.parentElement.querySelector('.fill-hex');
    var current = (hexInput && hexInput.value) || '#000000';

    var rect = swatch.getBoundingClientRect();
    var pop = document.createElement('div');
    pop.id = 'reframe-color-popover';
    pop.style.cssText =
      'position:fixed;left:' + Math.max(8, rect.left - 4) + 'px;' +
      'top:' + (rect.bottom + 6) + 'px;z-index:11000;' +
      'background:var(--surface-elevated,#1a1a1a);' +
      'border:1px solid var(--border,#333);border-radius:8px;' +
      'box-shadow:0 12px 40px rgba(0,0,0,.5);padding:10px;width:240px;' +
      'font-family:inherit;font-size:11px;color:var(--text-primary,#e5e5e5)';

    pop.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
        '<div data-pop-swatch style="width:32px;height:32px;border-radius:6px;border:1px solid var(--border,#333);background:' + escape(current) + '"></div>' +
        '<input data-pop-hex type="text" value="' + escape(current) + '" ' +
          'style="flex:1;padding:4px 6px;font-size:11px;background:var(--surface,#0e0e0e);color:inherit;' +
          'border:1px solid var(--border,#333);border-radius:4px;outline:none;font-family:var(--mono,monospace)">' +
      '</div>' +
      '<input data-pop-native type="color" value="' + escape(current) + '" ' +
        'style="width:100%;height:32px;border:1px solid var(--border,#333);border-radius:4px;background:none;padding:2px;cursor:pointer">' +
      '<div data-pop-tokens style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px"></div>';

    document.body.appendChild(pop);

    var popSwatch = pop.querySelector('[data-pop-swatch]');
    var popHex = pop.querySelector('[data-pop-hex]');
    var popNative = pop.querySelector('[data-pop-native]');
    var popTokens = pop.querySelector('[data-pop-tokens]');

    // Brand tokens — fetched from /platform/api/tokens/<sceneId>. Each
    // token chip shows a small swatch with the resolved color plus the
    // token name. Click to bind. Loading state shown while fetching.
    popTokens.innerHTML = '<div style="width:100%;font-size:10px;color:var(--text-muted,#888)">Loading brand tokens…</div>';
    fetchSceneTokens(sceneId).then(function(tokens) {
      var colorTokens = tokens.filter(function(t) { return t.type === 'COLOR'; });
      if (colorTokens.length === 0) {
        popTokens.innerHTML =
          '<div style="width:100%;font-size:10px;color:var(--text-muted,#888)">' +
          'No brand tokens. Apply a brand via reframe_design first.' +
          '</div>';
        return;
      }
      popTokens.innerHTML =
        '<div style="width:100%;font-size:10px;color:var(--text-muted,#888);margin-bottom:4px">Brand tokens</div>' +
        colorTokens.slice(0, 16).map(function(t) {
          return '<button data-pop-token="' + escape(t.name) + '" type="button" title="' + escape(t.name) + '" ' +
            'style="padding:2px 6px 2px 4px;font-size:10px;background:var(--surface,#0e0e0e);' +
            'color:var(--text-muted,#888);border:1px solid var(--border,#333);border-radius:4px;cursor:pointer;' +
            'font-family:inherit;display:inline-flex;align-items:center;gap:4px">' +
            '<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + escape(String(t.value)) + ';flex:none"></span>' +
            escape(t.name.replace(/^color./, '')) +
            '</button>';
        }).join('');

      // Wire token-pick clicks here (rendered async after fetch).
      popTokens.querySelectorAll('[data-pop-token]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var token = btn.getAttribute('data-pop-token');
          editNodeProp(sceneId, nodeId, prop + '__token', token);
          pop.remove();
        });
      });
    });

    function applyHex(hex) {
      popSwatch.style.background = hex;
      popNative.value = hex;
      popHex.value = hex;
      swatch.style.background = hex;
      if (hexInput) hexInput.value = hex;
    }

    popHex.addEventListener('input', function() {
      var v = popHex.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v)) applyHex(v);
    });
    popNative.addEventListener('input', function() {
      applyHex(popNative.value);
    });
    popNative.addEventListener('change', function() {
      editNodeProp(sceneId, nodeId, prop, popNative.value);
    });
    popHex.addEventListener('change', function() {
      var v = popHex.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v)) editNodeProp(sceneId, nodeId, prop, v);
    });
    // (Token chips are wired async inside fetchSceneTokens.then above.)

    // Dismiss on outside click
    setTimeout(function() {
      function dismiss(e) {
        if (!pop.contains(e.target) && e.target !== swatch) {
          pop.remove();
          document.removeEventListener('mousedown', dismiss);
        }
      }
      document.addEventListener('mousedown', dismiss);
    }, 0);
  }

  // ── Phase 1.6: W/H aspect-lock chain ─────────────────────────────
  // Inserts a chain icon between width and height inputs. When locked,
  // editing one proportionally updates the other. State persists per
  // session in localStorage so it survives node-switching.
  function enhanceAspectLock() {
    var wInput = $('.prop-compact-input[data-prop="width"]');
    var hInput = $('.prop-compact-input[data-prop="height"]');
    if (!wInput || !hInput) return;
    // Only one chain per render — guard against duplicates.
    if (document.getElementById('reframe-aspect-chain')) return;

    var pair = wInput.closest('.prop-pair');
    if (!pair) return;

    var locked = (function() {
      try { return localStorage.getItem('reframe.aspectLock') === '1'; } catch (_) { return false; }
    })();

    var chain = document.createElement('button');
    chain.id = 'reframe-aspect-chain';
    chain.type = 'button';
    chain.className = 'prop-icon-btn' + (locked ? ' on' : '');
    chain.title = locked ? 'Aspect locked' : 'Aspect free';
    chain.style.alignSelf = 'center';
    chain.innerHTML = iconLink(locked);
    // Insert between width and height controls (after the W .prop-compact, before H).
    var compacts = pair.querySelectorAll('.prop-compact');
    if (compacts.length < 2) return;
    pair.insertBefore(chain, compacts[1]);

    chain.addEventListener('click', function() {
      locked = !locked;
      try { localStorage.setItem('reframe.aspectLock', locked ? '1' : '0'); } catch (_) {}
      chain.innerHTML = iconLink(locked);
      chain.title = locked ? 'Aspect locked' : 'Aspect free';
      chain.classList.toggle('on', locked);
    });

    // When locked + one changes → update the other proportionally.
    var ratio = (Number(wInput.value) || 1) / (Number(hInput.value) || 1);
    function onChange(src, dst, isWidth) {
      src.addEventListener('input', function() {
        if (!locked) return;
        var v = Number(src.value);
        if (!v || !isFinite(v)) return;
        var newOther = isWidth ? v / ratio : v * ratio;
        dst.value = String(Math.round(newOther * 100) / 100);
        dst.dispatchEvent(new Event('input', { bubbles: true }));
      });
      src.addEventListener('change', function() {
        // Update ratio when user explicitly commits a non-locked change.
        if (!locked) {
          ratio = (Number(wInput.value) || 1) / (Number(hInput.value) || 1);
        } else {
          // Persist BOTH — the input's own change handler covers src,
          // we need to fire change on dst too.
          dst.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    }
    onChange(wInput, hInput, true);
    onChange(hInput, wInput, false);
  }

  // ── Phase 1.7: Section collapse persistence ──────────────────────
  // Each section header has [data-collapse-toggle]. When clicked, the
  // parent gets .collapsed. We persist that to localStorage keyed by
  // the section's text label so the user's preference survives node
  // switches and reloads.
  function enhanceCollapsePersist() {
    var KEY = 'reframe.props.collapsed';
    var collapsed = (function() {
      try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) { return {}; }
    })();

    $$('[data-collapse-toggle]').forEach(function(header) {
      var label = (header.textContent || '').trim().replace(/▼|▶/g, '').trim();
      if (!label) return;
      // Restore prior state.
      if (collapsed[label]) {
        header.parentElement && header.parentElement.classList.add('collapsed');
      }
      // Save on toggle. The default click handler from bindPropInputs
      // already toggles the class — we just observe AFTER it ran.
      header.addEventListener('click', function() {
        // setTimeout 0 lets the existing handler complete first.
        setTimeout(function() {
          collapsed[label] = header.parentElement.classList.contains('collapsed');
          try { localStorage.setItem(KEY, JSON.stringify(collapsed)); } catch (_) {}
        }, 0);
      });
    });
  }

  // ── Phase 3: Inline AI augments (sparingly placed) ───────────────
  // Small text links that expand specific aspects of the node into AI
  // calls. We only add them where AI provides clear value over manual:
  //   - Fill   → "Match brand"   (rebrand-color this node's fill)
  //   - States → "Generate hover" (AI creates a sensible hover variant)
  //   - Animation → "Suggest"    (AI picks a fitting preset)
  // Style: tiny ✨-prefixed link, NOT a chip. Discoverable but not noisy.
  function enhanceInlineAiHooks() {
    var nodeId = (function() {
      var firstSwatch = $('.fill-swatch[data-node]');
      return firstSwatch ? firstSwatch.getAttribute('data-node') : null;
    })();
    var sceneId = (function() {
      var firstSwatch = $('.fill-swatch[data-scene]');
      return firstSwatch ? firstSwatch.getAttribute('data-scene') : null;
    })();
    if (!sceneId) return;

    function aiLink(label, prompt) {
      return '<a data-ai-augment href="javascript:void(0)" data-prompt="' + escape(prompt) + '" ' +
        'style="font-size:10px;color:var(--accent,#f15a29);margin-left:6px;text-decoration:none">' +
        '✨ ' + escape(label) + '</a>';
    }

    // Fill: append "Match brand"
    var fillSection = (function() {
      var headers = $$('.props-section-header');
      for (var i = 0; i < headers.length; i++) {
        if ((headers[i].textContent || '').trim().indexOf('Fill') === 0) return headers[i];
      }
      return null;
    })();
    if (fillSection && !fillSection.querySelector('[data-ai-augment]')) {
      fillSection.insertAdjacentHTML('beforeend', aiLink('Match brand', 'Bind this fill to the closest brand color token.'));
    }

    // States: append "Generate states"
    var stateHeaders = $$('.props-section-header');
    for (var i = 0; i < stateHeaders.length; i++) {
      if ((stateHeaders[i].textContent || '').trim().indexOf('States') === 0 &&
          !stateHeaders[i].querySelector('[data-ai-augment]')) {
        stateHeaders[i].insertAdjacentHTML('beforeend', aiLink('Generate hover', 'Create a tasteful hover state for this node.'));
        break;
      }
    }
    // Animation: append "Suggest"
    for (var j = 0; j < stateHeaders.length; j++) {
      if ((stateHeaders[j].textContent || '').trim().indexOf('Animation') === 0 &&
          !stateHeaders[j].querySelector('[data-ai-augment]')) {
        stateHeaders[j].insertAdjacentHTML('beforeend', aiLink('Suggest', 'Pick the best entrance animation for this node based on its role.'));
        break;
      }
    }
    // Type: append "Match brand typography"
    for (var k = 0; k < stateHeaders.length; k++) {
      if ((stateHeaders[k].textContent || '').trim().indexOf('Type') === 0 &&
          !stateHeaders[k].querySelector('[data-ai-augment]')) {
        stateHeaders[k].insertAdjacentHTML('beforeend', aiLink('Match brand', 'Apply the active brand typography (font family, size, weight, letter-spacing) to this text node.'));
        break;
      }
    }
    // Layout: append "Auto-arrange"
    for (var m = 0; m < stateHeaders.length; m++) {
      if ((stateHeaders[m].textContent || '').trim().indexOf('Layout') === 0 &&
          !stateHeaders[m].querySelector('[data-ai-augment]')) {
        stateHeaders[m].insertAdjacentHTML('beforeend', aiLink('Auto-arrange', 'Pick a sensible alignment + gap + padding for this container based on its children.'));
        break;
      }
    }
    // Identity: small "rename clearly" hint right next to node name.
    var nodeNameEl = $('.node-name');
    if (nodeNameEl && !nodeNameEl.querySelector('[data-ai-augment]')) {
      nodeNameEl.insertAdjacentHTML('beforeend', aiLink('Rename', 'Suggest a clearer semantic name for this node based on its content and role.'));
    }

    // Wire all augment links to fire the floating Ask Agent with prefilled prompt.
    $$('[data-ai-augment]').forEach(function(link) {
      link.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var prompt = link.getAttribute('data-prompt') || '';
        window.dispatchEvent(new CustomEvent('reframe:ask-agent', {
          detail: {
            nodeId: nodeId || null,
            x: window.innerWidth / 2 - 220,
            y: 100,
            prefill: prompt,
          },
        }));
      });
    });
  }

  async function editNodeProp(sceneId, nodeId, prop, value) {
    // "root" is a server-side alias resolved to scene.rootId. It isn't
    // in the OP bridge (bridge only knows real node UUIDs), so the
    // generic skip-if-not-in-bridge rule below would drop it. Let it
    // through unchanged.
    var isSceneRootAlias = nodeId === 'root';
    // Translate raw OP id → reframe id if bridge has the mapping. Skip
    // entirely when nodeId has no server counterpart (OP-only chrome,
    // synthetic events). Without this we 404 + show a toast on every
    // canvas event from a non-mapped node.
    var bridge = window.__reframeBridge;
    if (!isSceneRootAlias && bridge && bridge.opToReframeId && bridge.opToReframeId.get) {
      var mapped = bridge.opToReframeId.get(nodeId);
      if (mapped) nodeId = mapped;
      else if (bridge.reframeToOpId && bridge.reframeToOpId.has && !bridge.reframeToOpId.has(nodeId)) {
        // Not in either direction — OP-only id. Skip silently.
        return;
      }
    }
    var edits = {};
    edits[prop] = value;
    // Direct fetch instead of api() — 404 stays silent (stale id races
    // during drag / SSE rebuild are expected and shouldn't toast). Any
    // other error DOES flash: the user should know when their input was
    // accepted-by-server-but-not-applied vs just dropped.
    try {
      var resp = await fetch('/platform/api/node/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneId: sceneId, nodeId: nodeId, props: edits }),
      });
      if (resp.status === 404) return; // node gone (sync race) — silent
      if (!resp.ok) {
        var errText = '';
        try { errText = await resp.text(); } catch (_) {}
        flash('Edit ' + prop + ' failed: ' + resp.status + (errText ? ' · ' + errText.slice(0, 80) : ''), 'error');
        return;
      }
      var res = await resp.json();
      if (!res.ok) {
        flash('Edit ' + prop + ' rejected: ' + (res.error || 'unknown'), 'error');
        return;
      }
      if (res.ok && res.props) {
        // Update swatch if color changed.
        var swatch = $('.prop-swatch[data-prop="' + prop + '"]');
        if (swatch && (prop === 'background' || prop === 'color')) {
          swatch.style.background = res.props[prop] || value;
        }
        // If OP CanvasKit is active, notify it to re-hydrate this node
        // so the canvas reflects the property change without full reload.
        // Use the server-resolved nodeId (res.nodeId) so aliases like
        // "root" become the real UUID — otherwise CanvasKit listeners
        // keyed on node id can't match the event.
        var ckCanvas = document.getElementById('reframe-viewport');
        if (ckCanvas) {
          window.dispatchEvent(new CustomEvent('reframe:prop-changed', {
            detail: { sceneId: sceneId, nodeId: res.nodeId || nodeId, prop: prop, value: value, props: res.props },
          }));
        }
      }
    } catch (_) {}
  }
