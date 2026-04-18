  // ── Agent chat panel ──────────────────────────────────────────────
  // Embedded Claude Code agent. Talks to /api/agent/chat which spawns
  // claude (-p, --output-format stream-json) server-side and pipes parsed
  // events back as SSE. We render text/tool_use/tool_result inline so the
  // user sees what the agent is doing without leaving the UI.
  function initAgentPanel() {
    state.agentPanelLoaded = true;

    var statusDot = $('[data-agent-status-dot]');
    var banner = $('[data-agent-banner]');
    var logEl = $('[data-agent-log]');
    var inputEl = $('[data-agent-input]');
    var sendBtn = $('[data-agent-send]');
    var cancelBtn = $('[data-agent-cancel]');
    var clearBtn = $('[data-agent-clear]');

    // Health — read from boot payload when available, fall back to fetch.
    var bootAgentInfo = bootAgent();
    if (bootAgentInfo) {
      applyAgentHealth(bootAgentInfo);
    } else {
      fetch('/api/agent/health').then(function(r) { return r.json(); }).then(applyAgentHealth).catch(function() {
        if (statusDot) statusDot.style.background = '#e85a5a';
      });
    }
    function applyAgentHealth(h) {
      if (!h || !h.claudeFound) {
        if (statusDot) statusDot.style.background = '#e85a5a';
        if (banner) {
          banner.style.display = '';
          banner.innerHTML = 'Claude Code CLI not found. <a href="https://claude.com/download" target="_blank" style="color:var(--accent)">Install</a> then refresh.';
        }
      } else {
        if (statusDot) statusDot.style.background = '#36c777';
      }
    }

    function clearLog() {
      if (logEl) logEl.innerHTML = '';
      state.agentSessionId = null;
      state.agentToolMap = {};
    }

    function appendBubble(role, content) {
      if (!logEl) return null;
      // Drop the empty-state placeholder on first real message.
      var empty = logEl.querySelector('.agent-empty');
      if (empty) empty.remove();
      var b = document.createElement('div');
      b.className = 'agent-bubble agent-' + role;
      var bg = role === 'user' ? 'var(--accent)' : 'var(--surface-elevated)';
      var color = role === 'user' ? '#fff' : 'var(--text-primary)';
      var align = role === 'user' ? 'flex-end' : 'flex-start';
      b.style.cssText = 'align-self:' + align + ';max-width:92%;padding:8px 10px;border-radius:8px;background:' + bg + ';color:' + color + ';word-break:break-word';
      if (role === 'assistant') {
        b._raw = content || '';
        b.innerHTML = renderMarkdown(b._raw);
      } else {
        b.style.whiteSpace = 'pre-wrap';
        b.textContent = content;
      }
      logEl.appendChild(b);
      logEl.scrollTop = logEl.scrollHeight;
      return b;
    }

    // ── Minimal markdown renderer ───────────────────────────────────
    // Self-contained, zero deps. Escapes HTML first then reconstructs
    // only a known-safe subset (headings, bold, italic, code, lists,
    // blockquote, hr, links, paragraphs). Link hrefs are restricted
    // to http(s):// to block javascript: vectors. Code blocks keep a
    // `lang-X` class hook so a highlighter can be layered on later.
    function renderMarkdown(src) {
      if (!src) return '';
      src = String(src);
      // 1. Extract fenced code blocks before any escaping/transforms.
      var codes = [];
      src = src.replace(/```([\w+-]*)\s*\n?([\s\S]*?)```/g, function(_, lang, body) {
        codes.push({ lang: lang || '', body: body.replace(/\n$/, '') });
        return '\uE000CODE' + (codes.length - 1) + '\uE001';
      });
      // 2. Escape all HTML in the remainder.
      src = src.replace(/[&<>"']/g, function(c) {
        return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
      });
      // 3. Inline code.
      src = src.replace(/`([^`\n]+)`/g, '<code class="md-ci">$1</code>');
      // 4. Bold then italic (order matters — ** before *).
      src = src.replace(/\*\*([^\*\n]+)\*\*/g, '<strong>$1</strong>');
      src = src.replace(/(^|[^\*\w])\*([^\*\n]+)\*/g, '$1<em>$2</em>');
      src = src.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');
      // 5. Links [text](url) — http(s) only.
      src = src.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function(_, text, url) {
        if (!/^https?:\/\//i.test(url) && !/^\//.test(url)) return text;
        return '<a href="' + url + '" target="_blank" rel="noopener">' + text + '</a>';
      });
      // 6. Block-level pass — split into lines, accumulate blocks.
      var lines = src.split('\n');
      var out = [];
      var i = 0;
      var CODE_RE = /^\uE000CODE\d+\uE001$/;
      while (i < lines.length) {
        var line = lines[i];
        // Standalone code-block placeholder — emit as-is, resolved later.
        if (CODE_RE.test(line.trim())) { out.push(line.trim()); i++; continue; }
        // Heading
        var mh = /^(#{1,6})\s+(.*)$/.exec(line);
        if (mh) {
          out.push('<h' + mh[1].length + ' class="md-h md-h' + mh[1].length + '">' + mh[2] + '</h' + mh[1].length + '>');
          i++; continue;
        }
        // Horizontal rule
        if (/^\s*(-{3,}|_{3,}|\*{3,})\s*$/.test(line)) { out.push('<hr class="md-hr">'); i++; continue; }
        // Blockquote
        if (/^>\s?/.test(line)) {
          var bq = [];
          while (i < lines.length && /^>\s?/.test(lines[i])) { bq.push(lines[i].replace(/^>\s?/, '')); i++; }
          out.push('<blockquote class="md-bq">' + bq.join('<br>') + '</blockquote>');
          continue;
        }
        // Unordered list
        if (/^\s*[-*+]\s+/.test(line)) {
          var ui = [];
          while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
            ui.push('<li>' + lines[i].replace(/^\s*[-*+]\s+/, '') + '</li>');
            i++;
          }
          out.push('<ul class="md-ul">' + ui.join('') + '</ul>');
          continue;
        }
        // Ordered list
        if (/^\s*\d+\.\s+/.test(line)) {
          var oi = [];
          while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
            oi.push('<li>' + lines[i].replace(/^\s*\d+\.\s+/, '') + '</li>');
            i++;
          }
          out.push('<ol class="md-ol">' + oi.join('') + '</ol>');
          continue;
        }
        // Blank line
        if (line.trim() === '') { i++; continue; }
        // Paragraph — gather until blank line or new block start.
        var para = [line]; i++;
        while (i < lines.length && lines[i].trim() !== '' &&
               !CODE_RE.test(lines[i].trim()) &&
               !/^(#{1,6}\s|>\s?|\s*[-*+]\s|\s*\d+\.\s|-{3,}|_{3,}|\*{3,})/.test(lines[i])) {
          para.push(lines[i]); i++;
        }
        out.push('<p class="md-p">' + para.join('<br>') + '</p>');
      }
      var html = out.join('');
      // 7. Restore code blocks.
      html = html.replace(/\uE000CODE(\d+)\uE001/g, function(_, idx) {
        var c = codes[parseInt(idx, 10)];
        var body = c.body.replace(/[&<>"']/g, function(ch) {
          return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[ch];
        });
        var cls = 'md-cb' + (c.lang ? ' lang-' + c.lang.replace(/[^\w-]/g, '') : '');
        return '<pre class="md-pre"><code class="' + cls + '">' + body + '</code></pre>';
      });
      return html;
    }

    // ── TodoWrite pinned panel ──────────────────────────────────────
    // Each TodoWrite tool call carries {todos:[{content,status,activeForm}]}.
    // Instead of a one-off card, render a single sticky panel at the top
    // of the log and re-render (not re-append) on every subsequent call,
    // so the user sees the plan mutate in place.
    function renderTodoPanel(todos) {
      if (!logEl || !Array.isArray(todos)) return;
      var panel = logEl.querySelector('[data-agent-todo-panel]');
      if (!panel) {
        panel = document.createElement('div');
        panel.setAttribute('data-agent-todo-panel', '');
        panel.className = 'agent-todo-panel';
        logEl.insertBefore(panel, logEl.firstChild);
      }
      var done = 0, active = 0;
      todos.forEach(function(t) {
        if (t.status === 'completed') done++;
        else if (t.status === 'in_progress') active++;
      });
      var total = todos.length;
      var pct = total ? Math.round(done / total * 100) : 0;
      var rows = todos.map(function(t) {
        var s = t.status || 'pending';
        var ico = s === 'completed' ? '✓' : s === 'in_progress' ? '◐' : '○';
        var label = s === 'in_progress' && t.activeForm ? t.activeForm : t.content || '';
        return '<li class="agent-todo-item agent-todo-' + s + '">' +
          '<span class="agent-todo-ico">' + ico + '</span>' +
          '<span class="agent-todo-text">' + escapeHtml(label) + '</span>' +
        '</li>';
      }).join('');
      panel.innerHTML =
        '<div class="agent-todo-head">' +
          '<span class="agent-todo-title">Plan · ' + done + '/' + total +
            (active ? ' · <em>' + escapeHtml((todos.find(function(t){return t.status==='in_progress';})||{}).activeForm || 'working') + '</em>' : '') +
          '</span>' +
          '<span class="agent-todo-bar"><span class="agent-todo-bar-fill" style="width:' + pct + '%"></span></span>' +
        '</div>' +
        '<ul class="agent-todo-list">' + rows + '</ul>';
    }

    function appendToolCard(toolName, input, toolUseId) {
      if (!logEl) return null;
      var empty = logEl.querySelector('.agent-empty');
      if (empty) empty.remove();
      var card = document.createElement('div');
      card.className = 'agent-tool';
      card.style.cssText = 'align-self:flex-start;max-width:92%;padding:6px 8px;border-radius:6px;background:var(--surface-elevated);border:1px solid var(--border);font-family:var(--mono,monospace);font-size:11px';
      var inputPreview = '';
      try {
        var s = JSON.stringify(input);
        if (s && s.length > 80) s = s.slice(0, 80) + '...';
        inputPreview = s || '';
      } catch (_) {}
      card.innerHTML = '<div style="display:flex;align-items:center;gap:6px;color:var(--text-primary)"><span style="opacity:.6">🔧</span><strong>' + escapeHtml(toolName) + '</strong><span data-tool-status style="margin-left:auto;font-size:10px;color:var(--text-muted)">running…</span></div>' +
        (inputPreview ? '<div style="margin-top:3px;color:var(--text-muted);font-size:10px">' + escapeHtml(inputPreview) + '</div>' : '') +
        '<div data-tool-result style="display:none;margin-top:4px;padding-top:4px;border-top:1px dashed var(--border);color:var(--text-muted);font-size:10px;white-space:pre-wrap;max-height:80px;overflow-y:auto"></div>';
      logEl.appendChild(card);
      logEl.scrollTop = logEl.scrollHeight;
      if (toolUseId) state.agentToolMap[toolUseId] = card;
      return card;
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, function(c) {
        return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
      });
    }

    function setSending(on) {
      if (sendBtn) { sendBtn.disabled = on; sendBtn.textContent = on ? 'Working…' : 'Send'; }
      if (cancelBtn) cancelBtn.style.display = on ? '' : 'none';
      if (inputEl) inputEl.disabled = on;
    }

    // Parse SSE stream produced by /api/agent/chat. The browser EventSource
    // API cannot do POST, so we use fetch + ReadableStream and parse the
    // text/event-stream format by hand (each event is one event-line plus
    // one data-line, separated from the next event by a blank line).
    function streamChat(prompt) {
      setSending(true);
      var body = { prompt: prompt };
      if (state.agentSessionId) body.sessionId = state.agentSessionId;
      // Tell the server which scene the user is currently editing so the
      // preamble can include scene id, dimensions, and brand. Without
      // this, claude has no idea what "header" / "this section" mean.
      var sid = state.currentSceneId
        || (document.querySelector('[data-session]') && document.querySelector('[data-session]').getAttribute('data-session'))
        || (document.querySelector('canvas[data-session]') && document.querySelector('canvas[data-session]').getAttribute('data-session'));
      if (sid) body.sceneId = sid;

      // User bubble first.
      appendBubble('user', prompt);

      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      state.agentReader = ctrl; // store the controller so cancelBtn can abort.

      fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl ? ctrl.signal : undefined,
      }).then(function(resp) {
        if (!resp.ok || !resp.body) throw new Error('HTTP ' + resp.status);
        var reader = resp.body.getReader();
        var decoder = new TextDecoder();
        var buf = '';

        function processBuf() {
          // SSE events are separated by blank lines.
          var idx;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            var raw = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            handleSseBlock(raw);
          }
        }

        function pump() {
          return reader.read().then(function(r) {
            if (r.done) {
              if (buf.trim()) handleSseBlock(buf);
              setSending(false);
              return;
            }
            buf += decoder.decode(r.value, { stream: true });
            processBuf();
            return pump();
          });
        }
        return pump();
      }).catch(function(err) {
        if (err && err.name === 'AbortError') {
          appendBubble('assistant', '[cancelled]');
        } else {
          appendBubble('assistant', '[error] ' + (err && err.message ? err.message : err));
        }
        setSending(false);
      });
    }

    function handleSseBlock(raw) {
      // Each block: "event: <name>" + "data: <json>" lines (other lines ignored).
      var ev = null;
      var data = null;
      raw.split(/\r?\n/).forEach(function(line) {
        if (line.indexOf('event:') === 0) {
          ev = line.slice(6).trim();
        } else if (line.indexOf('data:') === 0) {
          var rest = line.slice(5).trim();
          try { data = JSON.parse(rest); } catch (_) { data = rest; }
        }
      });
      if (!ev || data === null) return;
      handleAgentEvent(ev, data);
    }

    var pendingAssistantBubble = null;

    function handleAgentEvent(name, data) {
      switch (name) {
        case 'chat_id':
          state.agentChatId = data.chatId;
          break;
        case 'session_start':
          state.agentSessionId = data.sessionId || state.agentSessionId;
          pendingAssistantBubble = null;
          break;
        case 'text':
          // Coalesce successive text blocks into one bubble for readability.
          // Re-render markdown on each chunk so streaming looks live.
          if (!pendingAssistantBubble) {
            pendingAssistantBubble = appendBubble('assistant', data.text);
          } else {
            pendingAssistantBubble._raw = (pendingAssistantBubble._raw || '') + data.text;
            pendingAssistantBubble.innerHTML = renderMarkdown(pendingAssistantBubble._raw);
            if (logEl) logEl.scrollTop = logEl.scrollHeight;
          }
          break;
        case 'tool_use':
          pendingAssistantBubble = null; // break the bubble before a tool call
          // TodoWrite gets a dedicated sticky panel instead of a card.
          if (data.toolName === 'TodoWrite' && data.input && Array.isArray(data.input.todos)) {
            renderTodoPanel(data.input.todos);
            if (data.toolUseId) state.agentToolMap[data.toolUseId] = { _isTodo: true };
          } else {
            appendToolCard(data.toolName, data.input, data.toolUseId);
          }
          break;
        case 'tool_result':
          var card = state.agentToolMap[data.toolUseId];
          if (card && card._isTodo) break; // Todo panel manages its own state
          if (card) {
            var statusEl = card.querySelector('[data-tool-status]');
            if (statusEl) {
              statusEl.textContent = data.ok ? 'ok' : 'error';
              statusEl.style.color = data.ok ? '#36c777' : '#e85a5a';
            }
            var resEl = card.querySelector('[data-tool-result]');
            if (resEl && data.preview) {
              resEl.style.display = '';
              resEl.textContent = data.preview;
            }
          }
          break;
        case 'done':
          pendingAssistantBubble = null;
          if (data.cost && logEl) {
            var meta = document.createElement('div');
            meta.style.cssText = 'align-self:center;font-size:10px;color:var(--text-muted);padding:4px 0';
            meta.textContent = 'Done in ' + Math.round(data.durationMs / 100) / 10 + 's' + (data.cost ? ' · $' + data.cost.toFixed(4) : '');
            logEl.appendChild(meta);
            logEl.scrollTop = logEl.scrollHeight;
          }
          break;
        case 'error':
          appendBubble('assistant', '[error] ' + (data.message || data.code || 'unknown'));
          break;
      }
    }

    if (sendBtn) {
      sendBtn.addEventListener('click', function() {
        var text = (inputEl && inputEl.value || '').trim();
        if (!text) return;
        if (inputEl) inputEl.value = '';
        streamChat(text);
      });
    }
    if (inputEl) {
      inputEl.addEventListener('keydown', function(e) {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          if (sendBtn) sendBtn.click();
        }
      });
    }
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function() {
        // Best-effort cancel: tell server (kills subprocess) AND abort the stream.
        if (state.agentChatId) {
          fetch('/api/agent/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatId: state.agentChatId }),
          }).catch(function() {});
        }
        if (state.agentReader && state.agentReader.abort) {
          try { state.agentReader.abort(); } catch (_) {}
        }
        setSending(false);
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', clearLog);
    }
  }

  function initVaryPanel() {
    state.varyPanelLoaded = true;
    fetch('/platform/api/variations/presets')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.ok) return;
        renderVaryControls(data.presets);
        renderVaryGridAxes(data.presets);
      })
      .catch(function(err) { console.error('presets fetch failed', err); });
  }

  function renderVaryControls(presets) {
    var container = $('[data-vary-controls]');
    if (!container) return;
    var html = '';
    html += '<div class="t-caption" style="color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px">Quick apply</div>';
    html += '<div class="t-body" style="color:var(--text-muted);font-size:12px;margin-bottom:8px">Click a preset to apply it in-place on the current scene.</div>';

    Object.keys(presets).forEach(function(kind) {
      var preset = presets[kind];
      if (kind === 'mode') return; // mode handled in rebrand panel
      html += '<div data-vary-axis-group="' + kind + '" style="display:flex;flex-direction:column;gap:6px">';
      html += '<div class="t-caption" style="color:var(--text-base);font-weight:600">' + preset.label + '</div>';
      if (preset.description) {
        html += '<div class="t-body" style="color:var(--text-muted);font-size:11px">' + preset.description + '</div>';
      }
      if (preset.kind === 'slider') {
        html += '<div style="display:flex;align-items:center;gap:8px">';
        html += '<input type="range" data-vary-slider="' + kind + '" min="' + preset.min + '" max="' + preset.max + '" step="' + preset.step + '" value="' + preset.default + '" style="flex:1">';
        html += '<span data-vary-slider-value="' + kind + '" style="min-width:32px;font-size:12px;color:var(--text-muted)">' + preset.default + '</span>';
        html += '<button data-vary-apply="' + kind + '" class="btn-apply" style="padding:4px 10px;background:var(--accent);color:var(--on-accent);border:none;border-radius:4px;cursor:pointer;font-size:12px">Apply</button>';
        html += '</div>';
      } else if (preset.kind === 'enum') {
        html += '<div style="display:flex;flex-wrap:wrap;gap:6px">';
        preset.options.forEach(function(opt) {
          html += '<button data-vary-preset="' + kind + '" data-vary-value="' + opt.value + '" class="btn-preset" style="padding:6px 10px;background:var(--surface);color:var(--text-base);border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:12px">' + opt.label + '</button>';
        });
        html += '</div>';
      }
      html += '</div>';
    });

    container.innerHTML = html;

    // Bind slider value display + apply buttons
    $$('[data-vary-slider]').forEach(function(slider) {
      var kind = slider.getAttribute('data-vary-slider');
      var valueEl = $('[data-vary-slider-value="' + kind + '"]');
      slider.addEventListener('input', function() {
        if (valueEl) valueEl.textContent = slider.value;
      });
    });
    $$('[data-vary-apply]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var kind = btn.getAttribute('data-vary-apply');
        var slider = $('[data-vary-slider="' + kind + '"]');
        if (slider) applyVariation(kind, parseFloat(slider.value));
      });
    });
    $$('[data-vary-preset]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var kind = btn.getAttribute('data-vary-preset');
        var value = btn.getAttribute('data-vary-value');
        applyVariation(kind, value);
      });
    });
  }

  function applyVariation(kind, value) {
    var sceneId = getCurrentSessionId();
    if (!sceneId || !kind) return;
    fetch('/platform/api/variations/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sceneId: sceneId, kind: kind, value: value }),
    })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.ok) {
          refreshViewports();
        } else {
          console.error('variation failed', data.error);
        }
      });
  }

  function renderVaryGridAxes(presets) {
    var container = $('[data-vary-grid-axes]');
    if (!container) return;
    var html = '';

    // Brand axis (checkboxes from current brands list)
    var brandsList = (window).__REFRAME_BRANDS__ || [];
    if (brandsList.length > 0) {
      html += '<div><div class="t-caption" style="color:var(--text-muted);margin-bottom:4px">Brand</div><div style="display:flex;flex-wrap:wrap;gap:6px">';
      brandsList.forEach(function(b) {
        html += '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px"><input type="checkbox" data-vary-grid="brand" value="' + b + '">' + b + '</label>';
      });
      html += '</div></div>';
    }

    // Density (multi-value slider buttons)
    html += '<div><div class="t-caption" style="color:var(--text-muted);margin-bottom:4px">Density values</div><div style="display:flex;flex-wrap:wrap;gap:6px">';
    ['0.7','0.85','1.0','1.15','1.3'].forEach(function(v) {
      html += '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px"><input type="checkbox" data-vary-grid="density" value="' + v + '">' + v + '</label>';
    });
    html += '</div></div>';

    // Radius strategies
    html += '<div><div class="t-caption" style="color:var(--text-muted);margin-bottom:4px">Radius</div><div style="display:flex;flex-wrap:wrap;gap:6px">';
    ['sharp','editorial','soft','pill'].forEach(function(v) {
      html += '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px"><input type="checkbox" data-vary-grid="radius" value="' + v + '">' + v + '</label>';
    });
    html += '</div></div>';

    // Typography presets
    html += '<div><div class="t-caption" style="color:var(--text-muted);margin-bottom:4px">Typography</div><div style="display:flex;flex-wrap:wrap;gap:6px">';
    ['dramatic','flat','editorial','technical','friendly'].forEach(function(v) {
      html += '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px"><input type="checkbox" data-vary-grid="typography" value="' + v + '">' + v + '</label>';
    });
    html += '</div></div>';

    // Shadows
    html += '<div><div class="t-caption" style="color:var(--text-muted);margin-bottom:4px">Shadows</div><div style="display:flex;flex-wrap:wrap;gap:6px">';
    ['flat','subtle','normal','dramatic'].forEach(function(v) {
      html += '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px"><input type="checkbox" data-vary-grid="shadows" value="' + v + '">' + v + '</label>';
    });
    html += '</div></div>';

    // Modes
    html += '<div><div class="t-caption" style="color:var(--text-muted);margin-bottom:4px">Mode</div><div style="display:flex;flex-wrap:wrap;gap:6px">';
    ['light','dark'].forEach(function(v) {
      html += '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px"><input type="checkbox" data-vary-grid="mode" value="' + v + '">' + v + '</label>';
    });
    html += '</div></div>';

    container.innerHTML = html;
  }

  function bindVaryGridButton() {
    var btn = $('[data-vary-grid-generate]');
    if (!btn) return;
    btn.addEventListener('click', function() {
      var sceneId = getCurrentSessionId();
      if (!sceneId) return;
      // Collect selected values from checkboxes
      var axes = {};
      ['brand','density','radius','typography','shadows','mode'].forEach(function(axis) {
        var values = [];
        $$('[data-vary-grid="' + axis + '"]:checked').forEach(function(cb) {
          var v = cb.value;
          if (axis === 'density') v = parseFloat(v);
          values.push(v);
        });
        if (values.length > 0) axes[axis] = values;
      });
      if (Object.keys(axes).length === 0) {
        setVaryGridStatus('Select at least one axis value', true);
        return;
      }
      var total = 1;
      Object.keys(axes).forEach(function(k) { total *= axes[k].length; });
      setVaryGridStatus('Generating ' + total + ' variants…');
      fetch('/platform/api/variations/grid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneId: sceneId, axes: axes }),
      })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.ok) {
            setVaryGridStatus('✓ Generated ' + data.generated.length + ' variants');
            renderVaryGridResults(data.generated);
          } else {
            setVaryGridStatus('Error: ' + (data.error || 'grid failed'), true);
          }
        })
        .catch(function(err) {
          setVaryGridStatus('Network error: ' + err, true);
        });
    });
  }

  function setVaryGridStatus(text, isError) {
    var el = $('[data-vary-grid-status]');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = isError ? 'var(--error, #f3727f)' : 'var(--text-muted)';
  }

  function renderVaryGridResults(generated) {
    var container = $('[data-vary-grid-results]');
    if (!container) return;
    if (!generated || generated.length === 0) {
      container.innerHTML = '';
      return;
    }
    var html = generated.map(function(v) {
      return '<a href="/platform/scene/' + v.sceneId + '" style="padding:6px 10px;background:var(--surface);border:1px solid var(--border);border-radius:4px;font-size:12px;color:var(--text-base);text-decoration:none;display:block">' +
        '<span style="color:var(--text-muted)">' + v.sceneId + '</span> · ' + v.label +
        '</a>';
    }).join('');
    container.innerHTML = html;
  }

  // ── Sections panel ─────────────────────────────────────
  var SECTION_ICONS = {
    nav: '◫', hero: '▣', section: '▧', content: '▦',
    stats: '▤', filters: '▥', cta: '◉', footer: '▨',
    background: '◻', heading: '▬', default: '□'
  };

  function fetchSections() {
    var sceneId = state.currentSceneSlug;
    if (!sceneId) return;
    // Use sessionId from page data attribute
    var el = $('[data-session]');
    var sessionId = el ? el.getAttribute('data-session') : sceneId;
    fetch('/platform/api/scene/sections?sceneId=' + encodeURIComponent(sessionId))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.ok) return;
        state.sectionsLoaded = true;
        renderSections(data.sections);
      })
      .catch(function(err) { console.error('sections fetch failed', err); });
  }

  function renderSections(sections) {
    var container = $('#sections-list');
    if (!container) return;
    if (!sections || sections.length === 0) {
      container.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted)" class="t-body">No sections found. Compile a page first.</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < sections.length; i++) {
      var s = sections[i];
      var icon = SECTION_ICONS[s.role] || SECTION_ICONS['default'];
      html += '<div class="section-card" data-node-id="' + s.nodeId + '" data-index="' + i + '"'
        + ' data-bx="' + s.bounds.x + '" data-by="' + s.bounds.y + '" data-bw="' + s.bounds.w + '" data-bh="' + s.bounds.h + '"'
        + ' draggable="true">'
        + '<div class="section-card-header">'
        + '<span class="section-icon">' + icon + '</span>'
        + '<span class="section-role t-caption">' + escapeHtml(s.role.toUpperCase()) + '</span>'
        + '<span class="section-dims t-caption" style="margin-left:auto;color:var(--text-muted)">' + s.bounds.w + '×' + s.bounds.h + '</span>'
        + '</div>'
        + '<div class="section-card-name t-body">' + escapeHtml(s.name) + '</div>'
        + (s.textPreview ? '<div class="section-card-preview t-caption" style="color:var(--text-muted)">' + escapeHtml(s.textPreview) + '</div>' : '')
        + '<div class="section-card-meta t-caption" style="color:var(--text-muted)">' + s.childCount + ' nodes</div>'
        + '</div>';
    }
    container.innerHTML = html;

    // Bind click → highlight in preview
    $$('.section-card').forEach(function(card) {
      card.addEventListener('click', function() {
        $$('.section-card').forEach(function(c) { c.classList.remove('selected'); });
        card.classList.add('selected');
        var nodeId = card.getAttribute('data-node-id');
        highlightSectionInPreview(nodeId);
      });
    });

    // Drag and drop reorder
    bindSectionDrag();
  }

  function highlightSectionInPreview(nodeId) {
    // Scroll the element into view in the iframe
    postToIframe({ type: 'reframe:highlight', inode: nodeId });

    // Draw a selection outline on the SVG overlay using the section's bounds
    var card = $('.section-card[data-node-id="' + nodeId + '"]');
    if (!card) return;
    // Get bounds from the sections data stored on the card
    var bx = parseFloat(card.getAttribute('data-bx') || '0');
    var by = parseFloat(card.getAttribute('data-by') || '0');
    var bw = parseFloat(card.getAttribute('data-bw') || '0');
    var bh = parseFloat(card.getAttribute('data-bh') || '0');
    if (bw > 0 && bh > 0) {
      drawSectionHighlight(bx, by, bw, bh);
    }
  }

  function drawSectionHighlight(x, y, w, h) {
    var outline = $('.select-outline');
    if (!outline) return;
    outline.setAttribute('x', String(x));
    outline.setAttribute('y', String(y));
    outline.setAttribute('width', String(w));
    outline.setAttribute('height', String(h));
    outline.classList.remove('hidden');
  }

  function clearSectionHighlight() {
    var outline = $('.select-outline');
    if (outline) outline.classList.add('hidden');
  }

  function bindSectionDrag() {
    var dragSrc = null;
    $$('.section-card').forEach(function(card) {
      card.addEventListener('dragstart', function(e) {
        dragSrc = card;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', card.getAttribute('data-index'));
      });
      card.addEventListener('dragend', function() {
        card.classList.remove('dragging');
        $$('.section-card').forEach(function(c) { c.classList.remove('drag-over'); });
        dragSrc = null;
      });
      card.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        card.classList.add('drag-over');
      });
      card.addEventListener('dragleave', function() {
        card.classList.remove('drag-over');
      });
      card.addEventListener('drop', function(e) {
        e.preventDefault();
        card.classList.remove('drag-over');
        if (!dragSrc || dragSrc === card) return;
        // Reorder in DOM
        var container = $('#sections-list');
        if (container) {
          var cards = Array.from(container.children);
          var fromIdx = cards.indexOf(dragSrc);
          var toIdx = cards.indexOf(card);
          if (fromIdx < toIdx) {
            container.insertBefore(dragSrc, card.nextSibling);
          } else {
            container.insertBefore(dragSrc, card);
          }
          // Collect new order and send to server
          var order = Array.from(container.children).map(function(c) {
            return c.getAttribute('data-node-id');
          }).filter(Boolean);
          reorderSections(order);
        }
      });
    });
  }

  function reorderSections(order) {
    var el = $('[data-session-id]');
    var sessionId = el ? el.getAttribute('data-session-id') : '';
    fetch('/platform/api/scene/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sceneId: sessionId, order: order })
    }).catch(function(err) { console.error('reorder failed', err); });
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Properties Inspector ────────────────────────────
  // Fetches CSS-named properties for the selected node and renders
  // editable controls. Every change fires POST /platform/api/node/edit
  // → engine applies → SSE → preview reloads. Real-time direct editing.

  var currentPropsNodeId = null;
