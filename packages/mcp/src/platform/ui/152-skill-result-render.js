  // ════════════════════════════════════════════════════════
  // Phase 3.5 Pin #5 — Skill result rendering library.
  //
  // Single source of truth for rendering skill-bus invocation results.
  // 8 surface clients (workbench / Cmd+K palette / verbs / bottom chat /
  // context menu / toolbar / drawer / thread panel) call the same two
  // helpers + splice the resulting HTML into their own mount points.
  // No new state ownership — surfaces keep their UI shells, only the
  // result-rendering pass is shared.
  //
  // Library sits at 152- inside the IIFE (per ≤159 bundle scoping rule
  // banked in Brief 3b) so other ui/*.js files can call it directly.
  // Functions return HTML strings, not DOM nodes — matches the existing
  // codebase idiom where every render* function returns string.
  //
  // Result envelope shape (from skill-bus:result SSE):
  //   { requestId, ok, skill, payload: {kind, ...} }
  // Result kinds (Phase 3.5 stub set; Phase 4 expands):
  //   'critique-result' / 'edit-result' / 'export-result' /
  //   'audit-result' / 'motion-result' / 'design-result' / 'generic'
  // ════════════════════════════════════════════════════════

  function renderSkillResult(result) {
    if (!result) return '';
    if (result.ok === false) {
      return renderSkillError(result);
    }
    var payload = (result && result.payload) || {};
    switch (payload.kind) {
      case 'critique-result':  return renderCritiqueResult(payload, result);
      case 'edit-result':      return renderEditResult(payload, result);
      case 'export-result':    return renderExportResult(payload, result);
      case 'audit-result':     return renderAuditResult(payload, result);
      case 'motion-result':    return renderMotionResult(payload, result);
      case 'design-result':    return renderDesignResult(payload, result);
      default:                 return renderGenericResult(payload, result);
    }
  }

  // Progress events arrive multiple times per invocation. Surfaces call
  // this on each frame to update the status pill in place.
  function renderSkillProgress(ev) {
    if (!ev) return '';
    var phase = String(ev.phase || 'queued');
    var skill = String(ev.skill || '');
    var label = phase === 'queued' ? 'Queued'
              : phase === 'running' ? 'Running…'
              : phase === 'streaming' ? 'Streaming…'
              : phase;
    return '<span class="skill-pill skill-pill--' + escapeAttr(phase) + '" data-skill-progress data-skill-request-id="' + escapeAttr(ev.requestId || '') + '">' +
      '<span class="skill-pill-skill">' + escape(skill) + '</span>' +
      '<span class="skill-pill-phase">' + escape(label) + '</span>' +
    '</span>';
  }

  // ── Per-kind renderers ───────────────────────────────────

  function renderCritiqueResult(payload, result) {
    var summary = String(payload.summary || '').trim();
    var findings = Array.isArray(payload.findings) ? payload.findings : [];
    var findingsHtml = findings.length === 0
      ? '<div class="skill-result-empty">No findings.</div>'
      : '<ul class="skill-result-findings">' + findings.map(function(f) {
          var msg = escape(String(f.message || f.text || ''));
          var sev = escapeAttr(String(f.severity || 'info'));
          return '<li class="skill-result-finding skill-result-finding--' + sev + '">' + msg + '</li>';
        }).join('') + '</ul>';
    return resultShell(result, 'critique', [
      summary ? '<p class="skill-result-summary">' + escape(summary) + '</p>' : '',
      findingsHtml,
      renderActions([
        { kind: 'view', label: 'View details' },
        { kind: 'dismiss', label: 'Dismiss' },
      ], result),
    ].join(''));
  }

  function renderEditResult(payload, result) {
    var changes = payload.changes || payload.changedFields || {};
    var rows = Object.keys(changes).map(function(k) {
      var v = changes[k];
      var disp = (typeof v === 'object') ? JSON.stringify(v) : String(v);
      return '<div class="skill-result-row"><span class="skill-result-key">' +
        escape(k) + '</span><span class="skill-result-val">' + escape(disp) + '</span></div>';
    }).join('');
    return resultShell(result, 'edit', [
      payload.stub ? '<div class="skill-result-stub">stub result — Phase 4 wires real edit body</div>' : '',
      rows ? '<div class="skill-result-changes">' + rows + '</div>' : '<div class="skill-result-empty">no changed fields</div>',
      renderActions([
        { kind: 'apply', label: 'Apply' },
        { kind: 'dismiss', label: 'Dismiss' },
      ], result),
    ].join(''));
  }

  function renderExportResult(payload, result) {
    var url = payload.url || payload.path;
    return resultShell(result, 'export', [
      url ? '<a class="skill-result-link" href="' + escapeAttr(String(url)) + '" target="_blank" rel="noopener">' + escape(String(url)) + '</a>'
          : '<div class="skill-result-empty">export pending</div>',
      payload.stub ? '<div class="skill-result-stub">stub result — Phase 4 wires real exporter</div>' : '',
      renderActions([
        url ? { kind: 'view', label: 'Open' } : null,
        { kind: 'dismiss', label: 'Dismiss' },
      ].filter(Boolean), result),
    ].join(''));
  }

  function renderAuditResult(payload, result) {
    var counts = payload.counts || {};
    var pills = ['error', 'warning', 'info'].map(function(level) {
      var n = Number(counts[level] || 0);
      return '<span class="skill-result-count skill-result-count--' + level + '">' +
        n + ' ' + level + '</span>';
    }).join('');
    return resultShell(result, 'audit', [
      '<div class="skill-result-counts">' + pills + '</div>',
      payload.score !== undefined ? '<div class="skill-result-score">score: <strong>' + escape(String(payload.score)) + '</strong></div>' : '',
      renderActions([
        { kind: 'view', label: 'Open audit' },
        { kind: 'dismiss', label: 'Dismiss' },
      ], result),
    ].join(''));
  }

  function renderMotionResult(payload, result) {
    return resultShell(result, 'motion', [
      payload.stub ? '<div class="skill-result-stub">stub result — Phase 4 wires real motion pipeline</div>' : '',
      payload.preview ? '<video class="skill-result-video" src="' + escapeAttr(String(payload.preview)) + '" controls muted></video>' : '',
      renderActions([
        { kind: 'apply', label: 'Apply animation' },
        { kind: 'dismiss', label: 'Dismiss' },
      ], result),
    ].join(''));
  }

  function renderDesignResult(payload, result) {
    return resultShell(result, 'design', [
      payload.stub ? '<div class="skill-result-stub">stub result — Phase 4 wires real design body</div>' : '',
      payload.summary ? '<p class="skill-result-summary">' + escape(String(payload.summary)) + '</p>' : '',
      renderActions([
        { kind: 'apply', label: 'Use this design' },
        { kind: 'dismiss', label: 'Dismiss' },
      ], result),
    ].join(''));
  }

  function renderGenericResult(payload, result) {
    var rows = '';
    if (payload && typeof payload === 'object') {
      rows = Object.keys(payload).filter(function(k) { return k !== 'kind'; }).map(function(k) {
        var v = payload[k];
        var disp = (typeof v === 'object') ? JSON.stringify(v) : String(v);
        return '<div class="skill-result-row"><span class="skill-result-key">' +
          escape(k) + '</span><span class="skill-result-val">' + escape(disp) + '</span></div>';
      }).join('');
    }
    return resultShell(result, 'generic', [
      rows || '<div class="skill-result-empty">no payload</div>',
      renderActions([
        { kind: 'dismiss', label: 'Dismiss' },
      ], result),
    ].join(''));
  }

  function renderSkillError(result) {
    return resultShell(result, 'error', [
      '<div class="skill-result-error">' + escape(String((result && result.error) || 'Unknown error')) + '</div>',
      renderActions([
        { kind: 'retry', label: 'Retry' },
        { kind: 'dismiss', label: 'Dismiss' },
      ], result),
    ].join(''));
  }

  // ── Common scaffolding ──────────────────────────────────

  function resultShell(result, kindLabel, innerHtml) {
    var skill = escape(String((result && result.skill) || ''));
    var requestId = escapeAttr(String((result && result.requestId) || ''));
    return '<div class="skill-result skill-result--' + escapeAttr(kindLabel) + '" data-skill-result data-skill-request-id="' + requestId + '">' +
      '<header class="skill-result-head">' +
        '<span class="skill-result-skill">' + skill + '</span>' +
        '<span class="skill-result-kind">' + escape(kindLabel) + '</span>' +
      '</header>' +
      '<div class="skill-result-body">' + innerHtml + '</div>' +
    '</div>';
  }

  function renderActions(actions, result) {
    if (!actions || actions.length === 0) return '';
    var requestId = escapeAttr(String((result && result.requestId) || ''));
    return '<div class="skill-result-actions">' + actions.map(function(a) {
      return '<button class="skill-result-action skill-result-action--' + escapeAttr(a.kind) + '" data-skill-action="' + escapeAttr(a.kind) + '" data-skill-request-id="' + requestId + '">' +
        escape(a.label) + '</button>';
    }).join('') + '</div>';
  }

  function escape(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escapeAttr(s) {
    return escape(s).replace(/"/g, '&quot;');
  }

  // ── Action binder — event delegation, idempotent. ─────────

  function bindSkillResultActions(rootEl, opts) {
    if (!rootEl) return;
    if (rootEl.__skillActionsBound) return;
    rootEl.__skillActionsBound = true;
    var handlers = (opts && opts.handlers) || {};
    rootEl.addEventListener('click', function(e) {
      var btn = e.target && e.target.closest && e.target.closest('[data-skill-action]');
      if (!btn) return;
      e.preventDefault();
      var kind = btn.getAttribute('data-skill-action');
      var requestId = btn.getAttribute('data-skill-request-id') || '';
      var fn = handlers[kind];
      if (typeof fn === 'function') {
        try { fn({ kind: kind, requestId: requestId, button: btn }); } catch (_) {}
        return;
      }
      // Default behavior: dismiss removes the result card from DOM.
      // Other actions are surface-specific and should be wired via opts.handlers.
      if (kind === 'dismiss') {
        var card = btn.closest('[data-skill-result]');
        if (card) card.remove();
      }
    });
  }

  // Expose helpers on `window` so non-IIFE callers (page-mounted JSON
  // scripts, future extensions) can also consume them. IIFE-internal
  // callers prefer the bare function names since closure access is free.
  if (typeof window !== 'undefined') {
    window.renderSkillResult = renderSkillResult;
    window.renderSkillProgress = renderSkillProgress;
    window.bindSkillResultActions = bindSkillResultActions;
  }
