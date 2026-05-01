  // ════════════════════════════════════════════════════════
  // Phase 8.7+ — Persistent annotation rendering
  // ════════════════════════════════════════════════════════

  // ── Geometry helpers (mirror of packages/core/src/gestures/geometry.ts) ──
  function pointInPolygon(x, y, polygon) {
    if (!polygon || polygon.length < 3) return false;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0], yi = polygon[i][1];
      const xj = polygon[j][0], yj = polygon[j][1];
      const intersect = ((yi > y) !== (yj > y)) &&
        (x < ((xj - xi) * (y - yi)) / ((yj - yi) + 1e-9) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function bboxCenterInPolygon(bbox, polygon) {
    return pointInPolygon(bbox.x + bbox.w / 2, bbox.y + bbox.h / 2, polygon);
  }

  function pointInBBox(x, y, b) {
    return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
  }

  function hitTestInnermost(x, y) {
    let best = null;
    let bestArea = Infinity;
    state.measurements.forEach(function(m) {
      const b = m.bbox;
      if (!pointInBBox(x, y, b)) return;
      const area = b.w * b.h;
      if (area > 0 && area < bestArea) { best = m.inode; bestArea = area; }
    });
    return best;
  }

  function lassoContainedAnchors(polygon) {
    const out = [];
    state.measurements.forEach(function(m) {
      if (bboxCenterInPolygon(m.bbox, polygon)) out.push(m.inode);
    });
    return out;
  }

  function matchesResonanceAxes(seed, cand, axes) {
    for (let i = 0; i < axes.length; i++) {
      const ax = axes[i];
      if (ax === 'tag' && seed.tag !== cand.tag) return false;
      if (ax === 'class' && (seed.className || '') !== (cand.className || '')) return false;
      if (ax === 'role' && (seed.role || '') !== (cand.role || '')) return false;
      if (ax === 'style') {
        const s = seed.style || {}, c = cand.style || {};
        if (s.bg !== c.bg || s.fs !== c.fs || s.fw !== c.fw) return false;
      }
      if (ax === 'content' && (seed.text || '') !== (cand.text || '')) return false;
      if (ax === 'position') {
        const s = seed.style || {}, c = cand.style || {};
        if (s.display !== c.display) return false;
        const ws = seed.bbox.w, wc = cand.bbox.w;
        if (ws === 0 || wc === 0) { if (ws !== wc) return false; }
        else {
          const ratio = Math.abs(ws - wc) / Math.max(ws, wc);
          if (ratio > 0.05) return false;
        }
      }
    }
    return true;
  }

  // Screen-space coordinate conversion: iframe-doc units → frame pixels.
  function bboxToScreen(bbox) {
    const dims = VIEWPORT_DIMS[state.currentViewport];
    const frame = $('.viewport-frame');
    if (!frame) return { left: 0, top: 0, width: 0, height: 0 };
    const sx = frame.clientWidth / dims.w;
    const sy = frame.clientHeight / dims.h;
    return {
      left: bbox.x * sx,
      top: bbox.y * sy,
      width: bbox.w * sx,
      height: bbox.h * sy,
    };
  }

  // Convert pointer event to iframe-doc coords over the SVG overlay.
  function svgCoordsFromEvent(e) {
    const svg = $('.viewport-frame .annotations');
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const dims = VIEWPORT_DIMS[state.currentViewport];
    return {
      x: ((e.clientX - rect.left) / rect.width) * dims.w,
      y: ((e.clientY - rect.top) / rect.height) * dims.h,
    };
  }

  // ── Annotation fetch ──────────────────────────────────
  async function refreshAnnotations() {
    if (!state.currentSceneSlug) return;
    // Boot payload keys scenes by id, not slug, so we read through the
    // active scene of the payload (it maps 1:1 to the first canvas).
    var boot = window.__REFRAME_BOOT__;
    var cached = (boot && boot.activeSceneId)
      ? consumeBootSection(boot.activeSceneId, 'annotations')
      : null;
    if (cached) {
      state.annotations = cached;
      renderAllAnnotations();
      return;
    }
    try {
      const res = await api('/platform/api/annotations/list?status=active&sceneSlug=' +
        encodeURIComponent(state.currentSceneSlug));
      state.annotations = res.annotations || [];
      renderAllAnnotations();
    } catch (_) {}
  }

  // ── Renderer entry point — dispatches per kind ──────
  function renderAllAnnotations() {
    const svgGroup = $('.annotation-marks-svg');
    const htmlLayer = $('.annotation-marks-html');
    if (!svgGroup && !htmlLayer) return;
    const svgParts = [];
    const htmlParts = [];
    for (let i = 0; i < state.annotations.length; i++) {
      const ann = state.annotations[i];
      const p = ann.payload;
      if (!p) continue;
      switch (p.kind) {
        case 'comment':           renderCommentMark(ann, svgParts, htmlParts); break;
        case 'pin':               renderPinMark(ann, svgParts, htmlParts); break;
        case 'rule':              renderRuleMark(ann, svgParts, htmlParts); break;
        case 'echo-arrow':        renderEchoArrow(ann, svgParts, htmlParts); break;
        case 'region':            renderRegionMark(ann, svgParts, htmlParts); break;
        case 'brush-stroke':      renderBrushStrokeMark(ann, svgParts, htmlParts); break;
        case 'reference':         renderReferenceMark(ann, svgParts, htmlParts); break;
        case 'resonance-overlay': renderResonanceOverlayMark(ann, svgParts, htmlParts); break;
        case 'ghost-proposal':    renderGhostProposal(ann, svgParts, htmlParts); break;
        case 'free-vector':       renderFreeVectorMark(ann, svgParts, htmlParts); break;
      }
    }
    if (svgGroup) svgGroup.innerHTML = svgParts.join('');
    if (htmlLayer) {
      htmlLayer.innerHTML = htmlParts.join('');
      bindMarkInteractions();
    }
  }

  function getBBox(inode) {
    const m = state.measurements.get(inode);
    return m ? m.bbox : null;
  }

  // ── Per-kind renderers ────────────────────────────────
  // Build the meta line shown inside any tooltip: author + relative time.
  function tooltipMeta(ann) {
    const authorKind = (ann.author && ann.author.kind) || 'human';
    const authorName = (ann.author && ann.author.id) || authorKind;
    const rel = formatRelativeTime(ann.createdAt);
    return '<span class="tip-meta">' + escape(authorName) + ' · ' + escape(rel) + '</span>';
  }

  // Normalized author class for mark styling (ring color, hue tint).
  function authorClass(ann) {
    const kind = (ann.author && ann.author.kind) || 'human';
    return 'author-' + kind;
  }

  function renderCommentMark(ann, svgOut, htmlOut) {
    const bbox = getBBox(ann.anchor);
    if (!bbox) return;
    const scr = bboxToScreen(bbox);
    const left = scr.left + scr.width - 6;
    const top = scr.top - 6;
    const text = escape((ann.payload.text || '').slice(0, 120));
    htmlOut.push(
      '<div class="mark mark-comment ' + authorClass(ann) + '" data-ann="' + escape(ann.id) + '" tabindex="0" style="left:' + left + 'px;top:' + top + 'px">' +
        '<div class="mark-dot comment"></div>' +
        '<div class="mark-tooltip">' + text + tooltipMeta(ann) + '</div>' +
      '</div>'
    );
  }

  function renderPinMark(ann, svgOut, htmlOut) {
    const bbox = getBBox(ann.anchor);
    if (!bbox) return;
    const scr = bboxToScreen(bbox);
    const style = ann.payload.style || 'default';
    const left = scr.left + scr.width - 6;
    const top = scr.top - 6;
    const note = escape((ann.payload.note || 'pin').slice(0, 120));
    htmlOut.push(
      '<div class="mark mark-pin mark-style-' + escape(style) + ' ' + authorClass(ann) + '" data-ann="' + escape(ann.id) + '" tabindex="0" style="left:' + left + 'px;top:' + top + 'px">' +
        '<div class="mark-diamond"></div>' +
        '<div class="mark-tooltip">' + note + tooltipMeta(ann) + '</div>' +
      '</div>'
    );
  }

  function renderRuleMark(ann, svgOut, htmlOut) {
    const bbox = getBBox(ann.anchor);
    if (!bbox) return;
    const scr = bboxToScreen(bbox);
    const enforced = !!ann.payload.enforced;
    const rule = escape(ann.payload.rule || '');
    const value = ann.payload.value !== undefined ? ' = ' + escape(String(ann.payload.value)) : '';
    const left = scr.left + 4;
    const top = scr.top - 10;
    htmlOut.push(
      '<div class="mark mark-rule ' + (enforced ? 'enforced' : 'oneshot') + ' ' + authorClass(ann) + '" data-ann="' + escape(ann.id) + '" tabindex="0" style="left:' + left + 'px;top:' + top + 'px">' +
        '<div class="mark-shield">§</div>' +
        '<div class="mark-tooltip">' + rule + value + (enforced ? ' · enforced' : '') + tooltipMeta(ann) + '</div>' +
      '</div>'
    );
  }

  function renderEchoArrow(ann, svgOut, htmlOut) {
    const from = getBBox(ann.payload.fromAnchor);
    const to = getBBox(ann.payload.toAnchor);
    if (!from || !to) return;
    const x1 = from.x + from.w / 2;
    const y1 = from.y + from.h / 2;
    const x2 = to.x + to.w / 2;
    const y2 = to.y + to.h / 2;
    // Quadratic curve for a bit of arc — more legible than a straight line.
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2 - 40;
    svgOut.push(
      '<g class="mark-echo" data-ann="' + escape(ann.id) + '">' +
        '<path d="M' + x1 + ',' + y1 + ' Q' + mx + ',' + my + ' ' + x2 + ',' + y2 + '" fill="none" />' +
        '<circle cx="' + x2 + '" cy="' + y2 + '" r="6" />' +
      '</g>'
    );
    const scr = bboxToScreen({ x: mx - 30, y: my - 8, w: 60, h: 16 });
    htmlOut.push(
      '<div class="mark mark-echo-label" data-ann="' + escape(ann.id) + '" style="left:' + scr.left + 'px;top:' + scr.top + 'px">' +
        'Echo · ' + escape(ann.payload.axis || '') +
      '</div>'
    );
  }

  function renderRegionMark(ann, svgOut, htmlOut) {
    const points = ann.payload.points || [];
    if (points.length < 3) return;
    const pointsStr = points.map(function(p) { return p[0] + ',' + p[1]; }).join(' ');
    svgOut.push(
      '<polygon class="mark-region" data-ann="' + escape(ann.id) + '" points="' + pointsStr + '" />'
    );
  }

  function renderBrushStrokeMark(ann, svgOut, htmlOut) {
    const anchors = ann.payload.anchors || [];
    if (anchors.length === 0) return;
    // Outline each hit node + connect centers with thin line.
    let outlines = '';
    let path = '';
    let first = true;
    for (let i = 0; i < anchors.length; i++) {
      const b = getBBox(anchors[i]);
      if (!b) continue;
      outlines += '<rect x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h + '" rx="2" />';
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      path += (first ? 'M' : 'L') + cx + ',' + cy + ' ';
      first = false;
    }
    svgOut.push(
      '<g class="mark-brush" data-ann="' + escape(ann.id) + '">' +
        outlines +
        (path ? '<path d="' + path + '" fill="none" />' : '') +
      '</g>'
    );
  }

  function renderReferenceMark(ann, svgOut, htmlOut) {
    const bbox = getBBox(ann.anchor);
    if (!bbox) return;
    const scr = bboxToScreen(bbox);
    const src = ann.payload.source || {};
    const type = src.type || '?';
    const summary = type === 'brand' ? src.brand
                  : type === 'url'   ? src.url
                  : type === 'image' ? (src.url || 'image')
                  : type === 'node'  ? (src.anchor || '').slice(-8)
                  : '';
    const left = scr.left + 2;
    const top = scr.top + 2;
    htmlOut.push(
      '<div class="mark mark-reference ' + authorClass(ann) + '" data-ann="' + escape(ann.id) + '" tabindex="0" style="left:' + left + 'px;top:' + top + 'px">' +
        '<div class="mark-ref-tag">' + escape(type) + '</div>' +
        '<div class="mark-tooltip">' + escape(String(summary)) + tooltipMeta(ann) + '</div>' +
      '</div>'
    );
  }

  function renderResonanceOverlayMark(ann, svgOut, htmlOut) {
    const matches = ann.payload.matches || [];
    for (let i = 0; i < matches.length; i++) {
      const b = getBBox(matches[i]);
      if (!b) continue;
      svgOut.push(
        '<rect class="mark-resonance-match" x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h + '" rx="2" />'
      );
    }
    const seed = getBBox(ann.payload.seed);
    if (seed) {
      svgOut.push(
        '<rect class="mark-resonance-seed" x="' + seed.x + '" y="' + seed.y + '" width="' + seed.w + '" height="' + seed.h + '" rx="2" />'
      );
    }
  }

  function renderGhostProposal(ann, svgOut, htmlOut) {
    const bbox = getBBox(ann.anchor);
    if (!bbox) return;
    const scr = bboxToScreen(bbox);
    const changes = ann.payload.changes || [];

    // SVG layer — the "ghost" breathing outline on the target + any
    // geometric diffs (move arrow, before/after rects, text strike-through).
    svgOut.push(
      '<rect class="mark-ghost" data-ann="' + escape(ann.id) + '" x="' + bbox.x + '" y="' + bbox.y + '" width="' + bbox.w + '" height="' + bbox.h + '" rx="3" />'
    );

    // Render each DiffChange on the SVG when it has a geometric dimension.
    for (let i = 0; i < changes.length; i++) {
      const c = changes[i];
      if (c.kind === 'move') {
        // Draw a dashed outline at the ORIGIN position + an arrow to the
        // TARGET position. The origin box uses the current bbox (the
        // node hasn't moved yet) and the target is origin + delta.
        const ox = bbox.x + (c.from.x - c.to.x);
        const oy = bbox.y + (c.from.y - c.to.y);
        svgOut.push(
          '<rect class="diff-origin" x="' + ox + '" y="' + oy + '" width="' + bbox.w + '" height="' + bbox.h + '" rx="3" />' +
          '<line class="diff-arrow" x1="' + (ox + bbox.w / 2) + '" y1="' + (oy + bbox.h / 2) + '" x2="' + (bbox.x + bbox.w / 2) + '" y2="' + (bbox.y + bbox.h / 2) + '" />'
        );
      } else if (c.kind === 'resize') {
        // Dashed outline at the OLD dimensions, centered on the same origin.
        svgOut.push(
          '<rect class="diff-origin" x="' + bbox.x + '" y="' + bbox.y + '" width="' + c.from.w + '" height="' + c.from.h + '" rx="3" />'
        );
      }
    }

    // HTML panel — floating Accept/Dismiss bar + typed diff chips.
    const left = scr.left + scr.width + 8;
    const top = scr.top;
    const summary = escape((ann.payload.summary || '').slice(0, 80));
    const intentId = escape(ann.payload.intentId || '');
    const chips = changes.length > 0 ? renderDiffChips(changes) : '';
    htmlOut.push(
      '<div class="mark mark-ghost-panel" data-ann="' + escape(ann.id) + '" data-intent="' + intentId + '" style="left:' + left + 'px;top:' + top + 'px">' +
        '<div class="ghost-summary">' + summary + '</div>' +
        chips +
        '<div class="ghost-actions">' +
          '<button class="btn btn-primary btn-sm" data-ghost-action="accept" data-ann="' + escape(ann.id) + '" data-intent="' + intentId + '">Accept</button>' +
          '<button class="btn btn-ghost btn-sm" data-ghost-action="dismiss" data-ann="' + escape(ann.id) + '">Dismiss</button>' +
        '</div>' +
      '</div>'
    );
  }

  // Render DiffChange[] as inline chips inside the ghost panel.
  function renderDiffChips(changes) {
    if (!changes || changes.length === 0) return '';
    const parts = [];
    for (let i = 0; i < changes.length; i++) {
      const c = changes[i];
      if (c.kind === 'color') {
        parts.push(
          '<div class="diff-chip diff-color">' +
            '<span class="diff-prop">' + escape(c.property || 'color') + '</span>' +
            '<span class="diff-swatch" style="background:' + escape(c.from) + '"></span>' +
            '<span class="diff-arrow-glyph">→</span>' +
            '<span class="diff-swatch" style="background:' + escape(c.to) + '"></span>' +
          '</div>'
        );
      } else if (c.kind === 'text') {
        parts.push(
          '<div class="diff-chip diff-text">' +
            '<span class="diff-from">' + escape(String(c.from || '').slice(0, 40)) + '</span>' +
            '<span class="diff-arrow-glyph">→</span>' +
            '<span class="diff-to">' + escape(String(c.to || '').slice(0, 40)) + '</span>' +
          '</div>'
        );
      } else if (c.kind === 'move') {
        const dx = Math.round(c.to.x - c.from.x);
        const dy = Math.round(c.to.y - c.from.y);
        parts.push(
          '<div class="diff-chip diff-move">' +
            '<span class="diff-prop">move</span>' +
            '<span class="diff-vector">' + (dx >= 0 ? '+' : '') + dx + ', ' + (dy >= 0 ? '+' : '') + dy + '</span>' +
          '</div>'
        );
      } else if (c.kind === 'resize') {
        parts.push(
          '<div class="diff-chip diff-resize">' +
            '<span class="diff-prop">resize</span>' +
            '<span class="diff-from">' + Math.round(c.from.w) + '×' + Math.round(c.from.h) + '</span>' +
            '<span class="diff-arrow-glyph">→</span>' +
            '<span class="diff-to">' + Math.round(c.to.w) + '×' + Math.round(c.to.h) + '</span>' +
          '</div>'
        );
      } else if (c.kind === 'style') {
        parts.push(
          '<div class="diff-chip diff-style">' +
            '<span class="diff-prop">' + escape(c.property) + '</span>' +
            '<span class="diff-from">' + escape(String(c.from).slice(0, 24)) + '</span>' +
            '<span class="diff-arrow-glyph">→</span>' +
            '<span class="diff-to">' + escape(String(c.to).slice(0, 24)) + '</span>' +
          '</div>'
        );
      } else if (c.kind === 'replace') {
        parts.push('<div class="diff-chip diff-replace">' + escape(c.summary) + '</div>');
      } else {
        parts.push('<div class="diff-chip diff-unknown">' + escape(c.kind || '?') + '</div>');
      }
    }
    return '<div class="diff-chips">' + parts.join('') + '</div>';
  }

  // Convert an array of {x,y} points into an SVG path `d` attribute.
  // Plain mode: `M x0,y0 L x1,y1 ...`.
  // Smooth mode: Catmull-Rom interpolation emitted as cubic-bezier `C` segments
  //   so the generated path is rendered smoothly by every SVG implementation
  //   without depending on a non-standard interpolator. Tension = 0.5.
  function pointsToPath(points, smooth) {
    if (!points || points.length === 0) return '';
    if (points.length === 1) {
      return 'M' + points[0].x + ',' + points[0].y;
    }
    if (!smooth || points.length < 3) {
      var d = 'M' + points[0].x + ',' + points[0].y;
      for (var i = 1; i < points.length; i++) {
        d += ' L' + points[i].x + ',' + points[i].y;
      }
      return d;
    }
    var out = 'M' + points[0].x + ',' + points[0].y;
    for (var j = 0; j < points.length - 1; j++) {
      var p0 = points[j === 0 ? 0 : j - 1];
      var p1 = points[j];
      var p2 = points[j + 1];
      var p3 = points[j + 2 < points.length ? j + 2 : points.length - 1];
      var cp1x = p1.x + (p2.x - p0.x) / 6;
      var cp1y = p1.y + (p2.y - p0.y) / 6;
      var cp2x = p2.x - (p3.x - p1.x) / 6;
      var cp2y = p2.y - (p3.y - p1.y) / 6;
      out += ' C' + cp1x + ',' + cp1y + ' ' + cp2x + ',' + cp2y + ' ' + p2.x + ',' + p2.y;
    }
    return out;
  }

  function renderFreeVectorMark(ann, svgOut, htmlOut) {
    var p = ann.payload;
    var points = p.points || [];
    if (points.length === 0) return;
    var d = pointsToPath(points, !!p.smooth);
    var stroke = String(p.stroke || '#2b74ff');
    var width = Number(p.width != null ? p.width : 2);
    var opacity = Number(p.opacity != null ? p.opacity : 1);
    svgOut.push(
      '<path class="mark-free-vector" data-ann="' + escape(ann.id) + '" d="' + d + '" ' +
        'stroke="' + escape(stroke) + '" stroke-width="' + width + '" stroke-opacity="' + opacity + '" ' +
        'fill="none" stroke-linecap="round" stroke-linejoin="round" />'
    );
  }

  // Free-vector eraser — hover any pen stroke (when Pen mode is NOT active)
  // to highlight + reveal a delete pill. Click pill or press Delete on a
  // highlighted stroke to dismiss the annotation. Esc clears the highlight.
  // Implicit eraser, no separate tool mode.
  var _eraserSelectedId = null;

  function bindFreeVectorEraser() {
    var svg = $('.annotation-marks-svg');
    if (!svg) return;
    var paths = svg.querySelectorAll('path.mark-free-vector[data-ann]');
    paths.forEach(function(path) {
      path.addEventListener('mouseenter', function() {
        if (state.mode && state.mode.kind === 'pen') return;
        path.classList.add('hover');
      });
      path.addEventListener('mouseleave', function() {
        path.classList.remove('hover');
      });
      path.addEventListener('click', function(e) {
        if (state.mode && state.mode.kind === 'pen') return;
        e.stopPropagation();
        var id = path.getAttribute('data-ann');
        if (!id) return;
        selectFreeVectorForErase(id);
      });
    });
  }

  function selectFreeVectorForErase(id) {
    _eraserSelectedId = id;
    var svg = $('.annotation-marks-svg');
    if (svg) {
      svg.querySelectorAll('path.mark-free-vector').forEach(function(p) {
        p.classList.toggle('eraser-selected', p.getAttribute('data-ann') === id);
      });
    }
    showEraserDeleteIcon(id);
  }

  function clearEraserSelection() {
    _eraserSelectedId = null;
    var svg = $('.annotation-marks-svg');
    if (svg) {
      svg.querySelectorAll('path.mark-free-vector').forEach(function(p) {
        p.classList.remove('eraser-selected');
      });
    }
    hideEraserDeleteIcon();
  }

  function showEraserDeleteIcon(id) {
    hideEraserDeleteIcon();
    var svg = $('.annotation-marks-svg');
    if (!svg) return;
    var path = svg.querySelector('path.mark-free-vector[data-ann="' + id + '"]');
    if (!path) return;
    var bb;
    try { bb = path.getBBox(); } catch (_) { return; }
    // Position at the path's first point in screen-space (need to convert
    // from iframe-doc coords to frame pixels).
    var scr = bboxToScreen({ x: bb.x + bb.width, y: bb.y, w: 0, h: 0 });
    var btn = document.createElement('button');
    btn.className = 'free-vector-erase-btn';
    btn.setAttribute('data-erase-ann', id);
    btn.setAttribute('title', 'Remove stroke (Delete)');
    btn.style.left = (scr.left + 4) + 'px';
    btn.style.top = (scr.top - 8) + 'px';
    btn.innerHTML = '×';
    var host = $('.annotation-marks-html');
    if (host) host.appendChild(btn);
    btn.addEventListener('click', async function(e) {
      e.stopPropagation();
      await eraseFreeVector(id);
    });
  }

  function hideEraserDeleteIcon() {
    var existing = document.querySelector('.free-vector-erase-btn');
    if (existing) existing.remove();
  }

  async function eraseFreeVector(id) {
    if (!id) return;
    try {
      await api('/platform/api/annotate-transition', {
        annotationId: id,
        toStatus: 'dismissed',
      });
      clearEraserSelection();
      flash('Stroke removed', 'success');
      refreshAnnotations();
    } catch (_) {}
  }

  // Wire global keyboard handlers for the eraser (Delete + Esc clear).
  // Bind once at module-level so it survives re-renders. Guard with the
  // private flag so it doesn't double-bind.
  if (typeof window !== 'undefined' && !window.__reframeFreeVectorEraserBound) {
    window.__reframeFreeVectorEraserBound = true;
    document.addEventListener('keydown', function(e) {
      if (!_eraserSelectedId) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        eraseFreeVector(_eraserSelectedId);
      } else if (e.key === 'Escape') {
        clearEraserSelection();
      }
    });
    document.addEventListener('click', function(e) {
      if (!_eraserSelectedId) return;
      if (e.target && (e.target.closest('.free-vector-erase-btn') ||
          e.target.closest('path.mark-free-vector'))) return;
      clearEraserSelection();
    });
  }

  function bindMarkInteractions() {
    bindFreeVectorEraser();
    // Click a mark → scroll the stream to its thread (via annotation id).
    $$('.annotation-marks-html .mark[data-ann]').forEach(function(el) {
      el.addEventListener('click', function(e) {
        if (e.target && e.target.tagName === 'BUTTON') return;
        const id = el.getAttribute('data-ann');
        if (!id) return;
        scrollStreamTo(id);
      });
    });
    // Ghost accept / dismiss buttons.
    $$('.mark-ghost-panel button[data-ghost-action]').forEach(function(btn) {
      btn.addEventListener('click', async function(e) {
        e.stopPropagation();
        const action = btn.getAttribute('data-ghost-action');
        const annId = btn.getAttribute('data-ann');
        const intentId = btn.getAttribute('data-intent');
        if (action === 'accept' && intentId) {
          try {
            await api('/platform/api/intent/accept', { intentId: intentId });
            await api('/platform/api/annotate-transition', { annotationId: annId, toStatus: 'dismissed' });
            flash('Proposal accepted', 'success');
            refreshStream();
            refreshAnnotations();
          } catch (_) {}
        } else if (action === 'dismiss' && annId) {
          try {
            await api('/platform/api/annotate-transition', { annotationId: annId, toStatus: 'dismissed' });
            refreshAnnotations();
          } catch (_) {}
        }
      });
    });
  }

  function scrollStreamTo(annId) {
    // Find the annotation, resolve its thread, open thread panel.
    const ann = state.annotations.find(function(a) { return a.id === annId; });
    if (!ann || !ann.threadId) { flash('No thread for this mark', 'error'); return; }
    openThreadPanel(ann.threadId);
  }

  // ════════════════════════════════════════════════════════
  // Thread detail panel
  // ════════════════════════════════════════════════════════

  // Phase 2 Brief 2c — public hook for designer-qa probe + future
  // toolbar entry points. Exposed under a debug namespace so internal
  // refactors don't accidentally rely on it.
  if (typeof window !== 'undefined') {
    window.__reframeDebug = window.__reframeDebug || {};
  }

  async function openThreadPanel(threadId) {
    try {
      const data = await api('/platform/api/threads/get?id=' + encodeURIComponent(threadId));
      if (!data.ok || !data.thread) { flash('Thread not found', 'error'); return; }
      renderThreadPanel(data);
      const panel = $('[data-thread-panel]');
      if (panel) panel.classList.remove('hidden');
      const stream = $('.stream');
      if (stream) stream.style.display = 'none';
    } catch (_) {}
  }

  function closeThreadPanel() {
    const panel = $('[data-thread-panel]');
    if (panel) panel.classList.add('hidden');
    const stream = $('.stream');
    if (stream) stream.style.display = '';
  }

  if (typeof window !== 'undefined') {
    window.__reframeDebug.openThreadPanel = openThreadPanel;
    window.__reframeDebug.closeThreadPanel = closeThreadPanel;
  }

  function renderThreadPanel(data) {
    const panel = $('[data-thread-panel]');
    if (!panel) return;
    const t = data.thread;
    const intents = data.intents || [];
    const annotations = data.annotations || [];

    // Title: prefer explicit thread title, then anchor, then thread id.
    const titleEl = panel.querySelector('[data-field="title"]');
    if (titleEl) titleEl.textContent = t.title || ('@' + (t.anchor || '')) || t.id;

    const metaEl = panel.querySelector('[data-field="meta"]');
    if (metaEl) {
      metaEl.innerHTML =
        '<span class="status-tag ' + escape(t.status) + '">' + escape(t.status.toUpperCase()) + '</span>' +
        escape(t.anchor || '') +
        (t.sceneSlug ? ' · ' + escape(t.sceneSlug) : '') +
        ' · ' + escape(formatRelativeTime(t.updatedAt));
    }

    // Merge intents + annotations into a single chronological event list.
    const events = [];
    for (let i = 0; i < intents.length; i++) {
      const it = intents[i];
      events.push({ at: it.createdAt, kind: 'intent', author: it.author || { kind: 'human' }, data: it });
    }
    for (let i = 0; i < annotations.length; i++) {
      const a = annotations[i];
      events.push({ at: a.createdAt, kind: 'annotation', author: a.author || { kind: 'human' }, data: a });
    }
    events.sort(function(x, y) { return x.at < y.at ? -1 : x.at > y.at ? 1 : 0; });

    const bodyEl = panel.querySelector('[data-field="body"]');
    if (bodyEl) {
      const eventsHtml = events.length === 0
        ? '<div class="thread-event"><div class="event-body muted">Empty thread.</div></div>'
        : events.map(renderThreadEvent).join('');
      // Phase 2 Brief 2c — reply form footer. Mounted inside the body
      // container after the chronological events list, gated on thread
      // status: archived threads are read-only with a small note in
      // place of the form.
      const replyHtml = renderThreadReplyForm(t);
      bodyEl.innerHTML = eventsHtml + replyHtml;
      bindThreadReplyForm(bodyEl, t);
    }

    // Thread-level actions
    const actionsEl = panel.querySelector('[data-field="actions"]');
    if (actionsEl) {
      const canResolve = t.status === 'active';
      const canReopen = t.status === 'resolved' || t.status === 'orphaned';
      const canArchive = t.status !== 'archived';
      actionsEl.innerHTML =
        (canResolve ? '<button class="btn btn-primary btn-sm" data-thread-action="resolve" data-id="' + escape(t.id) + '">Resolve</button>' : '') +
        (canReopen ? '<button class="btn btn-secondary btn-sm" data-thread-action="reopen" data-id="' + escape(t.id) + '">Reopen</button>' : '') +
        (canArchive ? '<button class="btn btn-ghost btn-sm" data-thread-action="archive" data-id="' + escape(t.id) + '">Archive</button>' : '');
      actionsEl.querySelectorAll('button[data-thread-action]').forEach(function(btn) {
        btn.addEventListener('click', async function() {
          const action = btn.getAttribute('data-thread-action');
          const id = btn.getAttribute('data-id');
          if (!id || !action) return;
          const toStatus = action === 'resolve' ? 'resolved'
                         : action === 'reopen'  ? 'active'
                         : action === 'archive' ? 'archived'
                         : null;
          if (!toStatus) return;
          try {
            await api('/platform/api/threads/transition', {
              threadId: id,
              toStatus: toStatus,
              resolution: action === 'resolve' ? 'resolved by user' : undefined,
            });
            flash('Thread ' + action + 'd', 'success');
            // Refresh the thread detail view with new state + refresh stream.
            openThreadPanel(id);
            refreshStream();
            refreshAnnotations();
          } catch (_) {}
        });
      });
    }

    // Bind close button
    const closeBtn = panel.querySelector('.close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', closeThreadPanel);
    }
  }

  // Phase 2 Brief 2c — light @-mention parsing. Operates on an
  // ALREADY-ESCAPED body string (escape() was called first), so it's
  // XSS-safe by construction: the regex matches `@\w+` literal chars
  // which can never coincide with HTML special-chars after escape().
  // Output wraps each match in a span for visual styling — no
  // notification/autocomplete semantics in scope (Phase 6 territory).
  function parseMentions(escapedBody) {
    if (!escapedBody) return '';
    return escapedBody.replace(/@(\w+)/g, function(_match, name) {
      return '<span class="thread-mention">@' + name + '</span>';
    });
  }

  function renderThreadEvent(ev) {
    const authorKind = (ev.author && ev.author.kind) || 'human';
    const authorName = (ev.author && ev.author.id) || authorKind;
    const time = formatRelativeTime(ev.at);
    let kindTag = '';
    let body = '';
    if (ev.kind === 'intent') {
      const it = ev.data;
      kindTag = 'intent · ' + escape(String(it.status));
      const parts = (it.parts || []).map(function(p) { return escape(describePart(p)); }).join(' · ');
      body = parts || '<span class="muted">(empty)</span>';
    } else {
      const a = ev.data;
      kindTag = 'annotation · ' + escape(String(a.payload.kind));
      // Comment annotations get @-mention parsing on the raw text. The
      // describePayload path wraps it in quotes which would break the
      // mention regex on the leading `"@`, so we route comments
      // directly here.
      if (a.payload && a.payload.kind === 'comment') {
        body = parseMentions(escape(a.payload.text || ''));
      } else {
        body = escape(describeAnnotationPayload(a.payload));
      }
    }
    const accentLeft = ev.kind === 'annotation' && ev.data.payload && ev.data.payload.kind === 'ghost-proposal';
    return '<div class="thread-event' + (accentLeft ? ' accent-left' : '') + '">' +
      '<div class="event-head">' +
        '<span class="author ' + escape(authorKind) + '">' + escape(authorName) + '</span>' +
        '<span class="kind-tag">' + kindTag + '</span>' +
        '<span class="time">' + escape(time) + '</span>' +
      '</div>' +
      '<div class="event-body">' + body + '</div>' +
    '</div>';
  }

  // Phase 2 Brief 2c — reply form. Archived threads are read-only;
  // active/resolved/orphaned threads show the textarea + Send affordance.
  function renderThreadReplyForm(thread) {
    if (!thread) return '';
    if (thread.status === 'archived') {
      return '<div class="thread-reply-archived">Thread archived. Reopen to add replies.</div>';
    }
    return '<div class="thread-reply-form" data-thread-reply data-thread-id="' + escape(thread.id) + '">' +
        '<textarea class="thread-reply-input" data-thread-reply-input placeholder="Reply or @mention…" rows="2" maxlength="4000"></textarea>' +
        '<div class="thread-reply-actions">' +
          '<span class="thread-reply-hint">Cmd+Enter to send</span>' +
          '<button class="btn btn-primary btn-sm" data-thread-action="send-reply" disabled>Send</button>' +
        '</div>' +
      '</div>';
  }

  function bindThreadReplyForm(bodyEl, thread) {
    if (!bodyEl || !thread || thread.status === 'archived') return;
    const form = bodyEl.querySelector('[data-thread-reply]');
    if (!form) return;
    const textarea = form.querySelector('[data-thread-reply-input]');
    const sendBtn = form.querySelector('[data-thread-action="send-reply"]');
    if (!textarea || !sendBtn) return;

    function refreshSendState() {
      sendBtn.disabled = textarea.value.trim().length === 0;
      // Auto-resize up to 6 rows (~ 6 * 18px line-height + padding).
      textarea.style.height = 'auto';
      const max = 6 * 18 + 16;
      textarea.style.height = Math.min(textarea.scrollHeight, max) + 'px';
    }

    // Phase 4 Brief 4b Pin #7 — thread panel slash-command bus migration
    // (closes 3.5 Pin #11).
    //
    // Replies that START with a slash (`/critic ...`, `/design ...`)
    // route to /platform/api/skill-bus/invoke instead of the plain
    // /threads/reply path. The thread panel listens for SSE
    // skill-bus:result events filtered by requestId, renders results
    // inline using the Phase 3.5 result-rendering library
    // (152-skill-result-render.js). Plain comments unchanged.
    function parseSlashCommand(body) {
      var m = body.match(/^\/(\w[\w-]*)\s*(.*)$/s);
      if (!m) return null;
      var verb = m[1];
      var rest = m[2].trim();
      // Verb → canonical skill name. Phase 4d may surface this as a
      // user-configurable verb registry; for now hard-coded mapping.
      var SKILL_BY_VERB = {
        'critic':           'reframe-critic',
        'critique':         'reframe-critic',
        'design':           'reframe-design',
        'enhance':          'reframe-enhance',
        'brand':            'reframe-brand',
        'motion':           'reframe-motion',
        'animate':          'reframe-motion',
        'review':           'reframe-critic',
      };
      var skill = SKILL_BY_VERB[verb.toLowerCase()];
      if (!skill) return null;
      return { skill: skill, verb: verb, prompt: rest };
    }

    function freshRequestId() {
      return 'r-' + Date.now().toString(36) + '-' +
        Math.random().toString(36).slice(2, 7);
    }

    async function submitReply() {
      const trimmed = textarea.value.trim();
      if (!trimmed) return;
      sendBtn.disabled = true;
      textarea.readOnly = true;
      sendBtn.textContent = 'Sending…';

      // Slash-command path → skill-bus invocation.
      const slash = parseSlashCommand(trimmed);
      if (slash) {
        const requestId = freshRequestId();
        try {
          // Determine context kind by skill — the bus router validates
          // context.kind against each skill's bus-context-types.
          // reframe-critic accepts critique-target / scene-compiled;
          // reframe-design accepts design-intent / scene-edit.
          var contextKind = (slash.skill === 'reframe-critic') ? 'critique-target' :
                            (slash.skill === 'reframe-brand')  ? 'brand-load' :
                            (slash.skill === 'reframe-motion') ? 'motion-intent' :
                                                                  'design-intent';
          // Append an optimistic local entry в thread events log so the
          // designer sees the slash invocation lands in the timeline
          // immediately, then the bus result event upgrades it inline.
          mountThreadBusEntry(bodyEl, requestId, slash.skill, slash.verb, slash.prompt);
          await api('/platform/api/skill-bus/invoke', {
            skill: slash.skill,
            requestId: requestId,
            context: {
              kind: contextKind,
              threadId: thread.id,
              anchor: thread.anchor || null,
              prompt: slash.prompt,
              sceneSlug: thread.sceneSlug || null,
            },
          });
          textarea.value = '';
          flash('/' + slash.verb + ' dispatched', 'success');
        } catch (e) {
          flash('Bus invoke failed', 'error');
          sendBtn.disabled = false;
          textarea.readOnly = false;
          sendBtn.textContent = 'Send';
          return;
        }
        sendBtn.disabled = false;
        textarea.readOnly = false;
        sendBtn.textContent = 'Send';
        refreshSendState();
        return;
      }

      // Plain reply path — unchanged.
      try {
        await api('/platform/api/threads/reply', {
          threadId: thread.id,
          body: trimmed,
        });
        textarea.value = '';
        flash('Reply sent', 'success');
        // Reuse the existing refetch path so the new comment slots
        // into the chronologically-sorted events list correctly.
        openThreadPanel(thread.id);
        refreshAnnotations();
      } catch (e) {
        flash('Reply failed', 'error');
        sendBtn.disabled = false;
        textarea.readOnly = false;
        sendBtn.textContent = 'Send';
      }
    }

    // Mount an inline bus-result entry into the thread events stream.
    // Renders a Phase 3.5 progress card initially; upgrades to a result
    // card when the SSE skill-bus:result event for this requestId fires.
    function mountThreadBusEntry(panelBody, requestId, skill, verb, prompt) {
      if (!panelBody || typeof renderSkillProgress !== 'function') return;
      var entriesHost = panelBody.querySelector('.thread-events') || panelBody;
      var wrap = document.createElement('div');
      wrap.className = 'thread-bus-entry';
      wrap.setAttribute('data-thread-bus-entry', requestId);
      wrap.innerHTML =
        '<div class="thread-bus-head">' +
          '<span class="thread-bus-verb">/' + verb + '</span>' +
          '<span class="thread-bus-skill">' + skill + '</span>' +
        '</div>' +
        renderSkillProgress({ requestId: requestId, skill: skill, phase: 'queued' });
      entriesHost.appendChild(wrap);

      // Subscribe to bus events. Reuses the Phase 3.5 sibling registry.
      if (!Array.isArray(window.__reframeSkillBusSubscribers)) {
        window.__reframeSkillBusSubscribers = [];
      }
      window.__reframeSkillBusSubscribers.push(function(ev) {
        if (!ev || ev.requestId !== requestId) return;
        if (ev.type === 'skill-bus:progress') {
          var prog = wrap.querySelector('[data-skill-progress]') || wrap;
          prog.outerHTML = renderSkillProgress({
            requestId: ev.requestId, skill: ev.skill, phase: ev.phase,
          });
        } else if (ev.type === 'skill-bus:result') {
          wrap.innerHTML =
            '<div class="thread-bus-head">' +
              '<span class="thread-bus-verb">/' + verb + '</span>' +
              '<span class="thread-bus-skill">' + skill + '</span>' +
            '</div>' +
            renderSkillResult({
              requestId: ev.requestId,
              skill: ev.skill,
              ok: ev.ok,
              payload: ev.payload,
              error: ev.error,
            });
          if (typeof bindSkillResultActions === 'function') bindSkillResultActions(wrap);
        }
      });
      void prompt;
    }

    textarea.addEventListener('input', refreshSendState);
    textarea.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submitReply();
      }
    });
    sendBtn.addEventListener('click', function(e) {
      e.preventDefault();
      submitReply();
    });
    refreshSendState();
  }

  function describeAnnotationPayload(p) {
    if (!p) return '';
    switch (p.kind) {
      case 'comment':           return '"' + (p.text || '') + '"';
      case 'pin':               return 'pinned' + (p.note ? ': ' + p.note : '');
      case 'echo-arrow':        return 'echo ' + (p.fromAnchor || '?') + ' → ' + (p.toAnchor || '?') + ' (axis: ' + (p.axis || '?') + ')';
      case 'region':            return 'region · ' + ((p.anchors || []).length) + ' nodes';
      case 'brush-stroke':      return 'brush "' + (p.macro || '') + '" over ' + ((p.anchors || []).length) + ' nodes';
      case 'reference':         return 'reference ' + (p.source ? p.source.type + ': ' + (p.source.brand || p.source.url || p.source.anchor || '?') : '?');
      case 'rule':              return 'rule "' + (p.rule || '') + '"' + (p.value !== undefined ? ' = ' + JSON.stringify(p.value) : '') + (p.enforced ? ' (enforced)' : '');
      case 'ghost-proposal':    return 'proposal: ' + (p.summary || '');
      case 'resonance-overlay': return 'resonance · ' + ((p.matches || []).length) + ' matches along [' + ((p.axes || []).join(',')) + ']';
      default: return p.kind;
    }
  }

  function formatRelativeTime(iso) {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    if (isNaN(then)) return '';
    const diff = Date.now() - then;
    const s = Math.floor(diff / 1000);
    if (s < 5) return 'just now';
    if (s < 60) return s + 's ago';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    const d = Math.floor(h / 24);
    if (d < 7) return d + 'd ago';
    return iso.slice(0, 10);
  }
