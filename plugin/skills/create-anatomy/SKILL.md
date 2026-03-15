---
name: create-anatomy
description: Generate a visual anatomy annotation in Figma showing numbered markers on a component instance with an attribute table. Use when the user mentions "anatomy", "anatomy annotation", "component anatomy", "create anatomy", or wants to annotate a component's structural elements.
---

# Create Anatomy Annotation

Generate a hierarchical anatomy annotation directly in Figma — a **composition section** showing the top-level sub-components with numbered markers and a 4-column attribute table, then **per-child sections** for each INSTANCE sub-component showing all its internal elements (including hidden ones).

Uses the **Anatomy & Properties v2** template with `#annotation-table`, type indicators (`#instance` / `#text`), and `#anatomy-section` cloning.

## Inputs Expected

- **Figma link to the component**: URL to a component set or standalone component in Figma (required)
- **Figma link to the destination** (optional): URL to the page/frame where the annotation should be placed. If omitted, places it in the same file as the component.

## Workflow

Copy this checklist and update as you progress:

```
Task Progress:
- [ ] Step 1: Verify MCP connection
- [ ] Step 2: Read template key from uspecs.config.json
- [ ] Step 3: Navigate to the component and extract anatomy data (incl. property definitions)
- [ ] Step 4: Classify elements and enrich notes (AI reasoning)
- [ ] Step 5: Navigate to destination (if different file)
- [ ] Step 6: Import and detach the Anatomy template
- [ ] Step 7: Fill header fields and create composition section
- [ ] Step 8: Build composition artwork with markers + fill table
- [ ] Step 8b: Per-sub-component child sections (property-aware unhide)
- [ ] Step 10: Visual validation
```

### Step 1: Verify MCP Connection

Check that Figma Console MCP is connected:
- `figma_get_status` — Confirm Desktop Bridge plugin is active

If connection fails, guide user:
> Please open Figma Desktop and run the Desktop Bridge plugin. Then try again.

### Step 2: Read Template Key

Read the file `uspecs.config.json` and extract:
- The `anatomyOverview` value from the `templateKeys` object → save as `ANATOMY_TEMPLATE_KEY`
- The `fontFamily` value → save as `FONT_FAMILY` (default to `Inter` if not set)

If the template key is empty, tell the user:
> The anatomy template key is not configured. Run `@setup-library` with your Figma template library link first.

### Step 3: Extract Anatomy Data

Navigate to the component file and run the extraction script via `figma_execute`.

**Extract the node ID from the URL:** Figma URLs contain `node-id=123-456` → use `123:456`.

This produces a two-level hierarchy:
- **Level 1 — Composition**: Direct children of the component's default variant.
- **Level 2 — Sub-component internals**: For each INSTANCE child at Level 1, resolve its main component set, instantiate the default variant with all hidden descendants visible, and extract all direct children.

Run this extraction script, replacing `TARGET_NODE_ID` with the actual node ID:

```javascript
const TARGET_NODE_ID = '__NODE_ID__';

async function extractElement(node, index, artworkAbsX, artworkAbsY) {
  const absX = node.absoluteTransform[0][2];
  const absY = node.absoluteTransform[1][2];
  const element = {
    index,
    name: node.name,
    nodeType: node.type,
    visible: node.visible,
    bbox: {
      x: Math.round(absX - artworkAbsX),
      y: Math.round(absY - artworkAbsY),
      w: Math.round(node.width),
      h: Math.round(node.height)
    },
    notes: ''
  };

  if (node.type === 'INSTANCE') {
    try {
      const mc = await node.getMainComponentAsync();
      if (mc) {
        element.mainComponentId = mc.id;
        if (mc.parent && mc.parent.type === 'COMPONENT_SET') {
          element.mainComponentSetId = mc.parent.id;
          element.childIsComponentSet = true;
          element.notes = mc.parent.name + ' instance';
        } else {
          element.mainComponentSetId = null;
          element.childIsComponentSet = false;
          element.notes = mc.name + ' instance';
        }
      }
    } catch {}
  } else if (node.type === 'TEXT') {
    const content = node.characters || '';
    if (content.length > 0 && content.length <= 30) {
      element.notes = 'Text element — "' + content + '"';
    } else {
      element.notes = 'Text element';
    }
  } else if (node.type === 'FRAME' || node.type === 'GROUP') {
    const childCount = ('children' in node) ? node.children.length : 0;
    element.notes = childCount > 0 ? 'Contains ' + childCount + ' elements' : 'Empty container';
  } else if (['VECTOR', 'RECTANGLE', 'ELLIPSE', 'LINE', 'POLYGON', 'STAR', 'BOOLEAN_OPERATION'].includes(node.type)) {
    element.notes = 'Illustration';
  }

  return element;
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

let childContainer = variant;
while (childContainer.children.length === 1 && childContainer.children[0].type === 'FRAME' && childContainer.children[0].layoutMode !== 'NONE') {
  childContainer = childContainer.children[0];
}

if (childContainer === variant && childContainer.children.length > 1) {
  const LEAF_STRUCTURAL = ['RECTANGLE', 'VECTOR', 'ELLIPSE', 'LINE', 'POLYGON', 'STAR', 'BOOLEAN_OPERATION'];
  const autoLayoutFrames = childContainer.children.filter(c => c.type === 'FRAME' && c.layoutMode !== 'NONE' && ('children' in c) && c.children.length >= 2);
  const structuralOnly = childContainer.children.filter(c => LEAF_STRUCTURAL.includes(c.type));
  if (autoLayoutFrames.length === 1 && structuralOnly.length === childContainer.children.length - 1) {
    childContainer = autoLayoutFrames[0];
  }
}

for (const child of childContainer.children) {
  elements.push(await extractElement(child, idx++, absX, absY));
}

const propDefs = node.componentPropertyDefinitions || {};
const booleanProps = [];
const variantAxes = [];
const instanceSwapProps = [];

for (const [rawKey, def] of Object.entries(propDefs)) {
  const cleanKey = rawKey.split('#')[0];
  if (def.type === 'VARIANT') {
    variantAxes.push({ name: cleanKey, options: def.variantOptions || [], defaultValue: def.defaultValue });
  } else if (def.type === 'BOOLEAN') {
    let associatedLayer = null;
    const defaultVariantProps = variant.componentProperties;
    if (defaultVariantProps) {
      for (const [k, v] of Object.entries(defaultVariantProps)) {
        if (k.split('#')[0] === cleanKey && v.type === 'BOOLEAN') {
          const nodeIdSuffix = k.split('#')[1];
          if (nodeIdSuffix) {
            try {
              const lid = variant.id.split(';')[0] + ';' + nodeIdSuffix;
              const layerNode = await figma.getNodeByIdAsync(lid);
              if (layerNode) associatedLayer = layerNode.name;
            } catch {}
          }
        }
      }
    }
    booleanProps.push({ name: cleanKey, defaultValue: def.defaultValue, associatedLayer, rawKey });
  } else if (def.type === 'INSTANCE_SWAP') {
    let swapTargetName = def.defaultValue;
    try {
      const swapNode = await figma.getNodeByIdAsync(def.defaultValue);
      if (swapNode) swapTargetName = swapNode.name;
    } catch {}
    instanceSwapProps.push({ name: cleanKey, defaultValue: swapTargetName, rawKey });
  }
}

return {
  componentName: node.name,
  variantName: variant.name,
  compSetNodeId: TARGET_NODE_ID,
  isComponentSet,
  rootSize: { w: Math.round(variant.width), h: Math.round(variant.height) },
  elements,
  booleanProps,
  variantAxes,
  instanceSwapProps
};
```

Save the returned JSON — you will use `componentName`, `compSetNodeId`, `isComponentSet`, `rootSize`, `elements`, `booleanProps`, `variantAxes`, and `instanceSwapProps` in subsequent steps.

### Step 4: Classify Elements and Enrich Notes (AI Reasoning)

This is a pure reasoning step — no `figma_execute` calls. Read the instruction file `anatomy/agent-anatomy-instruction.md`, then enrich the extraction data in-memory before proceeding to rendering.

**Process:**

1. **Read** `anatomy/agent-anatomy-instruction.md` for classification rules, note-writing guidelines, and validation checklist.

2. **Cross-reference** each element against `booleanProps`:
   - For each element, check if its `name` matches any `booleanProps[].associatedLayer`.
   - If a match is found, record the controlling boolean's `name` and `rawKey` on the element.
   - For hidden elements (`visible === false`), set `unhideStrategy: { method: 'boolean', booleanName, booleanRawKey }`.
   - For hidden elements with no matching boolean, set `unhideStrategy: { method: 'direct' }`.

3. **Classify** each element's role using the rules from the instruction file (optional slot, instance-swap slot, fixed sub-component, content element, structural/decorative).

4. **Evaluate child section eligibility** for each INSTANCE element using the "Child Section Eligibility" rules from the instruction file. Set `shouldCreateSection: true` or `shouldCreateSection: false` on each INSTANCE element. Confidently skip utility components by name (Spacer, Divider, etc.). For structural-leaf and trivial-leaf conditions, use best judgment from naming conventions and component purpose since sub-component internals are not yet extracted — when uncertain, default to `true` and let the runtime safety net handle it. Record the decision on each element so Step 8b can check it before running `figma_execute`.

5. **Rewrite** the `notes` field for each element with semantic descriptions following the instruction file's note-writing guidelines. Replace generic notes like `"X instance"` or `"Contains N elements"` with role-based descriptions.

6. **Decide** per-child section unhide strategy: for each INSTANCE child that will get a Step 8b section (i.e., `shouldCreateSection: true`), note whether to use property-aware unhide (toggle booleans individually) or direct unhide (fallback).

7. **Validate** using the instruction file's checklist — ensure no generic notes remain, all hidden elements explain their controlling property, and `shouldCreateSection` is set on every INSTANCE element. Do NOT add cross-references ("See X anatomy section") yet — those are appended after Step 8b confirms which sections were actually created.

The enriched `elements` array (with updated `notes`, `unhideStrategy`, and `shouldCreateSection` fields) is used by all subsequent rendering steps.

### Step 5: Navigate to Destination

If the user provided a separate destination file URL:
- `figma_navigate` — Switch to the destination file

If no destination was provided, stay in the current file.

### Step 6: Import and Detach Template

Run via `figma_execute` (replace `__ANATOMY_TEMPLATE_KEY__` with the key from Step 2):

```javascript
const ANATOMY_TEMPLATE_KEY = '__ANATOMY_TEMPLATE_KEY__';

const templateComponent = await figma.importComponentByKeyAsync(ANATOMY_TEMPLATE_KEY);
const instance = templateComponent.createInstance();
const { x, y } = figma.viewport.center;
instance.x = x - instance.width / 2;
instance.y = y - instance.height / 2;
const frame = instance.detachInstance();
frame.name = '__COMPONENT_NAME__ Anatomy';
figma.currentPage.selection = [frame];
figma.viewport.scrollAndZoomIntoView([frame]);
return { frameId: frame.id };
```

Replace `__COMPONENT_NAME__` with the extracted `componentName`.

Save the returned `frameId` — you need it for all subsequent steps.

### Step 7: Fill Header Fields and Create Composition Section

This step fills the top-level header and creates a dedicated anatomy section by **cloning** `#anatomy-section`. The clone is renamed so it is not affected by other skills' cleanup. After cloning, the original `#anatomy-section` is **hidden** to prevent its placeholder text from appearing in screenshots. The property skill re-shows it if it needs additional clones.

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
  if (t) t.characters = 'Anatomy breakdown of the __COMPONENT_NAME__ component';
}

const anatomySectionTemplate = frame.findOne(n => n.name === '#anatomy-section');
const compositionSection = anatomySectionTemplate.clone();
anatomySectionTemplate.parent.appendChild(compositionSection);
compositionSection.name = 'Component structure';
compositionSection.visible = true;

const sectionFrame = compositionSection.findOne(n => n.name === '#section-name');
if (sectionFrame) {
  const t = sectionFrame.findOne(n => n.type === 'TEXT');
  if (t) t.characters = 'Component structure';
}

const sectionDescFrame = compositionSection.findOne(n => n.name === '#optional-section-description');
if (sectionDescFrame) {
  const t = sectionDescFrame.findOne(n => n.type === 'TEXT');
  if (t) t.characters = 'Elements that compose the __COMPONENT_NAME__ and their key attributes.';
}

anatomySectionTemplate.visible = false;

return { success: true, compositionSectionId: compositionSection.id };
```

Save the returned `compositionSectionId` — you need it for Step 8.

### Step 8: Build Composition Artwork with Markers + Fill Table

Run via `figma_execute`. Replace `__COMPOSITION_SECTION_ID__`, `__COMP_SET_NODE_ID__`, `__IS_COMPONENT_SET__`, the `elements` array, and `__BOOLEAN_UNHIDES_JSON__` with the enriched data from Step 4. Use the `compositionSectionId` from Step 7 to scope lookups. `__BOOLEAN_UNHIDES_JSON__` is an array of `{ booleanRawKey }` objects from elements whose `unhideStrategy.method === 'boolean'` — these booleans are toggled via `setProperties` instead of direct unhide. Pass `[]` if no boolean-controlled hidden elements exist.

**Artwork** (`#preview`): Place a component instance with hidden children made visible via property-aware unhide, then clone `#marker-example` for each element with connecting lines.

**Table** (`#annotation-table`): Clone the template `row` for each element, filling 4 cells: `#number`, `#indicator` (show/hide `#instance` vs `#text`), `#element-name`, `#notes`.

```javascript
const COMPOSITION_SECTION_ID = '__COMPOSITION_SECTION_ID__';
const COMP_SET_ID = '__COMP_SET_NODE_ID__';
const IS_COMPONENT_SET = __IS_COMPONENT_SET__;
const MARKER_COLOR = { r: 0.922, g: 0, b: 0.431 };

const elements = __ELEMENTS_JSON__;

const section = await figma.getNodeByIdAsync(COMPOSITION_SECTION_ID);
const frame = section.parent.parent;
const preview = section.findOne(n => n.name === '#preview');
const markerExample = frame.findOne(n => n.name === '#marker-example');

const MARKER_SIZE = 33;
const MARKER_OFFSET = 40;
const PADDING = 80;
const MIN_W = 1400;
const MIN_H = 290;

const compNode = await figma.getNodeByIdAsync(COMP_SET_ID);
const defaultVariant = IS_COMPONENT_SET ? (compNode.defaultVariant || compNode.children[0]) : compNode;
const compInstance = defaultVariant.createInstance();

const rootW = Math.round(compInstance.width);
const rootH = Math.round(compInstance.height);

const STAGGER_STEP_SIZING = MARKER_SIZE + 12;
const leftStaggerExtra = elements.length * STAGGER_STEP_SIZING;
const neededW = rootW + 2 * (MARKER_SIZE + MARKER_OFFSET + PADDING) + leftStaggerExtra;
const neededH = rootH + 2 * (MARKER_SIZE + MARKER_OFFSET + PADDING);
const ARTWORK_W = Math.max(MIN_W, Math.round(neededW));
const ARTWORK_H = Math.max(MIN_H, Math.round(neededH));

preview.layoutMode = 'NONE';
preview.resize(ARTWORK_W, ARTWORK_H);
preview.paddingTop = 0;
preview.paddingBottom = 0;
preview.paddingLeft = 0;
preview.paddingRight = 0;
preview.clipsContent = true;

const compX = Math.round((ARTWORK_W - rootW) / 2);
const compY = Math.round((ARTWORK_H - rootH) / 2);

preview.appendChild(compInstance);
compInstance.x = compX;
compInstance.y = compY;

const BOOLEAN_UNHIDES = __BOOLEAN_UNHIDES_JSON__;

if (BOOLEAN_UNHIDES.length > 0) {
  const currentProps = {};
  for (const bu of BOOLEAN_UNHIDES) {
    currentProps[bu.booleanRawKey] = true;
  }
  compInstance.setProperties(currentProps);
}

for (const el of elements) {
  if (!el.visible && (!el.unhideStrategy || el.unhideStrategy.method === 'direct')) {
    function findAndUnhide(node, targetName) {
      if (node.name === targetName && !node.visible) { node.visible = true; return true; }
      if ('children' in node) { for (const c of node.children) { if (findAndUnhide(c, targetName)) return true; } }
      return false;
    }
    findAndUnhide(compInstance, el.name);
  }
}

await figma.loadFontAsync({ family: FONT_FAMILY, style: 'Medium' });

const instAbsX = compInstance.absoluteTransform[0][2];
const instAbsY = compInstance.absoluteTransform[1][2];
let childContainer = compInstance;
while (childContainer.children.length === 1 && childContainer.children[0].type === 'FRAME' && childContainer.children[0].layoutMode !== 'NONE') {
  childContainer = childContainer.children[0];
}

if (childContainer === compInstance && childContainer.children.length > 1) {
  const LEAF_STRUCTURAL = ['RECTANGLE', 'VECTOR', 'ELLIPSE', 'LINE', 'POLYGON', 'STAR', 'BOOLEAN_OPERATION'];
  const autoLayoutFrames = childContainer.children.filter(c => c.type === 'FRAME' && c.layoutMode !== 'NONE' && ('children' in c) && c.children.length >= 2);
  const structuralOnly = childContainer.children.filter(c => LEAF_STRUCTURAL.includes(c.type));
  if (autoLayoutFrames.length === 1 && structuralOnly.length === childContainer.children.length - 1) {
    childContainer = autoLayoutFrames[0];
  }
}

for (let i = 0; i < elements.length; i++) {
  const el = elements[i];
  const match = childContainer.children[i];
  if (match) {
    const absX = match.absoluteTransform[0][2];
    const absY = match.absoluteTransform[1][2];
    el.bbox = {
      x: Math.round(absX - instAbsX),
      y: Math.round(absY - instAbsY),
      w: Math.round(match.width),
      h: Math.round(match.height)
    };
  }
}

const LINE_WIDTH = 1;

const xCenters = elements.map(el => el.bbox.x + el.bbox.w / 2);
const X_THRESHOLD = 20;
let useLeftStagger = false;
if (elements.length >= 2) {
  const centerCounts = {};
  for (const cx of xCenters) {
    const bucket = Math.round(cx / X_THRESHOLD) * X_THRESHOLD;
    centerCounts[bucket] = (centerCounts[bucket] || 0) + 1;
  }
  const maxGroup = Math.max(...Object.values(centerCounts));
  useLeftStagger = maxGroup / elements.length > 0.5;
}

const STAGGER_STEP = MARKER_SIZE + 12;

for (const el of elements) {
  const outline = figma.createRectangle();
  preview.appendChild(outline);
  outline.name = 'Outline ' + el.index;
  outline.x = Math.round(compX + el.bbox.x);
  outline.y = Math.round(compY + el.bbox.y);
  outline.resize(Math.max(1, el.bbox.w), Math.max(1, el.bbox.h));
  outline.fills = [];
  outline.strokes = [{ type: 'SOLID', color: MARKER_COLOR }];
  outline.strokeWeight = 1;
  outline.dashPattern = [4, 4];
}

for (const el of elements) {
  const elCenterX = compX + el.bbox.x + el.bbox.w / 2;
  const elCenterY = compY + el.bbox.y + el.bbox.h / 2;
  const elTopY = compY + el.bbox.y;
  const elBottomY = compY + el.bbox.y + el.bbox.h;
  const elLeftX = compX + el.bbox.x;

  const dot = markerExample.clone();
  preview.appendChild(dot);
  dot.name = 'Marker ' + el.index;
  dot.visible = true;
  const numText = dot.findOne(n => n.type === 'TEXT');
  if (numText) numText.characters = String(el.index);

  let dotX, dotY, lineStartX, lineStartY, lineEndX, lineEndY;

  if (useLeftStagger) {
    const staggerX = compX - MARKER_OFFSET - MARKER_SIZE - (el.index - 1) * STAGGER_STEP;
    dotX = staggerX;
    dotY = elCenterY - MARKER_SIZE / 2;
    lineStartX = dotX + MARKER_SIZE;
    lineStartY = elCenterY;
    lineEndX = elLeftX;
    lineEndY = elCenterY;
  } else if (el.index === 1) {
    dotX = compX - MARKER_OFFSET - MARKER_SIZE;
    dotY = elCenterY - MARKER_SIZE / 2;
    lineStartX = dotX + MARKER_SIZE;
    lineStartY = elCenterY;
    lineEndX = elLeftX;
    lineEndY = elCenterY;
  } else if (el.index % 2 === 0) {
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
  preview.appendChild(line);
  line.name = 'Line ' + el.index;
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

markerExample.visible = false;

// --- Fill annotation table ---
await figma.loadFontAsync({ family: FONT_FAMILY, style: 'Regular' });
const annotationTable = section.findOne(n => n.name === '#annotation-table');
const rows = annotationTable.children.filter(c => c.name === 'row');
const rowTemplate = rows[rows.length - 1];

for (const el of elements) {
  const row = rowTemplate.clone();
  annotationTable.appendChild(row);
  row.name = 'Row ' + el.index;

  const numCell = row.findOne(n => n.name === '#number');
  if (numCell) {
    const t = numCell.findOne(n => n.type === 'TEXT');
    if (t) t.characters = String(el.index);
  }

  const indicator = row.findOne(n => n.name === '#indicator');
  if (indicator) {
    const instIcon = indicator.findOne(n => n.name === '#instance');
    const textIcon = indicator.findOne(n => n.name === '#text');
    if (el.nodeType === 'INSTANCE') {
      if (instIcon) instIcon.visible = true;
      if (textIcon) textIcon.visible = false;
    } else if (el.nodeType === 'TEXT') {
      if (instIcon) instIcon.visible = false;
      if (textIcon) textIcon.visible = true;
    } else {
      if (instIcon) instIcon.visible = false;
      if (textIcon) textIcon.visible = false;
    }
  }

  const nameCell = row.findOne(n => n.name === '#element-name');
  if (nameCell) {
    const t = nameCell.findOne(n => n.type === 'TEXT');
    if (t) {
      const hiddenLabel = el.visible ? '' : ' (hidden)';
      t.characters = el.name + hiddenLabel;
    }
  }

  const notesCell = row.findOne(n => n.name === '#notes');
  if (notesCell) {
    const t = notesCell.findOne(n => n.type === 'TEXT');
    if (t) t.characters = el.notes || el.nodeType;
  }
}

rowTemplate.remove();
return { success: true };
```

### Step 8b: Per-Sub-Component Child Sections

For each direct child that is an `INSTANCE` node (has `mainComponentId` or `mainComponentSetId` in the extraction data), create a standalone anatomy section showing that child's internal structure using **only the default variant** with all hidden descendants made visible.

Skip this step entirely if no child elements have `nodeType === 'INSTANCE'`. Additionally, **check `shouldCreateSection`** on each INSTANCE child (set during Step 4 reasoning) — skip the `figma_execute` call entirely for any child where `shouldCreateSection === false`. These are utility or trivially simple sub-components (Spacer, Divider, structural-only, etc.) that don't warrant a dedicated section. The `gcElements.length <= 1` guard in the JavaScript remains as a runtime safety net, but the agent should avoid even calling `figma_execute` for ineligible children.

For **each** eligible INSTANCE child element (`shouldCreateSection === true`), run via `figma_execute` (replace `__FRAME_ID__`, `__CHILD_NAME__`, `__CHILD_COMP_ID__`, `__CHILD_IS_COMP_SET__` with values from the extraction data — use `mainComponentSetId` if `childIsComponentSet` is true, otherwise use `mainComponentId`). Replace `__CHILD_BOOLEAN_PROPS_JSON__` with the child sub-component's boolean properties (extracted from its `componentPropertyDefinitions` during Step 4 reasoning). If the child has no boolean properties, pass `[]`:

```javascript
const FRAME_ID = '__FRAME_ID__';
const CHILD_NAME = '__CHILD_NAME__';
const CHILD_COMP_ID = '__CHILD_COMP_ID__';
const CHILD_IS_COMP_SET = __CHILD_IS_COMP_SET__;
const MARKER_COLOR = { r: 0.922, g: 0, b: 0.431 };
const CHILD_BOOLEAN_PROPS = __CHILD_BOOLEAN_PROPS_JSON__;

const frame = await figma.getNodeByIdAsync(FRAME_ID);
const anatomySectionTemplate = frame.findOne(n => n.name === '#anatomy-section');
const markerExample = frame.findOne(n => n.name === '#marker-example');

const childSection = anatomySectionTemplate.clone();
anatomySectionTemplate.parent.appendChild(childSection);
childSection.name = CHILD_NAME + ' anatomy';
childSection.visible = true;

const textNodes = childSection.findAll(n => n.type === 'TEXT');
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

const sectionFrame = childSection.findOne(n => n.name === '#section-name');
if (sectionFrame) {
  const t = sectionFrame.findOne(n => n.type === 'TEXT');
  if (t) t.characters = CHILD_NAME + ' anatomy';
}

const sectionDescFrame = childSection.findOne(n => n.name === '#optional-section-description');
if (sectionDescFrame) {
  const t = sectionDescFrame.findOne(n => n.type === 'TEXT');
  if (t) t.characters = 'Internal elements of the ' + CHILD_NAME + ' sub-component.';
}

const childCompNode = await figma.getNodeByIdAsync(CHILD_COMP_ID);

function directUnhide(node) {
  if (!node.visible) node.visible = true;
  if ('children' in node) { for (const c of node.children) directUnhide(c); }
}

const singleVariant = CHILD_IS_COMP_SET
  ? (childCompNode.defaultVariant || childCompNode.children[0])
  : childCompNode;
const compInstance = singleVariant.createInstance();

if (CHILD_BOOLEAN_PROPS.length > 0) {
  const boolProps = {};
  for (const bp of CHILD_BOOLEAN_PROPS) {
    boolProps[bp.rawKey] = true;
  }
  try { compInstance.setProperties(boolProps); } catch {}
}
directUnhide(compInstance);

let grandchildContainer = compInstance;
while (grandchildContainer.children.length === 1 && grandchildContainer.children[0].type === 'FRAME' && grandchildContainer.children[0].layoutMode !== 'NONE') {
  grandchildContainer = grandchildContainer.children[0];
}

if (grandchildContainer === compInstance && grandchildContainer.children.length > 1) {
  const LEAF_STRUCTURAL = ['RECTANGLE', 'VECTOR', 'ELLIPSE', 'LINE', 'POLYGON', 'STAR', 'BOOLEAN_OPERATION'];
  const autoLayoutFrames = grandchildContainer.children.filter(c => c.type === 'FRAME' && c.layoutMode !== 'NONE' && ('children' in c) && c.children.length >= 2);
  const structuralOnly = grandchildContainer.children.filter(c => LEAF_STRUCTURAL.includes(c.type));
  if (autoLayoutFrames.length === 1 && structuralOnly.length === grandchildContainer.children.length - 1) {
    grandchildContainer = autoLayoutFrames[0];
  }
}

const LEAF_TYPES = ['TEXT', 'INSTANCE', 'VECTOR', 'RECTANGLE', 'ELLIPSE', 'LINE', 'POLYGON', 'STAR', 'BOOLEAN_OPERATION'];

function resolveLeafElements(node, depth, maxDepth, parentVisible) {
  const vis = parentVisible && node.visible;
  if (LEAF_TYPES.includes(node.type)) {
    return [{ node, name: node.name, visible: vis }];
  }
  if (('children' in node) && node.children.length > 0 && depth < maxDepth) {
    const leaves = [];
    for (const child of node.children) {
      const resolved = resolveLeafElements(child, depth + 1, maxDepth, vis);
      if (resolved.length === 1 && node.children.length === 1) {
        resolved[0].name = node.name;
      }
      leaves.push(...resolved);
    }
    return leaves;
  }
  return [{ node, name: node.name, visible: vis }];
}

const rawLeaves = [];
for (const gc of grandchildContainer.children) {
  rawLeaves.push(...resolveLeafElements(gc, 0, 4, true));
}

const gcElements = [];
let gcIdx = 1;
for (const leaf of rawLeaves) {
  const gc = leaf.node;
  const gcEl = {
    index: gcIdx++,
    name: leaf.name,
    nodeType: gc.type,
    visible: leaf.visible,
    nodeRef: gc,
    bbox: { x: 0, y: 0, w: Math.round(gc.width), h: Math.round(gc.height) },
    notes: ''
  };
  if (gc.type === 'INSTANCE') {
    try {
      const mc = await gc.getMainComponentAsync();
      if (mc) {
        const compSetName = (mc.parent && mc.parent.type === 'COMPONENT_SET') ? mc.parent.name : mc.name;
        gcEl.notes = compSetName + ' instance';
        gcEl.resolvedCompKey = (mc.parent && mc.parent.type === 'COMPONENT_SET') ? mc.parent.id : mc.id;
      }
    } catch { gcEl.notes = 'Instance'; }
  } else if (gc.type === 'TEXT') {
    const content = gc.characters || '';
    if (content.length > 0 && content.length <= 30) {
      gcEl.notes = 'Text element — "' + content + '"';
    } else {
      gcEl.notes = 'Text element';
    }
  } else if (gc.type === 'FRAME' || gc.type === 'GROUP') {
    const childCount = ('children' in gc) ? gc.children.length : 0;
    gcEl.notes = childCount > 0 ? 'Contains ' + childCount + ' elements' : 'Empty container';
  } else if (['VECTOR', 'RECTANGLE', 'ELLIPSE', 'LINE', 'POLYGON', 'STAR', 'BOOLEAN_OPERATION'].includes(gc.type)) {
    gcEl.notes = 'Illustration';
  }
  gcElements.push(gcEl);
}

// --- Collapse repeated identical siblings ---
const grouped = [];
for (const el of gcElements) {
  const groupKey = el.resolvedCompKey || el.name;
  const prev = grouped[grouped.length - 1];
  const prevKey = prev ? (prev.resolvedCompKey || prev.name) : null;
  if (prev && prev.name === el.name && prev.nodeType === el.nodeType && prevKey === groupKey) {
    prev.count = (prev.count || 1) + 1;
  } else {
    el.count = 1;
    grouped.push(el);
  }
}
let reIdx = 1;
for (const el of grouped) { el.index = reIdx++; }
const gcElementsGrouped = grouped;

if (gcElementsGrouped.length <= 1) {
  childSection.remove();
  compInstance.remove();
  return { success: true, skipped: true, childName: CHILD_NAME, elementCount: gcElementsGrouped.length, rawLeafCount: gcElements.length, reason: 'Sub-component has 1 or fewer unique element groups — section not needed' };
}

// --- Build artwork in #preview ---
const preview = childSection.findOne(n => n.name === '#preview');

const MARKER_SIZE = 33;
const MARKER_OFFSET = 40;
const PADDING = 80;
const MIN_W = 1400;
const MIN_H = 290;

const rootW = Math.round(compInstance.width);
const rootH = Math.round(compInstance.height);

const STAGGER_STEP_SIZING = MARKER_SIZE + 12;
const leftStaggerExtra = gcElementsGrouped.length * STAGGER_STEP_SIZING;
const neededW = rootW + 2 * (MARKER_SIZE + MARKER_OFFSET + PADDING) + leftStaggerExtra;
const neededH = rootH + 2 * (MARKER_SIZE + MARKER_OFFSET + PADDING);
const ARTWORK_W = Math.max(MIN_W, Math.round(neededW));
const ARTWORK_H = Math.max(MIN_H, Math.round(neededH));

preview.layoutMode = 'NONE';
preview.resize(ARTWORK_W, ARTWORK_H);
preview.paddingTop = 0;
preview.paddingBottom = 0;
preview.paddingLeft = 0;
preview.paddingRight = 0;
preview.clipsContent = true;

const compX = Math.round((ARTWORK_W - rootW) / 2);
const compY = Math.round((ARTWORK_H - rootH) / 2);

preview.appendChild(compInstance);
compInstance.x = compX;
compInstance.y = compY;

await figma.loadFontAsync({ family: FONT_FAMILY, style: 'Medium' });

const instAbsX = compInstance.absoluteTransform[0][2];
const instAbsY = compInstance.absoluteTransform[1][2];
for (const el of gcElementsGrouped) {
  const n = el.nodeRef;
  if (n && n.absoluteTransform) {
    const absX = n.absoluteTransform[0][2];
    const absY = n.absoluteTransform[1][2];
    el.bbox = {
      x: Math.round(absX - instAbsX),
      y: Math.round(absY - instAbsY),
      w: Math.round(n.width),
      h: Math.round(n.height)
    };
  }
}

const LINE_WIDTH = 1;

const xCenters = gcElementsGrouped.map(el => el.bbox.x + el.bbox.w / 2);
const X_THRESHOLD = 20;
let useLeftStagger = false;
if (gcElementsGrouped.length >= 2) {
  const centerCounts = {};
  for (const cx of xCenters) {
    const bucket = Math.round(cx / X_THRESHOLD) * X_THRESHOLD;
    centerCounts[bucket] = (centerCounts[bucket] || 0) + 1;
  }
  const maxGroup = Math.max(...Object.values(centerCounts));
  useLeftStagger = maxGroup / gcElementsGrouped.length > 0.5;
}

const STAGGER_STEP = MARKER_SIZE + 12;

for (const el of gcElementsGrouped) {
  const outline = figma.createRectangle();
  preview.appendChild(outline);
  outline.name = 'Outline ' + el.index;
  outline.x = Math.round(compX + el.bbox.x);
  outline.y = Math.round(compY + el.bbox.y);
  outline.resize(Math.max(1, el.bbox.w), Math.max(1, el.bbox.h));
  outline.fills = [];
  outline.strokes = [{ type: 'SOLID', color: MARKER_COLOR }];
  outline.strokeWeight = 1;
  outline.dashPattern = [4, 4];
}

for (const el of gcElementsGrouped) {
  const elCenterX = compX + el.bbox.x + el.bbox.w / 2;
  const elCenterY = compY + el.bbox.y + el.bbox.h / 2;
  const elTopY = compY + el.bbox.y;
  const elBottomY = compY + el.bbox.y + el.bbox.h;
  const elLeftX = compX + el.bbox.x;

  const dot = markerExample.clone();
  preview.appendChild(dot);
  dot.visible = true;
  dot.name = 'Marker ' + el.index;
  const numText = dot.findOne(n => n.type === 'TEXT');
  if (numText) numText.characters = String(el.index);

  let dotX, dotY, lineStartX, lineStartY, lineEndX, lineEndY;

  if (useLeftStagger) {
    const staggerX = compX - MARKER_OFFSET - MARKER_SIZE - (el.index - 1) * STAGGER_STEP;
    dotX = staggerX;
    dotY = elCenterY - MARKER_SIZE / 2;
    lineStartX = dotX + MARKER_SIZE;
    lineStartY = elCenterY;
    lineEndX = elLeftX;
    lineEndY = elCenterY;
  } else if (el.index === 1) {
    dotX = compX - MARKER_OFFSET - MARKER_SIZE;
    dotY = elCenterY - MARKER_SIZE / 2;
    lineStartX = dotX + MARKER_SIZE;
    lineStartY = elCenterY;
    lineEndX = elLeftX;
    lineEndY = elCenterY;
  } else if (el.index % 2 === 0) {
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
  preview.appendChild(line);
  line.name = 'Line ' + el.index;
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

// --- Fill annotation table ---
await figma.loadFontAsync({ family: FONT_FAMILY, style: 'Regular' });
const annotationTable = childSection.findOne(n => n.name === '#annotation-table');
const rows = annotationTable.children.filter(c => c.name === 'row');
const rowTemplate = rows[rows.length - 1];

for (const el of gcElementsGrouped) {
  const row = rowTemplate.clone();
  annotationTable.appendChild(row);
  row.name = 'Row ' + el.index;

  const numCell = row.findOne(n => n.name === '#number');
  if (numCell) {
    const t = numCell.findOne(n => n.type === 'TEXT');
    if (t) t.characters = String(el.index);
  }

  const indicator = row.findOne(n => n.name === '#indicator');
  if (indicator) {
    const instIcon = indicator.findOne(n => n.name === '#instance');
    const textIcon = indicator.findOne(n => n.name === '#text');
    if (el.nodeType === 'INSTANCE') {
      if (instIcon) instIcon.visible = true;
      if (textIcon) textIcon.visible = false;
    } else if (el.nodeType === 'TEXT') {
      if (instIcon) instIcon.visible = false;
      if (textIcon) textIcon.visible = true;
    } else {
      if (instIcon) instIcon.visible = false;
      if (textIcon) textIcon.visible = false;
    }
  }

  const nameCell = row.findOne(n => n.name === '#element-name');
  if (nameCell) {
    const t = nameCell.findOne(n => n.type === 'TEXT');
    if (t) {
      const hiddenLabel = el.visible ? '' : ' (hidden)';
      const countSuffix = el.count > 1 ? ' (x' + el.count + ')' : '';
      t.characters = el.name + countSuffix + hiddenLabel;
    }
  }

  const notesCell = row.findOne(n => n.name === '#notes');
  if (notesCell) {
    const t = notesCell.findOne(n => n.type === 'TEXT');
    if (t) t.characters = el.notes || el.nodeType;
  }
}

rowTemplate.remove();
return { success: true, childSectionId: childSection.id, childName: CHILD_NAME, elementCount: gcElementsGrouped.length, groupedElements: gcElementsGrouped.map(el => ({ index: el.index, name: el.name, nodeType: el.nodeType, visible: el.visible, notes: el.notes, count: el.count })) };
```

Save each returned `childSectionId` and `groupedElements` array (which includes `count` for grouped siblings).

**Enrich per-child notes (AI reasoning):** The script above produces generic notes for `groupedElements` (e.g., `"Label instance"`, `"Contains 3 elements"`). After each `figma_execute` returns, apply the same reasoning process as Step 4 — read the note-writing guidelines from `anatomy/agent-anatomy-instruction.md` and rewrite each element's `notes` with semantic descriptions. When an element has `count > 1`, the note should mention the count and explain the pattern (e.g., "Tag sub-component — category label slot (8 instances in this layout)"). Then run a lightweight `figma_execute` to update the table text:

```javascript
const CHILD_SECTION_ID = '__CHILD_SECTION_ID__';
const ENRICHED_ELEMENTS = __ENRICHED_ELEMENTS_JSON__;

const section = await figma.getNodeByIdAsync(CHILD_SECTION_ID);
const annotationTable = section.findOne(n => n.name === '#annotation-table');
const rows = annotationTable.children.filter(c => c.name.startsWith('Row '));

const textNodes = annotationTable.findAll(n => n.type === 'TEXT');
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

for (const el of ENRICHED_ELEMENTS) {
  const row = rows.find(r => r.name === 'Row ' + el.index);
  if (!row) continue;
  const notesCell = row.findOne(n => n.name === '#notes');
  if (notesCell) {
    const t = notesCell.findOne(n => n.type === 'TEXT');
    if (t) t.characters = el.notes;
  }
}

return { success: true };
```

Replace `__CHILD_SECTION_ID__` with the returned `childSectionId` and `__ENRICHED_ELEMENTS_JSON__` with the enriched elements array (only `index` and `notes` fields are needed).

Repeat for every eligible INSTANCE child element (`shouldCreateSection === true`) from the Step 3 extraction data. Skip any child where `shouldCreateSection === false` — do not call `figma_execute` for it.

After all per-child sections are processed, update the composition table's `#notes` cells: for each INSTANCE child that was **not** skipped (i.e., a section was created and `shouldCreateSection === true`), append ` — See <child name> anatomy section` to the existing notes text in the corresponding row. Do not add cross-references for skipped or ineligible children.

### Step 10: Visual Validation

1. `figma_take_screenshot` with the `frameId` — Capture the completed annotation
2. Verify:
   - All sections (composition and per-child) have pink dashed outlines around each annotated element, correct markers, and 4-column table with type icons
   - Each sub-component with `shouldCreateSection: true` has its own section with artwork showing all elements visible
   - No sections were created for ineligible children (`shouldCreateSection: false`)
   - Type indicators correctly show diamond for INSTANCE, T for TEXT, both hidden for FRAME/other
   - Hidden elements labeled "(hidden)" in element name column
   - Grouped elements show `(xN)` suffix in element name column
   - Notes column has brief functional descriptions; grouped elements mention their count
   - All markers fit within preview area
   - Per-child section titles use designer-facing names
3. If issues are found, fix via `figma_execute` and re-capture (up to 3 iterations)

## Notes

These notes document non-obvious behaviors, gotchas, and cross-step coordination that the step prose alone does not capture.

- The target node can be either a `COMPONENT_SET` or a standalone `COMPONENT`. When standalone, it is treated as its own default variant — `createInstance()` is called directly on it, and there are no variant axes.
- **Hidden children are included** in extraction because they represent toggleable boolean properties. They are made visible on the artwork instance so markers point to visible elements, but labeled "(hidden)" in the table.
- **Wrapper traversal** (Step 3 + Step 8 + Step 8b): Scripts traverse through single-child auto-layout wrappers and a fallback for `[Background RECT, Content auto-layout FRAME]` patterns. This logic is duplicated in three places — extraction, composition artwork, and per-child artwork — and must stay in sync.
- **Marker positioning**: Default mode places #1 left, evens above, odds below. Left-stagger mode (auto-detected when >50% of children share the same X center) places all markers left at staggered X positions. The mode decision uses the element's actual bbox, not the component container edge.
- Step 7 **hides** the original `#anatomy-section` after cloning. This is critical — without it, placeholder text appears in screenshots. The property skill re-shows it if it needs additional clones.
- **4-column table**: `#indicator` contains `#instance` (diamond) and `#text` (T) sub-frames — show one, hide the other. For FRAME/other types, hide both.
- **Property-aware unhide** (Step 8 + 8b): Boolean-controlled elements are toggled via `setProperties`, not blanket `recursiveUnhide`, to avoid showing mutually exclusive states simultaneously. In Step 8b, the child's own `componentPropertyDefinitions` booleans are toggled before a `directUnhide` pass catches remaining hidden elements.
- **Index-based child matching** (Step 8): Bounding boxes are refreshed by array index (`childContainer.children[i]`), not by name. This avoids failures with duplicate element names.
- **Marker visibility gotcha**: Step 8 sets `markerExample.visible = false` after composition markers. Step 8b clones from the same `#marker-example`, so each clone must explicitly set `dot.visible = true`.
- **Simplified notes**: The anatomy skill produces semantic role-based descriptions only — no colors, tokens, typography, or dimensions. Those are handled by the dedicated color, structure, and API skills.
- **Deep leaf resolution** (Step 8b): `resolveLeafElements` walks past wrapper FRAMEs (up to 4 levels) to annotate meaningful leaves. Single-child wrappers inherit the parent FRAME's name; multi-child wrappers extract each child separately.
- **Child section eligibility** (Step 4 → Step 8b): The agent sets `shouldCreateSection` on each INSTANCE element at Step 4. Utility names (Spacer, Divider, etc.) are confidently skipped; structural-leaf heuristics are best-effort with a default-to-true policy. The runtime `gcElementsGrouped.length <= 1` guard is the final safety net.
- **Repeated sibling grouping** (Step 8b): Consecutive elements with the same `name`, `nodeType`, and `resolvedCompKey` (component set/component ID for INSTANCEs, element name for other types) are collapsed into one entry with a `count` field — one outline, one marker, one table row per group, with `(xN)` suffix in the name column.
- **Cross-reference timing**: Cross-refs ("See X anatomy section") are NOT written during Step 4 note enrichment. They are appended to the composition table after all Step 8b sections are processed, once the agent knows which sections were actually created vs. skipped.
- **Pink dashed outlines**: Both composition (Step 8) and per-child (Step 8b) sections draw dashed pink rectangles (`dashPattern = [4, 4]`, `MARKER_COLOR`) around each annotated element.
