import type { BaseJson, EvidenceEnvelope, TreeNode } from './types.js';
import { findDefaultVariant } from './stage.js';
import { buildApiObligations } from './obligations.js';

export function buildApiEvidence(
  base: BaseJson,
  baseSourceHash: string,
  preparedAt: string,
): EvidenceEnvelope<Record<string, unknown>> {
  const defaultVariant = findDefaultVariant(base);
  const defaultVariantIndex = base.variants.findIndex((variant) => variant.id === defaultVariant.id);
  const nodeById = new Map<string, TreeNode>();
  const indexTree = (node: TreeNode): void => {
    if (node.id) nodeById.set(node.id, node);
    for (const child of node.children ?? []) indexTree(child);
  };
  for (const variant of base.variants) indexTree(variant.treeHierarchical);

  const composableChildren = base._childComposition.children
    .filter((child) => child.nodeType === 'INSTANCE' && child.classification !== 'decorative')
    .map((child) => {
    const parentSetName = child.parentSetName ?? null;
    const mainComponentName = child.mainComponentName ?? child.name;
    const componentName =
      parentSetName && parentSetName.length > 0 ? parentSetName : mainComponentName;
    const dimensionsByVariant = Object.fromEntries(
      Object.entries(child.placementsByVariant ?? {}).flatMap(([variantName, placement]) => {
        const node = placement.nodeIds.map((nodeId) => nodeById.get(nodeId)).find(Boolean);
        return node ? [[variantName, node.dimensions ?? {}]] : [];
      }),
    );
    return {
      name: child.name,
      componentName,
      mainComponentName,
      parentSetName,
      subCompSetId: child.subCompSetId ?? null,
      classification: child.classification,
      origin: child.origin ?? 'top-level',
      slotName: child.slotName ?? null,
      presentInVariants: child.presentInVariants ?? [],
      defaultVariantPresent: child.defaultVariantPresent ?? false,
      dimensionsByVariant,
      booleanOverrides: child.booleanOverrides ?? {},
      componentProperties: child.componentProperties ?? null,
    };
  });

  const booleanProps = base.propertyDefinitions.booleans.map((b) => ({
    name: b.name,
    defaultValue: b.defaultValue,
    associatedLayer: b.associatedLayerName ?? null,
    rawKey: b.rawKey,
    associatedLayerId: b.associatedLayerId ?? null,
  }));

  const relevantVariableCollections = base.ownershipHints
    .filter((h) => h.evidenceType === 'variableMode')
    .map((h) => ({
      name: String(h.propertyName ?? h.name ?? ''),
      modes: Array.isArray(h.modeNames) ? h.modeNames : [],
    }));

  const textNodeMap = base.ownershipHints
    .filter((h) => h.evidenceType === 'textNode')
    .map((h) => ({
      name: String(h.propertyName ?? h.name ?? ''),
      characters: String(h.textContent ?? ''),
      parentName: String(h.sourceLayerName ?? ''),
    }));

  const referencedChildren = base._childComposition.children
    .filter((c) => c.classification === 'referenced')
    .map((c) => ({
      name: c.name,
      parentSetName: c.parentSetName ?? null,
      mainComponentName: c.mainComponentName ?? null,
      subCompSetId: c.subCompSetId ?? null,
      presentInVariants: c.presentInVariants ?? [],
      defaultVariantPresent: c.defaultVariantPresent ?? false,
      placementsByVariant: c.placementsByVariant ?? {},
    }));

  return {
    _meta: {
      schemaVersion: '1',
      preparedAt,
      componentSlug: base._meta.componentSlug,
      domain: 'api',
      baseSourceHash,
      defaultVariantId: defaultVariant.id,
      defaultVariantName: defaultVariant.name,
    },
    data: {
      componentName: base.component.componentName,
      variantAxes: base.variantAxes,
      booleanProps,
      instanceSwapProps: base.propertyDefinitions.instanceSwaps,
      slotProps: base.propertyDefinitions.slots,
      composableChildren,
      relevantVariableCollections,
      textNodeMap,
      ownershipHints: base.ownershipHints,
      defaultProps: base.defaultVariant.variantProperties,
      defaultVariantName: base.defaultVariant.name,
      boolGatedFillers: (base.slotHostGeometry as { boolGatedFillers?: unknown[] } | null)
        ?.boolGatedFillers ?? [],
      referencedChildren,
      obligations: buildApiObligations(base, defaultVariantIndex),
    },
  };
}

export function walkTextNodes(node: TreeNode, acc: Array<Record<string, unknown>> = []): typeof acc {
  if (node.type === 'TEXT') {
    acc.push({
      nodeId: node.id ?? null,
      name: node.name,
      styleId: node.styleId ?? null,
      typography: node.typography ?? null,
      characters: node.characters ?? null,
    });
  }
  for (const child of node.children ?? []) {
    walkTextNodes(child, acc);
  }
  return acc;
}
