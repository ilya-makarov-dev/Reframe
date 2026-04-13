/**
 * AI Semantic Classification — LLM-based role assignment.
 *
 * Provider-agnostic: accepts a `classify` callback that takes a prompt
 * and returns a string. Works with Claude, GPT, local models, etc.
 *
 * Falls back to heuristic classification on LLM failure/timeout.
 */

import type { SceneGraph } from '../engine/scene-graph';
import type { SceneNode } from '../engine/types';
import { autoDetectRoles } from './auto-detect';

// ─── Types ──────────────────────────────────────────────────

export interface AiClassifyOptions {
  /** LLM classification callback. Provider-agnostic. */
  classify: (prompt: string) => Promise<string>;
  /** Maximum nodes to include in the prompt. Default: 200. */
  maxNodes?: number;
  /** Minimum confidence threshold. Default: 0.7. */
  minConfidence?: number;
  /** Timeout in ms for the LLM call. Default: 30000. */
  timeout?: number;
}

export interface AiRoleAssignment {
  nodeId: string;
  role: string;
  confidence: number;
}

export interface AiClassifyResult {
  /** Number of roles assigned by AI. */
  aiAssigned: number;
  /** Number of roles assigned by heuristic fallback. */
  heuristicAssigned: number;
  /** Total classified nodes. */
  totalClassified: number;
  /** Individual assignments. */
  assignments: AiRoleAssignment[];
  /** Whether AI was used (false = full heuristic fallback). */
  usedAi: boolean;
}

// ─── Minimal Scene Serialization ────────────────────────────

interface MinimalNode {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  childCount: number;
  fontSize?: number;
  hasFill: boolean;
  hasStroke: boolean;
  cornerRadius?: number;
}

function serializeMinimal(graph: SceneGraph, rootId: string, maxNodes: number): MinimalNode[] {
  const nodes: MinimalNode[] = [];

  function walk(nodeId: string): void {
    if (nodes.length >= maxNodes) return;
    const node = graph.getNode(nodeId);
    if (!node || !node.visible) return;

    const minimal: MinimalNode = {
      id: node.id,
      type: node.type,
      name: node.name,
      x: Math.round(node.x),
      y: Math.round(node.y),
      w: Math.round(node.width),
      h: Math.round(node.height),
      childCount: node.childIds.length,
      hasFill: node.fills.length > 0 && node.fills.some(f => f.visible !== false),
      hasStroke: node.strokes.length > 0,
    };

    if (node.type === 'TEXT' && node.text) {
      minimal.text = node.text.slice(0, 80); // Truncate long text
    }
    if (node.fontSize > 0) minimal.fontSize = node.fontSize;
    if (node.cornerRadius > 0) minimal.cornerRadius = node.cornerRadius;

    nodes.push(minimal);

    for (const childId of node.childIds) {
      walk(childId);
    }
  }

  walk(rootId);
  return nodes;
}

// ─── Prompt Construction ────────────────────────────────────

function buildPrompt(nodes: MinimalNode[]): string {
  const nodeList = nodes.map(n => {
    let desc = `${n.id}: ${n.type} "${n.name}" at (${n.x},${n.y}) ${n.w}×${n.h}`;
    if (n.text) desc += ` text="${n.text}"`;
    if (n.fontSize) desc += ` font=${n.fontSize}px`;
    if (n.childCount > 0) desc += ` children=${n.childCount}`;
    if (n.hasFill) desc += ' [fill]';
    if (n.hasStroke) desc += ' [stroke]';
    if (n.cornerRadius) desc += ` r=${n.cornerRadius}`;
    return desc;
  }).join('\n');

  return `You are a design analysis system. Analyze this node tree and assign semantic roles.

Available roles: nav, header, hero, section, footer, heading, paragraph, caption, button, cta, link, input, card, badge, avatar, divider, image, icon, logo, list, listItem, toast, modal, tooltip, dropdown

For each node that has a clear semantic role, return a JSON array:
[{"nodeId": "...", "role": "...", "confidence": 0.0-1.0}]

Only assign roles you are confident about (confidence > 0.7). Skip decorative/structural nodes.

Node tree (${nodes.length} nodes):
${nodeList}

Return ONLY the JSON array, no other text.`;
}

// ─── Response Parsing ───────────────────────────────────────

function parseResponse(response: string): AiRoleAssignment[] {
  // Try to extract JSON array from response
  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item: any) =>
        item && typeof item.nodeId === 'string' &&
        typeof item.role === 'string' &&
        typeof item.confidence === 'number'
      )
      .map((item: any) => ({
        nodeId: item.nodeId,
        role: item.role,
        confidence: item.confidence,
      }));
  } catch {
    return [];
  }
}

// ─── Main ───────────────────────────────────────────────────

/**
 * Classify a scene using an LLM with heuristic fallback.
 */
export async function aiClassifyScene(
  graph: SceneGraph,
  rootId: string,
  options: AiClassifyOptions,
): Promise<AiClassifyResult> {
  const maxNodes = options.maxNodes ?? 200;
  const minConfidence = options.minConfidence ?? 0.7;
  const timeout = options.timeout ?? 30000;

  let aiAssignments: AiRoleAssignment[] = [];
  let usedAi = false;

  // Try AI classification
  try {
    const nodes = serializeMinimal(graph, rootId, maxNodes);
    const prompt = buildPrompt(nodes);

    // Race against timeout
    const response = await Promise.race([
      options.classify(prompt),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('AI classification timeout')), timeout)
      ),
    ]);

    const parsed = parseResponse(response);
    aiAssignments = parsed.filter(a => a.confidence >= minConfidence);

    if (aiAssignments.length > 0) {
      usedAi = true;

      // Apply AI roles to the graph
      for (const assignment of aiAssignments) {
        const node = graph.getNode(assignment.nodeId);
        if (node && !node.semanticRole) {
          graph.updateNode(assignment.nodeId, { semanticRole: assignment.role } as any);
        }
      }
    }
  } catch {
    // AI failed — full heuristic fallback
  }

  // Fill gaps with heuristic classification
  const heuristicCount = autoDetectRoles(graph, rootId, 0.6);

  return {
    aiAssigned: aiAssignments.length,
    heuristicAssigned: heuristicCount,
    totalClassified: aiAssignments.length + heuristicCount,
    assignments: aiAssignments,
    usedAi,
  };
}
