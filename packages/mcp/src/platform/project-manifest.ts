// Project manifest — `.reframe/project.json` v1 schema.
//
// Defines what makes a reframe "project container". Every new field
// is OPTIONAL with a studio default, so pre-existing projects keep
// working without migration; the manifest reader fills in implicit
// values and the sidecar boot path uses them to pick the shell, load
// installed packs, and enforce the kernel-compatibility band.
//
// Layer this sits at:
//   kernel (core)  — knows nothing about manifests
//   runtime (mcp)  — reads the manifest, selects shell + packs
//   shell (studio) — consumes what runtime loaded

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface ProjectManifest {
  /** Manifest format version. Current: "1". Older projects default. */
  reframe: string;
  /** Human-readable project name. */
  name: string;
  /** Distro identity — what "flavor" of reframe this project expects. */
  distro: 'studio' | 'decks' | 'sites' | 'custom' | string;
  /**
   * Shell this project boots into. Names resolved through the shell
   * registry; unknown name → warn + fall back to studio.
   */
  shell: string;
  /** Kernel compatibility band. "^1.0" = reframe 1.x kernel. */
  kernel: string;
  /** Installed packs. Keys are `<kind>/<name>`, e.g. `brand/ferrari`. */
  packs: Record<string, PackInstall>;
  /** ISO timestamps — managed by the runtime. */
  created?: string;
  updated?: string;

  // Legacy fields preserved as-is for back-compat with existing on-disk projects.
  // New code SHOULD NOT depend on these — prefer enumerating packs / querying
  // the scene store. Kept here so round-tripping the manifest doesn't drop data.
  version?: number;
  brands?: Record<string, LegacyBrandEntry>;
  scenes?: LegacyScene[];
  activeBrand?: string;
}

export interface PackInstall {
  /** Semver-ish tag or "local" when installed via `reframe add <path>`. */
  version: string;
  /** Where the pack lives on disk relative to project root. */
  source: string;
  /** When the pack was installed. */
  installedAt?: string;
}

export interface LegacyBrandEntry {
  slug: string;
  path: string;
  hash?: string;
  updated?: string;
}

export interface LegacyScene {
  id: string;
  slug: string;
  name: string;
  file: string;
  width?: number;
  height?: number;
  nodes?: number;
  source?: string;
  created?: string;
  updated?: string;
  revision?: number;
}

/** Absent-field defaults — projects made before the packaging refactor get these. */
export const MANIFEST_DEFAULTS = {
  reframe: '1',
  distro: 'studio',
  shell: 'studio',
  kernel: '^1.0',
} as const;

/**
 * Read and normalize `.reframe/project.json`. Missing fields filled with
 * studio defaults; unknown extra fields preserved untouched so nothing
 * gets dropped on the next save.
 */
export function readManifest(projectDir: string): ProjectManifest | null {
  const file = join(projectDir, '.reframe', 'project.json');
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as Partial<ProjectManifest>;
    return normalizeManifest(raw);
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error(`[reframe] failed to read project manifest: ${e?.message ?? e}`);
    return null;
  }
}

export function normalizeManifest(raw: Partial<ProjectManifest>): ProjectManifest {
  return {
    reframe: raw.reframe ?? MANIFEST_DEFAULTS.reframe,
    name: raw.name ?? 'unnamed',
    distro: (raw.distro as ProjectManifest['distro']) ?? MANIFEST_DEFAULTS.distro,
    shell: raw.shell ?? MANIFEST_DEFAULTS.shell,
    kernel: raw.kernel ?? MANIFEST_DEFAULTS.kernel,
    packs: raw.packs ?? {},
    created: raw.created,
    updated: raw.updated,
    version: raw.version,
    brands: raw.brands,
    scenes: raw.scenes,
    activeBrand: raw.activeBrand,
  };
}

/** Write manifest back. Preserves legacy fields so existing tools keep working. */
export function writeManifest(projectDir: string, manifest: ProjectManifest): void {
  const file = join(projectDir, '.reframe', 'project.json');
  const toWrite: Record<string, unknown> = {
    // New fields first — makes on-disk manifests visibly distro-aware.
    reframe: manifest.reframe,
    name: manifest.name,
    distro: manifest.distro,
    shell: manifest.shell,
    kernel: manifest.kernel,
    packs: manifest.packs,
    created: manifest.created,
    updated: new Date().toISOString(),
  };
  // Legacy fields retained so current code that reads them still works.
  if (manifest.version !== undefined) toWrite.version = manifest.version;
  if (manifest.brands !== undefined) toWrite.brands = manifest.brands;
  if (manifest.scenes !== undefined) toWrite.scenes = manifest.scenes;
  if (manifest.activeBrand !== undefined) toWrite.activeBrand = manifest.activeBrand;
  writeFileSync(file, JSON.stringify(toWrite, null, 2), 'utf-8');
}

/**
 * Scaffold a fresh manifest — used by `reframe new`.
 */
export function blankManifest(name: string, opts: Partial<Pick<ProjectManifest, 'distro' | 'shell' | 'kernel'>> = {}): ProjectManifest {
  const now = new Date().toISOString();
  return {
    reframe: MANIFEST_DEFAULTS.reframe,
    name,
    distro: opts.distro ?? MANIFEST_DEFAULTS.distro,
    shell: opts.shell ?? MANIFEST_DEFAULTS.shell,
    kernel: opts.kernel ?? MANIFEST_DEFAULTS.kernel,
    packs: {},
    created: now,
    updated: now,
    // Legacy init values so old loaders also work on a fresh project.
    version: 1,
    brands: {},
    scenes: [],
  };
}
