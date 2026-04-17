  // ── Sectioned right-click context menu (full catalog) ──
  //
  // Replaces the node-only menu from 020-selection.js. Shows:
  //   [Node]     — only when a node is selected (delete/duplicate/wrap/AI)
  //   Generate   — variants / regenerate / responsive
  //   Modify     — rebrand / theme / scale spacing·radius·shadows·typo
  //   Preview    — Desktop / Tablet / Mobile / New tab
  //   Export     — 7 formats
  //
  // Node actions → handleContextAction (kept in 020-selection.js).
  // Catalog actions → handleMacroAction (kept in 140-toolbar.js) via a
  // synthetic item carrying data-kind / data-value / data-format / data-vp
  // the same way the top dropdown items do. One dispatcher, one API.
  //
  // Because ui/*.js files are lexically concatenated into a single IIFE,
  // function declarations in 045-* override those hoisted from 020-*
  // (later declaration wins on the assignment phase). That's how we
  // swap bindContextMenu + showContextMenu without touching init.

  function bindContextMenu() {
    // The annotation overlays sit on top of the iframe, so their
    // contextmenu events fire — cross-origin iframe content doesn't
    // propagate its own. Bind on all three (SVG, HTML marks layer,
    // and the frame itself) so right-click works everywhere inside
    // the viewport on scene pages.
    var targets = [
      $('.viewport-frame .annotations'),
      $('.viewport-frame .annotation-marks-html'),
      $('.viewport-frame'),
    ];
    targets.forEach(function(el) {
      if (!el) return;
      el.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        e.stopPropagation();
        showContextMenu(e.clientX, e.clientY);
      });
    });
    // Close on any left click outside the menu.
    document.addEventListener('click', function(e) {
      if (!e.target.closest || !e.target.closest('.context-menu')) {
        closeContextMenu();
      }
    });
    // Escape closes.
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeContextMenu();
    });
  }

  function showContextMenu(x, y) {
    closeContextMenu();
    var hasSelection = !!(state.selection && state.selection.inode);

    var menu = document.createElement('div');
    menu.className = 'context-menu ctx-catalog show';

    var html = '';

    // ── Node section (only when a node is selected) ──
    if (hasSelection) {
      html +=
        '<div class="ctx-section-label">Selected node</div>' +
        '<div class="ctx-item" data-ctx="duplicate">Duplicate<span class="shortcut">⌘D</span></div>' +
        '<div class="ctx-item" data-ctx="wrap">Wrap in container</div>' +
        '<div class="ctx-item" data-ctx="extract">Extract component</div>' +
        '<div class="ctx-item" data-ctx="add-frame">Add frame (child)</div>' +
        '<div class="ctx-item" data-ctx="add-text">Add text (child)</div>' +
        '<div class="ctx-item danger" data-ctx="delete">Delete<span class="shortcut">⌫</span></div>' +
        '<div class="ctx-sep"></div>' +
        '<div class="ctx-section-label">AI verbs</div>' +
        '<div class="ctx-item ai-verb" data-ctx="ask">✦ Ask about this…</div>' +
        '<div class="ctx-item ai-verb" data-ctx="echo">✦ Echo from…</div>' +
        '<div class="ctx-item ai-verb" data-ctx="pin">✦ Pin reference</div>' +
        '<div class="ctx-item ai-verb" data-ctx="rule">✦ Set rule</div>' +
        '<div class="ctx-item ai-verb" data-ctx="brush">✦ Brush with macro</div>' +
        '<div class="ctx-sep"></div>';
    }

    // ── Generate section ──
    html +=
      '<div class="ctx-section-label">Generate</div>' +
      '<div class="ctx-item macro" data-macro="variants">Variants<span class="shortcut">9 grid</span></div>' +
      '<div class="ctx-item macro" data-macro="regenerate">Regenerate<span class="shortcut">prompt</span></div>' +
      '<div class="ctx-item macro" data-macro="responsive">Responsive set<span class="shortcut">prompt</span></div>' +
      '<div class="ctx-sep"></div>';

    // ── Modify section ──
    html +=
      '<div class="ctx-section-label">Modify</div>' +
      '<div class="ctx-item macro" data-macro="rebrand">Rebrand…</div>' +
      '<div class="ctx-item macro" data-macro="toggle-theme">Toggle light/dark</div>' +
      '<div class="ctx-item macro" data-macro="variation" data-kind="density" data-value="0.9">Density · Compact</div>' +
      '<div class="ctx-item macro" data-macro="variation" data-kind="density" data-value="1.1">Density · Airy</div>' +
      '<div class="ctx-item macro" data-macro="variation" data-kind="radius" data-value="sharp">Radius · Sharp</div>' +
      '<div class="ctx-item macro" data-macro="variation" data-kind="radius" data-value="soft">Radius · Soft</div>' +
      '<div class="ctx-item macro" data-macro="variation" data-kind="radius" data-value="pill">Radius · Pill</div>' +
      '<div class="ctx-item macro" data-macro="variation" data-kind="shadows" data-value="flat">Shadows · Flat</div>' +
      '<div class="ctx-item macro" data-macro="variation" data-kind="shadows" data-value="lifted">Shadows · Lifted</div>' +
      '<div class="ctx-item macro" data-macro="variation" data-kind="typography" data-value="serif">Typography · Serif</div>' +
      '<div class="ctx-item macro" data-macro="variation" data-kind="typography" data-value="mono">Typography · Mono</div>' +
      '<div class="ctx-item macro" data-macro="variation" data-kind="colorRotation" data-value="30">Rotate colors 30°</div>' +
      '<div class="ctx-item macro" data-macro="iterate-fix">Iterate · Fix audit<span class="shortcut">prompt</span></div>' +
      '<div class="ctx-sep"></div>';

    // ── Preview section ──
    html +=
      '<div class="ctx-section-label">Preview</div>' +
      '<div class="ctx-item macro" data-macro="viewport" data-vp="desktop">Desktop</div>' +
      '<div class="ctx-item macro" data-macro="viewport" data-vp="tablet">Tablet</div>' +
      '<div class="ctx-item macro" data-macro="viewport" data-vp="mobile">Mobile</div>' +
      '<div class="ctx-item macro" data-macro="new-tab">Open in new tab</div>' +
      '<div class="ctx-sep"></div>';

    // ── Export section ──
    html +=
      '<div class="ctx-section-label">Export</div>' +
      '<div class="ctx-item macro" data-macro="export-html"  data-format="html">HTML</div>' +
      '<div class="ctx-item macro" data-macro="export-react" data-format="react">React</div>' +
      '<div class="ctx-item macro" data-macro="export-svg"   data-format="svg">SVG</div>' +
      '<div class="ctx-item macro" data-macro="export-png"   data-format="png">PNG</div>' +
      '<div class="ctx-item macro" data-macro="export-pdf"   data-format="pdf">PDF</div>' +
      '<div class="ctx-item macro" data-macro="export-lottie" data-format="lottie">Lottie</div>' +
      '<div class="ctx-item macro" data-macro="export-anim"  data-format="animated_html">Animated HTML</div>';

    menu.innerHTML = html;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    document.body.appendChild(menu);

    // Clamp to viewport.
    var rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = (window.innerHeight - rect.height - 8) + 'px';
    }

    // ── Dispatch ──
    menu.addEventListener('click', function(e) {
      var item = e.target.closest('[data-ctx],[data-macro]');
      if (!item) return;
      e.stopPropagation();

      // Node action → handleContextAction (in 020-selection.js).
      var ctxAction = item.getAttribute('data-ctx');
      if (ctxAction) {
        closeContextMenu();
        handleContextAction(ctxAction);
        return;
      }

      // Catalog action → handleMacroAction (in 140-toolbar.js).
      // handleMacroAction reads data-kind / data-value / data-vp /
      // data-format off the item, so passing the real element works.
      var macroAction = item.getAttribute('data-macro');
      if (macroAction) {
        closeContextMenu();
        handleMacroAction(macroAction, item);
      }
    });
  }

  // closeContextMenu is defined in 020-selection.js and remains the
  // single source of truth for tearing down the menu DOM.
