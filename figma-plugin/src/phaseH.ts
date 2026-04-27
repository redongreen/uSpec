// Phase H — ownership hints.

export type PhaseHResult = {
  ownershipHints: Array<{
    propertyName: string;
    evidenceType: string;
    sourceNodeName: string;
    sourceLayerName: string | null;
    suggestedExposure: string;
    rationale: string;
    textContent?: string;
    collectionId?: string;
    modeNames?: string[];
  }>;
};

export async function runPhaseH(nodeId: string): Promise<PhaseHResult | null> {
  const node: any = await figma.getNodeByIdAsync(nodeId);
  if (!node || (node.type !== 'COMPONENT_SET' && node.type !== 'COMPONENT')) return null;

  const isCS = node.type === 'COMPONENT_SET';
  const defaultVariant: any = isCS ? node.defaultVariant || node.children[0] : node;
  const propDefs = node.componentPropertyDefinitions || {};

  const hints: PhaseHResult['ownershipHints'] = [];
  for (const [rawKey, defRaw] of Object.entries(propDefs)) {
    const def: any = defRaw;
    const cleanKey = rawKey.split('#')[0];
    if (def.type === 'VARIANT') {
      hints.push({
        propertyName: cleanKey,
        evidenceType: 'rootVariant',
        sourceNodeName: node.name,
        sourceLayerName: null,
        suggestedExposure: 'parent',
        rationale: 'Defined on the component set as a variant axis.',
      });
    } else if (def.type === 'BOOLEAN') {
      let layer: string | null = null;
      if (defaultVariant.componentProperties) {
        for (const [k, vRaw] of Object.entries(defaultVariant.componentProperties)) {
          const v: any = vRaw;
          if (k.split('#')[0] === cleanKey && v.type === 'BOOLEAN') {
            const nId = k.split('#')[1];
            if (nId) {
              try {
                const ln = await figma.getNodeByIdAsync(
                  defaultVariant.id.split(';')[0] + ';' + nId
                );
                if (ln) layer = (ln as any).name;
              } catch {}
            }
          }
        }
      }
      hints.push({
        propertyName: cleanKey,
        evidenceType: 'rootBoolean',
        sourceNodeName: node.name,
        sourceLayerName: layer,
        suggestedExposure: layer ? 'parent_or_child' : 'parent',
        rationale: layer
          ? 'Defined on the root component but associated with a specific layer or child.'
          : 'Defined directly on the root component.',
      });
    } else if (def.type === 'INSTANCE_SWAP') {
      hints.push({
        propertyName: cleanKey,
        evidenceType: 'rootInstanceSwap',
        sourceNodeName: node.name,
        sourceLayerName: null,
        suggestedExposure: 'parent',
        rationale: 'Defined on the root component as an instance swap.',
      });
    } else if (def.type === 'SLOT') {
      hints.push({
        propertyName: cleanKey,
        evidenceType: 'rootSlot',
        sourceNodeName: node.name,
        sourceLayerName: null,
        suggestedExposure: 'parent',
        rationale: 'Defined on the root component as a slot selector.',
      });
    }
  }

  if (defaultVariant.children) {
    for (const child of defaultVariant.children) {
      if (child.type === 'INSTANCE' && child.componentProperties) {
        let mc: any = null;
        try {
          mc = await child.getMainComponentAsync();
        } catch {}
        for (const [k] of Object.entries(child.componentProperties)) {
          hints.push({
            propertyName: k.split('#')[0],
            evidenceType: 'childOverride',
            sourceNodeName: mc ? mc.name : child.name,
            sourceLayerName: child.name,
            suggestedExposure: 'child_or_parent',
            rationale: 'Observed as a contextual override on a fixed child instance.',
          });
        }
      }
    }
  }

  const allTextNodes = defaultVariant.findAll
    ? defaultVariant.findAll((n: any) => n.type === 'TEXT')
    : [];
  for (const tn of allTextNodes) {
    hints.push({
      propertyName: tn.name,
      evidenceType: 'textNode',
      sourceNodeName: node.name,
      sourceLayerName: tn.parent ? tn.parent.name : null,
      suggestedExposure: 'child_or_parent',
      rationale: 'Observed as visible text in the default variant.',
      textContent: tn.characters,
    });
  }

  const componentWords = node.name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  for (const col of collections) {
    const nameLower = col.name.toLowerCase();
    const matchesName = componentWords.some((w: string) => w.length > 2 && nameLower.includes(w));
    const matchesGeneric =
      /(density|shape|size|spacing|radius|tone|color|state|variant|theme|mode)/i.test(col.name);
    if (!matchesName && !matchesGeneric) continue;
    if (col.modes.length <= 1) continue;
    hints.push({
      propertyName: col.name,
      evidenceType: 'variableMode',
      sourceNodeName: node.name,
      sourceLayerName: null,
      suggestedExposure: 'parent',
      rationale:
        'Relevant variable collection with multiple modes that may affect the component contract.',
      collectionId: col.id,
      modeNames: col.modes.map((m: any) => m.name),
    });
  }

  return { ownershipHints: hints };
}
