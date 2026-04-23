// State store — persistent KV outside the scene graph.
//
// Lives at `.reframe/state/state.json`. Simple object-map, atomic
// writes (write-rename), agent-readable for session continuity
// ("what brand did the user pin" / "last prompt" / "ref chips on
// hero prompt"). Inspired by bbx's `bbx state set/get/list`.
//
// Not a database. No concurrency primitives beyond the write-rename
// dance. If two agents race on the same key they'll last-write-wins,
// which is fine because state is advisory — the source of truth for
// scenes/brands/exports is the scene graph + pack dirs, not here.

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';

export interface StateBag {
  [key: string]: unknown;
}

function stateFile(projectDir: string): string {
  return join(projectDir, '.reframe', 'state', 'state.json');
}

function readBag(projectDir: string): StateBag {
  const f = stateFile(projectDir);
  if (!existsSync(f)) return {};
  try {
    return JSON.parse(readFileSync(f, 'utf-8')) as StateBag;
  } catch {
    return {};
  }
}

function writeBag(projectDir: string, bag: StateBag): void {
  const f = stateFile(projectDir);
  mkdirSync(dirname(f), { recursive: true });
  const tmp = f + '.tmp';
  writeFileSync(tmp, JSON.stringify(bag, null, 2), 'utf-8');
  renameSync(tmp, f);
}

export function stateGet(projectDir: string, key: string): unknown {
  const bag = readBag(projectDir);
  if (key.includes('.')) {
    return key.split('.').reduce<any>((acc, k) => (acc == null ? undefined : acc[k]), bag);
  }
  return bag[key];
}

export function stateSet(projectDir: string, key: string, value: unknown): void {
  const bag = readBag(projectDir);
  if (key.includes('.')) {
    const parts = key.split('.');
    let cursor: any = bag;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (typeof cursor[p] !== 'object' || cursor[p] == null) cursor[p] = {};
      cursor = cursor[p];
    }
    cursor[parts[parts.length - 1]] = value;
  } else {
    bag[key] = value;
  }
  writeBag(projectDir, bag);
}

export function stateDelete(projectDir: string, key: string): boolean {
  const bag = readBag(projectDir);
  if (!(key in bag)) return false;
  delete bag[key];
  writeBag(projectDir, bag);
  return true;
}

export function stateList(projectDir: string): StateBag {
  return readBag(projectDir);
}

export function stateClear(projectDir: string): void {
  writeBag(projectDir, {});
}
