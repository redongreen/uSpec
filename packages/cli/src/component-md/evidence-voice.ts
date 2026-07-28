import type { BaseJson, EvidenceEnvelope } from './types.js';
import { findDefaultVariant } from './stage.js';

const A11Y_AXIS_PATTERN = /state|mode|interaction/i;

export function buildVoiceEvidence(
  base: BaseJson,
  baseSourceHash: string,
  preparedAt: string,
): EvidenceEnvelope<Record<string, unknown>> {
  const defaultVariant = findDefaultVariant(base);

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

  const focusStopCandidates = (defaultVariant.treeFlat ?? [])
    .filter((el) => el.visible && ['INSTANCE', 'TEXT', 'FRAME'].includes(el.nodeType))
    .map((el) => ({
      index: el.index,
      name: el.name,
      nodeType: el.nodeType,
      candidateLayerName: el.name,
      slotIndex: el.slotIndex ?? null,
    }));

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
      variantAxes: base.variantAxes,
      booleanDefs,
      slotDefs: base.propertyDefinitions.slots,
      slotVisibility,
      a11yAxisCandidates: base.variantAxes
        .filter((axis) => A11Y_AXIS_PATTERN.test(axis.name))
        .map((axis) => axis.name),
      textNodeHints: base.ownershipHints.filter((h) => h.evidenceType === 'textNode'),
      focusStopCandidates,
    },
  };
}
