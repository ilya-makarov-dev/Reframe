  // ── Header toolbar: Undo/Redo, Tool modes, Export ─────
  function bindHeaderToolbar() {
    // Undo / Redo buttons
    var undoBtn = $('[data-action="undo"]');
    var redoBtn = $('[data-action="redo"]');
    if (undoBtn) undoBtn.addEventListener('click', undoLastOp);
    if (redoBtn) redoBtn.addEventListener('click', function() {
      flash('Redo: use Cmd+Z to undo further back');
      // Full redo stack requires server-side state — deferred to
      // timeline scrubber which gives visual access to any point.
    });

    // Tool mode selector (Select / Move / Lasso)
    $$('.tool-mode[data-tool-mode]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var mode = btn.getAttribute('data-tool-mode');
        $$('.tool-mode').forEach(function(b) { b.classList.toggle('active', b === btn); });
        // Set edit mode ON for Move/Lasso, keep current for Select.
        if (mode === 'move' || mode === 'lasso') {
          setEditMode(true);
          if (mode === 'lasso') {
            enterMode({ kind: 'lasso', polygon: [], active: false });
          } else {
            // Move mode = drag-live ready.
            if (state.selection.inode) {
              enterMode({ kind: 'drag-live', source: state.selection.inode, origin: null, delta: { dx: 0, dy: 0 }, active: false });
            }
          }
        }
      });
    });

    // Export dropdown toggle
    var exportBtn = $('.export-btn');
    var exportMenu = $('.export-menu');
    if (exportBtn && exportMenu) {
      exportBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        exportMenu.classList.toggle('hidden');
      });
      // Close on outside click.
      document.addEventListener('click', function() {
        if (exportMenu) exportMenu.classList.add('hidden');
      });
      // Export format buttons → open split-preview overlay.
      exportMenu.querySelectorAll('button[data-format]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var format = btn.getAttribute('data-format');
          exportMenu.classList.add('hidden');
          if (!format) return;
          var frame = $('.viewport-frame');
          var sessionId = frame ? frame.getAttribute('data-session') : null;
          if (!sessionId) { flash('No scene to export', 'error'); return; }
          showExportPreview(sessionId, format);
        });
      });
    }
  }

  // ── Edit mode toggle ─────────────────────────────────
  function setEditMode(on) {
    if (state.editMode === on) return;
    state.editMode = !!on;
    // Tell the iframe whether to block link navigation + show crosshair.
    postToIframe({ type: 'reframe:setMode', annotationMode: state.editMode });
    // Reflect on the shell so CSS can style accordingly (viewport frame
    // accent ring, EDIT pill in header, chip bar visibility).
    const app = $('.app');
    if (app) app.classList.toggle('edit-mode', state.editMode);
    // Leaving edit mode → drop any active submode + selection + hide
    // the floating chip bar. We want view mode to be truly quiet.
    if (!state.editMode) {
      if (state.mode) exitMode();
      clearSelection();
      clearMarkFocus();
      // Also drop any in-progress hover outline.
      state.hover.inode = null;
      state.hover.bbox = null;
      drawHoverOutline();
    }
    flash(state.editMode ? 'Edit mode on' : 'Edit mode off', state.editMode ? 'success' : undefined);
  }

  function bindEditToggle() {
    // The Edit button was removed from the floating canvas palette —
    // edit mode needs a per-scene surface and the canvas is multi-iframe.
    // Selector stays as a safety net in case some page still ships it.
    const btn = $('[data-edit-toggle]');
    if (!btn) return;
    btn.addEventListener('click', function() {
      setEditMode(!state.editMode);
    });
  }

  // ── Project overview health bar ──────────────────────
  async function refreshOverviewHealth() {
    var healthBar = $('[data-health-bar]');
    if (!healthBar) return;
    try {
      var res = await api('/platform/api/project/health');
      if (!res.ok) return;
      var s = res.summary;
      healthBar.innerHTML =
        '<div class="health-item"><span class="health-dot ok"></span><span class="health-label">AUDIT</span> ' +
          s.clean + ' clean' +
          (s.warn > 0 ? ' · ' + s.warn + ' warn' : '') +
          (s.fail > 0 ? ' · ' + s.fail + ' fail' : '') +
        '</div>' +
        '<div class="health-item"><span class="health-dot neutral"></span><span class="health-label">RESPONSIVE</span> ' +
          s.responsive + '/' + s.total + ' scenes' +
        '</div>' +
        '<div class="health-item"><span class="health-dot neutral"></span><span class="health-label">AI</span> ' +
          s.totalThreads + ' thread' + (s.totalThreads === 1 ? '' : 's') +
        '</div>' +
        (s.activeBrand ? '<div class="health-item"><span class="health-dot ok"></span><span class="health-label">BRAND</span> ' + escape(s.activeBrand) + '</div>' : '');
    } catch (_) {
      healthBar.innerHTML = '<span class="health-loading">Health data unavailable</span>';
    }
  }

  // ── Export split-preview overlay ──────────────────────
  function showExportPreview(sessionId, format) {
    var previewUrl = '/preview/' + sessionId;
    var exportUrl = '/preview/' + sessionId + '.' + format;
    var isCode = (format === 'react' || format === 'tsx');

    var overlay = document.createElement('div');
    overlay.className = 'export-preview show';
    overlay.innerHTML =
      '<div class="export-preview-panel">' +
        '<div class="export-preview-head">' +
          '<span class="title">Export preview</span>' +
          '<span class="format-tag">' + escape(format.toUpperCase()) + '</span>' +
          '<a class="btn btn-primary btn-sm download-btn" href="' + escape(exportUrl) + '" target="_blank" download>Download</a>' +
          '<button class="close-btn">×</button>' +
        '</div>' +
        '<div class="export-preview-body">' +
          '<div class="export-preview-left"><iframe src="' + escape(previewUrl) + '"></iframe></div>' +
          '<div class="export-preview-right">' +
            (isCode
              ? '<iframe src="' + escape(exportUrl) + '"></iframe>'
              : '<iframe src="' + escape(exportUrl) + '"></iframe>') +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('.close-btn').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  }
