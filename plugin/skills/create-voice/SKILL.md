---
name: create-voice
description: Generate screen reader accessibility specifications for VoiceOver (iOS), TalkBack (Android), and ARIA (Web). Use when the user mentions "voice", "voiceover", "screen reader", "accessibility spec", "talkback", "aria", or wants to create accessibility documentation for a UI component.
---

# Create Voice Reader Specification

Generate a screen reader specification directly in Figma — focus order, platform-specific property tables, and announcement patterns organized by component state.

## Inputs Expected

- **Figma link**: URL to a component set or standalone component in Figma (preferred)
- **Screenshot**: Image of the UI component (alternative if no Figma link)
- **Description** (optional): Component type, states to document, context

## Workflow

Copy this checklist and update as you progress:

```
Task Progress:
- [ ] Step 1: Read instruction file and platform references
- [ ] Step 2: Verify MCP connection (if Figma link provided)
- [ ] Step 3: Read template key from uspecs.config.json
- [ ] Step 4: Gather context (MCP tools + user-provided input + structural extraction)
- [ ] Step 5: List visual parts, run merge analysis, count focus stops, identify states
- [ ] Step 6: Generate structured data (guidelines, focus order, states with platform sections)
- [ ] Step 7: Re-read instruction file (Pre-Output Validation Checklist, Common Mistakes) and audit
- [ ] Step 8: Import and detach the Screen Reader template
- [ ] Step 9: Fill header fields (component name and guidelines)
- [ ] Step 10–11: Render state sections with artwork (one figma_execute per state/focus-order entry)
- [ ] Step 12: Visual validation
```

### Step 1: Read References

Read these files before generating output:
- [agent-screenreader-instruction.md](../../screen-reader/agent-screenreader-instruction.md) — main instructions
- [voiceover.md](../../screen-reader/voiceover.md) — iOS VoiceOver patterns
- [talkback.md](../../screen-reader/talkback.md) — Android TalkBack patterns
- [aria.md](../../screen-reader/aria.md) — Web ARIA patterns

### Step 2: Verify MCP Connection

If a Figma link is provided, verify the connection:
- `figma_get_status` — Confirm Figma Desktop is running with debug flag and Desktop Bridge plugin is active

If connection fails, guide user through setup before proceeding.

### Step 3: Read Template Key

Read the file `uspecs.config.json` and extract:
- The `screenReader` value from the `templateKeys` object → save as `SCREEN_READER_TEMPLATE_KEY`
- The `fontFamily` value → save as `FONT_FAMILY` (default to `Inter` if not set)

If the template key is empty, tell the user:
> The screen reader template key is not configured. Run `@setup-library` with your Figma template library link first.

### Step 4: Gather Context

Use ALL available sources to maximize context:

**From user:**
- Any screenshots or images provided
- Component description and context
- Specific states or variants to document

**From MCP tools (when Figma link provided):**
1. `figma_navigate` — Open the component URL
2. `figma_take_screenshot` — Capture the component visually
3. `figma_get_file_data` — Get component structure, variants, and states
4. `figma_get_component_for_development` — Get component data with visual reference (if nodeId known)
5. `figma_search_components` — Find component by name if URL points to a page rather than specific component

**Extract structural data (when Figma link provided):**

Extract the node ID from the URL: Figma URLs contain `node-id=123-456` → use `123:456`.

Run this extraction script via `figma_execute`, replacing `TARGET_NODE_ID` with the actual node ID:

```javascript
const TARGET_NODE_ID = '__NODE_ID__';

async function extractElement(node, index, artworkAbsX, artworkAbsY) {
  const absX = node.absoluteTransform[0][2];
  const absY = node.absoluteTransform[1][2];
  return {
    index,
    name: node.name,
    nodeType: node.type,
    visible: node.visible,
    bbox: {
      x: Math.round(absX - artworkAbsX),
      y: Math.round(absY - artworkAbsY),
      w: Math.round(node.width),
      h: Math.round(node.height)
    }
  };
}

const node = await figma.getNodeByIdAsync(TARGET_NODE_ID);
if (!node || (node.type !== 'COMPONENT_SET' && node.type !== 'COMPONENT')) {
  return { error: 'Node is not a component set or component. Type: ' + (node ? node.type : 'null') };
}

const isComponentSet = node.type === 'COMPONENT_SET';
const variant = isComponentSet ? (node.defaultVariant || node.children[0]) : node;
const absX = variant.absoluteTransform[0][2];
const absY = variant.absoluteTransform[1][2];

const elements = [];
let idx = 1;

const rootEl = await extractElement(variant, idx++, absX, absY);
rootEl.name = node.name;
elements.push(rootEl);

let childContainer = variant;
if (variant.children.length === 1 && variant.children[0].type === 'FRAME' && variant.children[0].layoutMode !== 'NONE') {
  childContainer = variant.children[0];
}

for (const child of childContainer.children) {
  elements.push(await extractElement(child, idx++, absX, absY));
}

return {
  componentName: node.name,
  compSetNodeId: TARGET_NODE_ID,
  isComponentSet,
  rootSize: { w: Math.round(variant.width), h: Math.round(variant.height) },
  elements
};
```

Save the returned JSON — you will use `componentName`, `compSetNodeId`, `rootSize`, and `elements` in subsequent steps. The `elements` array provides structural data for merge analysis and bounding box geometry for positioning focus order markers.

### Step 5: List Visual Parts and Run Merge Analysis

Using gathered context, identify:

**A. List all visual parts:** label, input, hint text, icon, trailing button, container, divider, etc.

**B. Merge analysis — determine what gets focus vs. what merges:**
For each visual part, ask: "Is this an independent focus stop?"
- **Focus stop** — interactive element (button, input, link, switch) or navigation container (tablist, menu)
- **Merged into parent** — provides name/value/hint for a focus stop (label → input, hint → input, subtitle → list item)
- **Live region** — announced reactively, not a focus stop (error message, status update)
- **Decorative** — not announced (divider, background shape)

Consider platform-specific merge mechanisms:
- iOS: `accessibilityElement = true` on parent merges children
- Android: `mergeDescendants = true` merges children; `clickable = true` children break out
- Web: `<label for>`, `aria-describedby` merge; separate `<button>` / `<input>` never merge

**C. Count actual focus stops** — this determines whether `focusOrder` is needed (2+ stops) or not (1 stop).

**D. Grouping structure:** Apply the diagnostic questions from the instruction file. Does a container need its own semantics?

**E. States:** List all states to document. Note if focus order changes between states (e.g., error state adds a live region).

### Step 6: Generate Structured Data

Follow the schema in the instruction file. Build the data as a structured object with:
- `componentName`: string
- `guidelines`: string (general accessibility guidelines for this component)
- `focusOrder`: object (optional, only when 2+ focus stops), with `title`, `description` (optional), `tables` array
- `states`: array, each with:
  - `state`: string (e.g., "enabled", "disabled")
  - `description`: string (optional)
  - `sections`: array (3 platform sections), each with:
    - `title`: string (exact: `"VoiceOver (iOS)"`, `"TalkBack (Android)"`, `"ARIA (Web)"`)
    - `tables`: array (one per focus stop / component part), each with:
      - `name`: string (part/object name)
      - `announcement`: string (what the screen reader says)
      - `properties`: array, each with `property`, `value`, `notes`

### Step 7: Audit

Re-read the instruction file, focusing on:
- **Pre-Output Validation Checklist** — walk through each checkbox (merge analysis done? focus stops only? merged parts as properties?)
- **Common Mistakes** section (especially: listing merged parts as focus stops, confusing visual parts with focus stops)
- Section title formatting (exact: `"Focus order"`, `"VoiceOver (iOS)"`, `"TalkBack (Android)"`, `"ARIA (Web)"`)

Check your output against each rule. Fix any violations.

### Step 8: Import and Detach Template

Run via `figma_execute` (replace `__SCREEN_READER_TEMPLATE_KEY__` and `__COMPONENT_NAME__`):

```javascript
const TEMPLATE_KEY = '__SCREEN_READER_TEMPLATE_KEY__';

const templateComponent = await figma.importComponentByKeyAsync(TEMPLATE_KEY);
const instance = templateComponent.createInstance();
const { x, y } = figma.viewport.center;
instance.x = x - instance.width / 2;
instance.y = y - instance.height / 2;
const frame = instance.detachInstance();
frame.name = '__COMPONENT_NAME__ Screen reader';
figma.currentPage.selection = [frame];
figma.viewport.scrollAndZoomIntoView([frame]);
return { frameId: frame.id };
```

Save the returned `frameId` — you need it for all subsequent steps.

### Step 9: Fill Header Fields

Run via `figma_execute` (replace `__FRAME_ID__`, `__COMPONENT_NAME__`, and `__GUIDELINES__`):

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

// Set component name with "Screen reader" suffix
const compNameFrame = frame.findOne(n => n.name === '#compName');
if (compNameFrame) {
  const t = compNameFrame.findOne(n => n.type === 'TEXT');
  if (t) t.characters = '__COMPONENT_NAME__ Screen reader';
}

// Set guidelines via frame name lookup
const guidelinesFrame = frame.findOne(n => n.name === '{screen-reader-general-guidelines}');
if (guidelinesFrame) {
  const t = guidelinesFrame.findOne(n => n.type === 'TEXT');
  if (t) t.characters = '__GUIDELINES__';
}

return { success: true };
```

### Step 10–11: Render State Sections with Artwork

Steps 10 and 11 are combined into a single unified `figma_execute` script per state entry. Each script handles both the table rendering (platform sections, tables, property rows) and the focus order artwork (component instance, numbered markers, connecting lines) in one call.

The screen reader template has 4 levels of nesting: state → platform section → table → property row. To avoid timeouts, render **one `figma_execute` call per state entry**.

First, build the full list of entries to render:
1. **Focus order** (if present, `focusOrder.tables.length > 0`): rendered as the first `#state-template` clone with title "Focus order"
2. **Each state**: rendered as a `#state-template` clone with title "{ComponentName} {state}"

For each entry, run via `figma_execute`. Replace all `__PLACEHOLDER__` values. Set `RENDER_ARTWORK` to `true` when extraction data is available (Figma link input), or `false` for screenshot-only input:

```javascript
const FRAME_ID = '__FRAME_ID__';
const ENTRY_TITLE = '__ENTRY_TITLE__';
const ENTRY_DESCRIPTION = '__ENTRY_DESCRIPTION__';
const HAS_DESCRIPTION = __HAS_DESCRIPTION__;
const SECTIONS = __SECTIONS_JSON__;
const RENDER_ARTWORK = __RENDER_ARTWORK__;
const COMP_SET_ID = '__COMP_SET_NODE_ID__';
const ROOT_SIZE = __ROOT_SIZE_JSON__;
const FOCUS_STOPS = __FOCUS_STOPS_JSON__;

const frame = await figma.getNodeByIdAsync(FRAME_ID);
const stateTemplate = frame.findOne(n => n.name === '#state-template');

const stateClone = stateTemplate.clone();
stateTemplate.parent.appendChild(stateClone);
stateClone.name = ENTRY_TITLE;
stateClone.visible = true;

const textNodes = stateClone.findAll(n => n.type === 'TEXT');
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

const titleFrame = stateClone.findOne(n => n.name === '#state-title');
if (titleFrame) {
  const t = titleFrame.findOne(n => n.type === 'TEXT');
  if (t) t.characters = ENTRY_TITLE;
}

const descFrame = stateClone.findOne(n => n.name === '#optional-description');
if (descFrame) {
  if (!HAS_DESCRIPTION) {
    descFrame.visible = false;
  } else {
    const t = descFrame.findOne(n => n.type === 'TEXT');
    if (t) t.characters = ENTRY_DESCRIPTION;
  }
}

// --- Platform sections and tables ---
const sectionTemplate = stateClone.findOne(n => n.name === '#section');

for (let s = 0; s < SECTIONS.length; s++) {
  const sectionData = SECTIONS[s];
  const sectionClone = sectionTemplate.clone();
  sectionTemplate.parent.appendChild(sectionClone);
  sectionClone.name = sectionData.title;
  sectionClone.visible = true;

  const platformTitle = sectionClone.findOne(n => n.name === '#platform-title');
  if (platformTitle) {
    const t = platformTitle.findOne(n => n.type === 'TEXT');
    if (t) t.characters = sectionData.title;
  }

  const tableTemplate = sectionClone.findOne(n => n.name === '#state-table');

  for (let tb = 0; tb < sectionData.tables.length; tb++) {
    const tableData = sectionData.tables[tb];
    const tableClone = tableTemplate.clone();
    tableTemplate.parent.appendChild(tableClone);
    tableClone.name = tableData.name || 'Table';
    tableClone.visible = true;

    const headerRow = tableClone.findOne(n => n.name === '#header-row');

    const focusOrderCol = headerRow ? headerRow.findOne(n => n.name === '#focus-order') : null;
    if (focusOrderCol) {
      const t = focusOrderCol.findOne(n => n.type === 'TEXT');
      if (t) t.characters = String(tableData.focusOrderIndex);
    }

    const announcementCol = headerRow ? headerRow.findOne(n => n.name === '#announcement') : null;
    if (announcementCol) {
      const t = announcementCol.findOne(n => n.type === 'TEXT');
      if (t) t.characters = tableData.name + ' ' + tableData.announcement;
    }

    const rowTemplate = tableClone.findOne(n => n.name === '#prop-row-template');

    for (const prop of tableData.properties) {
      const row = rowTemplate.clone();
      tableClone.appendChild(row);
      row.name = 'Row ' + prop.property;

      const propName = row.findOne(n => n.name === '#prop-name');
      if (propName) {
        const t = propName.findOne(n => n.type === 'TEXT');
        if (t) t.characters = prop.property;
      }

      const propValue = row.findOne(n => n.name === '#prop-value');
      if (propValue) {
        const t = propValue.findOne(n => n.type === 'TEXT');
        if (t) t.characters = prop.value;
      }

      const propNotes = row.findOne(n => n.name === '#prop-notes');
      if (propNotes) {
        const t = propNotes.findOne(n => n.type === 'TEXT');
        if (t) t.characters = prop.notes;
      }
    }

    rowTemplate.remove();
  }

  tableTemplate.remove();
}

sectionTemplate.remove();

// --- Focus order artwork ---
if (RENDER_ARTWORK && FOCUS_STOPS.length >= 1) {
  const MARKER_COLOR = { r: 0.922, g: 0, b: 0.431 };

  const previewPlaceholder = stateClone.findOne(n => n.name === 'Preview placeholder');
  if (previewPlaceholder) {
    previewPlaceholder.layoutMode = 'NONE';
    previewPlaceholder.clipsContent = true;

    const PW = previewPlaceholder.width;
    const PH = previewPlaceholder.height;

    const compNode = await figma.getNodeByIdAsync(COMP_SET_ID);
    const defaultVariant = compNode.type === 'COMPONENT_SET'
      ? (compNode.defaultVariant || compNode.children[0])
      : compNode;
    const compInstance = defaultVariant.createInstance();
    previewPlaceholder.appendChild(compInstance);
    const compX = Math.round((PW - ROOT_SIZE.w) / 2);
    const compY = Math.round((PH - ROOT_SIZE.h) / 2);
    compInstance.x = compX;
    compInstance.y = compY;

    const instAbsX = compInstance.absoluteTransform[0][2];
    const instAbsY = compInstance.absoluteTransform[1][2];
    let childContainer = compInstance;
    if (compInstance.children.length === 1 && compInstance.children[0].type === 'FRAME' && compInstance.children[0].layoutMode !== 'NONE') {
      childContainer = compInstance.children[0];
    }
    for (const stop of FOCUS_STOPS) {
      const match = childContainer.children.find(c => c.name === stop.name);
      if (match) {
        const absX = match.absoluteTransform[0][2];
        const absY = match.absoluteTransform[1][2];
        stop.bbox = {
          x: Math.round(absX - instAbsX),
          y: Math.round(absY - instAbsY),
          w: Math.round(match.width),
          h: Math.round(match.height)
        };
      }
    }

    const markerExample = frame.findOne(n => n.name === '#marker-example');
    await figma.loadFontAsync({ family: FONT_FAMILY, style: 'Medium' });

    const MARKER_SIZE = 33;
    const LINE_WIDTH = 1;
    const MARKER_OFFSET = 40;

    for (let i = 0; i < FOCUS_STOPS.length; i++) {
      const stop = FOCUS_STOPS[i];
      const stopNum = i + 1;
      const elCenterX = compX + stop.bbox.x + stop.bbox.w / 2;
      const elTopY = compY + stop.bbox.y;
      const elBottomY = compY + stop.bbox.y + stop.bbox.h;

      const dot = markerExample.clone();
      previewPlaceholder.appendChild(dot);
      dot.name = 'Marker ' + stopNum;
      const numText = dot.findOne(n => n.type === 'TEXT');
      if (numText) numText.characters = String(stopNum);

      let dotX, dotY, lineStartX, lineStartY, lineEndX, lineEndY;

      if (stopNum === 1) {
        dotX = compX - MARKER_OFFSET - MARKER_SIZE;
        dotY = compY + stop.bbox.y + stop.bbox.h / 2 - MARKER_SIZE / 2;
        lineStartX = dotX + MARKER_SIZE;
        lineStartY = compY + stop.bbox.y + stop.bbox.h / 2;
        lineEndX = compX + stop.bbox.x;
        lineEndY = lineStartY;
      } else if (stopNum % 2 === 0) {
        dotX = elCenterX - MARKER_SIZE / 2;
        dotY = compY - MARKER_OFFSET - MARKER_SIZE;
        lineStartX = elCenterX;
        lineStartY = dotY + MARKER_SIZE;
        lineEndX = elCenterX;
        lineEndY = elTopY;
      } else {
        dotX = elCenterX - MARKER_SIZE / 2;
        dotY = elBottomY + MARKER_OFFSET;
        lineStartX = elCenterX;
        lineStartY = elBottomY;
        lineEndX = elCenterX;
        lineEndY = dotY;
      }

      dot.x = Math.round(dotX);
      dot.y = Math.round(dotY);

      const line = figma.createRectangle();
      previewPlaceholder.appendChild(line);
      line.name = 'Line ' + stopNum;
      line.fills = [{ type: 'SOLID', color: MARKER_COLOR }];

      if (lineStartX === lineEndX) {
        const topY = Math.min(lineStartY, lineEndY);
        const height = Math.abs(lineEndY - lineStartY);
        line.x = Math.round(lineStartX - LINE_WIDTH / 2);
        line.y = Math.round(topY);
        line.resize(LINE_WIDTH, Math.max(1, height));
      } else {
        const leftX = Math.min(lineStartX, lineEndX);
        const width = Math.abs(lineEndX - lineStartX);
        line.x = Math.round(leftX);
        line.y = Math.round(lineStartY - LINE_WIDTH / 2);
        line.resize(Math.max(1, width), LINE_WIDTH);
      }
    }
  }
}

return { success: true, entry: ENTRY_TITLE };
```

After all entries are rendered, hide the `#marker-example` and the original `#state-template`:

```javascript
const frame = await figma.getNodeByIdAsync('__FRAME_ID__');
const markerExample = frame.findOne(n => n.name === '#marker-example');
if (markerExample) markerExample.visible = false;
const stateTemplate = frame.findOne(n => n.name === '#state-template');
if (stateTemplate) stateTemplate.visible = false;
return { success: true };
```

**Building the entries:**

Every table in every section must have a `focusOrderIndex` — the reading order position (1, 2, 3…). Tables within each platform section are listed in focus traversal order, so the index matches the table's position in that section. For single-stop components, all tables have `focusOrderIndex: 1`.

For the focus order (if present):
- `ENTRY_TITLE` = `"Focus order"`
- `ENTRY_DESCRIPTION` = focus order description (or empty)
- `SECTIONS` = `[{ title: focusOrder.title, tables: focusOrder.tables }]`
- `FOCUS_STOPS` = all focus stops from the component's focus order tables

For each state:
- `ENTRY_TITLE` = `"__COMPONENT_NAME__ __STATE__"` (e.g., "Button enabled")
- `ENTRY_DESCRIPTION` = state description (or empty)
- `SECTIONS` = the state's sections array (3 platform sections)
- `FOCUS_STOPS` = same focus stops as the focus order entry, unless the state changes the focus order (e.g., error state adds/removes elements — adjust accordingly)

**Artwork parameters:**
- `RENDER_ARTWORK` = `true` when extraction data is available (Figma link input), `false` for screenshot-only input
- `COMP_SET_ID` = `compSetNodeId` from extraction (set to `''` when `RENDER_ARTWORK` is `false`)
- `ROOT_SIZE` = `rootSize` from extraction (set to `{ w: 0, h: 0 }` when `RENDER_ARTWORK` is `false`)
- `FOCUS_STOPS` = array of `{ index, name, bbox: {x, y, w, h} }` from extraction elements (set to `[]` when `RENDER_ARTWORK` is `false`)

### Step 12: Visual Validation

1. `figma_take_screenshot` with the `frameId` — Capture the completed spec
2. Verify:
   - Focus order section appears (if applicable) with correct table entries
   - Each state has 3 platform sections (VoiceOver, TalkBack, ARIA)
   - Tables within each section have correct part names and announcements
   - Property rows are filled with correct values
   - Guidelines text is set (no placeholder text remaining)
   - Component name includes "Screen reader" suffix
   - Component instance is present and centered in each `Preview placeholder`
   - Focus order markers match the focus stops (numbered correctly, positioned near their elements)
   - Connecting lines link markers to their target elements
3. If issues are found, fix via `figma_execute` and re-capture (up to 3 iterations)

## Notes

- The screen reader template key is stored in `uspecs.config.json` under `templateKeys.screenReader` and is configured via `@setup-library`.
- The target node can be either a `COMPONENT_SET` (multi-variant) or a standalone `COMPONENT` (single variant). The extraction script detects the type and returns `isComponentSet` accordingly. When the node is a standalone component, it is used directly for element extraction and artwork rendering.
- Four-level cloning: state → platform section → table → property row. Each level is cloned from its respective template (`#state-template` → `#section` → `#state-table` → `#prop-row-template`), filled, and the original template removed.
- The guidelines frame is found by name (`{screen-reader-general-guidelines}`), not by content search. This is handled in Step 9.
- Focus order is rendered as the first `#state-template` clone with title "Focus order". It contains a single section with the focus order tables. Regular states follow after.
- Each state entry is rendered in a single unified `figma_execute` call (Step 10–11) that handles both table rendering and artwork rendering. This avoids the previous pattern of requiring the agent to manually splice separate artwork code into each state call.
- **Markers per state, not global**: Unlike anatomy which has one artwork, voice renders markers inside each state's `Preview placeholder`. This is correct because focus order can change between states (e.g., error state might add/remove elements). Markers are always rendered, even for single-stop components — the number shows reading order position.
- The `RENDER_ARTWORK` flag controls whether artwork is generated. Set to `true` when extraction data is available (Figma link input), `false` for screenshot-only input. When `false`, the `COMP_SET_ID`, `ROOT_SIZE`, and `FOCUS_STOPS` parameters are ignored.
- The extraction script in Step 4 is a lightweight version of anatomy's extraction — it captures child names, types, and bounding boxes for marker positioning without extracting fills, tokens, or typography.
- Marker positioning alternates: #1 goes left of the component, even numbers go above, odd numbers go below (same pattern as anatomy).
- After all state entries are rendered, both `#marker-example` and `#state-template` are hidden in a single cleanup call.
- The table header row uses `#focus-order` (280px) and `#announcement` (1120px) columns inside `#header-row`. The `#focus-order` column shows the reading order number (`focusOrderIndex`), and `#announcement` shows the part name + full announcement combined (e.g., "Button \"Submit, button\"").
- The instruction file (`screen-reader/agent-screenreader-instruction.md`) and platform reference files contain the schema, merge analysis rules, and platform-specific patterns. The AI reasoning for merge analysis and announcement generation is unchanged — only the delivery mechanism has changed.
