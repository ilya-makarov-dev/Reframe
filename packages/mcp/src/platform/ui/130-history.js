  // ── Inline Audit — real 23-rule findings on the preview ──
  // Fetches per-node audit findings from the engine, renders badges
  // on the HTML annotation layer, and shows a popover with fix
  // suggestion + one-click auto-fix button on hover/click.

  var auditFindings = [];

  async function refreshAudit() {
    var frame = $('.viewport-frame');
    var sessionId = frame ? frame.getAttribute('data-session') : null;
    if (!sessionId) return;
    try {
      var res = await api('/platform/api/audit?sceneId=' + encodeURIComponent(sessionId));
      if (!res.ok) return;
      auditFindings = res.findings || [];
      // Update header audit badge.
      var badge = $('.pill.success, .pill.danger');
      if (badge) {
        badge.className = 'pill ' + (res.score < 70 ? 'danger' : 'success');
        badge.innerHTML = '<span class="dot"></span>AUDIT ' + res.score;
      }
      renderAuditBadges(sessionId);
    } catch (_) {}
  }

  function renderAuditBadges(sessionId) {
    var htmlLayer = $('.annotation-marks-html');
    if (!htmlLayer) return;
    // Remove previous audit badges.
    htmlLayer.querySelectorAll('.audit-badge').forEach(function(el) { el.remove(); });
    // Group findings by nodeId.
    var byNode = {};
    for (var i = 0; i < auditFindings.length; i++) {
      var f = auditFindings[i];
      if (!f.nodeId) continue;
      if (!byNode[f.nodeId]) byNode[f.nodeId] = [];
      byNode[f.nodeId].push(f);
    }
    // Render one badge per node that has findings.
    for (var nodeId in byNode) {
      var findings = byNode[nodeId];
      var bbox = getBBox(nodeId);
      if (!bbox) continue;
      var scr = bboxToScreen(bbox);
      var worstSeverity = 'info';
      for (var j = 0; j < findings.length; j++) {
        if (findings[j].severity === 'error') worstSeverity = 'error';
        else if (findings[j].severity === 'warning' && worstSeverity !== 'error') worstSeverity = 'warning';
      }
      var badgeColor = worstSeverity === 'error' ? 'var(--danger)' : worstSeverity === 'warning' ? 'var(--warning)' : 'var(--text-tertiary)';
      // Badge position: top-left of node bbox.
      var left = scr.left - 4;
      var top = scr.top - 4;
      var popoverItems = findings.map(function(f) {
        var fixBtn = f.fix
          ? '<button class="audit-fix-btn" data-scene="' + escape(sessionId) + '" data-node="' + escape(f.nodeId) + '" data-prop="' + escape(f.fix.property) + '" data-suggested="' + escape(f.fix.suggested) + '">Fix</button>'
          : '';
        var fixPreview = f.fix
          ? '<div class="audit-fix-preview"><span class="audit-from">' + escape(f.fix.current) + '</span> → <span class="audit-to">' + escape(f.fix.suggested) + '</span></div>'
          : '';
        return '<div class="audit-finding ' + escape(f.severity) + '">' +
          '<div class="audit-finding-head">' +
            '<span class="audit-severity">' + escape(f.severity) + '</span>' +
            '<span class="audit-rule">' + escape(f.rule) + '</span>' +
            fixBtn +
          '</div>' +
          '<div class="audit-message">' + escape(f.message) + '</div>' +
          fixPreview +
        '</div>';
      }).join('');

      var badge = '<div class="audit-badge severity-' + escape(worstSeverity) + '" style="left:' + left + 'px;top:' + top + 'px;border-color:' + badgeColor + '" tabindex="0">' +
        '<span class="audit-badge-dot" style="background:' + badgeColor + '">' + findings.length + '</span>' +
        '<div class="audit-popover">' + popoverItems + '</div>' +
      '</div>';
      htmlLayer.insertAdjacentHTML('beforeend', badge);
    }
    // Bind fix buttons.
    htmlLayer.querySelectorAll('.audit-fix-btn').forEach(function(btn) {
      btn.addEventListener('click', async function(e) {
        e.stopPropagation();
        var scene = btn.getAttribute('data-scene');
        var node = btn.getAttribute('data-node');
        var prop = btn.getAttribute('data-prop');
        var suggested = btn.getAttribute('data-suggested');
        if (!scene || !node || !prop || !suggested) return;
        try {
          await api('/platform/api/audit/fix', {
            sceneId: scene,
            nodeId: node,
            property: prop,
            suggested: suggested,
          });
          flash('Fixed: ' + prop, 'success');
          // Re-audit after fix.
          setTimeout(refreshAudit, 300);
        } catch (_) {}
      });
    });
  }

  // ── Undo via Cmd+Z ────────────────────────────────
  async function undoLastOp() {
    var sceneSlug = state.currentSceneSlug;
    if (!sceneSlug) return;
    // Find the session id for this scene. We get it from the viewport frame.
    var frame = $('.viewport-frame');
    var sessionId = frame ? frame.getAttribute('data-session') : null;
    if (!sessionId) return;
    try {
      var res = await api('/platform/api/undo', { sceneId: sessionId });
      if (res.ok && res.undone) {
        flash('Undo: ' + (res.op ? res.op.type : '?'), 'success');
        // Re-fetch props if we have a selection.
        if (currentPropsNodeId && sessionId) {
          showPropsForNode(currentPropsNodeId, sessionId);
        }
      } else {
        flash('Nothing to undo');
      }
    } catch (_) {}
  }

  // ── History dropdown (top header) ────────────────────
  //
  // Replaces the old Activity tab (intent queue) with a Git-style
  // revision log. Each entry is an op from /platform/api/ops. Click
  // "Revert to here" on any entry → we repeatedly call /platform/api/undo
  // until we've undone enough ops to land at that revision.
  //
  // History data is pulled from the server on open + after every edit
  // (subscribed to SSE scene:saved via the debounced refreshTimeline).
  function bindHistoryDropdown() {
    var wrap = $('[data-history-dropdown]');
    if (!wrap) return;
    var btn = wrap.querySelector('.history-btn');
    var panel = wrap.querySelector('[data-history-panel]');
    var list = wrap.querySelector('[data-history-list]');
    var sub = wrap.querySelector('[data-history-sub]');
    var countBadge = wrap.querySelector('[data-history-count]');
    var clearBtn = wrap.querySelector('[data-action="history-clear"]');
    if (!btn || !panel || !list || !sub) return;

    function getSessionId() {
      var frame = $('.viewport-frame');
      return frame ? frame.getAttribute('data-session') : null;
    }

    function closePanel() {
      panel.classList.add('hidden');
    }
    function togglePanel() {
      if (panel.classList.contains('hidden')) {
        panel.classList.remove('hidden');
        loadHistory();
      } else {
        closePanel();
      }
    }

    async function loadHistory() {
      var sessionId = getSessionId();
      if (!sessionId) {
        list.innerHTML = '<div class="history-empty">Open a scene to see revisions.</div>';
        sub.textContent = '';
        return;
      }
      sub.textContent = 'Loading…';
      try {
        // Load ops log + saved snapshots in parallel.
        var ops = [];
        var snaps = [];
        var results = await Promise.all([
          api('/platform/api/ops?sceneId=' + encodeURIComponent(sessionId)).catch(function() { return { ops: [] }; }),
          api('/platform/api/history/snapshots?sceneId=' + encodeURIComponent(sessionId)).catch(function() { return { snapshots: [] }; }),
        ]);
        ops = (results[0] && results[0].ops) || [];
        snaps = (results[1] && results[1].snapshots) || [];
        renderHistoryList(ops, snaps);
        // Badge = total snapshot + op count (sense of "history size")
        var total = ops.length + snaps.length;
        if (countBadge) {
          if (total > 0) {
            countBadge.textContent = String(total);
            countBadge.classList.remove('hidden');
          } else {
            countBadge.classList.add('hidden');
          }
        }
        var parts = [];
        if (snaps.length > 0) parts.push(snaps.length + ' save' + (snaps.length === 1 ? '' : 's'));
        if (ops.length > 0) parts.push(ops.length + ' edit' + (ops.length === 1 ? '' : 's'));
        sub.textContent = parts.length > 0 ? parts.join(' · ') : 'No history yet';
      } catch (err) {
        list.innerHTML = '<div class="history-empty">Failed to load: ' + err + '</div>';
        sub.textContent = '';
      }
    }

    function formatOpLabel(op, idx) {
      // The ops returned by /platform/api/ops are lightweight summaries
      // ({ id, type, nodeId, timestamp }). Make the type human-readable.
      var type = (op.type || 'edit').replace(/_/g, ' ');
      var label = type.charAt(0).toUpperCase() + type.slice(1);
      var tail = op.nodeId ? ' @' + op.nodeId.slice(-6) : '';
      return { label: label, tail: tail, index: idx };
    }

    function formatTimestamp(ts) {
      if (!ts) return '';
      var t = new Date(ts);
      if (isNaN(t.getTime())) return '';
      var now = Date.now();
      var diff = now - t.getTime();
      if (diff < 60000) return 'just now';
      if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
      if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
      return t.toLocaleDateString();
    }

    function renderHistoryList(ops, snaps) {
      var html = '';

      // ── SAVES section (user checkpoints) ──
      if (snaps && snaps.length > 0) {
        html += '<div class="history-section-head">Saves</div>';
        for (var s = 0; s < snaps.length; s++) {
          var snap = snaps[s];
          var ts2 = formatTimestamp(snap.createdAt);
          html += '<div class="history-entry save" data-snapshot-id="' + escape(snap.id) + '">' +
            '<div class="history-entry-dot save-dot"></div>' +
            '<div class="history-entry-body">' +
              '<div class="history-entry-label">' + escape(snap.label) + '</div>' +
              '<div class="history-entry-meta">' + snap.nodeCount + ' nodes · rev ' + snap.revision + (ts2 ? ' · ' + ts2 : '') + '</div>' +
            '</div>' +
            '<div class="history-entry-actions">' +
              '<button class="history-restore-btn" data-action="restore-snapshot" title="Load this save">Restore</button>' +
              '<button class="history-snap-delete" data-action="delete-snapshot" title="Delete this save" aria-label="Delete">×</button>' +
            '</div>' +
          '</div>';
        }
      }

      // ── EDITS section (auto ops log) ──
      if (ops && ops.length > 0) {
        html += '<div class="history-section-head">Edits</div>';
        // Current state marker at the top of edits
        html += '<div class="history-entry current">' +
          '<div class="history-entry-dot"></div>' +
          '<div class="history-entry-body">' +
            '<div class="history-entry-label">Current state</div>' +
            '<div class="history-entry-meta">HEAD · ' + ops.length + ' op' + (ops.length === 1 ? '' : 's') + ' applied</div>' +
          '</div>' +
        '</div>';
        for (var i = ops.length - 1; i >= 0; i--) {
          var op = ops[i];
          var fmt = formatOpLabel(op, i);
          var ts = formatTimestamp(op.timestamp);
          // Revert button: undo all ops AFTER this one (count = ops.length - 1 - i)
          var undoCount = ops.length - 1 - i;
          html += '<div class="history-entry" data-op-index="' + i + '" data-undo-count="' + undoCount + '">' +
            '<div class="history-entry-dot"></div>' +
            '<div class="history-entry-body">' +
              '<div class="history-entry-label">' + escape(fmt.label) + '<span class="history-entry-tail">' + escape(fmt.tail) + '</span></div>' +
              '<div class="history-entry-meta">rev ' + (i + 1) + (ts ? ' · ' + ts : '') + '</div>' +
            '</div>' +
            (undoCount > 0 ? '<button class="history-revert-btn" data-action="revert-to-rev" title="Undo ' + undoCount + ' later op' + (undoCount === 1 ? '' : 's') + ' to return here">Revert</button>' : '<span class="history-entry-latest">latest</span>') +
          '</div>';
        }
      }

      if (!html) {
        html = '<div class="history-empty">No history yet. Click <strong>Save current state</strong> below to create a checkpoint.</div>';
      }
      list.innerHTML = html;

      // Revert-to-revision (atomic server call, not loop)
      list.querySelectorAll('[data-action="revert-to-rev"]').forEach(function(revertBtn) {
        revertBtn.addEventListener('click', async function(ev) {
          ev.stopPropagation();
          var entry = revertBtn.closest('.history-entry');
          if (!entry) return;
          var targetIdx = parseInt(entry.getAttribute('data-op-index') || '-1', 10);
          var undoCount = parseInt(entry.getAttribute('data-undo-count') || '0', 10);
          if (undoCount <= 0) return;

          var ok = await customConfirm({
            kind: 'danger',
            title: 'Revert to this revision?',
            message: 'Undo <strong>' + undoCount + ' operation' + (undoCount === 1 ? '' : 's') + '</strong> applied after this point. Tip: click <strong>Save current state</strong> first if you want to keep the current version.',
            confirmText: 'Revert',
            cancelText: 'Cancel',
          });
          if (!ok) return;

          var sessionId = getSessionId();
          if (!sessionId) return;
          revertBtn.textContent = 'Reverting…';
          revertBtn.setAttribute('disabled', 'true');
          try {
            await api('/platform/api/history/revert-to', { sceneId: sessionId, targetIndex: targetIdx });
            await loadHistory();
            if (debouncedRefreshViewports) debouncedRefreshViewports();
            if (debouncedRefreshAudit) debouncedRefreshAudit();
          } catch (err) {
            flash('Revert failed: ' + err, 'error');
            revertBtn.textContent = 'Revert';
            revertBtn.removeAttribute('disabled');
          }
        });
      });

      // Restore snapshot
      list.querySelectorAll('[data-action="restore-snapshot"]').forEach(function(restoreBtn) {
        restoreBtn.addEventListener('click', async function(ev) {
          ev.stopPropagation();
          var entry = restoreBtn.closest('.history-entry');
          var snapId = entry && entry.getAttribute('data-snapshot-id');
          if (!snapId) return;
          var sessionId = getSessionId();
          if (!sessionId) return;

          var ok = await customConfirm({
            kind: 'danger',
            title: 'Restore this save?',
            message: 'The current scene state will be replaced. Tip: click <strong>Save current state</strong> first if you want to keep the current version before loading.',
            confirmText: 'Restore',
            cancelText: 'Cancel',
          });
          if (!ok) return;

          restoreBtn.textContent = 'Restoring…';
          restoreBtn.setAttribute('disabled', 'true');
          try {
            await api('/platform/api/history/restore', { sceneId: sessionId, snapshotId: snapId });
            await loadHistory();
            if (debouncedRefreshViewports) debouncedRefreshViewports();
            if (debouncedRefreshAudit) debouncedRefreshAudit();
            flash('Restored', 'success');
          } catch (err) {
            flash('Restore failed: ' + err, 'error');
            restoreBtn.textContent = 'Restore';
            restoreBtn.removeAttribute('disabled');
          }
        });
      });

      // Delete snapshot
      list.querySelectorAll('[data-action="delete-snapshot"]').forEach(function(delBtn) {
        delBtn.addEventListener('click', async function(ev) {
          ev.stopPropagation();
          var entry = delBtn.closest('.history-entry');
          var snapId = entry && entry.getAttribute('data-snapshot-id');
          if (!snapId) return;
          var sessionId = getSessionId();
          if (!sessionId) return;
          try {
            await api('/platform/api/history/snapshot-delete', { sceneId: sessionId, snapshotId: snapId });
            await loadHistory();
          } catch (_) {}
        });
      });
    }

    btn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      togglePanel();
    });

    // Click-outside to close
    document.addEventListener('click', function(ev) {
      if (panel.classList.contains('hidden')) return;
      if (!wrap.contains(ev.target)) closePanel();
    });
    // Escape to close
    document.addEventListener('keydown', function(ev) {
      if (ev.key === 'Escape' && !panel.classList.contains('hidden')) closePanel();
    });

    // Save current state button — creates a snapshot
    var saveBtn = wrap.querySelector('[data-action="history-save"]');
    if (saveBtn) {
      saveBtn.addEventListener('click', async function() {
        var sessionId = getSessionId();
        if (!sessionId) return;
        // Prompt for optional label via a custom prompt modal. Simpler
        // to use window.prompt for now since this is a cheap internal
        // tool — can theme it later if needed.
        var label = window.prompt('Name this save (optional):', '');
        if (label === null) return; // cancelled
        saveBtn.setAttribute('disabled', 'true');
        try {
          var res = await api('/platform/api/history/save', { sceneId: sessionId, label: label });
          if (res && res.ok) {
            flash('Saved: ' + (res.snapshot && res.snapshot.label), 'success');
            await loadHistory();
          } else {
            flash('Save failed', 'error');
          }
        } catch (err) {
          flash('Save failed: ' + err, 'error');
        } finally {
          saveBtn.removeAttribute('disabled');
        }
      });
    }

    // Clear history button
    if (clearBtn) {
      clearBtn.addEventListener('click', async function() {
        var sessionId = getSessionId();
        if (!sessionId) return;
        var ok = await customConfirm({
          kind: 'danger',
          title: 'Clear revision history?',
          message: 'All recorded ops will be discarded. The scene will be re-compiled from its source HTML the next time you edit. This cannot be undone.',
          confirmText: 'Clear history',
          cancelText: 'Cancel',
        });
        if (!ok) return;
        try {
          // There is no direct /platform endpoint for history_clear yet;
          // we fall through to reframe_project via the MCP bridge if the
          // user has a project. If nothing works, we just flash an error.
          var r = await fetch('/platform/api/history/clear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sceneId: sessionId }),
          });
          if (r.ok) {
            await loadHistory();
            flash('History cleared', 'success');
            if (debouncedRefreshViewports) debouncedRefreshViewports();
          } else {
            flash('Clear failed', 'error');
          }
        } catch (_) {
          flash('Clear failed', 'error');
        }
      });
    }

    // Refresh count badge on SSE scene:saved so the user sees the revision
    // counter climb without opening the panel.
    if (window.EventSource) {
      try {
        var es = new EventSource('/events');
        es.addEventListener('message', function(ev) {
          try {
            var data = JSON.parse(ev.data);
            if (data.type === 'scene:saved' || data.type === 'scene:session-changed') {
              // Debounce — only refresh the count, not full panel
              setTimeout(function() {
                var sessionId = getSessionId();
                if (!sessionId) return;
                api('/platform/api/ops?sceneId=' + encodeURIComponent(sessionId)).then(function(res) {
                  var ops = (res && res.ops) || [];
                  if (countBadge) {
                    if (ops.length > 0) {
                      countBadge.textContent = String(ops.length);
                      countBadge.classList.remove('hidden');
                    } else {
                      countBadge.classList.add('hidden');
                    }
                  }
                  // If panel is open, refresh the list too
                  if (!panel.classList.contains('hidden')) loadHistory();
                }).catch(function() {});
              }, 400);
            }
          } catch (_) {}
        });
      } catch (_) {}
    }
  }
