// Phase F' — synthesize _childComposition.
//
// When the plugin runs in interactive mode, the UI overrides every child's classification with
// `classificationEvidence: ["user-selected"]` so the downstream create-component-md Step 4.5
// review becomes a no-op. This module provides the "first guess" that the UI offers the user
// for review.

import type { PhaseAResult } from './phaseA';
import type { PhaseEVariantResult } from './phaseE';
import type { ChildOrigin, ComponentPropertySnapshot } from './types';
import {
  collectOwnedInstancePlacements,
  getEffectiveChildContainerOfWalked,
} from './safe';

export type ChildCompositionEntry = {
  name: string;
  mainComponentName: string | null;
  parentSetName: string | null;
  subCompSetId: string | null;
  topLevelInstanceId: string | null;
  nodeType: string;
  booleanOverrides: Record<string, boolean>;
  // See PreviewChild.componentProperties for the shape's rationale. `null` for entries
  // without a placed instance (FRAMEs, vectors, wrapper layout chrome, slot-preferred
  // entries).
  componentProperties: ComponentPropertySnapshot | null;
  subCompVariantAxes: Record<string, string[]>;
  classification: 'constitutive' | 'referenced' | 'decorative' | null;
  classificationReason: string;
  classificationEvidence: string[];
  origin: ChildOrigin;
  slotName: string | null;
  // See PreviewChild.placement* for semantics. Set per top-level entry by the dedup
  // pass in buildFirstGuess; defaulted to 1/[]/false for wrapper:N and slot-origin
  // entries.
  placementCount: number;
  placementIndices: number[];
  placementsVary: boolean;
  presentInVariants: string[];
  defaultVariantPresent: boolean;
  placementsByVariant: Record<
    string,
    { variantId: string; nodeIds: string[]; placementIndices: number[] }
  >;
};

export type ChildComposition = {
  children: ChildCompositionEntry[];
  ambiguousChildren: ChildCompositionEntry[];
  guessConfidence: 'high' | 'medium' | 'low';
};

export function buildFirstGuess(
  parentName: string,
  variantEntries: PhaseEVariantResult[],
  defaultVariantId: string,
  propertyDefinitions: PhaseAResult['propertyDefinitions']
): ChildComposition {
  // Build an INSTANCE_SWAP reference set so we can tag children that are the concrete fill of
  // an instance-swap property.
  const instanceSwapTargets = new Set(
    propertyDefinitions.instanceSwaps
      .map((s) => s.defaultValue)
      .filter((v): v is string => Boolean(v))
  );

  const escaped = parentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nameRegex = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
  const roleSuffixRegex = /(Item|Row|Cell|Step|Tab|Segment|Panel|Option)$/;

  const children: ChildCompositionEntry[] = [];
  const ambiguous: ChildCompositionEntry[] = [];
  const byIdentity = new Map<
    string,
    { representative: any; fingerprints: Set<string>; placements: ChildCompositionEntry['placementsByVariant'] }
  >();
  const wrapperByIdentity = new Map<string, ChildCompositionEntry>();
  const orderedVariants = [
    ...variantEntries.filter((variant) => variant.id === defaultVariantId),
    ...variantEntries.filter((variant) => variant.id !== defaultVariantId),
  ];

  for (const variant of orderedVariants) {
    const { container: effectiveTree, wrappers } = getEffectiveChildContainerOfWalked(
      variant.treeHierarchical
    );
    const topLevelChildren = Array.isArray(effectiveTree.children) ? effectiveTree.children : [];

    wrappers.forEach((w: any, depth: number) => {
      const identity = `wrapper:${depth}:${w.name}`;
      const existing = wrapperByIdentity.get(identity);
      if (existing) {
        existing.presentInVariants.push(variant.name);
        existing.defaultVariantPresent ||= variant.id === defaultVariantId;
        existing.placementsByVariant[variant.name] = {
          variantId: variant.id,
          nodeIds: w.id ? [w.id] : [],
          placementIndices: [],
        };
        return;
      }
      wrapperByIdentity.set(identity, {
        name: w.name,
        mainComponentName: null,
        parentSetName: null,
        subCompSetId: null,
        topLevelInstanceId: identity,
        nodeType: w.type,
        booleanOverrides: {},
        componentProperties: null,
        subCompVariantAxes: {},
        classification: 'decorative',
        classificationReason:
          'Layout wrapper FRAME — descended for sub-component classification.',
        classificationEvidence: ['layout-wrapper'],
        origin: 'top-level',
        slotName: null,
        placementCount: 1,
        placementIndices: [],
        placementsVary: false,
        presentInVariants: [variant.name],
        defaultVariantPresent: variant.id === defaultVariantId,
        placementsByVariant: {
          [variant.name]: {
            variantId: variant.id,
            nodeIds: w.id ? [w.id] : [],
            placementIndices: [],
          },
        },
      });
    });

    const directIndexById = new Map<string, number>();
    topLevelChildren.forEach((child: any, index: number) => {
      if (child.id) directIndexById.set(String(child.id), index);
    });
    const recordPlacement = (child: any, index: number | null): void => {
      const identity =
        child.type === 'INSTANCE'
          ? `component:${child.subCompSetId || child.mainComponentName || child.name}`
          : `decorative:${child.type}:${child.name}`;
      const fingerprint = `${child.mainComponentName || ''}|${JSON.stringify(
        child.booleanOverrides || {}
      )}|${JSON.stringify(child.componentProperties || {})}`;
      const existing = byIdentity.get(identity);
      if (existing) {
        existing.fingerprints.add(fingerprint);
        const placement = existing.placements[variant.name] ?? {
          variantId: variant.id,
          nodeIds: [],
          placementIndices: [],
        };
        if (child.id && placement.nodeIds.includes(child.id)) return;
        if (child.id) placement.nodeIds.push(child.id);
        if (index != null) placement.placementIndices.push(index);
        existing.placements[variant.name] = placement;
        return;
      }
      byIdentity.set(identity, {
        representative: child,
        fingerprints: new Set([fingerprint]),
        placements: {
          [variant.name]: {
            variantId: variant.id,
            nodeIds: child.id ? [child.id] : [],
            placementIndices: index == null ? [] : [index],
          },
        },
      });
    };
    topLevelChildren.forEach((child: any, index: number) => recordPlacement(child, index));
    for (const { node } of collectOwnedInstancePlacements(variant.treeHierarchical)) {
      recordPlacement(node, directIndexById.get(String(node.id)) ?? null);
    }
  }

  children.push(...wrapperByIdentity.values());

  for (const [identity, group] of byIdentity) {
    const child: any = group.representative;
    const presentInVariants = Object.keys(group.placements);
    const defaultPlacement = Object.values(group.placements).find(
      (placement) => placement.variantId === defaultVariantId
    );
    const placementCount = Object.values(group.placements).reduce(
      (total, placement) => total + placement.nodeIds.length,
      0
    );
    const entry: ChildCompositionEntry = {
      name: child.name,
      mainComponentName: child.mainComponentName || null,
      parentSetName: child.parentSetName || null,
      subCompSetId: child.subCompSetId || null,
      topLevelInstanceId: identity,
      nodeType: child.type,
      booleanOverrides: child.booleanOverrides || {},
      // Forward the typed snapshot Phase E captured at depth 0. `null` for non-INSTANCE
      // entries (FRAMEs, vectors, wrappers) and for any INSTANCE Phase E couldn't
      // snapshot (rare; defensive).
      componentProperties: child.componentProperties || null,
      subCompVariantAxes: child.subCompVariantAxes || {},
      classification: null,
      classificationReason: '',
      classificationEvidence: [],
      origin: 'top-level',
      slotName: null,
      placementCount,
      placementIndices: defaultPlacement?.placementIndices ?? [],
      placementsVary: group.fingerprints.size > 1,
      presentInVariants,
      defaultVariantPresent: Boolean(defaultPlacement),
      placementsByVariant: group.placements,
    };

    if (child.type !== 'INSTANCE') {
      entry.classification = 'decorative';
      entry.classificationReason =
        'Child is not an INSTANCE (raw vector, frame, or text with no main component).';
      entry.classificationEvidence.push('not-instance');
      children.push(entry);
      continue;
    }

    const haystack = `${child.mainComponentName || ''}|${child.parentSetName || ''}`;
    const substringMatch = nameRegex.test(haystack);
    const suffixName = child.parentSetName || child.mainComponentName || '';
    const hasRoleSuffix = roleSuffixRegex.test(suffixName);

    if (substringMatch) {
      entry.classification = 'constitutive';
      entry.classificationReason = `Child's component name contains parent name "${parentName}".`;
      entry.classificationEvidence.push('parent-name-substring');
    } else if (hasRoleSuffix) {
      entry.classification = 'constitutive';
      entry.classificationReason = 'Child name ends with a role-style suffix (Item / Row / Cell / …).';
      entry.classificationEvidence.push('role-suffix');
    } else if (child.subCompSetId && instanceSwapTargets.has(child.subCompSetId)) {
      entry.classification = 'referenced';
      entry.classificationReason = 'Child is the default fill of an INSTANCE_SWAP property.';
      entry.classificationEvidence.push('instance-swap-fill');
    } else {
      entry.classification = null;
      entry.classificationReason =
        'No strong structural signal. Designer decides constitutive vs referenced in the plugin UI.';
      entry.classificationEvidence.push('ambiguous');
    }

    if (entry.classification === null) {
      ambiguous.push(entry);
    } else {
      children.push(entry);
    }
  }

  const confidence: ChildComposition['guessConfidence'] =
    ambiguous.length === 0 ? 'high' : ambiguous.length * 2 > byIdentity.size ? 'low' : 'medium';

  return {
    children,
    ambiguousChildren: ambiguous,
    guessConfidence: confidence,
  };
}
