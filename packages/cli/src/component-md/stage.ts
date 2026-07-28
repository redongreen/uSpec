import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { BaseJson } from './types.js';

export interface StageResult {
  stagedBasePath: string;
  baseBytes: number;
  variantCount: number;
  warningCount: number;
  skippedCopy: boolean;
}

export async function stageBaseJson(opts: {
  sourcePath: string;
  stagedBasePath: string;
  optionalContext?: string;
}): Promise<{ base: BaseJson; result: StageResult }> {
  const absSource = resolve(opts.sourcePath);
  const absStaged = resolve(opts.stagedBasePath);
  await mkdir(dirname(absStaged), { recursive: true });

  const raw = await readFile(absSource, 'utf8');
  const base = JSON.parse(raw) as BaseJson;
  let stamped = false;

  if (
    opts.optionalContext &&
    (base._meta.optionalContext === null || base._meta.optionalContext === undefined)
  ) {
    base._meta.optionalContext = opts.optionalContext;
    stamped = true;
  }

  const skippedCopy = absSource === absStaged && !stamped;
  if (!skippedCopy) {
    await writeFile(absStaged, JSON.stringify(base, null, 2) + '\n', 'utf8');
  }

  const stagedRaw = skippedCopy ? raw : await readFile(absStaged, 'utf8');

  return {
    base,
    result: {
      stagedBasePath: absStaged,
      baseBytes: Buffer.byteLength(stagedRaw, 'utf8'),
      variantCount: base.variants.length,
      warningCount: base._extractionNotes.warnings?.length ?? 0,
      skippedCopy,
    },
  };
}

export function verifyRequiredBaseKeys(base: BaseJson): void {
  const required = [
    '_meta',
    'component',
    'variantAxes',
    'propertyDefinitions',
    'variants',
    'ownershipHints',
    '_childComposition',
  ] as const;
  for (const key of required) {
    if ((base as unknown as Record<string, unknown>)[key] == null) {
      throw new Error(`_base.json missing required top-level key: ${key}`);
    }
  }
}

export function checkRenderMetaFreshness(base: BaseJson): boolean {
  const defaultVariant = findDefaultVariant(base);
  const layoutTree = defaultVariant?.layoutTree;
  if (!layoutTree || typeof layoutTree !== 'object') return false;
  const tree = layoutTree as { id?: string };
  return Boolean(tree.id);
}

export function revealedTreeHasChildren(base: BaseJson): boolean {
  const defaultVariant = findDefaultVariant(base);
  const revealed = defaultVariant?.revealedTree;
  if (!revealed || typeof revealed !== 'object') return false;
  const children = (revealed as { children?: unknown[] }).children;
  return Array.isArray(children) && children.length > 0;
}

export function findDefaultVariant(base: BaseJson) {
  const byId = base.variants.find((v) => v.id === base.defaultVariant.id);
  if (byId) return byId;
  const byName = base.variants.find((v) => v.name === base.defaultVariant.name);
  return byName ?? base.variants[0];
}

export function compositionCounts(base: BaseJson) {
  const children = base._childComposition.children ?? [];
  const ambiguous = base._childComposition.ambiguousChildren?.length ?? 0;
  return {
    constitutive: children.filter((c) => c.classification === 'constitutive').length,
    referenced: children.filter((c) => c.classification === 'referenced').length,
    decorative: children.filter((c) => c.classification === 'decorative').length,
    ambiguous,
  };
}

export function childCompositionUserSelected(base: BaseJson): boolean {
  const instances = base._childComposition.children.filter((c) => c.nodeType === 'INSTANCE');
  if (instances.length === 0) return true;
  return instances.every((c) =>
    (c.classificationEvidence ?? []).includes('user-selected'),
  );
}
