import type { BaseJson, ColorWalkEntry, EvidenceEnvelope } from './types.js';
import { findDefaultVariant } from './stage.js';
import { buildColorObligations } from './obligations.js';

function resolveToken(
  base: BaseJson,
  styleId?: string | null,
  boundVariableId?: string | null,
): string | null {
  if (styleId && base.styles.resolvedStyles[styleId]?.name) {
    return base.styles.resolvedStyles[styleId].name;
  }
  if (boundVariableId) {
    const variable = base.variables.resolvedVariables[boundVariableId];
    if (variable) {
      return variable.codeSyntax || variable.name || null;
    }
  }
  return null;
}

function colorEntryKey(entry: { element: string; property: string; hex?: string | null; styleId?: string | null; boundVariableId?: string | null }) {
  const token = entry.styleId || entry.boundVariableId || entry.hex || '';
  return `${entry.element}|${entry.property}|${token}`;
}

function resolveColorEntry(base: BaseJson, walk: ColorWalkEntry) {
  return {
    element: walk.element,
    path: walk.path,
    property: walk.property,
    hex: walk.hex ?? null,
    token: resolveToken(base, walk.styleId, walk.boundVariableId),
    opacity: walk.opacity ?? null,
    subComponentName: walk.subComponentName ?? undefined,
    stops: walk.stops,
    angleDegrees: walk.angleDegrees ?? null,
  };
}

function buildBooleanDelta(base: BaseJson, defaultVariant: BaseJson['variants'][0]) {
  const baseline = defaultVariant.colorWalk ?? [];
  const revealed = defaultVariant.revealedColorWalk ?? [];
  const baselineKeys = new Set(baseline.map((e) => colorEntryKey(e)));
  const delta = revealed
    .filter((e) => !baselineKeys.has(colorEntryKey(e)))
    .map((e) => resolveColorEntry(base, e));
  return { delta };
}

function detectModeCollection(base: BaseJson) {
  const pattern = /density|shape|size|spacing|radius|tone|color|state|variant|theme|mode/i;
  for (const collection of base.variables.localCollections) {
    if (collection.modes.length <= 1) continue;
    if (!pattern.test(collection.name)) continue;
    const modeIds: Record<string, string> = {};
    for (const mode of collection.modes) {
      modeIds[mode.name] = mode.modeId;
    }
    return {
      hasModeCollection: true,
      collectionName: collection.name,
      collectionId: collection.id,
      modes: collection.modes.map((m) => m.name),
      modeIds,
      modeTokenMap: {},
    };
  }
  return { hasModeCollection: false };
}

function uniqueTokens(variantColorData: Array<{ colorEntries: Array<{ token: string | null }> }>) {
  const tokens = new Set<string>();
  for (const variant of variantColorData) {
    for (const entry of variant.colorEntries) {
      if (entry.token) tokens.add(entry.token);
    }
  }
  return [...tokens].sort();
}

function containerSymptoms(base: BaseJson) {
  const constitutive = base._childComposition.children.filter(
    (c) => c.classification === 'constitutive' && c.subCompSetId,
  );
  return {
    hasConstitutiveSubComponents: constitutive.length > 0,
    constitutiveNames: constitutive.map((c) => c.name),
  };
}

export function buildColorEvidence(
  base: BaseJson,
  baseSourceHash: string,
  preparedAt: string,
): EvidenceEnvelope<Record<string, unknown>> {
  const defaultVariant = findDefaultVariant(base);
  const cross = (base.crossVariant ?? {}) as Record<string, unknown>;

  const variantColorData = base.variants.map((variant) => ({
    name: variant.name,
    variantProperties: variant.variantProperties,
    colorEntries: (variant.colorWalk ?? []).map((entry) => resolveColorEntry(base, entry)),
  }));

  const modeDetection = detectModeCollection(base);
  const booleanDelta = buildBooleanDelta(base, defaultVariant);

  return {
    _meta: {
      schemaVersion: '1',
      preparedAt,
      componentSlug: base._meta.componentSlug,
      domain: 'color',
      baseSourceHash,
      defaultVariantId: defaultVariant.id,
      defaultVariantName: defaultVariant.name,
    },
    data: {
      variantColorData,
      booleanDelta,
      axisClassification: cross.axisClassification ?? null,
      axisTokenFingerprints: cross.axisTokenFingerprints ?? null,
      modeDetection,
      constitutiveSubComponents: base._childComposition.children
        .filter((c) => c.classification === 'constitutive')
        .map((c) => ({
          name: c.name,
          subCompSetId: c.subCompSetId ?? null,
        })),
      containerSymptoms: containerSymptoms(base),
      uniqueTokens: uniqueTokens(variantColorData),
      strategyHints: {
        suggested: cross.stateAxis ? 'B' : 'A',
        reason: cross.stateAxis
          ? 'stateAxis present in crossVariant'
          : 'no stateAxis; per-variant tables likely',
      },
      obligations: buildColorObligations(base, variantColorData),
    },
  };
}
