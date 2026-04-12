---
name: create-property
description: Generate a visual property annotation in Figma showing each configurable property axis with component instance previews. Use when the user mentions "property", "properties", "property annotation", "create property", or wants to document a component's configurable properties visually.
---

# Create Property Annotation

Generate a visual property annotation directly in Figma — one exhibit per variant axis and boolean toggle, each showing the available options as component instances with a summary table.

## MCP Adapter

Read `uspecs.config.json` → `mcpProvider`. Follow the matching column for every MCP call in this skill.

| Operation | `figma-console` | `figma-mcp` |
|-----------|-----------------|-------------|
| Verify connection | `figma_get_status` | Skip — implicit. If first `use_figma` call fails, guide user to check MCP setup. |
| Navigate to file | `figma_navigate` with URL | Extract `fileKey` from URL (`figma.com/design/:fileKey/...`). No navigate needed. |
| Take screenshot | `figma_take_screenshot` | `get_screenshot` with `fileKey` + `nodeId` |
| Execute Plugin JS | `figma_execute` with `code` | `use_figma` with `fileKey`, `code`, `description`. **Core logic is identical** — see font loading note below for the one API difference (`getRangeAllFontNames` → `tn.fontName`). |
| Search components | `figma_search_components` | `search_design_system` with `query` + `fileKey` + `includeComponents: true` |
| Get file/component data | `figma_get_file_data` / `figma_get_component` | `get_metadata` or `get_design_context` with `fileKey` + `nodeId` |
| Get variables (file-wide) | `figma_get_variables` | `use_figma` script: `return await figma.variables.getLocalVariableCollectionsAsync();` |
| Get token values | `figma_get_token_values` | `use_figma` script reading variable values per mode/collection |
| Get styles | `figma_get_styles` | `search_design_system` with `includeStyles: true`, or `use_figma`: `return figma.getLocalPaintStyles();` |
| Get selection | `figma_get_selection` | `use_figma` script: `return figma.currentPage.selection.map(n => ({id: n.id, name: n.name, type: n.type}));` |

**`figma-mcp` requires `fileKey` on every call.** Extract it once from the user's Figma URL at the start of the workflow. For branch URLs (`figma.com/design/:fileKey/branch/:branchKey/:fileName`), use `:branchKey` as the fileKey.

**`figma-mcp` page context:** `use_figma` resets `figma.currentPage` to the first page on every call. When a script accesses a node from a previous step via `getNodeByIdAsync(ID)`, the page content may not be loaded — `findAll`, `findOne`, and `characters` will fail with `TypeError` until the page is activated. Insert this page-loading block at the **start** of every script that references a previously-created node:

```javascript
const pages = figma.root.children;
const targetPage = pages.find(p => p.name === '__PAGE_NAME__');
if (targetPage) await figma.setCurrentPageAsync(targetPage);
```

Replace `__PAGE_NAME__` with the actual page name (determined during Step 7 when the template is placed). This loads the page content so child nodes are accessible.

**`figma-mcp` font loading:** `getRangeAllFontNames` is not available in the `use_figma` sandbox and will throw `TypeError`. Replace it with `tn.fontName` (returns `{ family, style }` for single-font text, or `figma.mixed` for mixed-font text). `findAll` and `findOne` work normally after `setCurrentPageAsync` — they do not need replacement.

Replace the font-collection loop in every script from:
```javascript
const fonts = tn.getRangeAllFontNames(0, tn.characters.length);
for (const f of fonts) {
  const key = f.family + '|' + f.style;
  if (!fontSet.has(key)) { fontSet.add(key); fontsToLoad.push(f); }
}
```
to:
```javascript
try {
  const fn = tn.fontName;
  if (fn && fn !== figma.mixed && fn.family) {
    const key = fn.family + '|' + fn.style;
    if (!fontSet.has(key)) { fontSet.add(key); fontsToLoad.push(fn); }
  }
} catch {}
```

And add `.catch(() => {})` to the batch load: `await Promise.all(fontsToLoad.map(f => figma.loadFontAsync(f).catch(() => {})));`

## Inputs Expected

- **Figma link to the component**: URL to a component set or standalone component in Figma (required)
- **Figma link to the destination** (optional): URL to the page/frame where the annotation should be placed. If omitted, places it in the same file as the component.

## Workflow

Copy this checklist and update as you progress:

```
Task Progress:
- [ ] Step 1: Read instruction file
- [ ] Step 2: Verify MCP connection
- [ ] Step 3: Read template key from uspecs.config.json
- [ ] Step 4: Navigate to the component and extract property data
- [ ] Step 4a: Detect variant-gated booleans (deterministic + interpretation)
- [ ] Step 4b: Detect variable mode properties (shape, density) — AI search
- [ ] Step 4c: Discover local child component properties + boolean linkage (deterministic)
- [ ] Step 4d: Normalize child properties (deterministic script)
- [ ] Step 4e: AI validation layer + context axis identification — cross-check extraction output before rendering
- [ ] Step 5: Re-read instruction file (Pre-Render Validation Checklist, Common Mistakes, Do NOT) and audit
- [ ] Step 6: Navigate to destination (if different file)
- [ ] Step 7: Import and detach the Property template
- [ ] Step 8: Fill header fields
- [ ] Step 9: Build property exhibits with component instances
- [ ] Step 10: Visual validation
```

### Step 1: Read Instructions

Read [agent-property-instruction.md](../../property/agent-property-instruction.md)

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
- The `propertyOverview` value from the `templateKeys` object → save as `PROPERTY_TEMPLATE_KEY`
- The `fontFamily` value → save as `FONT_FAMILY` (default to `Inter` if not set)

If the template key is empty, tell the user:
> The property template key is not configured. Run `@firstrun` with your Figma template library link first.

### Step 4: Extract Property Data

Navigate to the component file and run the extraction script via `figma_execute`.

**Extract the node ID from the URL:** Figma URLs contain `node-id=123-456` → use `123:456`.

Run this extraction script, replacing `TARGET_NODE_ID` with the actual node ID:

```javascript
const TARGET_NODE_ID = '__NODE_ID__';

const node = await figma.getNodeByIdAsync(TARGET_NODE_ID);
if (!node || (node.type !== 'COMPONENT_SET' && node.type !== 'COMPONENT')) {
  return { error: 'Node is not a component set or component. Type: ' + (node ? node.type : 'null') };
}

const isComponentSet = node.type === 'COMPONENT_SET';
const propDefs = node.componentPropertyDefinitions;
const variantAxes = [];
const booleanProps = [];
const instanceSwapProps = [];
const slotProps = [];

for (const [rawKey, def] of Object.entries(propDefs)) {
  const cleanKey = rawKey.split('#')[0];
  if (def.type === 'VARIANT') {
    variantAxes.push({
      name: cleanKey,
      options: def.variantOptions || [],
      defaultValue: def.defaultValue
    });
  } else if (def.type === 'BOOLEAN') {
    let associatedLayer = null;
    let controlsSlot = false;
    let slotPreferredNames = [];
    const defaultVariant = isComponentSet ? (node.defaultVariant || node.children[0]) : node;
    const props = defaultVariant.componentProperties;
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (k.split('#')[0] === cleanKey && v.type === 'BOOLEAN') {
          const nodeId = k.split('#')[1];
          if (nodeId) {
            try {
              const layerNode = await figma.getNodeByIdAsync(defaultVariant.id.split(';')[0] + ';' + nodeId);
              if (layerNode) {
                associatedLayer = layerNode.name;
                if (layerNode.type === 'SLOT') {
                  controlsSlot = true;
                  const matchedSlotDef = slotProps.find(s => s.name === layerNode.name) ||
                    Object.entries(propDefs).find(([rk, d]) => d.type === 'SLOT' && rk.split('#')[0] === layerNode.name);
                  if (matchedSlotDef) {
                    const sDef = matchedSlotDef.preferredInstances || (matchedSlotDef[1] && matchedSlotDef[1].preferredValues) || [];
                    const pvArr = Array.isArray(sDef) ? sDef : [];
                    for (const pv of pvArr) {
                      if (pv.componentName) slotPreferredNames.push(pv.componentName);
                    }
                  }
                }
              }
            } catch {}
          }
        }
      }
    }
    booleanProps.push({
      name: cleanKey,
      defaultValue: def.defaultValue,
      associatedLayer,
      controlsSlot,
      slotPreferredNames,
      rawKey
    });
  } else if (def.type === 'INSTANCE_SWAP') {
    instanceSwapProps.push({
      name: cleanKey,
      defaultValue: def.defaultValue,
      rawKey
    });
  } else if (def.type === 'SLOT') {
    const preferred = [];
    if (def.preferredValues && def.preferredValues.length > 0) {
      for (const pv of def.preferredValues) {
        if (pv.type === 'COMPONENT') {
          let compName = null;
          try {
            const comp = await figma.getNodeByIdAsync(pv.key);
            if (comp) compName = comp.name;
          } catch {}
          preferred.push({ componentKey: pv.key, componentName: compName || pv.key });
        }
      }
    }
    slotProps.push({
      name: cleanKey,
      description: def.description || '',
      preferredInstances: preferred,
      rawKey
    });
  }
}

const defaultVariant = isComponentSet ? (node.defaultVariant || node.children[0]) : node;
const defaultProps = { ...(defaultVariant.variantProperties || {}) };

return {
  componentName: node.name,
  compSetNodeId: TARGET_NODE_ID,
  isComponentSet,
  variantAxes,
  booleanProps,
  instanceSwapProps,
  slotProps,
  defaultProps,
  defaultVariantName: defaultVariant.name
};
```

Save the returned JSON — you will use it in subsequent steps.

### Step 4a: Detect Variant-Gated Booleans

Some boolean properties only have a visual effect under specific variant axis values. For example, a "Dismiss button" boolean may only control a layer that exists in the `Behavior=Interactive` variant, not in `Behavior=Static`. When the default variant lacks the target layer, toggling the boolean produces identical-looking previews.

After extracting properties in Step 4, run this script to resolve each boolean's target layer across all variant axis values. Replace `TARGET_NODE_ID` with the actual node ID:

```javascript
const TARGET_NODE_ID = '__NODE_ID__';

const node = await figma.getNodeByIdAsync(TARGET_NODE_ID);
if (!node || node.type !== 'COMPONENT_SET') {
  return { skip: true, reason: 'Not a component set — no variant gating possible' };
}

const propDefs = node.componentPropertyDefinitions;
const boolDefs = [];
for (const [rawKey, def] of Object.entries(propDefs)) {
  if (def.type === 'BOOLEAN') {
    boolDefs.push({ name: rawKey.split('#')[0], rawKey, nodeIdSuffix: rawKey.split('#')[1] || null });
  }
}

const variantAxes = [];
for (const [rawKey, def] of Object.entries(propDefs)) {
  if (def.type === 'VARIANT') {
    variantAxes.push({ name: rawKey.split('#')[0], options: def.variantOptions || [] });
  }
}

const defaultVariant = node.defaultVariant || node.children[0];
const defaultVProps = defaultVariant.variantProperties || {};

const boolLayerReport = [];

for (const bd of boolDefs) {
  if (!bd.nodeIdSuffix) {
    boolLayerReport.push({ name: bd.name, resolved: false, reason: 'No nodeId suffix in rawKey' });
    continue;
  }

  const layerInDefault = await (async () => {
    try {
      const lid = defaultVariant.id.split(';')[0] + ';' + bd.nodeIdSuffix;
      const ln = await figma.getNodeByIdAsync(lid);
      return ln ? ln.name : null;
    } catch { return null; }
  })();

  if (layerInDefault) {
    boolLayerReport.push({ name: bd.name, layerFoundInDefault: true, layerName: layerInDefault });
    continue;
  }

  let foundInVariant = null;
  for (const child of node.children) {
    const vp = child.variantProperties || {};
    try {
      const lid = child.id.split(';')[0] + ';' + bd.nodeIdSuffix;
      const ln = await figma.getNodeByIdAsync(lid);
      if (ln) {
        const diffAxis = {};
        for (const [k, v] of Object.entries(vp)) {
          if (defaultVProps[k] !== v) diffAxis[k] = v;
        }
        foundInVariant = { variantProps: vp, diffFromDefault: diffAxis, layerName: ln.name };
        break;
      }
    } catch {}
  }

  boolLayerReport.push({
    name: bd.name,
    layerFoundInDefault: false,
    foundInVariant,
    reason: foundInVariant ? 'Layer only exists under different variant axis values' : 'Layer not found in any variant'
  });
}

// --- Interpret variant-gating deterministically ---
const interpretedBooleans = boolLayerReport.map(entry => {
  const result = { name: entry.name, requiredVariantOverrides: null, layerName: entry.layerName || null };
  if (!entry.layerFoundInDefault && entry.foundInVariant) {
    result.requiredVariantOverrides = entry.foundInVariant.diffFromDefault;
    result.layerName = entry.foundInVariant.layerName;
  }
  return result;
});

return { boolLayerReport, interpretedBooleans, variantAxes };
```

**How the agent should use this data:**

The script now returns an `interpretedBooleans` array alongside the raw `boolLayerReport`. Each entry in `interpretedBooleans` contains:

- `name`: the boolean's clean name
- `requiredVariantOverrides`: an object like `{ "Behavior": "Interactive" }` if the boolean is variant-gated, or `null` if it works on the default variant
- `layerName`: the resolved layer name

For each boolean in `interpretedBooleans`:

- **`requiredVariantOverrides === null`** — No action needed. The boolean works on the default variant. Render normally in 6b.
- **`requiredVariantOverrides` is an object** — The boolean is **variant-gated**. Store the `requiredVariantOverrides` on the boolean entry from Step 4's `booleanProps`. In 6b, use these overrides when looking up the base variant for instance creation. The description should note the dependency (e.g., "Requires Behavior = Interactive").

No AI reasoning is needed — the script has already resolved which booleans are variant-gated and what overrides they require.

### Step 4b: Detect Variable Mode Properties

Some component properties (e.g., shape, density) are controlled via **Figma variable modes** at the container level, not per-instance. These do not appear in `componentPropertyDefinitions` and will be missed by the extraction script above.

Call `figma_get_variables` with `format: "summary"` to get a lightweight overview of all variable collections in the file. Look for collections whose names contain the component name or common mode-property keywords:

- `"[ComponentName] shape"` — e.g., "Button shape" with modes like Rectangular, Rounded
- `"[ComponentName] density"` or `"Density"` — e.g., "Button density" with modes like Default, Compact, Spacious

For each matching collection, extract:
- **Property name**: Derive from the collection name (e.g., "Button shape" → `shape`, "Density" → `density`)
- **Options**: The mode names in the collection (e.g., `["Rectangular", "Rounded"]`)
- **Default value**: The mode named "Default" or "default" if one exists; otherwise the first mode
- **Collection name**: The full collection name for the annotation note
- **Collection ID**: The `id` field of the collection (e.g., `"VariableCollectionId:6028:44006"`) — needed to apply modes via `setExplicitVariableModeForCollection`
- **Modes**: An array of `{ modeId, name }` objects for each mode — needed to apply the correct mode per preview instance

Store these as a `variableModeProps` array alongside `variantAxes` and `booleanProps`:

```
variableModeProps: [
  {
    name: "shape",
    options: ["Rectangular", "Rounded"],
    defaultValue: "Rectangular",
    collectionName: "Button shape",
    collectionId: "VariableCollectionId:1234:5678",
    modes: [{ modeId: "1234:0", name: "Rectangular" }, { modeId: "1234:1", name: "Rounded" }]
  },
  {
    name: "density",
    options: ["Default", "Compact", "Spacious"],
    defaultValue: "Default",
    collectionName: "Button density",
    collectionId: "VariableCollectionId:6028:44006",
    modes: [{ modeId: "6028:0", name: "Default" }, { modeId: "6028:1", name: "Compact" }, { modeId: "6028:2", name: "Spacious" }]
  }
]
```

If no matching collections are found, set `variableModeProps` to an empty array and proceed.

### Step 4c: Discover Local Child Component Properties

Some components contain nested child instances (e.g., a Button inside a Section Heading) that have their own configurable properties. These are not captured by the parent's `componentPropertyDefinitions`. This step walks the default variant's children recursively to find local child components and extract their properties.

Run this script via `figma_execute`, replacing `TARGET_NODE_ID` with the actual node ID. **Pass the parent's `booleanProps` array** (from Step 4) as `PARENT_BOOLEANS` so the script can resolve controlling boolean linkage deterministically:

```javascript
const TARGET_NODE_ID = '__NODE_ID__';
const PARENT_BOOLEANS = __PARENT_BOOLEANS_JSON__;

const node = await figma.getNodeByIdAsync(TARGET_NODE_ID);
if (!node || (node.type !== 'COMPONENT_SET' && node.type !== 'COMPONENT')) {
  return { error: 'Node is not a component set or component.' };
}

const isComponentSet = node.type === 'COMPONENT_SET';
const defaultVariant = isComponentSet ? (node.defaultVariant || node.children[0]) : node;

const childComponents = [];

async function walkForInstances(container) {
  for (const child of container.children) {
    if (child.type === 'INSTANCE') {
      try {
        const mainComp = await child.getMainComponentAsync();
        if (!mainComp) continue;

        const parent = mainComp.parent;
        const isLocalComponentSet = parent && parent.type === 'COMPONENT_SET';

        const sourceNode = isLocalComponentSet ? parent : mainComp;
        const propDefs = sourceNode.componentPropertyDefinitions || {};

        const variantAxes = [];
        const booleanProps = [];
        const instanceSwapProps = [];

        for (const [rawKey, def] of Object.entries(propDefs)) {
          const cleanKey = rawKey.split('#')[0];
          if (def.type === 'VARIANT') {
            variantAxes.push({
              name: cleanKey,
              options: def.variantOptions || [],
              defaultValue: def.defaultValue
            });
          } else if (def.type === 'BOOLEAN') {
            booleanProps.push({
              name: cleanKey,
              defaultValue: def.defaultValue,
              rawKey
            });
          } else if (def.type === 'INSTANCE_SWAP') {
            instanceSwapProps.push({
              name: cleanKey,
              defaultValue: def.defaultValue,
              rawKey
            });
          }
        }

        if (variantAxes.length === 0 && booleanProps.length === 0 && instanceSwapProps.length === 0) continue;

        childComponents.push({
          name: child.name,
          mainComponentName: mainComp.name,
          mainComponentSetId: isLocalComponentSet ? parent.id : null,
          mainComponentId: mainComp.id,
          isComponentSet: isLocalComponentSet,
          variantAxes,
          booleanProps,
          instanceSwapProps,
          visible: child.visible
        });
      } catch {}
    } else if ('children' in child && child.type !== 'INSTANCE') {
      await walkForInstances(child);
    }
  }
}

await walkForInstances(defaultVariant);

// --- Boolean linkage: resolve which parent boolean controls each hidden child ---
const controllingBooleanNames = [];

for (const child of childComponents) {
  child.controllingBooleanName = null;
  child.controllingBooleanRawKey = null;

  if (child.visible) continue;

  // Primary: resolve rawKey#nodeId to layer name match
  for (const pb of PARENT_BOOLEANS) {
    const nodeIdSuffix = pb.rawKey.split('#')[1];
    if (!nodeIdSuffix) continue;
    try {
      const lid = defaultVariant.id.split(';')[0] + ';' + nodeIdSuffix;
      const layerNode = await figma.getNodeByIdAsync(lid);
      if (layerNode && layerNode.name === child.name) {
        child.controllingBooleanName = pb.name;
        child.controllingBooleanRawKey = pb.rawKey;
        break;
      }
    } catch {}
  }

  // Fallback: deterministic normalized name containment
  if (!child.controllingBooleanName) {
    const normChild = child.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const pb of PARENT_BOOLEANS) {
      const normBool = pb.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normChild.includes(normBool) || normBool.includes(normChild)) {
        child.controllingBooleanName = pb.name;
        child.controllingBooleanRawKey = pb.rawKey;
        break;
      }
    }
  }

  if (child.controllingBooleanName) {
    controllingBooleanNames.push(child.controllingBooleanName);
  }
}

return { childComponents, controllingBooleanNames };
```

Replace `__PARENT_BOOLEANS_JSON__` with the `booleanProps` array from Step 4 (e.g., `[{"name":"Trailing content","defaultValue":false,"rawKey":"Trailing content#6051:1","associatedLayer":"trailingContent v2"}]`).

Save the returned `childComponents` array and `controllingBooleanNames` array. Each child entry now contains:
- `name`: the layer name in the parent (e.g., "trailingContent v2")
- `mainComponentName`: the source component name (e.g., "Content=Button (text)")
- `mainComponentSetId` or `mainComponentId`: for creating instances
- `isComponentSet`: whether it is a multi-variant component set
- `variantAxes`, `booleanProps`, `instanceSwapProps`: its own properties
- `visible`: whether it is visible by default in the parent
- `controllingBooleanName`: the clean name of the parent boolean that controls this child's visibility, or `null` if none found
- `controllingBooleanRawKey`: the full raw key for `setProperties()`, or `null`

The `controllingBooleanNames` array contains all matched boolean names — these are skipped in 6b (not rendered as standalone boolean chapters).

If `childComponents` is empty, proceed — there are no local child components to exhibit.

### Step 4d: Normalize Child Properties (Deterministic Script)

This is a deterministic data-processing step — no Figma calls needed. Run the following script via `figma_execute`, passing in the extracted data from Steps 4, 4c. It performs all four sub-analyses (coupled axes, container-gated booleans, unified slots, sibling booleans) and returns the full normalization plan.

Replace `__PARENT_VARIANT_AXES_JSON__` with the `variantAxes` array from Step 4, `__CHILD_COMPONENTS_JSON__` with the `childComponents` array from Step 4c, and `__CONTROLLING_BOOLEAN_NAMES_JSON__` with the `controllingBooleanNames` array from Step 4c:

```javascript
const PARENT_AXES = __PARENT_VARIANT_AXES_JSON__;
const CHILDREN = __CHILD_COMPONENTS_JSON__;
const CONTROLLING_BOOL_NAMES = __CONTROLLING_BOOLEAN_NAMES_JSON__;

// --- 4d-i: Detect coupled axes ---
for (const child of CHILDREN) {
  for (const axis of child.variantAxes) {
    axis.coupled = false;
    for (const pAxis of PARENT_AXES) {
      if (axis.name.toLowerCase() === pAxis.name.toLowerCase()) {
        const childSet = new Set(axis.options.map(o => o.toLowerCase()));
        const parentSet = new Set(pAxis.options.map(o => o.toLowerCase()));
        const isSubset = [...childSet].every(o => parentSet.has(o));
        if (isSubset) { axis.coupled = true; break; }
      }
    }
  }
}

// --- 4d-ii/iii: Container-gated booleans + unified slot chapters ---
const unifiedSlotChapters = [];
const unifiedSubBooleanNames = [];

function shortName(boolName, containerName) {
  const prefixWords = containerName.toLowerCase().split(/\s+/);
  const boolWords = boolName.split(/\s+/);
  let stripped = boolWords.filter(w => !prefixWords.includes(w.toLowerCase()));
  if (stripped.length === 0) stripped = boolWords;
  return stripped.join(' ');
}

function stripVerbs(name) {
  return name.replace(/^(Show|Has|With|Enable|Toggle|Display)\s+/i, '');
}

for (const child of CHILDREN) {
  if (!child.controllingBooleanName || child.booleanProps.length === 0) continue;

  const subBools = child.booleanProps;
  const containerBoolName = child.controllingBooleanName;
  const containerBoolRawKey = child.controllingBooleanRawKey;

  const combos = [];
  combos.push({ label: 'None', containerOn: false, subValues: {} });

  if (subBools.length <= 5) {
    const count = subBools.length;
    const total = 1 << count;
    const comboEntries = [];
    for (let mask = 1; mask < total; mask++) {
      const subValues = {};
      const onNames = [];
      for (let i = 0; i < count; i++) {
        const on = Boolean(mask & (1 << i));
        subValues[subBools[i].name] = on;
        if (on) onNames.push(stripVerbs(shortName(subBools[i].name, containerBoolName)));
      }
      comboEntries.push({ label: onNames.join(' + '), containerOn: true, subValues, onCount: onNames.length });
    }
    comboEntries.sort((a, b) => a.onCount - b.onCount);
    const capped = comboEntries.length > 5 ? [...comboEntries.slice(0, 4), comboEntries[comboEntries.length - 1]] : comboEntries;
    for (const c of capped) { delete c.onCount; combos.push(c); }
  } else {
    for (const sb of subBools) {
      const subValues = {};
      for (const s of subBools) subValues[s.name] = (s.name === sb.name);
      combos.push({ label: stripVerbs(shortName(sb.name, containerBoolName)), containerOn: true, subValues });
    }
    const allOn = {};
    for (const s of subBools) allOn[s.name] = true;
    combos.push({ label: subBools.map(s => stripVerbs(shortName(s.name, containerBoolName))).join(' + '), containerOn: true, subValues: allOn });
  }

  if (subBools.length === 1) {
    combos[1].label = stripVerbs(shortName(subBools[0].name, containerBoolName));
  }

  const parentBoolDef = CONTROLLING_BOOL_NAMES.includes(containerBoolName);
  let defaultLabel = 'None';
  if (parentBoolDef) {
    const defaultSubValues = {};
    for (const sb of subBools) defaultSubValues[sb.name] = sb.defaultValue;
    const match = combos.find(c => c.containerOn && Object.entries(c.subValues).every(([k, v]) => defaultSubValues[k] === v));
    if (match) defaultLabel = match.label;
  }

  unifiedSlotChapters.push({
    chapterName: child.name + ' -- ' + containerBoolName,
    childName: child.name,
    containerBoolName,
    containerBoolRawKey,
    subBooleans: subBools,
    previewCombinations: combos,
    defaultLabel
  });

  for (const sb of subBools) unifiedSubBooleanNames.push(sb.name);
}

// --- 4d-iv: Sibling boolean collapsing ---
const siblingBoolChapters = [];
const siblingBoolNames = [];
const consumedByUnified = new Set(unifiedSubBooleanNames);

for (const child of CHILDREN) {
  if (child.controllingBooleanName && child.booleanProps.length > 0) continue;

  const remaining = child.booleanProps.filter(b => !consumedByUnified.has(b.name));
  if (remaining.length < 2) continue;

  const combos = [];
  const count = remaining.length;
  const total = 1 << count;
  const comboEntries = [];
  for (let mask = 0; mask < total; mask++) {
    const subValues = {};
    const onNames = [];
    for (let i = 0; i < count; i++) {
      const on = Boolean(mask & (1 << i));
      subValues[remaining[i].name] = on;
      if (on) onNames.push(stripVerbs(remaining[i].name));
    }
    const label = onNames.length === 0 ? 'None' : onNames.join(' + ');
    comboEntries.push({ label, subValues, onCount: onNames.length });
  }
  comboEntries.sort((a, b) => a.onCount - b.onCount);
  const capped = comboEntries.length > 6 ? [...comboEntries.slice(0, 4), comboEntries[comboEntries.length - 2], comboEntries[comboEntries.length - 1]] : comboEntries;
  for (const c of capped) { delete c.onCount; combos.push(c); }

  const defaultSubValues = {};
  for (const b of remaining) defaultSubValues[b.name] = b.defaultValue;
  const defaultMatch = combos.find(c => Object.entries(c.subValues).every(([k, v]) => defaultSubValues[k] === v));
  const defaultLabel = defaultMatch ? defaultMatch.label : 'None';

  siblingBoolChapters.push({
    chapterName: child.name,
    childName: child.name,
    booleans: remaining,
    previewCombinations: combos,
    defaultLabel
  });

  for (const b of remaining) siblingBoolNames.push(b.name);
}

return {
  childComponents: CHILDREN,
  unifiedSlotChapters,
  unifiedSubBooleanNames,
  siblingBoolChapters,
  siblingBoolNames
};
```

Save the returned data. The script produces:

- **`childComponents`** — Updated with `coupled: true` flags on child variant axes that mirror parent axes (4d-i). In Step 9 (6e-i), skip axes where `coupled === true`.
- **`unifiedSlotChapters`** — Array of chapter entries for container + sub-boolean combinations (4d-ii/iii). Each entry has `chapterName`, `childName`, `containerBoolName`, `containerBoolRawKey`, `subBooleans`, `previewCombinations`, and `defaultLabel`. Rendered in 6f.
- **`unifiedSubBooleanNames`** — Array of sub-boolean names consumed by unified slot chapters. These are skipped in 6e-ii.
- **`siblingBoolChapters`** — Array of chapter entries for sibling boolean combinations (4d-iv). Each entry has `chapterName`, `childName`, `booleans`, `previewCombinations`, and `defaultLabel`. Rendered in 6g.
- **`siblingBoolNames`** — Array of boolean names consumed by sibling boolean chapters. These are skipped in 6e-ii.

**Label generation rules** (handled by the script):
- Sub-boolean short names are derived by stripping the common prefix shared with the container name, plus common verbs ("Show", "Has", "With", "Enable", "Toggle", "Display")
- `"None"` = container off (unified) or all booleans off (sibling)
- Multi-on combos are joined with " + "
- Default label is computed from actual boolean default values

**Combination cap** (handled by the script): Power sets with more than 5-6 entries are capped to the most meaningful combinations (individually-on states, plus the all-on state).

**Graceful fallback**: If a child has only 1 remaining boolean after filtering (not consumed by unified slots), it is NOT added to `siblingBoolChapters` — it stays as a standard boolean chapter rendered in 6e-ii.

### Step 4e: AI Validation and Exhibit Planning

After all deterministic extraction is complete (Steps 4–4d), perform AI validation and exhibit planning. Follow the **Data Validation** and **Exhibit Planning** sections in the instruction file ([agent-property-instruction.md](../../property/agent-property-instruction.md)).

This step has two phases: **Phase A** (Data Validation) corrects the extraction data, **Phase B** (Exhibit Planning) plans what to render and how. Do NOT rely on visual inspection (Step 10) as the primary safety net — this step is the designated reasoning layer.

**Context axis identification** — As the first action in Phase B, follow the "Identify context axes" section in the instruction file. Evaluate each variant axis against the heuristics and select 0–1 context axes (rarely 2). Store the result as `contextAxis`:

```
contextAxis: { name: "variant", options: ["primary", "subtle"], defaultValue: "primary" }
// or null if no axis qualifies
```

When `contextAxis` is non-null:
- The context axis's own exhibit plan entry is `presentation: "illustrate"` with `template: "6a"` (standard, non-contextual). This gives engineers a dedicated reference for the axis options.
- All other `"illustrate"` entries use contextual templates (6a-ctx instead of 6a, 6b-ctx instead of 6b).
- Composite chapters use the context rowGroup pattern (see 6a-ctx).
- The `briefDescription` should mention the context axis (e.g., "…available in primary and subtle variants").

Produce the `exhibitPlan` array and `contextAxis` as documented in the instruction file. Also compose the `briefDescription` string for the spec header.

After validation and planning, proceed to the pre-render audit.

### Step 5: Audit

Re-read the instruction file ([agent-property-instruction.md](../../property/agent-property-instruction.md)), focusing on:
- **Pre-Render Validation Checklist** — walk through every item
- **Common Mistakes** section
- **Do NOT** section

Check the exhibit plan and corrected data against each rule. Fix any violations before rendering.

### Step 6: Navigate to Destination

If the user provided a separate destination file URL:
- `figma_navigate` — Switch to the destination file

If no destination was provided, stay in the current file.

### Step 7: Import and Detach Template

**If the user provided a cross-file destination URL** (navigated in Step 6), run via `figma_execute`:

```javascript
const PROPERTY_TEMPLATE_KEY = '__PROPERTY_TEMPLATE_KEY__';

const templateComponent = await figma.importComponentByKeyAsync(PROPERTY_TEMPLATE_KEY);
const instance = templateComponent.createInstance();
const { x, y } = figma.viewport.center;
instance.x = x - instance.width / 2;
instance.y = y - instance.height / 2;
const frame = instance.detachInstance();
frame.name = '__COMPONENT_NAME__ Properties';
figma.currentPage.selection = [frame];
figma.viewport.scrollAndZoomIntoView([frame]);
return { frameId: frame.id };
```

**If no destination was provided (default)**, run via `figma_execute` — this places the spec on the component's page, to its right:

```javascript
const PROPERTY_TEMPLATE_KEY = '__PROPERTY_TEMPLATE_KEY__';
const COMP_NODE_ID = '__COMPONENT_NODE_ID__';

const compNode = await figma.getNodeByIdAsync(COMP_NODE_ID);
let _p = compNode;
while (_p.parent && _p.parent.type !== 'DOCUMENT') _p = _p.parent;
if (_p.type === 'PAGE') await figma.setCurrentPageAsync(_p);

const templateComponent = await figma.importComponentByKeyAsync(PROPERTY_TEMPLATE_KEY);
const instance = templateComponent.createInstance();
const frame = instance.detachInstance();

const GAP = 200;
frame.x = compNode.x + compNode.width + GAP;
frame.y = compNode.y;

frame.name = '__COMPONENT_NAME__ Properties';
figma.currentPage.selection = [frame];
figma.viewport.scrollAndZoomIntoView([frame]);
return { frameId: frame.id, pageId: _p.id, pageName: _p.name };
```

Replace `__COMPONENT_NAME__` with the extracted `componentName`. Replace `__COMPONENT_NODE_ID__` with the node ID extracted from the component URL (same as `TARGET_NODE_ID` from Step 4).

Save the returned `frameId`.

### Step 8: Fill Header Fields

Run via `figma_execute` (replace `__FRAME_ID__`, `__COMPONENT_NAME__`, `__BRIEF_DESCRIPTION__`). Replace `__BRIEF_DESCRIPTION__` with the `briefDescription` composed during Step 4e:

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

const markerExample = frame.findOne(n => n.name === '#marker-example');
if (markerExample) markerExample.visible = false;

return { success: true };
```

### Step 9: Build Property Exhibits

This is the main rendering step. Iterate over the `exhibitPlan` array produced in Step 4e. Each entry specifies the chapter type, rendering mode, and configuration. Do NOT mechanically iterate `variantAxes` then `booleanProps` — the exhibit plan already accounts for matrix chapters, composite chapters, and context axis rendering.

**Template routing based on `contextAxis`:**

| Exhibit type | `contextAxis` is null | `contextAxis` is non-null |
|---|---|---|
| Variant axis chapter | **6a** (standard) | **6a-ctx** (contextual rows) |
| Boolean chapter | **6b** (standard) | **6b-ctx** (contextual rows) |
| Composite chapter | **6a** (custom OPTIONS) | **6a-ctx** (custom OPTIONS + context rows) |
| Sparse matrix | **6a-matrix** | **6a-matrix** (unchanged) |
| Variable mode | **6c** | **6c** (unchanged) |
| Child component | **6e/6f/6g** | **6e/6f/6g** (unchanged) |

When `contextAxis` is non-null, pass `CONTEXT_AXIS_NAME`, `CONTEXT_OPTIONS`, and `CONTEXT_DEFAULT` to the contextual templates. These values come from the `contextAxis` object produced in Step 4e.

Run **one `figma_execute` call per exhibit** to avoid timeouts. The scripts below are templates — select the appropriate template based on each exhibit entry's `template` field.

#### 6a: Standard VARIANT axis chapter

For exhibit plan entries with `template: "6a"` (when `contextAxis` is null). Also used for composite entries without context — supply a customized `OPTIONS` array and `DEFAULT_PROPS` as determined by the exhibit plan:

```javascript
const FRAME_ID = '__FRAME_ID__';
const COMP_SET_ID = '__COMP_SET_NODE_ID__';
const PROPERTY_NAME = '__PROPERTY_NAME__';
const OPTIONS = __OPTIONS_JSON__;
const DEFAULT_VALUE = '__DEFAULT_VALUE__';
const DEFAULT_PROPS = __DEFAULT_PROPS_JSON__;
const FONT_FAMILY = '__FONT_FAMILY__';

const frame = await figma.getNodeByIdAsync(FRAME_ID);
const chapterTemplate = frame.findOne(n => n.name === '#anatomy-section');

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

const chapter = chapterTemplate.clone();
chapterTemplate.parent.appendChild(chapter);
chapter.name = PROPERTY_NAME;
chapter.visible = true;

try {

await loadAllFonts(chapter);

const sectionName = chapter.findOne(n => n.name === '#section-name');
if (sectionName) {
  const t = sectionName.findOne(n => n.type === 'TEXT');
  if (t) t.characters = PROPERTY_NAME;
}

const sectionDesc = chapter.findOne(n => n.name === '#optional-section-description');
if (sectionDesc) {
  const t = sectionDesc.findOne(n => n.type === 'TEXT');
  if (t) t.characters = OPTIONS.length + ' options. Default: ' + DEFAULT_VALUE;
}

const assetPlaceholder = chapter.findOne(n => n.name === '#preview');
while (assetPlaceholder.children.length > 0) {
  assetPlaceholder.children[0].remove();
}
assetPlaceholder.layoutWrap = 'WRAP';
assetPlaceholder.counterAxisSpacing = assetPlaceholder.itemSpacing;

const compSet = await figma.getNodeByIdAsync(COMP_SET_ID);

for (const option of OPTIONS) {
  const variantProps = {};
  for (const [k, v] of Object.entries(DEFAULT_PROPS)) {
    variantProps[k] = v;
  }
  variantProps[PROPERTY_NAME] = option;

  let targetVariant = null;
  let bestFallback = null;
  let bestFallbackScore = -1;
  for (const child of compSet.children) {
    const vp = child.variantProperties || {};
    if (vp[PROPERTY_NAME] !== option) continue;
    let score = 0;
    let exactMatch = true;
    for (const [k, v] of Object.entries(variantProps)) {
      if (vp[k] === v) { score++; } else { exactMatch = false; }
    }
    if (exactMatch) { targetVariant = child; break; }
    if (score > bestFallbackScore) { bestFallbackScore = score; bestFallback = child; }
  }
  if (!targetVariant) targetVariant = bestFallback;

  const wrapper = figma.createFrame();
  wrapper.name = option;
  wrapper.layoutMode = 'VERTICAL';
  wrapper.primaryAxisAlignItems = 'CENTER';
  wrapper.counterAxisAlignItems = 'CENTER';
  wrapper.itemSpacing = 12;
  wrapper.fills = [];
  wrapper.primaryAxisSizingMode = 'AUTO';
  wrapper.counterAxisSizingMode = 'AUTO';
  assetPlaceholder.appendChild(wrapper);

  if (targetVariant) {
    const inst = targetVariant.createInstance();
    await loadAllFonts(inst);
    wrapper.appendChild(inst);
  } else {
    const placeholder = figma.createText();
    await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
    placeholder.characters = 'Variant unavailable';
    placeholder.fontSize = 12;
    placeholder.fills = [{ type: 'SOLID', color: { r: 0.6, g: 0.6, b: 0.6 } }];
    wrapper.appendChild(placeholder);
  }

  const LABEL_FONT = await loadFontWithFallback(FONT_FAMILY, 'Medium');
  const label = figma.createText();
  label.fontName = LABEL_FONT;
  label.characters = option === DEFAULT_VALUE ? option + ' (default)' : option;
  label.fontSize = 14;
  label.fills = [{ type: 'SOLID', color: { r: 0.29, g: 0.29, b: 0.29 } }];
  wrapper.appendChild(label);
}

return { success: true, property: PROPERTY_NAME };

} catch (e) {
  chapter.remove();
  return { error: e.message, rolledBack: true };
}
```

#### 6a-ctx: Contextual VARIANT axis chapter

When `contextAxis` is non-null, use this template instead of 6a for variant chapters. Also used for composite chapters with context. The template adds an outer loop over context axis values, rendering grouped rows inside a vertical container frame. Each row group has a row label and a horizontal instance row.

Replace `CONTEXT_AXIS_NAME`, `CONTEXT_OPTIONS`, and `CONTEXT_DEFAULT` with the context axis data from the exhibit plan. Replace all other placeholders as in 6a:

```javascript
const FRAME_ID = '__FRAME_ID__';
const COMP_SET_ID = '__COMP_SET_NODE_ID__';
const PROPERTY_NAME = '__PROPERTY_NAME__';
const OPTIONS = __OPTIONS_JSON__;
const DEFAULT_VALUE = '__DEFAULT_VALUE__';
const DEFAULT_PROPS = __DEFAULT_PROPS_JSON__;
const CONTEXT_AXIS_NAME = '__CONTEXT_AXIS_NAME__';
const CONTEXT_OPTIONS = __CONTEXT_OPTIONS_JSON__;
const CONTEXT_DEFAULT = '__CONTEXT_DEFAULT__';
const FONT_FAMILY = '__FONT_FAMILY__';

const frame = await figma.getNodeByIdAsync(FRAME_ID);
const chapterTemplate = frame.findOne(n => n.name === '#anatomy-section');

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

const chapter = chapterTemplate.clone();
chapterTemplate.parent.appendChild(chapter);
chapter.name = PROPERTY_NAME;
chapter.visible = true;

try {

await loadAllFonts(chapter);

const sectionName = chapter.findOne(n => n.name === '#section-name');
if (sectionName) {
  const t = sectionName.findOne(n => n.type === 'TEXT');
  if (t) t.characters = PROPERTY_NAME;
}

const sectionDesc = chapter.findOne(n => n.name === '#optional-section-description');
if (sectionDesc) {
  const t = sectionDesc.findOne(n => n.type === 'TEXT');
  if (t) t.characters = OPTIONS.length + ' options across ' + CONTEXT_OPTIONS.length + ' ' + CONTEXT_AXIS_NAME + 's. Default: ' + DEFAULT_VALUE;
}

const assetPlaceholder = chapter.findOne(n => n.name === '#preview');
while (assetPlaceholder.children.length > 0) {
  assetPlaceholder.children[0].remove();
}

const compSet = await figma.getNodeByIdAsync(COMP_SET_ID);
const LABEL_FONT = await loadFontWithFallback(FONT_FAMILY, 'Medium');
const ROW_LABEL_FONT = await loadFontWithFallback(FONT_FAMILY, 'Bold');

const contextContainer = figma.createFrame();
contextContainer.name = 'context-groups';
contextContainer.layoutMode = 'VERTICAL';
contextContainer.itemSpacing = 32;
contextContainer.fills = [];
contextContainer.primaryAxisSizingMode = 'AUTO';
contextContainer.counterAxisSizingMode = 'FILL';
assetPlaceholder.appendChild(contextContainer);

for (const ctxValue of CONTEXT_OPTIONS) {
  const rowGroup = figma.createFrame();
  rowGroup.name = ctxValue;
  rowGroup.layoutMode = 'VERTICAL';
  rowGroup.itemSpacing = 16;
  rowGroup.fills = [];
  rowGroup.primaryAxisSizingMode = 'AUTO';
  rowGroup.counterAxisSizingMode = 'FILL';
  contextContainer.appendChild(rowGroup);

  const rowLabel = figma.createText();
  rowLabel.fontName = ROW_LABEL_FONT;
  rowLabel.characters = ctxValue === CONTEXT_DEFAULT ? ctxValue + ' (default)' : ctxValue;
  rowLabel.fontSize = 12;
  rowLabel.fills = [{ type: 'SOLID', color: { r: 0.45, g: 0.45, b: 0.45 } }];
  rowGroup.appendChild(rowLabel);

  const instanceRow = figma.createFrame();
  instanceRow.name = ctxValue + '-instances';
  instanceRow.layoutMode = 'HORIZONTAL';
  instanceRow.layoutWrap = 'WRAP';
  instanceRow.itemSpacing = 24;
  instanceRow.counterAxisSpacing = 24;
  instanceRow.fills = [];
  instanceRow.primaryAxisSizingMode = 'AUTO';
  instanceRow.counterAxisSizingMode = 'AUTO';
  rowGroup.appendChild(instanceRow);

  for (const option of OPTIONS) {
    const variantProps = { ...DEFAULT_PROPS };
    variantProps[PROPERTY_NAME] = option;
    variantProps[CONTEXT_AXIS_NAME] = ctxValue;

    let targetVariant = null;
    let bestFallback = null;
    let bestFallbackScore = -1;
    for (const child of compSet.children) {
      const vp = child.variantProperties || {};
      if (vp[PROPERTY_NAME] !== option) continue;
      if (vp[CONTEXT_AXIS_NAME] !== ctxValue) continue;
      let score = 0;
      let exactMatch = true;
      for (const [k, v] of Object.entries(variantProps)) {
        if (vp[k] === v) { score++; } else { exactMatch = false; }
      }
      if (exactMatch) { targetVariant = child; break; }
      if (score > bestFallbackScore) { bestFallbackScore = score; bestFallback = child; }
    }
    if (!targetVariant) targetVariant = bestFallback;

    const wrapper = figma.createFrame();
    wrapper.name = option;
    wrapper.layoutMode = 'VERTICAL';
    wrapper.primaryAxisAlignItems = 'CENTER';
    wrapper.counterAxisAlignItems = 'CENTER';
    wrapper.itemSpacing = 12;
    wrapper.fills = [];
    wrapper.primaryAxisSizingMode = 'AUTO';
    wrapper.counterAxisSizingMode = 'AUTO';
    instanceRow.appendChild(wrapper);

    if (targetVariant) {
      const inst = targetVariant.createInstance();
      await loadAllFonts(inst);
      wrapper.appendChild(inst);
    } else {
      const placeholder = figma.createText();
      await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
      placeholder.characters = 'N/A';
      placeholder.fontSize = 12;
      placeholder.fills = [{ type: 'SOLID', color: { r: 0.6, g: 0.6, b: 0.6 } }];
      wrapper.appendChild(placeholder);
    }

    const label = figma.createText();
    label.fontName = LABEL_FONT;
    label.characters = option === DEFAULT_VALUE ? option + ' (default)' : option;
    label.fontSize = 14;
    label.fills = [{ type: 'SOLID', color: { r: 0.29, g: 0.29, b: 0.29 } }];
    wrapper.appendChild(label);
  }
}

return { success: true, property: PROPERTY_NAME };

} catch (e) {
  chapter.remove();
  return { error: e.message, rolledBack: true };
}
```

**Key differences from 6a:**
- Outer loop over `CONTEXT_OPTIONS` creates row groups with labels
- A `contextContainer` frame inside `#preview` handles vertical stacking (avoids modifying `#preview` properties)
- `variantProps` sets both `PROPERTY_NAME` and `CONTEXT_AXIS_NAME` for each instance
- Variant lookup requires both the property AND context axis to match, with fallback scoring
- Row labels use Bold/12px to distinguish from option labels (Medium/14px)
- N/A placeholders appear when a context × option combination doesn't exist

**Composite chapters with context:** When a composite chapter (variant axis + related booleans) needs context rendering, use the same 6a-ctx structure. The `OPTIONS` loop creates instances with custom property combinations (as in the standard composite approach), and the outer `CONTEXT_OPTIONS` loop wraps everything in context rows. For each composite option, set the variant properties AND the boolean properties on the instance, then also set `CONTEXT_AXIS_NAME = ctxValue`.

#### 6a-matrix: For a SPARSE VARIANT MATRIX chapter

When the exhibit plan (Step 4e) identified a sparse axis pair, render a matrix chapter **plus standalone chapters for both axes**. The matrix's primary axis forms the rows, the secondary axis forms the columns. Missing combinations get "N/A" placeholders that occupy the same cell space as real instances for visual alignment. The standalone chapters (6a) give engineers a dedicated reference for each axis in isolation; the matrix shows which cross-product combinations exist.

**Grid layout technique**: The matrix uses **absolute positioning** inside a non-auto-layout child frame, nested within the template's `#preview` frame. This prevents auto-layout from collapsing or misaligning cells when "N/A" placeholders are smaller than real instances.

```javascript
const FRAME_ID = '__FRAME_ID__';
const COMP_SET_ID = '__COMP_SET_NODE_ID__';
const PRIMARY_AXIS = '__PRIMARY_AXIS_NAME__';   // e.g., 'variant' (rows)
const SECONDARY_AXIS = '__SECONDARY_AXIS_NAME__'; // e.g., 'color' (columns)
const PRIMARY_OPTIONS = __PRIMARY_OPTIONS_JSON__;
const SECONDARY_OPTIONS = __SECONDARY_OPTIONS_JSON__;
const DEFAULT_PROPS = __DEFAULT_PROPS_JSON__;
const FONT_FAMILY = '__FONT_FAMILY__';
const CHAPTER_NAME = '__CHAPTER_NAME__';
const DESCRIPTION = '__DESCRIPTION__';

const frame = await figma.getNodeByIdAsync(FRAME_ID);
const chapterTemplate = frame.findOne(n => n.name === '#anatomy-section');

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
  if (familyFonts.length === 0) return { family: 'Inter', style: fallbackStyle };
  const pref = familyFonts.find(f => f.fontName.style === preferredStyle);
  if (pref) return pref.fontName;
  const fb = familyFonts.find(f => f.fontName.style === fallbackStyle);
  return fb ? fb.fontName : familyFonts[0].fontName;
}

const chapter = chapterTemplate.clone();
chapter.visible = true;
chapter.name = CHAPTER_NAME;
frame.appendChild(chapter);

try {

await loadAllFonts(chapter);
const titleNode = chapter.findOne(n => n.name === '#property-name' && n.type === 'TEXT');
if (titleNode) titleNode.characters = CHAPTER_NAME;
const descNode = chapter.findOne(n => n.name === '#property-description' && n.type === 'TEXT');
if (descNode) descNode.characters = DESCRIPTION;

const assetPlaceholder = chapter.findOne(n => n.name === '#preview');
while (assetPlaceholder.children.length > 0) assetPlaceholder.children[0].remove();

// --- Measure a sample instance to determine cell size ---
const compSet = await figma.getNodeByIdAsync(COMP_SET_ID);
const sampleVariant = compSet.children[0];
const sampleInst = sampleVariant.createInstance();
await loadAllFonts(sampleInst);
const CELL_W = Math.ceil(sampleInst.width) + 40;
const CELL_H = Math.ceil(sampleInst.height) + 40;
sampleInst.remove();

const LABEL_H = 20;
const HEADER_H = 24;
const GAP = 8;
const ROW_LABEL_W = 120;
const GRID_LEFT = ROW_LABEL_W + GAP;

const totalCols = SECONDARY_OPTIONS.length;
const totalRows = PRIMARY_OPTIONS.length;
const totalW = GRID_LEFT + totalCols * (CELL_W + GAP);
const totalH = HEADER_H + GAP + totalRows * (CELL_H + LABEL_H + GAP);

// Preserve #preview as auto-layout, create a non-auto-layout child for the grid
assetPlaceholder.layoutWrap = 'WRAP';
const gridFrame = figma.createFrame();
gridFrame.name = CHAPTER_NAME + '-grid';
gridFrame.layoutMode = 'NONE';
gridFrame.fills = [];
gridFrame.resize(totalW, totalH);
assetPlaceholder.appendChild(gridFrame);

const LABEL_FONT = await loadFontWithFallback(FONT_FAMILY, 'Medium');
const HEADER_FONT = await loadFontWithFallback(FONT_FAMILY, 'Bold');

// --- Column headers ---
for (let ci = 0; ci < SECONDARY_OPTIONS.length; ci++) {
  const header = figma.createText();
  header.fontName = HEADER_FONT;
  header.characters = SECONDARY_OPTIONS[ci];
  header.fontSize = 12;
  header.fills = [{ type: 'SOLID', color: { r: 0.4, g: 0.4, b: 0.4 } }];
  gridFrame.appendChild(header);
  header.x = GRID_LEFT + ci * (CELL_W + GAP) + CELL_W / 2 - header.width / 2;
  header.y = 0;
}

// --- Rows ---
for (let ri = 0; ri < PRIMARY_OPTIONS.length; ri++) {
  const rowY = HEADER_H + GAP + ri * (CELL_H + LABEL_H + GAP);
  const rowLabel = figma.createText();
  rowLabel.fontName = LABEL_FONT;
  rowLabel.characters = PRIMARY_OPTIONS[ri];
  rowLabel.fontSize = 14;
  rowLabel.fills = [{ type: 'SOLID', color: { r: 0.29, g: 0.29, b: 0.29 } }];
  gridFrame.appendChild(rowLabel);
  rowLabel.x = 0;
  rowLabel.y = rowY + CELL_H / 2 - rowLabel.height / 2;

  for (let ci = 0; ci < SECONDARY_OPTIONS.length; ci++) {
    const cellX = GRID_LEFT + ci * (CELL_W + GAP);
    const cellY = rowY;

    const variantProps = { ...DEFAULT_PROPS };
    variantProps[PRIMARY_AXIS] = PRIMARY_OPTIONS[ri];
    variantProps[SECONDARY_AXIS] = SECONDARY_OPTIONS[ci];

    let targetVariant = null;
    for (const child of compSet.children) {
      const vp = child.variantProperties || {};
      let match = true;
      for (const [k, v] of Object.entries(variantProps)) {
        if (vp[k] !== v) { match = false; break; }
      }
      if (match) { targetVariant = child; break; }
    }

    const wrapper = figma.createFrame();
    wrapper.layoutMode = 'VERTICAL';
    wrapper.primaryAxisAlignItems = 'CENTER';
    wrapper.counterAxisAlignItems = 'CENTER';
    wrapper.itemSpacing = 8;
    wrapper.fills = [];
    wrapper.primaryAxisSizingMode = 'AUTO';
    wrapper.counterAxisSizingMode = 'FIXED';
    wrapper.resize(CELL_W, CELL_H + LABEL_H);

    if (targetVariant) {
      const inst = targetVariant.createInstance();
      await loadAllFonts(inst);
      wrapper.appendChild(inst);
    } else {
      const naText = figma.createText();
      await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
      naText.characters = 'N/A';
      naText.fontSize = 14;
      naText.fills = [{ type: 'SOLID', color: { r: 0.7, g: 0.7, b: 0.7 } }];
      wrapper.appendChild(naText);
    }

    gridFrame.appendChild(wrapper);
    wrapper.x = cellX;
    wrapper.y = cellY;
  }
}

return { success: true, chapter: CHAPTER_NAME };

} catch (e) {
  chapter.remove();
  return { error: e.message, rolledBack: true };
}
```

**N/A placeholder rule**: Always render "N/A" text for missing combinations. Never skip the cell or leave it empty — the placeholder preserves the grid's visual scanability and lets the spec consumer immediately see which combinations don't exist.

**Cell sizing**: Measure a real instance before building the grid. Use the measured dimensions + padding as the fixed cell size. All cells (instance and N/A) use the same width to maintain column alignment.

#### 6b: Standard BOOLEAN property chapter

For exhibit plan entries with `template: "6b"` (when `contextAxis` is null).

**Skip controlling booleans**: Before rendering each parent boolean, check if its `name` appears in the `controllingBooleanNames` set built in Step 4c. If so, skip it — its chapter is produced by 6e as part of the unified child component chapter.

**Handle variant-gated booleans**: Before rendering, check if the boolean has `requiredVariantOverrides` (from Step 4a). If so, the base variant for instance creation must match those overrides instead of using the default variant. Replace `VARIANT_OVERRIDES` with the required overrides object (e.g., `{"Behavior": "Interactive"}`), or `null` if the boolean is not variant-gated.

**Slot-aware descriptions**: Replace `__CONTROLS_SLOT_BOOL__` with the boolean's `controlsSlot` value (`true` or `false`). Replace `__SLOT_PREFERRED_NAMES_JSON__` with the boolean's `slotPreferredNames` array (e.g., `["Checkbox", "Radio"]`), or `[]` if empty. When a boolean controls a SLOT, the description reads "Controls slot: {name} (accepts: {preferred})" instead of "Controls layer: {name}".

For each remaining boolean property, run via `figma_execute`:

```javascript
const FRAME_ID = '__FRAME_ID__';
const COMP_SET_ID = '__COMP_SET_NODE_ID__';
const PROPERTY_NAME = '__PROPERTY_NAME__';
const DEFAULT_VALUE = __DEFAULT_BOOL_VALUE__;
const ASSOCIATED_LAYER = '__ASSOCIATED_LAYER__';
const CONTROLS_SLOT = __CONTROLS_SLOT_BOOL__;
const SLOT_PREFERRED_NAMES = __SLOT_PREFERRED_NAMES_JSON__;
const VARIANT_OVERRIDES = __VARIANT_OVERRIDES_OR_NULL__;
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

const frame = await figma.getNodeByIdAsync(FRAME_ID);
const chapterTemplate = frame.findOne(n => n.name === '#anatomy-section');

const chapter = chapterTemplate.clone();
chapterTemplate.parent.appendChild(chapter);
chapter.name = PROPERTY_NAME;
chapter.visible = true;

try {

await loadAllFonts(chapter);

const sectionName = chapter.findOne(n => n.name === '#section-name');
if (sectionName) {
  const t = sectionName.findOne(n => n.type === 'TEXT');
  if (t) t.characters = PROPERTY_NAME;
}

const sectionDesc = chapter.findOne(n => n.name === '#optional-section-description');
if (sectionDesc) {
  const t = sectionDesc.findOne(n => n.type === 'TEXT');
  const defaultStr = DEFAULT_VALUE ? 'true' : 'false';
  let layerStr = '';
  if (CONTROLS_SLOT) {
    layerStr = '. Controls slot: ' + ASSOCIATED_LAYER;
    if (SLOT_PREFERRED_NAMES.length > 0) layerStr += ' (accepts: ' + SLOT_PREFERRED_NAMES.join(', ') + ')';
  } else if (ASSOCIATED_LAYER) {
    layerStr = '. Controls layer: ' + ASSOCIATED_LAYER;
  }
  const gateStr = VARIANT_OVERRIDES ? '. Requires ' + Object.entries(VARIANT_OVERRIDES).map(([k,v]) => k + ' = ' + v).join(', ') : '';
  if (t) t.characters = 'Boolean toggle. Default: ' + defaultStr + layerStr + gateStr;
}

const assetPlaceholder = chapter.findOne(n => n.name === '#preview');
while (assetPlaceholder.children.length > 0) {
  assetPlaceholder.children[0].remove();
}
assetPlaceholder.layoutWrap = 'WRAP';
assetPlaceholder.counterAxisSpacing = assetPlaceholder.itemSpacing;

const compNode = await figma.getNodeByIdAsync(COMP_SET_ID);

let baseVariant;
if (VARIANT_OVERRIDES && compNode.type === 'COMPONENT_SET') {
  const defaultVProps = (compNode.defaultVariant || compNode.children[0]).variantProperties || {};
  const targetProps = { ...defaultVProps, ...VARIANT_OVERRIDES };
  baseVariant = null;
  let bestScore = -1;
  for (const child of compNode.children) {
    const vp = child.variantProperties || {};
    let score = 0;
    let exact = true;
    for (const [k, v] of Object.entries(targetProps)) {
      if (vp[k] === v) { score++; } else { exact = false; }
    }
    if (exact) { baseVariant = child; break; }
    if (score > bestScore) { bestScore = score; baseVariant = child; }
  }
} else {
  baseVariant = compNode.type === 'COMPONENT_SET'
    ? (compNode.defaultVariant || compNode.children[0])
    : compNode;
}

const LABEL_FONT = await loadFontWithFallback(FONT_FAMILY, 'Medium');

for (const boolVal of [true, false]) {
  const wrapper = figma.createFrame();
  wrapper.name = PROPERTY_NAME + ' = ' + boolVal;
  wrapper.layoutMode = 'VERTICAL';
  wrapper.primaryAxisAlignItems = 'CENTER';
  wrapper.counterAxisAlignItems = 'CENTER';
  wrapper.itemSpacing = 12;
  wrapper.fills = [];
  wrapper.primaryAxisSizingMode = 'AUTO';
  wrapper.counterAxisSizingMode = 'AUTO';
  assetPlaceholder.appendChild(wrapper);

  const inst = baseVariant.createInstance();
  await loadAllFonts(inst);
  wrapper.appendChild(inst);

  for (const [rawKey, val] of Object.entries(inst.componentProperties)) {
    const cleanKey = rawKey.split('#')[0];
    if (cleanKey === PROPERTY_NAME) {
      inst.setProperties({ [rawKey]: boolVal });
      await loadAllFonts(inst);
      break;
    }
  }

  const label = figma.createText();
  label.fontName = LABEL_FONT;
  const isDefault = boolVal === DEFAULT_VALUE;
  label.characters = String(boolVal) + (isDefault ? ' (default)' : '');
  label.fontSize = 14;
  label.fills = [{ type: 'SOLID', color: { r: 0.29, g: 0.29, b: 0.29 } }];
  wrapper.appendChild(label);
}

return { success: true, property: PROPERTY_NAME };

} catch (e) {
  chapter.remove();
  return { error: e.message, rolledBack: true };
}
```

#### 6b-ctx: Contextual BOOLEAN property chapter

When `contextAxis` is non-null, use this template instead of 6b for boolean chapters. It wraps the true/false toggle in context rows so the developer sees how the boolean looks across all context values.

**Skip controlling booleans and handle variant-gated booleans** using the same rules as 6b.

For each remaining boolean property, run via `figma_execute`:

```javascript
const FRAME_ID = '__FRAME_ID__';
const COMP_SET_ID = '__COMP_SET_NODE_ID__';
const PROPERTY_NAME = '__PROPERTY_NAME__';
const DEFAULT_VALUE = __DEFAULT_BOOL_VALUE__;
const ASSOCIATED_LAYER = '__ASSOCIATED_LAYER__';
const CONTROLS_SLOT = __CONTROLS_SLOT_BOOL__;
const SLOT_PREFERRED_NAMES = __SLOT_PREFERRED_NAMES_JSON__;
const VARIANT_OVERRIDES = __VARIANT_OVERRIDES_OR_NULL__;
const CONTEXT_AXIS_NAME = '__CONTEXT_AXIS_NAME__';
const CONTEXT_OPTIONS = __CONTEXT_OPTIONS_JSON__;
const CONTEXT_DEFAULT = '__CONTEXT_DEFAULT__';
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

const frame = await figma.getNodeByIdAsync(FRAME_ID);
const chapterTemplate = frame.findOne(n => n.name === '#anatomy-section');

const chapter = chapterTemplate.clone();
chapterTemplate.parent.appendChild(chapter);
chapter.name = PROPERTY_NAME;
chapter.visible = true;

try {

await loadAllFonts(chapter);

const sectionName = chapter.findOne(n => n.name === '#section-name');
if (sectionName) {
  const t = sectionName.findOne(n => n.type === 'TEXT');
  if (t) t.characters = PROPERTY_NAME;
}

const sectionDesc = chapter.findOne(n => n.name === '#optional-section-description');
if (sectionDesc) {
  const t = sectionDesc.findOne(n => n.type === 'TEXT');
  const defaultStr = DEFAULT_VALUE ? 'true' : 'false';
  let layerStr = '';
  if (CONTROLS_SLOT) {
    layerStr = '. Controls slot: ' + ASSOCIATED_LAYER;
    if (SLOT_PREFERRED_NAMES.length > 0) layerStr += ' (accepts: ' + SLOT_PREFERRED_NAMES.join(', ') + ')';
  } else if (ASSOCIATED_LAYER) {
    layerStr = '. Controls layer: ' + ASSOCIATED_LAYER;
  }
  const gateStr = VARIANT_OVERRIDES ? '. Requires ' + Object.entries(VARIANT_OVERRIDES).map(([k,v]) => k + ' = ' + v).join(', ') : '';
  if (t) t.characters = 'Boolean toggle across ' + CONTEXT_OPTIONS.length + ' ' + CONTEXT_AXIS_NAME + 's. Default: ' + defaultStr + layerStr + gateStr;
}

const assetPlaceholder = chapter.findOne(n => n.name === '#preview');
while (assetPlaceholder.children.length > 0) {
  assetPlaceholder.children[0].remove();
}

const compNode = await figma.getNodeByIdAsync(COMP_SET_ID);
const LABEL_FONT = await loadFontWithFallback(FONT_FAMILY, 'Medium');
const ROW_LABEL_FONT = await loadFontWithFallback(FONT_FAMILY, 'Bold');

const contextContainer = figma.createFrame();
contextContainer.name = 'context-groups';
contextContainer.layoutMode = 'VERTICAL';
contextContainer.itemSpacing = 32;
contextContainer.fills = [];
contextContainer.primaryAxisSizingMode = 'AUTO';
contextContainer.counterAxisSizingMode = 'FILL';
assetPlaceholder.appendChild(contextContainer);

for (const ctxValue of CONTEXT_OPTIONS) {
  const rowGroup = figma.createFrame();
  rowGroup.name = ctxValue;
  rowGroup.layoutMode = 'VERTICAL';
  rowGroup.itemSpacing = 16;
  rowGroup.fills = [];
  rowGroup.primaryAxisSizingMode = 'AUTO';
  rowGroup.counterAxisSizingMode = 'FILL';
  contextContainer.appendChild(rowGroup);

  const rowLabel = figma.createText();
  rowLabel.fontName = ROW_LABEL_FONT;
  rowLabel.characters = ctxValue === CONTEXT_DEFAULT ? ctxValue + ' (default)' : ctxValue;
  rowLabel.fontSize = 12;
  rowLabel.fills = [{ type: 'SOLID', color: { r: 0.45, g: 0.45, b: 0.45 } }];
  rowGroup.appendChild(rowLabel);

  const instanceRow = figma.createFrame();
  instanceRow.name = ctxValue + '-instances';
  instanceRow.layoutMode = 'HORIZONTAL';
  instanceRow.layoutWrap = 'WRAP';
  instanceRow.itemSpacing = 24;
  instanceRow.counterAxisSpacing = 24;
  instanceRow.fills = [];
  instanceRow.primaryAxisSizingMode = 'AUTO';
  instanceRow.counterAxisSizingMode = 'AUTO';
  rowGroup.appendChild(instanceRow);

  const defaultVProps = (compNode.defaultVariant || compNode.children[0]).variantProperties || {};
  const baseProps = VARIANT_OVERRIDES ? { ...defaultVProps, ...VARIANT_OVERRIDES } : { ...defaultVProps };
  baseProps[CONTEXT_AXIS_NAME] = ctxValue;

  let baseVariant = null;
  let bestScore = -1;
  for (const child of compNode.children) {
    const vp = child.variantProperties || {};
    let score = 0;
    let exact = true;
    for (const [k, v] of Object.entries(baseProps)) {
      if (vp[k] === v) { score++; } else { exact = false; }
    }
    if (exact) { baseVariant = child; break; }
    if (score > bestScore) { bestScore = score; baseVariant = child; }
  }

  if (!baseVariant) {
    const skipLabel = figma.createText();
    skipLabel.fontName = LABEL_FONT;
    skipLabel.characters = 'Not available for ' + ctxValue;
    skipLabel.fontSize = 12;
    skipLabel.fills = [{ type: 'SOLID', color: { r: 0.6, g: 0.6, b: 0.6 } }];
    instanceRow.appendChild(skipLabel);
    continue;
  }

  for (const boolVal of [true, false]) {
    const wrapper = figma.createFrame();
    wrapper.name = PROPERTY_NAME + ' = ' + boolVal;
    wrapper.layoutMode = 'VERTICAL';
    wrapper.primaryAxisAlignItems = 'CENTER';
    wrapper.counterAxisAlignItems = 'CENTER';
    wrapper.itemSpacing = 12;
    wrapper.fills = [];
    wrapper.primaryAxisSizingMode = 'AUTO';
    wrapper.counterAxisSizingMode = 'AUTO';
    instanceRow.appendChild(wrapper);

    const inst = baseVariant.createInstance();
    await loadAllFonts(inst);
    wrapper.appendChild(inst);

    for (const [rawKey, val] of Object.entries(inst.componentProperties)) {
      const cleanKey = rawKey.split('#')[0];
      if (cleanKey === PROPERTY_NAME) {
        inst.setProperties({ [rawKey]: boolVal });
        await loadAllFonts(inst);
        break;
      }
    }

    const label = figma.createText();
    label.fontName = LABEL_FONT;
    const isDefault = boolVal === DEFAULT_VALUE;
    label.characters = String(boolVal) + (isDefault ? ' (default)' : '');
    label.fontSize = 14;
    label.fills = [{ type: 'SOLID', color: { r: 0.29, g: 0.29, b: 0.29 } }];
    wrapper.appendChild(label);
  }
}

return { success: true, property: PROPERTY_NAME };

} catch (e) {
  chapter.remove();
  return { error: e.message, rolledBack: true };
}
```

**Key differences from 6b:**
- Outer loop over `CONTEXT_OPTIONS` creates row groups with labels
- Base variant lookup includes `CONTEXT_AXIS_NAME = ctxValue` in the target props
- When no base variant exists for a context value (sparse), the row shows "Not available for {ctxValue}" instead of failing
- Same `contextContainer` → `rowGroup` → `instanceRow` nesting as 6a-ctx

#### 6c: For each VARIABLE MODE property

If `variableModeProps` is not empty, render a visual chapter for each. Variable mode properties are controlled via Figma variable modes at the container level. To produce visual previews, create a wrapper frame for each mode option, place a component instance inside, and call `wrapper.setExplicitVariableModeForCollection(collection, modeId)` on the wrapper so the instance inherits the mode.

**Important — collection object, not string ID:** The Figma plugin API in incremental mode requires the actual collection object for `setExplicitVariableModeForCollection`, not a string ID. The script below fetches the collection object via `getLocalVariableCollectionsAsync()`.

**Important — clearing baked-in modes:** Some components have explicit variable modes set directly on their root or internal nodes. Instances created from such components inherit these baked-in modes, which override the wrapper's mode. After creating each instance, the script recursively clears explicit modes for the target collection so the instance defers to the wrapper.

For each variable mode property, run via `figma_execute`:

```javascript
const FRAME_ID = '__FRAME_ID__';
const COMP_SET_ID = '__COMP_SET_NODE_ID__';
const PROPERTY_NAME = '__PROPERTY_NAME__';
const DEFAULT_VALUE = '__DEFAULT_VALUE__';
const COLLECTION_NAME = '__COLLECTION_NAME__';
const COLLECTION_ID = '__COLLECTION_ID__';
const MODES = __MODES_JSON__;
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

const frame = await figma.getNodeByIdAsync(FRAME_ID);
const chapterTemplate = frame.findOne(n => n.name === '#anatomy-section');

const chapter = chapterTemplate.clone();
chapterTemplate.parent.appendChild(chapter);
chapter.name = PROPERTY_NAME;
chapter.visible = true;

try {

const collections = await figma.variables.getLocalVariableCollectionsAsync();
const collection = collections.find(c => c.id === COLLECTION_ID);
if (!collection) {
  chapter.remove();
  return { error: 'Variable collection not found: ' + COLLECTION_ID };
}

function clearModesRecursive(node, col) {
  try { node.clearExplicitVariableModeForCollection(col); } catch {}
  if ('children' in node) {
    for (const child of node.children) clearModesRecursive(child, col);
  }
}

await loadAllFonts(chapter);

const sectionName = chapter.findOne(n => n.name === '#section-name');
if (sectionName) {
  const t = sectionName.findOne(n => n.type === 'TEXT');
  if (t) t.characters = PROPERTY_NAME;
}

const sectionDesc = chapter.findOne(n => n.name === '#optional-section-description');
if (sectionDesc) {
  const t = sectionDesc.findOne(n => n.type === 'TEXT');
  if (t) {
    t.characters = MODES.length + ' options. Default: ' + DEFAULT_VALUE + '. Controlled via \'' + COLLECTION_NAME + '\' variable mode.';
  }
}

const assetPlaceholder = chapter.findOne(n => n.name === '#preview');
while (assetPlaceholder.children.length > 0) {
  assetPlaceholder.children[0].remove();
}
assetPlaceholder.layoutWrap = 'WRAP';
assetPlaceholder.counterAxisSpacing = assetPlaceholder.itemSpacing;

const compNode = await figma.getNodeByIdAsync(COMP_SET_ID);
const defaultVariant = compNode.type === 'COMPONENT_SET'
  ? (compNode.defaultVariant || compNode.children[0])
  : compNode;

const LABEL_FONT = await loadFontWithFallback(FONT_FAMILY, 'Medium');

for (const mode of MODES) {
  const wrapper = figma.createFrame();
  wrapper.name = mode.name;
  wrapper.layoutMode = 'VERTICAL';
  wrapper.primaryAxisAlignItems = 'CENTER';
  wrapper.counterAxisAlignItems = 'CENTER';
  wrapper.itemSpacing = 12;
  wrapper.fills = [];
  wrapper.primaryAxisSizingMode = 'AUTO';
  wrapper.counterAxisSizingMode = 'AUTO';
  assetPlaceholder.appendChild(wrapper);

  wrapper.setExplicitVariableModeForCollection(collection, mode.modeId);

  const inst = defaultVariant.createInstance();
  wrapper.appendChild(inst);
  clearModesRecursive(inst, collection);

  const label = figma.createText();
  label.fontName = LABEL_FONT;
  label.characters = mode.name === DEFAULT_VALUE ? mode.name + ' (default)' : mode.name;
  label.fontSize = 14;
  label.fills = [{ type: 'SOLID', color: { r: 0.29, g: 0.29, b: 0.29 } }];
  wrapper.appendChild(label);
}

return { success: true, property: PROPERTY_NAME };

} catch (e) {
  chapter.remove();
  return { error: e.message, rolledBack: true };
}
```

#### 6e: For each CHILD COMPONENT

If `childComponents` from Step 4c is not empty, render chapters for each child component.

**Rendering mode selection:** The preferred approach is **in-context rendering** — creating parent component instances with the child's property varied on the nested instance. This shows the child property in the context of the full parent component, which matches the designer's experience.

However, use **blown-out rendering** (isolated sub-component instances created directly from the child's component set) when any of these conditions apply:

- The child was flagged for blown-out rendering in Step 4e (sparse variant matrix, interdependent constraints)
- `setProperties()` on a nested instance fails at runtime (fallback — catch the error, remove the broken chapter, and re-render blown-out)
- Multiple identical child instances exist in the parent (e.g., 4 buttons in a button group) — deduplicate to one blown-out child entry
- The user explicitly requests blown-out views

When blown-out rendering is used, create instances directly from the child's `mainComponentSetId` component set using `findVariant()` to locate the exact variant, rather than modifying nested instances. See **6e-iii** for the blown-out script template.

**Important**: Run **one `figma_execute` call per child component** (covering its variant axes chapter). If the child also has boolean properties, run a second call for the boolean chapters. This prevents timeouts.

##### 6e-i: Child variant axes (with optional off state)

**Skip coupled axes**: Before rendering each child variant axis, check if the axis has `coupled === true` (set in Step 4d-i). If so, skip it entirely — it mirrors the parent axis and adds no information.

For each remaining child component variant axis, run via `figma_execute`. When the child has a `controllingBooleanName`, the first preview shows the "off" state (controlling boolean = false), and subsequent previews show each variant option (controlling boolean = true, child variant swapped). When there is no controlling boolean, only the variant options are shown.

Replace placeholders with extracted data. Set `CONTROLLING_BOOL_RAW_KEY` to `null` if no controlling boolean was found.

```javascript
const FRAME_ID = '__FRAME_ID__';
const COMP_SET_ID = '__COMP_SET_NODE_ID__';
const CHILD_NAME = '__CHILD_LAYER_NAME__';
const MAIN_COMP_NAME = '__MAIN_COMPONENT_NAME__';
const CONTROLLING_BOOL_NAME = '__CONTROLLING_BOOL_NAME__';
const CONTROLLING_BOOL_RAW_KEY = __CONTROLLING_BOOL_RAW_KEY_OR_NULL__;
const VARIANT_AXES = __VARIANT_AXES_JSON__;
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

const frame = await figma.getNodeByIdAsync(FRAME_ID);
const chapterTemplate = frame.findOne(n => n.name === '#anatomy-section');

const compNode = await figma.getNodeByIdAsync(COMP_SET_ID);
const parentDefaultVariant = compNode.type === 'COMPONENT_SET'
  ? (compNode.defaultVariant || compNode.children[0])
  : compNode;

const LABEL_FONT = await loadFontWithFallback(FONT_FAMILY, 'Medium');

for (const axis of VARIANT_AXES) {

const chapter = chapterTemplate.clone();
chapterTemplate.parent.appendChild(chapter);
chapter.name = CHILD_NAME + ' – ' + axis.name;
chapter.visible = true;

try {

await loadAllFonts(chapter);

const sectionName = chapter.findOne(n => n.name === '#section-name');
if (sectionName) {
  const t = sectionName.findOne(n => n.type === 'TEXT');
  if (t) t.characters = CHILD_NAME + ' – ' + axis.name;
}

const sectionDesc = chapter.findOne(n => n.name === '#optional-section-description');
if (sectionDesc) {
  const t = sectionDesc.findOne(n => n.type === 'TEXT');
  const totalOptions = CONTROLLING_BOOL_RAW_KEY ? axis.options.length + 1 : axis.options.length;
  const offNote = CONTROLLING_BOOL_RAW_KEY ? ' (includes off state)' : '';
  if (t) t.characters = 'Sub-component: ' + MAIN_COMP_NAME + '. ' + totalOptions + ' options' + offNote + '. Default: ' + axis.defaultValue;
}

const assetPlaceholder = chapter.findOne(n => n.name === '#preview');
while (assetPlaceholder.children.length > 0) {
  assetPlaceholder.children[0].remove();
}
assetPlaceholder.layoutWrap = 'WRAP';
assetPlaceholder.counterAxisSpacing = assetPlaceholder.itemSpacing;

function findControllingBoolRawKey(inst) {
  for (const [rk, val] of Object.entries(inst.componentProperties)) {
    if (rk.split('#')[0] === CONTROLLING_BOOL_NAME) return rk;
  }
  return null;
}

function findNestedChild(parentInst, childLayerName) {
  const queue = [...parentInst.children];
  while (queue.length > 0) {
    const n = queue.shift();
    if (n.name === childLayerName) return n;
    if ('children' in n) queue.push(...n.children);
  }
  return null;
}

if (CONTROLLING_BOOL_RAW_KEY) {
  const wrapper = figma.createFrame();
  wrapper.name = 'No ' + CONTROLLING_BOOL_NAME;
  wrapper.layoutMode = 'VERTICAL';
  wrapper.primaryAxisAlignItems = 'CENTER';
  wrapper.counterAxisAlignItems = 'CENTER';
  wrapper.itemSpacing = 12;
  wrapper.fills = [];
  wrapper.primaryAxisSizingMode = 'AUTO';
  wrapper.counterAxisSizingMode = 'AUTO';
  assetPlaceholder.appendChild(wrapper);

  const inst = parentDefaultVariant.createInstance();
  await loadAllFonts(inst);
  wrapper.appendChild(inst);
  const boolRk = findControllingBoolRawKey(inst);
  if (boolRk) {
    inst.setProperties({ [boolRk]: false });
    await loadAllFonts(inst);
  }

  const label = figma.createText();
  label.fontName = LABEL_FONT;
  label.characters = 'No ' + CONTROLLING_BOOL_NAME + ' (default)';
  label.fontSize = 14;
  label.fills = [{ type: 'SOLID', color: { r: 0.29, g: 0.29, b: 0.29 } }];
  wrapper.appendChild(label);
}

for (const option of axis.options) {
  const wrapper = figma.createFrame();
  wrapper.name = option;
  wrapper.layoutMode = 'VERTICAL';
  wrapper.primaryAxisAlignItems = 'CENTER';
  wrapper.counterAxisAlignItems = 'CENTER';
  wrapper.itemSpacing = 12;
  wrapper.fills = [];
  wrapper.primaryAxisSizingMode = 'AUTO';
  wrapper.counterAxisSizingMode = 'AUTO';
  assetPlaceholder.appendChild(wrapper);

  const inst = parentDefaultVariant.createInstance();
  await loadAllFonts(inst);
  wrapper.appendChild(inst);

  if (CONTROLLING_BOOL_RAW_KEY) {
    const boolRk = findControllingBoolRawKey(inst);
    if (boolRk) {
      inst.setProperties({ [boolRk]: true });
      await loadAllFonts(inst);
    }
  }

  const nestedChild = findNestedChild(inst, CHILD_NAME);
  if (nestedChild && nestedChild.type === 'INSTANCE') {
    for (const [rk, val] of Object.entries(nestedChild.componentProperties)) {
      if (rk.split('#')[0] === axis.name) {
        nestedChild.setProperties({ [rk]: option });
        await loadAllFonts(inst);
        break;
      }
    }
  }

  const label = figma.createText();
  label.fontName = LABEL_FONT;
  label.characters = option === axis.defaultValue ? option + ' (default)' : option;
  label.fontSize = 14;
  label.fills = [{ type: 'SOLID', color: { r: 0.29, g: 0.29, b: 0.29 } }];
  wrapper.appendChild(label);
}

} catch (e) {
  chapter.remove();
  return { error: e.message, rolledBack: true };
}
}

return { success: true, childComponent: CHILD_NAME };
```

Replace `__COMP_SET_NODE_ID__` with the **parent** component's `compSetNodeId` (from Step 4 extraction), not the child's. Set `__CONTROLLING_BOOL_RAW_KEY_OR_NULL__` to the quoted raw key string if a controlling boolean was found (e.g., `'Trailing content#6051:1'`), or `null` if none.

##### 6e-ii: Child boolean properties (in parent context)

**Skip unified sub-booleans**: Before rendering each child boolean, check if its `name` appears in the `unifiedSubBooleanNames` set built in Step 4d-iii. If so, skip it — its chapter is produced by 6f as part of a unified slot chapter.

For each remaining child boolean property, run via `figma_execute`. Each preview is a parent instance with the controlling boolean enabled and the child's boolean toggled.

```javascript
const FRAME_ID = '__FRAME_ID__';
const COMP_SET_ID = '__COMP_SET_NODE_ID__';
const CHILD_NAME = '__CHILD_LAYER_NAME__';
const MAIN_COMP_NAME = '__MAIN_COMPONENT_NAME__';
const CONTROLLING_BOOL_NAME = '__CONTROLLING_BOOL_NAME__';
const CONTROLLING_BOOL_RAW_KEY = __CONTROLLING_BOOL_RAW_KEY_OR_NULL__;
const BOOLEAN_PROPS = __BOOLEAN_PROPS_JSON__;
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

const frame = await figma.getNodeByIdAsync(FRAME_ID);
const chapterTemplate = frame.findOne(n => n.name === '#anatomy-section');

const compNode = await figma.getNodeByIdAsync(COMP_SET_ID);
const parentDefaultVariant = compNode.type === 'COMPONENT_SET'
  ? (compNode.defaultVariant || compNode.children[0])
  : compNode;

const LABEL_FONT = await loadFontWithFallback(FONT_FAMILY, 'Medium');

function findControllingBoolRawKey(inst) {
  for (const [rk, val] of Object.entries(inst.componentProperties)) {
    if (rk.split('#')[0] === CONTROLLING_BOOL_NAME) return rk;
  }
  return null;
}

function findNestedChild(parentInst, childLayerName) {
  const queue = [...parentInst.children];
  while (queue.length > 0) {
    const n = queue.shift();
    if (n.name === childLayerName) return n;
    if ('children' in n) queue.push(...n.children);
  }
  return null;
}

for (const boolProp of BOOLEAN_PROPS) {

const chapter = chapterTemplate.clone();
chapterTemplate.parent.appendChild(chapter);
chapter.name = CHILD_NAME + ' – ' + boolProp.name;
chapter.visible = true;

try {

await loadAllFonts(chapter);

const sectionName = chapter.findOne(n => n.name === '#section-name');
if (sectionName) {
  const t = sectionName.findOne(n => n.type === 'TEXT');
  if (t) t.characters = CHILD_NAME + ' – ' + boolProp.name;
}

const sectionDesc = chapter.findOne(n => n.name === '#optional-section-description');
if (sectionDesc) {
  const t = sectionDesc.findOne(n => n.type === 'TEXT');
  const defaultStr = boolProp.defaultValue ? 'true' : 'false';
  if (t) t.characters = 'Sub-component: ' + MAIN_COMP_NAME + '. Boolean toggle. Default: ' + defaultStr;
}

const assetPlaceholder = chapter.findOne(n => n.name === '#preview');
while (assetPlaceholder.children.length > 0) {
  assetPlaceholder.children[0].remove();
}
assetPlaceholder.layoutWrap = 'WRAP';
assetPlaceholder.counterAxisSpacing = assetPlaceholder.itemSpacing;

for (const boolVal of [true, false]) {
  const wrapper = figma.createFrame();
  wrapper.name = boolProp.name + ' = ' + boolVal;
  wrapper.layoutMode = 'VERTICAL';
  wrapper.primaryAxisAlignItems = 'CENTER';
  wrapper.counterAxisAlignItems = 'CENTER';
  wrapper.itemSpacing = 12;
  wrapper.fills = [];
  wrapper.primaryAxisSizingMode = 'AUTO';
  wrapper.counterAxisSizingMode = 'AUTO';
  assetPlaceholder.appendChild(wrapper);

  const inst = parentDefaultVariant.createInstance();
  await loadAllFonts(inst);
  wrapper.appendChild(inst);

  if (CONTROLLING_BOOL_RAW_KEY) {
    const boolRk = findControllingBoolRawKey(inst);
    if (boolRk) {
      inst.setProperties({ [boolRk]: true });
      await loadAllFonts(inst);
    }
  }

  const nestedChild = findNestedChild(inst, CHILD_NAME);
  if (nestedChild && nestedChild.type === 'INSTANCE') {
    for (const [rk, val] of Object.entries(nestedChild.componentProperties)) {
      if (rk.split('#')[0] === boolProp.name) {
        nestedChild.setProperties({ [rk]: boolVal });
        await loadAllFonts(inst);
        break;
      }
    }
  }

  const label = figma.createText();
  label.fontName = LABEL_FONT;
  const isDefault = boolVal === boolProp.defaultValue;
  label.characters = String(boolVal) + (isDefault ? ' (default)' : '');
  label.fontSize = 14;
  label.fills = [{ type: 'SOLID', color: { r: 0.29, g: 0.29, b: 0.29 } }];
  wrapper.appendChild(label);
}

} catch (e) {
  chapter.remove();
  return { error: e.message, rolledBack: true };
}
}

return { success: true, childComponent: CHILD_NAME };
```

Replace `__COMP_SET_NODE_ID__` with the **parent** component's `compSetNodeId`, not the child's. Set `__CONTROLLING_BOOL_RAW_KEY_OR_NULL__` to the quoted raw key string or `null`.

##### 6e-iii: Blown-out child rendering (direct sub-component instances)

When blown-out rendering is selected (per the conditions in 6e), create instances directly from the child's component set rather than modifying nested instances in a parent. This approach is immune to sparse variant matrices and nested-instance property access issues.

For each child variant axis (non-coupled), run via `figma_execute`. Replace `__SUB_COMP_SET_ID__` with the child's `mainComponentSetId`:

```javascript
const FRAME_ID = '__FRAME_ID__';
const SUB_COMP_SET_ID = '__SUB_COMP_SET_ID__';
const CHAPTER_NAME = '__CHAPTER_NAME__';
const AXIS_NAME = '__AXIS_NAME__';
const OPTIONS = __OPTIONS_JSON__;
const DEFAULT_VALUE = '__DEFAULT_VALUE__';
const BASE_PROPS = __BASE_PROPS_JSON__;
const DESCRIPTION = '__DESCRIPTION__';
const FONT_FAMILY = '__FONT_FAMILY__';

// ... page-loading block (see MCP Adapter) ...

const frame = await figma.getNodeByIdAsync(FRAME_ID);
const subCompSet = await figma.getNodeByIdAsync(SUB_COMP_SET_ID);

function findVariant(compSet, targetProps) {
  let best = null;
  let bestScore = -1;
  for (const child of compSet.children) {
    const vp = child.variantProperties || {};
    let score = 0;
    let exact = true;
    for (const [k, v] of Object.entries(targetProps)) {
      if (vp[k] === v) score++;
      else exact = false;
    }
    if (exact) return child;
    if (score > bestScore) { bestScore = score; best = child; }
  }
  return best;
}

// ... clone #anatomy-section, set section name/description, clear #preview (same pattern as 6a) ...

for (const option of OPTIONS) {
  const targetProps = { ...BASE_PROPS };
  targetProps[AXIS_NAME] = option;

  const variant = findVariant(subCompSet, targetProps);
  // ... create wrapper, create instance from variant, add label (same pattern as 6a) ...
}
```

`BASE_PROPS` should contain the default values for all OTHER variant axes of the sub-component (e.g., `{ layout: 'icon+label', size: 'medium', variant: 'primary', isDisabled: 'false', isSelected: 'true' }`). When a `constrainedBy` note exists from 3e (e.g., `isDisabled` requires `isSelected=true`), incorporate that constraint into `BASE_PROPS`.

For child **boolean** properties in blown-out mode, create an instance from the sub-component's default variant and call `inst.setProperties({ [rawKey]: boolValue })` directly on the instance (not nested). Boolean `setProperties` on a direct instance is reliable since it doesn't change the variant combination.

For **sibling boolean** combinatorial chapters in blown-out mode, follow the same pattern: create a direct instance and call `setProperties()` with the boolean raw keys for each combination.

##### 6f: Unified slot chapters (combinatorial previews)

If `unifiedSlotChapters` from Step 4d-iii is not empty, render one chapter per entry. Each chapter shows the meaningful combinations of the container boolean + its sub-booleans as a single visual exhibit.

**Blown-out adaptation**: If the child referenced by a unified slot chapter has `blownOut: true`, replace the in-context rendering pattern (parent instance + `findNestedChild` + `setProperties` on nested instance) with the blown-out pattern from 6e-iii: create instances directly from the child's `mainComponentSetId` and call `setProperties()` for the boolean combinations on the direct instance. The container boolean on/off toggle is still meaningful — for the "None" state, simply omit the instance (or show a placeholder text "Hidden").

For each unified slot chapter, run via `figma_execute`:

```javascript
const FRAME_ID = '__FRAME_ID__';
const COMP_SET_ID = '__COMP_SET_NODE_ID__';
const CHILD_NAME = '__CHILD_LAYER_NAME__';
const CHAPTER_NAME = '__CHAPTER_NAME__';
const CONTAINER_BOOL_NAME = '__CONTAINER_BOOL_NAME__';
const DEFAULT_LABEL = '__DEFAULT_LABEL__';
const PREVIEW_COMBINATIONS = __PREVIEW_COMBINATIONS_JSON__;
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

const frame = await figma.getNodeByIdAsync(FRAME_ID);
const chapterTemplate = frame.findOne(n => n.name === '#anatomy-section');

const compNode = await figma.getNodeByIdAsync(COMP_SET_ID);
const parentDefaultVariant = compNode.type === 'COMPONENT_SET'
  ? (compNode.defaultVariant || compNode.children[0])
  : compNode;

const chapter = chapterTemplate.clone();
chapterTemplate.parent.appendChild(chapter);
chapter.name = CHAPTER_NAME;
chapter.visible = true;

try {

await loadAllFonts(chapter);

const sectionName = chapter.findOne(n => n.name === '#section-name');
if (sectionName) {
  const t = sectionName.findOne(n => n.type === 'TEXT');
  if (t) t.characters = CHAPTER_NAME;
}

const sectionDesc = chapter.findOne(n => n.name === '#optional-section-description');
if (sectionDesc) {
  const t = sectionDesc.findOne(n => n.type === 'TEXT');
  if (t) t.characters = PREVIEW_COMBINATIONS.length + ' combinations. Default: ' + DEFAULT_LABEL;
}

const assetPlaceholder = chapter.findOne(n => n.name === '#preview');
while (assetPlaceholder.children.length > 0) {
  assetPlaceholder.children[0].remove();
}
assetPlaceholder.layoutWrap = 'WRAP';
assetPlaceholder.counterAxisSpacing = assetPlaceholder.itemSpacing;

function findControllingBoolRawKey(inst) {
  for (const [rk, val] of Object.entries(inst.componentProperties)) {
    if (rk.split('#')[0] === CONTAINER_BOOL_NAME) return rk;
  }
  return null;
}

function findNestedChild(parentInst, childLayerName) {
  const queue = [...parentInst.children];
  while (queue.length > 0) {
    const n = queue.shift();
    if (n.name === childLayerName) return n;
    if ('children' in n) queue.push(...n.children);
  }
  return null;
}

const LABEL_FONT = await loadFontWithFallback(FONT_FAMILY, 'Medium');

for (const combo of PREVIEW_COMBINATIONS) {
  const wrapper = figma.createFrame();
  wrapper.name = combo.label;
  wrapper.layoutMode = 'VERTICAL';
  wrapper.primaryAxisAlignItems = 'CENTER';
  wrapper.counterAxisAlignItems = 'CENTER';
  wrapper.itemSpacing = 12;
  wrapper.fills = [];
  wrapper.primaryAxisSizingMode = 'AUTO';
  wrapper.counterAxisSizingMode = 'AUTO';
  assetPlaceholder.appendChild(wrapper);

  const inst = parentDefaultVariant.createInstance();
  await loadAllFonts(inst);
  wrapper.appendChild(inst);

  const boolRk = findControllingBoolRawKey(inst);
  if (boolRk) {
    inst.setProperties({ [boolRk]: combo.containerOn });
    await loadAllFonts(inst);
  }

  if (combo.containerOn) {
    const nestedChild = findNestedChild(inst, CHILD_NAME);
    if (nestedChild && nestedChild.type === 'INSTANCE') {
      for (const [subName, subVal] of Object.entries(combo.subValues)) {
        for (const [rk, val] of Object.entries(nestedChild.componentProperties)) {
          if (rk.split('#')[0] === subName) {
            nestedChild.setProperties({ [rk]: subVal });
            break;
          }
        }
      }
      await loadAllFonts(inst);
    }
  }

  const label = figma.createText();
  label.fontName = LABEL_FONT;
  const isDefault = combo.label === DEFAULT_LABEL;
  label.characters = combo.label + (isDefault ? ' (default)' : '');
  label.fontSize = 14;
  label.fills = [{ type: 'SOLID', color: { r: 0.29, g: 0.29, b: 0.29 } }];
  wrapper.appendChild(label);
}

return { success: true, chapter: CHAPTER_NAME };

} catch (e) {
  chapter.remove();
  return { error: e.message, rolledBack: true };
}
```

Replace `__COMP_SET_NODE_ID__` with the **parent** component's `compSetNodeId`. Replace `__CHAPTER_NAME__` with the `chapterName` from the unified slot chapter entry (e.g., "Input -- Leading content"). Replace `__CHILD_LAYER_NAME__` with the child's layer `name` from the `childComponents` entry. Replace `__PREVIEW_COMBINATIONS_JSON__` with the `previewCombinations` array from the unified slot chapter entry.

##### 6g: Sibling boolean combinatorial chapters

If `siblingBoolChapters` from Step 4d-iv is not empty, render one chapter per entry. Each chapter shows the meaningful combinations of sibling booleans on the same child component as a single visual exhibit.

**Blown-out adaptation**: If the child has `blownOut: true`, use the blown-out pattern from 6e-iii: create instances directly from the child's `mainComponentSetId` and call `setProperties()` with the boolean combinations on the direct instance (no parent wrapper, no `findNestedChild`).

For each sibling boolean chapter, run via `figma_execute`:

```javascript
const FRAME_ID = '__FRAME_ID__';
const COMP_SET_ID = '__COMP_SET_NODE_ID__';
const CHILD_NAME = '__CHILD_LAYER_NAME__';
const CHAPTER_NAME = '__CHAPTER_NAME__';
const DEFAULT_LABEL = '__DEFAULT_LABEL__';
const PREVIEW_COMBINATIONS = __PREVIEW_COMBINATIONS_JSON__;
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

const frame = await figma.getNodeByIdAsync(FRAME_ID);
const chapterTemplate = frame.findOne(n => n.name === '#anatomy-section');

const compNode = await figma.getNodeByIdAsync(COMP_SET_ID);
const parentDefaultVariant = compNode.type === 'COMPONENT_SET'
  ? (compNode.defaultVariant || compNode.children[0])
  : compNode;

const chapter = chapterTemplate.clone();
chapterTemplate.parent.appendChild(chapter);
chapter.name = CHAPTER_NAME;
chapter.visible = true;

try {

await loadAllFonts(chapter);

const sectionName = chapter.findOne(n => n.name === '#section-name');
if (sectionName) {
  const t = sectionName.findOne(n => n.type === 'TEXT');
  if (t) t.characters = CHAPTER_NAME;
}

const sectionDesc = chapter.findOne(n => n.name === '#optional-section-description');
if (sectionDesc) {
  const t = sectionDesc.findOne(n => n.type === 'TEXT');
  if (t) t.characters = PREVIEW_COMBINATIONS.length + ' combinations. Default: ' + DEFAULT_LABEL;
}

const assetPlaceholder = chapter.findOne(n => n.name === '#preview');
while (assetPlaceholder.children.length > 0) {
  assetPlaceholder.children[0].remove();
}
assetPlaceholder.layoutWrap = 'WRAP';
assetPlaceholder.counterAxisSpacing = assetPlaceholder.itemSpacing;

function findNestedChild(parentInst, childLayerName) {
  const queue = [...parentInst.children];
  while (queue.length > 0) {
    const n = queue.shift();
    if (n.name === childLayerName) return n;
    if ('children' in n) queue.push(...n.children);
  }
  return null;
}

const LABEL_FONT = await loadFontWithFallback(FONT_FAMILY, 'Medium');

for (const combo of PREVIEW_COMBINATIONS) {
  const wrapper = figma.createFrame();
  wrapper.name = combo.label;
  wrapper.layoutMode = 'VERTICAL';
  wrapper.primaryAxisAlignItems = 'CENTER';
  wrapper.counterAxisAlignItems = 'CENTER';
  wrapper.itemSpacing = 12;
  wrapper.fills = [];
  wrapper.primaryAxisSizingMode = 'AUTO';
  wrapper.counterAxisSizingMode = 'AUTO';
  assetPlaceholder.appendChild(wrapper);

  const inst = parentDefaultVariant.createInstance();
  await loadAllFonts(inst);
  wrapper.appendChild(inst);

  const nestedChild = findNestedChild(inst, CHILD_NAME);
  if (nestedChild && nestedChild.type === 'INSTANCE') {
    for (const [subName, subVal] of Object.entries(combo.subValues)) {
      for (const [rk, val] of Object.entries(nestedChild.componentProperties)) {
        if (rk.split('#')[0] === subName) {
          nestedChild.setProperties({ [rk]: subVal });
          break;
        }
      }
    }
    await loadAllFonts(inst);
  }

  const label = figma.createText();
  label.fontName = LABEL_FONT;
  const isDefault = combo.label === DEFAULT_LABEL;
  label.characters = combo.label + (isDefault ? ' (default)' : '');
  label.fontSize = 14;
  label.fills = [{ type: 'SOLID', color: { r: 0.29, g: 0.29, b: 0.29 } }];
  wrapper.appendChild(label);
}

return { success: true, chapter: CHAPTER_NAME };

} catch (e) {
  chapter.remove();
  return { error: e.message, rolledBack: true };
}
```

Replace `__COMP_SET_NODE_ID__` with the **parent** component's `compSetNodeId`. Replace `__CHAPTER_NAME__` with the `chapterName` from the sibling boolean chapter entry (e.g., "Label"). Replace `__CHILD_LAYER_NAME__` with the child's layer `name`. Replace `__PREVIEW_COMBINATIONS_JSON__` with the `previewCombinations` array. Replace `__DEFAULT_LABEL__` with the `defaultLabel` value.

#### 6d: Clean up

After all properties are rendered (including child component chapters), hide the original `#anatomy-section`:

```javascript
const frame = await figma.getNodeByIdAsync('__FRAME_ID__');
const chapterTemplate = frame.findOne(n => n.name === '#anatomy-section');
if (chapterTemplate) chapterTemplate.visible = false;
return { success: true };
```

### Step 10: Visual Validation

1. `figma_take_screenshot` with the `frameId` — Capture the completed annotation
2. Verify:
   - Each variant axis has a section with instance previews for every option
   - Each boolean has a section showing on/off states (excluding controlling booleans merged into child chapters, and sibling booleans collapsed into combinatorial chapters)
   - Each variable mode property has a section with visual instance previews per mode
   - Each child component chapter shows the child property varied — either as in-context parent instances or as blown-out sub-component instances (see 6e for mode selection criteria). Verify the chosen mode matches the conditions.
   - Child chapters with a controlling boolean include an "off" state labeled "No {booleanName}" as the first preview (in-context mode only)
   - Labels indicate defaults
   - Component instances render correctly
   - Child component chapter titles use the `controllingBooleanName` (e.g., "Trailing content") rather than the raw layer name (e.g., "trailingContent v2") when a controlling boolean exists. If a title shows an internal layer name (camelCase, version suffixes like "v2"), rename the chapter and its `#section-name` text to use the controlling boolean name instead.
   - All preview items fit within the preview area without being clipped. Wrapping is always enabled, but if items are still too wide for a single row even individually, reduce `itemSpacing` or check that instances are not unexpectedly large.
   - When `contextAxis` is non-null: each illustrated chapter shows grouped rows per context value, with row labels. Row labels use the context value name, with "(default)" appended to the default value. The context axis itself has NO standalone chapter.
3. If issues are found, fix via `figma_execute` and re-capture (up to 3 iterations)

### Step 11: Completion Link

Print a clickable Figma URL to the completed spec in chat. Construct the URL from the `fileKey` (extracted from the user's input URL) and the `frameId` (returned by Step 7), replacing `:` with `-` in the node ID:

```
Property spec complete: https://www.figma.com/design/{fileKey}/?node-id={frameId}
```

## Notes

- See the instruction file ([agent-property-instruction.md](../../property/agent-property-instruction.md)) for implementation notes, normalization reference, rendering mode selection guidance, common mistakes, and do-not rules.
