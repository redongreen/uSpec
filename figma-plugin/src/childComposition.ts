// Phase F' — synthesize _childComposition.
//
// When the plugin runs in interactive mode, the UI overrides every child's classification with
// `classificationEvidence: ["user-selected"]` so the downstream create-component-md Step 4.5
// review becomes a no-op. This module provides the "first guess" that the UI offers the user
// for review.

import type { PhaseAResult } from './phaseA';
import type { PhaseEVariantResult } from './phaseE';
import type { ChildOrigin } from './types';
import { getEffectiveChildContainerOfWalked, groupBySubComp } from './safe';

export type ChildCompositionEntry = {
  name: string;
  mainComponentName: string | null;
  parentSetName: string | null;
  subCompSetId: string | null;
  topLevelInstanceId: string | null;
  nodeType: string;
  booleanOverrides: Record<string, boolean>;
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
};

export type ChildComposition = {
  children: ChildCompositionEntry[];
  ambiguousChildren: ChildCompositionEntry[];
  guessConfidence: 'high' | 'medium' | 'low';
};

export function buildFirstGuess(
  parentName: string,
  defaultVariantEntry: PhaseEVariantResult,
  propertyDefinitions: PhaseAResult['propertyDefinitions']
): ChildComposition {
  // Descend through any single auto-layout FRAME wrappers — same rule as sendPreview /
  // flatWalk — so the first guess is computed against the real top-level children.
  const { container: effectiveTree, wrappers } = getEffectiveChildContainerOfWalked(
    defaultVariantEntry.treeHierarchical
  );
  const topLevelChildren = Array.isArray(effectiveTree.children) ? effectiveTree.children : [];

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

  // Surface every descended-through wrapper as an explicit decorative entry so consumers
  // of `_childComposition` can see the layout chrome that was bypassed.
  wrappers.forEach((w: any, depth: number) => {
    children.push({
      name: w.name,
      mainComponentName: null,
      parentSetName: null,
      subCompSetId: null,
      topLevelInstanceId: `wrapper:${depth}`,
      nodeType: w.type,
      booleanOverrides: {},
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
    });
  });

  // Dedup top-level INSTANCE children by sub-component identity. Preserves the original
  // order of first occurrence so `idx:N` keys and the `topLevelInstanceId` round-trip
  // from `sendPreview` line up. Non-INSTANCE children pass through as solo groups.
  const groups = groupBySubComp(
    topLevelChildren as any[],
    (child: any) => {
      if (child.type !== 'INSTANCE') return null;
      // Prefer subCompSetId (stable across COMPONENT_SET membership); fall back to
      // mainComponentName for plain components without a parent set.
      return child.subCompSetId || child.mainComponentName || null;
    },
    // Two placements are "the same" when their main-component variant choice and their
    // boolean overrides match. mainComponentName encodes the variant for COMPONENT_SET
    // members (e.g. "state=default, size=medium"). Instance-swap and text overrides are
    // intentionally not in v1 — see groupBySubComp's docstring.
    (child: any) => {
      const overrides = JSON.stringify(child.booleanOverrides || {});
      return `${child.mainComponentName || ''}|${overrides}`;
    }
  );

  groups.forEach((group) => {
    const child: any = group.representative;
    const entry: ChildCompositionEntry = {
      name: child.name,
      mainComponentName: child.mainComponentName || null,
      parentSetName: child.parentSetName || null,
      subCompSetId: child.subCompSetId || null,
      topLevelInstanceId: `idx:${group.index}`,
      nodeType: child.type,
      booleanOverrides: child.booleanOverrides || {},
      subCompVariantAxes: child.subCompVariantAxes || {},
      classification: null,
      classificationReason: '',
      classificationEvidence: [],
      origin: 'top-level',
      slotName: null,
      placementCount: group.members.length,
      placementIndices: group.indices,
      placementsVary: group.varies,
    };

    if (child.type !== 'INSTANCE') {
      entry.classification = 'decorative';
      entry.classificationReason =
        'Child is not an INSTANCE (raw vector, frame, or text with no main component).';
      entry.classificationEvidence.push('not-instance');
      children.push(entry);
      return;
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
  });

  const confidence: ChildComposition['guessConfidence'] =
    ambiguous.length === 0 ? 'high' : ambiguous.length * 2 > topLevelChildren.length ? 'low' : 'medium';

  return {
    children,
    ambiguousChildren: ambiguous,
    guessConfidence: confidence,
  };
}
