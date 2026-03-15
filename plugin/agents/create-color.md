---
name: create-color
description: Generate color annotation specifications mapping UI elements to design tokens. Use when the user mentions "color", "color annotation", "color spec", "tokens", "design tokens", or wants to document which color tokens a component uses.
---

# Create Color Annotation

Generate a color annotation directly in Figma — tables mapping each visual element to its design token, organized by variant and state.

## Inputs Expected

- **Figma link**: URL to a component set or standalone component in Figma (preferred)
- **Screenshot**: Image of the UI component (alternative if no Figma link)
- **Description** (optional): Component name, specific variants to document

## Workflow

Copy this checklist and update as you progress:

```
Task Progress:
- [ ] Step 1: Read instruction file
- [ ] Step 2: Verify MCP connection (if Figma link provided)
- [ ] Step 3: Read template key from uspecs.config.json
- [ ] Step 4: Gather context (MCP tools + user-provided input)
- [ ] Step 4b: Run token extraction script
- [ ] Step 4b-post: Boolean-toggle enrichment (if boolean properties exist)
- [ ] Step 4c: Analyze complexity (axis classification, mode detection, strategy selection)
- [ ] Step 5: Identify structure (variants, states, elements)
- [ ] Step 6: Extract token names
- [ ] Step 7: Organize analysis into structured data (component name, general notes, variants with tables and rows)
- [ ] Step 8: Re-read instruction file (Common Mistakes, Do NOT sections) and audit
- [ ] Step 9: Import and detach the Color Annotation template
- [ ] Step 10: Fill header fields
- [ ] Step 11: Render variants (Strategy A or B, one figma_execute per variant)
- [ ] Step 12: Visual validation
```

### Step 1: Read Instructions

Read [agent-color-instruction.md](../../color/agent-color-instruction.md)

### Step 2: Verify MCP Connection

If a Figma link is provided, verify the connection:
- `figma_get_status` — Confirm Figma Desktop is running with debug flag and Desktop Bridge plugin is active

If connection fails, guide user through setup before proceeding.

### Step 3: Read Template Key

Read the file `uspecs.config.json` and extract:
- The `colorAnnotation` value from the `templateKeys` object → save as `COLOR_TEMPLATE_KEY`
- The `fontFamily` value → save as `FONT_FAMILY` (default to `Inter` if not set)

If the template key is empty, tell the user:
> The color annotation template key is not configured. Run `@setup-library` with your Figma template library link first.

### Step 4: Gather Context

Use ALL available sources to maximize context:

**From user:**
- Any screenshots or images provided
- Component description and context
- Specific variants or states to document

**From MCP tools (when Figma link provided):**
1. `figma_navigate` — Open the component URL
2. `figma_take_screenshot` — Capture the component layout and states
3. `figma_get_file_data` — Get detailed structure with fill/stroke information
4. `figma_get_component` — Get component data including visual properties
5. `figma_get_variables` — Get variable collections and token definitions
6. `figma_get_token_values` — Get all variable values organized by collection and mode
7. `figma_get_styles` — Get color styles if component uses styles instead of variables
8. `figma_search_components` — Find component by name if needed

### Step 4b: Run Token Extraction Script

When a Figma link is provided, run this extraction script via `figma_execute` to programmatically walk the component tree and resolve all color variable bindings.

Set `__SKIP_AXES_JSON__` to `{}` for the initial run — the script will walk all variants. After running Step 4c (complexity analysis), you may optionally re-run this script with color-irrelevant axes populated to get a reduced dataset (see Step 4c-iv).

Replace `__NODE_ID__` with the component set node ID extracted from the URL (`node-id=123-456` → `123:456`). Replace `__SKIP_AXES_JSON__` with `{}` (or a JSON object mapping color-irrelevant axis names to their default/representative value if re-running after Step 4c, e.g., `{"Size": "Medium", "Density": "Default"}`):

```javascript
const TARGET_NODE_ID = '__NODE_ID__';
const SKIP_AXES = __SKIP_AXES_JSON__;

function rgbToHex(c) {
  return '#' + [c.r, c.g, c.b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

async function resolveVariableToken(binding) {
  if (!binding?.id) return null;
  try {
    const v = await figma.variables.getVariableByIdAsync(binding.id);
    if (v) return v.name;
  } catch {}
  return null;
}

async function extractColorBindings(node, path) {
  const entries = [];
  const elementName = path || node.name;

  if (node.fills && Array.isArray(node.fills)) {
    for (const fill of node.fills) {
      if (fill.visible === false) continue;
      if (fill.type === 'SOLID') {
        const hex = rgbToHex(fill.color);
        const token = fill.boundVariables?.color
          ? await resolveVariableToken(fill.boundVariables.color)
          : null;
        const prop = node.type === 'TEXT' ? 'text fill' : 'fill';
        entries.push({ element: elementName, property: prop, hex, token, opacity: fill.opacity });
      }
    }
  }

  if (node.strokes && Array.isArray(node.strokes)) {
    for (const stroke of node.strokes) {
      if (stroke.visible === false) continue;
      if (stroke.type === 'SOLID') {
        const hex = rgbToHex(stroke.color);
        const token = stroke.boundVariables?.color
          ? await resolveVariableToken(stroke.boundVariables.color)
          : null;
        entries.push({ element: elementName, property: 'stroke', hex, token, opacity: stroke.opacity });
      }
    }
  }

  if (node.effects && Array.isArray(node.effects)) {
    for (const effect of node.effects) {
      if (effect.visible === false) continue;
      if (effect.color) {
        const hex = rgbToHex(effect.color);
        const token = effect.boundVariables?.color
          ? await resolveVariableToken(effect.boundVariables.color)
          : null;
        const effectType = effect.type === 'DROP_SHADOW' ? 'drop shadow'
          : effect.type === 'INNER_SHADOW' ? 'inner shadow'
          : effect.type;
        entries.push({ element: elementName, property: effectType, hex, token, opacity: effect.color.a });
      }
    }
  }

  return entries;
}

async function walkTree(node, parentPath) {
  const currentPath = parentPath ? parentPath + ' > ' + node.name : node.name;
  let allEntries = await extractColorBindings(node, node.name);

  if ('children' in node && node.type !== 'INSTANCE') {
    for (const child of node.children) {
      const childEntries = await walkTree(child, currentPath);
      allEntries = allEntries.concat(childEntries);
    }
  }

  if (node.type === 'INSTANCE') {
    for (const child of node.children) {
      const childEntries = await walkTree(child, currentPath);
      allEntries = allEntries.concat(childEntries);
    }
  }

  return allEntries;
}

const node = await figma.getNodeByIdAsync(TARGET_NODE_ID);
if (!node || (node.type !== 'COMPONENT_SET' && node.type !== 'COMPONENT')) {
  return { error: 'Node is not a component set or component. Type: ' + (node ? node.type : 'null') };
}

const isComponentSet = node.type === 'COMPONENT_SET';

const propDefs = node.componentPropertyDefinitions;
const propertyDefs = {};
if (propDefs) {
  for (const [key, def] of Object.entries(propDefs)) {
    propertyDefs[key] = { type: def.type, defaultValue: def.defaultValue };
    if (def.variantOptions) propertyDefs[key].variantOptions = def.variantOptions;
  }
}

const variantAxes = {};
if (isComponentSet && node.variantGroupProperties) {
  for (const [key, val] of Object.entries(node.variantGroupProperties)) {
    variantAxes[key] = val.values;
  }
}

const variantChildren = isComponentSet ? node.children : [node];

// Filter variants: skip color-irrelevant axis values (keep only the representative)
const skipAxes = SKIP_AXES || {};
const filteredVariants = variantChildren.filter(variant => {
  const props = variant.variantProperties || {};
  for (const [axis, defaultVal] of Object.entries(skipAxes)) {
    if (props[axis] && props[axis] !== defaultVal) return false;
  }
  return true;
});

const variantColorData = [];
for (const variant of filteredVariants) {
  const colorEntries = await walkTree(variant, null);
  variantColorData.push({
    name: variant.name,
    variantProperties: variant.variantProperties || {},
    colorEntries
  });
}

return {
  componentName: node.name,
  compSetNodeId: TARGET_NODE_ID,
  isComponentSet,
  variantAxes,
  propertyDefs,
  variantCount: variantChildren.length,
  sampledCount: filteredVariants.length,
  skippedAxes: Object.keys(skipAxes),
  variantColorData
};
```

Save the returned JSON. This provides:
- `compSetNodeId` — needed for creating live preview instances in Step 11
- `variantAxes` — variant axis names and their options, for mapping variant sections to Figma property keys
- `propertyDefs` — exact Figma property keys (including `#nodeId` suffixes) for `setProperties()` when placing preview instances
- `variantCount` — total variants in the component set
- `sampledCount` — how many variants were actually extracted (after filtering color-irrelevant axes)
- `skippedAxes` — which axes were filtered out as color-irrelevant
- `variantColorData` — per-variant array of `colorEntries`, each with `element` (layer name), `property` (fill/stroke/text fill/shadow), `hex` (resolved color), `token` (variable name or null), and `opacity`

Use the `variantColorData` in Steps 5-6 to build element-to-token mappings deterministically. Entries with a non-null `token` field have a resolved variable binding; entries with `token: null` use a hard-coded color (note this in the output). Group entries by variant name to organize into variant sections.

### Step 4b-post: Boolean-Toggle Enrichment

Check the `propertyDefs` from Step 4b output for BOOLEAN type properties. If none exist, skip this step entirely.

If boolean properties exist, run the following `figma_execute` script to discover color bindings hidden behind boolean toggles (e.g., sub-components swapped via INSTANCE_SWAP, deferred fills, or nested boolean-gated elements). Replace `__NODE_ID__` with the component set node ID:

```javascript
const TARGET_NODE_ID = '__NODE_ID__';

function rgbToHex(c) {
  return '#' + [c.r, c.g, c.b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

async function resolveVariableToken(binding) {
  if (!binding?.id) return null;
  try {
    const v = await figma.variables.getVariableByIdAsync(binding.id);
    if (v) return v.name;
  } catch {}
  return null;
}

async function extractColorBindings(node) {
  const entries = [];
  const elementName = node.name;
  if (node.fills && Array.isArray(node.fills)) {
    for (const fill of node.fills) {
      if (fill.visible === false) continue;
      if (fill.type === 'SOLID') {
        const hex = rgbToHex(fill.color);
        const token = fill.boundVariables?.color
          ? await resolveVariableToken(fill.boundVariables.color) : null;
        const prop = node.type === 'TEXT' ? 'text fill' : 'fill';
        entries.push({ element: elementName, property: prop, hex, token, opacity: fill.opacity });
      }
    }
  }
  if (node.strokes && Array.isArray(node.strokes)) {
    for (const stroke of node.strokes) {
      if (stroke.visible === false) continue;
      if (stroke.type === 'SOLID') {
        const hex = rgbToHex(stroke.color);
        const token = stroke.boundVariables?.color
          ? await resolveVariableToken(stroke.boundVariables.color) : null;
        entries.push({ element: elementName, property: 'stroke', hex, token, opacity: stroke.opacity });
      }
    }
  }
  if (node.effects && Array.isArray(node.effects)) {
    for (const effect of node.effects) {
      if (effect.visible === false) continue;
      if (effect.color) {
        const hex = rgbToHex(effect.color);
        const token = effect.boundVariables?.color
          ? await resolveVariableToken(effect.boundVariables.color) : null;
        const effectType = effect.type === 'DROP_SHADOW' ? 'drop shadow'
          : effect.type === 'INNER_SHADOW' ? 'inner shadow' : effect.type;
        entries.push({ element: elementName, property: effectType, hex, token, opacity: effect.color.a });
      }
    }
  }
  return entries;
}

async function walkTree(node, parentPath) {
  const currentPath = parentPath ? parentPath + ' > ' + node.name : node.name;
  let allEntries = await extractColorBindings(node);
  if ('children' in node) {
    for (const child of node.children) {
      allEntries = allEntries.concat(await walkTree(child, currentPath));
    }
  }
  return allEntries;
}

const node = await figma.getNodeByIdAsync(TARGET_NODE_ID);
if (!node || (node.type !== 'COMPONENT_SET' && node.type !== 'COMPONENT')) {
  return { error: 'Node not found or wrong type' };
}

const isCompSet = node.type === 'COMPONENT_SET';
const defaultVariant = isCompSet
  ? (node.defaultVariant || node.children[0])
  : node;

const baselineKeys = new Set();
const baselineEntries = await walkTree(defaultVariant, null);
for (const e of baselineEntries) {
  baselineKeys.add(e.element + '|' + e.property + '|' + (e.token || e.hex));
}

const instance = defaultVariant.createInstance();
instance.x = defaultVariant.x + defaultVariant.width + 100;
instance.y = defaultVariant.y;

const boolProps = {};
const propDefs = node.componentPropertyDefinitions || {};
for (const [key, def] of Object.entries(propDefs)) {
  if (def.type === 'BOOLEAN') {
    boolProps[key] = true;
  }
}
instance.setProperties(boolProps);

const enrichedEntries = await walkTree(instance, null);
const delta = [];
for (const e of enrichedEntries) {
  const key = e.element + '|' + e.property + '|' + (e.token || e.hex);
  if (!baselineKeys.has(key)) {
    delta.push(e);
  }
}

instance.remove();

return {
  booleanPropsToggled: Object.keys(boolProps),
  baselineCount: baselineEntries.length,
  enrichedCount: enrichedEntries.length,
  deltaCount: delta.length,
  delta
};
```

This script:
1. Creates an instance from the default variant
2. Enables all boolean toggles via `setProperties()`
3. Re-runs the same `extractColorBindings` + `walkTree` logic on the enriched instance
4. Compares against the baseline extraction to find new element-token pairs
5. Removes the test instance

**If the delta is empty**, no new elements were found — proceed to Step 4c with the original data.

**If the delta contains new entries**, merge them into the `variantColorData` for the default variant (and by extension all variants that share the same boolean-gated sub-components). These additional entries feed into Steps 5-7 alongside the baseline data.

### Step 4c: Analyze Complexity

Determine how many variant sections are needed and choose the rendering strategy. This avoids combinatorial explosion on complex components (e.g., a Tag with 4 axes × 56 variants × 11 color modes).

#### Step 4c-i: Classify Variant Axes by Color Relevance

Run this script via `figma_execute` to compare token sets across axis values and identify which axes actually affect color. Replace `__NODE_ID__` with the component set node ID:

```javascript
const TARGET_NODE_ID = '__NODE_ID__';

const node = await figma.getNodeByIdAsync(TARGET_NODE_ID);
if (!node || (node.type !== 'COMPONENT_SET' && node.type !== 'COMPONENT')) {
  return { error: 'Node is not a component set or component. Type: ' + (node ? node.type : 'null') };
}

if (node.type === 'COMPONENT') {
  return { axisClassification: {} };
}

const axes = node.variantGroupProperties;
const axisNames = Object.keys(axes);
const children = node.children;

async function resolveToken(binding) {
  if (!binding?.id) return null;
  try {
    const v = await figma.variables.getVariableByIdAsync(binding.id);
    return v ? v.name : null;
  } catch { return null; }
}

async function getTokenSet(variant) {
  const tokens = new Set();
  const stack = [variant];
  while (stack.length) {
    const n = stack.pop();
    if (n.fills && Array.isArray(n.fills)) {
      for (const f of n.fills) {
        if (f.visible === false) continue;
        const t = f.boundVariables?.color ? await resolveToken(f.boundVariables.color) : null;
        if (t) tokens.add(t);
      }
    }
    if (n.strokes && Array.isArray(n.strokes)) {
      for (const s of n.strokes) {
        if (s.visible === false) continue;
        const t = s.boundVariables?.color ? await resolveToken(s.boundVariables.color) : null;
        if (t) tokens.add(t);
      }
    }
    if ('children' in n) {
      for (const c of n.children) stack.push(c);
    }
  }
  return [...tokens].sort().join('|');
}

const stateKeywords = ['enabled', 'hover', 'pressed', 'disabled', 'active', 'rest', 'focused', 'selected', 'dragged', 'error', 'loading'];

const axisClassification = {};

for (const axis of axisNames) {
  const values = axes[axis].values;
  const isState = values.some(v => stateKeywords.includes(v.toLowerCase()));

  const tokenSetsByValue = {};
  let allSame = true;
  let referenceSet = null;

  for (const val of values) {
    const matching = children.filter(c => c.variantProperties[axis] === val);
    if (matching.length === 0) continue;
    const tset = await getTokenSet(matching[0]);
    tokenSetsByValue[val] = tset;
    if (referenceSet === null) referenceSet = tset;
    else if (tset !== referenceSet) allSame = false;
  }

  axisClassification[axis] = {
    values,
    isState,
    colorRelevant: !allSame,
    tokenSetsByValue
  };
}

return { axisClassification };
```

Save the result. Each axis is classified as:
- **Color-irrelevant**: `colorRelevant: false` — tokens identical across all values (e.g., Size, Density). These axes never create separate sections.
- **Color-relevant**: `colorRelevant: true` — tokens differ across values (e.g., Type, State).
- **State axis**: `isState: true` — values match interactive state keywords (Enabled, Hover, Pressed, etc.).

#### Step 4c-ii: Detect Mode-Controlled Color Collections

Run this script via `figma_execute` to find component-specific color collections and resolve variable aliases per mode. Replace `__COMPONENT_NAME__` with the component name:

```javascript
const COMPONENT_NAME = '__COMPONENT_NAME__';

const collections = await figma.variables.getLocalVariableCollectionsAsync();
const searchTerms = [
  COMPONENT_NAME.toLowerCase() + ' color',
  COMPONENT_NAME.toLowerCase() + ' style',
  COMPONENT_NAME.toLowerCase() + ' emphasis'
];

let targetCollection = null;
for (const col of collections) {
  const colNameLower = col.name.toLowerCase();
  if (searchTerms.some(t => colNameLower.includes(t)) || colNameLower.includes(COMPONENT_NAME.toLowerCase())) {
    targetCollection = col;
    break;
  }
}

if (!targetCollection) {
  return { hasModeCollection: false, collectionName: null, modes: [], modeTokenMap: {} };
}

const modes = targetCollection.modes.map(m => m.name);
const modeTokenMap = {};

for (const mode of targetCollection.modes) {
  modeTokenMap[mode.name] = {};
  for (const varId of targetCollection.variableIds) {
    const variable = await figma.variables.getVariableByIdAsync(varId);
    if (!variable) continue;
    const modeValue = variable.valuesByMode[mode.modeId];
    if (modeValue && modeValue.type === 'VARIABLE_ALIAS') {
      const aliased = await figma.variables.getVariableByIdAsync(modeValue.id);
      if (aliased) {
        modeTokenMap[mode.name][variable.name] = aliased.name;
      }
    } else {
      modeTokenMap[mode.name][variable.name] = variable.name;
    }
  }
}

return {
  hasModeCollection: true,
  collectionName: targetCollection.name,
  modes,
  modeTokenMap
};
```

Save the result. If `hasModeCollection` is `true`, the component has mode-controlled colors. The `modeTokenMap` maps generic token names to their resolved semantic names for each mode.

#### Step 4c-iii: Determine Rendering Strategy

Using the axis classification from 4c-i and mode detection from 4c-ii, choose one of two rendering strategies:

**Strategy A — Simple (single-state sections):**
- Use when the total number of color-relevant variant combinations is **≤ 6 sections**
- Layout: One section per variant, each with preview + single table
- Table columns: `Element | Token | Notes`
- This is the current behavior with the column header corrected from "State" to "Token"

**Strategy B — Consolidated (multi-column table with states as columns):**
- Use when the total number of color-relevant variant combinations is **> 6 sections**
- Layout: One section per color-relevant NON-state axis value × mode combination (e.g., "Primary / Gray", "Secondary / Orange")
- Table columns: `Element | {State1} | {State2} | ... | {StateN} | Notes`
- States become column headers instead of separate sections

**Decision logic:**

1. Count color-relevant axes (from 4c-i where `colorRelevant: true`)
2. Identify the state axis (where `isState: true`)
3. Calculate total planned sections:
   - For Strategy A: product of all color-relevant axis value counts × number of modes (if mode-controlled)
   - For Strategy B: product of all color-relevant NON-state axis value counts × number of modes (if mode-controlled)
4. If total planned sections ≤ 6 → **Strategy A**
5. If total planned sections > 6 → **Strategy B** (states become columns)

If Strategy B, also record:
- `stateAxisName`: name of the state axis (e.g., "State")
- `stateValues`: ordered list of state values (columns)
- `nonStateAxes`: the remaining color-relevant axes whose combinations form sections

The agent may also use judgment to override the threshold when the layout would be clearer with one strategy over the other.

#### Step 4c-iv: Build Variant Reduction Plan

Based on the strategy, determine which variants to extract in Step 4b (if re-running) and which sections to render:

- **Color-irrelevant axes**: Pick one representative value (typically the default). Never create sections for these axes.
- **Strategy A sections**: List each color-relevant axis combination as a section.
- **Strategy B sections**: List each non-state color-relevant combination as a section, with all state values as columns within each section.

**Mode-controlled expansion (critical):** If `hasModeCollection` is true, **every mode must be rendered as its own section(s)**. Do NOT collapse modes into `generalNotes` only.

- Create one section per **non-state-axis-value × mode** combination. For example, if the non-state color-relevant axis is `Type` with values `[Primary, Secondary]` and there are 11 modes, create 22 sections: "Primary / Gray", "Primary / Orange", ..., "Secondary / Gray", etc.
- Section name format: `"{TypeValue} / {ModeName}"`
- For each section, use the `modeTokenMap[modeName]` from Step 4c-ii to resolve every generic token (from the extraction data in Step 4b) to its semantic alias. For example, `Primary/tagBackground` → `Tag/Gray/backgroundPrimary` for the Gray mode.
- Record the `collectionId` from Step 4c-ii on the top-level data structure.
- Record the `modeId` for each section (from `modeTokenMap` modes) so the rendering step can apply the correct variable mode to preview instances.

**Optional re-extraction:** If the component is complex (many variants) and Step 4b was run with `{}`, re-run Step 4b now with `__SKIP_AXES_JSON__` populated with the color-irrelevant axes identified above (e.g., `{"Size": "Medium", "Density": "Default"}`) to get a focused dataset. For components with few variants (≤ 10), there is no need to re-run.

### Step 5-6: Analyze Structure and Extract Tokens

Using gathered context, the extraction data from Step 4b, and the complexity analysis from Step 4c:
- Identify variants and states from Figma
- Extract clean token names from variable bindings
- Map elements to tokens
- Capture the **component set node ID** from the Figma link (the parent component set, needed for live previews)
- Capture the **Figma variant property keys** (from `componentPropertyDefinitions`) so each variant section can map its name back to the correct Figma property values for `setProperties()`

**Strategy-aware extraction:**
- **Strategy A**: Extract tokens for each color-relevant variant combination independently (one section per combination).
- **Strategy B**: Extract tokens for each state within each non-state color-relevant combination. Group the state tokens together so they can be placed as columns in the consolidated table. For mode-controlled components, resolve generic tokens to semantic aliases per mode using `modeTokenMap`.
- **Mode-controlled**: For each Type × Mode combination, build a variant entry with the mode's resolved tokens. Record the `collectionId` and per-variant `modeId` for preview rendering.

For both strategies, skip color-irrelevant axes entirely — use the representative value from Step 4c-iv.

### Step 7: Organize Analysis into Structured Data

Follow the data structure reference in the instruction file. Build an internal working model that feeds directly into the Figma rendering steps — no JSON output artifact is needed.

The data structure depends on the rendering strategy chosen in Step 4c-iii:

#### Strategy A (Simple — ≤ 6 sections)

- `componentName`: string
- `generalNotes`: string (optional)
- `renderingStrategy`: `"A"`
- `variants`: array, each with:
  - `name`: string (variant/state name)
  - `variantProperties`: object (optional — mapping Figma property keys to values for instantiating the component preview, when a component set node ID is available)
  - `tables`: array, each with:
    - `name`: string (table label, e.g. "Spec" or state name)
    - `elements`: array, each with `element`, `token`, `notes`

#### Strategy B (Consolidated — > 6 sections)

- `componentName`: string
- `generalNotes`: string (optional)
- `renderingStrategy`: `"B"`
- `stateColumns`: string[] (ordered list of state values that become column headers, e.g. `["Enabled", "Hover", "Pressed", "Active", "Disabled"]`)
- `stateAxisName`: string (Figma variant axis name for states, e.g. `"State"`)
- `collectionId`: string or null (variable collection ID for mode-controlled colors, e.g. `"VariableCollectionId:6006:13874"`)
- `variants`: array, each with:
  - `name`: string ("{Type} / {Mode}" for mode-controlled, e.g. "Primary / Gray"; or non-state axis value for simple, e.g. "Primary")
  - `modeId`: string or null (variable mode ID for this section, e.g. `"6006:2"` for Gray)
  - `variantProperties`: object (optional — mapping Figma property keys to values for the base/rest state of this combination)
  - `tables`: array, each with:
    - `name`: string (table label, typically "Spec")
    - `elements`: array, each with:
      - `element`: string (UI element name)
      - `tokensByState`: object mapping state name → token (e.g. `{"Enabled": "Tag/Gray/backgroundPrimary", "Disabled": "Tag/Gray/backgroundStateDisabled"}`)
      - `notes`: string (3-8 word description)

### Step 8: Audit

Re-read the instruction file, focusing on:
- **Common Mistakes** section
- **Do NOT** section
- **Writing Notes** guidelines (3-8 words per note)

Check your output against each rule. Fix any violations.

### Step 9: Import and Detach Template

Run via `figma_execute` (replace `__COLOR_TEMPLATE_KEY__` and `__COMPONENT_NAME__`):

```javascript
const TEMPLATE_KEY = '__COLOR_TEMPLATE_KEY__';

const templateComponent = await figma.importComponentByKeyAsync(TEMPLATE_KEY);
const instance = templateComponent.createInstance();
const { x, y } = figma.viewport.center;
instance.x = x - instance.width / 2;
instance.y = y - instance.height / 2;
const frame = instance.detachInstance();
frame.name = '__COMPONENT_NAME__ Color';
figma.currentPage.selection = [frame];
figma.viewport.scrollAndZoomIntoView([frame]);
return { frameId: frame.id };
```

Save the returned `frameId` — you need it for all subsequent steps.

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

const notesFrame = frame.findOne(n => n.name === '#general-color-assignment-description');
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

Replace `__HAS_GENERAL_NOTES__` with `true` or `false`.

### Step 11: Render Variants

Use the rendering strategy determined in Step 4c-iii. Run **one `figma_execute` call per variant** to avoid timeouts.

#### Strategy A: Simple Layout (≤ 6 sections)

For each variant in the data, run the following script. Replace all `__PLACEHOLDER__` values with actual data. `__TABLES_JSON__` is the tables array for this variant (each element has `element`, `token`, `notes`).

- `__COMPONENT_SET_NODE_ID__` is the node ID of the component set (from Step 5-6). Set to `''` if not available.
- `__VARIANT_PROPERTIES_JSON__` is an object mapping **Figma property keys** (exactly as returned by `componentPropertyDefinitions`) to values for this variant. Set to `{}` if not available.

```javascript
const FRAME_ID = '__FRAME_ID__';
const VARIANT_NAME = '__VARIANT_NAME__';
const COMPONENT_NAME = '__COMPONENT_NAME__';
const COMPONENT_SET_ID = '__COMPONENT_SET_NODE_ID__';
const VARIANT_PROPS = __VARIANT_PROPERTIES_JSON__;
const TABLES = __TABLES_JSON__;

const frame = await figma.getNodeByIdAsync(FRAME_ID);
const variantTemplate = frame.findOne(n => n.name === '#variant-template');

const variant = variantTemplate.clone();
variantTemplate.parent.appendChild(variant);
variant.name = VARIANT_NAME;
variant.visible = true;

const textNodes = variant.findAll(n => n.type === 'TEXT');
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

// Set variant title
const titleFrame = variant.findOne(n => n.name === '#variant-title');
if (titleFrame) {
  const t = titleFrame.findOne(n => n.type === 'TEXT');
  if (t) t.characters = VARIANT_NAME;
}

const previewContainer = variant.findOne(n => n.name === '#preview');
if (previewContainer && COMPONENT_SET_ID) {
  const componentSet = await figma.getNodeByIdAsync(COMPONENT_SET_ID);
  if (componentSet) {
    const isCompSet = componentSet.type === 'COMPONENT_SET';
    let targetVariant = null;
    if (isCompSet && VARIANT_PROPS && Object.keys(VARIANT_PROPS).length > 0) {
      let bestFallback = null;
      let bestScore = -1;
      for (const child of componentSet.children) {
        const vp = child.variantProperties || {};
        let score = 0;
        let exactMatch = true;
        for (const [k, v] of Object.entries(VARIANT_PROPS)) {
          if (vp[k] === v) { score++; } else { exactMatch = false; }
        }
        if (exactMatch) { targetVariant = child; break; }
        if (score > bestScore) { bestScore = score; bestFallback = child; }
      }
      if (!targetVariant) targetVariant = bestFallback;
    }
    if (!targetVariant) {
      targetVariant = isCompSet
        ? (componentSet.defaultVariant || componentSet.children[0])
        : componentSet;
    }
    await figma.loadFontAsync({ family: FONT_FAMILY, style: 'Medium' });
    for (const containerName of ['Light theme preview placeholder', 'Dark theme preview placeholder']) {
      const container = previewContainer.findOne(n => n.name === containerName);
      if (container) {
        const placeholder = container.findOne(n => n.name === 'Placeholder');
        if (placeholder) placeholder.remove();

        const wrapper = figma.createFrame();
        wrapper.name = VARIANT_NAME;
        wrapper.layoutMode = 'VERTICAL';
        wrapper.primaryAxisAlignItems = 'CENTER';
        wrapper.counterAxisAlignItems = 'CENTER';
        wrapper.itemSpacing = 8;
        wrapper.fills = [];
        wrapper.primaryAxisSizingMode = 'AUTO';
        wrapper.counterAxisSizingMode = 'AUTO';
        container.appendChild(wrapper);

        const instance = targetVariant.createInstance();
        wrapper.appendChild(instance);

        const label = figma.createText();
        label.fontName = { family: FONT_FAMILY, style: 'Medium' };
        label.characters = VARIANT_NAME;
        label.fontSize = 14;
        label.fills = [{ type: 'SOLID', color: { r: 0.29, g: 0.29, b: 0.29 } }];
        wrapper.appendChild(label);
      }
    }
  }
} else {
  const previewText = VARIANT_NAME === COMPONENT_NAME
    ? COMPONENT_NAME
    : COMPONENT_NAME + ' ' + VARIANT_NAME;

  const lightFrame = variant.findOne(n => n.name === '#preview-instruction-light');
  if (lightFrame) {
    const textNodesInFrame = lightFrame.children.filter(c => c.type === 'TEXT');
    if (textNodesInFrame[1]) textNodesInFrame[1].characters = previewText;
  }

  const darkFrame = variant.findOne(n => n.name === '#preview-instruction-dark');
  if (darkFrame) {
    const textNodesInFrame = darkFrame.children.filter(c => c.type === 'TEXT');
    if (textNodesInFrame[1]) textNodesInFrame[1].characters = previewText;
  }
}

// Clone and fill tables (Strategy A: Element | Token | Notes)
const tableTemplate = variant.findOne(n => n.name === '#color-table-template');

for (let t = 0; t < TABLES.length; t++) {
  const tableData = TABLES[t];
  const tableClone = tableTemplate.clone();
  tableTemplate.parent.appendChild(tableClone);
  tableClone.name = tableData.name;
  tableClone.visible = true;

  const tableTitleFrame = tableClone.findOne(n => n.name === '#table-title');
  if (tableTitleFrame) {
    const txt = tableTitleFrame.findOne(n => n.type === 'TEXT');
    if (txt) txt.characters = tableData.name;
  }

  // Rename header: "State" → "Token"
  const headerRow = tableClone.findOne(n => n.name === '#color-table')?.findOne(n => n.name === '#header-row');
  if (headerRow) {
    const stateTitle = headerRow.findOne(n => n.name === '#state-title');
    if (stateTitle) {
      const txt = stateTitle.findOne(n => n.type === 'TEXT');
      if (txt) txt.characters = 'Token';
    }
  }

  const colorTable = tableClone.findOne(n => n.name === '#color-table');
  const rowTemplate = colorTable.findOne(n => n.name === '#element-row-template');

  for (const element of tableData.elements) {
    const row = rowTemplate.clone();
    colorTable.appendChild(row);
    row.name = 'Row ' + element.element;

    const elemFrame = row.findOne(n => n.name === '#element-name');
    if (elemFrame) {
      const txt = elemFrame.findOne(n => n.type === 'TEXT');
      if (txt) txt.characters = element.element;
    }

    const tokenFrame = row.findOne(n => n.name === '#state-name');
    if (tokenFrame) {
      const txt = tokenFrame.findOne(n => n.type === 'TEXT');
      if (txt) txt.characters = element.token;
    }

    const notesFrame = row.findOne(n => n.name === '#element-notes');
    if (notesFrame) {
      const txt = notesFrame.findOne(n => n.type === 'TEXT');
      if (txt) txt.characters = element.notes;
    }
  }

  rowTemplate.remove();
}

tableTemplate.remove();
return { success: true, variant: VARIANT_NAME };
```

#### Strategy B: Consolidated Multi-Column Layout (> 6 sections)

For each variant in the data, run the following script. Replace all `__PLACEHOLDER__` values with actual data.

- `__STATE_COLUMNS_JSON__` is the ordered array of state names that become column headers (e.g. `["Enabled", "Hover", "Pressed", "Active", "Disabled"]`).
- `__STATE_AXIS_NAME__` is the Figma variant axis name for states (e.g. `"State"`).
- `__TABLES_JSON__` is the tables array for this variant. Each element has `element`, `tokensByState` (object mapping state name → token), and `notes`.
- `__COLLECTION_ID__` is the variable collection ID for mode-controlled colors (e.g. `"VariableCollectionId:6006:13874"`). Set to `''` if not mode-controlled.
- `__MODE_ID__` is the variable mode ID for this section (e.g. `"6006:2"` for Gray). Set to `''` if not mode-controlled.

```javascript
const FRAME_ID = '__FRAME_ID__';
const VARIANT_NAME = '__VARIANT_NAME__';
const COMPONENT_NAME = '__COMPONENT_NAME__';
const COMPONENT_SET_ID = '__COMPONENT_SET_NODE_ID__';
const VARIANT_PROPS = __VARIANT_PROPERTIES_JSON__;
const STATE_COLUMNS = __STATE_COLUMNS_JSON__;
const STATE_AXIS_NAME = '__STATE_AXIS_NAME__';
const TABLES = __TABLES_JSON__;
const COLLECTION_ID = '__COLLECTION_ID__';
const MODE_ID = '__MODE_ID__';

const frame = await figma.getNodeByIdAsync(FRAME_ID);
const variantTemplate = frame.findOne(n => n.name === '#variant-template');

const variant = variantTemplate.clone();
variantTemplate.parent.appendChild(variant);
variant.name = VARIANT_NAME;
variant.visible = true;

const textNodes = variant.findAll(n => n.type === 'TEXT');
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

const titleFrame = variant.findOne(n => n.name === '#variant-title');
if (titleFrame) {
  const t = titleFrame.findOne(n => n.type === 'TEXT');
  if (t) t.characters = VARIANT_NAME;
}

let collection = null;
if (COLLECTION_ID) {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  collection = collections.find(c => c.id === COLLECTION_ID) || null;
}

function clearModesRecursive(node, col) {
  try { node.clearExplicitVariableModeForCollection(col); } catch {}
  if ('children' in node) {
    for (const child of node.children) clearModesRecursive(child, col);
  }
}

const previewContainer = variant.findOne(n => n.name === '#preview');
if (previewContainer && COMPONENT_SET_ID) {
  const componentSet = await figma.getNodeByIdAsync(COMPONENT_SET_ID);
  if (componentSet) {
    const isCompSet = componentSet.type === 'COMPONENT_SET';
    await figma.loadFontAsync({ family: FONT_FAMILY, style: 'Medium' });

    for (const containerName of ['Light theme preview placeholder', 'Dark theme preview placeholder']) {
      const container = previewContainer.findOne(n => n.name === containerName);
      if (!container) continue;
      const placeholder = container.findOne(n => n.name === 'Placeholder');
      if (placeholder) placeholder.remove();
      container.itemSpacing = 24;

      for (let s = 0; s < STATE_COLUMNS.length; s++) {
        const stateProps = { ...VARIANT_PROPS };
        stateProps[STATE_AXIS_NAME] = STATE_COLUMNS[s];

        let targetVariant = null;
        let bestFallback = null;
        let bestScore = -1;
        for (const child of componentSet.children) {
          const vp = child.variantProperties || {};
          let score = 0;
          let exactMatch = true;
          for (const [k, v] of Object.entries(stateProps)) {
            if (vp[k] === v) { score++; } else { exactMatch = false; }
          }
          if (exactMatch) { targetVariant = child; break; }
          if (score > bestScore) { bestScore = score; bestFallback = child; }
        }
        if (!targetVariant) targetVariant = bestFallback;
        if (!targetVariant) targetVariant = isCompSet ? (componentSet.defaultVariant || componentSet.children[0]) : componentSet;

        const wrapper = figma.createFrame();
        wrapper.name = STATE_COLUMNS[s];
        wrapper.layoutMode = 'VERTICAL';
        wrapper.primaryAxisAlignItems = 'CENTER';
        wrapper.counterAxisAlignItems = 'CENTER';
        wrapper.itemSpacing = 8;
        wrapper.fills = [];
        wrapper.primaryAxisSizingMode = 'AUTO';
        wrapper.counterAxisSizingMode = 'AUTO';
        container.appendChild(wrapper);

        if (collection && MODE_ID) {
          wrapper.setExplicitVariableModeForCollection(collection, MODE_ID);
        }

        const inst = targetVariant.createInstance();
        wrapper.appendChild(inst);
        if (collection) clearModesRecursive(inst, collection);

        const label = figma.createText();
        label.fontName = { family: FONT_FAMILY, style: 'Medium' };
        label.characters = STATE_COLUMNS[s];
        label.fontSize = 14;
        label.fills = [{ type: 'SOLID', color: { r: 0.29, g: 0.29, b: 0.29 } }];
        wrapper.appendChild(label);
      }
    }
  }
} else {
  const previewText = VARIANT_NAME === COMPONENT_NAME
    ? COMPONENT_NAME
    : COMPONENT_NAME + ' ' + VARIANT_NAME;

  const lightFrame = variant.findOne(n => n.name === '#preview-instruction-light');
  if (lightFrame) {
    const textNodesInFrame = lightFrame.children.filter(c => c.type === 'TEXT');
    if (textNodesInFrame[1]) textNodesInFrame[1].characters = previewText;
  }

  const darkFrame = variant.findOne(n => n.name === '#preview-instruction-dark');
  if (darkFrame) {
    const textNodesInFrame = darkFrame.children.filter(c => c.type === 'TEXT');
    if (textNodesInFrame[1]) textNodesInFrame[1].characters = previewText;
  }
}

// Clone and fill tables (Strategy B: Element | State1 | State2 | ... | Notes)
const N = STATE_COLUMNS.length;

const tableTemplate = variant.findOne(n => n.name === '#color-table-template');

for (let t = 0; t < TABLES.length; t++) {
  const tableData = TABLES[t];
  const tableClone = tableTemplate.clone();
  tableTemplate.parent.appendChild(tableClone);
  tableClone.name = tableData.name;
  tableClone.visible = true;

  const tableTitleFrame = tableClone.findOne(n => n.name === '#table-title');
  if (tableTitleFrame) {
    const txt = tableTitleFrame.findOne(n => n.type === 'TEXT');
    if (txt) txt.characters = tableData.name;
  }

  const colorTable = tableClone.findOne(n => n.name === '#color-table');

  const headerRow = colorTable.findOne(n => n.name === '#header-row');
  if (headerRow) {
    const stateTitle = headerRow.findOne(n => n.name === '#state-title');
    const notesTitle = headerRow.findOne(n => n.name === '#notes-title');
    const notesIndex = notesTitle ? headerRow.children.indexOf(notesTitle) : -1;

    if (stateTitle) {
      const headerClones = [];
      for (let s = 0; s < N; s++) {
        const col = stateTitle.clone();
        headerClones.push(col);
        if (notesIndex >= 0) {
          headerRow.insertChild(notesIndex + s, col);
        } else {
          headerRow.appendChild(col);
        }
      }
      stateTitle.remove();
      for (let s = 0; s < headerClones.length; s++) {
        headerClones[s].name = 'state-col-' + s;
        headerClones[s].layoutSizingHorizontal = 'FILL';
        const txt = headerClones[s].findOne(n => n.type === 'TEXT');
        if (txt) txt.characters = STATE_COLUMNS[s];
      }
    }

    if (notesTitle) {
      notesTitle.layoutSizingHorizontal = 'FILL';
    }
  }

  const rowTemplate = colorTable.findOne(n => n.name === '#element-row-template');

  for (const element of tableData.elements) {
    const row = rowTemplate.clone();
    colorTable.appendChild(row);
    row.name = 'Row ' + element.element;

    const elemFrame = row.findOne(n => n.name === '#element-name');
    if (elemFrame) {
      const txt = elemFrame.findOne(n => n.type === 'TEXT');
      if (txt) txt.characters = element.element;
    }

    const stateCell = row.findOne(n => n.name === '#state-name');
    const notesFrame = row.findOne(n => n.name === '#element-notes');
    const notesCellIndex = notesFrame ? row.children.indexOf(notesFrame) : -1;

    if (stateCell) {
      const cellClones = [];
      for (let s = 0; s < N; s++) {
        const col = stateCell.clone();
        cellClones.push(col);
        if (notesCellIndex >= 0) {
          row.insertChild(notesCellIndex + s, col);
        } else {
          row.appendChild(col);
        }
      }
      stateCell.remove();
      for (let s = 0; s < cellClones.length; s++) {
        cellClones[s].name = 'state-val-' + s;
        cellClones[s].layoutSizingHorizontal = 'FILL';
        const txt = cellClones[s].findOne(n => n.type === 'TEXT');
        if (txt) txt.characters = element.tokensByState[STATE_COLUMNS[s]] || 'none';
      }
    }

    if (notesFrame) {
      notesFrame.layoutSizingHorizontal = 'FILL';
      const txt = notesFrame.findOne(n => n.type === 'TEXT');
      if (txt) txt.characters = element.notes;
    }
  }

  rowTemplate.remove();
}

tableTemplate.remove();
return { success: true, variant: VARIANT_NAME };
```

#### After All Variants: Hide Template

After all variants are rendered (regardless of strategy), hide the original `#variant-template`:

```javascript
const frame = await figma.getNodeByIdAsync('__FRAME_ID__');
const variantTemplate = frame.findOne(n => n.name === '#variant-template');
if (variantTemplate) variantTemplate.visible = false;
return { success: true };
```

### Step 12: Visual Validation

1. `figma_take_screenshot` with the `frameId` — Capture the completed annotation
2. Verify:
   - All variant sections are present with correct titles (for mode-controlled components: one section per Type × Mode combination)
   - Tables within each variant have correct element-to-token mappings with resolved semantic tokens
   - **Strategy B previews**: Each variant's light and dark preview containers show **all state instances side by side with labels** (e.g., Enabled, Hover, Pressed, Active, Disabled)
   - **Strategy A previews**: Each variant's light and dark preview containers show a labeled component instance
   - For mode-controlled components, preview instances display the correct color mode
   - General notes are visible or hidden as expected
3. If issues are found, fix via `figma_execute` and re-capture (up to 3 iterations)

## Notes

- The color annotation template key is stored in `uspecs.config.json` under `templateKeys.colorAnnotation` and is configured via `@setup-library`.
- The target node can be either a `COMPONENT_SET` (multi-variant) or a standalone `COMPONENT` (single variant). The extraction script detects the type and returns `isComponentSet` accordingly. When the node is a standalone component, it is treated as a single-entry variant array and there are no variant axes. Preview instance creation in Step 11 uses the component directly for standalone components.
- Three-level cloning: variants → tables → rows. Each variant section is cloned from `#variant-template`, each table from `#color-table-template`, and each row from `#element-row-template`.
- Preview instructions: The `#preview-instruction-light` and `#preview-instruction-dark` frames each contain multiple TEXT nodes. The second TEXT node (index 1) receives the preview text formatted as "{ComponentName} {VariantName}".
- The extraction script (Step 4b) supports smart sampling via `SKIP_AXES` — pass color-irrelevant axes and their default values to avoid extracting redundant variants. For components with few variants (≤ 10), extracting all variants is fine.
- The instruction file (`color/agent-color-instruction.md`) contains the data structure reference, examples, and element-to-token mapping rules that guide the analysis phase.
- Preview frames: Each variant section has light and dark preview containers. The `Placeholder` child is removed and replaced with live component instances.
  - **Strategy A**: One labeled instance per container (wrapper frame with instance + text label).
  - **Strategy B**: Multiple labeled instances per container — one per state column. Each instance is wrapped in a vertical frame with a text label showing the state name (e.g., "Enabled", "Hover"). The theme containers use `HORIZONTAL` layout with `itemSpacing: 24` so instances flow left to right.
- **Mode-controlled previews**: For components with a variable mode collection (e.g., "Tag color"), each preview instance wrapper has `setExplicitVariableModeForCollection(collection, modeId)` applied so the correct color mode renders. After creating each instance, `clearModesRecursive` is called to remove any baked-in modes so the instance inherits from the wrapper.
- **Mode-expanded sections**: When `hasModeCollection: true`, every mode is rendered as its own section(s) — one per Type × Mode combination. Section names use the format `"{Type} / {Mode}"` (e.g., "Primary / Gray"). Tokens are resolved per mode via `modeTokenMap` from Step 4c-ii. The `collectionId` and `modeId` are passed to the rendering script for preview mode application.
- The script uses scored variant matching (exact match first, then best partial match by score) to find the correct variant child directly, rather than creating from the default and calling `setProperties()`. This handles sparse component sets where some variant combinations may not exist.
- **Column header rename:** The template's `#state-title` layer originally displays "State", but the column actually holds token names. Strategy A renames this to "Token" at render time. Strategy B replaces the column entirely with per-state columns.
- **Two rendering strategies:** Step 4c determines whether to use Strategy A (simple, ≤ 6 sections) or Strategy B (consolidated, > 6 sections). Strategy B clones the `#state-title` / `#state-name` cells N times (one per state). All cloned state columns and the Notes column use `layoutSizingHorizontal = 'FILL'` so Figma's auto-layout distributes width equally — no hardcoded pixel widths needed.
