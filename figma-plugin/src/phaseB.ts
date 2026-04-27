// Phase B — variables + resolved values.

export type PhaseBResult = {
  localCollections: Array<{
    id: string;
    name: string;
    modes: Array<{ modeId: string; name: string }>;
    variableIds: string[];
  }>;
  resolvedVariables: Record<
    string,
    {
      name: string;
      codeSyntax: string | null;
      collectionId: string;
      valuesByMode: Record<string, any>;
      resolvedType: string | null;
    }
  >;
};

export async function runPhaseB(): Promise<PhaseBResult> {
  const allCollections = await figma.variables.getLocalVariableCollectionsAsync();
  const localCollections: PhaseBResult['localCollections'] = [];
  const resolvedVariables: PhaseBResult['resolvedVariables'] = {};

  for (const col of allCollections) {
    const varIds = col.variableIds || [];
    localCollections.push({
      id: col.id,
      name: col.name,
      modes: col.modes.map((m: any) => ({ modeId: m.modeId, name: m.name })),
      variableIds: [...varIds],
    });
    for (const vid of varIds) {
      try {
        const v = await figma.variables.getVariableByIdAsync(vid);
        if (!v) continue;
        const valuesByMode: Record<string, any> = {};
        for (const mode of col.modes) {
          const raw = (v as any).valuesByMode[mode.modeId];
          if (raw === undefined) continue;
          if (raw && typeof raw === 'object' && raw.type === 'VARIABLE_ALIAS') {
            try {
              const aliased = await figma.variables.getVariableByIdAsync(raw.id);
              valuesByMode[mode.name] = {
                kind: 'alias',
                targetName: aliased ? (aliased as any).codeSyntax?.WEB || aliased.name : raw.id,
                targetId: raw.id,
              };
            } catch {
              valuesByMode[mode.name] = { kind: 'alias', targetId: raw.id };
            }
          } else if (raw && typeof raw === 'object' && 'r' in raw) {
            valuesByMode[mode.name] = { kind: 'color', r: raw.r, g: raw.g, b: raw.b, a: raw.a };
          } else {
            valuesByMode[mode.name] = {
              kind: typeof raw === 'number' ? 'number' : typeof raw,
              value: raw,
            };
          }
        }
        resolvedVariables[vid] = {
          name: v.name,
          codeSyntax: (v as any).codeSyntax?.WEB || null,
          collectionId: v.variableCollectionId,
          valuesByMode,
          resolvedType: (v as any).resolvedType || null,
        };
      } catch {}
    }
  }

  return { localCollections, resolvedVariables };
}
