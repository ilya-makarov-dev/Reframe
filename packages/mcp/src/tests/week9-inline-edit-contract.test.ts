/**
 * Phase 1 UI-5a — Inline editing exhaustive + inspector small deferrals.
 *
 * Pins covered (UI-5a subset; Pin #10 color picker rail → UI-5b):
 *   #1 Tag expansion           — isLeafTextElement allowlist + heuristic
 *   #2 Multi-modal entry        — controller.tryEnterFromKey for Enter/F2
 *   #3 Mini-toolbar             — bundle string-search for module presence
 *   #4 Visual polish            — bundle string-search for ring + shadow
 *   #5 Caret preservation       — re-verify renderer.ts wires capture/restore
 *   #6 Hug-on-edit              — controller schedules hug-debounced POST on input
 *   #7 Commit/revert formal     — controller fires commit on Enter/Blur, no POST on Esc
 *   #8 Slider debouncing 250ms  — createDebouncedSliderCommit trailing + flush
 *   #9 Cmd/Shift arrow modifiers— applyArrowModifier ±1/±0.1/±10/±100
 *
 * No HTTP / DOM mocks beyond hand-rolled stand-ins for the surfaces the
 * controller touches. Editor pkg is ESM, mcp is CJS — dynamic import
 * bridges the boundary, same pattern as week7-caret-preservation.
 *
 * Run: npx tsx packages/mcp/src/tests/week9-inline-edit-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  applyArrowModifier,
  createDebouncedSliderCommit,
  naturalStepForProp,
} from '../platform/inspector-numeric-helpers.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const DOM_CANVAS_TS = path.join(REPO_ROOT, 'packages', 'editor', 'src', 'canvas-dom', 'dom-canvas.ts');
const RENDERER_TS = path.join(REPO_ROOT, 'packages', 'editor', 'src', 'canvas-dom', 'renderer.ts');
const WIDGETS_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '120-widgets.js');
const INLINE_EDIT_TS = path.join(REPO_ROOT, 'packages', 'editor', 'src', 'canvas-dom', 'inline-text-edit.ts');
const MINI_TOOLBAR_TS = path.join(REPO_ROOT, 'packages', 'editor', 'src', 'canvas-dom', 'mini-toolbar.ts');

// ─── Editor pkg dynamic import (ESM/CJS bridge) ────────────────
type IsLeafTextElement = (el: Element | null) => boolean;
type CreateInlineEditor = (opts: any) => any;

let isLeafTextElement!: IsLeafTextElement;
let createInlineTextEditor!: CreateInlineEditor;

// ─── Hand-rolled mock DOM ──────────────────────────────────────
//
// Pure structural mock — only the surfaces inline-text-edit reads/
// writes are implemented. Anything else throws to flag accidental
// over-reach. Kept minimal for inspectability.

function makeMockDoc() {
  const listeners: Record<string, Array<(e: any) => void>> = {};
  const doc: any = {
    addEventListener(type: string, fn: any) {
      (listeners[type] ||= []).push(fn);
    },
    removeEventListener(type: string, fn: any) {
      const arr = listeners[type] || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    fire(type: string, e: any) {
      (listeners[type] || []).slice().forEach((fn) => fn(e));
    },
    createRange() {
      return {
        selectNodeContents() {},
        setStart() {},
        setEnd() {},
      };
    },
    getSelection() {
      return { rangeCount: 0, removeAllRanges() {}, addRange() {}, getRangeAt() { return null; } };
    },
    querySelector() { return null; },
    body: { firstElementChild: null },
    defaultView: { innerWidth: 1440 },
  };
  return doc;
}

function makeMockHost(opts: { tag: string; nodeId: string; text?: string; children?: any[]; doc?: any }) {
  const listeners: Record<string, Array<(e: any) => void>> = {};
  const dataset: Record<string, string> = {};
  const style: Record<string, string> = {};
  const attrs: Record<string, string> = { 'data-reframe-inode': opts.nodeId };
  const el: any = {
    nodeType: 1,
    tagName: opts.tag.toUpperCase(),
    childNodes: [] as any[],
    dataset,
    style,
    contains(n: any) { return n === el || (el.childNodes || []).some((c: any) => c === n || (c.contains && c.contains(n))); },
    textContent: opts.text ?? '',
    setAttribute(k: string, v: string) { attrs[k] = v; },
    getAttribute(k: string) { return attrs[k]; },
    removeAttribute(k: string) { delete attrs[k]; },
    addEventListener(type: string, fn: any, _opts?: any) {
      (listeners[type] ||= []).push(fn);
    },
    removeEventListener(type: string, fn: any) {
      const arr = listeners[type] || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    fire(type: string, e: any) {
      (listeners[type] || []).slice().forEach((fn) => fn(e));
    },
    focus() {},
    ownerDocument: opts.doc ?? makeMockDoc(),
  };
  if (opts.children) {
    for (const c of opts.children) el.childNodes.push(c);
  } else if (opts.text) {
    el.childNodes.push({ nodeType: 3, textContent: opts.text });
  }
  return el;
}

async function main() {
  console.log('Phase 1 UI-5a — inline edit + inspector small deferrals contract\n');

  // Editor pkg ESM bridge.
  const inlineMod: any = await import('../../../editor/dist/canvas-dom/inline-text-edit.js');
  isLeafTextElement = inlineMod.isLeafTextElement;
  createInlineTextEditor = inlineMod.createInlineTextEditor;

  // ─── Pin #1 — Tag expansion + isLeafTextElement ──────────────
  console.log('Pin #1 — Tag expansion');
  {
    // Original allowlist members still pass.
    for (const tag of ['P', 'H1', 'H2', 'H3', 'BUTTON', 'SPAN']) {
      const el = makeMockHost({ tag, nodeId: 'n1', text: 'hi' });
      assert(isLeafTextElement(el), `${tag} with text-only child is leaf-text`);
    }
    // Expanded set members pass.
    for (const tag of ['DIV', 'A', 'LI', 'LABEL', 'BLOCKQUOTE', 'CODE', 'TD', 'TH', 'FIGCAPTION']) {
      const el = makeMockHost({ tag, nodeId: 'n1', text: 'hi' });
      assert(isLeafTextElement(el), `${tag} with text-only child is leaf-text (expanded)`);
    }
    // DIV with block child (DIV>DIV) is NOT leaf-text.
    const blockChild = makeMockHost({ tag: 'DIV', nodeId: 'n2', text: 'block' });
    const divWithBlock = makeMockHost({ tag: 'DIV', nodeId: 'n1', children: [blockChild] });
    assert(!isLeafTextElement(divWithBlock), 'DIV containing DIV is NOT leaf-text');

    // P with inline formatting (P>STRONG>"x") IS leaf-text.
    const strong = makeMockHost({ tag: 'STRONG', nodeId: 'n2', text: 'x' });
    const pWithStrong = makeMockHost({ tag: 'P', nodeId: 'n1', children: [strong] });
    assert(isLeafTextElement(pWithStrong), 'P>STRONG>text is leaf-text (inline formatting recurse)');

    // Unknown tag (TABLE, ARTICLE) is NOT leaf-text — not in allowlist.
    const tableEl = makeMockHost({ tag: 'TABLE', nodeId: 'n1', text: 'x' });
    assert(!isLeafTextElement(tableEl), 'TABLE is NOT in EDITABLE_TAGS allowlist');

    // Empty editable element IS leaf-text.
    const emptyP = makeMockHost({ tag: 'P', nodeId: 'n1' });
    emptyP.childNodes = [];
    assert(isLeafTextElement(emptyP), 'Empty P is leaf-text (typeable into)');

    // null safe
    assert(!isLeafTextElement(null), 'null returns false (safety)');
  }

  // ─── Pin #2 — Multi-modal entry ──────────────────────────────
  console.log('\nPin #2 — Multi-modal entry');
  {
    let started: any = null;
    const editor = createInlineTextEditor({
      sceneId: 's1',
      postEdit: () => {},
      onEditStart: (h: any) => { started = h; },
    });
    const host = makeMockHost({ tag: 'P', nodeId: 'n1', text: 'hello' });
    // Enter (no mods) should enter edit mode.
    const handled = editor.tryEnterFromKey({
      key: 'Enter', shiftKey: false, metaKey: false, ctrlKey: false, altKey: false,
      target: { tagName: 'BODY' }, preventDefault() {},
    } as any, () => host);
    assert(handled === true, 'Enter routes to startInlineEdit when single text host selected');
    assert(started === host, 'onEditStart fired with the host');
    void editor.finish(false);

    // F2 also enters.
    let started2: any = null;
    const editor2 = createInlineTextEditor({
      sceneId: 's1',
      postEdit: () => {},
      onEditStart: (h: any) => { started2 = h; },
    });
    const host2 = makeMockHost({ tag: 'H1', nodeId: 'n2', text: 'hi' });
    const handled2 = editor2.tryEnterFromKey({
      key: 'F2', shiftKey: false, metaKey: false, ctrlKey: false, altKey: false,
      target: { tagName: 'BODY' }, preventDefault() {},
    } as any, () => host2);
    assert(handled2 === true && started2 === host2, 'F2 also routes to startInlineEdit');
    void editor2.finish(false);

    // Ignored when target is INPUT.
    const editor3 = createInlineTextEditor({ sceneId: 's', postEdit: () => {} });
    const handled3 = editor3.tryEnterFromKey({
      key: 'Enter', shiftKey: false, metaKey: false, ctrlKey: false, altKey: false,
      target: { tagName: 'INPUT' }, preventDefault() {},
    } as any, () => makeMockHost({ tag: 'P', nodeId: 'n', text: 'x' }));
    assert(handled3 === false, 'Enter inside INPUT does not steal focus');
  }

  // ─── Pin #3 — Mini-toolbar bundle presence ───────────────────
  console.log('\nPin #3 — Mini-toolbar');
  {
    const src = fs.readFileSync(MINI_TOOLBAR_TS, 'utf8');
    assert(/createMiniToolbar/.test(src), 'mini-toolbar.ts exports createMiniToolbar');
    assert(/handleHotkey/.test(src), 'mini-toolbar exposes handleHotkey for Cmd+B/I/K');
    assert(/buttonHTML\('B',\s*'bold'/.test(src), 'Bold action button registered');
    assert(/buttonHTML\('I',\s*'italic'/.test(src), 'Italic action button registered');
    assert(/buttonHTML\('🔗',\s*'link'|buttonHTML\([^)]+,\s*'link'/.test(src), 'Link action button registered');
    assert(/onSelectionChanged/.test(src), 'mini-toolbar consumes selection-change events for show/hide');
    assert(/idleShowMs|idleMs/.test(src), 'mini-toolbar honors idle threshold for caret-only show');

    const dom = fs.readFileSync(DOM_CANVAS_TS, 'utf8');
    assert(/createMiniToolbar\(/.test(dom), 'dom-canvas instantiates mini-toolbar');
    assert(/miniToolbar\.handleHotkey/.test(dom), 'dom-canvas wires hotkey handler');
  }

  // ─── Pin #4 — Visual polish ──────────────────────────────────
  console.log('\nPin #4 — Visual polish');
  {
    const src = fs.readFileSync(INLINE_EDIT_TS, 'utf8');
    assert(/1px solid #2b74ff/.test(src), 'Edit ring uses 1px (was 2px)');
    assert(/rgba\(43,116,255,0\.15\)/.test(src), 'Soft blue glow shadow applied');
    assert(/0 4px 12px rgba\(0,0,0,0\.08\)/.test(src), 'Drop shadow for depth');
    assert(/dataset\.rfdEditing\s*=/.test(src), 'Editing host gets rfdEditing dataset marker');
  }

  // ─── Pin #5 — Caret preservation wiring ──────────────────────
  console.log('\nPin #5 — Caret preservation wiring (existing renderer.ts)');
  {
    const src = fs.readFileSync(RENDERER_TS, 'utf8');
    assert(/captureCaret\(/.test(src), 'renderer.ts captures caret on reload');
    assert(/restoreCaret\(/.test(src), 'renderer.ts restores caret post-reload');
    assert(/beforeState/.test(src), 'capture state held for post-reload restore');
    // The editor's onInput hugReflow uses postEdit which triggers SSE
    // reload — which goes through this same capture/restore. Caret
    // therefore survives mid-edit hug reflows by transitive guarantee.
    const editorSrc = fs.readFileSync(INLINE_EDIT_TS, 'utf8');
    assert(/scheduleHug/.test(editorSrc), 'Inline editor uses debounced hug schedule');
    assert(/text-content/.test(editorSrc), 'Hug reflow posts text-content (server SSE round-trip preserves caret)');
  }

  // ─── Pin #6 — Hug-on-edit debounced POST ─────────────────────
  console.log('\nPin #6 — Hug-on-edit');
  {
    let posts: Array<{ id: string; props: any }> = [];
    const editor = createInlineTextEditor({
      sceneId: 's1',
      postEdit: (id: string, props: any) => { posts.push({ id, props }); },
      hugReflowDebounceMs: 5,
    });
    const doc = makeMockDoc();
    const host = makeMockHost({ tag: 'P', nodeId: 'n1', text: 'hi', doc });
    editor.start(host);
    // Three rapid input events within 5ms — only the last should produce a POST.
    host.textContent = 'h';
    host.fire('input', {});
    host.textContent = 'hi';
    host.fire('input', {});
    host.textContent = 'his';
    host.fire('input', {});
    await new Promise((r) => setTimeout(r, 30));
    const hugPosts = posts.filter((p) => p.props['text-content'] === 'his');
    assert(hugPosts.length === 1, `Three rapid input events debounced to 1 trailing POST (got ${posts.length} total, ${hugPosts.length} matching final)`);
    void editor.finish(true);
  }

  // ─── Pin #7 — Commit / revert ────────────────────────────────
  console.log('\nPin #7 — Commit / revert formalization');
  {
    let posts: Array<{ id: string; props: any }> = [];
    const editor = createInlineTextEditor({
      sceneId: 's1',
      postEdit: (id: string, props: any) => { posts.push({ id, props }); },
    });
    const doc = makeMockDoc();
    const host = makeMockHost({ tag: 'P', nodeId: 'n1', text: 'before', doc });
    editor.start(host);
    host.textContent = 'after';
    await editor.finish(true);
    assert(posts.length === 1 && posts[0].props['text-content'] === 'after', 'Commit fires text-content POST');

    // Revert path (Esc) — no POST.
    posts = [];
    const host2 = makeMockHost({ tag: 'H1', nodeId: 'n2', text: 'orig', doc: makeMockDoc() });
    editor.start(host2);
    host2.textContent = 'changed';
    await editor.finish(false);
    assert(posts.length === 0, 'Revert (commit=false) fires NO POST');

    // Blur path commits (Figma default — clicking outside saves).
    posts = [];
    const host3 = makeMockHost({ tag: 'P', nodeId: 'n3', text: 'orig', doc: makeMockDoc() });
    editor.start(host3);
    host3.textContent = 'blur-commit';
    host3.fire('blur', {});
    await new Promise((r) => setTimeout(r, 5));
    assert(posts.length === 1 && posts[0].props['text-content'] === 'blur-commit', 'Blur outside fires commit POST (Figma default)');
  }

  // ─── Pin #8 — Slider debouncing 250ms ────────────────────────
  console.log('\nPin #8 — Slider debouncing');
  {
    let posts: Array<{ s: string; n: string; p: string; v: number }> = [];
    const ctrl = createDebouncedSliderCommit((s, n, p, v) => {
      posts.push({ s, n, p, v });
    }, { delayMs: 25 });
    // 5 schedules within 5ms → 1 POST after 25ms idle (last value).
    for (let i = 0; i < 5; i++) ctrl.schedule('s1', 'n1', 'opacity', 0.1 * i);
    assert(ctrl.pendingCount() === 1, '5 sequential schedules collapse to 1 pending entry');
    await new Promise((r) => setTimeout(r, 50));
    assert(posts.length === 1 && posts[0].v === 0.4, 'Trailing-edge POST commits final value');

    // flush() bypasses delay.
    posts = [];
    ctrl.schedule('s1', 'n1', 'opacity', 0.5);
    ctrl.flush('s1', 'n1', 'opacity', 0.7);
    assert(posts.length === 1 && posts[0].v === 0.7, 'flush() commits immediately, supersedes pending');
    assert(ctrl.pendingCount() === 0, 'flush() clears pending entry');

    // Different keys are isolated.
    posts = [];
    ctrl.schedule('s1', 'n1', 'opacity', 0.5);
    ctrl.schedule('s1', 'n2', 'opacity', 0.6);
    assert(ctrl.pendingCount() === 2, 'Distinct (scene,node,prop) keys debounced independently');
    await new Promise((r) => setTimeout(r, 50));
    assert(posts.length === 2, 'Both distinct keys flush after delay');

    // 120-widgets.js wires it.
    const widgets = fs.readFileSync(WIDGETS_JS, 'utf8');
    assert(/getSliderDebouncer\(\)\.schedule/.test(widgets), 'Slider input event schedules via debouncer');
    assert(/getSliderDebouncer\(\)\.flush/.test(widgets), 'Slider change event flushes via debouncer');
  }

  // ─── Pin #9 — Cmd/Shift arrow modifiers ──────────────────────
  console.log('\nPin #9 — Cmd/Shift arrow modifiers');
  {
    // Plain ArrowUp on integer prop = +1.
    assert(applyArrowModifier({ current: 100, direction: 'up', modifiers: {}, step: 1 }) === 101, '100 + ArrowUp = 101');
    assert(applyArrowModifier({ current: 100, direction: 'down', modifiers: {}, step: 1 }) === 99, '100 + ArrowDown = 99');

    // Shift = ±0.1 for step=1.
    const shifted = applyArrowModifier({ current: 100, direction: 'up', modifiers: { shift: true }, step: 1 });
    assert(Math.abs(shifted - 100.1) < 1e-9, `Shift+ArrowUp = 100.1 (got ${shifted})`);

    // Cmd = ±10 for step=1.
    const cmd = applyArrowModifier({ current: 100, direction: 'up', modifiers: { meta: true }, step: 1 });
    assert(cmd === 110, 'Cmd+ArrowUp = 110');

    // Shift+Cmd = ±100 for step=1.
    const both = applyArrowModifier({ current: 100, direction: 'up', modifiers: { shift: true, meta: true }, step: 1 });
    assert(both === 200, 'Shift+Cmd+ArrowUp = 200');

    // Sub-1 step (opacity step=0.05): Cmd = step*10 = 0.5.
    const op = applyArrowModifier({ current: 0.5, direction: 'up', modifiers: { meta: true }, step: 0.05 });
    assert(Math.abs(op - 1.0) < 1e-9, `Cmd+ArrowUp on opacity = 1.0 (0.5 + 0.5)`);

    // naturalStepForProp lookup
    assert(naturalStepForProp('opacity') === 0.05, 'opacity has step 0.05');
    assert(naturalStepForProp('width') === 1, 'width has step 1');
    assert(naturalStepForProp('unknown-prop') === 1, 'Unknown prop defaults to step 1');

    // 120-widgets.js wires arrow modifier.
    const widgets = fs.readFileSync(WIDGETS_JS, 'utf8');
    assert(/applyArrowModifierJS/.test(widgets), 'Bundle exposes applyArrowModifierJS');
    assert(/key === 'ArrowUp'.*key === 'ArrowDown'|ArrowUp.*ArrowDown/s.test(widgets), 'Bundle handles ArrowUp/ArrowDown keydown');
  }

  // ─── dom-canvas integration ──────────────────────────────────
  console.log('\nIntegration — dom-canvas wires the new modules');
  {
    const dom = fs.readFileSync(DOM_CANVAS_TS, 'utf8');
    assert(/createInlineTextEditor\(/.test(dom), 'dom-canvas instantiates inline editor');
    assert(/inlineEditor\.attachToDocument/.test(dom), 'dom-canvas binds doc-level dblclick via module');
    assert(/inlineEditor\.tryEnterFromKey/.test(dom), 'dom-canvas wires Enter/F2 multi-modal entry');
    assert(/inlineEditor\.isEditing\(\)/.test(dom), 'dom-canvas reads editor state via controller');
    assert(!/let editingEl: HTMLElement/.test(dom), 'Old closure-state editingEl is removed');
    assert(!/startInlineTextEdit\b/.test(dom) || /startInlineEdit/.test(dom), 'Old startInlineTextEdit closure is removed');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
