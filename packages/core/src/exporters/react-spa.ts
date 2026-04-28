/**
 * Single-file React SPA exporter (#20 stateful prototype).
 *
 * Takes a Flow composition + persisted state, emits one HTML file that
 * runs as a portable interactive React app — fonts/images/vendor scripts
 * inlined, no localhost, no build, no internet. Click .html → step
 * navigation works, inputs bind into props.state via data-flow-state.
 *
 * Pipeline:
 *   1. Validate composition kind === 'flow' (Phase 0 scope).
 *   2. Per step: exportToReact → wrap as `function Step<i>(props)` via
 *      react-step-wrapper.
 *   3. Inline vendor scripts (Babel + React + ReactDOM) read from
 *      node_modules.
 *   4. Aggregate per-step Google Fonts + images via existing #3 inliners
 *      (font subset deduped across the union of all steps' used variants).
 *   5. Compose FlowApp wrapper: useState(initialState), Steps array,
 *      transitions inlined from flow.json, Prev/Next nav.
 *   6. Assemble HTML + emit.
 *
 * Determinism: same flow composition + pinned vendor versions + stable
 * network → byte-identical output. Tests use mocked fetcher to avoid
 * real network in CI.
 *
 * Size budget: ~3MB Babel + 132KB ReactDOM + N×~50KB step JSX +
 * fonts (subset) + images. Typical 3-step flow = 3.5-5MB. Output emits
 * a `sizeWarning` field when total exceeds 2MB so callers can surface
 * the cost vs the production-grade `format='react'` (TSX source) path.
 *
 * Annotations preserved: React exporter already emits annotation spans;
 * Caveat font (used by annotations) flows through the font subset like
 * any other Google font.
 */

import type { SceneGraph } from '../engine/scene-graph.js';
import type { FlowTransition, FlowState } from '../engine/composition.js';
import { exportToReact } from './react.js';
import { wrapStepBody } from './react-step-wrapper.js';
import { readVendorScript, escapeForInlineScript } from './inline-vendor.js';
import {
  inlineGoogleFontCss,
  isGoogleFontUrl,
  type UsedVariant,
  type ResourceFetcher,
} from './inline-fonts.js';
import { inlineImages } from './inline-images.js';
import { collectUsedVariants } from './bundle.js';
import { StandaloneNode } from '../adapters/standalone/node.js';
import { StandaloneHost } from '../adapters/standalone/adapter.js';
import { setHost } from '../host/context.js';

// ─── Types ────────────────────────────────────────────────────

export interface ReactSpaInput {
  flowId: string;
  flowName?: string;
  steps: SceneGraph[];
  stepRootIds: string[];
  transitions: FlowTransition[];
  state: FlowState;
}

export interface ReactSpaOptions {
  inlineFonts?: boolean;
  inlineImages?: boolean;
  failOnFetchError?: boolean;
  fetchTimeout?: number;
  fetcher?: ResourceFetcher;
  /** Project root for the brand-mark special-case (Week 5 #21). */
  projectDir?: string;
}

export interface ReactSpaResult {
  html: string;
  warnings: string[];
  inlinedAssets: { fonts: number; images: number };
  sizeBytes: number;
  sizeWarning: string | null;
}

const SIZE_WARNING_THRESHOLD_BYTES = 2 * 1024 * 1024; // 2MB

// ─── Public API ──────────────────────────────────────────────

export async function exportFlowToReactSpa(
  input: ReactSpaInput,
  options: ReactSpaOptions = {},
): Promise<ReactSpaResult> {
  const warnings: string[] = [];

  if (input.steps.length < 2) {
    throw new Error('exportFlowToReactSpa: flow must have at least 2 steps');
  }
  if (input.steps.length !== input.stepRootIds.length) {
    throw new Error('exportFlowToReactSpa: steps[] and stepRootIds[] must have equal length');
  }

  // ── 1. Per-step JSX via React exporter + wrap ──
  const stepBodies: string[] = [];
  for (let i = 0; i < input.steps.length; i++) {
    const graph = input.steps[i];
    const rootId = input.stepRootIds[i];
    const root = graph.getNode(rootId);
    if (!root) throw new Error(`exportFlowToReactSpa: step ${i} root id ${rootId} not in graph`);
    const host = new StandaloneHost(graph);
    setHost(host);
    const wrapped = new StandaloneNode(graph, root) as any;
    const jsxModule = exportToReact(wrapped, {
      typescript: false,
      cssModules: false,
      componentName: `Step${i}`,
    });
    stepBodies.push(wrapStepBody(jsxModule, { index: i }));
  }

  // ── 2. Vendor scripts (raw bytes ready for inline) ──
  const vendorBabel = readVendorScript('babel');
  const vendorReact = readVendorScript('react');
  const vendorReactDom = readVendorScript('react-dom');

  // ── 3. Aggregate font variants across all steps ──
  // Each step contributes its used (family, weight, style) tuples; the
  // SET semantics of UsedVariant equality (family|weight|style key) mean
  // duplicates collapse naturally.
  const allVariants = new Map<string, UsedVariant>();
  if (options.inlineFonts !== false) {
    for (let i = 0; i < input.steps.length; i++) {
      const variants = collectUsedVariants(input.steps[i], input.stepRootIds[i]);
      for (const v of variants) {
        const key = `${v.family}|${v.weight}|${v.style}`;
        if (!allVariants.has(key)) allVariants.set(key, v);
      }
    }
  }
  const usedVariants = [...allVariants.values()];

  // Build the Google Fonts URL for the union of used families (matching
  // the html.ts logic so caches align). Skip system fonts.
  let fontsCssBlock = '';
  let fontsInlined = 0;
  if (options.inlineFonts !== false && usedVariants.length > 0) {
    const familyMap = new Map<string, Set<number>>();
    for (const v of usedVariants) {
      if (!familyMap.has(v.family)) familyMap.set(v.family, new Set());
      familyMap.get(v.family)!.add(v.weight);
    }
    const familyParts = [...familyMap.entries()]
      .map(([family, weights]) => {
        const sorted = [...weights].sort((a, b) => a - b);
        return `family=${family.replace(/ /g, '+')}:wght@${sorted.join(';')}`;
      });
    const fontsUrl = `https://fonts.googleapis.com/css2?${familyParts.join('&')}&display=swap`;
    if (isGoogleFontUrl(fontsUrl)) {
      const fontResult = await inlineGoogleFontCss(fontsUrl, {
        usedVariants,
        fetcher: options.fetcher,
        fetchTimeout: options.fetchTimeout,
        failOnFetchError: options.failOnFetchError,
      });
      fontsCssBlock = fontResult.styleBlock;
      fontsInlined = fontResult.facesEmitted;
      warnings.push(...fontResult.warnings);
    }
  }

  // ── 4. Compose the FlowApp + transitions ──
  const initialState = JSON.stringify(input.state.data ?? {});
  const transitionsLiteral = JSON.stringify(input.transitions ?? []);
  const stepCount = input.steps.length;

  const flowAppCode = `
function FlowApp() {
  const [step, setStep] = React.useState(0);
  const [state, setState] = React.useState(${initialState});
  const Steps = [${input.steps.map((_, i) => `Step${i}`).join(', ')}];
  const Transitions = ${transitionsLiteral};
  const stepCount = ${stepCount};
  const Current = Steps[step];
  const props = { state, setState };
  return (
    React.createElement('div', { className: 'reframe-flow-app', style: { minHeight: '100vh', display: 'flex', flexDirection: 'column' } },
      React.createElement('div', { className: 'reframe-flow-step', style: { flex: '1 1 auto', overflow: 'auto' } },
        React.createElement(Current, props)
      ),
      React.createElement('nav', {
        className: 'reframe-flow-nav',
        style: {
          display: 'flex', gap: '12px', padding: '12px 16px',
          background: '#f5f5f5', borderTop: '1px solid #ddd',
          font: '500 13px/1.4 system-ui, sans-serif',
        },
      },
        React.createElement('button', {
          type: 'button',
          onClick: () => setStep(s => Math.max(0, s - 1)),
          disabled: step === 0,
          style: { padding: '8px 16px', borderRadius: '4px', cursor: step === 0 ? 'not-allowed' : 'pointer' },
        }, 'Prev'),
        React.createElement('button', {
          type: 'button',
          onClick: () => setStep(s => Math.min(stepCount - 1, s + 1)),
          disabled: step === stepCount - 1,
          style: { padding: '8px 16px', borderRadius: '4px', cursor: step === stepCount - 1 ? 'not-allowed' : 'pointer' },
        }, 'Next'),
        React.createElement('div', { style: { flex: 1 } }),
        React.createElement('div', { style: { color: '#666' } }, 'Step ' + (step + 1) + ' / ' + stepCount)
      )
    )
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(FlowApp));
`;

  // ── 5. Assemble HTML ──
  const escTitle = escapeHtml(`${input.flowName ?? input.flowId} — Live Flow`);
  const stepBodiesJoined = stepBodies.join('\n\n');

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escTitle}</title>
  <script>${vendorReact}</script>
  <script>${vendorReactDom}</script>
  <script>${vendorBabel}</script>
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; }
    #root { min-height: 100vh; }
  </style>
  ${fontsCssBlock}
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" data-presets="react">
${stepBodiesJoined}

${flowAppCode}
  </script>
</body>
</html>`;

  // ── 6. Image inlining (single pass over composed HTML) ──
  let imagesInlined = 0;
  if (options.inlineImages !== false) {
    const imgResult = await inlineImages(html, {
      fetcher: options.fetcher,
      fetchTimeout: options.fetchTimeout,
      failOnFetchError: options.failOnFetchError,
      projectDir: options.projectDir,
    });
    html = imgResult.html;
    imagesInlined = imgResult.inlinedCount;
    warnings.push(...imgResult.warnings);
  }

  const sizeBytes = Buffer.byteLength(html, 'utf8');
  const sizeWarning = sizeBytes > SIZE_WARNING_THRESHOLD_BYTES
    ? `SPA size: ${(sizeBytes / 1024 / 1024).toFixed(1)} MB. For production-grade React deliverable, consider format='react' (TSX source) + your own build pipeline.`
    : null;

  return {
    html,
    warnings,
    inlinedAssets: { fonts: fontsInlined, images: imagesInlined },
    sizeBytes,
    sizeWarning,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Re-export for callers that want vendor inlining utilities directly.
export { readVendorScript, escapeForInlineScript };
