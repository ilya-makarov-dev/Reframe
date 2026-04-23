// Phase 6.2 — disk-backed panel registry + artifact hot-reload.
//
// Run: npx tsx packages/mcp/src/tests/phase6-panel-registry.test.ts
//
// Covers the contract that Phase 6 sells to users:
//   1. Drop .reframe/ui/<name>.panel.html on disk → renderPanelAsync
//      returns compiled HTML (with gestures, intent roles, mount slot)
//      without touching the code registry.
//   2. Change the file → cache refreshes, next mount returns new HTML.
//   3. Delete the file → cache drops it; renderPanelAsync falls back
//      to the in-code panel of the same name if one exists.
//   4. listAllPanels() shows both code + artifact sources.

import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  loadPanelArtifacts,
  renderPanelAsync,
  writeArtifact,
  deleteArtifact,
  listAllPanels,
  resetPanelArtifacts,
} from '../platform/panel-registry.js';

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error('  🔴 FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('  🟢 OK  :', msg);
  }
}

const ARTIFACT_HTML = `
<div style="width:320px; padding:16px; background:#111; color:#eee"
     data-intent-role="version-history/root"
     data-mount-slot="right-panel"
     data-panel-accepts="version-history">
  <h3 data-intent-role="version-history/title" data-bind-text="title">Title</h3>
  <div data-bind-each="versions">
    <div data-intent-role="version-history/entry"
         data-bind-attr="data-version-id:id"
         data-gesture-click='{"tool":"reframe_edit","args":{"op":"restoreVersion","versionId":"{id}"}}'>
      <span data-bind-text="label">Label</span>
    </div>
  </div>
</div>`;

const CONFIG = {
  title: 'Version history',
  versions: [
    { id: 'v-001', label: 'Initial import' },
    { id: 'v-002', label: 'Edit spacing' },
  ],
};

async function run(): Promise<void> {
  console.log('Phase 6.2 — disk-backed panel registry\n');

  // Temp project layout: <projectDir>/.reframe/ui/
  const projectDir = mkdtempSync(join(tmpdir(), 'reframe-phase6-'));
  mkdirSync(join(projectDir, '.reframe', 'ui'), { recursive: true });

  try {
    console.log('cold load (no artifacts on disk):');
    resetPanelArtifacts();
    const initial = loadPanelArtifacts(projectDir);
    assert(initial.length === 0, `cold load returns empty list (got ${initial.length})`);

    // Write via the author helper — this mirrors what reframe_ui_author does.
    console.log('\nwriteArtifact:');
    const full = writeArtifact(projectDir, 'version-history', ARTIFACT_HTML);
    assert(full.endsWith('version-history.panel.html'), `wrote file at expected location (${full})`);

    // List shows the artifact alongside core panels.
    const listed = listAllPanels(projectDir);
    assert(listed.artifact.includes('version-history'), `artifact appears in list (got ${listed.artifact.join(',')})`);
    assert(listed.code.length > 0, `code panels still listed (got ${listed.code.length})`);

    console.log('\nrenderPanelAsync (artifact path):');
    const t0 = performance.now();
    const rendered = await renderPanelAsync('version-history', CONFIG, { projectDir });
    const elapsed = performance.now() - t0;
    assert(rendered.panelName === 'version-history', 'panelName echoed');
    assert(rendered.html.length > 500, `html non-trivial (${rendered.html.length} bytes)`);
    assert(rendered.nodeCount >= 6, `nodeCount reflects per-row expansion (got ${rendered.nodeCount})`);
    // HTML carries Block A attributes re-emitted by the exporter.
    assert(rendered.html.includes('data-intent-role="version-history/root"'), 'root intent role survives export');
    assert(rendered.html.includes('data-mount-slot="right-panel"'), 'mount-slot survives export');
    const entryMatches = (rendered.html.match(/data-intent-role="version-history\/entry"/g) ?? []).length;
    assert(entryMatches === 2, `entry rendered 2× from 2-item config (got ${entryMatches})`);
    const decoded = rendered.html.replace(/&quot;/g, '"');
    assert(decoded.includes('"versionId":"v-001"'), 'per-row {id} substitution present in gesture JSON');
    assert(decoded.includes('"versionId":"v-002"'), 'per-row {id} substitution present on second row');
    console.log(`  (render took ${elapsed.toFixed(1)}ms)`);

    console.log('\nrenderPanelAsync (code-panel fallback):');
    // `dashboard` is in the in-code registry, not as an artifact. Artifact
    // lookup must not throw — renderPanelAsync must fall through.
    const dashboard = await renderPanelAsync('dashboard', { projects: [] }, { projectDir });
    assert(dashboard.panelName === 'dashboard', 'code-path panel renders unchanged');

    console.log('\nhot-update: rewrite artifact, render again:');
    const updatedHtml = ARTIFACT_HTML.replace('data-intent-role="version-history/title"', 'data-intent-role="version-history/title-v2"');
    writeArtifact(projectDir, 'version-history', updatedHtml);
    const reRendered = await renderPanelAsync('version-history', CONFIG, { projectDir });
    assert(
      reRendered.html.includes('data-intent-role="version-history/title-v2"'),
      'next mount picks up the rewritten source',
    );

    console.log('\ndeleteArtifact:');
    const removed = deleteArtifact(projectDir, 'version-history');
    assert(removed === true, 'deleteArtifact returns true for an existing file');
    let threw = false;
    try { await renderPanelAsync('version-history', CONFIG, { projectDir }); }
    catch { threw = true; }
    assert(threw, 'post-delete render throws (no code-registry fallback for this name)');

    console.log('\nartifact wins on name clash with code registry:');
    writeArtifact(projectDir, 'dashboard', `<div data-intent-role="dashboard-override/root">override!</div>`);
    const override = await renderPanelAsync('dashboard', {}, { projectDir });
    assert(
      override.html.includes('data-intent-role="dashboard-override/root"'),
      'artifact overrides code panel on shared name (user customization wins)',
    );

    if (process.exitCode && process.exitCode !== 0) {
      console.log('\n🔴 FAIL');
    } else {
      console.log('\n🟢 PASS — Phase 6.2 registry + artifact pipeline green');
    }
  } finally {
    resetPanelArtifacts();
    try { rmSync(projectDir, { recursive: true, force: true }); } catch {}
  }
}

run().catch(err => {
  console.error('Test crashed:', err);
  process.exit(1);
});
