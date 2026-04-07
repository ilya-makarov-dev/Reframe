/**
 * INode Conformance Spec — Universal Runner
 *
 * Takes declarative spec entries, builds scenes, exports to each target,
 * checks matchers, runs roundtrip verification.
 *
 * One runner for everything. No hand-written assertions.
 */

import type { PropertySpec, ImportSpec, AnimationSpec, FunctionalSpec, Matcher, SpecCheckResult, SpecSuiteResult } from './types';
import type { AuditRuleEntry } from './audit';
import type { SceneGraph } from '../engine/scene-graph';
import type { SceneNode } from '../engine/types';
import { build } from '../builder';
import { exportToHtml } from '../exporters/html';
import { exportSceneGraphToSvg } from '../exporters/svg';
import { exportToReact } from '../exporters/react';
import { importFromHtml } from '../importers/html';
import { exportToAnimatedHtml } from '../exporters/animated-html';
import { exportToLottieString } from '../exporters/lottie';
import { audit } from '../audit';
import { StandaloneNode } from '../adapters/standalone/node';

// ─── Default roundtrip-safe properties ────────────────────────

const DEFAULT_ROUNDTRIP_PROPS = [
  'width', 'height', 'cornerRadius',
  'opacity', 'fontSize', 'fontWeight',
  'layoutMode', 'itemSpacing',
];

// Numeric tolerance for roundtrip comparison
const TOLERANCE = 0.5;

// ─── Matcher Engine ───────────────────────────────────────────

function checkMatcher(output: string, matcher: Matcher): { ok: boolean; detail: string } {
  if (typeof matcher === 'string') {
    const ok = output.includes(matcher);
    return { ok, detail: ok ? matcher : `missing: "${matcher}"` };
  }
  if (Array.isArray(matcher)) {
    const missing = matcher.filter(s => !output.includes(s));
    return {
      ok: missing.length === 0,
      detail: missing.length === 0
        ? `all ${matcher.length} patterns found`
        : `missing: ${missing.map(s => `"${s}"`).join(', ')}`,
    };
  }
  if (matcher instanceof RegExp) {
    const ok = matcher.test(output);
    return { ok, detail: ok ? `matched ${matcher}` : `no match for ${matcher}` };
  }
  if (typeof matcher === 'function') {
    const ok = matcher(output);
    return { ok, detail: ok ? 'custom check passed' : 'custom check failed' };
  }
  return { ok: false, detail: 'unknown matcher type' };
}

// ─── Property Spec Runner ─────────────────────────────────────

export async function runPropertySpecs(specs: PropertySpec[]): Promise<SpecSuiteResult> {
  const checks: SpecCheckResult[] = [];

  for (const spec of specs) {
    const { root, graph } = build(spec.scene);

    // HTML export check
    if (spec.html !== undefined) {
      try {
        const html = exportToHtml(graph, root.id, { fullDocument: false });
        const { ok, detail } = checkMatcher(html, spec.html);
        checks.push({ spec: spec.name, target: 'html', passed: ok, message: ok ? undefined : detail });
      } catch (e: any) {
        checks.push({ spec: spec.name, target: 'html', passed: false, message: `export error: ${e.message}` });
      }
    }

    // SVG export check
    if (spec.svg !== undefined) {
      try {
        const svg = exportSceneGraphToSvg(graph, root.id);
        const { ok, detail } = checkMatcher(svg, spec.svg);
        checks.push({ spec: spec.name, target: 'svg', passed: ok, message: ok ? undefined : detail });
      } catch (e: any) {
        checks.push({ spec: spec.name, target: 'svg', passed: false, message: `export error: ${e.message}` });
      }
    }

    // React export check
    if (spec.react !== undefined) {
      try {
        const code = exportToReact(root, { componentName: 'Spec' });
        const { ok, detail } = checkMatcher(code, spec.react);
        checks.push({ spec: spec.name, target: 'react', passed: ok, message: ok ? undefined : detail });
      } catch (e: any) {
        checks.push({ spec: spec.name, target: 'react', passed: false, message: `export error: ${e.message}` });
      }
    }

    // Roundtrip check (HTML → reimport → compare properties)
    if (spec.roundtrip) {
      try {
        const html = exportToHtml(graph, root.id, { fullDocument: false, dataAttributes: true });
        // Wrap in a root div with dimensions for reimport
        const rootNode = graph.getNode(root.id)!;
        const wrappedHtml = `<div style="width:${rootNode.width}px;height:${rootNode.height}px;position:relative">${html}</div>`;

        const result = await importFromHtml(wrappedHtml);
        const reimportedRoot = result.graph.getNode(result.rootId)!;

        const propsToCheck = spec.roundtrip === true
          ? DEFAULT_ROUNDTRIP_PROPS
          : spec.roundtrip;

        // Build INode wrappers for comparison
        const originalRoot = new StandaloneNode(graph, rootNode);
        const reimportedIRoot = new StandaloneNode(result.graph, reimportedRoot);

        // Find best comparison pairs: root vs root, then first child vs first child
        const pairs: Array<[any, any, string]> = [
          [originalRoot, reimportedIRoot, 'root'],
        ];
        const origChildren = originalRoot.children;
        const reimChildren = reimportedIRoot.children;
        if (origChildren?.length && reimChildren?.length) {
          pairs.push([origChildren[0], reimChildren[0], 'child[0]']);
        }

        const failures: string[] = [];
        for (const prop of propsToCheck) {
          // Try root first, then child — use whichever has the property defined
          let original: any, reimported: any;
          let found = false;
          for (const [orig, reim] of pairs) {
            const o = (orig as any)[prop];
            if (o !== undefined && o !== null) {
              original = o;
              reimported = (reim as any)[prop];
              found = true;
              break;
            }
          }
          if (!found) continue;

          if (typeof original === 'number' && typeof reimported === 'number') {
            if (Math.abs(original - reimported) > TOLERANCE) {
              failures.push(`${prop}: ${original} → ${reimported}`);
            }
          } else if (typeof original === 'string' && typeof reimported === 'string') {
            if (original !== reimported) {
              failures.push(`${prop}: "${original}" → "${reimported}"`);
            }
          } else if (typeof original === 'boolean') {
            if (original !== reimported) {
              failures.push(`${prop}: ${original} → ${reimported}`);
            }
          }
          // Skip complex types (arrays, objects) for now
        }

        const ok = failures.length === 0;
        checks.push({
          spec: spec.name,
          target: 'roundtrip',
          passed: ok,
          message: ok ? undefined : failures.join('; '),
        });
      } catch (e: any) {
        checks.push({ spec: spec.name, target: 'roundtrip', passed: false, message: `roundtrip error: ${e.message}` });
      }
    }
  }

  const passed = checks.filter(c => c.passed).length;
  const failed = checks.filter(c => !c.passed).length;
  return { checks, passed, failed, total: checks.length };
}

// ─── Audit Spec Runner ────────────────────────────────────────

export async function runAuditSpecs(specs: AuditRuleEntry[]): Promise<SpecSuiteResult> {
  const checks: SpecCheckResult[] = [];

  for (const spec of specs) {
    const ruleInstance = spec.factory();

    // PASS scene — should have 0 issues
    {
      const { root } = build(spec.pass);
      const issues = audit(root, [ruleInstance], spec.designSystem);
      const ok = issues.length === 0;
      checks.push({
        spec: `audit/${spec.rule}`,
        target: 'pass',
        passed: ok,
        message: ok ? undefined : `expected 0 issues, got ${issues.length}: ${issues.map(i => i.message).join('; ')}`,
      });
    }

    // FAIL scene — should have at least 1 issue
    {
      const { root } = build(spec.fail);
      const issues = audit(root, [ruleInstance], spec.designSystem);
      const ok = issues.length >= 1;
      checks.push({
        spec: `audit/${spec.rule}`,
        target: 'fail',
        passed: ok,
        message: ok ? undefined : `expected >= 1 issues, got 0`,
      });
    }
  }

  const passed = checks.filter(c => c.passed).length;
  const failed = checks.filter(c => !c.passed).length;
  return { checks, passed, failed, total: checks.length };
}

// ─── Import Spec Runner ──────────────────────────────────────

/** Resolve a dot-path like 'children[0].fills[0].type' on an object */
function resolvePath(obj: any, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current = obj;
  for (const p of parts) {
    if (current == null) return undefined;
    current = current[p];
  }
  return current;
}

export async function runImportSpecs(specs: ImportSpec[]): Promise<SpecSuiteResult> {
  const checks: SpecCheckResult[] = [];

  for (const spec of specs) {
    try {
      const { graph, rootId } = await importFromHtml(spec.html);
      const root = new StandaloneNode(graph, graph.getNode(rootId)!);

      for (const check of spec.checks) {
        const actual = resolvePath(root, check.path);
        const tolerance = check.tolerance ?? 0.5;
        let ok: boolean;
        let detail: string;

        if (typeof check.expected === 'function') {
          ok = (check.expected as (v: unknown) => boolean)(actual);
          detail = ok ? 'custom check passed' : `custom check failed (got ${JSON.stringify(actual)})`;
        } else if (typeof check.expected === 'number' && typeof actual === 'number') {
          ok = Math.abs(actual - check.expected) <= tolerance;
          detail = ok ? `${check.path}=${actual}` : `${check.path}: expected ${check.expected}, got ${actual}`;
        } else {
          ok = actual === check.expected;
          detail = ok ? `${check.path}=${JSON.stringify(actual)}` : `${check.path}: expected ${JSON.stringify(check.expected)}, got ${JSON.stringify(actual)}`;
        }

        checks.push({
          spec: `import/${spec.name}`,
          target: check.path,
          passed: ok,
          message: ok ? undefined : detail,
        });
      }
    } catch (e: any) {
      checks.push({
        spec: `import/${spec.name}`,
        target: 'import',
        passed: false,
        message: `import error: ${e.message}`,
      });
    }
  }

  const passed = checks.filter(c => c.passed).length;
  const failed = checks.filter(c => !c.passed).length;
  return { checks, passed, failed, total: checks.length };
}

// ─── Animation Spec Runner ────────────────────────���──────────

export async function runAnimationSpecs(specs: AnimationSpec[]): Promise<SpecSuiteResult> {
  const checks: SpecCheckResult[] = [];

  for (const spec of specs) {
    const { root, graph } = build(spec.scene);
    const timeline = spec.timeline as any;

    // Animated HTML check
    if (spec.html !== undefined) {
      try {
        const html = exportToAnimatedHtml(graph, root.id, timeline, { fullDocument: false });
        const { ok, detail } = checkMatcher(html, spec.html);
        checks.push({ spec: spec.name, target: 'html', passed: ok, message: ok ? undefined : detail });
      } catch (e: any) {
        checks.push({ spec: spec.name, target: 'html', passed: false, message: `export error: ${e.message}` });
      }
    }

    // Lottie check
    if (spec.lottie !== undefined) {
      try {
        const json = exportToLottieString(graph, root.id, timeline);
        const { ok, detail } = checkMatcher(json, spec.lottie);
        checks.push({ spec: spec.name, target: 'lottie', passed: ok, message: ok ? undefined : detail });
      } catch (e: any) {
        checks.push({ spec: spec.name, target: 'lottie', passed: false, message: `export error: ${e.message}` });
      }
    }
  }

  const passed = checks.filter(c => c.passed).length;
  const failed = checks.filter(c => !c.passed).length;
  return { checks, passed, failed, total: checks.length };
}

// ─── Functional Spec Runner ──────────────────────────────────

export async function runFunctionalSpecs(specs: FunctionalSpec[]): Promise<SpecSuiteResult> {
  const checks: SpecCheckResult[] = [];

  for (const spec of specs) {
    try {
      const result = await spec.test();
      const ok = result === true;
      checks.push({
        spec: `fn/${spec.name}`,
        target: spec.category,
        passed: ok,
        message: ok ? undefined : (result as string),
      });
    } catch (e: any) {
      checks.push({
        spec: `fn/${spec.name}`,
        target: spec.category,
        passed: false,
        message: `error: ${e.message}`,
      });
    }
  }

  const passed = checks.filter(c => c.passed).length;
  const failed = checks.filter(c => !c.passed).length;
  return { checks, passed, failed, total: checks.length };
}

// ─── Full Suite ───────────────────────────────────────────────

export async function runFullSuite(
  propertySpecs: PropertySpec[],
  auditSpecs: AuditRuleEntry[],
  importSpecs?: ImportSpec[],
  animationSpecs?: AnimationSpec[],
  functionalSpecs?: FunctionalSpec[],
  pipelineSpecs?: FunctionalSpec[],
  designSystemSpecs?: FunctionalSpec[],
): Promise<{ properties: SpecSuiteResult; audit: SpecSuiteResult; imports: SpecSuiteResult; animations: SpecSuiteResult; functional: SpecSuiteResult; pipeline: SpecSuiteResult; designSystem: SpecSuiteResult; total: SpecSuiteResult }> {
  const properties = await runPropertySpecs(propertySpecs);
  const auditResult = await runAuditSpecs(auditSpecs);
  const imports = importSpecs ? await runImportSpecs(importSpecs) : { checks: [], passed: 0, failed: 0, total: 0 };
  const animations = animationSpecs ? await runAnimationSpecs(animationSpecs) : { checks: [], passed: 0, failed: 0, total: 0 };
  const functional = functionalSpecs ? await runFunctionalSpecs(functionalSpecs) : { checks: [], passed: 0, failed: 0, total: 0 };
  const pipeline = pipelineSpecs ? await runFunctionalSpecs(pipelineSpecs) : { checks: [], passed: 0, failed: 0, total: 0 };
  const designSystem = designSystemSpecs ? await runFunctionalSpecs(designSystemSpecs) : { checks: [], passed: 0, failed: 0, total: 0 };

  const all = [properties, auditResult, imports, animations, functional, pipeline, designSystem];
  const total: SpecSuiteResult = {
    checks: all.flatMap(s => s.checks),
    passed: all.reduce((s, r) => s + r.passed, 0),
    failed: all.reduce((s, r) => s + r.failed, 0),
    total: all.reduce((s, r) => s + r.total, 0),
  };

  return { properties, audit: auditResult, imports, animations, functional, pipeline, designSystem, total };
}
