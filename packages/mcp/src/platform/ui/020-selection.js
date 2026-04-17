  // ── Selection handles (canvas-native, no toolbar) ────
  // 4 corner resize handles + padding zones on SVG overlay.
  // Right-click context menu for actions + AI verbs.

  function drawSelectionHandles() {
    var svg = $('.viewport-frame .annotations');
    if (!svg) return;
    var s = state.selection;
    if (!s.inode || !s.bbox) return;
    clearSelectionHandles();
    var b = s.bbox;
    var hs = 8;
    var corners = [
      { cls: 'nw', x: b.x - hs/2,       y: b.y - hs/2 },
      { cls: 'ne', x: b.x + b.w - hs/2, y: b.y - hs/2 },
      { cls: 'sw', x: b.x - hs/2,       y: b.y + b.h - hs/2 },
      { cls: 'se', x: b.x + b.w - hs/2, y: b.y + b.h - hs/2 },
    ];
    var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'selection-handles');
    for (var i = 0; i < corners.length; i++) {
      var c = corners[i];
      var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('class', 'resize-handle ' + c.cls);
      rect.setAttribute('x', String(c.x));
      rect.setAttribute('y', String(c.y));
      rect.setAttribute('width', String(hs));
      rect.setAttribute('height', String(hs));
      rect.setAttribute('rx', '1');
      g.appendChild(rect);
    }
    svg.appendChild(g);

    // AI trigger — small clickable icon below the SE corner handle.
    // Shows "✦" that opens the AI verb picker on click. This is the
    // ONE discoverable entry point for AI verbs on the canvas (the
    // other is right-click context menu).
    var htmlLayer = $('.annotation-marks-html');
    if (htmlLayer) {
      // Remove old trigger.
      var old = htmlLayer.querySelector('.ai-trigger');
      if (old) old.remove();
      // Position in screen coords below SE corner.
      var scr = bboxToScreen(b);
      var trigger = document.createElement('div');
      trigger.className = 'ai-trigger';
      trigger.innerHTML = '✦';
      trigger.title = 'AI tools (right-click for more)';
      trigger.style.left = (scr.left + scr.width - 4) + 'px';
      trigger.style.top = (scr.top + scr.height + 6) + 'px';
      trigger.addEventListener('click', function(e) {
        e.stopPropagation();
        showAiVerbPicker(trigger);
      });
      htmlLayer.appendChild(trigger);
    }
  }

  function showAiVerbPicker(anchorEl) {
    // Remove existing.
    var old = $('.ai-verb-panel');
    if (old) old.remove();
    var panel = document.createElement('div');
    panel.className = 'ai-verb-panel';
    panel.innerHTML =
      '<button class="avp-item" data-verb="ask">✦ Ask</button>' +
      '<button class="avp-item" data-verb="echo">✦ Echo</button>' +
      '<button class="avp-item" data-verb="pin">✦ Pin</button>' +
      '<button class="avp-item" data-verb="rule">✦ Rule</button>' +
      '<button class="avp-item" data-verb="brush">✦ Brush</button>';
    // Position below the trigger.
    var rect = anchorEl.getBoundingClientRect();
    panel.style.position = 'fixed';
    panel.style.left = rect.left + 'px';
    panel.style.top = (rect.bottom + 4) + 'px';
    document.body.appendChild(panel);
    // Bind.
    panel.querySelectorAll('[data-verb]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        panel.remove();
        handleVerb(btn.getAttribute('data-verb'));
      });
    });
    // Close on outside click.
    setTimeout(function() {
      document.addEventListener('click', function closePanel() {
        panel.remove();
        document.removeEventListener('click', closePanel);
      });
    }, 10);
  }

  function clearSelectionHandles() {
    var svg = $('.viewport-frame .annotations');
    if (svg) {
      var existing = svg.querySelector('.selection-handles');
      if (existing) existing.remove();
    }
    // Also remove the AI trigger icon.
    var htmlLayer = $('.annotation-marks-html');
    if (htmlLayer) {
      var trigger = htmlLayer.querySelector('.ai-trigger');
      if (trigger) trigger.remove();
    }
    // And any open verb picker.
    var picker = $('.ai-verb-panel');
    if (picker) picker.remove();
  }

  // ── Right-click context menu ────────────────────────
  // bindContextMenu + showContextMenu moved to 045-context-menu.js
  // (full sectioned catalog — Generate / Modify / Preview / Export,
  // plus the node-specific actions below when a selection exists).
  // closeContextMenu + handleContextAction stay here as shared utils.

  function closeContextMenu() {
    var existing = $('.context-menu');
    if (existing) existing.remove();
  }

  async function handleContextAction(action) {
    var frame = $('.viewport-frame');
    var sessionId = frame ? frame.getAttribute('data-session') : null;
    var nodeId = state.selection.inode;
    if (!sessionId || !nodeId) return;

    switch (action) {
      case 'ask':     handleVerb('ask'); break;
      case 'echo':    handleVerb('echo'); break;
      case 'pin':     handleVerb('pin'); break;
      case 'rule':    handleVerb('rule'); break;
      case 'brush':   handleVerb('brush'); break;
      case 'duplicate': {
        try {
          var res = await api('/platform/api/node/duplicate', { sceneId: sessionId, nodeId: nodeId });
          if (res.ok) {
            flash('Duplicated', 'success');
            refreshLayersTree();
          }
        } catch (_) {}
        break;
      }
      case 'delete': {
        try {
          await api('/platform/api/node/delete', { sceneId: sessionId, nodeId: nodeId });
          flash('Deleted', 'success');
          clearSelection();
          refreshLayersTree();
        } catch (_) {}
        break;
      }
      case 'wrap': {
        try {
          var res = await api('/platform/api/node/wrap', { sceneId: sessionId, nodeId: nodeId });
          if (res.ok) {
            flash('Wrapped in container', 'success');
            refreshLayersTree();
          }
        } catch (_) {}
        break;
      }
      case 'extract': {
        flash('Extract component: use reframe_project extract_component via AI');
        break;
      }
      case 'add-frame': {
        try {
          var res = await api('/platform/api/node/add', { sceneId: sessionId, parentId: nodeId, type: 'FRAME', name: 'Frame' });
          if (res.ok) { flash('Frame added', 'success'); refreshLayersTree(); }
        } catch (_) {}
        break;
      }
      case 'add-text': {
        try {
          var res = await api('/platform/api/node/add', { sceneId: sessionId, parentId: nodeId, type: 'TEXT', name: 'Text' });
          if (res.ok) { flash('Text added', 'success'); refreshLayersTree(); }
        } catch (_) {}
        break;
      }
    }
  }

  function repositionChipBar() {
    const bar = $('.verb-chip-bar');
    const frame = $('.viewport-frame');
    if (!bar || !frame || !state.selection.bbox) return;
    // Convert iframe-doc coords → screen space within the frame.
    // The iframe is scaled by the ratio of frame size / iframe-doc size.
    const dims = VIEWPORT_DIMS[state.currentViewport];
    const scaleX = frame.clientWidth / dims.w;
    const scaleY = frame.clientHeight / dims.h;
    const b = state.selection.bbox;
    const top = b.y * scaleY + b.h * scaleY + 8;  // below the node
    const left = b.x * scaleX;
    // Clamp within frame so chip bar doesn't escape the viewport.
    const barW = bar.offsetWidth || 240;
    const maxLeft = frame.clientWidth - barW - 8;
    bar.style.top = top + 'px';
    bar.style.left = Math.max(8, Math.min(left, maxLeft)) + 'px';
    // If the chip bar would go below the frame, flip it above the node.
    if (top + bar.offsetHeight > frame.clientHeight) {
      const above = b.y * scaleY - bar.offsetHeight - 8;
      bar.style.top = Math.max(8, above) + 'px';
    }
  }

  // ── Verb handlers ─────────────────────────────────────
  async function handleVerb(verb) {
    if (!state.selection.inode) return;
    switch (verb) {
      case 'ask':       return handleAsk();
      case 'rule':      return handleRule();
      case 'echo':      return enterMode({ kind: 'echo', source: null });
      case 'drag':      return enterMode({ kind: 'drag-live', source: state.selection.inode, origin: null, delta: { dx: 0, dy: 0 }, active: false });
      case 'pin':       return handlePin();
      case 'lasso':     return enterMode({ kind: 'lasso', polygon: [], active: false });
      case 'brush':     return handleBrushEnter();
      case 'resonance': return handleResonanceEnter();
      case 'time':      return handleTime();
      default: flash('Verb "' + verb + '" not wired yet', 'error');
    }
  }
