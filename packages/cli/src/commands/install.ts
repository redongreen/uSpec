import { resolve, relative } from 'node:path';
import { renderBundle, isPlatform, type Platform } from '../render.js';
import { findProjectRoot, resolveSourceDirs } from '../paths.js';
import { readConfig, upsertConfig, type UspecConfig } from '../config.js';
import { getCliVersion } from '../version.js';

interface InstallArgs {
  platform?: Platform;
  cwd?: string;
  help?: boolean;
}

function parseArgs(args: string[]): InstallArgs | { error: string } {
  const out: InstallArgs = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--platform') {
      const v = args[++i];
      if (!v || !isPlatform(v)) return { error: '--platform must be cursor | claude-code | codex' };
      out.platform = v;
    } else if (a === '--cwd') {
      const v = args[++i];
      if (!v) return { error: '--cwd requires a value' };
      out.cwd = v;
    } else {
      return { error: `unknown argument: ${a}` };
    }
  }
  return out;
}

export async function runInstall(args: string[]): Promise<number> {
  const parsed = parseArgs(args);
  if ('error' in parsed) {
    console.error(`uspec-skills install: ${parsed.error}`);
    return 1;
  }
  if (parsed.help) {
    console.log(`uspec-skills install - non-interactive install

usage:
  npx uspec-skills install [--platform <p>] [--cwd <dir>]

If --platform is omitted, reads environment from uspecs.config.json.
Idempotent \u2014 safe to re-run to repair or update an installation.
`);
    return 0;
  }

  const cwd = resolve(parsed.cwd ?? process.cwd());
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    console.error('uspec-skills install: could not find a project root.');
    console.error(`  searched up from: ${cwd}`);
    console.error('  expected one of: .git/, package.json, uspecs.config.json');
    console.error('  Run `npx uspec-skills init` first to bootstrap a new project here.');
    return 1;
  }

  const existing = await readConfig(projectRoot);
  const platform = parsed.platform ?? existing?.environment;
  if (!platform) {
    console.error('uspec-skills install: no --platform given and no environment in uspecs.config.json.');
    console.error('  Run `npx uspec-skills init` for interactive setup, or pass --platform.');
    return 1;
  }

  const { skillsSrc, referencesSrc } = resolveSourceDirs();
  const result = await renderBundle({ skillsSrc, referencesSrc, projectRoot, platform });

  const cliVersion = await getCliVersion();
  // Preserve the primary `environment` already recorded (used by `firstrun`).
  // If none is recorded, this install becomes the primary. Otherwise an
  // explicit `--platform` flag adds a secondary host without disturbing it.
  const patch: Partial<UspecConfig> = { cliVersion };
  if (!existing?.environment) patch.environment = platform;
  await upsertConfig(projectRoot, patch);

  console.log(
    `installed ${result.skillsWritten} skills to ./${relative(projectRoot, result.outDir)}`,
  );
  console.log(
    `copied ${result.referencesCopied} reference dirs to ./${relative(projectRoot, result.refsDir)}`,
  );
  if (existing?.environment && existing.environment !== platform) {
    console.log(
      `note: primary environment in uspecs.config.json remains '${existing.environment}'.`,
    );
  }
  return 0;
}
