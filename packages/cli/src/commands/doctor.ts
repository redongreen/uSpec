import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { findProjectRoot } from '../paths.js';
import { readConfig, CONFIG_FILENAME } from '../config.js';
import { skillsDirForPlatform } from '../render.js';
import { getCliVersion } from '../version.js';

interface DoctorArgs {
  cwd?: string;
  help?: boolean;
}

function parseArgs(args: string[]): DoctorArgs | { error: string } {
  const out: DoctorArgs = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--cwd') {
      const v = args[++i];
      if (!v) return { error: '--cwd requires a value' };
      out.cwd = v;
    } else {
      return { error: `unknown argument: ${a}` };
    }
  }
  return out;
}

export async function runDoctor(args: string[]): Promise<number> {
  const parsed = parseArgs(args);
  if ('error' in parsed) {
    console.error(`uspec-skills doctor: ${parsed.error}`);
    return 1;
  }
  if (parsed.help) {
    console.log(`uspec-skills doctor - verify your install

usage:
  npx uspec-skills doctor [--cwd <dir>]

Checks that uspecs.config.json exists, the configured platform's skills
directory is populated, references resolve, and reports CLI version drift.
Read-only \u2014 reports issues but does not fix them.
`);
    return 0;
  }

  const cwd = resolve(parsed.cwd ?? process.cwd());
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    console.error('FAIL  could not find a project root.');
    return 1;
  }

  let issues = 0;
  const ok = (msg: string) => console.log(`OK    ${msg}`);
  const fail = (msg: string) => {
    console.log(`FAIL  ${msg}`);
    issues++;
  };
  const warn = (msg: string) => console.log(`WARN  ${msg}`);

  console.log(`checking uspec-skills install at ${projectRoot}`);
  console.log('');

  const configPath = join(projectRoot, CONFIG_FILENAME);
  if (!existsSync(configPath)) {
    fail(`${CONFIG_FILENAME} not found. Run \`npx uspec-skills init\`.`);
    return 1;
  }
  ok(`${CONFIG_FILENAME} exists`);

  const config = await readConfig(projectRoot);
  if (!config) {
    fail(`${CONFIG_FILENAME} is unreadable`);
    return 1;
  }

  if (!config.environment) {
    fail('uspecs.config.json has no `environment` field');
    return 1;
  }
  ok(`environment = ${config.environment}`);

  const skillsDir = join(projectRoot, skillsDirForPlatform(config.environment));
  if (!existsSync(skillsDir)) {
    fail(`skills directory missing: ${skillsDir}`);
    return 1;
  }
  const skillEntries = (await readdir(skillsDir, { withFileTypes: true })).filter((e) =>
    e.isDirectory(),
  );
  if (skillEntries.length === 0) {
    fail(`skills directory is empty: ${skillsDir}`);
  } else {
    ok(`${skillEntries.length} skills installed in ${skillsDir}`);
  }

  const referencesDir = join(projectRoot, 'references');
  if (!existsSync(referencesDir)) {
    fail('references/ directory missing. References will not resolve.');
  } else {
    const refEntries = (await readdir(referencesDir, { withFileTypes: true })).filter((e) =>
      e.isDirectory(),
    );
    ok(`references/ has ${refEntries.length} subdirectories`);
  }

  let brokenLinkCount = 0;
  for (const entry of skillEntries) {
    const skillMd = join(skillsDir, entry.name, 'SKILL.md');
    if (!existsSync(skillMd)) {
      fail(`SKILL.md missing in ${entry.name}`);
      continue;
    }
    const content = await readFile(skillMd, 'utf8');
    const linkPattern = /\]\(([^)]+\.md)\)/g;
    let match: RegExpExecArray | null;
    while ((match = linkPattern.exec(content)) !== null) {
      const linkPath = match[1];
      if (linkPath.startsWith('http://') || linkPath.startsWith('https://')) continue;
      if (linkPath.startsWith('#')) continue;
      // Skip figma-plugin/ links: those are documentation pointers to the uSpec
      // source repo's plugin docs, intentionally absent from user projects.
      if (linkPath.includes('figma-plugin/')) continue;
      const resolved = resolve(skillsDir, entry.name, linkPath);
      if (!existsSync(resolved)) {
        brokenLinkCount++;
        warn(`broken link in ${entry.name}/SKILL.md -> ${linkPath}`);
      }
    }
  }
  if (brokenLinkCount === 0) {
    ok('all relative links in SKILL.md files resolve');
  }

  if (config.cliVersion) {
    const cliVersion = await getCliVersion();
    if (config.cliVersion !== cliVersion) {
      warn(
        `installed with uspec-skills ${config.cliVersion}, current CLI is ${cliVersion}. Run \`npx uspec-skills update\`.`,
      );
    } else {
      ok(`cliVersion ${cliVersion} matches`);
    }
  }

  console.log('');
  if (issues > 0) {
    console.log(`${issues} issue(s) found.`);
    return 1;
  }
  console.log('all checks passed.');
  return 0;
}
