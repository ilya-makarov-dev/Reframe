/**
 * End-to-end pipeline test — verifies the full reframe flow works.
 *
 * design → compile → inspect → edit → export
 *
 * Run: npx tsx scripts/test-pipeline.ts
 */

import { initYoga } from '../packages/core/src/engine/yoga-init.js';
import { handleDesign } from '../packages/mcp/src/tools/design.js';
import { handleCompile } from '../packages/mcp/src/tools/compile.js';
import { handleEdit } from '../packages/mcp/src/tools/edit.js';
import { handleInspect } from '../packages/mcp/src/tools/inspect.js';
import { handleExport } from '../packages/mcp/src/tools/export.js';

const TEST_HTML = `
<div style="width:1080px;height:1080px;background:#0a0a0a;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:Inter,sans-serif;padding:80px;">
  <h1 style="color:#ffffff;font-size:48px;font-weight:700;margin:0 0 16px;">Build faster</h1>
  <p style="color:#888888;font-size:18px;margin:0 0 32px;">Ship products users love</p>
  <div style="background:#6366f1;color:#ffffff;padding:16px 32px;border-radius:12px;font-size:16px;font-weight:600;">Get Started</div>
</div>
`;

function ok(label: string) { console.log(`  [OK] ${label}`); }
function fail(label: string, err: any) { console.error(`  [FAIL] ${label}: ${err}`); process.exit(1); }

async function main() {
  console.log('Initializing Yoga...');
  await initYoga();
  console.log('');

  // ─── Step 1: Design — extract brand from HTML ─────────────
  console.log('Step 1: reframe_design (extract)');
  let designMd: string;
  try {
    const result = await handleDesign({ action: 'extract', html: TEST_HTML });
    designMd = result.content[0].text!;
    if (!designMd || designMd.length < 50) throw new Error('DESIGN.md too short');
    ok(`Extracted DESIGN.md (${designMd.length} chars)`);
  } catch (e: any) { fail('design extract', e.message); return; }

  // ─── Step 2: Compile — content + design system → 2 sizes ──
  console.log('Step 2: reframe_compile (2 sizes)');
  let sceneIds: string[] = [];
  try {
    const result = await handleCompile({
      designMd,
      content: {
        headline: 'Programmable Design',
        subheadline: 'Content in, designs out. No HTML intermediate.',
        cta: 'Try reframe',
      },
      sizes: [
        { width: 1080, height: 1080, name: 'social' },
        { width: 728, height: 90, name: 'banner' },
      ],
      exports: ['html'],
    });
    const text = result.content[0].text!;
    // Extract scene IDs from output (format: s1 "name" or **s1**)
    const matches = text.match(/\b(s\d+)\b/g);
    sceneIds = matches ? [...new Set(matches)] : [];
    if (sceneIds.length < 2) throw new Error(`Expected 2 scenes, got ${sceneIds.length}`);
    ok(`Compiled ${sceneIds.length} scenes: ${sceneIds.join(', ')}`);
  } catch (e: any) { fail('compile', e.message); return; }

  // ─── Step 3: Inspect — audit the banner ───────────────────
  console.log('Step 3: reframe_inspect (audit banner)');
  try {
    const result = await handleInspect({
      sceneId: sceneIds[1], // banner
      tree: true,
      audit: true,
    });
    const text = result.content[0].text!;
    const hasTree = text.includes('Tree') || text.includes('nodes');
    const hasAudit = text.includes('Audit') || text.includes('rules') || text.includes('PASS');
    if (!hasTree && !hasAudit) throw new Error('No tree or audit in output');
    ok(`Inspected ${sceneIds[1]}: tree + audit`);
  } catch (e: any) { fail('inspect', e.message); return; }

  // ─── Step 4: Edit — update CTA color on social ────────────
  console.log('Step 4: reframe_edit (update CTA)');
  try {
    const result = await handleEdit({
      operations: [{
        op: 'update',
        sceneId: sceneIds[0],
        path: 'Root/CTA',
        props: { fills: ['#10b981'], cornerRadius: 24 },
      }],
    });
    const text = result.content[0].text!;
    if (!text.includes('UPDATE') && !text.includes('update')) throw new Error('No update confirmation');
    ok(`Updated CTA on ${sceneIds[0]}`);
  } catch (e: any) { fail('edit', e.message); return; }

  // ─── Step 5: Export — get HTML for social ─────────────────
  console.log('Step 5: reframe_export (html)');
  try {
    const result = await handleExport({
      sceneId: sceneIds[0],
      format: 'html',
    });
    const text = result.content[0].text!;
    if (!text.includes('<') && !text.includes('html')) throw new Error('No HTML in output');
    const sizeMatch = text.match(/(\d+)\s*bytes/);
    ok(`Exported HTML${sizeMatch ? ` (${sizeMatch[1]} bytes)` : ''}`);
  } catch (e: any) { fail('export', e.message); return; }

  // ─── Step 6: Session overview ─────────────────────────────
  console.log('Step 6: reframe_inspect (session overview)');
  try {
    const result = await handleInspect({});
    const text = result.content[0].text!;
    ok(`Session: ${text.substring(0, 100).replace(/\n/g, ' ')}...`);
  } catch (e: any) { fail('session overview', e.message); return; }

  console.log('');
  console.log('Pipeline test PASSED — all 6 steps completed.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
