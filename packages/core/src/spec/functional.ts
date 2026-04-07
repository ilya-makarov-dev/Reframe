/**
 * INode Conformance Spec — Functional Specifications
 *
 * Tests for APIs that don't fit the scene → export pattern:
 * assert API, serialize/diff, presets, timeline, stagger.
 */

import type { FunctionalSpec } from './types';
import { build, frame, rect, text, solid, linearGradient } from '../builder';
import { assertDesign, formatAssertions } from '../assert';
import { serializeNode, deserializeNode } from '../serialize';
import { diffTrees } from '../diff';
import { presets, stagger, listPresets } from '../animation/presets';
import { validateTimeline, computeDuration } from '../animation/timeline';
import { resolveEasing } from '../animation/easing';
import { exportToReact } from '../exporters/react';
import { exportToHtml } from '../exporters/html';
import { exportToLottie } from '../exporters/lottie';
import { importFromHtml } from '../importers/html';
import { audit, contrastMinimum, colorInPalette, minTouchTarget } from '../audit';
import { StandaloneNode } from '../adapters/standalone/node';
import { ComponentRegistry, normalizeVariantKey } from '../engine/component-registry';
import type { ITimeline } from '../animation/types';

function scene() {
  return build(
    frame({ width: 800, height: 600, name: 'Test', fills: [solid('#0a0a0a')] },
      text('Title', { fontSize: 32, fontWeight: 700, name: 'Title', x: 20, y: 20, width: 400, height: 50, fills: [solid('#ffffff')] }),
      text('Body', { fontSize: 14, name: 'Body', x: 20, y: 80, width: 400, height: 30, fills: [solid('#888888')] }),
      frame({ width: 160, height: 48, name: 'CTA', x: 20, y: 130, fills: [solid('#4a9eff')], cornerRadius: 8 },
        text('Click', { fontSize: 14, name: 'CTA-Text', fills: [solid('#ffffff')] }),
      ),
    ),
  );
}

export const FUNCTIONAL_SPECS: FunctionalSpec[] = [

  // ═══ Assert API ══════════════════════════════════════════════

  {
    name: 'assert/hasMinContrast-pass',
    category: 'assert',
    test: () => {
      const { root } = scene();
      const r = assertDesign(root).hasMinContrast(2.5).run();
      return r.length === 1 && r[0].passed ? true : `expected pass, got ${r[0]?.passed}`;
    },
  },
  {
    name: 'assert/fitsWithin-pass',
    category: 'assert',
    test: () => {
      const { root } = scene();
      const r = assertDesign(root).fitsWithin(800, 600).run();
      return r[0].passed ? true : 'expected pass at exact size';
    },
  },
  {
    name: 'assert/fitsWithin-fail',
    category: 'assert',
    test: () => {
      const { root } = scene();
      const r = assertDesign(root).fitsWithin(100, 100).run();
      return !r[0].passed ? true : 'expected fail when too small';
    },
  },
  {
    name: 'assert/noOverlapping',
    category: 'assert',
    test: () => {
      const { root } = scene();
      const r = assertDesign(root).noOverlapping().run();
      return r.length === 1 ? true : `expected 1 result, got ${r.length}`;
    },
  },
  {
    name: 'assert/noEmptyText-pass',
    category: 'assert',
    test: () => {
      const { root } = scene();
      const r = assertDesign(root).noEmptyText().run();
      return r[0].passed ? true : 'expected pass with real text';
    },
  },
  {
    name: 'assert/chain-multiple',
    category: 'assert',
    test: () => {
      const { root } = scene();
      const r = assertDesign(root)
        .hasMinContrast(2)
        .fitsWithin(800, 600)
        .noOverlapping()
        .hasMinFontSize(8)
        .noEmptyText()
        .noZeroSize()
        .run();
      return r.length === 6 ? true : `expected 6 results, got ${r.length}`;
    },
  },
  {
    name: 'assert/formatAssertions',
    category: 'assert',
    test: () => {
      const { root } = scene();
      const r = assertDesign(root).hasMinContrast(2).run();
      const f = formatAssertions(r);
      return typeof f === 'string' && f.length > 0 ? true : 'formatAssertions returned empty';
    },
  },

  {
    name: 'assert/hasMinFontSize-pass',
    category: 'assert',
    test: () => {
      const { root } = scene();
      const r = assertDesign(root).hasMinFontSize(10).run();
      return r.length === 1 && r[0].passed ? true : `expected pass, got ${r[0]?.passed}`;
    },
  },
  {
    name: 'assert/noZeroSize',
    category: 'assert',
    test: () => {
      const { root } = scene();
      const r = assertDesign(root).noZeroSize().run();
      return r.length === 1 && r[0].passed ? true : `expected pass, got ${r[0]?.passed}`;
    },
  },
  {
    name: 'assert/noTextOverflow',
    category: 'assert',
    test: () => {
      const { root } = scene();
      const r = assertDesign(root).noTextOverflow().run();
      return r.length === 1 ? true : `expected 1 result, got ${r.length}`;
    },
  },
  {
    name: 'assert/hasMinLineHeight',
    category: 'assert',
    test: () => {
      const { root } = scene();
      const r = assertDesign(root).hasMinLineHeight(1.0).run();
      return r.length === 1 ? true : `expected 1 result, got ${r.length}`;
    },
  },

  // ═══ Serialize / Diff ════════════════════════════════════════

  {
    name: 'serialize/roundtrip-preserves-type',
    category: 'serialize',
    test: () => {
      const { root } = scene();
      const json = serializeNode(root);
      return json.type === 'FRAME' && json.name === 'Test' ? true : `type=${json.type}, name=${json.name}`;
    },
  },
  {
    name: 'serialize/roundtrip-preserves-dimensions',
    category: 'serialize',
    test: () => {
      const { root } = scene();
      const json = serializeNode(root);
      const restored = deserializeNode(json);
      return restored.width === 800 && restored.height === 600
        ? true : `width=${restored.width}, height=${restored.height}`;
    },
  },
  {
    name: 'serialize/roundtrip-preserves-name',
    category: 'serialize',
    test: () => {
      const { root } = scene();
      const json = serializeNode(root);
      const restored = deserializeNode(json);
      return restored.name === 'Test' ? true : `name=${restored.name}`;
    },
  },
  {
    name: 'diff/identical-no-changes',
    category: 'diff',
    test: () => {
      const { root: r1 } = scene();
      const { root: r2 } = scene();
      const d = diffTrees(r1, r2);
      const propChanges = d.entries.filter((e: any) => e.changes?.length > 0).length;
      return propChanges === 0 ? true : `${propChanges} property changes in identical scenes`;
    },
  },
  {
    name: 'diff/detects-modification',
    category: 'diff',
    test: () => {
      const { root: r1 } = build(
        frame({ width: 300, height: 200, name: 'Card' },
          text('Hello', { fontSize: 20, fontWeight: 700, name: 'Title', fills: [solid('#fff')] }),
        ),
      );
      const { root: r2, graph: g2 } = build(
        frame({ width: 300, height: 200, name: 'Card' },
          text('Hello', { fontSize: 32, fontWeight: 700, name: 'Title', fills: [solid('#fff')] }),
        ),
      );
      const d = diffTrees(r1, r2);
      const fontChange = d.entries.some((e: any) => e.changes?.some((c: any) => c.property === 'fontSize'));
      return fontChange ? true : 'fontSize change not detected';
    },
  },

  // ═══ Presets ═════════════════════════════════════════════════

  {
    name: 'preset/all-valid-keyframes',
    category: 'preset',
    test: () => {
      const names = listPresets();
      if (names.length < 17) return `only ${names.length} presets (expected ≥17)`;
      for (const name of names) {
        const p = presets[name];
        if (!p) return `preset "${name}" not found`;
        const anim = p.create();
        if (!Array.isArray(anim.keyframes) || anim.keyframes.length < 2)
          return `"${name}" has ${anim.keyframes?.length} keyframes`;
        if (anim.duration <= 0) return `"${name}" has non-positive duration`;
        if (anim.keyframes[0].offset !== 0) return `"${name}" doesn't start at 0`;
        if (anim.keyframes[anim.keyframes.length - 1].offset !== 1) return `"${name}" doesn't end at 1`;
      }
      return true;
    },
  },
  {
    name: 'preset/compound-multi-property',
    category: 'preset',
    test: () => {
      const compounds = ['fadeSlideUp', 'fadeSlideDown', 'fadeSlideLeft', 'fadeSlideRight', 'fadeScaleIn'];
      for (const name of compounds) {
        if (!presets[name]) return `"${name}" not found`;
        const anim = presets[name].create({});
        const props = Object.keys(anim.keyframes[0].properties);
        if (props.length < 2) return `"${name}" only animates ${props.length} property`;
      }
      return true;
    },
  },
  {
    name: 'preset/total-count',
    category: 'preset',
    test: () => {
      const all = listPresets();
      return all.length === 22 ? true : `expected 22 presets, got ${all.length}`;
    },
  },

  // ═══ Stagger ═════════════════════════════════════════════════

  {
    name: 'stagger/delay-monotonic',
    category: 'stagger',
    test: () => {
      const ids = ['n1', 'n2', 'n3'];
      const anims = stagger(ids, 'fadeIn', { staggerDelay: 100 });
      if (anims.length !== 3) return `expected 3, got ${anims.length}`;
      if (anims[1].delay! <= anims[0].delay!) return 'delay not increasing';
      if (anims[2].delay! <= anims[1].delay!) return 'delay not monotonic';
      return true;
    },
  },

  // ═══ Timeline ════════════════════════════════════════════════

  {
    name: 'timeline/validate-valid',
    category: 'timeline',
    test: () => {
      const tl: ITimeline = {
        animations: [{
          nodeName: 'Test',
          keyframes: [{ offset: 0, properties: { opacity: 0 } }, { offset: 1, properties: { opacity: 1 } }],
          duration: 600,
        }],
      };
      const errors = validateTimeline(tl);
      return errors.length === 0 ? true : `validation errors: ${errors.join(', ')}`;
    },
  },
  {
    name: 'timeline/computeDuration-simple',
    category: 'timeline',
    test: () => {
      const tl: ITimeline = {
        animations: [{
          nodeName: 'A', duration: 600,
          keyframes: [{ offset: 0, properties: { opacity: 0 } }, { offset: 1, properties: { opacity: 1 } }],
        }],
      };
      const d = computeDuration(tl);
      return d === 600 ? true : `expected 600, got ${d}`;
    },
  },
  {
    name: 'timeline/computeDuration-with-delay',
    category: 'timeline',
    test: () => {
      const tl: ITimeline = {
        animations: [
          { nodeName: 'A', duration: 400, delay: 200,
            keyframes: [{ offset: 0, properties: { opacity: 0 } }, { offset: 1, properties: { opacity: 1 } }] },
          { nodeName: 'B', duration: 600, delay: 100,
            keyframes: [{ offset: 0, properties: { opacity: 0 } }, { offset: 1, properties: { opacity: 1 } }] },
        ],
      };
      const d = computeDuration(tl);
      return d === 700 ? true : `expected 700, got ${d}`;
    },
  },
  {
    name: 'timeline/computeDuration-iterations',
    category: 'timeline',
    test: () => {
      const tl: ITimeline = {
        animations: [{
          nodeId: 'test', duration: 1000, iterations: 3, direction: 'alternate',
          keyframes: [{ offset: 0, properties: { opacity: 0 } }, { offset: 1, properties: { opacity: 1 } }],
        }],
      };
      const d = computeDuration(tl);
      return d === 3000 ? true : `expected 3000, got ${d}`;
    },
  },
  {
    name: 'timeline/computeDuration-empty',
    category: 'timeline',
    test: () => {
      const d = computeDuration({ animations: [] });
      return d === 0 ? true : `expected 0, got ${d}`;
    },
  },

  // ═══ Spring Easing ═══════════════════════════════════════════

  {
    name: 'timeline/spring-easing-converges',
    category: 'timeline',
    test: () => {
      const stiff = resolveEasing({ type: 'spring', stiffness: 300, damping: 20, mass: 1 });
      const soft = resolveEasing({ type: 'spring', stiffness: 50, damping: 5, mass: 1 });
      if (Math.abs(stiff(0)) > 0.01) return `stiff(0) = ${stiff(0)}`;
      if (stiff(1) < 0.95) return `stiff(1) = ${stiff(1)}`;
      if (Math.abs(soft(0)) > 0.01) return `soft(0) = ${soft(0)}`;
      if (soft(1) < 0.9) return `soft(1) = ${soft(1)}`;
      return true;
    },
  },

  // ═══ React Export Options ════════════════════════════════════

  {
    name: 'react/custom-componentName',
    category: 'assert', // reuse category
    test: () => {
      const { root } = scene();
      const code = exportToReact(root, { componentName: 'MyBanner' });
      return code.includes('MyBanner') ? true : 'componentName not in output';
    },
  },

  // ═══ Audit Precision ════════════════════════════════════════

  {
    name: 'audit/nested-contrast-detection',
    category: 'audit',
    test: () => {
      const { root } = build(
        frame({ width: 400, height: 300, name: 'ContrastTest', fills: [solid('#ffffff')] },
          frame({ width: 300, height: 200, name: 'DarkCard', x: 50, y: 50, fills: [solid('#1a1a1a')] },
            text('Light text on dark', { fontSize: 16, name: 'GoodContrast', fills: [solid('#ffffff')] }),
          ),
          frame({ width: 300, height: 80, name: 'LightCard', x: 50, y: 220, fills: [solid('#f0f0f0')] },
            text('Light text on light', { fontSize: 16, name: 'BadContrast', fills: [solid('#cccccc')] }),
          ),
        ),
      );
      const issues = audit(root, [contrastMinimum(4.5)]);
      const goodIssue = issues.find(i => i.nodeName === 'GoodContrast');
      const badIssue = issues.find(i => i.nodeName === 'BadContrast');
      if (goodIssue) return 'white-on-dark should pass nested contrast';
      if (!badIssue) return 'light-on-light should fail nested contrast';
      return true;
    },
  },
  {
    name: 'audit/colorInPalette-perceptual-deltaE',
    category: 'audit',
    test: () => {
      const { root } = build(
        frame({ width: 200, height: 100, name: 'PaletteTest' },
          rect({ width: 100, height: 100, name: 'ExactMatch', fills: [solid('#ff0000')] }),
          rect({ width: 100, height: 100, name: 'SlightOff', x: 100, fills: [solid('#fe0100')] }),
          rect({ width: 100, height: 100, name: 'WayOff', x: 200, fills: [solid('#00ff00')] }),
        ),
      );
      const ds = { colors: { roles: new Map([['primary', '#ff0000'], ['bg', '#ffffff']]) } };
      const issues = audit(root, [colorInPalette(0.05)], ds);
      const exactIssue = issues.find(i => i.nodeName === 'ExactMatch');
      const slightIssue = issues.find(i => i.nodeName === 'SlightOff');
      const wayOffIssue = issues.find(i => i.nodeName === 'WayOff');
      if (exactIssue) return 'exact palette color should pass';
      if (slightIssue) return 'perceptually similar color should pass ΔE check';
      if (!wayOffIssue) return 'very different color should be flagged';
      return true;
    },
  },
  {
    name: 'audit/minTouchTarget-fix-field',
    category: 'audit',
    test: () => {
      const { root } = build(
        frame({ width: 400, height: 300, name: 'TouchTest' },
          frame({ width: 120, height: 48, name: 'BigButton', fills: [solid('#4a9eff')] },
            text('Click', { fontSize: 14, name: 'BtnText', fills: [solid('#ffffff')] }),
          ),
          frame({ width: 30, height: 20, name: 'TinyButton', x: 200, y: 0, fills: [solid('#ff0000')] },
            text('X', { fontSize: 10, name: 'TinyText', fills: [solid('#ffffff')] }),
          ),
        ),
      );
      const issues = audit(root, [minTouchTarget(44)]);
      const bigIssue = issues.find(i => i.nodeName === 'BigButton');
      const tinyIssue = issues.find(i => i.nodeName === 'TinyButton');
      if (bigIssue) return 'big button should pass touch target';
      if (!tinyIssue) return 'tiny button should fail touch target';
      if (!tinyIssue.fix) return 'touch target issue should have auto-fix';
      return true;
    },
  },

  // ═══ Lottie ═════════════════════════════════════════════════

  {
    name: 'lottie/clip-mask',
    category: 'lottie',
    test: () => {
      const { root, graph } = build(
        frame({ width: 400, height: 300, name: 'ClipTest', clipsContent: true },
          rect({ width: 500, height: 500, name: 'Overflow', fills: [solid('#ff0000')] }),
        ),
      );
      const timeline = { animations: [], loop: false, speed: 1 };
      const lottie = exportToLottie(graph, root.id, timeline);
      const json = JSON.stringify(lottie);
      return json.includes('masksProperties') || json.includes('mask')
        ? true : 'Lottie should have clip mask for clipsContent';
    },
  },
  {
    name: 'lottie/spring-easing-export',
    category: 'lottie',
    test: () => {
      const { root, graph } = build(
        frame({ width: 400, height: 300, name: 'SpringTest' },
          rect({ width: 100, height: 100, name: 'SpringBox', fills: [solid('#ff0000')] }),
        ),
      );
      const childId = graph.getNode(root.id)!.childIds[0];
      const timeline: ITimeline = {
        animations: [{
          nodeId: childId,
          keyframes: [
            { offset: 0, properties: { x: 0 }, easing: { type: 'spring', stiffness: 200, damping: 15, mass: 1 } },
            { offset: 1, properties: { x: 100 } },
          ],
          duration: 1000,
        }],
      };
      const lottie = exportToLottie(graph, root.id, timeline) as any;
      return typeof lottie === 'object' && lottie.layers.length > 0
        ? true : 'Lottie export should succeed with spring easing';
    },
  },

  // ═══ Roundtrip: Gradient Angles ═════════════════════════════

  {
    name: 'roundtrip/gradient-45deg-export',
    category: 'roundtrip',
    test: async () => {
      const html = `<div style="width:400px;height:300px;background:linear-gradient(45deg, #ff0000, #0000ff)"></div>`;
      const { graph, rootId } = await importFromHtml(html);
      const exported = exportToHtml(graph, rootId);
      return exported.includes('45deg') || exported.includes('45.')
        ? true : 'exported HTML should preserve 45deg angle';
    },
  },
  {
    name: 'roundtrip/gradient-to-right-export',
    category: 'roundtrip',
    test: async () => {
      const html = `<div style="width:400px;height:300px;background:linear-gradient(to right, #ff0000, #00ff00)"></div>`;
      const { graph, rootId } = await importFromHtml(html);
      const exported = exportToHtml(graph, rootId);
      return exported.includes('90deg') || exported.includes('90.')
        ? true : '"to right" should export as 90deg';
    },
  },
  {
    name: 'roundtrip/gradient-to-top-left-export',
    category: 'roundtrip',
    test: async () => {
      const html = `<div style="width:400px;height:300px;background:linear-gradient(to top left, #ff0000, #00ff00)"></div>`;
      const { graph, rootId } = await importFromHtml(html);
      const exported = exportToHtml(graph, rootId);
      return exported.includes('315deg') || exported.includes('315.')
        ? true : '"to top left" should export as 315deg';
    },
  },

  // ═══ Roundtrip: Flex-wrap ═══════════════════════════════════

  {
    name: 'roundtrip/flex-wrap-export',
    category: 'roundtrip',
    test: async () => {
      const html = `<div style="width:600px;height:400px;display:flex;flex-wrap:wrap;gap:10px">
        <div style="width:200px;height:100px;background:#ff0000"></div>
        <div style="width:200px;height:100px;background:#00ff00"></div>
      </div>`;
      const { graph, rootId } = await importFromHtml(html);
      const exported = exportToHtml(graph, rootId);
      return exported.includes('flex-wrap: wrap')
        ? true : 'flex-wrap should survive export';
    },
  },

  // ═══ Roundtrip: 3-phase gradient ═══════════════════════════

  {
    name: 'roundtrip/gradient-3stop-full-cycle',
    category: 'roundtrip',
    test: async () => {
      const html = `<div style="width:400px;height:300px;background:linear-gradient(135deg, #ff0000 0%, #00ff00 50%, #0000ff 100%)"></div>`;
      // Phase 1: import
      const { graph, rootId } = await importFromHtml(html);
      const root = new StandaloneNode(graph, graph.getNode(rootId)!);
      const fills = root.fills as any[];
      if (fills[0]?.type !== 'GRADIENT_LINEAR') return 'phase 1: not a linear gradient';
      if (fills[0]?.gradientStops?.length !== 3) return 'phase 1: expected 3 stops';
      // Phase 2: export
      const exported = exportToHtml(graph, rootId);
      if (!exported.includes('linear-gradient')) return 'phase 2: no linear-gradient in export';
      if (!exported.includes('135deg') && !exported.includes('135.')) return 'phase 2: 135deg not in export';
      // Phase 3: re-import
      const { graph: g2, rootId: r2 } = await importFromHtml(exported);
      const root2 = new StandaloneNode(g2, g2.getNode(r2)!);
      const f2 = root2.fills as any[];
      const fills2 = f2.length > 0 ? f2 : ((root2.children as any)?.[0]?.fills ?? []);
      const gradFill = fills2.find((f: any) => f.type === 'GRADIENT_LINEAR');
      if (!gradFill) return 'phase 3: gradient lost in re-import';
      if (!gradFill.gradientTransform) return 'phase 3: transform lost in re-import';
      if (gradFill.gradientStops?.length !== 3) return 'phase 3: stops lost in re-import';
      return true;
    },
  },

  // ═══ Timeline: iterations + delay ═══════════════════════════

  {
    name: 'timeline/computeDuration-iterations-with-delay',
    category: 'timeline',
    test: () => {
      const tl: ITimeline = {
        animations: [{
          nodeId: 'test', duration: 500, iterations: 4, delay: 200,
          keyframes: [{ offset: 0, properties: { opacity: 0 } }, { offset: 1, properties: { opacity: 1 } }],
        }],
      };
      const d = computeDuration(tl);
      return d === 2200 ? true : `expected 2200, got ${d}`;
    },
  },

  // ═══ Component System ═══════════════════════════════════════

  {
    name: 'component/define-from-frame',
    category: 'component',
    test: () => {
      const { root, graph } = build(
        frame({ width: 200, height: 48, name: 'Button', fills: [solid('#4a9eff')] },
          text('Click', { fontSize: 14, name: 'Label', fills: [solid('#ffffff')] }),
        ),
      );
      const registry = new ComponentRegistry(graph);
      const compId = registry.defineComponent(root.id, 'Button');
      const node = graph.getNode(compId)!;
      return node.type === 'COMPONENT' && node.name === 'Button'
        ? true : `type=${node.type}, name=${node.name}`;
    },
  },
  {
    name: 'component/define-idempotent',
    category: 'component',
    test: () => {
      const { root, graph } = build(
        frame({ width: 200, height: 48, name: 'Button', fills: [solid('#4a9eff')] }),
      );
      const registry = new ComponentRegistry(graph);
      const id1 = registry.defineComponent(root.id);
      const id2 = registry.defineComponent(root.id);
      return id1 === id2 ? true : 'second define should return same id';
    },
  },
  {
    name: 'component/create-instance',
    category: 'component',
    test: () => {
      const { root, graph } = build(
        frame({ width: 200, height: 48, name: 'Button', fills: [solid('#4a9eff')] },
          text('Click', { fontSize: 14, name: 'Label', fills: [solid('#ffffff')] }),
        ),
      );
      const registry = new ComponentRegistry(graph);
      const parentId = graph.getNode(root.id)!.parentId!;
      const compId = registry.defineComponent(root.id, 'Button');
      const instId = registry.createInstance(compId, parentId, { x: 300, y: 0 });
      const inst = graph.getNode(instId)!;
      if (inst.type !== 'INSTANCE') return `type=${inst.type}`;
      if (inst.componentId !== compId) return `componentId=${inst.componentId}`;
      if (inst.childIds.length === 0) return 'instance has no children';
      return true;
    },
  },
  {
    name: 'component/instance-override-applied',
    category: 'component',
    test: () => {
      const { root, graph } = build(
        frame({ width: 200, height: 48, name: 'Button', fills: [solid('#4a9eff')] },
          text('Click', { fontSize: 14, name: 'Label', fills: [solid('#ffffff')] }),
        ),
      );
      const registry = new ComponentRegistry(graph);
      const parentId = graph.getNode(root.id)!.parentId!;
      const compId = registry.defineComponent(root.id, 'Button');
      const instId = registry.createInstance(compId, parentId, {
        overrides: { 'Label': { text: 'Sign Up' } },
      });
      const inst = graph.getNode(instId)!;
      const label = graph.getNode(inst.childIds[0])!;
      return label.text === 'Sign Up' ? true : `text="${label.text}"`;
    },
  },
  {
    name: 'component/set-overrides-merge',
    category: 'component',
    test: () => {
      const { root, graph } = build(
        frame({ width: 200, height: 48, name: 'Button', fills: [solid('#4a9eff')] },
          text('Click', { fontSize: 14, name: 'Label', fills: [solid('#ffffff')] }),
        ),
      );
      const registry = new ComponentRegistry(graph);
      const parentId = graph.getNode(root.id)!.parentId!;
      const compId = registry.defineComponent(root.id, 'Button');
      const instId = registry.createInstance(compId, parentId);
      registry.setOverrides(instId, { 'Label': { text: 'Go' } });
      registry.setOverrides(instId, { 'Label': { fontSize: 20 } });
      const inst = graph.getNode(instId)!;
      const label = graph.getNode(inst.childIds[0])!;
      if (label.text !== 'Go') return `text="${label.text}" (should be Go)`;
      if (label.fontSize !== 20) return `fontSize=${label.fontSize}`;
      return true;
    },
  },
  {
    name: 'component/define-set-with-variants',
    category: 'component',
    test: () => {
      const { root, graph } = build(
        frame({ width: 800, height: 600, name: 'Root' },
          frame({ width: 100, height: 32, name: 'Button/sm', fills: [solid('#4a9eff')] }),
          frame({ width: 160, height: 48, name: 'Button/md', fills: [solid('#4a9eff')] }),
          frame({ width: 220, height: 56, name: 'Button/lg', fills: [solid('#4a9eff')] }),
        ),
      );
      const registry = new ComponentRegistry(graph);
      const rootNode = graph.getNode(root.id)!;
      const [smId, mdId, lgId] = rootNode.childIds;

      registry.defineComponent(smId, 'Button/sm');
      registry.defineComponent(mdId, 'Button/md');
      registry.defineComponent(lgId, 'Button/lg');
      graph.updateNode(smId, { variantProperties: { size: 'sm' } });
      graph.updateNode(mdId, { variantProperties: { size: 'md' } });
      graph.updateNode(lgId, { variantProperties: { size: 'lg' } });

      const setId = registry.defineComponentSet('Button', [smId, mdId, lgId], [
        { name: 'size', type: 'VARIANT', defaultValue: 'md', variantOptions: ['sm', 'md', 'lg'] },
      ]);
      const set = graph.getNode(setId)!;
      if (set.type !== 'COMPONENT_SET') return `type=${set.type}`;
      if (set.childIds.length !== 3) return `children=${set.childIds.length}`;
      return true;
    },
  },
  {
    name: 'component/variant-resolution-exact',
    category: 'component',
    test: () => {
      const { root, graph } = build(
        frame({ width: 800, height: 600, name: 'Root' },
          frame({ width: 100, height: 32, name: 'Button/sm', fills: [solid('#4a9eff')] }),
          frame({ width: 160, height: 48, name: 'Button/md', fills: [solid('#4a9eff')] }),
        ),
      );
      const registry = new ComponentRegistry(graph);
      const rootNode = graph.getNode(root.id)!;
      const [smId, mdId] = rootNode.childIds;

      registry.defineComponent(smId, 'Button/sm');
      registry.defineComponent(mdId, 'Button/md');
      graph.updateNode(smId, { variantProperties: { size: 'sm' }, isDefaultVariant: true });
      graph.updateNode(mdId, { variantProperties: { size: 'md' } });

      const setId = registry.defineComponentSet('Button', [smId, mdId], [
        { name: 'size', type: 'VARIANT', defaultValue: 'sm', variantOptions: ['sm', 'md'] },
      ]);

      const resolved = registry.resolveVariantId(setId, { size: 'md' });
      return resolved === mdId ? true : `resolved to ${resolved}, expected ${mdId}`;
    },
  },
  {
    name: 'component/variant-resolution-fallback-default',
    category: 'component',
    test: () => {
      const { root, graph } = build(
        frame({ width: 800, height: 600, name: 'Root' },
          frame({ width: 100, height: 32, name: 'Button/sm', fills: [solid('#4a9eff')] }),
          frame({ width: 160, height: 48, name: 'Button/md', fills: [solid('#4a9eff')] }),
        ),
      );
      const registry = new ComponentRegistry(graph);
      const rootNode = graph.getNode(root.id)!;
      const [smId, mdId] = rootNode.childIds;

      registry.defineComponent(smId, 'Button/sm');
      registry.defineComponent(mdId, 'Button/md');
      graph.updateNode(smId, { variantProperties: { size: 'sm' }, isDefaultVariant: true });
      graph.updateNode(mdId, { variantProperties: { size: 'md' } });

      const setId = registry.defineComponentSet('Button', [smId, mdId], [
        { name: 'size', type: 'VARIANT', defaultValue: 'sm', variantOptions: ['sm', 'md'] },
      ]);

      // Request non-existent variant -> should fall back to default
      const resolved = registry.resolveVariantId(setId, { size: 'xl' });
      return resolved === smId ? true : `resolved to ${resolved}, expected default ${smId}`;
    },
  },
  {
    name: 'component/swap-variant',
    category: 'component',
    test: () => {
      const { root, graph } = build(
        frame({ width: 800, height: 600, name: 'Root' },
          frame({ width: 100, height: 32, name: 'Button/sm', fills: [solid('#4a9eff')] },
            text('Small', { fontSize: 12, name: 'Label', fills: [solid('#fff')] }),
          ),
          frame({ width: 200, height: 56, name: 'Button/lg', fills: [solid('#4a9eff')] },
            text('Large', { fontSize: 18, name: 'Label', fills: [solid('#fff')] }),
          ),
        ),
      );
      const registry = new ComponentRegistry(graph);
      const rootNode = graph.getNode(root.id)!;
      const parentId = rootNode.parentId!;
      const [smId, lgId] = rootNode.childIds;

      registry.defineComponent(smId, 'Button/sm');
      registry.defineComponent(lgId, 'Button/lg');
      graph.updateNode(smId, { variantProperties: { size: 'sm' }, isDefaultVariant: true });
      graph.updateNode(lgId, { variantProperties: { size: 'lg' } });

      const setId = registry.defineComponentSet('Button', [smId, lgId], [
        { name: 'size', type: 'VARIANT', defaultValue: 'sm', variantOptions: ['sm', 'lg'] },
      ]);

      // Create instance of sm variant
      const instId = registry.createInstance(setId, parentId, {
        variant: { size: 'sm' },
      });

      // Swap to lg
      registry.swapVariant(instId, { size: 'lg' });
      const inst = graph.getNode(instId)!;
      if (inst.componentId !== lgId) return `componentId=${inst.componentId}, expected ${lgId}`;
      if (inst.variantProperties.size !== 'lg') return `variant size=${inst.variantProperties.size}`;
      return true;
    },
  },
  {
    name: 'component/propagate-master-changes',
    category: 'component',
    test: () => {
      const { root, graph } = build(
        frame({ width: 200, height: 48, name: 'Button', fills: [solid('#4a9eff')] },
          text('Click', { fontSize: 14, name: 'Label', fills: [solid('#ffffff')] }),
        ),
      );
      const registry = new ComponentRegistry(graph);
      const parentId = graph.getNode(root.id)!.parentId!;
      const compId = registry.defineComponent(root.id, 'Button');

      // Create 2 instances
      const inst1 = registry.createInstance(compId, parentId);
      const inst2 = registry.createInstance(compId, parentId);

      // Modify master: add a child
      graph.createNode('TEXT', compId, { name: 'Subtitle', text: 'New', fontSize: 10, width: 100, height: 20 });

      // Propagate
      const count = registry.propagateChanges(compId);
      if (count !== 2) return `propagated to ${count}, expected 2`;

      // Both instances should now have 2 children
      const i1 = graph.getNode(inst1)!;
      const i2 = graph.getNode(inst2)!;
      if (i1.childIds.length !== 2) return `inst1 children=${i1.childIds.length}`;
      if (i2.childIds.length !== 2) return `inst2 children=${i2.childIds.length}`;
      return true;
    },
  },
  {
    name: 'component/propagate-preserves-overrides',
    category: 'component',
    test: () => {
      const { root, graph } = build(
        frame({ width: 200, height: 48, name: 'Button', fills: [solid('#4a9eff')] },
          text('Click', { fontSize: 14, name: 'Label', fills: [solid('#ffffff')] }),
        ),
      );
      const registry = new ComponentRegistry(graph);
      const parentId = graph.getNode(root.id)!.parentId!;
      const compId = registry.defineComponent(root.id, 'Button');

      // Create instance with override
      const instId = registry.createInstance(compId, parentId, {
        overrides: { 'Label': { text: 'Custom' } },
      });

      // Modify master width
      graph.updateNode(compId, { width: 300 });

      // Propagate
      registry.propagateChanges(compId);

      // Override should survive
      const inst = graph.getNode(instId)!;
      const label = graph.getNode(inst.childIds[0])!;
      if (label.text !== 'Custom') return `text="${label.text}", expected "Custom"`;
      if (inst.width !== 300) return `width=${inst.width}, expected 300`;
      return true;
    },
  },
  {
    name: 'component/detach-instance',
    category: 'component',
    test: () => {
      const { root, graph } = build(
        frame({ width: 200, height: 48, name: 'Button', fills: [solid('#4a9eff')] },
          text('Click', { fontSize: 14, name: 'Label', fills: [solid('#ffffff')] }),
        ),
      );
      const registry = new ComponentRegistry(graph);
      const parentId = graph.getNode(root.id)!.parentId!;
      const compId = registry.defineComponent(root.id, 'Button');
      const instId = registry.createInstance(compId, parentId);

      registry.detachInstance(instId);
      const node = graph.getNode(instId)!;
      return node.type === 'FRAME' ? true : `type=${node.type} after detach`;
    },
  },
  {
    name: 'component/list-components',
    category: 'component',
    test: () => {
      const { root, graph } = build(
        frame({ width: 800, height: 600, name: 'Root' },
          frame({ width: 200, height: 48, name: 'Button', fills: [solid('#4a9eff')] }),
          frame({ width: 300, height: 200, name: 'Card', fills: [solid('#ffffff')] }),
        ),
      );
      const registry = new ComponentRegistry(graph);
      const rootNode = graph.getNode(root.id)!;

      registry.defineComponent(rootNode.childIds[0], 'Button');
      registry.defineComponent(rootNode.childIds[1], 'Card');

      const components = registry.listComponents();
      if (components.length !== 2) return `found ${components.length}, expected 2`;
      const names = components.map(c => c.name).sort();
      return names[0] === 'Button' && names[1] === 'Card'
        ? true : `names: ${names.join(', ')}`;
    },
  },
  {
    name: 'component/resolve-instance',
    category: 'component',
    test: () => {
      const { root, graph } = build(
        frame({ width: 200, height: 48, name: 'Button', fills: [solid('#4a9eff')] },
          text('Click', { fontSize: 14, name: 'Label', fills: [solid('#ffffff')] }),
        ),
      );
      const registry = new ComponentRegistry(graph);
      const parentId = graph.getNode(root.id)!.parentId!;
      const compId = registry.defineComponent(root.id, 'Button');
      const instId = registry.createInstance(compId, parentId, {
        overrides: { 'Label': { text: 'Go' } },
      });

      const resolved = registry.resolveInstance(instId);
      if (resolved.componentId !== compId) return `componentId=${resolved.componentId}`;
      if (!resolved.overriddenPaths.includes('Label')) return `paths=${resolved.overriddenPaths}`;
      if (resolved.childCount === 0) return 'childCount is 0';
      return true;
    },
  },
  {
    name: 'component/normalizeVariantKey',
    category: 'component',
    test: () => {
      const key1 = normalizeVariantKey({ size: 'lg', state: 'hover' });
      const key2 = normalizeVariantKey({ state: 'hover', size: 'lg' });
      return key1 === key2 ? true : `keys differ: "${key1}" vs "${key2}"`;
    },
  },
  {
    name: 'component/nested-path-override',
    category: 'component',
    test: () => {
      const { root, graph } = build(
        frame({ width: 300, height: 60, name: 'Card', fills: [solid('#fff')] },
          frame({ width: 280, height: 40, name: 'Container' },
            text('Title', { fontSize: 16, name: 'Title', fills: [solid('#000')] }),
          ),
        ),
      );
      const registry = new ComponentRegistry(graph);
      const parentId = graph.getNode(root.id)!.parentId!;
      const compId = registry.defineComponent(root.id, 'Card');
      const instId = registry.createInstance(compId, parentId, {
        overrides: { 'Container/Title': { text: 'Overridden' } },
      });

      // Find the nested title in the instance
      const inst = graph.getNode(instId)!;
      const container = graph.getNode(inst.childIds[0])!;
      const title = graph.getNode(container.childIds[0])!;
      return title.text === 'Overridden' ? true : `text="${title.text}"`;
    },
  },
];
