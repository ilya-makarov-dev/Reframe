/**
 * Event bus — real-time project events for Studio sync.
 *
 * MCP tools emit events (scene saved, project opened, etc.).
 * The HTTP transport subscribes and pushes to Studio via SSE.
 */

import type { ProjectEvent } from '../../core/src/project/types.js';

type EventListener = (event: ProjectEvent) => void;

const listeners = new Set<EventListener>();

/** Subscribe to project events. Returns unsubscribe function. */
export function onProjectEvent(listener: EventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Emit a project event to all listeners. */
export function emitProjectEvent(event: ProjectEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (_) {}
  }
}
