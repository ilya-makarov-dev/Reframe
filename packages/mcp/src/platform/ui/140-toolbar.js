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
        $$('.macro-submenu.open').forEach(function(s) { s.classList.remove('open'); });
      }
    });
    // Close on Escape — keyboard users get trapped otherwise. Capture
    // phase beats the canvas Escape handler (which deselects nodes) so
    // the dropdown is the first responder whenever it's open.
    document.addEventListener('keydown', function(e) {
      if (e.key !== 'Escape') return;
      var anyOpen = document.querySelector('[data-macro-menu]:not(.hidden)') ||
                    document.querySelector('.macro-submenu.open');
      if (!anyOpen) return;
      e.stopPropagation();
      $$('[data-macro-menu]').forEach(function(m) { m.classList.add('hidden'); });
      $$('[data-macro-btn]').forEach(function(b) { b.classList.remove('active'); });
      $$('.macro-submenu.open').forEach(function(s) { s.classList.remove('open'); });
    }, true);

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

  // Find the scene id from either the baseShell iframe frame or the
  // editor-shell CanvasKit canvas. Both carry it as data-session.
  function currentSceneId() {
    var frame = $('.viewport-frame') || document.getElementById('reframe-viewport');
    return frame ? frame.getAttribute('data-session') : null;
  }

  async function handleMacroAction(action, item) {
    var sceneId = currentSceneId();

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
      // Legacy path: some older pages still render a
      // [data-brand-picker-btn] in the header. Platform 2.0 dropped
      // that button — clicking Rebrand fell through to the error
      // flash. The actual picker renderer (openBrandBrowser) is
      // declared in 150-sidebar.js's IIFE scope, so we can call it
      // directly from here in the concatenated bundle.
      var pickerBtn = $('[data-brand-picker-btn]');
      if (pickerBtn) { pickerBtn.click(); return; }
      if (typeof openBrandBrowser === 'function') {
        openBrandBrowser();
        return;
      }
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
      // Legacy iframe viewport: click the actual button so the iframe
      // + annotation SVG both resize. Platform 2.0 has no .vp-btn, so
      // we fall through to the visual preview path below.
      var vpBtn = document.querySelector('.vp-btn[data-vp="' + vp + '"]');
      if (vpBtn) { vpBtn.click(); return; }
      if (state && typeof state === 'object') {
        state.currentViewport = vp;
        try { persistUiState(); } catch (_) {}
      }
      // Platform 2.0: constrain the canvas host so the user sees a
      // narrower canvas even before running an `adapt` op. This is a
      // preview — the actual scene graph stays at its authored width.
      // Ask the agent (or call reframe_edit op=adapt) to generate a
      // real mobile variant if you want the layout to reflow.
      var VP_WIDTH = { desktop: 1440, tablet: 768, mobile: 390 };
      var canvas = document.getElementById('reframe-viewport');
      var host = canvas && canvas.parentElement;
      if (host && VP_WIDTH[vp]) {
        if (vp === 'desktop') {
          host.style.maxWidth = '';
          host.style.margin = '';
          host.style.marginLeft = '';
          host.style.marginRight = '';
          host.style.width = '';
          host.style.display = '';
        } else {
          // Mobile preview shipped un-centered on Platform 2.0: the host's
          // parent (.main) is block overflow, so `margin: 0 auto` only
          // works if the host has a constrained width AND is a block
          // formatting context. Setting width explicitly to the target +
          // forcing `display: block` + explicit marginLeft/Right: auto
          // makes the centering survive even when the host was promoted
          // to a flex child by upstream CSS changes.
          host.style.maxWidth = VP_WIDTH[vp] + 'px';
          host.style.width = VP_WIDTH[vp] + 'px';
          host.style.display = 'block';
          host.style.marginLeft = 'auto';
          host.style.marginRight = 'auto';
        }
      }
      // Also repaint the chat chip immediately so the context is fresh
      // before the user hits Enter.
      var chipsEl = document.querySelector('[data-bc-chips]');
      if (chipsEl && typeof window.reframeRenderBottomChips === 'function') {
        window.reframeRenderBottomChips();
      }
      $$('.viewport-frame').forEach(function(f) {
        f.classList.remove('original', 'desktop', 'tablet', 'mobile');
        f.classList.add(vp);
      });
      flash(vp === 'desktop'
        ? 'Viewport → desktop (canvas restored)'
        : 'Previewing at ' + vp + ' width. Run reframe_edit op=adapt to generate a real variant.');
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
      if (picker) { picker.click(); return; }
      if (typeof openBrandBrowser === 'function') { openBrandBrowser(); return; }
      flash('Brand picker unavailable', 'error');
      return;
    }

    // ── Agent-delegated actions: regenerate / responsive / iterate-fix ──
    if (action === 'regenerate' || action === 'responsive' || action === 'iterate-fix') {
      // The bottom chat textarea was renamed from `.agent-chat-input`
      // to `.bc-input` (data-attr `[data-bc-input]`) when the sidebar
      // was folded into the bottom chat. The legacy selector still
      // came first here, so after the rename Responsive / Regenerate /
      // Iterate-fix silently fell through to the toast-only fallback:
      // the prompt flashed, disappeared, and nothing was ever sent.
      var agentInput = $('[data-bc-input]')
        || document.querySelector('.bc-input')
        || $('[data-agent-input]')
        || document.querySelector('.agent-chat-input');
      var prompt = action === 'regenerate'    ? 'Regenerate this scene with a fresh layout while keeping the brand and content intent.'
                 : action === 'responsive'    ? 'Create responsive variants for this scene: 1440 desktop, 768 tablet, 390 mobile.'
                 : /* iterate-fix */            'Run audit and fix all failing rules on this scene.';
      if (agentInput && 'value' in agentInput) {
        agentInput.value = prompt;
        // Fire input event so any height-autoresize / send-enable
        // listener on the textarea picks up the new value.
        agentInput.dispatchEvent(new Event('input', { bubbles: true }));
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
          var sessionId = currentSceneId();
          if (!sessionId) { flash('No scene to export', 'error'); return; }
          showExportPreview(sessionId, format);
        });
      });
    }

    // Editor-shell header `#btn-detach` — applies detach-from-layout to
    // every currently selected node. Selection comes from the OP editor
    // (window.__reframeEditor.state.selectedIds = OP ids); we translate
    // to reframe ids via the bridge so editNodeProp hits the right rows.
    var detachBtn = document.getElementById('btn-detach');
    if (detachBtn && !detachBtn.dataset.bound) {
      detachBtn.dataset.bound = '1';
      detachBtn.addEventListener('click', async function() {
        var sceneId = currentSceneId();
        if (!sceneId) { flash('No scene', 'error'); return; }
        var ed = window.__reframeEditor;
        if (!ed || !ed.state || !ed.state.selectedIds || ed.state.selectedIds.size === 0) {
          flash('Select a node first', 'info'); return;
        }
        var bridge = window.__reframeBridge;
        var opIds = Array.from(ed.state.selectedIds);
        var rfIds = opIds.map(function(id) {
          if (bridge && bridge.opToReframeId && bridge.opToReframeId.get) {
            var mapped = bridge.opToReframeId.get(id);
            if (mapped) return mapped;
          }
          return id;
        }).filter(Boolean);
        var ok = 0;
        for (var i = 0; i < rfIds.length; i++) {
          if (typeof detachNodeFromLayout === 'function') {
            var success = await detachNodeFromLayout(sceneId, rfIds[i]);
            if (success) ok++;
          }
        }
        if (ok > 0) {
          flash('Detached ' + ok + ' node' + (ok === 1 ? '' : 's'), 'success');
          if (ed.requestRender) ed.requestRender();
        } else {
          flash('Detach failed', 'error');
        }
      });
    }

    // Editor-shell header has a simple `#btn-export` primary button
    // (no menu). Wire it to the HTML export preview — the most common
    // format and a reliable default. Users can still pick other formats
    // via the More macro dropdown on scene pages.
    var shellExportBtn = document.getElementById('btn-export');
    if (shellExportBtn && !shellExportBtn.dataset.bound) {
      shellExportBtn.dataset.bound = '1';
      shellExportBtn.addEventListener('click', function() {
        var sessionId = currentSceneId();
        if (!sessionId) { flash('No scene to export', 'error'); return; }
        showExportPreview(sessionId, 'html');
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
      // Expose the active brand so the bottom-chat chip row can render it
      // on the project page (there's no [data-brand-picker-label] here).
      window.__reframeActiveBrand = s.activeBrand || '';
      if (typeof window.reframeRenderBottomChips === 'function') {
        window.reframeRenderBottomChips();
      }
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
    overlay.setAttribute('data-testid', 'export-modal');
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
    // Close handlers: × button, backdrop click, AND Escape key.
    // Previously only × and backdrop worked — keyboard users and
    // anyone on a trackpad had to hunt for the close button.
    function closeExport() {
      document.removeEventListener('keydown', onEsc, true);
      overlay.remove();
    }
    function onEsc(e) {
      if (e.key === 'Escape') { e.stopPropagation(); closeExport(); }
    }
    overlay.querySelector('.close-btn').addEventListener('click', closeExport);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeExport(); });
    // Use capture so this beats any descendant keydown handler
    // (the canvas editor also listens for Escape to deselect).
    document.addEventListener('keydown', onEsc, true);
  }
