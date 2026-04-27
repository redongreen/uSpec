import { resolve, relative } from 'node:path';
import { existsSync } from 'node:fs';
import { select, confirm } from '@inquirer/prompts';
import { renderBundle, isPlatform, type Platform } from '../render.js';
import { findProjectRoot, resolveSourceDirs } from '../paths.js';
import { upsertConfig, readConfig, type McpProvider } from '../config.js';
import { getCliVersion } from '../version.js';

interface InitArgs {
  platform?: Platform;
  mcp?: McpProvider;
  yes?: boolean;
  cwd?: string;
  help?: boolean;
}

function parseArgs(args: string[]): InitArgs | { error: string } {
  const out: InitArgs = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--yes' || a === '-y') out.yes = true;
    else if (a === '--platform') {
      const v = args[++i];
      if (!v || !isPlatform(v)) return { error: '--platform must be cursor | claude-code | codex' };
      out.platform = v;
    } else if (a === '--mcp') {
      const v = args[++i];
      if (v !== 'figma-console' && v !== 'figma-mcp') {
        return { error: '--mcp must be figma-console | figma-mcp' };
      }
      out.mcp = v;
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

export async function runInit(args: string[]): Promise<number> {
  const parsed = parseArgs(args);
  if ('error' in parsed) {
    console.error(`uspec-skills init: ${parsed.error}`);
    return 1;
  }
  if (parsed.help) {
    console.log(`uspec-skills init - interactive setup

usage:
  npx uspec-skills init [--platform <p>] [--mcp <m>] [--yes] [--cwd <dir>]

options:
  --platform     skip platform prompt: cursor | claude-code | codex
  --mcp          skip MCP prompt: figma-console | figma-mcp
  --yes, -y      skip confirmation prompts
  --cwd <dir>    project directory to install into (default: current dir)
  -h, --help     show this help
`);
    return 0;
  }

  const cwd = resolve(parsed.cwd ?? process.cwd());
  const foundRoot = findProjectRoot(cwd);
  const projectRoot = foundRoot ?? cwd;
  const bootstrapping = !foundRoot;

  if (bootstrapping) {
    console.log(`uspec-skills init: no project root found above ${cwd}.`);
    console.log(`  bootstrapping a new uSpec project here.`);
    console.log('');
  }

  console.log(`uspec-skills init -> ${projectRoot}`);
  console.log('');

  const existing = await readConfig(projectRoot);
  if (existing && !parsed.yes) {
    const overwrite = await confirm({
      message: `An existing uspecs.config.json was found. Continue and update it? Existing fields will be preserved unless you change them.`,
      default: true,
    });
    if (!overwrite) {
      console.log('aborted.');
      return 0;
    }
  }

  const platform =
    parsed.platform ??
    (await select<Platform>({
      message: 'Which agent are you using?',
      choices: [
        { name: 'Cursor', value: 'cursor' },
        { name: 'Claude Code CLI', value: 'claude-code' },
        { name: 'Codex CLI', value: 'codex' },
      ],
      default: existing?.environment,
    }));

  const mcp =
    parsed.mcp ??
    (await select<McpProvider>({
      message: 'Which Figma MCP do you use?',
      choices: [
        {
          name: 'Native Figma MCP (official, supports write)',
          value: 'figma-mcp',
        },
        {
          name: 'Figma Console MCP (Southleft, requires Desktop Bridge plugin)',
          value: 'figma-console',
        },
      ],
      default: existing?.mcpProvider,
    }));

  console.log('');
  console.log('installing skills and references...');

  const { skillsSrc, referencesSrc } = resolveSourceDirs();
  const result = await renderBundle({
    skillsSrc,
    referencesSrc,
    projectRoot,
    platform,
  });

  const cliVersion = await getCliVersion();
  await upsertConfig(projectRoot, {
    mcpProvider: mcp,
    environment: platform,
    cliVersion,
  });

  const skillsRel = relative(projectRoot, result.outDir);
  const refsRel = relative(projectRoot, result.refsDir);

  console.log('');
  console.log('Setup complete.');
  console.log('');
  console.log(`  ${result.skillsWritten} skills installed at ./${skillsRel}`);
  console.log(`  ${result.referencesCopied} reference dirs at ./${refsRel}`);
  console.log(`  config written to ./uspecs.config.json`);
  console.log('');
  console.log('Next: ask your agent to run the firstrun skill to extract your');
  console.log('Figma template keys. For example:');
  console.log('');
  if (platform === 'cursor') {
    console.log('  > @firstrun');
  } else {
    console.log('  > Run the firstrun skill');
  }
  console.log('');
  console.log('Docs: https://uspec.design/');

  if (existing && !existsSync(resolve(projectRoot, 'uspecs.config.json'))) {
    // unreachable safeguard; upsertConfig writes the file
  }

  return 0;
}
