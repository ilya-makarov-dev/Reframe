/**
 * Template Engine — Scene + Data Binding
 *
 * Takes a scene graph with template variables ({{variable}}) in text,
 * fill colors, image URLs, and visibility — and merges them with data
 * to produce a populated scene.
 *
 * Template syntax:
 *   - Text: "Hello {{name}}, welcome to {{company}}"
 *   - Node name suffixes: elements named "headline__text" or with __visible, __color
 *   - Explicit bindings via boundVariables on SceneNode
 *
 * Usage:
 *   const populated = applyTemplate(graph, rootId, {
 *     headline: "Summer Sale",
 *     subtitle: "50% off everything",
 *     cta_text: "Shop Now",
 *     bg_color: "#ff6b35",
 *     hero_image: "https://example.com/hero.jpg",
 *     show_badge: true,
 *   });
 */

import type { SceneGraph } from './scene-graph';
import type { SceneNode, Color } from './types';

export interface TemplateData {
  [key: string]: string | number | boolean | Color | null | undefined;
}

export interface TemplateResult {
  /** Number of bindings resolved */
  boundCount: number;
  /** Variables that were referenced but not provided */
  missingVars: string[];
  /** Variables that were provided but not referenced */
  unusedVars: string[];
}

/**
 * Apply template data to a scene graph in place.
 * Mutates the graph — clone first if you need the original.
 */
export function applyTemplate(
  graph: SceneGraph,
  rootId: string,
  data: TemplateData,
): TemplateResult {
  const usedVars = new Set<string>();
  const missingVars = new Set<string>();
  let boundCount = 0;

  function processNode(nodeId: string): void {
    const node = graph.getNode(nodeId);
    if (!node) return;

    const updates: Partial<SceneNode> = {};

    // 1. Template variables in text: {{variable}}
    if (node.type === 'TEXT' && node.text) {
      const replaced = resolveTemplateString(node.text, data, usedVars, missingVars);
      if (replaced !== node.text) {
        updates.text = replaced;
        boundCount++;
      }
    }

    // 2. Bound variables (explicit bindings via SceneNode.boundVariables)
    if (node.boundVariables && Object.keys(node.boundVariables).length > 0) {
      for (const [prop, varName] of Object.entries(node.boundVariables)) {
        if (varName in data) {
          usedVars.add(varName);
          const value = data[varName];
          applyBinding(updates, prop, value);
          boundCount++;
        } else {
          missingVars.add(varName);
        }
      }
    }

    // 3. Name-based convention: "elementName__property"
    const nameBindings = parseNameBindings(node.name);
    for (const [prop, varName] of nameBindings) {
      if (varName in data) {
        usedVars.add(varName);
        const value = data[varName];
        applyBinding(updates, prop, value);
        boundCount++;
      }
    }

    // 4. Template variables in node name itself (for dynamic naming)
    if (node.name.includes('{{')) {
      const newName = resolveTemplateString(node.name, data, usedVars, missingVars);
      if (newName !== node.name) {
        updates.name = newName;
      }
    }

    // Apply accumulated updates
    if (Object.keys(updates).length > 0) {
      graph.updateNode(nodeId, updates);
    }

    // Recurse into children
    for (const childId of node.childIds) {
      processNode(childId);
    }
  }

  processNode(rootId);

  const dataKeys = new Set(Object.keys(data));
  const unusedVars = [...dataKeys].filter(k => !usedVars.has(k));

  return {
    boundCount,
    missingVars: [...missingVars],
    unusedVars,
  };
}

/**
 * Extract all template variables from a scene (for documentation/validation).
 */
export function extractTemplateVars(
  graph: SceneGraph,
  rootId: string,
): string[] {
  const vars = new Set<string>();

  function walk(nodeId: string): void {
    const node = graph.getNode(nodeId);
    if (!node) return;

    // Text templates
    if (node.text) {
      for (const match of node.text.matchAll(/\{\{(\w+)\}\}/g)) {
        vars.add(match[1]);
      }
    }

    // Name templates
    if (node.name.includes('{{')) {
      for (const match of node.name.matchAll(/\{\{(\w+)\}\}/g)) {
        vars.add(match[1]);
      }
    }

    // Bound variables
    if (node.boundVariables) {
      for (const varName of Object.values(node.boundVariables)) {
        vars.add(varName);
      }
    }

    // Name-based bindings
    const nameBindings = parseNameBindings(node.name);
    for (const [, varName] of nameBindings) {
      vars.add(varName);
    }

    for (const childId of node.childIds) {
      walk(childId);
    }
  }

  walk(rootId);
  return [...vars].sort();
}

// ─── Internals ─────────────────────────────────────────────────

const TEMPLATE_RE = /\{\{(\w+)\}\}/g;

function resolveTemplateString(
  template: string,
  data: TemplateData,
  usedVars: Set<string>,
  missingVars: Set<string>,
): string {
  return template.replace(TEMPLATE_RE, (match, varName) => {
    if (varName in data) {
      usedVars.add(varName);
      const value = data[varName];
      if (value === null || value === undefined) return '';
      return String(value);
    }
    missingVars.add(varName);
    return match; // leave unresolved
  });
}

/**
 * Parse name-based bindings from node names.
 * Convention: "Button__cta_text" → property "text", variable "cta_text"
 * Convention: "Badge__show_badge__visible" → property "visible", variable "show_badge"
 */
function parseNameBindings(name: string): Array<[string, string]> {
  const bindings: Array<[string, string]> = [];
  const parts = name.split('__');

  if (parts.length < 2) return bindings;

  // Pattern 1: "name__variable" → text binding
  if (parts.length === 2) {
    bindings.push(['text', parts[1]]);
  }

  // Pattern 2: "name__variable__property" → explicit property
  if (parts.length === 3) {
    const prop = parts[2];
    const varName = parts[1];

    switch (prop) {
      case 'text':
      case 'visible':
      case 'opacity':
      case 'color':
      case 'bg':
      case 'image':
      case 'fontSize':
      case 'fontWeight':
        bindings.push([prop, varName]);
        break;
    }
  }

  return bindings;
}

function applyBinding(
  updates: Partial<SceneNode>,
  prop: string,
  value: string | number | boolean | Color | null | undefined,
): void {
  if (value === null || value === undefined) return;

  switch (prop) {
    case 'text':
      updates.text = String(value);
      break;
    case 'visible':
      updates.visible = Boolean(value);
      break;
    case 'opacity':
      updates.opacity = typeof value === 'number' ? value : parseFloat(String(value));
      break;
    case 'fontSize':
      updates.fontSize = typeof value === 'number' ? value : parseFloat(String(value));
      break;
    case 'fontWeight':
      updates.fontWeight = typeof value === 'number' ? value : parseInt(String(value), 10);
      break;
    case 'color':
      if (typeof value === 'object' && 'r' in value) {
        // Direct Color object
        updates.fills = [{ type: 'SOLID', color: value as Color, opacity: 1, visible: true }];
      } else if (typeof value === 'string') {
        const color = parseHexColor(value);
        if (color) {
          updates.fills = [{ type: 'SOLID', color, opacity: 1, visible: true }];
        }
      }
      break;
    case 'bg':
      if (typeof value === 'string') {
        const color = parseHexColor(value);
        if (color) {
          updates.fills = [{ type: 'SOLID', color, opacity: 1, visible: true }];
        }
      }
      break;
    case 'image':
      if (typeof value === 'string') {
        updates.fills = [{
          type: 'IMAGE',
          color: { r: 1, g: 1, b: 1, a: 1 },
          opacity: 1,
          visible: true,
          imageHash: value,
        }];
      }
      break;
  }
}

function parseHexColor(hex: string): Color | null {
  if (!hex.startsWith('#')) return null;
  const h = hex.slice(1);
  if (h.length === 3) {
    return {
      r: parseInt(h[0] + h[0], 16) / 255,
      g: parseInt(h[1] + h[1], 16) / 255,
      b: parseInt(h[2] + h[2], 16) / 255,
      a: 1,
    };
  }
  if (h.length === 6) {
    return {
      r: parseInt(h.slice(0, 2), 16) / 255,
      g: parseInt(h.slice(2, 4), 16) / 255,
      b: parseInt(h.slice(4, 6), 16) / 255,
      a: 1,
    };
  }
  return null;
}
