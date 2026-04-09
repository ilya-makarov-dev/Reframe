#!/usr/bin/env node

/**
 * Reframe MCP Server v2 — 6 tools (design, compile, edit, inspect, export, project).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { registerReframeMcpTools } from './register-tools.js';
import { initYoga } from '../../core/src/engine/yoga-init.js';
import { VERSION } from './version.js';
import { startHttpSidecar } from './http-server.js';
import { projectExists } from '../../core/src/project/io.js';
import { setDeferredProjectInit, loadProjectScenes } from './store.js';
import { setProjectDir } from './tools/project.js';

import { getReframeInstructions } from './instructions.js';

const server = new McpServer({
  name: 'reframe',
  version: VERSION,
}, {
  instructions: getReframeInstructions(),
});

registerReframeMcpTools(server);

async function main() {
  await initYoga();

  const cwd = process.cwd();
  if (projectExists(cwd)) {
    // Use tools/project setProjectDir so session store and reframe_project._projectDir stay in sync.
    setProjectDir(cwd);
    const count = loadProjectScenes(cwd);
    if (count > 0) {
      process.stderr.write(`reframe: loaded ${count} scene(s) from ${cwd}/.reframe\n`);
    }
  } else {
    setDeferredProjectInit(cwd);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const port = parseInt(process.env.REFRAME_HTTP_PORT ?? '4100', 10);
  startHttpSidecar(port);
}

main().catch((err) => {
  process.stderr.write(`reframe MCP error: ${err.message}\n`);
  process.exit(1);
});
