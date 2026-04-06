---
name: create-voice
description: Generate screen reader accessibility specifications for VoiceOver (iOS), TalkBack (Android), and ARIA (Web). Use when the user mentions "voice", "voiceover", "screen reader", "accessibility spec", "talkback", "aria", or wants to create accessibility documentation for a UI component.
---

# Create Voice Reader Specification

Generate a screen reader specification directly in Figma — focus order, platform-specific property tables, and announcement patterns organized by component state.

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
- [ ] Step 7: Re-read instruction file (Validation Checklist, Common Mistakes) and audit
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

If a Figma link is provided, read `mcpProvider` from `uspecs.config.json` and verify the connection:

**If `figma-console`:**
- `figma_get_status` — Confirm Desktop Bridge plugin is active
- If connection fails: *"Please open Figma Desktop and run the Desktop Bridge plugin. Then try again."*

**If `figma-mcp`:**
- Connection is verified implicitly on the first `use_figma` call. No explicit check needed.
- If the first call fails: *"Please verify your FIGMA_API_KEY is set correctly in your MCP configuration."*

### Step 3: Read Template Key

Read the file `uspecs.config.json` and extract:
- The `screenReader` value from the `templateKeys` object → save as `SCREEN_READER_TEMPLATE_KEY`
- The `fontFamily` value → save as `FONT_FAMILY` (default to `Inter` if not set)

If the template key is empty, tell the user:
> The screen reader template key is not configured. Run `@firstrun` with your Figma template library link first.

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

async function resolvePreferredComponents(slotPropDefs, variant) {
  const allCompKeys = new Map();
  if (!Object.values(slotPropDefs).some(def => def.preferredValues && def.preferredValues.length > 0)) {
    return allCompKeys;
  }
  for (const page of figma.root.children) {
    try { await figma.setCurrentPageAsync(page); } catch { continue; }
    const comps = page.findAll(n => n.type === 'COMPONENT' || n.type === 'COMPONENT_SET');
    for (const comp of comps) {
      if (comp.key) allCompKeys.set(comp.key, comp);
      if (comp.type === 'COMPONENT_SET' && 'children' in comp) {
        for (const child of comp.children) {
          if (child.type === 'COMPONENT' && child.key) allCompKeys.set(child.key, child);
        }
      }
    }
  }
  let p = variant;
  while (p.parent && p.parent.type !== 'DOCUMENT') p = p.parent;
  if (p.type === 'PAGE') await figma.setCurrentPageAsync(p);
  return allCompKeys;
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
if (childContainer.children.length === 1 && childContainer.children[0].type === 'SLOT') {
  childContainer = childContainer.children[0];
}

async function extractChildren(container, artAbsX, artAbsY) {
  for (const child of container.children) {
    if (child.type === 'SLOT') {
      await extractChildren(child, artAbsX, artAbsY);
      continue;
    }
    const childSubs = child.children ? child.children.filter(c => c.type === 'INSTANCE') : [];
    if (childSubs.length > 1 && childSubs.every(c => c.name === childSubs[0].name)) {
      let slotIdx = 0;
      for (const slotChild of child.children) {
        const el = await extractElement(slotChild, idx++, artAbsX, artAbsY);
        el.slotIndex = slotIdx++;
        elements.push(el);
      }
    } else {
      elements.push(await extractElement(child, idx++, artAbsX, artAbsY));
    }
  }
}
await extractChildren(childContainer, absX, absY);

const propDefs = node.componentPropertyDefinitions || {};
const variantAxes = [];
const slotPropDefs = {};
const slotDefs = [];
for (const [rawKey, def] of Object.entries(propDefs)) {
  if (def.type === 'VARIANT') {
    const cleanKey = rawKey.split('#')[0];
    variantAxes.push({
      name: cleanKey,
      options: def.variantOptions || [],
      defaultValue: def.defaultValue
    });
  } else if (def.type === 'SLOT') {
    slotPropDefs[rawKey] = def;
  }
}

const booleanDefs = {};
for (const [rawKey, def] of Object.entries(propDefs)) {
  if (def.type === 'BOOLEAN') booleanDefs[rawKey] = def.defaultValue;
}

const resolvedPreferred = await resolvePreferredComponents(slotPropDefs, variant);
const slotVisibility = {};
const slotNodes = variant.findAll(n => n.type === 'SLOT');
for (const sn of slotNodes) {
  const cpRefs = sn.componentPropertyReferences || {};
  const slotDefEntry = Object.entries(slotPropDefs).find(([rawKey]) => rawKey.split('#')[0] === sn.name);
  const matchedDef = slotDefEntry ? slotDefEntry[1] : null;
  const preferredInstances = [];
  if (matchedDef && matchedDef.preferredValues) {
    for (const pv of matchedDef.preferredValues) {
      if (pv.type !== 'COMPONENT') continue;
      const compNode = resolvedPreferred.get(pv.key);
      if (!compNode) continue;
      const isSet = compNode.parent && compNode.parent.type === 'COMPONENT_SET';
      preferredInstances.push({
        componentKey: pv.key,
        componentName: compNode.name,
        componentId: compNode.id,
        isComponentSet: isSet,
        componentSetId: isSet ? compNode.parent.id : null,
        componentSetName: isSet ? compNode.parent.name : compNode.name
      });
    }
  }
  const defaultChildren = [];
  if ('children' in sn && sn.children.length > 0) {
    for (const child of sn.children) {
      const childInfo = { name: child.name, nodeType: child.type, visible: child.visible };
      if (child.type === 'INSTANCE') {
        try {
          const mc = await child.getMainComponentAsync();
          if (mc) {
            childInfo.mainComponentId = mc.id;
            childInfo.mainComponentKey = mc.key;
            const isSet = mc.parent && mc.parent.type === 'COMPONENT_SET';
            childInfo.componentSetName = isSet ? mc.parent.name : mc.name;
            childInfo.componentSetId = isSet ? mc.parent.id : null;
            childInfo.isComponentSet = isSet;
            const contextualOverrides = {};
            if (child.componentProperties) {
              for (const [k, v] of Object.entries(child.componentProperties)) {
                contextualOverrides[k.split('#')[0]] = v.value;
              }
            }
            childInfo.contextualOverrides = contextualOverrides;
          }
        } catch {}
      }
      defaultChildren.push(childInfo);
    }
  }
  const slotCleanName = sn.name;
  const visibleRawKey = cpRefs.visible || null;
  if (visibleRawKey) slotVisibility[slotCleanName] = visibleRawKey;
  slotDefs.push({
    propName: slotCleanName,
    rawKey: slotDefEntry ? slotDefEntry[0] : slotCleanName,
    description: matchedDef && matchedDef.description ? matchedDef.description : '',
    visibleRawKey,
    visiblePropName: visibleRawKey ? visibleRawKey.split('#')[0] : null,
    preferredInstances,
    defaultChildren
  });
}

return {
  componentName: node.name,
  compSetNodeId: TARGET_NODE_ID,
  isComponentSet,
  elements,
  variantAxes,
  booleanDefs,
  slotDefs,
  slotVisibility
};
```

Save the returned JSON — you will use `componentName`, `compSetNodeId`, `elements`, `variantAxes`, `booleanDefs`, `slotDefs`, and `slotVisibility` in subsequent steps. The `elements` array provides structural data for merge analysis and bounding box geometry for positioning focus order markers. The extraction script deep-recurses into SLOT nodes — when a child is `type === 'SLOT'`, the script walks into it and extracts its children directly, so interactive elements inside slots (e.g., 2 buttons in a slot) appear as separate entries for merge analysis. When a child container holds multiple identically-named INSTANCE children (composable slots), the script recurses into the slot and extracts each child individually with a `slotIndex` field for index-based matching — consistent with the anatomy skill's approach. The `variantAxes` array lists each variant property axis with its options and default value — used in Step 5F to map states to variant properties. The `booleanDefs` object maps each boolean property key to its default value — used in Step 10–11 to force-enable boolean-gated elements on the Focus Order artwork. The `slotDefs` array now carries the slot's raw key, description, boolean visibility binding, resolved `preferredInstances`, and `defaultChildren` metadata from the default variant. Use this to decide whether focus order should document the default slot content or a representative interactive preferred fill. The `slotVisibility` object still maps slot node names to their controlling boolean property key for quick conditional-focus-stop checks.

### Step 5: List Visual Parts and Run Merge Analysis

Using gathered context, identify:

**A. List all visual parts** per the instruction file (Step 1).

**B. Merge analysis — determine what gets focus vs. what merges:**
Run the merge analysis from the instruction file (Step 2) to classify each visual part as: focus stop, merged into parent, live region, or decorative.

**C. Count actual focus stops** — this determines whether `focusOrder` is needed (2+ stops) or not (1 stop).

**D. Grouping structure:** Apply the diagnostic questions from the instruction file. Does a container need its own semantics?

**E. States:** List all states to document. Note if focus order changes between states (e.g., error state adds a live region).

**E-bis. State grouping — collapse states with identical accessibility semantics:**

Filter variant axes using the `A11Y_AXES` pattern `/state|mode|interaction/i` to identify axes that may affect accessibility semantics (skip purely visual axes like Size, Shape, Theme). Then apply the state-grouping rules from the instruction file (Step 4) to collapse states with identical screen reader behavior and keep states with unique accessibility semantics separate.

**E-ter. Behavioral states from user context:** Identify behavioral states per the instruction file (Step 4). Map each to default variant props since they don't correspond to a Figma axis.

**E-quater. Slot scenario selection:** When a focus stop lives inside slot content, decide whether the documented scenario should use the slot's default child content or a preferred interactive fill. Use the extracted `slotDefs` to inspect `defaultChildren`, `preferredInstances`, and `visiblePropName`. If the default slot content already exposes the documented focus stop, prefer that concrete configuration. If the focus stop only exists when the slot is populated with a different interactive component, choose a representative preferred instance and record a slot insertion plan for the focus-order entry and any affected states.

**F. State-to-variant mapping:** Using the `variantAxes` from extraction, map each documented state to a set of variant property key-value pairs. Match state names to variant axis options (case-insensitive). When a state name matches an option on a variant axis, set that axis to the matching value and leave other axes at their defaults. When no match is found (e.g., the state is behavioral like "focused" rather than a Figma variant), use the default variant properties. Save this mapping as `stateVariantProps` — a dict from state name to `{ [axisName]: value }`. In parallel, carry `slotInsertions` into any state objects that need slot population beyond the default content.

### Step 6: Generate Structured Data

Do NOT output JSON to the user. All data flows directly into Figma template placeholders via `figma_execute`.

Follow the schema in the instruction file. Build the data as a structured object with:
- `componentName`: string
- `guidelines`: string (general accessibility guidelines for this component)
- `focusOrder`: object (optional, only when 2+ focus stops), with `title`, `description` (optional), `tables` array, and optional `slotInsertions`
- `states`: array, each with:
  - `state`: string (e.g., "enabled", "disabled")
  - `description`: string (optional)
  - `variantProps`: `Record<string, string>` — variant axis values for this state's preview (from `stateVariantProps`)
  - `slotInsertions`: `SlotInsertion[]` (optional) — slot population plan for this state's preview when the documented focus stops depend on non-default slot content
  - `sections`: array (3 platform sections), each with:
    - `title`: string (exact: `"VoiceOver (iOS)"`, `"TalkBack (Android)"`, `"ARIA (Web)"`)
    - `tables`: array (one per focus stop / component part), each with:
      - `name`: string (part/object name)
      - `announcement`: string (what the screen reader says)
      - `properties`: array, each with `property`, `value`, `notes`

`SlotInsertion` follows the same mutation-ordering rule used by the API skill: `{ slotName, componentNodeId, nestedOverrides?, textOverrides? }`. `componentNodeId` may point to a local `COMPONENT` or `COMPONENT_SET`; when it is a set, instantiate its default variant (or first child). Apply all overrides to the inserted child **before** `appendChild` into the slot.

### Step 7: Audit

Re-read the instruction file, focusing on:
- **Validation Checklist** — walk through the pre-render structured-data checks first, then the rendered-preview checks after artwork generation
- **Common Mistakes** section (especially: listing merged parts as focus stops, confusing visual parts with focus stops)
- Section title formatting (exact: `"Focus order"`, `"VoiceOver (iOS)"`, `"TalkBack (Android)"`, `"ARIA (Web)"`)

Check your output against each rule. Fix any violations.

### Step 8: Import and Detach Template

Run via `figma_execute` (replace `__SCREEN_READER_TEMPLATE_KEY__`, `__COMPONENT_NAME__`, and `__COMPONENT_NODE_ID__` with the node ID extracted from the component URL):

```javascript
const TEMPLATE_KEY = '__SCREEN_READER_TEMPLATE_KEY__';
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

frame.name = '__COMPONENT_NAME__ Screen reader';
figma.currentPage.selection = [frame];
figma.viewport.scrollAndZoomIntoView([frame]);
return { frameId: frame.id, pageId: _p.id, pageName: _p.name };
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
  try {
    const fn = tn.fontName;
    if (fn && fn !== figma.mixed && fn.family) {
      const key = fn.family + '|' + fn.style;
      if (!fontSet.has(key)) { fontSet.add(key); fontsToLoad.push(fn); }
    }
  } catch {}
}
await Promise.all(fontsToLoad.map(f => figma.loadFontAsync(f).catch(() => {})));

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
const FONT_FAMILY = '__FONT_FAMILY__';
const FRAME_ID = '__FRAME_ID__';
const ENTRY_TITLE = '__ENTRY_TITLE__';
const ENTRY_DESCRIPTION = '__ENTRY_DESCRIPTION__';
const HAS_DESCRIPTION = __HAS_DESCRIPTION__;
const SECTIONS = __SECTIONS_JSON__;
const RENDER_ARTWORK = __RENDER_ARTWORK__;
const COMP_SET_ID = '__COMP_SET_NODE_ID__';
const FOCUS_STOPS = __FOCUS_STOPS_JSON__;
const VARIANT_PROPS = __VARIANT_PROPS_JSON__;
const BOOLEAN_DEFS = __BOOLEAN_DEFS_JSON__;
const SLOT_INSERTIONS = __SLOT_INSERTIONS_JSON__;
const IS_FOCUS_ORDER_ENTRY = __IS_FOCUS_ORDER_ENTRY__;

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

async function loadAllFonts(rootNode) {
  let textNodes = [];
  try {
    textNodes = rootNode.findAll(n => n.type === 'TEXT');
  } catch {
    const walk = node => {
      if (node.type === 'TEXT') textNodes.push(node);
      if ('children' in node && node.children) {
        for (const child of node.children) walk(child);
      }
    };
    walk(rootNode);
  }
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
const stateTemplate = frame.findOne(n => n.name === '#state-template');

const stateClone = stateTemplate.clone();
stateTemplate.parent.appendChild(stateClone);
stateClone.name = ENTRY_TITLE;
stateClone.visible = true;

const textNodes = stateClone.findAll(n => n.type === 'TEXT');
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

// --- Artwork preview ---
if (RENDER_ARTWORK) {
  const MARKER_COLOR = { r: 0.922, g: 0, b: 0.431 };
  const MARKER_SIZE = 33;
  const MARKER_OFFSET = 40;
  const LINE_WIDTH = 1;
  const PADDING = 80;
  const COLLISION_GAP = 8;

  const previewPlaceholder = stateClone.findOne(n => n.name === 'Preview placeholder');
  if (previewPlaceholder) {
    const compNode = await figma.getNodeByIdAsync(COMP_SET_ID);
    if (!compNode || (compNode.type !== 'COMPONENT' && compNode.type !== 'COMPONENT_SET')) {
      return { success: false, entry: ENTRY_TITLE, reason: 'Component node not found for artwork rendering' };
    }
    const defaultVariant = compNode.type === 'COMPONENT_SET'
      ? (compNode.defaultVariant || compNode.children[0])
      : compNode;
    const compInstance = defaultVariant.createInstance();
    await loadAllFonts(compInstance);
    if (Object.keys(VARIANT_PROPS).length > 0) {
      try { compInstance.setProperties(VARIANT_PROPS); } catch (e) {}
      await loadAllFonts(compInstance);
    }
    if (IS_FOCUS_ORDER_ENTRY && Object.keys(BOOLEAN_DEFS).length > 0) {
      const enableAll = {};
      for (const key of Object.keys(BOOLEAN_DEFS)) enableAll[key] = true;
      try { compInstance.setProperties(enableAll); } catch (e) {}
      await loadAllFonts(compInstance);
    }

    if (SLOT_INSERTIONS && SLOT_INSERTIONS.length > 0) {
      for (const insertion of SLOT_INSERTIONS) {
        const slotNode = compInstance.findOne(n => n.type === 'SLOT' && n.name === insertion.slotName);
        if (!slotNode) continue;
        try { if (typeof slotNode.resetSlot === 'function') slotNode.resetSlot(); } catch (e) {}
        if ('children' in slotNode && slotNode.children.length > 0) {
          for (const existingChild of [...slotNode.children]) {
            try { existingChild.remove(); } catch (e) {}
          }
        }
        const targetNode = await figma.getNodeByIdAsync(insertion.componentNodeId);
        if (!targetNode || (targetNode.type !== 'COMPONENT' && targetNode.type !== 'COMPONENT_SET')) continue;
        const targetComp = targetNode.type === 'COMPONENT_SET'
          ? (targetNode.defaultVariant || targetNode.children[0])
          : targetNode;
        if (!targetComp || targetComp.type !== 'COMPONENT') continue;
        const insertedChild = targetComp.createInstance();
        await loadAllFonts(insertedChild);
        if (insertion.nestedOverrides && Object.keys(insertion.nestedOverrides).length > 0) {
          try {
            insertedChild.setProperties(insertion.nestedOverrides);
            await loadAllFonts(insertedChild);
          } catch (e) {}
        }
        if (insertion.textOverrides && Object.keys(insertion.textOverrides).length > 0) {
          for (const [layerName, newText] of Object.entries(insertion.textOverrides)) {
            const tn = insertedChild.findOne(n => n.type === 'TEXT' && n.name === layerName);
            if (tn) tn.characters = newText;
          }
          await loadAllFonts(insertedChild);
        }
        try {
          slotNode.appendChild(insertedChild);
          await loadAllFonts(compInstance);
        } catch (e) {
          try { insertedChild.remove(); } catch (_) {}
        }
      }
    }

    let rootW = Math.round(compInstance.width);
    let rootH = Math.round(compInstance.height);
    const markerPadding = Math.ceil(Math.max(FOCUS_STOPS.length, 1) / 4) * (MARKER_SIZE + COLLISION_GAP);
    const sideRoom = MARKER_SIZE + MARKER_OFFSET + PADDING + markerPadding;
    const neededH = rootH + 2 * sideRoom;
    const ARTWORK_W = Math.round(previewPlaceholder.width);
    let ARTWORK_H = Math.max(Math.round(neededH), 200);

    const wrapper = figma.createFrame();
    wrapper.name = 'Artwork wrapper';
    wrapper.layoutMode = 'NONE';
    wrapper.resize(ARTWORK_W, ARTWORK_H);
    wrapper.clipsContent = true;
    wrapper.fills = [];
    previewPlaceholder.appendChild(wrapper);

    let compX = Math.round((ARTWORK_W - rootW) / 2);
    let compY = Math.round((ARTWORK_H - rootH) / 2);
    wrapper.appendChild(compInstance);
    compInstance.x = compX;
    compInstance.y = compY;

    function isEffectivelyVisible(node, root) {
      let cur = node;
      while (cur && cur !== root) {
        if (cur.visible === false) return false;
        cur = cur.parent;
      }
      return true;
    }

    function findStopNode(root, stop, visibleOnly) {
      const nameFilter = n => n.name === stop.name;
      if (stop.slotIndex !== undefined) {
        const all = root.findAll(nameFilter);
        if (visibleOnly) {
          const visible = all.filter(n => isEffectivelyVisible(n, root));
          return visible[stop.slotIndex] || visible[0] || null;
        }
        return all[stop.slotIndex] || all[0] || null;
      }
      if (visibleOnly) {
        const all = root.findAll(nameFilter);
        return all.find(n => isEffectivelyVisible(n, root)) || null;
      }
      return root.findOne(nameFilter);
    }

    if (FOCUS_STOPS.length >= 1) {
      const instAbsX = compInstance.absoluteTransform[0][2];
      const instAbsY = compInstance.absoluteTransform[1][2];
      for (const stop of FOCUS_STOPS) {
        const match = findStopNode(compInstance, stop, IS_FOCUS_ORDER_ENTRY);
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

      if (IS_FOCUS_ORDER_ENTRY) {
        const missingStops = FOCUS_STOPS.filter(s => !s.bbox || !s.bbox.w);
        if (missingStops.length > 0 && compNode.type === 'COMPONENT_SET') {
        let bestVariant = null;
        let bestResolved = 0;
        for (const v of compNode.children) {
          const testInst = v.createInstance();
          if (Object.keys(BOOLEAN_DEFS).length > 0) {
            const enableAll = {};
            for (const key of Object.keys(BOOLEAN_DEFS)) enableAll[key] = true;
            try { testInst.setProperties(enableAll); } catch (e) {}
          }
          if (SLOT_INSERTIONS && SLOT_INSERTIONS.length > 0) {
            for (const insertion of SLOT_INSERTIONS) {
              const slotNode = testInst.findOne(n => n.type === 'SLOT' && n.name === insertion.slotName);
              if (!slotNode) continue;
              try { if (typeof slotNode.resetSlot === 'function') slotNode.resetSlot(); } catch (e) {}
              if ('children' in slotNode && slotNode.children.length > 0) {
                for (const existingChild of [...slotNode.children]) {
                  try { existingChild.remove(); } catch (e) {}
                }
              }
              const targetNode = await figma.getNodeByIdAsync(insertion.componentNodeId);
              if (!targetNode || (targetNode.type !== 'COMPONENT' && targetNode.type !== 'COMPONENT_SET')) continue;
              const targetComp = targetNode.type === 'COMPONENT_SET'
                ? (targetNode.defaultVariant || targetNode.children[0])
                : targetNode;
              if (!targetComp || targetComp.type !== 'COMPONENT') continue;
              const insertedChild = targetComp.createInstance();
              if (insertion.nestedOverrides && Object.keys(insertion.nestedOverrides).length > 0) {
                try { insertedChild.setProperties(insertion.nestedOverrides); } catch (e) {}
              }
              try { slotNode.appendChild(insertedChild); } catch (e) { try { insertedChild.remove(); } catch (_) {} }
            }
          }
          let resolved = 0;
          for (const s of FOCUS_STOPS) {
            if (findStopNode(testInst, s, true)) resolved++;
          }
          testInst.remove();
          if (resolved > bestResolved) { bestResolved = resolved; bestVariant = v; }
        }
        const currentResolved = FOCUS_STOPS.length - missingStops.length;
        if (bestVariant && bestResolved > currentResolved) {
          compInstance.remove();
          const newInstance = bestVariant.createInstance();
          await loadAllFonts(newInstance);
          if (Object.keys(BOOLEAN_DEFS).length > 0) {
            const enableAll = {};
            for (const key of Object.keys(BOOLEAN_DEFS)) enableAll[key] = true;
            try { newInstance.setProperties(enableAll); } catch (e) {}
            await loadAllFonts(newInstance);
          }
          if (SLOT_INSERTIONS && SLOT_INSERTIONS.length > 0) {
            for (const insertion of SLOT_INSERTIONS) {
              const slotNode = newInstance.findOne(n => n.type === 'SLOT' && n.name === insertion.slotName);
              if (!slotNode) continue;
              try { if (typeof slotNode.resetSlot === 'function') slotNode.resetSlot(); } catch (e) {}
              if ('children' in slotNode && slotNode.children.length > 0) {
                for (const existingChild of [...slotNode.children]) {
                  try { existingChild.remove(); } catch (e) {}
                }
              }
              const targetNode = await figma.getNodeByIdAsync(insertion.componentNodeId);
              if (!targetNode || (targetNode.type !== 'COMPONENT' && targetNode.type !== 'COMPONENT_SET')) continue;
              const targetComp = targetNode.type === 'COMPONENT_SET'
                ? (targetNode.defaultVariant || targetNode.children[0])
                : targetNode;
              if (!targetComp || targetComp.type !== 'COMPONENT') continue;
              const insertedChild = targetComp.createInstance();
              await loadAllFonts(insertedChild);
              if (insertion.nestedOverrides && Object.keys(insertion.nestedOverrides).length > 0) {
                try {
                  insertedChild.setProperties(insertion.nestedOverrides);
                  await loadAllFonts(insertedChild);
                } catch (e) {}
              }
              if (insertion.textOverrides && Object.keys(insertion.textOverrides).length > 0) {
                for (const [layerName, newText] of Object.entries(insertion.textOverrides)) {
                  const tn = insertedChild.findOne(n => n.type === 'TEXT' && n.name === layerName);
                  if (tn) tn.characters = newText;
                }
                await loadAllFonts(insertedChild);
              }
              try {
                slotNode.appendChild(insertedChild);
                await loadAllFonts(newInstance);
              } catch (e) {
                try { insertedChild.remove(); } catch (_) {}
              }
            }
          }
          rootW = Math.round(newInstance.width);
          rootH = Math.round(newInstance.height);
          const newNeededH = rootH + 2 * sideRoom;
          ARTWORK_H = Math.max(Math.round(newNeededH), 200);
          wrapper.resize(ARTWORK_W, ARTWORK_H);
          wrapper.appendChild(newInstance);
          compX = Math.round((ARTWORK_W - rootW) / 2);
          compY = Math.round((ARTWORK_H - rootH) / 2);
          newInstance.x = compX;
          newInstance.y = compY;
          const newAbsX = newInstance.absoluteTransform[0][2];
          const newAbsY = newInstance.absoluteTransform[1][2];
          for (const stop of FOCUS_STOPS) {
            const match = findStopNode(newInstance, stop, true);
            if (match) {
              const absX = match.absoluteTransform[0][2];
              const absY = match.absoluteTransform[1][2];
              stop.bbox = {
                x: Math.round(absX - newAbsX),
                y: Math.round(absY - newAbsY),
                w: Math.round(match.width),
                h: Math.round(match.height)
              };
            }
          }
        }
        }
      }

      // --- Focus stop outlines ---
      for (const stop of FOCUS_STOPS) {
        if (!stop.bbox || !stop.bbox.w) continue;
        const outline = figma.createRectangle();
        wrapper.appendChild(outline);
        outline.name = 'Outline ' + (FOCUS_STOPS.indexOf(stop) + 1);
        outline.x = Math.round(compX + stop.bbox.x);
        outline.y = Math.round(compY + stop.bbox.y);
        outline.resize(Math.max(1, stop.bbox.w), Math.max(1, stop.bbox.h));
        outline.fills = [];
        outline.strokes = [{ type: 'SOLID', color: MARKER_COLOR }];
        outline.strokeWeight = 1;
        outline.dashPattern = [4, 4];
      }

      const markerExample = frame.findOne(n => n.name === '#marker-example');
      await loadFontWithFallback(FONT_FAMILY, 'Medium');

      // --- Nearest-edge marker placement with collision avoidance ---
      function scoreSides(stop, rW, rH) {
        return [
          { side: 'left', dist: stop.bbox.x },
          { side: 'top', dist: stop.bbox.y },
          { side: 'right', dist: rW - (stop.bbox.x + stop.bbox.w) },
          { side: 'bottom', dist: rH - (stop.bbox.y + stop.bbox.h) }
        ].sort((a, b) => a.dist - b.dist);
      }

    function markerPos(side, stop, cX, cY, rW, rH, offset) {
      const eCX = cX + stop.bbox.x + stop.bbox.w / 2;
      const eCY = cY + stop.bbox.y + stop.bbox.h / 2;
      const eL = cX + stop.bbox.x;
      const eR = cX + stop.bbox.x + stop.bbox.w;
      const eT = cY + stop.bbox.y;
      const eB = cY + stop.bbox.y + stop.bbox.h;
      const off = offset || 0;
      if (side === 'left') {
        return { dotX: cX - MARKER_OFFSET - MARKER_SIZE, dotY: eCY - MARKER_SIZE / 2 + off, anchorX: eL, anchorY: eCY, markerEdgeX: cX - MARKER_OFFSET, markerEdgeY: eCY + off };
      } else if (side === 'right') {
        return { dotX: cX + rW + MARKER_OFFSET, dotY: eCY - MARKER_SIZE / 2 + off, anchorX: eR, anchorY: eCY, markerEdgeX: cX + rW + MARKER_OFFSET, markerEdgeY: eCY + off };
      } else if (side === 'top') {
        return { dotX: eCX - MARKER_SIZE / 2 + off, dotY: cY - MARKER_OFFSET - MARKER_SIZE, anchorX: eCX, anchorY: eT, markerEdgeX: eCX + off, markerEdgeY: cY - MARKER_OFFSET };
      } else {
        return { dotX: eCX - MARKER_SIZE / 2 + off, dotY: eB + MARKER_OFFSET, anchorX: eCX, anchorY: eB, markerEdgeX: eCX + off, markerEdgeY: eB + MARKER_OFFSET };
      }
    }

    function overlapsPlaced(dX, dY, pl) {
      for (const p of pl) {
        if (Math.abs(dX - p.x) < MARKER_SIZE + COLLISION_GAP && Math.abs(dY - p.y) < MARKER_SIZE + COLLISION_GAP) return true;
      }
      return false;
    }

    function inBounds(dX, dY, aw, ah) {
      return dX >= -MARKER_SIZE && dY >= -MARKER_SIZE && dX <= aw && dY <= ah;
    }

    const placed = [];
    const validStops = FOCUS_STOPS.filter(s => s.bbox && s.bbox.w);
    const perimeterCount = validStops.length;

    function drawLine(wr, x1, y1, x2, y2, nm) {
      if (Math.abs(x1 - x2) < 1 && Math.abs(y1 - y2) < 1) return;
      const seg = figma.createRectangle();
      wr.appendChild(seg);
      seg.name = nm;
      seg.fills = [{ type: 'SOLID', color: MARKER_COLOR }];
      if (Math.abs(x1 - x2) < 1) {
        seg.x = Math.round(x1 - LINE_WIDTH / 2);
        seg.y = Math.round(Math.min(y1, y2));
        seg.resize(LINE_WIDTH, Math.max(1, Math.abs(y2 - y1)));
      } else {
        seg.x = Math.round(Math.min(x1, x2));
        seg.y = Math.round(y1 - LINE_WIDTH / 2);
        seg.resize(Math.max(1, Math.abs(x2 - x1)), LINE_WIDTH);
      }
    }

    for (let i = 0; i < FOCUS_STOPS.length; i++) {
      const stop = FOCUS_STOPS[i];
      if (!stop.bbox || !stop.bbox.w) continue;
      const stopNum = i + 1;

      const dot = markerExample.clone();
      wrapper.appendChild(dot);
      dot.name = 'Marker ' + stopNum;
      const numText = dot.findOne(n => n.type === 'TEXT');
      if (numText) numText.characters = String(stopNum);

      const rankedSides = scoreSides(stop, rootW, rootH);
      let finalDotX, finalDotY, finalSide, finalOffset = 0;
      let foundSpot = false;

      for (let off = 0; off <= perimeterCount * (MARKER_SIZE + COLLISION_GAP); off += MARKER_SIZE + COLLISION_GAP) {
        for (const { side } of rankedSides) {
          if (off === 0) {
            const pos = markerPos(side, stop, compX, compY, rootW, rootH, 0);
            if (inBounds(pos.dotX, pos.dotY, ARTWORK_W, ARTWORK_H) && !overlapsPlaced(pos.dotX, pos.dotY, placed)) {
              finalDotX = pos.dotX; finalDotY = pos.dotY; finalSide = side; finalOffset = 0;
              foundSpot = true; break;
            }
          } else {
            for (const sign of [1, -1]) {
              const perpOff = off * sign;
              const pos = markerPos(side, stop, compX, compY, rootW, rootH, perpOff);
              if (!inBounds(pos.dotX, pos.dotY, ARTWORK_W, ARTWORK_H)) continue;
              if (!overlapsPlaced(pos.dotX, pos.dotY, placed)) {
                finalDotX = pos.dotX; finalDotY = pos.dotY; finalSide = side; finalOffset = perpOff;
                foundSpot = true; break;
              }
            }
            if (foundSpot) break;
          }
        }
        if (foundSpot) break;
      }

      if (!foundSpot) {
        const pos = markerPos(rankedSides[0].side, stop, compX, compY, rootW, rootH, 0);
        finalDotX = pos.dotX; finalDotY = pos.dotY; finalSide = rankedSides[0].side; finalOffset = 0;
      }

      placed.push({ x: finalDotX, y: finalDotY });
      dot.x = Math.round(finalDotX);
      dot.y = Math.round(finalDotY);

      const pos = markerPos(finalSide, stop, compX, compY, rootW, rootH, finalOffset);
      drawLine(wrapper, pos.markerEdgeX, pos.markerEdgeY, pos.anchorX, pos.anchorY, 'Line ' + stopNum);
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
- `VARIANT_PROPS` = for the Focus Order entry, set this to the variant that naturally shows the most focus stops. Use the merge analysis (which identifies conditional focus stops and their triggering states) and the `variantAxes` from extraction to select the variant — e.g., for a text field where the clear button only appears in Active-typing, use `{"State": "Active-typing"}`. Do NOT pass `{}` and rely solely on the fallback. The boolean-enable step, slot insertion step, and richest-variant fallback in the rendering script are safety nets, not the primary mechanism. If the documented focus stop only exists when a slot is populated with a different component, pair `VARIANT_PROPS` with `focusOrder.slotInsertions` for that representative scenario. If no single variant + slot configuration shows all stops, use the state with the most stops and note which stops are missing in the spec.
For each state:
- `ENTRY_TITLE` = `"__COMPONENT_NAME__ __STATE__"` (e.g., "Button enabled")
- `ENTRY_DESCRIPTION` = state description (or empty)
- `SECTIONS` = the state's sections array (3 platform sections)
- `FOCUS_STOPS` = same focus stops as the focus order entry, unless the state changes the focus order (e.g., error state adds/removes elements — adjust accordingly). For states where the component is entirely removed from the focus order (e.g., Disabled), set `FOCUS_STOPS = []` — the artwork will still render the component preview but without markers, outlines, or connecting lines.
- `VARIANT_PROPS` = `stateVariantProps[state]` from Step 5F (the variant axis values that switch the preview instance to this state's variant). Per-state previews do **not** auto-enable every boolean the way the Focus Order entry does, so include the state's visibility-driving properties here when they matter to the preview.
- `SLOT_INSERTIONS` = `focusOrder.slotInsertions` for the Focus Order entry, or `state.slotInsertions` for per-state entries. Use `[]` when the default slot content already matches the documented focus stops.
**Artwork parameters:**
- `FONT_FAMILY` = the `fontFamily` value from `uspecs.config.json` (default: `Inter`)
- `RENDER_ARTWORK` = `true` when extraction data is available (Figma link input), `false` for screenshot-only input
- `COMP_SET_ID` = `compSetNodeId` from extraction (set to `''` when `RENDER_ARTWORK` is `false`)
- `FOCUS_STOPS` = array of `{ index, name, slotIndex?, bbox: {x, y, w, h} }` built from extraction `elements` — use only names that appear in the extraction output. Do not invent deeply nested node names that are not in the extracted `elements` array; `findStopNode` resolves by name match and will fail silently on names that don't exist. `slotIndex` is present when the element was extracted from a slot container with identically-named siblings — used for index-based matching consistent with anatomy. Set to `[]` when `RENDER_ARTWORK` is `false`.
- `VARIANT_PROPS` = variant axis values for this entry. For the Focus Order entry, use the variant showing the most focus stops (see guidance above). For per-state entries, use `stateVariantProps[state]`. Set to `{}` when `RENDER_ARTWORK` is `false`.
- `BOOLEAN_DEFS` = `booleanDefs` from extraction (set to `{}` when `RENDER_ARTWORK` is `false`)
- `SLOT_INSERTIONS` = array of `{ slotName, componentNodeId, nestedOverrides?, textOverrides? }`. `componentNodeId` may refer to a local component or component set. Use this when a documented focus stop depends on preferred slot content rather than the default slot children. All overrides must be applied before `appendChild` into the slot. Set to `[]` when `RENDER_ARTWORK` is `false` or no slot population is needed.
- `IS_FOCUS_ORDER_ENTRY` = `true` for the Focus Order entry, `false` for per-state entries

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
   - Any slot-hosted focus stop listed in the tables is actually present in the rendered preview; if it depends on preferred content, the slot has been populated accordingly
   - Connecting lines link markers to their target elements
   - Dashed outlines surround each focus stop in the artwork
   - Artwork preview text is updated through the same `textOverrides` and `slotInsertions` choices used to build the documented scenario (no stray "Label" placeholders)
3. If issues are found, fix via `figma_execute` and re-capture (up to 3 iterations)

### Step 13: Completion Link

Print a clickable Figma URL to the completed spec in chat. Construct the URL from the `fileKey` (extracted from the user's input URL) and the `frameId` (returned by Step 8), replacing `:` with `-` in the node ID:

```
Screen reader spec complete: https://www.figma.com/design/{fileKey}/?node-id={frameId}
```

## Notes

- The screen reader template key is stored in `uspecs.config.json` under `templateKeys.screenReader` and is configured via `@firstrun`.
- The target node can be either a `COMPONENT_SET` (multi-variant) or a standalone `COMPONENT` (single variant). The extraction script detects the type and returns `isComponentSet` accordingly. When the node is a standalone component, it is used directly for element extraction and artwork rendering.
- Four-level cloning: state → platform section → table → property row. Each level is cloned from its respective template (`#state-template` → `#section` → `#state-table` → `#prop-row-template`), filled, and the original template removed.
- The guidelines frame is found by name (`{screen-reader-general-guidelines}`), not by content search. This is handled in Step 9.
- Focus order is rendered as the first `#state-template` clone with title "Focus order". It contains a single section with the focus order tables. Regular states follow after.
- Each state entry is rendered in a single unified `figma_execute` call (Step 10–11) that handles both table rendering and artwork rendering. This avoids the previous pattern of requiring the agent to manually splice separate artwork code into each state call.
- **Markers per state, not global**: Unlike anatomy which has one artwork, voice renders markers inside each state's `Preview placeholder`. This is correct because focus order can change between states (e.g., error state might add/remove elements). Markers are rendered for every state that has at least one focus stop, even single-stop components — the number shows reading order position. For states where the component is removed from the focus order (e.g., Disabled), pass `FOCUS_STOPS = []` so only the component preview is rendered without markers, outlines, or connecting lines.
- The `RENDER_ARTWORK` flag controls whether artwork is generated. Set to `true` when extraction data is available (Figma link input), `false` for screenshot-only input. When `false`, the `COMP_SET_ID` and `FOCUS_STOPS` parameters are ignored.
- The extraction script in Step 4 is a lightweight version of anatomy's extraction — it captures child names, types, and bounding boxes for marker positioning without extracting fills, tokens, or typography. It deep-recurses into SLOT nodes to extract their children individually, so interactive elements inside slots appear as separate entries for merge analysis. It also reads SLOT property definitions, resolves `preferredValues` to local component nodes, records default slot children, and reads boolean visibility bindings (`slotVisibility`) so the agent can distinguish between default slot content and representative interactive slot fills.
- Preview-content changes should use the same mechanisms the render script understands: direct text updates on the main instance where needed, plus `slotInsertions` for slot-hosted content. Do not model preview content with a separate `artworkLabels` field.
- **Dynamic preview sizing**: The `Preview placeholder` keeps its template auto-layout. An inner wrapper frame (`layoutMode = 'NONE'`, `clipsContent = true`, transparent fills) is created and appended as an auto-layout child. The wrapper **width** is read from `previewPlaceholder.width` so it matches the template's layout width — this prevents the wrapper from blowing out the spec frame horizontally. The wrapper **height** is computed dynamically from the component height plus marker room (`rootH + 2 * sideRoom`), with a 200px floor to prevent collapse on tiny components. The component instance, outlines, markers, and lines are all placed inside the wrapper using absolute coordinates, while the template auto-layout controls the wrapper's position within the overall spec. This eliminates the stale `ROOT_SIZE` centering problem — `compX`/`compY` are calculated from live rendered dimensions. The sizing formula uses uniform `markerPadding` on all four sides based on `Math.ceil(stopCount / 4) * (MARKER_SIZE + COLLISION_GAP)`.
- **Marker positioning** uses the **nearest-edge + collision avoidance** algorithm (same as anatomy). For each focus stop, score all four sides by distance from the element's edge to the component boundary, then pick the shortest. Before placing, check overlap with all already-placed markers (8px minimum gap). If overlap, apply perpendicular offset; if offset exceeds bounds, try next-best side. Connectors are always straight lines from the marker to the element's nearest edge.
- After all state entries are rendered, both `#marker-example` and `#state-template` are hidden in a single cleanup call.
- The table header row uses `#focus-order` (280px) and `#announcement` (1120px) columns inside `#header-row`. The `#focus-order` column shows the reading order number (`focusOrderIndex`), and `#announcement` shows the part name + full announcement combined (e.g., "Button \"Submit, button\"").
- The instruction file (`screen-reader/agent-screenreader-instruction.md`) and platform reference files contain the schema, merge analysis rules, and platform-specific patterns. The AI reasoning for merge analysis and announcement generation is unchanged — only the delivery mechanism has changed.
- **Font loading for component instances**: The Step 10–11 rendering script uses `loadAllFonts(rootNode)` to load all fonts from a component instance's text nodes. This is called after `createInstance()` and after each `setProperties()` call (which may reveal hidden text nodes with different fonts). The `loadAllFonts` pattern reads `tn.fontName` from each text node (guarding against `figma.mixed`) rather than guessing font style names — per the Figma MCP server guide, font style names are file-dependent and must be discovered, not hardcoded.
- Variant properties are applied via `setProperties()` after instance creation; the `try/catch` handles behavioral states (e.g., "focused") that don't map to a Figma variant.
- Bounding boxes are captured from the live instance (no `detachInstance()` is ever called in artwork rendering — instances stay live throughout). For the Focus Order entry, `findStopNode` uses ancestor-aware visibility matching (`visibleOnly: true`) that walks the parent chain to confirm the node and all its ancestors are visible — this ensures the richest-variant fallback triggers when boolean-enable alone cannot surface all focus stops.
- For the Focus Order entry, focus stop visibility is maximized in four steps: (1) the agent sets `VARIANT_PROPS` to a variant where all focus stops are naturally visible; (2) all boolean properties from `booleanDefs` are force-enabled via `setProperties`; (3) any required `SLOT_INSERTIONS` are applied so slot-hosted interactive content actually exists in the preview; (4) `findStopNode` uses ancestor-aware visibility (`isEffectivelyVisible` walks the parent chain), so elements hidden by a parent container correctly report as unresolved — if unresolved stops remain, the richest-variant fallback iterates all variants, reapplies slot insertions, selects the best, resizes the wrapper, and re-centers. Per-state entries use `visibleOnly: false` and skip the fallback entirely.
- **Focus stop outlines**: Pink dashed rectangles (`dashPattern = [4, 4]`, `strokeWeight = 1`, `MARKER_COLOR`) are drawn around each focus stop's bounding box in the artwork. These use the same values as the anatomy skill for cross-skill visual consistency.
- **SLOT and composable slot handling**: The extraction script handles both native Figma SLOT nodes (`type === 'SLOT'`) and the legacy composable slot pattern (multiple identically-named INSTANCE children). For native SLOTs, the `extractChildren` helper deep-recurses — when a child is `type === 'SLOT'`, it walks into the SLOT's children instead of extracting the SLOT itself. This ensures interactive elements inside a SLOT (e.g., 2 buttons) appear as separate entries for merge analysis. The extracted `slotDefs` tell you whether those children come from the default content or whether you should use a preferred interactive fill. During artwork rendering, `SLOT_INSERTIONS` populate the chosen preferred content before bbox capture, and all nested overrides/text overrides are applied before `appendChild` to avoid compound-ID mutation issues. For the legacy pattern, when a child container holds multiple identically-named INSTANCE children, the script recurses and extracts each child individually with a `slotIndex` field. The `findStopNode` helper uses `slotIndex` for index-based matching (consistent with anatomy's approach), falling back to name-based `findOne` for uniquely-named elements. Bbox capture from `findStopNode` always runs on the live instance, ensuring SLOT nodes and their children are intact.
- **Behavioral states**: States driven by user-described configurations (single-select vs. multi-select, collapsed vs. expanded) that don't correspond to Figma variant axes are documented as separate entries with default variant props. The "Disabled" rule in Step 5E-bis applies to component-level disabled only — sub-component disabled is shown as an archetype within a behavioral state.
