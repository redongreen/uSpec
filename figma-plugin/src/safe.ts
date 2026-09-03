// Defensive property accessors. GROUP / SLOT / other non-container nodes throw synchronous
// TypeErrors on property reads that FRAME / INSTANCE / COMPONENT nodes never throw on. These
// helpers make every `node.<prop>` lookup safe so a single node type mismatch cannot kill the
// walk.

export const safeLen = (x: unknown): number => (Array.isArray(x) ? x.length : 0);

export const sg = (n: unknown, p: string): any => {
  try {
    return (n as any)[p];
  } catch {
    return undefined;
  }
};

export const sidStr = (n: unknown, p: string): string => {
  try {
    const v = (n as any)[p];
    return typeof v === 'string' ? v : '';
  } catch {
    return '';
  }
};

export const rv = (v: number): number => Math.round(v * 10) / 10;

export const md = (value: number | string, token: string | null | undefined): string =>
  token ? `${token} (${value})` : String(value);

export const rgbToHex = (c: { r: number; g: number; b: number }): string =>
  '#' +
  [c.r, c.g, c.b]
    .map((v) => Math.round(v * 255).toString(16).padStart(2, '0'))
    .join('');

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

// Snapshot an INSTANCE's `componentProperties` into the typed shape downstream
// renderers expect. Strips Figma's `#…` clean-key suffix from each property name and
// preserves both `type` and `value` exactly as Figma returns them — including
// `VARIANT` entries (one per variant axis).
//
// Returns `null` for non-INSTANCE nodes (so callers can store `componentProperties:
// null` on FRAMEs, vectors, wrappers, and slot-preferred entries with no concrete
// placed instance). Defensive against `componentProperties` throwing on certain
// node states (rare, but documented in Figma's plugin types) and against any
// `type` value Figma might add in the future that isn't in our supported union —
// unknown types are dropped at the source so the typed pipeline stays sound.
const ALLOWED_PROPERTY_TYPES = ['BOOLEAN', 'INSTANCE_SWAP', 'TEXT', 'VARIANT', 'SLOT'] as const;
type ComponentPropertyType = (typeof ALLOWED_PROPERTY_TYPES)[number];

export function snapshotComponentProperties(
  node: any
): Record<string, { type: ComponentPropertyType; value: unknown }> | null {
  if (!node || sg(node, 'type') !== 'INSTANCE') return null;
  const cp = sg(node, 'componentProperties');
  if (!cp || typeof cp !== 'object') return null;
  const out: Record<string, { type: ComponentPropertyType; value: unknown }> = {};
  for (const [k, vRaw] of Object.entries(cp)) {
    const v: any = vRaw;
    if (!v || typeof v !== 'object' || typeof v.type !== 'string') continue;
    if (!(ALLOWED_PROPERTY_TYPES as readonly string[]).includes(v.type)) continue;
    out[k.split('#')[0]] = { type: v.type as ComponentPropertyType, value: v.value };
  }
  return out;
}

// Resolve a SLOT node's bound slot-property clean-key.
//
// Authoritative source: `componentPropertyReferences.mainComponent` (per Figma's
// SlotNode / shared-node-properties docs — slots are defined by a component
// property reference, and the SLOT-binding slot lives under the `mainComponent`
// key alongside `visible` and `characters`).
//
// Real-world files often only carry `cpRefs.visible` (the visibility-toggle
// binding to a separate BOOLEAN prop) on a SLOT node and omit `mainComponent`
// entirely. In that case fall back to the SLOT node's `name`, which is Figma's
// UI-enforced convention (a SLOT is named after the slot prop it implements).
//
// The previous code grabbed `Object.values(cpRefs)[0]` which would pick up the
// `visible` binding and produce a wrong key (e.g. "show leading slot" instead
// of "leading slot"), causing every later lookup-by-slot-prop-name to miss.
export function getSlotPropName(slotNode: any): string {
  const cpRefs = sg(slotNode, 'componentPropertyReferences') || {};
  const ref = typeof cpRefs.mainComponent === 'string' ? cpRefs.mainComponent : null;
  return ref ? ref.split('#')[0] : sg(slotNode, 'name') || '';
}

// Layout-wrapper descent. Many components wrap their real sub-components in a single
// auto-layout FRAME (for clipping, scroll, padding, etc.). Descending through such
// wrappers lets the classification UI surface the actual sub-components instead of
// stopping at the wrapper. Recursive: handles `Variant > FRAME > FRAME > instances`.
//
// A node is considered a wrapper when:
//   - it has exactly one child,
//   - that child is a FRAME,
//   - that child has auto-layout (`layoutMode !== 'NONE'`).
//
// The descended-through wrappers are returned alongside the effective container so
// callers can surface them as explicit `decorative` entries (origin: top-level,
// topLevelInstanceId: `wrapper:<depth>`) and never silently drop layout chrome.
export function getEffectiveChildContainer(node: any): {
  container: any;
  wrappers: any[];
} {
  const wrappers: any[] = [];
  let container: any = node;
  while (true) {
    const kids = sg(container, 'children');
    if (!Array.isArray(kids) || kids.length !== 1) break;
    const child = kids[0];
    if (sg(child, 'type') !== 'FRAME') break;
    const lm = sg(child, 'layoutMode');
    if (!lm || lm === 'NONE') break;
    wrappers.push(child);
    container = child;
  }
  return { container, wrappers };
}

// Same descent applied to the walked-tree representation produced by Phase E. In that
// shape `layoutMode` is nested at `dimensions.layoutMode.value` and the property is
// omitted entirely when the FRAME has no auto-layout (see extractDims in phaseE.ts).
export function getEffectiveChildContainerOfWalked(walked: any): {
  container: any;
  wrappers: any[];
} {
  const wrappers: any[] = [];
  let container: any = walked || {};
  while (
    Array.isArray(container.children) &&
    container.children.length === 1 &&
    container.children[0]?.type === 'FRAME' &&
    container.children[0]?.dimensions?.layoutMode?.value &&
    container.children[0].dimensions.layoutMode.value !== 'NONE'
  ) {
    wrappers.push(container.children[0]);
    container = container.children[0];
  }
  return { container, wrappers };
}

// Component-placement discovery through parent-owned structural containers.
// Recurse through ordinary FRAME/GROUP wrappers, but stop at every INSTANCE or SLOT
// boundary so neither a referenced component's private internals nor interchangeable
// slot contents leak into the parent's fixed composition. Paths are relative to the
// supplied root.
export function collectOwnedInstancePlacements(
  root: any
): Array<{ node: any; path: number[] }> {
  const placements: Array<{ node: any; path: number[] }> = [];
  const visit = (node: any, path: number[]): void => {
    const children = sg(node, 'children');
    if (!Array.isArray(children)) return;
    children.forEach((child: any, index: number) => {
      const childPath = [...path, index];
      if (sg(child, 'type') === 'INSTANCE') {
        placements.push({ node: child, path: childPath });
        return;
      }
      if (sg(child, 'type') === 'SLOT') return;
      visit(child, childPath);
    });
  };
  visit(root, []);
  return placements;
}

// Sub-component dedup. The classification UI asks one question per distinct
// sub-component — "constitutive or referenced?" — so N placements of the same main
// component (e.g. six "selection button" placements inside a button group) collapse
// to one classification row, not N. Multiplicity is preserved as metadata
// (placementCount, placementIndices, placementsVary) so downstream consumers can
// distinguish "homogeneous array of N" from "single placement" without re-walking
// the tree.
//
// Items where `getKey` returns null (typically non-INSTANCE FRAMEs / vectors that
// can't be deduped meaningfully) are emitted as solo groups (count 1) so callers
// don't need to branch — every input becomes exactly one output group, in the
// original order of its first occurrence.
//
// `getFingerprint` decides what counts as "the same placement". Two members with
// equal fingerprints are considered equivalent; otherwise `varies` is true. For
// the v1 the fingerprint is `mainComponentName + booleanOverrides` (catches
// variant choices and boolean state differences). Instance-swap and text overrides
// are intentionally not in v1 — extend the fingerprint at both call sites
// simultaneously if you need them.
export type PlacementGroup<T> = {
  representative: T;
  index: number;
  members: T[];
  indices: number[];
  varies: boolean;
};

export function groupBySubComp<T>(
  items: T[],
  getKey: (item: T, idx: number) => string | null,
  getFingerprint: (item: T, idx: number) => string
): PlacementGroup<T>[] {
  const order: string[] = [];
  const groups = new Map<
    string,
    { members: T[]; indices: number[]; fingerprints: Set<string>; firstIndex: number }
  >();
  let soloCounter = 0;
  items.forEach((item, idx) => {
    const rawKey = getKey(item, idx);
    const key = rawKey === null ? `__solo:${soloCounter++}` : `key:${rawKey}`;
    let g = groups.get(key);
    if (!g) {
      g = { members: [], indices: [], fingerprints: new Set(), firstIndex: idx };
      groups.set(key, g);
      order.push(key);
    }
    g.members.push(item);
    g.indices.push(idx);
    g.fingerprints.add(getFingerprint(item, idx));
  });
  return order.map((k) => {
    const g = groups.get(k)!;
    return {
      representative: g.members[0],
      index: g.firstIndex,
      members: g.members,
      indices: g.indices,
      varies: g.fingerprints.size > 1,
    };
  });
}
