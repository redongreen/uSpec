// Phase I — sub-component spec walks.
//
// Phase E walks the PARENT's variants. For each top-level INSTANCE it captures the
// embedded child as-is (at whatever default variant the designer placed in the parent).
// If a constitutive child has its own variant axes — e.g. Input's `size: large | medium
// | small` — Phase E never varies them. Downstream spec tables therefore render those
// columns as `—`.
//
// Phase I fills that gap. It reads the finalized _childComposition.children[] (after
// user classifications from Phase F'), and emits a `subComponentVariantWalks[subCompSetId]`
// record per relevant entry. Coverage by (classification × target shape):
//
//   • constitutive + COMPONENT_SET   → cross-product variant walk (capped at MAX_COMBOS_PER_SUB)
//   • constitutive + plain COMPONENT → single "(default)" walk
//   • referenced   + plain COMPONENT → single "(default)" walk (captures the "recipe"
//                                      composition — container-level dims + tree —
//                                      without recursing into nested instances' own
//                                      variant matrices)
//   • referenced   + COMPONENT_SET   → skipped; the Phase A interface summary in
//                                      `propertyDefinitions.slots[].preferredInstances[]`
//                                      already covers these.
//
// Every walk's `treeHierarchical` stops at nested INSTANCE boundaries (same as Phase E),
// but leaf INSTANCE entries now carry a compact configuration summary:
// mainComponentName / parentSetName / variantProperties / booleanOverrides /
// instanceSwapOverrides / textOverrides. This lets downstream specs describe how each
// embedded instance is configured (e.g. "icon-button, size=md, variant=forward") without
// recursing into that instance's own internal spec.
//
// Scope remains narrow — dimensions + instance-config summaries only. colorWalk /
// treeFlat / layoutTree and the style/variable collection that Phase E performs are
// deliberately omitted. Downstream color/voice specialists can opt in later without
// Phase I blocking on them.

import { sg } from './safe';
import { extractDims } from './phaseE';

export type SubComponentVariantEntry = {
  variantKey: string;
  variantProperties: Record<string, string>;
  dimensions: any;
  treeHierarchical: any;
};

export type SubComponentVariantWalk = {
  name: string;
  subCompSetId: string;
  subCompSetName: string | null;
  classification: 'constitutive' | 'referenced';
  axes: Record<string, string[]>;
  variants: SubComponentVariantEntry[];
  skipped?: boolean;
  skippedReason?: string;
};

export type PhaseIResult = {
  walks: Record<string, SubComponentVariantWalk>;
  warnings: string[];
};

type ChildCompositionEntry = {
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
};

type ChildComposition = {
  children: ChildCompositionEntry[];
  ambiguousChildren: ChildCompositionEntry[];
  guessConfidence: 'high' | 'medium' | 'low';
};

const MAX_COMBOS_PER_SUB = 20;

// Cartesian product of axis values. Given { size: ['a','b'], density: ['x','y'] }
// returns [{size:'a',density:'x'}, {size:'a',density:'y'}, {size:'b',density:'x'}, {size:'b',density:'y'}].
function crossProduct(
  axes: Record<string, string[]>
): Array<Record<string, string>> {
  const keys = Object.keys(axes);
  if (keys.length === 0) return [];
  let combos: Array<Record<string, string>> = [{}];
  for (const k of keys) {
    const next: Array<Record<string, string>> = [];
    for (const combo of combos) {
      for (const v of axes[k]) {
        next.push({ ...combo, [k]: v });
      }
    }
    combos = next;
  }
  return combos;
}

// Summarizes the *configuration* of an INSTANCE node — enough for downstream specs
// to describe how the instance is configured ("icon-button, size=md, variant=forward")
// without recursing into the instance's own internal spec. Derived from the instance's
// main component (for identity) and its `componentProperties` (for per-instance
// overrides). Silently returns `null` if the main component can't be resolved; callers
// should tolerate that.
async function summarizeInstance(node: any): Promise<any> {
  if (!node || node.type !== 'INSTANCE') return null;
  let mc: any = null;
  try {
    mc = await (node as InstanceNode).getMainComponentAsync();
  } catch {}
  const parentSet =
    mc && mc.parent && mc.parent.type === 'COMPONENT_SET' ? mc.parent : null;
  const variantProperties: Record<string, string> = {};
  const booleanOverrides: Record<string, boolean> = {};
  const instanceSwapOverrides: Record<string, string> = {};
  const textOverrides: Record<string, string> = {};
  const props = (node as InstanceNode).componentProperties || {};
  for (const [rawKey, vRaw] of Object.entries(props)) {
    const v: any = vRaw;
    const clean = rawKey.split('#')[0];
    if (v.type === 'VARIANT') variantProperties[clean] = v.value;
    else if (v.type === 'BOOLEAN') booleanOverrides[clean] = v.value;
    else if (v.type === 'INSTANCE_SWAP') instanceSwapOverrides[clean] = v.value;
    else if (v.type === 'TEXT') textOverrides[clean] = v.value;
  }
  return {
    mainComponentId: mc ? mc.id : null,
    mainComponentName: mc ? mc.name : null,
    parentSetId: parentSet ? parentSet.id : null,
    parentSetName: parentSet ? parentSet.name : mc ? mc.name : null,
    isComponentSet: !!parentSet,
    variantProperties,
    booleanOverrides,
    instanceSwapOverrides,
    textOverrides,
  };
}

// Depth-aware walker that emits dimensions for the walk root and every descendant,
// stopping at nested INSTANCE boundaries (those are sub-sub-components, out of scope
// for this walk — same policy as Phase E for depth >= 1 INSTANCEs). For nested INSTANCE
// nodes, we still emit a compact `instanceConfig` summary so downstream specs can
// describe how the instance is configured without recursing into it.
async function measureHierarchical(node: any, depth: number): Promise<any> {
  const entry: any = {
    name: node.name,
    type: node.type,
    visible: node.visible,
    dimensions: await extractDims(node),
  };
  const isRootOrNonInstance = node.type !== 'INSTANCE' || depth === -1 || depth === 0;
  // Attach instance config for every INSTANCE node — including the root when the walk
  // target itself is an INSTANCE (rare) and every nested INSTANCE leaf.
  if (node.type === 'INSTANCE') {
    const cfg = await summarizeInstance(node);
    if (cfg) entry.instanceConfig = cfg;
  }
  const kids = sg(node, 'children');
  if (kids && kids.length > 0 && isRootOrNonInstance) {
    const childDepth = depth === -1 ? 0 : depth + 1;
    const arr: any[] = [];
    for (const c of kids) arr.push(await measureHierarchical(c, childDepth));
    entry.children = arr;
  }
  return entry;
}

export async function runPhaseI(
  childComposition: ChildComposition
): Promise<PhaseIResult> {
  const walks: Record<string, SubComponentVariantWalk> = {};
  const warnings: string[] = [];

  for (const child of childComposition.children) {
    // Only constitutive or referenced entries get walked. Decorative / unclassified
    // (null) entries are explicitly excluded.
    if (child.classification !== 'constitutive' && child.classification !== 'referenced')
      continue;
    if (!child.subCompSetId) continue;

    let cs: BaseNode | null = null;
    try {
      cs = await figma.getNodeByIdAsync(child.subCompSetId);
    } catch {}
    if (!cs) continue;

    // Plain-COMPONENT path — covers both constitutive (full recipe spec) and
    // referenced ("container + nested-instance configs"). Neither has a variant
    // matrix at this level to enumerate, so we emit a single "(default)" walk and
    // rely on `treeHierarchical`'s per-node `instanceConfig` summaries to describe
    // the inner instances.
    if (cs.type === 'COMPONENT') {
      const dims = await extractDims(cs);
      const tree = await measureHierarchical(cs, -1);
      walks[child.subCompSetId] = {
        name: child.name,
        subCompSetId: child.subCompSetId,
        subCompSetName: (cs as any).name || child.parentSetName || null,
        classification: child.classification,
        axes: {},
        variants: [
          {
            variantKey: '(default)',
            variantProperties: {},
            dimensions: dims,
            treeHierarchical: tree,
          },
        ],
      };
      continue;
    }

    if (cs.type !== 'COMPONENT_SET') continue;

    // Referenced COMPONENT_SETs are covered by Phase A's interface summary; skip
    // them here to avoid duplicating a heavy cross-product walk for library refs.
    if (child.classification === 'referenced') continue;

    const axisKeys = Object.keys(child.subCompVariantAxes);
    if (axisKeys.length === 0) continue;

    const combos = crossProduct(child.subCompVariantAxes);
    if (combos.length > MAX_COMBOS_PER_SUB) {
      walks[child.subCompSetId] = {
        name: child.name,
        subCompSetId: child.subCompSetId,
        subCompSetName: child.parentSetName || null,
        classification: child.classification,
        axes: child.subCompVariantAxes,
        variants: [],
        skipped: true,
        skippedReason: `cross-product ${combos.length} exceeds cap ${MAX_COMBOS_PER_SUB}`,
      };
      warnings.push(
        `Phase I skipped "${child.name}" sub-component variant walk (${combos.length} combos > cap ${MAX_COMBOS_PER_SUB}).`
      );
      continue;
    }

    const setChildren = (cs as ComponentSetNode).children;
    const entries: SubComponentVariantEntry[] = [];
    for (const combo of combos) {
      const match = setChildren.find((v: any) => {
        if (v.type !== 'COMPONENT') return false;
        const vp = v.variantProperties || {};
        for (const [k, want] of Object.entries(combo)) {
          if (vp[k] !== want) return false;
        }
        return true;
      });
      if (!match) continue;

      const dims = await extractDims(match);
      const tree = await measureHierarchical(match, -1);

      entries.push({
        variantKey: Object.entries(combo)
          .map(([k, v]) => `${k}=${v}`)
          .join('|'),
        variantProperties: combo,
        dimensions: dims,
        treeHierarchical: tree,
      });
    }

    walks[child.subCompSetId] = {
      name: child.name,
      subCompSetId: child.subCompSetId,
      subCompSetName: child.parentSetName || null,
      classification: child.classification,
      axes: child.subCompVariantAxes,
      variants: entries,
    };

    if (entries.length < combos.length) {
      warnings.push(
        `Phase I walked ${entries.length}/${combos.length} variants of "${child.name}" (${combos.length - entries.length} combo(s) had no matching COMPONENT inside set ${child.subCompSetId}).`
      );
    }
  }

  return { walks, warnings };
}
