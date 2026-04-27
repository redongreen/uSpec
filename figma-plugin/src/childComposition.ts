// Phase F' — synthesize _childComposition.
//
// When the plugin runs in interactive mode, the UI overrides every child's classification with
// `classificationEvidence: ["user-selected"]` so the downstream create-component-md Step 4.5
// review becomes a no-op. This module provides the "first guess" that the UI offers the user
// for review.

import type { PhaseAResult } from './phaseA';
import type { PhaseEVariantResult } from './phaseE';
import type { ChildOrigin } from './types';

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
  const topLevelChildren = Array.isArray(defaultVariantEntry.treeHierarchical?.children)
    ? defaultVariantEntry.treeHierarchical.children
    : [];

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

  topLevelChildren.forEach((child: any, idx: number) => {
    const entry: ChildCompositionEntry = {
      name: child.name,
      mainComponentName: child.mainComponentName || null,
      parentSetName: child.parentSetName || null,
      subCompSetId: child.subCompSetId || null,
      topLevelInstanceId: `idx:${idx}`,
      nodeType: child.type,
      booleanOverrides: child.booleanOverrides || {},
      subCompVariantAxes: child.subCompVariantAxes || {},
      classification: null,
      classificationReason: '',
      classificationEvidence: [],
      origin: 'top-level',
      slotName: null,
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
