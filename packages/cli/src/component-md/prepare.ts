import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { findProjectRoot } from '../paths.js';
import { computeSourceHash } from './hash.js';
import { resolvePreparePaths } from './paths.js';
import {
  stageBaseJson,
  verifyRequiredBaseKeys,
  checkRenderMetaFreshness,
  revealedTreeHasChildren,
  compositionCounts,
  childCompositionUserSelected,
} from './stage.js';
import { validateBaseFile } from './validate.js';
import { buildApiEvidence } from './evidence-api.js';
import { buildStructureEvidence } from './evidence-structure.js';
import { buildColorEvidence } from './evidence-color.js';
import { buildVoiceEvidence } from './evidence-voice.js';
import type { BaseJson, PrepareManifest } from './types.js';

export interface PrepareOptions {
  basePath: string;
  cwd?: string;
  output?: string;
  optionalContext?: string;
  slugOverride?: string;
}

export interface PrepareOutput {
  manifest: PrepareManifest;
  summaryLine: string;
}

function variantAxesSummary(base: BaseJson): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const axis of base.variantAxes) {
    out[axis.name] = [...axis.options];
  }
  return out;
}

export async function runPrepare(opts: PrepareOptions): Promise<PrepareOutput> {
  const projectRoot =
    findProjectRoot(opts.cwd ?? process.cwd()) ?? (opts.cwd ? opts.cwd : process.cwd());

  const validation = await validateBaseFile(opts.basePath);
  if (!validation.ok) {
    const lines = validation.errors.map(
      (e) => `${e.instancePath || '(root)'} — ${e.message}`,
    );
    throw new Error(`Validation failed for ${opts.basePath}:\n${lines.join('\n')}`);
  }

  const raw = await readFile(opts.basePath, 'utf8');
  const base = JSON.parse(raw) as BaseJson;
  verifyRequiredBaseKeys(base);

  const paths = resolvePreparePaths({
    projectRoot,
    base,
    output: opts.output,
    slugOverride: opts.slugOverride,
  });

  await mkdir(dirname(paths.outputPath), { recursive: true });
  await mkdir(paths.cachePath, { recursive: true });

  const { base: stagedBase, result: stageResult } = await stageBaseJson({
    sourcePath: opts.basePath,
    stagedBasePath: paths.stagedBasePath,
    optionalContext: opts.optionalContext,
  });

  const stagedRaw = await readFile(paths.stagedBasePath, 'utf8');
  const baseSourceHash = computeSourceHash(stagedRaw);
  const preparedAt = new Date().toISOString();
  const cross = (stagedBase.crossVariant ?? {}) as Record<string, unknown>;

  const manifest: PrepareManifest = {
    _meta: {
      schemaVersion: '1',
      preparedAt,
      componentSlug: paths.componentSlug,
      baseJsonPath: paths.stagedBasePath,
      baseBytes: stageResult.baseBytes,
      baseSourceHash,
      pluginVersion: stagedBase._meta.pluginVersion ?? null,
      variantsWalked: stageResult.variantCount,
      validation: { ok: true, errors: [] },
    },
    readiness: {
      layoutTreeHasNodeIds: checkRenderMetaFreshness(stagedBase),
      childCompositionUserSelected: childCompositionUserSelected(stagedBase),
      revealedTreeHasChildren: revealedTreeHasChildren(stagedBase),
      subComponentVariantWalksPresent: Boolean(stagedBase.subComponentVariantWalks),
      warnings: stagedBase._extractionNotes.warnings ?? [],
    },
    summaries: {
      componentName: stagedBase.component.componentName,
      defaultVariant: stagedBase.defaultVariant,
      variantAxes: variantAxesSummary(stagedBase),
      composition: compositionCounts(stagedBase),
      crossVariant: {
        sizeAxis: (cross.sizeAxis as string | null) ?? null,
        stateAxis: (cross.stateAxis as string | null) ?? null,
        dimensionAxes: (cross.dimensionAxes as string[]) ?? [],
      },
    },
    paths: {
      cachePath: paths.cachePath,
      stagedBasePath: paths.stagedBasePath,
      outputPath: paths.outputPath,
      evidence: paths.evidencePaths,
    },
  };

  const evidenceFiles = [
    buildApiEvidence(stagedBase, baseSourceHash, preparedAt),
    buildStructureEvidence(stagedBase, baseSourceHash, preparedAt),
    buildColorEvidence(stagedBase, baseSourceHash, preparedAt),
    buildVoiceEvidence(stagedBase, baseSourceHash, preparedAt),
  ];

  await writeFile(paths.manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  await writeFile(paths.evidencePaths.api, JSON.stringify(evidenceFiles[0], null, 2) + '\n', 'utf8');
  await writeFile(
    paths.evidencePaths.structure,
    JSON.stringify(evidenceFiles[1], null, 2) + '\n',
    'utf8',
  );
  await writeFile(
    paths.evidencePaths.color,
    JSON.stringify(evidenceFiles[2], null, 2) + '\n',
    'utf8',
  );
  await writeFile(
    paths.evidencePaths.voice,
    JSON.stringify(evidenceFiles[3], null, 2) + '\n',
    'utf8',
  );

  const summaryLine = `base: variants=${stageResult.variantCount}, bytes=${stageResult.baseBytes}, warnings=${stageResult.warningCount} → ${paths.stagedBasePath}`;

  return { manifest, summaryLine };
}

export function manifestForStdout(manifest: PrepareManifest, summaryLine: string) {
  return {
    ...manifest,
    summaryLine,
    componentSlug: manifest._meta.componentSlug,
    cachePath: manifest.paths.cachePath,
    stagedBasePath: manifest.paths.stagedBasePath,
    outputPath: manifest.paths.outputPath,
    baseSourceHash: manifest._meta.baseSourceHash,
  };
}
