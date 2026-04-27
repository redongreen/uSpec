import { runInstall } from './install.js';

export async function runUpdate(args: string[]): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`uspec-skills update - re-render skills from the current CLI version

usage:
  npx uspec-skills update [--cwd <dir>]

Equivalent to \`uspec-skills install\` with the platform read from uspecs.config.json.
Run this after upgrading the uspec-skills package to refresh skills and references.
`);
    return 0;
  }
  return runInstall(args);
}
