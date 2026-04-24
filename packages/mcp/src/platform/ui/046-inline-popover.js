  // ── Inline popover — top-3 context-aware actions on selection ──
  //
  // Rendered when the CanvasKit editor fires `reframe:canvas-select`
  // with a non-null nodeId. A compact glass pill with 3 buttons appears
  // at the last click point inside #reframe-viewport. Content is
  // context-aware based on the selected node's tag / role:
  //
  //   TEXT (h1..h6, p, span) → Rebrand typo · Scale text · Ask
  //   BUTTON / A / link      → Rebrand · Pill/Sharp · Rotate color
  //   IMAGE / IMG            → Replace · Resize · Ask
  //   FRAME / SECTION        → Rebrand · Scale spacing · Responsive
  //   default / unknown      → Rebrand · Toggle theme · Ask
  //
  // Each action delegates to handleMacroAction (140-toolbar.js) so the
  // server-side wiring stays DRY. A ⋯ button opens the full ПКМ
  // catalog at the popover's position.
  //
  // Closes on: outside click · Escape · deselect · canvas pan/zoom.

  var lastCanvasClick = null; // { x, y } — screen coords from pointerdown

  function bindInlinePopover() {
    // Record last click point inside the canvas so we know where the
    // popover should appear. The editor's own selection events carry
    // nodeId but not coords — we reuse what the user already pointed at.
    var canvas = document.getElementById('reframe-viewport');
    if (canvas) {
      canvas.addEventListener('pointerdown', function(e) {
        lastCanvasClick = { x: e.clientX, y: e.clientY };
      }, { capture: true, passive: true });
    }

    window.addEventListener('reframe:canvas-select', function(evt) {
      var detail = evt.detail || {};
      var nodeId = detail.nodeId;
      var selected = detail.selectedIds || [];
      // Show only for single-node selections. Multi-select → hide.
      if (!nodeId || selected.length !== 1) {
        closeInlinePopover();
        return;
      }
      // Defer a tick so the editor state (bridge id map) has the node.
      setTimeout(function() { showInlinePopover(nodeId); }, 0);
    });

    // Hide on pan / zoom / deselect handled by re-dispatch above.
    // Outside click + Escape:
    document.addEventListener('mousedown', function(e) {
      var pop = $('.inline-popover');
      if (!pop) return;
      if (e.target.closest('.inline-popover')) return;
      // Clicks inside the canvas will re-trigger via canvas-select; we
      // only close on clicks outside both popover AND canvas.
      if (e.target.id === 'reframe-viewport') return;
      closeInlinePopover();
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeInlinePopover();
      // Cmd+/ or Ctrl+/ while a node is selected opens the composer
      // directly — saves a click when the designer already knows what
      // to ask. Skip when typing inside an input/textarea/contenteditable
      // so the shortcut doesn't fight with text input on existing fields.
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        var t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        var sel = state.selection && state.selection.inode;
        if (!sel) return;
        e.preventDefault();
        // If a popover is already up, reuse it; else open one anchored
        // at the viewport center as a sensible default.
        var existing = $('.inline-popover');
        if (existing) {
          morphToCommentComposer(existing, sel);
        } else {
          lastCanvasClick = lastCanvasClick || { x: window.innerWidth / 2, y: window.innerHeight / 2 };
          showInlinePopover(sel);
          // Defer so the popover is in DOM before we morph it.
          setTimeout(function() {
            var pop = $('.inline-popover');
            if (pop) morphToCommentComposer(pop, sel);
          }, 0);
        }
      }
    });
  }

  function closeInlinePopover() {
    var existing = $('.inline-popover');
    if (existing) existing.remove();
  }

  function showInlinePopover(nodeId) {
    closeInlinePopover();
    if (!lastCanvasClick) return;
    // Look up the node through the editor bridge to pick context actions.
    var editor = window.__reframeEditor;
    var node = null;
    try { node = editor && editor.getNode && editor.getNode(nodeId); } catch (_) {}
    var actions = pickContextActions(node);

    var pop = document.createElement('div');
    pop.className = 'inline-popover show';
    // Universal "Comment" button precedes the context-specific actions.
    // Clicking it morphs the popover into a textarea composer so the
    // designer can ask a targeted change without moving focus to the
    // bottom chat. The selected node is already in state.selection, so
    // bottom-chat's collectChips auto-prepends [Scope: node: …] when we
    // fire reframeSendBottomChat below — no extra scope wiring needed.
    pop.innerHTML =
      '<button class="ipop-btn ipop-btn-comment" data-action="__comment" title="Comment on this element (Cmd+/)">' +
        '<span class="ipop-icon">💬</span><span class="ipop-label">Comment</span>' +
      '</button>' +
      '<span class="ipop-sep" aria-hidden="true"></span>' +
      actions.map(function(a) {
        return '<button class="ipop-btn" data-action="' + escape(a.action) + '"' +
          (a.kind ? ' data-kind="' + escape(a.kind) + '"' : '') +
          (a.value ? ' data-value="' + escape(String(a.value)) + '"' : '') +
          (a.vp ? ' data-vp="' + escape(a.vp) + '"' : '') +
          (a.format ? ' data-format="' + escape(a.format) + '"' : '') +
          ' title="' + escape(a.title || a.label) + '">' +
          '<span class="ipop-icon">' + a.icon + '</span>' +
          '<span class="ipop-label">' + escape(a.label) + '</span>' +
        '</button>';
      }).join('') +
      '<button class="ipop-more" data-action="__more" title="More actions (right-click for full catalog)">⋯</button>';

    // Anchor at last click position with a small offset so it doesn't
    // swallow the pointer. Clamp to viewport.
    var anchorX = lastCanvasClick.x + 10;
    var anchorY = lastCanvasClick.y + 10;
    pop.style.left = anchorX + 'px';
    pop.style.top = anchorY + 'px';
    document.body.appendChild(pop);
    var rect = pop.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) {
      pop.style.left = (window.innerWidth - rect.width - 8) + 'px';
    }
    if (rect.bottom > window.innerHeight - 8) {
      pop.style.top = (lastCanvasClick.y - rect.height - 10) + 'px';
    }

    // Dispatch: reuse handleMacroAction for every wired action.
    pop.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      e.stopPropagation();
      var action = btn.getAttribute('data-action');
      if (action === '__comment') {
        morphToCommentComposer(pop, nodeId);
        return;
      }
      closeInlinePopover();
      if (action === '__more') {
        // Re-show the sectioned ПКМ catalog at the same anchor.
        showContextMenu(lastCanvasClick.x, lastCanvasClick.y);
        return;
      }
      handleMacroAction(action, btn);
    });
  }

  // Replace the button row with a composer: textarea + send button + tiny
  // "presets" row. Submit fires reframeSendBottomChat(text) so the bottom
  // chat log still captures the exchange — the popover is just a capture
  // surface on top of the canvas, not a duplicate chat pipeline. Presets
  // prefill common asks; user can still hit send directly or edit first.
  function morphToCommentComposer(pop, nodeId) {
    if (!pop) return;
    // Keep the popover on-screen at the same anchor. Swap content.
    pop.classList.add('is-composer');
    var presets = [
      'Make this bigger',
      'Tighten spacing',
      'More contrast',
      'Cleaner hierarchy',
    ];
    pop.innerHTML =
      '<div class="ipop-composer">' +
        '<textarea class="ipop-composer-input" data-ipop-comment placeholder="What should change here?" rows="2"></textarea>' +
        '<div class="ipop-composer-row">' +
          '<div class="ipop-composer-presets">' +
            presets.map(function(p) {
              return '<button class="ipop-composer-preset" data-preset="' + escape(p) + '" type="button">' + escape(p) + '</button>';
            }).join('') +
          '</div>' +
          '<button class="ipop-composer-send" data-ipop-send type="button" title="Send (⌘↵)">Send</button>' +
        '</div>' +
      '</div>';

    var textarea = pop.querySelector('[data-ipop-comment]');
    if (textarea) setTimeout(function() { textarea.focus(); }, 0);

    function submit() {
      var text = (textarea && textarea.value || '').trim();
      if (!text) return;
      closeInlinePopover();
      // reframeSendBottomChat dispatches through the normal chat pipeline —
      // scope chips (node / brand / viewport) + attached refs + history
      // persistence all come for free. The popover stays decoupled from
      // annotate.ts for now; persistence is a Phase 3b follow-up.
      if (typeof window.reframeSendBottomChat === 'function') {
        window.reframeSendBottomChat(text);
      } else {
        // Fallback: write into the bottom-chat input and click its send.
        var input = document.querySelector('[data-bc-input]');
        var send = document.querySelector('[data-bc-send]');
        if (input) input.value = text;
        if (send && send.click) send.click();
      }
    }

    pop.addEventListener('click', function(e) {
      var preset = e.target.closest('[data-preset]');
      if (preset) {
        if (textarea) {
          textarea.value = preset.getAttribute('data-preset') || '';
          textarea.focus();
        }
        return;
      }
      if (e.target.closest('[data-ipop-send]')) {
        submit();
      }
    });
    if (textarea) {
      textarea.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          submit();
        }
      });
    }
    // Tag the node we're commenting on so test/probe code can read it.
    pop.setAttribute('data-comment-node', nodeId || '');
  }

  // Pick 3 context actions based on the node's tag / role. Returns an
  // array of { label, icon, title, action, kind?, value?, vp?, format? }
  // that maps onto handleMacroAction's dispatcher without modification.
  function pickContextActions(node) {
    var tag = node ? (node.tag || node.type || '').toLowerCase() : '';
    var role = node ? (node.role || '').toLowerCase() : '';

    // Text-like
    if (/^h[1-6]$/.test(tag) || tag === 'p' || tag === 'span' || tag === 'text') {
      return [
        { label: 'Rebrand type', icon: '✶', action: 'variation', kind: 'typography', value: 'editorial', title: 'Apply editorial typography preset' },
        { label: 'Compact',      icon: '⇵', action: 'variation', kind: 'density',    value: 0.9,         title: 'Tighten density' },
        { label: 'Ask',          icon: '✦', action: 'regenerate',                                        title: 'Send to agent' },
      ];
    }
    // Button / link
    if (tag === 'button' || tag === 'a' || role === 'button' || role === 'cta') {
      return [
        { label: 'Pill',    icon: '⬭', action: 'variation', kind: 'radius',   value: 'pill',  title: 'Pill-shaped radius' },
        { label: 'Sharp',   icon: '▢', action: 'variation', kind: 'radius',   value: 'sharp', title: 'Sharp corners' },
        { label: 'Rotate ° ',icon: '🌀', action: 'variation', kind: 'colorRotation', value: '30', title: 'Shift palette 30°' },
      ];
    }
    // Image
    if (tag === 'img' || tag === 'image' || role === 'image') {
      return [
        { label: 'Replace',   icon: '⤒', action: 'regenerate', title: 'Ask agent to swap image' },
        { label: 'Responsive',icon: '▭', action: 'responsive', title: 'Generate mobile/tablet variants' },
        { label: 'Ask',       icon: '✦', action: 'regenerate', title: 'Send to agent' },
      ];
    }
    // Container / section / frame
    if (tag === 'section' || tag === 'frame' || tag === 'div' || tag === 'main' ||
        tag === 'header' || tag === 'footer' || tag === 'aside' || tag === 'nav' ||
        role === 'section' || role === 'hero' || role === 'nav') {
      return [
        { label: 'Rebrand',       icon: '✦', action: 'rebrand',                                          title: 'Open brand picker' },
        { label: 'Scale space',   icon: '⇵', action: 'variation', kind: 'density',  value: 1.1,          title: 'Airy spacing' },
        { label: 'Responsive',    icon: '▭', action: 'responsive',                                      title: 'Generate responsive variants' },
      ];
    }
    // Fallback — generic actions
    return [
      { label: 'Rebrand',  icon: '✦', action: 'rebrand',                                       title: 'Open brand picker' },
      { label: 'Theme',    icon: '◐', action: 'toggle-theme',                                  title: 'Toggle light/dark' },
      { label: 'Ask',      icon: '?', action: 'regenerate',                                    title: 'Send to agent' },
    ];
  }
