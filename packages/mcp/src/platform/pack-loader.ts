// Pack loader — installable artifact bundles for reframe projects.
//
// A pack is a directory under `.reframe/packs/<kind>/<name>/` with a
// `pack.json` manifest and kind-specific content. Reframe ships with
// back-compat for the pre-pack layout:
//
//   .reframe/brands/<slug>/DESIGN.md         ← implicit brand pack
//   .reframe/ui/<name>.panel.html            ← implicit panel pack
//
// The pack layer formalizes these into a first-class installable unit
// so they can be versioned, distributed (GitHub / registry), and
// declared in `project.json.packs`. Back-compat paths keep working;
// pack-native paths win when both exist for the same name.
//
// Pack kinds (v1):
//   brand    — DESIGN.md + optional tokens.json + assets/
//   panel    — one or more *.panel.html artifacts
//   tool     — MCP tool definitions (future)
//   recipe   — prompt / scene templates (future)
//
// This module is a READER. Install / publish happen via the CLI.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type PackKind = 'brand' | 'panel' | 'tool' | 'recipe' | 'shell';

export interface PackManifest {
  /** Kebab-case name. Unique per kind. */
  name: string;
  /** Semver, 'local', or a git ref for packs installed from VCS. */
  version: string;
  /** Kind selector — drives which loader runs the pack. */
  kind: PackKind;
  /** Kernel compatibility band. */
  kernel?: string;
  /** Short human-readable summary. */
  description?: string;
  /** Entry file relative to pack dir; kind-specific meaning. */
  main?: string;
  /** Pack author(s). */
  author?: string;
  /** License (SPDX). Defaults to 'UNLICENSED' for unpublished packs. */
  license?: string;
}

export interface InstalledPack {
  manifest: PackManifest;
  /** Absolute directory this pack lives in. */
  dir: string;
  /** `<kind>/<name>` — how it's keyed in project.json.packs */
  id: string;
  /** True when the pack lives in the legacy dir (`.reframe/brands/` etc) — we
   *  still surface these so migration can happen lazily. */
  legacy?: boolean;
}

/**
 * Scan `<projectDir>/.reframe/packs/<kind>/<name>/` for pack.json'd
 * installations. Returns all packs; caller filters by kind.
 */
export function scanPacks(projectDir: string): InstalledPack[] {
  const packsRoot = join(projectDir, '.reframe', 'packs');
  const out: InstalledPack[] = [];
  if (!existsSync(packsRoot)) return out;
  for (const kind of readdirSync(packsRoot)) {
    const kindDir = join(packsRoot, kind);
    if (!isDir(kindDir)) continue;
    for (const name of readdirSync(kindDir)) {
      const dir = join(kindDir, name);
      if (!isDir(dir)) continue;
      const manifestPath = join(dir, 'pack.json');
      if (!existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as PackManifest;
        if (!manifest.name || !manifest.kind) continue;
        out.push({ manifest, dir, id: `${manifest.kind}/${manifest.name}` });
      } catch {
        // malformed pack.json — skip, don't crash
      }
    }
  }
  return out;
}

/**
 * Implicit legacy packs — existing `.reframe/brands/<slug>/DESIGN.md`
 * and `.reframe/ui/<name>.panel.html` still load without migration,
 * surfaced as `legacy:true` so tooling can propose `reframe migrate`.
 */
export function scanLegacyImplicitPacks(projectDir: string): InstalledPack[] {
  const out: InstalledPack[] = [];

  // Brands
  const brandsDir = join(projectDir, '.reframe', 'brands');
  if (existsSync(brandsDir)) {
    for (const slug of readdirSync(brandsDir)) {
      const dir = join(brandsDir, slug);
      if (!isDir(dir)) continue;
      const designMd = join(dir, 'DESIGN.md');
      if (!existsSync(designMd)) continue;
      out.push({
        manifest: { name: slug, version: 'local', kind: 'brand', main: 'DESIGN.md' },
        dir,
        id: `brand/${slug}`,
        legacy: true,
      });
    }
  }

  // Panels — each *.panel.html surfaces as its own implicit pack. The
  // panel-registry already reads this directory directly; this enum
  // is for `reframe pack list` + manifest parity, not for registry.
  const uiDir = join(projectDir, '.reframe', 'ui');
  if (existsSync(uiDir)) {
    for (const file of readdirSync(uiDir)) {
      if (!file.endsWith('.panel.html')) continue;
      const name = file.slice(0, -'.panel.html'.length);
      out.push({
        manifest: { name, version: 'local', kind: 'panel', main: file },
        dir: uiDir,
        id: `panel/${name}`,
        legacy: true,
      });
    }
  }

  return out;
}

/**
 * Everything installed — explicit packs + legacy implicit ones.
 * Explicit wins when the same `<kind>/<name>` exists in both.
 */
export function listAllPacks(projectDir: string): InstalledPack[] {
  const explicit = scanPacks(projectDir);
  const legacy = scanLegacyImplicitPacks(projectDir);
  const seen = new Set(explicit.map(p => p.id));
  return [...explicit, ...legacy.filter(p => !seen.has(p.id))];
}

export function listPacksByKind(projectDir: string, kind: PackKind): InstalledPack[] {
  return listAllPacks(projectDir).filter(p => p.manifest.kind === kind);
}

/** Read pack.json for a specific pack id (e.g. `brand/ferrari`). */
export function findPack(projectDir: string, id: string): InstalledPack | null {
  return listAllPacks(projectDir).find(p => p.id === id) ?? null;
}

function isDir(p: string): boolean {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

/** Pretty-print for `reframe pack list`. */
export function formatPackLine(p: InstalledPack): string {
  const tag = p.legacy ? ' (legacy)' : '';
  return `  ${p.id.padEnd(30)} ${p.manifest.version.padEnd(10)} ${p.manifest.description ?? ''}${tag}`;
}
