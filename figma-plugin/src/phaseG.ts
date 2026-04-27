// Phase G — revealed trees + slot host geometry.

import { sg, sidStr, rv, md, rgbToHex } from './safe';

export type PhaseGResult = {
  revealedByVariantName: Record<string, any>;
  revealedColorWalkByVariantName: Record<string, any[]>;
  slotHostGeometry: {
    swapResults: Record<string, Record<string, { prefDims: any; slotDims: any }>>;
    boolGatedFillers: any[];
  };
  mutationsPerformed: Array<{ action: string; target?: string; slot?: string; pref?: string }>;
  variantsWalked: string[];
};

async function rb(n: any, p: string): Promise<string | null> {
  const b = sg(n, 'boundVariables');
  if (!b || !b[p]) return null;
  const bb = Array.isArray(b[p]) ? b[p][0] : b[p];
  if (!bb?.id) return null;
  try {
    const v = await figma.variables.getVariableByIdAsync(bb.id);
    if (v) return v.name;
  } catch {}
  return null;
}

async function dim(n: any): Promise<any> {
  const d: any = {};
  for (const p of [
    'width',
    'height',
    'minWidth',
    'maxWidth',
    'minHeight',
    'maxHeight',
    'itemSpacing',
  ]) {
    const v = sg(n, p);
    if (v !== undefined && v !== null && v !== figma.mixed) {
      const t = await rb(n, p);
      const rvv = rv(v);
      d[p] = { value: rvv, token: t || null, display: md(rvv, t) };
    }
  }
  for (const p of ['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight']) {
    const v = sg(n, p);
    if (v !== undefined) {
      const t = await rb(n, p);
      const rvv = rv(v);
      d[p] = { value: rvv, token: t || null, display: md(rvv, t) };
    }
  }
  const lm = sg(n, 'layoutMode');
  if (lm) d.layoutMode = lm;
  return d;
}

async function loadAllFonts(rootNode: any): Promise<void> {
  const textNodes = rootNode.findAll ? rootNode.findAll((n: any) => n.type === 'TEXT') : [];
  const s = new Set<string>();
  const loads: FontName[] = [];
  for (const tn of textNodes) {
    try {
      const fn = sg(tn, 'fontName');
      if (fn && fn !== figma.mixed && fn.family) {
        const k = fn.family + '|' + fn.style;
        if (!s.has(k)) {
          s.add(k);
          loads.push(fn);
        }
      }
    } catch {}
  }
  await Promise.all(loads.map((f) => figma.loadFontAsync(f).catch(() => {})));
}

async function hierWalk(node: any, depth: number): Promise<any> {
  const entry: any = {
    name: node.name,
    type: node.type,
    visible: node.visible,
    dimensions: await dim(node),
  };
  if (node.type === 'INSTANCE') {
    try {
      const mc = await (node as InstanceNode).getMainComponentAsync();
      if (mc) {
        entry.mainComponentName = mc.name;
        const ps = mc.parent && mc.parent.type === 'COMPONENT_SET' ? mc.parent : null;
        entry.parentSetName = ps ? ps.name : mc.name;
      }
    } catch {}
  }
  const isTop = depth === 0 && node.type === 'INSTANCE';
  const kids = sg(node, 'children');
  if (kids && kids.length > 0 && (node.type !== 'INSTANCE' || isTop)) {
    entry.children = [];
    const childDepth = depth === -1 ? 0 : depth + 1;
    for (const c of kids) entry.children.push(await hierWalk(c, childDepth));
  }
  return entry;
}

async function detectBoolGatedFillers(root: any): Promise<any[]> {
  const out: any[] = [];
  async function visit(container: any, slotRole: string | null): Promise<void> {
    const kids = sg(container, 'children');
    if (!kids) return;
    for (const child of kids) {
      const refs = sg(child, 'componentPropertyReferences');
      if (
        child.type === 'INSTANCE' &&
        refs &&
        refs.visible &&
        typeof refs.visible === 'string'
      ) {
        const entry: any = {
          slotRole: slotRole || container.name || null,
          boolPropName: refs.visible.split('#')[0],
          nodeName: child.name,
        };
        try {
          const mc = await child.getMainComponentAsync();
          if (mc) {
            entry.componentKey = mc.key;
            entry.componentName = mc.name;
            const ps = mc.parent && mc.parent.type === 'COMPONENT_SET' ? mc.parent : null;
            entry.componentSetName = ps ? ps.name : mc.name;
            entry.componentSetId = ps ? ps.id : mc.id;
          }
        } catch {}
        out.push(entry);
      }
      if (child.type !== 'INSTANCE') {
        await visit(child, child.type === 'SLOT' ? child.name : slotRole);
      }
    }
  }
  await visit(root, null);
  return out;
}

async function colorWalkRevealed(
  node: any,
  path: string,
  subComponentName: string | null
): Promise<any[]> {
  const out: any[] = [];
  const elementName = node.name;
  const fillStyleId = sidStr(node, 'fillStyleId') || null;
  const strokeStyleId = sidStr(node, 'strokeStyleId') || null;
  const effectStyleId = sidStr(node, 'effectStyleId') || null;
  const visibleFills: any[] = [];
  const nodeFills = sg(node, 'fills');
  if (Array.isArray(nodeFills)) {
    for (const f of nodeFills) {
      if (f.visible === false) continue;
      const entry: any = {
        element: elementName,
        path,
        property: node.type === 'TEXT' ? 'text fill' : 'fill',
        paintType: f.type,
        hex: f.type === 'SOLID' ? rgbToHex(f.color) : null,
        styleId: fillStyleId,
        boundVariableId: f.boundVariables?.color?.id || null,
        opacity: f.opacity,
        blendMode: f.blendMode || 'NORMAL',
      };
      if (subComponentName) entry.subComponentName = subComponentName;
      if (f.type && f.type.startsWith('GRADIENT_')) {
        if (f.gradientTransform)
          entry.angleDegrees = Math.round(
            Math.atan2(f.gradientTransform[0][1], f.gradientTransform[0][0]) * (180 / Math.PI)
          );
        entry.stops = (f.gradientStops || []).map((s: any) => ({
          position: Math.round(s.position * 1000) / 1000,
          color:
            'rgba(' +
            Math.round(s.color.r * 255) +
            ', ' +
            Math.round(s.color.g * 255) +
            ', ' +
            Math.round(s.color.b * 255) +
            ', ' +
            Math.round(s.color.a * 1000) / 1000 +
            ')',
          boundVariableId: s.boundVariables?.color?.id || null,
        }));
      } else if (f.type === 'IMAGE') {
        entry.image = true;
      }
      visibleFills.push(entry);
      out.push(entry);
    }
  }
  if (fillStyleId && visibleFills.length >= 2) {
    const composite: any = {
      element: elementName,
      path,
      property: 'fill-composite',
      styleId: fillStyleId,
      layerCount: visibleFills.length,
      layers: visibleFills.map((f) => ({
        type: f.paintType,
        hex: f.hex,
        boundVariableId: f.boundVariableId,
        blendMode: f.blendMode,
        opacity: f.opacity,
        stops: f.stops,
        angleDegrees: f.angleDegrees,
        image: f.image,
      })),
    };
    if (subComponentName) composite.subComponentName = subComponentName;
    out.push(composite);
  }
  const nodeStrokes = sg(node, 'strokes');
  if (Array.isArray(nodeStrokes)) {
    for (const s of nodeStrokes) {
      if (s.visible === false) continue;
      const entry: any = {
        element: elementName,
        path,
        property: 'stroke',
        paintType: s.type,
        hex: s.type === 'SOLID' ? rgbToHex(s.color) : null,
        styleId: strokeStyleId,
        boundVariableId: s.boundVariables?.color?.id || null,
        opacity: s.opacity,
        blendMode: s.blendMode || 'NORMAL',
      };
      if (subComponentName) entry.subComponentName = subComponentName;
      out.push(entry);
    }
  }
  const nodeEffects = sg(node, 'effects');
  if (Array.isArray(nodeEffects)) {
    for (const e of nodeEffects) {
      if (e.visible === false) continue;
      const entry: any = {
        element: elementName,
        path,
        property:
          e.type === 'DROP_SHADOW'
            ? 'drop shadow'
            : e.type === 'INNER_SHADOW'
            ? 'inner shadow'
            : e.type,
        hex: e.color ? rgbToHex(e.color) : null,
        styleId: effectStyleId,
        boundVariableId: e.boundVariables?.color?.id || null,
        opacity: e.color ? e.color.a : null,
        blendMode: e.blendMode || 'NORMAL',
      };
      if (subComponentName) entry.subComponentName = subComponentName;
      out.push(entry);
    }
  }
  let currentSub = subComponentName;
  if (node.type === 'INSTANCE') {
    try {
      const mc = await (node as InstanceNode).getMainComponentAsync();
      if (mc && mc.parent && mc.parent.type === 'COMPONENT_SET') currentSub = mc.parent.name;
      else if (mc) currentSub = mc.name;
    } catch {}
  }
  const kids = sg(node, 'children');
  if (kids) {
    for (const c of kids) {
      const childEntries = await colorWalkRevealed(
        c,
        path ? path + ' > ' + node.name : node.name,
        currentSub
      );
      for (const e of childEntries) out.push(e);
    }
  }
  return out;
}

export async function runPhaseG(
  nodeId: string,
  booleanDefsKeys: string[],
  slotPrefList: Array<{ slotName: string; componentId: string }>
): Promise<PhaseGResult | null> {
  const node: any = await figma.getNodeByIdAsync(nodeId);
  if (!node || (node.type !== 'COMPONENT_SET' && node.type !== 'COMPONENT')) return null;

  const isCS = node.type === 'COMPONENT_SET';
  const allVariants: any[] = isCS ? node.children : [node];
  const defaultVariant: any = isCS ? node.defaultVariant || node.children[0] : node;

  // Representative variant set: default + one variant per dimensional-axis value.
  const axes: Record<string, string[]> = {};
  if (isCS && node.variantGroupProperties) {
    for (const [k, v] of Object.entries(node.variantGroupProperties))
      axes[k] = (v as any).values;
  }
  const defaultVProps: Record<string, string> = isCS ? defaultVariant.variantProperties || {} : {};
  const defaultValues: Record<string, string> = {};
  for (const [a, vals] of Object.entries(axes)) defaultValues[a] = defaultVProps[a] || vals[0];
  const DIM_RE = /size|density|shape/i;
  const dimAxes = Object.keys(axes).filter((a) => DIM_RE.test(a));
  const selectedNames = new Set<string>([defaultVariant.name]);
  for (const axis of dimAxes) {
    for (const val of axes[axis]) {
      const tp = { ...defaultValues, [axis]: val };
      const v = allVariants.find((vv) => {
        const vp = vv.variantProperties || {};
        return Object.entries(tp).every(([k, x]) => vp[k] === x);
      });
      if (v) selectedNames.add(v.name);
    }
  }
  const variantsToReveal = allVariants.filter((v) => selectedNames.has(v.name));

  const enable: Record<string, boolean> = {};
  for (const k of booleanDefsKeys) enable[k] = true;

  const mutationsPerformed: PhaseGResult['mutationsPerformed'] = [];
  const revealedByVariantName: Record<string, any> = {};
  const revealedColorWalkByVariantName: Record<string, any[]> = {};
  const slotSwapResults: Record<string, Record<string, { prefDims: any; slotDims: any }>> = {};
  let boolGatedFillers: any[] = [];

  for (const variant of variantsToReveal) {
    let testInst: InstanceNode | null = null;
    const tag = 'tempInst-' + variant.name;
    try {
      testInst = (variant as ComponentNode).createInstance();
      mutationsPerformed.push({ action: 'createInstance', target: tag });
      try {
        testInst.setProperties(enable);
        mutationsPerformed.push({ action: 'setProperties-all-booleans', target: tag });
      } catch {}
      await loadAllFonts(testInst);

      revealedByVariantName[variant.name] = await hierWalk(testInst, -1);
      revealedColorWalkByVariantName[variant.name] = await colorWalkRevealed(testInst, '', null);

      if (variant.id === defaultVariant.id) {
        boolGatedFillers = await detectBoolGatedFillers(testInst);

        for (const pref of slotPrefList) {
          const slotNode: any = (testInst as any).findOne(
            (n: any) => n.type === 'SLOT' && n.name === pref.slotName
          );
          if (!slotNode) continue;
          const prefComp: any = await figma.getNodeByIdAsync(pref.componentId);
          if (
            !prefComp ||
            (prefComp.type !== 'COMPONENT' && prefComp.type !== 'COMPONENT_SET')
          )
            continue;
          const targetComp =
            prefComp.type === 'COMPONENT_SET'
              ? prefComp.defaultVariant || prefComp.children[0]
              : prefComp;
          const prefInst = targetComp.createInstance();
          mutationsPerformed.push({
            action: 'createInstance',
            target: 'pref-' + pref.componentId,
          });
          try {
            while (slotNode.children.length > 0) slotNode.children[0].remove();
            slotNode.appendChild(prefInst);
            mutationsPerformed.push({
              action: 'slot-swap',
              slot: pref.slotName,
              pref: pref.componentId,
            });
            await loadAllFonts(testInst);
            if (!slotSwapResults[pref.slotName]) slotSwapResults[pref.slotName] = {};
            slotSwapResults[pref.slotName][pref.componentId] = {
              prefDims: await dim(prefInst),
              slotDims: await dim(slotNode),
            };
          } catch (err) {
            // Per-slot failure — log and continue.
          }
        }
      }
    } finally {
      if (testInst) {
        try {
          testInst.remove();
          mutationsPerformed.push({ action: 'remove', target: tag });
        } catch {}
      }
    }
  }

  return {
    revealedByVariantName,
    revealedColorWalkByVariantName,
    slotHostGeometry: { swapResults: slotSwapResults, boolGatedFillers },
    mutationsPerformed,
    variantsWalked: variantsToReveal.map((v) => v.name),
  };
}
