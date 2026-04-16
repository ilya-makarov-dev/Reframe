  // ════════════════════════════════════════════════════════
  // Phase 8.9 — Rich pointer substrate for Lasso / Brush / Drag
  // ════════════════════════════════════════════════════════

  function bindGesturePointerSubstrate() {
    const svg = $('.viewport-frame .annotations');
    if (!svg) return;
    svg.addEventListener('pointerdown', onSubstrateDown);
    svg.addEventListener('pointermove', onSubstrateMove);
    svg.addEventListener('pointerup', onSubstrateUp);
    svg.addEventListener('pointercancel', onSubstrateUp);
  }

  function onSubstrateDown(e) {
    if (!state.editMode) return;
    var m = state.mode;
    // Canvas drag disabled — section reorder is handled via Sections panel.
    // Direct canvas manipulation (M key → drag) still available for advanced use.
    if (!m) return;
    if (m.kind === 'lasso' || m.kind === 'brush' || m.kind === 'drag-live') {
      e.preventDefault();
      const p = svgCoordsFromEvent(e);
      if (m.kind === 'lasso') {
        m.polygon = [[p.x, p.y]];
        m.active = true;
        drawLassoPath(m.polygon);
      } else if (m.kind === 'brush') {
        m.active = true;
        if (!m.anchors) m.anchors = new Set();
        const hit = hitTestInnermost(p.x, p.y);
        if (hit) m.anchors.add(hit);
        drawBrushHighlights(m);
        updateBanner();
      } else if (m.kind === 'drag-live') {
        m.origin = p;
        m.delta = { dx: 0, dy: 0 };
        m.active = true;
        drawDragGhost(m);
      }
      try { e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId); } catch (_) {}
    }
  }

  function onSubstrateMove(e) {
    const m = state.mode;
    if (!m || !m.active) return;
    const p = svgCoordsFromEvent(e);
    if (m.kind === 'lasso') {
      // Only append if pointer moved enough — avoids 1000-point polygons.
      const last = m.polygon[m.polygon.length - 1];
      const dx = p.x - last[0], dy = p.y - last[1];
      if (dx * dx + dy * dy > 64) {
        m.polygon.push([p.x, p.y]);
        drawLassoPath(m.polygon);
      }
    } else if (m.kind === 'brush') {
      const hit = hitTestInnermost(p.x, p.y);
      if (hit && !m.anchors.has(hit)) {
        m.anchors.add(hit);
        drawBrushHighlights(m);
        updateBanner();
      }
    } else if (m.kind === 'drag-live') {
      m.delta = { dx: p.x - m.origin.x, dy: p.y - m.origin.y };
      drawDragGhost(m);
    }
  }

  async function onSubstrateUp(e) {
    const m = state.mode;
    if (!m || !m.active) return;
    if (m.kind === 'lasso') {
      clearLassoPath();
      // Auto-close + auto-commit at pointerup.
      await commitMode();
    } else if (m.kind === 'brush') {
      m.active = false;
      // Don't auto-commit brush — user may want multiple strokes before
      // Enter. Banner instructs "Enter to submit".
    } else if (m.kind === 'drag-live') {
      clearDragGhost();
      var dx = m.delta.dx;
      var dy = m.delta.dy;
      var source = m.source;
      var origBbox = m.origBbox || { x: 0, y: 0 };
      exitMode();
      // Only apply if actually moved (> 2px threshold)
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        var frame = $('.viewport-frame');
        var sessionId = frame ? frame.getAttribute('data-session') : null;
        if (sessionId) {
          try {
            // Move by updating x/y position
            var newX = Math.round(origBbox.x + dx);
            var newY = Math.round(origBbox.y + dy);
            await api('/platform/api/node/edit', {
              sceneId: sessionId,
              nodeId: source,
              props: { x: String(newX), y: String(newY) },
            });
            requestRemeasure();
          } catch (_) {
            flash('Move failed', 'error');
          }
        }
      }
    }
  }

  function drawLassoPath(polygon) {
    const svgGroup = $('.annotation-marks-svg');
    if (!svgGroup) return;
    // Strip any existing in-progress lasso preview before redrawing.
    const existing = svgGroup.querySelector('.lasso-preview');
    if (existing) existing.remove();
    if (polygon.length < 2) return;
    const d = polygon.map(function(p, i) { return (i === 0 ? 'M' : 'L') + p[0] + ',' + p[1]; }).join(' ');
    const preview = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    preview.setAttribute('class', 'lasso-preview');
    preview.setAttribute('d', d + ' Z');
    preview.setAttribute('fill', 'none');
    svgGroup.appendChild(preview);
  }

  function clearLassoPath() {
    const svgGroup = $('.annotation-marks-svg');
    if (!svgGroup) return;
    const existing = svgGroup.querySelector('.lasso-preview');
    if (existing) existing.remove();
  }

  function drawBrushHighlights(mode) {
    const svgGroup = $('.annotation-marks-svg');
    if (!svgGroup) return;
    // Remove in-progress brush preview before redrawing.
    const existing = svgGroup.querySelectorAll('.brush-preview');
    existing.forEach(function(el) { el.remove(); });
    mode.anchors.forEach(function(inode) {
      const b = getBBox(inode);
      if (!b) return;
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('class', 'brush-preview');
      rect.setAttribute('x', b.x);
      rect.setAttribute('y', b.y);
      rect.setAttribute('width', b.w);
      rect.setAttribute('height', b.h);
      rect.setAttribute('rx', '2');
      svgGroup.appendChild(rect);
    });
  }

  function drawDragGhost(mode) {
    const svgGroup = $('.annotation-marks-svg');
    if (!svgGroup) return;
    const existing = svgGroup.querySelector('.drag-ghost');
    if (existing) existing.remove();
    const b = getBBox(mode.source);
    if (!b) return;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('class', 'drag-ghost');
    rect.setAttribute('x', b.x + mode.delta.dx);
    rect.setAttribute('y', b.y + mode.delta.dy);
    rect.setAttribute('width', b.w);
    rect.setAttribute('height', b.h);
    rect.setAttribute('rx', '2');
    svgGroup.appendChild(rect);
  }

  function clearDragGhost() {
    const svgGroup = $('.annotation-marks-svg');
    if (!svgGroup) return;
    const existing = svgGroup.querySelector('.drag-ghost');
    if (existing) existing.remove();
  }

  // ════════════════════════════════════════════════════════
  // Phase 8.10 — Resonance live matching
  // ════════════════════════════════════════════════════════

  function recomputeResonance() {
    const m = state.mode;
    if (!m || m.kind !== 'resonance') return;
    const seed = state.measurements.get(m.seed);
    if (!seed) { m.matches = []; return; }
    const axes = Array.from(m.axes || []);
    const matches = [];
    state.measurements.forEach(function(cand) {
      if (cand.inode === m.seed) return;
      if (matchesResonanceAxes(seed, cand, axes)) matches.push(cand.inode);
    });
    m.matches = matches;
    drawResonancePreview(seed, matches);
    updateResonancePanel();
  }

  function drawResonancePreview(seed, matches) {
    const svgGroup = $('.annotation-marks-svg');
    if (!svgGroup) return;
    svgGroup.querySelectorAll('.resonance-preview').forEach(function(el) { el.remove(); });
    // Seed outline
    const seedRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    seedRect.setAttribute('class', 'resonance-preview resonance-seed');
    seedRect.setAttribute('x', seed.bbox.x);
    seedRect.setAttribute('y', seed.bbox.y);
    seedRect.setAttribute('width', seed.bbox.w);
    seedRect.setAttribute('height', seed.bbox.h);
    seedRect.setAttribute('rx', '2');
    svgGroup.appendChild(seedRect);
    // Match tints
    for (let i = 0; i < matches.length; i++) {
      const m = state.measurements.get(matches[i]);
      if (!m) continue;
      const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      r.setAttribute('class', 'resonance-preview resonance-match');
      r.setAttribute('x', m.bbox.x);
      r.setAttribute('y', m.bbox.y);
      r.setAttribute('width', m.bbox.w);
      r.setAttribute('height', m.bbox.h);
      r.setAttribute('rx', '2');
      svgGroup.appendChild(r);
    }
  }

  function clearResonancePreview() {
    const svgGroup = $('.annotation-marks-svg');
    if (!svgGroup) return;
    svgGroup.querySelectorAll('.resonance-preview').forEach(function(el) { el.remove(); });
  }

  function showResonancePanel() {
    const frame = $('.viewport-frame');
    if (!frame) return;
    let panel = $('.resonance-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'resonance-panel';
      frame.appendChild(panel);
    }
    panel.classList.add('show');
    updateResonancePanel();
  }

  function updateResonancePanel() {
    const panel = $('.resonance-panel');
    const m = state.mode;
    if (!panel || !m || m.kind !== 'resonance') return;
    const axisList = ['tag', 'class', 'role', 'style', 'content', 'position'];
    const checkboxes = axisList.map(function(ax) {
      const on = m.axes.has(ax);
      return '<label class="ax-chip' + (on ? ' on' : '') + '">' +
        '<input type="checkbox" data-axis="' + ax + '"' + (on ? ' checked' : '') + '>' +
        ax + '</label>';
    }).join('');
    panel.innerHTML =
      '<div class="panel-head">Resonance<span class="count">' + (m.matches || []).length + ' matches</span></div>' +
      '<div class="axes">' + checkboxes + '</div>' +
      '<div class="panel-actions">' +
        '<button class="btn btn-primary btn-sm" data-reso-action="commit">Apply</button>' +
        '<button class="btn btn-ghost btn-sm" data-reso-action="cancel">Cancel</button>' +
      '</div>';
    panel.querySelectorAll('input[data-axis]').forEach(function(input) {
      input.addEventListener('change', function() {
        const ax = input.getAttribute('data-axis');
        if (input.checked) m.axes.add(ax); else m.axes.delete(ax);
        recomputeResonance();
      });
    });
    panel.querySelectorAll('button[data-reso-action]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const action = btn.getAttribute('data-reso-action');
        if (action === 'commit') { commitMode(); hideResonancePanel(); }
        else { exitMode('cancelled'); hideResonancePanel(); }
      });
    });
  }

  function hideResonancePanel() {
    const panel = $('.resonance-panel');
    if (panel) panel.remove();
    clearResonancePreview();
  }

  async function submitGesture(gesture) {
    try {
      const result = await api('/platform/api/gesture', { gesture: gesture });
      if (result && result.ok) {
        const parts = [gesture.kind];
        if (result.annotation) parts.push('annotation:' + result.annotation.kind);
        if (result.intent) parts.push('intent:queued');
        flash(parts.join(' → '), 'success');
        refreshStream();
      }
    } catch (_) {}
  }
