---
name: create-motion
description: Generate motion specification annotations from After Effects timeline data. Use when the user mentions "motion", "motion spec", "animation spec", "timeline", or wants to document a component's animation properties.
---

# Create Motion Spec

Generate a motion specification directly in Figma — timeline bars and detail tables documenting all animated properties from an After Effects composition.

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

The user triggers this skill with one of these patterns:
- {{skill:create-motion}} + pasted JSON (from clipboard, exported via `{{ref:motion/export-timeline.jsx}}`)
- {{skill:create-motion}} + a file reference (e.g., `@motion-ex.json` or a path to a `.json` file)
- {{skill:create-motion}} + a Figma link (destination page/file where the annotation should be placed)

**Required:** The exported JSON data — either pasted inline or referenced as a file.

**Optional:**
- Figma link to the destination page (if not provided, place on current page at viewport center)
- Screenshot or recording of the animation
- Description of the animation's purpose

## Workflow

Copy this checklist and update as you progress:

```
Task Progress:
- [ ] Step 1: Read instruction file
- [ ] Step 2: Verify MCP connection
- [ ] Step 3: Read template key from uspecs.config.json
- [ ] Step 4: Gather context (JSON from paste, file reference, or prompt user)
- [ ] Step 5: Parse and validate JSON (including segments[] and hasAnimatedSegments)
- [ ] Step 6: Transform data (read pre-computed segments, compute track width, timeline positions)
- [ ] Step 7: Re-read instruction file (Errors and Anti-Patterns, Validation Checklist) and audit
- [ ] Step 8: Import and detach the Motion template
- [ ] Step 9: Fill header fields
- [ ] Step 10: Generate time ruler
- [ ] Step 11: Render timeline layers (one figma_execute per layer)
- [ ] Step 12: Hide templates
- [ ] Step 13: Render table rows
- [ ] Step 14: Visual validation
```

### Step 1: Read Instructions

Read [agent-motion-instruction.md]({{ref:motion/agent-motion-instruction.md}})

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
- The `motionSpec` value from the `templateKeys` object → save as `MOTION_TEMPLATE_KEY`

If the template key is empty, tell the user:
> The motion spec template key is not configured. Run {{skill:firstrun}} with your Figma template library link first.

### Step 4: Gather Context

Check what the user provided:

1. **JSON already provided** (pasted inline or as a file reference like `@motion-ex.json`) → read it and proceed directly to Step 5. Do not ask for it again.
2. **Only a Figma link** (destination) but no JSON → prompt:
   > Please paste the exported JSON or reference the `.json` file (e.g., `@motion-ex.json`).
3. **Nothing provided** → prompt:
   > Please paste the exported JSON from `export-timeline.jsx`, or reference the `.json` file.

If a Figma destination link was provided, use `figma_navigate` to open it before rendering (Step 8).

Also accept any optional screenshots, recordings, or descriptions the user provides for additional context.

### Step 5: Parse and Validate JSON

Validate the clipboard JSON against the schema and validation rules in the instruction file (JSON Schema and JSON Validation Rules sections). If validation fails, tell the user exactly which field is missing or malformed and ask them to re-export.

### Step 6: Transform Data

The export script pre-computes segments, value formatting, bar labels, easing labels, and no-change filtering. The agent reads these directly and only computes layout-dependent values.

**6a. Skip non-animated layers** — Check `layer.hasAnimatedSegments`. If `false`, omit the layer from timeline and table.

**6b. Read pre-computed segments** — Each property has a `segments[]` array with `startMs`, `endMs`, `durationMs`, `fromValue`, `toValue`, `barLabel`, `easing`, and `easingType`. Use these values directly — no manual computation needed.

**6c. Compute track width and pxPerMs** — `pxPerMs` is a fixed rate; `trackWidth` is dynamic with right padding for tick labels:
```
compDurationMs = composition.durationMs   // read directly from JSON
pxPerMs = 0.64                           // fixed rate — ~320px per 500ms tick
trackWidth = max(compDurationMs * pxPerMs + 50, 1600)   // data area + 50px label padding, min 1600
```

Pass `trackWidth` and `pxPerMs` to the Figma rendering code. `pxPerMs` is a fixed rate (0.64), not derived from `trackWidth / compDurationMs`. Bar positions (`barX`, `barWidth`) are computed inside the Figma code at render time — the agent does **not** compute per-segment positions.

At render time, resize both `#track-area` and `#ruler-track` to this computed `trackWidth`. The parent containers use HUG sizing and expand automatically.

**6d. Format composition meta** per the instruction file's Composition Meta rules. Save as `COMPOSITION_META`.

### Step 7: Audit

Re-read the instruction file, focusing on:
- **Errors and Anti-Patterns** section
- **Pre-Output Validation Checklist**

Check your transformed data against each rule. Fix any violations.

### Step 8: Import and Detach Template

Run via `figma_execute` (replace `__MOTION_TEMPLATE_KEY__` and `__COMPONENT_NAME__`):

```javascript
const TEMPLATE_KEY = '__MOTION_TEMPLATE_KEY__';

const templateComponent = await figma.importComponentByKeyAsync(TEMPLATE_KEY);
const instance = templateComponent.createInstance();
const { x, y } = figma.viewport.center;
instance.x = x - instance.width / 2;
instance.y = y - instance.height / 2;
const frame = instance.detachInstance();
frame.name = '__COMPONENT_NAME__ Motion';
figma.currentPage.selection = [frame];
figma.viewport.scrollAndZoomIntoView([frame]);
return { frameId: frame.id };
```

Save the returned `frameId` — you need it for all subsequent steps.

### Step 9: Fill Header Fields

Run via `figma_execute` (replace `__FRAME_ID__`, `__COMPONENT_NAME__`, `__COMPOSITION_META__`):

```javascript
const FRAME_ID = '__FRAME_ID__';

const frame = await figma.getNodeByIdAsync(FRAME_ID);
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

const compName = frame.findOne(n => n.name === '#component-name');
if (compName) {
  const t = compName.type === 'TEXT' ? compName : compName.findOne(n => n.type === 'TEXT');
  if (t) t.characters = '__COMPONENT_NAME__';
}

const compDesc = frame.findOne(n => n.name === '#component-description');
if (compDesc) {
  const t = compDesc.type === 'TEXT' ? compDesc : compDesc.findOne(n => n.type === 'TEXT');
  if (t) t.characters = 'Motion Specification';
}

const compMeta = frame.findOne(n => n.name === '#composition-meta');
if (compMeta) {
  const t = compMeta.type === 'TEXT' ? compMeta : compMeta.findOne(n => n.type === 'TEXT');
  if (t) t.characters = '__COMPOSITION_META__';
}

return { success: true };
```

### Step 10: Generate Time Ruler

Run via `figma_execute`. Compute the ideal track width, resize `#ruler-track` and all `#track-area` nodes, then clone `#tick` for each interval.

Replace `__FRAME_ID__`, `__COMP_DURATION_MS__` (read from `composition.durationMs`), `__TRACK_WIDTH__` (computed in Step 6c), and `__PX_PER_MS__` (fixed at 0.64):

```javascript
const FRAME_ID = '__FRAME_ID__';
const COMP_DURATION_MS = __COMP_DURATION_MS__;
const TRACK_WIDTH = __TRACK_WIDTH__;
const PX_PER_MS = __PX_PER_MS__;

const frame = await figma.getNodeByIdAsync(FRAME_ID);
const rulerTrack = frame.findOne(n => n.name === '#ruler-track');
if (!rulerTrack) return { error: '#ruler-track not found' };

// Resize ruler track to computed width
rulerTrack.resize(TRACK_WIDTH, rulerTrack.height);

// Resize all #track-area nodes (in layer template and any cloned layers)
const trackAreas = frame.findAll(n => n.name === '#track-area');
for (const ta of trackAreas) {
  ta.resize(TRACK_WIDTH, ta.height);
}

// Find the #tick template inside the ruler track
const tickTemplate = rulerTrack.findOne(n => n.name === '#tick');
if (!tickTemplate) return { error: '#tick template not found in #ruler-track' };

// Load fonts from the tick template's text nodes
const tickTextNodes = tickTemplate.findAll(n => n.type === 'TEXT');
for (const tn of tickTextNodes) {
  if (tn.characters.length > 0) {
    try { await figma.loadFontAsync(tn.fontName); } catch {}
  }
}

// Tick interval: aim for 6–12 ticks
const tickInterval = COMP_DURATION_MS <= 300 ? 50
  : COMP_DURATION_MS <= 600 ? 100
  : COMP_DURATION_MS <= 1500 ? 250
  : COMP_DURATION_MS <= 4000 ? 500
  : COMP_DURATION_MS <= 10000 ? 1000
  : 2000;

for (let ms = 0; ms <= COMP_DURATION_MS; ms += tickInterval) {
  const xPos = ms * PX_PER_MS;
  const tick = tickTemplate.clone();
  rulerTrack.appendChild(tick);
  tick.name = ms + 'ms';
  tick.visible = true;
  tick.x = xPos;

  const label = tick.findOne(n => n.type === 'TEXT');
  if (label) {
    try { await figma.loadFontAsync(label.fontName); } catch {}
    label.characters = ms + 'ms';
  }
}

tickTemplate.visible = false;
return { success: true, trackWidth: TRACK_WIDTH, tickInterval: tickInterval };
```

### Step 11: Render Timeline Layers

Run **one `figma_execute` call per layer** to avoid timeouts. For each layer (where `hasAnimatedSegments` is `true`), clone the `#layer-template`, set the layer name, then for each animated property clone `#property-template` and position bars.

Replace all `__PLACEHOLDER__` values. `__PROPERTIES_JSON__` is an array where each entry has `name` and `segments[]` — each segment with `startMs`, `durationMs`, `easingType`, and `barLabel` (straight from the JSON). The Figma code computes bar positions at render time using `PX_PER_MS`, so the agent does **not** pre-compute `barX`/`barWidth`.

```javascript
const FRAME_ID = '__FRAME_ID__';
const LAYER_NAME = '__LAYER_NAME__';
const PX_PER_MS = __PX_PER_MS__;
const TRACK_WIDTH = __TRACK_WIDTH__;
const PROPERTIES = __PROPERTIES_JSON__;

const frame = await figma.getNodeByIdAsync(FRAME_ID);
const layerTemplate = frame.findOne(n => n.name === '#layer-template');
if (!layerTemplate) return { error: '#layer-template not found' };

const layer = layerTemplate.clone();
layerTemplate.parent.appendChild(layer);
layer.name = LAYER_NAME;
layer.visible = true;

const textNodes = layer.findAll(n => n.type === 'TEXT');
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

// Read legend colors directly from color nodes
const colorBezier = frame.findOne(n => n.name === '#color-bezier');
const colorLinear = frame.findOne(n => n.name === '#color-linear');
const colorHold = frame.findOne(n => n.name === '#color-hold');

function getNodeColor(node) {
  if (!node) return { r: 0.5, g: 0.5, b: 0.5 };
  if (node.fills && node.fills.length > 0 && node.fills[0].color) {
    return node.fills[0].color;
  }
  return { r: 0.5, g: 0.5, b: 0.5 };
}

const colors = {
  BEZIER: getNodeColor(colorBezier),
  LINEAR: getNodeColor(colorLinear),
  HOLD: getNodeColor(colorHold)
};

const layerNameNode = layer.findOne(n => n.name === '#layer-name');
if (layerNameNode) {
  const t = layerNameNode.type === 'TEXT' ? layerNameNode : layerNameNode.findOne(n => n.type === 'TEXT');
  if (t) t.characters = LAYER_NAME;
}

const propertyTemplate = layer.findOne(n => n.name === '#property-template');
if (!propertyTemplate) return { error: '#property-template not found in layer' };

for (let p = 0; p < PROPERTIES.length; p++) {
  const prop = PROPERTIES[p];

  const propNode = propertyTemplate.clone();
  propertyTemplate.parent.appendChild(propNode);
  propNode.name = prop.name;
  propNode.visible = true;

  // Load fonts for cloned text nodes
  const propTextNodes = propNode.findAll(n => n.type === 'TEXT');
  for (const tn of propTextNodes) {
    if (tn.characters.length > 0) {
      try { await figma.loadFontAsync(tn.fontName); } catch {}
    }
  }

  const propNameNode = propNode.findOne(n => n.name === '#property-name');
  if (propNameNode) {
    const t = propNameNode.type === 'TEXT' ? propNameNode : propNameNode.findOne(n => n.type === 'TEXT');
    if (t) t.characters = prop.name;
  }

  // Render bars in the track area
  const trackArea = propNode.findOne(n => n.name === '#track-area');
  const barTemplate = propNode.findOne(n => n.name === '#bar-template');

  if (trackArea && barTemplate) {
    for (let s = 0; s < prop.segments.length; s++) {
      const seg = prop.segments[s];
      let barX = seg.startMs * PX_PER_MS;
      let barW = Math.max(seg.durationMs * PX_PER_MS, 4);
      if (barX + barW > TRACK_WIDTH) barW = TRACK_WIDTH - barX;

      const bar = barTemplate.clone();
      trackArea.appendChild(bar);
      bar.name = 'bar-' + s;
      bar.visible = true;
      bar.x = barX;
      bar.y = 0;
      bar.resize(barW, bar.height);
      bar.fills = [{ type: 'SOLID', color: colors[seg.easingType] || colors.LINEAR }];

      const barLabel = bar.findOne(n => n.name === '#bar-label');
      if (barLabel) {
        const t = barLabel.type === 'TEXT' ? barLabel : barLabel.findOne(n => n.type === 'TEXT');
        if (t) {
          try { await figma.loadFontAsync(t.fontName); } catch {}
          t.characters = seg.barLabel;
        }
      }
    }
    barTemplate.visible = false;
  }
}

propertyTemplate.visible = false;
return { success: true, layer: LAYER_NAME, propertyCount: PROPERTIES.length };
```

### Step 12: Hide Templates

After all layers are rendered, hide the original `#layer-template`:

```javascript
const frame = await figma.getNodeByIdAsync('__FRAME_ID__');
const layerTemplate = frame.findOne(n => n.name === '#layer-template');
if (layerTemplate) layerTemplate.visible = false;
return { success: true };
```

### Step 13: Render Table Rows

Run one `figma_execute` call to clone `#table-row-template` for each segment. If there are more than 15 rows, split into multiple calls.

Replace `__FRAME_ID__` and `__ROWS_JSON__`. Each row has: `element` (layer name), `property` (property name), `from` (`segment.fromValue`), `to` (`segment.toValue`), `duration` (`segment.durationMs` + "ms"), `delay` (`segment.startMs` + "ms"), `easing` (`segment.easing`).

Only include rows from layers where `hasAnimatedSegments` is `true`.

```javascript
const FRAME_ID = '__FRAME_ID__';
const ROWS = __ROWS_JSON__;

const frame = await figma.getNodeByIdAsync(FRAME_ID);
const rowTemplate = frame.findOne(n => n.name === '#table-row-template');
if (!rowTemplate) return { error: '#table-row-template not found' };

const textNodes = rowTemplate.findAll(n => n.type === 'TEXT');
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

for (let i = 0; i < ROWS.length; i++) {
  const row = ROWS[i];
  const rowNode = rowTemplate.clone();
  rowTemplate.parent.appendChild(rowNode);
  rowNode.name = 'Row ' + i;
  rowNode.visible = true;

  const fields = {
    '#cell-element': row.element,
    '#cell-property': row.property,
    '#cell-from': row.from,
    '#cell-to': row.to,
    '#cell-duration': row.duration,
    '#cell-delay': row.delay,
    '#cell-easing': row.easing
  };

  for (const [selector, value] of Object.entries(fields)) {
    const cell = rowNode.findOne(n => n.name === selector);
    if (cell) {
      const t = cell.type === 'TEXT' ? cell : cell.findOne(n => n.type === 'TEXT');
      if (t) t.characters = value;
    }
  }
}

rowTemplate.visible = false;
return { success: true, rowCount: ROWS.length };
```

### Step 14: Visual Validation

1. `figma_take_screenshot` with the `frameId` — Capture the completed annotation
2. Verify:
   - All layers with `hasAnimatedSegments: true` are present in the timeline
   - Layers with `hasAnimatedSegments: false` are absent
   - Each property has the correct number of bars (one per segment in `segments[]`)
   - Bar colors match the easing type (blue=Bezier, gray=Linear, orange=Hold from legend)
   - Bars are positioned correctly within the track (no overlaps, no overflow)
   - Time ruler ticks are evenly spaced and aligned with bar positions
   - Table rows match the total number of segments across all rendered properties
   - All table cells are filled with correct data
   - Header fields show the correct component name, description, and composition meta
3. If issues are found, fix via `figma_execute` and re-capture (up to 3 iterations)

### Step 15: Completion Link

Print a clickable Figma URL to the completed spec in chat. Construct the URL from the `fileKey` (extracted from the user's destination URL, or the current file if no destination was provided) and the `frameId` (returned by Step 8), replacing `:` with `-` in the node ID:

```
Motion spec complete: https://www.figma.com/design/{fileKey}/?node-id={frameId}
```

## Notes

- The motion spec template key is stored in `uspecs.config.json` under `templateKeys.motionSpec` and is configured via {{skill:firstrun}}.
- Unlike other skills, motion spec data comes from the clipboard (After Effects export), not from Figma MCP extraction. There is no component to inspect in Figma. The spec is placed at viewport center (or on the destination page if a Figma link was provided).
- `#property-template`, `#bar-template`, and `#table-row-template` may be hidden in the template by default. Clones must set `.visible = true`; originals are hidden after cloning.
- The `figma_execute` splitting strategy is: 1 call for import+detach, 1 for header, 1 for time ruler, 1 per layer for timeline, 1 for hiding templates, and 1 (or more) for table rows.
