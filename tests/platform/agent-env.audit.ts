/**
 * Agent environment audit — verify the in-browser Claude subprocess
 * runs with the right cwd, sees CLAUDE.md, reaches the reframe MCP
 * server, and keeps session continuity. Run BEFORE adding skills so
 * we don't build on top of a broken substrate.
 *
 * How it works: we send diagnostic prompts through the actual HTTP
 * endpoint the Platform UI uses (/api/agent/chat) and inspect the
 * stream-json events. We don't click UI — we hit the same pipe the UI
 * hits. Faster + more robust than a full browser test.
 *
 * Run:
 *   1. node packages/mcp/dist/mcp/src/http-server.js &   # sidecar on :4100
 *   2. npx tsx tests/platform/agent-env.audit.ts
 *
 * Prints a pass/fail report. Exits non-zero if any check fails.
 */

const BASE = 'http://localhost:4100';

interface AuditResult { name: string; ok: boolean; detail: string; }
const results: AuditResult[] = [];

function pass(name: string, detail = '') { results.push({ name, ok: true, detail }); console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? ' — ' + detail : ''}`); }
function fail(name: string, detail: string) { results.push({ name, ok: false, detail }); console.log(`  \x1b[31m✗\x1b[0m ${name} — ${detail}`); }

// Drive the same /api/agent/chat SSE endpoint the UI uses. Returns
// captured events: tool calls, text, session-id, plus any error.
async function ask(prompt: string, sessionId?: string): Promise<{
  text: string;
  toolUses: Array<{ name: string; input: any }>;
  toolResults: Array<{ ok: boolean; preview: string }>;
  sessionId: string | null;
  error: string | null;
}> {
  const body: any = { prompt };
  if (sessionId) body.sessionId = sessionId;
  const resp = await fetch(`${BASE}/api/agent/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const out = { text: '', toolUses: [] as any[], toolResults: [] as any[], sessionId: null as string | null, error: null as string | null };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, idx); buf = buf.slice(idx + 2);
      let ev = '', data: any = null;
      for (const line of raw.split(/\r?\n/)) {
        if (line.startsWith('event:')) ev = line.slice(6).trim();
        else if (line.startsWith('data:')) { try { data = JSON.parse(line.slice(5).trim()); } catch {} }
      }
      if (!ev || !data) continue;
      if (ev === 'session_start' && data.sessionId) out.sessionId = data.sessionId;
      if (ev === 'text' && typeof data.text === 'string') out.text += data.text;
      if (ev === 'tool_use') out.toolUses.push({ name: data.toolName, input: data.input });
      if (ev === 'tool_result') out.toolResults.push({ ok: !!data.ok, preview: String(data.preview || '').slice(0, 200) });
      if (ev === 'error') out.error = String(data.message || data.code || 'unknown');
    }
  }
  return out;
}

async function main() {
  // Preflight
  try { const r = await fetch(`${BASE}/health`); if (!r.ok) throw new Error('health ' + r.status); }
  catch (e: any) { console.error('Sidecar not running on :4100 —', e.message); process.exit(1); }

  // ── 1. CLAUDE.md visibility ──
  console.log('\n\x1b[1m1. CLAUDE.md visibility\x1b[0m');
  const r1 = await ask(
    'Using the Read tool, read the CLAUDE.md at the repository root (path: ./CLAUDE.md). ' +
    'Then in one word reply with just the first heading text (strip the # prefix).',
  );
  if (r1.error) fail('CLAUDE.md read', r1.error);
  else if (r1.toolUses.some((t: any) => t.name === 'Read')) {
    pass('CLAUDE.md Read tool invoked');
    if (r1.text.toLowerCase().includes('reframe')) pass('Agent understood CLAUDE.md contents', 'response mentions "reframe"');
    else fail('Agent did not echo CLAUDE.md heading', `text="${r1.text.slice(0, 80)}"`);
  } else fail('Agent did not call Read on CLAUDE.md', `tools used: ${r1.toolUses.map(t => t.name).join(', ') || '(none)'}`);

  // ── 2. cwd check ──
  console.log('\n\x1b[1m2. Subprocess cwd\x1b[0m');
  const r2 = await ask('Use Bash to run `pwd` and tell me the raw output, nothing else.');
  if (r2.error) fail('cwd probe', r2.error);
  else {
    const cwdMatch = r2.text.match(/[a-zA-Z]:[\\/]\S*|\/[a-zA-Z]\S*|\S*reframe\S*/i);
    if (cwdMatch) {
      const looksRight = /reframe/i.test(cwdMatch[0]) && !cwdMatch[0].includes('/packages/mcp');
      if (looksRight) pass('cwd is workspace root', cwdMatch[0]);
      else fail('cwd unexpected', cwdMatch[0]);
    } else fail('cwd not found in response', r2.text.slice(0, 100));
  }

  // ── 3. Reframe MCP tools available ──
  console.log('\n\x1b[1m3. Reframe MCP tools reachable\x1b[0m');
  const r3 = await ask(
    'List the mcp__reframe__* tools you have access to. ' +
    'Reply as a comma-separated list of tool names, nothing else.',
  );
  if (r3.error) fail('MCP tools probe', r3.error);
  else {
    const expected = ['reframe_design', 'reframe_compile', 'reframe_inspect', 'reframe_edit', 'reframe_export', 'reframe_project'];
    const missing = expected.filter(e => !r3.text.includes(e));
    if (missing.length === 0) pass('All 6 core reframe tools visible');
    else fail('Missing tools', missing.join(','));
  }

  // ── 4. Session continuity ──
  console.log('\n\x1b[1m4. Session continuity (--resume)\x1b[0m');
  const r4a = await ask('Remember the number 47 for later. Reply with just "ok".');
  if (!r4a.sessionId) fail('No sessionId on first turn', '');
  else {
    pass('sessionId received', r4a.sessionId.slice(0, 12) + '…');
    const r4b = await ask('What number did I ask you to remember?', r4a.sessionId);
    if (r4b.text.includes('47')) pass('Agent recalled 47 across turns', 'session resume works');
    else fail('Session continuity broken', `response: "${r4b.text.slice(0, 80)}"`);
  }

  // ── 5. Skill discovery ──
  // Four reframe skills should be present on disk AND auto-discovered by
  // Claude Code's skill system. We check both: (a) filesystem presence
  // via Bash, (b) whether the agent's description-based trigger actually
  // fires the right skill on a realistic intent.
  console.log('\n\x1b[1m5. Skill discovery\x1b[0m');
  const r5 = await ask(
    'Use Bash to run `ls .claude/skills/`. Reply with just the raw output.',
  );
  if (r5.error) fail('Skills ls probe', r5.error);
  else {
    const expected = ['reframe-design', 'reframe-brand', 'reframe-site-loop', 'reframe-enhance', 'reframe-critic', 'reframe-to-react'];
    const missing = expected.filter(e => !r5.text.includes(e));
    if (missing.length === 0) pass(`All ${expected.length} skills on disk`);
    else fail('Missing skill dirs', missing.join(','));
  }

  // ── 6. Skill trigger fires on intent ──
  // Simulate a design intent that should trigger reframe-design. The
  // agent's `skills used` or first tool call tells us if it activated.
  console.log('\n\x1b[1m6. Skill trigger on design intent\x1b[0m');
  const r6 = await ask(
    'I want to make a simple pricing page. Before doing anything, tell me in one sentence which reframe skill you would use and why. Do not take any action — just name the skill.',
  );
  if (r6.error) fail('Trigger probe', r6.error);
  else if (/reframe-design/i.test(r6.text)) pass('Agent recognizes reframe-design for design intent', r6.text.slice(0, 100));
  else fail('Agent did not name reframe-design', r6.text.slice(0, 120));

  // ── 7. Brand skill trigger ──
  console.log('\n\x1b[1m7. Skill trigger on brand intent\x1b[0m');
  const r7 = await ask(
    'I want to rebrand this scene to Stripe. Before doing anything, tell me in one sentence which skill you would use first. Do not take any action.',
  );
  if (r7.error) fail('Brand trigger probe', r7.error);
  else if (/reframe-brand/i.test(r7.text)) pass('Agent recognizes reframe-brand for brand intent', r7.text.slice(0, 100));
  else fail('Agent did not name reframe-brand', r7.text.slice(0, 120));

  // ── 8. Critic skill trigger ──
  // Review / critique intent should route to reframe-critic, not back
  // into reframe-design (which is for generating, not evaluating).
  console.log('\n\x1b[1m8. Skill trigger on review intent\x1b[0m');
  const r8 = await ask(
    'I just finished a pricing page. How does it look? Can you review it? Tell me in one sentence which skill you would use. Do not take any action.',
  );
  if (r8.error) fail('Critic trigger probe', r8.error);
  else if (/reframe-critic/i.test(r8.text)) pass('Agent recognizes reframe-critic for review intent', r8.text.slice(0, 100));
  else fail('Agent did not name reframe-critic', r8.text.slice(0, 120));

  // ── 9. React export skill trigger ──
  console.log('\n\x1b[1m9. Skill trigger on React export intent\x1b[0m');
  const r9a = await ask(
    'I want to export this scene as production-ready React components I can drop into my Next.js app. Which skill would you use? Tell me in one sentence. Do not take any action.',
  );
  if (r9a.error) fail('React trigger probe', r9a.error);
  else if (/reframe-to-react/i.test(r9a.text)) pass('Agent recognizes reframe-to-react for prod-React export', r9a.text.slice(0, 100));
  else fail('Agent did not name reframe-to-react', r9a.text.slice(0, 120));

  // ── 10. Project scenes in preamble ──
  // The context.ts preamble now lists ALL scenes with status. The
  // agent should be able to enumerate them without calling any tools.
  console.log('\n\x1b[1m10. Full-project scene listing in preamble\x1b[0m');
  const r9 = await ask(
    'Without calling any tools, how many scenes are currently in this reframe project? Answer with just the number.',
  );
  if (r9.error) fail('Scenes count probe', r9.error);
  else {
    // Cross-check against the actual session scene list so this test
    // doesn't rot as scenes are added/removed between runs. Agent is
    // correct if its number matches what /scenes returns.
    const actualScenes = await fetch(`${BASE}/scenes`).then(r => r.json()).catch(() => []);
    const actualCount = Array.isArray(actualScenes) ? actualScenes.length : -1;
    const n = (r9.text.match(/\b(\d+)\b/) || [])[1];
    const parsed = n ? parseInt(n, 10) : NaN;
    if (!Number.isNaN(parsed) && parsed === actualCount) pass('Agent sees project scenes in preamble', `${parsed} scenes (matches /scenes)`);
    else fail('Scene count mismatch', `agent said ${parsed}, /scenes returned ${actualCount}`);
  }

  // ── Summary ──
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n\x1b[1mSummary:\x1b[0m ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailures:');
    for (const r of results.filter(x => !x.ok)) console.log(`  - ${r.name}: ${r.detail}`);
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
