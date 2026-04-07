/**
 * Session Log Manager — accumulates run logs across multiple scale operations.
 *
 * Host-agnostic: the engine collects run logs; the host decides how to persist
 * (Figma UI downloads as .md, CLI writes to disk, MCP returns via API).
 */

import {
  stripScaleRunLogHeaderForSessionMerge,
  scaleSessionLogFilename,
} from '../utils/scale-run-log';
import type { RunLogSnapshot } from './engine-logger';

export interface SessionRunRecord {
  /** ISO timestamp of the run. */
  ts: string;
  /** Formatted markdown for this single run. */
  markdown: string;
  /** Suggested filename for single-run export. */
  filename: string;
  /** Structured event log snapshot (if engine logger was active). */
  eventLog?: RunLogSnapshot;
}

class SessionLogManager {
  private _runs: SessionRunRecord[] = [];

  /** Register a completed run. Called by handleScale after building the log. */
  pushRun(record: SessionRunRecord): void {
    this._runs.push(record);
  }

  /** All runs in this session (oldest first). */
  get runs(): readonly SessionRunRecord[] {
    return this._runs;
  }

  /** Number of recorded runs. */
  get count(): number {
    return this._runs.length;
  }

  /** Latest run (or null). */
  get lastRun(): SessionRunRecord | null {
    return this._runs.length > 0 ? this._runs[this._runs.length - 1]! : null;
  }

  /** Merge all run markdowns into one session document. */
  mergeAllMarkdown(): string {
    if (this._runs.length === 0) return '';
    const header = `# reframe — session log (${this._runs.length} runs)\n`;
    const separator = '\n\n---\n\n';
    const body = this._runs
      .map(r => stripScaleRunLogHeaderForSessionMerge(r.markdown))
      .join(separator);
    return header + '\n' + body;
  }

  /** Suggested filename for merged session export. */
  mergeFilename(): string {
    return scaleSessionLogFilename();
  }

  /** Reset session (e.g. when user clears all temps / starts fresh). */
  reset(): void {
    this._runs = [];
  }
}

/** Global session log manager singleton. */
export const sessionLog = new SessionLogManager();
