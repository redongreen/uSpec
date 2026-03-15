---
name: create-structure
description: Generate structure specifications documenting component dimensions, spacing, padding, and how values change across density, size, and shape variants. Use when the user mentions "structure", "structure spec", "dimensions", "spacing", "density", "sizing", or wants to document a component's dimensional properties.
---

# Create Structure Spec

Generate a structure specification directly in Figma — tables documenting all dimensional properties of a component, organized into sections by variant axis or sub-component, with dynamic columns for size/density variants.

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
- [ ] Step 4a-c: Gather baseline (navigate, screenshot, run extraction script, check variable modes)
- [ ] Step 4d: Deep exploration — write free-form figma_execute calls to enable all boolean toggles, inspect every sub-component's internals across sizes, and discover state-conditional properties
- [ ] Step 5: Navigate to destination (if different file)
- [ ] Step 6: Identify sections (variant axes, sub-components)
- [ ] Step 7: Apply columns vs sections decision framework
- [ ] Step 8: Generate structured data (component name, general notes, sections with columns and rows)
- [ ] Step 9: Re-read instruction file (Common Mistakes, Do NOT sections) and audit
- [ ] Step 10: Import and detach the Structure template
- [ ] Step 11: Fill header fields
- [ ] Step 12: For each section → render table, determine preview params, populate preview
- [ ] Step 13: Visual validation
```

### Step 1: Read Instructions

Read [agent-structure-instruction.md](../../structure/agent-structure-instruction.md)

### Step 2: Verify MCP Connection

Check that Figma Console MCP is connected:
- `figma_get_status` — Confirm Desktop Bridge plugin is active

If connection fails, guide user:
> Please open Figma Desktop and run the Desktop Bridge plugin. Then try again.

### Step 3: Read Template Key

Read the file `uspecs.config.json` and extract:
- The `structureSpec` value from the `templateKeys` object → save as `STRUCTURE_TEMPLATE_KEY`
- The `fontFamily` value → save as `FONT_FAMILY` (default to `Inter` if not set)

If the template key is empty, tell the user:
> The structure template key is not configured. Run `@setup-library` with your Figma template library link first.

### Step 4: Gather Context

Navigate to the component file and extract structural data using MCP tools.

**Extract the node ID from the URL:** Figma URLs contain `node-id=123-456` → use `123:456`.

**4a. Visual and structural context:**
1. `figma_navigate` — Go to the component URL
2. `figma_take_screenshot` — See the component and its variants
3. `figma_get_file_data` — Get component set structure with variant axes
4. `figma_get_component` — Get detailed component data for a specific instance
5. `figma_get_component_for_development` — Get component data with visual reference

**4b. Run the extraction script** via `figma_execute`. Replace `__NODE_ID__` with the actual node ID:

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

async function extractDimensions(node) {
  const dims = {};
  const numericProps = [
    'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
    'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
    'itemSpacing', 'counterAxisSpacing', 'cornerRadius', 'strokeWeight'
  ];
  for (const p of numericProps) {
    if (node[p] !== undefined && node[p] !== null && node[p] !== figma.mixed) {
      const token = await resolveBinding(node, p);
      dims[p] = { value: Math.round(node[p]), token: token || null };
    }
  }
  if (node.cornerRadius === figma.mixed) {
    for (const c of ['cornerRadiusTopLeft', 'cornerRadiusTopRight', 'cornerRadiusBottomLeft', 'cornerRadiusBottomRight']) {
      if (node[c] !== undefined) {
        dims[c] = { value: Math.round(node[c]), token: null };
      }
    }
  }
  if (node.layoutMode && node.layoutMode !== 'NONE') {
    dims.layoutMode = { value: node.layoutMode, token: null };
  }
  if (node.primaryAxisAlignItems) {
    dims.primaryAxisAlignItems = { value: node.primaryAxisAlignItems, token: null };
  }
  if (node.counterAxisAlignItems) {
    dims.counterAxisAlignItems = { value: node.counterAxisAlignItems, token: null };
  }
  if (node.layoutSizingHorizontal) {
    dims.layoutSizingHorizontal = { value: node.layoutSizingHorizontal, token: null };
  }
  if (node.layoutSizingVertical) {
    dims.layoutSizingVertical = { value: node.layoutSizingVertical, token: null };
  }
  if (node.clipsContent !== undefined) {
    dims.clipsContent = { value: node.clipsContent, token: null };
  }
  return dims;
}

async function extractTextProps(node) {
  if (node.type !== 'TEXT') return null;
  const styleName = await resolveTextStyle(node);
  if (styleName) return { textStyle: styleName };
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

async function extractChildren(container, depth) {
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
      entry.textProps = await extractTextProps(child);
    }
    if (child.type === 'INSTANCE') {
      try {
        const mc = await child.getMainComponentAsync();
        if (mc) entry.mainComponentName = mc.name;
      } catch {}
    }
    const isTopLevelInstance = depth === 0 && child.type === 'INSTANCE';
    if ('children' in child && child.children.length > 0 && (child.type !== 'INSTANCE' || isTopLevelInstance)) {
      entry.children = await extractChildren(child, depth + 1);
    }
    children.push(entry);
  }
  return children;
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
if (propDefs) {
  for (const [key, def] of Object.entries(propDefs)) {
    propertyDefs[key] = { type: def.type, defaultValue: def.defaultValue };
    if (def.variantOptions) propertyDefs[key].variantOptions = def.variantOptions;
  }
}

const variantChildren = isComponentSet ? node.children : [node];

const defaultValues = {};
for (const [axis, vals] of Object.entries(variantAxes)) {
  defaultValues[axis] = vals[0];
}

const selectedVariants = new Set();
for (const [axis, vals] of Object.entries(variantAxes)) {
  for (const val of vals) {
    const props = { ...defaultValues, [axis]: val };
    const name = Object.entries(props).map(([k, v]) => k + '=' + v).join(', ');
    selectedVariants.add(name);
  }
}

const variants = [];
for (const variant of variantChildren) {
  if (!isComponentSet || selectedVariants.has(variant.name)) {
    variants.push({
      name: variant.name,
      dimensions: await extractDimensions(variant),
      children: await extractChildren(variant)
    });
  }
}

return {
  componentName: node.name,
  compSetNodeId: TARGET_NODE_ID,
  isComponentSet,
  variantAxes,
  propertyDefs,
  variantCount: variantChildren.length,
  variants
};
```

Save the returned JSON. The script extracts **representative variants** — one per value of each axis at default values for other axes — rather than all variants. For a component with Size (4 values) × State (11 values) = 44 total variants, this extracts 4 + 10 = 14 variants instead of 44, keeping output size manageable while preserving full child-tree depth for sub-component analysis. You will use `componentName`, `compSetNodeId`, `variantAxes`, `propertyDefs`, and `variants` in subsequent steps. The `propertyDefs` object contains exact Figma property keys (including `#nodeId` suffixes for booleans) needed for `setProperties()` when placing preview instances.

**4c. Check variable modes:**
- `figma_get_variables` — **Critical:** Check if any bound tokens have multiple mode values (e.g., Density: compact/default/spacious). Filter by token prefix to find relevant variables. If the extraction script found tokens in `boundVariables`, query those token names to discover multi-mode collections.

**Scope constraint:** Only analyze the provided node and its children. Do not navigate to other pages or unrelated frames elsewhere in the Figma file.

**4d. Deep exploration — discover and inspect sub-components:**

The extraction script provides a structured baseline, but components often hide important sub-elements behind boolean toggles (e.g., "Show leading icon", "Show helper text", "Has hint"). You MUST explore beyond the defaults to produce a thorough structure spec.

**Why this matters:** A Text Field might have a Label, Input, and Hint Text as sub-components, but the Hint Text is hidden behind a boolean toggle in the default state. Without enabling that toggle, the extraction misses the entire sub-component and its internal structure (padding, spacing, text styles). The old output you're trying to match was detailed because the agent explored freely — this step restores that exploration.

**Exploration process:**

1. **Identify boolean properties** from `propertyDefs` in the extraction output. Look for keys with type `"BOOLEAN"` — these gate sub-components and optional content.

2. **Create a fully-enabled test instance** via `figma_execute`: create an instance from the default variant, then call `setProperties()` to enable ALL boolean toggles to `true`. Take a screenshot to see the full component with all sub-components visible.

3. **Inspect each sub-component INSTANCE** found in the extraction's child trees. For each one, write your own `figma_execute` calls to:
   - Get its main component name and understand what it is
   - **Record the sub-component's own component set ID** — call `getMainComponentAsync()` on the instance, then read `mainComponent.parent` to get the COMPONENT_SET node. Save `mainComponent.parent.id` as the sub-component's `SUB_COMP_SET_ID`. You will need this in Step 12a to source preview instances from the sub-component's own component set instead of the parent's.
   - **Read its `componentProperties`** — sub-component instances have their OWN boolean toggles that are separate from the parent's `propertyDefs`. These gate internal children like character counts, status icons, and secondary text. You MUST check these. Save the boolean property keys and their enabled values as `SUB_COMP_OVERRIDES` for use in Step 12a/12c.
   - **Enable all sub-component booleans** and inspect what children become visible inside — these are optional elements that still need dimensional specs
   - Extract its internal child tree (padding, spacing, min/max dimensions, text styles, nested frames) — including children revealed by enabling the sub-component's own booleans
   - Check how its dimensions change across the parent's size variants — create instances at different sizes and measure the sub-component within each
   - Look for internal structure that the baseline extraction captured at only one depth level

**Example: recording a sub-component's component set ID and overrides:**
```javascript
const compSet = await figma.getNodeByIdAsync('__COMP_SET_NODE_ID__');
const variant = compSet.children[0];
const inst = variant.createInstance();
const subComp = inst.findOne(n => n.name === '__SUB_COMPONENT_NAME__' && n.type === 'INSTANCE');
if (subComp) {
  const mc = await subComp.getMainComponentAsync();
  const subCompSetId = mc.parent && mc.parent.type === 'COMPONENT_SET' ? mc.parent.id : mc.id;
  const subCompSet = mc.parent && mc.parent.type === 'COMPONENT_SET' ? mc.parent : null;
  const subAxes = subCompSet ? subCompSet.variantGroupProperties : {};

  const props = subComp.componentProperties;
  const boolOverrides = {};
  for (const [key, val] of Object.entries(props)) {
    if (val.type === 'BOOLEAN') boolOverrides[key] = true;
  }

  inst.remove();
  return { subCompSetId, subAxes, boolOverrides };
}
inst.remove();
return { error: 'Sub-component not found' };
```
Save the returned `subCompSetId` and `boolOverrides` for each sub-component — these map directly to `SUB_COMP_SET_ID` and `SUB_COMP_OVERRIDES` in Step 12a's decision table.

4. **Check state-conditional properties** by comparing variants across states (e.g., default vs selected, enabled vs focused). Write `figma_execute` calls to inspect specific state variants and note any properties that only appear in certain states (e.g., an inner border on focus).

5. **Document your findings**: Keep notes on each sub-component's internal structure, which boolean toggles reveal which elements, and any state-conditional properties discovered. You will use this in Step 6 to plan sections and in Step 8 to populate the structured data.

**Example exploration calls:**

To create a fully-enabled instance and see all sub-components:
```javascript
const compSet = await figma.getNodeByIdAsync('__COMP_SET_NODE_ID__');
const defaultVariant = compSet.children[0];
const inst = defaultVariant.createInstance();

// Enable all boolean toggles using exact keys from propertyDefs
inst.setProperties({
  'Show leading icon#12345:67': true,
  'Show helper text#12345:89': true,
  // ... all boolean properties from propertyDefs
});

// Now extract the full child tree of this enriched instance
function getTree(node, depth) {
  const entry = { name: node.name, type: node.type, visible: node.visible };
  if (node.layoutMode && node.layoutMode !== 'NONE') {
    entry.padding = { top: node.paddingTop, bottom: node.paddingBottom, left: node.paddingLeft, right: node.paddingRight };
    entry.itemSpacing = node.itemSpacing;
  }
  if (node.minHeight) entry.minHeight = node.minHeight;
  if (node.minWidth) entry.minWidth = node.minWidth;
  if ('children' in node && node.children.length > 0) {
    entry.children = node.children.map(c => getTree(c, depth + 1));
  }
  return entry;
}

const tree = getTree(inst, 0);
inst.remove();
return tree;
```

To discover a sub-component's own boolean toggles and hidden internal children:
```javascript
const compSet = await figma.getNodeByIdAsync('__COMP_SET_NODE_ID__');
const variant = compSet.children.find(v => {
  const vp = v.variantProperties || {};
  return vp['Size'] === 'Large' && vp['State'] === 'Enabled';
});
const subComp = variant.findOne(n => n.name === '__SUB_COMPONENT_NAME__' && n.type === 'INSTANCE');

// CRITICAL: Read the sub-component's own componentProperties — separate from parent's propertyDefs
const props = subComp.componentProperties;
const booleanProps = {};
for (const [key, val] of Object.entries(props)) {
  if (val.type === 'BOOLEAN') booleanProps[key] = val.value;
}
// booleanProps might reveal: { "Character count#12013:5": false, "Show icon#12013:0": false }

// Enable all booleans to see hidden children
if (Object.keys(booleanProps).length > 0) {
  const enableAll = {};
  for (const key of Object.keys(booleanProps)) enableAll[key] = true;
  subComp.setProperties(enableAll);
}

// Now inspect the full child tree with all internal elements visible
const children = subComp.children.map(c => ({
  name: c.name, type: c.type, visible: c.visible,
  width: Math.round(c.width), height: Math.round(c.height),
  itemSpacing: c.itemSpacing || 0
}));
return { booleanProps, children };
```

To inspect a specific sub-component across sizes:
```javascript
const compSet = await figma.getNodeByIdAsync('__COMP_SET_NODE_ID__');
const results = [];
for (const variant of compSet.children) {
  const vp = variant.variantProperties || {};
  // Only check size variants at default state
  if (vp['State'] && vp['State'] !== 'Enabled') continue;
  const inst = variant.createInstance();
  // Enable the sub-component toggle if needed
  // inst.setProperties({ 'Show helper text#12345:89': true });
  const subComp = inst.findOne(n => n.name === '__SUB_COMPONENT_NAME__');
  if (subComp) {
    results.push({
      size: vp['Size'] || variant.name,
      padding: { top: subComp.paddingTop, bottom: subComp.paddingBottom, left: subComp.paddingLeft, right: subComp.paddingRight },
      itemSpacing: subComp.itemSpacing,
      minHeight: subComp.minHeight,
      children: subComp.children.map(c => ({ name: c.name, type: c.type, visible: c.visible, width: c.width, height: c.height }))
    });
  }
  inst.remove();
}
return results;
```

These are examples — write whatever queries you need to fully understand the component. The goal is to have complete knowledge of every sub-component's internal structure before moving to section planning.

### Step 5: Navigate to Destination

If the user provided a separate destination file URL:
- `figma_navigate` — Switch to the destination file

If no destination was provided, stay in the current file.

### Step 6: Identify Sections

Check for three types of dimensional variation:

**A. Explicit variant axes** (from `variantGroupProperties`):
- Size variants (Large/Medium/Small/XSmall)
- Shape variants (Rectangular/Rounded)

**B. Variable collection modes** (from `figma_get_variables`):
- Density modes (Compact/Default/Spacious)
- Theme modes if they affect dimensions

**C. Sub-components:**
- Each direct INSTANCE child of the variant (e.g., Label, Input, Hint text) is a sub-component that should get its own dedicated section documenting its full internal structure — padding, spacing, minHeight, text styles, icon sizes, and any nested child frames (like "Input text", "Leading content", "Trailing content"). Use both the baseline extraction data AND the deep exploration findings from Step 4d. Include sub-components discovered by enabling boolean toggles — even if they were hidden in the default state.

**D. Composition** (for compound components):
- Is this component composed of 2+ sub-components that have their own size variants?
- If yes, add a composition section first (see instruction file)

**E. State-conditional properties:**
- Does any state introduce new properties not present in the default state (e.g., inner border on focus)?
- Does any state change border/stroke visibility or weight compared to the default state?
- If yes to either, create a dedicated section for that state (see instruction file)

**F. Behavior/Configuration variants:**
- Does a variant axis control visual configuration (e.g., Static vs Interactive, Read-only vs Editable) rather than just size/density?
- Do the configurations look visibly different — different strokes/borders, different optional elements visible, different visual weight?
- If yes: use just the default configuration (e.g., Static) for the preview — one row of instances at each size is sufficient to illustrate the dimensional properties. If border/stroke differs between configurations, add a row documenting the difference. If dimensional values are otherwise identical, document them once with a note indicating the values apply to both configurations.

### Step 7: Apply Decision Framework

For each variant axis, ask:
- Do all variants have the **same properties**? → Columns
- Are differences **purely numeric**? → Columns
- Need **prose explanation**? → Separate section
- **Conditional properties**? → Separate section

### Step 8: Generate Structured Data

Follow the schema in the instruction file. Build the data as a structured object with:
- `componentName`: string
- `generalNotes`: string (optional)
- `sections`: array, each with:
  - `sectionName`: string
  - `sectionDescription`: string (optional)
  - `columns`: string[] (first is always "Spec" or "Composition", last is always "Notes")
  - `rows`: array, each with `spec`, `values` (array matching columns.length - 2), `notes`, optional `isSubProperty`, `isLastInGroup`

Ensure:
- First column is always "Spec" (or "Composition" for composition sections), last is always "Notes"
- `values` array length matches `columns.length - 2`
- Use `isSubProperty: true` for child properties

### Step 9: Audit

Re-read the instruction file, focusing on:
- **Common Mistakes** section
- **Do NOT** section
- **Property naming** (camelCase, include units)

Check your output against each rule. Fix any violations.

### Step 10: Import and Detach Template

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

### Step 11: Fill Header Fields

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

### Step 12: Render Sections (table + preview per section)

Process **one section at a time**, completing both the table and its preview before moving to the next section. For each section, perform sub-steps 12a, 12b, and 12c in order.

#### Step 12a: Determine preview parameters for this section

Before rendering, determine the preview configuration for the current section. This is **mandatory** — every section needs its own preview showing relevant variant instances.

**Preview parameter decision table:**

| Section type | `SUB_COMP_SET_ID` | `VARIANT_AXIS` | `COLUMN_VALUES` | `PROPERTY_OVERRIDES` | `SUB_COMP_OVERRIDES` | `TOKEN_MAPS` |
|---|---|---|---|---|---|---|
| **Size/variant** (columns are size names like Large, Medium, Small) | `''` | The axis name (e.g., `"Size"`) | Size names from the axis | `[]` | `[]` | Build from section rows |
| **Density** (columns are density modes from variable collections) | `''` | `''` | Mode names (e.g., `["Compact", "Default", "Spacious"]`) | `[]` | `[]` | Build from section rows |
| **Shape** (columns are shape variants) | `''` | The axis name (e.g., `"Shape"`) | Shape names from the axis | `[]` | `[]` | `[]` unless section has token-mapped rows |
| **Sub-component** (columns are size names showing a specific child) | The sub-component's own component set ID (recorded during Step 4d via `mainComponent.parent.id`) | The sub-component's size axis name (from its own component set's `variantGroupProperties`) | Size names from the sub-component's own size axis | `[]` | Boolean properties to enable on each sub-component instance so all internal children are visible (from `instance.componentProperties` discovered in Step 4d) | Build from section rows |
| **Composition** (columns show sub-component variant mappings) | `''` | `''` | Size names | Configure each column's specific property combination | `[]` | `[]` |
| **Behavior/Configuration** (columns are size names) | `''` | Size axis name | Size names from the axis | `[]` (use default configuration only) | `[]` | Build from section rows |
| **State-conditional** (columns show default vs active state) | `''` | `''` | State names | Set state variant property per column | `[]` | `[]` unless section has dimensional rows |

**Sub-component preview sourcing:** When `SUB_COMP_SET_ID` is non-empty, the preview script creates instances from the **sub-component's own component set** instead of the parent's `COMP_SET_ID`. This ensures sub-component section previews show the sub-component in isolation (e.g., four Label instances at different sizes) rather than four full parent component instances. The `SUB_COMP_OVERRIDES` parameter specifies boolean properties to enable on each sub-component instance after creation, so optional internal children (e.g., character count, status icon) are visible in the preview.

**Token map construction:**

For each column in the section, build a `tokenMap` object that maps Figma property names to their display string from the table row. This ensures annotation labels match exactly what the table shows (including token names where applicable).

The mapping from table `spec` names to Figma properties:

| Table spec name | Figma property in tokenMap |
|---|---|
| `horizontalPadding` | `paddingLeft` AND `paddingRight` (set both to the same value) |
| `verticalPadding` | `paddingTop` AND `paddingBottom` (set both to the same value) |
| `paddingTop` | `paddingTop` |
| `paddingBottom` | `paddingBottom` |
| `paddingStart` / `paddingLeft` | `paddingLeft` |
| `paddingEnd` / `paddingRight` | `paddingRight` |
| `contentSpacing` / `itemSpacing` / `gapBetween` / `iconLabelSpacing` | `itemSpacing` |

For each section row, look up the row's `spec` in this mapping. For each value column index `i`, set `tokenMaps[i][figmaProp] = row.values[i]`. If a spec name maps to two Figma properties (e.g., `horizontalPadding` → `paddingLeft` + `paddingRight`), set both keys.

If the section has no padding or spacing rows, set `TOKEN_MAPS` to `[]`. The recursive tree walker will still annotate padding, spacing, and min/max constraints it discovers, using raw numeric values as labels.

#### Step 12b: Render the table

Run **one `figma_execute` call** for this section's table. Replace all `__PLACEHOLDER__` values with actual data.

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

#### Step 12c: Populate this section's preview

**Immediately after** the table is rendered for this section, populate its `#Preview` frame with annotated component instances. Use the preview parameters determined in Step 12a.

Replace the following placeholders with the values from Step 12a:

- `__FRAME_ID__` — the root frame ID from Step 10
- `__SECTION_NAME__` — the section name (same as used in 12b)
- `__COMP_SET_NODE_ID__` — the component set (or standalone component) node ID
- `__SUB_COMP_SET_NODE_ID__` — the sub-component's own component set ID from Step 4d (empty string `''` for non-sub-component sections)
- `__DEFAULT_PROPS_JSON__` — object mapping all variant axis names to their default values (from `variantAxes` in Step 4b extraction). When `SUB_COMP_SET_ID` is non-empty, use the sub-component's own variant axes defaults instead.
- `__VARIANT_AXIS__` — from the decision table in Step 12a
- `__COLUMN_VALUES_JSON__` — from the decision table in Step 12a
- `__PROPERTY_OVERRIDES_JSON__` — from the decision table in Step 12a
- `__SUB_COMP_OVERRIDES_JSON__` — object mapping sub-component boolean property keys to `true`, from Step 4d (empty object `{}` for non-sub-component sections)
- `__TOKEN_MAPS_JSON__` — from the token map construction in Step 12a

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

await figma.loadFontAsync({ family: FONT_FAMILY, style: 'Medium' });

function labelText(tokenMap, prop, fallbackValue) {
  // Always include the property name in the label for readability: "paddingLeft (10)"
  const value = (tokenMap && tokenMap[prop] && tokenMap[prop] !== '–') ? tokenMap[prop] : String(fallbackValue);
  return prop + ' (' + value + ')';
}

function annotateNode(node, tokenMap, isRoot) {
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
      if (pT >= MIN_ANNOTATABLE) {
        figma.currentPage.addMeasurement(
          { node: node, side: 'TOP' }, { node: first, side: 'TOP' },
          { freeText: labelText(tokenMap, 'paddingTop', pT), offset: { type: 'OUTER', fixed: -20 } }
        );
      }
      if (pB >= MIN_ANNOTATABLE) {
        figma.currentPage.addMeasurement(
          { node: last, side: 'BOTTOM' }, { node: node, side: 'BOTTOM' },
          { freeText: labelText(tokenMap, 'paddingBottom', pB), offset: { type: 'OUTER', fixed: -20 } }
        );
      }
      if (pL >= MIN_ANNOTATABLE) {
        figma.currentPage.addMeasurement(
          { node: node, side: 'LEFT' }, { node: first, side: 'LEFT' },
          { freeText: labelText(tokenMap, 'paddingLeft', pL), offset: { type: 'OUTER', fixed: -20 } }
        );
      }
      if (pR >= MIN_ANNOTATABLE) {
        figma.currentPage.addMeasurement(
          { node: last, side: 'RIGHT' }, { node: node, side: 'RIGHT' },
          { freeText: labelText(tokenMap, 'paddingRight', pR), offset: { type: 'OUTER', fixed: -20 } }
        );
      }
    }

    const spacing = Math.round(node.itemSpacing || 0);
    if (spacing >= MIN_ANNOTATABLE && kids.length > 1) {
      const isH = node.layoutMode === 'HORIZONTAL';
      for (let ci = 0; ci < kids.length - 1; ci++) {
        figma.currentPage.addMeasurement(
          { node: kids[ci], side: isH ? 'RIGHT' : 'BOTTOM' },
          { node: kids[ci + 1], side: isH ? 'LEFT' : 'TOP' },
          { freeText: labelText(tokenMap, 'itemSpacing', spacing), offset: { type: 'OUTER', fixed: 10 } }
        );
      }
    }
  }

  if (node.minWidth > 0) {
    figma.currentPage.addMeasurement(
      { node: node, side: 'LEFT' }, { node: node, side: 'RIGHT' },
      { freeText: labelText(tokenMap, 'minWidth', 'min ' + node.minWidth), offset: { type: 'OUTER', fixed: 30 } }
    );
  }
  if (node.maxWidth > 0 && node.maxWidth < 10000) {
    figma.currentPage.addMeasurement(
      { node: node, side: 'LEFT' }, { node: node, side: 'RIGHT' },
      { freeText: labelText(tokenMap, 'maxWidth', 'max ' + node.maxWidth), offset: { type: 'OUTER', fixed: 30 } }
    );
  }
  if (node.minHeight > 0) {
    figma.currentPage.addMeasurement(
      { node: node, side: 'TOP' }, { node: node, side: 'BOTTOM' },
      { freeText: labelText(tokenMap, 'minHeight', 'min ' + node.minHeight), offset: { type: 'OUTER', fixed: 30 } }
    );
  }
  if (node.maxHeight > 0 && node.maxHeight < 10000) {
    figma.currentPage.addMeasurement(
      { node: node, side: 'TOP' }, { node: node, side: 'BOTTOM' },
      { freeText: labelText(tokenMap, 'maxHeight', 'max ' + node.maxHeight), offset: { type: 'OUTER', fixed: 30 } }
    );
  }

  if ('children' in node && (isRoot || node.type !== 'INSTANCE')) {
    for (const child of node.children) {
      annotateNode(child, tokenMap);
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

// IMPORTANT: Do NOT change the preview frame's layout properties (layoutMode,
// sizing, padding, etc.) — the template already defines the correct layout.
// Only set clipsContent to false so annotations outside bounds remain visible.
preview.clipsContent = false;

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

for (const { wrapper, entry } of wrappers) {
  if (entry._inst) {
    wrapper.layoutMode = 'NONE';
    annotateNode(entry._inst, entry.tokenMap, true);
  }
}

return { success: true, section: SECTION_NAME };
```

#### After all sections: hide the template

After processing all sections (each with 12a → 12b → 12c), hide the original `#section-template`:

```javascript
const frame = await figma.getNodeByIdAsync('__FRAME_ID__');
const sectionTemplate = frame.findOne(n => n.name === '#section-template');
if (sectionTemplate) sectionTemplate.visible = false;
return { success: true };
```

### Step 13: Visual Validation

1. `figma_take_screenshot` with the `frameId` — Capture the completed spec
2. Verify:
   - All sections are present with correct titles
   - Column headers match the expected variants/sizes
   - Row values are filled correctly
   - Hierarchy indicators (├─ / └─) appear on sub-properties
   - General notes are visible or hidden as expected
   - Each section's `#Preview` frame has at least one child instance and the instances are visible
   - **Preview layout**: Instances are placed inside the `#Preview` frame. Each instance has a label below it. The preview frame's layout properties (layoutMode, sizing, padding) are defined by the template and must NOT be overridden by the script — only `clipsContent` is set to `false` so annotations remain visible.
   - Column widths look balanced — the notes column is not crushed
   - **Padding measurements**: Native Figma measurement lines appear between every auto-layout container edge and its first/last visible child where padding >= 4px, across the full instance tree.
   - **Spacing measurements**: Native Figma measurement lines appear between consecutive visible siblings in every auto-layout container where itemSpacing >= 4px.
   - **Min/max constraints**: Measurement lines appear on any node with minWidth, maxWidth, minHeight, or maxHeight set, showing the constraint value.
   - **Measurement labels**: `freeText` labels always include the property name and value in the format `"propertyName (value)"` — e.g., `"paddingLeft (10)"`, `"itemSpacing (12)"`, `"minHeight (min 32)"`. When a `TOKEN_MAPS` entry exists, the value portion uses the token-enriched string (e.g., `"paddingLeft (spacing-md (16))"`). The property name prefix ensures annotations are self-descriptive when viewed on the canvas.
   - **INSTANCE boundary**: The entry-point instance is fully traversed (all internal frames and containers are annotated). Nested sub-component INSTANCE children are measured externally (e.g., their minHeight) but NOT recursed into — their internals are documented in their own specs.
   - **Minimum threshold**: No measurements appear for padding or spacing values below 4px.
   - **Sub-component preview correctness**: Sub-component section previews show instances from the sub-component's own component set (not the parent). Verify that the preview shows the sub-component in isolation (e.g., four Label instances at different sizes, not four full Text Field instances). If `SUB_COMP_OVERRIDES` was specified, verify that optional internal children (e.g., character count, icons) are visible on each preview instance.
   - **Behavior variant preview simplicity**: When a behavior/configuration axis exists (e.g., Static vs Interactive), the preview shows only the default configuration — one row of instances at each size. Do NOT duplicate instances for each configuration.
3. If issues are found, fix via `figma_execute` and re-capture (up to 3 iterations)

## Notes

- The structure template key is stored in `uspecs.config.json` under `templateKeys.structureSpec` and is configured via `@setup-library`.
- The target node can be either a `COMPONENT_SET` (multi-variant) or a standalone `COMPONENT` (single variant). The extraction script detects the type and returns `isComponentSet` accordingly. When the node is a standalone component, it is treated as a single-entry variants array and there are no variant axes. Preview instance creation in Step 12c uses `compNode.createInstance()` directly for standalone components.
- **Behavior/Configuration variant previews**: When a variant axis controls visual configuration (e.g., Static vs Interactive), the preview shows only the **default configuration** (e.g., Static) — one row of instances at each size is sufficient to illustrate dimensional properties. There is no need to duplicate instances for each configuration. If dimensional values are identical across configurations, document them once with a note. If a property like `borderWidth` differs, add it as a row in the table.
- **Hybrid exploration model**: The extraction script (Step 4b) provides a fast structured baseline — variant axes, dimensions, token bindings, and property definitions. Step 4d then adds free-form agent exploration to discover hidden sub-components, enable boolean toggles, and extract deeper internal structure. This combines deterministic extraction with the exploratory freedom needed for thorough sub-component analysis.
- **Two levels of boolean toggles**: The parent component's `propertyDefs` contains booleans that gate top-level sub-components (e.g., "Show hint text" on a Text Field). But each sub-component INSTANCE also has its own `componentProperties` with booleans that gate *internal* children (e.g., "Character count" and "Show icon" on a Label instance). The extraction script only captures `propertyDefs` from the parent component set — it does NOT capture sub-component instance properties. Step 4d MUST read `instance.componentProperties` on every INSTANCE child to discover these internal toggles. Missing this results in incomplete sections that omit optional internal elements like counters, status icons, and secondary text areas.
- The extraction script (Step 4b) selects representative variants (one per axis value at defaults for other axes) and walks their full child trees, extracting dimensions, padding, spacing, corner radius, layout properties, variable bindings (token names), text styles, and component property definitions. For a component with N axes each having V values, this extracts at most V1 + V2 + ... + Vn - (n-1) variants instead of V1 × V2 × ... × Vn. This keeps output size proportional to the axis cardinality sum rather than the axis cardinality product, preventing large-output failures while preserving full structural depth for sub-component analysis.
- The `propertyDefs` from extraction provide the exact Figma property keys (including `#nodeId` suffixes for booleans) that the agent can use when creating preview instances in Step 12c and during deep exploration in Step 4d.
- When the component is in a different file than the destination, run the extraction script in the component's file first, then navigate to the destination before importing the template.
- Dynamic columns: The `#variant-value` template in the header row and `#property-value-cell` in each data row are cloned once per value column, then the original template is removed. Clones are inserted before the Notes column to maintain correct column order. All value columns and the Notes column use `layoutSizingHorizontal = 'FILL'` so Figma's auto-layout distributes width equally across them. This guarantees header and data row columns align regardless of structural differences (e.g., the hierarchy indicator in data rows but not in the header).
- **Per-section rendering**: Step 12 processes one section at a time: determine preview parameters (12a), render table (12b), populate preview (12c). This keeps section-specific context fresh — the agent determines which variant axis, column values, property overrides, and token maps to use immediately before rendering each preview, preventing the context loss that occurs when all tables are rendered first and all previews second.
- Preview instances: Step 12c provides an explicit `figma_execute` script per section that creates labeled component instances inside each section's `#Preview` frame. It uses variant matching with fallback logic (exact match first, then best partial match) identical to create-property. The preview frame's layout properties are defined by the template and must NOT be overridden — the script only sets `clipsContent = false`. Each instance is wrapped in a vertical auto-layout frame containing the component instance and a label below it. All wrappers are appended to the preview. In the second pass, each wrapper is switched from `layoutMode = 'VERTICAL'` to `layoutMode = 'NONE'` — this freezes the instance and label at their laid-out positions — then annotations are applied.
- **Recursive tree walker**: The `annotateNode()` function walks the full visible subtree of each instance, creating native Figma measurements on every structurally significant node. This replaces the previous single-node annotation approach — no `ANNOTATE_PADDING`, `ANNOTATE_SPACING`, or `ANNOTATE_TARGET` params are needed.
- **INSTANCE recursion boundary**: The entry-point instance (the component variant being previewed) is always fully traversed — `annotateNode` is called with `isRoot = true`, which bypasses the INSTANCE type check for that node only. All nested INSTANCE children encountered during recursion are measured externally (e.g., their minHeight constraint) but NOT recursed into — their internals are documented in their own specs.
- **Sub-component preview sourcing**: When a section documents a sub-component (e.g., Label, Input, Hint Text), the preview script uses `SUB_COMP_SET_ID` to create instances from the **sub-component's own component set** rather than the parent's `COMP_SET_ID`. This shows the sub-component in isolation at each size, not the full parent component. The `SUB_COMP_OVERRIDES` parameter enables boolean properties on each sub-component instance so optional internal children (character counts, icons, etc.) are visible. When `SUB_COMP_SET_ID` is empty, the script falls back to the parent's component set (standard behavior for non-sub-component sections). The sub-component's component set ID and boolean overrides are recorded during Step 4d exploration via `getMainComponentAsync()` → `mainComponent.parent.id` and `instance.componentProperties`.
- **Native Figma measurements**: All dimension annotations use `figma.currentPage.addMeasurement()` — no drawn rectangles, overlays, or badge nodes. Each measurement uses `freeText` to display the label and `offset` to control line placement. Padding measurements use `{ type: 'OUTER', fixed: -20 }`, spacing measurements use `{ type: 'OUTER', fixed: 10 }`, and min/max constraint measurements use `{ type: 'OUTER', fixed: 30 }`. Measurements stay anchored to their endpoint nodes, so they remain correct if the component is resized.
- **Padding measurements**: Created between auto-layout container edges and first/last visible children. For each side (top, bottom, left, right) where padding >= 4px, one `addMeasurement()` call is made.
- **Spacing measurements**: Created between consecutive visible siblings within auto-layout containers. For horizontal layouts: childA RIGHT → childB LEFT. For vertical layouts: childA BOTTOM → childB TOP.
- **Min/max constraint measurements**: Created on any node with `minWidth`, `maxWidth`, `minHeight`, or `maxHeight` set. Width constraints use LEFT→RIGHT endpoints; height constraints use TOP→BOTTOM. Labels show "min X" or "max X" as fallback, or the token-mapped display string if available.
- **Minimum annotation threshold**: Measurements are skipped when the padding or spacing value is less than 4px. This prevents cluttered annotations on components with very tight spacing.
- **Token map (optional enrichment)**: The `TOKEN_MAPS` parameter bridges the table data and the annotation labels. For each column, the agent builds a `{ figmaProp: displayString }` object from the section's rows so that annotation labels include the token-enriched value string. Labels always use the format `"propertyName (value)"` — e.g., `"paddingLeft (spacing-md (16))"` when a token map entry exists, or `"paddingLeft (16)"` when falling back to raw values. When `TOKEN_MAPS` is `[]` or a property has no entry, the walker uses `"propertyName (numericValue)"`. The mapping from table spec names (like `horizontalPadding`) to Figma properties (like `paddingLeft` + `paddingRight`) is documented in the token map construction guide in Step 12a.
- Hierarchy indicators: The `#hierarchy-indicator` frame contains two child vectors — `within-group` (├─) for mid-group rows and `#hierarchy-indicator-last` (└─) for the last row in a group. For non-sub-properties, the entire frame is hidden.
- Each section is rendered in a separate `figma_execute` call to avoid timeouts on complex specs with many rows and columns.
- The instruction file (`structure/agent-structure-instruction.md`) contains the decision framework, examples, and field rules for organizing sections and columns. The agent reasons internally using this guidance and renders directly into Figma — no JSON is output.
