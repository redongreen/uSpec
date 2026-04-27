import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

let cached: string | null = null;

export async function getCliVersion(): Promise<string> {
  if (cached) return cached;
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkgPath = resolve(__dirname, '..', 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { version: string };
  cached = pkg.version;
  return cached;
}
