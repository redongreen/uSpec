import { resolve } from 'node:path';
import { renderBundle, isPlatform, PLATFORMS, type Platform } from '../render.js';
import { resolveSourceDirs } from '../paths.js';

interface ParsedArgs {
  target?: Platform;
  out?: string;
  help?: boolean;
}

function parseArgs(args: string[]): ParsedArgs | { error: string } {
  const result: ParsedArgs = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') {
      result.help = true;
    } else if (a === '--target') {
      const v = args[++i];
      if (!v) return { error: '--target requires a value' };
      if (!isPlatform(v)) {
        return { error: `--target must be one of: ${PLATFORMS.join(', ')}` };
      }
      result.target = v;
    } else if (a === '--out') {
      const v = args[++i];
      if (!v) return { error: '--out requires a value' };
      result.out = v;
    } else {
      return { error: `unknown argument: ${a}` };
    }
  }
  return result;
}

export async function runRender(args: string[]): Promise<number> {
  const parsed = parseArgs(args);
  if ('error' in parsed) {
    console.error(`uspec-skills render: ${parsed.error}`);
    return 1;
  }

  if (parsed.help) {
    console.log(`uspec-skills render - render skills+references for one platform

usage:
  uspec render --target <cursor|claude-code|codex> [--out <dir>]

options:
  --target <p>   target platform (required)
  --out <dir>    project root to render into (default: cwd)

This is an internal command used during repo development. End users should
run \`uspec-skills init\` or \`uspec-skills install\` instead.
`);
    return 0;
  }

  if (!parsed.target) {
    console.error('uspec render: --target is required (one of: ' + PLATFORMS.join(', ') + ')');
    return 1;
  }

  const projectRoot = resolve(parsed.out ?? process.cwd());

  const { skillsSrc, referencesSrc } = resolveSourceDirs();

  const result = await renderBundle({
    skillsSrc,
    referencesSrc,
    projectRoot,
    platform: parsed.target,
  });

  console.log(`rendered ${result.skillsWritten} skills to ${result.outDir}`);
  console.log(`copied ${result.referencesCopied} reference dirs to ${result.refsDir}`);
  return 0;
}
