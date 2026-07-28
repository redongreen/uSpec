import { runPrepare, manifestForStdout } from '../component-md/prepare.js';

interface ParsedArgs {
  base?: string;
  output?: string;
  cwd?: string;
  context?: string;
  slug?: string;
  json?: boolean;
  help?: boolean;
}

function parsePrepareArgs(args: string[]): ParsedArgs | { error: string } {
  const result: ParsedArgs = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') {
      result.help = true;
    } else if (a === '--base') {
      const v = args[++i];
      if (!v) return { error: '--base requires a value' };
      result.base = v;
    } else if (a === '--output') {
      const v = args[++i];
      if (!v) return { error: '--output requires a value' };
      result.output = v;
    } else if (a === '--cwd') {
      const v = args[++i];
      if (!v) return { error: '--cwd requires a value' };
      result.cwd = v;
    } else if (a === '--context') {
      const v = args[++i];
      if (!v) return { error: '--context requires a value' };
      result.context = v;
    } else if (a === '--slug') {
      const v = args[++i];
      if (!v) return { error: '--slug requires a value' };
      result.slug = v;
    } else if (a === '--json') {
      result.json = true;
    } else {
      return { error: `unknown argument: ${a}` };
    }
  }
  return result;
}

function printPrepareHelp(): void {
  console.log(`uspec-skills component-md prepare - validate and stage _base.json

usage:
  npx uspec-skills component-md prepare --base <path/to/_base.json> [options]

options:
  --base <path>       Path to plugin-produced _base.json (required)
  --output <path>     Output .md path (default: ./components/{slug}.md)
  --cwd <dir>         Project root (default: auto-detect from cwd)
  --context <text>    Optional context when _meta.optionalContext is null
  --slug <slug>       Override component slug from _meta
  --json              Emit machine-readable manifest on stdout
  -h, --help          Show this help
`);
}

export async function runComponentMdPrepare(args: string[]): Promise<number> {
  const parsed = parsePrepareArgs(args);
  if ('error' in parsed) {
    console.error(`uspec-skills component-md prepare: ${parsed.error}`);
    return 2;
  }
  if (parsed.help) {
    printPrepareHelp();
    return 0;
  }
  if (!parsed.base) {
    console.error('uspec-skills component-md prepare: --base is required');
    printPrepareHelp();
    return 2;
  }

  try {
    const { manifest, summaryLine } = await runPrepare({
      basePath: parsed.base,
      cwd: parsed.cwd,
      output: parsed.output,
      optionalContext: parsed.context,
      slugOverride: parsed.slug,
    });

    if (parsed.json) {
      console.log(JSON.stringify(manifestForStdout(manifest, summaryLine), null, 2));
    } else {
      console.log(summaryLine);
      console.log(`manifest: ${manifest.paths.cachePath}/${manifest._meta.componentSlug}-prepare-manifest.json`);
    }
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return 1;
  }
}

export async function runComponentMd(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (!sub || sub === '--help' || sub === '-h') {
    console.log(`uspec-skills component-md - component markdown preparation

usage:
  npx uspec-skills component-md prepare --base <path> [options]

Run \`npx uspec-skills component-md prepare --help\` for prepare options.
`);
    return sub ? 0 : 1;
  }
  if (sub === 'prepare') {
    return runComponentMdPrepare(rest);
  }
  console.error(`unknown component-md subcommand: ${sub}`);
  return 2;
}
