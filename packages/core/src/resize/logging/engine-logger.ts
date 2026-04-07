/**
 * Engine Logger — structured event logging during pipeline execution.
 *
 * Any part of the engine (pipeline steps, post-processing, Remember, etc.)
 * can push events via the global `engineLog` singleton. Events are scoped
 * to the current run — call `engineLog.startRun()` at the beginning of
 * `handleScale` and harvest with `engineLog.endRun()` at the end.
 *
 * Host-agnostic: works in Figma, CLI, MCP, or headless test environments.
 */

// ── Types ──

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  /** Milliseconds since run started (relative, cheap to compare). */
  ts: number;
  level: LogLevel;
  /** Short tag: pipeline step or subsystem (e.g. 'remember', 'letterbox', 'guide-post'). */
  source: string;
  msg: string;
  /** Arbitrary structured data for offline analysis. */
  data?: unknown;
}

export interface RunLogSnapshot {
  /** ISO timestamp when the run started. */
  startedAt: string;
  /** Wall-clock duration (ms). */
  durationMs: number;
  entries: LogEntry[];
}

// ── Logger implementation ──

/** Minimum level to capture (inclusive). Anything below is dropped. */
const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class EngineLogger {
  private _entries: LogEntry[] = [];
  private _runT0 = 0;
  private _runActive = false;
  private _minLevel: LogLevel = 'debug';
  private _startedAt = '';

  /** Call at the top of `handleScale` (or any orchestrator entry). */
  startRun(): void {
    this._entries = [];
    this._runT0 = Date.now();
    this._runActive = true;
    this._startedAt = new Date(this._runT0).toISOString();
  }

  /** Harvest all entries and close the run scope. */
  endRun(): RunLogSnapshot {
    const snapshot: RunLogSnapshot = {
      startedAt: this._startedAt,
      durationMs: this._runActive ? Date.now() - this._runT0 : 0,
      entries: this._entries.slice(),
    };
    this._runActive = false;
    return snapshot;
  }

  /** Change minimum captured level (e.g. 'info' in production, 'debug' in dev). */
  setMinLevel(level: LogLevel): void {
    this._minLevel = level;
  }

  /** Whether a run is currently in progress. */
  get active(): boolean {
    return this._runActive;
  }

  /** Current entries (live reference — use only for inspection, not mutation). */
  get entries(): readonly LogEntry[] {
    return this._entries;
  }

  // ── Convenience methods ──

  debug(source: string, msg: string, data?: unknown): void {
    this._push('debug', source, msg, data);
  }

  info(source: string, msg: string, data?: unknown): void {
    this._push('info', source, msg, data);
  }

  warn(source: string, msg: string, data?: unknown): void {
    this._push('warn', source, msg, data);
  }

  error(source: string, msg: string, data?: unknown): void {
    this._push('error', source, msg, data);
  }

  // ── Trace helpers (backward-compat with scale-handler's trace: string[]) ──

  /** Push a trace string (info level, source='trace'). Shorthand for pipeline post-processing. */
  trace(msg: string): void {
    this._push('info', 'trace', msg);
  }

  /** Extract trace strings (entries with source='trace') — drop-in for the old `trace: string[]`. */
  getTraceStrings(): string[] {
    return this._entries
      .filter(e => e.source === 'trace')
      .map(e => e.msg);
  }

  // ── Internal ──

  private _push(level: LogLevel, source: string, msg: string, data?: unknown): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this._minLevel]) return;
    this._entries.push({
      ts: this._runActive ? Date.now() - this._runT0 : 0,
      level,
      source,
      msg,
      ...(data !== undefined ? { data } : {}),
    });
  }
}

/** Global engine logger singleton. */
export const engineLog = new EngineLogger();
