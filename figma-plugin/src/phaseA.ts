// Phase A — meta + axes + property definitions.

import { sg } from './safe';
import { resolvePreferredComponent } from './resolveKey';

export type PhaseAResult = {
  component: { componentName: string; compSetNodeId: string; isComponentSet: boolean };
  variantAxes: Array<{ name: string; options: string[]; defaultValue: string }>;
  defaultVariant: { id: string; name: string; variantProperties: Record<string, string> };
  propertyDefinitions: {
    rawDefs: Record<string, any>;
    booleans: Array<{
      name: string;
      rawKey: string;
      defaultValue: boolean;
      associatedLayerId: string | null;
      associatedLayerName: string | null;
    }>;
    instanceSwaps: Array<{
      name: string;
      rawKey: string;
      defaultValue: string | null;
      defaultComponentName: string | null;
    }>;
    slots: Array<{
      name: string;
      rawKey: string;
      description: string;
      preferredInstances: Array<{
        componentKey: string;
        componentName: string;
        componentSetId?: string;
        componentSetName?: string;
        isComponentSet?: boolean;
        variantAxes?: Record<string, string[]>;
        defaultVariantProperties?: Record<string, string>;
        booleanDefaults?: Record<string, boolean>;
        slotProps?: string[];
        instanceSwapDefaults?: Record<string, string>;
        textDefaults?: Record<string, string>;
      }>;
      defaultChildren: Array<{
        name: string;
        nodeType: string;
        visible: boolean;
        mainComponentId?: string;
        mainComponentKey?: string;
        mainComponentName?: string;
        componentSetName?: string;
        componentSetId?: string | null;
        isComponentSet?: boolean;
        contextualOverrides?: Record<string, any>;
      }>;
      defaultChildMainIds: string[];
      visibleRawKey?: string;
      visiblePropName?: string;
    }>;
  };
};

export async function runPhaseA(nodeId: string): Promise<PhaseAResult> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node || (node.type !== 'COMPONENT_SET' && node.type !== 'COMPONENT')) {
    throw new Error(
      'Node is not a component set or component. Type: ' + (node ? node.type : 'null')
    );
  }

  // Ensure the node's page is the current page before traversing descendants.
  let _p: any = node;
  while (_p.parent && _p.parent.type !== 'PAGE') _p = _p.parent;
  if (_p.parent && _p.parent.type === 'PAGE') {
    try {
      await figma.setCurrentPageAsync(_p.parent);
    } catch {}
  }

  const isComponentSet = node.type === 'COMPONENT_SET';
  const defaultVariant: any = isComponentSet
    ? ((node as ComponentSetNode).defaultVariant || (node as ComponentSetNode).children[0])
    : node;

  const variantAxes: PhaseAResult['variantAxes'] = [];
  if (isComponentSet && (node as ComponentSetNode).variantGroupProperties) {
    for (const [axisName, val] of Object.entries(
      (node as ComponentSetNode).variantGroupProperties!
    )) {
      variantAxes.push({
        name: axisName,
        options: (val as any).values,
        defaultValue:
          (defaultVariant.variantProperties || {})[axisName] || (val as any).values[0],
      });
    }
  }

  const propDefs = (node as ComponentNode | ComponentSetNode).componentPropertyDefinitions || {};
  const rawDefs: Record<string, any> = {};
  const booleans: PhaseAResult['propertyDefinitions']['booleans'] = [];
  const instanceSwaps: PhaseAResult['propertyDefinitions']['instanceSwaps'] = [];
  const slots: PhaseAResult['propertyDefinitions']['slots'] = [];

  for (const [rawKey, defRaw] of Object.entries(propDefs)) {
    const def: any = defRaw;
    rawDefs[rawKey] = {
      type: def.type,
      defaultValue: def.defaultValue,
      variantOptions: def.variantOptions || null,
      description: def.description || null,
    };
    const cleanKey = rawKey.split('#')[0];
    if (def.type === 'BOOLEAN') {
      let associatedLayerId: string | null = null;
      let associatedLayerName: string | null = null;
      const props = defaultVariant.componentProperties;
      if (props) {
        for (const [k, vRaw] of Object.entries(props)) {
          const v: any = vRaw;
          if (k.split('#')[0] === cleanKey && v.type === 'BOOLEAN') {
            const nId = k.split('#')[1];
            if (nId) {
              try {
                const compoundId = defaultVariant.id.split(';')[0] + ';' + nId;
                const layerNode = await figma.getNodeByIdAsync(compoundId);
                if (layerNode) {
                  associatedLayerId = compoundId;
                  associatedLayerName = (layerNode as any).name;
                }
              } catch {}
            }
          }
        }
      }
      booleans.push({
        name: cleanKey,
        rawKey,
        defaultValue: def.defaultValue,
        associatedLayerId,
        associatedLayerName,
      });
    } else if (def.type === 'INSTANCE_SWAP') {
      let defaultComponentName: string | null = null;
      if (def.defaultValue) {
        try {
          const t = await figma.getNodeByIdAsync(def.defaultValue);
          if (t) defaultComponentName = (t as any).name;
        } catch {}
      }
      instanceSwaps.push({
        name: cleanKey,
        rawKey,
        defaultValue: def.defaultValue,
        defaultComponentName,
      });
    } else if (def.type === 'SLOT') {
      const preferredInstances: any[] = [];
      const defaultChildMainIds: string[] = [];
      if (def.preferredValues && def.preferredValues.length > 0) {
        for (const pv of def.preferredValues) {
          if (pv.type !== 'COMPONENT' && pv.type !== 'COMPONENT_SET') continue;
          // Shared 3-layer resolver: getNodeByIdAsync → importComponent(Set)ByKeyAsync
          // → document-wide findAll on `.key`.
          const comp = await resolvePreferredComponent(pv);
          const entry: any = {
            componentKey: pv.key,
            componentName: comp ? comp.name : pv.key,
          };
          if (!comp) {
            console.warn(
              `[uSpec Extract] preferredInstance: resolver returned null for key=${pv.key} (pv.type=${pv.type})`
            );
            preferredInstances.push(entry);
            continue;
          }

          // Resolve to the COMPONENT_SET where possible. `resolvePreferredComponent`
          // sometimes returns a single COMPONENT variant (e.g. `importComponentByKeyAsync`
          // selected the default variant), in which case we climb to `comp.parent` to
          // find the set so `variantGroupProperties` and consistent `componentPropertyDefinitions`
          // are reachable. Both COMPONENT and COMPONENT_SET expose
          // `componentPropertyDefinitions` — on a variant it returns the set's definitions —
          // but variant axes only live on the set.
          const setLike: any =
            comp.type === 'COMPONENT_SET'
              ? comp
              : comp.parent && comp.parent.type === 'COMPONENT_SET'
                ? comp.parent
                : null;
          // `componentSetId` / `componentSetName` hold the id+name of the true set
          // when one exists, otherwise they fall back to the plain COMPONENT's own
          // id+name. `isComponentSet` disambiguates the two cases so downstream
          // skills don't have to infer it from presence-of-`variantAxes`.
          if (setLike) {
            entry.componentSetId = setLike.id;
            entry.componentSetName = setLike.name;
            entry.isComponentSet = true;
          } else {
            entry.componentSetId = comp.id;
            entry.componentSetName = comp.name;
            entry.isComponentSet = false;
          }

          // Variant axes + default variant props. A single COMPONENT that isn't part of a
          // set has no axes — that's fine, we just omit the key.
          if (setLike && setLike.variantGroupProperties) {
            const variantAxes: Record<string, string[]> = {};
            for (const [axis, v] of Object.entries(setLike.variantGroupProperties)) {
              variantAxes[axis] = (v as any).values;
            }
            if (Object.keys(variantAxes).length > 0) entry.variantAxes = variantAxes;

            const dv: any = setLike.defaultVariant || setLike.children[0];
            if (dv && dv.variantProperties) {
              entry.defaultVariantProperties = { ...dv.variantProperties };
            }
          }

          // Property-definition summary. `componentPropertyDefinitions` is available on
          // both COMPONENT and COMPONENT_SET and returns the same shape, so we read from
          // the set when available (to match what instances will see).
          const pdefSource: any = setLike || comp;
          const compPropDefs = pdefSource.componentPropertyDefinitions;
          if (compPropDefs) {
            const booleanDefaults: Record<string, boolean> = {};
            const slotProps: string[] = [];
            const instanceSwapDefaults: Record<string, string> = {};
            const textDefaults: Record<string, string> = {};
            for (const [pk, pdefRaw] of Object.entries(compPropDefs)) {
              const pdef: any = pdefRaw;
              const cleanName = pk.split('#')[0];
              if (pdef.type === 'BOOLEAN') booleanDefaults[cleanName] = pdef.defaultValue;
              else if (pdef.type === 'SLOT') slotProps.push(cleanName);
              else if (pdef.type === 'INSTANCE_SWAP') instanceSwapDefaults[cleanName] = pdef.defaultValue;
              else if (pdef.type === 'TEXT') textDefaults[cleanName] = pdef.defaultValue;
              // VARIANT props are covered by variantAxes above.
            }
            if (Object.keys(booleanDefaults).length > 0) entry.booleanDefaults = booleanDefaults;
            if (slotProps.length > 0) entry.slotProps = slotProps;
            if (Object.keys(instanceSwapDefaults).length > 0)
              entry.instanceSwapDefaults = instanceSwapDefaults;
            if (Object.keys(textDefaults).length > 0) entry.textDefaults = textDefaults;
          }

          preferredInstances.push(entry);
        }
      }
      slots.push({
        name: cleanKey,
        rawKey,
        description: def.description || '',
        preferredInstances,
        defaultChildren: [],
        defaultChildMainIds,
      });
    }
  }

  if (slots.length > 0 && defaultVariant.findAll) {
    const slotNodes = defaultVariant.findAll((n: any) => n.type === 'SLOT');
    for (const slotNode of slotNodes) {
      const cpRefs = slotNode.componentPropertyReferences || {};
      const matchingSlot = slots.find((sp) => {
        const refKey = Object.values(cpRefs)[0] as string | undefined;
        if (refKey && refKey.split('#')[0] === sp.name) return true;
        return sp.name === slotNode.name;
      });
      if (matchingSlot) {
        const visibleRef = cpRefs.visible;
        if (visibleRef && typeof visibleRef === 'string') {
          matchingSlot.visibleRawKey = visibleRef;
          matchingSlot.visiblePropName = visibleRef.split('#')[0];
        }
      }
      if (matchingSlot && slotNode.children) {
        for (const child of slotNode.children) {
          const ci: any = { name: child.name, nodeType: child.type, visible: child.visible };
          if (child.type === 'INSTANCE') {
            try {
              const mc = await (child as InstanceNode).getMainComponentAsync();
              if (mc) {
                ci.mainComponentId = mc.id;
                ci.mainComponentKey = mc.key;
                ci.mainComponentName = mc.name;
                const isSet = mc.parent && mc.parent.type === 'COMPONENT_SET';
                ci.componentSetName = isSet ? mc.parent!.name : mc.name;
                ci.componentSetId = isSet ? mc.parent!.id : null;
                ci.isComponentSet = isSet;
                const ov: Record<string, any> = {};
                if ((child as InstanceNode).componentProperties) {
                  for (const [k, vRaw] of Object.entries(
                    (child as InstanceNode).componentProperties
                  )) {
                    ov[k.split('#')[0]] = (vRaw as any).value;
                  }
                }
                ci.contextualOverrides = ov;
                matchingSlot.defaultChildMainIds.push(mc.id);
              }
            } catch {}
          }
          matchingSlot.defaultChildren.push(ci);
        }
      }
    }
  }

  return {
    component: { componentName: node.name, compSetNodeId: nodeId, isComponentSet },
    variantAxes,
    defaultVariant: {
      id: defaultVariant.id,
      name: defaultVariant.name,
      variantProperties: { ...(defaultVariant.variantProperties || {}) },
    },
    propertyDefinitions: { rawDefs, booleans, instanceSwaps, slots },
  };
}
