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

**`figma-mcp` page context:** `use_figma` resets `figma.currentPage` to the first page on every call. When a script accesses a node from a previous step via `getNodeByIdAsync(ID)`, descendant nodes (text, instances) may not be fully loaded — methods like `getRangeAllFontNames`, `findAll`, or `characters` can fail with `TypeError`. Insert this page-loading block immediately after `getNodeByIdAsync`:

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
- [ ] Step 5: Navigate to destination (if different file)
- [ ] Step 6: AI interpretation layer — build section plan, write design-intent notes, detect anomalies, judge completeness
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

function makeDisplayString(value, token) {
  if (token) return token + ' (' + value + ')';
  return String(value);
}

function collapsePadding(pT, pB, pS, pE, tT, tB, tS, tE) {
  const vT = Math.round(pT || 0), vB = Math.round(pB || 0);
  const vS = Math.round(pS || 0), vE = Math.round(pE || 0);
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
      const v = Math.round(node[p]);
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
        Math.round(node.topLeftRadius || 0), Math.round(node.topRightRadius || 0),
        Math.round(node.bottomLeftRadius || 0), Math.round(node.bottomRightRadius || 0),
        tTL, tTR, tBL, tBR
      );
    } else {
      const token = await resolveBinding(node, 'cornerRadius');
      const v = Math.round(node.cornerRadius);
      dims.cornerRadius = { value: v, token: token || null, display: makeDisplayString(v, token) };
    }
  }

  if (node.strokeWeight !== undefined && node.strokeWeight !== null) {
    if (node.strokeWeight === figma.mixed) {
      const sides = {};
      for (const s of ['strokeTopWeight', 'strokeBottomWeight', 'strokeLeftWeight', 'strokeRightWeight']) {
        if (node[s] !== undefined) {
          const logicalKey = s.replace('strokeTopWeight', 'top').replace('strokeBottomWeight', 'bottom').replace('strokeLeftWeight', 'start').replace('strokeRightWeight', 'end');
          sides[logicalKey] = { value: Math.round(node[s]), token: null, display: String(Math.round(node[s])) };
        }
      }
      dims.strokeWeight = sides;
    } else {
      const token = await resolveBinding(node, 'strokeWeight');
      const v = Math.round(node.strokeWeight);
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
const defaultValues = {};
for (const [axis, vals] of Object.entries(variantAxes)) {
  defaultValues[axis] = vals[0];
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
const defaultVariant = variantChildren[0];
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
  subComponents
};
```

Save the returned JSON. The enhanced extraction script provides:

- **Representative variants** — one per value of each *dimension-affecting* axis (Size, Density, Shape) at default values for other axes. Visual-only axes (State, Mode, Theme) are skipped — e.g., Size(4) × State(11) yields 4 variants instead of 14.
- **Collapsed/expanded dimensional model** — `padding` is a single `{ value, token, display }` when all sides equal, `{ vertical, horizontal }` when top==bottom and left==right, or `{ top, bottom, start, end }` with logical directions when sides differ. Same pattern for `cornerRadius` (uniform vs `{ topStart, topEnd, bottomStart, bottomEnd }`) and `strokeWeight` (uniform vs per-side).
- **Typography as composite** — `typography: { styleName }` when a named text style exists, or `{ fontSize, fontWeight, lineHeight, ... }` for inline values. Never both — mutual exclusion enforced at extraction time.
- **Pre-formatted display strings** — every dimensional property includes a `display` field: `"token-name (value)"` when token-bound, `"value"` when hardcoded. Use `display` directly in table rows and token maps.
- **Sub-component discovery** — all top-level INSTANCE children have `subCompSetId`, `subCompVariantAxes`, and `booleanOverrides` populated automatically via `getMainComponentAsync()`.
- **Enriched tree** — full recursive tree with dimensions from a fully-enabled test instance (all parent booleans set to `true`). Each node includes name, type, visible, dimensions, children, typography for TEXT, and sub-component metadata for INSTANCE. Used for sub-component discovery, completeness checks, and detailed dimensional analysis.
- **Layout tree** — a recursive `layoutTree` on each variant showing auto-layout nesting, which containers have padding/spacing, and the hierarchy of structurally significant frames.
- **`subComponents` array** — full sub-component data: name, mainComponentName, subCompSetId, subCompVariantAxes, booleanOverrides, dimensions, children, and typography. Provides sub-component dimensions from the enriched tree (fully-enabled state) in addition to the cross-variant measurements from Step 4d.

You will use `componentName`, `compSetNodeId`, `variantAxes`, `propertyDefs`, `booleanDefs`, `variants`, `enrichedTree`, `subComponents`, and each variant's `layoutTree` in subsequent steps. The `propertyDefs` object contains exact Figma property keys (including `#nodeId` suffixes for booleans) needed for `setProperties()` when placing preview instances.

**4c. Check variable modes:**
- `figma_get_variables` — **Critical:** Check if any bound tokens have multiple mode values (e.g., Density: compact/default/spacious). Filter by token prefix to find relevant variables. If the extraction script found tokens in `boundVariables`, query those token names to discover multi-mode collections.

**Scope constraint:** Only analyze the provided node and its children. Do not navigate to other pages or unrelated frames elsewhere in the Figma file.

**4d. Cross-variant dimensional comparison** — Run this deterministic script via `figma_execute` to systematically compare dimensions across all size/variant values for every discovered sub-component, plus the root component itself. Replace `__NODE_ID__` and `__SUB_COMPONENTS_JSON__` (from the extraction's `subComponents` array) and `__BOOLEAN_DEFS_JSON__` (from `booleanDefs`):

```javascript
const TARGET_NODE_ID = '__NODE_ID__';
const SUB_COMPONENTS = __SUB_COMPONENTS_JSON__;
const BOOLEAN_DEFS = __BOOLEAN_DEFS_JSON__;
const VARIANT_AXES = __VARIANT_AXES_JSON__;

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
  const vT = Math.round(pT || 0), vB = Math.round(pB || 0);
  const vS = Math.round(pS || 0), vE = Math.round(pE || 0);
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
      const v = Math.round(node[p]);
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
        Math.round(node.topLeftRadius || 0), Math.round(node.topRightRadius || 0),
        Math.round(node.bottomLeftRadius || 0), Math.round(node.bottomRightRadius || 0),
        tTL, tTR, tBL, tBR
      );
    } else {
      const token = await resolveBinding(node, 'cornerRadius');
      const v = Math.round(node.cornerRadius);
      m.cornerRadius = { value: v, token: token || null, display: makeDisplay(v, token) };
    }
  }

  if (node.strokeWeight !== undefined && node.strokeWeight !== null) {
    if (node.strokeWeight === figma.mixed) {
      const sides = {};
      for (const s of ['strokeTopWeight', 'strokeBottomWeight', 'strokeLeftWeight', 'strokeRightWeight']) {
        if (node[s] !== undefined) {
          const logicalKey = s.replace('strokeTopWeight', 'top').replace('strokeBottomWeight', 'bottom').replace('strokeLeftWeight', 'start').replace('strokeRightWeight', 'end');
          sides[logicalKey] = { value: Math.round(node[s]), token: null, display: String(Math.round(node[s])) };
        }
      }
      m.strokeWeight = sides;
    } else {
      const token = await resolveBinding(node, 'strokeWeight');
      const v = Math.round(node.strokeWeight);
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
      const nested = {};
      for (const gc of child.children) {
        if (gc.visible) nested[gc.name] = await measureNode(gc);
      }
      if (Object.keys(nested).length > 0) result[child.name + '.__children'] = nested;
    }
  }
  return result;
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

const defaultValues = {};
for (const [axis, vals] of Object.entries(axes)) {
  defaultValues[axis] = vals[0];
}

const rootDimensions = {};
const subComponentDimensions = {};

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
  stateComparison,
  sizeAxis: sizeAxis || null,
  stateAxis: stateAxis || null
};
```

Save the returned JSON. Replace `__VARIANT_AXES_JSON__` with the `variantAxes` object from Step 4b extraction. This script provides:
- **`rootDimensions`** — keyed by size/variant label, full measurements of the root component at each size (at default state and default values for all other axes). Uses the same representative variant strategy as Step 4b — only one variant per size value, not all permutations.
- **`subComponentDimensions`** — keyed by sub-component name, then by size label, with `self` (the sub-component's own measurements) and `children` (its internal children's measurements, with booleans enabled). Every sub-component discovered in Step 4b is measured across all sizes.
- **`stateComparison`** — measurements of the root at the default size across all state values. Use this to detect state-conditional properties (e.g., border appears on focus).
- All measurements use the same collapsed dimensional model as Step 4b: `padding` as uniform / `{ vertical, horizontal }` / `{ top, bottom, start, end }`, collapsed `cornerRadius`, collapsed `strokeWeight`, and `typography` as composite `{ styleName }` or `{ fontSize, fontWeight, ... }`.

### Step 5: Navigate to Destination

If the user provided a separate destination file URL:
- `figma_navigate` — Switch to the destination file

If no destination was provided, stay in the current file.

### Step 6: AI Interpretation Layer

This is the core quality step. You have complete, structured data from Steps 4b-4d. Instead of writing `figma_execute` queries, you focus on high-value reasoning tasks that directly improve spec quality for engineers.

**Input:** The extraction data (4b), cross-variant dimensional comparison (4d), and variable mode data (4c).

**A. Build the section plan:**

Apply these deterministic rules to the extraction and cross-variant data, then validate and adjust the result using your judgment about the component's actual structure.

**Rules (apply in order):**

1. **Variant axes with purely numeric differences → columns.** For each variant axis from `variantAxes`, compare `rootDimensions` across values. If all values have the same set of properties and differ only numerically, make this axis a set of columns (e.g., Size → "Large", "Medium", "Small", "XSmall" columns).

2. **Sub-components → separate sections.** Each entry in `subComponents` gets its own section. The section's columns match the parent's size axis (or the sub-component's own size axis if it has one). Use `subComponentDimensions[name]` for the row data.

3. **2+ sub-components with own size variants → composition section.** If `subComponents` has 2+ entries where `subCompVariantAxes` contains a size-like axis, create a composition section as the first section. Map parent size → sub-component variant for each sub-component.

4. **State axis with new properties → state-conditional section.** Compare `stateComparison` entries: if any state introduces a property not present in the default state (especially `strokeWeight` appearing or changing), create a state-conditional section.

5. **Layout tree for container hierarchy.** Use the `layoutTree` from the default variant to identify which containers are structurally significant (have their own padding/spacing). Containers that are pass-through wrappers (no padding, no spacing, single child) can be omitted.

**Produce a `sectionPlan` array** with this shape:
```
sectionPlan = [
  {
    sectionType: "composition" | "variant" | "subComponent" | "stateConditional",
    sectionName: string,
    sectionDescription: string | null,
    columns: string[],           // e.g., ["Spec", "Large", "Medium", "Small", "Notes"]
    subCompSetId: string | null, // for subComponent sections
    booleanOverrides: object,    // for subComponent sections
    variantAxis: string | null,  // axis name for variant sections
    dataSource: string           // "rootDimensions" | "subComponentDimensions.Name" | "stateComparison"
  },
  ...
]
```

**Ordering:** Composition section first (if any), then root/variant sections, then sub-component sections in the order they appear in the enriched tree (visual order: leading → middle → trailing), then state-conditional sections last.

**Then validate the plan against the full data:**
- Does every auto-layout container in the extraction have its padding and spacing covered by a section?
- Does every sub-component discovered in the `enrichedTree` have a section?
- Are there dimensional properties in the extraction that are not included in any section (and should they be)?
- Should any sections be merged, split, or reordered based on the component's actual structure?
- For behavior/configuration variant axes (e.g., Static vs Interactive): use the default configuration for the preview. If border/stroke differs between configurations, add a row — don't create a separate section unless the property sets are fundamentally different.

Produce the final `sectionPlan` with any adjustments.

**B. Write design-intent notes:**

For each property row you will generate, write notes that answer **"why this value?"** not just **"what is this property?"**. You have full dimensional data across all variants and sub-components — use it.

| Instead of this | Write this |
|---|---|
| "Tap target" | "Meets WCAG 2.5.8 minimum touch target (44px) with 12px optical margin" |
| "Inset from edges" | "Accommodates multi-line secondary text at spacious density" |
| "Pill shape" | "Uses half of minHeight — pill shape scales with container height" |
| "Icon size" | "Matches platform icon grid (20dp Android, 20pt iOS)" |
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
- Does every auto-layout container in the extraction have its padding and spacing documented in a section row?
- Does every sub-component discovered in the `enrichedTree` have its own section?
- Are there dimensional properties present in `rootDimensions` or `subComponentDimensions` that were not included in any row?
- For composition sections: does every sub-component's size mapping cover all parent sizes?
- Are typography styles documented for every TEXT node in the enriched tree?

If gaps exist that cannot be filled from the extraction data, add a note in `generalNotes`: e.g., "Trailing content slot dimensions not documented — slot was empty in all inspected variants."

### Step 7: Generate Structured Data

Using the section plan from Step 6 and the complete dimensional data from Steps 4b-4d, build the structured data object.

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
- Look up the `dataSource` to find the right dimensional data object (`rootDimensions`, `subComponentDimensions.Name`, or `stateComparison`).
- For each column value (e.g., "Large", "Medium"), read the measurements at that key.
- Use the `display` field directly from the dimensional data as the cell value — this already handles `"token-name (value)"` vs `"value"` formatting.
- For collapsed padding: if `padding` is a single value, emit one `padding` row. If `{ vertical, horizontal }`, emit `verticalPadding` and `horizontalPadding` rows. If `{ top, bottom, start, end }`, emit individual `paddingTop`, `paddingBottom`, `paddingStart`, `paddingEnd` rows.
- For collapsed cornerRadius: if uniform, emit one `cornerRadius` row. If per-corner, emit `cornerRadiusTopStart`, `cornerRadiusTopEnd`, etc.
- For typography: if `{ styleName }`, emit one `textStyle` row with the style name. If inline properties, emit `fontSize`, `fontWeight`, `lineHeight` rows.

Ensure:
- First column is always "Spec" (or "Composition" for composition sections), last is always "Notes"
- `values` array length matches `columns.length - 2`
- Use `isSubProperty: true` for child properties
- Notes contain design-intent reasoning from Step 6, not generic descriptions

### Step 8: Audit

Re-read the instruction file, focusing on:
- **Common Mistakes** section
- **Do NOT** section
- **Property naming** (camelCase, include units)

Check your output against each rule. Fix any violations.

### Step 9: Import and Detach Template

Run via `figma_execute` (replace `__STRUCTURE_TEMPLATE_KEY__` with the key from Step 3, and `__COMPONENT_NAME__` with the component name):

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
  if (tn.characters.length > 0) {
    const fonts = tn.getRangeAllFontNames(0, tn.characters.length);
    for (const f of fonts) {
      const key = f.family + '|' + f.style;
      if (!fontSet.has(key)) { fontSet.add(key); fontsToLoad.push(f); }
    }
  }
}
await Promise.all(fontsToLoad.map(f => figma.loadFontAsync(f)));

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

| Section type | `SUB_COMP_SET_ID` | `VARIANT_AXIS` | `COLUMN_VALUES` | `PROPERTY_OVERRIDES` | `SUB_COMP_OVERRIDES` | `TOKEN_MAPS` |
|---|---|---|---|---|---|---|
| **Size/variant** (columns are size names like Large, Medium, Small) | `''` | The axis name (e.g., `"Size"`) | Size names from the axis | `[]` | `[]` | Build from section rows |
| **Density** (columns are density modes from variable collections) | `''` | `''` | Mode names (e.g., `["Compact", "Default", "Spacious"]`) | `[]` | `[]` | Build from section rows |
| **Shape** (columns are shape variants) | `''` | The axis name (e.g., `"Shape"`) | Shape names from the axis | `[]` | `[]` | `[]` unless section has token-mapped rows |
| **Sub-component** (columns are size names showing a specific child) | The sub-component's own component set ID (from `subComponents[].subCompSetId` in Step 4b extraction) | The sub-component's size axis name (from `subComponents[].subCompVariantAxes`) | Size names from the sub-component's own size axis | `[]` | Boolean properties to enable on each sub-component instance so all internal children are visible (from `subComponents[].booleanOverrides` in Step 4b — set all values to `true`) | Build from section rows |
| **Composition** (columns show sub-component variant mappings) | `''` | `''` | Size names | Configure each column's specific property combination | `[]` | `[]` |
| **Behavior/Configuration** (columns are size names) | `''` | Size axis name | Size names from the axis | `[]` (use default configuration only) | `[]` | Build from section rows |
| **State-conditional** (columns show default vs active state) | `''` | `''` | State names | Set state variant property per column | `[]` | `[]` unless section has dimensional rows |

**Sub-component preview sourcing:** When `SUB_COMP_SET_ID` is non-empty, the preview script creates instances from the **sub-component's own component set** instead of the parent's `COMP_SET_ID`. This ensures sub-component section previews show the sub-component in isolation (e.g., four Label instances at different sizes) rather than four full parent component instances. The `SUB_COMP_OVERRIDES` parameter specifies boolean properties to enable on each sub-component instance after creation, so optional internal children (e.g., character count, status icon) are visible in the preview. Both `subCompSetId` and `booleanOverrides` are pre-resolved by the enhanced extraction script (Step 4b) — no additional `figma_execute` exploration is needed to discover them.

**Token map construction from extraction data:**

Because the extraction and cross-variant scripts return pre-formatted `display` strings on every dimensional property, the token maps can be built directly from the section's row data without manual formatting. For each column in the section, build a `tokenMap` object that maps Figma property names to the `display` string from the corresponding row value.

The mapping from table `spec` names to Figma properties:

| Table spec name | Figma property in tokenMap |
|---|---|
| `padding` | `paddingTop` AND `paddingBottom` AND `paddingLeft` AND `paddingRight` (set all four to the same value) |
| `horizontalPadding` | `paddingLeft` AND `paddingRight` (set both to the same value) |
| `verticalPadding` | `paddingTop` AND `paddingBottom` (set both to the same value) |
| `paddingTop` | `paddingTop` |
| `paddingBottom` | `paddingBottom` |
| `paddingStart` / `paddingLeft` | `paddingLeft` |
| `paddingEnd` / `paddingRight` | `paddingRight` |
| `contentSpacing` / `itemSpacing` / `gapBetween` / `iconLabelSpacing` | `itemSpacing` |
| `minWidth` | `minWidth` |
| `maxWidth` | `maxWidth` |
| `minHeight` | `minHeight` |
| `maxHeight` | `maxHeight` |

For each section row, look up the row's `spec` in this mapping. For each value column index `i`, set `tokenMaps[i][figmaProp] = row.values[i]`. The `row.values[i]` already contains the correctly formatted display string (e.g., `"spacing-md (16)"` or `"16"`) because Step 7 populated rows using the `display` field from the dimensional data.

If the section has no dimensional rows (no padding, spacing, or min/max rows), set `TOKEN_MAPS` to `[]`. No measurement annotations will be drawn — the `annotateNode` function only creates measurements for properties that have a corresponding entry in the token map. This ensures annotations exactly match the table rows below.

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
  if (tn.characters.length > 0) {
    const fonts = tn.getRangeAllFontNames(0, tn.characters.length);
    for (const f of fonts) {
      const key = f.family + '|' + f.style;
      if (!fontSet.has(key)) { fontSet.add(key); fontsToLoad.push(f); }
    }
  }
}
await Promise.all(fontsToLoad.map(f => figma.loadFontAsync(f)));

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
return { success: true, section: SECTION_NAME };
```

#### Step 11c: Populate this section's preview

**Immediately after** the table is rendered for this section, populate its `#Preview` frame with annotated component instances. Use the preview parameters determined in Step 11a.

Replace the following placeholders with the values from Step 11a:

- `__FRAME_ID__` — the root frame ID from Step 9
- `__SECTION_NAME__` — the section name (same as used in 11b)
- `__COMP_SET_NODE_ID__` — the component set (or standalone component) node ID
- `__SUB_COMP_SET_NODE_ID__` — the sub-component's own component set ID from `subComponents[].subCompSetId` in Step 4b (empty string `''` for non-sub-component sections)
- `__DEFAULT_PROPS_JSON__` — object mapping all variant axis names to their default values (from `variantAxes` in Step 4b extraction). When `SUB_COMP_SET_ID` is non-empty, use the sub-component's own variant axes defaults from `subComponents[].subCompVariantAxes` instead.
- `__VARIANT_AXIS__` — from the decision table in Step 11a
- `__COLUMN_VALUES_JSON__` — from the decision table in Step 11a
- `__PROPERTY_OVERRIDES_JSON__` — from the decision table in Step 11a
- `__SUB_COMP_OVERRIDES_JSON__` — object mapping sub-component boolean property keys to `true`, from `subComponents[].booleanOverrides` in Step 4b (empty object `{}` for non-sub-component sections)
- `__TOKEN_MAPS_JSON__` — from the token map construction in Step 11a

```javascript
const FRAME_ID = '__FRAME_ID__';
const SECTION_NAME = '__SECTION_NAME__';
const COMP_SET_ID = '__COMP_SET_NODE_ID__';
const SUB_COMP_SET_ID = '__SUB_COMP_SET_NODE_ID__';
const DEFAULT_PROPS = __DEFAULT_PROPS_JSON__;
const VARIANT_AXIS = '__VARIANT_AXIS__';
const COLUMN_VALUES = __COLUMN_VALUES_JSON__;
const PROPERTY_OVERRIDES = __PROPERTY_OVERRIDES_JSON__;
const SUB_COMP_OVERRIDES = __SUB_COMP_OVERRIDES_JSON__;
const FONT_FAMILY = '__FONT_FAMILY__';
const TOKEN_MAPS = __TOKEN_MAPS_JSON__;

const MIN_ANNOTATABLE = 4;
const INSTANCE_GAP = 80;
const ARTWORK_PADDING = 60;
const LABEL_MARGIN = 28;

const frame = await figma.getNodeByIdAsync(FRAME_ID);
const section = frame.findOne(n => n.name === SECTION_NAME);
if (!section) return { error: 'Section not found: ' + SECTION_NAME };

const preview = section.findOne(n => n.name === '#Preview');
if (!preview) return { error: 'No #Preview frame in section: ' + SECTION_NAME };

const useSubComp = SUB_COMP_SET_ID && SUB_COMP_SET_ID !== '';
const sourceId = useSubComp ? SUB_COMP_SET_ID : COMP_SET_ID;
const compNode = await figma.getNodeByIdAsync(sourceId);
if (!compNode) return { error: 'Component not found: ' + sourceId };
const isComponentSet = compNode.type === 'COMPONENT_SET';

function hasTokenEntry(tokenMap, figmaProp) {
  return tokenMap && tokenMap[figmaProp] && tokenMap[figmaProp] !== '–';
}

function annotateNode(node, tokenMap, isRoot, annotateScope) {
  if (!node.visible) return;
  const isAutoLayout = node.layoutMode && node.layoutMode !== 'NONE';

  if (isAutoLayout) {
    const pT = Math.round(node.paddingTop || 0);
    const pB = Math.round(node.paddingBottom || 0);
    const pL = Math.round(node.paddingLeft || 0);
    const pR = Math.round(node.paddingRight || 0);
    const kids = ('children' in node) ? node.children.filter(c => c.visible) : [];
    const first = kids[0];
    const last = kids[kids.length - 1];

    if (first) {
      if (pT >= MIN_ANNOTATABLE && hasTokenEntry(tokenMap, 'paddingTop')) {
        figma.currentPage.addMeasurement(
          { node: node, side: 'TOP' }, { node: first, side: 'TOP' }
        );
      }
      if (pB >= MIN_ANNOTATABLE && hasTokenEntry(tokenMap, 'paddingBottom')) {
        figma.currentPage.addMeasurement(
          { node: last, side: 'BOTTOM' }, { node: node, side: 'BOTTOM' }
        );
      }
      if (pL >= MIN_ANNOTATABLE && hasTokenEntry(tokenMap, 'paddingLeft')) {
        figma.currentPage.addMeasurement(
          { node: node, side: 'LEFT' }, { node: first, side: 'LEFT' }
        );
      }
      if (pR >= MIN_ANNOTATABLE && hasTokenEntry(tokenMap, 'paddingRight')) {
        figma.currentPage.addMeasurement(
          { node: last, side: 'RIGHT' }, { node: node, side: 'RIGHT' }
        );
      }
    }

    const spacing = Math.round(node.itemSpacing || 0);
    if (spacing >= MIN_ANNOTATABLE && kids.length > 1 && hasTokenEntry(tokenMap, 'itemSpacing')) {
      const isH = node.layoutMode === 'HORIZONTAL';
      for (let ci = 0; ci < kids.length - 1; ci++) {
        figma.currentPage.addMeasurement(
          { node: kids[ci], side: isH ? 'RIGHT' : 'BOTTOM' },
          { node: kids[ci + 1], side: isH ? 'LEFT' : 'TOP' }
        );
      }
    }
  }

  if (node.minWidth > 0 && hasTokenEntry(tokenMap, 'minWidth')) {
    figma.currentPage.addMeasurement(
      { node: node, side: 'LEFT' }, { node: node, side: 'RIGHT' },
      { freeText: 'min ' + Math.round(node.minWidth) }
    );
  }
  if (node.maxWidth > 0 && node.maxWidth < 10000 && hasTokenEntry(tokenMap, 'maxWidth')) {
    figma.currentPage.addMeasurement(
      { node: node, side: 'LEFT' }, { node: node, side: 'RIGHT' },
      { freeText: 'max ' + Math.round(node.maxWidth) }
    );
  }
  if (node.minHeight > 0 && hasTokenEntry(tokenMap, 'minHeight')) {
    figma.currentPage.addMeasurement(
      { node: node, side: 'TOP' }, { node: node, side: 'BOTTOM' },
      { freeText: 'min ' + Math.round(node.minHeight) }
    );
  }
  if (node.maxHeight > 0 && node.maxHeight < 10000 && hasTokenEntry(tokenMap, 'maxHeight')) {
    figma.currentPage.addMeasurement(
      { node: node, side: 'TOP' }, { node: node, side: 'BOTTOM' },
      { freeText: 'max ' + Math.round(node.maxHeight) }
    );
  }

  const recurse = annotateScope === 'fullTree' && ('children' in node) && (isRoot || node.type !== 'INSTANCE');
  if (recurse) {
    for (const child of node.children) {
      annotateNode(child, tokenMap, false, annotateScope);
    }
  }
}

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

  instances.push({ colValue, targetVariant, tokenMap: TOKEN_MAPS.length > i ? TOKEN_MAPS[i] : {} });
}

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
    if (useSubComp && Object.keys(SUB_COMP_OVERRIDES).length > 0) {
      inst.setProperties(SUB_COMP_OVERRIDES);
    }
    wrapper.appendChild(inst);
    entry._inst = inst;
  }

  const label = figma.createText();
  label.fontName = { family: FONT_FAMILY, style: 'Medium' };
  label.characters = entry.colValue;
  label.fontSize = 14;
  label.fills = [{ type: 'SOLID', color: { r: 0.29, g: 0.29, b: 0.29 } }];
  wrapper.appendChild(label);

  preview.appendChild(wrapper);
  wrappers.push({ wrapper, entry });
}

const annotateScope = useSubComp ? 'fullTree' : 'rootOnly';
for (const { wrapper, entry } of wrappers) {
  if (entry._inst) {
    wrapper.layoutMode = 'NONE';
    annotateNode(entry._inst, entry.tokenMap, true, annotateScope);
  }
}

return { success: true, section: SECTION_NAME };
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
   - **Table-driven annotations**: Measurement lines appear ONLY for properties that have a corresponding row in the section's table. If a property is not documented in the table, it is not annotated on the preview — no extra measurements. The `TOKEN_MAPS` built from table rows gate which properties get annotated.
   - **Padding measurements**: Native Figma measurement lines appear between auto-layout container edges and first/last visible child, but only when the token map includes `paddingTop`, `paddingBottom`, `paddingLeft`, or `paddingRight` entries (i.e., the table has padding rows).
   - **Spacing measurements**: Native Figma measurement lines appear between consecutive visible siblings, but only when the token map includes an `itemSpacing` entry (i.e., the table has a spacing row).
   - **Min/max constraints**: Measurement lines appear only when the token map includes `minWidth`, `maxWidth`, `minHeight`, or `maxHeight` entries (i.e., the table has corresponding rows).
   - **Measurement labels**: `freeText` labels always include the property name and value in the format `"propertyName (value)"` — e.g., `"paddingLeft (10)"`, `"itemSpacing (12)"`, `"minHeight (min 32)"`. When a `TOKEN_MAPS` entry exists, the value portion uses the token-enriched string (e.g., `"paddingLeft (spacing-md (16))"`). The property name prefix ensures annotations are self-descriptive when viewed on the canvas.
   - **Annotation scope**: Root sections annotate only the root instance. Sub-component sections annotate the full subtree of each instance. Nested INSTANCE children are measured externally but not recursed into — their internals are documented in their own sections.
   - **Minimum threshold**: No measurements appear for padding or spacing values below 4px.
   - **Sub-component preview correctness**: Sub-component section previews show instances from the sub-component's own component set (not the parent). Verify that the preview shows the sub-component in isolation (e.g., four Label instances at different sizes, not four full Text Field instances). If `SUB_COMP_OVERRIDES` was specified, verify that optional internal children (e.g., character count, icons) are visible on each preview instance.
   - **Behavior variant preview simplicity**: When a behavior/configuration axis exists (e.g., Static vs Interactive), the preview shows only the default configuration — one row of instances at each size. Do NOT duplicate instances for each configuration.
3. If issues are found, fix via `figma_execute` and re-capture (up to 3 iterations)

## Notes

- The structure template key is stored in `uspecs.config.json` under `templateKeys.structureSpec` and is configured via `@firstrun`.
- The target node can be either a `COMPONENT_SET` (multi-variant) or a standalone `COMPONENT` (single variant). The extraction script detects the type and returns `isComponentSet` accordingly. When the node is a standalone component, it is treated as a single-entry variants array and there are no variant axes. Preview instance creation in Step 11c uses `compNode.createInstance()` directly for standalone components.
- **Behavior/Configuration variant previews**: When a variant axis controls visual configuration (e.g., Static vs Interactive), the preview shows only the **default configuration** (e.g., Static) — one row of instances at each size is sufficient to illustrate dimensional properties. There is no need to duplicate instances for each configuration. If dimensional values are identical across configurations, document them once with a note. If a property like `borderWidth` differs, add it as a row in the table.
- **Two-tier extraction model**: The extraction script (Step 4b) provides a comprehensive structured baseline — variant axes, dimensions, token bindings, property definitions, sub-component discovery (with `subCompSetId`, `subCompVariantAxes`, and `booleanOverrides`), an enriched fully-enabled child tree, a layout tree, and collapsed/expanded dimensional representations. Step 4d adds a deterministic cross-variant dimensional comparison across all sizes for every sub-component. Together, these two deterministic scripts provide complete dimensional data, eliminating the need for free-form `figma_execute` exploration. The AI's reasoning budget (Step 6) is spent on interpretation, not data gathering.
- **Two levels of boolean toggles**: The parent component's `propertyDefs` contains booleans that gate top-level sub-components (e.g., "Show hint text" on a Text Field). Each sub-component INSTANCE also has its own `componentProperties` with booleans that gate *internal* children (e.g., "Character count" and "Show icon" on a Label instance). The enhanced extraction script (Step 4b) captures BOTH levels: `booleanDefs` for parent-level booleans, and `subComponents[].booleanOverrides` for each sub-component's own boolean properties. The enriched tree is always created (even when no parent booleans exist), ensuring sub-component discovery works for all components.
- The extraction script (Step 4b) selects representative variants only from dimension-affecting axes (Size, Density, Shape), skipping visual-only axes (State, Mode, Theme). Each variant returns full dimensions with `{ value, token, display }` tuples, recursive children with dimensions, and a layoutTree. For Size(4) × State(11), this yields 4 variants instead of 14. The enriched tree and subComponents include full dimensional data.
- **Collapsed/expanded dimensional model**: Padding is returned as a single `{ value, token, display }` when all four sides have equal values AND equal token names, `{ vertical, horizontal }` when top==bottom and left==right (values and tokens), or `{ top, bottom, start, end }` with logical directions when sides differ in value or token. This means two sides with the same numeric value but different token names (e.g., `spacing-vertical-md` vs `spacing-horizontal-md`, both resolving to 16) will be returned per-side, preserving the distinct token names. Same pattern for cornerRadius and strokeWeight. The data structure itself communicates whether values are uniform — the AI doesn't need to guess. Table rows become `padding` / `horizontalPadding` + `verticalPadding` / individual `paddingTop`, `paddingStart`, etc. based on the shape of the extraction output.
- **Logical direction normalization**: The extraction uses logical directions (`start`/`end`) instead of physical (`left`/`right`) for padding and stroke weight. Corner radii use `topStart`, `topEnd`, `bottomStart`, `bottomEnd`. This ensures specs are RTL-aware by default.
- **Typography as composite**: The extraction returns `typography: { styleName }` when a named text style is used, or `{ fontSize, fontWeight, lineHeight, ... }` for inline values — never both. This makes table row decisions deterministic: if `styleName` exists, emit one `textStyle` row; if inline, emit individual typography rows.
- **Pre-formatted display strings**: Every `{ value, token, display }` tuple includes a `display` field: `"token-name (value)"` when token-bound, `"value"` when hardcoded. Step 7 uses `display` directly as table cell values. Step 11a uses `display` values from rows to build token maps. No manual formatting of token+value strings is needed.
- **Layout tree**: Each variant includes a `layoutTree` — a recursive tree showing auto-layout nesting. Nodes that have `hasPadding` or `hasSpacing` are structurally significant containers; pass-through wrappers are collapsed. Step 6A uses this to identify which containers deserve sections in the section plan.
- **Section planning**: Step 6A builds a `sectionPlan` by applying deterministic rules to the extraction data (variant axes with numeric differences → columns, sub-components → sections, 2+ sub-components with size variants → composition section, state changes → state-conditional sections), then validates and adjusts the result using AI judgment about the component's actual structure. The rules and validation happen in a single pass — there is no separate deterministic script.
- **AI interpretation layer**: Step 6 redirects AI reasoning toward five high-value tasks: (A) validating the section plan against the full data, (B) writing design-intent notes that explain "why this value" not just "what is this property", (C) recognizing cross-section patterns, (D) detecting anomalies (scaling inconsistencies, token misconfiguration, asymmetric padding), and (E) judging completeness. This produces better output quality for engineers because the AI's reasoning budget is spent on interpretation, not mechanical data gathering.
- The `propertyDefs` from extraction provide the exact Figma property keys (including `#nodeId` suffixes for booleans) that the agent can use when creating preview instances in Step 11c.
- When the component is in a different file than the destination, run the extraction script in the component's file first, then navigate to the destination before importing the template.
- Dynamic columns: The `#variant-value` template in the header row and `#property-value-cell` in each data row are cloned once per value column, then the original template is removed. Clones are inserted before the Notes column to maintain correct column order. All value columns and the Notes column use `layoutSizingHorizontal = 'FILL'` so Figma's auto-layout distributes width equally across them.
- **Per-section rendering**: Step 11 processes one section at a time: determine preview parameters (11a), render table (11b), populate preview (11c). This keeps section-specific context fresh — the agent determines which variant axis, column values, property overrides, and token maps to use immediately before rendering each preview.
- Preview instances: Step 11c provides an explicit `figma_execute` script per section that creates labeled component instances inside each section's `#Preview` frame. It uses variant matching with fallback logic (exact match first, then best partial match) identical to create-property. The template's `#Preview` frame provides the layout — the script does not override any of its properties.
- **Annotation scope**: Root/variant sections (SUB_COMP_SET_ID empty) annotate only the root instance — no recursion into children. Sub-component sections (SUB_COMP_SET_ID non-empty) annotate the full visible subtree of each instance. This ensures each section's preview only shows measurements for what that section documents.
- **Table-driven annotations**: The `annotateNode()` function only creates measurements for properties that have an entry in the `tokenMap` (built from the section's table rows). A `hasTokenEntry()` guard on every measurement call ensures annotations exactly match what the table documents — no extra measurements for properties not in the table. Padding and spacing measurements use Figma's native display (actual pixel values); min/max constraint measurements use `freeText` with the actual node property value (e.g., `min 32`). When scope is `fullTree`, it recurses into the visible subtree; when scope is `rootOnly`, it annotates only the entry-point node.
- **INSTANCE recursion boundary**: When recursing, nested INSTANCE children are measured externally but NOT recursed into.
- **Sub-component preview sourcing**: When a section documents a sub-component, the preview script uses `SUB_COMP_SET_ID` (from `subComponents[].subCompSetId` in Step 4b) to create instances from the sub-component's own component set. The `SUB_COMP_OVERRIDES` (from `subComponents[].booleanOverrides` with all values set to `true`) enables boolean properties on each instance so optional internal children are visible.
- **Native Figma measurements**: All dimension annotations use `figma.currentPage.addMeasurement()`. Padding and spacing measurements use Figma's default display (actual measured pixel values) with no `freeText` or custom offset. Min/max constraint measurements use `freeText` with the actual node constraint value (e.g., `'min ' + Math.round(node.minHeight)`) and Figma's default centering.
- **Token map from extraction data**: Because the extraction returns pre-formatted `display` strings, token maps are built directly from the section's row data. The `display` string goes directly into table cells, eliminating manual TOKEN_MAPS construction. The mapping from table spec names to Figma properties (including `minWidth`, `maxWidth`, `minHeight`, `maxHeight`) is documented in Step 11a. The token map gates which properties get annotated — only properties with a token map entry produce measurement lines.
- **Minimum annotation threshold**: Measurements are skipped when the padding or spacing value is less than 4px.
- Hierarchy indicators: The `#hierarchy-indicator` frame contains two child vectors — `within-group` (├─) for mid-group rows and `#hierarchy-indicator-last` (└─) for the last row. For non-sub-properties, the entire frame is hidden.
- Each section is rendered in a separate `figma_execute` call to avoid timeouts.
- The instruction file (`structure/agent-structure-instruction.md`) contains the decision framework, examples, and field rules for organizing sections and columns.
