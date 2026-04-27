// Phase F — cross-variant computations.

import { sg, rv } from './safe';

export type PhaseFResult = {
  axisDiffs: Record<string, Record<string, any>>;
  stateComparison: Record<string, any> | null;
  axisTokenFingerprints: Record<string, Record<string, string>>;
  axisClassification: Record<string, { values: string[]; isState: boolean; colorRelevant: boolean }>;
  sizeAxis: string | null;
  stateAxis: string | null;
  dimensionAxes: string[];
  mutationsPerformed: Array<{ action: string; target: string }>;
};

async function measureSimple(n: any): Promise<any> {
  const m: any = {};
  for (const p of [
    'width',
    'height',
    'minWidth',
    'maxWidth',
    'minHeight',
    'maxHeight',
    'itemSpacing',
    'paddingTop',
    'paddingBottom',
    'paddingLeft',
    'paddingRight',
    'cornerRadius',
    'strokeWeight',
  ]) {
    const v = sg(n, p);
    if (v !== undefined && v !== null && v !== figma.mixed) m[p] = rv(v);
  }
  const lm = sg(n, 'layoutMode');
  if (lm) m.layoutMode = lm;
  return m;
}

async function measureChildrenDeep(container: any): Promise<any> {
  const out: any = {};
  const kids = sg(container, 'children');
  if (!kids) return out;
  for (const child of kids) {
    const entry: any = {
      type: child.type,
      visible: child.visible,
      dims: await measureSimple(child),
    };
    if (child.type !== 'INSTANCE') {
      const grandKids = sg(child, 'children');
      if (grandKids && grandKids.length > 0) {
        const nested = await measureChildrenDeep(child);
        if (Object.keys(nested).length > 0) entry.__children = nested;
      }
    }
    out[child.name] = entry;
  }
  return out;
}

async function tokenFingerprint(n: any): Promise<string> {
  const tokens = new Set<string>();
  async function walk(x: any): Promise<void> {
    try {
      const fills = sg(x, 'fills');
      if (Array.isArray(fills)) {
        for (const f of fills) {
          if (f.visible === false) continue;
          if (f.boundVariables?.color?.id) {
            try {
              const v = await figma.variables.getVariableByIdAsync(f.boundVariables.color.id);
              if (v) tokens.add((v as any).codeSyntax?.WEB || v.name);
            } catch {}
          }
          const fsid = sg(x, 'fillStyleId');
          if (typeof fsid === 'string' && fsid) tokens.add('style:' + fsid);
        }
      }
      const strokes = sg(x, 'strokes');
      if (Array.isArray(strokes)) {
        for (const s of strokes) {
          if (s.visible === false) continue;
          if (s.boundVariables?.color?.id) {
            try {
              const v = await figma.variables.getVariableByIdAsync(s.boundVariables.color.id);
              if (v) tokens.add((v as any).codeSyntax?.WEB || v.name);
            } catch {}
          }
          const ssid = sg(x, 'strokeStyleId');
          if (typeof ssid === 'string' && ssid) tokens.add('style:' + ssid);
        }
      }
      const kids = sg(x, 'children');
      if (kids) for (const c of kids) await walk(c);
    } catch {}
  }
  await walk(n);
  return Array.from(tokens).sort().join('|');
}

export async function runPhaseF(
  nodeId: string,
  booleanDefsKeys: string[]
): Promise<PhaseFResult | null> {
  const node: any = await figma.getNodeByIdAsync(nodeId);
  if (!node || (node.type !== 'COMPONENT_SET' && node.type !== 'COMPONENT')) return null;

  const isCS = node.type === 'COMPONENT_SET';
  const allVariants: any[] = isCS ? node.children : [node];
  const axes: Record<string, string[]> = {};
  if (isCS && node.variantGroupProperties) {
    for (const [k, v] of Object.entries(node.variantGroupProperties))
      axes[k] = (v as any).values;
  }
  if (Object.keys(axes).length === 0) return null; // single-variant component; Phase F skipped.

  const defaultVariant: any = isCS ? node.defaultVariant || node.children[0] : node;
  const defaultVProps: Record<string, string> = isCS ? defaultVariant.variantProperties || {} : {};
  const defaultValues: Record<string, string> = {};
  for (const [a, vals] of Object.entries(axes)) defaultValues[a] = defaultVProps[a] || vals[0];

  const stateKeywords = [
    'enabled',
    'hover',
    'pressed',
    'disabled',
    'active',
    'rest',
    'focused',
    'selected',
    'dragged',
    'error',
    'loading',
  ];

  const axisTokenFingerprints: Record<string, Record<string, string>> = {};
  for (const axis of Object.keys(axes)) axisTokenFingerprints[axis] = {};

  for (const v of allVariants) {
    const fp = await tokenFingerprint(v);
    const vp = v.variantProperties || {};
    for (const [axis, val] of Object.entries(vp)) {
      if (!axisTokenFingerprints[axis][val as string])
        axisTokenFingerprints[axis][val as string] = fp;
    }
  }

  const axisClassification: PhaseFResult['axisClassification'] = {};
  for (const [axis, values] of Object.entries(axes)) {
    const fps = axisTokenFingerprints[axis] || {};
    const uniq = new Set(Object.values(fps));
    axisClassification[axis] = {
      values,
      isState: values.some((v) => stateKeywords.includes(v.toLowerCase())),
      colorRelevant: uniq.size > 1,
    };
  }

  const axisDiffs: PhaseFResult['axisDiffs'] = {};
  const dimensionAxes = Object.keys(axes).filter((a) => /size|density|shape/i.test(a));
  const nonDimAxes = Object.keys(axes).filter((a) => !dimensionAxes.includes(a));
  const mutationsPerformed: PhaseFResult['mutationsPerformed'] = [];

  for (const axis of nonDimAxes) {
    axisDiffs[axis] = {};
    for (const val of axes[axis]) {
      const tp = { ...defaultValues, [axis]: val };
      const variant = allVariants.find((v) => {
        const vp = v.variantProperties || {};
        return Object.entries(tp).every(([k, x]) => vp[k] === x);
      });
      if (!variant) {
        axisDiffs[axis][val] = null;
        continue;
      }
      const inst = variant.createInstance();
      mutationsPerformed.push({ action: 'createInstance', target: `axisDiff-${axis}-${val}` });
      const enable: Record<string, boolean> = {};
      for (const k of booleanDefsKeys) enable[k] = true;
      try {
        inst.setProperties(enable);
        mutationsPerformed.push({
          action: 'setProperties-all-booleans',
          target: `axisDiff-${axis}-${val}`,
        });
      } catch {}
      try {
        const rootDims = await measureSimple(inst);
        const kids: any[] = [];
        const instKids = sg(inst, 'children');
        if (instKids) {
          for (const c of instKids)
            kids.push({
              name: c.name,
              type: c.type,
              visible: c.visible,
              dims: await measureSimple(c),
            });
        }
        const childrenDeep = await measureChildrenDeep(inst);
        axisDiffs[axis][val] = { root: rootDims, children: kids, childrenDeep };
      } finally {
        try {
          inst.remove();
          mutationsPerformed.push({ action: 'remove', target: `axisDiff-${axis}-${val}` });
        } catch {}
      }
    }
  }

  const stateAxis = Object.keys(axes).find((a) => /state/i.test(a)) || null;
  let stateComparison: Record<string, any> | null = null;
  if (stateAxis && axes[stateAxis].length > 1) {
    stateComparison = {};
    for (const sv of axes[stateAxis]) {
      const tp = { ...defaultValues, [stateAxis]: sv };
      const variant = allVariants.find((v) => {
        const vp = v.variantProperties || {};
        return Object.entries(tp).every(([k, x]) => vp[k] === x);
      });
      if (variant) stateComparison[sv] = await measureSimple(variant);
    }
  }

  return {
    axisDiffs,
    stateComparison,
    axisTokenFingerprints,
    axisClassification,
    sizeAxis: Object.keys(axes).find((a) => /size/i.test(a)) || null,
    stateAxis,
    dimensionAxes,
    mutationsPerformed,
  };
}
