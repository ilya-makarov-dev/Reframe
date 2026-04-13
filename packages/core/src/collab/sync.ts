/**
 * Sync Protocol — server-authoritative collaboration.
 *
 * Uses existing SSE infrastructure for broadcasts.
 * Operations are sent to server, server merges via CRDT,
 * broadcasts merged state to all peers.
 *
 * Transport options:
 * - SSE (one-way server→client, existing infrastructure)
 * - HTTP POST (client→server)
 * - WebSocket (bidirectional, future)
 */

import type { CrdtOperation, CrdtState } from './crdt';

// ─── Types ──────────────────────────────────────────────────

export interface SyncSession {
  id: string;
  sceneId: string;
  peers: Set<string>;
  operations: CrdtOperation[];
  vectorClock: Record<string, number>;
  createdAt: number;
}

export interface SyncMessage {
  type: 'ops' | 'state' | 'join' | 'leave' | 'ping';
  sessionId: string;
  peerId: string;
  operations?: CrdtOperation[];
  state?: CrdtState;
}

// ─── Server-side Session Manager ────────────────────────────

const sessions = new Map<string, SyncSession>();

/** Create a new sync session for a scene. */
export function createSession(sceneId: string): SyncSession {
  const session: SyncSession = {
    id: `sync-${Date.now()}`,
    sceneId,
    peers: new Set(),
    operations: [],
    vectorClock: {},
    createdAt: Date.now(),
  };
  sessions.set(session.id, session);
  return session;
}

/** Get an existing session. */
export function getSession(sessionId: string): SyncSession | undefined {
  return sessions.get(sessionId);
}

/** Find session for a scene. */
export function findSessionForScene(sceneId: string): SyncSession | undefined {
  for (const session of sessions.values()) {
    if (session.sceneId === sceneId) return session;
  }
  return undefined;
}

/** Join a peer to a session. */
export function joinSession(sessionId: string, peerId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  session.peers.add(peerId);
  return true;
}

/** Remove a peer from a session. */
export function leaveSession(sessionId: string, peerId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  session.peers.delete(peerId);
  // Clean up empty sessions
  if (session.peers.size === 0) {
    sessions.delete(sessionId);
  }
  return true;
}

/** Receive operations from a peer and merge into session state. */
export function receiveOps(sessionId: string, peerId: string, ops: CrdtOperation[]): CrdtOperation[] {
  const session = sessions.get(sessionId);
  if (!session) return [];

  // Filter out already-seen operations (vector clock check)
  const newOps: CrdtOperation[] = [];
  for (const op of ops) {
    const lastSeen = session.vectorClock[op.peerId] ?? 0;
    if (op.timestamp > lastSeen) {
      session.vectorClock[op.peerId] = op.timestamp;
      session.operations.push(op);
      newOps.push(op);
    }
  }

  return newOps; // Return only new ops for broadcasting
}

/** Get all operations since a peer's last known clock. */
export function getOpsSince(sessionId: string, peerClock: Record<string, number>): CrdtOperation[] {
  const session = sessions.get(sessionId);
  if (!session) return [];

  return session.operations.filter(op => {
    const lastSeen = peerClock[op.peerId] ?? 0;
    return op.timestamp > lastSeen;
  });
}

/** List all active sessions. */
export function listSessions(): Array<{ id: string; sceneId: string; peers: number; ops: number }> {
  return [...sessions.values()].map(s => ({
    id: s.id,
    sceneId: s.sceneId,
    peers: s.peers.size,
    ops: s.operations.length,
  }));
}
