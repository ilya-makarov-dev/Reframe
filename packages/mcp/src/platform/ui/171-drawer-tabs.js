  // ── Phase 1 UI-6b — Drawer tab content renderers ────────────────
  //
  // Per-tab render functions for the four surfaces hosted in the
  // drawer (170-drawer.js). Each renderer takes the tab body
  // container and mutates it in place; called by the drawer on
  // (a) state-change open + (b) tab activation.
  //
  // Each tab is small enough to ship inline without a sub-module —
  // Quality + Variations + Tokens + Rebrand combined ≈ 200 lines of
  // straight DOM-construction. Splitting per-tab would multiply file
  // count without payoff.
  //
  // Endpoints used (all pre-existing in router.ts):
  //   GET  /platform/api/audit?sceneId=<id>           (Quality)
  //   GET  /platform/api/tokens/<sceneId>             (Tokens)
  //   POST /platform/api/rebrand/apply                (Rebrand)
  //   POST /platform/api/variations/apply             (Variations + mode toggle)
  //   GET  /platform/api/brands                       (Brand list for Rebrand select)

  function currentDrawerSceneId() {
    var f = document.querySelector('[data-session]');
    return f ? (f.getAttribute('data-session') || '') : '';
  }

  function escapeDrawer(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── Quality tab — design audit + 8 metrics + brand fidelity ─────
  function renderQualityTab(body) {
    if (body.dataset.rendered === 'quality') return; // initial chrome cached
    body.dataset.rendered = 'quality';
    body.innerHTML =
      '<div class="drawer-section">'
      + '<h3 class="drawer-section-title">Design Quality</h3>'
      + '<button type="button" class="drawer-action-btn" data-quality-analyze>Analyze Quality</button>'
      + '<div class="drawer-quality-score" data-quality-score></div>'
      + '<div class="drawer-quality-metrics" data-quality-metrics></div>'
      + '</div>'
      + '<div class="drawer-section">'
      + '<h3 class="drawer-section-title">Brand Fidelity</h3>'
      + '<div class="drawer-bf-score" data-brand-fidelity-score></div>'
      + '<div class="drawer-bf-breakdown" data-brand-fidelity-breakdown></div>'
      + '</div>';

    var btn = body.querySelector('[data-quality-analyze]');
    btn.addEventListener('click', function() {
      var sid = currentDrawerSceneId();
      if (!sid) return;
      btn.textContent = 'Analyzing…';
      btn.disabled = true;
      // Two endpoints in flight: /api/aesthetic/<sid> for the 8 metrics
      // (returns { overall, overallRating, metrics } at top level), and
      // /api/audit?sceneId=<sid> for brand fidelity (returns
      // { brandFidelity }). Earlier wiring assumed /api/audit&aesthetic=true
      // returned a nested `aesthetic` key — wrong shape; that endpoint
      // returns audit findings + score, not the aesthetic-metric breakdown.
      Promise.all([
        fetch('/platform/api/aesthetic/' + encodeURIComponent(sid)).then(function(r) { return r.json(); }),
        fetch('/platform/api/audit?sceneId=' + encodeURIComponent(sid)).then(function(r) { return r.json(); }),
      ])
        .then(function(arr) {
          var aesthetic = arr[0];
          var audit = arr[1];
          var scoreEl = body.querySelector('[data-quality-score]');
          var metricsEl = body.querySelector('[data-quality-metrics]');
          if (aesthetic && aesthetic.ok !== false) {
            if (scoreEl) {
              scoreEl.innerHTML = '<div class="drawer-big-score">' + (aesthetic.overall != null ? aesthetic.overall + '%' : '—') + '</div>'
                + '<div class="drawer-rating">' + escapeDrawer(aesthetic.overallRating || '') + '</div>';
            }
            if (metricsEl && Array.isArray(aesthetic.metrics)) {
              metricsEl.innerHTML = aesthetic.metrics.map(function(m) {
                var filled = Math.round((m.score || 0) / 10);
                var bar = ''; for (var i = 0; i < 10; i++) bar += i < filled ? '█' : '░';
                return '<div class="drawer-metric-row">'
                  + '<span class="drawer-metric-name">' + escapeDrawer(m.name) + '</span>'
                  + '<span class="drawer-metric-bar">' + bar + '</span>'
                  + '<span class="drawer-metric-pct">' + (m.score != null ? m.score + '%' : '—') + '</span>'
                  + '</div>';
              }).join('');
            }
          }
          // Brand fidelity from /api/audit response.
          var bfEl = body.querySelector('[data-brand-fidelity-score]');
          var bfBreak = body.querySelector('[data-brand-fidelity-breakdown]');
          var bf = audit && audit.brandFidelity;
          if (bf && bfEl) {
            bfEl.innerHTML = '<div class="drawer-big-score">' + (bf.score != null ? bf.score : '—') + '</div>'
              + '<div class="drawer-rating">' + escapeDrawer(bf.rating || '') + '</div>';
            if (bfBreak && bf.breakdown && typeof bf.breakdown === 'object') {
              bfBreak.innerHTML = Object.keys(bf.breakdown).map(function(k) {
                var v = Math.round((bf.breakdown[k] || 0) * 100);
                return '<div class="drawer-bf-row">'
                  + '<span class="drawer-bf-label">' + escapeDrawer(k.replace(/([A-Z])/g, ' $1').replace(/^./, function(c){return c.toUpperCase();})) + '</span>'
                  + '<span class="drawer-bf-val">' + v + '%</span>'
                  + '</div>';
              }).join('');
            }
          } else if (bfEl) {
            bfEl.innerHTML = '<div class="drawer-empty">No brand loaded</div>';
          }
          btn.textContent = 'Re-analyze';
          btn.disabled = false;
        })
        .catch(function() {
          btn.textContent = 'Analyze Quality';
          btn.disabled = false;
        });
    });
  }

  // ── Variations tab — declared variation controls + grid generator ──
  function renderVariationsTab(body) {
    if (body.dataset.rendered === 'variations') return;
    body.dataset.rendered = 'variations';
    body.innerHTML =
      '<div class="drawer-section">'
      + '<h3 class="drawer-section-title">Variations</h3>'
      + '<div class="drawer-vary-controls" data-vary-controls>'
      + '<div class="drawer-empty">No variation declarations on this scene yet.</div>'
      + '</div>'
      + '</div>'
      + '<div class="drawer-section">'
      + '<h3 class="drawer-section-title">Grid generator</h3>'
      + '<div class="drawer-vary-grid">'
      + '<button type="button" class="drawer-action-btn drawer-action-secondary" data-vary-axis="density">Density</button>'
      + '<button type="button" class="drawer-action-btn drawer-action-secondary" data-vary-axis="radius">Radius</button>'
      + '<button type="button" class="drawer-action-btn drawer-action-secondary" data-vary-axis="shadows">Shadows</button>'
      + '<button type="button" class="drawer-action-btn drawer-action-secondary" data-vary-axis="rotateColors">Rotate colors</button>'
      + '</div>'
      + '<div class="drawer-vary-status" data-vary-status></div>'
      + '</div>';

    body.querySelectorAll('[data-vary-axis]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var axis = btn.getAttribute('data-vary-axis');
        var sid = currentDrawerSceneId();
        if (!axis || !sid) return;
        var status = body.querySelector('[data-vary-status]');
        if (status) status.textContent = 'Applying ' + axis + '…';
        fetch('/platform/api/variations/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sceneId: sid, kind: axis }),
        })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (status) status.textContent = data && data.ok ? '✓ Applied ' + axis : 'Error: ' + (data && data.error || 'failed');
          })
          .catch(function() {
            if (status) status.textContent = 'Network error';
          });
      });
    });
  }

  // ── Tokens tab — DTCG tokens list ──────────────────────────────
  function renderTokensTab(body) {
    body.dataset.rendered = 'tokens';
    body.innerHTML =
      '<div class="drawer-section">'
      + '<h3 class="drawer-section-title">Design Tokens</h3>'
      + '<div class="drawer-tokens-tree" data-tokens-tree>'
      + '<div class="drawer-empty">Loading…</div>'
      + '</div>'
      + '</div>';

    var sid = currentDrawerSceneId();
    var tree = body.querySelector('[data-tokens-tree]');
    if (!sid) {
      tree.innerHTML = '<div class="drawer-empty">No scene loaded</div>';
      return;
    }
    fetch('/platform/api/tokens/' + encodeURIComponent(sid))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data || !data.ok || !Array.isArray(data.tokens) || data.tokens.length === 0) {
          tree.innerHTML = '<div class="drawer-empty">No tokens defined.<br>Use <code>reframe_edit defineTokens</code> to create from a brand.</div>';
          return;
        }
        tree.innerHTML = data.tokens.map(function(t) {
          var swatch = t.type === 'COLOR' && typeof t.value === 'string' && t.value.charAt(0) === '#'
            ? '<span class="drawer-token-swatch" style="background:' + escapeDrawer(t.value) + '"></span>'
            : '';
          return '<div class="drawer-token-row">'
            + swatch
            + '<span class="drawer-token-name">' + escapeDrawer(t.name) + '</span>'
            + '<span class="drawer-token-value">' + escapeDrawer(typeof t.value === 'string' ? t.value : JSON.stringify(t.value)) + '</span>'
            + '</div>';
        }).join('');
      })
      .catch(function() {
        tree.innerHTML = '<div class="drawer-empty">Failed to load tokens</div>';
      });
  }

  // ── Rebrand tab — Phase 3 Brief 3a Pin #7. Subsumed into the brand
  // workbench: the inline select+apply+mode-toggle UI is replaced with
  // a redirect button. The workbench ships catalog grid + live preview +
  // multi-scope apply, which beats the inline drawer dropdown on every
  // axis (catalog visibility, palette preview, scenes-using count). Mode
  // toggle (light/dark) keeps its drawer tab — it's not brand-scoped.
  function renderRebrandTab(body) {
    if (body.dataset.rendered === 'rebrand') return;
    body.dataset.rendered = 'rebrand';
    body.innerHTML =
      '<div class="drawer-section">'
      + '<h3 class="drawer-section-title">Brand</h3>'
      + '<p class="drawer-section-help">Catalog, live preview, multi-scope apply, and skill actions live in the brand workbench.</p>'
      + '<a class="drawer-action-btn" href="/platform/workbench/brands" data-bw-redirect>Open brand workbench →</a>'
      + '</div>'
      + '<div class="drawer-section">'
      + '<h3 class="drawer-section-title">Mode</h3>'
      + '<div class="drawer-mode-row">'
      + '<button type="button" class="drawer-action-btn drawer-action-secondary" data-mode-switch="light">Light</button>'
      + '<button type="button" class="drawer-action-btn drawer-action-secondary" data-mode-switch="dark">Dark</button>'
      + '</div>'
      + '</div>';

    body.querySelectorAll('[data-mode-switch]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var mode = btn.getAttribute('data-mode-switch');
        var sid = currentDrawerSceneId();
        if (!mode || !sid) return;
        fetch('/platform/api/variations/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sceneId: sid, kind: 'mode', value: mode }),
        }).then(function() {
          body.querySelectorAll('[data-mode-switch]').forEach(function(b) {
            b.classList.toggle('active', b === btn);
          });
        });
      });
    });
  }

  // Register all four renderers with the drawer module. Order matches
  // tab strip layout (Quality / Variations / Tokens / Rebrand).
  if (typeof window.registerDrawerTab === 'function') {
    window.registerDrawerTab('quality', renderQualityTab);
    window.registerDrawerTab('variations', renderVariationsTab);
    window.registerDrawerTab('tokens', renderTokensTab);
    window.registerDrawerTab('rebrand', renderRebrandTab);
  }
