  // ════════════════════════════════════════════════════════
  // Phase 4 Brief 4a — Components Workbench client bindings.
  //
  // Activates only on /platform/workbench/components. Wires:
  //   · Catalog filter (search input narrows visible cards)
  //   · Insert-into-scene modal + Instantiate flow
  //   · Delete master button
  //   · Per-instance row click → opens its scene with the node anchored
  //
  // Skill chips are foundation-only here — disabled in DOM by Pin #4
  // until Phase 4d wires them through the skill-bus. The chips inherit
  // the Phase 3.5 result-rendering library; binder lands в 4d.
  //
  // Pattern mirrors 155-workbench-brands.js (Phase 3a). Coexists with
  // unrelated pages — every binder early-returns when its anchor selector
  // is missing.
  // ════════════════════════════════════════════════════════

  function bindComponentsWorkbench() {
    var page = document.querySelector('[data-page="workbench-components"]');
    if (!page) return;
    bindComponentsFilter();
    bindComponentsInstantiate();
    bindComponentsDelete();
    bindComponentsInstanceClick();
  }

  function bindComponentsFilter() {
    var input = document.querySelector('[data-cw-filter]');
    var grid = document.querySelector('[data-cw-grid]');
    if (!input || !grid) return;
    input.addEventListener('input', function() {
      var q = String(input.value || '').toLowerCase().trim();
      var cards = grid.querySelectorAll('.cw-card');
      cards.forEach(function(card) {
        if (!q) { card.style.display = ''; return; }
        var text = (card.textContent || '').toLowerCase();
        var slug = String(card.getAttribute('data-component-slug') || '').toLowerCase();
        card.style.display = (text.indexOf(q) >= 0 || slug.indexOf(q) >= 0) ? '' : 'none';
      });
    });
  }

  function bindComponentsInstantiate() {
    var triggers = document.querySelectorAll('[data-cw-instantiate]');
    if (!triggers || triggers.length === 0) return;
    var modal = document.querySelector('[data-cw-instantiate-modal]');
    var form = modal && modal.querySelector('[data-cw-instantiate-form]');
    var sceneSelect = modal && modal.querySelector('[data-cw-instantiate-scene]');
    var errorEl = modal && modal.querySelector('[data-cw-instantiate-error]');
    var cancelBtn = modal && modal.querySelector('[data-cw-instantiate-cancel]');
    var submitBtn = modal && modal.querySelector('[data-cw-instantiate-submit]');

    function showError(msg) {
      if (!errorEl) return;
      errorEl.textContent = msg || '';
      errorEl.hidden = !msg;
    }
    function open() {
      showError('');
      if (modal && typeof modal.showModal === 'function') modal.showModal();
      else if (modal) modal.setAttribute('open', '');
    }
    function close() {
      if (modal && typeof modal.close === 'function') modal.close();
      else if (modal) modal.removeAttribute('open');
    }

    Array.prototype.forEach.call(triggers, function(trig) {
      trig.addEventListener('click', async function(e) {
        e.preventDefault();
        if (trig.disabled) return;
        var slug = trig.getAttribute('data-cw-slug') || '';
        if (!slug) return;
        // Resolve scene options from the modal — server already populated
        // them from the workbench data. Single-scene case: skip the modal,
        // instantiate immediately under the scene root.
        var options = sceneSelect ? sceneSelect.querySelectorAll('option:not([disabled])') : [];
        if (!modal || options.length === 0) {
          flash('No open scene to insert into', 'error');
          return;
        }
        if (options.length === 1) {
          await doInstantiate(slug, options[0].value);
          return;
        }
        if (form) form.setAttribute('data-cw-slug', slug);
        open();
      });
    });

    if (cancelBtn) {
      cancelBtn.addEventListener('click', function(e) { e.preventDefault(); close(); });
    }
    if (form) {
      form.addEventListener('submit', async function(e) {
        e.preventDefault();
        var slug = form.getAttribute('data-cw-slug') || '';
        var sceneId = sceneSelect ? sceneSelect.value : '';
        if (!slug || !sceneId) {
          showError('component slug and scene required');
          return;
        }
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Inserting…';
        }
        try {
          await doInstantiate(slug, sceneId);
          close();
        } catch (err) {
          showError((err && err.message) || 'instantiate failed');
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Insert';
          }
        }
      });
    }
  }

  async function doInstantiate(slug, sceneId) {
    try {
      var res = await api('/platform/api/workbench/components/instantiate', {
        slug: slug,
        sceneId: sceneId,
      });
      flash('Instance inserted', 'success');
      // Reload the workbench page so the Instances section reflects the
      // new instance (cheaper than re-rendering the strip in JS).
      setTimeout(function() { window.location.reload(); }, 250);
      return res;
    } catch (err) {
      flash('Insert failed', 'error');
      throw err;
    }
  }

  function bindComponentsDelete() {
    var btn = document.querySelector('[data-cw-delete]');
    if (!btn) return;
    btn.addEventListener('click', async function(e) {
      e.preventDefault();
      if (btn.disabled) return;
      var slug = btn.getAttribute('data-cw-slug') || '';
      if (!slug) return;
      var confirmed = window.confirm('Delete component master "' + slug + '"? Existing instances will become "missing master" warnings.');
      if (!confirmed) return;
      btn.disabled = true;
      try {
        await api('/platform/api/workbench/components/delete', { slug: slug });
        flash('Component deleted', 'success');
        window.location.href = '/platform/workbench/components';
      } catch (err) {
        flash('Delete failed', 'error');
        btn.disabled = false;
      }
    });
  }

  function bindComponentsInstanceClick() {
    var list = document.querySelector('[data-cw-instances]');
    if (!list) return;
    // Visual feedback only — the row already wraps an <a> to the scene.
    list.addEventListener('mouseenter', function() {}, true);
  }
