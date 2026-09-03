import type { BaseJson, EvidenceEnvelope, TreeNode } from './types.js';
import { findDefaultVariant } from './stage.js';
import { walkTextNodes } from './evidence-api.js';
import { buildStructureObligations } from './obligations.js';

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

function discoverSubComponents(base: BaseJson) {
  const nodeById = new Map<string, TreeNode>();
  const indexTree = (node: TreeNode): void => {
    if (node.id) nodeById.set(node.id, node);
    for (const child of node.children ?? []) indexTree(child);
  };
  for (const variant of base.variants) indexTree(variant.treeHierarchical);

  return base._childComposition.children
    .filter((child) => child.nodeType === 'INSTANCE' && child.classification !== 'decorative')
    .map((child) => ({
      name: child.name,
      mainComponentName: child.mainComponentName ?? child.name,
      parentSetName: child.parentSetName ?? null,
      subCompSetId: child.subCompSetId ?? null,
      classification: child.classification ?? null,
      booleanOverrides: child.booleanOverrides ?? {},
      componentProperties: child.componentProperties ?? null,
      presentInVariants: child.presentInVariants ?? [],
      defaultVariantPresent: child.defaultVariantPresent ?? false,
      dimensionsByVariant: Object.fromEntries(
        Object.entries(child.placementsByVariant ?? {}).flatMap(([variantName, placement]) => {
          const node = placement.nodeIds.map((nodeId) => nodeById.get(nodeId)).find(Boolean);
          return node ? [[variantName, node.dimensions ?? {}]] : [];
        }),
      ),
    }));
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
      if (!entry || typeof entry !== 'object') continue;
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
  const defaultVariantIndex = base.variants.findIndex((variant) => variant.id === defaultVariant.id);
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
      rootDimensionsByVariant: base.variants.map((variant) => ({
        variantId: variant.id,
        variantName: variant.name,
        variantProperties: variant.variantProperties,
        dimensions: variant.dimensions,
        strokeSemantics: variant.strokeSemantics ?? null,
      })),
      subComponents: discoverSubComponents(base),
      slotContents: base.propertyDefinitions.slots,
      slotHostGeometry: base.slotHostGeometry ?? null,
      subComponentVariantWalks: base.subComponentVariantWalks ?? null,
      enrichedTree: defaultVariant.revealedTree ?? null,
      enrichedTrees: base.variants
        .filter((variant) => variant.revealedTree)
        .map((variant) => ({
          variantId: variant.id,
          variantName: variant.name,
          variantProperties: variant.variantProperties,
          structuralRepresentative: variant.revealedTreeRepresentative ?? variant.name,
          tree: variant.revealedTree,
        })),
      structuralRepresentativeByVariant: Object.fromEntries(
        base.variants.map((variant) => [
          variant.name,
          variant.revealedTreeRepresentative ?? variant.name,
        ]),
      ),
      axisDiffs: cross.axisDiffs ?? null,
      stateComparison: cross.stateComparison ?? null,
      sizeAxis: (cross.sizeAxis as string | null) ?? null,
      stateAxis: (cross.stateAxis as string | null) ?? null,
      dimensionAxes: (cross.dimensionAxes as string[]) ?? [],
      variableModeCollections: variableModeCollections(base),
      typographyCandidates: base.variants.flatMap((variant) =>
        walkTextNodes(variant.treeHierarchical).map((candidate) => ({
          ...candidate,
          variantId: variant.id,
          variantName: variant.name,
          variantProperties: variant.variantProperties,
        })),
      ),
      layoutTreeIndex: base.variants.flatMap((variant) =>
        flattenLayoutTree(variant.layoutTree).map((entry) => ({
          ...entry,
          variantId: variant.id,
          variantName: variant.name,
          variantProperties: variant.variantProperties,
        })),
      ),
      variantTrees: base.variants.map((variant) => ({
        variantId: variant.id,
        variantName: variant.name,
        variantProperties: variant.variantProperties,
        treeHierarchical: variant.treeHierarchical,
      })),
      axisStructuralHints: axisStructuralHints(base),
      obligations: buildStructureObligations(base, defaultVariantIndex),
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
