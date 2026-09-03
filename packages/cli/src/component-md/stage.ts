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

function ensureVariantCompositionCoverage(base: BaseJson): boolean {
  const children = base._childComposition.children ?? [];
  const ambiguous = (base._childComposition.ambiguousChildren ?? []) as Array<
    Record<string, any>
  >;
  const allEntries = [...children, ...ambiguous] as Array<Record<string, any>>;
  const byIdentity = new Map<string, Record<string, any>>();
  const identityFor = (entry: Record<string, any>): string =>
    String(
      entry.subCompSetId ??
        entry.parentSetName ??
        entry.mainComponentName ??
        entry.name ??
        '',
    );
  for (const entry of allEntries) {
    if (
      entry.nodeType === 'INSTANCE' &&
      (entry.origin === 'top-level' || entry.origin == null)
    ) {
      byIdentity.set(identityFor(entry), entry);
    }
  }

  let changed = false;
  const fingerprints = new Map<Record<string, any>, Set<string>>();
  const effectiveChildren = (root: Record<string, any>): Record<string, any>[] => {
    let current = root;
    while (Array.isArray(current.children) && current.children.length === 1) {
      const only = current.children[0] as Record<string, any>;
      const layoutMode =
        only?.dimensions?.layoutMode?.value ??
        only?.dimensions?.layoutMode?.display ??
        only?.layoutMode;
      if (only?.type !== 'FRAME' || !layoutMode || layoutMode === 'NONE') break;
      current = only;
    }
    return Array.isArray(current.children) ? current.children : [];
  };

  for (const variant of base.variants) {
    const topLevel = effectiveChildren(variant.treeHierarchical);
    for (const [placementIndex, node] of topLevel.entries()) {
      if (node.type !== 'INSTANCE') continue;
      const identity = identityFor(node);
      let entry = byIdentity.get(identity);
      if (!entry) {
        entry = {
          name: node.name,
          nodeType: 'INSTANCE',
          mainComponentName: node.mainComponentName ?? null,
          parentSetName: node.parentSetName ?? null,
          subCompSetId: node.subCompSetId ?? null,
          topLevelInstanceId: `component:${identity}`,
          booleanOverrides: node.booleanOverrides ?? {},
          componentProperties: node.componentProperties ?? null,
          subCompVariantAxes: node.subCompVariantAxes ?? {},
          classification: null,
          classificationReason:
            'Synthesized from a variant-only placement in a legacy extraction; requires composition review.',
          classificationEvidence: ['legacy-variant-union'],
          origin: 'top-level',
          slotName: null,
          placementCount: 0,
          placementIndices: [],
          placementsVary: false,
          presentInVariants: [],
          defaultVariantPresent: false,
          placementsByVariant: {},
        };
        ambiguous.push(entry);
        byIdentity.set(identity, entry);
        changed = true;
      }

      if (!entry.placementsByVariant || typeof entry.placementsByVariant !== 'object') {
        entry.placementsByVariant = {};
        entry.placementCount = 0;
        entry.placementIndices = [];
        changed = true;
      }
      if (!Array.isArray(entry.presentInVariants)) {
        entry.presentInVariants = [];
        changed = true;
      }
      if (typeof entry.defaultVariantPresent !== 'boolean') {
        entry.defaultVariantPresent = false;
        changed = true;
      }
      if (typeof entry.placementCount !== 'number') {
        entry.placementCount = 0;
        changed = true;
      }
      if (!Array.isArray(entry.placementIndices)) {
        entry.placementIndices = [];
        changed = true;
      }
      const placement = entry.placementsByVariant[variant.name] ?? {
        variantId: variant.id,
        nodeIds: [],
        placementIndices: [],
      };
      if (node.id && !placement.nodeIds.includes(node.id)) {
        placement.nodeIds.push(node.id);
        placement.placementIndices.push(placementIndex);
        entry.placementCount += 1;
        changed = true;
      }
      entry.placementsByVariant[variant.name] = placement;
      if (!entry.presentInVariants.includes(variant.name)) {
        entry.presentInVariants.push(variant.name);
        changed = true;
      }
      if (variant.id === base.defaultVariant.id) {
        entry.defaultVariantPresent = true;
        entry.placementIndices = placement.placementIndices;
      }
      const fingerprint = JSON.stringify([
        node.mainComponentName ?? null,
        node.booleanOverrides ?? {},
        node.componentProperties ?? {},
      ]);
      const seen = fingerprints.get(entry) ?? new Set<string>();
      seen.add(fingerprint);
      fingerprints.set(entry, seen);
      entry.placementsVary = seen.size > 1;
    }
  }
  base._childComposition.ambiguousChildren = ambiguous;
  return changed;
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
  if (ensureVariantCompositionCoverage(base)) stamped = true;

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
  if ((base._childComposition.ambiguousChildren?.length ?? 0) > 0) return false;
  const instances = base._childComposition.children.filter((c) => c.nodeType === 'INSTANCE');
  if (instances.length === 0) return true;
  return instances.every((c) =>
    (c.classificationEvidence ?? []).includes('user-selected'),
  );
}
