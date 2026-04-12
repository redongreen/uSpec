---
name: create-anatomy
description: Generate a visual anatomy annotation in Figma showing numbered markers on a component instance with an attribute table. Use when the user mentions "anatomy", "anatomy annotation", "component anatomy", "create anatomy", or wants to annotate a component's structural elements.
---

# Create Anatomy Annotation

Generate a hierarchical anatomy annotation directly in Figma — a **composition section** showing the top-level sub-components with numbered markers and a 4-column attribute table, then **per-child sections** for each INSTANCE sub-component showing all its internal elements (including hidden ones).

Uses the **Anatomy & Properties v2** template with `#annotation-table`, type indicators (`#instance` / `#text` / `#slot`), and `#anatomy-section` cloning.

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

- **Figma link to the component**: URL to a component set or standalone component in Figma (required)
- **Figma link to the destination** (optional): URL to the page/frame where the annotation should be placed. If omitted, places it in the same file as the component.

## Workflow

Copy this checklist and update as you progress:

```
Task Progress:
- [ ] Step 1: Verify MCP connection
- [ ] Step 2: Read template key from uspecs.config.json
- [ ] Step 3: Navigate to the component and extract anatomy data (incl. property definitions)
- [ ] Step 4: Evaluate variant selection, classify elements, and enrich notes (AI reasoning)
- [ ] Step 5: Navigate to destination (if different file)
- [ ] Step 6: Import and detach the Anatomy template
- [ ] Step 7: Fill header fields and create composition section
- [ ] Step 8: Build composition artwork with markers + fill table
- [ ] Step 8b: Per-sub-component child sections (property-aware unhide)
- [ ] Step 10: Visual validation
```

### Step 1: Verify MCP Connection

Read `mcpProvider` from `uspecs.config.json` to determine which Figma MCP to use.

**If `figma-console`:**
- `figma_get_status` — Confirm Desktop Bridge plugin is active
- If connection fails: *"Please open Figma Desktop and run the Desktop Bridge plugin. Then try again."*

**If `figma-mcp`:**
- Connection is verified implicitly on the first `use_figma` call. No explicit check needed.
- If the first call fails: *"Please verify your FIGMA_API_KEY is set correctly in your MCP configuration."*

### Step 2: Read Template Key

Read the file `uspecs.config.json` and extract:
- The `anatomyOverview` value from the `templateKeys` object → save as `ANATOMY_TEMPLATE_KEY`
- The `fontFamily` value → save as `FONT_FAMILY` (default to `Inter` if not set)

If the template key is empty, tell the user:
> The anatomy template key is not configured. Run `@firstrun` with your Figma template library link first.

### Step 3: Extract Anatomy Data

Navigate to the component file and run the extraction script via `figma_execute`.

**Extract the node ID from the URL:** Figma URLs contain `node-id=123-456` → use `123:456`.

This produces a **pre-classified element array** with deterministic element types, resolved prop bindings, and unwrapped instance wrappers — no AI reasoning needed for classification. See the output contract after the script for field documentation.

**Wrapper traversal sync warning:** The single-child auto-layout / SLOT / background-rect traversal logic appears in three places — the extraction script below, the Step 8 composition artwork script, and the Step 8b per-child artwork script — and must stay in sync.

Run this extraction script, replacing `TARGET_NODE_ID` with the actual node ID and `__PREFERRED_VARIANT_PROPS__` with `null` for the initial extraction (or a variant property object like `{ "variant": "count-forward" }` when re-extracting after Step 4 sub-step 0 identifies a richer variant):

```javascript
const TARGET_NODE_ID = '__NODE_ID__';
const PREFERRED_VARIANT_PROPS = __PREFERRED_VARIANT_PROPS__;
const STRUCTURAL_TYPES = ['RECTANGLE', 'VECTOR', 'ELLIPSE', 'LINE', 'POLYGON', 'STAR', 'BOOLEAN_OPERATION'];

function hasVisuals(n) {
  const f = n.fills && n.fills.length > 0 && n.fills.some(f => f.visible !== false);
  const s = n.strokes && n.strokes.length > 0 && n.strokes.some(s => s.visible !== false);
  const e = n.effects && n.effects.length > 0 && n.effects.some(e => e.visible !== false);
  return { hasFills: !!f, hasStrokes: !!s, hasEffects: !!e, hasAny: !!f || !!s || !!e };
}

async function resolveInstanceInfo(instNode) {
  try {
    const mc = await instNode.getMainComponentAsync();
    if (!mc) return null;
    const isSet = mc.parent && mc.parent.type === 'COMPONENT_SET';
    const cs = isSet ? mc.parent : null;
    const info = {
      mainComponentId: mc.id,
      mainComponentSetId: cs ? cs.id : null,
      childIsComponentSet: !!cs,
      componentSetName: cs ? cs.name : mc.name,
      childVariantCount: cs ? cs.children.length : 1,
      childVariantAxes: []
    };
    if (cs) {
      const csPropDefs = cs.componentPropertyDefinitions || {};
      for (const [ck, cd] of Object.entries(csPropDefs)) {
        if (cd.type === 'VARIANT') {
          info.childVariantAxes.push({ name: ck.split('#')[0], options: cd.variantOptions || [], defaultValue: cd.defaultValue });
        }
      }
    }
    return info;
  } catch { return null; }
}

async function walkToInnerInstance(node, depth) {
  if (depth > 8) return null;
  if (node.type === 'INSTANCE') return node;
  if ((node.type === 'FRAME' || node.type === 'GROUP') && 'children' in node && node.children.length === 1) {
    return walkToInnerInstance(node.children[0], depth + 1);
  }
  return null;
}

async function extractElement(node, index, artworkAbsX, artworkAbsY) {
  const absX = node.absoluteTransform[0][2];
  const absY = node.absoluteTransform[1][2];
  const element = {
    index,
    name: node.name,
    originalName: null,
    nodeType: node.type,
    classification: null,
    visible: node.visible,
    bbox: {
      x: Math.round(absX - artworkAbsX),
      y: Math.round(absY - artworkAbsY),
      w: Math.round(node.width),
      h: Math.round(node.height)
    },
    notes: '',
    controlledByBoolean: null,
    wrappedInstance: null,
    mainComponentId: null,
    mainComponentSetId: null,
    childIsComponentSet: false,
    childVariantAxes: [],
    childVariantCount: 1,
    shouldCreateSection: false
  };

  if (node.type === 'INSTANCE') {
    const info = await resolveInstanceInfo(node);
    if (info) {
      Object.assign(element, info);
      element.notes = info.componentSetName + ' instance';
    }
    element.classification = 'instance';
  } else if (node.type === 'TEXT') {
    element.classification = 'text';
    const content = node.characters || '';
    if (content.length > 0 && content.length <= 30) {
      element.notes = 'Text element \u2014 "' + content + '"';
    } else {
      element.notes = 'Text element';
    }
  } else if (node.type === 'FRAME' || node.type === 'GROUP') {
    const innerInst = await walkToInnerInstance(node, 0);
    if (innerInst && innerInst !== node) {
      const info = await resolveInstanceInfo(innerInst);
      if (info) {
        element.wrappedInstance = info;
        element.originalName = element.name;
        element.nodeType = 'INSTANCE';
        element.classification = 'instance-unwrapped';
        Object.assign(element, {
          mainComponentId: info.mainComponentId,
          mainComponentSetId: info.mainComponentSetId,
          childIsComponentSet: info.childIsComponentSet,
          childVariantAxes: info.childVariantAxes,
          childVariantCount: info.childVariantCount
        });
        element.notes = element.name + ' instance';
      } else {
        element.classification = 'container';
        const childCount = ('children' in node) ? node.children.length : 0;
        element.notes = 'Container with ' + childCount + ' children';
      }
    } else if ('children' in node && node.children.length === 1 && node.children[0].type === 'TEXT') {
      const textChild = node.children[0];
      element.originalName = element.name;
      element.nodeType = 'TEXT';
      element.classification = 'text';
      const content = textChild.characters || '';
      if (content.length > 0 && content.length <= 30) {
        element.notes = 'Text element \u2014 "' + content + '"';
      } else {
        element.notes = 'Text element';
      }
    } else {
      const childCount = ('children' in node) ? node.children.length : 0;
      element.classification = childCount > 0 ? 'container' : 'structural';
      element.notes = childCount > 0 ? 'Container with ' + childCount + ' children' : 'Empty container';
    }
  } else if (node.type === 'SLOT') {
    element.classification = 'slot';
    const childCount = ('children' in node) ? node.children.length : 0;
    element.notes = 'Composable slot with ' + childCount + ' children';
  } else if (STRUCTURAL_TYPES.includes(node.type)) {
    element.classification = 'structural';
    element.notes = node.type;
  } else {
    element.classification = 'structural';
    element.notes = node.type;
  }

  return element;
}

const node = await figma.getNodeByIdAsync(TARGET_NODE_ID);
if (!node || (node.type !== 'COMPONENT_SET' && node.type !== 'COMPONENT')) {
  return { error: 'Node is not a component set or component. Type: ' + (node ? node.type : 'null') };
}

const isComponentSet = node.type === 'COMPONENT_SET';

function resolveChildContainer(v) {
  let cc = v;
  while (cc.children.length === 1 && cc.children[0].type === 'FRAME' && cc.children[0].layoutMode !== 'NONE') {
    cc = cc.children[0];
  }
  if (cc.children.length === 1 && cc.children[0].type === 'SLOT') {
    cc = cc.children[0];
  }
  if (cc === v && cc.children.length > 1) {
    const autoLayoutFrames = cc.children.filter(c => c.type === 'FRAME' && c.layoutMode !== 'NONE' && ('children' in c) && c.children.length >= 2);
    const structuralOnly = cc.children.filter(c => STRUCTURAL_TYPES.includes(c.type));
    if (autoLayoutFrames.length === 1 && structuralOnly.length === cc.children.length - 1) {
      cc = autoLayoutFrames[0];
    }
  }
  return cc;
}

let variant;
if (PREFERRED_VARIANT_PROPS && isComponentSet) {
  variant = node.children.find(v => {
    const props = v.variantProperties || {};
    return Object.entries(PREFERRED_VARIANT_PROPS).every(
      ([k, val]) => props[k] === val
    );
  }) || node.defaultVariant || node.children[0];
} else {
  variant = isComponentSet ? (node.defaultVariant || node.children[0]) : node;
}
let childContainer = resolveChildContainer(variant);

if (isComponentSet && childContainer.children.length === 0 && node.children.length > 1) {
  function countDescendants(n) {
    let c = 0;
    if ('children' in n) { for (const ch of n.children) { c += 1 + countDescendants(ch); } }
    return c;
  }
  let bestVariant = variant;
  let bestCount = 0;
  for (const v of node.children) {
    const cnt = countDescendants(v);
    if (cnt > bestCount) { bestCount = cnt; bestVariant = v; }
  }
  if (bestVariant !== variant) {
    variant = bestVariant;
    childContainer = resolveChildContainer(variant);
  }
}

const varAbsX = variant.absoluteTransform[0][2];
const varAbsY = variant.absoluteTransform[1][2];

const rootVis = hasVisuals(variant);
const rootVariantVisuals = {
  hasFills: rootVis.hasFills, hasStrokes: rootVis.hasStrokes, hasEffects: rootVis.hasEffects,
  cornerRadius: variant.cornerRadius || 0
};

const traversedFrames = [];
let walker = variant;
while (walker !== childContainer) {
  if ('children' in walker && walker.children.length === 1) {
    const child = walker.children[0];
    const vis = hasVisuals(child);
    const cAbsX = child.absoluteTransform[0][2];
    const cAbsY = child.absoluteTransform[1][2];
    traversedFrames.push({
      name: child.name, nodeType: child.type,
      hasFills: vis.hasFills, hasStrokes: vis.hasStrokes, hasEffects: vis.hasEffects,
      cornerRadius: child.cornerRadius || 0,
      bbox: { x: Math.round(cAbsX - varAbsX), y: Math.round(cAbsY - varAbsY), w: Math.round(child.width), h: Math.round(child.height) }
    });
    walker = child;
  } else break;
}

const absX = varAbsX;
const absY = varAbsY;

const elements = [];
let idx = 1;
for (const child of childContainer.children) {
  elements.push(await extractElement(child, idx++, absX, absY));
}

const propDefs = node.componentPropertyDefinitions || {};
const booleanProps = [];
const variantAxes = [];
const instanceSwapProps = [];

for (const [rawKey, def] of Object.entries(propDefs)) {
  const cleanKey = rawKey.split('#')[0];
  if (def.type === 'VARIANT') {
    variantAxes.push({ name: cleanKey, options: def.variantOptions || [], defaultValue: def.defaultValue });
  } else if (def.type === 'BOOLEAN') {
    let associatedLayer = null;
    let boundElementIndex = null;
    const defaultVariantProps = variant.componentProperties;
    if (defaultVariantProps) {
      for (const [k, v] of Object.entries(defaultVariantProps)) {
        if (k.split('#')[0] === cleanKey && v.type === 'BOOLEAN') {
          const nodeIdSuffix = k.split('#')[1];
          if (nodeIdSuffix) {
            try {
              const lid = variant.id.split(';')[0] + ';' + nodeIdSuffix;
              const layerNode = await figma.getNodeByIdAsync(lid);
              if (layerNode) {
                associatedLayer = layerNode.name;
                for (const el of elements) {
                  const matchName = el.originalName || el.name;
                  if (matchName === layerNode.name) {
                    boundElementIndex = el.index;
                    break;
                  }
                }
              }
            } catch {}
          }
        }
      }
    }
    if (boundElementIndex === null) {
      for (const el of elements) {
        const matchName = el.originalName || el.name;
        if (matchName.toLowerCase() === cleanKey.toLowerCase()) {
          boundElementIndex = el.index;
          if (!associatedLayer) associatedLayer = matchName;
          break;
        }
      }
    }
    booleanProps.push({ name: cleanKey, defaultValue: def.defaultValue, associatedLayer, rawKey, boundElementIndex });
  } else if (def.type === 'INSTANCE_SWAP') {
    let swapTargetName = def.defaultValue;
    try {
      const swapNode = await figma.getNodeByIdAsync(def.defaultValue);
      if (swapNode) swapTargetName = swapNode.name;
    } catch {}
    instanceSwapProps.push({ name: cleanKey, defaultValue: swapTargetName, rawKey });
  }
}

for (const bp of booleanProps) {
  if (bp.boundElementIndex !== null) {
    const el = elements.find(e => e.index === bp.boundElementIndex);
    if (el) {
      el.controlledByBoolean = { propName: bp.name, rawKey: bp.rawKey, defaultValue: bp.defaultValue };
    }
  }
}

for (const el of elements) {
  if (el.classification === 'instance' || el.classification === 'instance-unwrapped') {
    el.shouldCreateSection = true;
    const UTILITY_NAMES = ['spacer', 'divider', 'separator', 'divider line', 'gap', 'padding', 'filler'];
    if (UTILITY_NAMES.includes(el.name.toLowerCase())) {
      el.shouldCreateSection = false;
    }
  }
}

// --- Resolve slot preferred instances and boolean bindings ---
const slotPropDefs = {};
for (const [rawKey, def] of Object.entries(propDefs)) {
  if (def.type === 'SLOT') {
    slotPropDefs[rawKey] = def;
  }
}

const allCompKeys = new Map();
if (Object.values(slotPropDefs).some(d => d.preferredValues && d.preferredValues.length > 0)) {
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
  let _rp = variant; while (_rp.parent && _rp.parent.type !== 'DOCUMENT') _rp = _rp.parent;
  if (_rp.type === 'PAGE') await figma.setCurrentPageAsync(_rp);
}

for (const el of elements) {
  if (el.classification !== 'slot') continue;
  const slotNode = childContainer.children[el.index - 1];
  if (!slotNode) continue;

  const cpRefs = slotNode.componentPropertyReferences || {};
  if (cpRefs.visible) {
    const visRawKey = cpRefs.visible;
    const visClean = visRawKey.split('#')[0];
    el.slotBooleanBinding = { propName: visClean, rawKey: visRawKey };
    if (!el.controlledByBoolean) {
      const bp = booleanProps.find(b => b.rawKey === visRawKey);
      if (bp) el.controlledByBoolean = { propName: bp.name, rawKey: bp.rawKey, defaultValue: bp.defaultValue };
    }
  }

  const slotName = slotNode.name;
  let matchedSlotDef = null;
  for (const [rawKey, def] of Object.entries(slotPropDefs)) {
    if (rawKey.split('#')[0] === slotName) { matchedSlotDef = def; break; }
  }
  if (matchedSlotDef && matchedSlotDef.preferredValues && matchedSlotDef.preferredValues.length > 0) {
    el.slotPreferredInstances = [];
    for (const pv of matchedSlotDef.preferredValues) {
      if (pv.type !== 'COMPONENT') continue;
      const compNode = allCompKeys.get(pv.key);
      if (compNode) {
        const isSet = compNode.parent && compNode.parent.type === 'COMPONENT_SET';
        el.slotPreferredInstances.push({
          componentKey: pv.key,
          componentName: compNode.name,
          componentId: compNode.id,
          isComponentSet: isSet,
          componentSetId: isSet ? compNode.parent.id : null,
          componentSetName: isSet ? compNode.parent.name : compNode.name
        });
      }
    }
  }

  if ('children' in slotNode && slotNode.children.length > 0) {
    el.slotDefaultChildren = [];
    for (const sc of slotNode.children) {
      const scInfo = { name: sc.name, nodeType: sc.type, visible: sc.visible };
      if (sc.type === 'INSTANCE') {
        try {
          const mc = await sc.getMainComponentAsync();
          if (mc) {
            scInfo.mainComponentId = mc.id;
            scInfo.mainComponentKey = mc.key;
            const isSet = mc.parent && mc.parent.type === 'COMPONENT_SET';
            scInfo.componentSetName = isSet ? mc.parent.name : mc.name;
            scInfo.componentSetId = isSet ? mc.parent.id : null;
            scInfo.isComponentSet = isSet;
          }
        } catch {}
      }
      el.slotDefaultChildren.push(scInfo);
    }
  }
}

return {
  componentName: node.name,
  variantName: variant.name,
  selectedVariantId: variant.id,
  compSetNodeId: TARGET_NODE_ID,
  isComponentSet,
  rootSize: { w: Math.round(variant.width), h: Math.round(variant.height) },
  elements,
  booleanProps,
  variantAxes,
  instanceSwapProps,
  rootVariantVisuals,
  traversedFrames,
  childContainerIsVariant: childContainer === variant
};
```

Save the returned JSON — you will use `componentName`, `compSetNodeId`, `selectedVariantId`, `isComponentSet`, `rootSize`, `elements`, `booleanProps`, `variantAxes`, `instanceSwapProps`, `rootVariantVisuals`, `traversedFrames`, and `childContainerIsVariant` in subsequent steps. `selectedVariantId` is the variant that was actually used for extraction — it may differ from the default variant if `PREFERRED_VARIANT_PROPS` was set (agent-directed re-extraction from Step 4 sub-step 0) or if the default produced 0 elements and the script fell back to the richest variant.

Each element carries pre-resolved fields:
- `classification` — closed enum: `instance`, `instance-unwrapped`, `text`, `slot`, `container`, `structural`
- `name` — the designer-facing layer name. For `instance-unwrapped`, this is the wrapper frame's name (e.g., "Thumb"), not the inner component's name. For `text` classification from a FRAME-wrapped TEXT node, this is the FRAME name (e.g., "Label"). The inner component name is available in `wrappedInstance.componentSetName`.
- `controlledByBoolean` — `{ propName, rawKey, defaultValue }` or `null` (resolved by element index, not name matching)
- `wrappedInstance` — component info for the inner INSTANCE (only on `instance-unwrapped` elements): includes `componentSetName` (the inner component's name used by Step 8b for child section creation)
- `originalName` — the FRAME name before unwrapping (on `instance-unwrapped` and FRAME-wrapped `text` elements)
- `shouldCreateSection` — `true` for `instance`/`instance-unwrapped`, `false` for utility names and other types
- `childVariantAxes`, `childVariantCount` — variant data from the child component set
- `slotBooleanBinding` — `{ propName, rawKey }` or absent. Present on `slot` elements when the slot's `componentPropertyReferences.visible` points to a boolean property.
- `slotPreferredInstances[]` — array of `{ componentKey, componentName, componentId, isComponentSet, componentSetId, componentSetName }` or absent. Present on `slot` elements when the parent component defines `preferredValues` for this slot.
- `slotDefaultChildren[]` — array of `{ name, nodeType, visible, mainComponentId?, mainComponentKey?, componentSetName?, componentSetId?, isComponentSet? }` or absent. Present on `slot` elements that contain children in the default variant. Used to identify what content populates the slot by default.

Additional extraction-level fields:
- `rootVariantVisuals` — `{ hasFills, hasStrokes, hasEffects, cornerRadius }` for the root variant frame. When `hasFills` or `hasEffects` is true, the variant has visual properties. Step 4 should fold these into the root container's note when a container synthetic is already being created, or insert a standalone synthetic backplate/statelayer element when no container synthetic covers the root variant. `hasStrokes` is included for informational purposes (to enrich the root container note with border details) but does NOT trigger a separate synthetic element — strokes on the root variant are a border property of the container frame.
- `traversedFrames[]` — Frames the `resolveChildContainer` traversal walked through to reach the child container. Each entry has `{ name, nodeType, hasFills, hasStrokes, hasEffects, cornerRadius, bbox }`. Frames with fills, strokes, or effects are visually meaningful and should be inserted as synthetic elements by Step 4.
- `childContainerIsVariant` — `true` when `resolveChildContainer` resolved to the variant itself (no wrapper traversal). `false` when it traversed into a child frame, meaning the root component container was skipped during extraction. When `false`, Step 4 should insert a synthetic element for the root container regardless of whether it has visual properties.

The `fullTree` field has been removed. Classification, instance-wrapper detection, and prop binding are now handled deterministically in the extraction script itself.

### Step 4: Validate Extraction and Enrich Notes (AI Reasoning)

This is a pure reasoning step — no `figma_execute` calls unless a re-extraction is needed (sub-step 0). The extraction script (Step 3) has already performed classification, instance-wrapper unwrapping, boolean binding, and section eligibility. Step 4 focuses on **variant evaluation**, **validation**, and **semantic note-writing**.

Read the instruction file `anatomy/agent-anatomy-instruction.md`, then enrich the extraction data in-memory before proceeding to rendering.

**Process:**

0. **Evaluate variant selection**: If `isComponentSet` is true and `elements.length` is small (1–2 elements), review `variantAxes` option names for a structurally richer variant. If a clearly richer variant exists (option names suggest additional sub-components, e.g., "count-forward" adds a count badge to "forward"), re-run the Step 3 extraction script with `PREFERRED_VARIANT_PROPS` set to the target variant's property values and replace all Step 3 output data. Do NOT re-extract for purely stylistic differences (color, size, theme). See `anatomy/agent-anatomy-instruction.md` sub-step 0 for the full evaluation rules.

1. **Read** `anatomy/agent-anatomy-instruction.md` for note-writing guidelines, validation checklist, and unhide strategy rules.

2. **Validate** the pre-classified extraction data per the instruction file's validation checklist.

2b. **Detect skipped visual layers and root container**: Check `childContainerIsVariant`, `rootVariantVisuals`, and `traversedFrames` from the extraction output. When `childContainerIsVariant` is `false`, always insert a synthetic element for the root container. When `childContainerIsVariant` is `true`, evaluate whether the root container is architecturally meaningful (e.g., hosts composable slots, manages conditional visibility) and insert a synthetic element if so — skip it when the container is a self-evident stack of same-type sub-components. Root variant fills/effects (NOT strokes — strokes are described in the container note) are folded into the container's note when a container synthetic already exists, or inserted as standalone synthetic elements when no container synthetic covers the root variant. Also insert synthetic elements for traversed frames with fills/strokes/effects. See `anatomy/agent-anatomy-instruction.md` sub-step 1b for the full procedure and examples.

3. **Set unhide strategy** for hidden elements per the instruction file's Property-Aware Unhide Decisions section.

3b. **Detect inline markers**: For each element, determine whether it should use an inline marker (marker sits directly on the element's nearest edge with a short stub line) or a perimeter marker (standard marker outside the artwork). Elements nested inside another annotated element (e.g., slot default children that are also annotated) get `inlineMarker: true`. See `anatomy/agent-anatomy-instruction.md` for the detection rules.

3c. **Enrich slot preferred instances**: For each `slot` element that has `slotPreferredInstances`, enrich notes to mention the preferred component names. If the slot has `slotDefaultChildren`, mention the default content. For empty/hidden slots with preferred instances, mark the slot for artwork population (set `populateSlot: true` and `populateWith` to the first preferred instance). See `anatomy/agent-anatomy-instruction.md` for the enrichment rules.

4. **Rewrite** the `notes` field for each element following the instruction file's note-writing guidelines.

4b. **Integrate user-provided design context** into notes per the instruction file's guidelines.

4c. **Compose brief description**: Write a 1-sentence `briefDescription` (max ~15 words) that describes what this component IS and does — not what the spec shows. Incorporate user-provided context when available. See `anatomy/agent-anatomy-instruction.md` for guidelines and examples. Save this string for Step 7.

5. **Deduplicate repeated composition elements**: When multiple consecutive elements share the same `mainComponentSetId`, collapse them into a single representative element with a `count` field. The first element is kept; subsequent duplicates are removed from the array. The representative element's name gets an `(xN)` suffix in the table. Write notes for deduplicated elements per the instruction file's "Repeated composition elements" guidelines.

6. **Validate** using the instruction file's checklist.

The enriched `elements` array (with updated `notes`, `unhideStrategy`, `count`, `isSynthetic`, `inlineMarker`, `populateSlot`, `populateWith`, `shouldCreateSection`, and `slotPreferredComponentId` fields, plus any synthetic elements inserted for skipped visual layers) and the `briefDescription` string are used by all subsequent rendering steps.

### Step 5: Navigate to Destination

If the user provided a separate destination file URL:
- `figma_navigate` — Switch to the destination file

If no destination was provided, stay in the current file.

### Step 6: Import and Detach Template

**If the user provided a cross-file destination URL** (navigated in Step 5), run via `figma_execute`:

```javascript
const ANATOMY_TEMPLATE_KEY = '__ANATOMY_TEMPLATE_KEY__';

const templateComponent = await figma.importComponentByKeyAsync(ANATOMY_TEMPLATE_KEY);
const instance = templateComponent.createInstance();
const { x, y } = figma.viewport.center;
instance.x = x - instance.width / 2;
instance.y = y - instance.height / 2;
const frame = instance.detachInstance();
frame.name = '__COMPONENT_NAME__ Anatomy';
figma.currentPage.selection = [frame];
figma.viewport.scrollAndZoomIntoView([frame]);
return { frameId: frame.id };
```

**If no destination was provided (default)**, run via `figma_execute` — this places the spec on the component's page, to its right:

```javascript
const ANATOMY_TEMPLATE_KEY = '__ANATOMY_TEMPLATE_KEY__';
const COMP_NODE_ID = '__COMPONENT_NODE_ID__';

const compNode = await figma.getNodeByIdAsync(COMP_NODE_ID);
let _p = compNode;
while (_p.parent && _p.parent.type !== 'DOCUMENT') _p = _p.parent;
if (_p.type === 'PAGE') await figma.setCurrentPageAsync(_p);

const templateComponent = await figma.importComponentByKeyAsync(ANATOMY_TEMPLATE_KEY);
const instance = templateComponent.createInstance();
const frame = instance.detachInstance();

const GAP = 200;
frame.x = compNode.x + compNode.width + GAP;
frame.y = compNode.y;

frame.name = '__COMPONENT_NAME__ Anatomy';
figma.currentPage.selection = [frame];
figma.viewport.scrollAndZoomIntoView([frame]);
return { frameId: frame.id, pageId: _p.id, pageName: _p.name };
```

Replace `__COMPONENT_NAME__` with the extracted `componentName`. Replace `__COMPONENT_NODE_ID__` with the node ID extracted from the component URL (same as `TARGET_NODE_ID` from Step 3).

Save the returned `frameId` — you need it for all subsequent steps.

### Step 7: Fill Header Fields and Create Composition Section

This step fills the top-level header and creates a dedicated anatomy section by **cloning** `#anatomy-section`. The clone is renamed so it is not affected by other skills' cleanup. After cloning, the original `#anatomy-section` is **hidden** to prevent its placeholder text from appearing in screenshots. The property skill re-shows it if it needs additional clones.

Run via `figma_execute` (replace `__FRAME_ID__`, `__COMPONENT_NAME__`, `__BRIEF_DESCRIPTION__`). Replace `__BRIEF_DESCRIPTION__` with the `briefDescription` composed during Step 4 sub-step 4c:

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

const compNameFrame = frame.findOne(n => n.name === '#comp-name-anatomy');
if (compNameFrame) {
  const t = compNameFrame.findOne(n => n.type === 'TEXT');
  if (t) t.characters = '__COMPONENT_NAME__';
}

const descFrame = frame.findOne(n => n.name === '#brief-component-description');
if (descFrame) {
  const t = descFrame.findOne(n => n.type === 'TEXT');
  if (t) t.characters = '__BRIEF_DESCRIPTION__';
}

const anatomySectionTemplate = frame.findOne(n => n.name === '#anatomy-section');
const compositionSection = anatomySectionTemplate.clone();
anatomySectionTemplate.parent.appendChild(compositionSection);
compositionSection.name = 'Component structure';
compositionSection.visible = true;

const sectionFrame = compositionSection.findOne(n => n.name === '#section-name');
if (sectionFrame) {
  const t = sectionFrame.findOne(n => n.type === 'TEXT');
  if (t) t.characters = 'Component structure';
}

const sectionDescFrame = compositionSection.findOne(n => n.name === '#optional-section-description');
if (sectionDescFrame) {
  const t = sectionDescFrame.findOne(n => n.type === 'TEXT');
  if (t) t.characters = 'Elements that compose the __COMPONENT_NAME__ and their key attributes.';
}

anatomySectionTemplate.visible = false;

return { success: true, compositionSectionId: compositionSection.id };
```

Save the returned `compositionSectionId` — you need it for Step 8.

### Step 8: Build Composition Artwork with Markers + Fill Table

Run via `figma_execute`. Replace `__COMPOSITION_SECTION_ID__`, `__COMP_SET_NODE_ID__`, `__SELECTED_VARIANT_ID__`, `__IS_COMPONENT_SET__`, the `elements` array, and `__BOOLEAN_UNHIDES_JSON__` with the enriched data from Step 4. Use the `compositionSectionId` from Step 7 to scope lookups. `__SELECTED_VARIANT_ID__` is the `selectedVariantId` returned by Step 3 — it may differ from the default variant. `__BOOLEAN_UNHIDES_JSON__` is an array of `{ booleanRawKey }` objects from elements whose `unhideStrategy.method === 'boolean'` — these booleans are toggled via `setProperties` instead of direct unhide. Pass `[]` if no boolean-controlled hidden elements exist. Fonts are loaded in two phases: (1) template fonts from marker and section text nodes, and (2) instance fonts via `loadAllFonts` after `createInstance`, after `setProperties`, and after slot population — this catches fonts used by component instances (e.g., "Uber Move") that differ from the template font. No `__FONT_FAMILY__` replacement needed.

**Artwork** (`#preview`): Place a component instance with hidden children made visible via property-aware unhide, then clone `#marker-example` for each element with connecting lines using the nearest-edge + collision avoidance algorithm. Elements with `inlineMarker: true` get a short stub line on their nearest edge instead of a perimeter marker. Elements with `populateSlot: true` get the preferred component inserted directly into the SLOT node via `appendChild`; if slot insertion fails, fall back to a ghost instance at the slot's bbox position. The `elements` array may contain synthetic elements (`isSynthetic: true`) inserted by Step 4 — these include the root component container (when `childContainerIsVariant` is false) and any visually-meaningful skipped layers. Synthetic elements are skipped in the child-index-to-bbox loop (they have no corresponding child node), but their bboxes are updated by a separate reflow-update block that runs after all mutations — this block re-reads `compInstance.width`/`compInstance.height`, recalculates artwork dimensions, re-centers the instance, and updates synthetic bboxes to match the post-reflow component size.

**Table** (`#annotation-table`): Clone the template `row` for each element, filling 4 cells: `#number`, `#indicator` (show one of `#instance` / `#text` / `#slot`, hide the other two), `#element-name`, `#notes`.

```javascript
const COMPOSITION_SECTION_ID = '__COMPOSITION_SECTION_ID__';
const COMP_SET_ID = '__COMP_SET_NODE_ID__';
const SELECTED_VARIANT_ID = '__SELECTED_VARIANT_ID__';
const IS_COMPONENT_SET = __IS_COMPONENT_SET__;
const MARKER_COLOR = { r: 0.922, g: 0, b: 0.431 };

const elements = __ELEMENTS_JSON__;

const section = await figma.getNodeByIdAsync(COMPOSITION_SECTION_ID);
const frame = section.parent.parent;
const preview = section.findOne(n => n.name === '#preview');
const markerExample = frame.findOne(n => n.name === '#marker-example');

const MARKER_SIZE = 33;
const MARKER_OFFSET = 40;
const PADDING = 80;
const MIN_W = 1400;
const MIN_H = 290;
const COLLISION_GAP = 8;
const INLINE_STUB = 16;

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

const selectedVariant = await figma.getNodeByIdAsync(SELECTED_VARIANT_ID);
const compInstance = selectedVariant.createInstance();
await loadAllFonts(compInstance);

let rootW = Math.round(compInstance.width);
let rootH = Math.round(compInstance.height);

const perimeterCount = elements.filter(el => !el.inlineMarker).length;
const markerPadding = Math.ceil(perimeterCount / 4) * (MARKER_SIZE + COLLISION_GAP);
const sideRoom = MARKER_SIZE + MARKER_OFFSET + PADDING + markerPadding;
let neededW = rootW + 2 * sideRoom;
let neededH = rootH + 2 * sideRoom;
let ARTWORK_W = Math.max(MIN_W, Math.round(neededW));
let ARTWORK_H = Math.max(MIN_H, Math.round(neededH));

const wrapper = figma.createFrame();
wrapper.name = 'Artwork wrapper';
wrapper.layoutMode = 'NONE';
wrapper.resize(ARTWORK_W, ARTWORK_H);
wrapper.clipsContent = true;
wrapper.fills = [];
preview.appendChild(wrapper);

let compX = Math.round((ARTWORK_W - rootW) / 2);
let compY = Math.round((ARTWORK_H - rootH) / 2);

wrapper.appendChild(compInstance);
compInstance.x = compX;
compInstance.y = compY;

const BOOLEAN_UNHIDES = __BOOLEAN_UNHIDES_JSON__;

if (BOOLEAN_UNHIDES.length > 0) {
  const currentProps = {};
  for (const bu of BOOLEAN_UNHIDES) {
    currentProps[bu.booleanRawKey] = true;
  }
  compInstance.setProperties(currentProps);
  await loadAllFonts(compInstance);
}

for (const el of elements) {
  if (!el.visible && (!el.unhideStrategy || el.unhideStrategy.method === 'direct')) {
    function findAndUnhide(node, targetName) {
      if (node.name === targetName && !node.visible) { node.visible = true; return true; }
      if ('children' in node) { for (const c of node.children) { if (findAndUnhide(c, targetName)) return true; } }
      return false;
    }
    findAndUnhide(compInstance, el.name);
  }
}
await loadAllFonts(compInstance);

const markerTextNodes = markerExample.findAll(n => n.type === 'TEXT');
const tableSectionNodes = section.findAll(n => n.type === 'TEXT');
const allPreloadTexts = [...markerTextNodes, ...tableSectionNodes];
const fontSet = new Set();
const fontsToLoad = [];
for (const tn of allPreloadTexts) {
  try {
    const fn = tn.fontName;
    if (fn && fn !== figma.mixed && fn.family) {
      const key = fn.family + '|' + fn.style;
      if (!fontSet.has(key)) { fontSet.add(key); fontsToLoad.push(fn); }
    }
  } catch {}
}
await Promise.all(fontsToLoad.map(f => figma.loadFontAsync(f).catch(() => {})));

let instAbsX = compInstance.absoluteTransform[0][2];
let instAbsY = compInstance.absoluteTransform[1][2];
let childContainer = compInstance;
while (childContainer.children.length === 1 && childContainer.children[0].type === 'FRAME' && childContainer.children[0].layoutMode !== 'NONE') {
  childContainer = childContainer.children[0];
}
if (childContainer.children.length === 1 && childContainer.children[0].type === 'SLOT') {
  childContainer = childContainer.children[0];
}

if (childContainer === compInstance && childContainer.children.length > 1) {
  const LEAF_STRUCTURAL = ['RECTANGLE', 'VECTOR', 'ELLIPSE', 'LINE', 'POLYGON', 'STAR', 'BOOLEAN_OPERATION'];
  const autoLayoutFrames = childContainer.children.filter(c => c.type === 'FRAME' && c.layoutMode !== 'NONE' && ('children' in c) && c.children.length >= 2);
  const structuralOnly = childContainer.children.filter(c => LEAF_STRUCTURAL.includes(c.type));
  if (autoLayoutFrames.length === 1 && structuralOnly.length === childContainer.children.length - 1) {
    childContainer = autoLayoutFrames[0];
  }
}

// --- Populate slot content via appendChild into SLOT node ---
// Must run BEFORE bbox re-computation so auto-layout reflow is captured in positions.
// Ghost overlays (fallback when appendChild fails) are deferred to after reflow so they
// use final compX/compY and recomputed el.bbox.
const pendingGhosts = [];
let slotChildIdx = 0;
for (const el of elements) {
  if (el.isSynthetic) continue;
  if (el.populateSlot && el.populateWith) {
    try {
      const prefNode = await figma.getNodeByIdAsync(el.populateWith.componentId);
      if (prefNode && prefNode.type === 'COMPONENT') {
        let inserted = false;
        const slotNode = childContainer.children[slotChildIdx];
        if (slotNode && slotNode.type === 'SLOT') {
          const inst = prefNode.createInstance();
          await loadAllFonts(inst);
          try { slotNode.appendChild(inst); inserted = true; } catch {}
        }
        if (!inserted) {
          pendingGhosts.push({ el, prefNode });
        }
      }
    } catch {}
  }
  slotChildIdx++;
}

// --- Update dimensions after all mutations (boolean unhide + slot population may reflow auto-layout) ---
rootW = Math.round(compInstance.width);
rootH = Math.round(compInstance.height);
neededW = rootW + 2 * sideRoom;
neededH = rootH + 2 * sideRoom;
ARTWORK_W = Math.max(MIN_W, Math.round(neededW));
ARTWORK_H = Math.max(MIN_H, Math.round(neededH));
wrapper.resize(ARTWORK_W, ARTWORK_H);
compX = Math.round((ARTWORK_W - rootW) / 2);
compY = Math.round((ARTWORK_H - rootH) / 2);
compInstance.x = compX;
compInstance.y = compY;
instAbsX = compInstance.absoluteTransform[0][2];
instAbsY = compInstance.absoluteTransform[1][2];

for (const el of elements) {
  if (el.isSynthetic && el.classification === 'container') {
    el.bbox = { x: 0, y: 0, w: rootW, h: rootH };
  }
  if (el.isSynthetic && el.classification === 'structural' && el.bbox.x === 0 && el.bbox.y === 0) {
    el.bbox.w = rootW;
    el.bbox.h = rootH;
  }
}

// --- Re-compute bboxes from live instance positions (after slot population + auto-layout reflow) ---
let childIdx = 0;
for (let i = 0; i < elements.length; i++) {
  const el = elements[i];
  if (el.isSynthetic) continue;
  const match = childContainer.children[childIdx];
  if (match) {
    const absX = match.absoluteTransform[0][2];
    const absY = match.absoluteTransform[1][2];
    el.bbox = {
      x: Math.round(absX - instAbsX),
      y: Math.round(absY - instAbsY),
      w: Math.round(match.width),
      h: Math.round(match.height)
    };
  }
  childIdx++;
}

// --- Create ghost overlays for failed slot insertions (using final compX/compY and recomputed bboxes) ---
for (const ghost of pendingGhosts) {
  try {
    const inst = ghost.prefNode.createInstance();
    await loadAllFonts(inst);
    wrapper.appendChild(inst);
    inst.x = Math.round(compX + ghost.el.bbox.x + (ghost.el.bbox.w - inst.width) / 2);
    inst.y = Math.round(compY + ghost.el.bbox.y + (ghost.el.bbox.h - inst.height) / 2);
    inst.opacity = 0.6;
  } catch {}
}

const LINE_WIDTH = 1;

// --- Draw dashed outlines ---
for (const el of elements) {
  const outline = figma.createRectangle();
  wrapper.appendChild(outline);
  outline.name = 'Outline ' + el.index;
  outline.x = Math.round(compX + el.bbox.x);
  outline.y = Math.round(compY + el.bbox.y);
  outline.resize(Math.max(1, el.bbox.w), Math.max(1, el.bbox.h));
  outline.fills = [];
  outline.strokes = [{ type: 'SOLID', color: MARKER_COLOR }];
  outline.strokeWeight = 1;
  outline.dashPattern = [4, 4];
}

// --- Nearest-edge marker placement with collision avoidance ---
function scoreSides(el, rootW, rootH) {
  const pref = { top: 0, bottom: 1, left: 2, right: 3 };
  return [
    { side: 'left', dist: el.bbox.x },
    { side: 'top', dist: el.bbox.y },
    { side: 'right', dist: rootW - (el.bbox.x + el.bbox.w) },
    { side: 'bottom', dist: rootH - (el.bbox.y + el.bbox.h) }
  ].sort((a, b) => a.dist !== b.dist ? a.dist - b.dist : pref[a.side] - pref[b.side]);
}

function markerPos(side, el, compX, compY, rootW, rootH, offset) {
  const cX = compX + el.bbox.x + el.bbox.w / 2;
  const cY = compY + el.bbox.y + el.bbox.h / 2;
  const eL = compX + el.bbox.x;
  const eR = compX + el.bbox.x + el.bbox.w;
  const eT = compY + el.bbox.y;
  const eB = compY + el.bbox.y + el.bbox.h;
  const off = offset || 0;
  if (side === 'left') {
    return { dotX: compX - MARKER_OFFSET - MARKER_SIZE, dotY: cY - MARKER_SIZE / 2 + off, anchorX: eL, anchorY: cY + off, markerEdgeX: compX - MARKER_OFFSET, markerEdgeY: cY + off };
  } else if (side === 'right') {
    return { dotX: compX + rootW + MARKER_OFFSET, dotY: cY - MARKER_SIZE / 2 + off, anchorX: eR, anchorY: cY + off, markerEdgeX: compX + rootW + MARKER_OFFSET, markerEdgeY: cY + off };
  } else if (side === 'top') {
    return { dotX: cX - MARKER_SIZE / 2 + off, dotY: compY - MARKER_OFFSET - MARKER_SIZE, anchorX: cX + off, anchorY: eT, markerEdgeX: cX + off, markerEdgeY: compY - MARKER_OFFSET };
  } else {
    return { dotX: cX - MARKER_SIZE / 2 + off, dotY: eB + MARKER_OFFSET, anchorX: cX + off, anchorY: eB, markerEdgeX: cX + off, markerEdgeY: eB + MARKER_OFFSET };
  }
}

function overlapsPlaced(dotX, dotY, placed) {
  for (const p of placed) {
    if (Math.abs(dotX - p.x) < MARKER_SIZE + COLLISION_GAP && Math.abs(dotY - p.y) < MARKER_SIZE + COLLISION_GAP) return true;
  }
  return false;
}

function inBounds(dotX, dotY, aw, ah) {
  return dotX >= -MARKER_SIZE && dotY >= -MARKER_SIZE && dotX <= aw && dotY <= ah;
}

const placed = [];

function drawLine(wrapper, x1, y1, x2, y2, name) {
  if (Math.abs(x1 - x2) < 1 && Math.abs(y1 - y2) < 1) return;
  const seg = figma.createRectangle();
  wrapper.appendChild(seg);
  seg.name = name;
  seg.fills = [{ type: 'SOLID', color: MARKER_COLOR }];
  if (Math.abs(x1 - x2) < 1) {
    seg.x = Math.round(x1 - LINE_WIDTH / 2);
    seg.y = Math.round(Math.min(y1, y2));
    seg.resize(LINE_WIDTH, Math.max(1, Math.abs(y2 - y1)));
  } else {
    seg.x = Math.round(Math.min(x1, x2));
    seg.y = Math.round(y1 - LINE_WIDTH / 2);
    seg.resize(Math.max(1, Math.abs(x2 - x1)), LINE_WIDTH);
  }
}

for (const el of elements) {
  const elCenterX = compX + el.bbox.x + el.bbox.w / 2;
  const elCenterY = compY + el.bbox.y + el.bbox.h / 2;

  const dot = markerExample.clone();
  wrapper.appendChild(dot);
  dot.name = 'Marker ' + el.index;
  dot.visible = true;
  const numText = dot.findOne(n => n.type === 'TEXT');
  if (numText) numText.characters = String(el.index);

  if (el.inlineMarker) {
    const eL = compX + el.bbox.x;
    const eR = compX + el.bbox.x + el.bbox.w;
    const eT = compY + el.bbox.y;
    const eB = compY + el.bbox.y + el.bbox.h;
    const sides = scoreSides(el, rootW, rootH);
    const best = sides[0].side;
    let dX, dY, stubX1, stubY1, stubX2, stubY2;
    if (best === 'left') {
      dX = eL - MARKER_SIZE - 4; dY = elCenterY - MARKER_SIZE / 2;
      stubX1 = eL - 4; stubY1 = elCenterY; stubX2 = eL + INLINE_STUB; stubY2 = elCenterY;
    } else if (best === 'right') {
      dX = eR + 4; dY = elCenterY - MARKER_SIZE / 2;
      stubX1 = eR + 4; stubY1 = elCenterY; stubX2 = eR - INLINE_STUB; stubY2 = elCenterY;
    } else if (best === 'top') {
      dX = elCenterX - MARKER_SIZE / 2; dY = eT - MARKER_SIZE - 4;
      stubX1 = elCenterX; stubY1 = eT - 4; stubX2 = elCenterX; stubY2 = eT + INLINE_STUB;
    } else {
      dX = elCenterX - MARKER_SIZE / 2; dY = eB + 4;
      stubX1 = elCenterX; stubY1 = eB + 4; stubX2 = elCenterX; stubY2 = eB - INLINE_STUB;
    }
    dot.x = Math.round(dX);
    dot.y = Math.round(dY);
    drawLine(wrapper, stubX1, stubY1, stubX2, stubY2, 'Stub ' + el.index);
    continue;
  }

  const rankedSides = scoreSides(el, rootW, rootH);
  let finalDotX, finalDotY, finalSide, finalOffset = 0;
  let foundSpot = false;

  for (let off = 0; off <= perimeterCount * (MARKER_SIZE + COLLISION_GAP); off += MARKER_SIZE + COLLISION_GAP) {
    for (const { side } of rankedSides) {
      if (off === 0) {
        const pos = markerPos(side, el, compX, compY, rootW, rootH, 0);
        if (inBounds(pos.dotX, pos.dotY, ARTWORK_W, ARTWORK_H) && !overlapsPlaced(pos.dotX, pos.dotY, placed)) {
          finalDotX = pos.dotX; finalDotY = pos.dotY; finalSide = side; finalOffset = 0;
          foundSpot = true; break;
        }
      } else {
        for (const sign of [1, -1]) {
          const perpOff = off * sign;
          const pos = markerPos(side, el, compX, compY, rootW, rootH, perpOff);
          if (!inBounds(pos.dotX, pos.dotY, ARTWORK_W, ARTWORK_H)) continue;
          if (!overlapsPlaced(pos.dotX, pos.dotY, placed)) {
            finalDotX = pos.dotX; finalDotY = pos.dotY; finalSide = side; finalOffset = perpOff;
            foundSpot = true; break;
          }
        }
        if (foundSpot) break;
      }
    }
    if (foundSpot) break;
  }

  if (!foundSpot) {
    const pos = markerPos(rankedSides[0].side, el, compX, compY, rootW, rootH, 0);
    finalDotX = pos.dotX; finalDotY = pos.dotY; finalSide = rankedSides[0].side; finalOffset = 0;
  }

  placed.push({ x: finalDotX, y: finalDotY });
  dot.x = Math.round(finalDotX);
  dot.y = Math.round(finalDotY);

  const pos = markerPos(finalSide, el, compX, compY, rootW, rootH, finalOffset);
  drawLine(wrapper, pos.markerEdgeX, pos.markerEdgeY, pos.anchorX, pos.anchorY, 'Line ' + el.index);
}

markerExample.visible = false;

// --- Fill annotation table ---
const annotationTable = section.findOne(n => n.name === '#annotation-table');
const rows = annotationTable.children.filter(c => c.name === 'row');
const rowTemplate = rows[rows.length - 1];

for (const el of elements) {
  const row = rowTemplate.clone();
  annotationTable.appendChild(row);
  row.name = 'Row ' + el.index;

  const numCell = row.findOne(n => n.name === '#number');
  if (numCell) {
    const t = numCell.findOne(n => n.type === 'TEXT');
    if (t) t.characters = String(el.index);
  }

  const indicator = row.findOne(n => n.name === '#indicator');
  if (indicator) {
    const instIcon = indicator.findOne(n => n.name === '#instance');
    const textIcon = indicator.findOne(n => n.name === '#text');
    const slotIcon = indicator.findOne(n => n.name === '#slot');
    const frameIcon = indicator.findOne(n => n.name === '#frame');
    if (el.nodeType === 'INSTANCE') {
      if (instIcon) instIcon.visible = true;
      if (textIcon) textIcon.visible = false;
      if (slotIcon) slotIcon.visible = false;
      if (frameIcon) frameIcon.visible = false;
    } else if (el.nodeType === 'TEXT') {
      if (instIcon) instIcon.visible = false;
      if (textIcon) textIcon.visible = true;
      if (slotIcon) slotIcon.visible = false;
      if (frameIcon) frameIcon.visible = false;
    } else if (el.nodeType === 'SLOT' || el.classification === 'slot') {
      if (instIcon) instIcon.visible = false;
      if (textIcon) textIcon.visible = false;
      if (slotIcon) slotIcon.visible = true;
      if (frameIcon) frameIcon.visible = false;
    } else if (el.nodeType === 'FRAME' || el.nodeType === 'GROUP') {
      if (instIcon) instIcon.visible = false;
      if (textIcon) textIcon.visible = false;
      if (slotIcon) slotIcon.visible = false;
      if (frameIcon) frameIcon.visible = true;
    } else {
      if (instIcon) instIcon.visible = false;
      if (textIcon) textIcon.visible = false;
      if (slotIcon) slotIcon.visible = false;
      if (frameIcon) frameIcon.visible = false;
    }
  }

  const nameCell = row.findOne(n => n.name === '#element-name');
  if (nameCell) {
    const t = nameCell.findOne(n => n.type === 'TEXT');
    if (t) {
      const hiddenLabel = el.visible ? '' : ' (hidden)';
      const countSuffix = el.count > 1 ? ' (x' + el.count + ')' : '';
      t.characters = el.name + countSuffix + hiddenLabel;
    }
  }

  const notesCell = row.findOne(n => n.name === '#notes');
  if (notesCell) {
    const t = notesCell.findOne(n => n.type === 'TEXT');
    if (t) t.characters = el.notes || el.nodeType;
  }
}

rowTemplate.remove();
return { success: true };
```

### Step 8b: Per-Sub-Component Child Sections

For each direct child that is an `INSTANCE` node (has `mainComponentId` or `mainComponentSetId` in the extraction data), **an instance-wrapper FRAME** (has `wrappedInstance` set during Step 4 reasoning), **or a slot element with a preferred instance** (has `slotPreferredComponentId` set during Step 4 reasoning), create a standalone anatomy section showing that child's internal structure. The script starts with the default variant but **falls back to the richest variant** (most direct children) when the default has 1 or fewer children and the component set has multiple variants. All hidden descendants are made visible.

Skip this step entirely if no child elements have `nodeType === 'INSTANCE'`, no instance-wrapper FRAMEs, and no slot elements with `slotPreferredComponentId` were identified in Step 4. Additionally, **check `shouldCreateSection`** on each eligible child (set during Step 4 reasoning) — skip the `figma_execute` call entirely for any child where `shouldCreateSection === false`. These are utility or trivially simple sub-components (Spacer, Divider, structural-only, etc.) that don't warrant a dedicated section. The `gcElements.length <= 1` guard in the JavaScript remains as a runtime safety net, but the agent should avoid even calling `figma_execute` for ineligible children.

**Deduplicate by component set:** When multiple composition elements reference the same `mainComponentSetId`, create only one child section for that component set. Use the first element's data for section creation. This is particularly common with composable slot components where the slot contains multiple instances of the same sub-component (e.g., 4 buttons in a button group). For slot preferred instances, deduplicate against existing default children — if a slot's `slotPreferredComponentId` matches the `mainComponentId` of an existing direct instance child element that already has a section, skip it.

For **each** eligible child element (`shouldCreateSection === true`), run via `figma_execute` (replace `__FRAME_ID__`, `__CHILD_NAME__`, `__CHILD_COMP_ID__`, `__CHILD_IS_COMP_SET__` with values from the extraction data). For direct INSTANCE children, use `mainComponentSetId` if `childIsComponentSet` is true, otherwise use `mainComponentId`. For **instance-wrapper FRAMEs**, use `wrappedInstance.mainComponentSetId` if `wrappedInstance.childIsComponentSet` is true, otherwise use `wrappedInstance.mainComponentId`. For **slot elements with preferred instances** (`classification === 'slot'` and `slotPreferredComponentId` is set), use `slotPreferredComponentId` as `__CHILD_COMP_ID__` — this is a local component node ID. Use `getNodeByIdAsync(slotPreferredComponentId)` to get the component, then check if its parent is a COMPONENT_SET to determine `__CHILD_IS_COMP_SET__`. Replace `__CHILD_BOOLEAN_PROPS_JSON__` with the child sub-component's boolean properties (extracted from its `componentPropertyDefinitions` during Step 4 reasoning). If the child has no boolean properties, pass `[]`. Fonts are loaded in two phases: (1) template fonts from marker and section text nodes, and (2) instance fonts via `loadAllFonts` after `createInstance` and after `directUnhide` — this catches fonts used by the sub-component instance that differ from the template font. No `__FONT_FAMILY__` replacement needed:

```javascript
const FRAME_ID = '__FRAME_ID__';
const CHILD_NAME = '__CHILD_NAME__';
const CHILD_COMP_ID = '__CHILD_COMP_ID__';
const CHILD_IS_COMP_SET = __CHILD_IS_COMP_SET__;
const MARKER_COLOR = { r: 0.922, g: 0, b: 0.431 };
const CHILD_BOOLEAN_PROPS = __CHILD_BOOLEAN_PROPS_JSON__;

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

const frame = await figma.getNodeByIdAsync(FRAME_ID);
const anatomySectionTemplate = frame.findOne(n => n.name === '#anatomy-section');
const markerExample = frame.findOne(n => n.name === '#marker-example');

const childSection = anatomySectionTemplate.clone();
anatomySectionTemplate.parent.appendChild(childSection);
childSection.name = CHILD_NAME + ' anatomy';
childSection.visible = true;

const markerTextNodes = markerExample.findAll(n => n.type === 'TEXT');
const sectionTextNodes = childSection.findAll(n => n.type === 'TEXT');
const allTexts = [...markerTextNodes, ...sectionTextNodes];
const fontSet = new Set();
const fontsToLoad = [];
for (const tn of allTexts) {
  try {
    const fn = tn.fontName;
    if (fn && fn !== figma.mixed && fn.family) {
      const key = fn.family + '|' + fn.style;
      if (!fontSet.has(key)) { fontSet.add(key); fontsToLoad.push(fn); }
    }
  } catch {}
}
await Promise.all(fontsToLoad.map(f => figma.loadFontAsync(f).catch(() => {})));

const sectionFrame = childSection.findOne(n => n.name === '#section-name');
if (sectionFrame) {
  const t = sectionFrame.findOne(n => n.type === 'TEXT');
  if (t) t.characters = CHILD_NAME + ' anatomy';
}

const sectionDescFrame = childSection.findOne(n => n.name === '#optional-section-description');
if (sectionDescFrame) {
  const t = sectionDescFrame.findOne(n => n.type === 'TEXT');
  if (t) t.characters = 'Internal elements of the ' + CHILD_NAME + ' sub-component.';
}

const childCompNode = await figma.getNodeByIdAsync(CHILD_COMP_ID);

function directUnhide(node) {
  if (!node.visible) node.visible = true;
  if ('children' in node) { for (const c of node.children) directUnhide(c); }
}

let singleVariant = CHILD_IS_COMP_SET
  ? (childCompNode.defaultVariant || childCompNode.children[0])
  : childCompNode;

if (CHILD_IS_COMP_SET && childCompNode.children.length > 1) {
  const defChildren = singleVariant.children ? singleVariant.children.length : 0;
  if (defChildren <= 1) {
    let bestVariant = singleVariant;
    let bestCount = defChildren;
    for (const v of childCompNode.children) {
      const cnt = v.children ? v.children.length : 0;
      if (cnt > bestCount) { bestCount = cnt; bestVariant = v; }
    }
    if (bestCount > defChildren) singleVariant = bestVariant;
  }
}

const compInstance = singleVariant.createInstance();
await loadAllFonts(compInstance);

if (CHILD_BOOLEAN_PROPS.length > 0) {
  const boolProps = {};
  for (const bp of CHILD_BOOLEAN_PROPS) {
    boolProps[bp.rawKey] = true;
  }
  try { compInstance.setProperties(boolProps); } catch {}
  await loadAllFonts(compInstance);
}
directUnhide(compInstance);
await loadAllFonts(compInstance);

let grandchildContainer = compInstance;
while (grandchildContainer.children.length === 1 && grandchildContainer.children[0].type === 'FRAME' && grandchildContainer.children[0].layoutMode !== 'NONE') {
  grandchildContainer = grandchildContainer.children[0];
}
if (grandchildContainer.children.length === 1 && grandchildContainer.children[0].type === 'SLOT') {
  grandchildContainer = grandchildContainer.children[0];
}

if (grandchildContainer === compInstance && grandchildContainer.children.length > 1) {
  const LEAF_STRUCTURAL = ['RECTANGLE', 'VECTOR', 'ELLIPSE', 'LINE', 'POLYGON', 'STAR', 'BOOLEAN_OPERATION'];
  const autoLayoutFrames = grandchildContainer.children.filter(c => c.type === 'FRAME' && c.layoutMode !== 'NONE' && ('children' in c) && c.children.length >= 2);
  const structuralOnly = grandchildContainer.children.filter(c => LEAF_STRUCTURAL.includes(c.type));
  if (autoLayoutFrames.length === 1 && structuralOnly.length === grandchildContainer.children.length - 1) {
    grandchildContainer = autoLayoutFrames[0];
  }
}

const LEAF_TYPES = ['TEXT', 'INSTANCE', 'VECTOR', 'RECTANGLE', 'ELLIPSE', 'LINE', 'POLYGON', 'STAR', 'BOOLEAN_OPERATION'];

function resolveLeafElements(node, depth, maxDepth, parentVisible) {
  const vis = parentVisible && node.visible;
  if (LEAF_TYPES.includes(node.type)) {
    return [{ node, name: node.name, visible: vis }];
  }
  if (('children' in node) && node.children.length > 0 && depth < maxDepth) {
    const leaves = [];
    for (const child of node.children) {
      const resolved = resolveLeafElements(child, depth + 1, maxDepth, vis);
      if (resolved.length === 1 && node.children.length === 1) {
        resolved[0].name = node.name;
      }
      leaves.push(...resolved);
    }
    return leaves;
  }
  return [{ node, name: node.name, visible: vis }];
}

const rawLeaves = [];
for (const gc of grandchildContainer.children) {
  rawLeaves.push(...resolveLeafElements(gc, 0, 4, true));
}

const gcElements = [];
let gcIdx = 1;
for (const leaf of rawLeaves) {
  const gc = leaf.node;
  const gcEl = {
    index: gcIdx++,
    name: leaf.name,
    nodeType: gc.type,
    visible: leaf.visible,
    nodeRef: gc,
    bbox: { x: 0, y: 0, w: Math.round(gc.width), h: Math.round(gc.height) },
    notes: ''
  };
  if (gc.type === 'INSTANCE') {
    try {
      const mc = await gc.getMainComponentAsync();
      if (mc) {
        const compSetName = (mc.parent && mc.parent.type === 'COMPONENT_SET') ? mc.parent.name : mc.name;
        gcEl.notes = compSetName + ' instance';
        gcEl.resolvedCompKey = (mc.parent && mc.parent.type === 'COMPONENT_SET') ? mc.parent.id : mc.id;
      }
    } catch { gcEl.notes = 'Instance'; }
  } else if (gc.type === 'TEXT') {
    const content = gc.characters || '';
    if (content.length > 0 && content.length <= 30) {
      gcEl.notes = 'Text element — "' + content + '"';
    } else {
      gcEl.notes = 'Text element';
    }
  } else if (gc.type === 'FRAME' || gc.type === 'GROUP') {
    const childCount = ('children' in gc) ? gc.children.length : 0;
    gcEl.notes = childCount > 0 ? 'Contains ' + childCount + ' elements' : 'Empty container';
  } else if (['VECTOR', 'RECTANGLE', 'ELLIPSE', 'LINE', 'POLYGON', 'STAR', 'BOOLEAN_OPERATION'].includes(gc.type)) {
    gcEl.notes = 'Illustration';
  }
  gcElements.push(gcEl);
}

// --- Collapse repeated identical siblings ---
const grouped = [];
for (const el of gcElements) {
  const groupKey = el.resolvedCompKey || el.name;
  const prev = grouped[grouped.length - 1];
  const prevKey = prev ? (prev.resolvedCompKey || prev.name) : null;
  if (prev && prev.name === el.name && prev.nodeType === el.nodeType && prevKey === groupKey) {
    prev.count = (prev.count || 1) + 1;
  } else {
    el.count = 1;
    grouped.push(el);
  }
}
let reIdx = 1;
for (const el of grouped) { el.index = reIdx++; }
const gcElementsGrouped = grouped;

if (gcElementsGrouped.length <= 1) {
  childSection.remove();
  compInstance.remove();
  return { success: true, skipped: true, childName: CHILD_NAME, elementCount: gcElementsGrouped.length, rawLeafCount: gcElements.length, reason: 'Sub-component has 1 or fewer unique element groups — section not needed' };
}

// --- Build artwork in #preview ---
const preview = childSection.findOne(n => n.name === '#preview');

const MARKER_SIZE = 33;
const MARKER_OFFSET = 40;
const PADDING = 80;
const MIN_W = 1400;
const MIN_H = 290;
const COLLISION_GAP = 8;
const INLINE_STUB = 16;

const rootW = Math.round(compInstance.width);
const rootH = Math.round(compInstance.height);

const perimeterCount = gcElementsGrouped.filter(el => !el.inlineMarker).length;
const markerPadding = Math.ceil(perimeterCount / 4) * (MARKER_SIZE + COLLISION_GAP);
const sideRoom = MARKER_SIZE + MARKER_OFFSET + PADDING + markerPadding;
const neededW = rootW + 2 * sideRoom;
const neededH = rootH + 2 * sideRoom;
const ARTWORK_W = Math.max(MIN_W, Math.round(neededW));
const ARTWORK_H = Math.max(MIN_H, Math.round(neededH));

const wrapper = figma.createFrame();
wrapper.name = 'Artwork wrapper';
wrapper.layoutMode = 'NONE';
wrapper.resize(ARTWORK_W, ARTWORK_H);
wrapper.clipsContent = true;
wrapper.fills = [];
preview.appendChild(wrapper);

const compX = Math.round((ARTWORK_W - rootW) / 2);
const compY = Math.round((ARTWORK_H - rootH) / 2);

wrapper.appendChild(compInstance);
compInstance.x = compX;
compInstance.y = compY;

const instAbsX = compInstance.absoluteTransform[0][2];
const instAbsY = compInstance.absoluteTransform[1][2];
for (const el of gcElementsGrouped) {
  const n = el.nodeRef;
  if (n && n.absoluteTransform) {
    const absX = n.absoluteTransform[0][2];
    const absY = n.absoluteTransform[1][2];
    el.bbox = {
      x: Math.round(absX - instAbsX),
      y: Math.round(absY - instAbsY),
      w: Math.round(n.width),
      h: Math.round(n.height)
    };
  }
}

const LINE_WIDTH = 1;

// --- Nearest-edge marker placement with collision avoidance ---
function scoreSides(el, rW, rH) {
  const pref = { top: 0, bottom: 1, left: 2, right: 3 };
  return [
    { side: 'left', dist: el.bbox.x },
    { side: 'top', dist: el.bbox.y },
    { side: 'right', dist: rW - (el.bbox.x + el.bbox.w) },
    { side: 'bottom', dist: rH - (el.bbox.y + el.bbox.h) }
  ].sort((a, b) => a.dist !== b.dist ? a.dist - b.dist : pref[a.side] - pref[b.side]);
}

function markerPos(side, el, cX, cY, rW, rH, offset) {
  const eCX = cX + el.bbox.x + el.bbox.w / 2;
  const eCY = cY + el.bbox.y + el.bbox.h / 2;
  const eL = cX + el.bbox.x;
  const eR = cX + el.bbox.x + el.bbox.w;
  const eT = cY + el.bbox.y;
  const eB = cY + el.bbox.y + el.bbox.h;
  const off = offset || 0;
  if (side === 'left') {
    return { dotX: cX - MARKER_OFFSET - MARKER_SIZE, dotY: eCY - MARKER_SIZE / 2 + off, anchorX: eL, anchorY: eCY + off, markerEdgeX: cX - MARKER_OFFSET, markerEdgeY: eCY + off };
  } else if (side === 'right') {
    return { dotX: cX + rW + MARKER_OFFSET, dotY: eCY - MARKER_SIZE / 2 + off, anchorX: eR, anchorY: eCY + off, markerEdgeX: cX + rW + MARKER_OFFSET, markerEdgeY: eCY + off };
  } else if (side === 'top') {
    return { dotX: eCX - MARKER_SIZE / 2 + off, dotY: cY - MARKER_OFFSET - MARKER_SIZE, anchorX: eCX + off, anchorY: eT, markerEdgeX: eCX + off, markerEdgeY: cY - MARKER_OFFSET };
  } else {
    return { dotX: eCX - MARKER_SIZE / 2 + off, dotY: eB + MARKER_OFFSET, anchorX: eCX + off, anchorY: eB, markerEdgeX: eCX + off, markerEdgeY: eB + MARKER_OFFSET };
  }
}

function overlapsPlaced(dX, dY, placed) {
  for (const p of placed) {
    if (Math.abs(dX - p.x) < MARKER_SIZE + COLLISION_GAP && Math.abs(dY - p.y) < MARKER_SIZE + COLLISION_GAP) return true;
  }
  return false;
}

function inBounds(dX, dY, aw, ah) {
  return dX >= -MARKER_SIZE && dY >= -MARKER_SIZE && dX <= aw && dY <= ah;
}

const placed = [];

function drawLine(wr, x1, y1, x2, y2, nm) {
  if (Math.abs(x1 - x2) < 1 && Math.abs(y1 - y2) < 1) return;
  const seg = figma.createRectangle();
  wr.appendChild(seg);
  seg.name = nm;
  seg.fills = [{ type: 'SOLID', color: MARKER_COLOR }];
  if (Math.abs(x1 - x2) < 1) {
    seg.x = Math.round(x1 - LINE_WIDTH / 2);
    seg.y = Math.round(Math.min(y1, y2));
    seg.resize(LINE_WIDTH, Math.max(1, Math.abs(y2 - y1)));
  } else {
    seg.x = Math.round(Math.min(x1, x2));
    seg.y = Math.round(y1 - LINE_WIDTH / 2);
    seg.resize(Math.max(1, Math.abs(x2 - x1)), LINE_WIDTH);
  }
}

for (const el of gcElementsGrouped) {
  const outline = figma.createRectangle();
  wrapper.appendChild(outline);
  outline.name = 'Outline ' + el.index;
  outline.x = Math.round(compX + el.bbox.x);
  outline.y = Math.round(compY + el.bbox.y);
  outline.resize(Math.max(1, el.bbox.w), Math.max(1, el.bbox.h));
  outline.fills = [];
  outline.strokes = [{ type: 'SOLID', color: MARKER_COLOR }];
  outline.strokeWeight = 1;
  outline.dashPattern = [4, 4];
}

for (const el of gcElementsGrouped) {
  const elCenterX = compX + el.bbox.x + el.bbox.w / 2;
  const elCenterY = compY + el.bbox.y + el.bbox.h / 2;

  const dot = markerExample.clone();
  wrapper.appendChild(dot);
  dot.visible = true;
  dot.name = 'Marker ' + el.index;
  const numText = dot.findOne(n => n.type === 'TEXT');
  if (numText) numText.characters = String(el.index);

  if (el.inlineMarker) {
    const eL = compX + el.bbox.x;
    const eR = compX + el.bbox.x + el.bbox.w;
    const eT = compY + el.bbox.y;
    const eB = compY + el.bbox.y + el.bbox.h;
    const sides = scoreSides(el, rootW, rootH);
    const best = sides[0].side;
    let dX, dY, sX1, sY1, sX2, sY2;
    if (best === 'left') {
      dX = eL - MARKER_SIZE - 4; dY = elCenterY - MARKER_SIZE / 2;
      sX1 = eL - 4; sY1 = elCenterY; sX2 = eL + INLINE_STUB; sY2 = elCenterY;
    } else if (best === 'right') {
      dX = eR + 4; dY = elCenterY - MARKER_SIZE / 2;
      sX1 = eR + 4; sY1 = elCenterY; sX2 = eR - INLINE_STUB; sY2 = elCenterY;
    } else if (best === 'top') {
      dX = elCenterX - MARKER_SIZE / 2; dY = eT - MARKER_SIZE - 4;
      sX1 = elCenterX; sY1 = eT - 4; sX2 = elCenterX; sY2 = eT + INLINE_STUB;
    } else {
      dX = elCenterX - MARKER_SIZE / 2; dY = eB + 4;
      sX1 = elCenterX; sY1 = eB + 4; sX2 = elCenterX; sY2 = eB - INLINE_STUB;
    }
    dot.x = Math.round(dX);
    dot.y = Math.round(dY);
    drawLine(wrapper, sX1, sY1, sX2, sY2, 'Stub ' + el.index);
    continue;
  }

  const rankedSides = scoreSides(el, rootW, rootH);
  let finalDotX, finalDotY, finalSide, finalOffset = 0;
  let foundSpot = false;

  for (let off = 0; off <= perimeterCount * (MARKER_SIZE + COLLISION_GAP); off += MARKER_SIZE + COLLISION_GAP) {
    for (const { side } of rankedSides) {
      if (off === 0) {
        const pos = markerPos(side, el, compX, compY, rootW, rootH, 0);
        if (inBounds(pos.dotX, pos.dotY, ARTWORK_W, ARTWORK_H) && !overlapsPlaced(pos.dotX, pos.dotY, placed)) {
          finalDotX = pos.dotX; finalDotY = pos.dotY; finalSide = side; finalOffset = 0;
          foundSpot = true; break;
        }
      } else {
        for (const sign of [1, -1]) {
          const perpOff = off * sign;
          const pos = markerPos(side, el, compX, compY, rootW, rootH, perpOff);
          if (!inBounds(pos.dotX, pos.dotY, ARTWORK_W, ARTWORK_H)) continue;
          if (!overlapsPlaced(pos.dotX, pos.dotY, placed)) {
            finalDotX = pos.dotX; finalDotY = pos.dotY; finalSide = side; finalOffset = perpOff;
            foundSpot = true; break;
          }
        }
        if (foundSpot) break;
      }
    }
    if (foundSpot) break;
  }

  if (!foundSpot) {
    const pos = markerPos(rankedSides[0].side, el, compX, compY, rootW, rootH, 0);
    finalDotX = pos.dotX; finalDotY = pos.dotY; finalSide = rankedSides[0].side; finalOffset = 0;
  }

  placed.push({ x: finalDotX, y: finalDotY });
  dot.x = Math.round(finalDotX);
  dot.y = Math.round(finalDotY);

      const pos = markerPos(finalSide, el, compX, compY, rootW, rootH, finalOffset);
      drawLine(wrapper, pos.markerEdgeX, pos.markerEdgeY, pos.anchorX, pos.anchorY, 'Line ' + el.index);
}

// --- Fill annotation table ---
const annotationTable = childSection.findOne(n => n.name === '#annotation-table');
const rows = annotationTable.children.filter(c => c.name === 'row');
const rowTemplate = rows[rows.length - 1];

for (const el of gcElementsGrouped) {
  const row = rowTemplate.clone();
  annotationTable.appendChild(row);
  row.name = 'Row ' + el.index;

  const numCell = row.findOne(n => n.name === '#number');
  if (numCell) {
    const t = numCell.findOne(n => n.type === 'TEXT');
    if (t) t.characters = String(el.index);
  }

  const indicator = row.findOne(n => n.name === '#indicator');
  if (indicator) {
    const instIcon = indicator.findOne(n => n.name === '#instance');
    const textIcon = indicator.findOne(n => n.name === '#text');
    const slotIcon = indicator.findOne(n => n.name === '#slot');
    const frameIcon = indicator.findOne(n => n.name === '#frame');
    if (el.nodeType === 'INSTANCE') {
      if (instIcon) instIcon.visible = true;
      if (textIcon) textIcon.visible = false;
      if (slotIcon) slotIcon.visible = false;
      if (frameIcon) frameIcon.visible = false;
    } else if (el.nodeType === 'TEXT') {
      if (instIcon) instIcon.visible = false;
      if (textIcon) textIcon.visible = true;
      if (slotIcon) slotIcon.visible = false;
      if (frameIcon) frameIcon.visible = false;
    } else if (el.nodeType === 'SLOT') {
      if (instIcon) instIcon.visible = false;
      if (textIcon) textIcon.visible = false;
      if (slotIcon) slotIcon.visible = true;
      if (frameIcon) frameIcon.visible = false;
    } else if (el.nodeType === 'FRAME' || el.nodeType === 'GROUP') {
      if (instIcon) instIcon.visible = false;
      if (textIcon) textIcon.visible = false;
      if (slotIcon) slotIcon.visible = false;
      if (frameIcon) frameIcon.visible = true;
    } else {
      if (instIcon) instIcon.visible = false;
      if (textIcon) textIcon.visible = false;
      if (slotIcon) slotIcon.visible = false;
      if (frameIcon) frameIcon.visible = false;
    }
  }

  const nameCell = row.findOne(n => n.name === '#element-name');
  if (nameCell) {
    const t = nameCell.findOne(n => n.type === 'TEXT');
    if (t) {
      const hiddenLabel = el.visible ? '' : ' (hidden)';
      const countSuffix = el.count > 1 ? ' (x' + el.count + ')' : '';
      t.characters = el.name + countSuffix + hiddenLabel;
    }
  }

  const notesCell = row.findOne(n => n.name === '#notes');
  if (notesCell) {
    const t = notesCell.findOne(n => n.type === 'TEXT');
    if (t) t.characters = el.notes || el.nodeType;
  }
}

rowTemplate.remove();
return { success: true, childSectionId: childSection.id, childName: CHILD_NAME, elementCount: gcElementsGrouped.length, groupedElements: gcElementsGrouped.map(el => ({ index: el.index, name: el.name, nodeType: el.nodeType, visible: el.visible, notes: el.notes, count: el.count })) };
```

Save each returned `childSectionId` and `groupedElements` array (which includes `count` for grouped siblings).

**Enrich per-child notes (AI reasoning):** The script above produces generic notes for `groupedElements` (e.g., `"Label instance"`, `"Contains 3 elements"`). After each `figma_execute` returns, apply the same reasoning process as Step 4 — read the note-writing guidelines from `anatomy/agent-anatomy-instruction.md` and rewrite each element's `notes` with semantic descriptions. Then run a lightweight `figma_execute` to update the table text:

```javascript
const CHILD_SECTION_ID = '__CHILD_SECTION_ID__';
const ENRICHED_ELEMENTS = __ENRICHED_ELEMENTS_JSON__;

const section = await figma.getNodeByIdAsync(CHILD_SECTION_ID);
const annotationTable = section.findOne(n => n.name === '#annotation-table');
const rows = annotationTable.children.filter(c => c.name.startsWith('Row '));

const textNodes = annotationTable.findAll(n => n.type === 'TEXT');
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

for (const el of ENRICHED_ELEMENTS) {
  const row = rows.find(r => r.name === 'Row ' + el.index);
  if (!row) continue;
  const notesCell = row.findOne(n => n.name === '#notes');
  if (notesCell) {
    const t = notesCell.findOne(n => n.type === 'TEXT');
    if (t) t.characters = el.notes;
  }
}

return { success: true };
```

Replace `__CHILD_SECTION_ID__` with the returned `childSectionId` and `__ENRICHED_ELEMENTS_JSON__` with the enriched elements array (only `index` and `notes` fields are needed).

Repeat for every eligible child element (`shouldCreateSection === true`) from the Step 3/4 data — this includes direct INSTANCE children, instance-wrapper FRAMEs with `wrappedInstance`, and slot elements with `slotPreferredComponentId`. Skip any child where `shouldCreateSection === false` — do not call `figma_execute` for it.

After all per-child sections are processed, update the composition table's `#notes` cells: for each child (INSTANCE or instance-wrapper FRAME) that was **not** skipped (i.e., a section was created and `shouldCreateSection === true`), append ` — See <child name> anatomy section` to the existing notes text in the corresponding row. Do not add cross-references for skipped or ineligible children.

### Step 10: Visual Validation

1. `figma_take_screenshot` with the `frameId` — Capture the completed annotation
2. Verify:
   - All sections (composition and per-child) have pink dashed outlines around each annotated element, correct markers, and 4-column table with type icons
   - Each sub-component with `shouldCreateSection: true` has its own section with artwork showing all elements visible
   - No sections were created for ineligible children (`shouldCreateSection: false`)
   - Type indicators correctly show diamond for INSTANCE, T for TEXT, slot icon for SLOT, all three hidden for FRAME/container/structural
   - Hidden elements labeled "(hidden)" in element name column
   - Grouped elements show `(xN)` suffix in element name column
   - Notes column has brief functional descriptions; grouped elements mention their count
   - All markers fit within preview area
   - Per-child section titles use designer-facing names
3. If issues are found, fix via `figma_execute` and re-capture (up to 3 iterations)

### Step 11: Completion Link

Print a clickable Figma URL to the completed spec in chat. Construct the URL from the `fileKey` (extracted from the user's input URL) and the `frameId` (returned by Step 6), replacing `:` with `-` in the node ID:

```
Anatomy spec complete: https://www.figma.com/design/{fileKey}/?node-id={frameId}
```

