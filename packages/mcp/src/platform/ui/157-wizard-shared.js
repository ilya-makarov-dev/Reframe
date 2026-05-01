  // ════════════════════════════════════════════════════════
  // Phase 4 Brief 4b Pin #2 — Shared wizard primitive.
  //
  // Reusable across composition wizards (Variants + Sampler in 4b;
  // Flow + Overlay in 4c). All four kinds share the same shape:
  //
  //   Step 1: scene picker (project's session scenes)
  //   Step 2: kind-specific config form (axes for variants, cells for
  //           sampler, transitions for flow, layers for overlay)
  //   Step 3: live preview iframe (composition rendered against picked
  //           scene with current config)
  //   Step 4: commit summary + submit button
  //
  // Bundle exports four HTML-string renderers + one binder that wires
  // step nav / cancel / commit. Wizard pages mount one DOM container
  // per step and the binder swaps active panel based on currentStep
  // state. State persists across step nav (back-button preserves earlier
  // input) but NOT across page reload — wizards are session-scoped.
  //
  // Pattern matches the workbench shape (catalog grid + workbench mode
  // in brand/components workbenches): wizard catalog at
  // /platform/workbench/wizards lists kinds; per-kind wizard mounts at
  // /platform/workbench/wizards/<kind>.
  // ════════════════════════════════════════════════════════

  // Public API exposed on window so per-kind wizard binders (in their
  // own files) can call into shared primitive without duplicating
  // logic. Mirrors the 152-skill-result-render exports pattern.
  window.reframeRenderScenePicker = renderScenePicker;
  window.reframeRenderConfigForm = renderConfigForm;
  window.reframeRenderLivePreview = renderLivePreview;
  window.reframeRenderCommitStep = renderCommitStep;
  window.reframeRenderWizardBreadcrumb = renderWizardBreadcrumb;
  window.reframeBindWizardActions = bindWizardActions;

  function escW(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /**
   * renderScenePicker
   * @param scenes Array<{id, slug, name, width, height, nodes}>
   * @param selectedSceneId  current selection (for re-render after back nav)
   * @returns HTML string for Step 1 panel
   */
  function renderScenePicker(scenes, selectedSceneId) {
    if (!scenes || scenes.length === 0) {
      return '<div class="wz-empty">' +
        '<p>No open scenes in this project.</p>' +
        '<p class="wz-empty-hint">Compile a scene first, then start the wizard.</p>' +
        '</div>';
    }
    var rows = scenes.map(function(s) {
      var active = s.id === selectedSceneId;
      var dims = (s.width || '?') + '×' + (s.height || '?');
      var nodeCount = s.nodes != null ? s.nodes + ' nodes' : '';
      return '<label class="wz-scene-option' + (active ? ' wz-scene-option--active' : '') +
        '" data-wz-scene-id="' + escW(s.id) + '">' +
        '<input type="radio" name="wz-scene" value="' + escW(s.id) + '"' +
          (active ? ' checked' : '') + '>' +
        '<div class="wz-scene-meta">' +
          '<span class="wz-scene-name">' + escW(s.name || s.slug) + '</span>' +
          '<span class="wz-scene-dims">' + escW(dims) + ' · ' + escW(nodeCount) + '</span>' +
        '</div>' +
      '</label>';
    }).join('');
    return '<div class="wz-step-panel" data-wz-step="scene-picker">' +
      '<h3 class="wz-step-title">Pick a base scene</h3>' +
      '<p class="wz-step-lead">The wizard composes axes/cells/layers around this scene. Pick one to continue.</p>' +
      '<div class="wz-scene-list">' + rows + '</div>' +
    '</div>';
  }

  /**
   * renderConfigForm — kind-specific config form. Wizard pages pass
   * `kind` and the current spec; the renderer dispatches per kind.
   * Adding a new kind = adding a renderXxxConfig branch.
   */
  function renderConfigForm(kind, spec) {
    if (kind === 'variants') return renderVariantsConfig(spec || {});
    if (kind === 'sampler')  return renderSamplerConfig(spec || {});
    if (kind === 'flow')     return renderFlowConfig(spec || {});
    if (kind === 'overlay')  return renderOverlayConfig(spec || {});
    return '<div class="wz-empty">Unsupported wizard kind: ' + escW(kind) + '</div>';
  }

  function renderVariantsConfig(spec) {
    var axes = (spec.axes && spec.axes.length > 0) ? spec.axes : [
      { name: 'density', values: ['compact', 'default', 'dense'] },
    ];
    var idValue = spec.variantsId || '';
    var nameValue = spec.name || '';
    var brandValue = spec.brand || '';

    var axisRows = axes.map(function(axis, i) {
      return '<div class="wz-axis-row" data-wz-axis-index="' + i + '">' +
        '<label class="wz-field"><span>Axis ' + (i + 1) + ' name</span>' +
          '<input type="text" data-wz-axis-name="' + i + '" value="' + escW(axis.name) +
          '" placeholder="density / radius / brand"></label>' +
        '<label class="wz-field"><span>Values (comma-separated)</span>' +
          '<input type="text" data-wz-axis-values="' + i + '" value="' + escW((axis.values || []).join(', ')) +
          '" placeholder="compact, default, dense"></label>' +
        (axes.length > 1
          ? '<button type="button" class="wz-btn wz-btn--ghost" data-wz-axis-remove="' + i + '">Remove</button>'
          : '') +
      '</div>';
    }).join('');

    return '<div class="wz-step-panel" data-wz-step="config-form" data-wz-kind="variants">' +
      '<h3 class="wz-step-title">Configure axes</h3>' +
      '<p class="wz-step-lead">Each axis multiplies the variant grid. 3-value density × 2-value radius = 6 cells.</p>' +
      '<label class="wz-field"><span>Variants id</span>' +
        '<input type="text" data-wz-id value="' + escW(idValue) +
        '" placeholder="e.g. density-grid" pattern="^[a-z][a-z0-9\\-]*$" required></label>' +
      '<label class="wz-field"><span>Display name</span>' +
        '<input type="text" data-wz-name value="' + escW(nameValue) +
        '" placeholder="optional"></label>' +
      '<label class="wz-field"><span>Brand override</span>' +
        '<input type="text" data-wz-brand value="' + escW(brandValue) +
        '" placeholder="(uses scene brand)"></label>' +
      '<div class="wz-axis-list" data-wz-axis-list>' + axisRows + '</div>' +
      '<button type="button" class="wz-btn wz-btn--ghost" data-wz-axis-add>+ Add axis</button>' +
    '</div>';
  }

  function renderSamplerConfig(spec) {
    var idValue = spec.samplerId || '';
    var nameValue = spec.name || '';
    var sampleMode = spec.sampleMode || 'sequential';
    var sampleCount = spec.sampleCount || 6;
    var columns = (spec.grid && spec.grid.columns) || 3;
    var rows = (spec.grid && spec.grid.rows) || Math.ceil(sampleCount / columns);
    var brandValue = spec.sharedBrand || '';

    var modes = ['sequential', 'random', 'weighted'];
    var modeOpts = modes.map(function(m) {
      return '<option value="' + m + '"' + (m === sampleMode ? ' selected' : '') + '>' + m + '</option>';
    }).join('');

    return '<div class="wz-step-panel" data-wz-step="config-form" data-wz-kind="sampler">' +
      '<h3 class="wz-step-title">Configure sampler</h3>' +
      '<p class="wz-step-lead">A sampler is a grid of N variations of the base scene. Pick a sampling mode + grid layout.</p>' +
      '<label class="wz-field"><span>Sampler id</span>' +
        '<input type="text" data-wz-id value="' + escW(idValue) +
        '" placeholder="e.g. variant-sampler" pattern="^[a-z][a-z0-9\\-]*$" required></label>' +
      '<label class="wz-field"><span>Display name</span>' +
        '<input type="text" data-wz-name value="' + escW(nameValue) +
        '" placeholder="optional"></label>' +
      '<label class="wz-field"><span>Sample mode</span>' +
        '<select data-wz-mode>' + modeOpts + '</select></label>' +
      '<label class="wz-field"><span>Sample count</span>' +
        '<input type="number" data-wz-count value="' + sampleCount +
        '" min="1" max="64" step="1"></label>' +
      '<div class="wz-grid-pair">' +
        '<label class="wz-field"><span>Columns</span>' +
          '<input type="number" data-wz-cols value="' + columns + '" min="1" max="12"></label>' +
        '<label class="wz-field"><span>Rows</span>' +
          '<input type="number" data-wz-rows value="' + rows + '" min="1" max="12"></label>' +
      '</div>' +
      '<label class="wz-field"><span>Shared brand</span>' +
        '<input type="text" data-wz-brand value="' + escW(brandValue) +
        '" placeholder="(uses scene brand)"></label>' +
    '</div>';
  }

  // Phase 4 Brief 4c — Flow config form. Sequence editor with per-step
  // sceneId + duration + transition. Steps reorderable via up/down
  // arrows (drag-reorder is a 4d hop).
  function renderFlowConfig(spec) {
    var idValue = spec.flowId || '';
    var nameValue = spec.name || '';
    var steps = (Array.isArray(spec.steps) && spec.steps.length > 0)
      ? spec.steps
      : [{ sceneId: spec.sceneId || '', duration: 1500, transition: 'cut' }];
    var TRANSITIONS = ['cut', 'crossfade', 'slide-left', 'slide-right', 'fade-through-black'];
    // Pull the picked scene's slug so the sceneId select can offer
    // siblings. Falls back к single-option when only one scene.
    var availableScenes = [];
    try {
      var hostEl = document.querySelector('[data-wz-scenes-json]');
      if (hostEl) availableScenes = JSON.parse(hostEl.getAttribute('data-wz-scenes-json') || '[]');
    } catch (_) {}

    var stepRows = steps.map(function(step, i) {
      var sceneOpts = availableScenes.map(function(s) {
        return '<option value="' + escW(s.id) + '"' +
          (s.id === step.sceneId ? ' selected' : '') + '>' +
          escW(s.name || s.slug) + '</option>';
      }).join('');
      var transOpts = TRANSITIONS.map(function(t) {
        return '<option value="' + t + '"' +
          (t === step.transition ? ' selected' : '') + '>' + t + '</option>';
      }).join('');
      return '<div class="wz-flow-step" data-wz-step-index="' + i + '">' +
        '<div class="wz-flow-step-num">' + (i + 1) + '</div>' +
        '<label class="wz-field"><span>Scene</span>' +
          '<select data-wz-step-scene="' + i + '">' + sceneOpts + '</select></label>' +
        '<label class="wz-field"><span>Duration (ms)</span>' +
          '<input type="number" data-wz-step-duration="' + i + '" value="' +
          (step.duration || 1500) + '" min="100" max="60000" step="100"></label>' +
        '<label class="wz-field"><span>Transition</span>' +
          '<select data-wz-step-transition="' + i + '">' + transOpts + '</select></label>' +
        '<div class="wz-flow-step-actions">' +
          (i > 0 ? '<button type="button" class="wz-icon-btn" data-wz-step-up="' + i + '" title="Move up">↑</button>' : '') +
          (i < steps.length - 1 ? '<button type="button" class="wz-icon-btn" data-wz-step-down="' + i + '" title="Move down">↓</button>' : '') +
          (steps.length > 1 ? '<button type="button" class="wz-icon-btn wz-icon-btn--danger" data-wz-step-remove="' + i + '" title="Remove">×</button>' : '') +
        '</div>' +
      '</div>';
    }).join('');

    return '<div class="wz-step-panel" data-wz-step="config-form" data-wz-kind="flow">' +
      '<h3 class="wz-step-title">Configure flow</h3>' +
      '<p class="wz-step-lead">Linear step transitions over a sequence of scenes. Add steps, set duration + transition, reorder.</p>' +
      '<label class="wz-field"><span>Flow id</span>' +
        '<input type="text" data-wz-id value="' + escW(idValue) +
        '" placeholder="e.g. onboarding" pattern="^[a-z][a-z0-9\\-]*$" required></label>' +
      '<label class="wz-field"><span>Display name</span>' +
        '<input type="text" data-wz-name value="' + escW(nameValue) +
        '" placeholder="optional"></label>' +
      '<div class="wz-flow-steps" data-wz-flow-steps>' + stepRows + '</div>' +
      '<button type="button" class="wz-btn wz-btn--ghost" data-wz-step-add>+ Add step</button>' +
    '</div>';
  }

  // Phase 4 Brief 4c — Overlay config form. Up to 3 layers per the
  // engine's OverlayLayer constraint (composition.ts max 3). Each
  // layer carries opacity + blendMode + zIndex.
  function renderOverlayConfig(spec) {
    var idValue = spec.overlayId || '';
    var nameValue = spec.name || '';
    var layers = (Array.isArray(spec.layers) && spec.layers.length > 0)
      ? spec.layers
      : [{ type: 'noise-grain', opacity: 0.5, blendMode: 'normal', zIndex: 1 }];
    var BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'soft-light'];
    var LAYER_TYPES = ['noise-grain', 'shader-particles', 'shader-glow', 'fire', 'smoke'];
    var atMax = layers.length >= 3;

    var layerRows = layers.map(function(layer, i) {
      var typeOpts = LAYER_TYPES.map(function(t) {
        return '<option value="' + t + '"' +
          (t === layer.type ? ' selected' : '') + '>' + t + '</option>';
      }).join('');
      var blendOpts = BLEND_MODES.map(function(b) {
        return '<option value="' + b + '"' +
          (b === layer.blendMode ? ' selected' : '') + '>' + b + '</option>';
      }).join('');
      return '<div class="wz-overlay-layer" data-wz-layer-index="' + i + '">' +
        '<div class="wz-overlay-layer-num">L' + (i + 1) + '</div>' +
        '<label class="wz-field"><span>Type</span>' +
          '<select data-wz-layer-type="' + i + '">' + typeOpts + '</select></label>' +
        '<label class="wz-field"><span>Opacity</span>' +
          '<input type="number" data-wz-layer-opacity="' + i + '" value="' +
          (layer.opacity != null ? layer.opacity : 0.5) +
          '" min="0" max="1" step="0.05"></label>' +
        '<label class="wz-field"><span>Blend</span>' +
          '<select data-wz-layer-blend="' + i + '">' + blendOpts + '</select></label>' +
        '<label class="wz-field"><span>z-Index</span>' +
          '<input type="number" data-wz-layer-z="' + i + '" value="' +
          (layer.zIndex != null ? layer.zIndex : i + 1) + '" min="1" max="9"></label>' +
        '<div class="wz-overlay-layer-actions">' +
          (layers.length > 1 ? '<button type="button" class="wz-icon-btn wz-icon-btn--danger" data-wz-layer-remove="' + i + '" title="Remove">×</button>' : '') +
        '</div>' +
      '</div>';
    }).join('');

    return '<div class="wz-step-panel" data-wz-step="config-form" data-wz-kind="overlay">' +
      '<h3 class="wz-step-title">Configure overlay</h3>' +
      '<p class="wz-step-lead">Base scene with up to 3 effect layers (noise, shader, particle). Set opacity + blend mode + z-order per layer.</p>' +
      '<label class="wz-field"><span>Overlay id</span>' +
        '<input type="text" data-wz-id value="' + escW(idValue) +
        '" placeholder="e.g. dust-overlay" pattern="^[a-z][a-z0-9\\-]*$" required></label>' +
      '<label class="wz-field"><span>Display name</span>' +
        '<input type="text" data-wz-name value="' + escW(nameValue) +
        '" placeholder="optional"></label>' +
      '<div class="wz-overlay-layers" data-wz-overlay-layers>' + layerRows + '</div>' +
      '<button type="button" class="wz-btn wz-btn--ghost" data-wz-layer-add' +
        (atMax ? ' disabled title="Engine cap: max 3 layers"' : '') +
        '>+ Add layer' + (atMax ? ' (max reached)' : '') + '</button>' +
    '</div>';
  }

  /**
   * renderLivePreview — Step 3. Shows the picked scene rendered with
   * current composition state. For variants/sampler the iframe loads
   * `/preview/<sceneId>` — exact composition rendering will tighten
   * once the composition write endpoints land + URL precedence picks
   * up the storage path. For now the iframe shows the scene as-is so
   * the designer confirms scene choice before committing.
   */
  function renderLivePreview(sceneId, spec, kind) {
    if (!sceneId) {
      return '<div class="wz-empty">No scene picked yet — go back to Step 1.</div>';
    }
    var summary = '';
    var src = '/preview/' + encodeURIComponent(sceneId);
    var previewMode = 'base scene';

    // Phase 4 Brief 4c — closes 4b's 🟡. For variants we can build a
    // multi-cell CSV URL inline (no temp commit needed) and route к
    // /platform/project/<sceneSlug>?variants=<id>,<id>,... which boots
    // the editor shell + composition renderer in CSV mode. The composed
    // grid IS the preview the designer should see before commit.
    //
    // Sampler / Flow / Overlay don't have a CSV inline mode, so their
    // previews remain base-scene-only until commit; an explicit hint
    // appears below the iframe to set expectation.
    if (kind === 'variants' && spec && spec.axes) {
      var cells = (spec.axes || []).reduce(function(acc, a) {
        return acc * Math.max(1, (a.values || []).length);
      }, 1);
      summary = '<div class="wz-preview-stat"><strong>' + cells + '</strong> variant cells</div>';
      // Find the picked scene's slug from the JSON data attr the page
      // injected. The composition renderer mounts at the editor-shell
      // route, not /preview/<id>, so we need the slug.
      var sceneSlug = null;
      try {
        var hostEl = document.querySelector('[data-wz-scenes-json]');
        if (hostEl) {
          var scenes = JSON.parse(hostEl.getAttribute('data-wz-scenes-json') || '[]');
          var match = scenes.filter(function(s) { return s.id === sceneId; })[0];
          if (match) sceneSlug = match.slug;
        }
      } catch (_) {}
      if (sceneSlug && cells >= 2) {
        var csv = [];
        for (var i = 0; i < cells; i++) csv.push(sceneId);
        src = '/platform/project/' + encodeURIComponent(sceneSlug) +
          '?variants=' + encodeURIComponent(csv.join(','));
        previewMode = cells + '-cell composition (live)';
      }
    } else if (kind === 'sampler' && spec) {
      summary = '<div class="wz-preview-stat"><strong>' + (spec.sampleCount || 0) +
        '</strong> sampled cells · ' + (spec.grid && spec.grid.columns || '?') + '×' +
        (spec.grid && spec.grid.rows || '?') + ' grid</div>';
    } else if (kind === 'flow' && spec && Array.isArray(spec.steps)) {
      summary = '<div class="wz-preview-stat"><strong>' + spec.steps.length +
        '</strong> steps · ' + (spec.transitions || []).length + ' transitions</div>';
    } else if (kind === 'overlay' && spec && Array.isArray(spec.layers)) {
      summary = '<div class="wz-preview-stat"><strong>' + spec.layers.length +
        '</strong> layers</div>';
    }

    var hint = previewMode === 'base scene'
      ? '<p class="wz-preview-hint">Preview shows the base scene. The composition renders after commit — open it from the catalog.</p>'
      : '<p class="wz-preview-hint">Live preview: ' + previewMode + '.</p>';

    return '<div class="wz-step-panel" data-wz-step="live-preview">' +
      '<h3 class="wz-step-title">Preview</h3>' +
      '<p class="wz-step-lead">Verify the composition with the current config.</p>' +
      summary +
      '<iframe class="wz-preview-frame" data-wz-preview src="' + escW(src) +
        '" title="Live preview" sandbox="allow-same-origin allow-scripts" loading="lazy"></iframe>' +
      hint +
    '</div>';
  }

  /**
   * renderCommitStep — Step 4. Summary of what will be created + submit
   * button. Read-only view of the full spec.
   */
  function renderCommitStep(spec, kind) {
    var rows = [];
    if (kind === 'variants') {
      rows.push(['id', spec.variantsId]);
      rows.push(['name', spec.name || '—']);
      rows.push(['scene', spec.sceneId]);
      rows.push(['brand', spec.brand || '(scene default)']);
      rows.push(['axes', (spec.axes || []).length]);
      var cellCount = (spec.axes || []).reduce(function(acc, a) {
        return acc * Math.max(1, (a.values || []).length);
      }, 1);
      rows.push(['variant cells', cellCount]);
    } else if (kind === 'sampler') {
      rows.push(['id', spec.samplerId]);
      rows.push(['name', spec.name || '—']);
      rows.push(['scene', spec.sceneId]);
      rows.push(['mode', spec.sampleMode || 'sequential']);
      rows.push(['count', spec.sampleCount || 0]);
      rows.push(['grid', (spec.grid?.columns || 0) + '×' + (spec.grid?.rows || 0)]);
      rows.push(['brand', spec.sharedBrand || '(scene default)']);
    } else if (kind === 'flow') {
      rows.push(['id', spec.flowId]);
      rows.push(['name', spec.name || '—']);
      rows.push(['steps', (spec.steps || []).length]);
      var totalDur = (spec.steps || []).reduce(function(a, s) { return a + (s.duration || 0); }, 0);
      rows.push(['total duration', totalDur + 'ms']);
      var transitions = (spec.steps || []).map(function(s) { return s.transition; }).filter(Boolean);
      rows.push(['transitions', transitions.join(' · ') || '—']);
    } else if (kind === 'overlay') {
      rows.push(['id', spec.overlayId]);
      rows.push(['name', spec.name || '—']);
      rows.push(['scene', spec.sceneId]);
      rows.push(['layers', (spec.layers || []).length]);
      var blends = (spec.layers || []).map(function(l) { return l.blendMode; }).filter(Boolean);
      rows.push(['blend modes', blends.join(' · ') || '—']);
    }
    var summaryRows = rows.map(function(pair) {
      return '<div class="wz-summary-row">' +
        '<span class="wz-summary-key">' + escW(pair[0]) + '</span>' +
        '<span class="wz-summary-value">' + escW(String(pair[1])) + '</span>' +
      '</div>';
    }).join('');
    return '<div class="wz-step-panel" data-wz-step="commit">' +
      '<h3 class="wz-step-title">Commit</h3>' +
      '<p class="wz-step-lead">Review the spec, then create.</p>' +
      '<div class="wz-summary">' + summaryRows + '</div>' +
      '<button type="button" class="wz-btn wz-btn--primary" data-wz-commit>Create ' +
        escW(kind) + '</button>' +
    '</div>';
  }

  /**
   * renderWizardBreadcrumb — top-of-page step indicator. Highlights the
   * active step + lets the designer click a previously-completed step
   * to jump back without losing data (state is held by the wizard
   * controller — clicking just dispatches a navigation intent).
   */
  function renderWizardBreadcrumb(steps, currentStep) {
    var cells = steps.map(function(label, i) {
      var state = i < currentStep ? 'done' :
                  i === currentStep ? 'active' : 'upcoming';
      return '<button type="button" class="wz-crumb wz-crumb--' + state +
        '" data-wz-goto="' + i + '"' + (state === 'upcoming' ? ' disabled' : '') + '>' +
        '<span class="wz-crumb-num">' + (i + 1) + '</span>' +
        '<span class="wz-crumb-label">' + escW(label) + '</span>' +
      '</button>';
    }).join('');
    return '<nav class="wz-breadcrumb" data-wz-breadcrumb>' + cells + '</nav>';
  }

  /**
   * bindWizardActions — wires up step nav (Next/Back/breadcrumb), cancel,
   * and commit. Per-kind wizard binder calls this AFTER mounting all
   * step panels and registering its own onCommit/onCancel handlers.
   *
   * Contract:
   *   rootEl: HTMLElement      — the wizard container
   *   getState(): {step, spec} — wizard pulls current state for render
   *   setStep(n): void         — wizard updates currentStep + re-renders
   *   onCommit(spec): Promise  — POSTs to API + resolves with response
   *   onCancel(): void         — closes wizard, returns к catalog
   */
  function bindWizardActions(rootEl, opts) {
    if (!rootEl || !opts) return;
    var getState = opts.getState || function() { return { step: 0 }; };
    var setStep = opts.setStep || function() {};
    var onCommit = opts.onCommit || function() { return Promise.resolve(); };
    var onCancel = opts.onCancel || function() {};
    var totalSteps = opts.totalSteps || 4;

    rootEl.addEventListener('click', async function(e) {
      var t = e.target;
      // Step nav — Next.
      var nextBtn = t.closest && t.closest('[data-wz-next]');
      if (nextBtn) {
        e.preventDefault();
        var s = getState();
        if (s.step < totalSteps - 1) setStep(s.step + 1);
        return;
      }
      // Step nav — Back.
      var backBtn = t.closest && t.closest('[data-wz-back]');
      if (backBtn) {
        e.preventDefault();
        var s2 = getState();
        if (s2.step > 0) setStep(s2.step - 1);
        return;
      }
      // Breadcrumb jump.
      var crumb = t.closest && t.closest('[data-wz-goto]');
      if (crumb && !crumb.disabled) {
        e.preventDefault();
        var idx = Number(crumb.getAttribute('data-wz-goto') || '0');
        setStep(idx);
        return;
      }
      // Cancel.
      var cancelBtn = t.closest && t.closest('[data-wz-cancel]');
      if (cancelBtn) {
        e.preventDefault();
        onCancel();
        return;
      }
      // Commit.
      var commitBtn = t.closest && t.closest('[data-wz-commit]');
      if (commitBtn) {
        e.preventDefault();
        commitBtn.disabled = true;
        var origText = commitBtn.textContent;
        commitBtn.textContent = 'Creating…';
        try {
          await onCommit(getState().spec || {});
        } catch (err) {
          if (typeof flash === 'function') flash('Create failed: ' + ((err && err.message) || 'unknown'), 'error');
          commitBtn.disabled = false;
          commitBtn.textContent = origText;
        }
        return;
      }
    });
  }

  /**
   * mountWizard — convenience wrapper that creates a wizard controller
   * with internal state. Returns { mount(rootEl), getState(), setStep() }.
   * Per-kind wizards can either use this or roll their own state.
   */
  // ════════════════════════════════════════════════════════
  // Per-kind wizard binders — Pin #3 (variants) + Pin #4 (sampler).
  // Each just hooks the shared mountWizard primitive with a kind-
  // specific onCommit that POSTs к the right endpoint.
  // ════════════════════════════════════════════════════════

  function bindVariantsWizard() {
    var host = document.querySelector('[data-page="wizard-variants"] [data-wz-host]');
    if (!host) return;
    var wizard = window.reframeMountWizard({
      kind: 'variants',
      steps: ['Scene', 'Axes', 'Preview', 'Commit'],
      initialSpec: { axes: [{ name: 'density', values: ['compact', 'default', 'dense'] }] },
      onCommit: async function(spec) {
        if (!spec.variantsId || !spec.sceneId || !spec.axes || spec.axes.length === 0) {
          if (typeof flash === 'function') flash('id, scene, and at least one axis required', 'error');
          return;
        }
        try {
          var res = await api('/platform/api/variants', {
            variantsId: spec.variantsId,
            name: spec.name,
            sceneId: spec.sceneId,
            axes: spec.axes,
            grid: spec.grid,
            brand: spec.brand,
          });
          if (res && res.ok) {
            if (typeof flash === 'function') flash('Variants created → ' + spec.variantsId, 'success');
            setTimeout(function() {
              window.location.href = '/platform/workbench/wizards';
            }, 350);
          }
        } catch (err) {
          if (typeof flash === 'function') flash('Create failed: ' + ((err && err.message) || 'unknown'), 'error');
        }
      },
    });
    wizard.mount(host);
  }

  function bindSamplerWizard() {
    var host = document.querySelector('[data-page="wizard-sampler"] [data-wz-host]');
    if (!host) return;
    var wizard = window.reframeMountWizard({
      kind: 'sampler',
      steps: ['Scene', 'Config', 'Preview', 'Commit'],
      initialSpec: { sampleMode: 'sequential', sampleCount: 6, grid: { columns: 3, rows: 2 } },
      onCommit: async function(spec) {
        if (!spec.samplerId || !spec.sceneId || !spec.sampleCount) {
          if (typeof flash === 'function') flash('id, scene, and count required', 'error');
          return;
        }
        // The sampler API expects cellSceneIds[] — the wizard's "sample
        // count" maps to N copies of the base scene id. Real per-cell
        // scene generation lands в Phase 4d when /design create sampler
        // grid wires through bus and synthesises distinct cell scenes.
        var cells = [];
        for (var i = 0; i < spec.sampleCount; i++) cells.push(spec.sceneId);
        try {
          var res = await api('/platform/api/sampler/' + encodeURIComponent(spec.samplerId), {
            name: spec.name,
            cellSceneIds: cells,
            sharedBrand: spec.sharedBrand,
            grid: spec.grid,
          });
          if (res && res.ok) {
            if (typeof flash === 'function') flash('Sampler created → ' + spec.samplerId, 'success');
            setTimeout(function() {
              window.location.href = '/platform/workbench/wizards';
            }, 350);
          }
        } catch (err) {
          if (typeof flash === 'function') flash('Create failed: ' + ((err && err.message) || 'unknown'), 'error');
        }
      },
    });
    wizard.mount(host);
  }

  // Phase 4 Brief 4c — Flow wizard binder.
  function bindFlowWizard() {
    var host = document.querySelector('[data-page="wizard-flow"] [data-wz-host]');
    if (!host) return;
    var wizard = window.reframeMountWizard({
      kind: 'flow',
      steps: ['Scene', 'Sequence', 'Preview', 'Commit'],
      initialSpec: {
        steps: [
          { sceneId: '', duration: 1500, transition: 'cut' },
          { sceneId: '', duration: 1500, transition: 'crossfade' },
        ],
      },
      onCommit: async function(spec) {
        if (!spec.flowId || !spec.steps || spec.steps.length < 2) {
          if (typeof flash === 'function') flash('id + at least 2 steps required', 'error');
          return;
        }
        // Engine flow expects stepSceneIds[] + transitions[]. Map the
        // wizard's per-step transition + duration into the flow spec
        // shape (transitions array has length = steps.length - 1).
        var stepSceneIds = spec.steps.map(function(s) { return s.sceneId; });
        var transitions = [];
        for (var i = 1; i < spec.steps.length; i++) {
          transitions.push({
            from: i - 1,
            to: i,
            label: spec.steps[i].transition || 'cut',
          });
        }
        try {
          var res = await api('/platform/api/flow', {
            flowId: spec.flowId,
            name: spec.name,
            stepSceneIds: stepSceneIds,
            transitions: transitions,
          });
          if (res && res.ok) {
            if (typeof flash === 'function') flash('Flow created → ' + spec.flowId, 'success');
            setTimeout(function() {
              window.location.href = '/platform/workbench/wizards';
            }, 350);
          }
        } catch (err) {
          if (typeof flash === 'function') flash('Create failed: ' + ((err && err.message) || 'unknown'), 'error');
        }
      },
    });
    wizard.mount(host);
  }

  // Phase 4 Brief 4c — Overlay wizard binder.
  function bindOverlayWizard() {
    var host = document.querySelector('[data-page="wizard-overlay"] [data-wz-host]');
    if (!host) return;
    var wizard = window.reframeMountWizard({
      kind: 'overlay',
      steps: ['Scene', 'Layers', 'Preview', 'Commit'],
      initialSpec: {
        layers: [{ type: 'noise-grain', opacity: 0.4, blendMode: 'normal', zIndex: 1 }],
      },
      onCommit: async function(spec) {
        if (!spec.overlayId || !spec.sceneId || !spec.layers || spec.layers.length === 0) {
          if (typeof flash === 'function') flash('id, scene, and ≥1 layer required', 'error');
          return;
        }
        if (spec.layers.length > 3) {
          if (typeof flash === 'function') flash('Engine cap: max 3 layers', 'error');
          return;
        }
        try {
          var res = await api('/platform/api/overlay', {
            overlayId: spec.overlayId,
            name: spec.name || spec.overlayId,
            baseSceneId: spec.sceneId,
            layers: spec.layers.map(function(l, i) {
              return {
                id: 'layer-' + i,
                type: l.type,
                config: { opacity: l.opacity },
                blendMode: l.blendMode,
                zIndex: l.zIndex,
              };
            }),
          });
          if (res && res.ok) {
            if (typeof flash === 'function') flash('Overlay created → ' + spec.overlayId, 'success');
            setTimeout(function() {
              window.location.href = '/platform/workbench/wizards';
            }, 350);
          }
        } catch (err) {
          if (typeof flash === 'function') flash('Create failed: ' + ((err && err.message) || 'unknown'), 'error');
        }
      },
    });
    wizard.mount(host);
  }

  window.reframeBindVariantsWizard = bindVariantsWizard;
  window.reframeBindSamplerWizard = bindSamplerWizard;
  window.reframeBindFlowWizard = bindFlowWizard;
  window.reframeBindOverlayWizard = bindOverlayWizard;

  window.reframeMountWizard = function(opts) {
    var state = {
      step: 0,
      spec: opts.initialSpec || {},
    };
    var rootEl = null;
    var steps = opts.steps || ['Scene', 'Config', 'Preview', 'Commit'];
    var kind = opts.kind || 'variants';

    function getScenes() {
      // Pulled from a globally-rendered list (server-side data
      // attribute) so wizards don't take an HTTP dependency just to
      // populate the picker.
      try {
        var listEl = document.querySelector('[data-wz-scenes-json]');
        if (!listEl) return [];
        return JSON.parse(listEl.getAttribute('data-wz-scenes-json') || '[]');
      } catch (_) { return []; }
    }

    function readFormState() {
      // Read step #2 form fields into state.spec — call this before any
      // step transition AWAY from step 1 (scene-picker) or step 2
      // (config) so back/forward nav doesn't drop input.
      if (!rootEl) return;
      var sceneInput = rootEl.querySelector('input[name="wz-scene"]:checked');
      if (sceneInput) state.spec.sceneId = sceneInput.value;

      if (kind === 'variants') {
        var idEl = rootEl.querySelector('[data-wz-id]');
        var nameEl = rootEl.querySelector('[data-wz-name]');
        var brandEl = rootEl.querySelector('[data-wz-brand]');
        if (idEl) state.spec.variantsId = idEl.value;
        if (nameEl) state.spec.name = nameEl.value;
        if (brandEl) state.spec.brand = brandEl.value;
        var axisRows = rootEl.querySelectorAll('[data-wz-axis-index]');
        var axes = [];
        axisRows.forEach(function(row) {
          var i = row.getAttribute('data-wz-axis-index');
          var nameInput = row.querySelector('[data-wz-axis-name="' + i + '"]');
          var valInput = row.querySelector('[data-wz-axis-values="' + i + '"]');
          if (nameInput && valInput) {
            var values = String(valInput.value || '').split(',').map(function(v) { return v.trim(); }).filter(Boolean);
            if (nameInput.value && values.length > 0) {
              axes.push({ name: nameInput.value, values: values });
            }
          }
        });
        if (axes.length > 0) state.spec.axes = axes;
      } else if (kind === 'sampler') {
        var sIdEl = rootEl.querySelector('[data-wz-id]');
        var sNameEl = rootEl.querySelector('[data-wz-name]');
        var modeEl = rootEl.querySelector('[data-wz-mode]');
        var countEl = rootEl.querySelector('[data-wz-count]');
        var colsEl = rootEl.querySelector('[data-wz-cols]');
        var rowsEl = rootEl.querySelector('[data-wz-rows]');
        var sBrandEl = rootEl.querySelector('[data-wz-brand]');
        if (sIdEl) state.spec.samplerId = sIdEl.value;
        if (sNameEl) state.spec.name = sNameEl.value;
        if (modeEl) state.spec.sampleMode = modeEl.value;
        if (countEl) state.spec.sampleCount = Number(countEl.value);
        if (sBrandEl) state.spec.sharedBrand = sBrandEl.value;
        state.spec.grid = {
          columns: colsEl ? Number(colsEl.value) : 3,
          rows: rowsEl ? Number(rowsEl.value) : 2,
        };
      } else if (kind === 'flow') {
        var fIdEl = rootEl.querySelector('[data-wz-id]');
        var fNameEl = rootEl.querySelector('[data-wz-name]');
        if (fIdEl) state.spec.flowId = fIdEl.value;
        if (fNameEl) state.spec.name = fNameEl.value;
        var stepRows = rootEl.querySelectorAll('[data-wz-step-index]');
        var newSteps = [];
        stepRows.forEach(function(row) {
          var i = row.getAttribute('data-wz-step-index');
          var sceneSel = row.querySelector('[data-wz-step-scene="' + i + '"]');
          var durInput = row.querySelector('[data-wz-step-duration="' + i + '"]');
          var transSel = row.querySelector('[data-wz-step-transition="' + i + '"]');
          if (sceneSel) {
            newSteps.push({
              sceneId: sceneSel.value,
              duration: durInput ? Number(durInput.value) : 1500,
              transition: transSel ? transSel.value : 'cut',
            });
          }
        });
        if (newSteps.length > 0) state.spec.steps = newSteps;
      } else if (kind === 'overlay') {
        var oIdEl = rootEl.querySelector('[data-wz-id]');
        var oNameEl = rootEl.querySelector('[data-wz-name]');
        if (oIdEl) state.spec.overlayId = oIdEl.value;
        if (oNameEl) state.spec.name = oNameEl.value;
        var layerRows = rootEl.querySelectorAll('[data-wz-layer-index]');
        var newLayers = [];
        layerRows.forEach(function(row) {
          var i = row.getAttribute('data-wz-layer-index');
          var typeEl = row.querySelector('[data-wz-layer-type="' + i + '"]');
          var opEl = row.querySelector('[data-wz-layer-opacity="' + i + '"]');
          var blendEl = row.querySelector('[data-wz-layer-blend="' + i + '"]');
          var zEl = row.querySelector('[data-wz-layer-z="' + i + '"]');
          if (typeEl) {
            newLayers.push({
              type: typeEl.value,
              opacity: opEl ? Number(opEl.value) : 0.5,
              blendMode: blendEl ? blendEl.value : 'normal',
              zIndex: zEl ? Number(zEl.value) : 1,
            });
          }
        });
        if (newLayers.length > 0) state.spec.layers = newLayers.slice(0, 3);
      }
    }

    function render() {
      if (!rootEl) return;
      var scenes = getScenes();
      var bodyHtml = '';
      if (state.step === 0) bodyHtml = renderScenePicker(scenes, state.spec.sceneId);
      else if (state.step === 1) bodyHtml = renderConfigForm(kind, state.spec);
      else if (state.step === 2) bodyHtml = renderLivePreview(state.spec.sceneId, state.spec, kind);
      else bodyHtml = renderCommitStep(state.spec, kind);

      var navHtml = '<div class="wz-nav">' +
        (state.step > 0 ? '<button type="button" class="wz-btn" data-wz-back>← Back</button>' : '') +
        '<button type="button" class="wz-btn wz-btn--ghost" data-wz-cancel>Cancel</button>' +
        (state.step < steps.length - 1 ? '<button type="button" class="wz-btn wz-btn--primary" data-wz-next>Next →</button>' : '') +
      '</div>';

      rootEl.innerHTML = renderWizardBreadcrumb(steps, state.step) +
        '<div class="wz-step-body">' + bodyHtml + '</div>' +
        navHtml;
    }

    return {
      mount: function(el) {
        rootEl = el;
        bindWizardActions(rootEl, {
          getState: function() { return state; },
          setStep: function(n) {
            readFormState();
            state.step = Math.max(0, Math.min(steps.length - 1, n));
            render();
          },
          onCommit: function(spec) {
            readFormState();
            return opts.onCommit ? opts.onCommit(state.spec) : Promise.resolve();
          },
          onCancel: opts.onCancel || function() { window.location.href = '/platform/workbench/wizards'; },
          totalSteps: steps.length,
        });

        // Phase 4 Brief 4c — flow + overlay row management. Add /
        // remove / reorder steps + layers without leaving the page.
        // Each handler mutates state.spec then re-renders.
        rootEl.addEventListener('click', function(e) {
          var t = e.target;
          if (!t.closest) return;

          // Flow: add step.
          if (t.closest('[data-wz-step-add]')) {
            e.preventDefault();
            readFormState();
            if (!state.spec.steps) state.spec.steps = [];
            state.spec.steps.push({
              sceneId: state.spec.sceneId || '',
              duration: 1500,
              transition: 'cut',
            });
            render();
            return;
          }
          // Flow: remove step.
          var rmStep = t.closest('[data-wz-step-remove]');
          if (rmStep) {
            e.preventDefault();
            readFormState();
            var idx = Number(rmStep.getAttribute('data-wz-step-remove'));
            if (state.spec.steps) state.spec.steps.splice(idx, 1);
            render();
            return;
          }
          // Flow: move step up.
          var upStep = t.closest('[data-wz-step-up]');
          if (upStep) {
            e.preventDefault();
            readFormState();
            var ui = Number(upStep.getAttribute('data-wz-step-up'));
            if (state.spec.steps && ui > 0) {
              var tmp = state.spec.steps[ui - 1];
              state.spec.steps[ui - 1] = state.spec.steps[ui];
              state.spec.steps[ui] = tmp;
            }
            render();
            return;
          }
          // Flow: move step down.
          var dnStep = t.closest('[data-wz-step-down]');
          if (dnStep) {
            e.preventDefault();
            readFormState();
            var di = Number(dnStep.getAttribute('data-wz-step-down'));
            if (state.spec.steps && di < state.spec.steps.length - 1) {
              var tmp2 = state.spec.steps[di + 1];
              state.spec.steps[di + 1] = state.spec.steps[di];
              state.spec.steps[di] = tmp2;
            }
            render();
            return;
          }
          // Overlay: add layer (engine cap = 3).
          if (t.closest('[data-wz-layer-add]')) {
            e.preventDefault();
            readFormState();
            if (!state.spec.layers) state.spec.layers = [];
            if (state.spec.layers.length >= 3) {
              if (typeof flash === 'function') flash('Engine cap: max 3 layers per overlay', 'error');
              return;
            }
            state.spec.layers.push({
              type: 'noise-grain',
              opacity: 0.5,
              blendMode: 'normal',
              zIndex: state.spec.layers.length + 1,
            });
            render();
            return;
          }
          // Overlay: remove layer.
          var rmLayer = t.closest('[data-wz-layer-remove]');
          if (rmLayer) {
            e.preventDefault();
            readFormState();
            var li = Number(rmLayer.getAttribute('data-wz-layer-remove'));
            if (state.spec.layers) state.spec.layers.splice(li, 1);
            render();
            return;
          }
          // Variants: add axis.
          if (t.closest('[data-wz-axis-add]')) {
            e.preventDefault();
            readFormState();
            if (!state.spec.axes) state.spec.axes = [];
            state.spec.axes.push({ name: 'axis-' + (state.spec.axes.length + 1), values: ['a', 'b'] });
            render();
            return;
          }
          // Variants: remove axis.
          var rmAxis = t.closest('[data-wz-axis-remove]');
          if (rmAxis) {
            e.preventDefault();
            readFormState();
            var ai = Number(rmAxis.getAttribute('data-wz-axis-remove'));
            if (state.spec.axes) state.spec.axes.splice(ai, 1);
            render();
            return;
          }
        });

        render();
      },
      getState: function() { return state; },
      setStep: function(n) {
        state.step = n;
        render();
      },
    };
  };
