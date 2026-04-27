// Shared publish-key resolver. Used by both `sendPreview` (code.ts) and Phase A
// (phaseA.ts) so the UI checklist and the `_base.json.propertyDefinitions.slots[].
// preferredInstances[]` entries resolve the same way.
//
// Resolution layers, cheapest first, with a critical correctness-over-speed tweak:
//   1. `figma.getNodeByIdAsync(key)` — trivial fast path for the rare case when a
//      publish key happens to collide with a local node id.
//   2. Document-wide index keyed by `.key` — returns the *local* node when the
//      preferred value's component lives in this file. Preferred over the library
//      import (step 3) because locally-indexed nodes retain their `.parent`, which
//      lets callers climb a variant COMPONENT to its COMPONENT_SET to read
//      `variantGroupProperties`. Library-imported nodes are detached (`parent`
//      returns null), so if we resolved via step 3 first we'd silently drop the
//      variant-axes + defaults summary for every locally-published component.
//      The index is built once per session via `loadAllPagesAsync` + findAll.
//   3. `figma.importComponent(Set)ByKeyAsync(key)` — Figma's library resolver.
//      Only reached for components that don't live locally.
//
// All calls are wrapped in try/catch; failures are surfaced via `console.warn` with a
// `[uSpec Extract]` prefix so the plugin console surfaces diagnostics when a key truly
// cannot be resolved.

const keyResolveCache = new Map<string, any | null>();
let docKeyIndex: Map<string, any> | null = null;

async function buildDocKeyIndex(): Promise<Map<string, any>> {
  if (docKeyIndex) return docKeyIndex;
  const idx = new Map<string, any>();
  try {
    await (figma as any).loadAllPagesAsync?.();
  } catch {}
  try {
    const all = (figma.root as any).findAll((n: any) =>
      n && (n.type === 'COMPONENT' || n.type === 'COMPONENT_SET')
    );
    for (const n of all) {
      const k = (n as any).key;
      if (typeof k === 'string' && k) idx.set(k, n);
    }
  } catch {}
  docKeyIndex = idx;
  return idx;
}

export async function resolvePreferredComponent(pv: {
  type: string;
  key: string;
}): Promise<any> {
  if (keyResolveCache.has(pv.key)) return keyResolveCache.get(pv.key);

  // Layer 1 — node-id fast path.
  try {
    const byId = await figma.getNodeByIdAsync(pv.key);
    if (byId) {
      keyResolveCache.set(pv.key, byId);
      return byId;
    }
  } catch {}

  const importErrors: string[] = [];

  // Layer 2 — document-wide index. Prefer a locally-indexed node before the
  // library import so callers can still reach `.parent` to climb from a variant
  // COMPONENT to its COMPONENT_SET.
  try {
    const idx = await buildDocKeyIndex();
    const hit = idx.get(pv.key);
    if (hit) {
      keyResolveCache.set(pv.key, hit);
      return hit;
    }
  } catch (e) {
    importErrors.push(
      `doc findAll: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  // Layer 3 — library imports. Last resort for components that don't live
  // locally. Nodes returned by these APIs are detached (parent === null), so
  // anything consuming the result that needs `.parent` must explicitly tolerate
  // that.
  if (pv.type === 'COMPONENT') {
    try {
      const c = await (figma as any).importComponentByKeyAsync(pv.key);
      if (c) {
        keyResolveCache.set(pv.key, c);
        return c;
      }
    } catch (e) {
      importErrors.push(
        `importComponentByKeyAsync: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
  if (pv.type === 'COMPONENT_SET') {
    try {
      const cs = await (figma as any).importComponentSetByKeyAsync(pv.key);
      if (cs) {
        keyResolveCache.set(pv.key, cs);
        return cs;
      }
    } catch (e) {
      importErrors.push(
        `importComponentSetByKeyAsync: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
  // Cross-fallback — Figma occasionally reports pv.type as COMPONENT when the key
  // resolves to a COMPONENT_SET (and vice versa).
  try {
    const cs =
      pv.type === 'COMPONENT'
        ? await (figma as any).importComponentSetByKeyAsync(pv.key)
        : await (figma as any).importComponentByKeyAsync(pv.key);
    if (cs) {
      keyResolveCache.set(pv.key, cs);
      return cs;
    }
  } catch (e) {
    importErrors.push(
      `import cross-fallback: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  if (importErrors.length > 0) {
    console.warn(
      `[uSpec Extract] Could not resolve preferred ${pv.type} key=${pv.key}: ${importErrors.join(
        ' | '
      )}`
    );
  }
  keyResolveCache.set(pv.key, null);
  return null;
}
