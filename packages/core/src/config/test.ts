/**
 * Test engine — runs design assertions on all compiled scenes.
 *
 * config → for each scene × size → compile → assert → report
 */

import type { ReframeConfig, TestOutput, TestResult, AssertionResult, AssertionSpec, LayoutStyle } from './types.js';
import { resolveDesignMd, resolveSceneSizes } from './loader.js';
import { compileTemplate, autoPickLayout } from '../compiler/index.js';
import { build } from '../builder.js';
import { ensureSceneLayout } from '../engine/layout.js';
import { parseDesignMd } from '../design-system/index.js';
import { StandaloneNode } from '../adapters/standalone/node.js';
import { StandaloneHost } from '../adapters/standalone/adapter.js';
import { setHost } from '../host/context.js';
import { assertDesign } from '../assert.js';
import {
  audit, contrastMinimum, ctaVisibility,
  type AuditRule,
} from '../audit.js';

export interface TestLogger {
  scene(name: string): void;
  assertion(scene: string, size: string, type: string, passed: boolean, message: string): void;
  done(output: TestOutput): void;
}

export async function testAll(
  config: ReframeConfig,
  configDir: string,
  logger?: TestLogger,
): Promise<TestOutput> {
  const t0 = Date.now();
  const results: TestResult[] = [];

  const designMdContent = resolveDesignMd(config, configDir);
  const ds = parseDesignMd(designMdContent);

  for (const [sceneName, sceneSpec] of Object.entries(config.scenes)) {
    logger?.scene(sceneName);
    const sizes = resolveSceneSizes(sceneSpec, config.sizes);
    const assertions = sceneSpec.assert ?? config.assert ?? [];

    if (assertions.length === 0) continue;

    for (const size of sizes) {
      // Compile scene
      const layoutInput = (size.layout ?? sceneSpec.layout ?? 'auto') as LayoutStyle;
      const resolvedLayout = layoutInput === 'auto'
        ? autoPickLayout(size.width, size.height, sceneSpec.content)
        : layoutInput;

      const blueprint = compileTemplate({
        designSystem: ds,
        width: size.width,
        height: size.height,
        layout: resolvedLayout,
        content: sceneSpec.content,
      });
      const { graph, root } = build(blueprint);
      setHost(new StandaloneHost(graph));
      ensureSceneLayout(graph, root.id);

      // Run assertions
      const wrappedRoot = new StandaloneNode(graph, graph.getNode(root.id)!);
      const assertionResults: AssertionResult[] = [];

      for (const spec of assertions) {
        const result = runAssertion(wrappedRoot, spec, graph, root.id, ds);
        assertionResults.push(result);
        logger?.assertion(sceneName, size.name, spec.type, result.passed, result.message);
      }

      results.push({
        scene: sceneName,
        size: size.name,
        width: size.width,
        height: size.height,
        assertions: assertionResults,
        passed: assertionResults.every(a => a.passed),
      });
    }
  }

  const output: TestOutput = {
    results,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    totalMs: Date.now() - t0,
  };

  logger?.done(output);
  return output;
}

function runAssertion(
  root: any,
  spec: AssertionSpec,
  graph: any,
  rootId: string,
  ds: any,
): AssertionResult {
  try {
    const builder = assertDesign(root);

    switch (spec.type) {
      case 'minContrast': {
        builder.hasMinContrast(spec.value ?? 4.5);
        const results = builder.run();
        const r = results[0];
        return { type: spec.type, passed: r.passed, message: r.message, expected: spec.value ?? 4.5 };
      }
      case 'minFontSize': {
        builder.hasMinFontSize(spec.value ?? 10);
        const results = builder.run();
        const r = results[0];
        return { type: spec.type, passed: r.passed, message: r.message, expected: spec.value ?? 10 };
      }
      case 'noTextOverflow': {
        builder.noTextOverflow();
        const results = builder.run();
        const r = results[0];
        return { type: spec.type, passed: r.passed, message: r.message };
      }
      case 'noEmptyText': {
        builder.noEmptyText();
        const results = builder.run();
        const r = results[0];
        return { type: spec.type, passed: r.passed, message: r.message };
      }
      case 'noZeroSize': {
        builder.noZeroSize();
        const results = builder.run();
        const r = results[0];
        return { type: spec.type, passed: r.passed, message: r.message };
      }
      case 'noOverlapping': {
        builder.noOverlapping();
        const results = builder.run();
        const r = results[0];
        return { type: spec.type, passed: r.passed, message: r.message };
      }
      case 'fitsWithin': {
        const [w, h] = Array.isArray(spec.value) ? spec.value : [spec.value, spec.value];
        builder.fitsWithin(w, h);
        const results = builder.run();
        const r = results[0];
        return { type: spec.type, passed: r.passed, message: r.message };
      }
      case 'minLineHeight': {
        builder.hasMinLineHeight(spec.value ?? 1.2);
        const results = builder.run();
        const r = results[0];
        return { type: spec.type, passed: r.passed, message: r.message, expected: spec.value ?? 1.2 };
      }
      case 'ctaVisible': {
        // Use audit rule for CTA visibility
        setHost(graph.__host ?? new (require('../adapters/standalone/adapter.js').StandaloneHost)(graph));
        const rules: AuditRule[] = [ctaVisibility()];
        const issues = audit(root, rules);
        const passed = issues.filter(i => i.severity === 'error').length === 0;
        return {
          type: spec.type,
          passed,
          message: passed ? 'CTA is visible and prominent' : issues.map(i => i.message).join('; '),
        };
      }
      default:
        return { type: spec.type, passed: false, message: `Unknown assertion type: ${spec.type}` };
    }
  } catch (err: any) {
    return { type: spec.type, passed: false, message: `Error: ${err.message}` };
  }
}
