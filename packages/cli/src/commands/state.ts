// reframe state — persistent KV for the current project.
//
// Usage:
//   reframe state set <key> <value>
//   reframe state get <key>
//   reframe state list
//   reframe state delete <key>
//
// Backed by `.reframe/state/state.json`. Values stored as strings at
// the CLI layer; agents using the runtime directly can store arbitrary
// JSON via the state-store module.

import * as fs from 'node:fs';
import * as path from 'node:path';

function projectRoot(): string {
  const cwd = path.resolve(process.cwd());
  if (!fs.existsSync(path.join(cwd, '.reframe', 'project.json'))) {
    console.error('Not a reframe project (no .reframe/project.json).');
    process.exit(1);
  }
  return cwd;
}

function stateFile(projectDir: string): string {
  return path.join(projectDir, '.reframe', 'state', 'state.json');
}

function readBag(projectDir: string): Record<string, unknown> {
  const f = stateFile(projectDir);
  if (!fs.existsSync(f)) return {};
  try { return JSON.parse(fs.readFileSync(f, 'utf-8')); } catch { return {}; }
}

function writeBag(projectDir: string, bag: Record<string, unknown>): void {
  const f = stateFile(projectDir);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(bag, null, 2), 'utf-8');
  fs.renameSync(tmp, f);
}

export async function stateCommand(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  const projectDir = projectRoot();

  switch (sub) {
    case 'set': {
      const [key, ...valueParts] = rest;
      if (!key || valueParts.length === 0) {
        console.error('Usage: reframe state set <key> <value>');
        process.exit(1);
      }
      const value = valueParts.join(' ');
      const bag = readBag(projectDir);
      bag[key] = coerce(value);
      writeBag(projectDir, bag);
      console.log(`🟢 set ${key} = ${JSON.stringify(bag[key])}`);
      return;
    }
    case 'get': {
      const [key] = rest;
      if (!key) { console.error('Usage: reframe state get <key>'); process.exit(1); }
      const bag = readBag(projectDir);
      if (!(key in bag)) {
        console.error(`(unset)`);
        process.exit(2);
      }
      const v = bag[key];
      process.stdout.write(typeof v === 'string' ? v + '\n' : JSON.stringify(v, null, 2) + '\n');
      return;
    }
    case 'list': case 'ls': {
      const bag = readBag(projectDir);
      const keys = Object.keys(bag);
      if (keys.length === 0) { console.log('(empty)'); return; }
      console.log(`${keys.length} key${keys.length === 1 ? '' : 's'}:\n`);
      for (const k of keys) {
        const v = bag[k];
        const disp = typeof v === 'string' ? v : JSON.stringify(v);
        console.log(`  ${k.padEnd(28)} ${disp.slice(0, 80)}${disp.length > 80 ? '…' : ''}`);
      }
      return;
    }
    case 'delete': case 'rm': {
      const [key] = rest;
      if (!key) { console.error('Usage: reframe state delete <key>'); process.exit(1); }
      const bag = readBag(projectDir);
      if (!(key in bag)) { console.error(`(unset)`); process.exit(2); }
      delete bag[key];
      writeBag(projectDir, bag);
      console.log(`🟢 removed ${key}`);
      return;
    }
    case 'clear': {
      writeBag(projectDir, {});
      console.log(`🟢 state cleared`);
      return;
    }
    default:
      console.error(`Usage:
  reframe state set <key> <value>
  reframe state get <key>
  reframe state list
  reframe state delete <key>
  reframe state clear`);
      process.exit(1);
  }
}

function coerce(s: string): unknown {
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  const n = Number(s);
  if (!isNaN(n) && s.trim() !== '' && /^-?\d/.test(s)) return n;
  // JSON literal
  if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
    try { return JSON.parse(s); } catch { /* fallthrough */ }
  }
  return s;
}
