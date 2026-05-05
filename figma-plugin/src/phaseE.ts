// Phase E — per-variant tree walks (hierarchical, flat, colorWalk).
//
// Depth contract:
//   depth = -1  → wrapper pass over the variant root. Emits the root entry, then recurses its
//                 children at depth 0. The `isTopLevelInstance` check below fires for INSTANCE
//                 children at depth 0 so they descend one level into their subtree.
//   depth = 0   → direct child of the *effective* container — i.e. the variant root or, when
//                 the variant wraps its sub-components in a single auto-layout FRAME chain,
//                 the deepest such wrapper. Children of nodes in `ctx.wrapperIds` keep depth 0
//                 instead of incrementing, so an INSTANCE sitting inside a wrapper still gets
//                 the full top-level metadata block (subCompSetId, variant axes, boolean
//                 overrides) and gets descended once. Wrapper FRAMEs themselves stay in the
//                 walked tree so layoutTree / dimensions data is preserved.
//   depth >= 1  → descendant of a top-level INSTANCE. Non-INSTANCE nodes keep recursing;
//                 INSTANCE nodes stop (they are sub-sub-components, out of scope).

import {
  safeLen,
  sg,
  sidStr,
  rv,
  md,
  rgbToHex,
  getEffectiveChildContainer,
  getEffectiveChildContainerOfWalked,
} from './safe';

export type PhaseEVariantResult = {
  id: string;
  name: string;
  variantProperties: Record<string, string>;
  dimensions: any;
  treeHierarchical: any;
  treeFlat: any[];
  colorWalk: any[];
  layoutTree: any;
  styleIdInlineSamples: Record<string, any>;
  referencedVariableIds: string[];
  _selfCheck: {
    topLevelInstanceCount: number;
    missingChildren: Array<{ index: number; name: string; expectedChildCount: number }>;
  };
};

type WalkContext = {
  styleIdInlineSamples: Record<string, any>;
  referencedVariableIds: Set<string>;
  // Node ids of layout-wrapper FRAMEs descended through by `getEffectiveChildContainer`.
  // hierWalk consults this set to keep `effective depth` at 0 across the wrapper chain so
  // INSTANCEs sitting inside a wrapper still receive top-level metadata (subCompSetId,
  // variant axes, boolean overrides) and get descended one level into their subtree.
  wrapperIds: Set<string>;
};

async function resolveBinding(node: any, prop: string): Promise<string | null> {
  const b = sg(node, 'boundVariables');
  if (!b || !b[prop]) return null;
  const bb = Array.isArray(b[prop]) ? b[prop][0] : b[prop];
  if (!bb?.id) return null;
  try {
    const v = await figma.variables.getVariableByIdAsync(bb.id);
    if (v) return v.name;
  } catch {}
  return null;
}

function collapsePadding(
  pT: number,
  pB: number,
  pS: number,
  pE: number,
  tT: string | null,
  tB: string | null,
  tS: string | null,
  tEnd: string | null
) {
  const vT = rv(pT || 0),
    vB = rv(pB || 0),
    vS = rv(pS || 0),
    vE = rv(pE || 0);
  if (vT === vB && vS === vE && vT === vS && tT === tB && tS === tEnd && tT === tS) {
    return { value: vT, token: tT || null, display: md(vT, tT) };
  }
  if (vT === vB && vS === vE && tT === tB && tS === tEnd) {
    return {
      vertical: { value: vT, token: tT || null, display: md(vT, tT) },
      horizontal: { value: vS, token: tS || null, display: md(vS, tS) },
    };
  }
  return {
    top: { value: vT, token: tT || null, display: md(vT, tT) },
    bottom: { value: vB, token: tB || null, display: md(vB, tB) },
    start: { value: vS, token: tS || null, display: md(vS, tS) },
    end: { value: vE, token: tEnd || null, display: md(vE, tEnd) },
  };
}

function collapseCorner(
  tl: number,
  tr: number,
  bl: number,
  br: number,
  tTL: string | null,
  tTR: string | null,
  tBL: string | null,
  tBR: string | null
) {
  if (tl === tr && tr === bl && bl === br && tTL === tTR && tTR === tBL && tBL === tBR) {
    return { value: tl, token: tTL || null, display: md(tl, tTL) };
  }
  return {
    topStart: { value: tl, token: tTL || null, display: md(tl, tTL) },
    topEnd: { value: tr, token: tTR || null, display: md(tr, tTR) },
    bottomStart: { value: bl, token: tBL || null, display: md(bl, tBL) },
    bottomEnd: { value: br, token: tBR || null, display: md(br, tBR) },
  };
}

export async function extractDims(node: any): Promise<any> {
  const d: any = {};
  for (const p of [
    'width',
    'height',
    'minWidth',
    'maxWidth',
    'minHeight',
    'maxHeight',
    'itemSpacing',
    'counterAxisSpacing',
  ]) {
    const val = sg(node, p);
    if (val !== undefined && val !== null && val !== figma.mixed) {
      const token = await resolveBinding(node, p);
      const v = rv(val);
      d[p] = { value: v, token: token || null, display: md(v, token) };
    }
  }
  const pT = sg(node, 'paddingTop'),
    pB = sg(node, 'paddingBottom'),
    pS = sg(node, 'paddingLeft'),
    pE = sg(node, 'paddingRight');
  if (pT !== undefined || pB !== undefined || pS !== undefined || pE !== undefined) {
    const tPT = await resolveBinding(node, 'paddingTop');
    const tPB = await resolveBinding(node, 'paddingBottom');
    const tPS = await resolveBinding(node, 'paddingLeft');
    const tPE = await resolveBinding(node, 'paddingRight');
    d.padding = collapsePadding(pT, pB, pS, pE, tPT, tPB, tPS, tPE);
  }
  const cr = sg(node, 'cornerRadius');
  if (cr !== undefined && cr !== null) {
    if (cr === figma.mixed) {
      const tTL = await resolveBinding(node, 'topLeftRadius');
      const tTR = await resolveBinding(node, 'topRightRadius');
      const tBL = await resolveBinding(node, 'bottomLeftRadius');
      const tBR = await resolveBinding(node, 'bottomRightRadius');
      d.cornerRadius = collapseCorner(
        rv(sg(node, 'topLeftRadius') || 0),
        rv(sg(node, 'topRightRadius') || 0),
        rv(sg(node, 'bottomLeftRadius') || 0),
        rv(sg(node, 'bottomRightRadius') || 0),
        tTL,
        tTR,
        tBL,
        tBR
      );
    } else {
      const token = await resolveBinding(node, 'cornerRadius');
      const v = rv(cr);
      d.cornerRadius = { value: v, token: token || null, display: md(v, token) };
    }
  }
  const sw = sg(node, 'strokeWeight');
  if (sw !== undefined && sw !== null) {
    if (sw === figma.mixed) {
      const sides: any = {};
      for (const s of [
        'strokeTopWeight',
        'strokeBottomWeight',
        'strokeLeftWeight',
        'strokeRightWeight',
      ]) {
        const sv = sg(node, s);
        if (sv !== undefined) {
          const lk = s
            .replace('strokeTopWeight', 'top')
            .replace('strokeBottomWeight', 'bottom')
            .replace('strokeLeftWeight', 'start')
            .replace('strokeRightWeight', 'end');
          sides[lk] = { value: rv(sv), token: null, display: String(rv(sv)) };
        }
      }
      d.strokeWeight = sides;
    } else {
      const token = await resolveBinding(node, 'strokeWeight');
      const v = rv(sw);
      d.strokeWeight = { value: v, token: token || null, display: md(v, token) };
    }
  }
  const lm = sg(node, 'layoutMode');
  if (lm && lm !== 'NONE') d.layoutMode = { value: lm, token: null, display: lm };
  const pax = sg(node, 'primaryAxisAlignItems');
  if (pax) d.primaryAxisAlignItems = { value: pax, token: null, display: pax };
  const cax = sg(node, 'counterAxisAlignItems');
  if (cax) d.counterAxisAlignItems = { value: cax, token: null, display: cax };
  const lsh = sg(node, 'layoutSizingHorizontal');
  if (lsh) d.layoutSizingHorizontal = { value: lsh, token: null, display: lsh };
  const lsv = sg(node, 'layoutSizingVertical');
  if (lsv) d.layoutSizingVertical = { value: lsv, token: null, display: lsv };
  const cc = sg(node, 'clipsContent');
  if (cc !== undefined) d.clipsContent = { value: cc, token: null, display: String(cc) };
  return d;
}

async function extractTypography(node: any, ctx: WalkContext): Promise<any> {
  if (node.type !== 'TEXT') return null;
  const out: any = {};

  // Always capture inline properties alongside any styleId. `getStyleByIdAsync` cannot resolve
  // library-linked styles from the plugin sandbox, so the inline values are the fallback that
  // keep typography data intact when the style itself cannot be fetched.
  const sid = sidStr(node, 'textStyleId');
  if (sid) out.styleId = sid;
  const fs = sg(node, 'fontSize');
  if (typeof fs === 'number') out.fontSize = fs;
  const fn = sg(node, 'fontName');
  if (fn && fn !== figma.mixed && typeof fn === 'object') {
    out.fontFamily = fn.family;
    out.fontWeight = fn.style;
  }
  const lh = sg(node, 'lineHeight');
  if (lh && typeof lh === 'object' && lh.unit !== 'AUTO') out.lineHeight = lh.value;
  const ls = sg(node, 'letterSpacing');
  if (ls && typeof ls === 'object' && ls.value !== 0)
    out.letterSpacing = parseFloat(ls.value.toFixed(2));

  if (sid && !ctx.styleIdInlineSamples[sid]) {
    const sample: any = {};
    if (out.fontSize !== undefined) sample.fontSize = out.fontSize;
    if (out.fontFamily !== undefined) sample.fontFamily = out.fontFamily;
    if (out.fontWeight !== undefined) sample.fontWeight = out.fontWeight;
    if (out.lineHeight !== undefined) sample.lineHeight = out.lineHeight;
    if (out.letterSpacing !== undefined) sample.letterSpacing = out.letterSpacing;
    if (Object.keys(sample).length > 0) ctx.styleIdInlineSamples[sid] = sample;
  }

  return Object.keys(out).length > 0 ? out : null;
}

async function extractPaints(node: any): Promise<{ fills: any[]; strokes: any[]; effects: any[] }> {
  const out = { fills: [] as any[], strokes: [] as any[], effects: [] as any[] };
  const nodeFills = sg(node, 'fills');
  if (Array.isArray(nodeFills)) {
    const fillStyleId = sidStr(node, 'fillStyleId') || null;
    for (const f of nodeFills) {
      if (f.visible === false) continue;
      const entry: any = {
        type: f.type,
        blendMode: f.blendMode || 'NORMAL',
        opacity: f.opacity,
        styleId: fillStyleId,
      };
      if (f.type === 'SOLID') {
        entry.hex = rgbToHex(f.color);
        entry.boundVariableId = f.boundVariables?.color?.id || null;
      } else if (f.type && f.type.startsWith('GRADIENT_')) {
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
      out.fills.push(entry);
    }
  }
  const nodeStrokes = sg(node, 'strokes');
  if (Array.isArray(nodeStrokes)) {
    const strokeStyleId = sidStr(node, 'strokeStyleId') || null;
    for (const s of nodeStrokes) {
      if (s.visible === false) continue;
      const entry: any = {
        type: s.type,
        blendMode: s.blendMode || 'NORMAL',
        opacity: s.opacity,
        styleId: strokeStyleId,
      };
      if (s.type === 'SOLID') {
        entry.hex = rgbToHex(s.color);
        entry.boundVariableId = s.boundVariables?.color?.id || null;
      }
      out.strokes.push(entry);
    }
  }
  const nodeEffects = sg(node, 'effects');
  if (Array.isArray(nodeEffects)) {
    const effectStyleId = sidStr(node, 'effectStyleId') || null;
    for (const e of nodeEffects) {
      if (e.visible === false) continue;
      const entry: any = {
        type: e.type,
        blendMode: e.blendMode || 'NORMAL',
        opacity: e.color ? e.color.a : null,
        styleId: effectStyleId,
      };
      if (e.color) {
        entry.hex = rgbToHex(e.color);
        entry.boundVariableId = e.boundVariables?.color?.id || null;
      }
      out.effects.push(entry);
    }
  }
  return out;
}

async function hierWalk(
  node: any,
  depth: number,
  ctx: WalkContext
): Promise<any> {
  const entry: any = {
    name: node.name,
    type: node.type,
    visible: node.visible,
    dimensions: await extractDims(node),
  };
  if (node.type === 'TEXT') entry.typography = await extractTypography(node, ctx);
  if (node.type === 'INSTANCE') {
    try {
      const mc = await (node as InstanceNode).getMainComponentAsync();
      if (mc) {
        entry.mainComponentName = mc.name;
        const parentSet = mc.parent && mc.parent.type === 'COMPONENT_SET' ? mc.parent : null;
        entry.parentSetName = parentSet ? parentSet.name : mc.name;
        if (depth === 0) {
          const subCompSet: any = parentSet || mc;
          entry.subCompSetId = subCompSet.id;
          if (parentSet && (parentSet as ComponentSetNode).variantGroupProperties) {
            entry.subCompVariantAxes = {};
            for (const [k, v] of Object.entries(
              (parentSet as ComponentSetNode).variantGroupProperties!
            )) {
              entry.subCompVariantAxes[k] = (v as any).values;
            }
          }
          const ip = sg(node, 'componentProperties');
          if (ip) {
            entry.booleanOverrides = {};
            for (const [k, vRaw] of Object.entries(ip)) {
              const v: any = vRaw;
              if (v.type === 'BOOLEAN') entry.booleanOverrides[k] = v.value;
            }
          }
        }
      }
    } catch {}
  }
  const isTopLevelInstance = depth === 0 && node.type === 'INSTANCE';
  const kids = sg(node, 'children');
  if (kids && kids.length > 0 && (node.type !== 'INSTANCE' || isTopLevelInstance)) {
    // Layout-wrapper FRAMEs (precomputed in ctx.wrapperIds) keep effective depth at 0
    // so the INSTANCE sitting at the bottom of the wrapper chain is treated as a real
    // top-level sub-component (gets subCompSetId, variant axes, etc.).
    let childDepth: number;
    if (depth === -1) childDepth = 0;
    else if (ctx.wrapperIds.has((node as any).id)) childDepth = depth;
    else childDepth = depth + 1;
    const arr: any[] = [];
    for (const c of kids) arr.push(await hierWalk(c, childDepth, ctx));
    entry.children = arr;
  }
  return entry;
}

function buildLayoutTree(node: any, depth: number): any {
  const kids = sg(node, 'children');
  if (!kids || kids.length === 0) return node.name;
  const lm = sg(node, 'layoutMode');
  const isAuto = lm && lm !== 'NONE';
  const childTrees = kids.map((c: any) => buildLayoutTree(c, depth + 1));
  if (!isAuto && depth > 0) return childTrees.length === 1 ? childTrees[0] : childTrees;
  return {
    name: node.name,
    layoutMode: lm || 'NONE',
    hasPadding:
      (sg(node, 'paddingTop') || 0) +
        (sg(node, 'paddingBottom') || 0) +
        (sg(node, 'paddingLeft') || 0) +
        (sg(node, 'paddingRight') || 0) >
      0,
    hasSpacing: (sg(node, 'itemSpacing') || 0) > 0,
    children: childTrees,
  };
}

async function flatWalk(variant: any): Promise<any[]> {
  const elements: any[] = [];
  const absX = variant.absoluteTransform[0][2];
  const absY = variant.absoluteTransform[1][2];
  let idx = 1;
  async function el(n: any, slotIndex?: number): Promise<any> {
    const eabsX = n.absoluteTransform[0][2];
    const eabsY = n.absoluteTransform[1][2];
    const e: any = {
      index: idx++,
      name: n.name,
      nodeType: n.type,
      visible: n.visible,
      bbox: {
        x: Math.round(eabsX - absX),
        y: Math.round(eabsY - absY),
        w: Math.round(n.width),
        h: Math.round(n.height),
      },
    };
    if (slotIndex !== undefined) e.slotIndex = slotIndex;
    return e;
  }
  const rootEl = await el(variant);
  rootEl.name =
    variant.parent && variant.parent.type === 'COMPONENT_SET' ? variant.parent.name : variant.name;
  elements.push(rootEl);
  // Descend through any layout-wrapper FRAMEs so identically-named sibling instances
  // (which share `slotIndex`) are detected against the real container, not a wrapper.
  let { container: childContainer } = getEffectiveChildContainer(variant);
  if (childContainer.children.length === 1 && childContainer.children[0].type === 'SLOT')
    childContainer = childContainer.children[0];
  async function walk(container: any) {
    for (const c of container.children) {
      if (c.type === 'SLOT') {
        await walk(c);
        continue;
      }
      const subs = c.children
        ? c.children.filter((x: any) => x.type === 'INSTANCE')
        : [];
      if (subs.length > 1 && subs.every((x: any) => x.name === subs[0].name)) {
        let si = 0;
        for (const sc of c.children) elements.push(await el(sc, si++));
      } else {
        elements.push(await el(c));
      }
    }
  }
  await walk(childContainer);
  return elements;
}

async function colorWalk(
  node: any,
  path: string,
  subComponentName: string | null,
  ctx: WalkContext
): Promise<any[]> {
  const out: any[] = [];
  const elementName = node.name;
  const paints = await extractPaints(node);

  const fillStyleId = sidStr(node, 'fillStyleId') || null;
  const strokeStyleId = sidStr(node, 'strokeStyleId') || null;
  const effectStyleId = sidStr(node, 'effectStyleId') || null;

  for (const f of paints.fills) {
    const entry: any = {
      element: elementName,
      path,
      property: node.type === 'TEXT' ? 'text fill' : 'fill',
      paintType: f.type,
      hex: f.hex || null,
      styleId: f.styleId || null,
      boundVariableId: f.boundVariableId || null,
      opacity: f.opacity,
      blendMode: f.blendMode,
    };
    if (subComponentName) entry.subComponentName = subComponentName;
    if (f.stops) entry.stops = f.stops;
    if (f.angleDegrees !== undefined) entry.angleDegrees = f.angleDegrees;
    if (f.image) entry.image = true;
    if (entry.boundVariableId) ctx.referencedVariableIds.add(entry.boundVariableId);
    out.push(entry);
  }
  if (fillStyleId && paints.fills.length >= 2) {
    out.push({
      element: elementName,
      path,
      property: 'fill-composite',
      styleId: fillStyleId,
      layerCount: paints.fills.length,
      layers: paints.fills,
      subComponentName: subComponentName || undefined,
    });
  }
  for (const s of paints.strokes) {
    const entry: any = {
      element: elementName,
      path,
      property: 'stroke',
      paintType: s.type,
      hex: s.hex || null,
      styleId: s.styleId || null,
      boundVariableId: s.boundVariableId || null,
      opacity: s.opacity,
    };
    if (subComponentName) entry.subComponentName = subComponentName;
    if (entry.boundVariableId) ctx.referencedVariableIds.add(entry.boundVariableId);
    out.push(entry);
  }
  for (const e of paints.effects) {
    const entry: any = {
      element: elementName,
      path,
      property:
        e.type === 'DROP_SHADOW'
          ? 'drop shadow'
          : e.type === 'INNER_SHADOW'
          ? 'inner shadow'
          : e.type,
      hex: e.hex || null,
      styleId: e.styleId || effectStyleId || null,
      boundVariableId: e.boundVariableId || null,
      opacity: e.opacity,
    };
    if (subComponentName) entry.subComponentName = subComponentName;
    if (entry.boundVariableId) ctx.referencedVariableIds.add(entry.boundVariableId);
    out.push(entry);
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
      const childEntries = await colorWalk(
        c,
        path ? path + ' > ' + node.name : node.name,
        currentSub,
        ctx
      );
      for (const e of childEntries) out.push(e);
    }
  }
  return out;
}

export async function runPhaseE(variantId: string): Promise<PhaseEVariantResult> {
  const variant = await figma.getNodeByIdAsync(variantId);
  if (!variant) throw new Error('Variant not found: ' + variantId);

  // Precompute the wrapper chain so hierWalk can promote INSTANCEs sitting inside it to
  // effective depth 0. The walked tree itself still contains the wrapper FRAMEs — only
  // the depth-counting changes.
  const { container: effectiveLive, wrappers } = getEffectiveChildContainer(variant);
  const wrapperIds = new Set<string>(wrappers.map((w: any) => w.id));

  const ctx: WalkContext = {
    styleIdInlineSamples: {},
    referencedVariableIds: new Set<string>(),
    wrapperIds,
  };

  const payload: Partial<PhaseEVariantResult> = {
    id: variant.id,
    name: (variant as any).name,
    variantProperties: { ...((variant as any).variantProperties || {}) },
    dimensions: await extractDims(variant),
  };

  payload.treeHierarchical = await hierWalk(variant, -1, ctx);
  payload.layoutTree = buildLayoutTree(variant, 0);
  payload.treeFlat = await flatWalk(variant);
  payload.colorWalk = await colorWalk(variant, '', null, ctx);

  // Post-walk validation: every top-level INSTANCE child should have its `children`
  // array populated after the walk. "Top-level" is measured against the effective
  // container so a wrapper FRAME doesn't mask missing inner-instance children.
  const { container: effectiveWalked } = getEffectiveChildContainerOfWalked(
    payload.treeHierarchical
  );
  const walkedChildren = Array.isArray(effectiveWalked.children)
    ? effectiveWalked.children
    : [];
  const missingChildren: PhaseEVariantResult['_selfCheck']['missingChildren'] = [];
  const effectiveKids = sg(effectiveLive, 'children');
  if (Array.isArray(effectiveKids)) {
    for (let i = 0; i < effectiveKids.length; i++) {
      const src = effectiveKids[i];
      const srcKids = sg(src, 'children');
      if (src.type === 'INSTANCE' && Array.isArray(srcKids) && srcKids.length > 0) {
        const walked = walkedChildren[i];
        if (!walked || !Array.isArray(walked.children) || walked.children.length === 0) {
          missingChildren.push({
            index: i,
            name: src.name,
            expectedChildCount: srcKids.length,
          });
        }
      }
    }
  }
  payload._selfCheck = {
    topLevelInstanceCount: walkedChildren.filter((c: any) => c && c.type === 'INSTANCE').length,
    missingChildren,
  };
  payload.styleIdInlineSamples = ctx.styleIdInlineSamples;
  payload.referencedVariableIds = Array.from(ctx.referencedVariableIds);

  return payload as PhaseEVariantResult;
}
