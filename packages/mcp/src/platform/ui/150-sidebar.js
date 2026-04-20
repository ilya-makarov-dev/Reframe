  // ── Layers tree (sidebar) ─────────────────────────────
  // Fetches the node tree of the current scene and renders it as a
  // clickable hierarchy in the sidebar. Click a layer → selects that
  // node in the viewport + shows Properties Inspector.

  // Coalesce bursts: pullFromMCP rebuilding the OP graph fires N
  // reframe:node-created events, each of which used to queue a
  // setTimeout(refreshLayersTree, 1200). For an N-node scene that was
  // N parallel /platform/api/scene/tree fetches + N full innerHTML
  // swaps at roughly the same moment — the UI "scene/tree infinite
  // loop" smell. One trailing refresh is all we want.
  var _refreshTreeTimer = null;
  var _refreshTreeInFlight = false;
  async function refreshLayersTree() {
    if (_refreshTreeTimer) clearTimeout(_refreshTreeTimer);
    _refreshTreeTimer = setTimeout(doRefreshLayersTree, 120);
  }
  async function doRefreshLayersTree() {
    _refreshTreeTimer = null;
    if (_refreshTreeInFlight) {
      // Another refresh finished too recently; re-queue once so we
      // still land on the latest tree.
      _refreshTreeTimer = setTimeout(doRefreshLayersTree, 120);
      return;
    }
    _refreshTreeInFlight = true;
    try {
      var container = $('[data-layers-tree]');
      if (!container) return;
      var frame = $('.viewport-frame') || document.getElementById('reframe-viewport');
      var sessionId = frame ? (frame.getAttribute('data-session') || frame.dataset.session) : null;
      if (!sessionId) {
        container.innerHTML = '<div class="sidebar-empty">No scene</div>';
        return;
      }
      // Prefer inlined boot payload on first paint — same tree shape.
      var cachedTree = consumeBootSection(sessionId, 'tree');
      if (cachedTree) {
        container.innerHTML = renderLayerNode(cachedTree, 0);
        bindLayerClicks(sessionId);
        return;
      }
      try {
        var res = await api('/platform/api/scene/tree?sceneId=' + encodeURIComponent(sessionId));
        if (!res.ok || !res.tree) {
          container.innerHTML = '<div class="sidebar-empty">Failed to load</div>';
          return;
        }
        container.innerHTML = renderLayerNode(res.tree, 0);
        bindLayerClicks(sessionId);
      } catch (_) {
        container.innerHTML = '<div class="sidebar-empty">Error</div>';
      }
    } finally {
      _refreshTreeInFlight = false;
    }
  }

  function renderLayerNode(node, depth) {
    if (!node) return '';

    // Absorb single-TEXT-child into parent: if this node has exactly
    // one child of type TEXT, show the text inline and skip the child.
    var absorbedText = '';
    var effectiveChildren = node.children || [];
    if (effectiveChildren.length === 1 && effectiveChildren[0].type === 'TEXT') {
      absorbedText = effectiveChildren[0].text || effectiveChildren[0].name || '';
      effectiveChildren = []; // Don't render the child separately.
    }
    // Also absorb own text if this IS a TEXT node with no children.
    if (node.type === 'TEXT' && effectiveChildren.length === 0) {
      absorbedText = node.text || node.name || '';
    }

    // Determine display name: semantic role > meaningful name > tag.
    var rawName = (node.name || '').toLowerCase();
    var displayName = node.name || '?';
    // If name is just a generic HTML tag, try to make it more meaningful.
    // e.g. "div" with children → "Container", "section" → "Section"
    var FRIENDLY = {
      div: 'Container', span: 'Span', section: 'Section',
      header: 'Header', footer: 'Footer', main: 'Main',
      nav: 'Nav', article: 'Article', aside: 'Aside',
      ul: 'List', ol: 'List', li: 'Item',
      a: 'Link', img: 'Image', p: 'Paragraph',
      h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3',
      h4: 'Heading 4', h5: 'Heading 5', h6: 'Heading 6',
      button: 'Button', input: 'Input', form: 'Form',
    };
    if (FRIENDLY[rawName]) displayName = FRIENDLY[rawName];
    // TEXT nodes without absorbed text → show "Text"
    if (node.type === 'TEXT' && !absorbedText) displayName = 'Text';
    // TEXT nodes WITH text: use the live text content as the display
    // name. node.name is frozen at import from the original text, so it
    // stays stale after a reframe_edit characters update — chat agents
    // report "text updated" but LAYERS still shows the old truncated
    // name, which reads as "nothing happened." Using the current text
    // gives immediate visual confirmation; set absorbedText='' after so
    // we don't render the same content twice (name + preview quote).
    if (node.type === 'TEXT' && absorbedText) {
      displayName = absorbedText.length > 28
        ? absorbedText.slice(0, 28) + '…'
        : absorbedText;
      absorbedText = '';
    }

    var indent = depth * 16;
    var hasChildren = effectiveChildren.length > 0;
    var collapsed = depth >= 2 && hasChildren; // Auto-collapse deep levels.
    var toggleIcon = hasChildren
      ? '<span class="layer-toggle">' + (collapsed ? '▸' : '▾') + '</span>'
      : '<span class="layer-toggle-spacer"></span>';

    // Type badge — small, subtle, right-aligned. Hide when it would
    // just duplicate the name (e.g. a `<section>` auto-named after its
    // heading text shows "New deployment" as both name AND badge, which
    // ate half the row's horizontal space and pushed the actual name
    // into "New depl..." truncation). A badge is only worth showing when
    // it adds information the displayName doesn't already carry.
    var badgeText = rawName;
    var nameLower = displayName.toLowerCase();
    var badgeRedundant = node.type === 'TEXT'
      || !badgeText
      || badgeText === nameLower
      || nameLower.indexOf(badgeText) !== -1
      || badgeText.indexOf(nameLower) !== -1;
    var typeBadge = badgeRedundant ? '' :
      '<span class="layer-badge">' + escape(rawName) + '</span>';

    // Text preview inline (absorbed from child or own text).
    // Suppress when the preview would just repeat the row's name —
    // happens when an HTML import auto-names a frame after its single
    // text child, so both name and badge spell the same word.
    var textEl = '';
    if (absorbedText) {
      var nameNorm = displayName.toLowerCase().trim();
      var textNorm = absorbedText.toLowerCase().trim();
      var isRedundant = nameNorm === textNorm
        || nameNorm.indexOf(textNorm) === 0
        || textNorm.indexOf(nameNorm) === 0;
      if (!isRedundant) {
        textEl = '<span class="layer-text">“' + escape(absorbedText.slice(0, 24)) + (absorbedText.length > 24 ? '…' : '') + '”</span>';
      }
    }

    var html = '<div class="layer-item" data-layer-node="' + escape(node.id) + '" style="padding-left:' + (4 + indent) + 'px">' +
      toggleIcon +
      '<span class="layer-name">' + escape(displayName) + '</span>' +
      textEl +
      typeBadge +
    '</div>';

    if (hasChildren) {
      html += '<div class="layer-children' + (collapsed ? ' collapsed' : '') + '" data-layer-group>';
      for (var i = 0; i < effectiveChildren.length; i++) {
        html += renderLayerNode(effectiveChildren[i], depth + 1);
      }
      html += '</div>';
    }
    return html;
  }

  // Keep LAYERS highlight in sync with state.selection.inode — fires
  // when selection changes from ANY source (canvas click, macro-toolbar
  // selection, persisted-state boot). Without this, clicking on the
  // canvas highlights nothing in LAYERS because the click path never
  // reaches bindLayerClicks' own listener (that's LAYERS-only).
  function highlightLayerBySelection() {
    var active = state && state.selection && state.selection.inode;
    $$('[data-layer-node]').forEach(function(el) {
      var match = !!active && el.getAttribute('data-layer-node') === active;
      el.classList.toggle('selected', match);
    });
  }
  if (!window.__reframeLayersSelectionBound) {
    window.__reframeLayersSelectionBound = true;
    window.addEventListener('reframe:ui-state-changed', highlightLayerBySelection);
  }

  function bindLayerClicks(sessionId) {
    // Highlight the current selection right after the list re-renders
    // (the innerHTML swap wipes the .selected class).
    highlightLayerBySelection();
    $$('[data-layer-node]').forEach(function(el) {
      el.addEventListener('click', function(e) {
        // If click was on the toggle arrow → expand/collapse, don't select.
        if (e.target && e.target.classList && e.target.classList.contains('layer-toggle')) {
          var group = el.nextElementSibling;
          if (group && group.hasAttribute('data-layer-group')) {
            group.classList.toggle('collapsed');
            // Update arrow direction.
            e.target.textContent = group.classList.contains('collapsed') ? '▸' : '▾';
          }
          return;
        }
        var nodeId = el.getAttribute('data-layer-node');
        if (!nodeId) return;
        $$('[data-layer-node]').forEach(function(e) { e.classList.remove('selected'); });
        el.classList.add('selected');
        state.selection.inode = nodeId;
        state.selection.tag = '';
        state.selection.bbox = null;
        try { persistUiState(); } catch (_) {}
        var m = state.measurements.get(nodeId);
        if (m) {
          state.selection.bbox = m.bbox;
          state.selection.tag = m.tag || '';
          drawSelectOutline();
          if (state.editMode) showSelectionToolbar();
        }
        showPropsForNode(nodeId, sessionId);
        postToIframe({ type: 'reframe:highlight', inode: nodeId });
        // If CanvasKit is active, select the node on the OP canvas too.
        if (document.getElementById('reframe-viewport')) {
          window.dispatchEvent(new CustomEvent('reframe:layer-select', {
            detail: { nodeId: nodeId },
          }));
        }
      });
    });
  }

  // ── Sidebar actions (New scene, Switch brand) ────────
  function bindSidebarActions() {
    var newSceneBtn = $('[data-action="new-scene"]');
    if (newSceneBtn) {
      newSceneBtn.addEventListener('click', function() {
        showVerbPanel('New scene',
          '<textarea class="ask-input" style="height:80px;resize:vertical;font-family:var(--mono);font-size:12px" data-vp-field="html" placeholder="Paste HTML here…"></textarea>' +
          '<div class="ask-hint">Paste your HTML · the engine will compile it into a scene</div>',
          function(panel) {
            var textarea = panel.querySelector('[data-vp-field="html"]');
            var html = textarea ? textarea.value.trim() : '';
            if (!html) { flash('Paste HTML to create a scene'); return; }
            api('/platform/api/intent/add', {
              parts: [{ kind: 'text', value: 'compile this HTML: ' + html.slice(0, 500) }],
            }).then(function() {
              flash('Intent queued — agent will compile', 'success');
            }).catch(function() {});
          }
        );
      });
    }
    var switchBrandBtn = $('[data-action="switch-brand"]');
    if (switchBrandBtn) {
      switchBrandBtn.addEventListener('click', openBrandBrowser);
    }
  }

  // ── Timeline scrubber (bottom bar) ───────────────────
  // Fetches ops history and renders dots on the timeline track.
  // Drag the handle to scrub through history (undo to that point).

  var timelineOps = [];

  async function refreshTimeline() {
    var frame = $('.viewport-frame');
    var sessionId = frame ? frame.getAttribute('data-session') : null;
    if (!sessionId) return;
    try {
      var res = await api('/platform/api/ops?sceneId=' + encodeURIComponent(sessionId));
      timelineOps = res.ops || [];
      renderTimelineDots();
    } catch (_) {}
  }

  function renderTimelineDots() {
    var opsContainer = $('.bottom-bar .timeline-ops');
    if (!opsContainer) return;
    if (timelineOps.length === 0) {
      opsContainer.innerHTML = '';
      return;
    }
    opsContainer.innerHTML = timelineOps.map(function(op) {
      return '<div class="timeline-op" title="' + escape(op.type + (op.nodeId ? ' @' + op.nodeId.slice(-6) : '')) + '"></div>';
    }).join('');
    // Position handle at the end (current state = latest op).
    var handle = $('.bottom-bar .timeline-handle');
    if (handle) handle.style.right = '0';
  }

  function bindTimelineScrubber() {
    var track = $('.bottom-bar .timeline-track');
    var handle = $('.bottom-bar .timeline-handle');
    if (!track || !handle) return;

    var dragging = false;

    handle.addEventListener('pointerdown', function(e) {
      dragging = true;
      e.preventDefault();
      try { handle.setPointerCapture(e.pointerId); } catch (_) {}
    });
    document.addEventListener('pointermove', function(e) {
      if (!dragging) return;
      var rect = track.getBoundingClientRect();
      var x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      var pct = x / rect.width;
      handle.style.left = (pct * 100) + '%';
      handle.style.right = 'auto';
      // Show tooltip with op index.
      var idx = Math.round(pct * (timelineOps.length - 1));
      if (idx >= 0 && idx < timelineOps.length) {
        handle.title = 'Op ' + (idx + 1) + '/' + timelineOps.length + ': ' + (timelineOps[idx].type || '?');
      }
    });
    document.addEventListener('pointerup', function() {
      if (!dragging) return;
      dragging = false;
      // On release: undo everything after the drop point.
      var rect = track.getBoundingClientRect();
      var pct = parseFloat(handle.style.left) / 100;
      if (isNaN(pct)) return;
      var targetIdx = Math.round(pct * (timelineOps.length - 1));
      var undoCount = timelineOps.length - 1 - targetIdx;
      if (undoCount > 0) {
        (async function() {
          for (var i = 0; i < undoCount; i++) {
            await undoLastOp();
          }
          refreshTimeline();
        })();
      }
    });

    // Click on audit summary → refresh audit.
    var auditSummary = $('.bottom-bar .audit-summary');
    if (auditSummary) {
      auditSummary.addEventListener('click', refreshAudit);
    }
  }

  // ── Brand browser overlay ────────────────────────────
  async function openBrandBrowser() {
    var existing = $('.brand-browser');
    if (existing) { existing.classList.add('show'); return; }
    // Fetch brands.
    var brands = [];
    try {
      var res = await api('/platform/api/brands');
      brands = res.brands || [];
    } catch (_) {}
    // Build overlay.
    var overlay = document.createElement('div');
    overlay.className = 'brand-browser show';
    overlay.setAttribute('data-testid', 'brand-browser');
    var cardsHtml = brands.length === 0
      ? '<div style="grid-column:1/-1;padding:40px;text-align:center;color:var(--text-tertiary)">No brands registered. Use reframe_design to load one.</div>'
      : brands.map(function(b) {
          return '<button class="brand-card" data-brand-slug="' + escape(b.slug || b.name || '') + '">' +
            '<div class="brand-name">' + escape(b.name || b.slug || '?') + '</div>' +
            '<div class="brand-font">' + escape(b.slug || '') + '</div>' +
          '</button>';
        }).join('');
    overlay.innerHTML =
      '<div class="brand-browser-panel">' +
        '<div class="brand-browser-head">' +
          '<span class="title">Switch brand</span>' +
          '<button class="close-btn">×</button>' +
        '</div>' +
        '<div class="brand-browser-search">' +
          '<input type="text" placeholder="Search brands…">' +
        '</div>' +
        '<div class="brand-browser-grid">' + cardsHtml + '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    // Close: × button, backdrop click, Escape key. The Esc handler
    // was missing before — users who hit Escape to dismiss found the
    // modal still open and every other shortcut blocked (Modify/
    // Preview/More clicks bounced off the overlay pointer-events).
    function removeOverlay() {
      overlay.remove();
      document.removeEventListener('keydown', onEsc);
    }
    function onEsc(e) { if (e.key === 'Escape') { e.preventDefault(); removeOverlay(); } }
    document.addEventListener('keydown', onEsc);
    overlay.querySelector('.close-btn').addEventListener('click', removeOverlay);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) removeOverlay(); });
    // Search.
    var searchInput = overlay.querySelector('.brand-browser-search input');
    if (searchInput) {
      searchInput.addEventListener('input', function() {
        var q = searchInput.value.toLowerCase();
        overlay.querySelectorAll('.brand-card').forEach(function(card) {
          var name = card.getAttribute('data-brand-slug') || '';
          card.style.display = name.indexOf(q) >= 0 ? '' : 'none';
        });
      });
      searchInput.focus();
    }
    // Brand card click → switch.
    overlay.querySelectorAll('.brand-card').forEach(function(card) {
      card.addEventListener('click', async function() {
        var slug = card.getAttribute('data-brand-slug');
        if (!slug) return;
        try {
          await api('/platform/api/brand/switch', { slug: slug });
          flash('Brand: ' + slug, 'success');
          removeOverlay();
          // Re-render preview with new brand tokens.
          refreshViewports();
          // Update sidebar brand label.
          var brandLabel = $('.brand-label');
          if (brandLabel) brandLabel.textContent = slug;
        } catch (_) {}
      });
    });
  }

  // ── Theme toggle ─────────────────────────────────────
  function bindThemeToggle() {
    const btn = $('[data-theme-toggle]');
    if (!btn) return;
    btn.addEventListener('click', function() {
      const current = document.documentElement.getAttribute('data-theme');
      // Cycle: (unset/system) → light → dark → unset → ...
      let next;
      if (current === 'light') next = 'dark';
      else if (current === 'dark') next = null;
      else next = 'light';
      if (next) {
        document.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem('reframe-theme', next); } catch (_) {}
      } else {
        document.documentElement.removeAttribute('data-theme');
        try { localStorage.removeItem('reframe-theme'); } catch (_) {}
      }
      flash('Theme: ' + (next || 'system'));
      // Re-render annotations — accent colors shifted, marks need repaint.
      renderAllAnnotations();
    });
  }

  // ── Init ─────────────────────────────────────────────