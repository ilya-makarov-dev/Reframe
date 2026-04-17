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
    var micBtn = $('[data-bc-mic]');
    var chipsEl = $('[data-bc-chips]');
    if (!input || !sendBtn || !chipsEl) return;

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
      // Active brand (from the brand-picker label in the header)
      var brandLabel = document.querySelector('[data-brand-picker-label]');
      if (brandLabel) {
        var brand = (brandLabel.textContent || '').trim();
        if (brand && brand !== 'No brand') {
          out.push({ kind: 'brand', icon: '✦', label: brand });
        }
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

    // ── Send: build scope line + delegate to sidebar agent ──
    function send() {
      var text = (input.value || '').trim();
      if (!text) return;
      var chips = collectChips().filter(function(c) {
        return !state.bottomChatChipsMuted[c.kind];
      });
      var scopeLine = '';
      if (chips.length > 0) {
        var parts = chips.map(function(c) { return c.kind + ': ' + c.label; });
        scopeLine = '[Scope: ' + parts.join(' · ') + ']\n';
      }
      var fullPrompt = scopeLine + text;

      var sideInput = $('[data-agent-input]');
      var sideSend = $('[data-agent-send]');
      if (sideInput && sideSend) {
        sideInput.value = fullPrompt;
        sideSend.click();
        input.value = '';
        autosize();
        flash('Sent to agent', 'success');
      } else {
        flash('Agent panel not loaded', 'error');
      }
    }

    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', function(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        send();
      }
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
  }
