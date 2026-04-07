/**
 * Minimal argument parser (no external deps).
 */

export interface CliArgs {
  _: string[];
  target?: string;
  targets?: string;
  out?: string;
  'out-dir'?: string;
  outDir?: string;
  strategy?: string;
  format?: string;
  verbose?: boolean;
  help?: boolean;
  [key: string]: any;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { _: [] };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--verbose' || arg === '-v') {
      args.verbose = true;
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(arg);
    }
  }

  // Normalize
  if (args['out-dir']) args.outDir = args['out-dir'];

  return args;
}
