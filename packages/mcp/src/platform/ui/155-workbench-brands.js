  // ════════════════════════════════════════════════════════
  // Phase 3 Brief 3a — Brand Workbench client bindings.
  //
  // Activates only on /platform/workbench/brands. Wires:
  //   · Catalog filter (search input narrows visible cards)
  //   · Apply dropdown (scene / project default / global default)
  //   · Scenes-strip click → switch preview iframe to selected scene
  //   · Scoped SSE subscriber → reload preview iframe on
  //     brand:applied/brand:edited matching this workbench
  //
  // The page itself is server-rendered HTML; this file is the
  // interaction layer. Designed to coexist with the rest of the
  // platform-ui bundle even on pages that never use it (early
  // returns when [data-page="workbench-brands"] is absent).
  // ════════════════════════════════════════════════════════

  function bindBrandWorkbench() {
    var page = document.querySelector('[data-page="workbench-brands"]');
    if (!page) return;
    bindWorkbenchFilter();
    bindWorkbenchApply();
    bindWorkbenchSceneStrip();
    bindWorkbenchScopedEvents();
    // Phase 3 Brief 3b — editor surfaces.
    bindWorkbenchTokenEditors();
    bindWorkbenchVocabEditor();
    bindWorkbenchTypographyEditor();
    // Phase 3 Brief 3d — Brand Mark + Remix + follows-active-scene.
    bindWorkbenchMarkUpload();
    bindWorkbenchRemixModal();
    bindWorkbenchFollowScene();
    // Phase 3.5 Pin #6 — skill bus invocation chips + event log.
    bindWorkbenchSkillChips();
  }

  function bindWorkbenchFilter() {
    var input = document.querySelector('[data-bw-filter]');
    var grid = document.querySelector('[data-bw-grid]');
    if (!input || !grid) return;
    input.addEventListener('input', function() {
      var q = String(input.value || '').toLowerCase().trim();
      var cards = grid.querySelectorAll('.bw-card');
      cards.forEach(function(card) {
        if (!q) { card.style.display = ''; return; }
        var name = (card.textContent || '').toLowerCase();
        var slug = String(card.getAttribute('data-brand-slug') || '').toLowerCase();
        card.style.display = (name.indexOf(q) >= 0 || slug.indexOf(q) >= 0) ? '' : 'none';
      });
    });
  }

  function bindWorkbenchApply() {
    var apply = document.querySelector('[data-bw-apply]');
    if (!apply) return;
    var slug = apply.getAttribute('data-bw-slug') || '';
    if (!slug) return;
    apply.addEventListener('click', async function(e) {
      var btn = e.target && e.target.closest && e.target.closest('[data-bw-apply-action]');
      if (!btn) return;
      e.preventDefault();
      var action = btn.getAttribute('data-bw-apply-action');
      var sceneId = apply.getAttribute('data-bw-active-scene') || '';
      btn.setAttribute('disabled', 'true');
      var origText = btn.textContent;
      btn.textContent = 'Applying…';
      try {
        if (action === 'scene' && sceneId) {
          // applyVariationToScene with kind:'rebrand' uses the existing
          // brand-apply pipeline (parseDesignMd + applyBrandInheritance +
          // emit scoped brand:applied event).
          await api('/platform/api/variations/apply', {
            sceneId: sceneId,
            kind: 'rebrand',
            value: slug,
          });
          flash('Brand applied to scene', 'success');
        } else if (action === 'project') {
          await api('/platform/api/brand/apply', { slug: slug });
          flash('Brand set as project default', 'success');
        } else if (action === 'global') {
          await api('/platform/api/brand/switch', { slug: slug });
          flash('Brand set as global default', 'success');
        }
      } catch (err) {
        flash('Apply failed', 'error');
      } finally {
        btn.removeAttribute('disabled');
        btn.textContent = origText;
        // Close the More dropdown if open.
        var more = apply.querySelector('details.bw-apply-more');
        if (more) more.removeAttribute('open');
      }
    });
  }

  function bindWorkbenchSceneStrip() {
    var strip = document.querySelector('[data-bw-scenes]');
    if (!strip) return;
    strip.addEventListener('click', function(e) {
      var btn = e.target && e.target.closest && e.target.closest('[data-bw-scene-id]');
      if (!btn) return;
      e.preventDefault();
      var sceneId = btn.getAttribute('data-bw-scene-id') || '';
      if (!sceneId) return;
      // Update the preview iframe + Apply button context. URL stays in
      // sync via history.replaceState so a hard reload preserves choice
      // (Oracle 4 — persistence-on-reload).
      var iframe = document.querySelector('[data-bw-preview]');
      var apply = document.querySelector('[data-bw-apply]');
      var slug = apply ? apply.getAttribute('data-bw-slug') : '';
      if (iframe && slug) {
        iframe.src = '/api/render/' + encodeURIComponent(sceneId) +
          '?format=html&brand=' + encodeURIComponent(slug);
      }
      if (apply) apply.setAttribute('data-bw-active-scene', sceneId);
      strip.querySelectorAll('[data-bw-scene-id]').forEach(function(b) {
        b.classList.toggle('active', b === btn);
      });
      // Reflect in URL so reload restores the same scene preview.
      try {
        var u = new URL(window.location.href);
        u.searchParams.set('scene', sceneId);
        window.history.replaceState({}, '', u.toString());
      } catch (_) {}
    });
  }

  function bindWorkbenchScopedEvents() {
    if (typeof window === 'undefined') return;
    if (!Array.isArray(window.__reframeBrandSubscribers)) {
      window.__reframeBrandSubscribers = [];
    }
    var page = document.querySelector('[data-page="workbench-brands"]');
    if (!page) return;
    var pageSlug = page.getAttribute('data-bw-slug') || '';
    var pageSceneId = page.getAttribute('data-active-scene-id') || '';
    if (!pageSlug) return;

    // Phase 3 Brief 3b Pin #5 — debounced iframe reload. Rapid token
    // edits (e.g. designer dragging through 5 swatches in <200ms) used
    // to fire 5 sequential reloads, one per scoped event. Trailing-edge
    // debounce coalesces them into a single reload at end of the burst.
    var reloadPending = null;
    function scheduleReload() {
      if (reloadPending) clearTimeout(reloadPending);
      reloadPending = setTimeout(function() {
        reloadPending = null;
        var iframe = document.querySelector('[data-bw-preview]');
        if (!iframe || !iframe.src) return;
        try {
          var u = new URL(iframe.src, window.location.origin);
          u.searchParams.set('_t', String(Date.now()));
          iframe.src = u.toString();
        } catch (_) {
          iframe.src = iframe.src + (iframe.src.indexOf('?') < 0 ? '?' : '&') + '_t=' + Date.now();
        }
      }, 180);
    }

    window.__reframeBrandSubscribers.push(function(ev) {
      if (!ev) return;
      // Reload preview iframe when this workbench's brand or scene gets
      // an update event. Other brands' events are ignored — that's the
      // whole point of scoped events vs the catch-all reload-all.
      var matches = false;
      if (ev.type === 'brand:edited' && ev.slug === pageSlug) matches = true;
      if (ev.type === 'brand:applied') {
        if (ev.slug === pageSlug) matches = true;
        if (ev.sceneId && ev.sceneId === pageSceneId) matches = true;
      }
      if (!matches) return;
      scheduleReload();
    });
  }

  // ════════════════════════════════════════════════════════
  // Phase 3 Brief 3b — Token + Vocab + Typography editors.
  //
  // All three editors share the same pattern: capture user intent,
  // POST к /platform/api/workbench/edit-* endpoint, optimistically
  // update local DOM, server emits scoped SSE on success which
  // triggers iframe reload via the existing brand:edited subscriber.
  //
  // Pin #5 — debounce rapid edits to a single iframe reload. The
  // subscriber registered in Phase 3a fires per event; here we
  // debounce iframe reloads when N edits arrive in <200ms so a
  // 5-token sweep doesn't reload-storm the preview.
  // ════════════════════════════════════════════════════════

  function workbenchSlug() {
    var page = document.querySelector('[data-page="workbench-brands"]');
    return page ? page.getAttribute('data-bw-slug') : '';
  }

  async function workbenchPost(path, body) {
    return await api(path, body);
  }

  function bindWorkbenchTokenEditors() {
    var list = document.querySelector('[data-bw-token-list]');
    if (!list) return;
    var slug = workbenchSlug();
    if (!slug) return;

    list.addEventListener('input', async function(e) {
      var input = e.target && e.target.closest && e.target.closest('[data-bw-token-color]');
      if (!input) return;
      var role = input.getAttribute('data-bw-token-role');
      var hex = String(input.value || '').trim();
      if (!role || !/^#[0-9a-f]{3,8}$/i.test(hex)) return;
      var row = input.closest('.bw-token-row');
      // Optimistic update — the hex span flips immediately so feedback
      // doesn't wait on the round-trip. Server SSE will fire iframe
      // reload independently.
      var hexEl = row.querySelector('[data-bw-token-hex]');
      if (hexEl) hexEl.textContent = hex.toLowerCase();
      try {
        await workbenchPost('/platform/api/workbench/edit-token', {
          brandSlug: slug,
          role: role,
          hex: hex,
        });
        flash('Token updated', 'success');
      } catch (_) {
        flash('Token edit failed', 'error');
      }
    });

    // "edit" trigger button just opens the native color picker. The
    // picker mounts inline because input[type=color] is the cleanest
    // affordance Chromium gives without re-implementing a full picker.
    list.addEventListener('click', function(e) {
      var trig = e.target && e.target.closest && e.target.closest('[data-bw-token-trigger]');
      if (!trig) return;
      e.preventDefault();
      var role = trig.getAttribute('data-bw-token-trigger');
      var input = list.querySelector('[data-bw-token-color][data-bw-token-role="' + role + '"]');
      if (input) input.click();
    });

    // "+ Add token" — prompt for role name + hex (foundation v1; full
    // role picker UI is Phase 3c scope per honest framing). Sends the
    // edit-token POST which auto-creates the role.
    var addBtn = document.querySelector('[data-bw-add-token]');
    if (addBtn) {
      addBtn.addEventListener('click', async function() {
        var role = window.prompt('Role name (e.g. accent, surface, primary)');
        if (!role) return;
        var hex = window.prompt('Hex color (e.g. #2b74ff)');
        if (!hex || !/^#[0-9a-f]{3,8}$/i.test(hex)) {
          flash('Invalid hex', 'error');
          return;
        }
        try {
          await workbenchPost('/platform/api/workbench/edit-token', {
            brandSlug: slug,
            role: role,
            hex: hex,
          });
          flash('Token added — reloading', 'success');
          window.location.reload();
        } catch (_) {
          flash('Add token failed', 'error');
        }
      });
    }
  }

  function bindWorkbenchVocabEditor() {
    var vocab = document.querySelector('[data-bw-vocab]');
    if (!vocab) return;
    var slug = workbenchSlug();
    if (!slug) return;

    function readWordsFromList(listKind) {
      var pills = vocab.querySelectorAll('[data-bw-vocab-list="' + listKind + '"]');
      var out = [];
      pills.forEach(function(p) {
        var w = p.getAttribute('data-bw-vocab-word');
        if (w) out.push(w);
      });
      return out;
    }

    function readStyleFields() {
      var weight = vocab.querySelector('[data-bw-vocab-style="weight"]');
      var color = vocab.querySelector('[data-bw-vocab-style="color"]');
      var decoration = vocab.querySelector('[data-bw-vocab-style="decoration"]');
      return {
        weight: weight ? Number(weight.value) : undefined,
        color: color ? color.value : undefined,
        decoration: decoration ? decoration.value : undefined,
      };
    }

    async function postPatch(patch) {
      try {
        await workbenchPost('/platform/api/workbench/edit-vocab', {
          brandSlug: slug,
          patch: patch,
        });
        flash('Vocab updated', 'success');
      } catch (_) {
        flash('Vocab edit failed', 'error');
      }
    }

    // Pill remove.
    vocab.addEventListener('click', async function(e) {
      var rm = e.target && e.target.closest && e.target.closest('[data-bw-vocab-remove]');
      if (!rm) return;
      e.preventDefault();
      var pill = rm.closest('[data-bw-vocab-pill]');
      if (!pill) return;
      var listKind = pill.getAttribute('data-bw-vocab-list');
      var word = pill.getAttribute('data-bw-vocab-word');
      pill.remove();
      var newWords = readWordsFromList(listKind);
      var patch = {};
      patch[listKind === 'power' ? 'powerWords' : 'industryTerms'] = newWords;
      await postPatch(patch);
      void word;
    });

    // Add via Enter on the input.
    vocab.addEventListener('keydown', async function(e) {
      var input = e.target && e.target.closest && e.target.closest('[data-bw-vocab-add-input]');
      if (!input || e.key !== 'Enter') return;
      e.preventDefault();
      var listKind = input.getAttribute('data-bw-vocab-add-input');
      var word = String(input.value || '').trim();
      if (!word) return;
      input.value = '';
      var existing = readWordsFromList(listKind);
      if (existing.indexOf(word) >= 0) return; // dedup
      var newWords = existing.concat(word);
      var patch = {};
      patch[listKind === 'power' ? 'powerWords' : 'industryTerms'] = newWords;
      await postPatch(patch);
      // Reload so the new pill renders with all the binders attached
      // (cheaper than re-rendering the pill DOM by hand and rewiring).
      window.location.reload();
    });

    // Style fields commit on change.
    vocab.addEventListener('change', async function(e) {
      var sel = e.target && e.target.closest && e.target.closest('[data-bw-vocab-style]');
      if (!sel) return;
      var style = readStyleFields();
      await postPatch({ style: style });
    });
  }

  function bindWorkbenchTypographyEditor() {
    var typo = document.querySelector('[data-bw-typo]');
    if (!typo) return;
    var slug = workbenchSlug();
    if (!slug) return;

    async function commit(field, value) {
      var patch = {};
      patch[field] = value;
      try {
        await workbenchPost('/platform/api/workbench/edit-typography', {
          brandSlug: slug,
          patch: patch,
        });
        flash('Typography updated', 'success');
      } catch (_) {
        flash('Typography edit failed', 'error');
      }
    }

    // Commit on blur (avoids saving every keystroke). Enter also commits
    // for designers who tab through inputs without clicking elsewhere.
    typo.addEventListener('blur', function(e) {
      var input = e.target && e.target.closest && e.target.closest('[data-bw-typo-field]');
      if (!input) return;
      var field = input.getAttribute('data-bw-typo-field');
      var value = String(input.value || '').trim();
      if (!value) return;
      commit(field, value);
      // Live preview update — display sample reflects new font without
      // round-trip wait.
      var preview = typo.querySelector('[data-bw-typo-preview="' + field + '"]');
      if (preview) {
        preview.style.fontFamily = "'" + value.replace(/['"]/g, '') + "',sans-serif";
        preview.textContent = value;
      }
    }, true);
    typo.addEventListener('keydown', function(e) {
      if (e.key !== 'Enter') return;
      var input = e.target && e.target.closest && e.target.closest('[data-bw-typo-field]');
      if (!input) return;
      e.preventDefault();
      input.blur();
    });
  }

  // ════════════════════════════════════════════════════════
  // Phase 3 Brief 3d — Brand Mark upload + Remix + Follow scene.
  // ════════════════════════════════════════════════════════

  function bindWorkbenchMarkUpload() {
    var block = document.querySelector('[data-bw-mark-block]');
    if (!block) return;
    var slug = block.getAttribute('data-bw-slug') || '';
    if (!slug) return;
    var fileInput = block.querySelector('[data-bw-mark-file]');
    var status = block.querySelector('[data-bw-mark-status]');
    var dropZone = block.querySelector('[data-bw-mark-drop]');
    var preview = block.querySelector('[data-bw-mark-preview]');
    var strip = block.querySelector('[data-bw-mark-strip]');

    function setStatus(msg, kind) {
      if (!status) return;
      status.textContent = msg || '';
      status.className = 'bw-mark-status' + (kind ? ' bw-mark-status--' + kind : '');
    }

    async function uploadFile(file) {
      if (!file) return;
      if (!/svg/i.test(file.type) && !/\.svg$/i.test(file.name)) {
        setStatus('SVG only', 'error');
        return;
      }
      // Variant name = filename stem (sans .svg), sanitised. Brief Pin #1
      // accepts /^[a-z0-9][a-z0-9-]{0,40}$/i — coerce here so the user
      // doesn't see a 400 from the server when their filename has spaces.
      var stem = String(file.name).replace(/\.svg$/i, '');
      var variant = stem.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
      if (!variant) variant = 'logo';
      setStatus('Uploading ' + variant + '…');
      var fd = new FormData();
      fd.append('file', file);
      try {
        var res = await fetch('/platform/api/brand/' + encodeURIComponent(slug) +
          '/mark/' + encodeURIComponent(variant), { method: 'POST', body: fd });
        var data = await res.json();
        if (!res.ok || !data.ok) {
          setStatus(data.error || 'upload failed', 'error');
          return;
        }
        setStatus('Uploaded — refreshing…', 'success');
        // Optimistic preview swap before the page reloads.
        var img = block.querySelector('[data-bw-mark-image]');
        var src = '/platform/api/brand/' + encodeURIComponent(slug) + '/mark/' + encodeURIComponent(variant) + '?_t=' + Date.now();
        if (img) {
          img.src = src;
          img.alt = variant;
        } else if (preview) {
          preview.innerHTML = '<img class="bw-mark-image" data-bw-mark-image src="' + src + '" alt="' + variant + '" loading="lazy">';
        }
        // Reload to refresh the variants strip + catalog card. Cheap and
        // avoids re-implementing the strip render in JS.
        setTimeout(function() { window.location.reload(); }, 250);
      } catch (e) {
        setStatus('upload failed', 'error');
      }
    }

    if (fileInput) {
      fileInput.addEventListener('change', function(e) {
        var f = e.target && e.target.files && e.target.files[0];
        if (f) uploadFile(f);
      });
    }
    if (dropZone) {
      ['dragenter', 'dragover'].forEach(function(ev) {
        dropZone.addEventListener(ev, function(e) {
          e.preventDefault();
          dropZone.classList.add('drag-over');
        });
      });
      ['dragleave', 'drop'].forEach(function(ev) {
        dropZone.addEventListener(ev, function(e) {
          e.preventDefault();
          dropZone.classList.remove('drag-over');
        });
      });
      dropZone.addEventListener('drop', function(e) {
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) uploadFile(f);
      });
    }
    // Variant strip click → preview pivots.
    if (strip) {
      strip.addEventListener('click', function(e) {
        var btn = e.target && e.target.closest && e.target.closest('[data-bw-mark-variant]');
        if (!btn) return;
        e.preventDefault();
        var variant = btn.getAttribute('data-bw-mark-variant');
        if (!variant) return;
        var img = block.querySelector('[data-bw-mark-image]');
        var src = '/platform/api/brand/' + encodeURIComponent(slug) + '/mark/' + encodeURIComponent(variant);
        if (img) {
          img.src = src;
          img.alt = variant;
        } else if (preview) {
          preview.innerHTML = '<img class="bw-mark-image" data-bw-mark-image src="' + src + '" alt="' + variant + '" loading="lazy">';
        }
        strip.querySelectorAll('[data-bw-mark-variant]').forEach(function(b) {
          b.classList.toggle('active', b === btn);
        });
      });
    }
  }

  function bindWorkbenchRemixModal() {
    var trigger = document.querySelector('[data-bw-remix]');
    var modal = document.querySelector('[data-bw-remix-modal]');
    if (!trigger || !modal) return;
    var form = modal.querySelector('[data-bw-remix-form]');
    var input = modal.querySelector('[data-bw-remix-input]');
    var copyMarks = modal.querySelector('[data-bw-remix-copy-marks]');
    var error = modal.querySelector('[data-bw-remix-error]');
    var cancelBtn = modal.querySelector('[data-bw-remix-cancel]');
    var submitBtn = modal.querySelector('[data-bw-remix-submit]');
    var sourceSlug = trigger.getAttribute('data-bw-source-slug') || '';

    function showError(msg) {
      if (!error) return;
      error.textContent = msg;
      error.hidden = !msg;
    }
    function open() {
      showError('');
      if (typeof modal.showModal === 'function') modal.showModal();
      else modal.setAttribute('open', '');
      setTimeout(function() { if (input) input.focus(); }, 30);
    }
    function close() {
      if (typeof modal.close === 'function') modal.close();
      else modal.removeAttribute('open');
    }

    trigger.addEventListener('click', function(e) {
      e.preventDefault();
      open();
    });
    if (cancelBtn) cancelBtn.addEventListener('click', function(e) { e.preventDefault(); close(); });
    if (form) {
      form.addEventListener('submit', async function(e) {
        e.preventDefault();
        var newSlug = String(input && input.value || '').trim();
        if (!/^[a-z][a-z0-9-]*$/.test(newSlug)) {
          showError('slug must start with a letter, lowercase + dash only');
          return;
        }
        if (newSlug === sourceSlug) {
          showError('new slug must differ from source');
          return;
        }
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Cloning…';
        }
        try {
          var res = await api('/platform/api/workbench/clone-brand', {
            sourceSlug: sourceSlug,
            newSlug: newSlug,
            copyMarks: !!(copyMarks && copyMarks.checked),
          });
          void res;
          close();
          flash('Remixed → ' + newSlug, 'success');
          window.location.href = '/platform/workbench/brands?slug=' + encodeURIComponent(newSlug);
        } catch (err) {
          var msg = err && err.message ? err.message : 'clone failed';
          showError(msg);
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Remix';
          }
        }
      });
    }
  }

  function bindWorkbenchFollowScene() {
    var toggle = document.querySelector('[data-bw-follow-scene]');
    if (!toggle) return;
    var STORAGE_KEY = 'reframe-workbench-follow-scene';
    var SLUG_STORAGE_KEY = 'reframe-active-scene-slug';

    // Restore toggle state from localStorage.
    try {
      var saved = window.localStorage && window.localStorage.getItem(STORAGE_KEY);
      if (saved === '1') toggle.checked = true;
    } catch (_) {}

    toggle.addEventListener('change', function() {
      try { window.localStorage.setItem(STORAGE_KEY, toggle.checked ? '1' : '0'); } catch (_) {}
    });

    // Phase 3 Brief 3d Pin #6 foundation hook — when toggle ON, listen
    // to scene-focus signals and pivot the workbench's slug. We listen
    // on the scene-pinned-brand SSE event (brand:applied with sceneId)
    // AND on a custom 'reframe:active-scene' DOM event the canvas
    // editor dispatches when selection changes. The latter wires up
    // fully in Phase 3.5; for 3d we honour the SSE path which is
    // sufficient for cross-tab pivots.
    if (typeof window === 'undefined') return;
    if (!Array.isArray(window.__reframeBrandSubscribers)) {
      window.__reframeBrandSubscribers = [];
    }
    window.__reframeBrandSubscribers.push(function(ev) {
      if (!toggle.checked) return;
      if (!ev || ev.type !== 'brand:applied') return;
      if (!ev.slug || !ev.sceneId) return;
      // The scene the designer just applied a brand to is now the
      // "active scene"; if its brand differs from the workbench's
      // current slug, pivot.
      var page = document.querySelector('[data-page="workbench-brands"]');
      var pageSlug = page ? page.getAttribute('data-bw-slug') : '';
      if (ev.slug === pageSlug) return;
      try {
        window.localStorage.setItem(SLUG_STORAGE_KEY, ev.slug);
      } catch (_) {}
      // Navigate. Avoid replaceState — full reload is correct because
      // the workbench page renders different DESIGN.md content per slug.
      window.location.href = '/platform/workbench/brands?slug=' +
        encodeURIComponent(ev.slug) +
        (ev.sceneId ? '&scene=' + encodeURIComponent(ev.sceneId) : '');
    });
  }

  // ════════════════════════════════════════════════════════
  // Phase 3.5 Pin #6 — Skill chips wire to bus.
  //
  // Each chip POSTs /skill-bus/invoke with { skill, context, requestId }.
  // The bus returns 202 + requestId immediately, then emits SSE
  // 'skill-bus:progress' + 'skill-bus:result' events. This binder
  // subscribes to those events via the existing event subscriber
  // registry and updates the inline log entries through the result-
  // rendering library (152-skill-result-render.js).
  // ════════════════════════════════════════════════════════

  function bindWorkbenchSkillChips() {
    var chipsEl = document.querySelector('[data-bw-skills]');
    var logEl = document.querySelector('[data-bw-skill-log-entries]');
    if (!chipsEl || !logEl) return;
    var slug = chipsEl.getAttribute('data-bw-slug') || '';
    var requestMap = {}; // requestId → entry DOM node

    function entryFor(requestId, skillName) {
      if (requestMap[requestId]) return requestMap[requestId];
      var div = document.createElement('div');
      div.className = 'bw-skill-log-entry';
      div.setAttribute('data-skill-log-entry', requestId);
      div.innerHTML = renderSkillProgress({ requestId: requestId, skill: skillName, phase: 'queued' });
      logEl.insertBefore(div, logEl.firstChild);
      requestMap[requestId] = div;
      return div;
    }

    chipsEl.addEventListener('click', async function(e) {
      var btn = e.target && e.target.closest && e.target.closest('[data-bw-skill]');
      if (!btn) return;
      e.preventDefault();
      var skillName = btn.getAttribute('data-bw-skill');
      var action = btn.getAttribute('data-bw-skill-action');
      var contextKind = btn.getAttribute('data-bw-skill-context-kind');
      if (!skillName) return;
      // /extract action prompts for URL — quick CRUD for the foundation
      // hook. Phase 4 may move к inline form within the chip group.
      var extra = {};
      if (action === 'extract') {
        var url = window.prompt('Brand URL to extract from?');
        if (!url) return;
        extra.url = url;
      }
      var requestId = 'r-' + Date.now().toString(36) + '-' +
        Math.random().toString(36).slice(2, 7);
      var context = Object.assign({
        kind: contextKind,
        action: action,
        brand: slug,
      }, extra);
      // Optimistic log entry — appears immediately in the queued state.
      entryFor(requestId, skillName);
      try {
        await api('/platform/api/skill-bus/invoke', {
          skill: skillName,
          context: context,
          requestId: requestId,
        });
      } catch (err) {
        // Map invoke-time error к result-error frame so the entry
        // visibly reports failure instead of silently sticking on
        // queued.
        var entry = requestMap[requestId];
        if (entry) {
          entry.innerHTML = renderSkillResult({
            requestId: requestId,
            skill: skillName,
            ok: false,
            error: (err && err.message) || 'invoke failed',
          });
          bindSkillResultActions(entry);
        }
      }
    });

    // Subscribe to bus events. The existing __reframeBrandSubscribers
    // registry was built for brand:* events; Phase 3.5 piggy-backs a
    // sibling array __reframeSkillBusSubscribers for bus events so
    // existing subscribers don't need to filter unrelated event types.
    if (!Array.isArray(window.__reframeSkillBusSubscribers)) {
      window.__reframeSkillBusSubscribers = [];
    }
    window.__reframeSkillBusSubscribers.push(function(ev) {
      if (!ev || !ev.requestId) return;
      var entry = requestMap[ev.requestId];
      if (!entry) return;
      if (ev.type === 'skill-bus:progress') {
        entry.innerHTML = renderSkillProgress({
          requestId: ev.requestId,
          skill: ev.skill,
          phase: ev.phase,
        });
      } else if (ev.type === 'skill-bus:result') {
        entry.innerHTML = renderSkillResult({
          requestId: ev.requestId,
          skill: ev.skill,
          ok: ev.ok,
          payload: ev.payload,
          error: ev.error,
        });
        bindSkillResultActions(entry, {
          handlers: {
            dismiss: function(act) {
              var card = entry.querySelector('[data-skill-request-id]');
              if (card) card.remove();
              entry.remove();
              delete requestMap[act.requestId];
            },
          },
        });
      }
    });
  }
