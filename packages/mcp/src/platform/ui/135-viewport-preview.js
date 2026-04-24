  // ── Viewport preview switcher ──
  //
  // Three-button pill in the top-right of the canvas area: Desktop,
  // Tablet, Phone. Each click routes to a REAL variant scene of the
  // current project — not a CSS mask of the desktop scene. The engine
  // owns truth: if a variant at the target dimensions already exists
  // in this project, we navigate straight to it; otherwise we POST
  // /platform/api/resize/apply, wait for the new variant, then navigate.
  //
  // Desktop button → navigate back to the project's root (shortest-slug)
  // scene. Slug layout matches the engine's adapt naming convention:
  // "<root>-<W>x<H>" for variants, bare "<root>" for the source.
  //
  // Dedup is mandatory: clicking phone three times shouldn't spawn three
  // identical variants. /platform/api/project/health enumerates every
  // member of the project with its dimensions, so we check before
  // generating.

  var VP_DIMS = {
    desktop: null,                    // owner size, no adapt needed
    tablet:  { w: 834, h: 1194 },     // iPad mini portrait, modern "tablet" baseline
    phone:   { w: 375, h: 812 },      // iPhone 13 Pro portrait
  };

  function bindViewportPreview() {
    var pill = $('[data-viewport-preview-pill]');
    if (!pill) return;
    var buttons = pill.querySelectorAll('[data-viewport-preview]');
    if (!buttons.length) return;

    var slug = state.currentSceneSlug || '';

    // Owner slug = project's root scene slug. Adapt stores variants as
    // "<root>-<W>x<H>"; stripping that suffix (only if present) yields
    // the root. If the current slug has no suffix, it IS the root.
    function computeRootSlug(s) {
      if (!s) return '';
      return s.replace(/-\d+x\d+$/, '');
    }
    var rootSlug = computeRootSlug(slug);

    // Mark the button whose dimensions match the currently-loaded scene
    // so the UI reflects where the user actually is. Read from the
    // canvas root attribute / viewport-frame to resolve the real size
    // (scene data isn't inlined on every page).
    function detectCurrentMode() {
      // Project-canvas shells mount the editor bundle which stamps width
      // on the scene root. The editor's public zoom API exposes
      // scene-root bbox via the canvas object's internal state; we don't
      // need pixel-perfect detection, just which button reads as active.
      // Approximate: current slug's "-WxH" suffix OR owner fallback.
      var m = slug.match(/-(\d+)x(\d+)$/);
      if (m) {
        var w = parseInt(m[1], 10);
        if (w <= 500) return 'phone';
        if (w <= 900) return 'tablet';
        return 'desktop';
      }
      return 'desktop';
    }

    function applyActive(mode) {
      buttons.forEach(function(b) {
        var isActive = b.getAttribute('data-viewport-preview') === mode;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
      // Mirror the mode onto <html> so scoped CSS rules (decorative
      // bezel, dynamic island pseudo, home indicator) kick in without
      // touching markup inside the editor bundle. desktop = remove so
      // the default no-frame look comes back.
      var root = document.documentElement;
      if (mode === 'desktop' || !mode) {
        root.removeAttribute('data-viewport-preview');
      } else {
        root.setAttribute('data-viewport-preview', mode);
      }
    }

    function setBusy(btn, on) {
      if (!btn) return;
      if (on) btn.setAttribute('aria-busy', 'true');
      else btn.removeAttribute('aria-busy');
    }

    // Given a target mode, fetch /platform/api/project/health, find the
    // project this scene belongs to (by rootSlug prefix or exact id),
    // and return the member whose dimensions match the requested size.
    // Returns null if no match — caller then spawns a fresh variant.
    async function findExistingVariant(targetW, targetH) {
      try {
        var r = await fetch('/platform/api/project/health');
        if (!r.ok) return null;
        var j = await r.json();
        var scenes = (j && j.scenes) || [];
        // Match strategy: scenes whose slug starts with rootSlug (same
        // project) AND whose width/height are within 2 px of the target.
        for (var i = 0; i < scenes.length; i++) {
          var sc = scenes[i];
          if (!sc || typeof sc.slug !== 'string') continue;
          if (sc.slug !== rootSlug && sc.slug.indexOf(rootSlug + '-') !== 0) continue;
          if (Math.abs((sc.width || 0) - targetW) <= 2 && Math.abs((sc.height || 0) - targetH) <= 2) {
            return sc;
          }
        }
        return null;
      } catch (_) {
        return null;
      }
    }

    async function ensureVariant(btn, mode) {
      if (mode === 'desktop') {
        // Navigate to the project root. If we're already there, no-op.
        if (slug === rootSlug) { applyActive('desktop'); return; }
        location.href = '/platform/scene/' + encodeURIComponent(rootSlug);
        return;
      }
      var dims = VP_DIMS[mode];
      if (!dims) return;
      setBusy(btn, true);
      try {
        var existing = await findExistingVariant(dims.w, dims.h);
        if (existing && existing.slug) {
          location.href = '/platform/scene/' + encodeURIComponent(existing.slug);
          return;
        }
        // Resolve the source scene id — prefer the current scene's id
        // stamped on the viewport element by the shell renderer; fall
        // back to the root slug if the id isn't on the page.
        var frame = document.querySelector('[data-session]') ||
                    document.querySelector('canvas[data-session]') ||
                    document.querySelector('[data-scene]');
        var sourceSceneId = frame ? (frame.getAttribute('data-session') || frame.getAttribute('data-scene')) : rootSlug;

        var msg = 'Generating ' + mode + ' variant (' + dims.w + '×' + dims.h + ')…';
        var toast = flash(msg, 'info', { sticky: true });

        var resp = await fetch('/platform/api/resize/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceSceneId: sourceSceneId,
            width: dims.w,
            height: dims.h,
            strategy: 'smart',
          }),
        });
        if (toast && typeof toast.dismiss === 'function') toast.dismiss();
        if (!resp.ok) {
          var errText = await resp.text();
          flash('Adapt failed: ' + errText, 'error');
          return;
        }
        var result = await resp.json();
        if (!result || !result.ok || !result.slug) {
          flash('Adapt returned no variant slug', 'error');
          return;
        }
        flash('Opened ' + mode + ' variant · ' + result.slug, 'success');
        location.href = '/platform/scene/' + encodeURIComponent(result.slug);
      } catch (e) {
        flash('Adapt error: ' + (e && e.message ? e.message : e), 'error');
      } finally {
        setBusy(btn, false);
      }
    }

    buttons.forEach(function(b) {
      b.addEventListener('click', function() {
        var mode = b.getAttribute('data-viewport-preview');
        ensureVariant(b, mode);
      });
    });

    applyActive(detectCurrentMode());
  }
