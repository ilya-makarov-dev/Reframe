
  // ── Right panel tabs (Sections / Design / Rebrand / Vary / Activity) ───────────
  function bindRightTabs() {
    $$('.right-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        var target = tab.getAttribute('data-tab');
        if (!target) return;
        $$('.right-tab').forEach(function(t) { t.classList.toggle('active', t === tab); });
        // Hide all panels, then show target with correct display mode
        $$('[data-panel]').forEach(function(panel) {
          panel.style.display = 'none';
          panel.classList.add('hidden');
        });
        var targetPanel = $('[data-panel="' + target + '"]');
        if (targetPanel) {
          // Design panel needs block (vertical stacking), sections/ai use flex
          targetPanel.style.display = target === 'design' ? 'block' : 'flex';
          targetPanel.classList.remove('hidden');
        }
        // Auto-fetch sections when tab activates
        if (target === 'sections' && !state.sectionsLoaded) {
          fetchSections();
        }
        // Lazy-init variations panel on first activation
        if (target === 'vary' && !state.varyPanelLoaded) {
          initVaryPanel();
        }
        // Lazy-init agent panel on first activation
        if (target === 'agent' && !state.agentPanelLoaded) {
          initAgentPanel();
        }
        // Quality tab: fetch aesthetic score
        if (target === 'quality') {
          var analyzeBtn = $('[data-quality-analyze]');
          if (analyzeBtn && !analyzeBtn._bound) {
            analyzeBtn._bound = true;
            analyzeBtn.addEventListener('click', function() {
              var sid = state.currentSceneId || document.querySelector('[data-session]')?.getAttribute('data-session');
              if (!sid) return;
              analyzeBtn.textContent = 'Analyzing...';
              analyzeBtn.disabled = true;
              fetch('/platform/api/aesthetic/' + sid)
                .then(function(r) { return r.json(); })
                .then(function(data) {
                  if (!data.ok) { analyzeBtn.textContent = 'Error'; return; }
                  var scoreEl = $('[data-quality-score]');
                  if (scoreEl) {
                    scoreEl.innerHTML = '<div style="font-size:48px;font-weight:800;color:var(--accent)">' + data.overall + '%</div>'
                      + '<div class="t-caption" style="color:var(--text-muted)">' + data.overallRating + '</div>';
                  }
                  var metricsEl = $('[data-quality-metrics]');
                  if (metricsEl && data.metrics) {
                    metricsEl.innerHTML = data.metrics.map(function(m) {
                      var filled = Math.round(m.score / 10);
                      var bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
                      var color = m.score >= 60 ? 'var(--text-base)' : m.score >= 30 ? '#d4a017' : '#e74c3c';
                      return '<div style="display:flex;align-items:center;gap:8px;font-size:13px">'
                        + '<span style="width:80px;color:var(--text-muted)">' + m.name + '</span>'
                        + '<span style="font-family:var(--mono);color:' + color + '">' + bar + '</span>'
                        + '<span style="width:32px;text-align:right;font-weight:600">' + m.score + '%</span>'
                        + '</div>';
                    }).join('');
                  }
                  analyzeBtn.textContent = 'Re-analyze';
                  analyzeBtn.disabled = false;
                  // Also fetch Brand Fidelity from audit endpoint
                  fetch('/platform/api/audit?sceneId=' + sid)
                    .then(function(r) { return r.json(); })
                    .then(function(auditData) {
                      var bfEl = $('[data-brand-fidelity-score]');
                      var bfBreak = $('[data-brand-fidelity-breakdown]');
                      if (bfEl && auditData.brandFidelity) {
                        var bf = auditData.brandFidelity;
                        bfEl.innerHTML = '<div style="font-size:36px;font-weight:800;color:var(--accent)">' + bf.score + '</div>'
                          + '<div class="t-caption" style="color:var(--text-muted)">' + bf.rating + '</div>';
                        if (bfBreak) {
                          var dims = bf.breakdown;
                          bfBreak.innerHTML = Object.keys(dims).map(function(k) {
                            var val = Math.round(dims[k] * 100);
                            var label = k.replace(/([A-Z])/g, ' $1').replace(/^./, function(c) { return c.toUpperCase(); });
                            var color = val >= 70 ? 'var(--text-base)' : val >= 40 ? '#d4a017' : '#e74c3c';
                            return '<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0">'
                              + '<span style="color:var(--text-muted)">' + label + '</span>'
                              + '<span style="font-weight:600;color:' + color + '">' + val + '%</span>'
                              + '</div>';
                          }).join('');
                        }
                      } else if (bfEl) {
                        bfEl.innerHTML = '<div class="t-caption" style="color:var(--text-muted)">No brand loaded</div>';
                      }
                    }).catch(function() {});
                })
                .catch(function() { analyzeBtn.textContent = 'Analyze Quality'; analyzeBtn.disabled = false; });
            });
          }
        }
        // Tokens tab: fetch token list
        if (target === 'tokens') {
          var sid = state.currentSceneId || document.querySelector('[data-session]')?.getAttribute('data-session');
          if (sid) {
            fetch('/platform/api/tokens/' + sid)
              .then(function(r) { return r.json(); })
              .then(function(data) {
                var tree = $('[data-tokens-tree]');
                if (!tree || !data.ok) return;
                if (data.count === 0) {
                  tree.innerHTML = '<div class="t-caption" style="color:var(--text-muted);padding:16px;text-align:center">No tokens defined.</div>';
                  return;
                }
                tree.innerHTML = data.tokens.map(function(t) {
                  var swatch = t.type === 'COLOR' && typeof t.value === 'string' && t.value.startsWith('#')
                    ? '<span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:' + t.value + ';border:1px solid var(--border);vertical-align:middle;margin-right:6px"></span>'
                    : '';
                  return '<div style="display:flex;align-items:center;gap:4px;font-size:12px;padding:3px 0">'
                    + swatch
                    + '<span style="color:var(--text-base);font-family:var(--mono)">' + t.name + '</span>'
                    + '<span style="margin-left:auto;color:var(--text-muted)">' + (typeof t.value === 'string' ? t.value : JSON.stringify(t.value)) + '</span>'
                    + '</div>';
                }).join('');
              })
              .catch(function() {});
          }
        }
      });
    });

    // Auto-open tab from URL ?tab= param (e.g. from audit redirect)
    try {
      var params = new URLSearchParams(window.location.search);
      var autoTab = params.get('tab');
      if (autoTab) {
        var targetTab = document.querySelector('[data-tab="' + autoTab + '"]');
        if (targetTab) {
          setTimeout(function() { targetTab.click(); }, 300);
        }
      }
    } catch(e) {}
  }

  // ── Rebrand panel ──────────────────────────────────────────
  function getCurrentSessionId() {
    var el = $('[data-session]');
    return el ? el.getAttribute('data-session') : null;
  }

  function setRebrandStatus(text, isError) {
    var el = $('[data-rebrand-status]');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = isError ? 'var(--error, #f3727f)' : 'var(--text-muted)';
  }

  function bindRebrandPanel() {
    var applyBtn = $('[data-rebrand-apply]');
    var select = $('[data-rebrand-select]');
    if (applyBtn && select) {
      applyBtn.addEventListener('click', function() {
        var brand = select.value;
        var sceneId = getCurrentSessionId();
        if (!brand || !sceneId) {
          setRebrandStatus('Select a brand', true);
          return;
        }
        setRebrandStatus('Applying ' + brand + '…');
        fetch('/platform/api/rebrand/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sceneId: sceneId, brand: brand }),
        })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.ok) {
              setRebrandStatus('✓ ' + data.brand + ': ' + data.rebranded + ' nodes rebranded, ' + data.bindings + ' bindings');
              refreshViewports();
            } else {
              setRebrandStatus('Error: ' + (data.error || 'rebrand failed'), true);
            }
          })
          .catch(function(err) {
            setRebrandStatus('Network error: ' + err, true);
          });
      });
    }

    // Mode switcher (light/dark)
    $$('[data-mode-switch]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var mode = btn.getAttribute('data-mode-switch');
        var sceneId = getCurrentSessionId();
        if (!mode || !sceneId) return;
        fetch('/platform/api/variations/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sceneId: sceneId, kind: 'mode', value: mode }),
        })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.ok) {
              $$('[data-mode-switch]').forEach(function(b) {
                b.style.background = b === btn ? 'var(--accent)' : 'var(--surface)';
                b.style.color = b === btn ? 'var(--on-accent)' : 'var(--text-base)';
              });
              refreshViewports();
            }
          });
      });
    });
  }

