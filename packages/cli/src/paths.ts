import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Resolves the source directories for skills/ and references/. These can live
 * in two places:
 *
 *   1. Production (installed via npm): bundled inside the package at
 *      `<package>/templates/skills` and `<package>/templates/references`.
 *      The build script copies them there.
 *
 *   2. Development (running from the repo): at `<repo-root>/skills` and
 *      `<repo-root>/references`. We detect this by walking up from this
 *      module's location until we find a `skills/` directory at the same
 *      level as `packages/`.
 *
 * Production wins if templates/ exists in the package, since that's the
 * stable distribution.
 */
export function resolveSourceDirs(): { skillsSrc: string; referencesSrc: string } {
  const __dirname = dirname(fileURLToPath(import.meta.url));

  const pkgRoot = resolve(__dirname, '..');
  const templatesSkills = resolve(pkgRoot, 'templates', 'skills');
  const templatesReferences = resolve(pkgRoot, 'templates', 'references');
  if (existsSync(templatesSkills) && existsSync(templatesReferences)) {
    return { skillsSrc: templatesSkills, referencesSrc: templatesReferences };
  }

  let cursor = pkgRoot;
  for (let i = 0; i < 6; i++) {
    const candidateSkills = resolve(cursor, 'skills');
    const candidateRefs = resolve(cursor, 'references');
    if (existsSync(candidateSkills) && existsSync(candidateRefs)) {
      return { skillsSrc: candidateSkills, referencesSrc: candidateRefs };
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }

  throw new Error(
    'Could not locate uSpec skills/ and references/ source directories. ' +
      'If you are running from a checkout, ensure you are inside the uSpec repo. ' +
      'If you installed via npm, this is a packaging bug \u2014 please file an issue.',
  );
}

/**
 * Walks up from `start` looking for a project root marker. Returns null if
 * no marker found within a reasonable number of levels.
 */
export function findProjectRoot(start: string): string | null {
  let cursor = resolve(start);
  for (let i = 0; i < 10; i++) {
    if (
      existsSync(resolve(cursor, '.git')) ||
      existsSync(resolve(cursor, 'package.json')) ||
      existsSync(resolve(cursor, 'uspecs.config.json'))
    ) {
      return cursor;
    }
    const parent = dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
  return null;
}
