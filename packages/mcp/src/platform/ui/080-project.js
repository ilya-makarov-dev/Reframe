  // ── Project canvas (pan/zoom surface) ────────────────
  //
  // Figma-style canvas view for /platform/project/:slug. Artboards are
  // absolutely-positioned iframes inside a world div that gets panned
  // and zoomed via a single CSS transform. Interactions:
  //   - wheel               → zoom anchored on cursor
  //   - cmd+wheel / trackpad pinch → also zoom
  //   - space+drag          → pan (Figma convention)
  //   - middle-mouse drag   → pan
  //   - 0                   → fit to screen
  //   - 1                   → actual size (100%)
  //   - +/-                 → zoom step
  //   - Esc                 → back to dashboard
  //
  // Iframes are lazy-loaded via IntersectionObserver: only artboards
  // currently in the visible viewport get their src set. This keeps a
  // 50-variant project viable (otherwise ~3MB of HTML + compositor death).
  function bindCanvas() {
    var viewport = $('[data-canvas-viewport]');
    if (!viewport) return;
    var world = $('[data-canvas-world]');
    if (!world) return;
    // Prefer the new viewport-area.canvas-mode wrapper; fall back to the
    // legacy .canvas-page if some page still uses it.
    var page = viewport.closest('.viewport-area.canvas-mode') || viewport.closest('.canvas-page');
    if (!page) return;
    var contentW = parseFloat(page.getAttribute('data-content-w') || '0') || 1440;
    var contentH = parseFloat(page.getAttribute('data-content-h') || '0') || 900;

    var state = { scale: 1, tx: 0, ty: 0, spaceDown: false, panning: false };
    var MIN_SCALE = 0.05;
    var MAX_SCALE = 3;

    function apply() {
      world.style.transform = 'translate(' + state.tx + 'px,' + state.ty + 'px) scale(' + state.scale + ')';
      var label = $('[data-canvas-zoom-level]');
      if (label) label.textContent = Math.round(state.scale * 100) + '%';
    }

    function clampScale(s) {
      return Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
    }

    // Initial/reset view: show content at 100% native scale, centered
    // horizontally. If the content is taller than the viewport, align
    // the top with a small padding so the user can pan down to see
    // the rest. Never shrink content below 100% by default — user
    // explicitly pressing Fit-to-screen or "0" still calls fitAll().
    function initialView() {
      var vw = viewport.clientWidth;
      var vh = viewport.clientHeight;
      state.scale = 1;
      state.tx = (vw - contentW) / 2;
      if (contentH > vh) {
        state.ty = 40; // top-align with small breathing room
      } else {
        state.ty = (vh - contentH) / 2;
      }
      apply();
    }

    // True fit-to-screen — scales content to fit completely within
    // the viewport. Bound to the zoom "fit" button and the 0 key. Caps
    // at 100% so small content doesn't get scaled up artificially.
    function fitAll() {
      var vw = viewport.clientWidth;
      var vh = viewport.clientHeight;
      var pad = 40;
      var sx = (vw - pad * 2) / contentW;
      var sy = (vh - pad * 2) / contentH;
      state.scale = clampScale(Math.min(sx, sy, 1));
      state.tx = (vw - contentW * state.scale) / 2;
      state.ty = (vh - contentH * state.scale) / 2;
      apply();
    }

    // Back-compat alias — the old name was used widely in this file.
    var fitToScreen = initialView;

    function zoomAtPoint(newScale, px, py) {
      newScale = clampScale(newScale);
      // Keep the point (px, py) in viewport coords fixed under the cursor.
      // world coord = (px - tx) / scale  →  should remain constant
      var worldX = (px - state.tx) / state.scale;
      var worldY = (py - state.ty) / state.scale;
      state.scale = newScale;
      state.tx = px - worldX * state.scale;
      state.ty = py - worldY * state.scale;
      apply();
    }

    // Wheel → zoom (cmd/ctrl+wheel or trackpad pinch recognized as ctrl+wheel)
    viewport.addEventListener('wheel', function(e) {
      e.preventDefault();
      var rect = viewport.getBoundingClientRect();
      var px = e.clientX - rect.left;
      var py = e.clientY - rect.top;
      if (e.ctrlKey || e.metaKey) {
        // Pinch or cmd+wheel — precise zoom
        var delta = -e.deltaY * 0.01;
        zoomAtPoint(state.scale * (1 + delta), px, py);
      } else if (e.shiftKey) {
        // Shift+wheel → horizontal pan
        state.tx -= e.deltaY;
        apply();
      } else {
        // Plain wheel → vertical pan (like a normal scroll surface)
        // — unless you want to also zoom, in which case swap with cmd.
        // Figma defaults to pan on scroll; we follow that.
        state.tx -= e.deltaX;
        state.ty -= e.deltaY;
        apply();
      }
    }, { passive: false });

    // Space-to-pan (Figma convention)
    window.addEventListener('keydown', function(e) {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.code === 'Space' && !state.spaceDown) {
        state.spaceDown = true;
        viewport.classList.add('space-down');
        e.preventDefault();
      } else if (e.key === '0') {
        fitAll();
      } else if (e.key === '1') {
        var rect = viewport.getBoundingClientRect();
        zoomAtPoint(1, rect.width / 2, rect.height / 2);
      } else if (e.key === '+' || e.key === '=') {
        var r = viewport.getBoundingClientRect();
        zoomAtPoint(state.scale * 1.2, r.width / 2, r.height / 2);
      } else if (e.key === '-' || e.key === '_') {
        var r2 = viewport.getBoundingClientRect();
        zoomAtPoint(state.scale / 1.2, r2.width / 2, r2.height / 2);
      } else if (e.key === 'Escape') {
        window.location.href = '/platform';
      }
    });
    window.addEventListener('keyup', function(e) {
      if (e.code === 'Space') {
        state.spaceDown = false;
        viewport.classList.remove('space-down');
      }
    });

    // ── Artboard selection + drag ──────────────────────
    //
    // Figma-style behavior:
    //   · the LABEL BAR above the frame is the drag handle — mousedown
    //     there selects + optionally drags the whole artboard
    //   · the iframe body is fully interactive — clicks/scrolls inside
    //     the scene work naturally, nothing intercepts them
    //   · click on empty canvas → deselect + pan
    //   · space-bar / middle-click → pan regardless
    //   · Escape → deselect
    //
    // No hit overlay, no double-click-to-enter — those proved fiddly.
    // Grabbing the title bar is the one universal Figma convention, and
    // it keeps the scene itself untouched for normal interaction.
    function deselectAll() {
      $$('.canvas-artboard.selected').forEach(function(a) { a.classList.remove('selected'); });
    }

    // Drag to pan OR drag an artboard — decided on mousedown target.
    viewport.addEventListener('mousedown', function(e) {
      if (e.button !== 0 && e.button !== 1) return;

      // Clicks on floating chrome (toolbar buttons, zoom widget) must not
      // start a pan or a selection — let the button handle its own click.
      if (e.target.closest && (
        e.target.closest('.canvas-tools-float') ||
        e.target.closest('.canvas-zoom-float') ||
        e.target.closest('button') ||
        e.target.closest('[data-canvas-action]')
      )) return;

      // Middle-click / space+drag → always pan.
      var forcePan = state.spaceDown || e.button === 1;

      // Label bar = drag handle. Only mousedowns that land on the label
      // start an artboard drag. Clicks on the iframe body pass through to
      // the scene (pointer-events: auto on the iframe).
      var label = e.target.closest && e.target.closest('.canvas-artboard-label');
      var artboard = label ? label.closest('.canvas-artboard') : null;

      // Open-in-isolation link (if any artboard still has one) — let it work.
      if (e.target.closest && e.target.closest('.canvas-artboard-open')) return;

      // ── Pan branch ──
      if (forcePan || !artboard) {
        // Clicking on empty canvas also clears selection.
        if (!artboard && !forcePan) deselectAll();
        e.preventDefault();
        state.panning = true;
        viewport.classList.add('panning');
        var startX = e.clientX;
        var startY = e.clientY;
        var startTx = state.tx;
        var startTy = state.ty;
        function onMovePan(mv) {
          state.tx = startTx + (mv.clientX - startX);
          state.ty = startTy + (mv.clientY - startY);
          apply();
        }
        function onUpPan() {
          state.panning = false;
          viewport.classList.remove('panning');
          window.removeEventListener('mousemove', onMovePan);
          window.removeEventListener('mouseup', onUpPan);
        }
        window.addEventListener('mousemove', onMovePan);
        window.addEventListener('mouseup', onUpPan);
        return;
      }

      // ── Artboard branch (label grab) ──
      e.preventDefault();
      deselectAll();
      artboard.classList.add('selected');

      var startX = e.clientX;
      var startY = e.clientY;
      var startLeft = parseFloat(artboard.style.left || '0') || 0;
      var startTop = parseFloat(artboard.style.top || '0') || 0;
      var moved = false;
      var dragThreshold = 3; // px before we commit to a drag

      function onMoveAb(mv) {
        var dx = mv.clientX - startX;
        var dy = mv.clientY - startY;
        if (!moved && (Math.abs(dx) > dragThreshold || Math.abs(dy) > dragThreshold)) {
          moved = true;
          artboard.classList.add('dragging');
        }
        if (moved) {
          // Screen delta → world delta: divide by current zoom.
          artboard.style.left = (startLeft + dx / state.scale) + 'px';
          artboard.style.top  = (startTop  + dy / state.scale) + 'px';
        }
      }
      function onUpAb() {
        artboard.classList.remove('dragging');
        window.removeEventListener('mousemove', onMoveAb);
        window.removeEventListener('mouseup', onUpAb);
      }
      window.addEventListener('mousemove', onMoveAb);
      window.addEventListener('mouseup', onUpAb);
    });

    // Escape clears current selection (doesn't navigate away — that's
    // the outer keydown handler a few lines up, which still fires if
    // nothing was selected).
    window.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        var anySel = document.querySelector('.canvas-artboard.selected');
        if (anySel) { deselectAll(); e.stopPropagation(); }
      }
    }, true);

    // Toolbar buttons
    $$('[data-canvas-action]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var action = btn.getAttribute('data-canvas-action');
        var rect = viewport.getBoundingClientRect();
        if (action === 'fit') fitAll();
        else if (action === 'zoom-in') zoomAtPoint(state.scale * 1.2, rect.width / 2, rect.height / 2);
        else if (action === 'zoom-out') zoomAtPoint(state.scale / 1.2, rect.width / 2, rect.height / 2);
        else if (action === 'zoom-100') zoomAtPoint(1, rect.width / 2, rect.height / 2);
      });
    });

    // Initial fit — run on next frame so viewport has its real size.
    requestAnimationFrame(fitToScreen);
    window.addEventListener('resize', fitToScreen);

    // After an iframe finishes loading, read the actual rendered content
    // height and resize the artboard wrapper to match. Scene dimensions
    // stored at compile time (1440x1080) are the DECLARED root size,
    // but a full landing page naturally extends beyond that — iframes
    // default to showing scrollbars in the clipped area, which looks
    // like a cropped "window" instead of the whole artboard. Measuring
    // scrollHeight via contentDocument gives us the true height so we
    // can show the scene edge-to-edge.
    function resizeArtboardToContent(iframe, artboard) {
      try {
        var doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
        if (!doc || !doc.body) return;
        // Force the body to NOT scroll — we want natural height to flow
        // out instead of being clipped inside the iframe. Once the body
        // overflows we'll expand the artboard to match.
        try {
          doc.documentElement.style.overflow = 'hidden';
          doc.body.style.overflow = 'hidden';
        } catch (_) {}
        var contentH = Math.max(
          doc.body.scrollHeight,
          doc.documentElement ? doc.documentElement.scrollHeight : 0
        );
        var contentWidth = Math.max(
          doc.body.scrollWidth,
          doc.documentElement ? doc.documentElement.scrollWidth : 0
        );
        var declaredH = parseFloat(artboard.getAttribute('data-artboard-h') || '0') || 0;
        var declaredW = parseFloat(artboard.getAttribute('data-artboard-w') || '0') || 0;
        // Only grow — never shrink below declared (scenes with shorter
        // actual content than declared should keep the declared size).
        if (contentH > declaredH && contentH > 0) {
          artboard.style.height = contentH + 'px';
          // Bump the world content bounds so fitAll accounts for it.
          var newContentH = parseFloat(artboard.style.top || '0') + contentH;
          if (newContentH > contentH) contentH = newContentH;
          if (newContentH > (parseFloat(page.getAttribute('data-content-h') || '0') || 0)) {
            page.setAttribute('data-content-h', String(newContentH));
          }
        }
        if (contentWidth > declaredW && contentWidth > 0) {
          artboard.style.width = contentWidth + 'px';
        }
      } catch (_) {
        // Cross-origin or not-yet-loaded — ignore, fallback to declared dims
      }
    }

    function wireIframeLoad(iframe, artboard) {
      iframe.addEventListener('load', function() {
        resizeArtboardToContent(iframe, artboard);
        // Some browsers compute layout asynchronously — re-measure after
        // the next frame to catch late reflows (fonts, images).
        requestAnimationFrame(function() {
          resizeArtboardToContent(iframe, artboard);
        });
      });
    }

    // Lazy iframe loading via IntersectionObserver. Viewport is the
    // world itself, but IntersectionObserver observes against the
    // viewport element (which is what the user actually sees). We use
    // a rootMargin so artboards just outside the visible area
    // preload, and loaded iframes stay in place (we don't unload
    // them — trading memory for instant re-visits). Each iframe gets
    // a load listener that measures actual content height after
    // render and grows the artboard accordingly.
    if ('IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (!entry.isIntersecting) return;
          var artboard = entry.target;
          var iframe = artboard.querySelector('iframe[data-lazy-src]');
          if (iframe) {
            wireIframeLoad(iframe, artboard);
            iframe.src = iframe.getAttribute('data-lazy-src');
            iframe.removeAttribute('data-lazy-src');
            artboard.classList.add('loaded');
          }
        });
      }, {
        root: viewport,
        rootMargin: '400px',
        threshold: 0,
      });
      $$('.canvas-artboard').forEach(function(a) { observer.observe(a); });
    } else {
      // Fallback — load everything (older browser / non-IO environment)
      $$('.canvas-artboard').forEach(function(artboard) {
        var iframe = artboard.querySelector('iframe[data-lazy-src]');
        if (iframe) {
          wireIframeLoad(iframe, artboard);
          iframe.src = iframe.getAttribute('data-lazy-src');
          iframe.removeAttribute('data-lazy-src');
        }
        artboard.classList.add('loaded');
      });
    }
  }

  // ── Dashboard scenario tabs ──────────────────────────
  // Top-row pills (All / Originals / Variants / Brand rebrands / Drafts)
  // filter the scene grid. Pure client-side — each card has a
  // data-scenarios attribute computed server-side (e.g. all + variants
  // + brands), and we toggle display:none based on which pill is active.
  function bindScenarioTabs() {
    var tabs = $$('.overview-scenario');
    if (tabs.length === 0) return;
    var cards = $$('.overview-grid .overview-card-wrap');
    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        var scenario = tab.getAttribute('data-scenario') || 'all';
        tabs.forEach(function(t) {
          var on = t === tab;
          t.classList.toggle('active', on);
          t.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        cards.forEach(function(card) {
          var scenarios = (card.getAttribute('data-scenarios') || '').split(/s+/);
          var match = scenario === 'all' || scenarios.indexOf(scenario) !== -1;
          card.style.display = match ? '' : 'none';
        });
      });
    });
  }

  // ── Custom confirm modal ────────────────────────────
  // Replaces native window.confirm() with a themed modal. Returns a
  // Promise so callers can await the user choice. ESC cancels, Enter
  // confirms. Cancel button has focus by default for destructive
  // actions so keyboard users don't accidentally fire them.
  function customConfirm(opts) {
    return new Promise(function(resolve) {
      var backdrop = document.createElement('div');
      backdrop.className = 'confirm-backdrop';
      var isDanger = opts.kind === 'danger';
      backdrop.innerHTML =
        '<div class="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">' +
          '<div class="confirm-icon ' + (isDanger ? 'danger' : '') + '">' +
            (isDanger
              ? '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M5 6l1 14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-14M10 11v6M14 11v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
              : '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.6"/><path d="M12 8v4M12 16h.01" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>') +
          '</div>' +
          '<h2 class="confirm-title" id="confirm-title">' + (opts.title || 'Are you sure?') + '</h2>' +
          (opts.message ? '<p class="confirm-message">' + opts.message + '</p>' : '') +
          '<div class="confirm-actions">' +
            '<button class="confirm-btn confirm-cancel" type="button">' + (opts.cancelText || 'Cancel') + '</button>' +
            '<button class="confirm-btn ' + (isDanger ? 'confirm-danger' : 'confirm-primary') + '" type="button">' + (opts.confirmText || 'Confirm') + '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(backdrop);

      // Trigger the enter-animation on next frame (CSS transitions only
      // fire after the element is in the DOM).
      requestAnimationFrame(function() { backdrop.classList.add('visible'); });

      var cancelBtn = backdrop.querySelector('.confirm-cancel');
      var confirmBtn = backdrop.querySelector('.confirm-btn:not(.confirm-cancel)');

      function cleanup(result) {
        backdrop.classList.remove('visible');
        document.removeEventListener('keydown', onKey);
        setTimeout(function() {
          backdrop.parentNode && backdrop.parentNode.removeChild(backdrop);
        }, 180);
        resolve(result);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); cleanup(false); }
        else if (e.key === 'Enter') { e.preventDefault(); cleanup(true); }
      }
      cancelBtn.addEventListener('click', function() { cleanup(false); });
      confirmBtn.addEventListener('click', function() { cleanup(true); });
      backdrop.addEventListener('click', function(e) {
        if (e.target === backdrop) cleanup(false);
      });
      document.addEventListener('keydown', onKey);
      // Focus cancel by default for destructive actions (safer) — user
      // has to deliberately tab or click to the red button.
      setTimeout(function() { cancelBtn.focus(); }, 0);
    });
  }

  // ── Dashboard: delete project (all variants) ─────────
  function bindOverviewProjectDelete() {
    $$('.overview-grid [data-action="delete-project"]').forEach(function(btn) {
      btn.addEventListener('click', function(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var wrap = btn.closest('.overview-card-wrap');
        if (!wrap) return;
        var projectSlug = wrap.getAttribute('data-project-slug') || '';
        var name = wrap.getAttribute('data-project-name') || 'this project';
        if (!projectSlug) return;

        customConfirm({
          kind: 'danger',
          title: 'Delete project?',
          message: '<strong>' + name + '</strong> and all its variants will be removed — from the current session and from disk. This cannot be undone.',
          confirmText: 'Delete project',
          cancelText: 'Keep',
        }).then(function(ok) {
          if (!ok) return;

          btn.setAttribute('disabled', 'true');
          btn.style.opacity = '0.5';

          // Fetch the scene list, filter by project grouping, delete each.
          // We compute membership client-side by matching the owner slug
          // and derived variants — simpler to delete from the scene list
          // returned by the server which has the same grouping logic.
          fetch('/scenes').then(function(r) { return r.json(); }).then(function(scenes) {
            // Match members: owner slug == projectSlug, or derived
            // variants share the common prefix of the owner.
            var prefix = projectSlug.split(/[-_]/)[0].toLowerCase();
            var toDelete = scenes.filter(function(s) {
              var slug = (s.slug || '').toLowerCase();
              return slug === projectSlug.toLowerCase() || slug.indexOf(prefix) === 0;
            });
            var deletes = toDelete.map(function(s) {
              return fetch('/scenes/remove', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sceneId: s.id }),
              }).then(function(r) { return r.json(); });
            });
            return Promise.all(deletes);
          }).then(function() {
            wrap.style.transition = 'opacity 160ms, transform 160ms';
            wrap.style.opacity = '0';
            wrap.style.transform = 'scale(0.96)';
            setTimeout(function() {
              wrap.parentNode && wrap.parentNode.removeChild(wrap);
            }, 180);
          }).catch(function(err) {
            btn.removeAttribute('disabled');
            btn.style.opacity = '';
            flash('Delete failed: ' + err, 'error');
          });
        });
      });
    });
  }

  // ── Dashboard: delete scene button ───────────────────
  // Each overview card has a hover-revealed delete button. Clicking it
  // opens a themed confirm modal, POSTs to /scenes/remove (which
  // deletes from both the session store and the project on disk via
  // io.deleteScene), then removes the card from the DOM. SSE
  // 'scene:deleted' also fires so any other open dashboards stay in sync.
  function bindOverviewDelete() {
    $$('.overview-grid [data-action="delete-scene"]').forEach(function(btn) {
      btn.addEventListener('click', function(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var wrap = btn.closest('.overview-card-wrap');
        if (!wrap) return;
        var sceneId = wrap.getAttribute('data-scene-id') || '';
        var name = wrap.getAttribute('data-scene-name') || 'this scene';
        if (!sceneId) return;

        customConfirm({
          kind: 'danger',
          title: 'Delete scene?',
          message: '<strong>' + name + '</strong> will be removed from this project — both from the current session and from disk. This cannot be undone.',
          confirmText: 'Delete',
          cancelText: 'Keep',
        }).then(function(ok) {
          if (!ok) return;

          // Disable the button during the round-trip so repeated clicks
          // can't fire multiple deletes.
          btn.setAttribute('disabled', 'true');
          btn.style.opacity = '0.5';

          fetch('/scenes/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sceneId: sceneId }),
          })
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (data && data.ok) {
                // Animate out, then remove
                wrap.style.transition = 'opacity 160ms, transform 160ms';
                wrap.style.opacity = '0';
                wrap.style.transform = 'scale(0.96)';
                setTimeout(function() {
                  wrap.parentNode && wrap.parentNode.removeChild(wrap);
                  updateScenarioCounts();
                }, 180);
              } else {
                btn.removeAttribute('disabled');
                btn.style.opacity = '';
                flash('Delete failed: ' + (data && data.error || 'unknown'), 'error');
              }
            })
            .catch(function(err) {
              btn.removeAttribute('disabled');
              btn.style.opacity = '';
              flash('Delete failed: ' + err, 'error');
            });
        });
      });
    });
  }

  // Re-count scenes in each scenario bucket and update the pill labels
  // after a card is removed.
  function updateScenarioCounts() {
    var cards = $$('.overview-grid .overview-card-wrap');
    var counts = { all: 0, originals: 0, variants: 0, brands: 0, drafts: 0 };
    cards.forEach(function(card) {
      var scenarios = (card.getAttribute('data-scenarios') || '').split(/s+/);
      scenarios.forEach(function(s) {
        if (counts[s] !== undefined) counts[s]++;
      });
    });
    $$('.overview-scenario').forEach(function(tab) {
      var kind = tab.getAttribute('data-scenario') || 'all';
      var countEl = tab.querySelector('.count');
      if (countEl && counts[kind] !== undefined) countEl.textContent = String(counts[kind]);
    });
    // Update the subtitle "N scenes in this project"
    var sub = $('.overview-subtitle');
    if (sub && counts.all >= 0) {
      var brand = sub.textContent && sub.textContent.indexOf(' · ') >= 0 ? sub.textContent.split(' · ')[1] : '';
      sub.textContent = counts.all + ' scene' + (counts.all === 1 ? '' : 's') + ' in this project' + (brand ? ' · ' + brand : '');
    }
  }

  function bindEmptyLauncher() {
    $$('.empty-path').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var kind = btn.getAttribute('data-kind');
        if (kind === 'describe') {
          showVerbPanel('Describe a scene',
            '<input class="ask-input" type="text" placeholder="Describe what you want to create…" data-vp-field="text">' +
            '<div class="ask-hint">The AI agent will design it for you</div>',
            function(panel) {
              var input = panel.querySelector('[data-vp-field="text"]');
              var text = input ? input.value.trim() : '';
              if (!text) return;
              api('/platform/api/intent/add', {
                parts: [{ kind: 'scope', value: 'project' }, { kind: 'text', value: text }, { kind: 'explore', count: 1 }],
              }).then(function() { flash('Intent queued', 'success'); location.reload(); }).catch(function() {});
            }
          );
        } else if (kind === 'url') {
          showVerbPanel('Import from URL',
            '<input class="ask-input" type="url" placeholder="https://example.com" data-vp-field="url">' +
            '<div class="ask-hint">Extract design system and import the page</div>',
            function(panel) {
              var input = panel.querySelector('[data-vp-field="url"]');
              var url = input ? input.value.trim() : '';
              if (!url) return;
              flash('Importing…', 'info');
              api('/platform/api/import', { url: url })
                .then(function(data) {
                  if (data && data.slug) {
                    flash('Imported! Redirecting…', 'success');
                    location.href = '/platform/scene/' + data.slug;
                  } else {
                    flash('Import failed', 'error');
                  }
                })
                .catch(function() { flash('Import failed', 'error'); });
            }
          );
        } else if (kind === 'brand') {
          openBrandBrowser();
        } else if (kind === 'html') {
          showVerbPanel('Paste HTML',
            '<textarea class="ask-input" style="height:160px;resize:vertical;font-family:var(--mono);font-size:12px" data-vp-field="html" placeholder="Paste your full HTML here…"></textarea>' +
            '<div style="margin-top:12px"><label style="font-size:12px;color:var(--text-muted)">Brand (optional):</label>' +
            '<input class="ask-input" type="text" placeholder="e.g. stripe, airbnb, linear" data-vp-field="brand" style="margin-top:4px;font-size:13px"></div>' +
            '<div class="ask-hint">Compiles HTML into a scene. Add brand to auto-rebrand.</div>',
            function(panel) {
              var textarea = panel.querySelector('[data-vp-field="html"]');
              var brandInput = panel.querySelector('[data-vp-field="brand"]');
              var html = textarea ? textarea.value.trim() : '';
              var brand = brandInput ? brandInput.value.trim() : '';
              if (!html) return;
              flash('Compiling…', 'info');
              var body = { html: html };
              if (brand) body.brand = brand;
              api('/platform/api/import', body)
                .then(function(data) {
                  if (data && data.slug) {
                    flash('Compiled! Redirecting…', 'success');
                    location.href = '/platform/scene/' + data.slug;
                  } else {
                    flash('Compile failed', 'error');
                  }
                })
                .catch(function() { flash('Compile failed', 'error'); });
            }
          );
        } else if (kind === 'audit') {
          showVerbPanel('Quality Audit',
            '<textarea class="ask-input" style="height:160px;resize:vertical;font-family:var(--mono);font-size:12px" data-vp-field="html" placeholder="Paste HTML to audit…"></textarea>' +
            '<div class="ask-hint">Compiles and runs 37 audit rules + 8 aesthetic quality metrics.</div>',
            function(panel) {
              var textarea = panel.querySelector('[data-vp-field="html"]');
              var html = textarea ? textarea.value.trim() : '';
              if (!html) return;
              flash('Auditing…', 'info');
              api('/platform/api/import', { html: html })
                .then(function(data) {
                  if (data && data.slug) {
                    flash('Audit complete! Redirecting…', 'success');
                    // Redirect and auto-open quality tab
                    location.href = '/platform/scene/' + data.slug + '?tab=quality';
                  } else {
                    flash('Audit failed', 'error');
                  }
                })
                .catch(function() { flash('Audit failed', 'error'); });
            }
          );
        } else if (kind === 'blocks') {
          window.location.href = '/platform/blocks';
        } else if (kind === 'create-canvas') {
          // Create an empty canvas (1440x900 frame) and navigate to it.
          flash('Creating canvas…', 'info');
          api('/platform/api/import', {
            html: '<div style="width:1440px;min-height:900px;background:#f5f5f4"></div>',
          }).then(function(data) {
            if (data && data.slug) {
              // Navigate directly to project page (scene route redirects anyway)
              location.href = '/platform/project/' + data.slug;
            } else {
              flash('Failed to create canvas', 'error');
            }
          }).catch(function(e) { flash('Failed: ' + e.message, 'error'); });
        }
      });
    });
  }

  // ── Keyboard shortcuts ───────────────────────────────
  function bindKeyboard() {
    document.addEventListener('keydown', function(e) {
      const tag = (e.target || {}).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      // In a gesture submode (lasso/brush/drag/echo/etc): Enter commits,
      // Escape cancels. These are "already inside edit mode plus a verb".
      if (state.mode) {
        if (e.key === 'Enter') { commitMode(); e.preventDefault(); return; }
        if (e.key === 'Escape') { exitMode('cancelled'); e.preventDefault(); return; }
        return;
      }

      // Thread panel open → Escape closes it before anything else.
      const threadPanelOpen = $('[data-thread-panel]') && !$('[data-thread-panel]').classList.contains('hidden');
      if (threadPanelOpen && e.key === 'Escape') {
        closeThreadPanel();
        e.preventDefault();
        return;
      }

      // Command-K: open/close command palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggleCommandPalette();
        return;
      }

      // "E" toggles edit mode globally (view ↔ edit). This is the PRIMARY
      // hotkey — everything else lives inside edit mode. When already in
      // edit mode with a selection, "e" maps to the Echo verb instead
      // (the two don't conflict because selection gates verb hotkeys).
      if (e.key === 'e' && !state.selection.inode) {
        setEditMode(!state.editMode);
        e.preventDefault();
        return;
      }

      // Tab / Shift+Tab — cycle focus through visible annotation marks.
      // Works in BOTH modes — marks are persistent, user can scan them
      // even when not editing.
      if (e.key === 'Tab' && !threadPanelOpen) {
        if (cycleMarkFocus(e.shiftKey ? -1 : 1)) {
          e.preventDefault();
          return;
        }
      }
      // Enter on a focused mark → open its thread.
      if (e.key === 'Enter' && state.focusedMarkId) {
        e.preventDefault();
        scrollStreamTo(state.focusedMarkId);
        return;
      }

      // Cmd+Z = undo.
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoLastOp();
        return;
      }
      // Cmd+D = duplicate selected node.
      if ((e.metaKey || e.ctrlKey) && e.key === 'd' && state.selection.inode) {
        e.preventDefault();
        handleContextAction('duplicate');
        return;
      }
      // Delete / Backspace = delete selected node.
      if ((e.key === 'Delete' || e.key === 'Backspace') && state.editMode && state.selection.inode) {
        e.preventDefault();
        handleContextAction('delete');
        return;
      }

      // Verb hotkeys — only fire in edit mode with a selected node.
      if (state.editMode && state.selection.inode) {
        const hotkeys = {
          a: 'ask',
          e: 'echo',
          p: 'pin',
          r: 'rule',
          m: 'drag',
          s: 'resonance',
          l: 'lasso',
          b: 'brush',
          t: 'time',
        };
        if (hotkeys[e.key]) { handleVerb(hotkeys[e.key]); e.preventDefault(); return; }
      }

      if (e.key === 'Escape') {
        clearMarkFocus();
        if (state.selection.inode) {
          clearSelection();
        } else if (state.editMode) {
          // Empty selection + Escape → leave edit mode entirely.
          setEditMode(false);
        }
        return;
      }
    });
  }

  function cycleMarkFocus(dir) {
    const els = $$('.annotation-marks-html .mark[data-ann]');
    if (els.length === 0) return false;
    const ids = els.map(function(el) { return el.getAttribute('data-ann'); });
    let idx = ids.indexOf(state.focusedMarkId);
    idx = (idx + dir + ids.length) % ids.length;
    if (idx < 0) idx = ids.length - 1;
    state.focusedMarkId = ids[idx];
    els.forEach(function(el) { el.classList.remove('focused'); });
    els[idx].classList.add('focused');
    return true;
  }

  function clearMarkFocus() {
    state.focusedMarkId = null;
    $$('.annotation-marks-html .mark.focused').forEach(function(el) { el.classList.remove('focused'); });
  }