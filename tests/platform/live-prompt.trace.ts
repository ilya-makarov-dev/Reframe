/**
 * Live prompt trace — send a realistic design request through the
 * in-app chat endpoint and capture the full agent transcript so we
 * can see what skills fired, what tools got called, and whether the
 * chain actually produced a scene.
 *
 * This is the "test drive" — not a regression test. Output is for
 * human review, not pass/fail assertions. Run:
 *   npx tsx tests/platform/live-prompt.trace.ts
 */

// Node's built-in fetch uses undici (bundled, not importable). Its
// default bodyTimeout is 300s — long agent runs exceed that. Since we
// can't reconfigure the global dispatcher without adding undici as a
// dep, use a raw http request instead of fetch. Browsers don't have
// this timeout on EventSource, so the Platform UI is unaffected.
const http = require('http') as typeof import('http');

const BASE = 'http://localhost:4100';

const PROMPT = process.argv[2] || 'Сделай простой hero section с брендом Linear — только headline + subtext + primary CTA. Без остальных секций.';

interface Event {
  type: string;
  data: any;
  t: number; // ms since stream start
}

function stream(prompt: string, t0: number): Promise<{ events: Event[]; sessionId: string | null; finalText: string }> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ prompt });
    const req = http.request(`${BASE}/api/agent/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (resp) => {
      if (resp.statusCode !== 200) return reject(new Error(`HTTP ${resp.statusCode}`));
      // Disable socket timeout — agent runs can take minutes.
      resp.socket?.setTimeout(0);
      let buf = '';
      const events: Event[] = [];
      let sessionId: string | null = null;
      let finalText = '';
      resp.setEncoding('utf8');
      resp.on('data', (chunk: string) => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const raw = buf.slice(0, idx); buf = buf.slice(idx + 2);
          let ev = '', data: any = null;
          for (const line of raw.split(/\r?\n/)) {
            if (line.startsWith('event:')) ev = line.slice(6).trim();
            else if (line.startsWith('data:')) { try { data = JSON.parse(line.slice(5).trim()); } catch {} }
          }
          if (!ev || !data) continue;
          events.push({ type: ev, data, t: Date.now() - t0 });
          if (ev === 'session_start' && data.sessionId) sessionId = data.sessionId;
          if (ev === 'text' && typeof data.text === 'string') finalText += data.text;
        }
      });
      resp.on('end', () => resolve({ events, sessionId, finalText }));
      resp.on('error', reject);
    });
    req.setTimeout(0); // no client-side timeout
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function color(c: string, s: string): string {
  const map: Record<string, string> = { red: '31', green: '32', yellow: '33', blue: '34', magenta: '35', cyan: '36', gray: '90' };
  return `\x1b[${map[c] || '0'}m${s}\x1b[0m`;
}

function trunc(s: any, n = 120): string {
  const str = typeof s === 'string' ? s : JSON.stringify(s);
  return str.length > n ? str.slice(0, n) + '…' : str;
}

async function main() {
  console.log(color('cyan', '─'.repeat(80)));
  console.log(color('cyan', 'Live prompt trace'));
  console.log(color('cyan', '─'.repeat(80)));
  console.log(color('gray', 'Prompt:'));
  console.log('  ' + PROMPT);
  console.log('');

  const t0 = Date.now();
  const { events, sessionId, finalText } = await stream(PROMPT, t0);
  const dtSec = ((Date.now() - t0) / 1000).toFixed(1);

  // Counts
  const textEvents = events.filter(e => e.type === 'text');
  const toolUses = events.filter(e => e.type === 'tool_use');
  const toolResults = events.filter(e => e.type === 'tool_result');
  const errors = events.filter(e => e.type === 'error');

  // ─── Tool call timeline ───
  console.log(color('cyan', 'Tool timeline'));
  console.log(color('cyan', '─'.repeat(80)));
  if (toolUses.length === 0) {
    console.log(color('yellow', '  (no tool calls — agent only talked)'));
  } else {
    for (let i = 0; i < toolUses.length; i++) {
      const t = toolUses[i].data;
      const result = toolResults.find(r => r.data.toolUseId === t.toolUseId);
      const ok = result ? result.data.ok : null;
      const mark = ok === true ? color('green', '✓') : ok === false ? color('red', '✗') : color('gray', '·');
      const name = color('magenta', t.toolName.padEnd(35));
      const input = trunc(t.input, 100);
      const tStart = toolUses[i].t;
      const tEnd = result ? result.t : null;
      const dur = tEnd ? `${((tEnd - tStart) / 1000).toFixed(1)}s` : '    ';
      const mark2 = `[${String(Math.round(tStart/1000)).padStart(3)}s +${dur}]`;
      console.log(`  ${mark} ${color('gray', mark2)} ${String(i + 1).padStart(2)}. ${name} ${color('gray', input)}`);
      if (result && result.data.preview) {
        const preview = trunc(result.data.preview, 120).replace(/\n/g, ' ');
        console.log(color('gray', `       → ${preview}`));
      }
    }
  }
  console.log('');

  // ─── Assistant narrative ───
  console.log(color('cyan', 'Agent narrative'));
  console.log(color('cyan', '─'.repeat(80)));
  if (finalText) {
    console.log(finalText.split('\n').map(l => '  ' + l).join('\n'));
  } else {
    console.log(color('yellow', '  (no text output)'));
  }
  console.log('');

  // ─── Skill detection ───
  console.log(color('cyan', 'Skill activation (inferred from text + tool usage)'));
  console.log(color('cyan', '─'.repeat(80)));
  const skills = [
    { name: 'reframe-brand',    signals: ['reframe-brand', 'extract', 'DESIGN.md'], toolHint: (t: string) => t.includes('reframe_design') },
    { name: 'reframe-enhance',  signals: ['reframe-enhance', 'DESIGN SYSTEM', 'Page Structure'], toolHint: () => false },
    { name: 'reframe-design',   signals: ['reframe-design', 'pipeline', 'compile'], toolHint: (t: string) => t.includes('reframe_compile') || t.includes('reframe_edit') },
    { name: 'reframe-critic',   signals: ['reframe-critic', 'holds up', 'worth fixing'], toolHint: (t: string) => t.includes('reframe_inspect') },
    { name: 'reframe-site-loop',signals: ['reframe-site-loop', 'SITE.md', 'next-prompt'], toolHint: () => false },
    { name: 'reframe-to-react', signals: ['reframe-to-react', 'React components'], toolHint: (t: string) => t.includes('reframe_export') },
  ];
  const toolNames = toolUses.map(t => t.data.toolName).join(' ');
  for (const s of skills) {
    const textHit = s.signals.some(sig => finalText.toLowerCase().includes(sig.toLowerCase()));
    const toolHit = s.toolHint(toolNames);
    const fired = textHit || toolHit;
    const mark = fired ? color('green', '●') : color('gray', '○');
    const why = [textHit ? 'text' : null, toolHit ? 'tool' : null].filter(Boolean).join('+') || '—';
    console.log(`  ${mark} ${s.name.padEnd(25)} ${color('gray', why)}`);
  }
  console.log('');

  // ─── Summary ───
  console.log(color('cyan', 'Summary'));
  console.log(color('cyan', '─'.repeat(80)));
  console.log(`  duration:     ${dtSec}s`);
  console.log(`  session:      ${sessionId || '(none)'}`);
  console.log(`  text events:  ${textEvents.length} (${finalText.length} chars total)`);
  console.log(`  tool calls:   ${toolUses.length}`);
  console.log(`  tool results: ${toolResults.length}`);
  console.log(`  errors:       ${errors.length}`);
  if (errors.length > 0) {
    for (const e of errors) console.log(color('red', `    ${e.data.code || '?'}: ${trunc(e.data.message, 100)}`));
  }

  // ─── Scene check ───
  // If the agent compiled something, ask the session scene list for a new scene.
  console.log('');
  console.log(color('cyan', 'Scene check (after run)'));
  console.log(color('cyan', '─'.repeat(80)));
  try {
    const scenes = await fetch(`${BASE}/scenes`).then(r => r.json()).catch(() => null);
    if (Array.isArray(scenes)) {
      console.log(`  ${scenes.length} scenes total in session`);
      for (const s of scenes.slice(-5)) {
        console.log(`    · ${s.id || '?'} ${s.slug || ''} "${s.name || ''}" (${s.size || '?'}, ${s.nodes || 0} nodes)`);
      }
    } else {
      console.log(color('yellow', '  (scene list endpoint unavailable)'));
    }
  } catch (e: any) {
    console.log(color('yellow', `  scene fetch failed: ${e.message}`));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
