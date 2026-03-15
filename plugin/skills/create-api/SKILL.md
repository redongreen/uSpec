---
name: create-api
description: Generate API overview specifications documenting component properties, values, defaults, and configuration examples. Use when the user mentions "api", "api spec", "props", "properties", "component api", or wants to document a component's configurable properties.
---

# Create API Overview

Generate an API overview directly in Figma — property tables with values, defaults, required status, sub-component tables, and configuration examples.

## Inputs Expected

- **Figma link**: URL to a component set or standalone component in Figma (preferred)
- **Screenshot**: Image of the UI component (alternative if no Figma link)
- **Description** (optional): Component name, specific properties to document, sub-components

## Workflow

Copy this checklist and update as you progress:

```
Task Progress:
- [ ] Step 1: Read instruction file
- [ ] Step 2: Verify MCP connection (if Figma link provided)
- [ ] Step 3: Read template key from uspecs.config.json
- [ ] Step 4: Gather context (MCP tools + user-provided input)
- [ ] Step 4b: Run extraction script for deterministic property identification
- [ ] Step 5: Identify properties and sub-components
- [ ] Step 6: Generate structured data (main table, sub-component tables, config examples)
- [ ] Step 7: Re-read instruction file (Pre-Output Validation Checklist, Common Mistakes, Do NOT) and audit
- [ ] Step 8: Import and detach the API template
- [ ] Step 9: Fill header fields
- [ ] Step 10: Fill main API table
- [ ] Step 11: Fill sub-component tables (if any)
- [ ] Step 12: Fill configuration examples
- [ ] Step 13: Visual validation
```

### Step 1: Read Instructions

Read [agent-api-instruction.md](../../api/agent-api-instruction.md)

### Step 2: Verify MCP Connection

If a Figma link is provided, verify the connection:
- `figma_get_status` — Confirm Figma Desktop is running with debug flag and Desktop Bridge plugin is active

If connection fails, guide user through setup before proceeding.

### Step 3: Read Template Key

Read the file `uspecs.config.json` and extract the `apiOverview` value from the `templateKeys` object.

Save this key as `API_TEMPLATE_KEY`. If the key is empty, tell the user:
> The API overview template key is not configured. Run `@setup-library` with your Figma template library link first.

### Step 4: Gather Context

Use ALL available sources to maximize context:

**From user:**
- Any screenshots or images provided
- Component description and context
- Specific properties or sub-components to document

**From MCP tools (when Figma link provided):**
1. `figma_navigate` — Open the component URL
2. `figma_take_screenshot` — Capture the component and its variants
3. `figma_get_file_data` — Get component set structure with variant axes
4. `figma_get_component` — Get detailed component data for specific instance
5. `figma_get_component_for_development` — Get component data with visual reference
6. `figma_get_variables` — Check for variable mode-controlled properties (shape, density)
7. `figma_search_components` — Find component by name if needed

### Step 4b: Run Extraction Script

When a Figma link is provided, run this extraction script via `figma_execute` to programmatically extract all component properties. Replace `__NODE_ID__` with the component set node ID extracted from the URL (`node-id=123-456` → `123:456`):

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
    let swapTargetName = null;
    if (def.defaultValue) {
      try {
        const targetNode = await figma.getNodeByIdAsync(def.defaultValue);
        if (targetNode) swapTargetName = targetNode.name;
      } catch {}
    }
    instanceSwapProps.push({
      name: cleanKey,
      defaultValue: swapTargetName || def.defaultValue,
      rawKey
    });
  }
}

const defaultVariant = isComponentSet ? (node.defaultVariant || node.children[0]) : node;
const defaultProps = { ...(defaultVariant.variantProperties || {}) };

const variantAxesObj = {};
if (isComponentSet && node.variantGroupProperties) {
  for (const [key, val] of Object.entries(node.variantGroupProperties)) {
    variantAxesObj[key] = val.values;
  }
}

return {
  componentName: node.name,
  compSetNodeId: TARGET_NODE_ID,
  isComponentSet,
  variantAxes,
  booleanProps,
  instanceSwapProps,
  variantAxesObj,
  defaultProps,
  defaultVariantName: defaultVariant.name
};
```

Save the returned JSON. This provides:
- `compSetNodeId` — needed for creating live preview instances in configuration examples (Step 12)
- `variantAxes` — each axis with `name`, `options`, and `defaultValue` for populating the main property table
- `booleanProps` — each boolean with `name`, `defaultValue`, `associatedLayer`, and `rawKey` (the exact Figma key including `#nodeId` suffix for `setProperties()`)
- `instanceSwapProps` — each instance swap with `name`, `defaultValue`, and `rawKey`
- `defaultProps` — default variant property values for variant matching in configuration examples
- `defaultVariantName` — for fallback identification

Use this structured data in Step 5 to identify properties deterministically rather than relying solely on MCP tool interpretation.

### Step 5: Identify Properties

Using gathered context and the extraction data from Step 4b, identify:

**A. Variant properties** from Figma axes (size, type, state, hierarchy, etc.)

**B. Boolean toggles** from instance inspection (isElevated, hasIcon, etc.)

**C. Variable mode properties** (shape, density) from `figma_get_variables`

**D. Sub-component configurations:**
- **Slot content types:** Does a slot have multiple interchangeable options (e.g., leading content can be icon, avatar, image)? → Pattern A sub-component tables
- **Fixed sub-components:** Is this a compound component composed of 2+ always-present children that each have configurable properties (e.g., Text Field = Label + Input + Hint)? → Pattern B sub-component tables

### Step 6: Generate Structured Data

Follow the schema in the instruction file. Build the data as a structured object with:
- `componentName`: string
- `generalNotes`: string (optional)
- `mainTable`: object with `properties` array, each with `property`, `values`, `required` (boolean), `default`, `notes`, optional `isSubProperty`
- `subComponentTables`: array (optional), each with `name`, `description` (optional), `properties` array (each with `property`, `values`, `required`, `default`, `notes`, optional `isSubProperty`)
- `configurationExamples`: array (1-4), each with `title`, `variantProperties` (object mapping Figma variant/boolean property keys to values for instantiating the component preview), `properties` array (each with `property`, `value`, `notes`)

### Step 7: Audit

Re-read the instruction file, focusing on:
- **Pre-Output Validation Checklist** — walk through each checkbox
- **Common Mistakes** section
- **Do NOT** section
- **Property Naming** conventions (camelCase, engineer-friendly)

Check your output against each rule. Fix any violations.

### Step 8: Import and Detach Template

Run via `figma_execute` (replace `__API_TEMPLATE_KEY__` and `__COMPONENT_NAME__`):

```javascript
const TEMPLATE_KEY = '__API_TEMPLATE_KEY__';

const templateComponent = await figma.importComponentByKeyAsync(TEMPLATE_KEY);
const instance = templateComponent.createInstance();
const { x, y } = figma.viewport.center;
instance.x = x - instance.width / 2;
instance.y = y - instance.height / 2;
const frame = instance.detachInstance();
frame.name = '__COMPONENT_NAME__ API';
figma.currentPage.selection = [frame];
figma.viewport.scrollAndZoomIntoView([frame]);
return { frameId: frame.id };
```

Save the returned `frameId` — you need it for all subsequent steps.

### Step 9: Fill Header Fields

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

const notesFrame = frame.findOne(n => n.name === '#general-api-notes');
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

### Step 10: Fill Main API Table

Run via `figma_execute`. Replace `__FRAME_ID__` and `__PROPERTIES_JSON__` with the main table properties array.

```javascript
const FRAME_ID = '__FRAME_ID__';
const PROPERTIES = __PROPERTIES_JSON__;

const frame = await figma.getNodeByIdAsync(FRAME_ID);
const mainTable = frame.findOne(n => n.name === '#main-api-table');
const rowTemplate = mainTable.findOne(n => n.name === '#api-row-template');

const textNodes = mainTable.findAll(n => n.type === 'TEXT');
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

for (const prop of PROPERTIES) {
  const row = rowTemplate.clone();
  mainTable.appendChild(row);
  row.name = 'Row ' + prop.property;

  const nameFrame = row.findOne(n => n.name === '#property-name');
  if (nameFrame) {
    const t = nameFrame.findOne(n => n.type === 'TEXT');
    if (t) t.characters = prop.property;
  }

  const valuesFrame = row.findOne(n => n.name === '#property-values');
  if (valuesFrame) {
    const t = valuesFrame.findOne(n => n.type === 'TEXT');
    if (t) t.characters = prop.values;
  }

  const requiredFrame = row.findOne(n => n.name === '#property-required');
  if (requiredFrame) {
    const t = requiredFrame.findOne(n => n.type === 'TEXT');
    if (t) t.characters = prop.required ? 'Yes' : 'No';
  }

  const defaultFrame = row.findOne(n => n.name === '#property-default');
  if (defaultFrame) {
    const t = defaultFrame.findOne(n => n.type === 'TEXT');
    if (t) t.characters = prop.default;
  }

  const notesFrame = row.findOne(n => n.name === '#property-notes');
  if (notesFrame) {
    const t = notesFrame.findOne(n => n.type === 'TEXT');
    if (t) t.characters = prop.notes;
  }

  // Handle hierarchy indicator for sub-properties
  const hierarchyIndicator = row.findOne(n => n.name === '#hierarchy-indicator');
  if (hierarchyIndicator) {
    hierarchyIndicator.visible = !!prop.isSubProperty;
  }
}

rowTemplate.remove();
return { success: true };
```

### Step 11: Fill Sub-component Tables

If there are sub-component tables, run **one `figma_execute` call per sub-component** to avoid timeouts. If there are NO sub-component tables, run a single call to hide the template.

#### 11a: When sub-components exist

For each sub-component table, run:

```javascript
const FRAME_ID = '__FRAME_ID__';
const SUB_NAME = '__SUBCOMPONENT_NAME__';
const SUB_DESCRIPTION = '__SUBCOMPONENT_DESCRIPTION__';
const HAS_DESCRIPTION = __HAS_DESCRIPTION__;
const SUB_PROPERTIES = __SUBCOMPONENT_PROPERTIES_JSON__;

const frame = await figma.getNodeByIdAsync(FRAME_ID);
const subTemplate = frame.findOne(n => n.name === '#subcomponent-chapter-template');

const section = subTemplate.clone();
subTemplate.parent.appendChild(section);
section.name = SUB_NAME;
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

// Set sub-component title
const titleFrame = section.findOne(n => n.name === '#subcomponent-title');
if (titleFrame) {
  const t = titleFrame.findOne(n => n.type === 'TEXT');
  if (t) t.characters = SUB_NAME;
}

// Set description (optional)
const descFrame = section.findOne(n => n.name === '#subcomponent-description');
if (descFrame) {
  if (!HAS_DESCRIPTION) {
    descFrame.visible = false;
  } else {
    const t = descFrame.findOne(n => n.type === 'TEXT');
    if (t) t.characters = SUB_DESCRIPTION;
  }
}

// Fill sub-component table
const subTable = section.findOne(n => n.name === '#subcomponent-table');
const rowTemplate = subTable.findOne(n => n.name === '#subcomponent-row-template');

for (const prop of SUB_PROPERTIES) {
  const row = rowTemplate.clone();
  subTable.appendChild(row);
  row.name = 'Row ' + prop.property;

  const nameFrame = row.findOne(n => n.name === '#subprop-name');
  if (nameFrame) {
    const t = nameFrame.findOne(n => n.type === 'TEXT');
    if (t) t.characters = prop.property;
  }

  const valuesFrame = row.findOne(n => n.name === '#subprop-values');
  if (valuesFrame) {
    const t = valuesFrame.findOne(n => n.type === 'TEXT');
    if (t) t.characters = prop.values;
  }

  const requiredFrame = row.findOne(n => n.name === '#subprop-required');
  if (requiredFrame) {
    const t = requiredFrame.findOne(n => n.type === 'TEXT');
    if (t) t.characters = prop.required ? 'Yes' : 'No';
  }

  const defaultFrame = row.findOne(n => n.name === '#subprop-default');
  if (defaultFrame) {
    const t = defaultFrame.findOne(n => n.type === 'TEXT');
    if (t) t.characters = prop.default;
  }

  const notesFrame = row.findOne(n => n.name === '#subprop-notes');
  if (notesFrame) {
    const t = notesFrame.findOne(n => n.type === 'TEXT');
    if (t) t.characters = prop.notes;
  }

  const hierarchyIndicator = row.findOne(n => n.name === '#subprop-hierarchy-indicator');
  if (hierarchyIndicator) {
    hierarchyIndicator.visible = !!prop.isSubProperty;
  }
}

rowTemplate.remove();
return { success: true, subComponent: SUB_NAME };
```

After all sub-component tables are rendered, hide the original template:

```javascript
const frame = await figma.getNodeByIdAsync('__FRAME_ID__');
const subTemplate = frame.findOne(n => n.name === '#subcomponent-chapter-template');
if (subTemplate) subTemplate.visible = false;
return { success: true };
```

#### 11b: When no sub-components exist

Hide the template:

```javascript
const frame = await figma.getNodeByIdAsync('__FRAME_ID__');
const subTemplate = frame.findOne(n => n.name === '#subcomponent-chapter-template');
if (subTemplate) subTemplate.visible = false;
return { success: true };
```

### Step 12: Fill Configuration Examples

Run **one `figma_execute` call per configuration example** to avoid timeouts.

For each example, run (replace `__FRAME_ID__`, `__EXAMPLE_TITLE__`, `__COMPONENT_SET_NODE_ID__`, `__VARIANT_PROPERTIES_JSON__`, and `__EXAMPLE_PROPERTIES_JSON__`):

- `__VARIANT_PROPERTIES_JSON__` is an object mapping **Figma property keys** (exactly as returned by `componentPropertyDefinitions`) to values. This is used to instantiate and configure the live component preview. Include variant axes and boolean toggles needed for the example.

```javascript
const FRAME_ID = '__FRAME_ID__';
const EXAMPLE_TITLE = '__EXAMPLE_TITLE__';
const COMPONENT_SET_ID = '__COMPONENT_SET_NODE_ID__';
const VARIANT_PROPS = __VARIANT_PROPERTIES_JSON__;
const EXAMPLE_PROPERTIES = __EXAMPLE_PROPERTIES_JSON__;

const frame = await figma.getNodeByIdAsync(FRAME_ID);
const exampleTemplate = frame.findOne(n => n.name === '#config-example-chapter-template');

const section = exampleTemplate.clone();
exampleTemplate.parent.appendChild(section);
section.name = EXAMPLE_TITLE;
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

// Set example title
const titleFrame = section.findOne(n => n.name === '#example-title');
if (titleFrame) {
  const t = titleFrame.findOne(n => n.type === 'TEXT');
  if (t) t.characters = EXAMPLE_TITLE;
}

// Place live component instance in the Preview frame
const preview = section.findOne(n => n.name === 'Preview');
if (preview) {
  // Remove the asset description text placeholder
  const assetDesc = preview.findOne(n => n.name === '#example-asset-description');
  if (assetDesc) assetDesc.remove();

  // Instantiate component and configure variant/boolean properties
  const compNode = await figma.getNodeByIdAsync(COMPONENT_SET_ID);
  const defaultVariant = compNode.type === 'COMPONENT_SET'
    ? (compNode.defaultVariant || compNode.children[0])
    : compNode;
  const instance = defaultVariant.createInstance();
  if (Object.keys(VARIANT_PROPS).length > 0) {
    instance.setProperties(VARIANT_PROPS);
  }
  preview.appendChild(instance);
  instance.layoutAlign = 'INHERIT';
}

// Fill example table
const exampleTable = section.findOne(n => n.name === '#example-table');
const rowTemplate = exampleTable.findOne(n => n.name === '#example-row-template');

for (const prop of EXAMPLE_PROPERTIES) {
  const row = rowTemplate.clone();
  exampleTable.appendChild(row);
  row.name = 'Row ' + prop.property;

  const nameFrame = row.findOne(n => n.name === '#example-prop-name');
  if (nameFrame) {
    const t = nameFrame.findOne(n => n.type === 'TEXT');
    if (t) t.characters = prop.property;
  }

  const valueFrame = row.findOne(n => n.name === '#example-prop-value');
  if (valueFrame) {
    const t = valueFrame.findOne(n => n.type === 'TEXT');
    if (t) t.characters = prop.value;
  }

  const notesFrame = row.findOne(n => n.name === '#example-prop-notes');
  if (notesFrame) {
    const t = notesFrame.findOne(n => n.type === 'TEXT');
    if (t) t.characters = prop.notes;
  }
}

rowTemplate.remove();
return { success: true, example: EXAMPLE_TITLE };
```

After all examples are rendered, hide the original template:

```javascript
const frame = await figma.getNodeByIdAsync('__FRAME_ID__');
const exampleTemplate = frame.findOne(n => n.name === '#config-example-chapter-template');
if (exampleTemplate) exampleTemplate.visible = false;
return { success: true };
```

### Step 13: Visual Validation

1. `figma_take_screenshot` with the `frameId` — Capture the completed spec
2. Verify:
   - Main property table has all properties with correct values, required status, and defaults
   - Hierarchy indicators appear on sub-properties
   - Sub-component tables are present (or hidden if none)
   - Configuration examples show correct property/value pairs
   - Each configuration example Preview frame contains a live component instance (no text description)
   - General notes are visible or hidden as expected
3. If issues are found, fix via `figma_execute` and re-capture (up to 3 iterations)

## Notes

- The API overview template key is stored in `uspecs.config.json` under `templateKeys.apiOverview` and is configured via `@setup-library`.
- Conditional sub-components: If `subComponentTables` is empty or absent, the `#subcomponent-chapter-template` is hidden. If present, each sub-component gets its own cloned section with its own property table.
- Hierarchy indicators: Both the main table (`#hierarchy-indicator`) and sub-component tables (`#subprop-hierarchy-indicator`) support `isSubProperty` for indented child rows.
- Configuration examples: Each example has a title, a Preview frame containing a live component instance configured with the example's variant/boolean properties, and a property/value table. The `#example-asset-description` text placeholder is removed and replaced by the actual component instance. Examples are rendered as separate cloned sections from `#config-example-chapter-template`.
- The target node can be either a `COMPONENT_SET` (multi-variant) or a standalone `COMPONENT` (single variant). The extraction script detects the type and returns `isComponentSet` accordingly. When the node is a standalone component, there are no variant axes — only boolean, instance swap, and variable mode properties apply. Instance creation in Step 12 uses `compNode.createInstance()` directly for standalone components.
- The extraction script (Step 4b) programmatically reads `componentPropertyDefinitions` from the component set or component, capturing all variant axes (with options and defaults), boolean toggles (with associated layer names and raw keys), and instance swap properties. This structured data makes property identification in Step 5 deterministic rather than relying solely on LLM interpretation of MCP tool output. The `rawKey` values (including `#nodeId` suffixes) are needed for `setProperties()` when creating configuration example previews in Step 12.
- The instruction file (`api/agent-api-instruction.md`) contains the JSON schema, examples, and property classification rules. The AI reasoning for property identification is unchanged — only the delivery mechanism has changed.
