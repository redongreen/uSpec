import { join, resolve } from 'node:path';
import type { BaseJson } from './types.js';

export interface PreparePaths {
  projectRoot: string;
  componentSlug: string;
  cachePath: string;
  stagedBasePath: string;
  outputPath: string;
  manifestPath: string;
  evidencePaths: {
    api: string;
    structure: string;
    color: string;
    voice: string;
  };
}

export function resolvePreparePaths(opts: {
  projectRoot: string;
  base: BaseJson;
  output?: string;
  slugOverride?: string;
}): PreparePaths {
  const componentSlug = opts.slugOverride ?? opts.base._meta.componentSlug;
  const cachePath = join(opts.projectRoot, '.uspec-cache', componentSlug);
  const stagedBasePath = join(cachePath, `${componentSlug}-_base.json`);
  const outputPath = opts.output
    ? resolve(opts.projectRoot, opts.output)
    : join(opts.projectRoot, 'components', `${componentSlug}.md`);

  return {
    projectRoot: opts.projectRoot,
    componentSlug,
    cachePath,
    stagedBasePath,
    outputPath,
    manifestPath: join(cachePath, `${componentSlug}-prepare-manifest.json`),
    evidencePaths: {
      api: join(cachePath, `${componentSlug}-evidence-api.json`),
      structure: join(cachePath, `${componentSlug}-evidence-structure.json`),
      color: join(cachePath, `${componentSlug}-evidence-color.json`),
      voice: join(cachePath, `${componentSlug}-evidence-voice.json`),
    },
  };
}
