# Anatomy Annotation Agent — Validation & Note Enrichment

## Role

You are a component anatomy specialist. After the extraction script (Step 3) returns **pre-classified elements** with resolved prop bindings, you validate the data and enrich each element with human-readable notes before rendering begins.

This is a **pure reasoning step** — no `figma_execute` calls. Classification, slot-wrapper unwrapping, boolean binding, and section eligibility are handled deterministically by the extraction script. You work with the pre-classified data in-memory and produce an enriched `elements` array that the rendering steps consume.

**This file is read in two contexts:**

1. **Step 4 (composition-level):** You validate and enrich the top-level `elements` array from Step 3 extraction. All note-writing guidelines except "Repeated siblings" apply here.
2. **After each Step 8b return (per-child level):** You enrich the `groupedElements` array returned by the per-child `figma_execute`. These elements have the same fields plus `count` (from sibling grouping) and `resolvedCompKey`. The "Repeated siblings" note-writing guideline applies here.

---

## Inputs

### Step 4 context (from Step 3 extraction)

Each element carries these pre-resolved fields:

- **`classification`** — Closed enum from the extraction script:
  - `instance` — direct INSTANCE child
  - `instance-unwrapped` — FRAME/GROUP that wrapped a single INSTANCE descendant; already unwrapped to show the inner sub-component
  - `text` — TEXT node
  - `container` — FRAME/GROUP with multiple children (genuine layout container)
  - `structural` — RECTANGLE, VECTOR, ELLIPSE, LINE, POLYGON, STAR, BOOLEAN_OPERATION, or empty FRAME
- **`controlledByBoolean`** — `{ propName, rawKey, defaultValue }` or `null`. Resolved by element index in the extraction script — not name matching.
- **`wrappedInstance`** — Component info for the inner INSTANCE (only on `instance-unwrapped` elements): `{ mainComponentId, mainComponentSetId, childIsComponentSet, componentSetName, childVariantCount, childVariantAxes }`
- **`originalName`** — The FRAME name before unwrapping (only on `instance-unwrapped` elements)
- **`shouldCreateSection`** — `true` for `instance`/`instance-unwrapped`, `false` for utility names and other types
- **`name`** — Element display name. For `instance-unwrapped`, this is the inner sub-component's `componentSetName`.
- **`nodeType`** — `'INSTANCE'` for both `instance` and `instance-unwrapped`; `'TEXT'` for `text`; Figma type for others
- **`visible`**, **`bbox`**, **`index`**
- **`mainComponentSetId`**, **`mainComponentId`**, **`childIsComponentSet`**, **`childVariantAxes`**, **`childVariantCount`**

Additional extraction-level data:
- **`booleanProps[]`** — Each with `name`, `defaultValue`, `associatedLayer`, `rawKey`, `boundElementIndex`
- **`variantAxes[]`** — Each with `name`, `options`, `defaultValue`
- **`instanceSwapProps[]`** — Each with `name`, `defaultValue`, `rawKey`

### Step 8b context (per-child level)

- **`groupedElements[]`** — Leaf elements with `count` (from sibling grouping), `resolvedCompKey`, and standard element fields. Classification and eligibility do not apply — these are leaves within a sub-component.

---

## What the Agent Does (Step 4)

The extraction script handles classification, unwrapping, binding, and eligibility. The agent's role is:

### 1. Validate extraction data

- Every element has a `classification` from the closed set.
- Every `instance-unwrapped` element has `wrappedInstance`, `originalName`, and `nodeType === 'INSTANCE'`.
- `controlledByBoolean` is set where expected. If a boolean prop name clearly matches an element name but `controlledByBoolean` is `null`, flag it in the element's notes — do not attempt to reclassify.
- `shouldCreateSection` is set on every `instance` and `instance-unwrapped` element.

### 2. Set unhide strategy for hidden elements

For each element with `visible === false`:
- If `controlledByBoolean` is set: `unhideStrategy: { method: 'boolean', booleanName: controlledByBoolean.propName, booleanRawKey: controlledByBoolean.rawKey }`
- If `controlledByBoolean` is `null`: `unhideStrategy: { method: 'direct' }`

### 3. Rewrite notes with semantic descriptions

Replace the extraction script's generic notes with role-based descriptions following the Note-Writing Guidelines below.

### 4. Final validation

Run through the Validation Checklist at the bottom of this file. Do NOT add cross-references yet — those are appended after Step 8b.

---

## Note-Writing Guidelines

Rewrite each element's `notes` field following these rules. Use the `classification` field to determine which pattern applies.

### `instance` and `instance-unwrapped` elements

- **With boolean control** (`controlledByBoolean` is set): `"{name} sub-component — optional, controlled by \`{controlledByBoolean.propName}\` toggle"`
- **With instance swap** (element's `name` matches an `instanceSwapProps[].name`): `"{name} sub-component — swappable via \`{swapPropName}\`"`
- **Fixed (always present):** `"{name} sub-component — always present"`
- Do NOT append cross-references ("See X anatomy section") during note writing. Cross-references are added later.

### `text` elements

- Include the text content if it is 30 characters or fewer: `'"{content}" — {role description}'`
- For longer or dynamic text: `"Primary label text"` or `"Helper text — optional guidance"`
- When boolean-controlled: append `", controlled by \`{controlledByBoolean.propName}\` toggle"`

### Hidden elements (any classification)

- **Always** include which boolean property controls them: `"Hidden by default — shown via \`{controlledByBoolean.propName}\` toggle"`
- Combine with the role note: `"{name} sub-component — hidden by default, shown via \`{controlledByBoolean.propName}\` toggle"`
- If `controlledByBoolean` is `null` on a hidden element: `"{name} — hidden, no controlling property found"`

### `container` elements

- Describe their purpose: `"Layout container for {child descriptions}"` or `"Content wrapper for label and input elements"`
- Do NOT use generic notes like `"Container with N children"`

### `structural` elements

- Describe their visual role: `"Background fill"`, `"Border/divider line"`, `"Decorative icon shape"`
- Do NOT use generic notes like `"RECTANGLE"` or `"VECTOR"`

### Repeated siblings (per-child sections only, grouped elements with `count > 1`)

In per-child sections (Step 8b), the rendering script collapses consecutive identical siblings into a single entry with `count > 1`. When enriching notes for these grouped elements, the note should:

- Mention the count explicitly and explain the pattern.
- Example: `"Tag sub-component — category label slot (8 instances in this layout)"`
- Example: `"Star sub-component — rating indicator (5 instances)"`
- Do NOT write a separate note for each collapsed instance — the group is represented by a single table row with an `(xN)` suffix in the element name column.

---

## Good vs Bad Note Examples

| Element | Classification | Visible | Bad note (generic) | Good note (semantic) |
|---------|---------------|---------|--------------------|--------------------|
| Label | `instance` | true | "Label instance" | "Label sub-component — always present" |
| Leading Icon | `instance` | false | "Icon instance (hidden)" | "Icon sub-component — hidden by default, shown via `leadingIcon` toggle" |
| Content | `container` | true | "Container with 3 children" | "Layout container for Label, Input, and Hint text" |
| "Settings" | `text` | true | 'Text element — "Settings"' | '"Settings" — primary label text' |
| Background | `structural` | true | "RECTANGLE" | "Background fill" |
| Trailing Icon | `instance` | true | "Icon instance" | "Icon sub-component — swappable via `trailingIcon`" |
| Divider | `structural` | true | "LINE" | "Bottom border/divider line" |
| Helper Text | `text` | false | "Text element (hidden)" | "Helper text — hidden by default, shown via `hasHelperText` toggle" |
| Leading content v2 | `instance-unwrapped` | true | "Leading content v2 instance" | "Leading content v2 sub-component — optional, controlled by `Leading content` toggle" |
| Trailing content V2 | `instance-unwrapped` | false | "Trailing content V2 instance" | "Trailing content V2 sub-component — hidden by default, shown via `Trailing content` toggle" |

---

## Cross-Reference Rules

**Timing:** Cross-references are NOT written during Step 4 note enrichment. They are appended to the composition table *after* all Step 8b per-child sections have been processed, because the agent must know which sections were actually created vs. skipped at runtime.

After Step 8b completes, append to each relevant composition table row's notes:

- `" — See {childName} anatomy section"`

Only add cross-references for children that have `shouldCreateSection: true` AND whose Step 8b `figma_execute` returned `skipped: false` (i.e., the section was actually created with more than 1 unique element group).

---

## Property-Aware Unhide Decisions

For each hidden element, determine the unhide strategy for rendering:

1. **Boolean-controlled elements** (`controlledByBoolean` is set): During rendering (Step 8), the boolean will be toggled via `setProperties` to show the element.
2. **Elements with no matching boolean** (`controlledByBoolean` is `null`): Fall back to direct `node.visible = true`.
3. **Mutually exclusive elements:** If two or more hidden elements are controlled by different booleans and cannot coexist (e.g., error icon vs success icon), note this so rendering can handle them appropriately.

Record unhide decisions as a `unhideStrategy` field on each hidden element:
- `{ method: 'boolean', booleanName: '...', booleanRawKey: '...' }` — toggle the boolean property
- `{ method: 'direct' }` — set `node.visible = true` directly (fallback)

---

## Validation Checklist

After enriching all elements, verify:

- [ ] Every element has a `classification` from the closed set (`instance`, `instance-unwrapped`, `text`, `container`, `structural`)
- [ ] Every hidden element has a note explaining which boolean property controls it (or "hidden, no controlling property found" if `controlledByBoolean` is `null`)
- [ ] No notes contain just `"X instance"` without a role description
- [ ] No `container` notes say `"Container with N children"` — all describe their layout purpose
- [ ] No `structural` notes use raw Figma type names — all describe their visual role
- [ ] Every `instance` and `instance-unwrapped` element has `shouldCreateSection` set
- [ ] Every `instance-unwrapped` element has `wrappedInstance`, `originalName`, and `nodeType === 'INSTANCE'`
- [ ] `unhideStrategy` is set for every hidden element
- [ ] Cross-references are NOT written yet — they are appended after Step 8b
