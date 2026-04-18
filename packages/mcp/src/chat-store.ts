/**
 * Project-scoped chat history.
 *
 * The in-app agent's conversation is persisted to
 * `<projectDir>/.reframe/chats/<projectSlug>.json` so:
 *
 *   1. A page reload doesn't wipe the dialog (the UI replays from disk).
 *   2. Each project has its own chat — switching projects switches chats.
 *   3. A "New chat" button can explicitly wipe the file, triggering a
 *      fresh Claude `--resume` session id on the next turn.
 *
 * The file is a single JSON blob — each turn rewrites it. Chats stay
 * small (a few hundred KB even after long sessions), so JSON.stringify
 * / writeFileSync is fast enough and atomic-enough. When we outgrow that
 * we'll move to an append-only JSONL with periodic compaction.
 *
 * Events we persist:
 *   - "user"        text prompts
 *   - "assistant"   streaming text (coalesced per `pendingAssistantBubble`)
 *   - "tool_use"    { name, input, toolUseId } — TodoWrite is stored here too
 *   - "tool_result" { toolUseId, ok, preview } — matched to tool_use on replay
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';
import { getReframeDir } from './store.js';

export type ChatMessage =
  | { role: 'user'; text: string; at: number }
  | { role: 'assistant'; text: string; at: number }
  | { role: 'tool_use'; toolName: string; input: unknown; toolUseId: string; at: number }
  | { role: 'tool_result'; toolUseId: string; ok: boolean; preview: string; at: number };

export interface ChatHistory {
  projectSlug: string;
  /** Claude Code --resume id. Reset on clear. */
  sessionId: string | null;
  messages: ChatMessage[];
  updatedAt: number;
}

function sanitizeSlug(slug: string): string {
  return slug.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128);
}

function chatsDir(): string {
  const d = join(getReframeDir(), 'chats');
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function chatPath(slug: string): string {
  return join(chatsDir(), `${sanitizeSlug(slug)}.json`);
}

export function loadChat(slug: string): ChatHistory {
  if (!slug) return emptyChat(slug);
  const p = chatPath(slug);
  if (!existsSync(p)) return emptyChat(slug);
  try {
    const raw = readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.messages)) {
      return {
        projectSlug: slug,
        sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : null,
        messages: parsed.messages,
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
      };
    }
  } catch {
    /* swallow — corrupt file, treat as fresh */
  }
  return emptyChat(slug);
}

function emptyChat(slug: string): ChatHistory {
  return { projectSlug: slug, sessionId: null, messages: [], updatedAt: Date.now() };
}

function saveChat(history: ChatHistory): void {
  try {
    history.updatedAt = Date.now();
    writeFileSync(chatPath(history.projectSlug), JSON.stringify(history), 'utf8');
  } catch {
    /* best-effort — the in-memory chat stays consistent even if disk fails */
  }
}

export function clearChat(slug: string): void {
  if (!slug) return;
  const p = chatPath(slug);
  try { if (existsSync(p)) rmSync(p); } catch { /* best-effort */ }
}

/**
 * Append one message and persist. Caller owns coalescing of assistant
 * text (we store every delta separately would spam the file); the chat
 * handler does the coalescing then calls `appendMessage` once per turn.
 */
export function appendMessage(slug: string, msg: ChatMessage): void {
  if (!slug) return;
  const history = loadChat(slug);
  history.messages.push(msg);
  saveChat(history);
}

export function setChatSessionId(slug: string, sessionId: string): void {
  if (!slug) return;
  const history = loadChat(slug);
  if (history.sessionId !== sessionId) {
    history.sessionId = sessionId;
    saveChat(history);
  }
}

export function listChats(): Array<{ projectSlug: string; messageCount: number; updatedAt: number }> {
  try {
    const dir = chatsDir();
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const slug = f.slice(0, -5);
        const h = loadChat(slug);
        return { projectSlug: slug, messageCount: h.messages.length, updatedAt: h.updatedAt };
      });
  } catch {
    return [];
  }
}
