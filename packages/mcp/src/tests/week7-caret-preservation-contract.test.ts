/**
 * T3 #14 Caret preservation — capture / restore contract.
 *
 * The caret-preservation module lives in the editor package
 * (`packages/editor/src/canvas-dom/caret-preservation.ts`) but is
 * exercised here for consistency with other week7-* contract suites.
 * Tests use a hand-rolled mock Document/Selection/Range API instead of
 * jsdom — jsdom's Selection support is incomplete + flaky across
 * versions (createRange-on-fragment quirks, getSelection returning
 * null in some configurations, etc.). Mocks give us exact control
 * over the surfaces the module touches.
 *
 * Tests:
 *   1. Capture returns valid state when selection lives inside an
 *      inode-anchored element
 *   2. Capture returns null when no selection
 *   3. Capture returns null when selection is outside any inode anchor
 *   4. Restore re-targets selection to the same nodeId + offset
 *   5. Restore returns false when target nodeId is gone (graceful)
 *   6. Restore clamps offset when content shrunk between capture
 *      and restore
 *   7. Restore preserves end-offset for selection ranges (not just caret)
 *   8. Multi-iframe isolation — capture in doc A doesn't read doc B's
 *      selection
 *   9. Capture survives nested element shape (selection inside <strong>
 *      inside <p data-reframe-inode>) — anchor walks to outer inode
 *
 * Run: npx tsx packages/mcp/src/tests/week7-caret-preservation-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

// Editor package is ESM, mcp is CJS — import dynamically to bridge
// the resolution mismatch. Loaded once at runner start before tests
// run; same handle reused across all assertions.
type CaretState = {
  sceneId: string;
  nodeId: string;
  startOffset: number;
  endOffset: number;
};
let captureCaret: (doc: any, sceneId: string) => CaretState | null;
let restoreCaret: (doc: any, state: CaretState | null | undefined) => boolean;

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

// ─── Mock DOM ────────────────────────────────────────────────
//
// Hand-rolled minimal stand-ins for Document / Element / Text / Range
// / Selection. Only the surfaces caret-preservation reads/writes are
// implemented; everything else throws to flag accidental over-reach.

interface MockTextNode {
  nodeType: 3;
  textContent: string;
  parentNode: MockElement | null;
}

interface MockElement {
  nodeType: 1;
  tagName: string;
  attrs: Record<string, string>;
  childNodes: Array<MockElement | MockTextNode>;
  parentNode: MockElement | null;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

interface MockRange {
  startContainer: MockElement | MockTextNode;
  startOffset: number;
  endContainer: MockElement | MockTextNode;
  endOffset: number;
  setStart(node: MockElement | MockTextNode, offset: number): void;
  setEnd(node: MockElement | MockTextNode, offset: number): void;
}

interface MockSelection {
  ranges: MockRange[];
  rangeCount: number;
  getRangeAt(i: number): MockRange;
  removeAllRanges(): void;
  addRange(r: MockRange): void;
}

interface MockDocument {
  root: MockElement;
  _selection: MockSelection | null;
  getSelection(): MockSelection | null;
  createRange(): MockRange;
  querySelector(sel: string): MockElement | null;
}

function makeText(text: string, parent: MockElement | null = null): MockTextNode {
  return { nodeType: 3, textContent: text, parentNode: parent };
}

function makeEl(tagName: string, attrs: Record<string, string> = {}, children: Array<MockElement | MockTextNode> = []): MockElement {
  const el: MockElement = {
    nodeType: 1,
    tagName,
    attrs: { ...attrs },
    childNodes: children,
    parentNode: null,
    getAttribute(name) { return this.attrs[name] ?? null; },
    setAttribute(name, value) { this.attrs[name] = value; },
  };
  for (const child of children) {
    child.parentNode = el;
  }
  return el;
}

function makeDoc(root: MockElement): MockDocument {
  const doc: MockDocument = {
    root,
    _selection: null,
    getSelection() { return this._selection; },
    createRange() {
      const range: MockRange = {
        startContainer: this.root,
        startOffset: 0,
        endContainer: this.root,
        endOffset: 0,
        setStart(node, offset) { this.startContainer = node; this.startOffset = offset; },
        setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; },
      };
      return range;
    },
    querySelector(sel: string) {
      // Implement only attribute selector form: [data-reframe-inode="<id>"]
      const m = sel.match(/^\[data-reframe-inode="([^"]+)"\]$/);
      if (!m) return null;
      const targetId = m[1];
      function walk(el: MockElement): MockElement | null {
        if (el.getAttribute('data-reframe-inode') === targetId) return el;
        for (const child of el.childNodes) {
          if (child.nodeType === 1) {
            const found = walk(child as MockElement);
            if (found) return found;
          }
        }
        return null;
      }
      return walk(this.root);
    },
  };
  return doc;
}

function setSelection(doc: MockDocument, container: MockElement | MockTextNode, startOffset: number, endOffset?: number): void {
  const range: MockRange = {
    startContainer: container,
    startOffset,
    endContainer: container,
    endOffset: endOffset ?? startOffset,
    // Selection-API ranges expose setStart/setEnd; captureCaret never
    // calls them on a captured range, but the type contract requires
    // they exist. No-op stubs satisfy that without affecting any test.
    setStart(node, offset) { this.startContainer = node; this.startOffset = offset; },
    setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; },
  };
  doc._selection = {
    ranges: [range],
    rangeCount: 1,
    getRangeAt(i) { return this.ranges[i]; },
    removeAllRanges() { this.ranges = []; this.rangeCount = 0; },
    addRange(r) { this.ranges.push(r); this.rangeCount = this.ranges.length; },
  };
}

// ─── TEST 1: capture happy path ──
async function testCaptureHappyPath(): Promise<void> {
  const text = makeText('Hello world');
  const p = makeEl('P', { 'data-reframe-inode': 'abc12345' }, [text]);
  const root = makeEl('DIV', {}, [p]);
  const doc = makeDoc(root);
  setSelection(doc, text, 5);
  const state = captureCaret(doc as any, 'scene-1');
  assert(state !== null, 'capture: state returned');
  assert(state?.sceneId === 'scene-1', 'capture: sceneId set');
  assert(state?.nodeId === 'abc12345', `capture: nodeId = abc12345 (got ${state?.nodeId})`);
  assert(state?.startOffset === 5, `capture: startOffset = 5 (got ${state?.startOffset})`);
  assert(state?.endOffset === 5, 'capture: endOffset = 5 (caret-only)');
}

// ─── TEST 2: capture returns null with no selection ──
async function testCaptureNoSelection(): Promise<void> {
  const text = makeText('Hello');
  const p = makeEl('P', { 'data-reframe-inode': 'x' }, [text]);
  const doc = makeDoc(p);
  // Don't setSelection.
  const state = captureCaret(doc as any, 'scene-1');
  assert(state === null, 'no-selection: state is null');
}

// ─── TEST 3: capture outside inode anchor ──
async function testCaptureOutsideAnchor(): Promise<void> {
  // Selection inside an element that has no data-reframe-inode ancestor.
  const text = makeText('orphan');
  const p = makeEl('P', {}, [text]);  // no data-reframe-inode
  const root = makeEl('DIV', {}, [p]);
  const doc = makeDoc(root);
  setSelection(doc, text, 2);
  const state = captureCaret(doc as any, 'scene-1');
  assert(state === null, 'no-anchor: state is null');
}

// ─── TEST 4: restore re-targets selection ──
async function testRestoreHappyPath(): Promise<void> {
  const text = makeText('Hello world');
  const p = makeEl('P', { 'data-reframe-inode': 'abc12345' }, [text]);
  const root = makeEl('DIV', {}, [p]);
  const doc = makeDoc(root);
  setSelection(doc, text, 0);   // initial caret at start
  const state: CaretState = { sceneId: 'scene-1', nodeId: 'abc12345', startOffset: 5, endOffset: 5 };
  const ok = restoreCaret(doc as any, state);
  assert(ok === true, 'restore: returned true');
  const sel = doc.getSelection()!;
  assert(sel.rangeCount === 1, 'restore: 1 range present');
  assert(sel.ranges[0].startOffset === 5, `restore: startOffset = 5 (got ${sel.ranges[0].startOffset})`);
  assert(sel.ranges[0].startContainer === text, 'restore: container is the text node');
}

// ─── TEST 5: restore on missing node ──
async function testRestoreMissingNode(): Promise<void> {
  const text = makeText('hi');
  const p = makeEl('P', { 'data-reframe-inode': 'present' }, [text]);
  const doc = makeDoc(p);
  setSelection(doc, text, 0);
  const state: CaretState = { sceneId: 'scene-1', nodeId: 'GONE', startOffset: 0, endOffset: 0 };
  const ok = restoreCaret(doc as any, state);
  assert(ok === false, 'missing-node: returns false (graceful no-op)');
  // Selection should NOT have been touched; original ranges intact.
  const sel = doc.getSelection()!;
  assert(sel.rangeCount === 1, 'missing-node: pre-existing selection untouched');
}

// ─── TEST 6: offset clamping ──
async function testRestoreOffsetClamp(): Promise<void> {
  const text = makeText('hi');  // 2 chars
  const p = makeEl('P', { 'data-reframe-inode': 'short' }, [text]);
  const doc = makeDoc(p);
  setSelection(doc, text, 0);
  const state: CaretState = { sceneId: 'scene-1', nodeId: 'short', startOffset: 10, endOffset: 12 };
  const ok = restoreCaret(doc as any, state);
  assert(ok === true, 'clamp: restore succeeds even with out-of-bound offset');
  const sel = doc.getSelection()!;
  assert(sel.ranges[0].startOffset === 2, `clamp: offset clamped to 2 (got ${sel.ranges[0].startOffset})`);
  assert(sel.ranges[0].endOffset === 2, `clamp: endOffset clamped to 2`);
}

// ─── TEST 7: range preservation (start ≠ end) ──
async function testRangePreservation(): Promise<void> {
  const text = makeText('abcdefgh');
  const p = makeEl('P', { 'data-reframe-inode': 'span' }, [text]);
  const doc = makeDoc(p);
  setSelection(doc, text, 0);
  const state: CaretState = { sceneId: 'scene-1', nodeId: 'span', startOffset: 2, endOffset: 5 };
  const ok = restoreCaret(doc as any, state);
  assert(ok === true, 'range: restore ok');
  const sel = doc.getSelection()!;
  assert(sel.ranges[0].startOffset === 2, 'range: start = 2');
  assert(sel.ranges[0].endOffset === 5, 'range: end = 5 (selection span preserved)');
}

// ─── TEST 8: multi-iframe isolation ──
async function testMultiIframeIsolation(): Promise<void> {
  // Two independent docs. Capture in A — B's selection untouched.
  const textA = makeText('A doc');
  const pA = makeEl('P', { 'data-reframe-inode': 'a' }, [textA]);
  const docA = makeDoc(pA);
  setSelection(docA, textA, 3);

  const textB = makeText('B doc');
  const pB = makeEl('P', { 'data-reframe-inode': 'b' }, [textB]);
  const docB = makeDoc(pB);
  setSelection(docB, textB, 1);

  const stateA = captureCaret(docA as any, 'scene-A');
  assert(stateA?.nodeId === 'a' && stateA?.startOffset === 3, 'iso: docA capture returns A state');
  // docB's selection unchanged.
  assert(docB.getSelection()!.ranges[0].startOffset === 1, 'iso: docB selection untouched');

  // Restore into docA — verify docB still untouched.
  const restored = restoreCaret(docA as any, { sceneId: 'scene-A', nodeId: 'a', startOffset: 4, endOffset: 4 });
  assert(restored, 'iso: restore into docA ok');
  assert(docB.getSelection()!.ranges[0].startOffset === 1, 'iso: docB still untouched after docA restore');
}

// ─── TEST 9: nested anchor walk ──
async function testNestedAnchorWalk(): Promise<void> {
  // Selection inside <strong> inside <p data-reframe-inode> — capture
  // walks up to the outer P's anchor.
  const text = makeText('bold word');
  const strong = makeEl('STRONG', {}, [text]);
  const p = makeEl('P', { 'data-reframe-inode': 'outer' }, [strong]);
  const doc = makeDoc(p);
  setSelection(doc, text, 4);
  const state = captureCaret(doc as any, 'scene-1');
  assert(state?.nodeId === 'outer', `nested: anchor resolved to outer (got ${state?.nodeId})`);
  assert(state?.startOffset === 4, 'nested: offset preserved through walk');
}

// ─── Runner ────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('T3 #14 Caret Preservation contract\n');

  // Dynamic import bridges CJS test runner ↔ ESM editor package.
  const mod = await import('../../../editor/src/canvas-dom/caret-preservation.js');
  captureCaret = mod.captureCaret;
  restoreCaret = mod.restoreCaret;

  const tests: Array<[string, () => Promise<void>]> = [
    ['capture: selection inside inode-anchored element returns valid state', testCaptureHappyPath],
    ['capture: no selection → null', testCaptureNoSelection],
    ['capture: selection outside any inode anchor → null', testCaptureOutsideAnchor],
    ['restore: re-targets selection to nodeId + offset', testRestoreHappyPath],
    ['restore: missing node → false (graceful no-op)', testRestoreMissingNode],
    ['restore: offset clamped when content shrunk', testRestoreOffsetClamp],
    ['restore: range preservation (start ≠ end)', testRangePreservation],
    ['multi-iframe isolation — capture/restore scoped per document', testMultiIframeIsolation],
    ['nested anchor — selection inside <strong> walks up to <p inode>', testNestedAnchorWalk],
  ];

  for (const [name, fn] of tests) {
    console.log(`▸ ${name}`);
    try { await fn(); }
    catch (err: any) {
      failed++;
      console.error(`  UNEXPECTED ERROR: ${err?.message ?? err}`);
      if (err?.stack) console.error(err.stack.split('\n').slice(0, 6).join('\n'));
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
