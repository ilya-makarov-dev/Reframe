/**
 * reframe_ui session manager — Playwright lifecycle + log ring buffers.
 *
 * The MCP tool handler is stateless; keeping a live browser Page across
 * separate tool calls is what makes UI automation fast enough to actually
 * use. A fresh Chromium boot is 2-3s; once the browser is warm every
 * subsequent click/probe/screenshot is sub-second.
 *
 * Singleton Browser, many Page tabs (one per session). Each session
 * captures console messages, uncaught page errors, and network failures
 * into bounded ring buffers so the agent can pull "what went wrong since
 * my last action" without drowning in a full 10k-entry log.
 *
 * GC: sessions idle > 15 min are closed; when the last session dies the
 * whole browser is shut down so we don't leak a Chromium process after
 * the Platform tab is long gone.
 */

// Playwright is a devDependency at the repo root — lazy-loaded so that
// anyone running @reframe/mcp without ever touching reframe_ui doesn't
// pay the ~300 MB browser download cost at install time.
type PWModule = typeof import('playwright');
type Browser = import('playwright').Browser;
type Page = import('playwright').Page;

export interface UiSession {
  id: string;
  page: Page;
  createdAt: number;
  lastActiveAt: number;
  /** Project slug this session is navigated to, parsed from the open URL. */
  projectSlug: string | null;
  consoleLog: LogEntry<ConsoleEntry>[];
  pageErrors: LogEntry<ErrorEntry>[];
  networkErrors: LogEntry<NetworkErrorEntry>[];
}

/**
 * Thrown by `openSession` when another live session already owns the same
 * `/platform/project/<slug>` URL. Parallel designer-qa sweeps require
 * slug-isolation — two sessions on the same project share SSE broadcasts
 * and last-write-wins the same `manifest.json` on disk. Raising early is
 * better than silent corruption; the caller fails loudly with a 409-style
 * error and the agent picks a unique slug on retry.
 */
export class SlugInUseError extends Error {
  constructor(public readonly slug: string, public readonly ownerSessionId: string) {
    super(
      `Project slug "${slug}" is already open in session ${ownerSessionId}. ` +
      `Two concurrent reframe_ui sessions on the same project corrupt manifest state ` +
      `— use a unique slug per session, or close the other one first.`,
    );
    this.name = 'SlugInUseError';
  }
}

/**
 * Parse `/platform/project/<slug>` out of an open URL. Returns null for
 * dashboard / preview / any non-project route — those are safe to share
 * across sessions (read-only surfaces don't mutate disk state).
 */
export function parseProjectSlug(rawUrl: string): string | null {
  try {
    // Accept both absolute ("http://localhost:4100/platform/project/foo")
    // and path-only ("/platform/project/foo") forms.
    const path = rawUrl.startsWith('http') ? new URL(rawUrl).pathname : rawUrl.split('?')[0];
    const m = path.match(/\/platform\/project\/([^/]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

interface ConsoleEntry { type: string; text: string; }
interface ErrorEntry { message: string; stack?: string; }
interface NetworkErrorEntry { url: string; status?: number; failure?: string; }
type LogEntry<T> = T & { at: number };

const MAX_SESSIONS = 5;
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const LOG_BUFFER_SIZE = 100;

let browser: Browser | null = null;
let pwPromise: Promise<PWModule> | null = null;
const sessions = new Map<string, UiSession>();
let gcTimer: NodeJS.Timeout | null = null;

async function loadPlaywright(): Promise<PWModule> {
  if (!pwPromise) {
    pwPromise = (async () => {
      try {
        return await import('playwright');
      } catch (err: any) {
        throw new Error(
          'reframe_ui: playwright is not installed. Run `npm install playwright` ' +
          'and `npx playwright install chromium` at the repo root, then retry. ' +
          `Underlying error: ${err?.message ?? err}`,
        );
      }
    })();
  }
  return pwPromise;
}

async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) return browser;
  const pw = await loadPlaywright();
  // REFRAME_UI_HEADED=1 flips headless off so a human can watch the
  // agent drive the browser — invaluable for first-run debugging.
  const headed = process.env.REFRAME_UI_HEADED === '1';
  browser = await pw.chromium.launch({ headless: !headed });
  return browser;
}

export interface OpenOptions {
  url: string;
  viewport?: { width: number; height: number };
}

export async function openSession(opts: OpenOptions): Promise<UiSession> {
  // Slug collision guard — reject up front if another live session owns
  // the same project. Done BEFORE the Playwright context is created so we
  // don't waste a Chromium context on a call that's about to fail.
  const projectSlug = parseProjectSlug(opts.url);
  if (projectSlug) {
    for (const existing of sessions.values()) {
      if (existing.projectSlug === projectSlug) {
        throw new SlugInUseError(projectSlug, existing.id);
      }
    }
  }

  // Evict oldest if we're at the cap. Keeps browser memory bounded even
  // when an over-enthusiastic agent forgets to close what it opened.
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = [...sessions.values()].sort((a, b) => a.lastActiveAt - b.lastActiveAt)[0];
    if (oldest) await closeSession(oldest.id);
  }

  const b = await getBrowser();
  const ctx = await b.newContext({ viewport: opts.viewport ?? { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const id = `ui_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const session: UiSession = {
    id, page,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    projectSlug,
    consoleLog: [],
    pageErrors: [],
    networkErrors: [],
  };

  page.on('console', (msg) => {
    pushBounded(session.consoleLog, { type: msg.type(), text: msg.text(), at: Date.now() });
  });
  page.on('pageerror', (err) => {
    pushBounded(session.pageErrors, { message: err.message, stack: err.stack, at: Date.now() });
  });
  page.on('requestfailed', (req) => {
    const failure = req.failure()?.errorText ?? '';
    // Skip benign aborts: SSE /events gets cancelled when the browser
    // navigates away, fetches from closed pages abort, etc. These
    // aren't bugs but flood the "network failures" log.
    if (failure.includes('ERR_ABORTED') || failure.includes('NS_BINDING_ABORTED')) return;
    pushBounded(session.networkErrors, {
      url: req.url(),
      failure,
      at: Date.now(),
    });
  });
  page.on('response', (res) => {
    const status = res.status();
    if (status >= 400) {
      pushBounded(session.networkErrors, { url: res.url(), status, at: Date.now() });
    }
  });

  sessions.set(id, session);
  ensureGc();

  await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  // A short settle lets late-paint work finish before the first screenshot
  // — CanvasKit initializing in the Platform bootstrap is the common case.
  await page.waitForTimeout(150);
  return session;
}

export function getSession(id: string): UiSession | null {
  return sessions.get(id) ?? null;
}

export function listSessions(): UiSession[] {
  return [...sessions.values()];
}

export async function closeSession(id: string): Promise<void> {
  const s = sessions.get(id);
  if (!s) return;
  try {
    await s.page.context().close();
  } catch { /* already gone */ }
  sessions.delete(id);
  // If the last session just died, tear down the browser too. Saves
  // ~200 MB RSS when no one's actively using reframe_ui.
  if (sessions.size === 0 && browser) {
    try { await browser.close(); } catch { /* already gone */ }
    browser = null;
    if (gcTimer) { clearInterval(gcTimer); gcTimer = null; }
  }
}

export function touchSession(id: string): void {
  const s = sessions.get(id);
  if (s) s.lastActiveAt = Date.now();
}

export interface DrainedLogs {
  console: ConsoleEntry[];
  pageErrors: ErrorEntry[];
  networkErrors: NetworkErrorEntry[];
}

export function drainLogs(session: UiSession): DrainedLogs {
  const out: DrainedLogs = {
    console: session.consoleLog.slice(),
    pageErrors: session.pageErrors.slice(),
    networkErrors: session.networkErrors.slice(),
  };
  session.consoleLog.length = 0;
  session.pageErrors.length = 0;
  session.networkErrors.length = 0;
  return out;
}

function pushBounded<T>(buf: T[], item: T): void {
  buf.push(item);
  while (buf.length > LOG_BUFFER_SIZE) buf.shift();
}

function ensureGc(): void {
  if (gcTimer) return;
  const handle = setInterval(() => {
    const now = Date.now();
    const expired: string[] = [];
    for (const [id, s] of sessions) {
      if (now - s.lastActiveAt > IDLE_TIMEOUT_MS) expired.push(id);
    }
    for (const id of expired) { closeSession(id).catch(() => {}); }
  }, 60_000) as unknown as NodeJS.Timeout;
  gcTimer = handle;
  // Don't keep the Node process alive just for the GC ticker.
  if (typeof handle.unref === 'function') handle.unref();
}

export function formatLogs(logs: DrainedLogs): string {
  const lines: string[] = [];
  const interesting = logs.console.filter(c => c.type === 'error' || c.type === 'warning');
  if (interesting.length) {
    lines.push(`console: ${interesting.length} error/warning${interesting.length === 1 ? '' : 's'}`);
    for (const c of interesting.slice(0, 8)) lines.push(`  [${c.type}] ${c.text.slice(0, 240)}`);
  }
  if (logs.pageErrors.length) {
    lines.push(`page errors: ${logs.pageErrors.length}`);
    for (const e of logs.pageErrors.slice(0, 5)) lines.push(`  ${e.message.slice(0, 240)}`);
  }
  if (logs.networkErrors.length) {
    lines.push(`network failures: ${logs.networkErrors.length}`);
    for (const n of logs.networkErrors.slice(0, 5)) {
      lines.push(`  ${n.status ?? n.failure ?? 'failed'}  ${n.url.slice(0, 160)}`);
    }
  }
  return lines.join('\n');
}
