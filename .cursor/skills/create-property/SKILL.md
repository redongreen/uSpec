---
name: create-property
description: Generate a visual property annotation in Figma showing each configurable property axis with component instance previews. Use when the user mentions "property", "properties", "property annotation", "create property", or wants to document a component's configurable properties visually.
---

# Create Property Annotation

Generate a visual property annotation directly in Figma — one exhibit per variant axis and boolean toggle, each showing the available options as component instances with a summary table.

## Inputs Expected

- **Figma link to the component**: URL to a component set or standalone component in Figma (required)
- **Figma link to the destination** (optional): URL to the page/frame where the annotation should be placed. If omitted, places it in the same file as the component.

## Workflow

Copy this checklist and update as you progress:

```
Task Progress:
- [ ] Step 1: Verify MCP connection
- [ ] Step 2: Read template key from uspecs.config.json
- [ ] Step 3: Navigate to the component and extract property data
- [ ] Step 3a: Detect variant-gated booleans (deterministic + interpretation)
- [ ] Step 3b: Detect variable mode properties (shape, density) — AI search
- [ ] Step 3c: Discover local child component properties + boolean linkage (deterministic)
- [ ] Step 3d: Normalize child properties (deterministic script)
- [ ] Step 3e: AI validation layer — cross-check extraction output before rendering
- [ ] Step 4: Navigate to destination (if different file)
- [ ] Step 5: Import and detach the Property template
- [ ] Step 6: Fill header fields
- [ ] Step 7: Build property exhibits with component instances
- [ ] Step 8: Visual validation (limited role — confirms rendering, not primary safety net)
```

### Step 1: Verify MCP Connection

Check that Figma Console MCP is connected:
- `figma_get_status` — Confirm Desktop Bridge plugin is active

If connection fails, guide user:
> Please open Figma Desktop and run the Desktop Bridge plugin. Then try again.

### Step 2: Read Template Key

Read the file `uspecs.config.json` and extract:
- The `propertyOverview` value from the `templateKeys` object → save as `PROPERTY_TEMPLATE_KEY`
- The `fontFamily` value → save as `FONT_FAMILY` (default to `Inter` if not set)

If the template key is empty, tell the user:
> The property template key is not configured. Run `@firstrun` with your Figma template library link first.

### Step 3: Extract Property Data

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
    const defaultVariant = isComponentSet ? (node.defaultVariant || node.children[0]) : node;
    const props = defaultVariant.componentProperties;
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (k.split('#')[0] === cleanKey && v.type === 'BOOLEAN') {
          const nodeId = k.split('#')[1];
          if (nodeId) {
            try {
              const layerNode = await figma.getNodeByIdAsync(defaultVariant.id.split(';')[0] + ';' + nodeId);
              if (layerNode) associatedLayer = layerNode.name;
            } catch {}
          }
        }
      }
    }
    booleanProps.push({
      name: cleanKey,
      defaultValue: def.defaultValue,
      associatedLayer,
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

const defaultVariant = isComponentSet ? (node.defaultVariant || node.children[0]) : node;
const defaultProps = { ...(defaultVariant.variantProperties || {}) };

return {
  componentName: node.name,
  compSetNodeId: TARGET_NODE_ID,
  isComponentSet,
  variantAxes,
  booleanProps,
  instanceSwapProps,
  defaultProps,
  defaultVariantName: defaultVariant.name
};
```

Save the returned JSON — you will use it in subsequent steps.

### Step 3a: Detect Variant-Gated Booleans

Some boolean properties only have a visual effect under specific variant axis values. For example, a "Dismiss button" boolean may only control a layer that exists in the `Behavior=Interactive` variant, not in `Behavior=Static`. When the default variant lacks the target layer, toggling the boolean produces identical-looking previews.

After extracting properties in Step 3, run this script to resolve each boolean's target layer across all variant axis values. Replace `TARGET_NODE_ID` with the actual node ID:

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
- **`requiredVariantOverrides` is an object** — The boolean is **variant-gated**. Store the `requiredVariantOverrides` on the boolean entry from Step 3's `booleanProps`. In 6b, use these overrides when looking up the base variant for instance creation. The description should note the dependency (e.g., "Requires Behavior = Interactive").

No AI reasoning is needed — the script has already resolved which booleans are variant-gated and what overrides they require.

### Step 3b: Detect Variable Mode Properties

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

### Step 3c: Discover Local Child Component Properties

Some components contain nested child instances (e.g., a Button inside a Section Heading) that have their own configurable properties. These are not captured by the parent's `componentPropertyDefinitions`. This step walks the default variant's children recursively to find local child components and extract their properties.

Run this script via `figma_execute`, replacing `TARGET_NODE_ID` with the actual node ID. **Pass the parent's `booleanProps` array** (from Step 3) as `PARENT_BOOLEANS` so the script can resolve controlling boolean linkage deterministically:

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

Replace `__PARENT_BOOLEANS_JSON__` with the `booleanProps` array from Step 3 (e.g., `[{"name":"Trailing content","defaultValue":false,"rawKey":"Trailing content#6051:1","associatedLayer":"trailingContent v2"}]`).

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

### Step 3d: Normalize Child Properties (Deterministic Script)

This is a deterministic data-processing step — no Figma calls needed. Run the following script via `figma_execute`, passing in the extracted data from Steps 3, 3c. It performs all four sub-analyses (coupled axes, container-gated booleans, unified slots, sibling booleans) and returns the full normalization plan.

Replace `__PARENT_VARIANT_AXES_JSON__` with the `variantAxes` array from Step 3, `__CHILD_COMPONENTS_JSON__` with the `childComponents` array from Step 3c, and `__CONTROLLING_BOOLEAN_NAMES_JSON__` with the `controllingBooleanNames` array from Step 3c:

```javascript
const PARENT_AXES = __PARENT_VARIANT_AXES_JSON__;
const CHILDREN = __CHILD_COMPONENTS_JSON__;
const CONTROLLING_BOOL_NAMES = __CONTROLLING_BOOLEAN_NAMES_JSON__;

// --- 3d-i: Detect coupled axes ---
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

// --- 3d-ii/iii: Container-gated booleans + unified slot chapters ---
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

// --- 3d-iv: Sibling boolean collapsing ---
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

- **`childComponents`** — Updated with `coupled: true` flags on child variant axes that mirror parent axes (3d-i). In Step 7 (6e-i), skip axes where `coupled === true`.
- **`unifiedSlotChapters`** — Array of chapter entries for container + sub-boolean combinations (3d-ii/iii). Each entry has `chapterName`, `childName`, `containerBoolName`, `containerBoolRawKey`, `subBooleans`, `previewCombinations`, and `defaultLabel`. Rendered in 6f.
- **`unifiedSubBooleanNames`** — Array of sub-boolean names consumed by unified slot chapters. These are skipped in 6e-ii.
- **`siblingBoolChapters`** — Array of chapter entries for sibling boolean combinations (3d-iv). Each entry has `chapterName`, `childName`, `booleans`, `previewCombinations`, and `defaultLabel`. Rendered in 6g.
- **`siblingBoolNames`** — Array of boolean names consumed by sibling boolean chapters. These are skipped in 6e-ii.

**Label generation rules** (handled by the script):
- Sub-boolean short names are derived by stripping the common prefix shared with the container name, plus common verbs ("Show", "Has", "With", "Enable", "Toggle", "Display")
- `"None"` = container off (unified) or all booleans off (sibling)
- Multi-on combos are joined with " + "
- Default label is computed from actual boolean default values

**Combination cap** (handled by the script): Power sets with more than 5-6 entries are capped to the most meaningful combinations (individually-on states, plus the all-on state).

**Graceful fallback**: If a child has only 1 remaining boolean after filtering (not consumed by unified slots), it is NOT added to `siblingBoolChapters` — it stays as a standard boolean chapter rendered in 6e-ii.

### Step 3e: AI Validation Layer

After all deterministic extraction is complete (Steps 3, 3a, 3b, 3c, 3d), perform an AI validation pass over the full dataset **before rendering**. This is the designated Tier 2 reasoning step — it catches issues that deterministic scripts cannot detect. Do NOT rely on visual inspection (Step 8) as the primary safety net.

Review the following and make corrections to the data structures before proceeding to Step 4:

#### Cross-check boolean linkage

For each child component where `controllingBooleanName` is `null` and `visible === false`, check whether any parent boolean name is semantically related to the child's layer name. The deterministic script in 3c uses exact name matching and normalized substring containment, but some designs use unrelated naming conventions (e.g., boolean "Show actions" controlling a child named "toolbar"). If a semantic match is apparent, manually set `controllingBooleanName` and `controllingBooleanRawKey` on the child entry and add the boolean name to `controllingBooleanNames`.

Conversely, if a deterministic match looks wrong (e.g., "Icon" boolean matched to "Icon button" child when "Icon" controls a different element), override it by setting `controllingBooleanName` back to `null`.

#### Validate variable mode relevance

Review the `variableModeProps` from Step 3b. For each collection:

- Confirm it applies to this component specifically, not a different component or a global theme. A "Density" collection that only has bindings to unrelated components should be excluded.
- Confirm the mode names represent meaningful property options (e.g., "Compact", "Default", "Spacious"), not color themes or breakpoints.
- Remove any entries that are not relevant to this component's configurable properties.

#### Catch structural anomalies

Scan for potential issues in the extraction output:

- A child component with 0 renderable properties after normalization (all variant axes coupled, all booleans consumed by unified/sibling chapters) — verify this is genuinely empty rather than a script oversight. If properties were incorrectly consumed, adjust the skip lists.
- A `unifiedSlotChapter` where all sub-booleans default to `true` but the container defaults to `false` — the default label should be "None", not a combination label. Verify the `defaultLabel` is correct.
- Child components whose `mainComponentName` suggests they are utility/internal components (e.g., "Spacer", "Divider") rather than meaningful sub-components — consider whether they should be exhibited at all.

#### Sanity-check combination counts

For each `unifiedSlotChapter` and `siblingBoolChapter`, verify the number of `previewCombinations` is reasonable:

- If a chapter has more than 8 combinations, reduce to the most meaningful subset (all off, each individually on, all on)
- If a chapter has only 2 combinations (just "None" and one other), consider whether it should remain as a unified chapter or be rendered as a simple boolean toggle instead
- If combination labels are unclear or redundant, rewrite them for clarity

After validation, proceed with the corrected data to rendering.

### Step 4: Navigate to Destination

If the user provided a separate destination file URL:
- `figma_navigate` — Switch to the destination file

If no destination was provided, stay in the current file.

### Step 5: Import and Detach Template

Run via `figma_execute` (replace `__PROPERTY_TEMPLATE_KEY__` with the key from Step 2):

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

Replace `__COMPONENT_NAME__` with the extracted `componentName`.

Save the returned `frameId`.

### Step 6: Fill Header Fields

Run via `figma_execute` (replace `__FRAME_ID__`, `__COMPONENT_NAME__`):

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

const compNameFrame = frame.findOne(n => n.name === '#comp-name-anatomy');
if (compNameFrame) {
  const t = compNameFrame.findOne(n => n.type === 'TEXT');
  if (t) t.characters = '__COMPONENT_NAME__';
}

const descFrame = frame.findOne(n => n.name === '#brief-component-description');
if (descFrame) {
  const t = descFrame.findOne(n => n.type === 'TEXT');
  if (t) t.characters = 'Configurable properties of the __COMPONENT_NAME__ component';
}

const markerExample = frame.findOne(n => n.name === '#marker-example');
if (markerExample) markerExample.visible = false;

return { success: true };
```

### Step 7: Build Property Exhibits

This is the main rendering step. For each property (variant axes first, then booleans, then variable mode properties), create a chapter section with visual exhibits.

Run **one `figma_execute` call per property** to avoid timeouts. The scripts below are templates — fill in the extracted data.

#### 6a: For each VARIANT axis

For each variant axis from the extraction, run via `figma_execute`:

```javascript
const FRAME_ID = '__FRAME_ID__';
const COMP_SET_ID = '__COMP_SET_NODE_ID__';
const PROPERTY_NAME = '__PROPERTY_NAME__';
const OPTIONS = __OPTIONS_JSON__;
const DEFAULT_VALUE = '__DEFAULT_VALUE__';
const DEFAULT_PROPS = __DEFAULT_PROPS_JSON__;

const frame = await figma.getNodeByIdAsync(FRAME_ID);
const chapterTemplate = frame.findOne(n => n.name === '#anatomy-section');

const chapter = chapterTemplate.clone();
chapterTemplate.parent.appendChild(chapter);
chapter.name = PROPERTY_NAME;
chapter.visible = true;

try {

const textNodes = chapter.findAll(n => n.type === 'TEXT');
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
    wrapper.appendChild(inst);
  } else {
    const placeholder = figma.createText();
    await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
    placeholder.characters = 'Variant unavailable';
    placeholder.fontSize = 12;
    placeholder.fills = [{ type: 'SOLID', color: { r: 0.6, g: 0.6, b: 0.6 } }];
    wrapper.appendChild(placeholder);
  }

  await figma.loadFontAsync({ family: FONT_FAMILY, style: 'Medium' });
  const label = figma.createText();
  label.fontName = { family: FONT_FAMILY, style: 'Medium' };
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

#### 6b: For each BOOLEAN property

**Skip controlling booleans**: Before rendering each parent boolean, check if its `name` appears in the `controllingBooleanNames` set built in Step 3c. If so, skip it — its chapter is produced by 6e as part of the unified child component chapter.

**Handle variant-gated booleans**: Before rendering, check if the boolean has `requiredVariantOverrides` (from Step 3a). If so, the base variant for instance creation must match those overrides instead of using the default variant. Replace `VARIANT_OVERRIDES` with the required overrides object (e.g., `{"Behavior": "Interactive"}`), or `null` if the boolean is not variant-gated.

For each remaining boolean property, run via `figma_execute`:

```javascript
const FRAME_ID = '__FRAME_ID__';
const COMP_SET_ID = '__COMP_SET_NODE_ID__';
const PROPERTY_NAME = '__PROPERTY_NAME__';
const DEFAULT_VALUE = __DEFAULT_BOOL_VALUE__;
const ASSOCIATED_LAYER = '__ASSOCIATED_LAYER__';
const VARIANT_OVERRIDES = __VARIANT_OVERRIDES_OR_NULL__;

const frame = await figma.getNodeByIdAsync(FRAME_ID);
const chapterTemplate = frame.findOne(n => n.name === '#anatomy-section');

const chapter = chapterTemplate.clone();
chapterTemplate.parent.appendChild(chapter);
chapter.name = PROPERTY_NAME;
chapter.visible = true;

try {

const textNodes = chapter.findAll(n => n.type === 'TEXT');
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

const sectionName = chapter.findOne(n => n.name === '#section-name');
if (sectionName) {
  const t = sectionName.findOne(n => n.type === 'TEXT');
  if (t) t.characters = PROPERTY_NAME;
}

const sectionDesc = chapter.findOne(n => n.name === '#optional-section-description');
if (sectionDesc) {
  const t = sectionDesc.findOne(n => n.type === 'TEXT');
  const defaultStr = DEFAULT_VALUE ? 'true' : 'false';
  const layerStr = ASSOCIATED_LAYER ? '. Controls layer: ' + ASSOCIATED_LAYER : '';
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

await figma.loadFontAsync({ family: FONT_FAMILY, style: 'Medium' });

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
  wrapper.appendChild(inst);

  for (const [rawKey, val] of Object.entries(inst.componentProperties)) {
    const cleanKey = rawKey.split('#')[0];
    if (cleanKey === PROPERTY_NAME) {
      inst.setProperties({ [rawKey]: boolVal });
      break;
    }
  }

  const label = figma.createText();
  label.fontName = { family: FONT_FAMILY, style: 'Medium' };
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

const textNodes = chapter.findAll(n => n.type === 'TEXT');
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

await figma.loadFontAsync({ family: FONT_FAMILY, style: 'Medium' });

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
  label.fontName = { family: FONT_FAMILY, style: 'Medium' };
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

#### 6e: For each CHILD COMPONENT (in-context rendering)

If `childComponents` from Step 3c is not empty, render chapters for each child component. All previews are created as **parent component instances** with the child's property varied on the nested instance — never as isolated child instances.

**Important**: Run **one `figma_execute` call per child component** (covering its variant axes chapter). If the child also has boolean properties, run a second call for the boolean chapters. This prevents timeouts.

##### 6e-i: Child variant axes (with optional off state)

**Skip coupled axes**: Before rendering each child variant axis, check if the axis has `coupled === true` (set in Step 3d-i). If so, skip it entirely — it mirrors the parent axis and adds no information.

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

const frame = await figma.getNodeByIdAsync(FRAME_ID);
const chapterTemplate = frame.findOne(n => n.name === '#anatomy-section');

const compNode = await figma.getNodeByIdAsync(COMP_SET_ID);
const parentDefaultVariant = compNode.type === 'COMPONENT_SET'
  ? (compNode.defaultVariant || compNode.children[0])
  : compNode;

await figma.loadFontAsync({ family: FONT_FAMILY, style: 'Medium' });

for (const axis of VARIANT_AXES) {

const chapter = chapterTemplate.clone();
chapterTemplate.parent.appendChild(chapter);
chapter.name = CHILD_NAME + ' – ' + axis.name;
chapter.visible = true;

try {

const textNodes = chapter.findAll(n => n.type === 'TEXT');
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
  wrapper.appendChild(inst);
  const boolRk = findControllingBoolRawKey(inst);
  if (boolRk) inst.setProperties({ [boolRk]: false });

  const label = figma.createText();
  label.fontName = { family: FONT_FAMILY, style: 'Medium' };
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
  wrapper.appendChild(inst);

  if (CONTROLLING_BOOL_RAW_KEY) {
    const boolRk = findControllingBoolRawKey(inst);
    if (boolRk) inst.setProperties({ [boolRk]: true });
  }

  const nestedChild = findNestedChild(inst, CHILD_NAME);
  if (nestedChild && nestedChild.type === 'INSTANCE') {
    for (const [rk, val] of Object.entries(nestedChild.componentProperties)) {
      if (rk.split('#')[0] === axis.name) {
        nestedChild.setProperties({ [rk]: option });
        break;
      }
    }
  }

  const label = figma.createText();
  label.fontName = { family: FONT_FAMILY, style: 'Medium' };
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

Replace `__COMP_SET_NODE_ID__` with the **parent** component's `compSetNodeId` (from Step 3 extraction), not the child's. Set `__CONTROLLING_BOOL_RAW_KEY_OR_NULL__` to the quoted raw key string if a controlling boolean was found (e.g., `'Trailing content#6051:1'`), or `null` if none.

##### 6e-ii: Child boolean properties (in parent context)

**Skip unified sub-booleans**: Before rendering each child boolean, check if its `name` appears in the `unifiedSubBooleanNames` set built in Step 3d-iii. If so, skip it — its chapter is produced by 6f as part of a unified slot chapter.

For each remaining child boolean property, run via `figma_execute`. Each preview is a parent instance with the controlling boolean enabled and the child's boolean toggled.

```javascript
const FRAME_ID = '__FRAME_ID__';
const COMP_SET_ID = '__COMP_SET_NODE_ID__';
const CHILD_NAME = '__CHILD_LAYER_NAME__';
const MAIN_COMP_NAME = '__MAIN_COMPONENT_NAME__';
const CONTROLLING_BOOL_NAME = '__CONTROLLING_BOOL_NAME__';
const CONTROLLING_BOOL_RAW_KEY = __CONTROLLING_BOOL_RAW_KEY_OR_NULL__;
const BOOLEAN_PROPS = __BOOLEAN_PROPS_JSON__;

const frame = await figma.getNodeByIdAsync(FRAME_ID);
const chapterTemplate = frame.findOne(n => n.name === '#anatomy-section');

const compNode = await figma.getNodeByIdAsync(COMP_SET_ID);
const parentDefaultVariant = compNode.type === 'COMPONENT_SET'
  ? (compNode.defaultVariant || compNode.children[0])
  : compNode;

await figma.loadFontAsync({ family: FONT_FAMILY, style: 'Medium' });

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

const textNodes = chapter.findAll(n => n.type === 'TEXT');
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
  wrapper.appendChild(inst);

  if (CONTROLLING_BOOL_RAW_KEY) {
    const boolRk = findControllingBoolRawKey(inst);
    if (boolRk) inst.setProperties({ [boolRk]: true });
  }

  const nestedChild = findNestedChild(inst, CHILD_NAME);
  if (nestedChild && nestedChild.type === 'INSTANCE') {
    for (const [rk, val] of Object.entries(nestedChild.componentProperties)) {
      if (rk.split('#')[0] === boolProp.name) {
        nestedChild.setProperties({ [rk]: boolVal });
        break;
      }
    }
  }

  const label = figma.createText();
  label.fontName = { family: FONT_FAMILY, style: 'Medium' };
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

##### 6f: Unified slot chapters (combinatorial previews)

If `unifiedSlotChapters` from Step 3d-iii is not empty, render one chapter per entry. Each chapter shows the meaningful combinations of the container boolean + its sub-booleans as a single visual exhibit.

For each unified slot chapter, run via `figma_execute`:

```javascript
const FRAME_ID = '__FRAME_ID__';
const COMP_SET_ID = '__COMP_SET_NODE_ID__';
const CHILD_NAME = '__CHILD_LAYER_NAME__';
const CHAPTER_NAME = '__CHAPTER_NAME__';
const CONTAINER_BOOL_NAME = '__CONTAINER_BOOL_NAME__';
const DEFAULT_LABEL = '__DEFAULT_LABEL__';
const PREVIEW_COMBINATIONS = __PREVIEW_COMBINATIONS_JSON__;

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

const textNodes = chapter.findAll(n => n.type === 'TEXT');
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

await figma.loadFontAsync({ family: FONT_FAMILY, style: 'Medium' });

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
  wrapper.appendChild(inst);

  const boolRk = findControllingBoolRawKey(inst);
  if (boolRk) inst.setProperties({ [boolRk]: combo.containerOn });

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
    }
  }

  const label = figma.createText();
  label.fontName = { family: FONT_FAMILY, style: 'Medium' };
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

If `siblingBoolChapters` from Step 3d-iv is not empty, render one chapter per entry. Each chapter shows the meaningful combinations of sibling booleans on the same child component as a single visual exhibit.

For each sibling boolean chapter, run via `figma_execute`:

```javascript
const FRAME_ID = '__FRAME_ID__';
const COMP_SET_ID = '__COMP_SET_NODE_ID__';
const CHILD_NAME = '__CHILD_LAYER_NAME__';
const CHAPTER_NAME = '__CHAPTER_NAME__';
const DEFAULT_LABEL = '__DEFAULT_LABEL__';
const PREVIEW_COMBINATIONS = __PREVIEW_COMBINATIONS_JSON__;

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

const textNodes = chapter.findAll(n => n.type === 'TEXT');
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

await figma.loadFontAsync({ family: FONT_FAMILY, style: 'Medium' });

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
  }

  const label = figma.createText();
  label.fontName = { family: FONT_FAMILY, style: 'Medium' };
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

### Step 8: Visual Validation

1. `figma_take_screenshot` with the `frameId` — Capture the completed annotation
2. Verify:
   - Each variant axis has a section with instance previews for every option
   - Each boolean has a section showing on/off states (excluding controlling booleans merged into child chapters, and sibling booleans collapsed into combinatorial chapters)
   - Each variable mode property has a section with visual instance previews per mode
   - Each child component chapter shows **parent instances** (not isolated sub-components) with the child property varied
   - Child chapters with a controlling boolean include an "off" state labeled "No {booleanName}" as the first preview
   - Labels indicate defaults
   - Component instances render correctly
   - Child component chapter titles use the `controllingBooleanName` (e.g., "Trailing content") rather than the raw layer name (e.g., "trailingContent v2") when a controlling boolean exists. If a title shows an internal layer name (camelCase, version suffixes like "v2"), rename the chapter and its `#section-name` text to use the controlling boolean name instead.
   - All preview items fit within the preview area without being clipped. Wrapping is always enabled, but if items are still too wide for a single row even individually, reduce `itemSpacing` or check that instances are not unexpectedly large.
3. If issues are found, fix via `figma_execute` and re-capture (up to 3 iterations)

## Notes

- The target node can be either a `COMPONENT_SET` (multi-variant) or a standalone `COMPONENT` (single variant). The extraction script detects the type and returns `isComponentSet` accordingly. When the node is a standalone component, there are no variant axes — only boolean, instance swap, and variable mode properties apply. Instance creation uses `comp.createInstance()` directly.
- The extraction script reads `componentPropertyDefinitions` from the component set or component, which captures all variant axes, boolean toggles, and instance swap properties. The `defaultProps` are built from `defaultVariant.variantProperties` (not `componentProperties`, which only has booleans/swaps).
- For variant axes, the script finds the matching variant child by iterating the component set's children and matching `variantProperties`. Other properties are kept at their defaults.
- For boolean toggles, the script creates instances from the default variant and uses `setProperties` to flip the boolean value. However, some booleans are **variant-gated** — the layer they control only exists under specific variant axis values (e.g., a "Dismiss button" layer only exists when `Behavior=Interactive`, not `Behavior=Static`). Step 3a detects this deterministically: the script resolves the boolean's `rawKey#nodeId` across variants and returns an `interpretedBooleans` array with `requiredVariantOverrides` already computed (no AI reasoning needed). When a boolean has `requiredVariantOverrides`, 6b uses those overrides as the base variant instead of the default, and the description notes the dependency.
- The property template key is stored in `uspecs.config.json` under `templateKeys.propertyOverview` and is configured via `@firstrun`. This is a dedicated property template with the header already set to "Property" — no renaming needed.
- Each variant option is shown in a horizontal layout inside the `#preview`. `layoutWrap: 'WRAP'` is always enabled so items wrap to additional rows instead of overflowing. The template's `clipsContent: true` is preserved to prevent any overflow beyond the preview bounds.
- New chapters are appended to the Content parent via `appendChild` (not inserted at a table index).
- **Chapter rollback on failure**: All chapter-creation scripts (6a, 6b, 6c) wrap the main logic in a try/catch. If the script fails after cloning `#anatomy-section`, the cloned chapter is removed before returning the error. This prevents orphan chapters from accumulating in the frame on retries.
- Variable mode properties (shape, density, etc.) are detected via `figma_get_variables` in Step 3b by looking for collections named after the component (e.g., "Button shape", "Button density"). These are rendered as visual chapters with component instance previews.
- **Variable mode collection lookup**: The Figma plugin API in incremental mode requires the actual collection object (not a string ID) for `setExplicitVariableModeForCollection`. The 6c script fetches the collection via `getLocalVariableCollectionsAsync()` and matches by ID.
- **Baked-in variable modes**: Some components have explicit variable modes set directly on their root or internal sub-instances. Instances created from such components inherit these baked-in modes, which override the wrapper frame's mode. The 6c script calls `clearExplicitVariableModeForCollection(collection)` recursively on each instance after creation so it inherits the mode from the wrapper instead.
- **Sub-component discovery** (Step 3c): The extraction script walks the default variant's children recursively. For each `INSTANCE` child, it resolves the main component via `getMainComponentAsync()`. If the main component belongs to a local `COMPONENT_SET` or is a standalone `COMPONENT` with its own `componentPropertyDefinitions` (variant axes, booleans, instance swaps), those properties are extracted into the `childComponents` array. Child components with no configurable properties are skipped.
- **Controlling boolean linkage** (Step 3c): The `figma_execute` script resolves boolean-to-child linkage deterministically within the script itself (no AI reasoning needed). For each hidden child (`visible === false`), it iterates the parent's `booleanProps` (passed as input) and uses two deterministic checks: (1) primary — resolve `rawKey#nodeId` suffix to a layer and compare its name to the child's layer name, (2) fallback — normalize both names (lowercase, strip non-alphanumeric) and check substring containment. The script returns `controllingBooleanName`, `controllingBooleanRawKey` on each child entry, plus a `controllingBooleanNames` array for the skip set used in 6b.
- **In-context rendering** (6e): All child component properties are rendered on **parent instances**, never as isolated sub-component instances. For each preview, the skill creates a parent instance via `parentDefaultVariant.createInstance()`, toggles the controlling boolean if applicable, then finds the nested child instance by layer name and calls `setProperties()` to swap the variant or toggle the boolean. This ensures previews show the child property in the context of the full parent component, which is what designers see when configuring the component.
- **Off-state label convention**: When a child has a controlling boolean, the first preview in the chapter shows the "off" state (boolean = false) labeled `"No {controllingBooleanName}"` (e.g., "No trailing content"). This negated phrasing clearly communicates that the child is hidden. The off state is marked as `(default)` when the controlling boolean's default value is `false`.
- **Child component exhibits** (6e): Each child component with variant axes gets a chapter per axis, and each with booleans gets a chapter per boolean toggle. Instances are created from the **parent** component (not the child directly). Chapter titles use the format "{childLayerName} – {propertyName}" and descriptions note "Sub-component: {mainComponentName}" for context. The same rollback-on-failure pattern (try/catch with chapter removal) applies.
- **Property normalization** (Step 3d): Before rendering, a deterministic `figma_execute` script processes the extracted property data to eliminate redundant or misleading chapters. No AI reasoning is needed — the script takes `parentVariantAxes`, `childComponents`, and `controllingBooleanNames` as inputs and returns the full normalization plan. Four issues are addressed: (1) child variant axes that mirror the parent (coupled axes) are flagged with `coupled: true` and skipped in rendering, (2) sub-booleans nested inside container-gated children are identified as candidates for unification, (3) container booleans + their sub-booleans are collapsed into `unifiedSlotChapters` with combinatorial previews, and (4) sibling booleans on the same child are collapsed into `siblingBoolChapters` with combinatorial previews.
- **Coupled axis detection** (3d-i): A child variant axis is coupled when it shares the same name (case-insensitive) with a parent axis and its options are a subset of (or equal to) the parent's options. For example, a child "Label" with `Size: [Large, Medium, Small]` matching the parent's `Size: [Large, Medium, Small, XSmall]` is coupled — the child size always follows the parent, so showing it separately is redundant.
- **Unified slot chapter labeling** (3d-iii / 6f): Combination labels are derived by stripping the common prefix from sub-boolean names. For a container "Leading content" with sub-booleans "Leading artwork" and "Leading text", the labels become: None / Text only / Artwork only / Text + Artwork. When there is only 1 sub-boolean, the labels are: None / {short name}. The "None" state represents the container boolean in its off position.
- **Combination cap** (3d-iii): For containers with 3+ sub-booleans, the full power set may be too large. Limit unified slot chapters to ~6 meaningful combinations, omitting edge cases. Focus on the most common designer workflows (all off, each on individually, all on) and skip unlikely combinations.
- **Sibling boolean collapsing** (3d-iv / 6g): When a child component has 2+ boolean properties that are not consumed by container-gating (3d-ii/iii), they are collapsed into a single combinatorial chapter. For example, a Label child with "Show icon" (default: false) and "Character count" (default: true) becomes a single "Label" chapter with 4 previews: None, Character count (default), Icon, Character count + Icon. The default label is computed from the actual boolean defaults. Short names are derived by stripping common prefixes/verbs (e.g., "Show icon" → "Icon"). If only 1 boolean remains after filtering, it is rendered as a standard boolean chapter (6e-ii) instead.
- **Graceful fallback for normalization**: If the agent is uncertain about a grouping — for example, ambiguous naming conventions, unusual hierarchy structures, or sub-booleans that do not clearly belong to the container — it should fall back to rendering individual chapters (the pre-normalization behavior) rather than producing incorrect unified chapters.
