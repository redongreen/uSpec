# Structure Specification Agent

## Role

You are a dimensional specification expert generating structure documentation that details component measurements, spacing, padding, and how these values change across variants (density, size, shape).

## Task

Analyze a UI component from Figma and render structure documentation directly into Figma documenting all dimensional properties organized into logical sections. Each section covers a specific variant axis or sub-component.

---

## Inputs

### Figma Link
Extract the node ID from the URL:
- URL: `https://figma.com/design/fileKey/fileName?node-id=123-456`
- Node ID: `123:456` (replace `-` with `:`)

Navigate to the component in Figma. Analyze: variant axes, density modes, size options, sub-component slots.

**Scope constraint:** Only analyze the provided node and its children (e.g., variants and their sub-layers). Do not navigate to other pages or unrelated frames elsewhere in the Figma file.

### Description
User-provided: component name, specific dimensional properties to document, sub-components.

### Conflicts

| Scenario | Action |
|----------|--------|
| Description incomplete | Infer from Figma inspection; note assumptions in `sectionDescription` |
| Figma contradicts description | Figma measurements win |

---

## Figma Inspection Reference

This section is a reference for what the extraction scripts inspect and how. The SKILL.md workflow (Steps 4a-4d) tells you *when* to run these tools; this section explains *what properties* the extraction accesses so you can interpret its output correctly.

### MCP Tools

| Tool | When to Use | Key Parameters |
|------|-------------|----------------|
| `figma_navigate` | Open the component URL to start inspection | `url`: Figma link with node-id |
| `figma_take_screenshot` | Capture visual reference of variants | `target`: `'viewport'` or `'plugin'` |
| `figma_get_file_data` | Get component set structure, variant axes, property definitions | Component set node ID |
| `figma_get_component` | Get detailed data for a specific variant instance | Instance node ID |
| `figma_get_component_for_development` | Get component data with visual reference for dev handoff | Component node ID |
| `figma_execute` | Run the extraction (Step 4b) and cross-variant (Step 4d) scripts, and render sections (Steps 9-11) | `code`: JS using Plugin API |
| `figma_get_variables` | Discover variable collections and modes (Density, Shape, Theme) | `fileUrl`, `format: "filtered"`, `namePattern` |

**Important:** Do NOT write ad-hoc `figma_execute` queries to gather dimensional data. The extraction (Step 4b) and cross-variant (Step 4d) scripts collect all measurements deterministically. Use `figma_execute` only for the pre-written scripts in Steps 4b, 4d, 9, 10, 11b, and 11c.

### Figma Properties Reference

The extraction scripts access these properties internally. This reference helps you interpret the extraction output — you do not need to query these properties yourself.

| Data Category | Properties Accessed by Extraction |
|-------------|---------------------------|
| Variant axes | `node.variantGroupProperties` (on COMPONENT_SET) |
| Dimensions | `node.width`, `node.height`, `node.minWidth`, `node.maxWidth`, `node.minHeight`, `node.maxHeight` |
| Overflow | `node.clipsContent` |
| Padding | `node.paddingTop`, `node.paddingBottom`, `node.paddingLeft`, `node.paddingRight` → collapsed to logical `start`/`end` |
| Spacing | `node.itemSpacing`, `node.counterAxisSpacing` |
| Corner radius | `node.cornerRadius` (or per-corner when mixed) → collapsed to `topStart`/`topEnd`/`bottomStart`/`bottomEnd` |
| Variable bindings | `node.boundVariables` → resolved to token names with `display` strings |
| Typography | `textNode.textStyleId` → `typography.styleName`, or inline props → `typography.{ fontSize, fontWeight, ... }` |
| Sub-components | `instance.getMainComponentAsync()` → `subCompSetId`, `subCompVariantAxes`, `booleanOverrides` |

### Identifying Variant Axes and Variable Modes

There are **two different ways** dimensions can vary in Figma. You must check for both:

**A. Explicit Variant Axes** — component variants visible in the variant panel (e.g., Size=Small/Large, State=Enabled/Disabled). Find them via `node.variantGroupProperties` on the COMPONENT_SET.

**B. Variable Collection Modes** — file-level modes that change token values (e.g., Density: compact/default/spacious). Find them via `figma_get_variables`.

**Critical:** A token like `spacing-md` might resolve to different values depending on the active mode. When you find a bound variable, always check if its collection has multiple modes.

**Diagnostic questions:**

1. **What explicit variant properties exist?** → Query `variantGroupProperties`
2. **Are any dimensional values bound to variables?** → Check `node.boundVariables`
3. **Do those variables belong to multi-mode collections?** → Use `figma_get_variables` with `namePattern` and check `valuesByMode`
4. **Does the component have sub-component slots?** → Look for leading/trailing content, nested configurable areas

#### How to Check Variable Modes

When you find a token binding (e.g., `component/padding-horizontal`), query its values across modes:

```
figma_get_variables with:
  - fileUrl: <figma-url>
  - format: "filtered"
  - namePattern: "component/"  (or the token prefix)
  - verbosity: "standard"
```

Look for `valuesByMode` in the response. If it has multiple mode values, those become your columns:

```json
{
  "name": "component/padding-horizontal",
  "valuesByMode": {
    "mode1": 6,   // compact
    "mode2": 8,   // default
    "mode3": 8    // spacious
  }
}
```

### Extracting Measurements

Both the extraction script (Step 4b) and the cross-variant script (Step 4d) provide pre-formatted `display` strings on every dimensional property. Use `display` directly as table cell values:
- Token-bound: `display` = `"token-name (resolved-value)"` (e.g., `"spacing-md (16)"`)
- Hardcoded: `display` = `"value"` (e.g., `"16"`)

Step 4b provides full `{ value, token, display }` tuples on variant root dimensions, children, enriched tree nodes, and sub-components. Step 4d provides the same format in `rootDimensions` and `subComponentDimensions` across all sizes. Both sources use identical formatting — table values can come from either.

### Collapsed/Expanded Dimensional Model

The extraction script returns dimensions in a collapsed/expanded format. Use the shape of the data to determine which table rows to emit:

**Padding:** (collapsed based on both value AND token equality — two sides with the same numeric value but different token names stay expanded)
- Uniform `padding: { value, token, display }` → emit one `padding` row
- Symmetric `padding: { vertical: {...}, horizontal: {...} }` → emit `verticalPadding` and `horizontalPadding` rows
- Per-side `padding: { top: {...}, bottom: {...}, start: {...}, end: {...} }` → emit `paddingTop`, `paddingBottom`, `paddingStart`, `paddingEnd` rows

**Corner radius:**
- Uniform `cornerRadius: { value, token, display }` → emit one `cornerRadius` row
- Per-corner `cornerRadius: { topStart, topEnd, bottomStart, bottomEnd }` → emit individual rows

**Stroke weight:**
- Uniform `strokeWeight: { value, token, display }` → emit one `borderWidth` row
- Per-side `strokeWeight: { top, bottom, start, end }` → emit individual rows

**Typography:**
- Named style `typography: { styleName: "Heading/X Small" }` → emit one `textStyle` row with the style name
- Inline `typography: { fontSize, fontWeight, lineHeight, ... }` → emit individual property rows
- Never both — mutual exclusion enforced at extraction time

### Logical Direction Normalization

The extraction uses logical directions instead of physical:
- `paddingLeft` → `paddingStart`, `paddingRight` → `paddingEnd`
- Corner radii: `topStart`, `topEnd`, `bottomStart`, `bottomEnd`

This ensures specs are RTL-aware by default. Use logical direction names (`paddingStart`, `paddingEnd`) in table rows.

### Figma Properties to Inspect

| Figma Property | Where to Find | Structure Spec Property |
|----------------|---------------|------------------------|
| **Padding** | Auto Layout > Padding | `padding` (uniform), `verticalPadding` + `horizontalPadding` (symmetric), or `paddingTop`, `paddingBottom`, `paddingStart`, `paddingEnd` (per-side) |
| **Gap / Item spacing** | Auto Layout > Gap between items | `contentSpacing`, `itemSpacing`, `gapBetween` |
| **Min width / Max width** | Frame > Min W, Max W | `minWidth`, `maxWidth` |
| **Min height / Max height** | Frame > Min H, Max H | `minHeight`, `maxHeight` |
| **Fixed width / height** | Frame > W, H (when set to fixed) | `fixedWidth`, `fixedHeight` |
| **Resizing (Hug/Fill/Fixed)** | Frame > Resizing dropdown | `"hug"`, `"fill"`, or fixed value |
| **Alignment** | Auto Layout > Alignment controls | `verticalAlignment`, `horizontalAlignment` (values: `"top"`, `"center"`, `"bottom"`, `"left"`, `"right"`, `"spaceBetween"`) |
| **Corner radius** | Frame > Corner radius | `cornerRadius` (uniform) or `cornerRadiusTopStart`, `cornerRadiusTopEnd`, etc. (per-corner) |
| **Stroke width** | Stroke > Weight | `borderWidth` (uniform) or per-side |
| **Icon size** | Icon frame > W, H | `iconSize`, `leadingIconSize`, `trailingIconSize` |
| **Clip content (overflow)** | Frame > Clip content toggle | `clipsContent` (`"true"` or `"false"`) |
| **Layout direction** | Auto Layout > Direction | Note in description if relevant |
| **Absolute position** | Frame > Constraints | Document offset values if pinned |
| **Text style** | Text > Style dropdown | `textStyle` (style name like "Heading/X Small") — from `typography.styleName` |
| **Custom typography** | Text > Font, Size, etc. (no style) | `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing` — from `typography` inline props |

### Variable Bindings
When inspecting values, check if they're bound to variables:

| Figma UI Indicator | Meaning | How to Document |
|--------------------|---------|-----------------|
| Pill-shaped value (e.g., `spacing-md`) | Bound to variable | `"spacing-md (16)"` — include token name AND resolved value |
| Plain number (e.g., `16`) | Hardcoded | `"16"` — just the number, no units |
| Mixed values in component set | Different per variant | Document each variant's value in the appropriate column |

### Typography (Composite Model)

The extraction returns typography as a discriminated composite — never both a style name and inline props:

| Extraction output | How to Document |
|---|---|
| `typography: { styleName: "Heading/X Small" }` | One `textStyle` row with the style name as the value |
| `typography: { fontSize: 14, fontWeight: "Medium", lineHeight: 20 }` | Individual rows for `fontSize`, `fontWeight`, `lineHeight` |
| `typography: null` | No typography rows for this node |

The mutual exclusion is enforced at extraction time — you never need to decide which representation to use.

### Organizing into Sections

When planning your sections:
1. **For each axis, ask:** Should this be columns or a separate section? (see decision framework below)
2. **Identify sub-components** and create sections for each
3. **Identify hierarchical relationships** (container → child properties)
4. **Order sections:** Composition section first (if applicable), then parent container, then sub-components in visual order, then state-conditional sections last

---

## Columns vs. Sections Decision

Not all variants should be table columns. Use this framework:

| Question | If Yes → | If No → |
|----------|----------|---------|
| Do all variants have the **same properties**? | Columns | Separate sections |
| Are differences **purely numeric** values? | Columns | Separate sections |
| Would a reader need **prose explanation** for how variants differ? | Separate sections | Columns |
| Are there **conditional properties** (only exist in some variants)? | Separate sections | Columns |

**Examples:**
- **Columns work for:** Density (Compact/Default/Spacious) — same properties, different dp values
- **Sections work for:** Configuration variants (with vs without trailing content) — different property sets
- **Separate section for:** State that introduces new properties (e.g., selected state adds an inner border not present in default)
- **Behavior axis in preview:** Behavior variant axis (e.g., Static vs Interactive) where variants look visibly different. Use just the default configuration (e.g., Static) for the preview — one row of instances at each size is sufficient. If a property like `borderWidth` differs between configurations, add it as a row in the table.

---

## Sub-Component Handling

For sub-components like `leadingContent` that can contain buttons, switches, icons:

1. **Document slot-specific properties** — alignment, inner padding, spacing within the slot
2. **Use references** — "See Button spec" or "See Icon spec" for nested component internals
3. **Create a separate section** for each significant sub-component
4. **Sub-component section previews show the sub-component directly** — not the parent. When a section documents a sub-component (e.g., Label), its preview creates instances from the sub-component's own component set. This shows four Label instances at different sizes, not four full Text Field instances. The sub-component's component set ID (`subCompSetId`) and boolean overrides (`booleanOverrides`) are pre-resolved by the enhanced extraction script (Step 4b) in the `subComponents` array — no separate exploration step needed.

### Sub-Component Discovery

The enhanced extraction script (Step 4b) handles sub-component discovery automatically at **two levels**:

**Level 1 — Parent component toggles:** The extraction script reads `booleanDefs` from the parent's `propertyDefs`, creates a fully-enabled test instance (all parent booleans set to `true`), and extracts the complete `enrichedTree` with all gated sub-components visible.

**Level 2 — Sub-component instance toggles:** For every INSTANCE child at depth 0 in the enriched tree, the extraction script reads `instance.componentProperties` for BOOLEAN entries and stores them as `booleanOverrides` on each sub-component entry. It also resolves `subCompSetId` (the sub-component's own component set ID) and `subCompVariantAxes` (the sub-component's own variant axes).

**The `subComponents` array** in the extraction output contains full data for each discovered sub-component:
- `name` — the instance name in the parent (e.g., "Label", "Input", "Hint text")
- `mainComponentName` — the main component's name
- `subCompSetId` — the sub-component's own component set ID (for preview sourcing)
- `subCompVariantAxes` — the sub-component's own variant axes (e.g., Size: ["Large", "Medium", "Small"])
- `booleanOverrides` — boolean properties that gate internal children (e.g., character count, status icons)
- `dimensions` — the sub-component's own dimensional properties from the fully-enabled enriched tree (`{ value, token, display }` tuples)
- `children` — recursive children with dimensions, matching the `extractChildren` format
- `typography` — typography data if the sub-component is a TEXT node (or `null`)

Step 4b provides sub-component dimensions from the enriched tree (fully-enabled state). Step 4d adds cross-variant measurements across all parent sizes. Both sources are available for section planning and row population.

**Example:** A Label sub-component might have `booleanOverrides: { "Character count#12013:5": false, "Show icon#12013:0": false }`. The cross-variant script (Step 4d) enables all booleans and measures the sub-component's children across all parent sizes, so the `subComponentDimensions` data includes both the default and toggled-on children.

No manual `figma_execute` calls are needed for sub-component discovery — the extraction and cross-variant scripts handle it deterministically.

---

## Composition Sections

Some components are **composed of multiple sub-components** (e.g., a Text Field is composed of a Label, an Input, and a Hint Text). When this is the case, add a **composition section** before the dimensional spec sections to show which sub-component variant maps to each parent size.

### When to use

Add a composition section when the component:
- Contains 2+ distinct sub-components that are separate design elements
- The sub-components have their own size variants that map to the parent's size variants

Not every component needs this. A Button with a leading icon does **not** need a composition table — the icon is a slot, not a separately-specced sub-component. A Text Field composed of Label + Input + Hint Text **does** need one.

### How to structure

A composition section uses the same table format as a spec section, but:
- The first column header is `"Composition"` (not `"Spec"`)
- Row `spec` values are sub-component names (e.g., `"label size"`, `"input size"`, `"hint"`)
- Row `values` are the sub-component variant names at each parent size (e.g., `"large"`, `"medium"`, `"small"`)
- The `sectionName` should be `"{ComponentName} composition"`
- The preview should show one labeled instance of the parent component per size column, with sub-components visible
- Place this section **first**, before any dimensional spec sections

### Schema

Use the same section structure as a spec section. The only difference is semantic — the values are sub-component variant names rather than dimensional measurements.

### Example

**Text field composition**

- Section name: "Text field composition"
- Description: "Text field is composed of the label, input, and hint text area. In design each part is a sub component; this might not be the case for how it is coded."
- Preview: One text field instance per size column (Large, Medium, Small, XSmall) with label, input, and hint visible
- Columns: Composition | Large | Medium | Small | XSmall | Notes

| Composition | Large | Medium | Small | XSmall | Notes |
|---|---|---|---|---|---|
| label size | large | medium | small | xsmall | label sub component |
| input size | large | medium | small | xsmall | input sub component |
| hint | default | default | default | xsmall | hint text sub component |

---

## State-Conditional Sections

Some states introduce **new properties** that don't exist in the default state (e.g., a focused/selected input gains an inner border that isn't present when unfocused). When this happens, create a **dedicated section** for that state rather than adding state columns to the main spec table.

### When to use

Use a state-conditional section when:
- A state adds properties that **do not exist** in the default state (e.g., an inner border only appears on focus)
- A state changes **border/stroke presence or weight** (e.g., a visible border in Enabled disappears in Active, or a border appears on focus that wasn't present in default)
- A state modifies **visual treatment** (fills, effects) in ways that affect implementation beyond simple color changes
- The state-specific properties are few and would create mostly-empty columns in the main table

Do **not** use this for states that simply change existing numeric property values without adding/removing visual elements (e.g., pressed state changes padding) — use columns for those.

### How to structure

- Use a descriptive `sectionName` like `"Input — Selected"` or `"Button — Focused"`
- The `sectionDescription` should explain why this state has its own section
- The preview should include both a default-state instance and a state-active instance for comparison
- The columns can be simpler (e.g., `["Spec", "Default", "Selected", "Notes"]`) or omit the default column and only document the new properties

### Example

**Input — Selected**

- Section name: "Input — Selected"
- Description: "When input field is selected an inner border is shown for accessibility."
- Preview: Input instance in default state and another in selected state
- Columns: Spec | Default | Selected | Notes

| Spec | Default | Selected | Notes |
|---|---|---|---|
| Most parent container | – | – | Container hosting leading, middle, and trailing content |
| └─ border width | none | 3 | Inner border width |

### Example: Border change between states

**Tag — Interactive states**

- Section name: "Tag — Interactive states"
- Description: "Interactive tag shows border changes between enabled and active states."
- Preview: Interactive Tag instance in Enabled state and another in Active state
- Columns: Spec | Enabled | Active | Notes

| Spec | Enabled | Active | Notes |
|---|---|---|---|
| borderWidth | 1 | none | Active uses filled background instead of border |

---

## Data Structure Reference

*Use this structure to organize your analysis internally. The data is passed directly into Figma template placeholders — no JSON output is needed.*

Organize the data you gather into the following logical structure before rendering:

- **componentName** — the component's name (e.g., "Button", "List item")
- **generalNotes** (optional) — component-wide implementation notes (e.g., "Density controlled by variable mode")
- **sections** — one or more sections, each containing:
  - **sectionName** — descriptive title (e.g., "Button sizes", "Leading content", "Shape")
  - **sectionDescription** (optional) — explanatory text or "See X spec" references
  - **preview** — a brief description of which component variant instances to place in the section's `#Preview` frame; typically one labeled instance per value column, varying the section's axis while keeping other axes at defaults
  - **columns** — ordered list of column headers; first is always "Spec" (or "Composition"), last is always "Notes", middle columns are variant names
  - **rows** — one or more rows, each with:
    - **spec** — property name in camelCase (e.g., "minHeight", "horizontalPadding")
    - **values** — one value per middle column (length must equal columns count minus 2)
    - **notes** — brief implementation note (use "–" if none needed)
    - **isSubProperty** (optional) — true if the row belongs to a parent group
    - **isLastInGroup** (optional) — true if this is the final row of a group

---

## Field Rules

| Field | Rule |
|-------|------|
| `componentName` | Component name: "Button", "List item", "Section heading" |
| `generalNotes` | Optional. Use for component-wide notes about density modes, variable usage, etc. |
| `sections` | At least one section. First section is typically the parent container. |
| `sectionName` | Descriptive name: "Button sizes", "Leading content", "Shape variants" |
| `sectionDescription` | Optional. Use for "See X spec" references or explanatory prose. |
| `preview` | Which component variant instances to show — typically one labeled instance per value column, varying the section's axis while keeping other axes at defaults |
| `columns` | First column is always "Spec" (or "Composition" for composition sections), last is always "Notes". Middle columns are variant names. Render order: first column → values[0..n] → Notes |
| `rows` | At least one row per section. |
| `spec` | Property name in camelCase: `minHeight`, `horizontalPadding`, `cornerRadius` |
| `values` | Array of values for middle columns. Length must equal `columns.length - 2`. Renders between Spec and Notes columns. |
| `notes` | Brief implementation note (3-10 words). Use "–" if no note needed. Always renders in the final "Notes" column. |
| `isSubProperty` | Set `true` for rows belonging to a group (shows "within-group" hierarchy indicator) |
| `isLastInGroup` | Set `true` on the final row of a group (shows "end of group" indicator instead of "within-group") |

### Group Header Rows

Use group header rows to organize related properties:

| Aspect | Rule |
|--------|------|
| When to use | When multiple properties belong to a logical container (e.g., "Container", "Row container", "Icon area") |
| `spec` value | Descriptive name for the group |
| `values` array | Use `"–"` for all columns (no dimensional values for the header itself) |
| `isSubProperty` | Do NOT set on the header row itself |
| Child rows | Set `isSubProperty: true` on rows belonging to this group |
| Last child row | Set BOTH `isSubProperty: true` AND `isLastInGroup: true` on the final row of the group |

**Example pattern:**

- `Container` — values: – | – | – — notes: "Tap target" (group header, no `isSubProperty`)
- `minHeight` — values: 48 | 56 | 72 — `isSubProperty: true`
- `padding` — values: 12 | 16 | 20 — `isSubProperty: true`, `isLastInGroup: true`

**Visual result:**
```
Container          –      –      –     Tap target
 ├─ minHeight     48     56     72     ...
 └─ padding       12     16     20     ...
```

---

## Structure Rules

| Rule | Guidance |
|------|----------|
| Section order | Composition section first (if applicable), then parent container, then sub-components in visual order (leading → middle → trailing), then state-conditional sections last |
| Column consistency | All rows in a section must have same number of values matching column count |
| Hierarchy | Use `isSubProperty: true` for properties that belong to a parent row |
| Value format | Use plain numbers without units: "48", "16", "full", "center". Use "–" for not applicable. |
| References | Put "See X spec" in `sectionDescription`, not scattered in notes |

## Value Formatting: Display Strings from Extraction

The extraction script provides pre-formatted `display` strings on every `{ value, token, display }` tuple. Use `display` directly as table cell values — no manual formatting needed.

| Source | `display` value | Example |
|--------|-----------------|---------|
| Semantic token | `"token-name (resolved-value)"` | `"spacing-horizontal-xs (8)"` |
| Hardcoded value | `"value"` | `"8"` |

**Why:** This helps engineers know whether to use a token reference or a literal value in implementation.

**Note:** Do not include platform-specific units (px, dp, pt). Assume 1 px = 1 dp = 1 pt. Use plain numbers.

**Examples:**
- Token-based: `"spacing-horizontal-md (16)"`, `"radius-small (4)"`
- Hardcoded: `"48"`, `"full"`, `"center"`

---

## Common Variant Columns

| Variant Type | Typical Columns |
|--------------|-----------------|
| Density | `["Spec", "Compact", "Default", "Spacious", "Notes"]` |
| Size | `["Spec", "Large", "Medium", "Small", "XSmall", "Notes"]` |
| Shape | `["Spec", "Rectangular", "Rounded", "Notes"]` |
| State dimensions | `["Spec", "Rest", "Pressed", "Notes"]` |

---

## Common Property Names

| Category | Properties | Typical Values |
|----------|------------|----------------|
| Height/Width | `minHeight`, `maxHeight`, `minWidth`, `maxWidth`, `fixedWidth`, `fixedHeight` | `"48"`, `"sizing-md (48)"` |
| Padding (uniform) | `padding` | `"spacing-md (16)"` |
| Padding (symmetric) | `horizontalPadding`, `verticalPadding` | `"spacing-md (16)"`, `"12"` |
| Padding (per-side) | `paddingTop`, `paddingBottom`, `paddingStart`, `paddingEnd` | `"spacing-md (16)"`, `"12"` |
| Spacing | `contentSpacing`, `itemSpacing`, `gapBetween` | `"spacing-sm (8)"`, `"4"` |
| Alignment | `verticalAlignment`, `horizontalAlignment` | `"top"`, `"center"`, `"bottom"`, `"left"`, `"right"`, `"spaceBetween"` |
| Sizing mode | `widthMode`, `heightMode` | `"hug"`, `"fill"`, `"fixed"` |
| Shape (uniform) | `cornerRadius` | `"radius-md (8)"`, `"full"` |
| Shape (per-corner) | `cornerRadiusTopStart`, `cornerRadiusTopEnd`, `cornerRadiusBottomStart`, `cornerRadiusBottomEnd` | `"radius-sm (4)"` |
| Border (uniform) | `borderWidth` | `"1"` |
| Icons | `iconSize`, `leadingIconSize`, `trailingIconSize` | `"icon-sm (16)"`, `"icon-md (20)"`, `"24"` |
| Slots | `slotWidth`, `slotMinWidth`, `slotMaxWidth` | `"24"`, `"sizing-avatar-sm (40)"` |
| Typography (style) | `textStyle` | `"Heading/X Small"` |
| Typography (inline) | `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing` | `"14"`, `"500"`, `"20"` |
| Overflow | `clipsContent` | `"true"`, `"false"` |

---

## Do NOT

- Use placeholder values like `<value>` or `[TBD]` — extract real measurements
- Mix different variant axes in one section (don't combine size and density columns)
- Create sections for variants that only differ by numeric values (use columns instead)
- Put detailed component internals in sub-component sections (reference the component's own spec)
- Add platform-specific units (px, dp, pt) — use plain numbers only
- Use inconsistent property naming (stick to camelCase)
- Show only the token name without the resolved value — always include both: `"token-name (value)"`
- Show only the value when a semantic token is used — engineers need to know which token to reference

---

## Common Mistakes

- **Wrong column count:** `values` array length doesn't match `columns.length - 2`
- **Missing hierarchy:** Container properties and child properties at same level without `isSubProperty`
- **Adding platform units:** Using "dp", "px", or "pt" — just use plain numbers
- **Over-documenting:** Including every property instead of the meaningful dimensional ones
- **Under-referencing:** Documenting nested component internals instead of saying "See X spec"
- **Empty or missing preview:** Not populating the `#Preview` frame with labeled variant instances for the section
- **Identical previews across sections:** Every section's preview must show instances relevant to that section's axis — a "Size" section should show different sizes, a "Shape" section should show different shapes, a sub-component section should show the sub-component visible at each size. Never use the same default variant for all previews.
- **Ignoring `display` strings:** Manually formatting `"token-name (value)"` instead of using the `display` field from extraction data. The extraction already provides correctly formatted display strings.
- **Wrong padding representation:** Using `horizontalPadding` when the extraction returned per-side `{ top, bottom, start, end }`, or using `paddingStart`/`paddingEnd` when the extraction returned uniform `padding`. Match the table row structure to the extraction data shape.
- **Physical directions instead of logical:** Using `paddingLeft`/`paddingRight` in table rows instead of `paddingStart`/`paddingEnd`. The extraction normalizes to logical directions — use them.
- **Missing variable modes:** Finding a token binding but not checking if it has multiple mode values (e.g., Density modes). Always use `figma_get_variables` to check if tokens vary by mode.
- **Missing typography composite:** Not using the `typography` composite from extraction. If `styleName` exists, emit one `textStyle` row. If inline properties exist, emit individual rows. Never both.
- **Generic notes:** Writing "Tap target" instead of "Meets WCAG 2.5.8 minimum touch target (44px) with 12px optical margin". Notes should explain design intent ("why this value?"), not just describe the property.
- **No cross-section patterns:** Building each section independently without synthesizing patterns across sections. The AI interpretation layer should identify shared token families, symmetrical slot designs, and scaling strategies.
- **Ignoring anomalies:** Not flagging scaling inconsistencies, token misconfiguration, or asymmetric padding. The extraction data makes these visible — call them out in notes.
- **Incomplete sections:** Not verifying that every auto-layout container and sub-component from the extraction has its own section or is covered by a parent section.
- **Showing parent component in sub-component preview:** Sub-component section previews must show instances from the sub-component's own component set (`subComponents[].subCompSetId`), not the parent. A "Label" section should show four Label instances at different sizes, not four full Text Field instances.
- **Overriding preview frame layout:** The `#Preview` frame's layout properties are defined by the template. Never override them.
- **Missing border/stroke state changes:** Only checking whether a state adds entirely new properties, without checking if an existing border/stroke appears, disappears, or changes weight between states. The `stateComparison` data from Step 4d makes this visible.
- **Measurement labels for constraints:** Min/max constraint labels must include the prefix: `"min 32"`, `"max 200"`. Padding and spacing measurements use Figma's default display (actual pixel values) with no custom labels.
- **Extra annotations not in table:** Annotating properties that don't have a corresponding row in the section's table. Only draw measurements for properties documented in the table below — the token map gates which properties get annotated.

---

## Applying the Principles

| If you see... | Questions to ask | Result |
|---------------|------------------|--------|
| Figma variant axis "Density" | Do values differ only numerically? | Single section with Compact/Default/Spacious columns |
| Figma variant axis "Size" | Same properties across all sizes? | Single section with Large/Medium/Small/XSmall columns |
| Shape variants (Rectangular/Rounded) | Only corner radius differs? | Section with shape columns, OR separate section if complex |
| Leading/trailing content slots | Are there slot-specific spacing rules? | Sub-component section for each slot |
| Variable bound to spacing value | What's the token name? Does it have multiple modes? | Use `figma_get_variables` to check `valuesByMode`; if multi-mode, add columns for each mode |
| Hardcoded pixel value | No variable binding? | Format as plain number `"N"` without units |
| Container with multiple children | Do children have their own spacing? | Use `isSubProperty: true` for child properties |
| Property only exists in some variants | Conditional on configuration? | Separate section, not columns |
| Multiple unrelated variant axes | Would combining be confusing? | Separate sections for each axis |
| Nested component (Button in slot) | Full component inside? | Reference "See Button spec" in sectionDescription |
| No explicit Density/Size variant axis | Could dimensions still vary by variable mode? | Check `figma_get_variables` for collections like "Density" with multiple modes |
| TEXT node in component | Does it use a text style? | Check `textStyleId`; if non-empty, document style name; if empty, note "custom" or document individual properties |
| Component composed of 2+ sub-components | Do sub-components have their own size variants? | Add a composition section first, mapping parent sizes to sub-component variants |
| State adds new properties (e.g., border on focus) | Do these properties not exist in the default state? Does a border/stroke appear, disappear, or change weight between states? | Create a state-conditional section (e.g., "Input — Selected") |
| Behavior/Configuration variant axis (e.g., Static vs Interactive) | Do variants look visually different (borders, strokes, optional elements)? | Use the default configuration for the preview. If dimensional values are identical, document once with a note. If border/stroke differs, add a row for it. |
| Sub-component INSTANCE with its own boolean properties | Does `instance.componentProperties` have BOOLEAN entries? | Enable them all, inspect revealed children, document their dimensions in the sub-component's section |
| State variant with different stroke/border visibility | Does the border appear/disappear or change weight between states? | Create a state-conditional section showing the border difference (e.g., "Tag — Interactive states") |

---

## Edge Cases

| Situation | Action |
|-----------|--------|
| Variant has no spacing differences | Skip that variant axis; only document meaningful differences |
| Value is "auto" or "fill" | Document as `"auto"` or `"fill"` — these are valid dimensional values |
| Spacing controlled by variable mode | Use mode names as columns (Compact/Default/Spacious); note in `generalNotes`: "Density controlled by variable mode" |
| Same value across all variants | Still document in columns; shows intentional consistency |
| Component has 5+ density/size variants | Document all; the template handles dynamic column count |
| Sub-component has its own density variants | Reference sub-component's spec; don't duplicate its structure table |
| Corner radius uses "full" for pill shape | Document as `"full"` with note: "Uses half of minHeight" |
| Value differs between platforms | Document the design spec value; note platform differences in notes |
| Figma shows decimals (e.g., 12.5) | Round to nearest integer unless precision matters |
| Token name unclear or ambiguous | Use the exact Figma variable name; engineers can map it |
| Optical measurement differs from actual | Document the actual values; add note explaining the optical result (e.g., "Optically 12 from outside: 8 container padding + 4 inner padding") |
| Composed spacing from nested containers | Document each container's value separately; note how they combine visually |

---

## Example: Simple Component (Button)

### Button sizes section

- Section name: "Button sizes"
- Preview: One Button instance per size (Large, Medium, Small, XSmall), each labeled with its size name
- Columns: Spec | Large | Medium | Small | XSmall | Notes

| Spec | Large | Medium | Small | XSmall | Notes |
|---|---|---|---|---|---|
| Container | – | – | – | – | Tap target and content container |
| ├─ minHeight | sizing-button-lg (56) | sizing-button-md (48) | sizing-button-sm (40) | sizing-button-xs (32) | Meets WCAG touch target |
| ├─ horizontalPadding | spacing-horizontal-lg (24) | spacing-horizontal-md (20) | spacing-horizontal-sm (16) | spacing-horizontal-xs (12) | Inset from edges |
| ├─ iconLabelSpacing | spacing-inline-md (8) | spacing-inline-md (8) | spacing-inline-sm (6) | spacing-inline-xs (4) | Gap between icon and label |
| └─ iconSize | icon-lg (24) | icon-md (20) | icon-sm (18) | icon-xs (16) | Leading or trailing icon |

### Button shape section

- Section name: "Button shape"
- Preview: One Button instance per shape (Rectangular, Rounded), each labeled
- Columns: Spec | Rectangular | Rounded | Notes

| Spec | Rectangular | Rounded | Notes |
|---|---|---|---|
| cornerRadius | radius-small (4) | full | Rounded uses half of minHeight |

## Example: Complex Component with Sub-Components (List Item)

General notes: "Density controlled by variable mode. All slot dimensions adapt accordingly."

### List item container section

- Section name: "List item container"
- Preview: One List item instance per density column (Compact, Default, Spacious) showing row height and padding
- Columns: Spec | Compact | Default | Spacious | Notes

| Spec | Compact | Default | Spacious | Notes |
|---|---|---|---|---|
| Row container | – | – | – | Full-width row |
| ├─ minHeight | sizing-row-compact (48) | sizing-row-default (56) | sizing-row-spacious (72) | Row height per density |
| ├─ horizontalPadding | spacing-inset-compact (12) | spacing-inset-default (16) | spacing-inset-spacious (20) | Inset from edges |
| ├─ contentSpacing | spacing-gap-compact (8) | spacing-gap-default (12) | spacing-gap-spacious (16) | Gap between slots |
| └─ verticalPadding | spacing-inset-compact (8) | spacing-inset-default (12) | spacing-inset-spacious (16) | Optically 16/20/24 from top: 8/12/16 row padding + 8 inner content margin |

### Leading content section

- Section name: "Leading content"
- Description: "Slot for avatar, icon, or checkbox. See Avatar spec, Icon spec for component internals."
- Preview: One Leading content sub-component instance per density column (sourced from the sub-component's own component set, not the parent List item). Each instance shows the leading content in isolation with its internal structure visible.
- Columns: Spec | Compact | Default | Spacious | Notes

| Spec | Compact | Default | Spacious | Notes |
|---|---|---|---|---|
| slotWidth | 24 | sizing-avatar-sm (40) | sizing-avatar-md (48) | Fixed width for leading area |
| verticalAlignment | center | center | top | Top-aligned at spacious for multi-line |

### Trailing content section

- Section name: "Trailing content"
- Description: "Slot for icon button, switch, or metadata. See Icon button spec, Switch spec for internals."
- Preview: One Trailing content sub-component instance per density column (sourced from the sub-component's own component set, not the parent List item). Each instance shows the trailing content in isolation.
- Columns: Spec | Compact | Default | Spacious | Notes

| Spec | Compact | Default | Spacious | Notes |
|---|---|---|---|---|
| slotMinWidth | 24 | 24 | 24 | Minimum; expands for content |
| trailingPadding | 0 | 0 | spacing-trailing-spacious (4) | Extra padding at spacious |

---

## Pre-Render Validation Checklist

Before rendering into Figma, verify:

| Check | What to Verify |
|-------|----------------|
| ☐ **Variable modes checked** | Used `figma_get_variables` to check if any bound tokens have multiple mode values (Density, Theme, etc.) |
| ☐ **Sub-components discovered** | The `subComponents` array from extraction includes all INSTANCE children found in the enriched tree (with all parent booleans enabled). Each has `subCompSetId`, `subCompVariantAxes`, and `booleanOverrides` pre-resolved. |
| ☐ **Cross-variant data complete** | The cross-variant script (Step 4d) measured all sub-components across all size values. `subComponentDimensions` has entries for every sub-component at every size. |
| ☐ **Section plan validated** | The AI interpretation layer (Step 6) built, validated, and adjusted the section plan. Every auto-layout container and sub-component is covered. |
| ☐ **Design-intent notes** | Notes answer "why this value?" not just "what is this property?". Scaling patterns, WCAG compliance, optical corrections are explained. |
| ☐ **Anomalies flagged** | Scaling inconsistencies, token misconfiguration, asymmetric padding, missing token bindings are noted in relevant rows or `generalNotes`. |
| ☐ **Completeness judged** | All dimensional properties from extraction are covered. Gaps are noted in `generalNotes`. |
| ☐ **Collapsed dimensions correct** | Padding representation matches extraction shape: uniform → `padding`, symmetric → `verticalPadding`/`horizontalPadding`, per-side → `paddingTop`/`paddingBottom`/`paddingStart`/`paddingEnd`. Same for cornerRadius and strokeWeight. |
| ☐ **Typography as composite** | TEXT nodes with `typography.styleName` → one `textStyle` row. Inline typography → individual property rows. Never both. |
| ☐ **Display strings used** | Table cell values come from the `display` field in extraction data — no manual token+value formatting. |
| ☐ **Logical directions** | Padding uses `paddingStart`/`paddingEnd` (not `paddingLeft`/`paddingRight`). Corner radii use `topStart`/`topEnd`/`bottomStart`/`bottomEnd`. |
| ☐ **Column count** | Each row's values count equals the number of middle columns (total columns minus Spec and Notes) |
| ☐ **Hierarchy markers** | Child rows have `isSubProperty: true`; last child in each group also has `isLastInGroup: true` |
| ☐ **No units** | Values are plain numbers without px, dp, or pt |
| ☐ **No placeholders** | No `<value>`, `[TBD]`, or placeholder text — only real measurements |
| ☐ **Section order** | Composition section first (if applicable), then parent container, sub-components in visual order, state-conditional sections last |
| ☐ **Notes column** | Every row has a notes value (use "–" if no note needed) |
| ☐ **Preview per section** | Each section has a distinct preview showing variant instances relevant to that section's axis |
| ☐ **Sub-component preview sourcing** | Sub-component section previews use `subComponents[].subCompSetId` from extraction, not the parent's component set. Boolean overrides from `subComponents[].booleanOverrides` (all set to `true`) are applied. |
| ☐ **Preview frame untouched** | The `#Preview` frame's layout properties are NOT overridden — the template provides the correct layout |
| ☐ **Measurement labels correct** | Padding and spacing use Figma's default display (actual pixel values). Min/max constraints use `freeText` with constraint prefix (`"min 32"`, `"max 200"`). |
| ☐ **Table-driven annotations only** | Measurement lines appear ONLY for properties that have a corresponding row in the section's table. No extra annotations for properties not documented in the table. Token maps gate which properties get annotated. |
| ☐ **Composition section** | If component has 2+ sub-components with their own size variants, a composition section comes first |
| ☐ **Behavior variant previews** | Default configuration only for the preview; border/stroke differences documented as table rows |
| ☐ **State-conditional sections** | States that introduce new properties or change border/stroke have their own section (detected by `stateComparison` from Step 4d) |
| ☐ **Cross-section patterns** | `generalNotes` includes system-wide patterns (shared token families, symmetrical slot designs, density scaling strategies) |

