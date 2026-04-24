/**
 * FlowRenderer — mount a flow composition with all steps upfront, CSS
 * display-gated for step-switching.
 *
 * Design choice (pin 4 of Week 2): every step iframe mounts at start,
 * inactive ones hidden via display:none. DOM-swap on each transition
 * would cost ~50-100ms per swap for iframe re-init — too slow for
 * fade/slide animations. All-mounted + CSS toggle = sub-frame switching
 * and enables two-step-visible transitions (crossfade between current
 * and next) when wanted later.
 *
 * RAM cost: N typical flow ≤ 10 steps × ~20MB per iframe = 200MB max.
 * Acceptable. Past 10 steps = sampler territory; virtualization TODO
 * mirrors the SSE multiplex TODO in renderer.ts — both activate when
 * sampler primitive lands (N > 10 cells / steps).
 *
 * Reuses the canvas-dom registry: each step's createDOMCanvas registers
 * under its stepSceneId as hostId, compositionKind='flow'. setFocused()
 * on step change fires reframe:composition-focus, the platform-bootstrap
 * shell subscriber updates [data-session], right panel + layers rail
 * re-fetch for the newly-focused step — same path as variants.
 */

import { createDOMCanvas } from './dom-canvas.js';
import { onFocusChange, setFocused, type HostId } from './registry.js';

export interface FlowStepDescriptor {
  sceneId: string;
  label?: string;
}

export interface FlowTransitionDescriptor {
  from: number;
  to: number;
  label?: string;
}

export interface FlowRendererOptions {
  host: HTMLElement;
  flowId: string;
  steps: FlowStepDescriptor[];
  transitions: FlowTransitionDescriptor[];
  /** Initial step to focus; defaults to 0. */
  initialStep?: number;
  /** Called when the active step changes. State persistence is the host's concern (POST to /api/flow/state). */
  onStepChange?: (stepIndex: number, sceneId: string) => void;
  /** Forwarded to each step's DOMCanvas onSelect. */
  onCanvasSelect?: (sceneId: string, ids: string[]) => void;
}

export interface FlowRendererHandle {
  readonly canvases: ReadonlyMap<string, ReturnType<typeof createDOMCanvas>>;
  getCurrentStep(): number;
  goToStep(stepIndex: number): void;
  goNext(): void;
  goPrev(): void;
  destroy(): void;
}

export function mountFlowRenderer(opts: FlowRendererOptions): FlowRendererHandle {
  const { host, flowId, steps, transitions } = opts;
  if (steps.length < 2) {
    throw new Error('mountFlowRenderer requires at least 2 steps');
  }

  // Preserve #reframe-viewport for the shell composition-focus
  // subscriber — updates its data-session on each step transition so
  // Platform UI reads (right panel, layers rail, toolbar, undo) resolve
  // the focused step's scene. Same fix as composition-renderer.ts:
  // without preservation, the shell reads null and shows "No scene open".
  const preservedViewport = host.querySelector('#reframe-viewport') as HTMLElement | null;
  host.innerHTML = '';
  if (preservedViewport) {
    preservedViewport.style.display = 'none';
    host.appendChild(preservedViewport);
  }
  const rootStyle = host.style;
  rootStyle.position = 'relative';
  rootStyle.display = 'flex';
  rootStyle.flexDirection = 'column';
  rootStyle.height = '100%';

  // Step stack — all N step containers live here, overlap via
  // position:absolute. Only the current one has display:block + opacity:1.
  const stack = document.createElement('div');
  stack.className = 'rfd-flow-stack';
  stack.style.position = 'relative';
  stack.style.flex = '1 1 auto';
  stack.style.minHeight = '0';
  host.appendChild(stack);

  // Nav bar — prev/next + step indicator. Lives below the stack.
  const nav = document.createElement('div');
  nav.className = 'rfd-flow-nav';
  nav.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:12px',
    'padding:12px 16px',
    "font:500 12px/1.4 'JetBrains Mono', ui-monospace, monospace",
    'letter-spacing:0.04em',
    'background:var(--surface-elevated, #e8e2d0)',
    'border-top:1px solid var(--border-subtle, #d9d0b6)',
  ].join(';');
  host.appendChild(nav);

  const canvases = new Map<string, ReturnType<typeof createDOMCanvas>>();
  const stepContainers: HTMLElement[] = [];
  const ownedHostIds = new Set<HostId>();

  let currentStep = Math.max(0, Math.min(opts.initialStep ?? 0, steps.length - 1));

  // Mount all step iframes upfront.
  steps.forEach((step, i) => {
    const stepHost = document.createElement('div');
    stepHost.className = 'rfd-flow-step';
    stepHost.dataset.stepIndex = String(i);
    stepHost.dataset.sceneId = step.sceneId;
    // All steps mount display:block so their iframes get real bbox
    // measurements at onLoad — if we used display:none for inactive
    // steps, their internal root bboxes would read 0×0 and the
    // zoom-pan layer would pin itself at minimum zoom (0.25×) for
    // those scenes forever. Visibility gating is opacity + pointer
    // events + visibility, not display.
    stepHost.style.cssText = [
      'position:absolute',
      'inset:0',
      'display:block',
      `opacity:${i === currentStep ? '1' : '0'}`,
      `pointer-events:${i === currentStep ? 'auto' : 'none'}`,
      `visibility:${i === currentStep ? 'visible' : 'hidden'}`,
      'transition:opacity 200ms ease',
    ].join(';');
    stack.appendChild(stepHost);
    stepContainers.push(stepHost);

    const canvas = createDOMCanvas({
      container: stepHost,
      sceneId: step.sceneId,
      hostId: step.sceneId,
      compositionKind: 'flow',
      onSelect: (ids) => opts.onCanvasSelect?.(step.sceneId, ids),
    });
    canvases.set(step.sceneId, canvas);
    ownedHostIds.add(step.sceneId);
  });

  // Promote the initial step to focused in the registry so
  // reframe:composition-focus fires for it on mount — shell subscribers
  // pick up the right-panel / layers for step 0.
  setFocused(steps[currentStep].sceneId);

  // Forward onFocusChange from registry → opts.onStepChange, but ONLY
  // when the focused hostId belongs to this flow (page may have other
  // canvases mounted independently — e.g. future pages with multi-flow).
  const unsubscribeFocus = onFocusChange((hostId) => {
    if (hostId === null) return;
    if (!ownedHostIds.has(hostId)) return;
    const idx = steps.findIndex((s) => s.sceneId === hostId);
    if (idx >= 0 && idx !== currentStep) {
      setCurrentStep(idx);
    }
  });

  // ─── Navigation ──────────────────────────────────────────
  //
  // Transitions from currentStep. Phase 0 Flow: condition field on
  // transitions is ignored (treated as always-true). When the
  // conditional evaluator lands, filter this list by evaluating each
  // transition's condition against flow state.data.

  function availableTransitions(fromIndex: number): FlowTransitionDescriptor[] {
    return transitions.filter((t) => t.from === fromIndex);
  }

  function setCurrentStep(nextIndex: number): void {
    if (nextIndex < 0 || nextIndex >= steps.length) return;
    if (nextIndex === currentStep) return;
    const prev = currentStep;
    currentStep = nextIndex;

    // Visibility swap (opacity + visibility + pointer-events — NOT
    // display, see mount comment). Keeping display:block avoids the
    // 0×0 iframe / pinned-min-zoom problem for hidden steps.
    stepContainers[prev].style.opacity = '0';
    stepContainers[prev].style.pointerEvents = 'none';
    stepContainers[nextIndex].style.visibility = 'visible';
    stepContainers[nextIndex].style.pointerEvents = 'auto';
    requestAnimationFrame(() => {
      stepContainers[nextIndex].style.opacity = '1';
    });
    setTimeout(() => {
      if (currentStep !== prev) stepContainers[prev].style.visibility = 'hidden';
    }, 220);

    setFocused(steps[nextIndex].sceneId);
    renderNav();
    opts.onStepChange?.(nextIndex, steps[nextIndex].sceneId);
  }

  function renderNav(): void {
    nav.innerHTML = '';

    const left = document.createElement('div');
    left.style.cssText = 'display:flex;gap:8px';

    const hasPrev = transitions.some((t) => t.to === currentStep);
    const prevBtn = mkButton('← Prev', hasPrev);
    if (hasPrev) {
      prevBtn.addEventListener('click', () => {
        // Prev means: go to any step that has a transition INTO currentStep.
        // Take the first matching one (typical linear flow = i+1 → i-1 only).
        const inbound = transitions.filter((t) => t.to === currentStep);
        if (inbound.length > 0) setCurrentStep(inbound[0].from);
      });
    }
    left.appendChild(prevBtn);

    const outbound = availableTransitions(currentStep);
    outbound.forEach((t) => {
      const label = t.label ?? (t.to === currentStep + 1 ? 'Next →' : `Go to step ${t.to + 1}`);
      const btn = mkButton(label, true);
      btn.addEventListener('click', () => setCurrentStep(t.to));
      left.appendChild(btn);
    });
    nav.appendChild(left);

    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    nav.appendChild(spacer);

    const indicator = document.createElement('div');
    indicator.className = 'rfd-flow-step-indicator';
    indicator.style.cssText = 'display:flex;gap:6px;align-items:center;color:var(--text-secondary,#6e6750)';
    indicator.textContent = `Step ${currentStep + 1} / ${steps.length} — ${steps[currentStep].label ?? steps[currentStep].sceneId}`;
    nav.appendChild(indicator);
  }

  function mkButton(label: string, enabled: boolean): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.style.cssText = [
      "font:inherit",
      'padding:6px 12px',
      'border-radius:4px',
      `border:1px solid ${enabled ? 'var(--accent, #e94b1a)' : 'var(--border-subtle, #d9d0b6)'}`,
      `background:${enabled ? 'var(--accent, #e94b1a)' : 'transparent'}`,
      `color:${enabled ? 'var(--on-accent, #fff)' : 'var(--text-muted, #b8af92)'}`,
      `cursor:${enabled ? 'pointer' : 'not-allowed'}`,
      'letter-spacing:0.05em',
    ].join(';');
    btn.disabled = !enabled;
    return btn;
  }

  renderNav();

  // Keyboard nav (arrow keys) — window-global but only acts when a flow
  // step is focused (registry.isFocused gates the canvas's listeners;
  // here we gate against ownedHostIds so arrow keys don't fight with
  // present-mode arrows or other canvases on the page).
  const onKey = (e: KeyboardEvent): void => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const focusedScene = steps[currentStep]?.sceneId;
    if (!focusedScene) return;
    if (e.key === 'ArrowRight') {
      const out = availableTransitions(currentStep);
      if (out.length > 0) {
        e.preventDefault();
        setCurrentStep(out[0].to);
      }
    } else if (e.key === 'ArrowLeft') {
      const inbound = transitions.filter((t) => t.to === currentStep);
      if (inbound.length > 0) {
        e.preventDefault();
        setCurrentStep(inbound[0].from);
      }
    }
  };
  window.addEventListener('keydown', onKey);

  return {
    canvases,
    getCurrentStep: () => currentStep,
    goToStep: (i) => setCurrentStep(i),
    goNext: () => {
      const out = availableTransitions(currentStep);
      if (out.length > 0) setCurrentStep(out[0].to);
    },
    goPrev: () => {
      const inbound = transitions.filter((t) => t.to === currentStep);
      if (inbound.length > 0) setCurrentStep(inbound[0].from);
    },
    destroy: () => {
      window.removeEventListener('keydown', onKey);
      unsubscribeFocus();
      for (const canvas of canvases.values()) {
        try { canvas.destroy(); }
        catch (err) { console.warn('[flow-renderer] destroy threw', err); }
      }
      canvases.clear();
      ownedHostIds.clear();
      host.innerHTML = '';
    },
  };
}
