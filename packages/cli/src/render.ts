import { readdir, readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, posix } from 'node:path';

export type Platform = 'cursor' | 'claude-code' | 'codex';

export const PLATFORMS: readonly Platform[] = ['cursor', 'claude-code', 'codex'] as const;

export function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value);
}

export function skillsDirForPlatform(platform: Platform): string {
  switch (platform) {
    case 'cursor':
      return '.cursor/skills';
    case 'claude-code':
      return '.claude/skills';
    case 'codex':
      return '.agents/skills';
  }
}

export interface RenderOptions {
  /** Directory containing the canonical platform-neutral `skills/` tree. */
  skillsSrc: string;
  /** Directory containing the canonical `references/` tree. */
  referencesSrc: string;
  /** Project root where output should be written. */
  projectRoot: string;
  /** Target platform. */
  platform: Platform;
}

export interface RenderResult {
  skillsWritten: number;
  referencesCopied: number;
  outDir: string;
  refsDir: string;
}

/**
 * Renders the bundle for one platform. Pure function over the filesystem:
 * - Walks every `skills/<name>/` directory.
 * - For each SKILL.md, resolves {{skill:}}, {{ref:}}, {{repo:}} tokens for the
 *   target platform and writes the result to the platform's skills directory.
 * - Copies non-SKILL.md files in each skill directory verbatim (helper scripts, etc.).
 * - Copies `references/` into the project root so {{ref:...}} links resolve.
 */
export async function renderBundle(opts: RenderOptions): Promise<RenderResult> {
  const { skillsSrc, referencesSrc, projectRoot, platform } = opts;

  const outDir = join(projectRoot, skillsDirForPlatform(platform));
  await mkdir(outDir, { recursive: true });

  let skillsWritten = 0;
  const skillNames: string[] = [];

  if (existsSync(skillsSrc)) {
    const entries = await readdir(skillsSrc, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      skillNames.push(entry.name);
    }
  }

  for (const skillName of skillNames) {
    const srcSkillDir = join(skillsSrc, skillName);
    const dstSkillDir = join(outDir, skillName);
    await mkdir(dstSkillDir, { recursive: true });

    const skillFiles = await readdir(srcSkillDir, { withFileTypes: true });
    for (const f of skillFiles) {
      const srcPath = join(srcSkillDir, f.name);
      const dstPath = join(dstSkillDir, f.name);
      if (f.isFile() && f.name === 'SKILL.md') {
        const raw = await readFile(srcPath, 'utf8');
        const rendered = renderSkill(raw, {
          platform,
          skillName,
          skillsRoot: outDir,
          projectRoot,
        });
        await writeFile(dstPath, rendered, 'utf8');
        skillsWritten++;
      } else if (f.isFile()) {
        await cp(srcPath, dstPath);
      } else if (f.isDirectory()) {
        await cp(srcPath, dstPath, { recursive: true });
      }
    }
  }

  let referencesCopied = 0;
  const refsDir = join(projectRoot, 'references');
  if (existsSync(referencesSrc)) {
    await cp(referencesSrc, refsDir, { recursive: true });
    const refDirs = await readdir(referencesSrc, { withFileTypes: true });
    referencesCopied = refDirs.filter((e) => e.isDirectory()).length;
  }

  return { skillsWritten, referencesCopied, outDir, refsDir };
}

interface RenderContext {
  platform: Platform;
  skillName: string;
  /** Absolute path to the platform's skills root, e.g. `<project>/.cursor/skills`. */
  skillsRoot: string;
  /** Absolute path to the user's project root. */
  projectRoot: string;
}

/**
 * Renders a single SKILL.md by substituting tokens. Pure function for testability.
 */
export function renderSkill(input: string, ctx: RenderContext): string {
  let out = input;

  out = out.replace(/\{\{skill:([a-z][a-z0-9-]*)\}\}/g, (_match, name: string) => {
    return renderSkillRef(name, ctx.platform);
  });

  out = out.replace(/\{\{ref:([^}]+)\}\}/g, (_match, refPath: string) => {
    return renderRefLink(refPath, ctx);
  });

  out = out.replace(/\{\{repo:([^}]+)\}\}/g, (_match, repoPath: string) => {
    return renderRepoLink(repoPath, ctx);
  });

  return out;
}

function renderSkillRef(name: string, platform: Platform): string {
  if (platform === 'cursor') {
    return `\`@${name}\``;
  }
  return `the \`${name}\` skill`;
}

function renderRefLink(refPath: string, ctx: RenderContext): string {
  const skillDir = posix.join(ctx.skillsRoot.replaceAll('\\', '/'), ctx.skillName);
  const projectRootPosix = ctx.projectRoot.replaceAll('\\', '/');
  const targetAbs = posix.join(projectRootPosix, 'references', refPath);
  return posix.relative(skillDir, targetAbs);
}

function renderRepoLink(repoPath: string, ctx: RenderContext): string {
  const skillDir = posix.join(ctx.skillsRoot.replaceAll('\\', '/'), ctx.skillName);
  const projectRootPosix = ctx.projectRoot.replaceAll('\\', '/');
  const targetAbs = posix.join(projectRootPosix, repoPath);
  return posix.relative(skillDir, targetAbs);
}
