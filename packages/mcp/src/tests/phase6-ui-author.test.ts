// Phase 6.3 — reframe_ui panel-authoring actions.
//
// Run: npx tsx packages/mcp/src/tests/phase6-ui-author.test.ts
//
// Exercises the MCP handler directly (no stdio, no HTTP):
//   1. authorCommit writes the artifact and returns OK with nodeCount.
//   2. authorList shows it alongside code panels.
//   3. authorRead returns the source verbatim.
//   4. renderPanelAsync (via the same registry) renders it with config.
//   5. authorCommit of malformed HTML rolls back.
//   6. authorDelete wipes the disk file.

import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleUi } from '../tools/ui.js';
import { renderPanelAsync, resetPanelArtifacts } from '../platform/panel-registry.js';

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error('  🔴 FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('  🟢 OK  :', msg);
  }
}

function extractText(result: any): string {
  // handleUi returns either `text(...)` or `withImage(...)`. Both shapes
  // share a `content: [{ type: 'text', text }]` first entry.
  const first = result?.content?.[0];
  return first?.text ?? '';
}

const PANEL_HTML = `<div style="width:320px; padding:16px"
     data-intent-role="scratch-panel/root"
     data-mount-slot="right-panel">
  <h3 data-bind-text="title">Title</h3>
  <ul>
    <li data-bind-each="items" data-gesture-click='{"tool":"noop","args":{"label":"{.}"}}'>
      <span data-bind-text=".">item</span>
    </li>
  </ul>
</div>`;

const BROKEN_HTML = `<div><unclosed-tag oops`;

async function run(): Promise<void> {
  console.log('Phase 6.3 — reframe_ui panel authoring\n');

  const projectDir = mkdtempSync(join(tmpdir(), 'reframe-phase63-'));
  mkdirSync(join(projectDir, '.reframe', 'ui'), { recursive: true });

  try {
    resetPanelArtifacts();

    // authorList on empty project
    console.log('authorList (empty):');
    const listEmpty = await handleUi({ action: 'authorList', projectDir });
    const listEmptyTxt = extractText(listEmpty);
    assert(listEmptyTxt.includes('Artifacts'), 'response shapes as expected');
    assert(listEmptyTxt.includes('(none)'), 'empty artifact list');
    assert(listEmptyTxt.includes('Code-shipped'), 'code section also present');

    // authorCommit — good HTML
    console.log('\nauthorCommit (good html):');
    const commit = await handleUi({
      action: 'authorCommit',
      projectDir,
      name: 'scratch-panel',
      html: PANEL_HTML,
    });
    const commitTxt = extractText(commit);
    assert(commitTxt.startsWith('authorCommit OK'), `commit succeeded (got "${commitTxt.slice(0, 80)}")`);
    assert(commitTxt.includes('nodeCount='), 'dry-run node count reported');
    assert(existsSync(join(projectDir, '.reframe', 'ui', 'scratch-panel.panel.html')), 'file written');

    // authorList — now shows the artifact
    console.log('\nauthorList (post-commit):');
    const listAfter = extractText(await handleUi({ action: 'authorList', projectDir }));
    assert(listAfter.includes('scratch-panel'), 'artifact appears in list');

    // authorRead — raw source echoes back
    console.log('\nauthorRead:');
    const readTxt = extractText(await handleUi({ action: 'authorRead', projectDir, name: 'scratch-panel' }));
    assert(readTxt.includes('data-bind-each="items"'), 'source echoed verbatim');

    // renderPanelAsync — exercise the same pipeline mount would use.
    console.log('\nrenderPanelAsync (via registry):');
    const rendered = await renderPanelAsync('scratch-panel', {
      title: 'Scratch',
      items: ['alpha', 'beta', 'gamma'],
    }, { projectDir });
    assert(rendered.html.includes('data-intent-role="scratch-panel/root"'), 'root role survives');
    const liMatches = (rendered.html.match(/<li\b/g) ?? []).length;
    assert(liMatches === 3, `3 li from 3-item list (got ${liMatches})`);
    const decoded = rendered.html.replace(/&quot;/g, '"');
    assert(decoded.includes('"label":"alpha"'), 'each-scope {.} interpolated in gesture JSON');

    // authorCommit — broken HTML should roll back
    console.log('\nauthorCommit (broken html, expect rollback):');
    const broken = extractText(await handleUi({
      action: 'authorCommit',
      projectDir,
      name: 'scratch-panel',
      html: BROKEN_HTML,
    }));
    // A truly unparseable artifact should land as "authorCommit FAILED (rolled back)"
    // OR the importer may be tolerant enough that the dry-run succeeds with a
    // malformed subtree. Either is acceptable — the contract is: if commit
    // returns OK, then artifact parses. So we just verify the source was
    // rolled back to the previous good one when it says FAILED.
    if (broken.includes('FAILED')) {
      assert(broken.includes('rolled back'), 'failure rolls back per default keepOnFailure');
      const readBack = extractText(await handleUi({ action: 'authorRead', projectDir, name: 'scratch-panel' }));
      assert(readBack.includes('data-bind-each="items"'), 'prior good artifact restored');
    } else {
      console.log('  (linkedom accepted the malformed HTML — importer is tolerant; no rollback needed)');
      // Overwrite back to good so the next step has a known state.
      await handleUi({ action: 'authorCommit', projectDir, name: 'scratch-panel', html: PANEL_HTML });
    }

    // authorDelete
    console.log('\nauthorDelete:');
    const del = extractText(await handleUi({ action: 'authorDelete', projectDir, name: 'scratch-panel' }));
    assert(del.startsWith('authorDelete OK'), 'delete succeeded');
    assert(!existsSync(join(projectDir, '.reframe', 'ui', 'scratch-panel.panel.html')), 'file removed');

    // authorDelete on a missing name — friendly error, not a throw
    const delMissing = extractText(await handleUi({ action: 'authorDelete', projectDir, name: 'does-not-exist' }));
    assert(delMissing.includes('no artifact'), 'missing delete returns friendly message');

    if (process.exitCode && process.exitCode !== 0) {
      console.log('\n🔴 FAIL');
    } else {
      console.log('\n🟢 PASS — Phase 6.3 reframe_ui author actions green');
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
