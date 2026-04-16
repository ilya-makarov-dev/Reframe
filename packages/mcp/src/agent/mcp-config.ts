/**
 * Ensure a `.mcp.json` exists in the workspace so the spawned `claude`
 * subprocess can discover the reframe MCP server automatically.
 *
 * claude reads .mcp.json from cwd (and parents) on startup. Without it
 * the spawned agent would have no reframe tools. We write a default
 * config pointing at `npx tsx packages/mcp/src/index.ts` (matches the
 * project's existing dev convention) only when no .mcp.json is present.
 *
 * If the user already has their own .mcp.json (e.g. with extra MCPs)
 * we leave it alone — they know what they're doing.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface EnsureMcpConfigResult {
  /** Path to the .mcp.json (whether we wrote it or not). */
  path: string;
  /** True if we wrote a new file; false if pre-existing. */
  created: boolean;
  /** True if the existing file already contained the reframe server. */
  hasReframe: boolean;
}

/**
 * Check workspace for .mcp.json. If missing, write a default config
 * registering the reframe server. If present, verify it has reframe.
 */
export function ensureMcpConfig(workspaceDir: string = process.cwd()): EnsureMcpConfigResult {
  const path = join(workspaceDir, '.mcp.json');

  if (existsSync(path)) {
    let hasReframe = false;
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8'));
      hasReframe = !!raw?.mcpServers?.reframe;
    } catch {
      // Malformed file — leave it; agent spawn will still try.
    }
    return { path, created: false, hasReframe };
  }

  // Use the prebuilt JS entry — much faster startup than tsx (which
  // recompiles on every spawn) and has no Windows shell quirks. The
  // user must `npm run build` once after install; we assume that's done.
  const config = {
    mcpServers: {
      reframe: {
        type: 'stdio',
        command: 'node',
        args: ['packages/mcp/dist/mcp/src/index.js'],
        // Prevent the spawned MCP from starting its own HTTP sidecar and
        // conflicting with the parent's port 4100.
        env: { REFRAME_HTTP_PORT: '0' },
      },
    },
  };

  try {
    writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf8');
    return { path, created: true, hasReframe: true };
  } catch {
    return { path, created: false, hasReframe: false };
  }
}
