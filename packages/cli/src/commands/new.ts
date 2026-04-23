// reframe new — scaffold a brand new reframe project.
//
// Creates `<name>/` with:
//   .reframe/project.json    ← manifest v1 (distro, shell, kernel, packs)
//   .reframe/scenes/          ← user INode graphs
//   .reframe/brands/          ← legacy brand directory (kept for back-compat)
//   .reframe/packs/           ← installable packs root
//   .reframe/ui/              ← loose panel artifacts (legacy-friendly)
//   src/                      ← HTML sources for `reframe_compile`
//   DESIGN.md (optional)      ← starter brand, if --brand provided locally
//
// Usage:
//   reframe new my-project [--shell=studio] [--distro=studio] [--kernel=^1.0]

import * as fs from 'node:fs';
import * as path from 'node:path';

export async function newCommand(args: string[], flags: Record<string, string | undefined>): Promise<void> {
  const projectName = args[0];
  if (!projectName) {
    console.error('Usage: reframe new <project-name> [--shell=studio] [--distro=studio]');
    process.exit(1);
  }
  const target = path.resolve(process.cwd(), projectName);
  if (fs.existsSync(target)) {
    console.error(`Error: ${target} already exists`);
    process.exit(1);
  }

  const shell = flags.shell ?? 'studio';
  const distro = flags.distro ?? 'studio';
  const kernel = flags.kernel ?? '^1.0';

  // Layout
  fs.mkdirSync(target);
  fs.mkdirSync(path.join(target, '.reframe'));
  fs.mkdirSync(path.join(target, '.reframe', 'scenes'));
  fs.mkdirSync(path.join(target, '.reframe', 'brands'));
  fs.mkdirSync(path.join(target, '.reframe', 'packs'));
  fs.mkdirSync(path.join(target, '.reframe', 'ui'));
  fs.mkdirSync(path.join(target, 'src'));

  // Manifest
  const now = new Date().toISOString();
  const manifest = {
    reframe: '1',
    name: projectName,
    distro,
    shell,
    kernel,
    packs: {},
    created: now,
    updated: now,
    version: 1,
    brands: {},
    scenes: [],
  };
  fs.writeFileSync(
    path.join(target, '.reframe', 'project.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8',
  );

  // Starter README
  fs.writeFileSync(path.join(target, 'README.md'), `# ${projectName}

A reframe project. Default shell: \`${shell}\`.

## Getting started

\`\`\`bash
reframe serve     # starts the local sidecar + opens the ${shell} shell
reframe add brand/stripe   # install a brand pack
reframe ship             # build production exports
\`\`\`
`, 'utf-8');

  console.log(`🟢 Created ${projectName}`);
  console.log(`   distro: ${distro} · shell: ${shell} · kernel: ${kernel}`);
  console.log(`\nNext:`);
  console.log(`   cd ${projectName}`);
  console.log(`   reframe serve`);
}
