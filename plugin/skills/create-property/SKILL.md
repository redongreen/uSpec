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
- [ ] Step 3a: Detect variant-gated booleans
- [ ] Step 3b: Detect variable mode properties (shape, density)
- [ ] Step 3c: Discover local child component properties
- [ ] Step 3d: Normalize child properties (coupled axes, container-gated booleans, unified slots, sibling booleans)
- [ ] Step 4: Navigate to destination (if different file)
- [ ] Step 5: Import and detach the Property template
- [ ] Step 6: Fill header fields
- [ ] Step 7: Build property exhibits with component instances
- [ ] Step 8: Visual validation
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
> The property template key is not configured. Run `@setup-library` with your Figma template library link first.

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

return { boolLayerReport, variantAxes };
```

**How the agent should use this data:**

This is a reasoning step — the script provides structural facts, and the agent decides how to act. For each boolean in `boolLayerReport`:

- **`layerFoundInDefault: true`** — No action needed. The boolean works on the default variant. Render normally in 6b.
- **`layerFoundInDefault: false`** with `foundInVariant` — The boolean is **variant-gated**. The `foundInVariant.diffFromDefault` object tells the agent which variant axis values are required (e.g., `{ "Behavior": "Interactive" }`). Store this on the boolean entry as `requiredVariantOverrides`. In 6b, the agent must use these overrides when looking up the base variant for instance creation instead of the default variant. The description should note the dependency (e.g., "Requires Behavior = Interactive").
- **`layerFoundInDefault: false`** without `foundInVariant` — The layer wasn't found anywhere. The agent should note this and render the boolean normally (the boolean may control something non-structural like opacity).

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

Run this script via `figma_execute`, replacing `TARGET_NODE_ID` with the actual node ID:

```javascript
const TARGET_NODE_ID = '__NODE_ID__';

const node = await figma.getNodeByIdAsync(TARGET_NODE_ID);
if (!node || (node.type !== 'COMPONENT_SET' && node.type !== 'COMPONENT')) {
  return { error: 'Node is not a component set or component.' };
}

const isComponentSet = node.type === 'COMPONENT_SET';
const defaultVariant = isComponentSet ? (node.defaultVariant || node.children[0]) : node;
const fileKey = figma.root.children.map(p => p.id)[0]?.split(':')[0];

const childComponents = [];

async function walkForInstances(container) {
  for (const child of container.children) {
    if (child.type === 'INSTANCE') {
      try {
        const mainComp = await child.getMainComponentAsync();
        if (!mainComp) continue;

        const parent = mainComp.parent;
        const isLocalComponentSet = parent && parent.type === 'COMPONENT_SET';
        const isLocalComponent = mainComp.type === 'COMPONENT' && !isLocalComponentSet;

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

return { childComponents };
```

Save the returned `childComponents` array alongside `variantAxes`, `booleanProps`, etc. Each entry contains:
- `name`: the layer name in the parent (e.g., "trailingContent v2")
- `mainComponentName`: the source component name (e.g., "Content=Button (text)")
- `mainComponentSetId` or `mainComponentId`: for creating instances
- `isComponentSet`: whether it is a multi-variant component set
- `variantAxes`, `booleanProps`, `instanceSwapProps`: its own properties
- `visible`: whether it is visible by default in the parent

If `childComponents` is empty, proceed — there are no local child components to exhibit.

#### Link controlling booleans to child components

After collecting `childComponents`, cross-reference each hidden child against the parent's `booleanProps` to find the parent boolean that controls the child's visibility. A match means the parent boolean and child variants should be rendered as a single unified chapter (see 6e).

For each child where `visible === false`:

1. **Primary match (rawKey node resolution)**: The parent boolean's `rawKey` contains a `#nodeId` suffix. Check if that node ID resolves to a node whose name matches the child's layer `name`. This is the most reliable signal.
2. **Fallback (fuzzy name match)**: Normalize both the boolean's `name` and the child's `name` to lowercase with spaces/special characters stripped, then check substring containment (e.g., "Trailing content" → "trailingcontent", "trailingContent v2" → "trailingcontentv2" — one contains the other).

When a match is found, store on the child entry:
- `controllingBooleanName`: the clean name of the parent boolean (e.g., "Trailing content")
- `controllingBooleanRawKey`: the full raw key from the parent's `booleanProps` (e.g., "Trailing content#6051:1") — needed for `setProperties()` on parent instances

Also build a `controllingBooleanNames` set containing all matched boolean names. This set is used in 6b to skip those booleans from standalone rendering.

If no match is found for a hidden child, leave `controllingBooleanName` as `null` — the child will still be rendered in parent context but without an "off" state.

### Step 3d: Normalize Child Properties

This is a pure data-analysis step — no Figma calls. Examine the extracted `childComponents`, parent `variantAxes`, and parent `booleanProps` to produce a cleaner rendering plan. Run the four sub-analyses in sequence.

#### 3d-i: Detect redundant coupled axes

For each child component's variant axes, check whether the axis has **the same name and identical (or subset) options** as a parent variant axis. If so, mark it as `coupled: true` so Step 7 (6e-i) skips rendering it as a separate chapter.

**Detection logic:**

- Child axis name matches a parent axis name (case-insensitive)
- Child axis options are a subset of (or equal to) parent axis options
- Example: Child "Label" has axis `Size: [Large, Medium, Small, XSmall]`, parent has axis `Size: [Large, Medium, Small, XSmall]` → coupled, skip
- Counter-example: Child "Input" has axis `isSelected: [false, true]` — no matching parent axis → keep

**Data change:** Add `coupled: true` flag to matched child variant axes in `childComponents`. In Step 7 (6e-i), skip axes where `coupled === true`.

#### 3d-ii: Detect container-gated booleans

For each child component, inspect whether any of its boolean properties are "container-gated" — meaning the boolean has no visible effect unless a parent container boolean is first enabled.

**Detection logic:**

- A child component has a `controllingBooleanName` (from Step 3c linkage), meaning the child's root frame visibility is toggled by a parent boolean
- The child also has its own boolean properties (e.g., "Trailing text", "Trailing artwork")
- These sub-booleans are container-gated: toggling them while the container boolean is off produces identical-looking previews (both show the child hidden)

When both conditions are true, the sub-booleans should not be rendered as standalone chapters — they are candidates for 3d-iii unification.

#### 3d-iii: Collapse container + sub-booleans into unified slot chapters

When a parent container boolean (e.g., "Leading content") gates a child component that has its own sub-booleans (e.g., "Leading artwork", "Leading text"), collapse them into a **single unified chapter** titled after the child name and container (e.g., "Input -- Leading content").

The chapter shows a combinatorial preview where each meaningful combination of the container + sub-booleans is one preview item:

For a container with 2 sub-booleans (artwork + text):

- `None` — container off (default when controlling boolean defaults to false)
- `Text only` — container on, text=true, artwork=false
- `Artwork only` — container on, artwork=true, text=false
- `Text + Artwork` — container on, both true

**Data structure — `unifiedSlotChapters`:**

```
unifiedSlotChapters: [
  {
    chapterName: "Input -- Leading content",
    childName: "Input",
    containerBoolName: "Leading content",
    containerBoolRawKey: "Leading content#12013:186",
    subBooleans: [
      { name: "Leading artwork", rawKey: "...", defaultValue: true },
      { name: "Leading text", rawKey: "...", defaultValue: true }
    ],
    previewCombinations: [
      { label: "None", containerOn: false, subValues: {} },
      { label: "Text only", containerOn: true, subValues: { "Leading artwork": false, "Leading text": true } },
      { label: "Artwork only", containerOn: true, subValues: { "Leading artwork": true, "Leading text": false } },
      { label: "Text + Artwork", containerOn: true, subValues: { "Leading artwork": true, "Leading text": true } }
    ],
    defaultLabel: "None"
  }
]
```

**Label generation:** Derive human-readable names from the sub-boolean names by stripping the common prefix shared with the container name (e.g., strip "Leading" from "Leading artwork" → "Artwork"). When there is only 1 sub-boolean, the combinations are: `None` / `{sub-boolean short name}`.

**Combination cap:** For containers with 3+ sub-booleans, limit to the most meaningful combinations (up to ~6 items). Omit edge combinations if the full power set is too large.

**Skip list updates:**

- The container boolean is already in `controllingBooleanNames` (from Step 3c)
- All sub-booleans that appear in `unifiedSlotChapters` are added to a new `unifiedSubBooleanNames` set so they are skipped in standalone 6e-ii rendering

**Graceful fallback:** If the naming is ambiguous, the hierarchy is unusual, or there is any uncertainty about the grouping, fall back to rendering individual chapters rather than producing incorrect groupings.

#### 3d-iv: Collapse sibling booleans into combinatorial chapters

Even when no container/sub-boolean hierarchy exists (3d-ii/iii), a child component may have **multiple sibling booleans** that are more meaningful when shown as combinations rather than isolated true/false toggles. For example, a Label child with booleans "Show icon" (default: false) and "Character count" (default: true) is better presented as a single "Label" chapter with 4 combinations than as two separate chapters each showing true/false.

**Detection logic:**

- A child component has **2 or more boolean properties** that are NOT already consumed by 3d-ii/iii (not container-gated, not unified sub-booleans)
- The booleans are siblings — they all belong to the same child component at the same level
- The full power set of combinations is small enough to render (2 booleans → 4 combos, 3 booleans → up to 6 combos after capping)

**When detected**, collapse all sibling booleans into a single `siblingBoolChapter` entry:

```
siblingBoolChapters: [
  {
    chapterName: "Label",
    childName: "Label",
    booleans: [
      { name: "Show icon", defaultValue: false },
      { name: "Character count", defaultValue: true }
    ],
    previewCombinations: [
      { label: "None", subValues: { "Show icon": false, "Character count": false } },
      { label: "Character count", subValues: { "Show icon": false, "Character count": true } },
      { label: "Icon", subValues: { "Show icon": true, "Character count": false } },
      { label: "Character count + Icon", subValues: { "Show icon": true, "Character count": true } }
    ],
    defaultLabel: "Character count"
  }
]
```

**Label generation:**

- `"None"` — all booleans off
- For single-boolean-on combos, use a short human-readable name derived from the boolean name (e.g., "Show icon" → "Icon", "Character count" → "Character count")
- For multi-boolean-on combos, join the short names with " + " (e.g., "Character count + Icon")
- Strip common prefixes or verbs like "Show", "Has", "With" when deriving short names

**Default label:** Compute from the actual default values of each boolean. The combination matching all defaults is the default label (e.g., if "Character count" defaults true and "Show icon" defaults false, the default is "Character count").

**Combination cap:** For 3+ sibling booleans, limit to ~6 meaningful combinations: all off, each individually on, common pairings, and all on.

**Skip list updates:** All booleans consumed by `siblingBoolChapters` are added to a `siblingBoolNames` set so they are skipped in standalone 6e-ii rendering.

**Graceful fallback:** If there is only 1 remaining boolean on a child (after 3d-ii/iii filtering), render it as a standard boolean chapter (6e-ii) rather than a degenerate 1-boolean combinatorial chapter. Also fall back to individual chapters if the boolean names are ambiguous or don't lend themselves to readable combination labels.

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
- For boolean toggles, the script creates instances from the default variant and uses `setProperties` to flip the boolean value. However, some booleans are **variant-gated** — the layer they control only exists under specific variant axis values (e.g., a "Dismiss button" layer only exists when `Behavior=Interactive`, not `Behavior=Static`). Step 3a detects this by resolving the boolean's `rawKey#nodeId` across variants. When a boolean is variant-gated, 6b uses the required variant as the base instead of the default variant, and the description notes the dependency.
- The property template key is stored in `uspecs.config.json` under `templateKeys.propertyOverview` and is configured via `@setup-library`. This is a dedicated property template with the header already set to "Property" — no renaming needed.
- Each variant option is shown in a horizontal layout inside the `#preview`. `layoutWrap: 'WRAP'` is always enabled so items wrap to additional rows instead of overflowing. The template's `clipsContent: true` is preserved to prevent any overflow beyond the preview bounds.
- New chapters are appended to the Content parent via `appendChild` (not inserted at a table index).
- **Chapter rollback on failure**: All chapter-creation scripts (6a, 6b, 6c) wrap the main logic in a try/catch. If the script fails after cloning `#anatomy-section`, the cloned chapter is removed before returning the error. This prevents orphan chapters from accumulating in the frame on retries.
- Variable mode properties (shape, density, etc.) are detected via `figma_get_variables` in Step 3b by looking for collections named after the component (e.g., "Button shape", "Button density"). These are rendered as visual chapters with component instance previews.
- **Variable mode collection lookup**: The Figma plugin API in incremental mode requires the actual collection object (not a string ID) for `setExplicitVariableModeForCollection`. The 6c script fetches the collection via `getLocalVariableCollectionsAsync()` and matches by ID.
- **Baked-in variable modes**: Some components have explicit variable modes set directly on their root or internal sub-instances. Instances created from such components inherit these baked-in modes, which override the wrapper frame's mode. The 6c script calls `clearExplicitVariableModeForCollection(collection)` recursively on each instance after creation so it inherits the mode from the wrapper instead.
- **Sub-component discovery** (Step 3c): The extraction script walks the default variant's children recursively. For each `INSTANCE` child, it resolves the main component via `getMainComponentAsync()`. If the main component belongs to a local `COMPONENT_SET` or is a standalone `COMPONENT` with its own `componentPropertyDefinitions` (variant axes, booleans, instance swaps), those properties are extracted into the `childComponents` array. Child components with no configurable properties are skipped.
- **Controlling boolean linkage** (Step 3c): After discovering child components, the skill cross-references each hidden child (`visible === false`) against the parent's `booleanProps` to find the parent boolean that toggles the child's visibility. The primary heuristic resolves the boolean's `rawKey#nodeId` suffix to check if the node name matches the child layer name. The fallback normalizes both names (lowercase, strip spaces/special chars) and checks substring containment. When a match is found, `controllingBooleanName` and `controllingBooleanRawKey` are stored on the child entry, and the boolean is added to a `controllingBooleanNames` skip set so 6b does not render it as a standalone chapter.
- **In-context rendering** (6e): All child component properties are rendered on **parent instances**, never as isolated sub-component instances. For each preview, the skill creates a parent instance via `parentDefaultVariant.createInstance()`, toggles the controlling boolean if applicable, then finds the nested child instance by layer name and calls `setProperties()` to swap the variant or toggle the boolean. This ensures previews show the child property in the context of the full parent component, which is what designers see when configuring the component.
- **Off-state label convention**: When a child has a controlling boolean, the first preview in the chapter shows the "off" state (boolean = false) labeled `"No {controllingBooleanName}"` (e.g., "No trailing content"). This negated phrasing clearly communicates that the child is hidden. The off state is marked as `(default)` when the controlling boolean's default value is `false`.
- **Child component exhibits** (6e): Each child component with variant axes gets a chapter per axis, and each with booleans gets a chapter per boolean toggle. Instances are created from the **parent** component (not the child directly). Chapter titles use the format "{childLayerName} – {propertyName}" and descriptions note "Sub-component: {mainComponentName}" for context. The same rollback-on-failure pattern (try/catch with chapter removal) applies.
- **Property normalization** (Step 3d): Before rendering, the agent analyzes the extracted property data to eliminate redundant or misleading chapters. This is a reasoning step, not a script — the agent examines the data and builds a normalization plan. Four issues are addressed: (1) child variant axes that mirror the parent (coupled axes) are skipped since they add no information, (2) sub-booleans nested inside container-gated children are identified so they are not rendered as standalone chapters with identical-looking previews, (3) container booleans + their sub-booleans are collapsed into unified slot chapters showing meaningful combinations, and (4) sibling booleans on the same child are collapsed into combinatorial chapters showing meaningful combinations instead of separate true/false toggles.
- **Coupled axis detection** (3d-i): A child variant axis is coupled when it shares the same name (case-insensitive) with a parent axis and its options are a subset of (or equal to) the parent's options. For example, a child "Label" with `Size: [Large, Medium, Small]` matching the parent's `Size: [Large, Medium, Small, XSmall]` is coupled — the child size always follows the parent, so showing it separately is redundant.
- **Unified slot chapter labeling** (3d-iii / 6f): Combination labels are derived by stripping the common prefix from sub-boolean names. For a container "Leading content" with sub-booleans "Leading artwork" and "Leading text", the labels become: None / Text only / Artwork only / Text + Artwork. When there is only 1 sub-boolean, the labels are: None / {short name}. The "None" state represents the container boolean in its off position.
- **Combination cap** (3d-iii): For containers with 3+ sub-booleans, the full power set may be too large. Limit unified slot chapters to ~6 meaningful combinations, omitting edge cases. Focus on the most common designer workflows (all off, each on individually, all on) and skip unlikely combinations.
- **Sibling boolean collapsing** (3d-iv / 6g): When a child component has 2+ boolean properties that are not consumed by container-gating (3d-ii/iii), they are collapsed into a single combinatorial chapter. For example, a Label child with "Show icon" (default: false) and "Character count" (default: true) becomes a single "Label" chapter with 4 previews: None, Character count (default), Icon, Character count + Icon. The default label is computed from the actual boolean defaults. Short names are derived by stripping common prefixes/verbs (e.g., "Show icon" → "Icon"). If only 1 boolean remains after filtering, it is rendered as a standard boolean chapter (6e-ii) instead.
- **Graceful fallback for normalization**: If the agent is uncertain about a grouping — for example, ambiguous naming conventions, unusual hierarchy structures, or sub-booleans that do not clearly belong to the container — it should fall back to rendering individual chapters (the pre-normalization behavior) rather than producing incorrect unified chapters.
