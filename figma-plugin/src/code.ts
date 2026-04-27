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
import { slugify, sg } from './safe';
import { resolvePreferredComponent } from './resolveKey';

const PLUGIN_VERSION = '2.0.0';

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
    await extract(msg.classifications, msg.optionalContext);
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

    const children: PreviewChild[] = [];
    const kids = sg(defaultVariant, 'children');
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
          subCompVariantAxes: {},
          classification: 'decorative',
          classificationReason: '',
          classificationEvidence: [],
          origin: 'top-level',
          slotName: null,
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
        children.push(entry);
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

        // Pre-locate SLOT nodes inside the default variant and match them to their property
        // name via `componentPropertyReferences` (same logic as phaseA.ts).
        const slotNodes: any[] =
          typeof defaultVariant.findAll === 'function'
            ? defaultVariant.findAll((n: any) => n.type === 'SLOT')
            : [];
        const slotNodeByName = new Map<string, any>();
        for (const sn of slotNodes) {
          const cpRefs = sn.componentPropertyReferences || {};
          const refKey = Object.values(cpRefs)[0] as string | undefined;
          const key = refKey ? refKey.split('#')[0] : sn.name;
          if (!slotNodeByName.has(key)) slotNodeByName.set(key, sn);
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
              subCompVariantAxes,
              classification: 'decorative',
              classificationReason: '',
              classificationEvidence: [],
              origin: 'slot-preferred',
              slotName,
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
              subCompVariantAxes,
              classification: 'decorative',
              classificationReason: '',
              classificationEvidence: [],
              origin: 'slot-default-child',
              slotName,
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
  optionalContext: string | null
): Promise<void> {
  const target = getSelectedTarget();
  if (!target) {
    figma.ui.postMessage({ type: 'extract-error', message: 'Selection changed. Pick a component.' });
    return;
  }

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
      }
    }

    figma.ui.postMessage({ type: 'progress', phase: 'H', detail: 'Ownership hints…' });
    const phaseH = await runPhaseH(target.id);

    figma.ui.postMessage({ type: 'progress', phase: 'Fp', detail: 'Child composition…' });
    const defaultVariantResult = variants.find(
      (v) => v.id === phaseA.defaultVariant.id
    ) || variants[0];
    const firstGuess = buildFirstGuess(
      phaseA.component.componentName,
      defaultVariantResult as any,
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
      mergedChildren.push({
        name: uc.name,
        mainComponentName: uc.mainComponentName,
        parentSetName: uc.parentSetName || (pref && pref.componentSetName) || null,
        subCompSetId: uc.subCompSetId || (pref && pref.componentSetId) || null,
        topLevelInstanceId: uc.topLevelInstanceId,
        nodeType: uc.nodeType,
        // `booleanOverrides` is instance-scoped (overrides applied in the parent's default
        // variant). Slot-preferred entries describe a referenced component, not a placed
        // instance, so overrides don't apply here — consumers that need the referenced
        // component's default boolean values should read `propertyDefinitions.slots[].
        // preferredInstances[].booleanDefaults`.
        booleanOverrides: {},
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

    // Post-walk validation: every constitutive top-level INSTANCE must have a non-empty
    // `children` array in the default variant's treeHierarchical. Surface any miss as a
    // warning. Slot-origin entries are skipped — their `topLevelInstanceId` uses a
    // `slot:...` scheme and they don't appear as direct children of the variant tree.
    const missingConstitutiveChildren = childComposition.children
      .filter(
        (c) =>
          c.classification === 'constitutive' &&
          c.nodeType === 'INSTANCE' &&
          (c.origin === 'top-level' || !c.origin) &&
          (c.topLevelInstanceId || '').startsWith('idx:')
      )
      .filter((c) => {
        const idx = Number((c.topLevelInstanceId || '').replace('idx:', ''));
        const entry = defaultVariantResult.treeHierarchical?.children?.[idx];
        return !entry || !Array.isArray(entry.children) || entry.children.length === 0;
      });
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
      fileKey: figma.fileKey || 'unknown-file',
      nodeId: target.id,
      componentSlug,
      optionalContext: optionalContext || null,
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
