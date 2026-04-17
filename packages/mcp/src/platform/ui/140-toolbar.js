  // ── Top-center macro-dropdowns: Generate / Modify / Preview / More ──
  //
  // 4 dropdowns that expose the engine's unique verbs:
  //   Generate   → /platform/api/variations/grid (vary) + agent prompts
  //   Modify     → /platform/api/variations/apply + /platform/api/rebrand/apply
  //   Preview    → local viewport class swap
  //   More       → export + utility
  //
  // Markup rendered by renderMacroDropdowns() in layout.ts. This handler
  // opens/closes menus, dispatches actions to the right API, and flashes
  // feedback. Actions without a platform API (regenerate, responsive,
  // iterate-fix) fall back to an agent prompt.
  function bindMacroDropdowns() {
    var root = $('[data-macro-dropdowns]');
    if (!root) return;

    // ── Open / close dropdowns (click button → toggle sibling menu) ──
    $$('[data-macro-btn]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var key = btn.getAttribute('data-macro-btn');
        var menu = $('[data-macro-menu="' + key + '"]');
        if (!menu) return;
        var wasOpen = !menu.classList.contains('hidden');
        // Close all menus first.
        $$('[data-macro-menu]').forEach(function(m) { m.classList.add('hidden'); });
        $$('[data-macro-btn]').forEach(function(b) { b.classList.remove('active'); });
        if (!wasOpen) {
          menu.classList.remove('hidden');
          btn.classList.add('active');
        }
      });
    });

    // Close on outside click.
    document.addEventListener('click', function(e) {
      if (!e.target.closest || !e.target.closest('[data-macro-dropdowns]')) {
        $$('[data-macro-menu]').forEach(function(m) { m.classList.add('hidden'); });
        $$('[data-macro-btn]').forEach(function(b) { b.classList.remove('active'); });
      }
    });

    // ── Submenu hover ─ expand nested panel on hover of trigger ──
    $$('.macro-submenu-trigger').forEach(function(trig) {
      trig.addEventListener('click', function(e) {
        e.stopPropagation();
        var sub = trig.parentElement;
        if (!sub) return;
        // Close sibling submenus first.
        var parent = sub.parentElement;
        if (parent) {
          parent.querySelectorAll('.macro-submenu.open').forEach(function(s) {
            if (s !== sub) s.classList.remove('open');
          });
        }
        sub.classList.toggle('open');
      });
    });

    // ── Action dispatch ─────────────────────────────────────
    root.addEventListener('click', async function(e) {
      var item = e.target.closest('[data-macro-action]');
      if (!item || item.hasAttribute('disabled')) return;
      e.stopPropagation();
      var action = item.getAttribute('data-macro-action');
      // Close all menus after any action click.
      setTimeout(function() {
        $$('[data-macro-menu]').forEach(function(m) { m.classList.add('hidden'); });
        $$('[data-macro-btn]').forEach(function(b) { b.classList.remove('active'); });
      }, 50);
      await handleMacroAction(action, item);
    });
  }

  async function handleMacroAction(action, item) {
    var frame = $('.viewport-frame');
    var sceneId = frame ? frame.getAttribute('data-session') : null;

    // ── Variation (density/radius/shadows/typography/colorRotation) ──
    if (action === 'variation') {
      if (!sceneId) { flash('No scene', 'error'); return; }
      var kind = item.getAttribute('data-kind');
      var value = item.getAttribute('data-value');
      if (!kind) return;
      try {
        var castValue = kind === 'density' ? Number(value) : value;
        await api('/platform/api/variations/apply', {
          sceneId: sceneId, kind: kind, value: castValue,
        });
        flash(kind + ' → ' + value, 'success');
        requestRemeasure && requestRemeasure();
      } catch (err) {
        flash('Variation failed: ' + (err && err.message || err), 'error');
      }
      return;
    }

    // ── Rebrand (full DESIGN.md swap) ──
    if (action === 'rebrand') {
      var pickerBtn = $('[data-brand-picker-btn]');
      if (pickerBtn) { pickerBtn.click(); return; }
      flash('Brand picker unavailable', 'error');
      return;
    }

    // ── Toggle theme (light/dark via token mode switch) ──
    if (action === 'toggle-theme') {
      if (!sceneId) { flash('No scene', 'error'); return; }
      // Read current token mode from body attribute (default dark).
      var currentMode = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
      var next = currentMode === 'light' ? 'dark' : 'light';
      try {
        await api('/platform/api/variations/apply', { sceneId: sceneId, kind: 'mode', value: next });
        flash('Mode → ' + next, 'success');
        requestRemeasure && requestRemeasure();
      } catch (err) {
        flash('Theme switch failed: ' + (err && err.message || err), 'error');
      }
      return;
    }

    // ── Variants (Cartesian grid via vary) ──
    if (action === 'variants') {
      if (!sceneId) { flash('No scene', 'error'); return; }
      // Default axes — density × radius × shadows (3×3×3 = 27 too much,
      // so ship a small starter: density 3 × radius 3 = 9 variants).
      try {
        flash('Generating variants…');
        var result = await api('/platform/api/variations/grid', {
          sceneId: sceneId,
          axes: {
            density: [0.9, 1.0, 1.1],
            radius: ['sharp', 'soft', 'pill'],
          },
          limit: 9,
        });
        var count = (result && result.generated || []).length;
        flash('Generated ' + count + ' variants', 'success');
      } catch (err) {
        flash('Variants failed: ' + (err && err.message || err), 'error');
      }
      return;
    }

    // ── Viewport switch (Preview dropdown) ──
    if (action === 'viewport') {
      var vp = item.getAttribute('data-vp');
      if (!vp) return;
      // Re-use viewport switcher: find any .vp-btn[data-vp=vp] and click,
      // otherwise apply the class swap directly.
      var vpBtn = document.querySelector('.vp-btn[data-vp="' + vp + '"]');
      if (vpBtn) { vpBtn.click(); return; }
      if (state && typeof state === 'object') state.currentViewport = vp;
      $$('.viewport-frame').forEach(function(f) {
        f.classList.remove('original', 'desktop', 'tablet', 'mobile');
        f.classList.add(vp);
      });
      flash('Viewport → ' + vp);
      return;
    }

    // ── New tab (open current scene preview standalone) ──
    if (action === 'new-tab') {
      if (!sceneId) { flash('No scene', 'error'); return; }
      window.open('/preview/' + sceneId, '_blank');
      return;
    }

    // ── Export shortcuts (route through existing export overlay) ──
    if (action && action.indexOf('export-') === 0) {
      var format = item.getAttribute('data-format');
      if (!sceneId || !format) { flash('No scene/format', 'error'); return; }
      showExportPreview(sceneId, format);
      return;
    }

    // ── Pick brand — open the brand picker dropdown ──
    if (action === 'pick-brand') {
      var picker = $('[data-brand-picker-btn]');
      if (picker) picker.click();
      return;
    }

    // ── Agent-delegated actions: regenerate / responsive / iterate-fix ──
    if (action === 'regenerate' || action === 'responsive' || action === 'iterate-fix') {
      var agentInput = $('[data-agent-input]') || document.querySelector('.agent-chat-input');
      var prompt = action === 'regenerate'    ? 'Regenerate this scene with a fresh layout while keeping the brand and content intent.'
                 : action === 'responsive'    ? 'Create responsive variants for this scene: 1440 desktop, 768 tablet, 390 mobile.'
                 : /* iterate-fix */            'Run audit and fix all failing rules on this scene.';
      if (agentInput && 'value' in agentInput) {
        agentInput.value = prompt;
        agentInput.focus();
        flash('Prompt ready — press Enter to send');
      } else {
        flash(prompt, 'info');
      }
      return;
    }

    flash('Action not wired: ' + action, 'info');
  }

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
