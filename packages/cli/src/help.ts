import { getCliVersion } from './version.js';

export function printHelp(): void {
  console.log(`uspec-skills - install uSpec design-system documentation skills

usage:
  npx uspec-skills <command> [options]

commands:
  init                    Interactive setup. Detects your agent platform,
                          installs all skills and references, writes
                          uspecs.config.json. Run this first.

  install [--platform p]  Non-interactive install. Reads uspecs.config.json
                          if present, otherwise requires --platform
                          (cursor | claude-code | codex). Idempotent.

  update                  Re-render skills from the installed CLI version.
                          Run after upgrading the uspec-skills package.

  doctor                  Verify your install: config exists, skills are
                          present, references resolve. Reports issues only.

  render --target <p> --out <dir>
                          [internal] Render skills/ + references/ for one
                          platform into <dir>. Used by repo development;
                          end users do not need this.

options:
  -h, --help              Show this help.
  -v, --version           Show version.

learn more:
  https://uspec.design/
`);
}

export async function printVersion(): Promise<void> {
  console.log(await getCliVersion());
}
