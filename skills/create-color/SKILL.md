---
name: create-color
description: Generate color annotation specifications mapping UI elements to design tokens. Use when the user mentions "color", "color annotation", "color spec", "tokens", "design tokens", or wants to document which color tokens a component uses.
---

# Create Color Annotation

Generate a color annotation directly in Figma — tables mapping each visual element to its design token, organized by variant and state.

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
- **Description** (optional): Component name, specific variants to document

## Workflow

Copy this checklist and update as you progress:

```
Task Progress:
- [ ] Step 1: Read instruction file
- [ ] Step 2: Verify MCP connection (if Figma link provided)
- [ ] Step 3: Read template key from uspecs.config.json
- [ ] Step 4: Gather context (MCP tools + user-provided input)
- [ ] Step 4b: Run consolidated extraction script (tokens, axis classification, boolean enrichment, mode detection, sub-component tagging)
- [ ] Step 4c: Interpret extraction data (strategy selection, variant plan, sub-component refs, element-to-token mappings)
- [ ] Step 7: Organize analysis into structured data (component name, general notes, variants with tables and rows)
- [ ] Step 8: Re-read instruction file (Common Mistakes, Do NOT sections) and audit
- [ ] Step 9: Import and detach the Color Annotation template
- [ ] Step 10: Fill header fields
- [ ] Step 11: Render variants (Strategy A or B, one figma_execute per variant)
- [ ] Step 12: Visual validation
```

### Step 1: Read Instructions

Read [agent-color-instruction.md]({{ref:color/agent-color-instruction.md}})

### Step 2: Verify MCP Connection

If a Figma link is provided, read `mcpProvider` from `uspecs.config.json` and verify the connection:

**If `figma-console`:**
- `figma_get_status` — Confirm Desktop Bridge plugin is active
- If connection fails: *"Please open Figma Desktop and run the Desktop Bridge plugin. Then try again."*

**If `figma-mcp`:**
- Connection is verified implicitly on the first `use_figma` call. No explicit check needed.
- If the first call fails: *"Please verify your FIGMA_API_KEY is set correctly in your MCP configuration."*

### Step 3: Read Template Key

Read the file `uspecs.config.json` and extract:
- The `colorAnnotation` value from the `templateKeys` object → save as `COLOR_TEMPLATE_KEY`
- The `fontFamily` value → save as `FONT_FAMILY` (default to `Inter` if not set)

If the template key is empty, tell the user:
> The color annotation template key is not configured. Run {{skill:firstrun}} with your Figma template library link first.

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

### Step 4b: Run Consolidated Extraction Script

When a Figma link is provided, run this extraction script via `figma_execute` to programmatically walk the component tree and resolve all color variable bindings, classify variant axes, detect boolean-gated elements, and discover mode-controlled color collections — all in a single call.

Set `__SKIP_AXES_JSON__` to `{}` for the initial run — the script will walk all variants. After interpreting the results in Step 4c, you may optionally re-run this script with color-irrelevant axes populated to get a reduced dataset (see Step 4c-ii).

Replace `__NODE_ID__` with the component set node ID extracted from the URL (`node-id=123-456` → `123:456`). Replace `__SKIP_AXES_JSON__` with `{}` (or a JSON object mapping color-irrelevant axis names to their default/representative value if re-running after Step 4c, e.g., `{"Size": "Medium", "Density": "Default"}`):

```javascript
const TARGET_NODE_ID = '__NODE_ID__';
const SKIP_AXES = __SKIP_AXES_JSON__;

function rgbToHex(c) {
  return '#' + [c.r, c.g, c.b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

const collectionIdSet = new Set();

async function resolveVariableToken(binding) {
  if (!binding?.id) return null;
  try {
    const v = await figma.variables.getVariableByIdAsync(binding.id);
    if (v) {
      collectionIdSet.add(v.variableCollectionId);
      return v.codeSyntax?.WEB || v.name;
    }
  } catch {}
  return null;
}

async function buildCompositeDetail(fills, styleName, resolveVarFn) {
  const visibleFills = fills.filter(f => f.visible !== false);
  if (visibleFills.length < 2) return null;
  const layers = [];
  for (let i = visibleFills.length - 1; i >= 0; i--) {
    const f = visibleFills[i];
    const layer = { type: f.type === 'SOLID' ? 'solid' : 'gradient', blendMode: f.blendMode || 'NORMAL', opacity: f.opacity };
    if (f.type === 'SOLID') {
      layer.hex = rgbToHex(f.color);
      layer.token = f.boundVariables?.color ? await resolveVarFn(f.boundVariables.color) : null;
    } else if (f.type.startsWith('GRADIENT_')) {
      layer.gradientType = f.type;
      if (f.gradientTransform) {
        layer.angleDegrees = Math.round(Math.atan2(f.gradientTransform[0][1], f.gradientTransform[0][0]) * (180 / Math.PI));
      }
      layer.stops = [];
      if (f.gradientStops) {
        for (const stop of f.gradientStops) {
          const s = { position: Math.round(stop.position * 1000) / 1000, color: 'rgba(' + Math.round(stop.color.r * 255) + ', ' + Math.round(stop.color.g * 255) + ', ' + Math.round(stop.color.b * 255) + ', ' + (Math.round(stop.color.a * 1000) / 1000) + ')' };
          s.token = stop.boundVariables?.color ? await resolveVarFn(stop.boundVariables.color) : null;
          layer.stops.push(s);
        }
      }
    } else if (f.type === 'IMAGE') {
      layer.type = 'image';
    }
    layers.push(layer);
  }
  return { styleName, layers };
}

async function extractColorBindings(node, path) {
  const entries = [];
  const elementName = path || node.name;

  if (node.fills && Array.isArray(node.fills)) {
    let fillStyleName = null;
    if (node.fillStyleId && node.fillStyleId !== '' && typeof node.fillStyleId === 'string') {
      try { const style = await figma.getStyleByIdAsync(node.fillStyleId); if (style) fillStyleName = style.name; } catch {}
    }
    let fillEntryAdded = false;
    for (const fill of node.fills) {
      if (fill.visible === false) continue;
      if (fill.type === 'SOLID') {
        const hex = rgbToHex(fill.color);
        let token = fillStyleName || null;
        if (!token && fill.boundVariables?.color) {
          token = await resolveVariableToken(fill.boundVariables.color);
        }
        const prop = node.type === 'TEXT' ? 'text fill' : 'fill';
        const entry = { element: elementName, property: prop, hex, token, opacity: fill.opacity };
        if (fillStyleName && !fillEntryAdded) {
          const composite = await buildCompositeDetail(node.fills, fillStyleName, resolveVariableToken);
          if (composite) entry.compositeDetail = composite;
          fillEntryAdded = true;
        }
        entries.push(entry);
      }
    }
    if (fillStyleName && !fillEntryAdded) {
      const visibleFills = node.fills.filter(f => f.visible !== false);
      if (visibleFills.length > 0) {
        const hex = visibleFills[0].type === 'SOLID' ? rgbToHex(visibleFills[0].color) : '';
        const entry = { element: elementName, property: node.type === 'TEXT' ? 'text fill' : 'fill', hex, token: fillStyleName, opacity: 1 };
        const composite = await buildCompositeDetail(node.fills, fillStyleName, resolveVariableToken);
        if (composite) entry.compositeDetail = composite;
        entries.push(entry);
        fillEntryAdded = true;
      }
    }
  }

  if (node.strokes && Array.isArray(node.strokes)) {
    let strokeStyleName = null;
    if (node.strokeStyleId && node.strokeStyleId !== '' && typeof node.strokeStyleId === 'string') {
      try { const style = await figma.getStyleByIdAsync(node.strokeStyleId); if (style) strokeStyleName = style.name; } catch {}
    }
    let strokeEntryAdded = false;
    for (const stroke of node.strokes) {
      if (stroke.visible === false) continue;
      if (stroke.type === 'SOLID') {
        const hex = rgbToHex(stroke.color);
        let token = strokeStyleName || null;
        if (!token && stroke.boundVariables?.color) {
          token = await resolveVariableToken(stroke.boundVariables.color);
        }
        const entry = { element: elementName, property: 'stroke', hex, token, opacity: stroke.opacity };
        if (strokeStyleName && !strokeEntryAdded) {
          const composite = await buildCompositeDetail(node.strokes, strokeStyleName, resolveVariableToken);
          if (composite) entry.compositeDetail = composite;
          strokeEntryAdded = true;
        }
        entries.push(entry);
      }
    }
  }

  if (node.effects && Array.isArray(node.effects)) {
    let effectStyleName = null;
    if (node.effectStyleId && node.effectStyleId !== '' && typeof node.effectStyleId === 'string') {
      try { const style = await figma.getStyleByIdAsync(node.effectStyleId); if (style) effectStyleName = style.name; } catch {}
    }
    if (effectStyleName) {
      entries.push({ element: elementName, property: 'effect style', hex: '', token: effectStyleName, opacity: 1 });
    } else {
      for (const effect of node.effects) {
        if (effect.visible === false) continue;
        if (effect.color) {
          const hex = rgbToHex(effect.color);
          let token = effect.boundVariables?.color
            ? await resolveVariableToken(effect.boundVariables.color)
            : null;
          const effectType = effect.type === 'DROP_SHADOW' ? 'drop shadow'
            : effect.type === 'INNER_SHADOW' ? 'inner shadow'
            : effect.type;
          entries.push({ element: elementName, property: effectType, hex, token, opacity: effect.color.a });
        }
      }
    }
  }

  return entries;
}

async function walkTree(node, parentPath) {
  const currentPath = parentPath ? parentPath + ' > ' + node.name : node.name;
  let entries = await extractColorBindings(node, node.name);

  if (node.type === 'INSTANCE') {
    let compSetName = null;
    try {
      const mainComp = await node.getMainComponentAsync();
      if (mainComp && mainComp.parent && mainComp.parent.type === 'COMPONENT_SET') {
        compSetName = mainComp.parent.name;
      }
    } catch {}
    if (compSetName) {
      entries = entries.map(e => ({ ...e, subComponentName: compSetName }));
    }
    for (const child of node.children) {
      const childEntries = await walkTree(child, currentPath);
      if (compSetName) {
        childEntries.forEach(e => { if (!e.subComponentName) e.subComponentName = compSetName; });
      }
      entries = entries.concat(childEntries);
    }
  } else if ('children' in node) {
    for (const child of node.children) {
      entries = entries.concat(await walkTree(child, currentPath));
    }
  }

  return entries;
}

const node = await figma.getNodeByIdAsync(TARGET_NODE_ID);
if (!node || (node.type !== 'COMPONENT_SET' && node.type !== 'COMPONENT')) {
  figma.closePlugin(JSON.stringify({ error: 'Node is not a component set or component. Type: ' + (node ? node.type : 'null') }));
  return;
}

// Ensure the correct page context is loaded for stable child traversal
let _p = node; while (_p.parent && _p.parent.type !== 'PAGE') _p = _p.parent;
if (_p.parent && _p.parent.type === 'PAGE') await figma.setCurrentPageAsync(_p.parent);

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
const skipAxes = SKIP_AXES || {};
const filteredVariants = variantChildren.filter(variant => {
  const props = variant.variantProperties || {};
  for (const [axis, defaultVal] of Object.entries(skipAxes)) {
    if (props[axis] && props[axis] !== defaultVal) return false;
  }
  return true;
});

// Phase 1: Walk all variants — color bindings + axis fingerprints + sub-component tagging
// Both `hover` and `hovered` are recognized: `hover` is the historical name in
// most existing Figma libraries; `hovered` is the canonical name going forward.
const stateKeywords = ['enabled', 'hover', 'hovered', 'pressed', 'disabled', 'active', 'rest', 'focused', 'selected', 'dragged', 'error', 'loading'];
const axisTokenSets = {};

const variantColorData = [];
for (const variant of filteredVariants) {
  const colorEntries = await walkTree(variant, null);
  const tokenFingerprint = colorEntries
    .filter(e => e.token)
    .map(e => e.token)
    .sort()
    .join('|');

  const vProps = variant.variantProperties || {};
  for (const [axis, val] of Object.entries(vProps)) {
    if (!axisTokenSets[axis]) axisTokenSets[axis] = {};
    if (!axisTokenSets[axis][val]) axisTokenSets[axis][val] = tokenFingerprint;
  }

  variantColorData.push({
    name: variant.name,
    variantProperties: vProps,
    colorEntries
  });
}

// Phase 2: Axis classification
const axisClassification = {};
for (const [axis, values] of Object.entries(variantAxes)) {
  const tokenSets = axisTokenSets[axis] || {};
  const uniqueSets = new Set(Object.values(tokenSets));
  const isState = values.some(v => stateKeywords.includes(v.toLowerCase()));
  axisClassification[axis] = {
    values,
    isState,
    colorRelevant: uniqueSets.size > 1,
    tokenSetsByValue: tokenSets
  };
}

// Phase 3: Boolean enrichment
let booleanDelta = { booleanPropsToggled: [], deltaCount: 0, delta: [] };
const boolProps = {};
for (const [key, def] of Object.entries(propertyDefs)) {
  if (def.type === 'BOOLEAN') boolProps[key] = true;
}

if (Object.keys(boolProps).length > 0) {
  const defaultVariant = isComponentSet
    ? (node.defaultVariant || node.children[0])
    : node;
  const baselineKeys = new Set();
  const baselineEntries = await walkTree(defaultVariant, null);
  for (const e of baselineEntries) {
    baselineKeys.add(e.element + '|' + e.property + '|' + (e.token || e.hex));
  }

  async function loadAllFonts(rootNode) {
    const textNodes = [];
    function collect(node) {
      try {
        if (node.type === 'TEXT') textNodes.push(node);
        if ('children' in node && node.children) {
          for (const c of node.children) { try { collect(c); } catch {} }
        }
      } catch {}
    }
    collect(rootNode);
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

  const instance = defaultVariant.createInstance();
  instance.x = defaultVariant.x + defaultVariant.width + 100;
  instance.y = defaultVariant.y;
  instance.setProperties(boolProps);
  await loadAllFonts(instance);

  function enableNestedBooleans(node) {
    try {
      if (node.type === 'INSTANCE') {
        const childProps = node.componentProperties;
        if (childProps) {
          const childBoolProps = {};
          for (const [key, val] of Object.entries(childProps)) {
            if (val.type === 'BOOLEAN') childBoolProps[key] = true;
          }
          if (Object.keys(childBoolProps).length > 0) {
            try { node.setProperties(childBoolProps); } catch {}
          }
        }
      }
      if ('children' in node && node.children) {
        for (const child of node.children) { try { enableNestedBooleans(child); } catch {} }
      }
    } catch {}
  }

  function directUnhide(node) {
    try { if (!node.visible) node.visible = true; } catch {}
    if ('children' in node && node.children) {
      for (const child of node.children) { try { directUnhide(child); } catch {} }
    }
  }

  enableNestedBooleans(instance);
  directUnhide(instance);
  await loadAllFonts(instance);

  const enrichedEntries = await walkTree(instance, null);
  const delta = [];
  for (const e of enrichedEntries) {
    const key = e.element + '|' + e.property + '|' + (e.token || e.hex);
    if (!baselineKeys.has(key)) delta.push(e);
  }
  instance.remove();

  booleanDelta = {
    booleanPropsToggled: Object.keys(boolProps),
    deltaCount: delta.length,
    delta
  };
}

// Phase 4: Mode detection
let modeDetection = { hasModeCollection: false, collectionName: null, modes: [], modeTokenMap: {} };
if (collectionIdSet.size > 0) {
  const allCollections = await figma.variables.getLocalVariableCollectionsAsync();
  for (const colId of collectionIdSet) {
    const col = allCollections.find(c => c.id === colId);
    if (!col || col.modes.length <= 1) continue;

    const modeTokenMap = {};
    for (const mode of col.modes) {
      modeTokenMap[mode.name] = {};
      for (const varId of col.variableIds) {
        const variable = await figma.variables.getVariableByIdAsync(varId);
        if (!variable) continue;
        const modeValue = variable.valuesByMode[mode.modeId];
        if (modeValue && modeValue.type === 'VARIABLE_ALIAS') {
          const aliased = await figma.variables.getVariableByIdAsync(modeValue.id);
          if (aliased) {
            modeTokenMap[mode.name][variable.codeSyntax?.WEB || variable.name] = aliased.codeSyntax?.WEB || aliased.name;
          }
        } else {
          modeTokenMap[mode.name][variable.codeSyntax?.WEB || variable.name] = variable.codeSyntax?.WEB || variable.name;
        }
      }
    }

    modeDetection = {
      hasModeCollection: true,
      collectionName: col.name,
      collectionId: col.id,
      modes: col.modes.map(m => m.name),
      modeIds: Object.fromEntries(col.modes.map(m => [m.name, m.modeId])),
      modeTokenMap
    };
    break;
  }
}

figma.closePlugin(JSON.stringify({
  componentName: node.name,
  compSetNodeId: TARGET_NODE_ID,
  isComponentSet,
  variantAxes,
  propertyDefs,
  variantCount: variantChildren.length,
  sampledCount: filteredVariants.length,
  skippedAxes: Object.keys(skipAxes),
  variantColorData,
  axisClassification,
  booleanDelta,
  modeDetection
}));
```

Save the returned JSON. This consolidated extraction provides:
- `compSetNodeId` — needed for creating live preview instances in Step 11
- `variantAxes` — variant axis names and their options, for mapping variant sections to Figma property keys
- `propertyDefs` — exact Figma property keys (including `#nodeId` suffixes) for `setProperties()` when placing preview instances
- `variantCount` / `sampledCount` / `skippedAxes` — extraction scope metadata
- `variantColorData` — per-variant array of `colorEntries`, each with `element`, `property` (fill, text fill, stroke, drop shadow, inner shadow, or effect style), `hex`, `token`, `opacity`, and optional `subComponentName` (string) identifying which nested component the entry belongs to (e.g., `"Button"`). Always show the actual token; use `subComponentName` for richer notes. When `property` is `"effect style"`, the entry represents a composed effect style (e.g., a shadow style) — the `token` is the style name and individual shadow layers are not emitted. **Token resolution priority:** paint/stroke style names (`fillStyleId`, `strokeStyleId`) take precedence over variable bindings (`boundVariables.color`). A composite style (e.g., `composite/button-primary/background`) wrapping a semantic variable is common — the style name is the correct token. **Composite styles:** When a fill/stroke style has 2+ visible paint layers, the entry includes a `compositeDetail` object with `styleName` and `layers[]` (ordered top-to-bottom). Each layer has `type` (`solid`, `gradient`, or `image`), `blendMode`, `opacity`, and type-specific fields: `hex`/`token` for solids; `gradientType`, `angleDegrees`, `stops[]` (each with `position`, `color` as rgba string, `token`) for gradients
- `axisClassification` — per-axis classification with `isState`, `colorRelevant`, and `tokenSetsByValue`
- `booleanDelta` — elements discovered behind boolean toggles (`deltaCount`, `delta` entries, `booleanPropsToggled`)
- `modeDetection` — mode-controlled collection info (`hasModeCollection`, `collectionName`, `collectionId`, `modes`, `modeIds`, `modeTokenMap`)

Use this data in Step 4c to interpret and plan the rendering strategy. Entries with `subComponentName` come from nested instances — always include their actual tokens and use the sub-component name for descriptive notes and element names.

### Step 4c: Interpret Extraction Data

Using the consolidated extraction output from Step 4b, perform the following interpretation steps (no additional `figma_execute` calls needed — all data is already in the extraction payload):

1. **Validate extraction**: Confirm `variantColorData` is non-empty and `sampledCount > 0`. If the component is a standalone `COMPONENT` (not a set), expect a single variant entry.
1b. **Container detection**: Check if the parent component has any direct color entries (entries WITHOUT `subComponentName`). If ALL entries across all variants have `subComponentName` and the parent contributes no direct color entries, this is a container/slot component. In this case:
   - Find the sub-component's component set node ID (search the file for the `subComponentName` value as a COMPONENT_SET)
   - Re-run the Step 4b extraction script targeting the sub-component's node ID
   - Use the sub-component's axes and variant structure for the rest of the workflow
   - Keep the parent component name as the annotation title
   - Note the container relationship in `generalNotes`
2. **Merge boolean delta**: If `booleanDelta.deltaCount > 0`, merge the `booleanDelta.delta` entries into the default variant's color entries. These represent elements hidden behind boolean toggles.
3. **Annotate sub-component entries**: Entries with `subComponentName` come from nested instances. Include their actual tokens — use the sub-component name to write descriptive notes (e.g., `"Button container fill"`). Group sub-component entries together in the table when it aids readability.
4. **Map elements to tokens**: Using the `variantColorData` entries, build element-to-token mappings. Entries with a non-null `token` field have a resolved variable binding; entries with `token: null` use a hard-coded color (note this in output).
4a. **Build composite breakdowns**: For each entry that has a `compositeDetail` (multi-layer paint style), construct a `compositeChildren` array on the corresponding `ColorElement`/`ConsolidatedElement`. Iterate layers in the already top-to-bottom order:
   - **Solid layers**: element = `"Solid fill"`, value = variable token or hex, notes = `"{blendMode} blend, {opacity}% opacity"`. Add `"Top layer."` or `"Bottom layer."` prefix when 2+ layers exist.
   - **Gradient layers**: element = `"{gradientType} gradient"` (e.g., `"Linear gradient"`), value = `"linear-gradient({angle}deg, ...)"`, notes = `"{blendMode} blend, {opacity}% opacity"` with layer position prefix. Then append one child per stop: element = `"Stop at {position}%"`, value = `"rgba(r, g, b, a)"` or token if bound, notes = position description (e.g., `"Transparent"`, `"Opaque"`).
   - **Image layers**: element = `"Image fill"`, value = `"image"`, notes = blend mode and opacity.
5. **Capture Figma property keys**: Use `propertyDefs` and `variantAxes` from the extraction to map variant section names to correct Figma property values for `setProperties()`.
6. **Choose rendering strategy**: See Step 4c-i below.
7. **Build variant plan**: See Step 4c-ii below.

#### Step 4c-i: Determine Rendering Strategy

Using `axisClassification` and `modeDetection` from the extraction output, choose a rendering strategy by following the **Rendering Strategies** and **Decision Logic (Two-Gate Model)** sections in the instruction file.

**Template note:** Strategy A renames the template's `#state-title` column header from "State" to "Token" at render time.

If Strategy B, also record:
- `stateAxisName`: name of the state axis (e.g., "State")
- `stateValues`: ordered list of state values (columns)
- `nonStateAxes`: the remaining color-relevant axes whose combinations form sections

#### Step 4c-ii: Build Variant Reduction Plan

Based on the strategy chosen in Step 4c-i, determine which sections to render. Follow the **Variable Mode Colors** section in the instruction file for mode-controlled components and the **Color-Irrelevant Axes** section for axis filtering.

- **Color-irrelevant axes**: Pick one representative value (typically the default). Never create sections for these axes.
- **Strategy A sections**: List each color-relevant axis combination as a section.
- **Strategy B sections**: List each non-state color-relevant combination as a section, with all state values as columns within each section.

**Mode-controlled components:** If `modeDetection.hasModeCollection` is true:
- Record the `collectionId` from `modeDetection` on the top-level data structure.
- Record the `modeId` for each section so the rendering step can apply the correct variable mode to preview instances.
- Use `modeDetection.modeTokenMap[modeName]` to resolve generic tokens to semantic aliases per mode.

**Optional re-extraction:** If the component is complex (many variants) and Step 4b was run with `SKIP_AXES = {}`, re-run Step 4b now with `__SKIP_AXES_JSON__` populated with the color-irrelevant axes identified above (e.g., `{"Size": "Medium", "Density": "Default"}`) to get a focused dataset. For components with few variants (≤ 10), there is no need to re-run.

Use the extraction output fields directly — `compSetNodeId` for creating live preview instances in Step 11, `variantAxes` for mapping sections to Figma property keys, `propertyDefs` for exact Figma property keys (including `#nodeId` suffixes).

### Step 7: Organize Analysis into Structured Data

Follow the **Data Structure Reference** in the instruction file — use the Strategy A (`ColorAnnotationData`) or Strategy B (`ConsolidatedColorAnnotationData`) interfaces. Build an internal working model that feeds directly into the Figma rendering steps — no JSON output artifact is needed.

Rendering-critical fields consumed by Step 11 scripts:
- `variantProperties` — maps Figma property keys to values for `setProperties()` on preview instances
- `collectionId` / `modeId` (Strategy B only) — passed to rendering scripts for `setExplicitVariableModeForCollection`

### Step 8: Audit

Re-read the instruction file, focusing on:
- **Common Mistakes** section
- **Do NOT** section
- **Writing Notes** guidelines (3-8 words per note)

Check your output against each rule. Fix any violations.

### Step 9: Import and Detach Template

Run via `figma_execute` (replace `__COLOR_TEMPLATE_KEY__`, `__COMPONENT_NAME__`, and `__COMPONENT_NODE_ID__` with the node ID extracted from the component URL):

```javascript
const TEMPLATE_KEY = '__COLOR_TEMPLATE_KEY__';
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

frame.name = '__COMPONENT_NAME__ Color';
figma.currentPage.selection = [frame];
figma.viewport.scrollAndZoomIntoView([frame]);
return { frameId: frame.id, pageId: _p.id, pageName: _p.name };
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

Use the rendering strategy determined in Step 4c-i. Run **one `figma_execute` call per variant** to avoid timeouts.

#### Strategy A: Simple Layout

For each variant in the data, run the following script. Replace all `__PLACEHOLDER__` values with actual data. `__TABLES_JSON__` is the tables array for this variant (each element has `element`, `token`, `notes`, and optionally `compositeChildren` — an array of `{ element, value, notes }` objects for multi-layer style breakdowns).

- `__COMPONENT_SET_NODE_ID__` is the node ID of the component set (from Step 4b extraction: `compSetNodeId`). Set to `''` if not available.
- `__VARIANT_PROPERTIES_JSON__` is an object mapping **Figma property keys** (exactly as returned by `componentPropertyDefinitions`) to values for this variant. Set to `{}` if not available.
- `__FONT_FAMILY__` is the `fontFamily` value from `uspecs.config.json` (default: `Inter`).
- `__BOOLEAN_UNHIDES_JSON__` is an array of `{ booleanRawKey: string }` objects derived from `booleanDelta.booleanPropsToggled` in the extraction output. Set to `[]` if `booleanDelta.deltaCount === 0`.

```javascript
const FRAME_ID = '__FRAME_ID__';
const VARIANT_NAME = '__VARIANT_NAME__';
const COMPONENT_NAME = '__COMPONENT_NAME__';
const COMPONENT_SET_ID = '__COMPONENT_SET_NODE_ID__';
const VARIANT_PROPS = __VARIANT_PROPERTIES_JSON__;
const TABLES = __TABLES_JSON__;
const FONT_FAMILY = '__FONT_FAMILY__';
const BOOLEAN_UNHIDES = __BOOLEAN_UNHIDES_JSON__;

async function loadAllFonts(rootNode) {
  const textNodes = [];
  function collect(node) {
    try {
      if (node.type === 'TEXT') textNodes.push(node);
      if ('children' in node && node.children) {
        for (const c of node.children) { try { collect(c); } catch {} }
      }
    } catch {}
  }
  collect(rootNode);
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

function enableNestedBooleans(node) {
  try {
    if (node.type === 'INSTANCE') {
      try {
        const childProps = node.componentProperties;
        if (childProps) {
          const childBoolProps = {};
          for (const [key, val] of Object.entries(childProps)) {
            if (val.type === 'BOOLEAN') childBoolProps[key] = true;
          }
          if (Object.keys(childBoolProps).length > 0) {
            try { node.setProperties(childBoolProps); } catch {}
          }
        }
      } catch {}
    }
    if ('children' in node && node.children) {
      for (const child of node.children) { try { enableNestedBooleans(child); } catch {} }
    }
  } catch {}
}

const frame = await figma.getNodeByIdAsync(FRAME_ID);
const variantTemplate = frame.findOne(n => n.name === '#variant-template');

const variant = variantTemplate.clone();
variantTemplate.parent.appendChild(variant);
variant.name = VARIANT_NAME;
variant.visible = true;

await loadAllFonts(variant);

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
    const LABEL_FONT = await loadFontWithFallback(FONT_FAMILY, 'Medium');
    for (const containerName of ['Light theme preview placeholder']) {
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
        await loadAllFonts(instance);
        if (BOOLEAN_UNHIDES.length > 0) {
          const boolProps = {};
          for (const bu of BOOLEAN_UNHIDES) boolProps[bu.booleanRawKey] = true;
          instance.setProperties(boolProps);
          await loadAllFonts(instance);
        }
        wrapper.appendChild(instance);

        enableNestedBooleans(instance);
        await loadAllFonts(instance);

        const label = figma.createText();
        label.fontName = LABEL_FONT;
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

  function showIndicator(row, isLast) {
    const ind = row.findOne(n => n.name === '#hierarchy-indicator');
    if (ind) {
      ind.visible = true;
      const wg = ind.findOne(n => n.name === 'within-group');
      const last = ind.findOne(n => n.name === '#hierarchy-indicator-last');
      if (wg) wg.visible = !isLast;
      if (last) last.visible = isLast;
    }
  }

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

    if (element.compositeChildren && element.compositeChildren.length > 0) {
      for (let ci = 0; ci < element.compositeChildren.length; ci++) {
        const child = element.compositeChildren[ci];
        const childRow = rowTemplate.clone();
        colorTable.appendChild(childRow);
        childRow.name = 'Row ' + child.element;
        showIndicator(childRow, ci === element.compositeChildren.length - 1);

        const cElem = childRow.findOne(n => n.name === '#element-name');
        if (cElem) {
          const txt = cElem.findOne(n => n.type === 'TEXT');
          if (txt) txt.characters = child.element;
        }
        const cToken = childRow.findOne(n => n.name === '#state-name');
        if (cToken) {
          const txt = cToken.findOne(n => n.type === 'TEXT');
          if (txt) txt.characters = child.value;
        }
        const cNotes = childRow.findOne(n => n.name === '#element-notes');
        if (cNotes) {
          const txt = cNotes.findOne(n => n.type === 'TEXT');
          if (txt) txt.characters = child.notes;
        }
      }
    }
  }

  rowTemplate.remove();
}

tableTemplate.remove();
return { success: true, variant: VARIANT_NAME };
```

#### Strategy B: Consolidated Multi-Column Layout

For each variant in the data, run the following script. Replace all `__PLACEHOLDER__` values with actual data.

- `__STATE_COLUMNS_JSON__` is the ordered array of state names that become column headers (e.g. `["Enabled", "Hovered", "Pressed", "Active", "Disabled"]`).
- `__STATE_AXIS_NAME__` is the Figma variant axis name for states (e.g. `"State"`).
- `__TABLES_JSON__` is the tables array for this variant. Each element has `element`, `tokensByState` (object mapping state name → token), `notes`, and optionally `compositeChildren` — an array of `{ element, value, notes }` objects for multi-layer style breakdowns.
- `__COLLECTION_ID__` is the variable collection ID for mode-controlled colors (e.g. `"VariableCollectionId:6006:13874"`). Set to `''` if not mode-controlled.
- `__MODE_ID__` is the variable mode ID for this section (e.g. `"6006:2"` for Gray). Set to `''` if not mode-controlled.
- `__FONT_FAMILY__` is the `fontFamily` value from `uspecs.config.json` (default: `Inter`).
- `__BOOLEAN_UNHIDES_JSON__` is an array of `{ booleanRawKey: string }` objects derived from `booleanDelta.booleanPropsToggled` in the extraction output. Set to `[]` if `booleanDelta.deltaCount === 0`.

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
const FONT_FAMILY = '__FONT_FAMILY__';
const BOOLEAN_UNHIDES = __BOOLEAN_UNHIDES_JSON__;

async function loadAllFonts(rootNode) {
  const textNodes = [];
  function collect(node) {
    try {
      if (node.type === 'TEXT') textNodes.push(node);
      if ('children' in node && node.children) {
        for (const c of node.children) { try { collect(c); } catch {} }
      }
    } catch {}
  }
  collect(rootNode);
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

function enableNestedBooleans(node) {
  try {
    if (node.type === 'INSTANCE') {
      try {
        const childProps = node.componentProperties;
        if (childProps) {
          const childBoolProps = {};
          for (const [key, val] of Object.entries(childProps)) {
            if (val.type === 'BOOLEAN') childBoolProps[key] = true;
          }
          if (Object.keys(childBoolProps).length > 0) {
            try { node.setProperties(childBoolProps); } catch {}
          }
        }
      } catch {}
    }
    if ('children' in node && node.children) {
      for (const child of node.children) { try { enableNestedBooleans(child); } catch {} }
    }
  } catch {}
}

const frame = await figma.getNodeByIdAsync(FRAME_ID);
const variantTemplate = frame.findOne(n => n.name === '#variant-template');

const variant = variantTemplate.clone();
variantTemplate.parent.appendChild(variant);
variant.name = VARIANT_NAME;
variant.visible = true;

await loadAllFonts(variant);

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
    const LABEL_FONT = await loadFontWithFallback(FONT_FAMILY, 'Medium');

    for (const containerName of ['Light theme preview placeholder']) {
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
        await loadAllFonts(inst);
        if (BOOLEAN_UNHIDES.length > 0) {
          const boolProps = {};
          for (const bu of BOOLEAN_UNHIDES) boolProps[bu.booleanRawKey] = true;
          inst.setProperties(boolProps);
          await loadAllFonts(inst);
        }
        wrapper.appendChild(inst);
        if (collection) clearModesRecursive(inst, collection);

        enableNestedBooleans(inst);
        await loadAllFonts(inst);

        const label = figma.createText();
        label.fontName = LABEL_FONT;
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

  function showIndicator(row, isLast) {
    const ind = row.findOne(n => n.name === '#hierarchy-indicator');
    if (ind) {
      ind.visible = true;
      const wg = ind.findOne(n => n.name === 'within-group');
      const last = ind.findOne(n => n.name === '#hierarchy-indicator-last');
      if (wg) wg.visible = !isLast;
      if (last) last.visible = isLast;
    }
  }

  function expandStateCols(row, values) {
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
        if (txt) txt.characters = values[s] || 'none';
      }
    }
    if (notesFrame) notesFrame.layoutSizingHorizontal = 'FILL';
  }

  for (const element of tableData.elements) {
    const row = rowTemplate.clone();
    colorTable.appendChild(row);
    row.name = 'Row ' + element.element;

    const elemFrame = row.findOne(n => n.name === '#element-name');
    if (elemFrame) {
      const txt = elemFrame.findOne(n => n.type === 'TEXT');
      if (txt) txt.characters = element.element;
    }

    const stateValues = STATE_COLUMNS.map(s => element.tokensByState[s] || 'none');
    expandStateCols(row, stateValues);

    const notesFrame = row.findOne(n => n.name === '#element-notes');
    if (notesFrame) {
      const txt = notesFrame.findOne(n => n.type === 'TEXT');
      if (txt) txt.characters = element.notes;
    }

    if (element.compositeChildren && element.compositeChildren.length > 0) {
      for (let ci = 0; ci < element.compositeChildren.length; ci++) {
        const child = element.compositeChildren[ci];
        const childRow = rowTemplate.clone();
        colorTable.appendChild(childRow);
        childRow.name = 'Row ' + child.element;
        showIndicator(childRow, ci === element.compositeChildren.length - 1);

        const cElem = childRow.findOne(n => n.name === '#element-name');
        if (cElem) {
          const txt = cElem.findOne(n => n.type === 'TEXT');
          if (txt) txt.characters = child.element;
        }
        const childStateValues = STATE_COLUMNS.map(() => child.value);
        expandStateCols(childRow, childStateValues);
        const cNotes = childRow.findOne(n => n.name === '#element-notes');
        if (cNotes) {
          const txt = cNotes.findOne(n => n.type === 'TEXT');
          if (txt) txt.characters = child.notes;
        }
      }
    }
  }

  rowTemplate.remove();
}

tableTemplate.remove();
return { success: true, variant: VARIANT_NAME };
```

### Step 12: Visual Validation

1. `figma_take_screenshot` with the `frameId` — Capture the completed annotation
2. Verify:
   - All variant sections are present with correct titles (for mode-controlled components: one section per Type × Mode combination)
   - Tables within each variant have correct element-to-token mappings with resolved semantic tokens
   - **Strategy B previews**: Each variant's preview container shows **all state instances side by side with labels** (e.g., Enabled, Hovered, Pressed, Active, Disabled)
   - **Strategy A previews**: Each variant's preview container shows a labeled component instance
   - For mode-controlled components, preview instances display the correct color mode
   - **Composite breakdowns**: Elements with multi-layer styles show nested child rows with hierarchy indicators (vertical line + elbow for middle children, elbow-only for last child). Top-level rows have indicators hidden.
   - General notes are visible or hidden as expected
3. If issues are found, fix via `figma_execute` and re-capture (up to 3 iterations)

### Step 13: Completion Link

Print a clickable Figma URL to the completed spec in chat. Construct the URL from the `fileKey` (extracted from the user's input URL) and the `frameId` (returned by Step 9), replacing `:` with `-` in the node ID:

```
Color spec complete: https://www.figma.com/design/{fileKey}/?node-id={frameId}
```

## Notes

- The color annotation template key is stored in `uspecs.config.json` under `templateKeys.colorAnnotation` and is configured via {{skill:firstrun}}.
- The target node can be either a `COMPONENT_SET` (multi-variant) or a standalone `COMPONENT` (single variant). The extraction script detects the type and returns `isComponentSet` accordingly. When the node is a standalone component, it is treated as a single-entry variant array and there are no variant axes. Preview instance creation in Step 11 uses the component directly for standalone components.
- Three-level cloning: variants → tables → rows. Each variant section is cloned from `#variant-template`, each table from `#color-table-template`, and each row from `#element-row-template`.
- **Template defaults:** `#variant-template` is hidden by default (`visible=false`) — cloned variants must be set to `visible=true`. No post-render hiding step is needed. The `#hierarchy-indicator` frame inside `#element-row-template` is also hidden by default with both vectors (`within-group`, `#hierarchy-indicator-last`) hidden — only composite child rows need to show it.
- Preview instructions: The `#preview-instruction-light` frame contains multiple TEXT nodes. The second TEXT node (index 1) receives the preview text formatted as "{ComponentName} {VariantName}".
- The extraction script (Step 4b) supports smart sampling via `SKIP_AXES` — pass color-irrelevant axes and their default values to avoid extracting redundant variants. For components with few variants (≤ 10), extracting all variants is fine.
- The instruction file (`{{ref:color/agent-color-instruction.md}}`) contains the data structure reference, examples, and element-to-token mapping rules that guide the analysis phase.
- Preview frames: Each variant section has a light theme preview container. The `Placeholder` child is removed and replaced with live component instances.
  - **Strategy A**: One labeled instance per container (wrapper frame with instance + text label).
  - **Strategy B**: Multiple labeled instances per container — one per state column. Each instance is wrapped in a vertical frame with a text label showing the state name (e.g., "Enabled", "Hovered"). The preview container uses `HORIZONTAL` layout with `itemSpacing: 24` so instances flow left to right.
- **Mode-controlled previews**: For components with a variable mode collection (e.g., "Tag color"), each preview instance wrapper has `setExplicitVariableModeForCollection(collection, modeId)` applied so the correct color mode renders. After creating each instance, `clearModesRecursive` is called to remove any baked-in modes so the instance inherits from the wrapper.
- **Mode-expanded sections**: When `hasModeCollection: true`, every mode is rendered as its own section(s) — one per Type × Mode combination. Section names use the format `"{Type} / {Mode}"` (e.g., "Primary / Gray"). Tokens are resolved per mode via `modeDetection.modeTokenMap` from the extraction output. The `collectionId` and `modeId` are passed to the rendering script for preview mode application.
- The script uses scored variant matching (exact match first, then best partial match by score) to find the correct variant child directly, rather than creating from the default and calling `setProperties()`. This handles sparse component sets where some variant combinations may not exist.
- **Column header rename:** The template's `#state-title` layer originally displays "State", but the column actually holds token names. Strategy A renames this to "Token" at render time. Strategy B replaces the column entirely with per-state columns.
- **Two rendering strategies:** Step 4c determines whether to use Strategy A or Strategy B based on the two-gate model in Step 4c-i. Strategy B clones the `#state-title` / `#state-name` cells N times (one per state). All cloned state columns and the Notes column use `layoutSizingHorizontal = 'FILL'` so Figma's auto-layout distributes width equally — no hardcoded pixel widths needed.
