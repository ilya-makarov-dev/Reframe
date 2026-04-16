  // ── Activity stream ──────────────────────────────────
  async function refreshStream() {
    const listEl = $('.stream-list');
    const headMeta = $('.stream-head .meta');
    if (!listEl) return;
    try {
      const data = await api('/platform/api/intent/list');
      const intents = data.intents || [];
      // Parallel: fetch orphaned annotations so the strip surfaces them.
      let orphanedHtml = '';
      try {
        const ann = await api('/platform/api/annotations/list?status=orphaned' +
          (state.currentSceneSlug ? '&sceneSlug=' + encodeURIComponent(state.currentSceneSlug) : ''));
        orphanedHtml = renderOrphanStrip(ann.annotations || []);
      } catch (_) {}
      listEl.innerHTML = orphanedHtml + renderStreamContent(intents);
      bindStreamActions();
      bindOrphanActions();
      if (headMeta) {
        var aiIntents = intents.filter(function(i) { return !isMechanicalIntent(i); });
        const sceneName = headMeta.firstChild ? headMeta.firstChild.textContent.split(' · ')[0] : 'this scene';
        headMeta.textContent = sceneName + ' · ' + aiIntents.length + (aiIntents.length === 1 ? ' item' : ' items');
      }
    } catch (_) {}
  }

  // Orphaned annotations get a dedicated strip at the top of the stream
  // because they are **events requiring user decision** — not mere history.
  function renderOrphanStrip(orphans) {
    if (!orphans || orphans.length === 0) return '';
    const items = orphans.map(function(o) {
      const reason = o.orphanedReason || 'anchor removed';
      const kind = o.payload ? o.payload.kind : '?';
      const preview = describePayloadShort(o.payload);
      return '<div class="orphan-item">' +
        '<span class="kind">' + escape(kind) + '</span>' +
        '<span class="body">' + escape(preview) + ' — ' + escape(reason) + '</span>' +
        '<button class="btn btn-secondary btn-sm" data-orphan-action="re-anchor" data-id="' + escape(o.id) + '">Re-anchor</button>' +
        '<button class="btn btn-ghost btn-sm" data-orphan-action="dismiss" data-id="' + escape(o.id) + '">Dismiss</button>' +
      '</div>';
    }).join('');
    return '<div class="orphan-strip">' +
      '<div class="title">Orphaned markers (' + orphans.length + ')</div>' +
      items +
      '</div>';
  }

  function describePayloadShort(p) {
    if (!p) return '';
    switch (p.kind) {
      case 'comment':           return '"' + (p.text || '').slice(0, 40) + '"';
      case 'pin':               return 'pin' + (p.note ? ': ' + p.note.slice(0, 30) : '');
      case 'echo-arrow':        return 'echo ' + (p.axis || '');
      case 'region':            return 'region ' + ((p.anchors || []).length) + ' nodes';
      case 'brush-stroke':      return 'brush ' + (p.macro || '');
      case 'reference':         return 'ref ' + (p.source ? p.source.type : '?');
      case 'rule':              return 'rule: ' + (p.rule || '');
      case 'ghost-proposal':    return 'ghost: ' + (p.summary || '').slice(0, 40);
      case 'resonance-overlay': return 'resonance ' + ((p.matches || []).length) + ' matches';
      default: return p.kind;
    }
  }

  function bindOrphanActions() {
    $$('.orphan-item button[data-orphan-action]').forEach(function(btn) {
      btn.addEventListener('click', async function(e) {
        e.stopPropagation();
        const action = btn.getAttribute('data-orphan-action');
        const id = btn.getAttribute('data-id');
        if (!id) return;
        if (action === 're-anchor') {
          // Enter re-anchor mode: next click on preview picks the new anchor.
          enterMode({ kind: 're-anchor', annotationId: id });
          flash('Click a new anchor node in the preview', 'success');
        } else if (action === 'dismiss') {
          try {
            await api('/platform/api/annotate-transition', {
              annotationId: id,
              toStatus: 'dismissed',
              reason: 'user dismissed orphan',
            });
            flash('Dismissed', 'success');
            refreshStream();
            refreshAnnotations();
          } catch (_) {}
        }
      });
    });
  }

  async function refreshOrphans() {
    // Trigger a stream refresh which re-renders the orphan strip.
    refreshStream();
  }

  // Mechanical intent kinds that should not clutter the activity stream.
  var MECHANICAL_KINDS = { move: 1, select: 1 };

  function isMechanicalIntent(intent) {
    var parts = intent.parts || [];
    if (parts.length === 0) return false;
    for (var i = 0; i < parts.length; i++) {
      if (!MECHANICAL_KINDS[parts[i].kind]) return false;
    }
    return true;
  }

  function renderStreamContent(intents) {
    // Filter out mechanical operations (move/resize) — only show AI-relevant intents.
    var filtered = intents.filter(function(i) { return !isMechanicalIntent(i); });
    if (!filtered.length) {
      return '<div class="stream-empty">' +
        '<div class="headline">No activity yet.</div>' +
        '<div class="body">Tell the agent what to do, or ask about a node in the preview.</div>' +
        '</div>';
    }
    return filtered.map(renderStreamCard).join('');
  }

  function renderStreamCard(intent) {
    const id = escape(String(intent.id || ''));
    const status = String(intent.status || 'draft');
    const partsDesc = (intent.parts || []).map(describePart).filter(Boolean).slice(0, 4).join(' · ');
    return '<div class="stream-card ' + status + '" data-id="' + id + '">' +
      '<div class="head">' +
        '<span>' + statusTitle(status) + '</span>' +
        '<span class="id">' + escape(String(intent.id || '').slice(-8)) + '</span>' +
      '</div>' +
      (partsDesc ? '<div class="body">' + escape(partsDesc) + '</div>' : '') +
      (cardActions(intent) ? '<div class="actions">' + cardActions(intent) + '</div>' : '') +
    '</div>';
  }

  function statusTitle(s) {
    return ({
      draft: 'Draft intent',
      queued: 'Queued',
      processing: 'Agent thinking…',
      proposed: 'Proposal — review',
      accepted: 'Accepted',
      rejected: 'Rejected',
      refined: 'Refined',
      archived: 'Archived',
    })[s] || s;
  }

  function cardActions(intent) {
    const id = escape(String(intent.id || ''));
    if (intent.status === 'draft') {
      return '<button class="btn btn-primary btn-sm" data-action="commit" data-id="' + id + '">Commit</button>' +
             '<button class="btn btn-ghost btn-sm" data-action="discard" data-id="' + id + '">Discard</button>';
    }
    if (intent.status === 'proposed') {
      return '<button class="btn btn-primary btn-sm" data-action="accept" data-id="' + id + '">Accept</button>' +
             '<button class="btn btn-ghost btn-sm" data-action="reject" data-id="' + id + '">Reject</button>';
    }
    if (intent.status === 'queued') {
      return '<button class="btn btn-secondary btn-sm" data-action="process" data-id="' + id + '">Process</button>';
    }
    return '';
  }

  function describePart(p) {
    if (!p) return '';
    switch (p.kind) {
      case 'select':      return (p.nodes || []).length + ' node(s)';
      case 'text':        return '"' + (p.value || '').slice(0, 40) + '"';
      case 'annotate':    return p.shape + ' (' + ((p.points || []).length) + 'pts)';
      case 'ref-brand':   return 'brand: ' + p.brand;
      case 'ref-image':   return 'image';
      case 'ref-node':    return 'ref-node ' + (p.nodeId || '').slice(-8);
      case 'apply-macro': return 'macro: ' + p.macro;
      case 'direction':   return p.value;
      case 'degree':      return p.value;
      case 'preserve':    return 'keep: ' + (p.keys || []).join(',');
      case 'constraint':  return 'rule: ' + p.rule;
      case 'move':        return p.delta ? 'move ' + p.delta.dx + ',' + p.delta.dy : 'move';
      case 'undo':        return 'undo ' + p.steps + ' step(s)';
      case 'query':       return 'query: ' + (p.selector || '').slice(0, 40);
      default:            return p.kind;
    }
  }

  function bindStreamActions() {
    $$('.stream-card button[data-action]').forEach(function(btn) {
      btn.addEventListener('click', async function(e) {
        e.stopPropagation();
        const action = btn.getAttribute('data-action');
        const id = btn.getAttribute('data-id');
        if (!action || !id) return;
        try {
          if (action === 'commit') {
            await api('/platform/api/intent/commit', { intentId: id });
          } else if (action === 'discard') {
            await api('/platform/api/intent/reject', { intentId: id, reason: 'discarded' });
          } else if (action === 'accept') {
            await api('/platform/api/intent/accept', { intentId: id });
          } else if (action === 'reject') {
            await api('/platform/api/intent/reject', { intentId: id, reason: 'user rejected' });
          } else if (action === 'process') {
            await api('/platform/api/intent/mark-processing', { intentId: id });
          }
          refreshStream();
        } catch (_) {}
      });
    });
  }

  // ── Macro apply buttons (macros page) ────────────────
  // ── Brand picker in global toolbar ─────────────────────────────────
  function bindBrandPicker() {
    var pickerBtn = $('[data-brand-picker-btn]');
    var pickerMenu = $('[data-brand-picker-menu]');
    if (!pickerBtn || !pickerMenu) return;

    pickerBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      var isHidden = pickerMenu.classList.contains('hidden');
      pickerMenu.classList.toggle('hidden');
      if (isHidden) {
        // Fetch brands
        fetch('/platform/api/brands')
          .then(function(r) { return r.json(); })
          .then(function(data) {
            var brands = data.brands || data || [];
            if (!Array.isArray(brands)) brands = [];
            var items = brands.map(function(b) {
              var name = typeof b === 'string' ? b : b.name || b.slug || '';
              return '<button class="brand-picker-item" style="display:block;width:100%;text-align:left;padding:8px 12px;border:none;background:transparent;border-radius:6px;cursor:pointer;font-size:13px;color:var(--text-base);font-family:var(--sans)" data-brand-apply="' + name + '">' + name + '</button>';
            }).join('');
            if (items) {
              pickerMenu.innerHTML = '<div style="padding:4px 8px;font-size:10px;font-weight:500;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em">Apply brand</div>' + items;
              pickerMenu.querySelectorAll('[data-brand-apply]').forEach(function(btn) {
                btn.addEventListener('click', function() {
                  var brand = btn.getAttribute('data-brand-apply');
                  pickerMenu.classList.add('hidden');
                  // Apply brand via rebrand API
                  var sid = state.currentSceneId || document.querySelector('[data-session]')?.getAttribute('data-session');
                  if (!sid || !brand) return;
                  var label = $('[data-brand-picker-label]');
                  if (label) label.textContent = brand;
                  fetch('/platform/api/rebrand/apply', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sceneId: sid, brand: brand })
                  }).then(function() {
                    // Refresh preview
                    var iframe = document.querySelector('.viewport-frame iframe');
                    if (iframe) iframe.src = iframe.src.split('?')[0] + '?t=' + Date.now();
                  });
                });
              });
            }
          })
          .catch(function() {});
      }
    });

    // Close on outside click
    document.addEventListener('click', function() { pickerMenu.classList.add('hidden'); });
  }

  // ── Command Palette (Cmd+K) ────────────────────────────────────────
  var commandPaletteEl = null;

  function toggleCommandPalette() {
    if (commandPaletteEl) {
      commandPaletteEl.remove();
      commandPaletteEl = null;
      return;
    }

    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding-top:20vh;backdrop-filter:blur(4px)';
    overlay.addEventListener('click', function(e) { if (e.target === overlay) { overlay.remove(); commandPaletteEl = null; } });

    var palette = document.createElement('div');
    palette.style.cssText = 'width:560px;background:var(--surface-elevated);border:1px solid var(--border);border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,0.2);overflow:hidden';

    var input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Type a command...';
    input.style.cssText = 'width:100%;padding:16px 20px;border:none;outline:none;background:transparent;font-size:16px;color:var(--text-base);font-family:var(--sans)';
    input.setAttribute('autofocus', '');

    var results = document.createElement('div');
    results.style.cssText = 'max-height:320px;overflow-y:auto;padding:8px';

    var commands = [
      { icon: '🎨', label: 'Design from scratch', desc: 'AI writes full page from your brief', action: function() { var btn = document.querySelector('[data-kind="describe"]'); if(btn) btn.click(); } },
      { icon: '🧱', label: 'Build from blocks', desc: 'Pick sections from block library', action: function() { window.location.href = '/platform/blocks'; } },
      { icon: '🔄', label: 'Rebrand', desc: 'Paste HTML, apply any brand', action: function() { var btn = document.querySelector('[data-kind="html"]'); if(btn) btn.click(); } },
      { icon: '📊', label: 'Quality audit', desc: 'Check design quality (37 rules + 8 metrics)', action: function() { var tab = document.querySelector('[data-tab="quality"]'); if(tab) tab.click(); } },
      { icon: '📦', label: 'Batch export', desc: 'N brands × M viewports × K formats', action: function() { window.location.href = '/platform/batch'; } },
      { icon: '🎭', label: 'Switch brand', desc: 'Apply a different brand to this design', action: function() { var tab = document.querySelector('[data-tab="rebrand"]'); if(tab) tab.click(); } },
      { icon: '🎲', label: 'Generate variants', desc: 'Density × Radius × Shadows grid', action: function() { var tab = document.querySelector('[data-tab="vary"]'); if(tab) tab.click(); } },
      { icon: '⬇️', label: 'Export HTML', desc: 'Static HTML with inline styles', action: function() { var btn = document.querySelector('[data-format="html"]'); if(btn) btn.click(); } },
      { icon: '🖼️', label: 'Export PNG', desc: 'Raster image via CanvasKit', action: function() { var btn = document.querySelector('[data-format="png"]'); if(btn) btn.click(); } },
      { icon: '📄', label: 'Export PDF', desc: 'Print-ready PDF document', action: function() { var btn = document.querySelector('[data-format="pdf"]'); if(btn) btn.click(); } },
      { icon: '⚛️', label: 'Export React', desc: 'TSX with TypeScript annotations', action: function() { var btn = document.querySelector('[data-format="react"]'); if(btn) btn.click(); } },
      { icon: '🌐', label: 'Export Site', desc: 'Multi-page app with routing', action: function() { var btn = document.querySelector('[data-format="site"]'); if(btn) btn.click(); } },
      { icon: '🔑', label: 'Tokens', desc: 'View/export design tokens (DTCG)', action: function() { var tab = document.querySelector('[data-tab="tokens"]'); if(tab) tab.click(); } },
      { icon: '🔌', label: 'API docs', desc: 'Headless render API reference', action: function() { window.location.href = '/platform/api-docs'; } },
    ];

    function renderResults(filter) {
      var q = (filter || '').toLowerCase();
      var filtered = q ? commands.filter(function(c) { return c.label.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q); }) : commands;
      results.innerHTML = filtered.map(function(cmd, i) {
        return '<div class="cmd-item" data-cmd-idx="' + commands.indexOf(cmd) + '" style="display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:8px;cursor:pointer;transition:background 0.1s' + (i === 0 ? ';background:var(--surface-sunken)' : '') + '">'
          + '<span style="font-size:18px;width:24px;text-align:center">' + cmd.icon + '</span>'
          + '<div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:500;color:var(--text-base)">' + cmd.label + '</div>'
          + '<div style="font-size:12px;color:var(--text-muted)">' + cmd.desc + '</div></div>'
          + '</div>';
      }).join('');

      results.querySelectorAll('.cmd-item').forEach(function(item) {
        item.addEventListener('click', function() {
          var idx = parseInt(item.getAttribute('data-cmd-idx') || '0');
          overlay.remove();
          commandPaletteEl = null;
          if (commands[idx]) commands[idx].action();
        });
        item.addEventListener('mouseenter', function() {
          results.querySelectorAll('.cmd-item').forEach(function(i) { i.style.background = 'transparent'; });
          item.style.background = 'var(--surface-sunken)';
        });
      });
    }

    input.addEventListener('input', function() { renderResults(input.value); });
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') { overlay.remove(); commandPaletteEl = null; }
      if (e.key === 'Enter') {
        var active = results.querySelector('.cmd-item[style*="surface-sunken"]') || results.querySelector('.cmd-item');
        if (active) active.click();
      }
    });

    palette.appendChild(input);
    palette.appendChild(results);
    overlay.appendChild(palette);
    document.body.appendChild(overlay);
    commandPaletteEl = overlay;
    renderResults('');
    setTimeout(function() { input.focus(); }, 50);
  }

  // ── Variant strip: show scene variants as thumbnails below preview ──
  function bindVariantStrip() {
    var strip = $('[data-variant-strip]');
    var items = $('[data-variant-items]');
    if (!strip || !items) return;

    // Fetch quality score for a scene (cached per session)
    var qualityCache = {};
    function getQuality(sceneId, cb) {
      if (qualityCache[sceneId] !== undefined) { cb(qualityCache[sceneId]); return; }
      fetch('/platform/api/aesthetic/' + sceneId)
        .then(function(r) { return r.json(); })
        .then(function(data) {
          var score = data.ok ? data.overall : null;
          qualityCache[sceneId] = score;
          cb(score);
        })
        .catch(function() { qualityCache[sceneId] = null; cb(null); });
    }

    function qualityColor(score) {
      if (score === null || score === undefined) return 'var(--text-muted)';
      if (score >= 80) return '#22c55e';
      if (score >= 60) return '#eab308';
      if (score >= 30) return '#f97316';
      return '#ef4444';
    }

    // Fetch all scenes and populate variant strip
    function refreshVariantStrip() {
      fetch('/api/scenes')
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (!data.scenes || data.scenes.length < 2) {
            strip.style.display = 'none';
            return;
          }
          strip.style.display = 'block';

          var currentSession = state.currentSceneId || document.querySelector('[data-session]')?.getAttribute('data-session');

          items.innerHTML = data.scenes.map(function(scene) {
            var isActive = scene.id === currentSession;
            return '<div class="variant-card' + (isActive ? ' variant-active' : '') + '" data-variant-scene="' + scene.id + '" style="'
              + 'display:inline-flex;flex-direction:column;gap:6px;padding:6px;border-radius:8px;cursor:pointer;min-width:140px;flex-shrink:0;'
              + 'border:2px solid ' + (isActive ? 'var(--accent)' : 'transparent') + ';'
              + 'background:' + (isActive ? 'rgba(var(--accent-rgb,0,113,227),0.06)' : 'var(--surface)') + ';'
              + 'transition:all 0.15s">'
              + '<div style="width:136px;height:80px;border-radius:4px;overflow:hidden;background:var(--surface-sunken);position:relative">'
              + '<img src="/thumbnail/' + scene.id + '.png?scale=1" loading="lazy" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display=&quot;none&quot;">'
              + '<span class="variant-quality-badge" data-vq-scene="' + scene.id + '" style="position:absolute;top:4px;right:4px;padding:2px 6px;border-radius:4px;background:rgba(0,0,0,0.6);color:#fff;font-size:10px;font-weight:600;font-family:var(--mono);display:none"></span>'
              + '</div>'
              + '<div style="font-size:11px;font-weight:500;color:var(--text-base);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:136px">' + (scene.name || scene.id) + '</div>'
              + '<div style="font-size:10px;color:var(--text-muted)">' + (scene.size || '') + ' · ' + (scene.nodes || '?') + ' nodes</div>'
              + '</div>';
          }).join('');

          // Fetch quality scores for each variant
          data.scenes.forEach(function(scene) {
            getQuality(scene.id, function(score) {
              var badge = document.querySelector('[data-vq-scene="' + scene.id + '"]');
              if (badge && score !== null) {
                badge.textContent = score + '%';
                badge.style.display = 'block';
                badge.style.color = qualityColor(score);
              }
            });
          });

          // Click handler: switch main preview to clicked variant
          items.querySelectorAll('[data-variant-scene]').forEach(function(card) {
            card.addEventListener('click', function() {
              var sceneId = card.getAttribute('data-variant-scene');
              if (!sceneId) return;
              var iframe = document.querySelector('.viewport-frame iframe');
              if (iframe) iframe.src = '/preview/' + sceneId + '?t=' + Date.now();
              items.querySelectorAll('.variant-card').forEach(function(c) {
                c.style.border = '2px solid transparent';
                c.style.background = 'var(--surface)';
                c.classList.remove('variant-active');
              });
              card.style.border = '2px solid var(--accent)';
              card.style.background = 'rgba(var(--accent-rgb,0,113,227),0.06)';
              card.classList.add('variant-active');
              state.currentSceneId = sceneId;
              // Update floating quality badge for new active scene
              refreshQualityBadge(sceneId);
            });
          });

          // Populate floating quality badge for current scene
          if (currentSession) refreshQualityBadge(currentSession);
        })
        .catch(function() { strip.style.display = 'none'; });
    }

    // Floating quality badge on the viewport
    function refreshQualityBadge(sceneId) {
      var badge = $('[data-quality-badge]');
      if (!badge) return;
      getQuality(sceneId, function(score) {
        if (score !== null) {
          badge.querySelector('[data-quality-badge-score]').textContent = score + '% Quality';
          badge.style.display = 'block';
          badge.style.background = 'rgba(0,0,0,0.75)';
          badge.style.color = qualityColor(score);
        } else {
          badge.style.display = 'none';
        }
      });

      // Click badge → open quality tab
      badge.onclick = function() {
        var tab = document.querySelector('[data-tab="quality"]');
        if (tab) tab.click();
      };
    }

    // Also fetch badge for initial scene on load
    var initSid = state.currentSceneId || document.querySelector('[data-session]')?.getAttribute('data-session');
    if (initSid) {
      setTimeout(function() { refreshQualityBadge(initSid); }, 500);
    }

    refreshVariantStrip();
    var origHandleEvent = handleEvent;
    handleEvent = function(ev) {
      origHandleEvent(ev);
      if (ev.type === 'session:scenes' || ev.type === 'scene:saved' || ev.type === 'scene:deleted') {
        qualityCache = {}; // invalidate on changes
        refreshVariantStrip();
      }
    };
  }

  // ── Pipeline stepper interactivity ──
  function bindPipelineStepper() {
    var steps = $$('.pipeline-step');
    if (steps.length === 0) return;

    steps.forEach(function(step) {
      step.addEventListener('click', function() {
        var target = step.getAttribute('data-step');
        if (!target) return;

        // Update active state
        steps.forEach(function(s) {
          s.style.background = 'transparent';
          s.style.color = 'var(--text-muted)';
          s.classList.remove('active');
        });
        step.style.background = 'var(--accent)';
        step.style.color = 'var(--on-accent)';
        step.classList.add('active');

        // Switch right panel based on step
        var tabMap = {
          generate: 'sections',
          review: 'quality',
          refine: 'rebrand',
          ship: null, // triggers export dropdown
        };

        var tabName = tabMap[target];
        if (tabName) {
          // Click the corresponding right panel tab
          var tab = document.querySelector('[data-tab="' + tabName + '"]');
          if (tab) tab.click();
        }

        if (target === 'ship') {
          // Open export dropdown
          var exportBtn = document.querySelector('[data-export-dropdown] .export-btn');
          if (exportBtn) exportBtn.click();
        }
      });
    });
  }

  function bindBatchExport() {
    var btn = $('[data-batch-generate]');
    if (!btn) return;
    btn.addEventListener('click', function() {
      var scenes = $$('[data-batch-scenes] input:checked').map(function(el) { return el.value; });
      var formats = $$('[data-batch-formats] input:checked').map(function(el) { return el.value; });
      var brands = $$('[data-batch-brands] input:checked').map(function(el) { return el.value; });
      var viewports = $$('[data-batch-viewports] input:checked').map(function(el) {
        return { name: el.value, width: parseInt(el.getAttribute('data-w') || '1440'), height: parseInt(el.getAttribute('data-h') || '900') };
      });

      if (scenes.length === 0 || formats.length === 0) {
        var status = $('[data-batch-status]');
        if (status) status.textContent = 'Select at least one scene and one format.';
        return;
      }

      var statusEl = $('[data-batch-status]');
      if (statusEl) statusEl.textContent = 'Generating...';
      btn.disabled = true;

      // For each scene, call batch API
      var allResults = [];
      var pending = scenes.length;
      scenes.forEach(function(sceneId) {
        var body = JSON.stringify({
          sceneId: sceneId,
          formats: formats,
          brands: brands.length > 0 ? brands : undefined,
          viewports: viewports.length > 0 ? viewports : undefined,
        });
        fetch('/api/render/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.results) allResults = allResults.concat(data.results);
            pending--;
            if (pending <= 0) {
              btn.disabled = false;
              if (statusEl) statusEl.textContent = allResults.length + ' files generated.';
              var resultsEl = $('[data-batch-results]');
              if (resultsEl) {
                resultsEl.innerHTML = allResults.map(function(r) {
                  return '<div>' + (r.brand || '') + ' ' + (r.viewport || '') + ' ' + r.format + ' — ' + (r.size > 0 ? Math.round(r.size / 1024) + 'KB' : 'ERR') + '</div>';
                }).join('');
              }
            }
          })
          .catch(function() { pending--; });
      });
    });
  }

  function bindMacroApplyBtns() {
    const pageEl = $('[data-macro-current-scene]');
    const sceneSlug = pageEl ? (pageEl.getAttribute('data-macro-current-scene') || null) : null;
    $$('.macro-apply-btn[data-macro]').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        const macro = btn.getAttribute('data-macro');
        if (!macro) return;
        try {
          await api('/platform/api/intent/add', {
            parts: [{ kind: 'apply-macro', macro: macro }],
            sceneSlug: sceneSlug,
          });
          flash('Macro "' + macro + '" queued', 'success');
        } catch (_) {}
      });
    });
  }
