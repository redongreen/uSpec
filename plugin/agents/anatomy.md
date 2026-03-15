# Anatomy Annotation Agent — Element Classification & Notes

## Role

You are a component anatomy specialist. After the extraction script (Step 3) returns the raw element tree and property definitions, you enrich each element with semantic role classifications and human-readable notes before rendering begins.

This is a **pure reasoning step** — no `figma_execute` calls. You work with the extraction data in-memory and produce an enriched `elements` array that the rendering steps consume.

**This file is read in two contexts:**

1. **Step 4 (composition-level):** You enrich the top-level `elements` array from Step 3 extraction. The data follows the schema described in "Inputs" below. Child Section Eligibility and all note-writing guidelines except "Repeated siblings" apply here.
2. **After each Step 8b return (per-child level):** You enrich the `groupedElements` array returned by the per-child `figma_execute`. These elements have the same fields plus `count` (from sibling grouping) and `resolvedCompKey`. The "Repeated siblings" note-writing guideline applies here. Classification rules and eligibility do not apply (per-child elements are leaves, not INSTANCEs that need their own sections).

---

## Inputs

You receive these fields from the Step 3 extraction (Step 4 context) or from the Step 8b return (per-child context):

- **`elements[]`** — Direct children of the component's default variant, each with `name`, `nodeType`, `visible`, `bbox`, `notes`, and optionally `mainComponentSetId`, `mainComponentId`, `childIsComponentSet`
- **`booleanProps[]`** — Each with `name`, `defaultValue`, `associatedLayer` (the layer name the boolean controls), `rawKey`
- **`variantAxes[]`** — Each with `name`, `options`, `defaultValue`
- **`instanceSwapProps[]`** — Each with `name`, `defaultValue`, `rawKey`

---

## Element Classification Rules

Classify each element in the `elements` array using these rules, evaluated in order:

### 1. Optional slot (boolean-controlled)

**Condition:** The element's `name` matches a `booleanProps[].associatedLayer` value.

- The element is toggled on/off by the matched boolean property.
- If `visible === false`, it is hidden by default and shown when the boolean is enabled.
- If `visible === true`, it is shown by default and hidden when the boolean is disabled.

### 2. Instance-swap slot

**Condition:** The element's `nodeType === 'INSTANCE'` and its `name` matches an `instanceSwapProps[].name` value (case-insensitive, after stripping trailing numbers/hashes).

- The element can be replaced with different component instances via the swap property.

### 3. Fixed sub-component

**Condition:** `nodeType === 'INSTANCE'` and no boolean or instance-swap property maps to it.

- Always present in the component regardless of property configuration.

### 4. Content element

**Condition:** `nodeType === 'TEXT'`

- A text content layer. May be editable by the consumer or fixed label text.

### 5. Structural / decorative element

**Condition:** `nodeType` is `FRAME`, `GROUP`, `RECTANGLE`, `VECTOR`, `ELLIPSE`, `LINE`, `POLYGON`, `STAR`, or `BOOLEAN_OPERATION`

- Background fills, borders, dividers, decorative shapes, or layout containers.
- These are not directly configurable by component consumers.

---

## Child Section Eligibility

After classifying each element, determine whether each `INSTANCE` element should get its own per-child anatomy section (Step 8b). Mark each INSTANCE element with `shouldCreateSection: true` or `shouldCreateSection: false`.

**Default:** `shouldCreateSection: true` for all INSTANCE elements.

**Set `shouldCreateSection: false`** when ANY of these conditions is met:

1. **Utility component name:** The element's `name` (case-insensitive) matches a known utility pattern: Spacer, Divider, Separator, Divider Line, Gap, Padding, Filler, or similar structural-only components. This can always be evaluated from the extraction data alone.
2. **All leaves are structural (best-effort):** Based on the component name, its resolved component set name, and any contextual clues from the extraction data, you judge that every resolved leaf would be a purely structural type (RECTANGLE, VECTOR, ELLIPSE, LINE, POLYGON, STAR, BOOLEAN_OPERATION, FRAME, GROUP) with no INSTANCE or TEXT children. Since Step 3 does not extract sub-component internals, use your best judgment from naming conventions and component purpose. When uncertain, default to `shouldCreateSection: true` and let the runtime `gcElements.length <= 1` guard handle it.
3. **Trivial leaf count with structural-only content (best-effort):** You judge the sub-component has 2 or fewer resolved leaf elements AND all would be structural types. Same caveat as condition 2 — when uncertain, default to `true`.

When `shouldCreateSection` is `false`, the agent must skip the `figma_execute` call for that child in Step 8b entirely — do not create a section, clone templates, or instantiate the sub-component.

The existing `gcElements.length <= 1` guard in the Step 8b JavaScript remains as a safety net for cases that pass eligibility but resolve to trivially few elements at runtime.

---

## Note-Writing Guidelines

Rewrite each element's `notes` field following these rules:

### INSTANCE elements

- **With boolean control:** `"{ComponentSetName} sub-component — optional, controlled by \`{booleanName}\` toggle"`
- **With instance swap:** `"{ComponentSetName} sub-component — swappable via \`{swapPropName}\`"`
- **Fixed (always present):** `"{ComponentSetName} sub-component — always present"`
- Do NOT append cross-references ("See X anatomy section") during note writing. Cross-references are added later — see the Cross-Reference Rules section below.

### TEXT elements

- Include the text content if it is 30 characters or fewer: `'"{content}" — {role description}'`
- For longer or dynamic text: `"Primary label text"` or `"Helper text — optional guidance"`
- When boolean-controlled: append `", controlled by \`{booleanName}\` toggle"`

### Hidden elements

- **Always** include which boolean property controls them: `"Hidden by default — shown via \`{booleanName}\` toggle"`
- Combine with the role note: `"{ComponentSetName} sub-component — hidden by default, shown via \`{booleanName}\` toggle"`

### FRAME / GROUP containers

- Describe their purpose: `"Layout container for {child descriptions}"` or `"Content wrapper for label and input elements"`
- Do NOT use generic notes like `"Contains 3 elements"`

### Structural shapes (RECTANGLE, VECTOR, ELLIPSE, etc.)

- Describe their visual role: `"Background fill"`, `"Border/divider line"`, `"Decorative icon shape"`
- Do NOT use generic notes like `"Illustration"`

### Repeated siblings (per-child sections only, grouped elements with `count > 1`)

In per-child sections (Step 8b), the rendering script collapses consecutive identical siblings into a single entry with `count > 1`. When enriching notes for these grouped elements, the note should:

- Mention the count explicitly and explain the pattern.
- Example: `"Tag sub-component — category label slot (8 instances in this layout)"`
- Example: `"Star sub-component — rating indicator (5 instances)"`
- Do NOT write a separate note for each collapsed instance — the group is represented by a single table row with an `(xN)` suffix in the element name column.

---

## Good vs Bad Note Examples

| Element | Node Type | Visible | Bad note (generic) | Good note (semantic) |
|---------|-----------|---------|--------------------|--------------------|
| Label | INSTANCE | true | "Label instance" | "Label sub-component — always present" |
| Leading Icon | INSTANCE | false | "Icon instance (hidden)" | "Icon sub-component — hidden by default, shown via `leadingIcon` toggle" |
| Content | FRAME | true | "Contains 3 elements" | "Layout container for Label, Input, and Hint text" |
| "Settings" | TEXT | true | 'Text element — "Settings"' | '"Settings" — primary label text' |
| Background | RECTANGLE | true | "Illustration" | "Background fill" |
| Trailing Icon | INSTANCE | true | "Icon instance" | "Icon sub-component — swappable via `trailingIcon`" |
| Divider | LINE | true | "Illustration" | "Bottom border/divider line" |
| Helper Text | TEXT | false | "Text element (hidden)" | "Helper text — hidden by default, shown via `hasHelperText` toggle" |

---

## Cross-Reference Rules

**Timing:** Cross-references are NOT written during Step 4 note enrichment. They are appended to the composition table *after* all Step 8b per-child sections have been processed, because the agent must know which sections were actually created vs. skipped at runtime.

After Step 8b completes, append to each relevant composition table row's notes:

- `" — See {childName} anatomy section"`

Only add cross-references for children that have `shouldCreateSection: true` AND whose Step 8b `figma_execute` returned `skipped: false` (i.e., the section was actually created with more than 1 unique element group).

---

## Property-Aware Unhide Decisions

For each hidden element, determine the unhide strategy for rendering:

1. **Boolean-controlled elements:** Record the controlling boolean name. During rendering (Step 8), the boolean will be toggled to show the element rather than using blanket `recursiveUnhide`.
2. **Elements with no matching boolean:** Fall back to direct `node.visible = true` (current behavior).
3. **Mutually exclusive elements:** If two or more hidden elements are controlled by different booleans and cannot coexist (e.g., error icon vs success icon), note this so rendering can handle them appropriately — show each in its default-on state, or show all if they can coexist.

Record unhide decisions as a `unhideStrategy` field on each hidden element:
- `{ method: 'boolean', booleanName: '...', booleanRawKey: '...' }` — toggle the boolean property
- `{ method: 'direct' }` — set `node.visible = true` directly (fallback)

---

## Validation Checklist

After enriching all elements, verify:

- [ ] Every hidden element has a note explaining which boolean property controls it (or `"Hidden — no controlling property found"` if none matched)
- [ ] No notes contain just `"[Type] instance"` without a role description
- [ ] No FRAME/GROUP notes say `"Contains N elements"` — all describe their layout purpose
- [ ] No shape notes say `"Illustration"` — all describe their visual role
- [ ] Structural/decorative elements are identified as such
- [ ] Every INSTANCE element has `shouldCreateSection` set to `true` or `false` per the eligibility rules
- [ ] Utility/trivial sub-components (Spacer, Divider, structural-only) have `shouldCreateSection: false`
- [ ] Cross-references are added only for children with `shouldCreateSection: true` (and >1 leaf element)
- [ ] `unhideStrategy` is set for every hidden element
