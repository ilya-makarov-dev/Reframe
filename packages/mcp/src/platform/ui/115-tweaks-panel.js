  // ── Tweaks panel — agent-declared live controls ──
  //
  // Reads tweak declarations from /platform/api/tweaks/get for the active
  // scene and renders a panel of color pickers / sliders / selects at the
  // top of the right-side Properties pane. Each control POSTs to
  // /platform/api/tweaks/apply on change; the engine mutates the graph
  // directly (setTokenValue or applyVariationToScene), no chat turn.
  //
  // Why this matters: a designer shouldn't need to burn a chat turn to
  // try "what if the accent were warmer" — the agent at compile time
  // picks the 3-6 knobs worth exposing and the UI surfaces them as
  // instant-feedback controls. Matches the pattern Claude Design and
  // open-codesign use for tweaks, but backed by reframe's typed engine.
  //
  // The panel auto-refreshes after each apply (iframe sources reload
  // via SSE `scene:session-changed` → refreshViewports). Values are
  // also debounced on sliders to avoid burning network on every pixel
  // of a drag — 120ms works as a "settled-enough-to-apply" threshold
  // without feeling laggy.

  function bindTweaksPanel() {
    var panel = $('[data-tweaks-panel]');
    var list = $('[data-tweaks-list]');
    var countEl = $('[data-tweaks-count]');
    if (!panel || !list) return;

    function currentSceneId() {
      var frame = $('.viewport-frame') ||
                  document.getElementById('reframe-viewport') ||
                  document.querySelector('[data-session]');
      return frame ? (frame.getAttribute('data-session') || frame.dataset.session || '') : '';
    }

    // Fetch + render. Called on init, after every apply, and on
    // scene:session-changed SSE (so re-compile picks up new declarations).
    async function refresh() {
      var sid = currentSceneId();
      if (!sid) {
        panel.setAttribute('hidden', '');
        list.innerHTML = '';
        return;
      }
      try {
        var r = await fetch('/platform/api/tweaks/get?sceneId=' + encodeURIComponent(sid));
        if (!r.ok) {
          panel.setAttribute('hidden', '');
          return;
        }
        var j = await r.json();
        var tweaks = (j && Array.isArray(j.tweaks)) ? j.tweaks : [];
        render(tweaks);
      } catch (_) {
        panel.setAttribute('hidden', '');
      }
    }

    function render(tweaks) {
      if (!tweaks || tweaks.length === 0) {
        panel.setAttribute('hidden', '');
        list.innerHTML = '';
        if (countEl) countEl.textContent = '';
        return;
      }
      panel.removeAttribute('hidden');
      if (countEl) countEl.textContent = String(tweaks.length);
      list.innerHTML = '';
      for (var i = 0; i < tweaks.length; i++) {
        list.appendChild(buildRow(tweaks[i]));
      }
    }

    function buildRow(t) {
      var row = document.createElement('div');
      row.className = 'tweak-row tweak-' + t.kind;
      row.setAttribute('data-tweak-id', t.id);

      var labelEl = document.createElement('div');
      labelEl.className = 'tweak-label';
      labelEl.textContent = t.label;
      if (t.description) labelEl.title = t.description;
      row.appendChild(labelEl);

      var control = document.createElement('div');
      control.className = 'tweak-control';

      if (t.kind === 'color') {
        var swatch = document.createElement('input');
        swatch.type = 'color';
        swatch.className = 'tweak-swatch';
        swatch.value = typeof t.default === 'string' ? t.default : '#000000';
        var hex = document.createElement('input');
        hex.type = 'text';
        hex.className = 'tweak-hex';
        hex.value = swatch.value;
        hex.spellcheck = false;
        hex.maxLength = 9;
        // Two-way bind swatch <-> hex so the designer can paste a hex
        // OR pick from the native picker; either way we apply once.
        swatch.addEventListener('input', function() {
          hex.value = swatch.value;
          queueApply(t, swatch.value);
        });
        hex.addEventListener('change', function() {
          var v = (hex.value || '').trim();
          if (/^#[0-9a-fA-F]{3,8}$/.test(v)) {
            swatch.value = v.length === 4 ? expandShortHex(v) : v.slice(0, 7);
            queueApply(t, v);
          } else {
            hex.value = swatch.value;
          }
        });
        control.appendChild(swatch);
        control.appendChild(hex);
      } else if (t.kind === 'number') {
        var slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'tweak-slider';
        var min = (typeof t.min === 'number') ? t.min : 0;
        var max = (typeof t.max === 'number') ? t.max : 1;
        var step = (typeof t.step === 'number') ? t.step : ((max - min) / 100);
        slider.min = String(min);
        slider.max = String(max);
        slider.step = String(step);
        slider.value = String(t.default);
        var readout = document.createElement('div');
        readout.className = 'tweak-readout';
        readout.textContent = formatNumber(t.default, t.unit);
        slider.addEventListener('input', function() {
          readout.textContent = formatNumber(Number(slider.value), t.unit);
          queueApply(t, Number(slider.value));
        });
        // Double-click readout resets to the default — standard pattern.
        readout.addEventListener('dblclick', function() {
          slider.value = String(t.default);
          readout.textContent = formatNumber(t.default, t.unit);
          queueApply(t, t.default);
        });
        control.appendChild(slider);
        control.appendChild(readout);
      } else if (t.kind === 'select') {
        var opts = Array.isArray(t.options) ? t.options : [];
        var sel = document.createElement('select');
        sel.className = 'tweak-select';
        for (var i = 0; i < opts.length; i++) {
          var o = document.createElement('option');
          o.value = opts[i].value;
          o.textContent = opts[i].label || opts[i].value;
          if (opts[i].value === t.default) o.selected = true;
          sel.appendChild(o);
        }
        sel.addEventListener('change', function() {
          queueApply(t, sel.value);
        });
        control.appendChild(sel);
      }

      row.appendChild(control);
      return row;
    }

    // Expand "#abc" → "#aabbcc" so <input type="color"> accepts it
    // (native picker only takes 6-digit hex + optional alpha).
    function expandShortHex(h) {
      if (h.length !== 4) return h;
      var r = h[1], g = h[2], b = h[3];
      return '#' + r + r + g + g + b + b;
    }

    function formatNumber(v, unit) {
      var n = Number(v);
      var s;
      if (Math.abs(n - Math.round(n)) < 0.005) s = String(Math.round(n));
      else if (Math.abs(n) < 1) s = n.toFixed(2);
      else s = n.toFixed(1);
      return s + (unit ? unit : '');
    }

    // Per-tweak apply. Two paths:
    //
    //  FAST PATH (token-op color/number tweaks):
    //    The exported scene HTML already uses CSS custom properties for
    //    every token-bound value (`background: var(--color-accent)` etc.).
    //    Overwriting the property on :root inside the iframe is a
    //    single-line, single-repaint operation — 0 ms perceived latency.
    //    We post the new value immediately on every input event, then
    //    fire the persisting HTTP request once the user releases the
    //    slider (300 ms debounce). Server-side graph stays authoritative;
    //    iframe rep just previews ahead of persistence.
    //
    //  SLOW PATH (macro-ops, anything without a CSS var):
    //    Single debounced HTTP apply (120 ms) — same flow as before.
    //    Macro ops like density/typography mutate many node properties
    //    in semantically-aware ways and can't be faithfully previewed
    //    client-side.
    var pending = {};
    function queueApply(tweak, value) {
      var isHotPathable = tweak.op && tweak.op.type === 'token'
                       && (tweak.kind === 'color' || tweak.kind === 'number');
      if (isHotPathable) {
        // Immediate visual preview via CSS var.
        hotPreview(tweak, value);
        // Debounced persist — longer than the slow path because we don't
        // need the "feels responsive" latency budget anymore (hot path
        // handled that) and a slower commit means fewer wasted requests
        // during a drag.
        if (pending[tweak.id]) clearTimeout(pending[tweak.id]);
        pending[tweak.id] = setTimeout(function() {
          delete pending[tweak.id];
          apply(tweak, value, /* skipRefresh = */ true);
        }, 300);
        return;
      }
      if (pending[tweak.id]) clearTimeout(pending[tweak.id]);
      pending[tweak.id] = setTimeout(function() {
        delete pending[tweak.id];
        apply(tweak, value);
      }, 120);
    }

    // Fast-path preview: push the new value directly into the iframe's
    // :root custom property so bound elements repaint in one frame. Falls
    // back to a no-op if the DOM canvas handle isn't mounted (e.g. on
    // dashboards) — downstream HTTP apply still ships the real change.
    function hotPreview(tweak, value) {
      var canvas = window.__reframeDOMCanvas;
      if (!canvas || typeof canvas.postToIframe !== 'function') return;
      if (!tweak.op || tweak.op.type !== 'token' || !tweak.op.tokenPath) return;
      // token "color.accent" → css var "--color-accent"
      var cssVar = '--' + tweak.op.tokenPath.replace(/\./g, '-');
      // Numbers need a unit when the CSS var is consumed as a length
      // (px for space.* tokens, deg for rotations). Tweak can declare a
      // unit; fall back to px for space.* and bare-number otherwise.
      var emitted = value;
      if (typeof value === 'number') {
        var unit = tweak.unit || (/^space\./i.test(tweak.op.tokenPath) ? 'px' : '');
        emitted = String(value) + (unit || '');
      }
      canvas.postToIframe({
        type: 'reframe:tweak-hot',
        updates: [{ cssVar: cssVar, value: emitted }],
      });
    }

    async function apply(tweak, value, skipRefresh) {
      var sid = currentSceneId();
      if (!sid) return;
      try {
        var r = await fetch('/platform/api/tweaks/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sceneId: sid, tweakId: tweak.id, value: value }),
        });
        if (!r.ok) {
          var txt = await r.text();
          flash('Tweak failed: ' + txt, 'error');
          return;
        }
        // On hot-path commits the iframe has already displayed the target
        // state via CSS var override; reloading would just redraw the
        // same pixels and fight the ongoing interaction. Skip the
        // refresh — SSE will drive one eventually for any host that
        // cares, and the DOM canvas's incremental patch reconciles when
        // a structural change actually happens.
        if (skipRefresh) return;
        if (typeof debouncedRefreshViewports === 'function') {
          debouncedRefreshViewports();
        } else if (typeof refreshViewports === 'function') {
          refreshViewports();
        }
      } catch (e) {
        flash('Tweak network error', 'error');
      }
    }

    // Refresh triggers: on init, on scene-changed SSE, and on scene-select
    // (project canvas can switch active scene without page reload).
    refresh();
    window.addEventListener('reframe:graph-changed', refresh);
    window.addEventListener('reframe:session-changed', refresh);
    window.addEventListener('reframe:canvas-select', function() {
      // Only re-fetch when the scene id actually changed.
      var sid = currentSceneId();
      if (panel.getAttribute('data-last-scene') !== sid) {
        panel.setAttribute('data-last-scene', sid);
        refresh();
      }
    });
  }
