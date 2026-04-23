// reframe serve — spawn the local sidecar and open the shell in browser.
//
// Wraps the existing dev-mode bootstrap. The sidecar reads the project
// manifest, picks the declared shell, loads installed packs, then binds
// the HTTP port (default 4100). Open-browser is best-effort; skips if
// running headless.

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export async function serveCommand(args: string[], flags: Record<string, string | undefined>): Promise<void> {
  const cwd = path.resolve(process.cwd());
  const manifest = path.join(cwd, '.reframe', 'project.json');
  if (!fs.existsSync(manifest)) {
    console.error(`No .reframe/ in ${cwd}. Run \`reframe new <name>\` first.`);
    process.exit(1);
  }
  const port = flags.port ?? process.env.REFRAME_HTTP_PORT ?? '4100';
  const url = `http://localhost:${port}/platform`;

  console.log(`🟢 reframe serve · project=${cwd} · port=${port}`);
  console.log(`   opening ${url} once sidecar is up…\n`);

  // Locate sidecar entry — works when cli + mcp are workspace-linked
  // (the canonical layout when this CLI is installed globally from the
  // reframe monorepo or npm workspace). For stand-alone installs we
  // defer to `npx reframe-sidecar` via the mcp package's bin, not
  // implemented yet; fall back to that path.
  const sidecarEntry = resolveSidecarEntry(cwd);
  if (!sidecarEntry) {
    console.error('Could not locate @reframe/mcp sidecar binary. Make sure @reframe/mcp is installed in this workspace.');
    process.exit(1);
  }

  const env = {
    ...process.env,
    REFRAME_HTTP_PORT: port,
    REFRAME_HTTP_FORCE: '1',
  };

  const child = spawn(process.execPath, [sidecarEntry], { stdio: 'inherit', env, cwd });

  // Best-effort browser open after a short delay
  setTimeout(() => { void openBrowser(url); }, 1500);

  child.on('exit', code => process.exit(code ?? 0));
}

function resolveSidecarEntry(cwd: string): string | null {
  const candidates = [
    // Workspace layout (monorepo): cli's sibling package
    path.resolve(cwd, 'packages', 'mcp', 'dist', 'mcp', 'src', 'index.js'),
    // Installed alongside cli in node_modules
    path.resolve(cwd, 'node_modules', '@reframe', 'mcp', 'dist', 'mcp', 'src', 'index.js'),
    // Inside this package's node_modules
    path.resolve(__dirname, '..', '..', '..', 'mcp', 'dist', 'mcp', 'src', 'index.js'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function openBrowser(url: string): Promise<void> {
  const cmd = process.platform === 'win32'
    ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]];
  try {
    const [bin, bargs] = cmd as [string, string[]];
    spawn(bin, bargs, { stdio: 'ignore', detached: true }).unref();
  } catch {
    // Headless env — skip, let the user click the URL in the log.
  }
}
