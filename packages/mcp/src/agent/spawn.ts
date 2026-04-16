/**
 * Agent spawn — invoke `claude -p` headlessly with reframe MCP attached
 * and stream stdout (stream-json format) as parsed events.
 *
 * Why this module exists:
 *   The Platform UI needs to "summon" an agent without embedding the
 *   Anthropic SDK. Users have Claude Code installed → the `claude` CLI
 *   handles auth/billing/model selection. We just spawn it, pipe the
 *   user's prompt in, and stream parsed events back to whoever is
 *   listening (HTTP SSE response, intent worker, etc.).
 *
 * Stream format:
 *   `claude -p --output-format stream-json` emits one JSON object per
 *   line. Each line is one of:
 *     { type: 'system',     subtype: 'init', session_id, model, ... }
 *     { type: 'assistant',  message: { content: [...] } }
 *     { type: 'user',       message: { content: [...] } }   // tool_result
 *     { type: 'result',     subtype: 'success' | 'error', ... }
 *   `assistant.message.content` is a list whose items are { type: 'text' }
 *   or { type: 'tool_use', name, input, id }. We forward those upward as
 *   typed events so the UI can render them.
 *
 * Lifecycle:
 *   spawnAgentSession() returns an object with:
 *     - events: AsyncIterable<AgentEvent> — consume this in `for await`
 *     - sessionId: Promise<string | null> — resolves once 'system:init'
 *       arrives (so the caller can echo it back for --resume).
 *     - kill(): force-terminate the subprocess.
 *
 * Failure modes:
 *   - `claude` binary not found → events emits one 'error' event with
 *     { code: 'CLAUDE_NOT_FOUND' } then completes. UI can show
 *     "Install Claude Code".
 *   - non-zero exit → 'error' event with stderr captured.
 */

import { spawn, type ChildProcess } from 'child_process';

// ─── Public event types ─────────────────────────────────────

export type AgentEvent =
  | { type: 'session_start'; sessionId: string; model?: string }
  | { type: 'text'; text: string }
  | { type: 'tool_use'; toolName: string; input: unknown; toolUseId: string }
  | { type: 'tool_result'; toolUseId: string; ok: boolean; preview: string }
  | { type: 'done'; reason: 'success' | 'error' | 'killed'; durationMs: number; cost?: number }
  | { type: 'error'; code: string; message: string };

export interface SpawnAgentOptions {
  /** User's prompt. Will be passed via -p. */
  prompt: string;
  /** Optional session id from previous turn — passes --resume <id>. */
  sessionId?: string;
  /** Working directory for the claude subprocess. Defaults to process.cwd(). */
  cwd?: string;
  /** Restrict tools the spawned claude may call. e.g. ["mcp__reframe__*"] */
  allowedTools?: string[];
  /** Override the binary name. Defaults to "claude". */
  binary?: string;
}

export interface AgentSession {
  /** Async iterable of parsed events. Completes when the subprocess exits. */
  events: AsyncIterable<AgentEvent>;
  /** Resolves to the session id once we see system:init. null if process died first. */
  sessionId: Promise<string | null>;
  /** Force-terminate the subprocess. */
  kill(): void;
}

// ─── Implementation ─────────────────────────────────────────

export function spawnAgentSession(opts: SpawnAgentOptions): AgentSession {
  const binary = opts.binary ?? 'claude';
  // Pass the prompt via stdin instead of -p <arg>. Critical on Windows
  // where the cmd shell mangles multi-line prompts and quote-heavy text
  // when passed as a positional argument (newlines split into multiple
  // claude invocations or get dropped). Stdin is binary-safe.
  const args: string[] = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose', // required by claude when output-format=stream-json
  ];
  if (opts.sessionId) {
    args.push('--resume', opts.sessionId);
  }
  if (opts.allowedTools && opts.allowedTools.length > 0) {
    args.push('--allowedTools', opts.allowedTools.join(','));
  }

  // Buffer for partial JSON lines + queue for events ready to consume.
  const queue: AgentEvent[] = [];
  const waiters: Array<(ev: IteratorResult<AgentEvent>) => void> = [];
  let done = false;
  let killed = false;
  let stderrBuf = '';
  let resolveSessionId: (id: string | null) => void = () => {};
  const sessionIdPromise = new Promise<string | null>((r) => { resolveSessionId = r; });
  const startedAt = Date.now();

  const push = (ev: AgentEvent): void => {
    if (done) return;
    if (waiters.length > 0) {
      waiters.shift()!({ value: ev, done: false });
    } else {
      queue.push(ev);
    }
  };

  const finish = (): void => {
    if (done) return;
    done = true;
    // Resolve session promise if still pending.
    resolveSessionId(null);
    while (waiters.length > 0) {
      waiters.shift()!({ value: undefined as any, done: true });
    }
  };

  // Declared at outer scope so makeIterable's closure can safely read it
  // even on the spawn-failure return path (no TDZ).
  let childRef: ChildProcess | null = null;
  let child: ChildProcess | null = null;
  try {
    child = spawn(binary, args, {
      cwd: opts.cwd ?? process.cwd(),
      // stdin: pipe (so we can write the prompt), stdout/stderr: pipe.
      stdio: ['pipe', 'pipe', 'pipe'],
      // shell:true on Windows so it can find claude.cmd from PATH.
      // claude is installed as a .cmd shim that node's spawn won't find without shell.
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        // Disable sidecar in the spawned claude's reframe MCP — we own
        // the HTTP port already; without this the spawned MCP kills our
        // running sidecar (port "in use" → takeover dance) and the
        // user's open chat SSE connection dies.
        REFRAME_HTTP_PORT: '0',
      },
    });
  } catch (err) {
    push({ type: 'error', code: 'SPAWN_FAILED', message: String((err as Error).message) });
    push({ type: 'done', reason: 'error', durationMs: 0 });
    finish();
    return makeIterable();
  }

  // Pipe stdin/stdout/stderr via runtime guards. With stdio:
  // ['pipe', 'pipe', 'pipe'] all three are present at runtime.
  const stdin = child.stdin!;
  const stdout = child.stdout!;
  const stderr = child.stderr!;
  childRef = child;

  // Write the prompt to stdin then close it so claude reads EOF and
  // begins generation. We do this on next tick so the on('error')
  // handler is registered first (avoids unhandled error events on
  // platforms where the binary is missing).
  setImmediate(() => {
    try {
      stdin.write(opts.prompt);
      stdin.end();
    } catch (err: any) {
      // Most common: EPIPE because the binary couldn't be found and
      // the process is already gone. on('error') will report it.
    }
  });

  // ── Parse stdout: NDJSON ──
  let buf = '';
  stdout.setEncoding('utf8');
  stdout.on('data', (chunk: string) => {
    buf += chunk;
    // Split on newlines; last entry may be partial.
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let parsed: any;
      try { parsed = JSON.parse(line); } catch { continue; }
      handleStreamObject(parsed, push, resolveSessionId);
    }
  });

  stderr.setEncoding('utf8');
  stderr.on('data', (chunk: string) => {
    stderrBuf += chunk;
    // Keep stderr buffer bounded.
    if (stderrBuf.length > 8192) stderrBuf = stderrBuf.slice(-8192);
  });

  childRef.on('error', (err: NodeJS.ErrnoException) => {
    const code = err.code === 'ENOENT' ? 'CLAUDE_NOT_FOUND' : 'SPAWN_ERROR';
    const msg = code === 'CLAUDE_NOT_FOUND'
      ? `Claude Code CLI not found at "${binary}". Install: https://claude.com/download`
      : err.message;
    push({ type: 'error', code, message: msg });
    push({ type: 'done', reason: 'error', durationMs: Date.now() - startedAt });
    finish();
  });

  childRef.on('close', (code) => {
    // Drain any partial line.
    if (buf.trim()) {
      try {
        const parsed = JSON.parse(buf);
        handleStreamObject(parsed, push, resolveSessionId);
      } catch { /* ignore trailing garbage */ }
      buf = '';
    }
    if (killed) {
      push({ type: 'done', reason: 'killed', durationMs: Date.now() - startedAt });
    } else if (code !== 0 && code !== null) {
      push({ type: 'error', code: 'EXIT_NONZERO', message: stderrBuf.trim().slice(-500) || `exit ${code}` });
      push({ type: 'done', reason: 'error', durationMs: Date.now() - startedAt });
    } else {
      // Note: a 'result' line usually pushes 'done' already; this is a backstop.
      push({ type: 'done', reason: 'success', durationMs: Date.now() - startedAt });
    }
    finish();
  });

  function makeIterable(): AgentSession {
    const events: AsyncIterable<AgentEvent> = {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<AgentEvent>> {
            if (queue.length > 0) {
              return Promise.resolve({ value: queue.shift()!, done: false });
            }
            if (done) return Promise.resolve({ value: undefined as any, done: true });
            return new Promise((r) => waiters.push(r));
          },
        };
      },
    };
    return {
      events,
      sessionId: sessionIdPromise,
      kill(): void {
        if (done) return;
        killed = true;
        try { childRef?.kill('SIGTERM'); } catch { /* ignore */ }
      },
    };
  }

  return makeIterable();
}

// ─── Stream-json line dispatcher ────────────────────────────

function handleStreamObject(
  obj: any,
  push: (ev: AgentEvent) => void,
  resolveSessionId: (id: string | null) => void,
): void {
  if (!obj || typeof obj !== 'object') return;
  const t = obj.type as string | undefined;

  // claude emits: { type: 'system', subtype: 'init', session_id, model, ... }
  if (t === 'system' && obj.subtype === 'init') {
    const sid = String(obj.session_id ?? '');
    if (sid) resolveSessionId(sid);
    push({ type: 'session_start', sessionId: sid, model: obj.model });
    return;
  }

  // Assistant message — content array with text + tool_use blocks.
  if (t === 'assistant' && obj.message?.content) {
    const content = obj.message.content as any[];
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof block.text === 'string') {
        push({ type: 'text', text: block.text });
      } else if (block.type === 'tool_use') {
        push({
          type: 'tool_use',
          toolName: String(block.name ?? 'unknown'),
          input: block.input ?? {},
          toolUseId: String(block.id ?? ''),
        });
      }
    }
    return;
  }

  // User message in stream = tool_result emitted by the harness.
  if (t === 'user' && obj.message?.content) {
    const content = obj.message.content as any[];
    for (const block of content) {
      if (block?.type === 'tool_result') {
        const raw = Array.isArray(block.content)
          ? block.content.map((c: any) => c?.text ?? '').join('')
          : String(block.content ?? '');
        push({
          type: 'tool_result',
          toolUseId: String(block.tool_use_id ?? ''),
          ok: !block.is_error,
          preview: raw.slice(0, 240),
        });
      }
    }
    return;
  }

  // Final result line.
  if (t === 'result') {
    const reason = obj.subtype === 'success' ? 'success' : 'error';
    push({
      type: 'done',
      reason,
      durationMs: Number(obj.duration_ms ?? 0),
      cost: typeof obj.total_cost_usd === 'number' ? obj.total_cost_usd : undefined,
    });
    return;
  }
}
