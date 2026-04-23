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

    // ── Muted chip tracking (kind → bool). Reset when scene changes. ──
    if (!state.bottomChatChipsMuted) state.bottomChatChipsMuted = {};

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
        return '<span class="bc-chip' + (muted ? ' muted' : '') + '" data-chip-kind="' + c.kind + '">' +
          '<span class="bc-chip-icon">' + c.icon + '</span>' +
          '<span class="bc-chip-label">' + escape(c.label) + '</span>' +
          '<button class="bc-chip-x" data-chip-toggle="' + c.kind + '" aria-label="Toggle ' + c.kind + '">' +
            (muted ? '+' : '×') +
          '</button>' +
        '</span>';
      }).join('');
    }

    function collectChips() {
      var out = [];
      // Selected node
      if (state.selection && state.selection.inode) {
        var tag = (state.selection.tag || 'node').toLowerCase();
        out.push({ kind: 'node', icon: '◉', label: tag + ' · ' + shortId(state.selection.inode) });
      }
      // Active brand. The dashboard has a [data-brand-picker-label],
      // the project page does not — it surfaces brand only via the
      // project health endpoint. Read the DOM first (dashboard path),
      // then fall back to the global the toolbar stashes after its
      // health probe resolves (project-page path). Without the fallback
      // the agent lost the brand chip on every project session and the
      // [Scope: …] prefix went out to the LLM without the active brand.
      var brandLabel = document.querySelector('[data-brand-picker-label]');
      var brandText = brandLabel ? (brandLabel.textContent || '').trim() : '';
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

    // Chip × / + toggles mute
    chipsEl.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-chip-toggle]');
      if (!btn) return;
      var kind = btn.getAttribute('data-chip-toggle');
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
    }

    // Phase 4.1 — chat intent shortcuts. Map simple keywords to immediate
    // panel-mount calls without spinning up the full Claude/agent
    // subprocess (5-60s cold start). Runs BEFORE streamChat's fetch;
    // hit → short-circuit + return true. Narrow matches intentionally
    // fall through when vague so the real agent still handles open-ended
    // asks.
    function tryChatIntent(prompt) {
      var p = String(prompt || '').toLowerCase().trim();
      if (!p) return false;

      function mount(panel, config) {
        appendBubble('user', prompt);
        var bubble = appendBubble('assistant', 'Mounting ' + panel + '...');
        fetch('/platform/api/panel-mount', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ panel: panel, slot: 'right-panel', config: config || {} }),
        }).then(function(r) { return r.json(); }).then(function(res) {
          bubble.textContent = res && res.ok
            ? 'Mounted ' + panel + ' (' + (res.nodeCount || 0) + ' nodes, ' + (res.composeMs || 0) + 'ms)'
            : 'Mount failed: ' + (res && res.error || 'unknown');
        }).catch(function() { bubble.textContent = 'Mount failed (network)'; });
      }

      function unmount(panel) {
        appendBubble('user', prompt);
        var bubble = appendBubble('assistant', 'Unmounting ' + panel + '...');
        fetch('/platform/api/panel-unmount', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ panel: panel, slot: 'right-panel' }),
        }).then(function(r) { return r.json(); }).then(function() {
          bubble.textContent = 'Unmounted ' + panel;
        }).catch(function() { bubble.textContent = 'Unmount failed'; });
      }

      // brand-palette — "palette" / "edit brand" / "brand colors"
      if (/\b(brand\s+palette|^palette$|palette\b|brand\s+colors?|edit\s+brand)\b/.test(p)) {
        var activeBrand = window.__reframeActiveBrand || '';
        mount('brand-palette', activeBrand ? { brandSlug: activeBrand } : {});
        return true;
      }
      // variant-picker — "variants" / "variant picker"
      if (/\b(variant\s+picker|variants?)\b/.test(p)) {
        var sid = state.currentSceneId
          || (document.querySelector('[data-session]') && document.querySelector('[data-session]').getAttribute('data-session'));
        mount('variant-picker', sid ? { sceneId: sid } : {});
        return true;
      }
      // inspector — "inspect" / "properties"
      if (/\b(inspector|inspect\s+node|inspect|properties|props)\b/.test(p)) {
        var sel = window.__reframeSelection || {};
        mount('inspector', sel.inode && sel.sceneId ? { nodeId: sel.inode, sceneId: sel.sceneId } : {});
        return true;
      }
      // close — "close panel" / "unmount X" / "hide palette"
      var closeMatch = p.match(/\b(close|unmount|hide|dismiss)\s+(panel|inspector|palette|picker|variant|brand)/);
      if (closeMatch) {
        var which = closeMatch[2];
        var target = which === 'palette' || which === 'brand' ? 'brand-palette'
          : which === 'picker' || which === 'variant' ? 'variant-picker'
          : 'inspector';
        unmount(target);
        return true;
      }
      return false;
    }

    // ── SSE stream parser. EventSource can't POST, so fetch + ReadableStream. ──
    function streamChat(prompt) {
      // Intent shortcut — fast path for mount/unmount commands; skips
      // the Claude subprocess entirely. Falls through when the prompt
      // isn't a recognized intent (most asks).
      if (tryChatIntent(prompt)) return;

      setSending(true);
      appendBubble('user', prompt);
      pendingAssistantBubble = null;
      state.agentTodoCard = null; // start a fresh checklist for this turn
      // Thinking indicator: before Claude emits its first text/tool_use
      // event there's a 5-60 s gap while the subprocess boots the session,
      // loads context, and waits for the first API token. Without this
      // placeholder the chat looks dead and users hit send again. Removed
      // by the first event handler below (text | tool_use | tool_result).
      thinkingBubble = appendBubble('assistant thinking', '\u2026');
      thinkingBubble.setAttribute('data-testid', 'chat-thinking');
      // NB: intent-shortcut `tryChatIntent` runs BEFORE this \u2014 see above.

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
      var scopeLine = '';
      if (chips.length > 0) {
        var parts = chips.map(function(c) { return c.kind + ': ' + c.label; });
        scopeLine = '[Scope: ' + parts.join(' · ') + ']\n';
      }
      var fullPrompt = scopeLine + text;
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
