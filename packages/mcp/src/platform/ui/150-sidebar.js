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

    // Phase 1 UI-4 — visibility + lock state on the row. Default-true
    // for visible (unset → shown), default-false for locked.
    var isVisible = node.visible !== false;
    var isLocked = !!node.locked;
    var rowClasses = 'layer-item' + (isVisible ? '' : ' layer-hidden') + (isLocked ? ' layer-locked' : '');
    var visibilityIcon = isVisible
      ? '<span class="layer-vis layer-vis-on" title="Visible · click to hide">👁</span>'
      : '<span class="layer-vis layer-vis-off" title="Hidden · click to show" style="opacity:0.4">⊘</span>';
    var lockIcon = isLocked
      ? '<span class="layer-lock layer-lock-on" title="Locked · click to unlock">🔒</span>'
      : '<span class="layer-lock layer-lock-off" title="Unlocked · click to lock" style="opacity:0.3">🔓</span>';
    var html = '<div class="' + rowClasses + '" data-layer-node="' + escape(node.id) +
        '" data-layer-visible="' + (isVisible ? '1' : '0') +
        '" data-layer-locked="' + (isLocked ? '1' : '0') +
        '" data-layer-name="' + escape(node.name || '') +
        '" draggable="true" style="padding-left:' + (4 + indent) + 'px">' +
      toggleIcon +
      '<span class="layer-name" data-layer-rename>' + escape(displayName) + '</span>' +
      textEl +
      typeBadge +
      '<span class="layer-icons" style="margin-left:auto;display:inline-flex;gap:6px;padding-right:4px">' +
        visibilityIcon + lockIcon +
      '</span>' +
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

  // Phase 1 UI-4 — multi-select state on the layers panel side. The
  // canvas owns a SelectionState container of its own (per-canvas
  // registry from UI-2); we mirror its set here so click semantics
  // (Shift range, Cmd toggle) compose correctly without round-trips.
  var layersSelectedIds = new Set();
  var layersPrimaryId = null;

  function applyLayersSelectionToDom() {
    $$('[data-layer-node]').forEach(function(el) {
      var id = el.getAttribute('data-layer-node');
      el.classList.toggle('selected', layersSelectedIds.has(id));
      el.classList.toggle('primary', id === layersPrimaryId);
    });
  }

  // Replace single-id sync with multi-id sync. Listens for the same
  // event the rest of the UI uses; reads `selectedNodeIds` from the
  // detail when present, falls back to the legacy single-id path.
  //
  // Phase 1 UI-4 fix (2026-04-29) — bare `reframe:ui-state-changed`
  // events without `selectedNodeIds` detail are fired in several
  // unrelated places (010-core.js:60, 070-viewport.js:92,405). They
  // signify "something visual changed", NOT "selection changed".
  // Treating them as selection updates clobbered the multi-select Set
  // back to the single-id `state.selection.inode`, which broke
  // Cmd+click toggle-remove (the next click added an empty Set →
  // looked like replace). When the event has no selectedNodeIds
  // detail, just re-paint the existing state's classes — never reset
  // the Set from the legacy single-id path.
  function syncLayersFromCanvas(evt) {
    var detail = (evt && evt.detail) || {};
    var ids = Array.isArray(detail.selectedNodeIds) ? detail.selectedNodeIds : null;
    if (ids === null) {
      // Bare event — preserve current multi-state. If the Set is
      // empty (e.g. very first paint after reload), bootstrap from
      // the legacy single-id so the row that was selected pre-reload
      // re-highlights.
      if (layersSelectedIds.size === 0) {
        var single = state && state.selection && state.selection.inode;
        if (single) {
          layersSelectedIds = new Set([single]);
          layersPrimaryId = single;
        }
      }
      applyLayersSelectionToDom();
      return;
    }
    // Phase 1 UI-2 fix (2026-04-29) — canvas iframe's own onSelect
    // echoes back a SINGLE id (it picks ids[0] as primary, not the
    // layers panel's last-clicked primary). When the incoming ids
    // are a single value that's already a member of our multi-set,
    // it's the canvas echoing one of its current selections — not
    // the user collapsing to single. Preserve the multi-set; the
    // overlay-sync side only needed the primary, which propagates
    // separately. Edge: a real user click on a single already-
    // selected node WILL also hit this branch, but the layers click
    // handler already updated state authoritatively before this
    // event fires, so the no-op is correct in that case too.
    if (
      ids.length === 1
      && layersSelectedIds.size > 1
      && layersSelectedIds.has(ids[0])
    ) {
      applyLayersSelectionToDom();
      return;
    }
    layersSelectedIds = new Set(ids);
    layersPrimaryId = ids.length > 0 ? ids[ids.length - 1] : null;
    applyLayersSelectionToDom();
  }
  if (!window.__reframeLayersMultiBound) {
    window.__reframeLayersMultiBound = true;
    window.addEventListener('reframe:ui-state-changed', syncLayersFromCanvas);
  }

  function flattenVisibleRows() {
    return $$('[data-layer-node]').filter(function(el) {
      // Walk up parents — if any ancestor layer-children container is
      // collapsed, the row is hidden. Filter elements default to
      // visible (display !== 'none').
      var p = el.parentElement;
      while (p) {
        if (p.classList && p.classList.contains('layer-children') && p.classList.contains('collapsed')) return false;
        if (p.classList && p.classList.contains('layers-tree')) break;
        p = p.parentElement;
      }
      return el.style.display !== 'none';
    });
  }

  function dispatchLayersSelection() {
    var ids = Array.from(layersSelectedIds);
    state.selection.inode = layersPrimaryId;
    state.selection.tag = '';
    try { persistUiState(); } catch (_) {}
    // Dispatch the same shape canvas-select uses — multi-select
    // consumers (inspector showPropsForNodes) listen here.
    window.dispatchEvent(new CustomEvent('reframe:ui-state-changed', {
      detail: { selectedNodeIds: ids },
    }));
    window.dispatchEvent(new CustomEvent('reframe:canvas-select', {
      detail: { nodeId: layersPrimaryId, nodeIds: ids, multi: ids.length > 1 },
    }));
  }

  async function postNodeEdit(sessionId, nodeId, propsPatch) {
    try {
      await fetch('/platform/api/node/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneId: sessionId, nodeId: nodeId, props: propsPatch }),
      });
    } catch (_) { /* best-effort */ }
  }

  async function postNodeReorder(sessionId, nodeId, targetId, position) {
    try {
      var res = await fetch('/platform/api/node/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneId: sessionId, nodeId: nodeId, targetId: targetId, position: position }),
      });
      if (!res.ok) {
        // Visual reject — shake animation on the source row.
        var src = $('[data-layer-node="' + (CSS.escape ? CSS.escape(nodeId) : nodeId) + '"]');
        if (src) {
          src.classList.add('layer-shake');
          setTimeout(function() { src.classList.remove('layer-shake'); }, 500);
        }
      }
    } catch (_) {}
  }

  function bindLayerClicks(sessionId) {
    // Highlight current selection right after the list re-renders
    // (the innerHTML swap wipes the .selected class).
    syncLayersFromCanvas();
    bindLayersFilter();
    bindLayersKeyboardNav(sessionId);
    bindLayersDragReorder(sessionId);

    $$('[data-layer-node]').forEach(function(el) {
      var nodeId = el.getAttribute('data-layer-node');

      // Phase 1 UI-4 — visibility toggle. Click on 👁/⊘ icon.
      el.querySelectorAll('.layer-vis').forEach(function(icon) {
        icon.addEventListener('click', async function(e) {
          e.stopPropagation();
          var isVis = el.getAttribute('data-layer-visible') === '1';
          await postNodeEdit(sessionId, nodeId, { visible: !isVis });
          // Optimistic UI: refresh after server replies via SSE.
        });
      });

      // Lock toggle. Click on 🔒/🔓 icon.
      el.querySelectorAll('.layer-lock').forEach(function(icon) {
        icon.addEventListener('click', async function(e) {
          e.stopPropagation();
          var isLocked = el.getAttribute('data-layer-locked') === '1';
          await postNodeEdit(sessionId, nodeId, { locked: !isLocked });
        });
      });

      // Inline rename — double-click name swaps the span for an input.
      var nameSpan = el.querySelector('[data-layer-rename]');
      if (nameSpan) {
        nameSpan.addEventListener('dblclick', function(e) {
          e.stopPropagation();
          var prev = nameSpan.textContent;
          var input = document.createElement('input');
          input.type = 'text';
          input.value = el.getAttribute('data-layer-name') || prev;
          input.style.cssText = 'width:80%;font-size:11px;padding:1px 4px;background:var(--surface,#0e0e0e);border:1px solid var(--accent,#2b74ff);border-radius:2px;color:var(--text-primary,#e5e5e5)';
          nameSpan.replaceWith(input);
          input.focus();
          input.select();
          var commit = async function(save) {
            var newName = (input.value || '').trim();
            var span = document.createElement('span');
            span.className = 'layer-name';
            span.setAttribute('data-layer-rename', '');
            if (save && newName !== '') {
              span.textContent = newName;
              el.setAttribute('data-layer-name', newName);
              await postNodeEdit(sessionId, nodeId, { name: newName });
            } else {
              span.textContent = prev;
            }
            input.replaceWith(span);
            // Re-bind dblclick for the new span.
            bindLayerClicks(sessionId);
          };
          input.addEventListener('keydown', function(ev) {
            if (ev.key === 'Enter') { ev.preventDefault(); commit(true); }
            if (ev.key === 'Escape') { ev.preventDefault(); commit(false); }
          });
          input.addEventListener('blur', function() { commit(true); });
        });
      }

      el.addEventListener('click', function(e) {
        // Toggle expand/collapse on chevron click — don't select.
        if (e.target && e.target.classList && e.target.classList.contains('layer-toggle')) {
          var group = el.nextElementSibling;
          if (group && group.hasAttribute('data-layer-group')) {
            group.classList.toggle('collapsed');
            e.target.textContent = group.classList.contains('collapsed') ? '▸' : '▾';
          }
          return;
        }
        // Click on an icon inside the row — already handled above.
        if (e.target && (e.target.classList.contains('layer-vis') || e.target.classList.contains('layer-lock'))) return;
        if (!nodeId) return;

        // Phase 1 UI-6a Pin #1 — single-source-of-truth selection.
        //
        // Compute the desired final selection from the current cache
        // (layersSelectedIds is now a passive mirror updated via the
        // canvas-select echo, not authoritative state). Then push the
        // new ids through canvas.setSelection — canvas owns the state,
        // dispatches the canonical event, layers DOM repaints via the
        // echo path. Without this routing, layers click would mutate
        // its mirror only and canvas selState would drift; subsequent
        // canvas Cmd+click toggles would operate on stale state.
        //
        // Order matters: canvas's setSelection sets primaryId =
        // ids[ids.length - 1]. Place the click target last so primary
        // tracks the user's intent (Figma muscle memory).
        var prevSet = new Set(layersSelectedIds);
        var prevPrimary = layersPrimaryId;
        var nextIds;

        if (e.shiftKey && prevPrimary && prevPrimary !== nodeId) {
          var visible = flattenVisibleRows();
          var ids = visible.map(function(x) { return x.getAttribute('data-layer-node'); });
          var fromIdx = ids.indexOf(prevPrimary);
          var toIdx = ids.indexOf(nodeId);
          if (fromIdx >= 0 && toIdx >= 0) {
            var lo = Math.min(fromIdx, toIdx);
            var hi = Math.max(fromIdx, toIdx);
            // Union prev set with range; ensure clicked nodeId ends
            // up last so it becomes the new primary.
            var union = new Set(prevSet);
            for (var i = lo; i <= hi; i++) union.add(ids[i]);
            union.delete(nodeId);
            nextIds = Array.from(union);
            nextIds.push(nodeId);
          } else {
            // One endpoint not in flattened-visible (e.g. inside a
            // collapsed group). Fall back to plain replace — Figma does
            // the same when shift-anchor is unreachable.
            nextIds = [nodeId];
          }
        } else if (e.metaKey || e.ctrlKey) {
          if (prevSet.has(nodeId)) {
            // Toggle off. Preserve current primary unless it WAS the
            // node being removed; in that case promote any other
            // remaining id to primary by putting it last.
            var afterRemove = Array.from(prevSet).filter(function(x){ return x !== nodeId; });
            if (prevPrimary === nodeId) {
              nextIds = afterRemove; // last item becomes primary
            } else if (prevPrimary) {
              // Keep prevPrimary as primary by putting it last
              nextIds = afterRemove.filter(function(x){ return x !== prevPrimary; });
              nextIds.push(prevPrimary);
            } else {
              nextIds = afterRemove;
            }
          } else {
            // Toggle on — append clicked at end so it becomes primary
            nextIds = Array.from(prevSet).filter(function(x){ return x !== nodeId; });
            nextIds.push(nodeId);
          }
        } else {
          // Plain click — replace
          nextIds = [nodeId];
        }

        // Route through canvas if mounted; canvas's commitSelection
        // mutates selState + dispatches reframe:canvas-select +
        // reframe:ui-state-changed. syncLayersFromCanvas listener
        // (already wired) updates layersSelectedIds + repaints classes
        // including .primary (skill A.2 single source of truth).
        // Public handle exposes `select(ids)` (DOMCanvasHandle in
        // packages/editor/src/canvas-dom/registry.ts).
        var canvas = window.__reframeDOMCanvas;
        if (canvas && typeof canvas.select === 'function') {
          canvas.select(nextIds);
        } else {
          // Fallback for callers without a mounted canvas (dashboard,
          // tests). Mutate mirror locally + dispatch the same event
          // shape canvas would have.
          layersSelectedIds = new Set(nextIds);
          layersPrimaryId = nextIds.length > 0 ? nextIds[nextIds.length - 1] : null;
          applyLayersSelectionToDom();
          dispatchLayersSelection();
        }

        // Legacy single-select side effects (canvas overlay, props
        // panel, OP highlight) — only fire when it's the lone selected
        // node so multi-select doesn't double-paint.
        if (layersSelectedIds.size === 1) {
          var m = state.measurements.get(nodeId);
          if (m) {
            state.selection.bbox = m.bbox;
            state.selection.tag = m.tag || '';
            drawSelectOutline();
            if (state.editMode) showSelectionToolbar();
          }
          showPropsForNode(nodeId, sessionId);
          postToIframe({ type: 'reframe:highlight', inode: nodeId });
          if (document.getElementById('reframe-viewport')) {
            window.dispatchEvent(new CustomEvent('reframe:layer-select', { detail: { nodeId: nodeId } }));
          }
        } else if (typeof window.showPropsForNodes === 'function') {
          window.showPropsForNodes(Array.from(layersSelectedIds), sessionId);
        }
      });
    });
  }

  // Phase 1 UI-4 — name filter. Live-filters rows whose data-layer-name
  // (or rendered display text) includes the query, hiding non-matching.
  // Ancestors of matched rows stay visible to preserve tree context.
  function bindLayersFilter() {
    var input = $('[data-layers-filter]');
    if (!input) return;
    if (input.__rfBound) return;
    input.__rfBound = true;
    input.addEventListener('input', function() {
      var q = String(input.value || '').trim().toLowerCase();
      var rows = $$('[data-layer-node]');
      var groups = $$('[data-layer-group]');
      if (!q) {
        rows.forEach(function(el) { el.style.removeProperty('display'); });
        // Empty query — restore each group's prior collapse state. We
        // saved the state on the element when first un-collapsed below
        // (data-rfd-prev-collapsed). If absent, leave alone.
        groups.forEach(function(g) {
          var prev = g.getAttribute('data-rfd-prev-collapsed');
          if (prev !== null) {
            if (prev === '1') g.classList.add('collapsed');
            else g.classList.remove('collapsed');
            g.removeAttribute('data-rfd-prev-collapsed');
          }
        });
        return;
      }
      // Collect row ids that match by displayName / data-layer-name.
      var matching = new Set();
      rows.forEach(function(el) {
        var name = el.getAttribute('data-layer-name') || '';
        var displayed = (el.querySelector('.layer-name') || {}).textContent || '';
        if (name.toLowerCase().indexOf(q) >= 0 || displayed.toLowerCase().indexOf(q) >= 0) {
          matching.add(el.getAttribute('data-layer-node'));
        }
      });
      // Preserve ancestors. For each matched row, walk UP the DOM and
      // un-collapse every layer-children container along the way, so a
      // deep match becomes visually reachable. Save prior collapse state
      // so empty-query restore can flip back.
      rows.forEach(function(el) {
        var id = el.getAttribute('data-layer-node');
        var keep = matching.has(id);
        if (!keep) {
          var group = el.nextElementSibling;
          if (group && group.hasAttribute('data-layer-group')) {
            var deeperMatches = group.querySelectorAll('[data-layer-node]');
            for (var i = 0; i < deeperMatches.length; i++) {
              if (matching.has(deeperMatches[i].getAttribute('data-layer-node'))) { keep = true; break; }
            }
          }
        }
        el.style.display = keep ? '' : 'none';
        if (keep && matching.has(id)) {
          // This row matched — walk up and un-collapse every group
          // ancestor so it actually shows.
          var p = el.parentElement;
          while (p) {
            if (p.hasAttribute && p.hasAttribute('data-layer-group')) {
              if (!p.hasAttribute('data-rfd-prev-collapsed')) {
                p.setAttribute('data-rfd-prev-collapsed', p.classList.contains('collapsed') ? '1' : '0');
              }
              p.classList.remove('collapsed');
            }
            p = p.parentElement;
          }
        }
      });
    });
  }

  // Phase 1 UI-4 — drag-reorder + reparent. Uses HTML5 drag API for
  // built-in cursor + drop indicators; per-row dragover paints a thin
  // blue line at top/bottom for sibling drop, full outline for inside.
  function bindLayersDragReorder(sessionId) {
    var dragSrcId = null;
    $$('[data-layer-node]').forEach(function(el) {
      el.addEventListener('dragstart', function(e) {
        dragSrcId = el.getAttribute('data-layer-node');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          try { e.dataTransfer.setData('text/plain', dragSrcId); } catch (_) {}
        }
        el.classList.add('layer-dragging');
      });
      el.addEventListener('dragend', function() {
        el.classList.remove('layer-dragging');
        $$('[data-layer-node]').forEach(function(x) {
          x.classList.remove('layer-drop-before', 'layer-drop-after', 'layer-drop-inside');
        });
        dragSrcId = null;
      });
      el.addEventListener('dragover', function(e) {
        if (!dragSrcId) return;
        var targetId = el.getAttribute('data-layer-node');
        if (targetId === dragSrcId) return;
        // Self-descendant guard: prevent dropping a node onto its own
        // child (would fail server-side too, but UI shouldn't hint OK).
        var p = el;
        while (p) {
          if (p.getAttribute && p.getAttribute('data-layer-node') === dragSrcId) return;
          p = p.parentElement;
        }
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        var rect = el.getBoundingClientRect();
        var y = e.clientY - rect.top;
        var third = rect.height / 3;
        // Clear previous indicators.
        el.classList.remove('layer-drop-before', 'layer-drop-after', 'layer-drop-inside');
        if (y < third) el.classList.add('layer-drop-before');
        else if (y > rect.height - third) el.classList.add('layer-drop-after');
        else el.classList.add('layer-drop-inside');
      });
      el.addEventListener('dragleave', function() {
        el.classList.remove('layer-drop-before', 'layer-drop-after', 'layer-drop-inside');
      });
      el.addEventListener('drop', async function(e) {
        if (!dragSrcId) return;
        var targetId = el.getAttribute('data-layer-node');
        if (targetId === dragSrcId) return;
        e.preventDefault();
        var position = el.classList.contains('layer-drop-before') ? 'before'
          : el.classList.contains('layer-drop-inside') ? 'inside'
          : 'after';
        el.classList.remove('layer-drop-before', 'layer-drop-after', 'layer-drop-inside');
        await postNodeReorder(sessionId, dragSrcId, targetId, position);
        dragSrcId = null;
      });
    });
  }

  // Phase 1 UI-4 — keyboard nav inside the layers tree. Arrow up/down
  // walks visible rows; Space toggles visibility; Cmd+Shift+H/L
  // toggle visibility/lock; Enter enters rename mode.
  function bindLayersKeyboardNav(sessionId) {
    var tree = $('[data-layers-tree]');
    if (!tree || tree.__rfKbBound) return;
    tree.__rfKbBound = true;
    tree.addEventListener('keydown', function(e) {
      var rows = flattenVisibleRows();
      var ids = rows.map(function(x) { return x.getAttribute('data-layer-node'); });
      var idx = layersPrimaryId ? ids.indexOf(layersPrimaryId) : -1;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (rows.length === 0) return;
        var dir = e.key === 'ArrowDown' ? 1 : -1;
        var nextIdx = idx < 0 ? 0 : (idx + dir + ids.length) % ids.length;
        var nextId = ids[nextIdx];
        if (e.shiftKey && layersPrimaryId) {
          layersSelectedIds.add(nextId);
        } else {
          layersSelectedIds = new Set([nextId]);
        }
        layersPrimaryId = nextId;
        applyLayersSelectionToDom();
        dispatchLayersSelection();
        var primaryEl = $('[data-layer-node="' + (CSS.escape ? CSS.escape(nextId) : nextId) + '"]');
        if (primaryEl && primaryEl.scrollIntoView) primaryEl.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (e.key === ' ' && layersPrimaryId) {
        e.preventDefault();
        var elPrim = $('[data-layer-node="' + (CSS.escape ? CSS.escape(layersPrimaryId) : layersPrimaryId) + '"]');
        if (elPrim) {
          var isVis = elPrim.getAttribute('data-layer-visible') === '1';
          postNodeEdit(sessionId, layersPrimaryId, { visible: !isVis });
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
        if (e.key === 'L' || e.key === 'l') {
          e.preventDefault();
          if (layersPrimaryId) {
            var elL = $('[data-layer-node="' + (CSS.escape ? CSS.escape(layersPrimaryId) : layersPrimaryId) + '"]');
            if (elL) {
              var isLk = elL.getAttribute('data-layer-locked') === '1';
              postNodeEdit(sessionId, layersPrimaryId, { locked: !isLk });
            }
          }
        }
        if (e.key === 'H' || e.key === 'h') {
          e.preventDefault();
          if (layersPrimaryId) {
            var elH = $('[data-layer-node="' + (CSS.escape ? CSS.escape(layersPrimaryId) : layersPrimaryId) + '"]');
            if (elH) {
              var isVH = elH.getAttribute('data-layer-visible') === '1';
              postNodeEdit(sessionId, layersPrimaryId, { visible: !isVH });
            }
          }
        }
      }
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