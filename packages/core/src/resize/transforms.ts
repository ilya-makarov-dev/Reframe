/**
 * Reframe — Built-in Transforms
 *
 * Pre-built transforms that wrap existing engine capabilities
 * into the composable pipe system.
 *
 *   import { pipe } from './pipe';
 *   import { classify, applyDesignRules, scaleTo, dedupeNames, analyze } from './transforms';
 *
 *   const pipeline = pipe(
 *     analyze(),
 *     classify(),
 *     applyDesignRules(myDesignSystem),
 *     scaleTo(1080, 1080),
 *     dedupeNames(),
 *   );
 */

import type { INode } from '../host/types';
import { NodeType } from '../host/types';
import type { Transform, PipeContext } from './pipe';
import { transform } from './pipe';

// ─── Analysis ──────────────────────────────────────────────────

/**
 * Analyze frame structure — detect text/image/vector/nested frame presence.
 * Stores result as ctx.state('analysis').
 */
export function analyze(): Transform {
  return transform('analyze', (root, ctx) => {
    // Lazy import to avoid circular deps
    const { analyzeFrame } = require('./pipelines/analyzer');
    const analysis = analyzeFrame(root);
    ctx.state.set('analysis', analysis);
  });
}

// ─── Semantic Classification ───────────────────────────────────

/**
 * Classify direct children of root by semantic role (title, button, logo, background...).
 * Stores result as ctx.state('semanticTypes'): Map<string, BannerElementType>.
 *
 * @param designSystem - Optional design system for smarter classification.
 */
export function classify(designSystem?: unknown): Transform {
  return transform('classify', (root, ctx) => {
    const { assignSemanticTypes } = require('./postprocess/semantic-classifier');
    const ds = designSystem ?? ctx.designSystem;
    const children = root.children ?? [];
    const types = assignSemanticTypes([...children], root, ds);
    ctx.state.set('semanticTypes', types);
  });
}

// ─── Scaling ───────────────────────────────────────────────────

/**
 * Scale the tree to target dimensions.
 * Uses the engine's scaleElement with uniform scaling.
 */
export function scaleTo(
  targetWidth: number,
  targetHeight: number,
): Transform {
  return transform(`scaleTo(${targetWidth}x${targetHeight})`, async (root, ctx) => {
    const { scaleElement, calculateScale } = require('./scaling/scaler');
    const scale = calculateScale(root.width, root.height, targetWidth, targetHeight);
    if (Math.abs(scale - 1) > 0.001) {
      await scaleElement(root, scale);
    }
    root.resize(targetWidth, targetHeight);
    ctx.rootWidth = targetWidth;
    ctx.rootHeight = targetHeight;
  });
}

/**
 * Scale the tree by a uniform factor.
 */
export function scaleBy(factor: number): Transform {
  return transform(`scaleBy(${factor})`, async (root) => {
    const { scaleElement } = require('./scaling/scaler');
    await scaleElement(root, factor);
  });
}

/**
 * Freeze constraints on all descendants (set to MIN/MIN).
 * Useful before manual positioning.
 */
export function freezeConstraints(): Transform {
  return transform('freezeConstraints', (root) => {
    const { freezeConstraintsSubtree } = require('./scaling/scaler');
    freezeConstraintsSubtree(root);
  });
}

// ─── Design System ─────────────────────────────────────────────

/**
 * Load and attach a design system to the pipeline context.
 * Subsequent transforms can access it via ctx.designSystem.
 */
export function withDesignSystem(ds: unknown): Transform {
  return transform('withDesignSystem', (_root, ctx) => {
    ctx.designSystem = ds;
    ctx.state.set('designSystem', ds);
  });
}

/**
 * Parse a DESIGN.md string and attach the resulting design system to context.
 */
export function parseDesignRules(designMd: string): Transform {
  return transform('parseDesignRules', (_root, ctx) => {
    const { parseDesignMd } = require('./design-system');
    const ds = parseDesignMd(designMd);
    ctx.designSystem = ds;
    ctx.state.set('designSystem', ds);
  });
}

/**
 * Extract design system from the root frame itself (infer rules from content).
 */
export function extractDesignRules(): Transform {
  return transform('extractDesignRules', (root, ctx) => {
    const { extractDesignSystemFromFrame } = require('./design-system');
    const ds = extractDesignSystemFromFrame(root);
    ctx.designSystem = ds;
    ctx.state.set('designSystem', ds);
  });
}

// ─── Template Binding ──────────────────────────────────────────

/**
 * Apply template data to the tree.
 * Replaces {{variable}} placeholders and bound variables with provided data.
 */
export function applyTemplateData(
  data: Record<string, string | number | boolean | null | undefined>,
): Transform {
  return transform('applyTemplate', (root, ctx) => {
    const { applyTemplate } = require('./engine/template');
    // applyTemplate needs a SceneGraph — get it from context if available
    const graph = ctx.state.get('graph');
    if (!graph) {
      throw new Error('applyTemplateData requires a SceneGraph in ctx.state("graph"). Use build() or set it manually.');
    }
    const result = applyTemplate(graph as any, root.id, data);
    ctx.state.set('templateResult', result);
  });
}

// ─── Name Deduplication ────────────────────────────────────────

/**
 * Ensure direct children of root have unique names.
 * Appends (1), (2) etc. to duplicates.
 */
export function dedupeNames(): Transform {
  return transform('dedupeNames', (root) => {
    const { ensureUniqueDirectChildNames } = require('./postprocess/dedupe-root-child-names');
    ensureUniqueDirectChildNames(root);
  });
}

// ─── Tree Walking Transforms ──────────────────────────────────

/**
 * Set a property on all nodes matching a predicate.
 *
 *   setProp(n => n.type === NodeType.Text, { visible: false })
 */
export function setProp(
  filter: (node: INode) => boolean,
  props: Partial<Pick<INode, 'visible' | 'opacity' | 'x' | 'y' | 'name'>>,
): Transform {
  return transform('setProp', (root) => {
    const walk = (node: INode) => {
      if (filter(node)) {
        if (props.visible !== undefined) node.visible = props.visible;
        if (props.opacity !== undefined) node.opacity = props.opacity;
        if (props.x !== undefined) node.x = props.x;
        if (props.y !== undefined) node.y = props.y;
        if (props.name !== undefined) node.name = props.name;
      }
      if (node.children) {
        for (const child of node.children) walk(child);
      }
    };
    walk(root);
  });
}

/**
 * Remove all nodes matching a predicate.
 */
export function removeWhere(predicate: (node: INode) => boolean): Transform {
  return transform('removeWhere', (root) => {
    const toRemove: INode[] = [];
    const walk = (node: INode) => {
      if (node.children) {
        for (const child of node.children) {
          if (predicate(child)) {
            toRemove.push(child);
          } else {
            walk(child);
          }
        }
      }
    };
    walk(root);
    for (const node of toRemove) {
      node.remove?.();
    }
  });
}

// ─── Snapshot / Debug ──────────────────────────────────────────

/**
 * Capture a snapshot of the tree structure for debugging.
 * Stores in ctx.state('snapshot:<name>').
 */
export function snapshot(name: string): Transform {
  return transform(`snapshot:${name}`, (root, ctx) => {
    const snap = captureSnapshot(root);
    ctx.state.set(`snapshot:${name}`, snap);
  });
}

interface NodeSnapshot {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  children?: NodeSnapshot[];
}

function captureSnapshot(node: INode): NodeSnapshot {
  const snap: NodeSnapshot = {
    id: node.id,
    name: node.name,
    type: node.type,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
  };
  if (node.children && node.children.length > 0) {
    snap.children = node.children.map(c => captureSnapshot(c));
  }
  return snap;
}
