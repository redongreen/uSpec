---
name: create-structure
description: Generate structure specifications documenting component dimensions, spacing, padding, and how values change across density, size, and shape variants. Use when the user mentions "structure", "structure spec", "dimensions", "spacing", "density", "sizing", or wants to document a component's dimensional properties.
---

# Create Structure Spec

Generate a structure specification directly in Figma — tables documenting all dimensional properties of a component, organized into sections by variant axis or sub-component, with dynamic columns for size/density variants.

## MCP Adapter

Read `uspecs.config.json` → `mcpProvider`. Follow the matching column for every MCP call in this skill.

| Operation | `figma-console` | `figma-mcp` |
|-----------|-----------------|-------------|
| Verify connection | `figma_get_status` | Skip — implicit. If first `use_figma` call fails, guide user to check MCP setup. |
| Navigate to file | `figma_navigate` with URL | Extract `fileKey` from URL (`figma.com/design/:fileKey/...`). No navigate needed. |
| Take screenshot | `figma_take_screenshot` | `get_screenshot` with `fileKey` + `nodeId` |
| Execute Plugin JS | `figma_execute` with `code` | `use_figma` with `fileKey`, `code`, `description`. **JS code is identical** — no wrapper changes. |
| Search components | `figma_search_components` | `search_design_system` with `query` + `fileKey` + `includeComponents: true` |
| Get file/component data | `figma_get_file_data` / `figma_get_component` | `get_metadata` or `get_design_context` with `fileKey` + `nodeId` |
| Get variables (file-wide) | `figma_get_variables` | `use_figma` script: `return await figma.variables.getLocalVariableCollectionsAsync();` |
| Get token values | `figma_get_token_values` | `use_figma` script reading variable values per mode/collection |
| Get styles | `figma_get_styles` | `search_design_system` with `includeStyles: true`, or `use_figma`: `return figma.getLocalPaintStyles();` |
| Get selection | `figma_get_selection` | `use_figma` script: `return figma.currentPage.selection.map(n => ({id: n.id, name: n.name, type: n.type}));` |

**`figma-mcp` requires `fileKey` on every call.** Extract it once from the user's Figma URL at the start of the workflow. For branch URLs (`figma.com/design/:fileKey/branch/:branchKey/:fileName`), use `:branchKey` as the fileKey.

**`figma-mcp` page context:** `use_figma` resets `figma.currentPage` to the first page on every call. When a script accesses a node from a previous step via `getNodeByIdAsync(ID)`, the page content may not be loaded — `findAll`, `findOne`, and `characters` will fail with `TypeError` until the page is activated. Insert this page-loading block immediately after `getNodeByIdAsync`:

```javascript
let _p = node; while (_p.parent && _p.parent.type !== 'DOCUMENT') _p = _p.parent;
if (_p.type === 'PAGE') await figma.setCurrentPageAsync(_p);
```

This walks up to the PAGE ancestor and loads its content. Console MCP does not need this — `figma_execute` inherits the Desktop page context.

## Inputs Expected

- **Figma link to the component**: Required — URL to a component set or standalone component in Figma
- **Figma link to the destination** (optional): URL to the page/frame where the spec should be placed. If omitted, places it in the same file as the component.
- **Description** (optional): Component name, specific properties to document, sub-components to include

## Workflow

Copy this checklist and update as you progress:

```
Task Progress:
- [ ] Step 1: Read instruction file
- [ ] Step 2: Verify MCP connection
- [ ] Step 3: Read template key from uspecs.config.json
- [ ] Step 4a: Visual and structural context (navigate, screenshot, file data)
- [ ] Step 4b: Run enhanced extraction script (sub-components, booleans, tokens, collapsed dimensions)
- [ ] Step 4c: Check variable modes
- [ ] Step 4d: Cross-variant dimensional comparison (deterministic script)
- [ ] Step 4e: Non-dimensional axis diff (measure all other axes for structural/property differences)
- [ ] Step 5: Navigate to destination (if different file)
- [ ] Step 6: AI interpretation layer — build section plan, write design-intent notes, detect anomalies, judge completeness
- [ ] Step 6b: Run targeted extractions for structural axes identified in Step 6
- [ ] Step 7: Generate structured data (component name, general notes, sections with columns and rows)
- [ ] Step 8: Re-read instruction file (Common Mistakes, Do NOT sections) and audit
- [ ] Step 9: Import and detach the Structure template
- [ ] Step 10: Fill header fields
- [ ] Step 11: For each section → render table, determine preview params, populate preview
- [ ] Step 12: Visual validation
```

### Step 1: Read Instructions

Read [agent-structure-instruction.md](../../structure/agent-structure-instruction.md)

### Step 2: Verify MCP Connection

Read `mcpProvider` from `uspecs.config.json` to determine which Figma MCP to use.

**If `figma-console`:**
- `figma_get_status` — Confirm Desktop Bridge plugin is active
- If connection fails: *"Please open Figma Desktop and run the Desktop Bridge plugin. Then try again."*

**If `figma-mcp`:**
- Connection is verified implicitly on the first `use_figma` call. No explicit check needed.
- If the first call fails: *"Please verify your FIGMA_API_KEY is set correctly in your MCP configuration."*

### Step 3: Read Template Key

Read the file `uspecs.config.json` and extract:
- The `structureSpec` value from the `templateKeys` object → save as `STRUCTURE_TEMPLATE_KEY`
- The `fontFamily` value → save as `FONT_FAMILY` (default to `Inter` if not set)

If the template key is empty, tell the user:
> The structure template key is not configured. Run `@firstrun` with your Figma template library link first.

### Step 4: Gather Context

Navigate to the component file and extract structural data using MCP tools.

**Extract the node ID from the URL:** Figma URLs contain `node-id=123-456` → use `123:456`.

**4a. Visual and structural context:**
1. `figma_navigate` — Go to the component URL
2. `figma_take_screenshot` — See the component and its variants
3. `figma_get_file_data` — Get component set structure with variant axes
4. `figma_get_component` — Get detailed component data for a specific instance
5. `figma_get_component_for_development` — Get component data with visual reference

**4b. Run the enhanced extraction script** via `figma_execute`. Replace `__NODE_ID__` with the actual node ID. This script performs sub-component discovery, boolean enumeration, token binding resolution, and returns a collapsed/expanded dimensional model with logical direction normalization and pre-formatted display strings.

```javascript
const TARGET_NODE_ID = '__NODE_ID__';

async function resolveBinding(node, prop) {
  const bindings = node.boundVariables;
  if (!bindings || !bindings[prop]) return null;
  const binding = Array.isArray(bindings[prop]) ? bindings[prop][0] : bindings[prop];
  if (!binding?.id) return null;
  try {
    const v = await figma.variables.getVariableByIdAsync(binding.id);
    if (v) return v.name;
  } catch {}
  return null;
}

async function resolveTextStyle(textNode) {
  if (textNode.textStyleId && typeof textNode.textStyleId === 'string' && textNode.textStyleId !== '') {
    try {
      const style = await figma.getStyleByIdAsync(textNode.textStyleId);
      if (style) return style.name;
    } catch {}
  }
  return null;
}

function rv(v) { return Math.round(v * 10) / 10; }

function makeDisplayString(value, token) {
  if (token) return token + ' (' + value + ')';
  return String(value);
}

function collapsePadding(pT, pB, pS, pE, tT, tB, tS, tE) {
  const vT = rv(pT || 0), vB = rv(pB || 0);
  const vS = rv(pS || 0), vE = rv(pE || 0);
  if (vT === vB && vS === vE && vT === vS && tT === tB && tS === tE && tT === tS) {
    return { value: vT, token: tT || null, display: makeDisplayString(vT, tT) };
  }
  if (vT === vB && vS === vE && tT === tB && tS === tE) {
    return {
      vertical: { value: vT, token: tT || null, display: makeDisplayString(vT, tT) },
      horizontal: { value: vS, token: tS || null, display: makeDisplayString(vS, tS) }
    };
  }
  return {
    top: { value: vT, token: tT || null, display: makeDisplayString(vT, tT) },
    bottom: { value: vB, token: tB || null, display: makeDisplayString(vB, tB) },
    start: { value: vS, token: tS || null, display: makeDisplayString(vS, tS) },
    end: { value: vE, token: tE || null, display: makeDisplayString(vE, tE) }
  };
}

function collapseCornerRadius(tl, tr, bl, br, tTL, tTR, tBL, tBR) {
  if (tl === tr && tr === bl && bl === br && tTL === tTR && tTR === tBL && tBL === tBR) {
    return { value: tl, token: tTL || null, display: makeDisplayString(tl, tTL) };
  }
  return {
    topStart: { value: tl, token: tTL || null, display: makeDisplayString(tl, tTL) },
    topEnd: { value: tr, token: tTR || null, display: makeDisplayString(tr, tTR) },
    bottomStart: { value: bl, token: tBL || null, display: makeDisplayString(bl, tBL) },
    bottomEnd: { value: br, token: tBR || null, display: makeDisplayString(br, tBR) }
  };
}

async function extractDimensions(node) {
  const dims = {};
  const simpleProps = ['width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'itemSpacing', 'counterAxisSpacing'];
  for (const p of simpleProps) {
    if (node[p] !== undefined && node[p] !== null && node[p] !== figma.mixed) {
      const token = await resolveBinding(node, p);
      const v = rv(node[p]);
      dims[p] = { value: v, token: token || null, display: makeDisplayString(v, token) };
    }
  }

  const tPT = await resolveBinding(node, 'paddingTop');
  const tPB = await resolveBinding(node, 'paddingBottom');
  const tPS = await resolveBinding(node, 'paddingLeft');
  const tPE = await resolveBinding(node, 'paddingRight');
  if (node.paddingTop !== undefined || node.paddingBottom !== undefined || node.paddingLeft !== undefined || node.paddingRight !== undefined) {
    dims.padding = collapsePadding(node.paddingTop, node.paddingBottom, node.paddingLeft, node.paddingRight, tPT, tPB, tPS, tPE);
  }

  if (node.cornerRadius !== undefined && node.cornerRadius !== null) {
    if (node.cornerRadius === figma.mixed) {
      const tTL = await resolveBinding(node, 'topLeftRadius');
      const tTR = await resolveBinding(node, 'topRightRadius');
      const tBL = await resolveBinding(node, 'bottomLeftRadius');
      const tBR = await resolveBinding(node, 'bottomRightRadius');
      dims.cornerRadius = collapseCornerRadius(
        rv(node.topLeftRadius || 0), rv(node.topRightRadius || 0),
        rv(node.bottomLeftRadius || 0), rv(node.bottomRightRadius || 0),
        tTL, tTR, tBL, tBR
      );
    } else {
      const token = await resolveBinding(node, 'cornerRadius');
      const v = rv(node.cornerRadius);
      dims.cornerRadius = { value: v, token: token || null, display: makeDisplayString(v, token) };
    }
  }

  if (node.strokeWeight !== undefined && node.strokeWeight !== null) {
    if (node.strokeWeight === figma.mixed) {
      const sides = {};
      for (const s of ['strokeTopWeight', 'strokeBottomWeight', 'strokeLeftWeight', 'strokeRightWeight']) {
        if (node[s] !== undefined) {
          const logicalKey = s.replace('strokeTopWeight', 'top').replace('strokeBottomWeight', 'bottom').replace('strokeLeftWeight', 'start').replace('strokeRightWeight', 'end');
          sides[logicalKey] = { value: rv(node[s]), token: null, display: String(rv(node[s])) };
        }
      }
      dims.strokeWeight = sides;
    } else {
      const token = await resolveBinding(node, 'strokeWeight');
      const v = rv(node.strokeWeight);
      dims.strokeWeight = { value: v, token: token || null, display: makeDisplayString(v, token) };
    }
  }

  if (node.layoutMode && node.layoutMode !== 'NONE') {
    dims.layoutMode = { value: node.layoutMode, token: null, display: node.layoutMode };
  }
  if (node.primaryAxisAlignItems) dims.primaryAxisAlignItems = { value: node.primaryAxisAlignItems, token: null, display: node.primaryAxisAlignItems };
  if (node.counterAxisAlignItems) dims.counterAxisAlignItems = { value: node.counterAxisAlignItems, token: null, display: node.counterAxisAlignItems };
  if (node.layoutSizingHorizontal) dims.layoutSizingHorizontal = { value: node.layoutSizingHorizontal, token: null, display: node.layoutSizingHorizontal };
  if (node.layoutSizingVertical) dims.layoutSizingVertical = { value: node.layoutSizingVertical, token: null, display: node.layoutSizingVertical };
  if (node.clipsContent !== undefined) dims.clipsContent = { value: node.clipsContent, token: null, display: String(node.clipsContent) };

  return dims;
}

async function extractTypography(node) {
  if (node.type !== 'TEXT') return null;
  const styleName = await resolveTextStyle(node);
  if (styleName) return { styleName };
  const props = {};
  if (typeof node.fontSize === 'number') props.fontSize = node.fontSize;
  if (typeof node.fontName === 'object') {
    props.fontFamily = node.fontName.family;
    props.fontWeight = node.fontName.style;
  }
  if (node.lineHeight && typeof node.lineHeight === 'object' && node.lineHeight.unit !== 'AUTO') {
    props.lineHeight = node.lineHeight.value;
  }
  if (node.letterSpacing && typeof node.letterSpacing === 'object' && node.letterSpacing.value !== 0) {
    props.letterSpacing = parseFloat(node.letterSpacing.value.toFixed(2));
  }
  return Object.keys(props).length > 0 ? props : null;
}

async function extractChildren(container, depth, discoverSubComps) {
  if (depth === undefined) depth = 0;
  const children = [];
  for (const child of container.children) {
    const entry = {
      name: child.name,
      type: child.type,
      visible: child.visible,
      dimensions: await extractDimensions(child)
    };
    if (child.type === 'TEXT') {
      entry.typography = await extractTypography(child);
    }
    if (child.type === 'INSTANCE') {
      try {
        const mc = await child.getMainComponentAsync();
        if (mc) {
          entry.mainComponentName = mc.name;
          const parentSet = mc.parent && mc.parent.type === 'COMPONENT_SET' ? mc.parent : null;
          entry.parentSetName = parentSet ? parentSet.name : mc.name;
          if (discoverSubComps && depth === 0) {
            const subCompSet = mc.parent && mc.parent.type === 'COMPONENT_SET' ? mc.parent : null;
            entry.subCompSetId = subCompSet ? subCompSet.id : mc.id;
            if (subCompSet && subCompSet.variantGroupProperties) {
              entry.subCompVariantAxes = {};
              for (const [k, v] of Object.entries(subCompSet.variantGroupProperties)) {
                entry.subCompVariantAxes[k] = v.values;
              }
            }
            const instProps = child.componentProperties;
            if (instProps) {
              entry.booleanOverrides = {};
              for (const [key, val] of Object.entries(instProps)) {
                if (val.type === 'BOOLEAN') entry.booleanOverrides[key] = val.value;
              }
            }
          }
        }
      } catch {}
    }
    const isTopLevelInstance = depth === 0 && child.type === 'INSTANCE';
    if ('children' in child && child.children.length > 0 && (child.type !== 'INSTANCE' || isTopLevelInstance)) {
      entry.children = await extractChildren(child, depth + 1, false);
    }
    children.push(entry);
  }
  return children;
}

function buildLayoutTree(node, depth) {
  if (depth === undefined) depth = 0;
  if (!('children' in node) || node.children.length === 0) return node.name;
  const isAutoLayout = node.layoutMode && node.layoutMode !== 'NONE';
  const childTrees = node.children.map(c => buildLayoutTree(c, depth + 1));
  if (!isAutoLayout && depth > 0) return childTrees.length === 1 ? childTrees[0] : childTrees;
  return {
    name: node.name,
    layoutMode: node.layoutMode || 'NONE',
    hasPadding: (node.paddingTop || 0) + (node.paddingBottom || 0) + (node.paddingLeft || 0) + (node.paddingRight || 0) > 0,
    hasSpacing: (node.itemSpacing || 0) > 0,
    children: childTrees
  };
}

const node = await figma.getNodeByIdAsync(TARGET_NODE_ID);
if (!node || (node.type !== 'COMPONENT_SET' && node.type !== 'COMPONENT')) {
  return { error: 'Node is not a component set or component. Type: ' + (node ? node.type : 'null') };
}

const isComponentSet = node.type === 'COMPONENT_SET';
const variantAxes = {};
if (isComponentSet && node.variantGroupProperties) {
  for (const [key, val] of Object.entries(node.variantGroupProperties)) {
    variantAxes[key] = val.values;
  }
}

const propDefs = node.componentPropertyDefinitions;
const propertyDefs = {};
const booleanDefs = {};
if (propDefs) {
  for (const [key, def] of Object.entries(propDefs)) {
    propertyDefs[key] = { type: def.type, defaultValue: def.defaultValue };
    if (def.variantOptions) propertyDefs[key].variantOptions = def.variantOptions;
    if (def.type === 'BOOLEAN') booleanDefs[key] = def.defaultValue;
  }
}

const variantChildren = isComponentSet ? node.children : [node];
const defaultVariant = isComponentSet ? (node.defaultVariant || node.children[0]) : node;
const defaultVProps = isComponentSet ? (defaultVariant.variantProperties || {}) : {};
const defaultValues = {};
for (const [axis, vals] of Object.entries(variantAxes)) {
  defaultValues[axis] = defaultVProps[axis] || vals[0];
}

// Only vary dimension-affecting axes (Size, Density, Shape); skip visual-only (State, Mode, Theme)
const DIMENSION_AXES = /size|density|shape/i;
const dimensionAffectingAxes = Object.keys(variantAxes).filter(a => DIMENSION_AXES.test(a));
const axesToVary = dimensionAffectingAxes.length > 0 ? dimensionAffectingAxes : [Object.keys(variantAxes)[0] || ''];

const selectedVariants = new Set();
for (const axis of axesToVary) {
  const vals = variantAxes[axis] || [];
  for (const val of vals) {
    const props = { ...defaultValues, [axis]: val };
    const name = Object.entries(props).map(([k, v]) => k + '=' + v).join(', ');
    selectedVariants.add(name);
  }
}
if (selectedVariants.size === 0 && variantChildren.length > 0) {
  selectedVariants.add(variantChildren[0].name);
}

const variants = [];
for (const variant of variantChildren) {
  if (!isComponentSet || selectedVariants.has(variant.name)) {
    const dims = await extractDimensions(variant);
    variants.push({
      name: variant.name,
      dimensions: dims,
      children: await extractChildren(variant, 0, true),
      layoutTree: buildLayoutTree(variant)
    });
  }
}

let enrichedTree = null;
const subComponents = [];
const testInst = defaultVariant.createInstance();
if (Object.keys(booleanDefs).length > 0) {
  const enableAll = {};
  for (const key of Object.keys(booleanDefs)) enableAll[key] = true;
  try { testInst.setProperties(enableAll); } catch {}
}
enrichedTree = await extractChildren(testInst, 0, true);

for (const child of enrichedTree) {
  if (child.type === 'INSTANCE' && child.subCompSetId) {
    subComponents.push({
      name: child.name,
      mainComponentName: child.mainComponentName || child.name,
      subCompSetId: child.subCompSetId,
      subCompVariantAxes: child.subCompVariantAxes || {},
      booleanOverrides: child.booleanOverrides || {},
      dimensions: child.dimensions || {},
      children: child.children || [],
      typography: child.typography || null
    });
  }
}
testInst.remove();

// --- Resolve SLOT properties and preferred instances ---
const slotContents = [];
const slotPropDefs = {};
for (const [rawKey, def] of Object.entries(propDefs)) {
  if (def.type === 'SLOT') slotPropDefs[rawKey] = def;
}

const hasPreferred = Object.values(slotPropDefs).some(d => d.preferredValues && d.preferredValues.length > 0);
const allCompKeys = new Map();
if (hasPreferred) {
  for (const page of figma.root.children) {
    try { await figma.setCurrentPageAsync(page); } catch { continue; }
    const comps = page.findAll(n => n.type === 'COMPONENT' || n.type === 'COMPONENT_SET');
    for (const c of comps) {
      if (c.key) allCompKeys.set(c.key, c);
      if (c.type === 'COMPONENT_SET' && 'children' in c) {
        for (const v of c.children) { if (v.type === 'COMPONENT' && v.key) allCompKeys.set(v.key, v); }
      }
    }
  }
  let _rp = node; while (_rp.parent && _rp.parent.type !== 'DOCUMENT') _rp = _rp.parent;
  if (_rp.type === 'PAGE') await figma.setCurrentPageAsync(_rp);
}

const slotTestInst = defaultVariant.createInstance();
if (Object.keys(booleanDefs).length > 0) {
  const enableAll = {};
  for (const key of Object.keys(booleanDefs)) enableAll[key] = true;
  try { slotTestInst.setProperties(enableAll); } catch {}
}

for (const [rawKey, def] of Object.entries(slotPropDefs)) {
  const slotName = rawKey.split('#')[0];
  const slotNode = slotTestInst.findOne(n => n.type === 'SLOT' && n.name === slotName);
  const entry = {
    slotName,
    slotNodeType: 'SLOT',
    preferredComponents: [],
    defaultChildren: [],
    slotDimensions: slotNode ? await extractDimensions(slotNode) : {}
  };

  if (slotNode && 'children' in slotNode) {
    for (const sc of slotNode.children) {
      const scInfo = { name: sc.name, nodeType: sc.type };
      if (sc.type === 'INSTANCE') {
        try {
          const mc = await sc.getMainComponentAsync();
          if (mc) {
            scInfo.mainComponentName = mc.name;
            const isSet = mc.parent && mc.parent.type === 'COMPONENT_SET';
            scInfo.componentSetName = isSet ? mc.parent.name : mc.name;
          }
        } catch {}
      }
      entry.defaultChildren.push(scInfo);
    }
  }

  if (def.preferredValues && def.preferredValues.length > 0) {
    for (const pv of def.preferredValues) {
      if (pv.type !== 'COMPONENT') continue;
      const compNode2 = allCompKeys.get(pv.key);
      if (!compNode2) continue;
      const isSet = compNode2.parent && compNode2.parent.type === 'COMPONENT_SET';
      const setNode = isSet ? compNode2.parent : compNode2;
      const prefEntry = {
        componentKey: pv.key,
        componentName: compNode2.name,
        componentId: compNode2.id,
        componentSetId: isSet ? setNode.id : null,
        isComponentSet: isSet,
        variantAxes: {},
        booleanDefs: {}
      };
      if (isSet && setNode.variantGroupProperties) {
        for (const [k, v] of Object.entries(setNode.variantGroupProperties)) {
          prefEntry.variantAxes[k] = v.values;
        }
      }
      const prefPropDefs = setNode.componentPropertyDefinitions || {};
      for (const [pk, pd] of Object.entries(prefPropDefs)) {
        if (pd.type === 'BOOLEAN') prefEntry.booleanDefs[pk] = pd.defaultValue;
      }
      entry.preferredComponents.push(prefEntry);
    }
  }
  slotContents.push(entry);
}
slotTestInst.remove();

return {
  componentName: node.name,
  compSetNodeId: TARGET_NODE_ID,
  isComponentSet,
  variantAxes,
  propertyDefs,
  booleanDefs,
  variantCount: variantChildren.length,
  variants,
  enrichedTree,
  subComponents,
  slotContents
};
```

Save the returned JSON. The extraction returns:

- **`componentName`**, **`compSetNodeId`**, **`isComponentSet`** — component identity
- **`variantAxes`** — map of axis name → value array (e.g., `{ Size: ["Large", "Medium", "Small"] }`)
- **`propertyDefs`** — all component property definitions with exact Figma keys (including `#nodeId` suffixes for booleans) needed for `setProperties()` when placing preview instances
- **`booleanDefs`** — parent-level boolean properties and their defaults
- **`variants`** — one per value of each dimension-affecting axis (Size, Density, Shape) at default values for other axes. Each has `name`, `dimensions` (collapsed `{ value, token, display }` tuples), `children`, and `layoutTree`
- **`enrichedTree`** — full recursive tree from a fully-enabled test instance (all parent booleans `true`). Each node: name, type, visible, dimensions, children, typography, sub-component metadata. INSTANCE nodes at any depth include `mainComponentName` (the variant name, e.g., `"Size=12, Theme=Filled"`) and `parentSetName` (the component set name, e.g., `"checkmark"`) — use `parentSetName` as the icon/component identity.
- **`subComponents`** — array with `name`, `mainComponentName`, `subCompSetId`, `subCompVariantAxes`, `booleanOverrides`, `dimensions`, `children`, `typography` per sub-component
- **`slotContents`** — array of SLOT property entries. Each has `slotName`, `slotNodeType`, `preferredComponents` (resolved preferred instances with `componentKey`, `componentName`, `componentId`, `componentSetId`, `isComponentSet`, `variantAxes`, `booleanDefs`), `defaultChildren` (current default slot content), and `slotDimensions` (dimensional properties of the SLOT node itself). Empty array when the component has no SLOT properties.

The instruction file (`agent-structure-instruction.md`) documents how to interpret the data shapes — collapsed dimensions, typography composites, display strings, and logical directions. Refer to it for row emission rules.

**Response truncation:** The MCP tool may truncate responses exceeding ~20KB. If the returned JSON is missing expected fields (`subComponents`, `slotContents`, or later `variants` entries), run a targeted follow-up `use_figma` call that extracts only the missing fields (e.g., just `subComponents` and `slotContents` with their metadata, without the full recursive `children` and `dimensions` trees). Do not re-run the full extraction script — extract only what was lost.

You will use `componentName`, `compSetNodeId`, `variantAxes`, `propertyDefs`, `booleanDefs`, `variants`, `enrichedTree`, `subComponents`, `slotContents`, and each variant's `layoutTree` in subsequent steps.

**4c. Check variable modes:**
- `figma_get_variables` — **Critical:** Check if any bound tokens have multiple mode values (e.g., Density: compact/default/spacious). Filter by token prefix to find relevant variables. If the extraction script found tokens in `boundVariables`, query those token names to discover multi-mode collections.

**Scope constraint:** Only analyze the provided node and its children. Do not navigate to other pages or unrelated frames elsewhere in the Figma file.

**4d. Cross-variant dimensional comparison** — Run this deterministic script via `figma_execute` to systematically compare dimensions across all size/variant values for every discovered sub-component, plus the root component itself. Replace `__NODE_ID__` and `__SUB_COMPONENTS_JSON__` (from the extraction's `subComponents` array) and `__BOOLEAN_DEFS_JSON__` (from `booleanDefs`):

```javascript
const TARGET_NODE_ID = '__NODE_ID__';
const SUB_COMPONENTS = __SUB_COMPONENTS_JSON__;
const BOOLEAN_DEFS = __BOOLEAN_DEFS_JSON__;
const VARIANT_AXES = __VARIANT_AXES_JSON__;

function rv(v) { return Math.round(v * 10) / 10; }

function makeDisplay(value, token) {
  if (token) return token + ' (' + value + ')';
  return String(value);
}

async function resolveBinding(node, prop) {
  const bindings = node.boundVariables;
  if (!bindings || !bindings[prop]) return null;
  const binding = Array.isArray(bindings[prop]) ? bindings[prop][0] : bindings[prop];
  if (!binding?.id) return null;
  try {
    const v = await figma.variables.getVariableByIdAsync(binding.id);
    if (v) return v.name;
  } catch {}
  return null;
}

function collapsePadding(pT, pB, pS, pE, tT, tB, tS, tE) {
  const vT = rv(pT || 0), vB = rv(pB || 0);
  const vS = rv(pS || 0), vE = rv(pE || 0);
  if (vT === vB && vS === vE && vT === vS && tT === tB && tS === tE && tT === tS) {
    return { value: vT, token: tT || null, display: makeDisplay(vT, tT) };
  }
  if (vT === vB && vS === vE && tT === tB && tS === tE) {
    return {
      vertical: { value: vT, token: tT || null, display: makeDisplay(vT, tT) },
      horizontal: { value: vS, token: tS || null, display: makeDisplay(vS, tS) }
    };
  }
  return {
    top: { value: vT, token: tT || null, display: makeDisplay(vT, tT) },
    bottom: { value: vB, token: tB || null, display: makeDisplay(vB, tB) },
    start: { value: vS, token: tS || null, display: makeDisplay(vS, tS) },
    end: { value: vE, token: tE || null, display: makeDisplay(vE, tE) }
  };
}

function collapseCornerRadius(tl, tr, bl, br, tTL, tTR, tBL, tBR) {
  if (tl === tr && tr === bl && bl === br && tTL === tTR && tTR === tBL && tBL === tBR) {
    return { value: tl, token: tTL || null, display: makeDisplay(tl, tTL) };
  }
  return {
    topStart: { value: tl, token: tTL || null, display: makeDisplay(tl, tTL) },
    topEnd: { value: tr, token: tTR || null, display: makeDisplay(tr, tTR) },
    bottomStart: { value: bl, token: tBL || null, display: makeDisplay(bl, tBL) },
    bottomEnd: { value: br, token: tBR || null, display: makeDisplay(br, tBR) }
  };
}

async function measureNode(node) {
  const m = {};
  const props = ['width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'itemSpacing', 'counterAxisSpacing'];
  for (const p of props) {
    if (node[p] !== undefined && node[p] !== null && node[p] !== figma.mixed) {
      const token = await resolveBinding(node, p);
      const v = rv(node[p]);
      m[p] = { value: v, token: token || null, display: makeDisplay(v, token) };
    }
  }

  const tPT = await resolveBinding(node, 'paddingTop');
  const tPB = await resolveBinding(node, 'paddingBottom');
  const tPS = await resolveBinding(node, 'paddingLeft');
  const tPE = await resolveBinding(node, 'paddingRight');
  if (node.paddingTop !== undefined || node.paddingBottom !== undefined || node.paddingLeft !== undefined || node.paddingRight !== undefined) {
    m.padding = collapsePadding(node.paddingTop, node.paddingBottom, node.paddingLeft, node.paddingRight, tPT, tPB, tPS, tPE);
  }

  if (node.cornerRadius !== undefined && node.cornerRadius !== null) {
    if (node.cornerRadius === figma.mixed) {
      const tTL = await resolveBinding(node, 'topLeftRadius');
      const tTR = await resolveBinding(node, 'topRightRadius');
      const tBL = await resolveBinding(node, 'bottomLeftRadius');
      const tBR = await resolveBinding(node, 'bottomRightRadius');
      m.cornerRadius = collapseCornerRadius(
        rv(node.topLeftRadius || 0), rv(node.topRightRadius || 0),
        rv(node.bottomLeftRadius || 0), rv(node.bottomRightRadius || 0),
        tTL, tTR, tBL, tBR
      );
    } else {
      const token = await resolveBinding(node, 'cornerRadius');
      const v = rv(node.cornerRadius);
      m.cornerRadius = { value: v, token: token || null, display: makeDisplay(v, token) };
    }
  }

  if (node.strokeWeight !== undefined && node.strokeWeight !== null) {
    if (node.strokeWeight === figma.mixed) {
      const sides = {};
      for (const s of ['strokeTopWeight', 'strokeBottomWeight', 'strokeLeftWeight', 'strokeRightWeight']) {
        if (node[s] !== undefined) {
          const logicalKey = s.replace('strokeTopWeight', 'top').replace('strokeBottomWeight', 'bottom').replace('strokeLeftWeight', 'start').replace('strokeRightWeight', 'end');
          sides[logicalKey] = { value: rv(node[s]), token: null, display: String(rv(node[s])) };
        }
      }
      m.strokeWeight = sides;
    } else {
      const token = await resolveBinding(node, 'strokeWeight');
      const v = rv(node.strokeWeight);
      m.strokeWeight = { value: v, token: token || null, display: makeDisplay(v, token) };
    }
  }

  if (node.layoutMode && node.layoutMode !== 'NONE') m.layoutMode = { value: node.layoutMode, token: null, display: node.layoutMode };
  if (node.layoutSizingHorizontal) m.layoutSizingHorizontal = { value: node.layoutSizingHorizontal, token: null, display: node.layoutSizingHorizontal };
  if (node.layoutSizingVertical) m.layoutSizingVertical = { value: node.layoutSizingVertical, token: null, display: node.layoutSizingVertical };

  if (node.type === 'TEXT') {
    if (node.textStyleId && typeof node.textStyleId === 'string' && node.textStyleId !== '') {
      try {
        const style = await figma.getStyleByIdAsync(node.textStyleId);
        if (style) m.typography = { styleName: style.name };
      } catch {}
    } else {
      const typo = {};
      if (typeof node.fontSize === 'number') typo.fontSize = node.fontSize;
      if (typeof node.fontName === 'object') typo.fontWeight = node.fontName.style;
      if (node.lineHeight && typeof node.lineHeight === 'object' && node.lineHeight.unit !== 'AUTO') typo.lineHeight = node.lineHeight.value;
      if (Object.keys(typo).length > 0) m.typography = typo;
    }
  }
  return m;
}

async function measureChildren(container, enableBools) {
  if (enableBools && Object.keys(enableBools).length > 0) {
    try { container.setProperties(enableBools); } catch {}
  }
  const result = {};
  for (const child of container.children) {
    if (!child.visible && !enableBools) continue;
    result[child.name] = await measureNode(child);
    if ('children' in child && child.children.length > 0 && child.type !== 'INSTANCE') {
      const nested = await measureChildren(child, null);
      if (Object.keys(nested).length > 0) result[child.name + '.__children'] = nested;
    }
  }
  return result;
}

async function loadAllFonts(rootNode) {
  const textNodes = rootNode.findAll(n => n.type === 'TEXT');
  const fontSet = new Set();
  const fontsToLoad = [];
  for (const tn of textNodes) {
    try {
      const fn = tn.fontName;
      if (fn && fn !== figma.mixed && fn.family) {
        const key = fn.family + '|' + fn.style;
        if (!fontSet.has(key)) { fontSet.add(key); fontsToLoad.push(fn); }
      }
    } catch {}
  }
  await Promise.all(fontsToLoad.map(f => figma.loadFontAsync(f).catch(() => {})));
}

const compSet = await figma.getNodeByIdAsync(TARGET_NODE_ID);
if (!compSet) return { error: 'Node not found' };
const isCS = compSet.type === 'COMPONENT_SET';
const allVariants = isCS ? compSet.children : [compSet];
const axes = {};
if (isCS && compSet.variantGroupProperties) {
  for (const [k, v] of Object.entries(compSet.variantGroupProperties)) axes[k] = v.values;
}

const sizeAxis = Object.keys(axes).find(a => /size/i.test(a));
const stateAxis = Object.keys(axes).find(a => /state/i.test(a));

const defaultVariant = isCS ? (compSet.defaultVariant || compSet.children[0]) : compSet;
const defaultVProps = isCS ? (defaultVariant.variantProperties || {}) : {};
const defaultValues = {};
for (const [axis, vals] of Object.entries(axes)) {
  defaultValues[axis] = defaultVProps[axis] || vals[0];
}

const rootDimensions = {};
const subComponentDimensions = {};
const slotContentDimensions = {};
const SLOT_CONTENTS = __SLOT_CONTENTS_JSON__;

const sizeValues = sizeAxis ? axes[sizeAxis] : [null];
for (const sizeVal of sizeValues) {
  const targetProps = { ...defaultValues };
  if (sizeAxis && sizeVal) targetProps[sizeAxis] = sizeVal;

  const variant = isCS ? allVariants.find(v => {
    const vp = v.variantProperties || {};
    return Object.entries(targetProps).every(([k, val]) => vp[k] === val);
  }) : allVariants[0];
  if (!variant) continue;

  const label = sizeVal || variant.name;
  rootDimensions[label] = await measureNode(variant);

  const inst = variant.createInstance();
  const enableAll = {};
  for (const key of Object.keys(BOOLEAN_DEFS)) enableAll[key] = true;
  try { inst.setProperties(enableAll); } catch {}

  for (const sc of SUB_COMPONENTS) {
    const subInst = inst.findOne(n => n.name === sc.name && n.type === 'INSTANCE');
    if (subInst) {
      if (!subComponentDimensions[sc.name]) subComponentDimensions[sc.name] = {};
      const boolOverrides = {};
      for (const key of Object.keys(sc.booleanOverrides || {})) boolOverrides[key] = true;
      subComponentDimensions[sc.name][label] = {
        self: await measureNode(subInst),
        children: await measureChildren(subInst, boolOverrides)
      };
    }
  }

  for (const slot of SLOT_CONTENTS) {
    if (!slot.preferredComponents || slot.preferredComponents.length === 0) continue;
    if (!slotContentDimensions[slot.slotName]) slotContentDimensions[slot.slotName] = {};
    const slotNode = inst.findOne(n => n.type === 'SLOT' && n.name === slot.slotName);
    if (!slotNode) continue;
    for (const pref of slot.preferredComponents) {
      if (!slotContentDimensions[slot.slotName][pref.componentName]) {
        slotContentDimensions[slot.slotName][pref.componentName] = {};
      }
      const prefComp = await figma.getNodeByIdAsync(pref.componentId);
      if (!prefComp || prefComp.type !== 'COMPONENT') continue;
      const prefInst = prefComp.createInstance();
      while (slotNode.children.length > 0) slotNode.children[0].remove();
      slotNode.appendChild(prefInst);
      await loadAllFonts(inst);
      slotContentDimensions[slot.slotName][pref.componentName][label] = {
        self: await measureNode(prefInst),
        slotContext: await measureNode(slotNode)
      };
    }
  }

  inst.remove();
}

let stateComparison = null;
if (stateAxis && axes[stateAxis].length > 1) {
  stateComparison = {};
  for (const stateVal of axes[stateAxis]) {
    const targetProps = { ...defaultValues, [stateAxis]: stateVal };
    const variant = allVariants.find(v => {
      const vp = v.variantProperties || {};
      return Object.entries(targetProps).every(([k, val]) => vp[k] === val);
    });
    if (variant) stateComparison[stateVal] = await measureNode(variant);
  }
}

return {
  rootDimensions,
  subComponentDimensions,
  slotContentDimensions,
  stateComparison,
  sizeAxis: sizeAxis || null,
  stateAxis: stateAxis || null
};
```

Save the returned JSON. Replace `__VARIANT_AXES_JSON__` with the `variantAxes` object from Step 4b extraction. Replace `__SLOT_CONTENTS_JSON__` with the `slotContents` array from Step 4b extraction. This script provides:
- **`rootDimensions`** — keyed by size/variant label, full measurements of the root component at each size (at default state and default values for all other axes). Uses the same representative variant strategy as Step 4b — only one variant per size value, not all permutations.
- **`subComponentDimensions`** — keyed by sub-component name, then by size label, with `self` (the sub-component's own measurements) and `children` (its internal children's measurements, with booleans enabled). Every sub-component discovered in Step 4b is measured across all sizes.
- **`slotContentDimensions`** — keyed by slot name → preferred component name → size label, with `self` (the preferred component's measurements after being placed inside the slot) and `slotContext` (the SLOT node's own measurements after content insertion and auto-layout reflow). Only populated when `slotContents` contains entries with `preferredComponents`. **Use `self` only to identify placement-specific deltas from the preferred component's standalone defaults. Do not treat `self` as a second full structure spec for the preferred component. Use `slotContext` for hosting-container properties.**
- **`stateComparison`** — measurements of the root at the default size across all state values. Use this to detect state-conditional properties (e.g., border appears on focus).
- All measurements use the same collapsed dimensional model as Step 4b: `padding` as uniform / `{ vertical, horizontal }` / `{ top, bottom, start, end }`, collapsed `cornerRadius`, collapsed `strokeWeight`, and `typography` as composite `{ styleName }` or `{ fontSize, fontWeight, ... }`.

**4e. Non-dimensional axis diff** — Run this script via `figma_execute` to measure root and direct children properties across every variant axis NOT already covered by Steps 4b–4d (i.e., not size/density/shape). This is a data-gathering step only — classification happens in Step 6. Replace `__NODE_ID__`, `__VARIANT_AXES_JSON__`, `__BOOLEAN_DEFS_JSON__`, and `__DIMENSION_AXES_LIST__` (a JSON array of axis names already handled, e.g., `["size"]`):

```javascript
const TARGET_NODE_ID = '__NODE_ID__';
const VARIANT_AXES = __VARIANT_AXES_JSON__;
const BOOLEAN_DEFS = __BOOLEAN_DEFS_JSON__;
const DIMENSION_AXES = __DIMENSION_AXES_LIST__;

function rv(v) { return Math.round(v * 10) / 10; }

function md(value, token) {
  if (token) return token + ' (' + value + ')';
  return String(value);
}

async function resolveBinding(node, prop) {
  try {
    const bindings = node.boundVariables;
    if (!bindings || !bindings[prop]) return null;
    const binding = Array.isArray(bindings[prop]) ? bindings[prop][0] : bindings[prop];
    if (!binding?.id) return null;
    const v = await figma.variables.getVariableByIdAsync(binding.id);
    if (v) return v.name;
  } catch {}
  return null;
}

async function measureNode(node) {
  const m = {};
  const isContainer = 'layoutMode' in node;
  const props = ['minWidth', 'maxWidth', 'minHeight', 'maxHeight'];
  if (isContainer) props.push('itemSpacing');
  for (const p of props) {
    try {
      const val = node[p];
      if (val !== undefined && val !== null && val !== figma.mixed) {
        const token = await resolveBinding(node, p);
        m[p] = { value: rv(val), token: token || null, display: md(rv(val), token) };
      }
    } catch {}
  }
  if (isContainer) {
    try {
      const tPS = await resolveBinding(node, 'paddingLeft');
      const tPE = await resolveBinding(node, 'paddingRight');
      const tPT = await resolveBinding(node, 'paddingTop');
      const tPB = await resolveBinding(node, 'paddingBottom');
      m.paddingTop = { value: rv(node.paddingTop || 0), token: tPT || null };
      m.paddingBottom = { value: rv(node.paddingBottom || 0), token: tPB || null };
      m.paddingStart = { value: rv(node.paddingLeft || 0), token: tPS || null };
      m.paddingEnd = { value: rv(node.paddingRight || 0), token: tPE || null };
    } catch {}
    try { m.layoutMode = node.layoutMode; } catch {}
    try { m.layoutSizingHorizontal = node.layoutSizingHorizontal; } catch {}
    try { m.layoutSizingVertical = node.layoutSizingVertical; } catch {}
  }
  try {
    if ('cornerRadius' in node && node.cornerRadius !== undefined && node.cornerRadius !== figma.mixed) {
      m.cornerRadius = { value: rv(node.cornerRadius) };
    }
  } catch {}
  try {
    if ('strokeWeight' in node && node.strokes && node.strokes.length > 0) {
      m.strokeWeight = { value: rv(node.strokeWeight) };
    } else if ('strokeWeight' in node) {
      m.strokeWeight = { value: 0 };
    }
  } catch {}
  return m;
}

async function measureChildSummary(container) {
  const children = [];
  if (!('children' in container)) return children;
  for (const child of container.children) {
    const entry = { name: child.name, type: child.type, visible: child.visible };
    entry.dims = await measureNode(child);
    children.push(entry);
  }
  return children;
}

const compSet = await figma.getNodeByIdAsync(TARGET_NODE_ID);
if (!compSet) return { error: 'Node not found' };

let _p = compSet; while (_p.parent && _p.parent.type !== 'DOCUMENT') _p = _p.parent;
if (_p.type === 'PAGE') await figma.setCurrentPageAsync(_p);

const isCS = compSet.type === 'COMPONENT_SET';
const allVariants = isCS ? compSet.children : [compSet];

const defaultVariant = isCS ? (compSet.defaultVariant || compSet.children[0]) : compSet;
const defaultVProps = isCS ? (defaultVariant.variantProperties || {}) : {};
const defaultValues = {};
for (const [axis, vals] of Object.entries(VARIANT_AXES)) {
  defaultValues[axis] = defaultVProps[axis] || vals[0];
}

const axisDiffs = {};
const axesToCheck = Object.keys(VARIANT_AXES).filter(a => !DIMENSION_AXES.includes(a));

for (const axis of axesToCheck) {
  axisDiffs[axis] = {};
  for (const val of VARIANT_AXES[axis]) {
    const targetProps = { ...defaultValues, [axis]: val };
    const variant = allVariants.find(v => {
      const vp = v.variantProperties || {};
      return Object.entries(targetProps).every(([k, tv]) => vp[k] === tv);
    });
    if (!variant) { axisDiffs[axis][val] = null; continue; }

    const inst = variant.createInstance();
    const enableAll = {};
    for (const key of Object.keys(BOOLEAN_DEFS)) enableAll[key] = true;
    try { inst.setProperties(enableAll); } catch {}

    axisDiffs[axis][val] = {
      root: await measureNode(inst),
      children: await measureChildSummary(inst)
    };
    inst.remove();
  }
}

return { axisDiffs };
```

Save the returned `axisDiffs`. This provides raw measurements for every non-dimensional axis value — root node properties and direct children with their names, types, visibility, and key dimensions. **Do not classify axes at this step.** The AI interpretation layer in Step 6 will reason about the diffs to determine which axes are structural, property-variant, or visual-only.

**Targeted follow-up for structural axes:** After Step 6 classifies an axis as structural (children differ across values), you must re-run the cross-variant dimensional comparison (Step 4d script) once for each structurally distinct configuration. For example, if `layout` is structural with values `label` and `icon-only`, run the Step 4d script twice — once with `layout=label` pinned and once with `layout=icon-only` pinned — varying the size axis in each run. This gives you complete dimensional data for each configuration across all sizes, which feeds into separate sections in Step 7.

### Step 5: Navigate to Destination

If the user provided a separate destination file URL:
- `figma_navigate` — Switch to the destination file

If no destination was provided, stay in the current file.

### Step 6: AI Interpretation Layer

This is the core quality step. You have complete, structured data from Steps 4b-4e. Instead of writing `figma_execute` queries, you focus on high-value reasoning tasks that directly improve spec quality for engineers.

**Input:** The extraction data (4b), cross-variant dimensional comparison (4d), variable mode data (4c), and non-dimensional axis diffs (4e).

**A. Build the section plan:**

Apply these deterministic rules to the extraction and cross-variant data, then validate and adjust the result using your judgment about the component's actual structure.

**Rules (apply in order):**

1. **Variant axes with purely numeric differences → columns.** For each variant axis from `variantAxes`, compare `rootDimensions` across values. If all values have the same set of properties and differ only numerically, make this axis a set of columns (e.g., Size → "Large", "Medium", "Small", "XSmall" columns).

1b. **Variant axes with identical values → still columns.** When the extraction returns multiple variants along an axis but all dimensional values are identical, use those variants as columns anyway. Identical values across columns communicate intentional structural consistency to engineers. Do not collapse to a single "Default" column. This applies especially when no dimension-affecting axes (size/density/shape) exist and the extraction falls back to the component's primary functional axis (e.g., checked/unchecked/indeterminate, expanded/collapsed, on/off).

1c. **Reason about non-dimensional axis diffs.** Using the raw `axisDiffs` from Step 4e, compare measurements across each axis and classify:

   - **Structural axis** (children differ — different names, count, or visibility across values): Each structurally distinct configuration needs its own full extraction and section(s). Re-run the Step 4d cross-variant script scoped to each configuration (see Step 4e follow-up instructions), then create separate sections for each. If the component also has a size axis, each configuration is documented across all sizes. Example: `layout=icon-only` has different children than `layout=label` — extract dimensions for both configurations and create separate sections.

   - **Property-variant axis** (same children, but dimensional properties differ — strokeWeight appears/disappears, cornerRadius changes, padding differs, sizing mode changes): Create a state-conditional section documenting which values have which property differences. Group values with identical properties into columns. Example: `variant=secondary` adds `strokeWeight=1` while `primary`/`ghost`/`subtle` have none — one section with columns showing the difference.

   - **Visual-only axis** (same children, same dimensional properties — only fills, effects, opacity change): Skip. No section needed.

   Use judgment for edge cases: a 0.5px rounding difference is noise, but `strokeWeight` going from 0 to 1 is meaningful. If multiple values along an axis share the same diff (e.g., `secondary` and `backgroundSafe` both add the same border), group them as columns rather than creating separate sections.

   **Dedup with `stateComparison`:** If an axis is already covered by `stateComparison` (Step 4d — axes matching `/state/i`), prefer `stateComparison` for Rule 4 and skip creating a duplicate section from `axisDiffs` for that axis. However, still check the `axisDiffs` children data — if children differ across that axis (structural change), escalate it to a structural axis, which supersedes the `stateComparison` section.

2. **Treat extraction outputs as candidates, not final section types.** `subComponents`, `slotContents`, `enrichedTree`, and `layoutTree` are discovery inputs for planning. Do **not** assume that an item belongs to a final section type just because it first appeared in one extraction array.

2a. **Resolve ownership before creating any sections.** For each candidate instance discovered in `subComponents`, `slotContents`, or the relevant structural zones of `enrichedTree`, classify it once onto exactly one path: `subComponent`, `slotContent`, or composition/root-only.

2b. **Ownership rule before slot classification.** If an instance is a **parent-owned structural role** in the component architecture, classify it as a `subComponent` even if it is placed via a slot or slot-like composition. If an instance is **library-owned** or generic **preferred slot content**, keep it on the `slotContent` path. Treat file-locality as a supporting signal only — ownership and engineering responsibility win over whether the instance is defined in the same file.

2c. **Deduplicate overlapping candidates.** If the same concept appears in both `subComponents` and `slotContents.preferredComponents`, resolve it once using Rule 2b and emit **at most one** section path for it. Do not generate both a `subComponent` section and a `slotContent` section for the same owned role.

2d. **Sub-components → separate sections.** After ownership resolution, each remaining `subComponent` gets its own section. The section's columns match the parent's size axis (or the sub-component's own size axis if it has one). Use `subComponentDimensions[name]` for the row data.

3. **2+ sub-components with own size variants → composition section.** If `subComponents` has 2+ entries where `subCompVariantAxes` contains a size-like axis, create a composition section as the first section. Map parent size → sub-component variant for each sub-component.

4. **State axis with new properties → state-conditional section.** Compare `stateComparison` entries: if any state introduces a property not present in the default state (especially `strokeWeight` appearing or changing), create a state-conditional section.

5. **Layout tree for container hierarchy.** Use the `layoutTree` from the default variant to identify which containers are structurally significant (have their own padding/spacing). Containers that are pass-through wrappers (no padding, no spacing, single child) can be omitted.

6. **Slot preferred content → `slotContent` sections.** For each entry in `slotContents` that has `preferredComponents`, create one section per preferred component **only when the preferred instance is still classified as `slotContent` after Rules 2a-2c**. The section name follows the pattern `"{slotName} — {componentName}"` (e.g., "Leading content — Checkbox"). Columns match the parent's size axis. Data source is `slotContentDimensions.{slotName}.{componentName}`. Section description notes the slot relationship: `"Dimensional properties when {componentName} is placed in the {slotName} slot. See {componentName} spec for component internals."` Place these sections after regular sub-component sections but before state-conditional sections. **These sections document only hosting context and slot-imposed deltas. Do not emit the preferred component's own internal structure from `self`. Prefer container rows such as `Container`, contextual padding, contextual widthMode/heightMode, and a reference row like `Text button instance` / `Checkbox instance`.**

**Produce a `sectionPlan` array** with this shape:
```
sectionPlan = [
  {
    sectionType: "composition" | "variant" | "subComponent" | "stateConditional" | "slotContent",
    sectionName: string,
    sectionDescription: string | null,
    columns: string[],           // e.g., ["Spec", "Large", "Medium", "Small", "Notes"]
    subCompSetId: string | null, // for subComponent sections
    booleanOverrides: object,    // for subComponent sections
    variantAxis: string | null,  // axis name for variant sections
    dataSource: string,          // "rootDimensions" | "subComponentDimensions.Name" | "stateComparison" | "slotContentDimensions.SlotName.CompName"
    preferredComponentId: string | null,      // for slotContent sections — the preferred component's own component set ID (or component ID if not in a set)
    preferredComponentSetId: string | null,    // for slotContent sections — the preferred component's component set ID (for preview sourcing)
    slotName: string | null                   // for slotContent sections — the SLOT property name
  },
  ...
]
```

**Ordering:** Composition section first (if any), then root/variant sections, then sub-component sections in the order they appear in the enriched tree (visual order: leading → middle → trailing), then slot content sections (grouped by slot: leading → trailing, one per preferred component), then state-conditional sections last.

**Then validate the plan against the full data:**
- Does every auto-layout container in the extraction have its padding and spacing covered by a section?
- Does every instance that remains classified as a `subComponent` after Rules 2a-2c have a section?
- Are there dimensional properties in the extraction that are not included in any section (and should they be)?
- Should any sections be merged, split, or reordered based on the component's actual structure?
- For behavior/configuration variant axes (e.g., Static vs Interactive): use the default configuration for the preview. If border/stroke differs between configurations, add a row — don't create a separate section unless the property sets are fundamentally different.
- For `slotContent` sections: are the rows limited to hosting context and placement-specific deltas, with no duplicated internals from the preferred component's own spec?
- If an instance appears in or near a slot, was it classified on the correct path first (`subComponent` for parent-owned structural roles, `slotContent` for library/preferred content)?
- If the same instance surfaced through multiple discovery paths, was it emitted on exactly one section path after ownership resolution?

Produce the final `sectionPlan` with any adjustments.

**B. Write design-intent notes:**

For each property row you will generate, write notes that answer **"why this value?"** not just **"what is this property?"**. You have full dimensional data across all variants and sub-components — use it.

| Instead of this | Write this |
|---|---|
| "Tap target" | "Meets WCAG 2.5.8 minimum touch target with 12 optical margin" |
| "Inset from edges" | "Accommodates multi-line secondary text at spacious density" |
| "Pill shape" | "Uses half of minHeight — pill shape scales with container height" |
| "Icon size" | "Matches the platform icon grid used by the system" |
| "Gap between icon and label" | "Scales with size axis: 4→6→8→8 maintains optical balance at each size" |

Use the cross-variant data to identify scaling patterns and explain them in notes.

**C. Cross-section pattern recognition:**

After reviewing all sections together, identify and document:
- **General notes** describing system-wide patterns: e.g., "All sub-components share the `spacing-inset-*` token family for horizontal padding, scaling from 12 (compact) to 20 (spacious)"
- **Consistency observations** in section descriptions: e.g., "Leading and trailing content slots have identical minWidth and alignment — designed as symmetrical containers"
- **Cross-references between sections** when one section's values explain another's: e.g., "Composition section shows Label uses `small` variant at XSmall parent size — this is why the Label section's XSmall column has different padding than other sizes"

These observations go into `generalNotes` and `sectionDescription` fields.

**D. Anomaly detection:**

Before generating structured data, scan the extraction and cross-variant data for:
- **Scaling inconsistencies:** A sub-component whose minHeight doesn't scale with the parent's size axis — intentional or a design bug? Flag in notes.
- **Token misconfiguration:** A token binding that resolves to the same value across all density modes — the token exists but doesn't differentiate. Note it.
- **Asymmetric padding without explanation:** paddingStart=16, paddingEnd=12 — optical correction or mistake? If intentional, the note should explain why.
- **Missing token bindings:** A hardcoded value surrounded by token-bound siblings — was the binding missed, or is it intentionally hardcoded? Flag for engineering awareness.
- **Stroke/border state changes:** Compare `stateComparison` data — does a border appear, disappear, or change weight between states? Flag as a state-conditional section candidate if not already in the plan.

Add anomaly notes to the relevant row's `notes` field or to `generalNotes` for component-wide issues.

**E. Completeness judgment:**

Before proceeding, verify:
- Does every auto-layout container in the extraction have its padding and spacing documented in a section row? **Verification procedure:** For each sub-component section, walk `subComponentDimensions[name][size].children` — including all nested `__children` entries. Every entry with non-zero `padding` (uniform, symmetric, or per-side) is an auto-layout container that needs a corresponding group with its own rows. Watch for content areas (e.g., `leadingContent`, `trailingContent`) that have zero padding themselves but contain child wrapper frames (e.g., `icon`, `label`, `clear action`) each with their own padding — each wrapper must be its own group, not collapsed into a note on the parent. When `enrichedTree` is available (not truncated), cross-check it recursively for the same pattern.
- Does every instance that remains classified as a `subComponent` after Rules 2a-2c have its own section?
- Are there dimensional properties present in `rootDimensions` or `subComponentDimensions` that were not included in any row?
- For composition sections: does every sub-component's size mapping cover all parent sizes?
- Are typography styles documented for every TEXT node the section actually owns? Do **not** satisfy this by copying preferred slot children's typography into `slotContent` sections when that typography belongs to the preferred component's own spec.

If gaps exist that cannot be filled from the extraction data, add a note in `generalNotes`: e.g., "Trailing content slot dimensions not documented — slot was empty in all inspected variants."

The instruction file (`agent-structure-instruction.md`, "Interpretation Quality Guidance" section) contains additional detail and examples for each of these steps.

### Step 6b: Targeted Extractions for Structural Axes

If Rule 1c classified any axis as structural (children differ across values), run the targeted follow-up extractions now. For each structurally distinct configuration, re-run the Step 4d cross-variant script with that configuration pinned (e.g., `layout=icon-only` pinned while varying the size axis). Store the results alongside the original `rootDimensions` / `subComponentDimensions`, keyed by configuration (e.g., `rootDimensions_iconOnly`, `subComponentDimensions_iconOnly`). This data feeds into Step 7 for generating separate sections per structural configuration.

If no structural axes were identified, skip this step.

### Step 7: Generate Structured Data

Using the section plan from Step 6, the complete dimensional data from Steps 4b-4e (including any targeted structural-axis extractions from Step 6b), build the structured data object.

Follow the schema in the instruction file:
- `componentName`: string
- `generalNotes`: string (optional) — include cross-section patterns and component-wide anomalies from Step 6
- `sections`: array, each with:
  - `sectionName`: string
  - `sectionDescription`: string (optional) — include structural rationale from Step 6, not generic labels
  - `columns`: string[] (first is always "Spec" or "Composition", last is always "Notes")
  - `rows`: array, each with `spec`, `values` (array matching columns.length - 2), `notes` (design-intent from Step 6), optional `isSubProperty`, `isLastInGroup`

**Populating rows from dimensional data:**

For each section in the plan:
- Look up the `dataSource` to find the right dimensional data object (`rootDimensions`, `subComponentDimensions.Name`, `slotContentDimensions.SlotName.CompName`, or `stateComparison`).
- For each column value (e.g., "Large", "Medium"), read the measurements at that key.
- Use the `display` field directly from the dimensional data as the cell value — this already handles `"token-name (value)"` vs `"value"` formatting.
- For collapsed padding: if `padding` is a single value, emit one `padding` row. If `{ vertical, horizontal }`, emit `verticalPadding` and `horizontalPadding` rows. If `{ top, bottom, start, end }`, emit individual `paddingTop`, `paddingBottom`, `paddingStart`, `paddingEnd` rows.
- For collapsed cornerRadius: if uniform, emit one `cornerRadius` row. If per-corner, emit `cornerRadiusTopStart`, `cornerRadiusTopEnd`, etc.
- For typography: if `{ styleName }`, emit one `textStyle` row with the style name. If inline properties, emit `fontSize`, `fontWeight`, `lineHeight` rows.

**Override for `slotContent` sections:**
- Treat `slotContext` as the primary source for hosting-container rows.
- Use `self` only for values that are **different from the preferred component's standalone defaults because of slot placement**.
- Do **not** emit a full row set from `self`. Skip the preferred component's own internal padding, cornerRadius, borderWidth, icon sizes, internal spacing, and typography when those belong to the preferred component's own spec.
- Prefer a structure like `Container` group rows for hosting context, followed by a reference row such as `Text button instance` / `Checkbox instance` with notes like `"See Button component API"` or `"See Checkbox spec for internals"`.
- If no meaningful `self` deltas exist, emit only hosting-container rows and the reference row.

Ensure:
- First column is always "Spec" (or "Composition" for composition sections), last is always "Notes"
- `values` array length matches `columns.length - 2`
- Use `isSubProperty: true` for child properties
- Notes contain design-intent reasoning from Step 6, not generic descriptions

### Step 8: Audit

Re-read the instruction file, focusing on:
- **Common Mistakes** section
- **Do NOT** section
- **Property naming** (camelCase, no platform units)

Check your output against each rule. Fix any violations.

Explicitly audit:
- If a section description says `See X spec`, no table rows may restate X's own internal structure.
- If a section is `slotContent`, confirm the table documents hosting context and placement-specific deltas only.

### Step 9: Import and Detach Template

**If the user provided a cross-file destination URL** (navigated in Step 5), run via `figma_execute`:

```javascript
const TEMPLATE_KEY = '__STRUCTURE_TEMPLATE_KEY__';

const templateComponent = await figma.importComponentByKeyAsync(TEMPLATE_KEY);
const instance = templateComponent.createInstance();
const { x, y } = figma.viewport.center;
instance.x = x - instance.width / 2;
instance.y = y - instance.height / 2;
const frame = instance.detachInstance();
frame.name = '__COMPONENT_NAME__ Structure';
figma.currentPage.selection = [frame];
figma.viewport.scrollAndZoomIntoView([frame]);
return { frameId: frame.id };
```

**If no destination was provided (default)**, run via `figma_execute` — this places the spec on the component's page, to its right:

```javascript
const TEMPLATE_KEY = '__STRUCTURE_TEMPLATE_KEY__';
const COMP_NODE_ID = '__COMPONENT_NODE_ID__';

const compNode = await figma.getNodeByIdAsync(COMP_NODE_ID);
let _p = compNode;
while (_p.parent && _p.parent.type !== 'DOCUMENT') _p = _p.parent;
if (_p.type === 'PAGE') await figma.setCurrentPageAsync(_p);

const templateComponent = await figma.importComponentByKeyAsync(TEMPLATE_KEY);
const instance = templateComponent.createInstance();
const frame = instance.detachInstance();

const GAP = 200;
frame.x = compNode.x + compNode.width + GAP;
frame.y = compNode.y;

frame.name = '__COMPONENT_NAME__ Structure';
figma.currentPage.selection = [frame];
figma.viewport.scrollAndZoomIntoView([frame]);
return { frameId: frame.id, pageId: _p.id, pageName: _p.name };
```

Replace `__COMPONENT_NODE_ID__` with the node ID extracted from the component URL (same as `TARGET_NODE_ID` from Step 4b).

Save the returned `frameId` — you need it for all subsequent steps.

**Cross-file note:** If the component is in a different file than the destination, the extraction script (Step 4b) must run in the component's file before navigating to the destination (Step 5). The template import above uses `importComponentByKeyAsync` which works across files.

### Step 10: Fill Header Fields

Run via `figma_execute` (replace `__FRAME_ID__`, `__COMPONENT_NAME__`, and `__GENERAL_NOTES__`):

```javascript
const frame = await figma.getNodeByIdAsync('__FRAME_ID__');
const textNodes = frame.findAll(n => n.type === 'TEXT');
const fontSet = new Set();
const fontsToLoad = [];
for (const tn of textNodes) {
  try {
    const fn = tn.fontName;
    if (fn && fn !== figma.mixed && fn.family) {
      const key = fn.family + '|' + fn.style;
      if (!fontSet.has(key)) { fontSet.add(key); fontsToLoad.push(fn); }
    }
  } catch {}
}
await Promise.all(fontsToLoad.map(f => figma.loadFontAsync(f).catch(() => {})));

const compNameFrame = frame.findOne(n => n.name === '#compName');
if (compNameFrame) {
  const t = compNameFrame.findOne(n => n.type === 'TEXT');
  if (t) t.characters = '__COMPONENT_NAME__';
}

const notesFrame = frame.findOne(n => n.name === '#general-structure-notes');
if (notesFrame) {
  const hasNotes = __HAS_GENERAL_NOTES__;
  if (!hasNotes) {
    notesFrame.visible = false;
  } else {
    const t = notesFrame.findOne(n => n.type === 'TEXT');
    if (t) t.characters = '__GENERAL_NOTES__';
  }
}

return { success: true };
```

Replace `__HAS_GENERAL_NOTES__` with `true` or `false`. If `false`, the general notes frame is hidden.

### Step 11: Render Sections (table + preview per section)

Process **one section at a time**, completing both the table and its preview before moving to the next section. For each section, perform sub-steps 11a, 11b, and 11c in order.

#### Step 11a: Determine preview parameters for this section

Before rendering, determine the preview configuration for the current section. This is **mandatory** — every section needs its own preview showing relevant variant instances.

**Preview parameter decision table:**

| Section type | `SUB_COMP_SET_ID` | `VARIANT_AXIS` | `COLUMN_VALUES` | `PROPERTY_OVERRIDES` | `SUB_COMP_OVERRIDES` |
|---|---|---|---|---|---|
| **Size/variant** (columns are size names like Large, Medium, Small) | `''` | The axis name (e.g., `"Size"`) | Size names from the axis | Enable all parent-level booleans from `booleanDefs` to `true` so all documented children are visible in the preview | `[]` |
| **Density** (columns are density modes from variable collections) | `''` | `''` | Mode names (e.g., `["Compact", "Default", "Spacious"]`) | Enable all parent-level booleans from `booleanDefs` to `true` so all documented children are visible in the preview | `[]` |
| **Shape** (columns are shape variants) | `''` | The axis name (e.g., `"Shape"`) | Shape names from the axis | Enable all parent-level booleans from `booleanDefs` to `true` so all documented children are visible in the preview | `[]` |
| **Sub-component** (columns are size names showing a specific child) | The sub-component's own component set ID (from `subComponents[].subCompSetId` in Step 4b extraction) | The sub-component's size axis name (from `subComponents[].subCompVariantAxes`) | Size names from the sub-component's own size axis | `[]` | Boolean properties to enable on each sub-component instance so all internal children are visible (from `subComponents[].booleanOverrides` in Step 4b — set all values to `true`) |
| **Composition** (columns show sub-component variant mappings) | `''` | `''` | Size names | Configure each column's specific property combination | `[]` |
| **Behavior/Configuration** (columns are size names) | `''` | Size axis name | Size names from the axis | `[]` (use default configuration only) | `[]` |
| **State-conditional** (columns show default vs active state) | `''` | `''` | State names | Set state variant property per column | `[]` |
| **Slot content** (columns are parent size names showing a preferred component) | The preferred component's own component set ID (`preferredComponentSetId` from the section plan) or `componentId` if not in a set | The preferred component's size axis name (from `slotContents[].preferredComponents[].variantAxes`) | Size names from the **parent's** size axis | `[]` | Boolean properties to enable on each preferred component instance (from `slotContents[].preferredComponents[].booleanDefs` — set all values to `true`) |
| **Boolean-toggled** (standalone component with booleans controlling structural elements like slots, accessories, subtext) | `''` | `''` | One label per meaningful boolean combination (e.g., `["Default", "With subtext", "No micro button"]`) | Each entry is a `PROPERTY_OVERRIDES` object setting the relevant booleans for that combination | `[]` |

**Boolean-toggled previews:** For standalone components with no variant axes, show meaningful boolean combinations as separate labeled preview instances. Always include the default state (all booleans at their defaults) plus the fully-enabled state. When the section documents a specific boolean-controlled element (e.g., heading accessory, subtext), show both the on and off states for that element.

**Sub-component preview sourcing:** When `SUB_COMP_SET_ID` is non-empty, the preview script creates instances from the **sub-component's own component set** instead of the parent's `COMP_SET_ID`. This ensures sub-component section previews show the sub-component in isolation (e.g., four Label instances at different sizes) rather than four full parent component instances. The `SUB_COMP_OVERRIDES` parameter specifies boolean properties to enable on each sub-component instance after creation, so optional internal children (e.g., character count, status icon) are visible in the preview. Both `subCompSetId` and `booleanOverrides` are pre-resolved by the enhanced extraction script (Step 4b) — no additional `figma_execute` exploration is needed to discover them.

**Slot content preview sourcing:** `slotContent` section previews also use isolated preferred-component instances for visual clarity. This preview choice does **not** change row ownership in the table: the table still documents only the hosting container and slot-imposed deltas, not a second full structure spec for the preferred component.

#### Step 11b: Render the table

Run **one `figma_execute` call** for this section's table. Replace all `__PLACEHOLDER__` values with actual data from Step 7.

```javascript
const FRAME_ID = '__FRAME_ID__';
const SECTION_NAME = '__SECTION_NAME__';
const SECTION_DESCRIPTION = '__SECTION_DESCRIPTION__';
const HAS_DESCRIPTION = __HAS_DESCRIPTION__;
const COLUMNS = __COLUMNS_JSON__;
const ROWS = __ROWS_JSON__;

const frame = await figma.getNodeByIdAsync(FRAME_ID);
const sectionTemplate = frame.findOne(n => n.name === '#section-template');

const section = sectionTemplate.clone();
sectionTemplate.parent.appendChild(section);
section.name = SECTION_NAME;
section.visible = true;

const textNodes = section.findAll(n => n.type === 'TEXT');
const fontSet = new Set();
const fontsToLoad = [];
for (const tn of textNodes) {
  try {
    const fn = tn.fontName;
    if (fn && fn !== figma.mixed && fn.family) {
      const key = fn.family + '|' + fn.style;
      if (!fontSet.has(key)) { fontSet.add(key); fontsToLoad.push(fn); }
    }
  } catch {}
}
await Promise.all(fontsToLoad.map(f => figma.loadFontAsync(f).catch(() => {})));

const titleFrame = section.findOne(n => n.name === '#section-title');
if (titleFrame) {
  const t = titleFrame.findOne(n => n.type === 'TEXT');
  if (t) t.characters = SECTION_NAME;
}

const descFrame = section.findOne(n => n.name === '#section-description');
if (descFrame) {
  if (!HAS_DESCRIPTION) {
    descFrame.visible = false;
  } else {
    const t = descFrame.findOne(n => n.type === 'TEXT');
    if (t) t.characters = SECTION_DESCRIPTION;
  }
}

const specTable = section.findOne(n => n.name === '#spec-table');

const variantTitleFrame = specTable.findOne(n => n.name === '#variant-title');
if (variantTitleFrame) {
  const t = variantTitleFrame.findOne(n => n.type === 'TEXT');
  if (t) t.characters = COLUMNS[0];
}

const headerRow = specTable.children.find(c => c.name === 'Header row');
const variantValueTemplate = headerRow.findOne(n => n.name === '#variant-value');
const notesHeader = headerRow.findOne(n => n.name === '#notes-header');
const notesIndex = notesHeader ? headerRow.children.indexOf(notesHeader) : -1;
const valueColumns = COLUMNS.slice(1, -1);

if (notesHeader) {
  notesHeader.layoutSizingHorizontal = 'FILL';
}

const headerClones = [];
for (let i = 0; i < valueColumns.length; i++) {
  const clone = variantValueTemplate.clone();
  headerClones.push(clone);
  if (notesIndex >= 0) {
    headerRow.insertChild(notesIndex + i, clone);
  } else {
    headerRow.appendChild(clone);
  }
}
variantValueTemplate.remove();

for (let i = 0; i < headerClones.length; i++) {
  headerClones[i].layoutSizingHorizontal = 'FILL';
  const textNode = headerClones[i].children.find(c => c.type === 'TEXT');
  if (textNode) textNode.characters = valueColumns[i];
}

const rowTemplate = specTable.findOne(n => n.name === '#row-template');

for (const rowData of ROWS) {
  const row = rowTemplate.clone();
  specTable.appendChild(row);
  row.name = 'Row ' + rowData.spec;

  const propNameFrame = row.findOne(n => n.name === '#property-name');
  if (propNameFrame) {
    const t = propNameFrame.findOne(n => n.type === 'TEXT');
    if (t) t.characters = rowData.spec;
  }

  const propNotesFrame = row.findOne(n => n.name === '#property-notes');
  if (propNotesFrame) {
    const t = propNotesFrame.findOne(n => n.type === 'TEXT');
    if (t) t.characters = rowData.notes;
    propNotesFrame.layoutSizingHorizontal = 'FILL';
  }

  const hierarchyFrame = row.findOne(n => n.name === '#hierarchy-indicator');
  if (hierarchyFrame) {
    if (rowData.isSubProperty) {
      hierarchyFrame.visible = true;
      const withinGroup = hierarchyFrame.children.find(c => c.name === 'within-group');
      const lastInGroup = hierarchyFrame.children.find(c => c.name === '#hierarchy-indicator-last');
      if (rowData.isLastInGroup) {
        if (withinGroup) withinGroup.visible = false;
        if (lastInGroup) lastInGroup.visible = true;
      } else {
        if (withinGroup) withinGroup.visible = true;
        if (lastInGroup) lastInGroup.visible = false;
      }
    } else {
      hierarchyFrame.visible = false;
    }
  }

  const valueCellTemplate = row.findOne(n => n.name === '#property-value-cell');
  const notesCell = row.findOne(n => n.name === '#property-notes');
  const notesCellIndex = notesCell ? row.children.indexOf(notesCell) : -1;

  const cellClones = [];
  for (let i = 0; i < rowData.values.length; i++) {
    const clone = valueCellTemplate.clone();
    cellClones.push(clone);
    if (notesCellIndex >= 0) {
      row.insertChild(notesCellIndex + i, clone);
    } else {
      row.appendChild(clone);
    }
  }
  valueCellTemplate.remove();

  for (let i = 0; i < cellClones.length; i++) {
    cellClones[i].layoutSizingHorizontal = 'FILL';
    const textNode = cellClones[i].children.find(c => c.type === 'TEXT');
    if (textNode) textNode.characters = rowData.values[i];
  }
}

rowTemplate.remove();
return { success: true, section: SECTION_NAME, sectionId: section.id };
```

Save the returned `sectionId` — pass it to Step 11c as `__SECTION_ID__` so the preview script can locate the section by ID instead of by name.

#### Step 11c: Populate this section's preview

**Immediately after** the table is rendered for this section, populate its `#Preview` frame with annotated component instances. Use the preview parameters determined in Step 11a.

Replace the following placeholders with the values from Step 11a:

- `__SECTION_ID__` — the section's node ID returned by Step 11b (`sectionId` in the return value)
- `__COMP_SET_NODE_ID__` — the component set (or standalone component) node ID
- `__SUB_COMP_SET_NODE_ID__` — the sub-component's own component set ID from `subComponents[].subCompSetId` in Step 4b (empty string `''` for non-sub-component sections)
- `__DEFAULT_PROPS_JSON__` — object mapping all variant axis names to their default values (from `variantAxes` in Step 4b extraction). When `SUB_COMP_SET_ID` is non-empty, use the sub-component's own variant axes defaults from `subComponents[].subCompVariantAxes` instead.
- `__VARIANT_AXIS__` — from the decision table in Step 11a
- `__COLUMN_VALUES_JSON__` — from the decision table in Step 11a
- `__PROPERTY_OVERRIDES_JSON__` — from the decision table in Step 11a
- `__SUB_COMP_OVERRIDES_JSON__` — object mapping sub-component boolean property keys to `true`, from `subComponents[].booleanOverrides` in Step 4b (empty object `{}` for non-sub-component sections)

```javascript
const SECTION_ID = '__SECTION_ID__';
const COMP_SET_ID = '__COMP_SET_NODE_ID__';
const SUB_COMP_SET_ID = '__SUB_COMP_SET_NODE_ID__';
const DEFAULT_PROPS = __DEFAULT_PROPS_JSON__;
const VARIANT_AXIS = '__VARIANT_AXIS__';
const COLUMN_VALUES = __COLUMN_VALUES_JSON__;
const PROPERTY_OVERRIDES = __PROPERTY_OVERRIDES_JSON__;
const SUB_COMP_OVERRIDES = __SUB_COMP_OVERRIDES_JSON__;
const FONT_FAMILY = '__FONT_FAMILY__';

async function loadAllFonts(rootNode) {
  const textNodes = rootNode.findAll(n => n.type === 'TEXT');
  const fontSet = new Set();
  const fontsToLoad = [];
  for (const tn of textNodes) {
    try {
      const fn = tn.fontName;
      if (fn && fn !== figma.mixed && fn.family) {
        const key = fn.family + '|' + fn.style;
        if (!fontSet.has(key)) { fontSet.add(key); fontsToLoad.push(fn); }
      }
    } catch {}
  }
  await Promise.all(fontsToLoad.map(f => figma.loadFontAsync(f).catch(() => {})));
}

async function loadFontWithFallback(family, preferredStyle, fallbackStyle) {
  fallbackStyle = fallbackStyle || 'Regular';
  const allFonts = await figma.listAvailableFontsAsync();
  const familyFonts = allFonts.filter(f => f.fontName.family === family);
  const match = familyFonts.find(f => f.fontName.style === preferredStyle);
  if (match) { await figma.loadFontAsync(match.fontName); return match.fontName; }
  const fallback = familyFonts.find(f => f.fontName.style === fallbackStyle);
  if (fallback) { await figma.loadFontAsync(fallback.fontName); return fallback.fontName; }
  if (familyFonts.length > 0) { await figma.loadFontAsync(familyFonts[0].fontName); return familyFonts[0].fontName; }
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  return { family: 'Inter', style: 'Regular' };
}

const section = await figma.getNodeByIdAsync(SECTION_ID);
if (!section) return { error: 'Section not found: ' + SECTION_ID };

let _p = section; while (_p.parent && _p.parent.type !== 'DOCUMENT') _p = _p.parent;
if (_p.type === 'PAGE') await figma.setCurrentPageAsync(_p);

const preview = section.findOne(n => n.name === '#Preview');
if (!preview) return { error: 'No #Preview frame in section: ' + SECTION_ID };

const useSubComp = SUB_COMP_SET_ID && SUB_COMP_SET_ID !== '';
const sourceId = useSubComp ? SUB_COMP_SET_ID : COMP_SET_ID;
const compNode = await figma.getNodeByIdAsync(sourceId);
if (!compNode) return { error: 'Component not found: ' + sourceId };
const isComponentSet = compNode.type === 'COMPONENT_SET';

const instances = [];
for (let i = 0; i < COLUMN_VALUES.length; i++) {
  const colValue = COLUMN_VALUES[i];
  const variantProps = { ...DEFAULT_PROPS };
  if (VARIANT_AXIS && VARIANT_AXIS !== '') {
    variantProps[VARIANT_AXIS] = colValue;
  }
  if (PROPERTY_OVERRIDES.length > i) {
    for (const [k, v] of Object.entries(PROPERTY_OVERRIDES[i])) {
      variantProps[k] = v;
    }
  }

  let targetVariant = null;
  if (isComponentSet) {
    let bestFallback = null;
    let bestFallbackScore = -1;
    for (const child of compNode.children) {
      const vp = child.variantProperties || {};
      let score = 0;
      let exactMatch = true;
      for (const [k, v] of Object.entries(variantProps)) {
        if (vp[k] === v) { score++; } else { exactMatch = false; }
      }
      if (exactMatch) { targetVariant = child; break; }
      if (score > bestFallbackScore) { bestFallbackScore = score; bestFallback = child; }
    }
    if (!targetVariant) targetVariant = bestFallback;
  } else {
    targetVariant = compNode;
  }

  instances.push({ colValue, targetVariant, overrideIndex: i });
}

const LABEL_FONT = await loadFontWithFallback(FONT_FAMILY, 'Medium');
const wrappers = [];
for (const entry of instances) {
  const wrapper = figma.createFrame();
  wrapper.name = 'Instance ' + entry.colValue;
  wrapper.layoutMode = 'VERTICAL';
  wrapper.primaryAxisAlignItems = 'CENTER';
  wrapper.counterAxisAlignItems = 'CENTER';
  wrapper.layoutSizingHorizontal = 'HUG';
  wrapper.layoutSizingVertical = 'HUG';
  wrapper.itemSpacing = 10;
  wrapper.fills = [];

  if (!entry.targetVariant) {
    const placeholder = figma.createText();
    await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
    placeholder.characters = 'Variant unavailable';
    placeholder.fontSize = 12;
    placeholder.fills = [{ type: 'SOLID', color: { r: 0.6, g: 0.6, b: 0.6 } }];
    wrapper.appendChild(placeholder);
  } else {
    const inst = entry.targetVariant.createInstance();
    await loadAllFonts(inst);
    if (useSubComp && Object.keys(SUB_COMP_OVERRIDES).length > 0) {
      inst.setProperties(SUB_COMP_OVERRIDES);
      await loadAllFonts(inst);
    }
    if (!useSubComp && PROPERTY_OVERRIDES.length > entry.overrideIndex && Object.keys(PROPERTY_OVERRIDES[entry.overrideIndex]).length > 0) {
      inst.setProperties(PROPERTY_OVERRIDES[entry.overrideIndex]);
      await loadAllFonts(inst);
    }
    wrapper.appendChild(inst);
    entry._inst = inst;
  }

  const label = figma.createText();
  label.fontName = LABEL_FONT;
  label.characters = entry.colValue;
  label.fontSize = 14;
  label.fills = [{ type: 'SOLID', color: { r: 0.29, g: 0.29, b: 0.29 } }];
  wrapper.appendChild(label);

  preview.appendChild(wrapper);
  wrappers.push({ wrapper, entry });
}

return { success: true, section: SECTION_ID };
```

### Step 12: Visual Validation

1. `figma_take_screenshot` with the `frameId` — Capture the completed spec
2. Verify:
   - All sections are present with correct titles
   - Column headers match the expected variants/sizes
   - Row values are filled correctly
   - Hierarchy indicators (├─ / └─) appear on sub-properties
   - General notes are visible or hidden as expected
   - Each section's `#Preview` frame has at least one child instance and the instances are visible
   - **Preview layout**: Instances are placed inside the `#Preview` frame. Each instance has a label below it. The template's `#Preview` frame provides the layout — the script does not override any of its properties.
   - Column widths look balanced — the notes column is not crushed
   - **Sub-component preview correctness**: Sub-component section previews show instances from the sub-component's own component set (not the parent). Verify that the preview shows the sub-component in isolation (e.g., four Label instances at different sizes, not four full Text Field instances). If `SUB_COMP_OVERRIDES` was specified, verify that optional internal children (e.g., character count, icons) are visible on each preview instance.
   - **Behavior variant preview simplicity**: When a behavior/configuration axis exists (e.g., Static vs Interactive), the preview shows only the default configuration — one row of instances at each size. Do NOT duplicate instances for each configuration.
3. If issues are found, fix via `figma_execute` and re-capture (up to 3 iterations)

### Step 13: Completion Link

Print a clickable Figma URL to the completed spec in chat. Construct the URL from the `fileKey` (extracted from the user's input URL) and the `frameId` (returned by Step 9), replacing `:` with `-` in the node ID:

```
Structure spec complete: https://www.figma.com/design/{fileKey}/?node-id={frameId}
```

## Notes

- The target node can be either a `COMPONENT_SET` (multi-variant) or a standalone `COMPONENT` (single variant). The extraction script detects the type and returns `isComponentSet` accordingly. When the node is a standalone component, it is treated as a single-entry variants array and there are no variant axes. Preview instance creation in Step 11c uses `compNode.createInstance()` directly for standalone components.
- Dynamic columns: The `#variant-value` template in the header row and `#property-value-cell` in each data row are cloned once per value column, then the original template is removed. Clones are inserted before the Notes column to maintain correct column order. All value columns and the Notes column use `layoutSizingHorizontal = 'FILL'` so Figma's auto-layout distributes width equally across them.
- Each section is rendered in a separate `figma_execute` call to avoid timeouts.
