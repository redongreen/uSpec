import { runInit } from './commands/init.js';
import { runInstall } from './commands/install.js';
import { runUpdate } from './commands/update.js';
import { runDoctor } from './commands/doctor.js';
import { runRender } from './commands/render.js';
import { printHelp, printVersion } from './help.js';

const COMMANDS = ['init', 'install', 'update', 'doctor', 'render'] as const;
type Command = (typeof COMMANDS)[number];

function isCommand(value: string): value is Command {
  return (COMMANDS as readonly string[]).includes(value);
}

async function main(argv: string[]): Promise<number> {
  const [first, ...rest] = argv;

  if (!first || first === '--help' || first === '-h' || first === 'help') {
    printHelp();
    return 0;
  }
  if (first === '--version' || first === '-v') {
    await printVersion();
    return 0;
  }

  if (!isCommand(first)) {
    console.error(`unknown command: ${first}`);
    printHelp();
    return 1;
  }

  switch (first) {
    case 'init':
      return runInit(rest);
    case 'install':
      return runInstall(rest);
    case 'update':
      return runUpdate(rest);
    case 'doctor':
      return runDoctor(rest);
    case 'render':
      return runRender(rest);
  }
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
