// Plugin entry point. Runs in Figma's plugin sandbox (no DOM).
// Responsibilities:
//   1. Validate selection → surface a preview to the UI with child-composition first-guesses.
//   2. On "extract", run phases A, B, E (all variants), C, F, G, H and F'.
//   3. Assemble a single _base.json and return it to the UI for delivery.

import type { MsgFromUi, Preview, PreviewChild, BaseJsonMeta, UserClassification } from './types';
import { runPhaseA } from './phaseA';
import { runPhaseB } from './phaseB';
import { runPhaseE } from './phaseE';
import { runPhaseC } from './phaseC';
import { runPhaseD } from './phaseD';
import { runPhaseF } from './phaseF';
import { runPhaseG } from './phaseG';
import { runPhaseH } from './phaseH';
import { runPhaseI } from './phaseI';
import { buildFirstGuess } from './childComposition';
import {
  slugify,
  sg,
  collectOwnedInstancePlacements,
  getEffectiveChildContainer,
  getEffectiveChildContainerOfWalked,
  getSlotPropName,
  groupBySubComp,
  snapshotComponentProperties,
} from './safe';
import { resolvePreferredComponent } from './resolveKey';
import { sanitizeText } from './sanitize';
import { parseFigmaFileKey, buildFigmaUrl } from './figmaUrl';

// Document-scoped pluginData key under which the user's last Figma file link is
// remembered, so the required link field can be prefilled on later runs.
const FILE_LINK_PLUGIN_DATA_KEY = 'uspecFileLink';

const PLUGIN_VERSION = '2.7.0';

figma.showUI(__html__, { width: 420, height: 620, themeColors: true });

figma.on('selectionchange', () => void sendPreview());
figma.on('currentpagechange', () => void sendPreview());
void sendPreview();

figma.ui.onmessage = async (msg: MsgFromUi) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'refresh-preview') {
    await sendPreview();
    return;
  }
  if (msg.type === 'close') {
    figma.closePlugin();
    return;
  }
  if (msg.type === 'extract') {
    await extract(msg.classifications, msg.optionalContext, msg.fileLink);
    return;
  }
};

function getSelectedTarget(): ComponentNode | ComponentSetNode | null {
  const sel = figma.currentPage.selection;
  if (sel.length !== 1) return null;
  let node: any = sel[0];
  // Walk up from a variant to its component set.
  if (node.type === 'COMPONENT' && node.parent && node.parent.type === 'COMPONENT_SET') {
    node = node.parent;
  }
  if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') return null;
  return node;
}

async function sendPreview(): Promise<void> {
  const target = getSelectedTarget();
  if (!target) {
    figma.ui.postMessage({ type: 'no-selection' });
    return;
  }

  // Lightweight preview — just enough to render the checklist. The heavy walker runs on extract.
  try {
    const isCS = target.type === 'COMPONENT_SET';
    const defaultVariant: any = isCS
      ? (target as ComponentSetNode).defaultVariant || (target as ComponentSetNode).children[0]
      : target;
    const previewVariants: any[] = isCS
      ? [
          defaultVariant,
          ...(target as ComponentSetNode).children.filter((variant) => variant.id !== defaultVariant.id),
        ]
      : [defaultVariant];

    const children: PreviewChild[] = [];
    // Descend through any single auto-layout FRAME wrappers (e.g. a clipping/scroll
    // container) so the checklist surfaces the real top-level sub-components, not the
    // wrapper. The wrapper itself is recorded as a decorative entry below so consumers
    // of `_childComposition` can still see it.
    const { container: effectiveContainer, wrappers } =
      getEffectiveChildContainer(defaultVariant);
    const kids = sg(effectiveContainer, 'children');
    const parentName = target.name;
    const escaped = parentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nameRegex = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
    const roleSuffixRegex = /(Item|Row|Cell|Step|Tab|Segment|Panel|Option)$/;

    // Stamp the heuristic classification onto an already-populated entry. Shared between the
    // top-level scan, slot preferred-value scan, and SLOT default-child scan so each origin
    // applies the same parent-name / role-suffix rules consistently.
    const classifyInstance = (entry: PreviewChild): void => {
      const haystack = `${entry.mainComponentName || ''}|${entry.parentSetName || ''}`;
      const suffixName = entry.parentSetName || entry.mainComponentName || '';
      if (nameRegex.test(haystack)) {
        entry.classification = 'constitutive';
        entry.classificationReason = `Name contains "${parentName}".`;
        entry.classificationEvidence.push('parent-name-substring');
      } else if (roleSuffixRegex.test(suffixName)) {
        entry.classification = 'constitutive';
        entry.classificationReason = 'Ends with a role suffix (Item / Row / Cell / …).';
        entry.classificationEvidence.push('role-suffix');
      } else {
        entry.classification = 'referenced';
        entry.classificationReason = 'Instance of an unrelated component — likely referenced.';
        entry.classificationEvidence.push('default-referenced');
      }
    };

    // Surface every descended-through wrapper as an explicit decorative entry, indexed
    // by descent depth (`wrapper:0` = outermost). Keeps layout chrome visible to the
    // designer (UI shows it under "Decorative") and to consumers of _childComposition.
    wrappers.forEach((w: any, depth: number) => {
      children.push({
        name: w.name,
        nodeType: w.type,
        mainComponentName: null,
        parentSetName: null,
        subCompSetId: null,
        topLevelInstanceId: `wrapper:${depth}`,
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
      });
    });

    // Build a raw entry per direct child of the effective container, BEFORE dedup. The
    // dedup pass below collapses N placements of the same sub-component into one entry
    // with `placementCount: N` so the classification UI asks the designer one question
    // per sub-component, not N. The original positions are preserved in
    // `placementIndices` so consumers can map back to specific nodes in
    // `treeHierarchical[*].children[*]`.
    const rawTopLevel: PreviewChild[] = [];
    if (Array.isArray(kids)) {
      for (let i = 0; i < kids.length; i++) {
        const c: any = kids[i];
        const entry: PreviewChild = {
          name: c.name,
          nodeType: c.type,
          mainComponentName: null,
          parentSetName: null,
          subCompSetId: null,
          topLevelInstanceId: `idx:${i}`,
          booleanOverrides: {},
          componentProperties: snapshotComponentProperties(c),
          subCompVariantAxes: {},
          classification: 'decorative',
          classificationReason: '',
          classificationEvidence: [],
          origin: 'top-level',
          slotName: null,
          placementCount: 1,
          placementIndices: [i],
          placementsVary: false,
        };
        if (c.type === 'INSTANCE') {
          try {
            const mc = await (c as InstanceNode).getMainComponentAsync();
            if (mc) {
              entry.mainComponentName = mc.name;
              const parentSet = mc.parent && mc.parent.type === 'COMPONENT_SET' ? mc.parent : null;
              entry.parentSetName = parentSet ? parentSet.name : mc.name;
              entry.subCompSetId = parentSet ? parentSet.id : mc.id;
              if (parentSet && (parentSet as ComponentSetNode).variantGroupProperties) {
                for (const [k, v] of Object.entries(
                  (parentSet as ComponentSetNode).variantGroupProperties!
                )) {
                  entry.subCompVariantAxes[k] = (v as any).values;
                }
              }
              const ip = (c as InstanceNode).componentProperties;
              for (const [k, vRaw] of Object.entries(ip || {})) {
                const v: any = vRaw;
                if (v.type === 'BOOLEAN') entry.booleanOverrides[k] = v.value;
              }
            }
          } catch {}
          classifyInstance(entry);
        } else {
          entry.classificationReason = 'Non-instance node — not a sub-component.';
          entry.classificationEvidence.push('not-instance');
        }
        rawTopLevel.push(entry);
      }
    }

    // Dedup top-level INSTANCE entries by sub-component identity. Same key + fingerprint
    // as buildFirstGuess so the preview, the first guess, and the user-classification
    // round-trip all agree on `topLevelInstanceId: idx:<firstOccurrence>`.
    const groups = groupBySubComp(
      rawTopLevel,
      (e) => {
        if (e.nodeType !== 'INSTANCE') return null;
        return e.subCompSetId || e.mainComponentName || null;
      },
      (e) => `${e.mainComponentName || ''}|${JSON.stringify(e.booleanOverrides || {})}`
    );
    for (const g of groups) {
      const rep = g.representative;
      if (rep.nodeType === 'INSTANCE') {
        rep.topLevelInstanceId = `component:${
          rep.subCompSetId || rep.mainComponentName || rep.name
        }`;
      }
      rep.placementCount = g.members.length;
      rep.placementIndices = g.indices;
      rep.placementsVary = g.varies;
      rep.presentInVariants = [defaultVariant.name];
      rep.defaultVariantPresent = true;
      rep.placementsByVariant = {
        [defaultVariant.name]: {
          variantId: defaultVariant.id,
          nodeIds: g.indices.map((index: number) => kids[index]?.id).filter(Boolean),
          placementIndices: g.indices,
        },
      };
      children.push(rep);
    }

    // Add instances found through parent-owned structural containers in every variant,
    // and aggregate placements for identities that recur. Traversal stops at INSTANCE
    // and SLOT boundaries so nested internals and interchangeable slot contents do not
    // leak into the parent's fixed composition. This keeps the designer checklist and
    // `_childComposition` aligned with the full variant union.
    const topLevelByIdentity = new Map(
      children
        .filter((entry) => entry.nodeType === 'INSTANCE' && entry.origin === 'top-level')
        .map((entry) => [entry.topLevelInstanceId, entry] as const)
    );
    for (const variant of previewVariants) {
      const { container } = getEffectiveChildContainer(variant);
      const directChildren: any[] = Array.isArray(sg(container, 'children'))
        ? sg(container, 'children')
        : [];
      const directIndexById = new Map(
        directChildren.map((child: any, index: number) => [child.id, index] as const)
      );
      for (const { node: child } of collectOwnedInstancePlacements(variant)) {
        const directIndex = directIndexById.get(child.id);
        const placementIndices = directIndex == null ? [] : [directIndex];
        const entry: PreviewChild = {
          name: child.name,
          nodeType: child.type,
          mainComponentName: null,
          parentSetName: null,
          subCompSetId: null,
          topLevelInstanceId: null,
          booleanOverrides: {},
          componentProperties: snapshotComponentProperties(child),
          subCompVariantAxes: {},
          classification: 'decorative',
          classificationReason: '',
          classificationEvidence: [],
          origin: 'top-level',
          slotName: null,
          placementCount: 1,
          placementIndices: [],
          placementsVary: false,
          presentInVariants: [variant.name],
          defaultVariantPresent: variant.id === defaultVariant.id,
          placementsByVariant: {
            [variant.name]: {
              variantId: variant.id,
              nodeIds: child.id ? [child.id] : [],
              placementIndices,
            },
          },
        };
        try {
          const mc = await (child as InstanceNode).getMainComponentAsync();
          if (mc) {
            entry.mainComponentName = mc.name;
            const parentSet = mc.parent && mc.parent.type === 'COMPONENT_SET' ? mc.parent : null;
            entry.parentSetName = parentSet ? parentSet.name : mc.name;
            entry.subCompSetId = parentSet ? parentSet.id : mc.id;
            if (parentSet && (parentSet as ComponentSetNode).variantGroupProperties) {
              for (const [key, value] of Object.entries(
                (parentSet as ComponentSetNode).variantGroupProperties!
              )) {
                entry.subCompVariantAxes[key] = (value as any).values;
              }
            }
          }
          for (const [key, valueRaw] of Object.entries(
            (child as InstanceNode).componentProperties || {}
          )) {
            const value: any = valueRaw;
            if (value.type === 'BOOLEAN') entry.booleanOverrides[key] = value.value;
          }
        } catch {}
        entry.topLevelInstanceId = `component:${
          entry.subCompSetId || entry.mainComponentName || entry.name
        }`;
        classifyInstance(entry);

        const existing = topLevelByIdentity.get(entry.topLevelInstanceId);
        if (!existing) {
          children.push(entry);
          topLevelByIdentity.set(entry.topLevelInstanceId, entry);
          continue;
        }
        const currentPlacement: {
          variantId: string;
          nodeIds: string[];
          placementIndices: number[];
        } = existing.placementsByVariant?.[variant.name] ?? {
          variantId: String(variant.id),
          nodeIds: [],
          placementIndices: [],
        };
        if (child.id && currentPlacement.nodeIds.includes(child.id)) continue;
        existing.placementCount += 1;
        if (!(existing.presentInVariants || []).includes(variant.name)) {
          existing.presentInVariants = [...(existing.presentInVariants || []), variant.name];
        }
        if (child.id) currentPlacement.nodeIds.push(child.id);
        currentPlacement.placementIndices.push(...placementIndices);
        existing.placementsByVariant = {
          ...(existing.placementsByVariant || {}),
          [variant.name]: currentPlacement,
        };
        const existingFingerprint = JSON.stringify({
          mainComponentName: existing.mainComponentName,
          booleanOverrides: existing.booleanOverrides,
          componentProperties: existing.componentProperties,
        });
        const entryFingerprint = JSON.stringify({
          mainComponentName: entry.mainComponentName,
          booleanOverrides: entry.booleanOverrides,
          componentProperties: entry.componentProperties,
        });
        existing.placementsVary ||= existingFingerprint !== entryFingerprint;
      }
    }

    // Scan SLOT properties so the UI can surface every component the designer either
    // declared as a preferred fill (`componentPropertyDefinitions[slot].preferredValues`)
    // or actually placed inside a SLOT node in the default variant. Without this, the
    // classification checklist only covers direct top-level children and slot content
    // like "Micro Button" / "Text Button" / "Icon Button" / "Trailing Text" is never
    // surfaced. De-duplication is per-slot keyed by mainComponent id — if a preferred
    // value is also placed as a default child we keep the default-child entry (it carries
    // concrete `booleanOverrides` + `subCompVariantAxes` from the actual instance).
    try {
      const propDefs: any = sg(target, 'componentPropertyDefinitions');
      if (propDefs && typeof propDefs === 'object') {
        // Collect slot names up front to avoid async work in a hot loop.
        const slotEntries: Array<{ rawKey: string; slotName: string }> = [];
        for (const [rawKey, defRaw] of Object.entries(propDefs)) {
          const def: any = defRaw;
          if (def && def.type === 'SLOT') {
            slotEntries.push({ rawKey, slotName: rawKey.split('#')[0] });
          }
        }

        // Pre-locate SLOT nodes inside the default variant and match them to their slot
        // property's clean key. `getSlotPropName` prefers Figma's authoritative
        // `componentPropertyReferences.mainComponent` binding (per the SlotNode docs)
        // and falls back to the SLOT node's own `name` when that binding is absent —
        // which is the common case in real files, where SLOTs typically only carry the
        // `visible` binding to a separate BOOLEAN prop.
        const slotNodes: any[] =
          typeof defaultVariant.findAll === 'function'
            ? defaultVariant.findAll((n: any) => n.type === 'SLOT')
            : [];
        const slotNodeByName = new Map<string, any>();
        for (const sn of slotNodes) {
          const key = getSlotPropName(sn);
          if (!key) continue;
          if (!slotNodeByName.has(key)) slotNodeByName.set(key, sn);
        }

        // Soft signal when a declared slot property has no SLOT node we could match.
        // This means either (a) the designer renamed the SLOT node away from the prop
        // name without setting `cpRefs.mainComponent`, or (b) the default variant
        // genuinely has no SLOT for this prop (rare but legal). Either way, downstream
        // we'll emit zero default-child entries for the slot — surface it on the
        // console so the designer can spot it.
        for (const { slotName } of slotEntries) {
          if (!slotNodeByName.has(slotName)) {
            console.warn(
              `[uSpec Extract] Slot property "${slotName}" has no matching SLOT node in the default variant — default-child instances (if any) will not appear in the classification UI.`
            );
          }
        }

        for (const { rawKey, slotName } of slotEntries) {
          const def: any = propDefs[rawKey];
          const seenMainIds = new Set<string>();

          // Slot-preferred: components the designer picked as valid fills. Only honor
          // `pv.type === 'COMPONENT'` to match phaseA — COMPONENT_SET preferred values are
          // a separate Figma feature we intentionally skip until phaseA supports them.
          const preferredValues: any[] = Array.isArray(def.preferredValues) ? def.preferredValues : [];
          for (const pv of preferredValues) {
            if (pv.type !== 'COMPONENT' && pv.type !== 'COMPONENT_SET') continue;
            let compName: string | null = null;
            let parentSetName: string | null = null;
            let subCompSetId: string | null = null;
            const subCompVariantAxes: Record<string, string[]> = {};
            // `pv.key` is a Figma *publish key* (40-char hex), not a local node id, whenever
            // the preferred value points at a library component. `getNodeByIdAsync` returns
            // null in that case, so we fall back to `importComponent(Set)ByKeyAsync` which
            // is Figma's documented way to resolve a library key to a readable node.
            const comp = await resolvePreferredComponent(pv);
            if (comp) {
              compName = comp.name;
              const parentSet = comp.parent && comp.parent.type === 'COMPONENT_SET' ? comp.parent : null;
              const setLike = comp.type === 'COMPONENT_SET' ? comp : parentSet;
              parentSetName = setLike ? setLike.name : comp.name;
              subCompSetId = setLike ? setLike.id : comp.id;
              if (setLike && (setLike as any).variantGroupProperties) {
                for (const [k, v] of Object.entries((setLike as any).variantGroupProperties)) {
                  subCompVariantAxes[k] = (v as any).values;
                }
              }
            }

            const dedupKey = subCompSetId || pv.key;
            if (seenMainIds.has(dedupKey)) continue;
            seenMainIds.add(dedupKey);

            const displayName =
              compName ||
              (pv.key.length > 12 ? `(unresolved library · ${pv.key.slice(0, 8)}…)` : pv.key);
            const entry: PreviewChild = {
              name: displayName,
              nodeType: 'INSTANCE',
              mainComponentName: compName,
              parentSetName,
              subCompSetId,
              topLevelInstanceId: `slot:${slotName}:pref:${pv.key}`,
              booleanOverrides: {},
              // Slot-preferred entries describe a *referenced* component declared as a
              // valid fill, not a *placed* instance. There is no instance to snapshot
              // — leave `null`. Consumers that need the referenced component's defaults
              // should read `propertyDefinitions.slots[].preferredInstances[]` instead.
              componentProperties: null,
              subCompVariantAxes,
              classification: 'decorative',
              classificationReason: '',
              classificationEvidence: [],
              origin: 'slot-preferred',
              slotName,
              placementCount: 1,
              placementIndices: [],
              placementsVary: false,
            };
            classifyInstance(entry);
            children.push(entry);
          }

          // Slot default children: INSTANCEs actually placed inside the SLOT node in the
          // default variant. These often differ from preferredValues — e.g. a slot declares
          // "Button" as preferred but holds a "Text Button" instance by default.
          const slotNode = slotNodeByName.get(slotName);
          const slotChildren: any[] = slotNode && Array.isArray(slotNode.children) ? slotNode.children : [];
          for (let j = 0; j < slotChildren.length; j++) {
            const c: any = slotChildren[j];
            if (c.type !== 'INSTANCE') continue;
            let compName: string | null = null;
            let parentSetName: string | null = null;
            let subCompSetId: string | null = null;
            const subCompVariantAxes: Record<string, string[]> = {};
            const booleanOverrides: Record<string, boolean> = {};
            try {
              const mc = await (c as InstanceNode).getMainComponentAsync();
              if (mc) {
                compName = mc.name;
                const parentSet = mc.parent && mc.parent.type === 'COMPONENT_SET' ? mc.parent : null;
                parentSetName = parentSet ? parentSet.name : mc.name;
                subCompSetId = parentSet ? parentSet.id : mc.id;
                if (parentSet && (parentSet as ComponentSetNode).variantGroupProperties) {
                  for (const [k, v] of Object.entries(
                    (parentSet as ComponentSetNode).variantGroupProperties!
                  )) {
                    subCompVariantAxes[k] = (v as any).values;
                  }
                }
              }
              const ip = (c as InstanceNode).componentProperties;
              for (const [k, vRaw] of Object.entries(ip || {})) {
                const v: any = vRaw;
                if (v.type === 'BOOLEAN') booleanOverrides[k] = v.value;
              }
            } catch {}

            // Prefer the default-child entry when it collides with a preferred-value entry
            // for the same main component — the default child carries richer data.
            const dedupKey = subCompSetId || c.id;
            if (seenMainIds.has(dedupKey)) {
              const existingIdx = children.findIndex(
                (e) => e.origin === 'slot-preferred' && e.slotName === slotName &&
                  (e.subCompSetId || '') === (subCompSetId || '')
              );
              if (existingIdx >= 0) children.splice(existingIdx, 1);
            }
            seenMainIds.add(dedupKey);

            const entry: PreviewChild = {
              name: c.name,
              nodeType: 'INSTANCE',
              mainComponentName: compName,
              parentSetName,
              subCompSetId,
              topLevelInstanceId: `slot:${slotName}:child:${j}:${c.id}`,
              booleanOverrides,
              // Snapshot the placed instance's full typed property surface (booleans,
              // instance-swaps, text, variant choices). The downstream renderer's
              // referenced-component override table reads this exclusively.
              componentProperties: snapshotComponentProperties(c),
              subCompVariantAxes,
              classification: 'decorative',
              classificationReason: '',
              classificationEvidence: [],
              origin: 'slot-default-child',
              slotName,
              placementCount: 1,
              placementIndices: [],
              placementsVary: false,
            };
            classifyInstance(entry);
            children.push(entry);
          }
        }
      }
    } catch {
      // Slot enumeration is best-effort; if anything throws we simply skip the slot
      // section and keep the top-level checklist functional.
    }

    const variantCount = isCS ? (target as ComponentSetNode).children.length : 1;

    const preview: Preview = {
      componentName: target.name,
      nodeId: target.id,
      isComponentSet: isCS,
      defaultVariantName: defaultVariant.name,
      variantCount,
      children,
      savedFileLink: figma.root.getPluginData(FILE_LINK_PLUGIN_DATA_KEY) || null,
    };
    figma.ui.postMessage({ type: 'ready', preview });
  } catch (err) {
    figma.ui.postMessage({
      type: 'invalid-selection',
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

async function extract(
  classifications: UserClassification[],
  optionalContext: string | null,
  fileLink: string | null
): Promise<void> {
  const target = getSelectedTarget();
  if (!target) {
    figma.ui.postMessage({ type: 'extract-error', message: 'Selection changed. Pick a component.' });
    return;
  }

  // Resolve the file key: a public plugin can't read figma.fileKey, so the user's
  // pasted link is the authoritative source. Remember it on the document for next time.
  const linkKey = parseFigmaFileKey(fileLink);
  if (linkKey && fileLink) {
    figma.root.setPluginData(FILE_LINK_PLUGIN_DATA_KEY, fileLink);
  }
  const resolvedFileKey = linkKey || figma.fileKey || 'unknown-file';

  const warnings: string[] = [];

  try {
    figma.ui.postMessage({ type: 'progress', phase: 'A', detail: 'Reading property definitions…' });
    const phaseA = await runPhaseA(target.id);

    figma.ui.postMessage({ type: 'progress', phase: 'B', detail: 'Reading variables…' });
    const phaseB = await runPhaseB();

    // Phase E: walk every variant.
    const isCS = target.type === 'COMPONENT_SET';
    const allVariants: any[] = isCS
      ? [...(target as ComponentSetNode).children]
      : [target];

    const variants: any[] = [];
    const styleIdSet = new Set<string>();
    const inlineSamples: Record<string, any> = {};
    const variableIdSet = new Set<string>();

    for (let i = 0; i < allVariants.length; i++) {
      const v = allVariants[i];
      figma.ui.postMessage({
        type: 'progress',
        phase: 'E',
        detail: `Walking variant ${i + 1}/${allVariants.length} (${v.name})…`,
      });
      const result = await runPhaseE(v.id);
      variants.push({
        id: result.id,
        name: result.name,
        variantProperties: result.variantProperties,
        dimensions: result.dimensions,
        treeHierarchical: result.treeHierarchical,
        treeFlat: result.treeFlat,
        colorWalk: result.colorWalk,
        layoutTree: result.layoutTree,
        strokeSemantics: result.strokeSemantics,
      });
      if (result._selfCheck.missingChildren.length > 0) {
        warnings.push(
          `HIERWALK_MISSING_CHILDREN on variant "${result.name}": ${result._selfCheck.missingChildren
            .map((m) => m.name)
            .join(', ')}`
        );
      }
      collectStyleIds(result.treeHierarchical, styleIdSet);
      for (const entry of result.colorWalk) {
        if (typeof entry.styleId === 'string' && entry.styleId) styleIdSet.add(entry.styleId);
      }
      for (const [k, v2] of Object.entries(result.styleIdInlineSamples)) {
        if (!inlineSamples[k]) inlineSamples[k] = v2;
      }
      for (const vid of result.referencedVariableIds) variableIdSet.add(vid);
    }

    figma.ui.postMessage({ type: 'progress', phase: 'C', detail: 'Resolving styles…' });
    const phaseC = await runPhaseC(Array.from(styleIdSet), inlineSamples);

    figma.ui.postMessage({ type: 'progress', phase: 'D', detail: 'Resolving variables…' });
    const phaseD = await runPhaseD(phaseB, Array.from(variableIdSet));

    figma.ui.postMessage({
      type: 'progress',
      phase: 'F',
      detail: 'Cross-variant diffs…',
    });
    const booleanDefsKeys = phaseA.propertyDefinitions.booleans.map((b) => b.rawKey);
    const phaseF = await runPhaseF(target.id, booleanDefsKeys);

    figma.ui.postMessage({
      type: 'progress',
      phase: 'G',
      detail: 'Revealed trees + slot swaps…',
    });
    const slotPrefList: Array<{ slotName: string; componentId: string }> = [];
    for (const slot of phaseA.propertyDefinitions.slots) {
      for (const pref of slot.preferredInstances) {
        slotPrefList.push({ slotName: slot.name, componentId: pref.componentKey });
      }
    }
    const phaseG = await runPhaseG(target.id, booleanDefsKeys, slotPrefList);
    if (phaseG) {
      for (const variant of variants) {
        const rev = phaseG.revealedByVariantName[variant.name];
        if (rev) variant.revealedTree = rev;
        const revCW = phaseG.revealedColorWalkByVariantName[variant.name];
        if (revCW) variant.revealedColorWalk = revCW;
        variant.revealedTreeRepresentative =
          phaseG.structuralRepresentativeByVariantName[variant.name] || variant.name;
      }
    }

    figma.ui.postMessage({ type: 'progress', phase: 'H', detail: 'Ownership hints…' });
    const phaseH = await runPhaseH(target.id);

    figma.ui.postMessage({ type: 'progress', phase: 'Fp', detail: 'Child composition…' });
    const firstGuess = buildFirstGuess(
      phaseA.component.componentName,
      variants as any,
      phaseA.defaultVariant.id,
      phaseA.propertyDefinitions
    );

    // Apply user-selected classifications. Top-level classifications overwrite the first
    // guess's entries; slot-origin classifications have no counterpart in buildFirstGuess
    // (which only scans top-level children) so we append them as new entries carrying the
    // `origin` + `slotName` metadata the preview captured.
    const userMap = new Map<string, UserClassification>();
    for (const c of classifications) {
      if (c.topLevelInstanceId) userMap.set(c.topLevelInstanceId, c);
    }
    const mergedChildren = [...firstGuess.children, ...firstGuess.ambiguousChildren].map((c) => {
      if (c.topLevelInstanceId && userMap.has(c.topLevelInstanceId)) {
        const uc = userMap.get(c.topLevelInstanceId)!;
        return {
          ...c,
          classification: uc.classification,
          classificationReason: 'Set by designer in the uSpec Extract plugin.',
          classificationEvidence: ['user-selected'],
        };
      }
      return c;
    });

    // Build a quick lookup of slot-preferred metadata keyed by componentKey so the
    // slot-origin entries we inject into `_childComposition.children[]` can inherit
    // the rich property summary Phase A just captured (variant axes, boolean defaults,
    // etc.). Without this, downstream readers of `_childComposition` would have to
    // cross-reference `propertyDefinitions.slots[].preferredInstances[]` for every
    // slot-preferred child.
    const prefByKey = new Map<string, any>();
    for (const slot of phaseA.propertyDefinitions.slots) {
      for (const pref of slot.preferredInstances) {
        prefByKey.set(pref.componentKey, pref);
      }
    }
    // `topLevelInstanceId` for slot-preferred entries has the shape `slot:<slotName>:pref:<key>`.
    const extractPrefKey = (id: string | null): string | null => {
      if (!id) return null;
      const m = id.match(/^slot:.+:pref:(.+)$/);
      return m ? m[1] : null;
    };

    const topLevelIds = new Set(mergedChildren.map((c) => c.topLevelInstanceId).filter(Boolean));
    for (const uc of classifications) {
      if (uc.origin === 'top-level') continue;
      if (uc.topLevelInstanceId && topLevelIds.has(uc.topLevelInstanceId)) continue;
      const prefKey = extractPrefKey(uc.topLevelInstanceId);
      const pref = prefKey ? prefByKey.get(prefKey) : null;
      // Derive booleanOverrides from the round-tripped componentProperties snapshot when
      // present (slot-default-child entries carry one; slot-preferred entries don't).
      // Keeps the legacy field correct without re-reading the Figma node.
      const derivedBooleans: Record<string, boolean> = {};
      if (uc.componentProperties) {
        for (const [k, vRaw] of Object.entries(uc.componentProperties)) {
          if (vRaw && (vRaw as any).type === 'BOOLEAN') {
            derivedBooleans[k] = Boolean((vRaw as any).value);
          }
        }
      }
      mergedChildren.push({
        name: uc.name,
        mainComponentName: uc.mainComponentName,
        parentSetName: uc.parentSetName || (pref && pref.componentSetName) || null,
        subCompSetId: uc.subCompSetId || (pref && pref.componentSetId) || null,
        topLevelInstanceId: uc.topLevelInstanceId,
        nodeType: uc.nodeType,
        // Booleans projected from the typed snapshot so the legacy field still reflects
        // reality. Empty for slot-preferred (no placed instance).
        booleanOverrides: derivedBooleans,
        // The typed snapshot itself — single source of truth for the renderer's
        // referenced-component override table. `null` for slot-preferred entries.
        componentProperties: uc.componentProperties || null,
        // `subCompVariantAxes` describes the sub-component itself ("what axes does it
        // expose"), which is meaningful whether or not the component is placed. Mirror
        // from Phase A so Phase I will walk this child's variant cross-product when the
        // designer marks it constitutive.
        subCompVariantAxes: pref && pref.variantAxes ? { ...pref.variantAxes } : {},
        classification: uc.classification,
        classificationReason: 'Set by designer in the uSpec Extract plugin.',
        classificationEvidence: ['user-selected'],
        origin: uc.origin,
        slotName: uc.slotName,
        // Slot-origin entries don't dedup across direct-child placements; they're already
        // de-dup'd per-slot by `seenMainIds` in sendPreview. Keep the placement* fields
        // populated with neutral defaults so downstream consumers can read them uniformly.
        placementCount: 1,
        placementIndices: [],
        placementsVary: false,
        presentInVariants: [],
        defaultVariantPresent: false,
        placementsByVariant: {},
      });
    }

    const childComposition = {
      children: mergedChildren.filter((c) => c.classification !== null),
      ambiguousChildren: [] as any[], // cleared — user resolves everything up front
      guessConfidence: 'high' as const,
    };

    figma.ui.postMessage({
      type: 'progress',
      phase: 'I',
      detail: 'Sub-component variant walks…',
    });
    const phaseI = await runPhaseI(childComposition as any);
    for (const w of phaseI.warnings) warnings.push(w);

    // Filter raw-hex colorWalk entries that live INSIDE any crossed INSTANCE boundary
    // (i.e. entries where `subComponentName` is set, meaning the walker recursed into a
    // nested component). Such entries describe artwork owned by the child component
    // (e.g. the red stripes of a flag illustration) and never inform the parent's spec.
    // Tokened entries (styleId or boundVariableId) survive — they reveal "this nested
    // child adapts to token X", which the parent still cares about.
    //
    // NOTE: this rule is independent of the top-level constitutive/referenced
    // classifications because noise-generating illustrations often live deep in the
    // tree (e.g. input > leadingContent > flags > Flags), not at the top level.
    const isRawHexInsideInstance = (e: any): boolean => {
      if (!e || typeof e !== 'object') return false;
      if (!e.subComponentName) return false;
      const hasStyle = typeof e.styleId === 'string' && e.styleId;
      const hasVar = typeof e.boundVariableId === 'string' && e.boundVariableId;
      return !hasStyle && !hasVar;
    };
    let droppedTotal = 0;
    const droppedBySub: Record<string, number> = {};
    for (const variant of variants) {
      for (const arrName of ['colorWalk', 'revealedColorWalk'] as const) {
        const arr = variant[arrName];
        if (!Array.isArray(arr)) continue;
        const kept: any[] = [];
        for (const e of arr) {
          if (isRawHexInsideInstance(e)) {
            droppedTotal += 1;
            const key = e.subComponentName || '(unknown)';
            droppedBySub[key] = (droppedBySub[key] || 0) + 1;
          } else {
            kept.push(e);
          }
        }
        variant[arrName] = kept;
      }
    }
    if (droppedTotal > 0) {
      const bySubStr = Object.entries(droppedBySub)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${k}: ${n}`)
        .join(', ');
      warnings.push(
        `Dropped ${droppedTotal} raw-hex colorWalk entries that lived inside crossed INSTANCE boundaries (${bySubStr}). Tokened entries were preserved.`
      );
    }

    // Post-walk validation: every constitutive top-level INSTANCE placement must have a
    // populated walked subtree in the exact variant where it appears.
    const treeIndexes = new Map<string, Map<string, any>>();
    const indexTree = (node: any, index: Map<string, any>): void => {
      if (!node || typeof node !== 'object') return;
      if (typeof node.id === 'string') index.set(node.id, node);
      if (Array.isArray(node.children)) {
        for (const child of node.children) indexTree(child, index);
      }
    };
    for (const variant of variants) {
      const index = new Map<string, any>();
      indexTree(variant.treeHierarchical, index);
      treeIndexes.set(variant.id, index);
    }
    const missingConstitutiveChildren = childComposition.children
      .filter(
        (child) =>
          child.classification === 'constitutive' &&
          child.nodeType === 'INSTANCE' &&
          (child.origin === 'top-level' || !child.origin)
      )
      .flatMap((child) =>
        Object.entries(child.placementsByVariant || {}).flatMap(([, placement]: [string, any]) =>
          placement.nodeIds
            .map((nodeId: string) => treeIndexes.get(placement.variantId)?.get(nodeId))
            .filter(
              (entry: any) =>
                !entry || !Array.isArray(entry.children) || entry.children.length === 0
            )
            .map(() => child)
        )
      );
    if (missingConstitutiveChildren.length > 0) {
      warnings.push(
        `Walked tree is missing children for constitutive instance(s): ${missingConstitutiveChildren
          .map((c) => c.name)
          .join(', ')}`
      );
    }

    const componentSlug = slugify(phaseA.component.componentName);
    const meta: BaseJsonMeta = {
      schemaVersion: '1',
      extractedAt: new Date().toISOString(),
      fileKey: resolvedFileKey,
      nodeId: target.id,
      componentSlug,
      optionalContext: sanitizeText(optionalContext) || null,
      figmaUrl:
        resolvedFileKey !== 'unknown-file'
          ? buildFigmaUrl(resolvedFileKey, figma.root.name, target.id)
          : null,
      extractionSource: 'plugin',
      pluginVersion: PLUGIN_VERSION,
    };

    const baseJson: any = {
      _meta: meta,
      component: phaseA.component,
      variantAxes: phaseA.variantAxes,
      defaultVariant: phaseA.defaultVariant,
      propertyDefinitions: phaseA.propertyDefinitions,
      variables: {
        localCollections: phaseB.localCollections,
        remoteCollections: phaseD.remoteCollections,
        resolvedVariables: { ...phaseB.resolvedVariables, ...phaseD.resolvedVariables },
      },
      styles: phaseC,
      variants,
      crossVariant: phaseF || null,
      slotHostGeometry: phaseG ? phaseG.slotHostGeometry : null,
      ownershipHints: phaseH ? phaseH.ownershipHints : [],
      subComponentVariantWalks: phaseI.walks,
      _childComposition: childComposition,
      _extractionNotes: {
        warnings,
        mutationsPerformed: [
          ...(phaseF ? phaseF.mutationsPerformed : []),
          ...(phaseG ? phaseG.mutationsPerformed : []),
        ],
      },
    };

    figma.ui.postMessage({
      type: 'extract-done',
      baseJson,
      filename: `${componentSlug}-_base.json`,
      warnings,
    });
  } catch (err) {
    figma.ui.postMessage({
      type: 'extract-error',
      message: err instanceof Error ? err.message + '\n' + (err.stack || '') : String(err),
    });
  }
}

function collectStyleIds(entry: any, out: Set<string>): void {
  if (!entry || typeof entry !== 'object') return;
  if (entry.typography && typeof entry.typography.styleId === 'string') {
    out.add(entry.typography.styleId);
  }
  if (Array.isArray(entry.children)) {
    for (const c of entry.children) collectStyleIds(c, out);
  }
}
