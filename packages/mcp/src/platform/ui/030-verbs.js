  // ════════════════════════════════════════════════════════
  // VerbPanels — inline glass panels replacing ALL prompt() calls.
  // Each verb gets a purpose-built panel that floats near the node.
  // ════════════════════════════════════════════════════════

  function showVerbPanel(verb, html, onSubmit) {
    // Remove any existing verb panel.
    closeVerbPanel();
    var frame = $('.viewport-frame') || $('.main') || document.querySelector('.app') || document.body;
    var panel = document.createElement('div');
    panel.className = 'verb-panel show';
    panel.setAttribute('data-verb-panel', verb);
    panel.innerHTML =
      '<div class="verb-panel-head">' +
        '<span class="verb-panel-title">' + escape(verb) + '</span>' +
        '<button class="verb-panel-close">×</button>' +
      '</div>' +
      html +
      '<div class="verb-panel-submit">' +
        '<button class="btn btn-ghost btn-sm" data-vp-action="cancel">Cancel</button>' +
        '<button class="btn btn-primary btn-sm" data-vp-action="submit">Apply</button>' +
      '</div>';
    frame.appendChild(panel);
    // Position near selected node.
    positionVerbPanel(panel);
    // Bind close + cancel + submit.
    panel.querySelector('.verb-panel-close').addEventListener('click', closeVerbPanel);
    panel.querySelector('[data-vp-action="cancel"]').addEventListener('click', closeVerbPanel);
    panel.querySelector('[data-vp-action="submit"]').addEventListener('click', function() {
      if (onSubmit) onSubmit(panel);
      closeVerbPanel();
    });
    // Focus first input if any.
    var firstInput = panel.querySelector('input, select, textarea');
    if (firstInput) setTimeout(function() { firstInput.focus(); }, 50);
    // Enter = submit in single-input panels.
    panel.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
        e.preventDefault();
        if (onSubmit) onSubmit(panel);
        closeVerbPanel();
      }
      if (e.key === 'Escape') { closeVerbPanel(); }
    });
  }

  function closeVerbPanel() {
    var existing = $('[data-verb-panel]');
    if (existing) existing.remove();
  }

  function positionVerbPanel(panel) {
    if (!state.selection.bbox) return;
    var frame = $('.viewport-frame');
    if (!frame) return;
    var dims = VIEWPORT_DIMS[state.currentViewport];
    var sx = frame.clientWidth / dims.w;
    var sy = frame.clientHeight / dims.h;
    var b = state.selection.bbox;
    // Position to the right of the node, vertically centered.
    var left = b.x * sx + b.w * sx + 12;
    var top = b.y * sy;
    // If would overflow right edge, put to the left instead.
    if (left + 300 > frame.clientWidth) {
      left = b.x * sx - 300 - 12;
    }
    panel.style.left = Math.max(8, left) + 'px';
    panel.style.top = Math.max(8, top) + 'px';
  }

  // ── Ask verb panel ─────────────────────────────────
  function handleAsk() {
    showVerbPanel('Ask',
      '<input class="ask-input" type="text" placeholder="Ask about this node…" data-vp-field="text">' +
      '<div class="ask-hint">Enter to submit · Esc to cancel</div>',
      function(panel) {
        var input = panel.querySelector('[data-vp-field="text"]');
        var text = input ? input.value.trim() : '';
        if (!text) return;
        submitGesture({
          kind: 'ask',
          at: new Date().toISOString(),
          sceneSlug: state.currentSceneSlug,
          author: { kind: 'human', id: 'platform-ui' },
          anchor: state.selection.inode,
          text: text,
        });
      }
    );
  }

  // ── Rule verb panel ────────────────────────────────
  function handleRule() {
    var commonRules = [
      'min-contrast', 'min-height-44', 'min-font-size',
      'brand-only', 'max-width', 'no-shrink-mobile',
      'spacing-grid', 'touch-target', 'text-overflow',
    ];
    var options = commonRules.map(function(r) {
      return '<option value="' + escape(r) + '">' + escape(r) + '</option>';
    }).join('');

    showVerbPanel('Rule',
      '<select class="rule-select" data-vp-field="rule">' +
        '<option value="">Select a rule…</option>' +
        options +
        '<option value="__custom">Custom…</option>' +
      '</select>' +
      '<input class="rule-value-input" type="text" placeholder="Custom rule name" data-vp-field="custom-rule" style="display:none">' +
      '<input class="rule-value-input" type="text" placeholder="Value (optional)" data-vp-field="value" style="display:none">' +
      '<label class="rule-enforced"><input type="checkbox" data-vp-field="enforced" checked> Standing order (audit enforces)</label>',
      function(panel) {
        var selectEl = panel.querySelector('[data-vp-field="rule"]');
        var valueEl = panel.querySelector('[data-vp-field="value"]');
        var enforcedEl = panel.querySelector('[data-vp-field="enforced"]');
        var rule = selectEl ? selectEl.value : '';
        if (rule === '__custom') {
          // Custom rule: read from a hidden input that appears when Custom is selected.
          var customInput = panel.querySelector('[data-vp-field="custom-rule"]');
          rule = customInput ? customInput.value.trim() : '';
        }
        if (!rule) return;
        var valStr = valueEl ? valueEl.value.trim() : '';
        var value = undefined;
        if (valStr) {
          var asNum = Number(valStr);
          value = isNaN(asNum) ? valStr : asNum;
        }
        submitGesture({
          kind: 'rule',
          at: new Date().toISOString(),
          sceneSlug: state.currentSceneSlug,
          author: { kind: 'human', id: 'platform-ui' },
          anchor: state.selection.inode,
          rule: rule,
          value: value,
          enforced: enforcedEl ? enforcedEl.checked : true,
        });
      }
    );
    // Show value input when a rule is selected + custom input when Custom chosen.
    var select = $('[data-verb-panel] .rule-select');
    var valInput = $('[data-verb-panel] [data-vp-field="value"]');
    var customInput = $('[data-verb-panel] [data-vp-field="custom-rule"]');
    if (select) {
      select.addEventListener('change', function() {
        if (valInput) valInput.style.display = select.value ? '' : 'none';
        if (customInput) customInput.style.display = select.value === '__custom' ? '' : 'none';
      });
    }
  }

  // ── Echo verb panel (axis picker after two-click) ──
  function handleEchoAxis(fromAnchor, toAnchor) {
    var axes = ['visual-style', 'structure', 'role', 'all'];
    var html = '<div class="echo-step">Echo from <strong>' + escape(String(fromAnchor).slice(-8)) + '</strong> to <strong>' + escape(String(toAnchor).slice(-8)) + '</strong></div>' +
      '<div class="echo-axes">' +
        axes.map(function(ax, i) {
          return '<button class="echo-axis' + (i === 0 ? ' active' : '') + '" data-axis="' + escape(ax) + '">' + escape(ax) + '</button>';
        }).join('') +
      '</div>';
    showVerbPanel('Echo', html, function(panel) {
      var activeAxis = panel.querySelector('.echo-axis.active');
      var axis = activeAxis ? activeAxis.getAttribute('data-axis') : 'visual-style';
      submitGesture({
        kind: 'echo',
        at: new Date().toISOString(),
        sceneSlug: state.currentSceneSlug,
        author: { kind: 'human', id: 'platform-ui' },
        fromAnchor: fromAnchor,
        toAnchor: toAnchor,
        axis: axis,
      });
    });
    // Bind axis buttons to toggle active state.
    $$('[data-verb-panel] .echo-axis').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        $$('[data-verb-panel] .echo-axis').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
      });
    });
  }

  // ── Pin verb panel (tabs: Image / URL / Brand / Node) ─
  function handlePin() {
    var tabs = ['Image', 'URL', 'Brand', 'Node'];
    showVerbPanel('Pin',
      '<div class="pin-tabs">' +
        tabs.map(function(t, i) {
          return '<button class="pin-tab' + (i === 0 ? ' active' : '') + '" data-pin-type="' + escape(t.toLowerCase()) + '">' + escape(t) + '</button>';
        }).join('') +
      '</div>' +
      '<input class="pin-input" type="text" placeholder="Image URL…" data-vp-field="source">' +
      '<input class="pin-input" type="text" placeholder="Note (optional)" data-vp-field="note" style="margin-top:6px">',
      function(panel) {
        var activeTab = panel.querySelector('.pin-tab.active');
        var type = activeTab ? activeTab.getAttribute('data-pin-type') : 'url';
        var sourceEl = panel.querySelector('[data-vp-field="source"]');
        var noteEl = panel.querySelector('[data-vp-field="note"]');
        var source = sourceEl ? sourceEl.value.trim() : '';
        var note = noteEl ? noteEl.value.trim() : undefined;
        if (!source && type !== 'node') return;
        var reference = null;
        if (type === 'image') reference = { type: 'image', url: source };
        else if (type === 'url') reference = { type: 'url', url: source };
        else if (type === 'brand') reference = { type: 'brand', brand: source };
        else if (type === 'node') {
          // Enter pin-pick mode — next click on preview = source node.
          closeVerbPanel();
          enterMode({ kind: 'pin-pick', target: state.selection.inode });
          flash('Click a source node', 'success');
          return;
        }
        submitGesture({
          kind: 'pin',
          at: new Date().toISOString(),
          sceneSlug: state.currentSceneSlug,
          author: { kind: 'human', id: 'platform-ui' },
          anchor: state.selection.inode,
          reference: reference,
          note: note || undefined,
        });
      }
    );
    // Tab switching.
    $$('[data-verb-panel] .pin-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        $$('[data-verb-panel] .pin-tab').forEach(function(t) { t.classList.remove('active'); });
        tab.classList.add('active');
        var type = tab.getAttribute('data-pin-type');
        var srcInput = $('[data-verb-panel] [data-vp-field="source"]');
        if (srcInput) {
          srcInput.placeholder = type === 'image' ? 'Image URL…'
            : type === 'url' ? 'URL…'
            : type === 'brand' ? 'Brand slug (stripe / linear)…'
            : 'Click to select node';
          if (type === 'node') srcInput.style.display = 'none';
          else srcInput.style.display = '';
        }
      });
    });
  }

  // ── Brush verb panel (macro list) ──────────────────
  async function handleBrushEnter() {
    // Fetch available macros from the project.
    var macros = [];
    try {
      var res = await api('/platform/api/intent/list');
      // Actually macros aren't in the intent list — they're in the project.
      // For now: hardcode common + allow custom input.
    } catch (_) {}
    var commonMacros = ['brutalize', 'darkmode', 'soften', 'appleify', 'linearize'];
    var listHtml = '<div class="macro-list">' +
      commonMacros.map(function(m) {
        return '<button class="macro-item" data-macro-name="' + escape(m) + '">' +
          escape(m) +
          '<span class="macro-ops">preset</span>' +
        '</button>';
      }).join('') +
    '</div>' +
    '<input class="pin-input" type="text" placeholder="Or type a custom macro name…" data-vp-field="custom-macro">';
    showVerbPanel('Brush', listHtml, function(panel) {
      var customInput = panel.querySelector('[data-vp-field="custom-macro"]');
      var macro = customInput ? customInput.value.trim() : '';
      if (!macro) return;
      var anchors = new Set();
      if (state.selection.inode) anchors.add(state.selection.inode);
      enterMode({ kind: 'brush', macro: macro, anchors: anchors, active: false });
    });
    // Click a macro-item → fill custom input + auto-submit.
    $$('[data-verb-panel] .macro-item').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var name = btn.getAttribute('data-macro-name');
        if (!name) return;
        closeVerbPanel();
        var anchors = new Set();
        if (state.selection.inode) anchors.add(state.selection.inode);
        enterMode({ kind: 'brush', macro: name, anchors: anchors, active: false });
      });
    });
  }

  // ── Resonance (already has its own panel — keep it) ──
  function handleResonanceEnter() {
    var seed = state.selection.inode;
    enterMode({
      kind: 'resonance',
      seed: seed,
      axes: new Set(['role', 'style']),
      matches: [],
    });
    recomputeResonance();
    showResonancePanel();
  }

  // ── Time (deferred to Phase H: timeline scrubber) ──
  function handleTime() {
    flash('Use the timeline scrubber in the bottom bar');
  }

  // ── Pen verb — free-vector drawing on top of canvas ──────────
  //
  // Phase 2 Brief 2b. Unlike the other verbs, Pen is anchor-free —
  // the stroke floats above the scene at iframe-doc coordinates and is
  // committed as a free-vector annotation. Activation paths:
  //   1. Toolbar Pen button (#btn-pen)
  //   2. Context-menu "Draw on top"
  //   3. Pen verb in the chip bar (when a node is selected)
  // All three call enterPenMode().
  //
  // While active, a glass style panel hangs off the top-right of the
  // viewport showing color / width / opacity / smooth controls. Style
  // state is persisted in localStorage (key 'reframe-pen-style') so the
  // designer's last choice survives across sessions.

  var PEN_STORAGE_KEY = 'reframe-pen-style';
  var PEN_DEFAULT_STYLE = {
    stroke: '#2b74ff',
    width: 2,
    opacity: 1,
    smooth: true,
  };
  var PEN_PALETTE = ['#2b74ff', '#16a34a', '#dc2626', '#f59e0b', '#111111'];
  var PEN_SAMPLE_DISTANCE = 4; // px in iframe-doc space

  function loadPenStyle() {
    try {
      var raw = window.localStorage && window.localStorage.getItem(PEN_STORAGE_KEY);
      if (!raw) return Object.assign({}, PEN_DEFAULT_STYLE);
      var parsed = JSON.parse(raw);
      return {
        stroke: typeof parsed.stroke === 'string' ? parsed.stroke : PEN_DEFAULT_STYLE.stroke,
        width:  typeof parsed.width  === 'number' ? parsed.width  : PEN_DEFAULT_STYLE.width,
        opacity: typeof parsed.opacity === 'number' ? parsed.opacity : PEN_DEFAULT_STYLE.opacity,
        smooth: typeof parsed.smooth === 'boolean' ? parsed.smooth : PEN_DEFAULT_STYLE.smooth,
      };
    } catch (_) { return Object.assign({}, PEN_DEFAULT_STYLE); }
  }

  function savePenStyle(style) {
    try {
      window.localStorage && window.localStorage.setItem(PEN_STORAGE_KEY, JSON.stringify(style));
    } catch (_) {}
  }

  function enterPenMode() {
    if (state.mode && state.mode.kind === 'pen') return;
    var style = loadPenStyle();
    enterMode({ kind: 'pen', style: style, drawing: false, points: [] });
    showPenPanel(style);
    activatePenCapture();
    var btn = $('#btn-pen');
    if (btn) btn.classList.add('active');
  }

  function exitPenMode() {
    closePenPanel();
    deactivatePenCapture();
    var btn = $('#btn-pen');
    if (btn) btn.classList.remove('active');
  }

  function togglePenMode() {
    if (state.mode && state.mode.kind === 'pen') {
      exitMode();
    } else {
      enterPenMode();
    }
  }

  function showPenPanel(style) {
    closePenPanel();
    var swatchHtml = PEN_PALETTE.map(function(c) {
      var active = c.toLowerCase() === String(style.stroke).toLowerCase();
      return '<button class="pen-swatch' + (active ? ' active' : '') + '" data-pen-color="' + escape(c) + '" style="background:' + escape(c) + '" title="' + escape(c) + '"></button>';
    }).join('');
    var html =
      '<div class="pen-panel" data-pen-panel>' +
        '<div class="pen-panel-head">' +
          '<span class="pen-panel-title">Pen ▸ Draw on canvas</span>' +
          '<button class="pen-panel-close" data-pen-action="close" title="Close (Esc)">×</button>' +
        '</div>' +
        '<div class="pen-row">' +
          '<label>Color</label>' +
          '<div class="pen-swatches">' + swatchHtml +
            '<input class="pen-color-custom" type="color" data-pen-field="stroke" value="' + escape(style.stroke) + '" title="Custom color">' +
          '</div>' +
        '</div>' +
        '<div class="pen-row">' +
          '<label>Width</label>' +
          '<input type="range" min="1" max="8" step="0.5" data-pen-field="width" value="' + style.width + '">' +
          '<span class="pen-val" data-pen-display="width">' + style.width + 'px</span>' +
        '</div>' +
        '<div class="pen-row">' +
          '<label>Opacity</label>' +
          '<input type="range" min="0.1" max="1" step="0.05" data-pen-field="opacity" value="' + style.opacity + '">' +
          '<span class="pen-val" data-pen-display="opacity">' + style.opacity.toFixed(2) + '</span>' +
        '</div>' +
        '<div class="pen-row">' +
          '<label class="pen-check"><input type="checkbox" data-pen-field="smooth"' + (style.smooth ? ' checked' : '') + '> Smooth curves</label>' +
        '</div>' +
        '<div class="pen-foot">Esc to cancel · drag to draw</div>' +
      '</div>';
    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    var node = wrap.firstChild;
    document.body.appendChild(node);
    bindPenPanel(node);
  }

  function closePenPanel() {
    var existing = $('[data-pen-panel]');
    if (existing) existing.remove();
  }

  function bindPenPanel(panel) {
    panel.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-pen-action="close"]');
      if (btn) { exitMode(); return; }
      var sw = e.target.closest('[data-pen-color]');
      if (sw) {
        var color = sw.getAttribute('data-pen-color');
        if (state.mode && state.mode.kind === 'pen') {
          state.mode.style.stroke = color;
          savePenStyle(state.mode.style);
          panel.querySelectorAll('[data-pen-color]').forEach(function(s) { s.classList.remove('active'); });
          sw.classList.add('active');
          var custom = panel.querySelector('[data-pen-field="stroke"]');
          if (custom) custom.value = color;
        }
      }
    });
    panel.addEventListener('input', function(e) {
      var t = e.target;
      var field = t.getAttribute && t.getAttribute('data-pen-field');
      if (!field || !state.mode || state.mode.kind !== 'pen') return;
      if (field === 'stroke') {
        state.mode.style.stroke = t.value;
        panel.querySelectorAll('[data-pen-color]').forEach(function(s) {
          s.classList.toggle('active', String(s.getAttribute('data-pen-color')).toLowerCase() === String(t.value).toLowerCase());
        });
      } else if (field === 'width') {
        state.mode.style.width = Number(t.value);
        var dw = panel.querySelector('[data-pen-display="width"]');
        if (dw) dw.textContent = t.value + 'px';
      } else if (field === 'opacity') {
        state.mode.style.opacity = Number(t.value);
        var dop = panel.querySelector('[data-pen-display="opacity"]');
        if (dop) dop.textContent = Number(t.value).toFixed(2);
      } else if (field === 'smooth') {
        state.mode.style.smooth = !!t.checked;
      }
      savePenStyle(state.mode.style);
    });
  }

  // Drawing capture overlay — sibling DIV layered on top of the
  // existing SVG annotation overlay. Captures pointer events at parent
  // layer (NOT inside iframe), translates to iframe-doc coords via the
  // same SVG viewBox math the annotations layer uses.
  var _penCaptureBindings = null;
  function activatePenCapture() {
    deactivatePenCapture();
    var svg = $('.viewport-frame .annotations');
    var frame = $('.viewport-frame');
    if (!svg || !frame) return;
    svg.classList.add('pen-active');
    frame.classList.add('pen-active');

    function onDown(e) {
      if (!state.mode || state.mode.kind !== 'pen') return;
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      var pt = svgCoordsFromEvent(e);
      state.mode.drawing = true;
      state.mode.points = [pt];
      renderPenPreview();
      svg.setPointerCapture && svg.setPointerCapture(e.pointerId);
    }
    function onMove(e) {
      if (!state.mode || state.mode.kind !== 'pen' || !state.mode.drawing) return;
      var pt = svgCoordsFromEvent(e);
      var pts = state.mode.points;
      var last = pts[pts.length - 1];
      var dx = pt.x - last.x, dy = pt.y - last.y;
      if (dx * dx + dy * dy < PEN_SAMPLE_DISTANCE * PEN_SAMPLE_DISTANCE) return;
      pts.push(pt);
      renderPenPreview();
    }
    async function onUp(e) {
      if (!state.mode || state.mode.kind !== 'pen' || !state.mode.drawing) return;
      state.mode.drawing = false;
      var pts = state.mode.points || [];
      state.mode.points = [];
      clearPenPreview();
      if (pts.length < 2) return;
      var style = state.mode.style;
      try {
        await submitGesture({
          kind: 'free-vector',
          at: new Date().toISOString(),
          sceneSlug: state.currentSceneSlug,
          author: { kind: 'human', id: 'platform-ui' },
          points: pts,
          stroke: style.stroke,
          width: style.width,
          opacity: style.opacity,
          smooth: style.smooth,
        });
        refreshAnnotations();
      } catch (_) {}
    }

    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointercancel', onUp);
    _penCaptureBindings = { svg: svg, onDown: onDown, onMove: onMove, onUp: onUp };
  }

  function deactivatePenCapture() {
    var svg = $('.viewport-frame .annotations');
    var frame = $('.viewport-frame');
    if (svg) svg.classList.remove('pen-active');
    if (frame) frame.classList.remove('pen-active');
    if (_penCaptureBindings) {
      var b = _penCaptureBindings;
      b.svg.removeEventListener('pointerdown', b.onDown);
      b.svg.removeEventListener('pointermove', b.onMove);
      b.svg.removeEventListener('pointerup', b.onUp);
      b.svg.removeEventListener('pointercancel', b.onUp);
      _penCaptureBindings = null;
    }
    clearPenPreview();
  }

  function renderPenPreview() {
    if (!state.mode || state.mode.kind !== 'pen') return;
    var svgGroup = $('.annotation-marks-svg');
    if (!svgGroup) return;
    var existing = svgGroup.querySelector('.pen-preview-path');
    var pts = state.mode.points || [];
    if (pts.length === 0) {
      if (existing) existing.remove();
      return;
    }
    var style = state.mode.style;
    var d = pointsToPath(pts, !!style.smooth);
    if (!existing) {
      svgGroup.insertAdjacentHTML('beforeend',
        '<path class="pen-preview-path" d="' + d + '" ' +
          'stroke="' + escape(style.stroke) + '" stroke-width="' + style.width + '" ' +
          'stroke-opacity="' + style.opacity + '" ' +
          'fill="none" stroke-linecap="round" stroke-linejoin="round" />');
    } else {
      existing.setAttribute('d', d);
      existing.setAttribute('stroke', style.stroke);
      existing.setAttribute('stroke-width', style.width);
      existing.setAttribute('stroke-opacity', style.opacity);
    }
  }

  function clearPenPreview() {
    var svgGroup = $('.annotation-marks-svg');
    if (!svgGroup) return;
    var existing = svgGroup.querySelector('.pen-preview-path');
    if (existing) existing.remove();
  }

  function bindPenToolbarButton() {
    var btn = $('#btn-pen');
    if (!btn || btn.__penBound) return;
    btn.__penBound = true;
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      togglePenMode();
    });
  }

  // ── Submode state machine ────────────────────────────
  // Modes are entered via chip click (or keyboard) and drive subsequent
  // clicks on the preview until a completion condition fires (second
  // click, Enter, or Escape). They're the rich-gesture layer — one level
  // above "prompt for everything".

  function enterMode(mode) {
    state.mode = mode;
    showBanner();
    hideChipBar();
    // Gesture modes need pointer events on the SVG overlay.
    const svg = $('.viewport-frame .annotations');
    if (svg && (mode.kind === 'lasso' || mode.kind === 'brush' || mode.kind === 'drag-live')) {
      svg.classList.add('gesture-active');
    }
  }

  function exitMode(reason) {
    var prev = state.mode;
    state.mode = null;
    hideBanner();
    // Clean up any in-progress gesture artifacts.
    clearLassoPath();
    clearDragGhost();
    clearResonancePreview();
    const svgGroup = $('.annotation-marks-svg');
    if (svgGroup) {
      svgGroup.querySelectorAll('.brush-preview').forEach(function(el) { el.remove(); });
    }
    const svg = $('.viewport-frame .annotations');
    if (svg) svg.classList.remove('gesture-active');
    // Hide resonance panel if we were in that mode.
    const resoPanel = $('.resonance-panel');
    if (resoPanel) resoPanel.remove();
    // Pen mode tear-down — close panel, drop capture bindings, clear preview.
    if (prev && prev.kind === 'pen') {
      exitPenMode();
    }
    if (reason === 'cancelled') flash('Cancelled', 'error');
  }

  function showBanner() {
    const bar = $('.mode-banner');
    if (!bar || !state.mode) return;
    bar.innerHTML = bannerContent(state.mode);
    bar.classList.add('show');
  }

  function hideBanner() {
    const bar = $('.mode-banner');
    if (bar) bar.classList.remove('show');
  }

  function updateBanner() {
    const bar = $('.mode-banner');
    if (!bar || !state.mode) return;
    bar.innerHTML = bannerContent(state.mode);
  }

  function bannerContent(mode) {
    switch (mode.kind) {
      case 'echo': {
        const step = mode.source ? 'Click the TARGET node' : 'Click the SOURCE node';
        return '<span class="label">Echo</span><span class="hint">' + step + '</span><span class="counter">Esc to cancel</span>';
      }
      case 'drag-live': {
        return '<span class="label">Drag</span><span class="hint">Press and drag to move · drop on target</span><span class="counter">Esc to cancel</span>';
      }
      case 'lasso': {
        const count = lassoContainedAnchors(mode.polygon || []).length;
        return '<span class="label">Lasso</span><span class="hint">Draw around nodes · release to select</span><span class="counter">' + count + ' inside</span>';
      }
      case 'brush': {
        const count = mode.anchors ? mode.anchors.size : 0;
        return '<span class="label">Brush: ' + escape(mode.macro) + '</span><span class="hint">Drag across nodes · Enter to submit</span><span class="counter">' + count + '</span>';
      }
      case 'resonance': {
        return '<span class="label">Resonance</span><span class="hint">Pick axes in the panel · Apply to submit</span><span class="counter">' + (mode.matches || []).length + ' matches</span>';
      }
      case 'pin-pick': {
        return '<span class="label">Pin</span><span class="hint">Click a source node to reference</span><span class="counter">Esc to cancel</span>';
      }
      case 're-anchor': {
        return '<span class="label">Re-anchor</span><span class="hint">Click a new anchor node</span><span class="counter">Esc to cancel</span>';
      }
      case 'pen': {
        return '<span class="label">Pen</span><span class="hint">Drag to draw</span><span class="counter">Esc to exit</span>';
      }
      default:
        return '<span class="label">Mode</span>';
    }
  }

  async function handleModeClick(data) {
    const m = state.mode;
    if (!m) return;
    const inode = data.inode;
    if (!inode) return;

    if (m.kind === 'echo') {
      if (!m.source) {
        m.source = inode;
        updateBanner();
        return;
      }
      // Second click = target → show axis picker panel.
      var fromA = m.source;
      var toA = inode;
      exitMode();
      handleEchoAxis(fromA, toA);
      return;
    }

    // Lasso / brush / drag-live are handled by the SVG pointer substrate,
    // not by iframe click bubbling. Those modes intentionally ignore
    // handleModeClick.
    if (m.kind === 'lasso' || m.kind === 'brush' || m.kind === 'drag-live') {
      return;
    }

    if (m.kind === 'pin-pick') {
      var pinTarget = m.target;
      var pinSource = inode;
      exitMode();
      // Show inline aspect picker via VerbPanel.
      var axes = ['style', 'structure', 'all'];
      showVerbPanel('Pin (node ref)',
        '<div class="echo-step">Reference <strong>' + escape(String(pinSource).slice(-8)) + '</strong> on <strong>' + escape(String(pinTarget).slice(-8)) + '</strong></div>' +
        '<div class="echo-axes">' +
          axes.map(function(ax, i) {
            return '<button class="echo-axis' + (i === 0 ? ' active' : '') + '" data-axis="' + escape(ax) + '">' + escape(ax) + '</button>';
          }).join('') +
        '</div>',
        function(panel) {
          var activeAxis = panel.querySelector('.echo-axis.active');
          var aspect = activeAxis ? activeAxis.getAttribute('data-axis') : 'style';
          submitGesture({
            kind: 'pin',
            at: new Date().toISOString(),
            sceneSlug: state.currentSceneSlug,
            author: { kind: 'human', id: 'platform-ui' },
            anchor: pinTarget,
            reference: { type: 'node', anchor: pinSource, aspect: aspect },
          });
        }
      );
      $$('[data-verb-panel] .echo-axis').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          $$('[data-verb-panel] .echo-axis').forEach(function(b) { b.classList.remove('active'); });
          btn.classList.add('active');
        });
      });
      return;
    }

    if (m.kind === 're-anchor') {
      const annotationId = m.annotationId;
      exitMode();
      try {
        await api('/platform/api/annotations/re-anchor', {
          annotationId: annotationId,
          newAnchor: inode,
        });
        flash('Re-anchored → active', 'success');
        refreshOrphans();
      } catch (_) {}
      return;
    }
  }

  async function commitMode() {
    const m = state.mode;
    if (!m) return;
    if (m.kind === 'lasso') {
      const anchors = lassoContainedAnchors(m.polygon || []);
      if (anchors.length === 0) { exitMode(); return; }
      const snapshot = anchors.slice();
      const polySnap = (m.polygon || []).slice();
      exitMode();
      await submitGesture({
        kind: 'lasso',
        at: new Date().toISOString(),
        sceneSlug: state.currentSceneSlug,
        author: { kind: 'human', id: 'platform-ui' },
        points: polySnap.map(function(p) { return [p[0], p[1]]; }),
        containedAnchors: snapshot,
      });
      return;
    }
    if (m.kind === 'brush') {
      const arr = Array.from(m.anchors || []);
      if (arr.length === 0) { exitMode(); return; }
      const macro = m.macro;
      exitMode();
      await submitGesture({
        kind: 'brush',
        at: new Date().toISOString(),
        sceneSlug: state.currentSceneSlug,
        author: { kind: 'human', id: 'platform-ui' },
        anchors: arr,
        macro: macro,
      });
      return;
    }
    if (m.kind === 'resonance') {
      const matches = m.matches || [];
      const axes = Array.from(m.axes || []);
      const seed = m.seed;
      exitMode();
      if (!seed || matches.length === 0) {
        flash('No matches — try fewer axes', 'error');
        return;
      }
      await submitGesture({
        kind: 'resonance',
        at: new Date().toISOString(),
        sceneSlug: state.currentSceneSlug,
        author: { kind: 'human', id: 'platform-ui' },
        seed: seed,
        axes: axes,
        matches: matches,
      });
      return;
    }
    exitMode();
  }
