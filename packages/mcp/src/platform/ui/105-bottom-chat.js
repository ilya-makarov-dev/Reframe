  // ── Bottom chat bar — docked agent input with context chips ──
  //
  // Rendered by renderBottomChat() in layout.ts on scene pages. This
  // module handles chip rendering (reacts to selection / brand / vp
  // changes), input UX (autosize, Cmd+Enter), and dispatches the
  // prompt to the existing sidebar agent by writing its input and
  // clicking its send button. One agent pipeline, two entry points.
  //
  // Chip scope is prepended to the prompt as a single line so the
  // agent sees explicit context without any server-side prompt logic:
  //   [Scope: hero section · brand: Stripe · viewport: desktop]
  //   <user's typed text>
  //
  // Chips are closable. A closed chip is excluded from the scope
  // line (stored in state.bottomChatChipsMuted Set, keyed by kind).

  function bindBottomChat() {
    var bar = $('[data-bottom-chat]');
    if (!bar) return;
    var resizeHandle = $('[data-bc-resize]');
    var input = $('[data-bc-input]');
    var sendBtn = $('[data-bc-send]');
    var cancelBtn = $('[data-bc-cancel]');
    var newBtn = $('[data-bc-new]');
    var micBtn = $('[data-bc-mic]');
    var thinkBtn = $('[data-bc-think]');
    var collapseBtn = $('[data-bc-collapse]');
    var chipsEl = $('[data-bc-chips]');
    var logEl = $('[data-bc-log]');
    if (!input || !sendBtn || !chipsEl) return;

    // Collapsed state — persists per-browser so the user's preference
    // survives reloads. Collapsed = only the input row stays visible
    // (log + pinned todo hide). Auto-uncollapse on send so you never
    // stream into a hidden panel.
    var COLLAPSE_KEY = 'reframe.bottomChat.collapsed';
    function applyCollapsed(on) {
      if (!bar) return;
      bar.classList.toggle('collapsed', !!on);
      if (collapseBtn) collapseBtn.setAttribute('aria-expanded', on ? 'false' : 'true');
    }
    try { applyCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1'); } catch (_) {}
    if (collapseBtn) {
      collapseBtn.addEventListener('click', function() {
        var next = !bar.classList.contains('collapsed');
        applyCollapsed(next);
        try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch (_) {}
      });
    }

    // Project slug powers per-project chat persistence. Read from the
    // shell's data-scene attribute (set on .app by renderEditorShell)
    // or from the boot payload — both point to the same thing, we just
    // pick whichever is present first.
    var projectSlug = (function() {
      var app = document.querySelector('.app[data-scene]') || document.getElementById('app');
      var fromDom = app && app.getAttribute ? app.getAttribute('data-scene') : null;
      if (fromDom) return fromDom;
      var b = window.__REFRAME_BOOT__;
      return (b && b.projectSlug) || '';
    })();

    // Deep-think toggle — persists per-session via state (not localStorage,
    // since "always thinking" wastes tokens if forgotten between sessions).
    if (typeof state.bottomChatThinking !== 'boolean') state.bottomChatThinking = false;
    function syncThinkBtn() {
      if (!thinkBtn) return;
      thinkBtn.setAttribute('aria-pressed', state.bottomChatThinking ? 'true' : 'false');
      thinkBtn.classList.toggle('active', !!state.bottomChatThinking);
    }
    if (thinkBtn) {
      thinkBtn.addEventListener('click', function() {
        state.bottomChatThinking = !state.bottomChatThinking;
        syncThinkBtn();
      });
      syncThinkBtn();
    }

    // Agent stream state. Kept on module-level `state` so other UI
    // (inline popover, toolbar macros) could read sessionId later.
    if (!state.agentToolMap) state.agentToolMap = {};
    var abortCtrl = null;
    var pendingAssistantBubble = null;
    var thinkingBubble = null;
    function clearThinkingBubble() {
      if (thinkingBubble && thinkingBubble.parentNode) {
        thinkingBubble.parentNode.removeChild(thinkingBubble);
      }
      thinkingBubble = null;
    }

    // Three bouncing dots placeholder. Replaces the earlier single-ellipsis
    // thinking bubble — dots read as "actively working" rather than "paused".
    function appendThinkingBubble() {
      if (!logEl) return null;
      showLog();
      var b = document.createElement('div');
      b.className = 'bc-bubble bc-assistant thinking';
      b.setAttribute('data-testid', 'chat-thinking');
      b.innerHTML = '<span class="bc-dot"></span><span class="bc-dot"></span><span class="bc-dot"></span>';
      logEl.appendChild(b);
      logEl.scrollTop = logEl.scrollHeight;
      return b;
    }

    // Elapsed-time indicator. Surfaced between 2s and stream end so short
    // replies don't flash a "0s" badge, but long agent runs make the wait
    // legible. Tabular-nums prevents digit-jitter.
    var elapsedEl = $('[data-bc-elapsed]');
    var elapsedTimer = null;
    var elapsedStart = 0;
    var elapsedShowTimer = null;
    function formatElapsed(ms) {
      var s = Math.floor(ms / 1000);
      if (s < 60) return s + 's';
      var m = Math.floor(s / 60);
      var rem = s % 60;
      return m + 'm ' + (rem < 10 ? '0' : '') + rem + 's';
    }
    function startElapsed() {
      if (!elapsedEl) return;
      elapsedStart = Date.now();
      if (elapsedShowTimer) clearTimeout(elapsedShowTimer);
      elapsedShowTimer = setTimeout(function() {
        if (!elapsedEl) return;
        elapsedEl.textContent = formatElapsed(Date.now() - elapsedStart);
        elapsedEl.removeAttribute('hidden');
      }, 2000);
      if (elapsedTimer) clearInterval(elapsedTimer);
      elapsedTimer = setInterval(function() {
        if (!elapsedEl || elapsedEl.hasAttribute('hidden')) return;
        elapsedEl.textContent = formatElapsed(Date.now() - elapsedStart);
      }, 500);
    }
    function stopElapsed() {
      if (elapsedShowTimer) { clearTimeout(elapsedShowTimer); elapsedShowTimer = null; }
      if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
      if (elapsedEl) { elapsedEl.setAttribute('hidden', ''); elapsedEl.textContent = ''; }
    }

    // ── Muted chip tracking (kind → bool). Reset when scene changes. ──
    if (!state.bottomChatChipsMuted) state.bottomChatChipsMuted = {};

    // ── Resizable log height ──
    // Handle at the top edge of the pill. Drag vertically to set
    // --bc-log-max on the bar element (which .bc-log max-height reads).
    // Persist per project so the designer's preferred chat height
    // survives reloads. Double-click resets to the default.
    var LOG_HEIGHT_KEY = 'reframe.bottomChat.logMax:' + (projectSlug || 'default');
    var MIN_LOG_H = 120;
    var MAX_LOG_H_RATIO = 0.8; // max 80% of viewport height
    function applyLogHeight(pxOrDefault) {
      if (!pxOrDefault || pxOrDefault === 'default') {
        bar.style.removeProperty('--bc-log-max');
        return;
      }
      var n = parseInt(pxOrDefault, 10);
      if (!Number.isFinite(n) || n <= 0) return;
      var maxH = Math.floor(window.innerHeight * MAX_LOG_H_RATIO);
      var clamped = Math.max(MIN_LOG_H, Math.min(maxH, n));
      bar.style.setProperty('--bc-log-max', clamped + 'px');
    }
    try { applyLogHeight(localStorage.getItem(LOG_HEIGHT_KEY)); } catch (_) {}

    if (resizeHandle) {
      var dragStartY = 0;
      var dragStartH = 0;
      function getCurrentLogHeight() {
        if (!logEl) return 440;
        // Prefer the explicit var if set; else fall back to computed max.
        var explicit = bar.style.getPropertyValue('--bc-log-max');
        if (explicit) return parseInt(explicit, 10) || 440;
        // computedStyle reflects the `min(50vh, 440px)` default.
        return parseFloat(getComputedStyle(logEl).maxHeight) || 440;
      }
      function onResizeMove(e) {
        var dy = dragStartY - e.clientY; // drag up → grow
        applyLogHeight(dragStartH + dy);
      }
      function onResizeEnd() {
        resizeHandle.classList.remove('resizing');
        document.removeEventListener('mousemove', onResizeMove);
        document.removeEventListener('mouseup', onResizeEnd);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        // Persist the final value (read the var we just wrote).
        var finalV = bar.style.getPropertyValue('--bc-log-max');
        try {
          if (finalV) localStorage.setItem(LOG_HEIGHT_KEY, parseInt(finalV, 10) + '');
        } catch (_) {}
      }
      resizeHandle.addEventListener('mousedown', function(e) {
        e.preventDefault();
        // Make sure the log is visible while resizing so the user sees
        // the growth — force-show even if it was hidden with no messages.
        if (logEl && logEl.hasAttribute('hidden')) logEl.removeAttribute('hidden');
        dragStartY = e.clientY;
        dragStartH = getCurrentLogHeight();
        resizeHandle.classList.add('resizing');
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onResizeMove);
        document.addEventListener('mouseup', onResizeEnd);
      });
      // Double-click → reset to default.
      resizeHandle.addEventListener('dblclick', function() {
        applyLogHeight('default');
        try { localStorage.removeItem(LOG_HEIGHT_KEY); } catch (_) {}
      });
      // Keyboard accessibility: arrow-up/down shift by 40px when handle
      // is focused. Tab + Space-focus also work because the handle has
      // tabindex=0.
      resizeHandle.addEventListener('keydown', function(e) {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        var cur = getCurrentLogHeight();
        var next = cur + (e.key === 'ArrowUp' ? 40 : -40);
        applyLogHeight(next);
        try { localStorage.setItem(LOG_HEIGHT_KEY, parseInt(bar.style.getPropertyValue('--bc-log-max'), 10) + ''); } catch (_) {}
      });
      // Re-clamp against new viewport when window resizes.
      window.addEventListener('resize', function() {
        var explicit = bar.style.getPropertyValue('--bc-log-max');
        if (explicit) applyLogHeight(parseInt(explicit, 10));
      });
    }

    // ── Autosize textarea up to ~4 rows ──
    function autosize() {
      input.style.height = 'auto';
      var max = 120; // ≈ 4 lines
      input.style.height = Math.min(input.scrollHeight, max) + 'px';
    }
    input.addEventListener('input', autosize);

    // ── Render chips from current state ──
    function renderChips() {
      var chips = collectChips();
      if (chips.length === 0) {
        chipsEl.innerHTML = '';
        chipsEl.style.display = 'none';
        return;
      }
      chipsEl.style.display = '';
      chipsEl.innerHTML = chips.map(function(c) {
        var muted = state.bottomChatChipsMuted[c.kind];
        // Removable refs vs toggleable scope chips: × on refs deletes,
        // × on scope mutes (and turns into + so user can restore).
        var xAttr, xLabel, xText;
        if (c.removable) {
          xAttr = 'data-chip-remove="' + c.refId + '"';
          xLabel = 'Remove reference';
          xText = '×';
        } else {
          xAttr = 'data-chip-toggle="' + c.kind + '"';
          xLabel = 'Toggle ' + c.kind;
          xText = muted ? '+' : '×';
        }
        return '<span class="bc-chip' + (muted ? ' muted' : '') + (c.removable ? ' bc-chip-ref' : '') + '" data-chip-kind="' + c.kind + '">' +
          '<span class="bc-chip-icon">' + c.icon + '</span>' +
          '<span class="bc-chip-label">' + escape(c.label) + '</span>' +
          '<button class="bc-chip-x" ' + xAttr + ' aria-label="' + xLabel + '">' +
            xText +
          '</button>' +
        '</span>';
      }).join('');
    }

    // User-added references (URLs, file paths). Persisted per project so
    // a designer's "current task sources" survive reloads. Stored as a
    // flat list of { kind: 'url'|'file', value, id } where id is a
    // lightweight random tag used by the × button handler. Chips for
    // these reuse the same row as auto-scope chips but use a distinct
    // kind prefix ('ref-url' / 'ref-file') so muting logic doesn't
    // collide with scope chips.
    var REFS_KEY = 'reframe.bottomChat.refs:' + (projectSlug || 'default');
    if (!Array.isArray(state.bottomChatRefs)) {
      state.bottomChatRefs = (function() {
        try {
          var raw = localStorage.getItem(REFS_KEY);
          if (!raw) return [];
          var parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed : [];
        } catch (_) { return []; }
      })();
    }
    function persistRefs() {
      try { localStorage.setItem(REFS_KEY, JSON.stringify(state.bottomChatRefs)); } catch (_) {}
    }
    function addRef(kind, value) {
      if (!value) return;
      var id = Math.random().toString(36).slice(2, 8);
      state.bottomChatRefs.push({ kind: kind, value: value, id: id });
      persistRefs();
      renderChips();
    }
    function removeRef(id) {
      state.bottomChatRefs = state.bottomChatRefs.filter(function(r) { return r.id !== id; });
      persistRefs();
      renderChips();
    }

    function collectChips() {
      var out = [];
      // Selected node
      if (state.selection && state.selection.inode) {
        var tag = (state.selection.tag || 'node').toLowerCase();
        out.push({ kind: 'node', icon: '◉', label: tag + ' · ' + shortId(state.selection.inode) });
      }
      // User-added references.
      (state.bottomChatRefs || []).forEach(function(r) {
        if (r.kind === 'url') {
          var shortUrl = r.value.replace(/^https?:\/\//, '').replace(/\/$/, '');
          if (shortUrl.length > 38) shortUrl = shortUrl.slice(0, 36) + '…';
          out.push({ kind: 'ref-url:' + r.id, icon: '↗', label: shortUrl, removable: true, refId: r.id });
        } else if (r.kind === 'file') {
          var shortFile = r.value.length > 38 ? '…' + r.value.slice(-36) : r.value;
          out.push({ kind: 'ref-file:' + r.id, icon: '📄', label: shortFile, removable: true, refId: r.id });
        }
      });
      // Active brand. The dashboard has a [data-brand-picker-label],
      // the project page does not — it surfaces brand only via the
      // project health endpoint. Read the DOM first (dashboard path),
      // then fall back to the global the toolbar stashes after its
      // health probe resolves (project-page path). Without the fallback
      // the agent lost the brand chip on every project session and the
      // [Scope: …] prefix went out to the LLM without the active brand.
      // Phase 3 Brief 3a Pin #8 — read scene's brand first (StoredScene.brand
      // via boot payload). Falls back to global brand picker label which
      // tracks manifest.activeBrand. This fixes the multi-brand UI bug
      // surfaced in executor's Q2 — picker chip used to lie about which
      // brand the agent was scoping against on per-scene-brand setups.
      var brandText = '';
      try {
        if (window.__REFRAME_BOOT__ && window.__REFRAME_BOOT__.scenes) {
          var activeId = (state && state.currentSession) || window.__REFRAME_BOOT__.activeSceneId;
          var sceneBoot = activeId ? window.__REFRAME_BOOT__.scenes[activeId] : null;
          if (sceneBoot && sceneBoot.brand) brandText = String(sceneBoot.brand).trim();
        }
      } catch (_) {}
      if (!brandText) {
        var brandLabel = document.querySelector('[data-brand-picker-label]');
        brandText = brandLabel ? (brandLabel.textContent || '').trim() : '';
      }
      if (!brandText || brandText === 'No brand') {
        brandText = (window.__reframeActiveBrand || '').trim();
      }
      if (brandText && brandText !== 'No brand') {
        out.push({ kind: 'brand', icon: '✦', label: brandText });
      }
      // Viewport mode
      var vp = state.currentViewport || 'desktop';
      if (vp && vp !== 'original') {
        out.push({ kind: 'viewport', icon: '▭', label: vp });
      }
      return out;
    }

    function shortId(id) {
      if (!id) return '';
      return id.length > 10 ? id.slice(0, 8) + '…' : id;
    }

    // Chip × handler: scope chips toggle mute, ref chips remove entirely.
    chipsEl.addEventListener('click', function(e) {
      var remove = e.target.closest('[data-chip-remove]');
      if (remove) {
        removeRef(remove.getAttribute('data-chip-remove'));
        return;
      }
      var toggle = e.target.closest('[data-chip-toggle]');
      if (!toggle) return;
      var kind = toggle.getAttribute('data-chip-toggle');
      state.bottomChatChipsMuted[kind] = !state.bottomChatChipsMuted[kind];
      renderChips();
    });

    // Expose so other modules (toolbar Preview macro, selection events)
    // can force a chip repaint when state.currentViewport / selection
    // changes. Previously the toolbar called window.reframeRenderBottomChips
    // as a no-op fallback because nobody ever assigned to it; as a result
    // the "desktop" chip went stale the moment the user switched to
    // Preview → Mobile. Keep this assignment LAST in bindBottomChat so it
    // only goes live after chipsEl / renderChips are ready.
    window.reframeRenderBottomChips = renderChips;

    // ── Log helpers ──
    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, function(c) {
        return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
      });
    }
    function showLog() {
      if (logEl && logEl.hasAttribute('hidden')) logEl.removeAttribute('hidden');
    }
    function appendBubble(role, content) {
      if (!logEl) return null;
      showLog();
      var b = document.createElement('div');
      b.className = 'bc-bubble bc-' + role;
      // Stable testid so designer-qa probes can grab the last reply
      // without knowing the class-name combo. role is 'user' or
      // 'assistant'; third-party bubbles get their own.
      b.setAttribute('data-testid', 'chat-bubble-' + role);
      b.textContent = content;
      logEl.appendChild(b);
      logEl.scrollTop = logEl.scrollHeight;
      return b;
    }

    // ── Quick-pick chips (<choices>A|B|C</choices>) ──
    //
    // Agent can append a <choices>...</choices> marker to any multiple-
    // choice question. When enabled, we render clickable chips below the
    // bubble and strip the marker from visible text. When disabled, we
    // still strip the marker silently — the question text stays clean
    // even with the UX feature off. Toggle lives in localStorage so the
    // user's preference persists across reloads.
    var QUICK_PICKS_KEY = 'reframe.bottomChat.quickPicks';
    function quickPicksEnabled() {
      try { return localStorage.getItem(QUICK_PICKS_KEY) !== '0'; } catch (_) { return true; }
    }
    function setQuickPicks(on) {
      try { localStorage.setItem(QUICK_PICKS_KEY, on ? '1' : '0'); } catch (_) {}
      syncQuickPicksToggle();
      // Re-process the last assistant bubble so existing chips
      // appear/disappear without re-streaming the whole turn.
      var lastBubble = logEl && logEl.querySelector('.bc-bubble.bc-assistant:last-of-type');
      var lastRaw = lastBubble && lastBubble.getAttribute('data-raw');
      if (lastBubble && lastRaw) {
        // Remove any existing chip row attached to this bubble.
        var existing = lastBubble.nextElementSibling;
        if (existing && existing.classList.contains('bc-chip-row')) existing.remove();
        lastBubble.textContent = lastRaw;
        finalizeBubbleChoices(lastBubble);
      }
    }
    function finalizeBubbleChoices(bubble) {
      if (!bubble) return;
      var raw = bubble.textContent || '';
      // Support multiple markers in one bubble (rare but future-proof).
      var re = /<choices>([^<]+)<\/choices>/g;
      var matches = [];
      var m;
      while ((m = re.exec(raw))) matches.push(m);
      if (matches.length === 0) return;
      // Stash the raw text so toggle can re-process.
      bubble.setAttribute('data-raw', raw);
      // Strip markers from visible text.
      bubble.textContent = raw.replace(re, '').replace(/\s+\n/g, '\n').trim();
      if (!quickPicksEnabled()) return;
      // Pull the options from the LAST marker only — the last question
      // in a bubble is what the user will answer.
      var last = matches[matches.length - 1];
      var options = last[1].split('|').map(function(s) { return s.trim(); }).filter(Boolean);
      if (options.length === 0) return;
      var row = document.createElement('div');
      row.className = 'bc-chip-row';
      row.setAttribute('data-testid', 'chat-quick-picks');
      options.forEach(function(opt) {
        var btn = document.createElement('button');
        btn.className = 'bc-chip-pick';
        btn.type = 'button';
        btn.textContent = opt;
        btn.addEventListener('click', function() {
          // Clicking a chip sends that text as the next user message.
          // The input textarea is just a courtesy — we dispatch directly.
          if (typeof window.reframeSendBottomChat === 'function') {
            window.reframeSendBottomChat(opt);
          } else if (input && sendBtn) {
            input.value = opt;
            sendBtn.click();
          }
          // Disable the row after one pick so the user can't double-send.
          row.querySelectorAll('button').forEach(function(b) { b.disabled = true; });
          btn.classList.add('picked');
        });
        row.appendChild(btn);
      });
      bubble.parentNode.insertBefore(row, bubble.nextSibling);
      if (logEl) logEl.scrollTop = logEl.scrollHeight;
    }
    function syncQuickPicksToggle() {
      var btn = document.querySelector('[data-bc-quickpicks-toggle]');
      if (btn) btn.setAttribute('aria-pressed', quickPicksEnabled() ? 'true' : 'false');
    }
    // ── TodoWrite → pinned live checklist ──
    // TodoWrite is called repeatedly through a turn with the full,
    // updated todo list each time. We render it into a DEDICATED sticky
    // strip between the scrolling log and the input row — not into the
    // log itself — so the plan stays pinned in view as the conversation
    // streams. Updates mutate the same element in place, so the list
    // reads as a live progress indicator.
    //
    // When all todos flip to `completed`, we fade the strip out
    // (completed plans are visual noise; the summary will explain what
    // happened). Any new TodoWrite call repaints and un-hides it.
    var pinnedTodoEl = $('[data-bc-todo-pinned]');
    function renderTodoChecklist(todos) {
      if (!pinnedTodoEl) return;
      var items = Array.isArray(todos) ? todos : [];
      if (items.length === 0) {
        pinnedTodoEl.setAttribute('hidden', '');
        pinnedTodoEl.innerHTML = '';
        return;
      }
      var allDone = items.every(function(t) { return (t.status || 'pending') === 'completed'; });
      var list = items.map(function(t) {
        var status = t.status || 'pending';
        var label = status === 'in_progress' && t.activeForm ? t.activeForm : (t.content || '');
        var mark = status === 'completed' ? '✓' : (status === 'in_progress' ? '◐' : '○');
        return '<li class="bc-todo-item bc-todo-' + status + '">' +
          '<span class="bc-todo-mark">' + mark + '</span>' +
          '<span class="bc-todo-label">' + escapeHtml(label) + '</span>' +
          '</li>';
      }).join('');
      pinnedTodoEl.removeAttribute('hidden');
      pinnedTodoEl.classList.toggle('all-done', allDone);
      pinnedTodoEl.innerHTML = '<ul class="bc-todo-list">' + list + '</ul>';
    }

    function appendToolCard(toolName, toolInput, toolUseId) {
      if (!logEl) return null;
      showLog();
      var card = document.createElement('div');
      card.className = 'bc-tool';
      var preview = '';
      try {
        var s = JSON.stringify(toolInput);
        if (s && s.length > 80) s = s.slice(0, 80) + '…';
        preview = s || '';
      } catch (_) {}
      card.innerHTML =
        '<div class="bc-tool-head"><span class="bc-tool-name">' + escapeHtml(toolName) + '</span>' +
        '<span class="bc-tool-status" data-tool-status>running…</span></div>' +
        (preview ? '<div class="bc-tool-input">' + escapeHtml(preview) + '</div>' : '') +
        '<div class="bc-tool-result" data-tool-result hidden></div>';
      logEl.appendChild(card);
      logEl.scrollTop = logEl.scrollHeight;
      if (toolUseId) state.agentToolMap[toolUseId] = card;
      return card;
    }

    function setSending(on) {
      sendBtn.disabled = !!on;
      if (cancelBtn) {
        if (on) cancelBtn.removeAttribute('hidden');
        else cancelBtn.setAttribute('hidden', '');
      }
      if (on) startElapsed();
      else stopElapsed();
    }

    // ── SSE stream parser. EventSource can't POST, so fetch + ReadableStream. ──
    function streamChat(prompt) {
      setSending(true);
      appendBubble('user', prompt);
      pendingAssistantBubble = null;
      state.agentTodoCard = null; // start a fresh checklist for this turn
      // Thinking indicator: before Claude emits its first text/tool_use
      // event there's a 5-60 s gap while the subprocess boots the session,
      // loads context, and waits for the first API token. Without this
      // placeholder the chat looks dead and users hit send again. Removed
      // by the first event handler below (text | tool_use | tool_result).
      thinkingBubble = appendThinkingBubble();

      var body = { prompt: prompt };
      if (state.agentSessionId) body.sessionId = state.agentSessionId;
      if (state.bottomChatThinking) body.thinking = true;
      if (projectSlug) body.projectSlug = projectSlug;
      var sid = state.currentSceneId
        || (document.querySelector('[data-session]') && document.querySelector('[data-session]').getAttribute('data-session'))
        || (document.querySelector('canvas[data-session]') && document.querySelector('canvas[data-session]').getAttribute('data-session'));
      if (sid) body.sceneId = sid;

      abortCtrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;

      fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortCtrl ? abortCtrl.signal : undefined,
      }).then(function(resp) {
        if (!resp.ok || !resp.body) throw new Error('HTTP ' + resp.status);
        var reader = resp.body.getReader();
        var decoder = new TextDecoder();
        var buf = '';
        function pump() {
          return reader.read().then(function(r) {
            if (r.done) {
              if (buf.trim()) handleSseBlock(buf);
              setSending(false);
              return;
            }
            buf += decoder.decode(r.value, { stream: true });
            var idx;
            while ((idx = buf.indexOf('\n\n')) !== -1) {
              handleSseBlock(buf.slice(0, idx));
              buf = buf.slice(idx + 2);
            }
            return pump();
          });
        }
        return pump();
      }).catch(function(err) {
        clearThinkingBubble();
        if (err && err.name === 'AbortError') appendBubble('assistant', '[cancelled]');
        else appendBubble('assistant', '[error] ' + (err && err.message ? err.message : err));
        setSending(false);
      });
    }

    function handleSseBlock(raw) {
      var ev = null, data = null;
      raw.split(/\r?\n/).forEach(function(line) {
        if (line.indexOf('event:') === 0) ev = line.slice(6).trim();
        else if (line.indexOf('data:') === 0) {
          var rest = line.slice(5).trim();
          try { data = JSON.parse(rest); } catch (_) { data = rest; }
        }
      });
      if (!ev || data === null) return;
      // First substantive event (text / tool_use / tool_result / done / error)
      // clears the "thinking…" placeholder. chat_id + session_start arrive
      // near-instantly and don't count as "agent reached Claude".
      if (ev === 'text' || ev === 'tool_use' || ev === 'tool_result' ||
          ev === 'done' || ev === 'error') {
        clearThinkingBubble();
      }
      switch (ev) {
        case 'chat_id':
          state.agentChatId = data.chatId;
          break;
        case 'session_start':
          state.agentSessionId = data.sessionId || state.agentSessionId;
          pendingAssistantBubble = null;
          break;
        case 'text':
          if (!pendingAssistantBubble) {
            pendingAssistantBubble = appendBubble('assistant', data.text);
          } else {
            pendingAssistantBubble.textContent += data.text;
            if (logEl) logEl.scrollTop = logEl.scrollHeight;
          }
          break;
        case 'tool_use':
          // Seal any pending assistant text before showing a tool card.
          // Sealing = scan for <choices> markers and render chip row.
          if (pendingAssistantBubble) finalizeBubbleChoices(pendingAssistantBubble);
          pendingAssistantBubble = null;
          if (data.toolName === 'TodoWrite') {
            renderTodoChecklist(data.input && data.input.todos);
            // Skip the generic card for TodoWrite — the checklist IS the UI.
            // Stash a sentinel so the matching tool_result is silently dropped.
            if (data.toolUseId) state.agentToolMap[data.toolUseId] = null;
          } else {
            appendToolCard(data.toolName, data.input, data.toolUseId);
          }
          break;
        case 'tool_result':
          if (data.toolUseId in state.agentToolMap && state.agentToolMap[data.toolUseId] === null) {
            break;
          }
          var card = state.agentToolMap[data.toolUseId];
          if (card) {
            var statusEl = card.querySelector('[data-tool-status]');
            if (statusEl) {
              statusEl.textContent = data.ok ? 'ok' : 'error';
              statusEl.classList.toggle('ok', !!data.ok);
              statusEl.classList.toggle('err', !data.ok);
            }
            var resEl = card.querySelector('[data-tool-result]');
            if (resEl && data.preview) {
              resEl.removeAttribute('hidden');
              resEl.textContent = data.preview;
            }
          }
          break;
        case 'done':
          // Seal the last assistant bubble so its <choices> markers
          // render as chips at the end of the turn.
          if (pendingAssistantBubble) finalizeBubbleChoices(pendingAssistantBubble);
          pendingAssistantBubble = null;
          break;
        case 'error':
          if (pendingAssistantBubble) finalizeBubbleChoices(pendingAssistantBubble);
          pendingAssistantBubble = null;
          appendBubble('assistant', '[error] ' + (data.message || data.code || 'unknown'));
          break;
      }
    }

    function send() {
      var text = (input.value || '').trim();
      if (!text) return;
      // Don't let the user stream into a collapsed panel — re-open it
      // so they can see the agent responding.
      if (bar.classList.contains('collapsed')) {
        applyCollapsed(false);
        try { localStorage.setItem(COLLAPSE_KEY, '0'); } catch (_) {}
      }
      var chips = collectChips().filter(function(c) {
        return !state.bottomChatChipsMuted[c.kind];
      });
      // Scope chips (node/brand/viewport) go on one line; user-added
      // refs (url/file) go on a separate line so the agent can parse
      // them distinctly and, for file refs, follow up with Read tool.
      var scopeParts = [];
      var refParts = [];
      chips.forEach(function(c) {
        if (c.kind.indexOf('ref-url:') === 0) {
          // Use the full URL from state, not the truncated chip label.
          var rec = (state.bottomChatRefs || []).find(function(r) { return r.id === c.refId; });
          refParts.push('url: ' + (rec ? rec.value : c.label));
        } else if (c.kind.indexOf('ref-file:') === 0) {
          var recF = (state.bottomChatRefs || []).find(function(r) { return r.id === c.refId; });
          refParts.push('file: ' + (recF ? recF.value : c.label));
        } else {
          scopeParts.push(c.kind + ': ' + c.label);
        }
      });
      var prefix = '';
      if (scopeParts.length > 0) prefix += '[Scope: ' + scopeParts.join(' · ') + ']\n';
      if (refParts.length > 0)   prefix += '[Refs: '  + refParts.join(' · ')   + ']\n';
      var fullPrompt = prefix + text;
      input.value = '';
      autosize();
      streamChat(fullPrompt);
    }

    sendBtn.addEventListener('click', send);
    // Chip clicks dispatch the chosen option as if the user typed it and
    // hit send. Exposed on window so the chip renderer (declared above)
    // can reach it without tight coupling to this scope.
    window.reframeSendBottomChat = function(text) {
      input.value = text;
      autosize();
      send();
    };

    // ── Reference popover (URL / file attachments) ──
    // Click the bc-ref button → small popover anchored below with two
    // inputs (URL + file path). Submit either to attach. Attached refs
    // persist per project and render as removable chips alongside scope
    // chips; on send they're folded into the [Scope: …] prefix so the
    // agent sees the same context we do.
    var refBtn = $('[data-bc-ref-toggle]');
    var refPopover = null;
    function closeRefPopover() {
      if (!refPopover) return;
      refPopover.remove();
      refPopover = null;
      if (refBtn) refBtn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', onRefPopoverOutside, true);
      document.removeEventListener('keydown', onRefPopoverKey, true);
    }
    function onRefPopoverOutside(e) {
      if (!refPopover) return;
      if (refPopover.contains(e.target) || (refBtn && refBtn.contains(e.target))) return;
      closeRefPopover();
    }
    function onRefPopoverKey(e) {
      if (e.key === 'Escape') { closeRefPopover(); if (refBtn) refBtn.focus(); }
    }
    function openRefPopover() {
      if (refPopover) { closeRefPopover(); return; }
      refPopover = document.createElement('div');
      refPopover.className = 'bc-ref-popover';
      refPopover.setAttribute('role', 'dialog');
      refPopover.innerHTML =
        '<div class="bc-ref-row">' +
          '<label class="bc-ref-label">URL</label>' +
          '<input type="url" class="bc-ref-input" data-ref-url placeholder="https://example.com/article" />' +
          '<button type="button" class="bc-ref-add" data-ref-add="url">Add</button>' +
        '</div>' +
        '<div class="bc-ref-row">' +
          '<label class="bc-ref-label">File</label>' +
          '<input type="text" class="bc-ref-input" data-ref-file placeholder=".reframe/notes.md" />' +
          '<button type="button" class="bc-ref-add" data-ref-add="file">Add</button>' +
        '</div>' +
        '<div class="bc-ref-hint">Attached references ride with every message in this chat as context for the agent.</div>';
      document.body.appendChild(refPopover);

      // Anchor above the button. refBtn is inside the bottom chat bar so
      // we measure its rect and position the popover with a small gap.
      var r = refBtn.getBoundingClientRect();
      refPopover.style.position = 'fixed';
      refPopover.style.left = Math.max(12, r.left) + 'px';
      refPopover.style.bottom = (window.innerHeight - r.top + 8) + 'px';

      var urlInput = refPopover.querySelector('[data-ref-url]');
      var fileInput = refPopover.querySelector('[data-ref-file]');
      if (urlInput) urlInput.focus();

      refPopover.addEventListener('click', function(e) {
        var btn = e.target.closest('[data-ref-add]');
        if (!btn) return;
        var kind = btn.getAttribute('data-ref-add');
        var input = kind === 'url' ? urlInput : fileInput;
        if (!input) return;
        var val = (input.value || '').trim();
        if (!val) return;
        addRef(kind, val);
        input.value = '';
      });
      refPopover.addEventListener('keydown', function(e) {
        if (e.key !== 'Enter') return;
        var input = e.target;
        if (input === urlInput) {
          e.preventDefault();
          var v = (input.value || '').trim();
          if (v) { addRef('url', v); input.value = ''; }
        } else if (input === fileInput) {
          e.preventDefault();
          var vf = (input.value || '').trim();
          if (vf) { addRef('file', vf); input.value = ''; }
        }
      });

      if (refBtn) refBtn.setAttribute('aria-expanded', 'true');
      document.addEventListener('click', onRefPopoverOutside, true);
      document.addEventListener('keydown', onRefPopoverKey, true);
    }
    if (refBtn) {
      refBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        openRefPopover();
      });
    }

    // Quick-picks toggle — renders agent's <choices> markers as
    // clickable chips when ON. OFF silently strips markers so the
    // question text stays clean. Default ON so the feature is
    // discoverable; user can flip it off if it feels noisy.
    var quickPicksBtn = $('[data-bc-quickpicks-toggle]');
    if (quickPicksBtn) {
      syncQuickPicksToggle();
      quickPicksBtn.addEventListener('click', function() {
        setQuickPicks(!quickPicksEnabled());
      });
    }
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function() {
        if (state.agentChatId) {
          fetch('/api/agent/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatId: state.agentChatId }),
          }).catch(function() {});
        }
        if (abortCtrl) { try { abortCtrl.abort(); } catch (_) {} }
        setSending(false);
      });
    }

    // ── New-chat button ─────────────────────────────────────
    // DELETE /api/chat/<slug> wipes the persisted file, then we clear
    // the log + sessionId so the next send spawns a fresh Claude session.
    if (newBtn) {
      newBtn.addEventListener('click', function() {
        if (projectSlug) {
          fetch('/api/chat/' + encodeURIComponent(projectSlug), { method: 'DELETE' })
            .catch(function() {});
        }
        state.agentSessionId = null;
        state.agentChatId = null;
        state.agentToolMap = {};
        state.agentTodoCard = null;
        pendingAssistantBubble = null;
        if (logEl) {
          logEl.innerHTML = '';
          logEl.setAttribute('hidden', '');
        }
        if (pinnedTodoEl) {
          pinnedTodoEl.innerHTML = '';
          pinnedTodoEl.setAttribute('hidden', '');
        }
        flash('Новый диалог', 'info');
      });
    }
    input.addEventListener('keydown', function(e) {
      if (e.key !== 'Enter') return;
      // Shift+Enter inserts a newline (standard chat UX).
      // Plain Enter OR Cmd/Ctrl+Enter both submit. Previously only
      // the modifier variant sent — designers trained on Slack /
      // Discord / iMessage hit Enter, got a newline, saw nothing
      // happen, and assumed the agent was broken.
      if (e.shiftKey) return;
      e.preventDefault();
      send();
    });

    // ── Mic button — Web Speech API voice capture ──
    // Browsers that support webkitSpeechRecognition (Chromium + Edge +
    // Safari with SpeechRecognition) get live dictation into the input.
    // Firefox falls back to a flash hint. Recognition is session-scoped:
    // one click starts, another stops. Interim results stream into the
    // textarea so the user sees transcription as they speak.
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    var recognizer = null;
    var listening = false;

    function setMicListening(on) {
      listening = !!on;
      if (micBtn) micBtn.classList.toggle('listening', listening);
    }

    if (micBtn) {
      micBtn.addEventListener('click', function() {
        if (!SR) {
          flash('Voice input not supported in this browser — try Chrome', 'info');
          return;
        }
        if (listening && recognizer) {
          try { recognizer.stop(); } catch (_) {}
          return;
        }
        recognizer = new SR();
        recognizer.lang = (navigator.language || 'en-US');
        recognizer.continuous = false;
        recognizer.interimResults = true;
        var baseValue = input.value || '';
        recognizer.onresult = function(evt) {
          var transcript = '';
          for (var i = evt.resultIndex; i < evt.results.length; i++) {
            transcript += evt.results[i][0].transcript;
          }
          input.value = (baseValue ? baseValue + ' ' : '') + transcript;
          autosize();
        };
        recognizer.onstart = function() { setMicListening(true); flash('Listening…', 'info'); };
        recognizer.onerror = function(e) { setMicListening(false); flash('Voice: ' + (e && e.error || 'error'), 'error'); };
        recognizer.onend = function() { setMicListening(false); };
        try { recognizer.start(); }
        catch (_) { flash('Voice failed to start', 'error'); setMicListening(false); }
      });
    }

    // ── Re-render chips on state signals ──
    // Selection changes come from canvas/click handlers; we poll lightly
    // because there's no central event bus. 250ms is below perception
    // threshold, above CPU noise floor.
    var lastSig = '';
    function chipWatcher() {
      var sig = (state.selection && state.selection.inode || '') + '|' +
                (state.currentViewport || '') + '|' +
                ((document.querySelector('[data-brand-picker-label]') || {}).textContent || '');
      if (sig !== lastSig) {
        lastSig = sig;
        renderChips();
      }
    }
    setInterval(chipWatcher, 250);
    renderChips();
    autosize();

    // ── Prefill from ?prompt= query param (starter-card entry) ──
    // Starter cards on the empty dashboard pass a tailored brief through
    // the URL. We populate the textarea (but don't auto-send) so the
    // designer can tweak before dispatching. The param is consumed once
    // then wiped via replaceState so a refresh doesn't refill.
    (function consumeStarterPrompt() {
      try {
        var params = new URLSearchParams(location.search);
        var seed = params.get('prompt');
        if (!seed) return;
        input.value = seed;
        autosize();
        input.focus();
        // Place caret at end so the user can edit or just hit ⌘↵.
        try { input.setSelectionRange(input.value.length, input.value.length); } catch (_) {}
        params.delete('prompt');
        var qs = params.toString();
        var newUrl = location.pathname + (qs ? '?' + qs : '') + location.hash;
        history.replaceState(history.state, '', newUrl);
      } catch (_) { /* no-op — URLSearchParams unavailable */ }
    })();

    // ── Replay persisted chat on load ───────────────────────
    // Boot payload carries the project's chat history. Walk messages
    // in order and rebuild the DOM: user/assistant bubbles, tool cards
    // with the paired tool_result status filled in, TodoWrite renders
    // as the live checklist with the latest state. sessionId gets
    // primed so the next send `--resume`s the same Claude session.
    replayHistory();

    function replayHistory() {
      var boot = window.__REFRAME_BOOT__;
      var chat = boot && boot.chat;
      if (!chat || !Array.isArray(chat.messages) || chat.messages.length === 0) return;
      if (chat.sessionId) state.agentSessionId = chat.sessionId;

      // First pass: index tool_result by toolUseId so we can attach
      // the final status to the card on the tool_use pass.
      var resultsById = {};
      for (var i = 0; i < chat.messages.length; i++) {
        var m = chat.messages[i];
        if (m && m.role === 'tool_result' && m.toolUseId) {
          resultsById[m.toolUseId] = m;
        }
      }

      // Second pass: render in order.
      for (var j = 0; j < chat.messages.length; j++) {
        var msg = chat.messages[j];
        if (!msg) continue;
        if (msg.role === 'user') {
          appendBubble('user', msg.text || '');
        } else if (msg.role === 'assistant') {
          var restored = appendBubble('assistant', msg.text || '');
          // Run the same sealing pass the streaming 'done' event uses,
          // otherwise persisted bubbles ship raw <choices>X|Y</choices>
          // markers as visible text instead of clickable chips.
          finalizeBubbleChoices(restored);
        } else if (msg.role === 'tool_use') {
          if (msg.toolName === 'TodoWrite') {
            // TodoWrite may appear multiple times — each call redraws
            // the same card in place, so only the LAST call's state is
            // visible after replay. We let the loop do that naturally.
            renderTodoChecklist(msg.input && msg.input.todos);
          } else {
            var card = appendToolCard(msg.toolName, msg.input, msg.toolUseId);
            // Apply the matching tool_result status if we have it.
            var r = resultsById[msg.toolUseId];
            if (card && r) {
              var statusEl = card.querySelector('[data-tool-status]');
              if (statusEl) {
                statusEl.textContent = r.ok ? 'ok' : 'error';
                statusEl.classList.toggle('ok', !!r.ok);
                statusEl.classList.toggle('err', !r.ok);
              }
              var resEl = card.querySelector('[data-tool-result]');
              if (resEl && r.preview) {
                resEl.removeAttribute('hidden');
                resEl.textContent = r.preview;
              }
            }
          }
        }
        // tool_result is handled via the index above — standalone rows
        // (no matching tool_use) are dropped as orphans.
      }
    }
  }
