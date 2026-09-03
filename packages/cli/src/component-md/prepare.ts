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
import { buildRendererEvidence } from './evidence-renderer.js';
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

  const baseSourceHash = computeSourceHash(JSON.stringify(stagedBase));
  const preparedAt = new Date().toISOString();
  const cross = (stagedBase.crossVariant ?? {}) as Record<string, unknown>;
  const evidenceFiles = [
    buildApiEvidence(stagedBase, baseSourceHash, preparedAt),
    buildStructureEvidence(stagedBase, baseSourceHash, preparedAt),
    buildColorEvidence(stagedBase, baseSourceHash, preparedAt),
    buildVoiceEvidence(stagedBase, baseSourceHash, preparedAt),
    buildRendererEvidence(stagedBase, baseSourceHash, preparedAt),
  ];
  const rendererVariantTrees = (
    evidenceFiles[4].data as { variantTrees?: unknown[] }
  ).variantTrees;
  if (
    !Array.isArray(rendererVariantTrees) ||
    rendererVariantTrees.length !== stagedBase.variants.length
  ) {
    throw new Error(
      `Renderer evidence variant-tree coverage mismatch: expected ${stagedBase.variants.length}, received ${
        Array.isArray(rendererVariantTrees) ? rendererVariantTrees.length : 0
      }.`,
    );
  }
  const evidenceNames = ['api', 'structure', 'color', 'voice', 'renderer'] as const;
  const serializedEvidence = evidenceFiles.map((evidence) => JSON.stringify(evidence, null, 2) + '\n');
  const evidenceBytes = Object.fromEntries(
    evidenceNames.map((name, index) => [name, Buffer.byteLength(serializedEvidence[index])]),
  ) as Record<(typeof evidenceNames)[number], number>;
  const obligationCounts = Object.fromEntries(
    evidenceNames.slice(0, 4).map((name, index) => [
      name,
      ((evidenceFiles[index].data as { obligations?: unknown[] }).obligations ?? []).length,
    ]),
  ) as Record<'api' | 'structure' | 'color' | 'voice', number>;
  const obligationKindCounts = Object.fromEntries(
    evidenceNames.slice(0, 4).map((name, index) => {
      const obligations =
        (evidenceFiles[index].data as { obligations?: Array<{ kind?: string }> }).obligations ?? [];
      const counts: Record<string, number> = {};
      for (const entry of obligations) {
        const kind = entry.kind ?? 'unknown';
        counts[kind] = (counts[kind] ?? 0) + 1;
      }
      return [name, counts];
    }),
  ) as Record<'api' | 'structure' | 'color' | 'voice', Record<string, number>>;
  const totalEvidenceBytes = Object.values(evidenceBytes).reduce((sum, bytes) => sum + bytes, 0);

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
      variantTreesComplete: true,
      subComponentVariantWalksPresent: Boolean(stagedBase.subComponentVariantWalks),
      warnings: stagedBase._extractionNotes.warnings ?? [],
    },
    source: {
      fileKey: stagedBase._meta.fileKey,
      nodeId: stagedBase._meta.nodeId,
      figmaUrl:
        stagedBase._meta.figmaUrl ??
        `https://www.figma.com/design/${stagedBase._meta.fileKey}/?node-id=${stagedBase._meta.nodeId.replaceAll(':', '-')}`,
      extractionSource: stagedBase._meta.extractionSource ?? null,
    },
    metrics: {
      prepare: {
        baseBytes: stageResult.baseBytes,
        evidenceBytes,
        obligationCounts,
        obligationKindCounts,
        totalEvidenceBytes,
        estimatedInputTokens: Math.ceil(stageResult.baseBytes / 4),
      },
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
      contractPath: paths.contractPath,
      evidence: paths.evidencePaths,
    },
  };

  await writeFile(paths.manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  await writeFile(paths.evidencePaths.api, serializedEvidence[0], 'utf8');
  await writeFile(
    paths.evidencePaths.structure,
    serializedEvidence[1],
    'utf8',
  );
  await writeFile(
    paths.evidencePaths.color,
    serializedEvidence[2],
    'utf8',
  );
  await writeFile(
    paths.evidencePaths.voice,
    serializedEvidence[3],
    'utf8',
  );
  await writeFile(
    paths.evidencePaths.renderer,
    serializedEvidence[4],
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
