// Bottom-chat panel — the agent chat pill anchored to bottom-center of
// editor pages. Chrome (input row, scope chips, voice button, deep-
// think toggle, send button) is composed as INode with stable
// semantic paths; the history scroll area + SSE streaming logic stays
// in platform-ui.js's bottom-chat binder (complex: async stream
// parsing, bubble rendering, cancel semantics).
//
// Two mount-slots:
//   chat-history  — bubbles rendered client-side from streaming SSE
//   chat-input    — <textarea> the binder reads on Enter submit
//
// Every other chrome element (buttons, scope chips, toggles) is
// composer-emitted with agent-operable click gestures.

import { SceneGraph } from '../engine/scene-graph';
import type { SceneNode } from '../engine/types';
import { buildPanel, solidFill, solidStroke, intent, gesture } from './helpers';

const CHAT = {
  SURFACE:     { r: 0.98,  g: 0.969, b: 0.941, a: 0.95 },
  SURFACE_ELV: { r: 1,     g: 1,     b: 1,     a: 1 },
  BORDER:      { r: 0.173, g: 0.149, b: 0.094, a: 0.12 },
  TEXT_PRI:    { r: 0.173, g: 0.149, b: 0.094, a: 1 },
  TEXT_SEC:    { r: 0.42,  g: 0.388, b: 0.329, a: 1 },
  TEXT_MUT:    { r: 0.604, g: 0.565, b: 0.51,  a: 1 },
  ACCENT:      { r: 0.914, g: 0.294, b: 0.102, a: 1 },
};

export interface BottomChatOptions {
  width?: number;
  /** Scope chips — [{label, onRemove?}]. When empty no chips render. */
  scopeChips?: Array<{ label: string; kind?: 'brand' | 'viewport' | 'node' }>;
  /** Show deep-think toggle. Default true. */
  deepThink?: boolean;
}

export function composeBottomChatPanel(opts: BottomChatOptions = {}): SceneGraph {
  const width = opts.width ?? 760;
  const graph = new SceneGraph();
  const root = buildPanel(graph, {
    name: 'bottom-chat',
    width,
    role: 'bottom-chat/panel',
    purpose: 'Agent chat pill',
    background: CHAT.SURFACE,
    padding: 8,
    itemSpacing: 6,
    editableBy: 'both',
  });

  // History slot (scrollable bubbles — populated by binder).
  graph.createNode('FRAME' as any, root.id, {
    name: 'chat-history',
    width: width - 16, height: 0,
    fills: [],
    mountSlot: { name: 'chat-history', accepts: [] },
    intent: intent('bottom-chat/history-slot', 'Bubble history populated by SSE stream', 'locked'),
  } as any);

  // Scope chips row.
  if ((opts.scopeChips ?? []).length > 0) {
    composeScopeRow(graph, root, width - 16, opts.scopeChips!);
  }

  // Input row.
  composeInputRow(graph, root, width - 16, opts);

  // Action row (mic / lightbulb / history + send).
  composeActionRow(graph, root, width - 16, opts);

  return graph;
}

function composeScopeRow(graph: SceneGraph, parent: SceneNode, width: number, chips: Array<{ label: string; kind?: string }>): void {
  const row = graph.createNode('FRAME' as any, parent.id, {
    name: 'scope-row',
    width,
    fills: [],
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'HUG',
    layoutWrap: 'WRAP',
    itemSpacing: 6,
    counterAxisSpacing: 6,
    intent: intent('bottom-chat/scope-row', 'Scope chips', 'locked'),
  } as any);
  for (const chip of chips) {
    composeChip(graph, row, chip.label, chip.kind ?? 'generic');
  }
}

function composeChip(graph: SceneGraph, parent: SceneNode, label: string, kind: string): void {
  const chip = graph.createNode('FRAME' as any, parent.id, {
    name: `chip-${kind}`,
    height: 24,
    cornerRadius: 12,
    fills: solidFill(CHAT.SURFACE_ELV),
    ...solidStroke(CHAT.BORDER, 1),
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FIXED',
    counterAxisAlign: 'CENTER',
    paddingLeft: 10, paddingRight: 8,
    itemSpacing: 6,
    intent: intent(`bottom-chat/chip-${kind}`, label, 'locked'),
  } as any);
  graph.createNode('TEXT' as any, chip.id, {
    name: 'chip-label',
    text: label,
    fontSize: 11, fontFamily: 'Inter', fontWeight: 500,
    width: Math.max(40, label.length * 7), height: 16,
    fills: solidFill(CHAT.TEXT_SEC),
    intent: intent(`bottom-chat/chip-${kind}-label`, label, 'locked'),
  } as any);
  const close = graph.createNode('FRAME' as any, chip.id, {
    name: 'chip-close',
    width: 14, height: 14,
    cornerRadius: 7,
    fills: [],
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'FIXED', counterAxisSizing: 'FIXED',
    primaryAxisAlign: 'CENTER', counterAxisAlign: 'CENTER',
    semanticRole: 'button',
    focusable: true,
    onClick: gesture('ui.removeScopeChip', { kind, label }, 'local-state'),
    intent: intent(`bottom-chat/chip-${kind}-close`, `Remove ${label} chip`, 'both'),
  } as any);
  graph.createNode('TEXT' as any, close.id, {
    name: 'x',
    text: '×',
    fontSize: 12, fontFamily: 'Inter', fontWeight: 400,
    width: 10, height: 14,
    textAlignHorizontal: 'CENTER',
    fills: solidFill(CHAT.TEXT_MUT),
    intent: intent(`bottom-chat/chip-${kind}-x`, 'x', 'locked'),
  } as any);
}

function composeInputRow(graph: SceneGraph, parent: SceneNode, width: number, _opts: BottomChatOptions): void {
  // Input slot — binder hydrates with <textarea data-bc-input>.
  graph.createNode('FRAME' as any, parent.id, {
    name: 'input',
    width, height: 40,
    cornerRadius: 8,
    fills: solidFill(CHAT.SURFACE_ELV),
    ...solidStroke(CHAT.BORDER, 1),
    mountSlot: { name: 'chat-input', accepts: [] },
    intent: intent('bottom-chat/input-slot', 'Textarea for user prompt — binder hydrates', 'both'),
  } as any);
}

function composeActionRow(graph: SceneGraph, parent: SceneNode, width: number, opts: BottomChatOptions): void {
  const row = graph.createNode('FRAME' as any, parent.id, {
    name: 'actions',
    width, height: 32,
    fills: [],
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    counterAxisAlign: 'CENTER',
    itemSpacing: 4,
    intent: intent('bottom-chat/actions', 'Bottom actions', 'locked'),
  } as any);

  // Left side: mic, lightbulb (deep-think), history.
  composeIconButton(graph, row, 'mic', '⏺', 'Voice input (coming)', 'bottom-chat/mic');
  if (opts.deepThink !== false) {
    composeIconButton(graph, row, 'deep-think', '💡', 'Deep-think mode', 'bottom-chat/deep-think');
  }
  composeIconButton(graph, row, 'history', '⋯', 'Chat history', 'bottom-chat/history-toggle');

  // Spacer.
  graph.createNode('FRAME' as any, row.id, {
    name: 'spacer',
    fills: [], layoutGrow: 1, width: 1, height: 1,
    intent: intent('bottom-chat/actions-spacer', '', 'locked'),
  } as any);

  // Attach (+) button.
  composeIconButton(graph, row, 'attach', '+', 'Attach file / URL', 'bottom-chat/attach');

  // Send button.
  const send = graph.createNode('FRAME' as any, row.id, {
    name: 'send',
    width: 32, height: 32,
    cornerRadius: 8,
    fills: solidFill(CHAT.ACCENT),
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    primaryAxisAlign: 'CENTER',
    counterAxisAlign: 'CENTER',
    semanticRole: 'button',
    focusable: true,
    onClick: gesture('ui.chatSubmit', {}, 'local-state'),
    keybinding: { combo: 'ctrl+enter', tool: 'ui.chatSubmit', args: {} },
    intent: intent('bottom-chat/send', 'Send prompt to agent', 'both'),
  } as any);
  graph.createNode('TEXT' as any, send.id, {
    name: 'send-glyph',
    text: '→',
    fontSize: 16, fontFamily: 'Inter', fontWeight: 500,
    width: 16, height: 20,
    textAlignHorizontal: 'CENTER',
    fills: solidFill({ r: 1, g: 1, b: 1, a: 1 }),
    intent: intent('bottom-chat/send-glyph', '→', 'locked'),
  } as any);
}

function composeIconButton(graph: SceneGraph, parent: SceneNode, name: string, glyph: string, title: string, role: string): void {
  const btn = graph.createNode('FRAME' as any, parent.id, {
    name,
    width: 28, height: 28,
    cornerRadius: 6,
    fills: [],
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    primaryAxisAlign: 'CENTER',
    counterAxisAlign: 'CENTER',
    semanticRole: 'button',
    focusable: true,
    onClick: gesture('ui.' + name.replace(/-/g, ''), {}, 'local-state'),
    intent: intent(role, title, 'both'),
  } as any);
  graph.createNode('TEXT' as any, btn.id, {
    name: 'icon',
    text: glyph,
    fontSize: 14, fontFamily: 'Inter', fontWeight: 400,
    width: 16, height: 18,
    textAlignHorizontal: 'CENTER',
    fills: solidFill(CHAT.TEXT_SEC),
    intent: intent(role + '-glyph', glyph, 'locked'),
  } as any);
}
