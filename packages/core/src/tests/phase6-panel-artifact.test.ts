// Phase 6.1 — panel-artifact compile + bindings.
//
// Run: npx tsx packages/core/src/tests/phase6-panel-artifact.test.ts
//
// Round-trips a real artifact HTML (version history panel) with a full
// config object through compilePanel(). Asserts:
//   - data-bind-each repeats for every item
//   - data-bind-text replaces textContent
//   - data-bind-attr sets attribute values
//   - {path} tokens in attribute values (including gesture JSON) interpolate
//   - the resulting SceneGraph keeps Block A substrate (semantic paths,
//     gestures, mount slot, intent roles)
//
// The point of the test isn't subtree-counting — it's proving that a
// future agent can drop an HTML file on disk and the same pipeline that
// serves user scenes lights it up as a Platform UI panel.

import { compilePanel, resolveBindings, interpolateString } from '../ui-artifacts/index.js';

const PANEL_HTML = `
<div style="width:320px; padding:16px; background:#111; color:#eee"
     data-intent-role="version-history/root"
     data-mount-slot="right-panel"
     data-panel-accepts="version-history">
  <h3 data-intent-role="version-history/title"
      data-bind-text="title">Title fallback</h3>
  <div data-bind-each="versions">
    <div data-intent-role="version-history/entry"
         data-bind-attr="data-version-id:id;data-author:author"
         data-gesture-click='{"tool":"reframe_edit","args":{"op":"restoreVersion","sceneId":"{sceneId}","versionId":"{id}"}}'>
      <span data-bind-text="label">Version N</span>
      <span data-bind-text="timestamp">time ago</span>
    </div>
  </div>
</div>`;

const CONFIG = {
  title: 'Version history',
  sceneId: 'scene-abc',
  versions: [
    { id: 'v-001', label: 'Initial import', timestamp: '2 hours ago', author: 'agent' },
    { id: 'v-002', label: 'Tightened spacing', timestamp: '41 min ago', author: 'ilya' },
    { id: 'v-003', label: 'Switched to Ferrari', timestamp: 'just now', author: 'agent' },
  ],
};

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error('  🔴 FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('  🟢 OK  :', msg);
  }
}

function includes(hay: string, needle: string, label: string): void {
  assert(hay.includes(needle), `${label} — expected substring "${needle.slice(0, 80)}"`);
}

async function run(): Promise<void> {
  console.log('Phase 6.1 — panel-artifact bindings + compile\n');

  // ─── interpolateString — unit-level ─────────────────────────────
  console.log('interpolateString:');
  const interp = interpolateString(
    '{"tool":"x","args":{"id":"{id}","scene":"{sceneId}"}}',
    { config: CONFIG, local: { id: 'v-001' } },
  );
  assert(interp.includes('"id":"v-001"'), 'resolves local scope');
  assert(interp.includes('"scene":"scene-abc"'), 'resolves config scope');

  // ─── resolveBindings — HTML transform ───────────────────────────
  console.log('\nresolveBindings:');
  const html = await resolveBindings(PANEL_HTML, CONFIG);
  // Title bind
  includes(html, 'Version history', 'title textContent replaced');
  // Each iteration count — one entry per version
  const entryCount = (html.match(/data-intent-role="version-history\/entry"/g) ?? []).length;
  assert(entryCount === 3, `entry repeated 3×, got ${entryCount}`);
  // Attribute bindings
  includes(html, 'data-version-id="v-001"', 'data-version-id bound on first');
  includes(html, 'data-author="ilya"', 'data-author bound on second');
  // Interpolation inside JSON gesture — linkedom serializes `"` as `&quot;`
  // inside attribute values, so check both the raw token and the decoded
  // form. What matters is the substitution happened.
  const decoded = html.replace(/&quot;/g, '"');
  includes(decoded, '"versionId":"v-003"', '{id} token interpolated into gesture JSON (decoded)');
  includes(decoded, '"sceneId":"scene-abc"', '{sceneId} token interpolated into gesture JSON (decoded)');
  // Nested bindings inside each scope
  includes(html, 'Initial import', 'nested data-bind-text resolved (first row)');
  includes(html, 'Switched to Ferrari', 'nested data-bind-text resolved (third row)');
  // data-bind-* attrs stripped
  assert(!html.includes('data-bind-each'), 'data-bind-each attr removed');
  assert(!html.includes('data-bind-text'), 'data-bind-text attr removed');
  assert(!html.includes('data-bind-attr'), 'data-bind-attr attr removed');

  // ─── compilePanel — full pipeline into SceneGraph ───────────────
  console.log('\ncompilePanel:');
  const { graph, rootId, resolvedHtml } = await compilePanel(PANEL_HTML, {
    name: 'Version history',
    config: CONFIG,
    width: 320,
    height: 600,
  });
  assert(!!graph, 'graph produced');
  assert(!!rootId, 'rootId returned');
  assert(resolvedHtml.includes('data-version-id="v-002"'), 'resolvedHtml carries resolved bindings');

  // Walk graph — assert mount-slot + intent roles survived import.
  const root = graph.getNode(rootId)!;
  assert(root.mountSlot?.name === 'right-panel', `root mountSlot === right-panel (got ${root.mountSlot?.name})`);
  assert(root.intent?.role === 'version-history/root', `root intent.role (got ${root.intent?.role})`);

  // DFS walk collecting intent roles + click gestures.
  const roles = new Set<string>();
  const gestures: string[] = [];
  const walk = (id: string): void => {
    const n = graph.getNode(id);
    if (!n) return;
    if (n.intent?.role) roles.add(n.intent.role);
    if (n.onClick) gestures.push(JSON.stringify(n.onClick));
    for (const c of n.childIds) walk(c);
  };
  walk(rootId);

  assert(roles.has('version-history/title'), 'title intent-role survived import');
  assert(roles.has('version-history/entry'), 'entry intent-role survived import');
  assert(gestures.length === 3, `3 click gestures imported (got ${gestures.length})`);
  assert(
    gestures.every(g => g.includes('restoreVersion')),
    'every gesture targets restoreVersion',
  );
  assert(
    gestures.some(g => g.includes('v-001')) && gestures.some(g => g.includes('v-003')),
    'gestures carry per-row versionId substitutions',
  );

  // ─── Edge: empty collection renders no rows, no crash ───────────
  console.log('\nedge cases:');
  const empty = await resolveBindings(PANEL_HTML, { ...CONFIG, versions: [] });
  assert(!empty.includes('data-intent-role="version-history/entry"'), 'empty array → zero rows');
  includes(empty, 'Version history', 'title still renders with empty rows');

  // Edge: missing path resolves to empty string (no crash).
  const partial = await resolveBindings(
    '<span data-bind-text="missing.deep.path">fallback</span>',
    {},
  );
  assert(partial.includes('<span></span>') || partial.includes('<span ></span>'), 'missing path → empty span');

  // Edge: data-bind-each-as aliases the row object.
  const aliased = await resolveBindings(
    '<ul><li data-bind-each="items" data-bind-each-as="row"><a data-bind-attr="href:row.url" data-bind-text="row.name">x</a></li></ul>',
    { items: [{ url: '/a', name: 'A' }, { url: '/b', name: 'B' }] },
  );
  includes(aliased, 'href="/a"', 'each-as alias: href bound');
  includes(aliased, '>A<', 'each-as alias: text bound');

  if (process.exitCode && process.exitCode !== 0) {
    console.log('\n🔴 FAIL');
  } else {
    console.log('\n🟢 PASS — Phase 6.1 bindings + compilePanel green');
  }
}

run().catch(err => {
  console.error('Test crashed:', err);
  process.exit(1);
});
