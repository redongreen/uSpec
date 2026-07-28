import type { BaseJson, EvidenceEnvelope, TreeNode } from './types.js';
import { findDefaultVariant } from './stage.js';
import { walkTextNodes } from './evidence-api.js';

function variantAxesMap(base: BaseJson): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const axis of base.variantAxes) {
    out[axis.name] = [...axis.options];
  }
  return out;
}

function booleanDefsMap(base: BaseJson): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const b of base.propertyDefinitions.booleans) {
    out[b.rawKey] = b.defaultValue;
  }
  return out;
}

function discoverSubComponents(base: BaseJson, defaultVariant: BaseJson['variants'][0]) {
  const compositionByName = new Map(
    base._childComposition.children.map((c) => [c.name, c]),
  );
  return (defaultVariant.treeHierarchical.children ?? [])
    .filter((c) => c.type === 'INSTANCE' && c.subCompSetId)
    .map((node) => {
      const comp = compositionByName.get(node.name);
      return {
        name: node.name,
        mainComponentName: node.mainComponentName ?? node.name,
        parentSetName: node.parentSetName ?? null,
        subCompSetId: node.subCompSetId ?? null,
        classification: comp?.classification ?? null,
        booleanOverrides: {},
        dimensions: node.dimensions ?? {},
      };
    });
}

function rootDimensionsBySize(base: BaseJson): Record<string, Record<string, unknown>> {
  const cross = base.crossVariant as {
    sizeAxis?: string | null;
  } | null;
  const sizeAxis = cross?.sizeAxis ?? 'size';
  const out: Record<string, Record<string, unknown>> = {};
  for (const variant of base.variants) {
    const sizeValue = variant.variantProperties[sizeAxis];
    if (sizeValue) {
      out[sizeValue] = variant.dimensions;
    }
  }
  return out;
}

function flattenLayoutTree(
  layoutTree: Record<string, unknown>,
  path: string[] = [],
): Array<{ nodeId: string | null; name: string; type: string; path: string[] }> {
  const out: Array<{ nodeId: string | null; name: string; type: string; path: string[] }> = [];
  const node = layoutTree as {
    id?: string;
    name?: string;
    type?: string;
    children?: Record<string, unknown>[] | Record<string, unknown>;
  };
  const name = node.name ?? 'root';
  const currentPath = [...path, name];
  out.push({
    nodeId: node.id ?? null,
    name,
    type: node.type ?? 'unknown',
    path: currentPath,
  });
  const children = node.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      if (child && typeof child === 'object') {
        out.push(...flattenLayoutTree(child as Record<string, unknown>, currentPath));
      }
    }
  } else if (children && typeof children === 'object') {
    for (const child of Object.values(children)) {
      if (child && typeof child === 'object') {
        out.push(...flattenLayoutTree(child as Record<string, unknown>, currentPath));
      }
    }
  }
  return out;
}

function variableModeCollections(base: BaseJson) {
  const pattern = /density|shape|size|spacing|radius|tone/i;
  return base.variables.localCollections.filter(
    (c) => c.modes.length > 1 && pattern.test(c.name),
  );
}

function axisStructuralHints(base: BaseJson): Record<string, boolean> {
  const axisDiffs = (base.crossVariant as { axisDiffs?: Record<string, Record<string, { children?: unknown }>> } | null)
    ?.axisDiffs;
  const hints: Record<string, boolean> = {};
  if (!axisDiffs) return hints;
  for (const [axis, values] of Object.entries(axisDiffs)) {
    const childNames = new Set<string>();
    let structural = false;
    for (const entry of Object.values(values)) {
      const children = entry.children as Record<string, unknown> | undefined;
      if (!children) continue;
      const names = Object.keys(children).sort().join('|');
      if (childNames.size > 0 && !childNames.has(names)) {
        structural = true;
        break;
      }
      childNames.add(names);
    }
    hints[axis] = structural;
  }
  return hints;
}

export function buildStructureEvidence(
  base: BaseJson,
  baseSourceHash: string,
  preparedAt: string,
): EvidenceEnvelope<Record<string, unknown>> {
  const defaultVariant = findDefaultVariant(base);
  const cross = (base.crossVariant ?? {}) as Record<string, unknown>;

  return {
    _meta: {
      schemaVersion: '1',
      preparedAt,
      componentSlug: base._meta.componentSlug,
      domain: 'structure',
      baseSourceHash,
      defaultVariantId: defaultVariant.id,
      defaultVariantName: defaultVariant.name,
    },
    data: {
      componentName: base.component.componentName,
      variantAxes: variantAxesMap(base),
      propertyDefs: base.propertyDefinitions.rawDefs,
      booleanDefs: booleanDefsMap(base),
      defaultVariantDimensions: defaultVariant.dimensions,
      rootDimensions: rootDimensionsBySize(base),
      subComponents: discoverSubComponents(base, defaultVariant),
      slotContents: base.propertyDefinitions.slots,
      slotHostGeometry: base.slotHostGeometry ?? null,
      subComponentVariantWalks: base.subComponentVariantWalks ?? null,
      enrichedTree: defaultVariant.revealedTree ?? null,
      axisDiffs: cross.axisDiffs ?? null,
      stateComparison: cross.stateComparison ?? null,
      sizeAxis: (cross.sizeAxis as string | null) ?? null,
      stateAxis: (cross.stateAxis as string | null) ?? null,
      dimensionAxes: (cross.dimensionAxes as string[]) ?? [],
      variableModeCollections: variableModeCollections(base),
      typographyCandidates: walkTextNodes(defaultVariant.treeHierarchical),
      layoutTreeIndex: flattenLayoutTree(defaultVariant.layoutTree),
      axisStructuralHints: axisStructuralHints(base),
    },
  };
}

export function countDistinctFrames(tree: TreeNode, seen = new Set<string>()): number {
  if (tree.type === 'FRAME' && tree.id) {
    seen.add(tree.id);
  }
  for (const child of tree.children ?? []) {
    countDistinctFrames(child, seen);
  }
  return seen.size;
}
