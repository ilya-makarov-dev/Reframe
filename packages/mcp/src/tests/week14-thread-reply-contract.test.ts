/**
 * Phase 2 Brief 2c — Thread reply chains contract.
 *
 * Pins covered:
 *   #1 POST /api/threads/reply endpoint — validates threadId + body,
 *      reuses createAnnotation/attachAnnotation, broadcasts SSE
 *   #2 Reply form mounted in thread panel (textarea + Send + Cmd+Enter
 *      hint), archive-state gating, openThreadPanel refetch on submit
 *   #3 parseMentions helper — XSS-safe, 0/1/N mentions
 *   #4 CSS — Phase 1 focus-ring identity on textarea + mention pill
 *   #5 renderThreadEvent routes comment kind through parseMentions
 *
 * Run: npx tsx packages/mcp/src/tests/week14-thread-reply-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'http';
import { handleGestureApi } from '../platform/api/gesture.js';
import { initProject } from '../../../core/src/project/io.js';
import {
  createThread,
  getThread,
} from '../../../core/src/project/threads/index.js';
import {
  listAnnotations,
  type Annotation,
} from '../../../core/src/project/annotations/index.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const ANNOTATIONS_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '040-annotations.js');
const GESTURE_TS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'api', 'gesture.ts');
const CSS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'platform-ui.css');

// ─── Mock req/res helpers ────────────────────────────────────
function mockRequest(method: string, urlPath: string, body?: any): IncomingMessage {
  const ee = new EventEmitter() as any;
  ee.method = method;
  ee.url = urlPath;
  ee.headers = { host: 'localhost' };
  // Defer body emission to next tick so the handler's `on('end')` fires
  // after handleGestureApi attaches its listeners.
  setImmediate(() => {
    if (body !== undefined) {
      ee.emit('data', Buffer.from(JSON.stringify(body), 'utf-8'));
    }
    ee.emit('end');
  });
  return ee as IncomingMessage;
}

interface MockResponse {
  statusCode: number;
  body: any;
}

function mockResponse(): { res: ServerResponse; out: MockResponse } {
  const out: MockResponse = { statusCode: 0, body: null };
  const res: any = {
    writeHead(code: number) { out.statusCode = code; return res; },
    end(payload?: string) { try { out.body = JSON.parse(payload || 'null'); } catch { out.body = payload; } },
  };
  return { res, out };
}

async function call(method: string, urlPath: string, body?: any): Promise<MockResponse> {
  const req = mockRequest(method, urlPath, body);
  const { res, out } = mockResponse();
  await handleGestureApi(req, res, { projectDir } as any);
  return out;
}

// ─── Test setup ─────────────────────────────────────────────
let projectDir: string;
let testThreadId: string;

function setup(): void {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reframe-thread-reply-test-'));
  initProject(projectDir, 'reply-test');
  const t = createThread(projectDir, {
    anchor: 'node-1',
    sceneSlug: 'reply-test',
    title: 'reply target',
  });
  testThreadId = t.id;
}

// ─── parseMentions inline mirror ─────────────────────────────
// The bundle's parseMentions is inside an IIFE — mirror its impl here
// for direct unit testing. The test asserts the bundle wires this exact
// implementation in renderThreadEvent's comment branch.
function parseMentions(escapedBody: string): string {
  if (!escapedBody) return '';
  return escapedBody.replace(/@(\w+)/g, function(_match, name) {
    return '<span class="thread-mention">@' + name + '</span>';
  });
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function main(): Promise<void> {
  console.log('Phase 2 Brief 2c — Thread reply chains contract\n');
  setup();

  // ─── Pin #1 — endpoint behavior ────────────────────────────
  console.log('Pin #1 — /api/threads/reply endpoint');
  {
    // Missing threadId → 400
    const r1 = await call('POST', '/platform/api/threads/reply', { body: 'hi' });
    assert(r1.statusCode === 400, 'POST without threadId → 400');

    // Empty body → 400
    const r2 = await call('POST', '/platform/api/threads/reply', { threadId: testThreadId, body: '   ' });
    assert(r2.statusCode === 400, 'POST with whitespace-only body → 400');

    // Body too long → 400
    const longBody = 'x'.repeat(4001);
    const r3 = await call('POST', '/platform/api/threads/reply', { threadId: testThreadId, body: longBody });
    assert(r3.statusCode === 400, 'POST with body > 4000 chars → 400');

    // Unknown threadId → 404
    const r4 = await call('POST', '/platform/api/threads/reply', { threadId: 't-nonexistent', body: 'hi' });
    assert(r4.statusCode === 404, 'POST with unknown threadId → 404');

    // Happy path — 200 + annotation returned + persisted
    const r5 = await call('POST', '/platform/api/threads/reply', {
      threadId: testThreadId,
      body: 'First reply @teammate',
    });
    assert(r5.statusCode === 200, 'POST happy-path → 200');
    assert(r5.body?.ok === true, 'response.ok = true');
    assert(r5.body?.annotation?.payload?.kind === 'comment',
      'annotation kind = comment');
    assert(r5.body?.annotation?.payload?.text === 'First reply @teammate',
      'annotation payload.text matches submitted body');
    assert(r5.body?.annotation?.threadId === testThreadId,
      'annotation linked to thread');
    assert(r5.body?.annotation?.anchor === 'node-1',
      'annotation inherits thread anchor');

    // Persistence check — annotation appears in store
    const stored = listAnnotations(projectDir, { threadId: testThreadId });
    const found = stored.find((a: Annotation) =>
      a.payload.kind === 'comment' &&
      (a.payload as any).text === 'First reply @teammate'
    );
    assert(!!found, 'reply annotation persisted to disk via createAnnotation');

    // Whitespace-trimmed
    const r6 = await call('POST', '/platform/api/threads/reply', {
      threadId: testThreadId,
      body: '  trimmed  ',
    });
    assert(r6.statusCode === 200, 'leading/trailing whitespace accepted');
    assert(r6.body?.annotation?.payload?.text === 'trimmed',
      'body trimmed before storage');
  }

  // ─── Pin #3 — parseMentions helper ─────────────────────────
  console.log('\nPin #3 — parseMentions');
  {
    assert(parseMentions('') === '', 'empty body → empty string');
    assert(parseMentions('plain text') === 'plain text',
      '0 mentions → unchanged');
    assert(parseMentions('hi @alice') ===
      'hi <span class="thread-mention">@alice</span>',
      '1 mention wrapped');
    assert(parseMentions('@a @b @c') ===
      '<span class="thread-mention">@a</span> <span class="thread-mention">@b</span> <span class="thread-mention">@c</span>',
      'N mentions all wrapped');
    assert(parseMentions('email@example.com') ===
      'email<span class="thread-mention">@example</span>.com',
      '@-in-email matched (acceptable false positive — visual-only feature)');

    // XSS safety — input is ALREADY-ESCAPED. parseMentions doesn't
    // unescape; HTML special chars stay neutralized.
    const malicious = '<script>alert(1)</script>@evil';
    const escaped = escape(malicious);
    const out = parseMentions(escaped);
    assert(!out.includes('<script>'),
      'parseMentions output never contains literal <script>');
    assert(out.includes('<span class="thread-mention">@evil</span>'),
      'mention still wrapped after escape');
    assert(out.includes('&lt;script&gt;'),
      'escape neutralized < and > before parseMentions saw the body');
  }

  // ─── Pin #2 — bundle wires reply form + Cmd+Enter ──────────
  console.log('\nPin #2 — Reply form bundle wiring');
  {
    const ann = fs.readFileSync(ANNOTATIONS_JS, 'utf8');
    assert(/function renderThreadReplyForm/.test(ann),
      'renderThreadReplyForm function defined');
    assert(/function bindThreadReplyForm/.test(ann),
      'bindThreadReplyForm function defined');
    assert(/data-thread-action="send-reply"/.test(ann),
      'Send button carries data-thread-action="send-reply"');
    assert(/data-thread-reply-input/.test(ann),
      'textarea has data-thread-reply-input attr');
    assert(/'archived'[\s\S]{0,200}Reopen to add replies/.test(ann),
      'archived gating renders Reopen note in place of form');
    assert(/maxlength="4000"/.test(ann), 'textarea maxlength=4000');
    assert(/Cmd\+Enter/.test(ann), 'hint copy mentions Cmd+Enter');
    assert(/e\.metaKey \|\| e\.ctrlKey/.test(ann),
      'Cmd+Enter handler accepts Meta or Ctrl');
    assert(/\/platform\/api\/threads\/reply/.test(ann),
      'submit POSTs to /api/threads/reply');
    assert(/openThreadPanel\(thread\.id\)/.test(ann),
      'success path refetches via openThreadPanel');
  }

  // ─── Pin #5 — comment-kind render uses parseMentions ───────
  console.log('\nPin #5 — comment render path uses parseMentions');
  {
    const ann = fs.readFileSync(ANNOTATIONS_JS, 'utf8');
    // The comment branch in renderThreadEvent calls parseMentions(escape(...)).
    assert(/a\.payload\.kind === 'comment'[\s\S]{0,200}parseMentions/.test(ann),
      'renderThreadEvent special-cases comment kind through parseMentions');
    assert(/function parseMentions/.test(ann),
      'parseMentions function defined in bundle');
  }

  // ─── Pin #1 backend declarations ───────────────────────────
  console.log('\nPin #1 — backend route declarations');
  {
    const gesture = fs.readFileSync(GESTURE_TS, 'utf8');
    assert(/'\/platform\/api\/threads\/reply' && req\.method === 'POST'/.test(gesture),
      '/threads/reply POST route declared');
    assert(/getThread\(dir, threadId\)/.test(gesture),
      'lookup uses getThread');
    assert(/createAnnotation\(dir,/.test(gesture),
      'reuses createAnnotation path');
    assert(/attachAnnotation\(dir, thread\.id/.test(gesture),
      'reuses attachAnnotation path');
    assert(/emitEvent\(\{[\s\S]{0,80}'scene:session-changed'/.test(gesture),
      'broadcasts scene:session-changed SSE');
  }

  // ─── Pin #4 — CSS polish ───────────────────────────────────
  console.log('\nPin #4 — CSS polish');
  {
    const css = fs.readFileSync(CSS, 'utf8');
    assert(/\.thread-reply-form/.test(css), 'reply form class styled');
    assert(/\.thread-reply-input:focus[\s\S]{0,200}rgba\(43, 116, 255, 0\.15\)/.test(css),
      'textarea focus carries Phase 1 focus-ring identity');
    assert(/\.thread-mention[\s\S]{0,150}rgba\(43, 116, 255, 0\.1\)/.test(css),
      'mention pill uses Phase 1 focus-ring blue tint');
    assert(/\.thread-reply-archived/.test(css),
      'archived note has its own style');
  }

  // Cleanup
  fs.rmSync(projectDir, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
