type JsonObject = Record<string, any>;

function collectNodeIds(value: unknown, ids = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const child of value) collectNodeIds(child, ids);
    return ids;
  }
  if (!value || typeof value !== 'object') return ids;
  const record = value as JsonObject;
  for (const key of ['id', 'nodeId']) {
    if (typeof record[key] === 'string') ids.add(record[key]);
  }
  for (const child of Object.values(record)) collectNodeIds(child, ids);
  return ids;
}

export function normalizeStructureTargetIdentity(
  sourceModel: JsonObject,
  structure: JsonObject,
): void {
  const rawVariantTrees = Array.isArray(sourceModel.variantTrees)
    ? sourceModel.variantTrees
    : [];
  const variantTrees = rawVariantTrees.map((variant: JsonObject) => ({
    id: String(variant.id ?? ''),
    name: String(variant.name ?? ''),
    variantProperties: (variant.variantProperties ?? {}) as Record<string, string>,
    ids: collectNodeIds(variant.treeHierarchical ?? variant.tree ?? variant),
  }));
  if (variantTrees.length === 0) {
    variantTrees.push({
      id: String(sourceModel.defaultVariant?.id ?? ''),
      name: String(sourceModel.defaultVariant?.name ?? ''),
      variantProperties: sourceModel.defaultVariant?.variantProperties ?? {},
      ids: collectNodeIds(sourceModel.defaultTree),
    });
  }
  const parentIds = new Set(variantTrees.flatMap((variant) => [...variant.ids]));
  const defaultVariantId = String(
    sourceModel.defaultVariant?.id ??
      sourceModel._meta?.defaultVariantId ??
      variantTrees[0]?.id ??
      '',
  );
  const variantsContaining = (nodeId: string): typeof variantTrees =>
    variantTrees.filter((variant) => variant.ids.has(nodeId));
  const variantByProperties = (properties: unknown): (typeof variantTrees)[number] | null => {
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return null;
    const entries = Object.entries(properties as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    );
    if (entries.length === 0) return null;
    const matches = variantTrees.filter((variant) =>
      entries.every(([axis, value]) => variant.variantProperties[axis] === value)
    );
    return matches.length === 1 ? matches[0] : null;
  };
  const resolveParentVariant = (
    target: JsonObject,
    section: JsonObject,
    nodeId: string | null,
  ): (typeof variantTrees)[number] => {
    const explicitId =
      target.variantId ??
      target._targetVariantId ??
      section.variantId ??
      section._targetVariantId;
    if (typeof explicitId === 'string') {
      const explicit = variantTrees.find((variant) => variant.id === explicitId);
      if (explicit) return explicit;
    }
    const explicitName = target.variantName ?? section.variantName;
    if (typeof explicitName === 'string') {
      const named = variantTrees.find((variant) => variant.name === explicitName);
      if (named) return named;
    }
    const byProperties =
      variantByProperties(target.variantProperties) ??
      variantByProperties(section.variantProperties);
    if (byProperties) return byProperties;
    if (nodeId) {
      const containing = variantsContaining(nodeId);
      if (containing.length === 1) return containing[0];
    }
    return (
      variantTrees.find((variant) => variant.id === defaultVariantId) ??
      variantTrees[0]
    );
  };

  const subcomponentIds = new Map<string, Set<string>>();
  const subcomponentVariants = new Map<
    string,
    Array<{ id: string; name: string; variantProperties: Record<string, string>; ids: Set<string> }>
  >();
  for (const [setId, walk] of Object.entries(sourceModel.subComponentVariantWalks ?? {})) {
    subcomponentIds.set(setId, collectNodeIds(walk));
    const variants = Array.isArray((walk as JsonObject)?.variants)
      ? (walk as JsonObject).variants
      : [];
    subcomponentVariants.set(
      setId,
      variants.map((variant: JsonObject) => ({
        id: String(variant.id ?? ''),
        name: String(variant.name ?? ''),
        variantProperties: variant.variantProperties ?? {},
        ids: collectNodeIds(variant.treeHierarchical ?? variant),
      })),
    );
  }

  for (const section of structure.sections ?? []) {
    if (!section._anchor || typeof section._anchor !== 'object') {
      section._anchor = {
        layerName: null,
        layerId: null,
        _targetDisposition: 'unresolved',
        _targetReason: 'Section did not supply a source anchor.',
      };
    }
    const setId =
      typeof section.subCompSetId === 'string' && section.subCompSetId
        ? section.subCompSetId
        : null;
    if (section._anchor) {
      const anchorId =
        typeof section._anchor.layerId === 'string' ? section._anchor.layerId : null;
      const anchorVariant = resolveParentVariant(section._anchor, section, anchorId);
      section._anchor.variantId = anchorVariant.id || null;
      section._anchor.variantName = anchorVariant.name || null;
      section._anchor.variantProperties = anchorVariant.variantProperties;
      section._anchor.sourceScope = setId ? 'parent-placement' : 'parent';
      if (setId) section._anchor.subCompSetId = setId;
      if (anchorId && !anchorVariant.ids.has(anchorId)) {
        section._anchor._invalidLayerId = anchorId;
        section._anchor._invalidTargetVariantId = anchorVariant.id || null;
        section._anchor.layerId = null;
        section._anchor._targetDisposition = 'unresolved';
        section._anchor._targetReason =
          'Layer ID is not present in the declared parent variant tree.';
      } else if (anchorId) {
        section._anchor._targetDisposition = 'resolved';
      } else {
        section._anchor._targetDisposition ??= 'unresolved';
        section._anchor._targetReason ??= 'No source-accurate parent layer ID was supplied.';
      }
    }
    for (const row of section.rows ?? []) {
      if (row.isSubProperty === true || !('_layerName' in row)) continue;
      row._targetScope = setId ? 'subcomponent' : 'parent';
      let exactSubcomponentIds: Set<string> | null = null;
      if (setId) {
        row._targetSubCompSetId = setId;
        const variants = subcomponentVariants.get(setId) ?? [];
        const containing = row._layerId
          ? variants.filter((variant) => variant.ids.has(row._layerId))
          : [];
        const explicitId = row._targetVariantId ?? row.variantId;
        const explicitName = row._targetVariantName ?? row.variantName;
        const explicitProperties =
          row._targetVariantProperties ?? row.variantProperties;
        const byExplicitId =
          typeof explicitId === 'string'
            ? variants.find((variant) => variant.id === explicitId)
            : null;
        const byExplicitName =
          typeof explicitName === 'string'
            ? variants.find((variant) => variant.name === explicitName)
            : null;
        const propertyEntries =
          explicitProperties &&
          typeof explicitProperties === 'object' &&
          !Array.isArray(explicitProperties)
            ? Object.entries(explicitProperties)
            : [];
        const byExplicitProperties =
          propertyEntries.length > 0
            ? variants.find((variant) =>
                propertyEntries.every(
                  ([axis, value]) => variant.variantProperties[axis] === value
                )
              )
            : null;
        const exactVariant =
          byExplicitId ??
          byExplicitName ??
          byExplicitProperties ??
          (containing.length === 1 ? containing[0] : null);
        if (exactVariant) {
          row._targetVariantId = exactVariant.id || null;
          row._targetVariantName = exactVariant.name || null;
          row._targetVariantProperties = exactVariant.variantProperties;
          exactSubcomponentIds = exactVariant.ids;
        }
      } else {
        const rowVariant = resolveParentVariant(row, section, row._layerId ?? null);
        row._targetVariantId = rowVariant.id || null;
        row._targetVariantName = rowVariant.name || null;
        row._targetVariantProperties = rowVariant.variantProperties;
      }
      const allowedGroupIds = setId
        ? exactSubcomponentIds ?? subcomponentIds.get(setId) ?? new Set<string>()
        : variantTrees.find((variant) => variant.id === row._targetVariantId)?.ids ??
          parentIds;
      if (row._layerId && !allowedGroupIds.has(row._layerId)) {
        row._invalidLayerId = row._layerId;
        row._layerId = null;
        row._targetDisposition = 'unresolved';
        row._targetReason = setId
          ? 'Layer ID is not present in the declared sub-component variant walk.'
          : 'Layer ID is not present in the declared parent variant tree.';
      } else if (row._layerId) {
        row._targetDisposition = 'resolved';
      } else {
        row._targetDisposition ??= 'unresolved';
        row._targetReason ??= 'No source-accurate layer ID was supplied.';
      }
    }
  }
}
