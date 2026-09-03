// Phase H — ownership hints.

import { collectOwnedInstancePlacements } from './safe';

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
    sourceVariantIds?: string[];
    sourceVariantNames?: string[];
  }>;
};

export async function runPhaseH(nodeId: string): Promise<PhaseHResult | null> {
  const node: any = await figma.getNodeByIdAsync(nodeId);
  if (!node || (node.type !== 'COMPONENT_SET' && node.type !== 'COMPONENT')) return null;

  const isCS = node.type === 'COMPONENT_SET';
  const variants: any[] = isCS ? [...node.children] : [node];
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
      const layerNames = new Set<string>();
      for (const variant of variants) {
        if (variant.componentProperties) {
          for (const [k, vRaw] of Object.entries(variant.componentProperties)) {
            const v: any = vRaw;
            if (k.split('#')[0] === cleanKey && v.type === 'BOOLEAN') {
              const nId = k.split('#')[1];
              if (nId) {
                try {
                  const ln = await figma.getNodeByIdAsync(
                    variant.id.split(';')[0] + ';' + nId
                  );
                  if (ln) layerNames.add((ln as any).name);
                } catch {}
              }
            }
          }
        }
      }
      const layer = [...layerNames].join(' | ') || null;
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

  for (const variant of variants) {
    for (const { node: child } of collectOwnedInstancePlacements(variant)) {
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
            sourceVariantIds: [variant.id],
            sourceVariantNames: [variant.name],
          });
        }
      }
    }
  }

  for (const variant of variants) {
    const allTextNodes = variant.findAll
      ? variant.findAll((candidate: any) => candidate.type === 'TEXT')
      : [];
    for (const textNode of allTextNodes) {
      hints.push({
        propertyName: textNode.name,
        evidenceType: 'textNode',
        sourceNodeName: node.name,
        sourceLayerName: textNode.parent ? textNode.parent.name : null,
        suggestedExposure: 'child_or_parent',
        rationale: 'Observed as visible text in one or more variants.',
        textContent: textNode.characters,
        sourceVariantIds: [variant.id],
        sourceVariantNames: [variant.name],
      });
    }
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

  const deduped = new Map<string, PhaseHResult['ownershipHints'][number]>();
  for (const hint of hints) {
    const key = JSON.stringify([
      hint.propertyName,
      hint.evidenceType,
      hint.sourceNodeName,
      hint.sourceLayerName,
      hint.textContent,
      hint.collectionId,
    ]);
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, hint);
      continue;
    }
    existing.sourceVariantIds = [
      ...new Set([...(existing.sourceVariantIds || []), ...(hint.sourceVariantIds || [])]),
    ];
    existing.sourceVariantNames = [
      ...new Set([...(existing.sourceVariantNames || []), ...(hint.sourceVariantNames || [])]),
    ];
  }
  return { ownershipHints: [...deduped.values()] };
}
