// Phase D — resolve every variable referenced anywhere in Phase E (local + library).
//
// Phase B already resolves LOCAL variable collections. Phase D picks up the slack for
// library-linked variables: each `boundVariableId` collected by the walker is passed to
// `figma.variables.getVariableByIdAsync`, which transparently crosses library boundaries
// in the plugin sandbox. Chains of VARIABLE_ALIAS references are resolved recursively so
// a semantic-token alias chain terminates at its primitive.
//
// Unknown collections (from libraries not already captured in Phase B) are fetched via
// `figma.variables.getVariableCollectionByIdAsync` and surfaced under `remoteCollections`.

import type { PhaseBResult } from './phaseB';

export type PhaseDResult = {
  remoteCollections: Array<{
    id: string;
    name: string;
    modes: Array<{ modeId: string; name: string }>;
    variableIds: string[];
    isFromLibrary?: true;
  }>;
  resolvedVariables: Record<
    string,
    {
      name: string;
      codeSyntax: string | null;
      collectionId: string;
      valuesByMode: Record<string, any>;
      resolvedType: string | null;
      isFromLibrary?: true;
      _unresolved?: true;
    }
  >;
};

export async function runPhaseD(
  phaseB: PhaseBResult,
  referencedVariableIds: string[]
): Promise<PhaseDResult> {
  const resolvedVariables: PhaseDResult['resolvedVariables'] = {};
  const remoteCollections: PhaseDResult['remoteCollections'] = [];

  const knownCollectionIds = new Set<string>(phaseB.localCollections.map((c) => c.id));
  const collectionCache: Record<
    string,
    { id: string; name: string; modes: Array<{ modeId: string; name: string }> } | null
  > = {};

  // Seed with the existing Phase B resolutions so we don't refetch locals.
  const resolvedIds = new Set<string>(Object.keys(phaseB.resolvedVariables));

  // Queue of IDs that still need resolution. Seeded from the walker's set; grows as
  // VARIABLE_ALIAS chains expose further targets.
  const queue: string[] = referencedVariableIds.slice();
  const queued = new Set<string>(queue);

  async function getCollection(colId: string) {
    if (colId in collectionCache) return collectionCache[colId];
    try {
      const c = await figma.variables.getVariableCollectionByIdAsync(colId);
      if (!c) {
        collectionCache[colId] = null;
        return null;
      }
      collectionCache[colId] = {
        id: c.id,
        name: c.name,
        modes: c.modes.map((m: any) => ({ modeId: m.modeId, name: m.name })),
      };
      return collectionCache[colId];
    } catch {
      collectionCache[colId] = null;
      return null;
    }
  }

  while (queue.length > 0) {
    const vid = queue.shift()!;
    if (resolvedIds.has(vid)) continue;
    resolvedIds.add(vid);

    let v: Variable | null = null;
    try {
      v = await figma.variables.getVariableByIdAsync(vid);
    } catch {
      v = null;
    }
    if (!v) {
      resolvedVariables[vid] = {
        name: vid,
        codeSyntax: null,
        collectionId: '',
        valuesByMode: {},
        resolvedType: null,
        _unresolved: true,
      };
      continue;
    }

    const colId = v.variableCollectionId;
    const col = await getCollection(colId);
    const valuesByMode: Record<string, any> = {};
    const rawValuesByMode = (v as any).valuesByMode || {};

    if (col) {
      for (const mode of col.modes) {
        const raw = rawValuesByMode[mode.modeId];
        if (raw === undefined) continue;
        valuesByMode[mode.name] = await formatValue(raw, queue, queued, resolvedIds);
      }
    } else {
      // No collection metadata: fall back to modeId-keyed values so nothing is lost.
      for (const [modeId, raw] of Object.entries(rawValuesByMode)) {
        valuesByMode[modeId] = await formatValue(raw, queue, queued, resolvedIds);
      }
    }

    const entry: PhaseDResult['resolvedVariables'][string] = {
      name: v.name,
      codeSyntax: (v as any).codeSyntax?.WEB || null,
      collectionId: colId,
      valuesByMode,
      resolvedType: (v as any).resolvedType || null,
    };

    // Tag as library-sourced when the variable's collection wasn't in Phase B's locals.
    if (!knownCollectionIds.has(colId)) {
      entry.isFromLibrary = true;
      if (col && !remoteCollections.find((rc) => rc.id === colId)) {
        remoteCollections.push({
          id: col.id,
          name: col.name,
          modes: col.modes,
          variableIds: [],
          isFromLibrary: true,
        });
      }
    }

    resolvedVariables[vid] = entry;
  }

  // Populate variableIds on every remoteCollection we surfaced.
  for (const rc of remoteCollections) {
    for (const [vid, entry] of Object.entries(resolvedVariables)) {
      if (entry.collectionId === rc.id) rc.variableIds.push(vid);
    }
  }

  return { remoteCollections, resolvedVariables };
}

async function formatValue(
  raw: any,
  queue: string[],
  queued: Set<string>,
  resolvedIds: Set<string>
): Promise<any> {
  if (raw && typeof raw === 'object' && raw.type === 'VARIABLE_ALIAS') {
    const targetId: string = raw.id;
    if (!resolvedIds.has(targetId) && !queued.has(targetId)) {
      queue.push(targetId);
      queued.add(targetId);
    }
    let targetName = targetId;
    try {
      const aliased = await figma.variables.getVariableByIdAsync(targetId);
      if (aliased) targetName = (aliased as any).codeSyntax?.WEB || aliased.name;
    } catch {}
    return { kind: 'alias', targetName, targetId };
  }
  if (raw && typeof raw === 'object' && 'r' in raw) {
    return { kind: 'color', r: raw.r, g: raw.g, b: raw.b, a: raw.a };
  }
  return {
    kind: typeof raw === 'number' ? 'number' : typeof raw,
    value: raw,
  };
}
