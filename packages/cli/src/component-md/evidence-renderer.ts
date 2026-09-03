import type { BaseJson, EvidenceEnvelope } from './types.js';
import { findDefaultVariant } from './stage.js';

/**
 * Mechanical fields required by the final Markdown renderer. Semantic prose
 * stays in specialist caches and the AI-authored render plan.
 */
export function buildRendererEvidence(
  base: BaseJson,
  baseSourceHash: string,
  preparedAt: string,
): EvidenceEnvelope<Record<string, unknown>> {
  const defaultVariant = findDefaultVariant(base);

  return {
    _meta: {
      schemaVersion: '1',
      preparedAt,
      componentSlug: base._meta.componentSlug,
      domain: 'renderer',
      baseSourceHash,
      defaultVariantId: defaultVariant.id,
      defaultVariantName: defaultVariant.name,
    },
    data: {
      source: {
        extractedAt: base._meta.extractedAt,
        fileKey: base._meta.fileKey,
        nodeId: base._meta.nodeId,
        figmaUrl:
          base._meta.figmaUrl ??
          `https://www.figma.com/design/${base._meta.fileKey}/?node-id=${base._meta.nodeId.replaceAll(':', '-')}`,
        optionalContext: base._meta.optionalContext ?? null,
        extractionSource: base._meta.extractionSource ?? null,
      },
      component: base.component,
      variantAxes: base.variantAxes,
      defaultVariant: base.defaultVariant,
      defaultTree: defaultVariant.treeHierarchical,
      variantTrees: base.variants.map((variant) => ({
        id: variant.id,
        name: variant.name,
        variantProperties: variant.variantProperties,
        treeHierarchical: variant.treeHierarchical,
        revealedTree: variant.revealedTree ?? null,
        revealedTreeRepresentative: variant.revealedTreeRepresentative ?? variant.name,
      })),
      variantSelfChecks: base.variants.map((variant) => ({
        id: variant.id,
        name: variant.name,
        selfCheck: variant._selfCheck ?? null,
      })),
      propertyDefinitions: base.propertyDefinitions,
      slotHostGeometry: base.slotHostGeometry ?? null,
      childComposition: base._childComposition,
      subComponentVariantWalks: base.subComponentVariantWalks ?? null,
      extractionNotes: base._extractionNotes,
    },
  };
}
