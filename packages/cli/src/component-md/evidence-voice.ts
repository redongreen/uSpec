import type { BaseJson, EvidenceEnvelope } from './types.js';
import { findDefaultVariant } from './stage.js';
import { buildVoiceObligations } from './obligations.js';

const A11Y_AXIS_PATTERN = /state|mode|interaction/i;

export function buildVoiceEvidence(
  base: BaseJson,
  baseSourceHash: string,
  preparedAt: string,
): EvidenceEnvelope<Record<string, unknown>> {
  const defaultVariant = findDefaultVariant(base);
  const defaultVariantIndex = base.variants.findIndex((variant) => variant.id === defaultVariant.id);

  const booleanDefs: Record<string, boolean> = {};
  for (const b of base.propertyDefinitions.booleans) {
    booleanDefs[b.rawKey] = b.defaultValue;
  }

  const slotVisibility: Record<string, string> = {};
  for (const slot of base.propertyDefinitions.slots as Array<{
    name?: string;
    visibleRawKey?: string;
  }>) {
    if (slot.name && slot.visibleRawKey) {
      slotVisibility[slot.name] = slot.visibleRawKey;
    }
  }

  const variantElements = base.variants.map((variant) => ({
    variantId: variant.id,
    variantName: variant.name,
    variantProperties: variant.variantProperties,
    elements: variant.treeFlat ?? [],
  }));
  const focusStopCandidates = variantElements.flatMap((variant) =>
    variant.elements
      .filter((element) =>
        element.visible && ['INSTANCE', 'TEXT', 'FRAME'].includes(element.nodeType)
      )
      .map((element) => ({
        variantId: variant.variantId,
        variantName: variant.variantName,
        variantProperties: variant.variantProperties,
        index: element.index,
        name: element.name,
        nodeType: element.nodeType,
        candidateLayerName: element.name,
        slotIndex: element.slotIndex ?? null,
      })),
  );

  return {
    _meta: {
      schemaVersion: '1',
      preparedAt,
      componentSlug: base._meta.componentSlug,
      domain: 'voice',
      baseSourceHash,
      defaultVariantId: defaultVariant.id,
      defaultVariantName: defaultVariant.name,
    },
    data: {
      componentName: base.component.componentName,
      compSetNodeId: base.component.compSetNodeId,
      elements: defaultVariant.treeFlat ?? [],
      variantElements,
      variantAxes: base.variantAxes,
      booleanDefs,
      slotDefs: base.propertyDefinitions.slots,
      slotVisibility,
      a11yAxisCandidates: base.variantAxes
        .filter((axis) => A11Y_AXIS_PATTERN.test(axis.name))
        .map((axis) => axis.name),
      textNodeHints: base.ownershipHints.filter((h) => h.evidenceType === 'textNode'),
      focusStopCandidates,
      obligations: buildVoiceObligations(base, defaultVariantIndex),
    },
  };
}
