// reframe run — execute a `.rfx.yml` workflow against the local kernel.
//
// Headless. Does NOT require the sidecar to be running — builds the
// adapter registry in-process by loading the runtime's adapter-bindings
// module directly. Prints a summary per step + final outputs.
//
// Usage:
//   reframe run workflow.rfx.yml [--inputs key=val ...]

import * as fs from 'node:fs';
import * as path from 'node:path';

export async function runCommand(args: string[], flags: Record<string, any>): Promise<void> {
  const file = args[0];
  if (!file) {
    console.error('Usage: reframe run <workflow.rfx.yml>');
    process.exit(1);
  }
  const absFile = path.resolve(file);
  if (!fs.existsSync(absFile)) {
    console.error(`Workflow not found: ${absFile}`);
    process.exit(1);
  }

  const cwd = path.resolve(process.cwd());

  // Load the adapter registry side-effect module. We try the installed
  // dist path first, then fall back to the source path when running
  // from the monorepo.
  try {
    const distPath = path.join(cwd, 'node_modules', '@reframe', 'mcp', 'dist', 'mcp', 'src', 'platform', 'adapter-bindings.js');
    if (fs.existsSync(distPath)) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require(distPath);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require(path.resolve(__dirname, '..', '..', '..', 'mcp', 'dist', 'mcp', 'src', 'platform', 'adapter-bindings.js'));
    }
  } catch (e: any) {
    console.error(`Failed to load adapter registry: ${e?.message ?? e}`);
    console.error('Run `npm run build` or install @reframe/mcp first.');
    process.exit(1);
  }

  // Load the workflow runtime.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readWorkflow, runWorkflow } = require(resolveRuntime('core/dist/core/src/workflow/runner.js'));

  const wf = readWorkflow(absFile);

  // Parse --inputs flags
  const inputs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flags)) {
    if (k === '_' || k === 'inputs') continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      inputs[k] = v;
    }
  }

  console.log(`🟢 running ${wf.id}${wf.name ? ` · ${wf.name}` : ''} (${wf.steps.length} steps)\n`);

  const result = await runWorkflow(wf, inputs, { projectDir: cwd });

  for (const [stepId, r] of Object.entries<any>(result.steps)) {
    const mark = r.skipped ? '⚪' : r.ok ? '🟢' : '🔴';
    const ms = r.elapsedMs ? `${Math.round(r.elapsedMs)}ms` : '';
    const note = r.skipped ? 'skipped' : r.error ? ` ${r.error}` : '';
    console.log(`  ${mark} ${stepId.padEnd(24)} ${r.adapter.padEnd(24)} ${ms.padStart(7)}${note}`);
  }

  if (Object.keys(result.outputs).length > 0) {
    console.log(`\noutputs:`);
    for (const [k, v] of Object.entries(result.outputs)) {
      console.log(`  ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
    }
  }

  console.log(`\n${result.ok ? '🟢 PASS' : '🔴 FAIL'} in ${Math.round(result.elapsedMs)}ms`);
  if (!result.ok) process.exit(1);
}

function resolveRuntime(subpath: string): string {
  const tryPaths = [
    path.resolve(process.cwd(), 'node_modules', '@reframe', subpath),
    path.resolve(__dirname, '..', '..', '..', subpath),
  ];
  for (const p of tryPaths) if (fs.existsSync(p)) return p;
  throw new Error(`Cannot resolve @reframe runtime at ${subpath}`);
}
