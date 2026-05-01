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
      // Phase 1 UI-6a Pin #4 — empty-state CTA. Don't hide the panel
      // when no tweaks are declared; render a muted CTA explaining
      // what tweaks are + how to ask the agent to add them. Designer
      // discovers the surface from first scene load instead of waiting
      // for the agent to declare them organically.
      if (!tweaks || tweaks.length === 0) {
        panel.removeAttribute('hidden');
        if (countEl) countEl.textContent = '0 declared';
        list.innerHTML =
          '<div class="tweaks-empty" data-tweaks-empty>'
          + '<div class="tweaks-empty-copy">'
          +   'Scene-wide knobs the agent declares as live controls — '
          +   'colors, spacing, density. Ask the agent to add some:'
          + '</div>'
          + '<div class="tweaks-empty-example">'
          +   '"add tweaks for accent color and spacing"'
          + '</div>'
          + '</div>';
        return;
      }
      panel.removeAttribute('hidden');
      if (countEl) countEl.textContent = String(tweaks.length);
      list.innerHTML = '';
      for (var i = 0; i < tweaks.length; i++) {
        list.appendChild(buildRow(tweaks[i]));
      }
      // Auto-expand on first scene load if tweaks > 0. localStorage
      // key is per-scene so a designer who collapsed it for scene A
      // doesn't have to re-collapse it for scene B. User collapse
      // persists; subsequent reopens honor the user's choice.
      var sid = currentSceneId();
      if (sid) {
        var storageKey = 'reframe-tweaks-collapsed-' + sid;
        var userCollapsed = false;
        try { userCollapsed = localStorage.getItem(storageKey) === '1'; } catch (_) {}
        if (userCollapsed) panel.classList.add('collapsed');
        else panel.classList.remove('collapsed');
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
        // Phase 2 Brief 2a Pin #3 — card-picker convention.
        // Select tweaks targeting palette.* tokens render as 24x24
        // swatch grid; typography.* render as Aa-sample card grid;
        // others fall back to <select> dropdown.
        var pickerKind = getCardPickerKindForTweakJS(t);
        var opts = Array.isArray(t.options) ? t.options : [];
        if (pickerKind === 'palette' || pickerKind === 'typography') {
          var grid = document.createElement('div');
          grid.className = 'tweak-cards-grid tweak-cards-' + pickerKind;
          for (var i = 0; i < opts.length; i++) {
            var card = document.createElement('button');
            card.type = 'button';
            card.className = 'tweak-card' + (opts[i].value === t.default ? ' active' : '');
            card.setAttribute('data-tweak-card-value', String(opts[i].value));
            card.title = opts[i].label || opts[i].value;
            if (pickerKind === 'palette') {
              card.style.background = String(opts[i].value);
            } else {
              // Typography card — show "Aa" in the option's font family.
              card.textContent = 'Aa';
              card.style.fontFamily = String(opts[i].value);
              card.style.fontSize = '20px';
            }
            (function(value, btn){
              btn.addEventListener('click', function() {
                var siblings = grid.querySelectorAll('.tweak-card');
                for (var k = 0; k < siblings.length; k++) siblings[k].classList.remove('active');
                btn.classList.add('active');
                queueApply(t, value);
              });
            })(opts[i].value, card);
            grid.appendChild(card);
          }
          control.appendChild(grid);
        } else {
          var sel = document.createElement('select');
          sel.className = 'tweak-select';
          for (var j = 0; j < opts.length; j++) {
            var o = document.createElement('option');
            o.value = opts[j].value;
            o.textContent = opts[j].label || opts[j].value;
            if (opts[j].value === t.default) o.selected = true;
            sel.appendChild(o);
          }
          sel.addEventListener('change', function() {
            queueApply(t, sel.value);
          });
          control.appendChild(sel);
        }
      }

      // Phase 2 Brief 2a Pin #2 — edit/duplicate/delete row icons.
      // Hover-revealed (CSS opacity 0 → 1) so resting rows stay clean.
      var actions = document.createElement('div');
      actions.className = 'tweak-row-actions';
      actions.innerHTML =
        '<button type="button" class="tweak-row-action" data-tweak-action="edit" title="Edit tweak">✎</button>'
        + '<button type="button" class="tweak-row-action" data-tweak-action="duplicate" title="Duplicate tweak">⎘</button>'
        + '<button type="button" class="tweak-row-action" data-tweak-action="delete" title="Delete tweak">×</button>';
      actions.querySelectorAll('[data-tweak-action]').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          var action = btn.getAttribute('data-tweak-action');
          if (action === 'edit') openTweakAuthorModal({ mode: 'edit', tweak: t });
          else if (action === 'duplicate') openTweakAuthorModal({ mode: 'duplicate', tweak: t });
          else if (action === 'delete') confirmAndDeleteTweak(t);
        });
      });
      row.appendChild(control);
      row.appendChild(actions);
      return row;
    }

    // ── Card-picker convention (mirror of getCardPickerKindForTweak) ──
    // Source of truth lives in tweak-defaults.ts; this is the inline
    // bundle equivalent so the panel can decide rendering without an
    // extra round-trip.
    function getCardPickerKindForTweakJS(tweak) {
      if (!tweak || tweak.kind !== 'select') return null;
      if (!tweak.op || tweak.op.type !== 'token') return null;
      var path = String(tweak.op.tokenPath || '').toLowerCase();
      if (!path) return null;
      if (path.indexOf('palette.') === 0 || path.indexOf('color.') === 0) return 'palette';
      if (path.indexOf('typography.') === 0 || path.indexOf('font.') === 0) return 'typography';
      return null;
    }

    // ── Adaptive slider defaults (mirror of inferSliderDefaults) ──
    var SLIDER_DEFAULTS_JS = {
      'opacity': { min: 0, max: 1, step: 0.05 },
      'border-radius': { min: 0, max: 32, step: 1 },
      'corner-radius': { min: 0, max: 32, step: 1 },
      'corner-smoothing': { min: 0, max: 1, step: 0.05 },
      'font-size': { min: 8, max: 72, step: 1 },
      'font-weight': { min: 100, max: 900, step: 100 },
      'line-height': { min: 0.8, max: 2.4, step: 0.05 },
      'letter-spacing': { min: -0.05, max: 0.2, step: 0.005 },
      'padding': { min: 0, max: 128, step: 4 },
      'padding-top': { min: 0, max: 128, step: 4 },
      'padding-right': { min: 0, max: 128, step: 4 },
      'padding-bottom': { min: 0, max: 128, step: 4 },
      'padding-left': { min: 0, max: 128, step: 4 },
      'margin': { min: 0, max: 128, step: 4 },
      'gap': { min: 0, max: 64, step: 4 },
      'width': { min: 0, max: 1440, step: 1 },
      'height': { min: 0, max: 1440, step: 1 },
    };
    function inferSliderDefaultsJS(prop) {
      if (!prop) return { min: 0, max: 100, step: 1 };
      return SLIDER_DEFAULTS_JS[prop] || { min: 0, max: 100, step: 1 };
    }

    function suggestIdFromLabelJS(label) {
      if (!label) return '';
      return String(label).toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/^[0-9]+(-?)/, '')
        .slice(0, 60);
    }
    function isValidTweakIdJS(id) {
      return typeof id === 'string' && /^[a-z][a-z0-9-]*$/.test(id);
    }

    // ── Pin #1 — Authoring modal ──────────────────────────────
    // Mounts in document.body as SIBLING of tweaks panel (NOT nested
    // — UI-6a Pin #4 architectural lock prevents inspector innerHTML
    // overwrites from wiping it). Single-instance: re-opening closes
    // any prior modal first.
    var __activeTweakModal = null;

    function closeTweakAuthorModal() {
      if (__activeTweakModal && __activeTweakModal.parentNode) {
        __activeTweakModal.parentNode.removeChild(__activeTweakModal);
      }
      __activeTweakModal = null;
      document.removeEventListener('keydown', onTweakModalEsc, true);
    }
    function onTweakModalEsc(e) {
      if (e.key === 'Escape' && __activeTweakModal) {
        e.stopPropagation();
        closeTweakAuthorModal();
      }
    }

    function openTweakAuthorModal(opts) {
      closeTweakAuthorModal();
      opts = opts || {};
      var mode = opts.mode || 'add'; // add | edit | duplicate
      var existing = opts.tweak || null;
      var allTweaks = (function(){
        var out = [];
        list.querySelectorAll('[data-tweak-id]').forEach(function(r){
          out.push(r.getAttribute('data-tweak-id'));
        });
        return out;
      })();

      // Initial values per mode.
      var initial = {
        label: '',
        id: '',
        kind: 'color',
        tokenPath: 'palette.accent',
        defaultColor: '#000000',
        targetProp: 'opacity',
        autoSlider: true,
        min: '',
        max: '',
        step: '',
        defaultNumber: 0.5,
        options: [{ label: 'Option A', value: 'a' }, { label: 'Option B', value: 'b' }],
        defaultSelect: 'a',
      };
      if (existing) {
        initial.label = existing.label || '';
        initial.id = mode === 'duplicate' ? (existing.id + '-copy') : (existing.id || '');
        initial.kind = existing.kind || 'color';
        if (existing.op && existing.op.type === 'token') {
          initial.tokenPath = existing.op.tokenPath || '';
        }
        if (existing.kind === 'color') initial.defaultColor = String(existing.default || '#000000');
        if (existing.kind === 'number') {
          initial.defaultNumber = Number(existing.default) || 0;
          initial.min = existing.min != null ? String(existing.min) : '';
          initial.max = existing.max != null ? String(existing.max) : '';
          initial.step = existing.step != null ? String(existing.step) : '';
          initial.autoSlider = initial.min === '' && initial.max === '' && initial.step === '';
          if (existing.op && existing.op.type === 'token') initial.targetProp = existing.op.tokenPath;
        }
        if (existing.kind === 'select') {
          initial.options = Array.isArray(existing.options) ? existing.options.slice() : initial.options;
          initial.defaultSelect = String(existing.default || (initial.options[0] && initial.options[0].value) || '');
        }
      }

      var overlay = document.createElement('div');
      overlay.className = 'tweak-author-overlay';
      overlay.setAttribute('data-tweak-author-modal', mode);
      overlay.innerHTML =
        '<div class="tweak-author-modal" role="dialog" aria-label="Tweak authoring">'
        + '<div class="tweak-author-head">'
        +   '<span class="tweak-author-title">'
        +     (mode === 'edit' ? 'Edit tweak' : mode === 'duplicate' ? 'Duplicate tweak' : 'Add tweak')
        +   '</span>'
        +   '<button type="button" class="tweak-author-close" aria-label="Close">×</button>'
        + '</div>'
        + '<div class="tweak-author-body">'
        +   '<label class="tweak-field"><span class="tweak-field-label">Label</span>'
        +     '<input data-tweak-field="label" type="text" value="' + escapeAttr(initial.label) + '" placeholder="Accent color" required></label>'
        +   '<label class="tweak-field"><span class="tweak-field-label">ID</span>'
        +     '<input data-tweak-field="id" type="text" value="' + escapeAttr(initial.id) + '" placeholder="accent-color" pattern="^[a-z][a-z0-9-]*$"' + (mode === 'edit' ? ' readonly' : '') + ' required></label>'
        +   '<div class="tweak-field"><span class="tweak-field-label">Kind</span>'
        +     '<div class="tweak-kind-radio">'
        +       '<label><input type="radio" name="tweak-kind" value="color" data-tweak-field="kind"' + (initial.kind === 'color' ? ' checked' : '') + '> Color</label>'
        +       '<label><input type="radio" name="tweak-kind" value="number" data-tweak-field="kind"' + (initial.kind === 'number' ? ' checked' : '') + '> Number</label>'
        +       '<label><input type="radio" name="tweak-kind" value="select" data-tweak-field="kind"' + (initial.kind === 'select' ? ' checked' : '') + '> Select</label>'
        +     '</div></div>'
        +   '<div class="tweak-kind-fields" data-tweak-kind-fields></div>'
        +   '<div class="tweak-form-error" data-tweak-form-error hidden></div>'
        + '</div>'
        + '<div class="tweak-author-foot">'
        +   '<button type="button" class="tweak-author-cancel">Cancel</button>'
        +   '<button type="button" class="tweak-author-submit">' + (mode === 'edit' ? 'Save' : 'Add tweak') + '</button>'
        + '</div>'
        + '</div>';

      document.body.appendChild(overlay);
      __activeTweakModal = overlay;
      document.addEventListener('keydown', onTweakModalEsc, true);

      var labelInput = overlay.querySelector('[data-tweak-field="label"]');
      var idInput = overlay.querySelector('[data-tweak-field="id"]');
      var kindInputs = overlay.querySelectorAll('[data-tweak-field="kind"]');
      var kindFieldsEl = overlay.querySelector('[data-tweak-kind-fields]');
      var errorEl = overlay.querySelector('[data-tweak-form-error]');

      function showError(msg) { errorEl.textContent = msg; errorEl.removeAttribute('hidden'); }
      function clearError() { errorEl.setAttribute('hidden', ''); errorEl.textContent = ''; }

      // Auto-suggest ID from label (only when add mode + ID untouched).
      var idTouched = !!initial.id;
      labelInput.addEventListener('input', function() {
        if (mode === 'add' && !idTouched) {
          idInput.value = suggestIdFromLabelJS(labelInput.value);
        }
      });
      idInput.addEventListener('input', function() { idTouched = true; });

      function currentKind() {
        for (var i = 0; i < kindInputs.length; i++) if (kindInputs[i].checked) return kindInputs[i].value;
        return 'color';
      }

      function renderKindFields() {
        var k = currentKind();
        if (k === 'color') {
          kindFieldsEl.innerHTML =
            '<label class="tweak-field"><span class="tweak-field-label">Token path</span>'
            +   '<input data-tweak-field="tokenPath" type="text" value="' + escapeAttr(initial.tokenPath) + '" placeholder="palette.accent"></label>'
            + '<label class="tweak-field"><span class="tweak-field-label">Default</span>'
            +   '<input data-tweak-field="defaultColor" type="color" value="' + escapeAttr(initial.defaultColor) + '"></label>';
        } else if (k === 'number') {
          var d = inferSliderDefaultsJS(initial.targetProp);
          kindFieldsEl.innerHTML =
            '<label class="tweak-field"><span class="tweak-field-label">Target prop</span>'
            +   '<input data-tweak-field="targetProp" type="text" value="' + escapeAttr(initial.targetProp) + '" placeholder="opacity"></label>'
            + '<label class="tweak-field tweak-field-checkbox">'
            +   '<input data-tweak-field="autoSlider" type="checkbox"' + (initial.autoSlider ? ' checked' : '') + '>'
            +   '<span>Auto min/max/step from prop</span></label>'
            + '<div class="tweak-field-row" data-tweak-manual-bounds' + (initial.autoSlider ? ' hidden' : '') + '>'
            +   '<label><span class="tweak-field-label">Min</span><input data-tweak-field="min" type="number" value="' + escapeAttr(initial.min || String(d.min)) + '"></label>'
            +   '<label><span class="tweak-field-label">Max</span><input data-tweak-field="max" type="number" value="' + escapeAttr(initial.max || String(d.max)) + '"></label>'
            +   '<label><span class="tweak-field-label">Step</span><input data-tweak-field="step" type="number" value="' + escapeAttr(initial.step || String(d.step)) + '"></label>'
            + '</div>'
            + '<label class="tweak-field"><span class="tweak-field-label">Default</span>'
            +   '<input data-tweak-field="defaultNumber" type="number" value="' + escapeAttr(String(initial.defaultNumber)) + '"></label>';
          var autoCb = kindFieldsEl.querySelector('[data-tweak-field="autoSlider"]');
          var manualBox = kindFieldsEl.querySelector('[data-tweak-manual-bounds]');
          autoCb.addEventListener('change', function() {
            if (autoCb.checked) manualBox.setAttribute('hidden', '');
            else manualBox.removeAttribute('hidden');
          });
        } else if (k === 'select') {
          kindFieldsEl.innerHTML =
            '<label class="tweak-field"><span class="tweak-field-label">Token path</span>'
            +   '<input data-tweak-field="tokenPath" type="text" value="' + escapeAttr(initial.tokenPath) + '" placeholder="palette.accent OR typography.display"></label>'
            + '<div class="tweak-field"><span class="tweak-field-label">Options</span>'
            +   '<div class="tweak-options-list" data-tweak-options></div>'
            +   '<button type="button" class="tweak-option-add" data-tweak-option-add>+ Add option</button>'
            + '</div>';
          var optionsList = kindFieldsEl.querySelector('[data-tweak-options]');
          function renderOptions() {
            optionsList.innerHTML = '';
            initial.options.forEach(function(opt, i) {
              var row = document.createElement('div');
              row.className = 'tweak-option-row';
              row.innerHTML =
                '<input type="text" placeholder="Label" value="' + escapeAttr(opt.label || '') + '" data-opt-label data-opt-idx="' + i + '">'
                + '<input type="text" placeholder="Value" value="' + escapeAttr(opt.value || '') + '" data-opt-value data-opt-idx="' + i + '">'
                + '<button type="button" class="tweak-option-remove" data-opt-remove="' + i + '" aria-label="Remove option">×</button>';
              optionsList.appendChild(row);
            });
            optionsList.querySelectorAll('[data-opt-label]').forEach(function(inp) {
              inp.addEventListener('input', function() {
                initial.options[Number(inp.getAttribute('data-opt-idx'))].label = inp.value;
              });
            });
            optionsList.querySelectorAll('[data-opt-value]').forEach(function(inp) {
              inp.addEventListener('input', function() {
                initial.options[Number(inp.getAttribute('data-opt-idx'))].value = inp.value;
              });
            });
            optionsList.querySelectorAll('[data-opt-remove]').forEach(function(btn) {
              btn.addEventListener('click', function() {
                var idx = Number(btn.getAttribute('data-opt-remove'));
                initial.options.splice(idx, 1);
                renderOptions();
              });
            });
          }
          renderOptions();
          kindFieldsEl.querySelector('[data-tweak-option-add]').addEventListener('click', function() {
            initial.options.push({ label: '', value: '' });
            renderOptions();
          });
        }
      }
      renderKindFields();
      kindInputs.forEach(function(r) { r.addEventListener('change', renderKindFields); });

      // Submit + cancel + close wiring.
      function buildPayloadOrError() {
        var label = labelInput.value.trim();
        var id = idInput.value.trim();
        if (!label) return { error: 'Label is required' };
        if (!isValidTweakIdJS(id)) return { error: 'ID must match pattern: lowercase letter then alphanumeric / hyphen' };
        if (mode !== 'edit' && allTweaks.indexOf(id) >= 0) {
          return { error: 'ID "' + id + '" already exists' };
        }
        var k = currentKind();
        var body = { id: id, label: label, kind: k };
        if (k === 'color') {
          var tokenPath = (kindFieldsEl.querySelector('[data-tweak-field="tokenPath"]').value || '').trim();
          if (!tokenPath) return { error: 'Token path is required for color tweaks' };
          body.op = { type: 'token', tokenPath: tokenPath };
          body['default'] = kindFieldsEl.querySelector('[data-tweak-field="defaultColor"]').value;
        } else if (k === 'number') {
          var prop = (kindFieldsEl.querySelector('[data-tweak-field="targetProp"]').value || '').trim();
          if (!prop) return { error: 'Target prop is required for number tweaks' };
          body.op = { type: 'token', tokenPath: prop };
          var auto = kindFieldsEl.querySelector('[data-tweak-field="autoSlider"]').checked;
          var defNum = Number(kindFieldsEl.querySelector('[data-tweak-field="defaultNumber"]').value);
          body['default'] = isFinite(defNum) ? defNum : 0;
          if (auto) {
            var d = inferSliderDefaultsJS(prop);
            body.min = d.min; body.max = d.max; body.step = d.step;
          } else {
            body.min = Number(kindFieldsEl.querySelector('[data-tweak-field="min"]').value);
            body.max = Number(kindFieldsEl.querySelector('[data-tweak-field="max"]').value);
            body.step = Number(kindFieldsEl.querySelector('[data-tweak-field="step"]').value);
          }
        } else if (k === 'select') {
          var tp = (kindFieldsEl.querySelector('[data-tweak-field="tokenPath"]').value || '').trim();
          if (!tp) return { error: 'Token path is required for select tweaks' };
          if (!Array.isArray(initial.options) || initial.options.length === 0) {
            return { error: 'At least one option is required' };
          }
          body.op = { type: 'token', tokenPath: tp };
          body.options = initial.options.filter(function(o){ return o && o.value; });
          body['default'] = String(initial.defaultSelect || (body.options[0] && body.options[0].value) || '');
        }
        return { payload: body };
      }

      function submit() {
        clearError();
        var built = buildPayloadOrError();
        if (built.error) { showError(built.error); return; }
        var payload = built.payload;
        var sid = currentSceneId();
        if (!sid) { showError('No scene loaded'); return; }
        var submitBtn = overlay.querySelector('.tweak-author-submit');
        submitBtn.disabled = true;
        var prevText = submitBtn.textContent;
        submitBtn.textContent = mode === 'edit' ? 'Saving…' : 'Adding…';
        var url, body;
        if (mode === 'edit') {
          url = '/platform/api/tweaks/update';
          body = JSON.stringify({ sceneId: sid, id: payload.id, updates: payload });
        } else {
          // add OR duplicate — both call /declare with full new tweak.
          // Append to existing list rather than replace; backend re-validates.
          var allCurrent = (function(){
            // Best-effort: read current tweaks from list rows. The /declare
            // endpoint replaces the whole array, so we must include
            // everything. Failing that, fall back to single-tweak declare —
            // backend handles dedup via id-uniqueness.
            var existingTweaks = [];
            list.querySelectorAll('[data-tweak-id]').forEach(function(row) {
              // We don't have full TweakDecl for existing rows in DOM.
              // Refetch via /api/tweaks/get is more correct.
            });
            return null;
          })();
          // Use /api/tweaks/get to read current list, append, then declare.
          url = '/platform/api/tweaks/declare';
          body = null; // built below after fetch
        }

        function persist(payloadBody) {
          fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payloadBody,
          }).then(function(r) { return r.json().then(function(j){ return { ok: r.ok, json: j }; }); })
            .then(function(res) {
              if (!res.ok || !res.json || res.json.ok === false) {
                showError((res.json && res.json.error) || 'Server rejected the tweak');
                submitBtn.disabled = false;
                submitBtn.textContent = prevText;
                return;
              }
              closeTweakAuthorModal();
              refresh();
            })
            .catch(function() {
              showError('Network error');
              submitBtn.disabled = false;
              submitBtn.textContent = prevText;
            });
        }

        if (mode === 'edit') {
          persist(body);
        } else {
          // For add/duplicate — fetch current tweaks, append, declare.
          fetch('/platform/api/tweaks/get?sceneId=' + encodeURIComponent(sid))
            .then(function(r) { return r.json(); })
            .then(function(data) {
              var current = (data && Array.isArray(data.tweaks)) ? data.tweaks : [];
              // Dedup by id (duplicate-mode safety net).
              current = current.filter(function(t){ return t.id !== payload.id; });
              current.push(Object.assign({ source: 'designer' }, payload));
              persist(JSON.stringify({ sceneId: sid, tweaks: current }));
            })
            .catch(function() { showError('Could not load existing tweaks'); submitBtn.disabled = false; submitBtn.textContent = prevText; });
        }
      }

      overlay.querySelector('.tweak-author-submit').addEventListener('click', submit);
      overlay.querySelector('.tweak-author-cancel').addEventListener('click', closeTweakAuthorModal);
      overlay.querySelector('.tweak-author-close').addEventListener('click', closeTweakAuthorModal);
      // Outside-click does NOT close — modal protects in-flight form data.

      // Focus label on open.
      setTimeout(function() { try { labelInput.focus(); } catch(_) {} }, 50);
    }

    function confirmAndDeleteTweak(tweak) {
      // Inline confirm prompt (subtle), not browser dialog.
      var prompt = document.createElement('div');
      prompt.className = 'tweak-delete-confirm';
      prompt.innerHTML =
        '<div class="tweak-delete-card">'
        +   '<p>Remove tweak <strong>"' + escapeHtml(tweak.label || tweak.id) + '"</strong>? This cannot be undone.</p>'
        +   '<div class="tweak-delete-actions">'
        +     '<button type="button" data-tweak-delete-cancel>Cancel</button>'
        +     '<button type="button" data-tweak-delete-confirm class="danger">Remove</button>'
        +   '</div>'
        + '</div>';
      document.body.appendChild(prompt);
      function close() { if (prompt.parentNode) prompt.parentNode.removeChild(prompt); }
      prompt.querySelector('[data-tweak-delete-cancel]').addEventListener('click', close);
      prompt.querySelector('[data-tweak-delete-confirm]').addEventListener('click', function() {
        var sid = currentSceneId();
        if (!sid) { close(); return; }
        fetch('/platform/api/tweaks/remove', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sceneId: sid, id: tweak.id }),
        }).then(function() { close(); refresh(); })
          .catch(function() { close(); });
      });
    }

    function escapeHtml(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function escapeAttr(s) { return escapeHtml(s); }

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

    // Phase 1 UI-6a Pin #4 — header click toggles collapse, persisted
    // per-scene in localStorage. Persistence key matches the auto-
    // expand reader above so initial-load + manual-collapse round-trip
    // correctly across reloads.
    var head = panel.querySelector('.tweaks-head');
    if (head) {
      // Phase 2 Brief 2a Pin #1 — "+ Add tweak" affordance in header.
      // Inserted before the count badge so designer can author from
      // first scene load without waiting for agent declarations.
      // Click handler stops propagation so the header collapse toggle
      // doesn't fire when the button is the click target.
      if (!head.querySelector('[data-tweak-add]')) {
        var addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'tweak-add-btn';
        addBtn.setAttribute('data-tweak-add', '');
        addBtn.title = 'Add new tweak';
        addBtn.textContent = '+';
        addBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          openTweakAuthorModal({ mode: 'add' });
        });
        // Insert right before the count badge (last child).
        var count = head.querySelector('.tweaks-count');
        if (count) head.insertBefore(addBtn, count);
        else head.appendChild(addBtn);
      }
      head.addEventListener('click', function(e) {
        // Don't toggle when click was on the add button or its descendants.
        if (e.target.closest && e.target.closest('[data-tweak-add]')) return;
        panel.classList.toggle('collapsed');
        var sid = currentSceneId();
        if (!sid) return;
        var key = 'reframe-tweaks-collapsed-' + sid;
        try {
          if (panel.classList.contains('collapsed')) localStorage.setItem(key, '1');
          else localStorage.removeItem(key);
        } catch (_) {}
      });
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
