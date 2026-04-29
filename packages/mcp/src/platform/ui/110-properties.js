  async function showPropsForNode(inode, sessionId) {
    if (!inode || !sessionId) {
      clearPropsPanel();
      return;
    }
    // During StoreSync rebuild the OP graph fires synthetic events with
    // ids that may not exist server-side yet (the rebuild is mid-flight).
    // Skip the fetch — the next user-initiated selection will refresh.
    if (window.__reframeSyncing) return;
    // Bridge translation: OP id → reframe id when bridge knows the
    // mapping. The earlier version also silently returned whenever the
    // id was absent from BOTH directions of the bridge — that was meant
    // to suppress OP drag-helper spam but it ALSO killed LAYERS-sidebar
    // clicks (reframe id from /scene/tree) whenever the bridge hadn't
    // finished indexing yet. Drag spam is already mitigated by
    // `queuePropsRefresh` (debounced + uses currentPropsNodeId which is
    // always a resolved reframe id), so we no longer need the defensive
    // bridge-miss guard here. Let the server's 404 handler (below) be
    // the authoritative filter — an unknown id renders the scene
    // dashboard, which is the correct fallback.
    var bridge = window.__reframeBridge;
    if (bridge) {
      var fwd = bridge.opToReframeId && bridge.opToReframeId.get && bridge.opToReframeId.get(inode);
      if (fwd) inode = fwd;
    }
    currentPropsNodeId = inode;
    // Direct fetch (instead of api() helper) so we can handle 404
    // SILENTLY — happens when the selected OP node has no server-side
    // counterpart yet (synthetic clicks, OP-internal nodes). Showing
    // empty state is the right UX; logging the 404 is just noise.
    try {
      var url = '/platform/api/node/get?sceneId=' + encodeURIComponent(sessionId) +
                '&nodeId=' + encodeURIComponent(inode);
      var resp = await fetch(url);
      if (resp.status === 404) {
        clearPropsPanel();
        return;
      }
      if (!resp.ok) return;
      var res = await resp.json();
      if (!res.ok || !res.props) return;
      renderPropsPanel(res.props, sessionId, inode);
    } catch (_) {}
  }

  function clearPropsPanel() {
    currentPropsNodeId = null;
    var panel = $('[data-panel="design"]');
    if (!panel) return;
    // Look up the active scene id (new editor uses #reframe-viewport;
    // legacy iframe pages use .viewport-frame).
    var frame = document.getElementById('reframe-viewport') || $('.viewport-frame');
    var sessionId = frame ? (frame.getAttribute('data-session') || frame.dataset && frame.dataset.session) : null;
    if (sessionId) {
      // Show scene-level controls (Canvas / Dimensions / Background) —
      // those are useful even with nothing selected. Export + Engine
      // buttons are stripped as noisy duplicates of the header / "+".
      renderSceneDashboard(panel, sessionId);
    } else {
      panel.innerHTML =
        '<div class="props-empty" style="color:var(--text-muted,#888);font-size:12px;text-align:center;padding:60px 16px;line-height:1.6">' +
          '<div style="font-size:13px;color:var(--text-primary,#e5e5e5);margin-bottom:6px">No scene open</div>' +
          'Pick a project from the sidebar.' +
        '</div>';
    }
  }

  async function renderSceneDashboard(panel, sessionId) {
    // Root node props for scene-level info. First look at the inlined
    // boot payload — it already carries {width, height, background}.
    // Fall back to the network only when the payload is absent / stale
    // / for a different scene.
    var sceneInfo = '';
    try {
      var p = null;
      var cachedRoot = consumeBootSection(sessionId, 'root');
      if (cachedRoot) {
        p = { width: cachedRoot.width, height: cachedRoot.height, background: cachedRoot.background, type: 'frame' };
      } else {
        // Use a plain fetch (not api()) — nodeId="root" is a best-effort
        // guess and a 404 is normal on first load. api() would toast
        // "API error: node root not found" before the catch could swallow it.
        var resp = await fetch('/platform/api/node/get?sceneId=' + encodeURIComponent(sessionId) + '&nodeId=root');
        if (!resp.ok) throw new Error('no root');
        var store = await resp.json();
        if (!store.ok) throw new Error('no root');
        p = store.props || {};
      }
      // Empty-state "Background" = CANVAS WORKSPACE around the scene,
      // NOT the root frame's fill. User mental model (correctly): when
      // nothing is selected, I'm editing the canvas itself — the area
      // around frames, Figma-style. Previously this wrote to root node
      // fill, which then leaked through any child that didn't cover the
      // full root bbox (e.g. a section at 1440 inside a root at 1600
      // showed a surprise stripe of the new color). That was the bug:
      // user paints "canvas", engine repaints "frame". Now the input
      // target is the --surface-canvas CSS variable, persisted per
      // project in localStorage, applied on the documentElement.
      var workspaceKey = 'reframe:workspace-bg:' + (state.currentSceneSlug || 'default');
      var savedWorkspace = null;
      try { savedWorkspace = localStorage.getItem(workspaceKey); } catch (_) {}
      var canvasBg = savedWorkspace ||
        (getComputedStyle(document.documentElement).getPropertyValue('--surface-canvas') || '').trim() ||
        '#E8E2D0';
      if (savedWorkspace) {
        try { document.documentElement.style.setProperty('--surface-canvas', savedWorkspace); } catch (_) {}
      }
      sceneInfo =
        '<div class="props-identity">' +
          '<div class="node-name">Canvas<span class="node-type">workspace</span></div>' +
          '<div class="node-parent">Nothing selected — edit the canvas around your frame</div>' +
        '</div>' +
        '<div class="props-section">' +
          '<div class="props-section-header">Frame dimensions</div>' +
          '<div class="props-section-body">' +
            '<div class="prop-pair">' +
              '<div class="prop-compact"><span class="prop-compact-label">W</span>' +
                '<input class="prop-compact-input" type="number" value="' + (p.width || 1440) + '" data-prop="width" data-scene="' + escape(sessionId) + '" data-node="root" step="1"></div>' +
              '<div class="prop-compact"><span class="prop-compact-label">H</span>' +
                '<input class="prop-compact-input" type="number" value="' + (p.height || 900) + '" data-prop="height" data-scene="' + escape(sessionId) + '" data-node="root" step="1"></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="props-section">' +
          '<div class="props-section-header">Background</div>' +
          '<div class="props-section-body">' +
            '<div class="fill-row">' +
              '<div class="fill-swatch" style="background:' + escape(canvasBg) + '" data-prop="canvas-bg" data-workspace-key="' + escape(workspaceKey) + '"></div>' +
              '<input class="fill-hex" type="text" value="' + escape(canvasBg) + '" data-prop="canvas-bg" data-workspace-key="' + escape(workspaceKey) + '">' +
            '</div>' +
          '</div>' +
        '</div>';
    } catch (_) {
      sceneInfo = '<div class="props-identity"><div class="node-name">Scene</div></div>';
    }

    // Audit summary.
    var auditHtml = '';
    if (auditFindings.length > 0) {
      var errors = auditFindings.filter(function(f) { return f.severity === 'error'; }).length;
      var warnings = auditFindings.filter(function(f) { return f.severity === 'warning'; }).length;
      var topFindings = auditFindings.slice(0, 3).map(function(f) {
        return '<div class="scene-dash-finding ' + escape(f.severity) + '">' +
          '<span class="finding-dot"></span>' +
          escape(f.rule) + (f.nodeName ? ' on ' + escape(f.nodeName) : '') +
        '</div>';
      }).join('');
      auditHtml =
        '<div class="props-section">' +
          '<div class="props-section-header">Audit</div>' +
          '<div class="props-section-body">' +
            '<div class="scene-dash-audit-score" data-testid="audit-score">' +
              (errors > 0 ? '<span class="score-bad">' + errors + ' error' + (errors > 1 ? 's' : '') + '</span>' : '') +
              (warnings > 0 ? '<span class="score-warn">' + warnings + ' warning' + (warnings > 1 ? 's' : '') + '</span>' : '') +
              (errors === 0 && warnings === 0 ? '<span class="score-ok">All clean</span>' : '') +
            '</div>' +
            topFindings +
          '</div>' +
        '</div>';
    }

    // Export + Engine + hint blocks removed — Export lives in the
    // header button, engine ops are one AI prompt away, and the hint
    // was covering actually-useful sections. Keep only Scene info +
    // Audit summary when no node is selected.
    var exportHtml = '';
    var engineHtml = '';
    var hintHtml = '';

    panel.innerHTML = sceneInfo + auditHtml + exportHtml + engineHtml + hintHtml;

    // Bind editable canvas settings (W/H inputs + background swatch/hex).
    bindPropInputs();

    // Bind export buttons.
    panel.querySelectorAll('.scene-dash-export-btn[data-format]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var format = btn.getAttribute('data-format');
        if (format) showExportPreview(sessionId, format);
      });
    });
    // Bind engine action buttons.
    panel.querySelectorAll('.scene-dash-export-btn[data-engine]').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var action = btn.getAttribute('data-engine');
        if (action === 'auto-fix') {
          flash('Running audit auto-fix…');
          try {
            var res = await api('/platform/api/scene/auto-fix', { sceneId: sessionId, maxRounds: 3 });
            if (res.ok) flash('Fixed ' + res.fixed + ' issue(s) in ' + res.rounds + ' round(s)', 'success');
            setTimeout(refreshAudit, 300);
          } catch (_) {}
        } else if (action === 'define-tokens') {
          try {
            var res = await api('/platform/api/scene/define-tokens', { sceneId: sessionId });
            if (res.ok) flash('Bound ' + res.bound + ' token(s)', 'success');
          } catch (_) {}
        } else if (action === 'show-source') {
          try {
            var res = await api('/platform/api/scene/source?sceneId=' + encodeURIComponent(sessionId));
            if (res.ok && res.source) {
              showVerbPanel('Source HTML',
                '<textarea class="ask-input" style="height:200px;resize:vertical;font-family:var(--mono);font-size:11px;line-height:1.5" readonly>' + escape(res.source) + '</textarea>' +
                '<div class="ask-hint">Source file: .reframe/src/' + escape(res.slug || '') + '.html</div>',
                function() {}
              );
            } else {
              flash('No source HTML found');
            }
          } catch (_) {}
        }
      });
    });
  }

  // Phase 1 UI-3 — multi-select inspector. When the user has 2+ nodes
  // selected, the JS UI calls /platform/api/node/get-many; the server
  // returns a `shared` map (props every node agrees on) plus a
  // sentinel string ('__reframe_mixed__') in slots where values
  // diverge. This function renders a compact shared-props view; the
  // full per-node panel is reserved for the single-select path.
  async function showPropsForNodes(nodeIds, sessionId) {
    if (!Array.isArray(nodeIds) || nodeIds.length === 0 || !sessionId) {
      clearPropsPanel();
      return;
    }
    if (nodeIds.length === 1) {
      // Delegate to the single-node path so we don't double-implement.
      showPropsForNode(nodeIds[0], sessionId);
      return;
    }
    // Track the multi-select set so subsequent edits know to fan out.
    currentPropsNodeId = nodeIds.slice();
    try {
      var resp = await fetch('/platform/api/node/get-many', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneId: sessionId, nodeIds: nodeIds }),
      });
      if (!resp.ok) { clearPropsPanel(); return; }
      var data = await resp.json();
      if (!data.ok) { clearPropsPanel(); return; }
      renderMultiSelectPanel(data.shared, data.mixedSentinel, sessionId, nodeIds);
    } catch (_) { /* best-effort */ }
  }

  function renderMultiSelectPanel(shared, mixedSentinel, sessionId, nodeIds) {
    var panel = $('[data-panel="design"]');
    if (!panel) return;
    var html = '';
    html += '<div class="props-identity">' +
      '<div class="node-name">' + escape(String(nodeIds.length)) + ' nodes selected' +
        ' <span class="node-type">multi</span>' +
      '</div>' +
      '<div class="node-parent">Edits apply to all selected. Mixed values show "Mixed".</div>' +
    '</div>';
    // Reuse the same data-prop / data-scene / data-node attribute
    // shape the single-select panel uses, but encode the JSON-array
    // of node ids in data-node so bindPropInputs' edit handler can
    // fan-out via splitting on the leading '['.
    var encodedIds = JSON.stringify(nodeIds).replace(/"/g, '&quot;');
    var rows = '';
    var keys = Object.keys(shared);
    keys.sort();
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v = shared[k];
      var isMixed = v === mixedSentinel;
      var displayValue = isMixed
        ? '<span class="prop-mixed" style="font-style:italic;color:var(--text-muted,#888)">Mixed</span>'
        : escape(String(v));
      rows +=
        '<div class="prop-pair" style="display:flex;align-items:center;gap:8px;margin:4px 0">' +
          '<span class="prop-label" style="flex:1;font-size:11px;color:var(--text-muted,#888)">' + escape(k) + '</span>' +
          '<span class="prop-value" data-multi-prop="' + escape(k) + '" data-scene="' + escape(sessionId) +
            '" data-nodes="' + encodedIds + '" style="font-size:11px">' +
          displayValue + '</span>' +
          '<button class="prop-reset" data-multi-reset="' + escape(k) + '" data-scene="' + escape(sessionId) +
            '" data-nodes="' + encodedIds + '" title="Reset to default" ' +
            'style="background:transparent;border:none;cursor:pointer;color:var(--text-muted,#888);padding:2px 4px;font-size:11px">↺</button>' +
        '</div>';
    }
    html += '<div class="props-section">' +
      '<div class="props-section-header">Shared properties (' + keys.length + ')</div>' +
      '<div class="props-section-body">' + (rows || '<div style="color:var(--text-muted);font-size:11px">No shared properties</div>') + '</div>' +
    '</div>';
    panel.innerHTML = html;
    bindMultiSelectInputs();
  }

  // Phase 1 UI-3 — fan-out edit handler. Click "Mixed" → text input
  // appears; submit → POST /node/edit per nodeId. Click ↺ → fan-out
  // /node/reset-prop with nodeIds[].
  function bindMultiSelectInputs() {
    $$('[data-multi-prop]').forEach(function(el) {
      el.addEventListener('click', function() {
        var prop = el.getAttribute('data-multi-prop');
        var sceneId = el.getAttribute('data-scene');
        var ids;
        try { ids = JSON.parse((el.getAttribute('data-nodes') || '[]').replace(/&quot;/g, '"')); } catch (_) { ids = []; }
        var input = document.createElement('input');
        input.type = 'text';
        input.style.cssText = 'width:120px;font-size:11px;padding:2px 4px';
        input.placeholder = 'New value';
        el.innerHTML = '';
        el.appendChild(input);
        input.focus();
        var commit = async function() {
          var val = input.value;
          if (val === '') { showPropsForNodes(ids, sceneId); return; }
          // Fan-out — one POST per node so each scene state observes
          // the full edit history (rather than a synthetic batch).
          for (var i = 0; i < ids.length; i++) {
            try {
              await fetch('/platform/api/node/edit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sceneId: sceneId, nodeId: ids[i], props: (function() { var o = {}; o[prop] = val; return o; })() }),
              });
            } catch (_) { /* keep going */ }
          }
          showPropsForNodes(ids, sceneId);
        };
        input.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { showPropsForNodes(ids, sceneId); }
        });
        input.addEventListener('blur', commit);
      });
    });
    $$('[data-multi-reset]').forEach(function(btn) {
      btn.addEventListener('click', async function(e) {
        e.preventDefault();
        e.stopPropagation();
        var prop = btn.getAttribute('data-multi-reset');
        var sceneId = btn.getAttribute('data-scene');
        var ids;
        try { ids = JSON.parse((btn.getAttribute('data-nodes') || '[]').replace(/&quot;/g, '"')); } catch (_) { ids = []; }
        try {
          await fetch('/platform/api/node/reset-prop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sceneId: sceneId, nodeIds: ids, prop: prop }),
          });
        } catch (_) {}
        showPropsForNodes(ids, sceneId);
      });
    });
  }

  // Expose for 010-core / 160-init bridges.
  window.showPropsForNodes = showPropsForNodes;

  function renderPropsPanel(props, sessionId, nodeId) {
    var panel = $('[data-panel="design"]');
    if (!panel) return;

    // Friendly display name.
    var rawName = (props.name || '').toLowerCase();
    var FRIENDLY = {
      div:'Container',span:'Span',section:'Section',header:'Header',
      footer:'Footer',main:'Main',nav:'Nav',article:'Article',
      aside:'Aside',button:'Button',a:'Link',p:'Paragraph',
      h1:'Heading 1',h2:'Heading 2',h3:'Heading 3',img:'Image',
    };
    var displayName = FRIENDLY[rawName] || props.name || '?';
    var typeBadge = (props.type || '').toLowerCase();

    var html = '';

    // ── Sticky AI bar (top, always visible) ──
    // Quick path: input + preset chips + variants + Ask. All actions
    // scoped to the currently selected node — no need to re-state context.
    // Manual props remain below as before — AI augments, doesn't replace.
    html += renderAiBar(sessionId, nodeId);

    // Phase 1 UI-3 — property name filter. Lives at the top of the
    // inspector (under the AI bar). Pure DOM filter — keystrokes hide
    // section bodies / rows whose data-prop key doesn't match. No
    // server round-trip; clearing the input restores everything.
    html +=
      '<div class="props-filter" style="margin:4px 0 8px;padding:0 2px">' +
        '<input data-props-filter type="text" placeholder="Filter properties..." ' +
          'style="width:100%;padding:6px 8px;background:var(--surface,#0e0e0e);' +
          'border:1px solid var(--border,#333);border-radius:4px;color:var(--text-primary,#e5e5e5);font-size:11px">' +
      '</div>';

    // ── Smart Suggestions container — populated async from audit ──
    // Empty placeholder rendered eagerly so the layout is stable; the
    // actual banners are injected by fetchAndRenderSuggestions() after
    // panel.innerHTML is committed. This avoids a layout shift when
    // the audit fetch resolves.
    html += '<div data-smart-suggestions style="display:none;margin:0 -12px 10px;padding:8px 12px;border-bottom:1px solid var(--border,#333);background:var(--surface,#0e0e0e)"></div>';

    // ── Identity ──
    html += '<div class="props-identity">' +
      '<div class="node-name">' + escape(displayName) +
        ' <span class="node-type">' + escape(typeBadge) + '</span>' +
      '</div>' +
      (props.role ? '<div class="node-parent">' + escape(props.role) + '</div>' : '') +
    '</div>';

    // ── Size (2-column: W+H side by side, X+Y below) ──
    html += '<div class="props-section">' +
      '<div class="props-section-header" data-collapse-toggle>Size<span class="chevron">▼</span></div>' +
      '<div class="props-section-body">' +
        '<div class="prop-pair">' +
          propCompact('W', 'width', props.width, sessionId, nodeId) +
          propCompact('H', 'height', props.height, sessionId, nodeId) +
        '</div>' +
        '<div class="prop-pair">' +
          propCompact('X', 'x', props.x, sessionId, nodeId) +
          propCompact('Y', 'y', props.y, sessionId, nodeId) +
        '</div>' +
      '</div>' +
    '</div>';

    // ── Layout (direction icons + alignment grid + gap + padding quad) ──
    html += '<div class="props-section">' +
      '<div class="props-section-header" data-collapse-toggle>Layout<span class="chevron">▼</span></div>' +
      '<div class="props-section-body">' +
        renderLayoutControls(props, sessionId, nodeId) +
      '</div>' +
    '</div>';

    // ── Phase 1 UI-6a Pin #3 — text-shaped nodes hide Background ──
    // Engine paints text via `fills` which exporter emits as CSS
    // `color`, not `background-color`. Showing a Fill (background)
    // swatch on a text node was confusing — both swatches wrote the
    // same engine field. Mirror of `getColorFieldsForNode` from
    // inspector-color-fields.ts.
    var TEXT_SHAPED_TYPES_JS = ['TEXT','SPAN','P','H1','H2','H3','H4','H5','H6','A','LI','LABEL','BUTTON'];
    var isTextShaped = props && props.type
      ? TEXT_SHAPED_TYPES_JS.indexOf(String(props.type).toUpperCase()) >= 0
      : false;

    // ── Fill (big swatch + hex + opacity + token badge) ──
    // When fill is bound to a brand token the row collapses the hex
    // input into a chip showing token name + resolved color preview +
    // unbind X. Click chip to navigate / change. Click X to unbind.
    var bgHex = props.background || '#FFFFFF';
    var bgOpacity = props['background-opacity'] != null ? Math.round(props['background-opacity'] * 100) : 100;
    var tokenBind = props['token-bindings'] && props['token-bindings'].fill;
    var fillRowHtml;
    if (tokenBind) {
      fillRowHtml =
        '<div class="fill-row">' +
          '<div class="fill-swatch" style="background:' + escape(bgHex) + '" data-prop="background" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '"></div>' +
          '<div class="prop-token-badge" style="flex:1;display:inline-flex;align-items:center;gap:6px;padding:4px 8px;' +
            'background:var(--surface,#0e0e0e);border:1px solid var(--accent,#f15a29);border-radius:4px;font-size:11px;color:var(--text-primary,#e5e5e5)">' +
            '<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + escape(bgHex) + ';flex:none"></span>' +
            '<span style="flex:1;font-family:var(--mono,monospace);font-size:10px">' + escape(tokenBind) + '</span>' +
            '<button class="prop-token-unbind" data-prop="background" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '" ' +
              'title="Unbind from token" style="background:transparent;border:none;color:var(--text-muted,#888);cursor:pointer;font-size:11px;padding:0 2px">✕</button>' +
          '</div>' +
        '</div>';
    } else {
      fillRowHtml =
        '<div class="fill-row">' +
          '<div class="fill-swatch" style="background:' + escape(bgHex) + '" data-prop="background" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '"></div>' +
          '<input class="fill-hex" type="text" value="' + escape(bgHex) + '" data-prop="background" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '">' +
          '<span class="fill-opacity">' + bgOpacity + '%</span>' +
        '</div>';
    }
    if (!isTextShaped) {
      html += '<div class="props-section">' +
        '<div class="props-section-header" data-collapse-toggle>Fill<span class="chevron">▼</span></div>' +
        '<div class="props-section-body">' +
          fillRowHtml +
        '</div>' +
      '</div>';
    }

    // ── Typography (font dropdown + compact row of 4 values) ──
    if (props['font-size'] != null || props.type === 'TEXT') {
      var colorHex = props.color || '';
      html += '<div class="props-section">' +
        '<div class="props-section-header" data-collapse-toggle>Type<span class="chevron">▼</span></div>' +
        '<div class="props-section-body">' +
          '<input class="type-font-input" type="text" value="' + escape(props['font-family'] || 'Inter') + '" data-prop="font-family" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '" placeholder="Font family">' +
          '<div class="type-row">' +
            propCompact('Size', 'font-size', props['font-size'] || 16, sessionId, nodeId) +
            propCompact('Wt', 'font-weight', props['font-weight'] || 400, sessionId, nodeId) +
            propCompact('LH', 'line-height', props['line-height'] || '', sessionId, nodeId) +
            propCompact('LS', 'letter-spacing', props['letter-spacing'] || 0, sessionId, nodeId) +
          '</div>' +
          (colorHex ? '<div class="fill-row" style="margin-top:8px">' +
            '<div class="fill-swatch" style="background:' + escape(colorHex) + '" data-prop="color" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '"></div>' +
            '<input class="fill-hex" type="text" value="' + escape(colorHex) + '" data-prop="color" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '">' +
            '<span class="fill-opacity">Text</span>' +
          '</div>' : '') +
        '</div>' +
      '</div>';
    }

    // ── Effects (radius slider + opacity slider) ──
    var radius = props['border-radius'] || 0;
    var opacity = props.opacity != null ? props.opacity : 1;
    html += '<div class="props-section">' +
      '<div class="props-section-header" data-collapse-toggle>Effects<span class="chevron">▼</span></div>' +
      '<div class="props-section-body">' +
        '<div class="effect-row">' +
          '<span class="effect-label">Radius</span>' +
          '<input class="effect-slider" type="range" min="0" max="48" value="' + radius + '" data-prop="border-radius" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '">' +
          '<span class="effect-value" data-for="border-radius">' + radius + '</span>' +
        '</div>' +
        '<div class="effect-row">' +
          '<span class="effect-label">Opacity</span>' +
          '<input class="effect-slider" type="range" min="0" max="1" step="0.01" value="' + opacity + '" data-prop="opacity" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '">' +
          '<span class="effect-value" data-for="opacity">' + Math.round(opacity * 100) + '%</span>' +
        '</div>' +
        renderShadowSwatches(props, sessionId, nodeId) +
      '</div>' +
    '</div>';

    // ── States (hover/active/focus/disabled) ──
    var stateNames = ['hover', 'active', 'focus', 'disabled'];
    var existingStates = props.states || {};
    var stateItems = stateNames.map(function(sn) {
      var has = !!existingStates[sn];
      var stateOverrides = has ? existingStates[sn] : null;
      var overrideCount = stateOverrides ? Object.keys(stateOverrides).length : 0;
      // "Clone from base" = pre-fills the new state with a sensible
      // delta (e.g. hover → 90% opacity + slight color shift) so the
      // user gets something useful instead of an empty override map.
      var addBtn = has
        ? '<span class="state-badge on">' + overrideCount + ' override' + (overrideCount !== 1 ? 's' : '') + '</span>' +
          '<button class="state-edit-btn" data-state="' + escape(sn) + '" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '">Edit</button>'
        : '<button class="state-add-btn" data-state="' + escape(sn) + '" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '" title="Empty state — add overrides yourself">Add</button>' +
          '<button class="prop-text-btn state-clone-btn" data-state="' + escape(sn) + '" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '" title="Clone with sensible defaults" style="margin-left:4px">Clone</button>';
      return '<div class="state-item">' +
        '<span class="state-name">' + escape(sn) + '</span>' +
        addBtn +
      '</div>';
    }).join('');
    html += '<div class="props-section collapsed">' +
      '<div class="props-section-header" data-collapse-toggle>States<span class="chevron">▼</span></div>' +
      '<div class="props-section-body">' + stateItems + '</div>' +
    '</div>';

    // ── Animation ──
    var animPresets = ['fadeIn','slideInUp','slideInLeft','popIn','bounce','shimmer','scaleIn','typewriter'];
    var presetBtns = animPresets.map(function(p) {
      return '<button class="anim-preset-btn" data-preset="' + escape(p) + '" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '">' + escape(p) + '</button>';
    }).join('');
    html += '<div class="props-section collapsed">' +
      '<div class="props-section-header" data-collapse-toggle>Animation<span class="chevron">▼</span></div>' +
      '<div class="props-section-body"><div class="anim-grid">' + presetBtns + '</div></div>' +
    '</div>';

    // ── Grid (if applicable) ──
    if (props['grid-columns'] || props['grid-col-gap'] != null) {
      html += '<div class="props-section collapsed">' +
        '<div class="props-section-header" data-collapse-toggle>Grid<span class="chevron">▼</span></div>' +
        '<div class="props-section-body">' +
          '<div class="prop-pair">' +
            propCompact('ColGap', 'grid-col-gap', props['grid-col-gap'] || 0, sessionId, nodeId) +
            propCompact('RowGap', 'grid-row-gap', props['grid-row-gap'] || 0, sessionId, nodeId) +
          '</div>' +
        '</div>' +
      '</div>';
    }

    // ── Responsive ──
    var responsiveRules = props.responsive || [];
    html += '<div class="props-section collapsed">' +
      '<div class="props-section-header" data-collapse-toggle>Responsive<span class="chevron">▼</span></div>' +
      '<div class="props-section-body">' +
        (responsiveRules.length > 0
          ? responsiveRules.map(function(r) { return '<div class="responsive-rule">≤' + (r.maxWidth || '?') + 'px</div>'; }).join('')
          : '<div class="scene-dash-hint">No breakpoint overrides</div>') +
      '</div>' +
    '</div>';

    // ── Stroke details ──
    if (props['stroke-weight'] != null || props['border-color']) {
      var strokeColor = props['border-color'] || '#000000';
      html += '<div class="props-section">' +
        '<div class="props-section-header" data-collapse-toggle>Stroke<span class="chevron">▼</span></div>' +
        '<div class="props-section-body">' +
          '<div class="fill-row" style="margin-bottom:8px">' +
            '<div class="fill-swatch" style="background:' + escape(strokeColor) + '" data-prop="border-color" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '"></div>' +
            '<input class="fill-hex" type="text" value="' + escape(strokeColor) + '" data-prop="border-color" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '">' +
          '</div>' +
          '<div class="prop-pair">' +
            propCompact('Wt', 'stroke-weight', props['stroke-weight'] || 0, sessionId, nodeId) +
            propCompact('Align', 'stroke-align', props['stroke-align'] || 'INSIDE', sessionId, nodeId) +
          '</div>' +
          '<div class="prop-pair">' +
            propCompact('Cap', 'stroke-cap', props['stroke-cap'] || 'NONE', sessionId, nodeId) +
            propCompact('Join', 'stroke-join', props['stroke-join'] || 'MITER', sessionId, nodeId) +
          '</div>' +
        '</div>' +
      '</div>';
    }

    // ── OpenType features ──
    if (props['font-features'] || props['font-size'] != null) {
      var feats = props['font-features'] || [];
      var commonFeats = ['tnum', 'ss01', 'ss02', 'cv01', 'cv11', 'lnum', 'onum', 'salt', 'liga'];
      var featChips = commonFeats.map(function(f) {
        var on = feats.indexOf(f) >= 0;
        return '<button class="feat-chip' + (on ? ' on' : '') + '" data-feat="' + escape(f) + '" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '">' + escape(f) + '</button>';
      }).join('');
      html += '<div class="props-section collapsed">' +
        '<div class="props-section-header" data-collapse-toggle>OpenType<span class="chevron">▼</span></div>' +
        '<div class="props-section-body"><div class="feat-grid">' + featChips + '</div></div>' +
      '</div>';
    }

    // ── Corner smoothing ──
    var smoothing = props['corner-smoothing'] || 0;
    html += '<div class="props-section collapsed">' +
      '<div class="props-section-header" data-collapse-toggle>Corner smoothing<span class="chevron">▼</span></div>' +
      '<div class="props-section-body">' +
        '<div class="effect-row">' +
          '<span class="effect-label">Smooth</span>' +
          '<input class="effect-slider" type="range" min="0" max="1" step="0.05" value="' + smoothing + '" data-prop="corner-smoothing" data-scene="' + escape(sessionId) + '" data-node="' + escape(nodeId) + '">' +
          '<span class="effect-value">' + Math.round(smoothing * 100) + '%</span>' +
        '</div>' +
      '</div>' +
    '</div>';

    // ── Constraints ──
    if (props['min-width'] != null || props['max-width'] != null) {
      html += '<div class="props-section collapsed">' +
        '<div class="props-section-header" data-collapse-toggle>Constraints<span class="chevron">▼</span></div>' +
        '<div class="props-section-body">' +
          '<div class="prop-pair">' +
            propCompact('MinW', 'min-width', props['min-width'] || '', sessionId, nodeId) +
            propCompact('MaxW', 'max-width', props['max-width'] || '', sessionId, nodeId) +
          '</div>' +
          '<div class="prop-pair">' +
            propCompact('MinH', 'min-height', props['min-height'] || '', sessionId, nodeId) +
            propCompact('MaxH', 'max-height', props['max-height'] || '', sessionId, nodeId) +
          '</div>' +
        '</div>' +
      '</div>';
    }

    // Phase 1 UI-3 — Metadata section. Surfaces engine-extension
    // fields (annotations / interactive / entrance / hero / narrative)
    // that have no inline editor in the shipping inspector — designer
    // can at least see they exist on the node. Full inline config
    // editors are reserved for Phase 2 picker palette work; for now
    // the rows are read-only summaries. Skipped entirely when none
    // of the metadata fields are populated.
    var metaRows = renderMetaRows(props, sessionId, nodeId);
    if (metaRows) {
      html += '<div class="props-section">' +
        '<div class="props-section-header" data-collapse-toggle>Metadata<span class="chevron">▼</span></div>' +
        '<div class="props-section-body">' + metaRows + '</div>' +
      '</div>';
    }

    panel.innerHTML = html;
    bindPropInputs();
    bindResetButtons(sessionId, nodeId);
    bindPropsFilter();
    bindCollapsePersistence();
    bindStatesAndAnimation(sessionId, nodeId);
    bindAiBar(sessionId, nodeId);
    // Async: fetch audit + brand fidelity → populate banners. Doesn't
    // block the rest of the panel; if it fails we just show nothing.
    fetchAndRenderSuggestions(sessionId, nodeId);
  }

  // Phase 1 UI-3 — metadata row builder. Mirrors the server-side
  // `summarizeMeta` from inspector-helpers.ts; runs client-side so we
  // don't pay an extra round-trip to render a one-line label. When
  // neither parsing nor summary is meaningful, returns null and the
  // section is skipped.
  function renderMetaRows(props, sessionId, nodeId) {
    var rows = '';
    function row(label, payload) {
      if (payload == null) return '';
      return '<div class="prop-pair" style="font-size:11px;color:var(--text-muted,#888);padding:4px 0">' +
        '<span style="flex:1">' + escape(label) + '</span>' +
        '<span style="font-family:var(--mono,monospace);font-size:10px">' + escape(String(payload)) + '</span>' +
      '</div>';
    }
    if (Array.isArray(props.annotations) && props.annotations.length > 0) {
      rows += row('Annotations', props.annotations.length + ' note' + (props.annotations.length === 1 ? '' : 's'));
    }
    if (props.interactive && props.interactive.type) {
      rows += row('Interactive', props.interactive.type);
    }
    if (props.entrance && props.entrance.type) {
      rows += row('Entrance', props.entrance.type);
    }
    if (props.hero && props.hero.mode) {
      rows += row('Hero', props.hero.mode);
    }
    if (props.narrative && props.narrative.kind) {
      var frames = typeof props.narrative.frameCount === 'number' ? ' (' + props.narrative.frameCount + ' frames)' : '';
      rows += row('Narrative', props.narrative.kind + frames);
    }
    void sessionId; void nodeId;
    return rows;
  }

  // Phase 1 UI-3 — reset-to-default button click handlers. Wires every
  // [data-reset-prop] button to POST /platform/api/node/reset-prop with
  // the node's id and the prop key. Server responds, SSE fires
  // scene:session-changed, the inspector re-fetches (the parent
  // showPropsForNode call) so the row's value flips back.
  function bindResetButtons(sessionId, nodeId) {
    $$('[data-reset-prop]').forEach(function(btn) {
      btn.addEventListener('click', async function(e) {
        e.preventDefault();
        e.stopPropagation();
        var prop = btn.getAttribute('data-reset-prop');
        try {
          await fetch('/platform/api/node/reset-prop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sceneId: sessionId, nodeId: nodeId, prop: prop }),
          });
        } catch (_) { /* best-effort */ }
        // Re-fetch the node so the inspector reflects the cleared prop.
        showPropsForNode(nodeId, sessionId);
      });
    });
  }

  // Phase 1 UI-3 — top-of-inspector property filter. Live filtering on
  // the data-prop attribute of every visible control row. A row matches
  // when its data-prop key (or its containing section's header) starts
  // with the query (case-insensitive). When the filter is non-empty
  // sections with zero matching rows hide entirely.
  function bindPropsFilter() {
    var input = $('[data-props-filter]');
    if (!input) return;
    input.addEventListener('input', function() {
      var q = String(input.value || '').trim().toLowerCase();
      var sections = $$('.props-section');
      sections.forEach(function(section) {
        if (q === '') {
          // Restore — let collapse state and CSS handle visibility.
          section.style.removeProperty('display');
          section.querySelectorAll('.prop-pair, .prop-row, .effect-row, .fill-row, .state-item').forEach(function(row) {
            row.style.removeProperty('display');
          });
          return;
        }
        var headerText = (section.querySelector('.props-section-header') || {}).textContent || '';
        var sectionMatches = headerText.toLowerCase().indexOf(q) >= 0;
        var anyRowMatch = false;
        section.querySelectorAll('[data-prop]').forEach(function(el) {
          var prop = (el.getAttribute('data-prop') || '').toLowerCase();
          var row = el.closest('.prop-pair, .prop-row, .effect-row, .fill-row, .state-item') || el;
          if (sectionMatches || prop.indexOf(q) >= 0) {
            row.style.removeProperty('display');
            anyRowMatch = true;
          } else {
            row.style.display = 'none';
          }
        });
        section.style.display = (sectionMatches || anyRowMatch) ? '' : 'none';
      });
    });
  }

  // Phase 1 UI-3 — collapse state persistence per section. Section
  // identity is the header text content (stable across renders). The
  // map of {header → collapsed} survives reload via localStorage.
  // Reapplied on every renderPropsPanel — keeps state across selection
  // changes within the same session.
  function bindCollapsePersistence() {
    var KEY = 'reframe-inspector-collapsed-sections';
    function loadMap() {
      try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) { return {}; }
    }
    function saveMap(m) {
      try { localStorage.setItem(KEY, JSON.stringify(m)); } catch (_) {}
    }
    var stored = loadMap();
    $$('[data-collapse-toggle]').forEach(function(header) {
      var label = (header.textContent || '').replace(/[▼▶▾▸]/g, '').trim();
      if (stored[label]) header.parentElement.classList.add('collapsed');
      header.addEventListener('click', function() {
        // Defer until after the existing toggle handler runs (the
        // handler in 120-widgets.js binds first; the classList state
        // we read here is the post-toggle state).
        setTimeout(function() {
          var current = loadMap();
          current[label] = header.parentElement.classList.contains('collapsed');
          saveMap(current);
        }, 0);
      });
    });
  }

  // ── AI bar inside Properties (sticky top, scoped to selected node) ─────
  // ONE input + Ask. No preset chips. AI handles whatever the user types
  // — including stylistic shifts the engine could do directly. The
  // server-side fast path (/api/agent/preset/apply) stays as an AI tool
  // claude can pick when it fits, but we don't surface chips that
  // duplicate textual intent.
  function renderAiBar(_sessionId, _nodeId) {
    return '' +
      '<div class="props-ai-bar" style="position:sticky;top:0;z-index:5;' +
        'background:var(--surface-elevated,#1a1a1a);' +
        'border-bottom:1px solid var(--border,#333);' +
        'margin:0 -12px 10px;padding:10px 12px;display:flex;' +
        'flex-direction:column;gap:6px">' +
        '<div style="display:flex;align-items:center;gap:6px">' +
          '<span style="font-size:13px">✨</span>' +
          '<input data-ai-input type="text" ' +
            'placeholder="Ask about this node…" ' +
            'style="flex:1;min-width:0;padding:5px 8px;font-size:11px;' +
            'background:var(--surface,#0e0e0e);color:var(--text-primary,#e5e5e5);' +
            'border:1px solid var(--border,#333);border-radius:5px;outline:none;font-family:inherit">' +
          '<button data-ai-ask type="button" ' +
            'style="padding:5px 10px;font-size:11px;font-weight:600;' +
            'background:var(--accent,#f15a29);color:#fff;border:none;border-radius:5px;cursor:pointer">' +
            'Ask</button>' +
        '</div>' +
        '<div data-ai-status style="display:none;font-size:10px;color:var(--text-muted,#888);min-height:12px"></div>' +
      '</div>';
  }

  function bindAiBar(sessionId, nodeId) {
    var panel = $('[data-panel="design"]');
    if (!panel) return;
    var bar = panel.querySelector('.props-ai-bar');
    if (!bar) return;

    var input = bar.querySelector('[data-ai-input]');
    var askBtn = bar.querySelector('[data-ai-ask]');

    // Open the floating prompt scoped to this node, pre-filled with
    // whatever the user typed in the bar. Reuses the same event the
    // canvas right-click + Cmd+K use, so all AI flows stay in one path.
    function fireAsk() {
      var text = (input && input.value || '').trim();
      var detail = {
        nodeId: nodeId || null,
        x: window.innerWidth / 2 - 220,
        y: 100,
        prefill: text,
      };
      window.dispatchEvent(new CustomEvent('reframe:ask-agent', { detail: detail }));
      if (input) input.value = '';
    }
    if (askBtn) askBtn.addEventListener('click', fireAsk);
    if (input) input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); fireAsk(); }
    });
    // sessionId is used implicitly by the floating prompt via the
    // canvas data-session attribute, so we don't need to pass it.
    void sessionId;
  }

  function bindStatesAndAnimation(sessionId, nodeId) {
    // State add buttons.
    $$('.state-add-btn[data-state]').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var stateName = btn.getAttribute('data-state');
        var scene = btn.getAttribute('data-scene');
        var node = btn.getAttribute('data-node');
        if (!stateName || !scene || !node) return;
        try {
          await api('/platform/api/node/state', { sceneId: scene, nodeId: node, stateName: stateName, props: {} });
          flash('State ' + stateName + ' added', 'success');
          showPropsForNode(node, scene);
        } catch (_) {}
      });
    });
    // State edit buttons — open a VerbPanel with common state overrides.
    $$('.state-edit-btn[data-state]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var stateName = btn.getAttribute('data-state');
        var scene = btn.getAttribute('data-scene');
        var node = btn.getAttribute('data-node');
        if (!stateName || !scene || !node) return;
        showVerbPanel('Edit ' + stateName + ' state',
          '<div class="prop-pair">' +
            '<div class="prop-compact"><span class="prop-compact-label">bg</span>' +
              '<input class="prop-compact-input" type="text" value="" data-state-prop="background" placeholder="#hex"></div>' +
            '<div class="prop-compact"><span class="prop-compact-label">opacity</span>' +
              '<input class="prop-compact-input" type="number" value="" data-state-prop="opacity" placeholder="0-1" step="0.1"></div>' +
          '</div>' +
          '<div class="prop-pair">' +
            '<div class="prop-compact"><span class="prop-compact-label">scale</span>' +
              '<input class="prop-compact-input" type="number" value="" data-state-prop="scaleX" placeholder="1" step="0.05"></div>' +
            '<div class="prop-compact"><span class="prop-compact-label">radius</span>' +
              '<input class="prop-compact-input" type="number" value="" data-state-prop="cornerRadius" placeholder="px"></div>' +
          '</div>',
          function(panel) {
            var overrides = {};
            panel.querySelectorAll('[data-state-prop]').forEach(function(input) {
              var prop = input.getAttribute('data-state-prop');
              var val = input.value.trim();
              if (!prop || !val) return;
              overrides[prop] = isNaN(Number(val)) ? val : Number(val);
            });
            if (Object.keys(overrides).length === 0) return;
            api('/platform/api/node/state', {
              sceneId: scene,
              nodeId: node,
              stateName: stateName,
              props: overrides,
            }).then(function() {
              flash(stateName + ' state updated', 'success');
              showPropsForNode(node, scene);
            }).catch(function() {});
          }
        );
      });
    });
    // Animation preset buttons.
    $$('.anim-preset-btn[data-preset]').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var preset = btn.getAttribute('data-preset');
        var scene = btn.getAttribute('data-scene');
        var node = btn.getAttribute('data-node');
        if (!preset || !scene || !node) return;
        try {
          await api('/platform/api/node/animate', { sceneId: scene, nodeId: node, preset: preset });
          flash('Animation: ' + preset, 'success');
          // Refresh viewport to show the animation.
          refreshViewports();
        } catch (_) {}
      });
    });
    // OpenType feature toggle chips.
    $$('.feat-chip[data-feat]').forEach(function(chip) {
      chip.addEventListener('click', async function() {
        var feat = chip.getAttribute('data-feat');
        var scene = chip.getAttribute('data-scene');
        var node = chip.getAttribute('data-node');
        if (!feat || !scene || !node) return;
        chip.classList.toggle('on');
        // Collect all active features.
        var activeFeats = [];
        chip.parentElement.querySelectorAll('.feat-chip.on').forEach(function(c) {
          activeFeats.push(c.getAttribute('data-feat'));
        });
        editNodeProp(scene, node, 'font-features', activeFeats);
      });
    });
  }

  // ── Smart Suggestions: audit-driven actionable banners ──────────
  // Pulls /platform/api/audit?sceneId=X, filters issues to the current
  // node, renders each as a click-to-fix banner. Non-fixable issues
  // open the floating Ask Agent prefilled with the issue context.
  // Brand-fidelity score → small chip near top showing alignment.
  var _auditCache = {}; // { sceneId: { ts, payload } }
  function fetchSceneAudit(sceneId) {
    if (!sceneId) return Promise.resolve(null);
    var cached = _auditCache[sceneId];
    if (cached && (Date.now() - cached.ts) < 10000) return Promise.resolve(cached.payload);
    return fetch('/platform/api/audit?sceneId=' + encodeURIComponent(sceneId))
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(j) {
        if (j) _auditCache[sceneId] = { ts: Date.now(), payload: j };
        return j;
      })
      .catch(function() { return null; });
  }

  function fetchAndRenderSuggestions(sceneId, nodeId) {
    var container = $('[data-smart-suggestions]');
    if (!container || !sceneId) return;
    fetchSceneAudit(sceneId).then(function(audit) {
      if (!audit || !Array.isArray(audit.findings)) return;
      // Filter to issues affecting this node. Matching is by nodeId
      // (some rules report a structural node, others an offending leaf)
      // — accept either an exact nodeId match OR a parent-path match.
      var related = audit.findings.filter(function(f) {
        if (!f.nodeId) return false;
        return f.nodeId === nodeId;
      });

      // Severity icons.
      function icon(sev) {
        if (sev === 'error') return '⚠';
        if (sev === 'warning') return '⚡';
        return 'ⓘ';
      }
      function color(sev) {
        if (sev === 'error') return '#e85a5a';
        if (sev === 'warning') return '#f0b132';
        return 'var(--text-muted,#888)';
      }

      var bannerHtml = '';
      // Brand alignment chip first (whole-scene, but useful here).
      if (audit.brandFidelity && typeof audit.brandFidelity.score === 'number') {
        var score = audit.brandFidelity.score;
        var aligned = score >= 80;
        bannerHtml += '<div style="display:flex;align-items:center;gap:6px;font-size:10px;margin-bottom:6px">' +
          '<span style="display:inline-block;padding:1px 6px;border-radius:3px;background:' +
            (aligned ? 'rgba(54,199,119,.18)' : 'rgba(232,90,90,.18)') + ';color:' +
            (aligned ? '#36c777' : '#e85a5a') + '">' +
            (aligned ? '✓ brand-aligned' : '⚠ brand drift') + ' ' + Math.round(score) + '%</span>' +
          (audit.brandFidelity.activeBrand ? '<span style="color:var(--text-muted,#888)">vs ' + escape(audit.brandFidelity.activeBrand) + '</span>' : '') +
        '</div>';
      }

      if (related.length === 0) {
        if (!bannerHtml) {
          // Nothing to show — keep container hidden.
          return;
        }
        // Show only brand chip even if no per-node issues.
        container.style.display = '';
        container.innerHTML = bannerHtml;
        return;
      }

      // Render up to 4 most severe issues.
      var sorted = related.sort(function(a, b) {
        var order = { error: 0, warning: 1, info: 2 };
        return (order[a.severity] || 9) - (order[b.severity] || 9);
      }).slice(0, 4);

      bannerHtml += sorted.map(function(f, i) {
        var fixable = f.fix && f.fix.suggested != null;
        return '<div data-suggestion-idx="' + i + '" style="display:flex;align-items:flex-start;gap:6px;padding:5px 0;font-size:11px;line-height:1.35;' +
          (i > 0 ? 'border-top:1px solid var(--border,#333);' : '') + '">' +
          '<span style="color:' + color(f.severity) + ';font-size:11px;flex:none;line-height:1.4">' + icon(f.severity) + '</span>' +
          '<div style="flex:1">' +
            '<div style="color:var(--text-primary,#e5e5e5)">' + escape(f.message) + '</div>' +
            '<div style="font-size:9px;color:var(--text-muted,#888);font-family:var(--mono,monospace);margin-top:1px">' + escape(f.rule) + '</div>' +
          '</div>' +
          (fixable
            ? '<button data-fix-idx="' + i + '" type="button" style="padding:3px 8px;font-size:10px;background:var(--accent,#f15a29);color:#fff;border:none;border-radius:3px;cursor:pointer;flex:none">Fix</button>'
            : '<button data-ask-idx="' + i + '" type="button" style="padding:3px 8px;font-size:10px;background:transparent;color:var(--accent,#f15a29);border:1px solid var(--accent,#f15a29);border-radius:3px;cursor:pointer;flex:none">✨ Ask</button>') +
        '</div>';
      }).join('');

      container.style.display = '';
      container.innerHTML = bannerHtml;

      // Wire fix buttons → apply suggested value via editNodeProp.
      container.querySelectorAll('[data-fix-idx]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var idx = Number(btn.getAttribute('data-fix-idx'));
          var f = sorted[idx];
          if (!f || !f.fix) return;
          editNodeProp(sceneId, nodeId, f.fix.property, f.fix.suggested);
          btn.disabled = true;
          btn.textContent = '✓';
          // Invalidate audit cache so next render picks up the fix.
          delete _auditCache[sceneId];
        });
      });
      // Wire ask buttons → open Ask Agent prefilled with issue context.
      container.querySelectorAll('[data-ask-idx]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var idx = Number(btn.getAttribute('data-ask-idx'));
          var f = sorted[idx];
          if (!f) return;
          window.dispatchEvent(new CustomEvent('reframe:ask-agent', {
            detail: {
              nodeId: nodeId || null,
              x: window.innerWidth / 2 - 220,
              y: 100,
              prefill: 'Fix this audit issue: ' + f.message + ' (rule: ' + f.rule + ')',
            },
          }));
        });
      });
    });
  }
