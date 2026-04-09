/**
 * Single lazy `require` site for core `project/io` (ESM/CJS interop in MCP).
 */

type ProjectIo = typeof import('../../core/src/project/io.js');

let cached: ProjectIo | null = null;

export function coreProjectIo(): ProjectIo {
  if (!cached) {
    // `require` keeps one copy and avoids top-level circular import issues.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('../../core/src/project/io.js') as ProjectIo;
  }
  return cached;
}
