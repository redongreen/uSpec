---
name: create-api
description: Generate API overview specifications documenting component properties, values, defaults, and configuration examples. Use when the user mentions "api", "api spec", "props", "properties", "component api", or wants to document a component's configurable properties.
---

# Create API Overview

Generate an API overview directly in Figma — property tables with values, defaults, required status, sub-component tables, and configuration examples.

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
- [ ] Step 4c: Build working evidence set (raw facts before interpretation)
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

Read [agent-api-instruction.md]({{ref:api/agent-api-instruction.md}})

### Step 2: Verify MCP Connection

If a Figma link is provided, read `mcpProvider` from `uspecs.config.json` and verify the connection:

**If `figma-console`:**
- `figma_get_status` — Confirm Desktop Bridge plugin is active
- If connection fails: *"Please open Figma Desktop and run the Desktop Bridge plugin. Then try again."*

**If `figma-mcp`:**
- Connection is verified implicitly on the first `use_figma` call. No explicit check needed.
- If the first call fails: *"Please verify your FIGMA_API_KEY is set correctly in your MCP configuration."*

### Step 3: Read Template Key

Read the file `uspecs.config.json` and extract the `apiOverview` value from the `templateKeys` object.

Save this key as `API_TEMPLATE_KEY`. If the key is empty, tell the user:
> The API overview template key is not configured. Run {{skill:firstrun}} with your Figma template library link first.

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
6. `figma_get_variables` — Check for variable mode-controlled properties (shape, density). Treat this as required deterministic input, not an optional enrichment step.
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
const slotProps = [];
const relevantVariableCollections = [];
const ownershipHints = [];

for (const [rawKey, def] of Object.entries(propDefs)) {
  const cleanKey = rawKey.split('#')[0];
  if (def.type === 'VARIANT') {
    variantAxes.push({
      name: cleanKey,
      options: def.variantOptions || [],
      defaultValue: def.defaultValue
    });
    ownershipHints.push({
      propertyName: cleanKey,
      evidenceType: 'rootVariant',
      sourceNodeName: node.name,
      sourceLayerName: null,
      suggestedExposure: 'parent',
      rationale: 'Defined on the component set as a variant axis.'
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
    ownershipHints.push({
      propertyName: cleanKey,
      evidenceType: 'rootBoolean',
      sourceNodeName: node.name,
      sourceLayerName: associatedLayer,
      suggestedExposure: associatedLayer ? 'parent_or_child' : 'parent',
      rationale: associatedLayer
        ? 'Defined on the root component but associated with a specific layer or child.'
        : 'Defined directly on the root component.'
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
    ownershipHints.push({
      propertyName: cleanKey,
      evidenceType: 'rootInstanceSwap',
      sourceNodeName: node.name,
      sourceLayerName: null,
      suggestedExposure: 'parent',
      rationale: 'Defined on the root component as an instance swap.'
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
      rawKey,
      defaultChildren: []
    });
    ownershipHints.push({
      propertyName: cleanKey,
      evidenceType: 'rootSlot',
      sourceNodeName: node.name,
      sourceLayerName: null,
      suggestedExposure: 'parent',
      rationale: 'Defined on the root component as a slot selector.'
    });
  }
}

const defaultVariant = isComponentSet ? (node.defaultVariant || node.children[0]) : node;
const defaultProps = { ...(defaultVariant.variantProperties || {}) };

// Read default children of SLOT nodes for contextual overrides
if (slotProps.length > 0) {
  const allSlotNodes = defaultVariant.findAll ? defaultVariant.findAll(n => n.type === 'SLOT') : [];
  for (const slotNode of allSlotNodes) {
    const cpRefs = slotNode.componentPropertyReferences || {};
    const matchingSlot = slotProps.find(sp => {
      const refKey = Object.values(cpRefs)[0];
      if (refKey && refKey.split('#')[0] === sp.name) return true;
      return sp.name === slotNode.name;
    });
    if (matchingSlot && slotNode.children) {
      for (const child of slotNode.children) {
        if (child.type === 'INSTANCE') {
          const mainComp = await child.getMainComponentAsync();
          const overrides = {};
          if (child.componentProperties) {
            for (const [k, v] of Object.entries(child.componentProperties)) {
              overrides[k.split('#')[0]] = v.value;
            }
          }
          matchingSlot.defaultChildren.push({
            componentName: mainComp ? mainComp.name : child.name,
            componentKey: mainComp ? mainComp.key : '',
            contextualOverrides: overrides
          });
        }
      }
    }
  }
}

// Read composable children for components that don't use native SLOT nodes
const composableChildren = [];
if (slotProps.length === 0 && defaultVariant.children) {
  for (const child of defaultVariant.children) {
    if (child.type === 'INSTANCE') {
      const mainComp = await child.getMainComponentAsync();
      const overrides = {};
      if (child.componentProperties) {
        for (const [k, v] of Object.entries(child.componentProperties)) {
          overrides[k.split('#')[0]] = v.value;
        }
      }
      composableChildren.push({
        componentName: mainComp ? mainComp.name : child.name,
        componentKey: mainComp ? mainComp.key : '',
        contextualOverrides: overrides
      });
      for (const key of Object.keys(overrides)) {
        ownershipHints.push({
          propertyName: key,
          evidenceType: 'childOverride',
          sourceNodeName: mainComp ? mainComp.name : child.name,
          sourceLayerName: child.name,
          suggestedExposure: 'child_or_parent',
          rationale: 'Observed as a contextual override on a fixed child instance.'
        });
      }
    } else if (child.children) {
      for (const grandchild of child.children) {
        if (grandchild.type === 'INSTANCE') {
          const mainComp = await grandchild.getMainComponentAsync();
          const overrides = {};
          if (grandchild.componentProperties) {
            for (const [k, v] of Object.entries(grandchild.componentProperties)) {
              overrides[k.split('#')[0]] = v.value;
            }
          }
          composableChildren.push({
            componentName: mainComp ? mainComp.name : grandchild.name,
            componentKey: mainComp ? mainComp.key : '',
            contextualOverrides: overrides,
            parentLayer: child.name
          });
          for (const key of Object.keys(overrides)) {
            ownershipHints.push({
              propertyName: key,
              evidenceType: 'childOverride',
              sourceNodeName: mainComp ? mainComp.name : grandchild.name,
              sourceLayerName: child.name,
              suggestedExposure: 'child_or_parent',
              rationale: 'Observed as a contextual override on a nested child instance.'
            });
          }
        }
      }
    }
  }
}

const variantAxesObj = {};
if (isComponentSet && node.variantGroupProperties) {
  for (const [key, val] of Object.entries(node.variantGroupProperties)) {
    variantAxesObj[key] = val.values;
  }
}

const textNodeMap = [];
const allTextNodes = defaultVariant.findAll ? defaultVariant.findAll(n => n.type === 'TEXT') : [];
for (const tn of allTextNodes) {
  textNodeMap.push({
    name: tn.name,
    characters: tn.characters,
    parentName: tn.parent ? tn.parent.name : null
  });
  ownershipHints.push({
    propertyName: tn.name,
    evidenceType: 'textNode',
    sourceNodeName: node.name,
    sourceLayerName: tn.parent ? tn.parent.name : null,
    suggestedExposure: 'child_or_parent',
    rationale: 'Observed as visible text in the default variant.'
  });
}

const componentWords = node.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const collections = await figma.variables.getLocalVariableCollectionsAsync();
for (const collection of collections) {
  const nameLower = collection.name.toLowerCase();
  const matchesComponentName = componentWords.some(w => w.length > 2 && nameLower.includes(w));
  const matchesGenericProperty = /(density|shape|size|spacing|radius|tone|color|state|variant)/i.test(collection.name);
  if (!matchesComponentName && !matchesGenericProperty) continue;
  relevantVariableCollections.push({
    name: collection.name,
    modes: collection.modes.map(mode => mode.name)
  });
  ownershipHints.push({
    propertyName: collection.name,
    evidenceType: 'variableMode',
    sourceNodeName: node.name,
    sourceLayerName: null,
    suggestedExposure: 'parent',
    rationale: 'Relevant variable collection with multiple modes that may affect the component contract.'
  });
}

return {
  componentName: node.name,
  compSetNodeId: TARGET_NODE_ID,
  isComponentSet,
  variantAxes,
  booleanProps,
  instanceSwapProps,
  slotProps,
  composableChildren,
  relevantVariableCollections,
  ownershipHints,
  variantAxesObj,
  defaultProps,
  defaultVariantName: defaultVariant.name,
  textNodeMap
};
```

Save the returned JSON. This provides:
- `compSetNodeId` — needed for creating live preview instances in configuration examples (Step 12)
- `variantAxes` — each axis with `name`, `options`, and `defaultValue` for populating the main property table
- `booleanProps` — each boolean with `name`, `defaultValue`, `associatedLayer`, and `rawKey` (the exact Figma key including `#nodeId` suffix for `setProperties()`)
- `instanceSwapProps` — each instance swap with `name`, `defaultValue`, and `rawKey`
- `slotProps` — each native SLOT property with `name`, `description`, `preferredInstances` (approved components for the slot), and `defaultChildren` (instances found in the slot with their `contextualOverrides` — property values set by the designer that may differ from the component's standalone defaults)
- `composableChildren` — for components that don't use native SLOT nodes: child INSTANCE nodes found in the default variant, each with `componentName`, `componentKey`, `contextualOverrides`, and optional `parentLayer` (the containing frame name). Empty when `slotProps` is populated.
- `relevantVariableCollections` — variable collections whose names suggest they may affect the component (for example component-specific shape/density collections or global density collections), each with `name` and `modes`
- `ownershipHints` — deterministic ownership cues gathered from root properties, child overrides, text nodes, and variable collections. These are hints for reasoning, not the final API ownership decision.
- `defaultProps` — default variant property values for variant matching in configuration examples
- `defaultVariantName` — for fallback identification
- `textNodeMap` — array of `{ name, characters, parentName }` for every TEXT node in the default variant. Use the `name` field (not `parentName`) as the key in `textOverrides` and `slotInsertions[].textOverrides`. This eliminates guessing layer names from frame structure or design context output. Layer names are case-sensitive.

Use this structured data in Step 5 to identify properties deterministically rather than relying solely on MCP tool interpretation. These fields are **facts**, not the final API. Do not copy raw Figma structures through verbatim when the engineer-facing API should be more semantic. When building sub-component tables (Pattern A or B), use `slotProps.defaultChildren.contextualOverrides` or `composableChildren.contextualOverrides` to populate the `default` column with context-specific values rather than the component's global defaults.

When building configuration examples (Step 12), use `slotProps` to populate `slotInsertions`: the slot name comes from `slotProps[].name` (e.g., `"trailing content slot"`), and the `componentNodeId` comes from the preferred instance node IDs discovered during Step 4 context gathering (e.g., the node IDs returned for trailing preferred instances). Use `textOverrides` for any text values shown in the example table that differ from the component's default text — look up the exact TEXT node layer name from `textNodeMap` (e.g., if `textNodeMap` shows `{ name: "section heading", characters: "Section heading", parentName: "title" }`, use `"section heading"` as the key, not `"title"`).

### Step 4c: Build Working Evidence Set

Before reasoning about the API, assemble a working evidence set from Step 4 and Step 4b. Keep deterministic evidence separate from interpretation.

Your working evidence set should include:
- raw variant axes and values,
- raw boolean, enum, slot, and instance-swap properties,
- relevant variable collections and modes,
- fixed child or slot child composition with contextual overrides,
- text node names and default strings,
- ownership hints collected from root definitions, child overrides, text nodes, and variable collections,
- user-provided context and screenshots,
- any observed evidence that a child-level capability affects the parent component contract.

Use this evidence set to answer two questions before writing the API:
1. What facts can be stated directly from Figma?
2. What API decisions require AI reasoning and normalization?

Facts should come from deterministic evidence. Interpretation should happen in Step 5 using the instruction file.
The working evidence set should be represented as a structured object matching the `ComponentEvidence` schema in the instruction file before you generate `ApiOverviewData`.

### Step 5: Identify Properties

Using gathered context and the extraction data from Step 4b, identify:

**A. Variant properties** from Figma axes (size, type, hierarchy, layout, behavior, etc.)
- If a broad axis mixes transient and persistent states, decompose it into engineer-friendly API properties instead of copying the axis verbatim.
- Drop transient interaction visuals such as hovered, pressed, and focused unless the component clearly exposes them as persistent configuration.

**B. Boolean toggles** from instance inspection
- Separate simple modifiers (`isDisabled`, `showBadge`) from slot-selection booleans that should become enums with `none`.
- Check whether a child-level toggle actually changes the parent component contract. If it does, promote it to the parent API.

**Mandatory: Override Promotion Pass**

For each entry in `composableChildren`, walk every key in `contextualOverrides` and classify it:

| Override key | Does it change what the parent looks like to a consumer? | Action |
|---|---|---|
| Yes (e.g., `Leading content`, `Trailing content`, `Character count`) | Promote to parent API as an enum or boolean |
| No (e.g., `Size` that mirrors the parent's own size axis) | Keep in sub-component table only |
| Unclear | Ask: would an engineer set this when USING the parent? If yes, promote. |

When a master boolean (`Leading content: true/false`) gates sub-booleans (`Leading artwork`, `Leading text`), merge them into a single enum on the parent API: `leadingContent: none, icon, text, iconAndText`. The master boolean `false` maps to `none`. See the instruction file's "Figma master boolean + sub-boolean trap" for the full pattern.

Do not skip this pass. The most common failure mode is leaving child-level capabilities buried in sub-component tables when they belong on the parent API.

**C. Variable mode properties** from variable collections and modes
- Treat density, shape, and similar mode-controlled properties as first-class API inputs when they materially affect the component.
- Do not omit variable modes just because they are controlled at the container level.

**D. Ownership and nesting decisions**
- Decide whether each property belongs on the parent API, in a sub-component table, or in both places.
- Use the parent API for properties that affect the component's external contract, behavior, or common usage.
- Use sub-component tables for implementation/configuration details of nested children.
- Use `isSubProperty` when a property is best understood as part of a parent capability rather than a standalone top-level row.

**E. Sub-component configurations** (Pattern A: slot content types; Pattern B: fixed sub-components — see instruction file for decision criteria)
- Check both fixed children and interchangeable slot content types.
- For compound components, prefer documenting the user-facing contract on the parent and the child-specific mechanics in the sub-component tables.

### Step 6: Generate Structured Data

Follow the `ApiOverviewData` schema defined in the instruction file. Build the data as a structured object matching those interfaces.

Before finalizing the object, mentally separate:
- deterministic facts: what Figma proves,
- semantic API decisions: how those facts should be exposed to engineers.

Prefer deterministic extraction for facts and AI reasoning for interpretation. Do not ask the model to infer facts that can be gathered directly from Figma. Do not hard-code semantic API decisions into scripts when those decisions require cross-component judgment.

### Step 7: Audit

Re-read the instruction file, focusing on:
- **Pre-Output Validation Checklist** — walk through each checkbox
- **Common Mistakes** section
- **Do NOT** section
- **Property Naming** conventions (camelCase, engineer-friendly)

Check your output against each rule. Fix any violations.

During the audit, explicitly verify:
- every semantic claim is backed by deterministic evidence or is clearly marked as an inference,
- broad Figma structures have been normalized into an engineer-friendly API,
- parent-level properties have not been buried inside sub-component tables,
- nested properties use `isSubProperty` only when the relationship is clear and meaningful.

### Step 8: Import and Detach Template

Run via `figma_execute` (replace `__API_TEMPLATE_KEY__`, `__COMPONENT_NAME__`, and `__COMPONENT_NODE_ID__` with the node ID extracted from the component URL):

```javascript
const TEMPLATE_KEY = '__API_TEMPLATE_KEY__';
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

frame.name = '__COMPONENT_NAME__ API';
figma.currentPage.selection = [frame];
figma.viewport.scrollAndZoomIntoView([frame]);
return { frameId: frame.id, pageId: _p.id, pageName: _p.name };
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
  try {
    const fn = tn.fontName;
    if (fn && fn !== figma.mixed && fn.family) {
      const key = fn.family + '|' + fn.style;
      if (!fontSet.has(key)) { fontSet.add(key); fontsToLoad.push(fn); }
    }
  } catch {}
}
await Promise.all(fontsToLoad.map(f => figma.loadFontAsync(f).catch(() => {})));

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
  try {
    const fn = tn.fontName;
    if (fn && fn !== figma.mixed && fn.family) {
      const key = fn.family + '|' + fn.style;
      if (!fontSet.has(key)) { fontSet.add(key); fontsToLoad.push(fn); }
    }
  } catch {}
}
await Promise.all(fontsToLoad.map(f => figma.loadFontAsync(f).catch(() => {})));

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

**IMPORTANT:** After all sub-component tables are rendered, you MUST hide the original template by running this script. Skipping this leaves a ghost "{Sub-component-title}" row visible in the output:

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

For each example, run (replace `__FRAME_ID__`, `__EXAMPLE_TITLE__`, `__COMPONENT_SET_NODE_ID__`, `__VARIANT_PROPERTIES_JSON__`, `__CHILD_OVERRIDES_JSON__`, `__TEXT_OVERRIDES_JSON__`, `__SLOT_INSERTIONS_JSON__`, and `__EXAMPLE_PROPERTIES_JSON__`):

- `__VARIANT_PROPERTIES_JSON__` is an object mapping **Figma property keys** (exactly as returned by `componentPropertyDefinitions`) to values. This is used to instantiate and configure the live component preview. Include variant axes and boolean toggles needed for the example.
- `__CHILD_OVERRIDES_JSON__` is an array of per-child property override objects for composable slot children (index 0 = first child). Use `[]` when no child overrides are needed. Each entry maps Figma property keys to values, same format as `variantProperties`.
- `__TEXT_OVERRIDES_JSON__` is an object mapping **Figma layer names** to new text content (e.g., `{ "Label": "Submit" }`). Applied to TEXT nodes inside the main instance. Use `{}` when no text overrides are needed.
- `__SLOT_INSERTIONS_JSON__` is an array of slot insertion objects. Each has `slotName` (SLOT node name), `componentNodeId` (local component node ID to instantiate), and optional `nestedOverrides` (component properties for `setProperties()`) and `textOverrides` (TEXT node content overrides on the inserted child). All overrides are applied **before** `appendChild` into the slot — after adoption, the child's internal nodes get compound IDs and become inaccessible. Use `[]` when no slot insertions are needed.

```javascript
const FRAME_ID = '__FRAME_ID__';
const EXAMPLE_TITLE = '__EXAMPLE_TITLE__';
const COMPONENT_SET_ID = '__COMPONENT_SET_NODE_ID__';
const VARIANT_PROPS = __VARIANT_PROPERTIES_JSON__;
const CHILD_OVERRIDES = __CHILD_OVERRIDES_JSON__;
const TEXT_OVERRIDES = __TEXT_OVERRIDES_JSON__;
const SLOT_INSERTIONS = __SLOT_INSERTIONS_JSON__;
const EXAMPLE_PROPERTIES = __EXAMPLE_PROPERTIES_JSON__;

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
const exampleTemplate = frame.findOne(n => n.name === '#config-example-chapter-template');

const section = exampleTemplate.clone();
exampleTemplate.parent.appendChild(section);
section.name = EXAMPLE_TITLE;
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
  await loadAllFonts(instance);
  if (Object.keys(VARIANT_PROPS).length > 0) {
    instance.setProperties(VARIANT_PROPS);
    await loadAllFonts(instance);
  }

  // Apply per-child overrides for composable slot children
  if (CHILD_OVERRIDES && CHILD_OVERRIDES.length > 0) {
    let slot = instance.findOne(n => n.type === 'SLOT');
    if (!slot) slot = instance.children[0];
    if (slot && slot.children) {
      for (let i = 0; i < Math.min(CHILD_OVERRIDES.length, slot.children.length); i++) {
        const child = slot.children[i];
        if (child.type === 'INSTANCE' && Object.keys(CHILD_OVERRIDES[i]).length > 0) {
          try { child.setProperties(CHILD_OVERRIDES[i]); } catch (e) {}
        }
      }
    }
    await loadAllFonts(instance);
  }

  // Apply text overrides to TEXT nodes inside the instance
  if (TEXT_OVERRIDES && Object.keys(TEXT_OVERRIDES).length > 0) {
    await loadAllFonts(instance);
    for (const [layerName, newText] of Object.entries(TEXT_OVERRIDES)) {
      const textNode = instance.findOne(n => n.type === 'TEXT' && n.name === layerName);
      if (textNode) {
        textNode.characters = newText;
      }
    }
  }

  // Insert content into named SLOT nodes
  if (SLOT_INSERTIONS && SLOT_INSERTIONS.length > 0) {
    for (const insertion of SLOT_INSERTIONS) {
      const slotNode = instance.findOne(
        n => n.type === 'SLOT' && n.name === insertion.slotName
      );
      if (slotNode) {
        const comp = await figma.getNodeByIdAsync(insertion.componentNodeId);
        if (comp && comp.type === 'COMPONENT') {
          const child = comp.createInstance();
          await loadAllFonts(child);
          // Apply all overrides BEFORE appendChild — after slot adoption, child nodes get compound IDs and become inaccessible
          if (insertion.nestedOverrides && Object.keys(insertion.nestedOverrides).length > 0) {
            try {
              child.setProperties(insertion.nestedOverrides);
              await loadAllFonts(child);
            } catch (e) {}
          }
          if (insertion.textOverrides && Object.keys(insertion.textOverrides).length > 0) {
            for (const [layerName, newText] of Object.entries(insertion.textOverrides)) {
              const tn = child.findOne(n => n.type === 'TEXT' && n.name === layerName);
              if (tn) {
                tn.characters = newText;
              }
            }
          }
          slotNode.appendChild(child);
          await loadAllFonts(instance);
        }
      }
    }
    await loadAllFonts(instance);
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

**IMPORTANT:** After all examples are rendered, you MUST hide the original template by running this script. Skipping this leaves a ghost "{example-title}" row visible in the output:

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

### Step 14: Completion Link

Print a clickable Figma URL to the completed spec in chat. Construct the URL from the `fileKey` (extracted from the user's input URL) and the `frameId` (returned by Step 8), replacing `:` with `-` in the node ID:

```
API spec complete: https://www.figma.com/design/{fileKey}/?node-id={frameId}
```

## Notes

- Conditional sub-components: If `subComponentTables` is empty or absent, the `#subcomponent-chapter-template` is hidden. If present, each sub-component gets its own cloned section with its own property table.
- Hierarchy indicators: Both the main table (`#hierarchy-indicator`) and sub-component tables (`#subprop-hierarchy-indicator`) support `isSubProperty` for indented child rows.
- The target node can be either a `COMPONENT_SET` (multi-variant) or a standalone `COMPONENT` (single variant). The extraction script detects the type and returns `isComponentSet` accordingly. When the node is a standalone component, there are no variant axes — only boolean, instance swap, and variable mode properties apply. Instance creation in Step 12 uses `compNode.createInstance()` directly for standalone components.
- The extraction script (Step 4b) programmatically reads `componentPropertyDefinitions` from the component set or component, capturing all variant axes (with options and defaults), boolean toggles (with associated layer names and raw keys), and instance swap properties. This structured data makes property identification in Step 5 deterministic rather than relying solely on LLM interpretation of MCP tool output. The `rawKey` values (including `#nodeId` suffixes) are needed for `setProperties()` when creating configuration example previews in Step 12.
- The instruction file (`{{ref:api/agent-api-instruction.md}}`) contains the JSON schema, examples, and property classification rules. The AI reasoning for property identification is unchanged — only the delivery mechanism has changed.
