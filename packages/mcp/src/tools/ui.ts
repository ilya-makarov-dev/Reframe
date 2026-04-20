/**
 * reframe_ui — drive the Platform UI in a real browser via Playwright.
 *
 * Mirrors what reframe_compile/inspect/edit do for the engine: a
 * stateful, tool-call-scoped surface that lets an agent (human or
 * Claude) open a page, click through a flow, read the DOM, grab
 * screenshots, and pull console / network errors. Every mutating
 * action returns an inline PNG so a multimodal agent sees exactly
 * what the browser just rendered.
 *
 * Actions
 *   open       launch a session on /platform/... → { sessionId, png, logs }
 *   act        apply a sequence of click/type/press/scroll/wait/goto
 *              ops in one call, return final png + drained logs
 *   probe      querySelector (one or all) + optional page.evaluate(js)
 *   screenshot current viewport or full page as inline PNG
 *   wait       block until selector reaches a state
 *   close      tear down one session
 *   list       enumerate active sessions
 *
 * Sessions live in memory in the MCP process. They are sticky across
 * tool calls because the MCP server is long-running (stdio or HTTP
 * sidecar). 15-min idle GC reclaims memory; closing the last session
 * shuts the browser back down.
 *
 * Set REFRAME_UI_HEADED=1 in the environment to watch the browser
 * drive itself — the fastest way to debug why an action failed.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import {
  openSession, getSession, listSessions, closeSession, touchSession,
  drainLogs, formatLogs,
  type UiSession,
} from './ui-session.js';
import { getWorkspaceRoot } from '../store.js';

type Page = import('playwright').Page;

// ─── Page-side scripts (raw strings, not TS functions) ───────
//
// tsx / esbuild inject a `__name(fn, "name")` helper around nested arrow
// functions to preserve .name for source-map / dev tooling. That helper
// does not exist inside the page JS context, so any page.evaluate that
// receives a TS-authored function crashes with `ReferenceError: __name`.
// Passing a raw string keeps Playwright's eval path identical to what a
// hand-written `new Function` would produce — zero transformer surface.

const PROBE_SELECTOR_SCRIPT = `(({ selector, getStyle }) => {
  const nodes = Array.from(document.querySelectorAll(selector));
  return nodes.map(function (el) {
    var r = el.getBoundingClientRect();
    var attrs = {};
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      attrs[a.name] = a.value;
    }
    var base = {
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200),
      html: el.outerHTML.slice(0, 500),
      bbox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      attrs: attrs,
    };
    if (getStyle) {
      var cs = window.getComputedStyle(el);
      base.computedStyle = {
        display: cs.display, position: cs.position,
        font: cs.fontWeight + ' ' + cs.fontSize + ' / ' + cs.lineHeight + ' ' + cs.fontFamily.replace(/["']/g, ''),
        color: cs.color, background: cs.backgroundColor,
        border: cs.borderWidth + ' ' + cs.borderStyle + ' ' + cs.borderColor,
        padding: cs.padding, margin: cs.margin, borderRadius: cs.borderRadius,
        opacity: cs.opacity, zIndex: cs.zIndex,
        transform: cs.transform === 'none' ? undefined : cs.transform,
      };
    }
    return base;
  });
})`;

const PROBE_AT_SCRIPT = `((p) => {
  var e = document.elementFromPoint(p.x, p.y);
  if (!e) return null;
  var r = e.getBoundingClientRect();
  var path = [];
  var cur = e;
  for (var i = 0; i < 8 && cur; i++) {
    var tag = cur.tagName.toLowerCase();
    var id = cur.id ? '#' + cur.id : '';
    var cls = cur.classList.length ? '.' + Array.from(cur.classList).slice(0, 3).join('.') : '';
    path.unshift(tag + id + cls);
    cur = cur.parentElement;
  }
  var attrs = {};
  for (var i = 0; i < e.attributes.length; i++) {
    var a = e.attributes[i];
    attrs[a.name] = a.value;
  }
  return {
    tag: e.tagName.toLowerCase(),
    text: (e.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200),
    html: e.outerHTML.slice(0, 500),
    bbox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    attrs: attrs,
    ancestorPath: path.join(' > '),
  };
})`;

// ─── Schema ──────────────────────────────────────────────────

const KEY_MODIFIERS = ['Alt', 'Control', 'Meta', 'Shift'] as const;

const stepSchema = z.object({
  op: z.enum([
    // basic interaction
    'click', 'type', 'press', 'scroll', 'hover', 'wait', 'goto',
    // canvas + drag + form
    'clickAt', 'dragAt', 'drag', 'select', 'upload', 'reload',
  ]),
  selector: z.string().optional().describe('CSS selector — required for click/type/hover/wait/clickAt/dragAt/select/upload; for drag this is the SOURCE'),
  targetSelector: z.string().optional().describe('For op=drag: the drop-target CSS selector'),
  text: z.string().optional().describe('For op=type: the text to fill into the selector'),
  key: z.string().optional().describe('For op=press: keyboard key (e.g. "Enter", "Escape", "ArrowDown", "e")'),
  modifiers: z.array(z.enum(KEY_MODIFIERS)).optional().describe('For op=press / op=click: held modifier keys. Use "Meta" for Cmd on macOS, "Control" on Windows/Linux. Example: press { key: "e", modifiers: ["Meta"] } for Cmd+E.'),
  button: z.enum(['left', 'right', 'middle']).optional().describe('For op=click / op=clickAt: mouse button (default "left"). Use "right" for context menus / ПКМ catalog.'),
  clickCount: z.number().int().min(1).max(3).optional().describe('For op=click / op=clickAt: 1 = single, 2 = double, 3 = triple'),
  x: z.number().optional().describe('For op=clickAt / op=dragAt: X coordinate inside the selector element'),
  y: z.number().optional().describe('For op=scroll: pixel delta (positive = down). For op=clickAt / op=dragAt: Y coordinate inside the selector element.'),
  from: z.object({ x: z.number(), y: z.number() }).optional().describe('For op=dragAt: start point inside the selector'),
  to: z.object({ x: z.number(), y: z.number() }).optional().describe('For op=dragAt: end point inside the selector'),
  value: z.string().optional().describe('For op=select: <option> value or visible label to choose'),
  files: z.array(z.string()).optional().describe('For op=upload: absolute file paths to set on a file input'),
  state: z.enum(['attached', 'detached', 'visible', 'hidden']).optional().describe('For op=wait: target state (default "visible")'),
  url: z.string().optional().describe('For op=goto: absolute URL or /platform/... path'),
  timeout: z.number().optional().describe('Per-step timeout in ms (default 5000)'),
});

export const uiInputSchema = {
  action: z.enum([
    'open', 'act', 'probe', 'screenshot', 'wait', 'close', 'list',
    'setViewport', 'state', 'reload', 'scene',
  ]).describe(
    'open = launch browser session, navigate to path. ' +
    'act = run a sequence of interaction steps (click/type/press/scroll/hover/wait/goto/clickAt/dragAt/drag/select/upload/reload). ' +
    'probe = querySelector (one or all) + elementFromPoint + page.evaluate. ' +
    'screenshot = inline PNG of current viewport, selector clip, or full page. ' +
    'wait = block until selector hits state. ' +
    'close = tear down session. list = enumerate active sessions. ' +
    'setViewport = resize current session\'s viewport without reopening. ' +
    'state = read / write / clear localStorage + sessionStorage + cookies. ' +
    'reload = refresh the current page. ' +
    'scene = dump the active Platform scene: SceneGraph tree, live audit, selected node, brand, viewport tag. One call to understand "what the user is looking at" — no DOM digging required.',
  ),
  sessionId: z.string().optional().describe(
    'Required for act/probe/screenshot/wait/close. Returned by open.',
  ),
  path: z.string().optional().describe(
    'open only — absolute URL or /platform/... path relative to the local sidecar (default /platform).',
  ),
  viewport: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }).optional().describe(
    'open only — browser viewport size. Default 1440x900. Use 390x844 for mobile, 768x1024 for tablet, 1920x1200 for ultrawide.',
  ),
  steps: z.array(stepSchema).optional().describe(
    'act only — ordered list of interaction steps. First failure aborts the rest.',
  ),
  selector: z.string().optional().describe(
    'probe / wait — CSS selector to match.',
  ),
  js: z.string().optional().describe(
    'probe only — JavaScript expression to evaluate in the page. Result is JSON-serialized. Use for computed styles, window.* globals, arbitrary DOM logic that selectors can\'t express.',
  ),
  all: z.boolean().optional().describe(
    'probe only — when true, return every matching element. Default returns the first match only.',
  ),
  fullPage: z.boolean().optional().describe(
    'screenshot only — capture the full scroll height, not just the viewport.',
  ),
  state: z.enum(['visible', 'hidden', 'attached', 'detached']).optional().describe(
    'wait only — state to wait for. Default "visible".',
  ),
  timeout: z.number().optional().describe(
    'wait only — timeout in ms. Default 5000.',
  ),
  // probe extensions
  at: z.object({ x: z.number(), y: z.number() }).optional().describe(
    'probe only — run document.elementFromPoint(x, y) and return the element underneath. Pair with a screenshot to go from "I see a bug at (300, 420)" to "it\'s the `.right-rail button.primary` button".',
  ),
  getStyle: z.boolean().optional().describe(
    'probe only — include `computedStyle` snapshot (font/color/border/display/…) on every returned element. Heavier payload; use when selector + bbox alone don\'t explain a visual bug.',
  ),
  // screenshot extensions
  omitBackground: z.boolean().optional().describe(
    'screenshot only — render with a transparent backdrop. Only meaningful when the document body has no opaque fill.',
  ),
  // state action
  stateOp: z.enum(['get', 'set', 'clear']).optional().describe(
    'state only — "get" reads current storage + cookies, "set" writes them, "clear" wipes all of the session\'s per-origin state.',
  ),
  localStorage: z.record(z.string()).optional().describe(
    'state only — for op=set: key→value map written into window.localStorage.',
  ),
  sessionStorage: z.record(z.string()).optional().describe(
    'state only — for op=set: key→value map written into window.sessionStorage.',
  ),
  cookies: z.array(z.object({
    name: z.string(),
    value: z.string(),
    domain: z.string().optional(),
    path: z.string().optional(),
    expires: z.number().optional(),
    httpOnly: z.boolean().optional(),
    secure: z.boolean().optional(),
    sameSite: z.enum(['Strict', 'Lax', 'None']).optional(),
  })).optional().describe(
    'state only — for op=set: cookie objects written via browser context.',
  ),
};

type StepDef = z.infer<typeof stepSchema>;

type UiInput = {
  action: 'open' | 'act' | 'probe' | 'screenshot' | 'wait' | 'close' | 'list'
        | 'setViewport' | 'state' | 'reload' | 'scene';
  sessionId?: string;
  path?: string;
  viewport?: { width: number; height: number };
  steps?: StepDef[];
  selector?: string;
  js?: string;
  all?: boolean;
  fullPage?: boolean;
  state?: 'visible' | 'hidden' | 'attached' | 'detached';
  timeout?: number;
  at?: { x: number; y: number };
  getStyle?: boolean;
  omitBackground?: boolean;
  stateOp?: 'get' | 'set' | 'clear';
  localStorage?: Record<string, string>;
  sessionStorage?: Record<string, string>;
  cookies?: Array<{
    name: string; value: string; domain?: string; path?: string;
    expires?: number; httpOnly?: boolean; secure?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
  }>;
};

// ─── Handler ─────────────────────────────────────────────────

export async function handleUi(input: UiInput) {
  try {
    switch (input.action) {
      case 'open':        return await doOpen(input);
      case 'act':         return await doAct(input);
      case 'probe':       return await doProbe(input);
      case 'screenshot':  return await doScreenshot(input);
      case 'wait':        return await doWait(input);
      case 'close':       return await doClose(input);
      case 'list':        return await doList();
      case 'setViewport': return await doSetViewport(input);
      case 'state':       return await doState(input);
      case 'reload':      return await doReload(input);
      case 'scene':       return await doScene(input);
    }
  } catch (e: any) {
    return text(`reframe_ui ${input.action} ERROR: ${e?.message ?? e}`);
  }
}

// ─── Actions ─────────────────────────────────────────────────

async function doOpen(input: UiInput) {
  const path = input.path ?? '/platform';
  const url = resolveUrl(path);
  const s = await openSession({ url, viewport: input.viewport });
  const logs = drainLogs(s);
  const png = await screenshot(s.page, false);
  const head = [
    `Opened session ${s.id}`,
    `  url: ${s.page.url()}`,
    `  title: ${await safeTitle(s.page)}`,
    `  viewport: ${input.viewport?.width ?? 1440}x${input.viewport?.height ?? 900}`,
  ];
  const tail = formatLogs(logs);
  return withImage(head.join('\n') + (tail ? '\n' + tail : ''), png);
}

async function doAct(input: UiInput) {
  const s = requireSession(input.sessionId);
  const steps = input.steps ?? [];
  if (steps.length === 0) return text('act: no steps provided');

  const results: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const t0 = Date.now();
    try {
      await runStep(s.page, step);
      results.push(`  [${i + 1}] ${describeStep(step)} ok (${Date.now() - t0}ms)`);
    } catch (e: any) {
      results.push(`  [${i + 1}] ${describeStep(step)} FAIL: ${e?.message ?? e}`);
      break;  // Bail on first failure — later steps probably depend on it.
    }
  }
  touchSession(s.id);
  const png = await screenshot(s.page, false);
  const logs = drainLogs(s);
  const header = `session ${s.id} → ${s.page.url()}\n${results.join('\n')}`;
  const logsText = formatLogs(logs);
  return withImage(header + (logsText ? '\n\n' + logsText : ''), png);
}

async function doProbe(input: UiInput) {
  const s = requireSession(input.sessionId);
  touchSession(s.id);

  const out: any = { url: s.page.url() };
  const withStyle = input.getStyle === true;

  if (input.selector) {
    const all = input.all ?? false;
    // We inline the arg via JSON.stringify so the string IIFE captures
    // it at parse time. page.evaluate(string, arg) doesn't pass the arg
    // when the expression is a raw string — Playwright just evals as-is.
    const arg = JSON.stringify({ selector: input.selector, getStyle: withStyle });
    const els = await s.page.evaluate(`${PROBE_SELECTOR_SCRIPT}(${arg})`);
    out.matchCount = (els as any[]).length;
    out.elements = all ? els : (els as any[]).slice(0, 1);
  }

  // elementFromPoint — the magic selector-discovery path. Turns "I see a
  // bug at pixel (300, 420)" into a full element descriptor.
  if (input.at) {
    const arg = JSON.stringify(input.at);
    const el = await s.page.evaluate(`${PROBE_AT_SCRIPT}(${arg})`);
    out.elementAtPoint = el;
  }

  if (input.js) {
    try {
      out.eval = await s.page.evaluate(input.js);
    } catch (e: any) {
      out.evalError = e?.message ?? String(e);
    }
  }

  if (!input.selector && !input.js && !input.at) {
    out.title = await safeTitle(s.page);
    out.dimensions = await s.page.evaluate(
      `({ innerWidth: window.innerWidth, innerHeight: window.innerHeight, scrollHeight: document.documentElement.scrollHeight, devicePixelRatio: window.devicePixelRatio })`,
    );
  }

  const json = JSON.stringify(out, null, 2);
  return text(json.length > 16000 ? json.slice(0, 16000) + '\n  ... (truncated)' : json);
}

async function doScreenshot(input: UiInput) {
  const s = requireSession(input.sessionId);
  touchSession(s.id);

  // Selector clip: pluck the element's bbox and capture just that rect.
  // Massive win for "screenshot this card so I can eyeball the shadow"
  // without carrying the entire viewport payload.
  if (input.selector) {
    const handle = await s.page.$(input.selector);
    if (!handle) return text(`screenshot: selector ${input.selector} not found`);
    const png = await handle.screenshot({ type: 'png', omitBackground: input.omitBackground ?? false });
    return withImage(`session ${s.id} → clip ${input.selector}`, png);
  }

  const png = await s.page.screenshot({
    type: 'png',
    fullPage: input.fullPage ?? false,
    omitBackground: input.omitBackground ?? false,
  });
  return withImage(`session ${s.id} → ${s.page.url()}${input.fullPage ? ' (fullPage)' : ''}`, png);
}

async function doWait(input: UiInput) {
  const s = requireSession(input.sessionId);
  if (!input.selector) return text('wait: selector required');
  const state = input.state ?? 'visible';
  const timeout = input.timeout ?? 5000;
  try {
    await s.page.waitForSelector(input.selector, { state, timeout });
    touchSession(s.id);
    return text(`wait ok — ${input.selector} is ${state}`);
  } catch (e: any) {
    return text(`wait FAIL — ${input.selector} did not reach ${state} within ${timeout}ms: ${e?.message ?? e}`);
  }
}

async function doClose(input: UiInput) {
  if (!input.sessionId) return text('close: sessionId required');
  await closeSession(input.sessionId);
  return text(`session ${input.sessionId} closed`);
}

async function doSetViewport(input: UiInput) {
  const s = requireSession(input.sessionId);
  if (!input.viewport) return text('setViewport: viewport { width, height } required');
  await s.page.setViewportSize(input.viewport);
  touchSession(s.id);
  // Re-screenshot so the agent sees the reflowed layout immediately.
  const png = await s.page.screenshot({ type: 'png' });
  return withImage(`session ${s.id} → viewport ${input.viewport.width}x${input.viewport.height}`, png);
}

async function doReload(input: UiInput) {
  const s = requireSession(input.sessionId);
  await s.page.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 });
  touchSession(s.id);
  const logs = drainLogs(s);
  const png = await s.page.screenshot({ type: 'png' });
  const header = `session ${s.id} → reload ${s.page.url()}`;
  const logsText = formatLogs(logs);
  return withImage(header + (logsText ? '\n' + logsText : ''), png);
}

async function doState(input: UiInput) {
  const s = requireSession(input.sessionId);
  const op = input.stateOp ?? 'get';
  touchSession(s.id);

  if (op === 'clear') {
    await s.page.evaluate(`(() => {
      try { window.localStorage.clear(); } catch (e) {}
      try { window.sessionStorage.clear(); } catch (e) {}
    })()`);
    const ctx = s.page.context();
    await ctx.clearCookies();
    return text(`session ${s.id} → localStorage, sessionStorage, cookies cleared`);
  }

  if (op === 'set') {
    // Storage must be written in-page. Cookies go through the browser
    // context (respecting domain/path/expiry) via addCookies.
    if (input.localStorage) {
      const kv = JSON.stringify(input.localStorage);
      await s.page.evaluate(
        `((v) => { for (var k in v) window.localStorage.setItem(k, v[k]); })(${kv})`,
      );
    }
    if (input.sessionStorage) {
      const kv = JSON.stringify(input.sessionStorage);
      await s.page.evaluate(
        `((v) => { for (var k in v) window.sessionStorage.setItem(k, v[k]); })(${kv})`,
      );
    }
    if (input.cookies) {
      const ctx = s.page.context();
      const url = s.page.url();
      const normalized = input.cookies.map((c) => ({
        ...c,
        // Playwright requires either url OR (domain + path). Default
        // to the current page URL if the caller didn't specify either.
        url: c.domain ? undefined : url,
      }));
      await ctx.addCookies(normalized as any);
    }
    const counts = [
      input.localStorage ? `localStorage=${Object.keys(input.localStorage).length}` : null,
      input.sessionStorage ? `sessionStorage=${Object.keys(input.sessionStorage).length}` : null,
      input.cookies ? `cookies=${input.cookies.length}` : null,
    ].filter(Boolean);
    return text(`session ${s.id} → wrote ${counts.join(', ') || 'nothing (no fields provided)'}`);
  }

  // op === 'get'
  const snapshot = await s.page.evaluate(`(() => {
    var ls = {};
    for (var i = 0; i < window.localStorage.length; i++) {
      var k = window.localStorage.key(i);
      if (k) ls[k] = window.localStorage.getItem(k) || '';
    }
    var ss = {};
    for (var j = 0; j < window.sessionStorage.length; j++) {
      var k2 = window.sessionStorage.key(j);
      if (k2) ss[k2] = window.sessionStorage.getItem(k2) || '';
    }
    return { localStorage: ls, sessionStorage: ss };
  })()`) as { localStorage: Record<string, string>; sessionStorage: Record<string, string> };
  const cookies = await s.page.context().cookies();
  return text(JSON.stringify({ url: s.page.url(), ...snapshot, cookies }, null, 2).slice(0, 16000));
}

async function doScene(input: UiInput) {
  const s = requireSession(input.sessionId);
  touchSession(s.id);

  // Pull the Platform scene context in-page. The canvas element carries
  // `data-session`, the bottom chat pill holds the active viewport tag,
  // the LAYERS panel has the selected node's id on `.layer-item.selected`,
  // and the right-panel header shows the brand (if loaded).
  const ctx = await s.page.evaluate(`(() => {
    var canvas = document.getElementById('reframe-viewport') || document.querySelector('.viewport-frame');
    var sessionId = canvas ? (canvas.getAttribute('data-session') || '') : '';
    var selectedEl = document.querySelector('.layer-item.selected, .layer-item.active');
    var selected = selectedEl ? selectedEl.getAttribute('data-layer-node') : null;
    var vpPill = document.querySelector('[data-viewport-tag], .viewport-pill, .chat-viewport');
    var viewport = vpPill ? (vpPill.textContent || '').trim() : 'unknown';
    var brandEl = document.querySelector('[data-brand-label], .brand-name');
    var brand = brandEl ? (brandEl.textContent || '').trim() : null;
    var uiAudit = (function(){
      var el = document.querySelector('.scene-dash-audit-score');
      if (!el) return null;
      var txt = el.textContent || '';
      var findings = Array.from(document.querySelectorAll('.scene-dash-finding')).map(f => (f.textContent||'').trim());
      return { summary: txt.trim(), findings: findings };
    })();
    var layerCount = document.querySelectorAll('.layer-item').length;
    return { sessionId: sessionId, selected: selected, viewport: viewport, brand: brand, uiAudit: uiAudit, layerCount: layerCount };
  })()`) as any;

  const out: any = {
    url: s.page.url(),
    sessionId: ctx.sessionId || null,
    selectedNodeId: ctx.selected,
    viewport: ctx.viewport,
    brand: ctx.brand,
    uiAudit: ctx.uiAudit,
    layerTreeItems: ctx.layerCount,
  };

  // Fetch the authoritative engine-side tree + audit via the platform
  // HTTP API (same endpoints the UI uses). This is what the SCENE
  // actually IS — the UI render is a projection of it.
  if (ctx.sessionId) {
    try {
      const tree = await s.page.evaluate(`fetch('/platform/api/scene/tree?sceneId=' + encodeURIComponent('${ctx.sessionId}')).then(r => r.ok ? r.json() : null)`);
      if (tree) out.tree = summarizeTree((tree as any).tree ?? tree);
    } catch { /* best-effort */ }
    try {
      const audit = await s.page.evaluate(`fetch('/platform/api/audit?sceneId=' + encodeURIComponent('${ctx.sessionId}')).then(r => r.ok ? r.json() : null)`);
      if (audit) {
        const a = audit as any;
        out.audit = {
          score: a.score,
          counts: a.counts,
          topFindings: (a.findings ?? []).slice(0, 12).map((f: any) => ({
            severity: f.severity, rule: f.rule, node: f.nodeName, message: f.message?.slice(0, 160),
          })),
        };
      }
    } catch { /* best-effort */ }
  }

  const json = JSON.stringify(out, null, 2);
  return text(json.length > 16000 ? json.slice(0, 16000) + '\n  ... (truncated)' : json);
}

function summarizeTree(node: any, depth = 0, maxDepth = 10, maxChildren = 20): any {
  if (!node || depth > maxDepth) return null;
  const children = Array.isArray(node.children) ? node.children : [];
  const shown = children.slice(0, maxChildren).map((c: any) => summarizeTree(c, depth + 1, maxDepth, maxChildren)).filter(Boolean);
  const overflow = children.length > maxChildren ? children.length - maxChildren : 0;
  return {
    id: node.id,
    name: node.name,
    type: node.type ?? node.sourceTag,
    bbox: node.width != null ? { w: Math.round(node.width), h: Math.round(node.height) } : undefined,
    children: shown.length ? (overflow ? [...shown, { more: overflow }] : shown) : undefined,
  };
}

async function doList() {
  const all = listSessions();
  if (all.length === 0) return text('no active sessions. Call reframe_ui { action: "open" } to start one.');
  const lines = ['Active sessions:'];
  for (const s of all) {
    const ageSec = Math.round((Date.now() - s.createdAt) / 1000);
    const idleSec = Math.round((Date.now() - s.lastActiveAt) / 1000);
    lines.push(`  ${s.id}  url=${s.page.url()}  age=${ageSec}s  idle=${idleSec}s`);
  }
  return text(lines.join('\n'));
}

// ─── Helpers ─────────────────────────────────────────────────

async function runStep(page: Page, step: z.infer<typeof stepSchema>): Promise<void> {
  const timeout = step.timeout ?? 5000;
  switch (step.op) {
    case 'click': {
      if (!step.selector) throw new Error('click: selector required');
      await page.click(step.selector, {
        timeout,
        button: step.button ?? 'left',
        clickCount: step.clickCount ?? 1,
        modifiers: step.modifiers as any,
      });
      break;
    }
    case 'type':
      if (!step.selector) throw new Error('type: selector required');
      await page.fill(step.selector, step.text ?? '', { timeout });
      break;
    case 'press': {
      if (!step.key) throw new Error('press: key required');
      // Compose shortcut strings like "Meta+e" / "Control+Shift+K" so
      // Playwright treats them as a single chord (proper keydown/keyup
      // ordering — critical for apps that listen for accelerators).
      const chord = step.modifiers && step.modifiers.length
        ? [...step.modifiers, step.key].join('+')
        : step.key;
      await page.keyboard.press(chord);
      break;
    }
    case 'scroll':
      await page.evaluate(`window.scrollBy(0, ${step.y ?? 300})`);
      break;
    case 'hover':
      if (!step.selector) throw new Error('hover: selector required');
      await page.hover(step.selector, { timeout });
      break;
    case 'wait':
      if (!step.selector) throw new Error('wait: selector required');
      await page.waitForSelector(step.selector, { state: step.state ?? 'visible', timeout });
      break;
    case 'goto':
      if (!step.url) throw new Error('goto: url required');
      await page.goto(resolveUrl(step.url), { waitUntil: 'domcontentloaded', timeout: 15_000 });
      break;
    case 'reload':
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 });
      break;
    case 'clickAt': {
      // Click at a pixel INSIDE a selector's bbox. Essential for canvas
      // surfaces (CanvasKit viewport, Figma-style drag handles) where
      // there's no DOM child to target with a selector.
      if (!step.selector) throw new Error('clickAt: selector required');
      if (step.x === undefined || step.y === undefined) throw new Error('clickAt: x and y required');
      const handle = await page.waitForSelector(step.selector, { state: 'visible', timeout });
      const box = await handle.boundingBox();
      if (!box) throw new Error(`clickAt: ${step.selector} has no bounding box`);
      await page.mouse.click(box.x + step.x, box.y + step.y, {
        button: step.button ?? 'left',
        clickCount: step.clickCount ?? 1,
      });
      break;
    }
    case 'dragAt': {
      // Drag from (fromX, fromY) to (toX, toY) inside a selector — for
      // canvas rubber-band selection, node drag, resize handles.
      if (!step.selector) throw new Error('dragAt: selector required');
      const from = step.from ?? (step.x !== undefined && step.y !== undefined ? { x: step.x, y: step.y } : null);
      const to = step.to;
      if (!from || !to) throw new Error('dragAt: from {x,y} and to {x,y} required');
      const handle = await page.waitForSelector(step.selector, { state: 'visible', timeout });
      const box = await handle.boundingBox();
      if (!box) throw new Error(`dragAt: ${step.selector} has no bounding box`);
      await page.mouse.move(box.x + from.x, box.y + from.y);
      await page.mouse.down();
      // Split the move into steps so apps with pointermove listeners
      // (drag-to-select, connector routing) see intermediate samples.
      await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 10 });
      await page.mouse.up();
      break;
    }
    case 'drag': {
      // DOM-level drag-and-drop from one selector to another. Playwright
      // synthesizes pointerdown/pointermove/pointerup + drag events in
      // the right order. Use this for list-reorder / DnD zones.
      if (!step.selector) throw new Error('drag: selector (source) required');
      if (!step.targetSelector) throw new Error('drag: targetSelector (drop zone) required');
      await page.dragAndDrop(step.selector, step.targetSelector, { timeout });
      break;
    }
    case 'select': {
      if (!step.selector) throw new Error('select: selector required');
      if (step.value === undefined) throw new Error('select: value required');
      await page.selectOption(step.selector, step.value, { timeout });
      break;
    }
    case 'upload': {
      if (!step.selector) throw new Error('upload: selector required');
      if (!step.files || step.files.length === 0) throw new Error('upload: files array required');
      await page.setInputFiles(step.selector, step.files, { timeout });
      break;
    }
  }
}

function describeStep(step: StepDef): string {
  const mod = step.modifiers?.length ? step.modifiers.join('+') + '+' : '';
  switch (step.op) {
    case 'click':    return `click ${mod}${step.button ?? 'left'}${(step.clickCount ?? 1) > 1 ? 'x' + step.clickCount : ''} ${step.selector}`;
    case 'type':     return `type ${JSON.stringify(step.text ?? '').slice(0, 40)} → ${step.selector}`;
    case 'press':    return `press ${mod}${step.key}`;
    case 'scroll':   return `scroll ${step.y ?? 300}px`;
    case 'hover':    return `hover ${step.selector}`;
    case 'wait':     return `wait ${step.selector} ${step.state ?? 'visible'}`;
    case 'goto':     return `goto ${step.url}`;
    case 'reload':   return `reload`;
    case 'clickAt':  return `clickAt ${step.button ?? 'left'} (${step.x},${step.y}) in ${step.selector}`;
    case 'dragAt': {
      const f = step.from ?? { x: step.x, y: step.y };
      return `dragAt (${f.x},${f.y}) → (${step.to?.x},${step.to?.y}) in ${step.selector}`;
    }
    case 'drag':     return `drag ${step.selector} → ${step.targetSelector}`;
    case 'select':   return `select ${step.value} in ${step.selector}`;
    case 'upload':   return `upload ${step.files?.length ?? 0} file(s) → ${step.selector}`;
  }
}

async function screenshot(page: Page, fullPage: boolean): Promise<Buffer> {
  return await page.screenshot({ fullPage, type: 'png' });
}

const MAX_INLINE_DIMENSION = 2000;

/** Read width/height from the IHDR chunk of a PNG buffer. */
function readPngDimensions(png: Buffer): { width: number; height: number } | null {
  if (png.length < 24) return null;
  if (png.readUInt32BE(12) !== 0x49484452) return null;
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

function withImage(textBody: string, png: Buffer) {
  const dims = readPngDimensions(png);
  if (dims && (dims.width > MAX_INLINE_DIMENSION || dims.height > MAX_INLINE_DIMENSION)) {
    try {
      const dir = path.join(getWorkspaceRoot(), '.reframe', 'exports');
      fs.mkdirSync(dir, { recursive: true });
      const ts = Date.now().toString(36);
      const filePath = path.join(dir, `ui-screenshot-${ts}.png`);
      fs.writeFileSync(filePath, png);
      const kb = Math.round(png.length / 1024);
      return {
        content: [
          {
            type: 'text' as const,
            text: `${textBody}\n\n⛔ INLINE PREVIEW REFUSED — screenshot is ${dims.width}×${dims.height}px (limit: ${MAX_INLINE_DIMENSION}×${MAX_INLINE_DIMENSION}). Sending a PNG this large will break the chat UI, so it is not attached to this response. Full-resolution file: ${filePath} (${kb}KB). Open that file to see the screenshot. If you need to sample the UI visually in-chat, use a clipped selector screenshot or a viewport capture instead of fullPage.`,
          },
        ],
      };
    } catch {
      // Fall through to inline — better to send a big image than nothing.
    }
  }
  return {
    content: [
      { type: 'text' as const, text: textBody },
      { type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' as const },
    ],
  };
}

function text(body: string) {
  return { content: [{ type: 'text' as const, text: body }] };
}

function requireSession(id?: string): UiSession {
  if (!id) throw new Error('sessionId required — call reframe_ui { action: "open" } first');
  const s = getSession(id);
  if (!s) throw new Error(`session ${id} not found (may have been GC\'d or closed)`);
  return s;
}

async function safeTitle(page: Page): Promise<string> {
  try { return await page.title(); } catch { return '(title unavailable)'; }
}

function resolveUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) return pathOrUrl;
  const port = process.env.REFRAME_HTTP_PORT ?? '4100';
  const host = process.env.REFRAME_HTTP_HOST ?? 'localhost';
  const p = pathOrUrl.startsWith('/') ? pathOrUrl : '/' + pathOrUrl;
  return `http://${host}:${port}${p}`;
}
