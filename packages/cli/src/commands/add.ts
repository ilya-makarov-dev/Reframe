// reframe add — install a pack into the current project.
//
// v1 supports three install sources:
//   - Local directory:       reframe add ./path/to/pack
//   - Local tarball:         reframe add ./pack-ferrari-1.0.tgz  (unimpl)
//   - Git URL:               reframe add github:org/repo#ref     (unimpl)
//
// The pack's `pack.json` is authoritative — dictates kind + name. We
// copy the entire directory into `.reframe/packs/<kind>/<name>/` and
// update `.reframe/project.json` → packs.<kind>/<name> so the manifest
// stays the record of truth.
//
// Usage:
//   reframe add ./my-brand
//   reframe add ./packs/panel-timeline

import * as fs from 'node:fs';
import * as path from 'node:path';

export async function addCommand(args: string[], flags: Record<string, string | undefined>): Promise<void> {
  const source = args[0];
  if (!source) {
    console.error('Usage: reframe add <path-to-pack>');
    process.exit(1);
  }
  const cwd = process.cwd();
  const manifestPath = path.join(cwd, '.reframe', 'project.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`Not a reframe project (no .reframe/project.json).`);
    process.exit(1);
  }

  const sourceDir = path.resolve(source);
  if (!fs.existsSync(sourceDir)) {
    console.error(`Source not found: ${sourceDir}`);
    process.exit(1);
  }
  const stat = fs.statSync(sourceDir);
  if (!stat.isDirectory()) {
    console.error(`Expected a directory (tarball/git sources not yet supported in v1)`);
    process.exit(1);
  }

  const packJsonPath = path.join(sourceDir, 'pack.json');
  if (!fs.existsSync(packJsonPath)) {
    console.error(`No pack.json in ${sourceDir}. Not a valid reframe pack.`);
    process.exit(1);
  }
  let pack: { name: string; kind: string; version: string };
  try {
    pack = JSON.parse(fs.readFileSync(packJsonPath, 'utf-8'));
  } catch (e: any) {
    console.error(`Malformed pack.json: ${e?.message ?? e}`);
    process.exit(1);
  }
  if (!pack.name || !pack.kind) {
    console.error(`pack.json missing required fields (name, kind)`);
    process.exit(1);
  }

  const target = path.join(cwd, '.reframe', 'packs', pack.kind, pack.name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) {
    if (!flags.force) {
      console.error(`Already installed at ${target}. Re-install with --force to overwrite.`);
      process.exit(1);
    }
    fs.rmSync(target, { recursive: true, force: true });
  }

  copyDir(sourceDir, target);

  // Update manifest
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  manifest.packs = manifest.packs ?? {};
  manifest.packs[`${pack.kind}/${pack.name}`] = {
    version: pack.version ?? 'local',
    source: path.relative(cwd, target).replace(/\\/g, '/'),
    installedAt: new Date().toISOString(),
  };
  manifest.updated = new Date().toISOString();
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  console.log(`🟢 Installed ${pack.kind}/${pack.name}@${pack.version ?? 'local'}`);
  console.log(`   → ${path.relative(cwd, target)}`);
}

function copyDir(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}
