---
name: extract-structure
description: Interpret a component's structure spec (variant axes, dimensions, sub-components, slot contents, cross-variant diffs) from the `_base.json` produced by the uSpec Extract Figma plugin, and write the normalized JSON to disk. Read-only interpretation — no Figma calls except an optional tiny delta script. Use as a sub-skill of create-component-md.
---

# Extract Structure Data

Interpretation-only companion to `create-structure`. This skill **does not extract data from Figma**. It reads `{cachePath}/{componentSlug}-_base.json` (produced by the uSpec Extract Figma plugin), applies the same reasoning layer as `create-structure`, and writes the normalized `StructureSpecData` JSON to disk for the `create-component-md` orchestrator to consume.

**Quality contract:** every reasoning step (section planning, ownership resolution, override promotion, design-intent notes, anomaly detection) mirrors `create-structure/SKILL.md`. Any improvement to structure-extraction quality must be made in both places.

**Batch-mode contract.** This skill MUST NOT call `AskQuestion`, prompt for confirmation, or pause for user input. When a value cannot be resolved from `_base.json` (and a Step 3-delta doesn't recover it), emit a row with `provenance: "not-measured"` and `values: ["—", …]` instead of asking. No mid-interpretation clarifications.

## Invocation Contract

The orchestrator calls this skill with these inputs (already resolved — do NOT re-parse URLs or re-read `uspecs.config.json`):

- `componentSlug` — filename-safe slug
- `cachePath` — cache directory, typically `.uspec-cache/{componentSlug}/`
- `optionalContext` — free-form string from the user (may be `"none"`)
- `mcpProvider` — `figma-console` or `figma-mcp` (only needed if a Step 3-delta escape hatch fires AND a live Figma link was provided to the orchestrator)
- `deltaAvailable` — boolean. When the orchestrator received only a `baseJsonPath` (no `figmaLink`), this is `false` and the Step 3-delta escape hatch must not fire; log the gap in `data._deltaExtractions[]` with `unavailable: "no-figma-link"` and continue with best-effort output.
- `apiDictionaryPath` — absolute or workspace-relative path to `{cachePath}/{componentSlug}-api-dictionary.json`. Optional. When present, this file is the canonical vocabulary for axis/value/sub-component/state naming (see Step 2.5). When absent, the skill continues with `_dictionaryUnavailable: true` in its output envelope and the renderer treats the produced cache as lower-confidence.

`fileKey` and `nodeId` are **not** pass-through parameters anymore. Read them from `{cachePath}/{componentSlug}-_base.json._meta.fileKey` and `_meta.nodeId` at the start of Step 1.

**Output:**

- Writes `{cachePath}/{componentSlug}-structure.json` containing the full `StructureSpecData` object.
- Returns a single-line summary to the orchestrator: `"Structure extracted: N sections, M sub-components, K slot contents → {path}"`.
- Never creates or mutates Figma nodes.

## MCP Adapter

This skill typically makes **zero** MCP calls — it reads `_base.json` from disk. The adapter applies only to the optional Step 3-delta escape hatch.

| Operation | `figma-console` | `figma-mcp` |
|-----------|-----------------|-------------|
| Execute Plugin JS (delta only) | `figma_execute` with `code` | `use_figma` with `fileKey`, `code`, `description` |

For `figma-mcp` delta scripts, include the page-focus preamble after `getNodeByIdAsync`:

```javascript
let _p = node; while (_p.parent && _p.parent.type !== 'DOCUMENT') _p = _p.parent;
if (_p.type === 'PAGE') await figma.setCurrentPageAsync(_p);
```

## Workflow

```
Task Progress:
- [ ] Step 1: Read instruction file
- [ ] Step 2: Load _base.json and optionalContext
- [ ] Step 2.5: Load API dictionary (canonical vocabulary) — optional
- [ ] Step 3: Build working evidence set (from _base.json fields only)
- [ ] Step 3-delta: OPTIONAL — read-only Figma call if a fact is genuinely missing
- [ ] Step 4: AI interpretation layer — section plan, ownership, design-intent notes, anomalies
- [ ] Step 5: Generate StructureSpecData object
- [ ] Step 6: Audit (re-read instruction file)
- [ ] Step 7: Write JSON to cache and return one-line summary
```

### Step 1: Read Instructions

Read [agent-structure-instruction.md]({{ref:structure/agent-structure-instruction.md}}). This is the **same** instruction file used by `create-structure`. Treat it as the single source of truth for the `StructureSpecData` schema, row emission rules, and audit checklists.

#### Rendering-only sections to skip

The shared instruction file describes both extraction and Figma rendering. This skill only performs interpretation — ignore guidance in the sections below. The data schema and audit checklists still apply.

- **§Role — "render structure documentation directly into Figma"** — framing only; this skill writes JSON to disk instead.
- **§Inputs — the `figma_execute` row's "render sections" phrasing** — this skill does not render.
- **§Data Structure Reference — "The data is passed directly into Figma template placeholders — no JSON output is needed"** — inverted: we **do** output JSON. Keep the schema; discard the "no JSON" framing.
- **§Field Rules — "Render order: first column → values[0..n] → Notes", "Renders between Spec and Notes columns", "Always renders in the final Notes column"** — rendering-order prose. The `spec` / `values[]` / `notes` shape is still the authoritative schema.
- **§Common Mistakes — "Overriding preview frame layout" and any bullet about `#Preview` frame behavior** — rendering concerns. Data-level mistakes (missing sub-component sections, wrong axis grouping, bad display strings) still apply.
- **§Pre-Render Validation Checklist — "Sub-component preview sourcing" and "Preview frame untouched" rows** — do not apply. All other checks (shape of `sections`, correctness of `rows`, column counts, measurement labels) DO still apply.

Note: Fields that look like rendering config but are part of the output schema (e.g., `preview`, `columns`, `variantProperties`, `booleanOverrides`) must still be populated.

### Step 2: Load `_base.json`

Read `{cachePath}/{componentSlug}-_base.json`. If missing, or if required sections are `null` / missing, abort with a diagnostic asking the user to re-run the uSpec Extract plugin.

See [figma-plugin/docs/base-json-schema.md]({{repo:figma-plugin/docs/base-json-schema.md}}) for the full schema. Top-level keys this skill consumes:

- `component`, `variantAxes`, `defaultVariant`
- `propertyDefinitions.rawDefs` / `booleans` / `slots`
- `variables.localCollections` + `resolvedVariables` (for mode detection)
- `variants[]` — each has `dimensions`, `layoutTree`, `treeHierarchical`, `revealedTree`
- `crossVariant.axisDiffs` / `stateComparison` / `axisClassification` / `sizeAxis` / `stateAxis` / `dimensionAxes`
- `slotHostGeometry.swapResults`
- `subComponentVariantWalks` (optional, Phase I; absent on legacy fixtures) — per-subCompSetId walks across a constitutive child's own variant cross-product
- `_extractionNotes.warnings`

Also absorb `optionalContext` as authoritative user guidance.

### Step 2.5: Load API dictionary (canonical vocabulary)

The `create-component-md` orchestrator writes `{cachePath}/{componentSlug}-api-dictionary.json` alongside `_base.json` after `extract-api` finishes. When present, this file is the **canonical vocabulary** for axis names, value names, sub-component names, and state runtime conditions. See the **`ApiDictionary` artifact** section in [api/agent-api-instruction.md]({{ref:api/agent-api-instruction.md}}) for the schema.

**Resolution order:**

1. If the orchestrator passed `apiDictionaryPath`, read that file.
2. Otherwise look for `{cachePath}/{componentSlug}-api-dictionary.json` on disk.
3. If neither path resolves (e.g., the skill is being run standalone outside the orchestrator), continue with existing behavior but set `data._dictionaryUnavailable = true` on the output envelope. The orchestrator's Step 9.5 integrity check uses this flag to mark the produced cache as lower confidence.

**How this skill uses the dictionary** (keep it in scope through Steps 3–5):

- **Sub-component section names.** When emitting `sections[].sectionName` for a sub-component section (Rule 2d) or a `slotContent` section (Rule 6), prefer the dictionary's canonical `subComponents[].name` over the raw Figma name. Example: the dictionary says `"Input"` but the revealed tree walks a node named `"input-container"` — the section name is `"Input"`.
- **State column headers.** When a section's columns correspond to a decomposed Figma state axis (`dictionary.states[].figmaAxis` matches the section axis), replace Figma option columns with the dictionary's `runtimeCondition` values in matching order. Do **not** substitute when the mapping is partial — leave every column as the raw Figma value and emit a `_dictionaryMismatch` entry (see below).
- **Visual-only axis delta columns (Step 4.D.1).** Same rule: the renderer already resolves column headers via `stateAxisMapping[]`, but when you emit `visualOnlyAxisDeltas[].columns[]`, keep them as the raw Figma values — the renderer relabels. **Never pre-substitute.**

**Mismatch protocol — do NOT silently rename, do NOT silently keep.**

When your evidence (from `_base.json`) contradicts the dictionary — for example, the dictionary names a sub-component the revealed tree does not contain, or you measured a value the dictionary does not list — emit the observed value AND attach a `_dictionaryMismatch` annotation to that row/section with shape:

```json
{
  "observed": "<what you measured / observed in _base.json>",
  "dictionary": "<what the dictionary named; null when the dictionary listed a value you couldn't find>",
  "kind": "value-missing" | "value-extra" | "name-drift",
  "note": "<short rationale; ≤160 chars>"
}
```

Aggregate every mismatch into `data._extractionArtifacts.dictionaryMismatches[]`. The orchestrator's Step 8.5 reconciliation pass consumes this list and decides whether to auto-rewrite vocabulary, re-dispatch a specialist, or surface a semantic conflict.

**Retry semantics — the orchestrator may re-dispatch this skill.**

When `optionalContext` begins with the literal prefix `create-component-md retry: `, the rest of the string is an authoritative scope expansion from the orchestrator's Step 8.5 reconciliation step. Parse it as a comma-separated list of items the dictionary exposed but this skill previously did not cover. The retry run MUST emit evidence for every listed item — either a real section/row citing evidence from `_base.json`, or an explicit `_dictionaryMismatch` entry explaining why no evidence could be gathered. Never silently drop a listed item.

### Step 3: Build Working Evidence Set

Populate the structure-side evidence structure by reading **only** from `_base.json`. The key mappings:

| Evidence field | `_base.json` source |
| -------------- | ------------------- |
| `componentName` | `component.componentName` |
| `variantAxes` | `variantAxes[*].options` (shape: `{ [axisName]: string[] }`) |
| `propertyDefs` | `propertyDefinitions.rawDefs` |
| `booleanDefs` | map of `propertyDefinitions.booleans[*].rawKey → defaultValue` |
| `variants[]` | `_base.json.variants[*]` — each has `name`, `dimensions`, `layoutTree`, and `treeHierarchical` (used as the "children" tree) |
| `enrichedTree` | `variants[<default>].revealedTree` (from Phase G of the plugin) |
| `subComponents[]` | Derived by walking `variants[<default>].treeHierarchical`: every top-level INSTANCE entry with a `subCompSetId` becomes a sub-component entry. Fields: `name`, `mainComponentName`, `subCompSetId`, `subCompVariantAxes`, `booleanOverrides`, `dimensions`, `children`, `typography`. |
| `slotContents[]` | `propertyDefinitions.slots[*]` (includes `defaultChildren` with `contextualOverrides`), joined with `slotHostGeometry.swapResults[slotName]` for per-preferred swap measurements |
| `rootDimensions` | For each variant on `sizeAxis` (or the fallback axis), `variants[v].dimensions` keyed by size label |
| `subComponentDimensions` | For each sub-component name and each size, the sub-component's node as found in `variants[v].revealedTree` (already has booleans enabled). Walk the revealed tree for the matching INSTANCE by name. Read its `dimensions` for `self` and walk its `children` for per-child dims. |
| `subComponentVariantWalks` | Optional Phase I block keyed by `subCompSetId`. When a constitutive sub-component has its own variant axes (e.g., Input's `size: large | medium | small`), this is the authoritative source for per-axis cells. For each column in a section whose axis matches the sub-component's own axis, resolve the matching `variants[*]` entry by `variantProperties` and pull values from its `dimensions` (root rows) or `treeHierarchical` (nested-frame rows). Cells filled this way get `provenance: "measured"`. See Rule 2d below for the full read-path. |
| `slotContentDimensions` | For each slot in `slotHostGeometry.swapResults`, for each preferred component: `{ self: swapResults[slotName][compId].prefDims, slotContext: swapResults[slotName][compId].slotDims }` |
| `stateComparison` | `crossVariant.stateComparison` |
| `axisDiffs` | `crossVariant.axisDiffs` |
| `sizeAxis` / `stateAxis` / `dimensionAxes` | `crossVariant.sizeAxis` / `stateAxis` / `dimensionAxes` |
| Variable-mode modes (density/shape/spacing) | `variables.localCollections[*]` filtered by name — look for collections whose name matches `/density|shape|size|spacing|radius|tone/i` with `modes.length > 1`, then look up values via `variables.resolvedVariables` |
| Text typography | Each `treeHierarchical` node with `type: "TEXT"` has `typography.styleId` (or inline props). Look up `styleId` in `styles.resolvedStyles[styleId].name` to get the human-readable style name. |

**No Figma calls** are needed for this step. If you need a field not in the table above, that's a Step 3-delta candidate — see below.

### Step 3-delta (optional, read-only)

If during Step 4 you find a genuinely missing fact — for example, a variant not walked by the plugin because the user passed `optionalContext: "focus: primary variant"`, or a variable mode value not resolved by Phase B — you MAY issue a small `figma_execute` / `use_figma` call scoped to that missing fact.

Rules:
- **Read-only.** No `createInstance`, `setProperties`, `appendChild`, or `remove`.
- **< 50 lines of JS.** Anything larger means the `_base.json` schema needs widening.
- **Audit every call.** Append one entry to `data._deltaExtractions[]` per delta script you run:
  ```json
  {
    "purpose": "<why missing>",
    "script": "<first 200 chars of the JS>",
    "byteCount": <returned bytes>,
    "timestamp": "<ISO 8601>"
  }
  ```
  An empty array (zero delta calls) is the expected default. Multiple entries signal pressure to widen the `_base.json` schema in the plugin.

If a structural axis (Rule 1c below) needs cross-variant dimensions that `axisDiffs` did not capture, **prefer** the delta escape over abandoning the reasoning — but keep the delta to one tiny measurement script per structural configuration.

### Step 4: AI Interpretation Layer

This is the core quality step. You have complete, structured data in the evidence set. Focus on high-value reasoning tasks.

**A. Build the section plan.** Apply these deterministic rules to the evidence, then validate against your judgment about the component's actual structure.

**Rules (apply in order):**

1. **Variant axes with purely numeric differences → columns.** For each variant axis, compare `rootDimensions` across values. If all values have the same set of properties and differ only numerically, make this axis a set of columns (e.g., Size → "Large", "Medium", "Small", "XSmall").

1b. **Variant axes with identical values → still columns.** When multiple variants along an axis share identical dimensional values, use those variants as columns anyway. Identical values across columns communicate intentional structural consistency. Do not collapse to a single "Default" column.

1c. **Reason about non-dimensional axis diffs.** Using `crossVariant.axisDiffs`, compare measurements across each axis and classify:

   - **Structural axis** (children differ — different names, count, or visibility across values): Each structurally distinct configuration needs its own section(s). If `_base.json` lacks cross-variant dimensions for that configuration, issue a Step 3-delta measurement scoped to it. Create separate sections per configuration.
   - **Property-variant axis** (same children, dimensional properties differ — strokeWeight appears/disappears, cornerRadius changes, padding differs, sizing mode changes): Create a state-conditional section documenting which values have which property differences.
   - **Visual-only axis** (same children, same dimensional properties — only fills, effects, opacity change): Skip. No section needed.

   Use judgment for edge cases: a 0.5px rounding difference is noise, but `strokeWeight` going from 0 to 1 is meaningful.

   **Dedup with `stateComparison`:** If an axis is already covered by `stateComparison` (axes matching `/state/i`), prefer `stateComparison` for Rule 4 and skip creating a duplicate section from `axisDiffs` for that axis. However, still check the `axisDiffs` children data — if children differ across that axis (structural change), escalate it to structural, which supersedes `stateComparison`.

2. **Treat evidence arrays as candidates, not final section types.** `subComponents`, `slotContents`, `enrichedTree`, `layoutTree` are discovery inputs for planning. Do not assume an item belongs to a final section type just because it first appeared in one array.

2a. **Resolve ownership before creating any sections.** For each candidate instance discovered in `subComponents`, `slotContents`, or the relevant structural zones of `enrichedTree`, classify it once onto exactly one path: `subComponent`, `slotContent`, or composition/root-only.

2b. **Ownership rule before slot classification.** If an instance is a **parent-owned structural role** in the component architecture, classify it as a `subComponent` even if it is placed via a slot. If an instance is **library-owned** or generic **preferred slot content**, keep it on the `slotContent` path. File-locality is a supporting signal only — ownership and engineering responsibility win.

2c. **Deduplicate overlapping candidates.** If the same concept appears in both `subComponents` and `slotContents.preferredComponents`, resolve with Rule 2b and emit **at most one** section path.

2d. **Sub-components → separate sections.** Each remaining `subComponent` gets its own section. The section's columns match the parent's size axis (or the sub-component's own size axis if it has one). Use `subComponentDimensions[name]` for row data.

**2d.1 — `subComponentVariantWalks` read-path (when the sub-component carries its OWN axis).** When the columns correspond to the sub-component's own `subCompVariantAxes` (not the parent's size axis), `subComponentDimensions[name]` only covers the ONE variant the designer embedded in the parent. The remaining columns MUST be filled from `_base.json.subComponentVariantWalks[subCompSetId]`:

1. Look up `subComponentVariantWalks[subCompSetId]` (the sub-component's set id is stored on each `subComponents[]` entry and on `_childComposition.children[]`).
2. For each column, match a `variants[*]` entry by comparing the column header to `variants[*].variantProperties[axis]` (case-insensitive, whitespace-normalised).
3. Use the matched entry's `dimensions` for the root-level row values (`minHeight`, `minWidth`, `padding*`, `itemSpacing`, `cornerRadius`, `strokeWeight`, …).
4. For nested-frame rows (`├ Some inner frame`-style, sourced from the sub-component's internal tree), resolve the same column from the matched entry's `treeHierarchical` — walk by name along the same path you would walk in `subComponentDimensions`.
5. Cells filled this way carry `provenance: "measured"`.

**When to emit `"—"` with `provenance: "not-measured"` on these columns.** Exactly two cases:

- The `subComponentVariantWalks[subCompSetId]` entry is `skipped: true`. Copy `skippedReason` into the row's `notes`.
- The entry is present but no `variants[*]` matches a specific column header (rare — means the COMPONENT_SET lacked that variant). Cite the missing `variantKey` in the row's `notes`.

**`_deltaExtractions` policy for sub-component axes.** Emit a `_deltaExtractions[*]` gap entry ONLY when `subComponentVariantWalks` is missing entirely (legacy `_base.json`) or when the matching block is `skipped`. Never emit a gap entry when Phase I walked the axis successfully — the data is already in `_base.json`.

**Legacy fallback.** When `_base.json.subComponentVariantWalks` is absent altogether, continue the previous behavior: fill only the embedded-variant column from `subComponentDimensions`, emit `"—"` + `provenance: "not-measured"` in the remaining columns, and log one `_deltaExtractions` entry noting the legacy shape and recommending the user re-run the updated plugin.

3. **2+ sub-components with own size variants → composition section.** If `subComponents` has 2+ entries where `subCompVariantAxes` contains a size-like axis, create a composition section as the first section.

4. **State axis with new properties → state-conditional section.** Compare `stateComparison` entries: if any state introduces a property not present in the default state (especially `strokeWeight` appearing or changing), create a state-conditional section.

5. **Layout tree for container hierarchy.** Use `layoutTree` from the default variant to identify structurally significant containers. Pass-through wrappers (no padding, no spacing, single child) can be omitted.

6. **Slot preferred content → `slotContent` sections.** For each entry in `slotContents` that has `preferredComponents`, create one section per preferred component **only when the preferred instance is still classified as `slotContent` after Rules 2a-2c**. Name pattern: `"{slotName} — {componentName}"`. Columns match the parent's size axis. Data source: `slotContentDimensions.{slotName}.{componentName}`. Description: `"Dimensional properties when {componentName} is placed in the {slotName} slot. See {componentName} spec for component internals."` Place after sub-component sections but before state-conditional sections. **Rows are limited to hosting context and slot-imposed deltas** — do not emit the preferred component's own internal structure from `self`. Prefer container rows (`Container`, contextual padding, contextual widthMode/heightMode) and a reference row like `Text button instance` / `Checkbox instance`.

**Produce a `sectionPlan` array** with this shape:

```
sectionPlan = [
  {
    sectionType: "composition" | "variant" | "subComponent" | "stateConditional" | "slotContent",
    sectionName: string,
    sectionDescription: string | null,
    columns: string[],
    subCompSetId: string | null,
    booleanOverrides: object,
    variantAxis: string | null,
    dataSource: string,
    preferredComponentId: string | null,
    preferredComponentSetId: string | null,
    slotName: string | null
  },
  ...
]
```

**Ordering:** Composition first (if any) → root/variant sections → sub-component sections in visual order (leading → middle → trailing) → slot content sections (grouped by slot) → state-conditional sections last.

**Validate the plan:**
- Does every auto-layout container have its padding and spacing covered?
- Does every sub-component have a section?
- Are there dimensional properties in the evidence not included in any section?
- For behavior/configuration variant axes: use the default configuration for the preview; add a row for border/stroke differences rather than creating a new section unless the property sets fundamentally differ.
- For `slotContent` sections: rows limited to hosting context and placement-specific deltas, no duplicated internals.
- If an instance appeared in multiple discovery paths, was it emitted on exactly one section path?

**B. Write design-intent notes.** For each property row, write notes that answer **"why this value?"** not just **"what is this property?"**. Use cross-variant data to identify scaling patterns and explain them.

| Instead of this | Write this |
|---|---|
| "Tap target" | "Meets WCAG 2.5.8 minimum touch target with 12 optical margin" |
| "Inset from edges" | "Accommodates multi-line secondary text at spacious density" |
| "Pill shape" | "Uses half of minHeight — pill shape scales with container height" |
| "Icon size" | "Matches the platform icon grid used by the system" |
| "Gap between icon and label" | "Scales with size axis: 4→6→8→8 maintains optical balance at each size" |

**C. Cross-section pattern recognition.** Identify system-wide patterns, consistency observations, and cross-references. Put these in `generalNotes` and `sectionDescription`.

**D. Anomaly detection.** Scan the evidence for scaling inconsistencies, token misconfiguration, asymmetric padding without explanation, missing token bindings, and stroke/border state changes. Add anomaly notes to the relevant row's `notes` or to `generalNotes`.

**D.1. Visual-only axis deltas (schema extension).** For every variant axis classified as **Visual-only** by Rule 1c (same children, same dimensional properties, non-dimensional properties still change), emit one entry into `data._extractionArtifacts.visualOnlyAxisDeltas[]`. See the instruction file's **Visual-only axis** subsection for the reasoning. Strict entry shape:

```jsonc
{
  "axis": "<name of the Figma axis, e.g. 'state'>",
  "columns": ["<each Figma option in declared order>"],
  "rows": [
    {
      "element": "<human-readable element name, e.g. 'Input strokeWeight', 'Cursor indicator', 'Hint icon glyph'>",
      "property": "strokeWeight | visibility | iconGlyph | textContent",
      "values": ["<one value per column, mapping the element's property at that Figma option>"],
      "notes": "<short rationale; optional>"
    }
  ]
}
```

Rules:

- `columns[]` mirrors the Figma axis option list exactly (the renderer relabels via `stateAxisMapping[]` when appropriate — do not pre-substitute).
- Emit only rows where **at least two columns differ**. Constant rows are not deltas.
- `property` is one of `strokeWeight`, `visibility`, `iconGlyph`, `textContent`. Other non-dimensional properties (opacity, blendMode, rotation, …) are out of scope for this artifact unless the component genuinely pivots on them — when in doubt, record them as `visibility` with a note.
- For `strokeWeight`, values are numeric (use `0` to indicate border-removed rather than `"hidden"`).
- For `visibility`, values are the strings `"visible"` or `"hidden"`.
- For `iconGlyph`, values are the icon component set names (e.g., `"circle_i"`, `"alert"`) — prefer `parentSetName` from the revealed tree, fall back to `mainComponentName`.
- For `textContent`, values are the resolved strings when deterministic (default placeholder, error message, …). Use `"—"` when the content is user-supplied.

Emit an empty array when no axis is visual-only. This is **not** a substitute for dimensional sections — it runs alongside them.

**D.2. Coverage matrix (schema extension — §coverageMatrix).** Emit `data._extractionArtifacts.coverageMatrix` on **every** run. This is the mechanical audit that guarantees every non-zero layout property on every auto-layout FRAME has at least one corresponding row in `data.sections`. The artifact is component-agnostic: every field is derived from `_base.json` + `data.sections` alone; no component-specific names appear in the algorithm.

Strict shape:

```jsonc
"coverageMatrix": {
  "complete": true,
  "totals": {
    "framesWalked":          <int>,
    "framesWithNonZeroProps": <int>,
    "missingFamilies":        <int>
  },
  "entries": [
    {
      "nodeId":   "<FRAME's Figma node id>",
      "nodePath": "<'/'-joined ancestor names ending at this FRAME>",
      "owningSection": "<sections[].sectionName, or '(root/composition)' when no sub-component ancestor applies>",
      "nonZeroProps": [
        { "family": "padding.horizontal", "value": <number>, "source": "dimensions.padding.horizontal.value" }
        /* one entry per non-zero property family on this FRAME */
      ],
      "emittedRows": [
        { "section": "<section name>", "spec": "<row.spec>" }
      ],
      "missing":       [ /* subset of family names for which no matching row was found */ ],
      "pendingReason": [ /* parallel to missing[]; optional justifications when complete=false */ ]
    }
  ]
}
```

**Walk rules (apply exactly — same for every component):**

**R1. ROOTS.** Walk the union of:
- `_base.json.variants[<default>].treeHierarchical`
- every `_base.json.variants[*].revealedByVariantName[*]`

Recurse depth-first through `children` (or `__children` in revealed trees).

**R2. FILTER.** Only nodes with `type === "FRAME"` are audited. Skip `TEXT`, `VECTOR`, `GROUP`, `COMPONENT`, `COMPONENT_SET`. `INSTANCE` nodes do not contribute coverage rows but may need to be traversed per R3.

**R3. BOUNDARY.** When traversal reaches an `INSTANCE`:
- If `_base.json._childComposition.children[]` contains an entry whose `subCompSetId` equals this INSTANCE's mainComponent's parent-set id AND `classification === "constitutive"` → **RECURSE** (this component documents it inline).
- Otherwise (referenced, decorative, or unclassified) → **STOP** traversal.

This rule adapts per component without hardcoding: `_childComposition` is always the source of truth.

**R4. NON-ZERO DETECTION.** For each audited FRAME, collect non-zero entries across these fixed property families from `node.dimensions`:

| Family | Source on the node |
|---|---|
| `padding` (uniform) | `dimensions.padding.value` |
| `padding.vertical` (symmetric) | `dimensions.padding.vertical.value` |
| `padding.horizontal` (symmetric) | `dimensions.padding.horizontal.value` |
| `padding.top` / `padding.bottom` / `padding.left` / `padding.right` (per-side) | `dimensions.padding.{side}.value` |
| `itemSpacing` | `dimensions.itemSpacing.value` |
| `counterAxisSpacing` | `dimensions.counterAxisSpacing.value` |
| `cornerRadius` (uniform or per-corner) | `dimensions.cornerRadius.value` (and per-corner sub-entries when present) |
| `borderWidth` | any `strokes[*].strokeWeight > 0` |

A family with value `0` is recorded only implicitly (by its absence from `nonZeroProps`) — `nonZeroProps` is the non-zero-only audit surface. The "emit both axes for symmetric padding even when one side is zero" quality rule (see `agent-structure-instruction.md` Pre-Render Validation Checklist) lives at the **row-emission** layer in Step 5, not in this matrix: the matrix's job is to guarantee that *every real non-zero value* is accounted for by at least one row. Zero-side documentation rows are expected to exist alongside and are never flagged as missing here (they cannot be — zero is never in `nonZeroProps`).

**R5. SECTION RESOLUTION + MATCH.** For each FRAME entry:

a) Walk ancestors upward. The closest ancestor whose name (or `subCompSetId`) matches an entry in `_base.json._childComposition.children[]` with `classification === "constitutive"` determines `owningSection`, by looking up that child's name in `data.sections[*].sectionName` (case-insensitive, whitespace-normalised). If no constitutive ancestor applies, `owningSection = "(root/composition)"` — use the first `sectionType: "composition"` section, or the first root section.

b) Scan `data.sections[<owningSection>].rows[*].spec` for any row whose spec is in the accepted-names set for each non-zero family:

| Family | Accepted row `spec` names |
|---|---|
| padding (any form) | `padding`, `verticalPadding`, `horizontalPadding`, `paddingTop`, `paddingBottom`, `paddingStart`, `paddingEnd` |
| itemSpacing | `itemSpacing`, `contentSpacing`, `gapBetween` |
| cornerRadius | `cornerRadius`, `cornerRadiusTopStart`, `cornerRadiusTopEnd`, `cornerRadiusBottomStart`, `cornerRadiusBottomEnd` |
| borderWidth | `borderWidth`, `strokeWeight` |

Record matches in `emittedRows`; record unmatched families in `missing`.

c) `complete = (entries.every(e => e.missing.length === 0))`.

**Gate behaviour.** If `complete` would be `false`, fix the section plan (add the missing rows from the evidence, re-run Step 4/5) before writing output. Only emit `complete: false` when a FRAME is a documented pass-through wrapper the component intentionally omits; in that case each missing family MUST carry a `pendingReason` explaining the omission. Never silently set `complete: true` over an unresolved miss.

**Known-gaps handoff.** Whenever `complete: false` is the legitimate outcome (pendingReason cases), the enumerated misses MUST ALSO be summarized in `data.generalNotes` (same channel used for `not-measured` rows — see Step 4.E). This is what lets the renderer surface them in the Known gaps block without any renderer change. Each summary line includes the FRAME's `nodePath` and the comma-separated `missing[]` families.

**Totals derivation.**
- `framesWalked` = the number of FRAME nodes reached under R1–R3 (distinct `nodeId`).
- `framesWithNonZeroProps` = `entries.filter(e => e.nonZeroProps.length > 0).length`.
- `missingFamilies` = `entries.reduce((sum, e) => sum + e.missing.length, 0)`.

Entries with zero non-zero properties (pure visual/wrapper FRAMEs) still appear in `entries[]` with empty `nonZeroProps`, `emittedRows`, and `missing` — they contribute to `framesWalked` but not to `framesWithNonZeroProps` or `missingFamilies`. This keeps the recount in Step 9.5 verifiable.

**D.3. Consolidated typography table (schema extension).** When the component contains two or more distinct text elements, emit `data._extractionArtifacts.typographyTable[]` in addition to the per-section typography rows. See the instruction file's **Consolidated Typography Table** subsection for the reasoning. Strict entry shape:

```jsonc
{
  "element": "<engineer-readable element name; prefer API name>",
  "family": "<fontFamily>",
  "weight": "<weight name or numeric>",
  "size": <number>,
  "lineHeight": <number | "auto">,
  "letterSpacing": <number>,
  "styleId": "<Figma text styleId or null>",
  "styleName": "<resolved style name or null>",
  "notes": "<optional truncation / wrapping / language behavior>"
}
```

Rules:

- One row per distinct text element (not per distinct text style). Two elements sharing the same style both appear.
- Pull the typography composite from the revealed default variant (or the first variant where the element renders, when it's state-gated). Do not synthesize from inline fallbacks when a `styleId` resolves.
- Skip the whole artifact (omit the field or emit an empty array) when the component has ≤1 distinct text element.

**E. Completeness judgment (hard provenance gate).**

Every row you emit **must** carry a `provenance` field with exactly one of these values:

1. **`"measured"`** — the numeric or token-and-number display string came **verbatim** from `_base.json`. Acceptable sources:
   - `variants[v].treeHierarchical` (dimensions, typography)
   - `variants[v].revealedTree` (post-boolean-enable geometry)
   - `revealedByVariantName[*]` (per-variant revealed tree from Phase G)
   - `crossVariant.axisDiffs[axis][value].root` / `.children` / `.childrenDeep`
   - `slotHostGeometry.swapResults[slot][compId].prefDims` / `.slotDims`
   - `styles.resolvedStyles[sid]` with a non-`_unresolved` entry
   The display string in the table cell must equal `source.display` byte-for-byte (or the derived value from collapsed-padding/cornerRadius rules).

2. **`"inferred"`** — the value was computed by resolving a documented design token via `variables.resolvedVariables` (e.g., mapping `spacing.md` through its mode values to produce `"8"`). The row's `notes` field must cite the token used.

3. **`"not-measured"`** — none of the above sources produced a value. The row value must be the literal em dash `"—"` in every column it appears in. **Numerical invention is forbidden.** Do not invent a plausible number, do not copy a value from a neighboring row, do not write "approx" or "estimated".

**Gate behaviour:**

- Walk every row in your plan. For each, determine provenance by physically looking up the source in `_base.json` (or via a documented token resolution) before setting the cell value.
- Tally how many planned rows end up `not-measured`. If **> 20%** of rows in the final plan are `not-measured`, STOP and fire a **Step 3-delta** read-only measurement scoped to the missing subtree(s). Rerun Step 4E with the delta data before emitting rows.
- Group-header rows (`spec: "Container"` etc. with all-`"–"` values) take `"measured"` when the container node itself was extracted, or `"not-measured"` when the group had to be invented to organize rows the extraction didn't cover.

**Coverage audit (run after provenance is assigned):**
- Does every auto-layout container have its padding and spacing documented? Walk `subComponentDimensions[name][size].children` (and nested `__children`) for every entry with non-zero `padding`.
- Does every instance classified as a `subComponent` have its own section?
- Are there dimensional properties in `rootDimensions` or `subComponentDimensions` not included in any row?
- For composition sections: does every sub-component's size mapping cover all parent sizes?
- Typography: for every TEXT node the section owns, emit a typography row set (see below). Do NOT copy preferred slot children's typography into `slotContent` sections.

**Typography provenance (E1 rule — no prose).** Never emit typography as a free-text note. For each TEXT node:

1. If `typography.styleId` resolves in `styles.resolvedStyles[sid]` and `_unresolved` is not true → emit one `textStyle` row with the style name as the value; `provenance: "measured"`.
2. Otherwise, if inline props are present (either directly on the node's `typography` object or in `styles.resolvedStyles[sid].inline` from the Phase C fallback) → emit individual rows for `fontSize` / `fontWeight` / `lineHeight` / `letterSpacing`. Each row gets `provenance: "measured"` (or `"inferred"` if derived from a variable mode).
3. If **neither** path resolves → emit a single `typography` row with value `"—"` and `provenance: "not-measured"`. Never emit a prose note in place of structured rows.

If gaps cannot be filled even after a Step 3-delta, add a summary in `generalNotes` that enumerates the `not-measured` rows so the final component-md renderer can surface them in the "Known gaps" block.

### Step 5: Generate `StructureSpecData`

Follow the schema in the instruction file:

- `componentName`: string
- `generalNotes`: string (optional) — cross-section patterns and component-wide anomalies from Step 4
- `sections`: array, each with:
  - `sectionName`: string
  - `sectionDescription`: string (optional)
  - `columns`: string[] (first is "Spec" or "Composition", last is "Notes")
  - `rows`: array, each with `spec`, `values[]` (length `columns.length - 2`), `notes`, optional `isSubProperty`, `isLastInGroup`

**Populating rows from dimensional data.** Look up `dataSource` and read measurements at each column key. Use the `display` field directly as the cell value. Collapsed padding: single value → one `padding` row; `{vertical, horizontal}` → `verticalPadding` + `horizontalPadding`; per-side → individual rows. Collapsed cornerRadius: uniform → one row; per-corner → `cornerRadiusTopStart`, etc. Typography: `{styleName}` → one `textStyle` row; inline props → `fontSize`, `fontWeight`, `lineHeight` rows.

**Override for `slotContent` sections.** Use `slotContext` as primary source for hosting-container rows. Use `self` only for values different from the preferred component's standalone defaults because of slot placement. Skip the preferred component's own internal padding, cornerRadius, borderWidth, icon sizes, internal spacing, and typography.

Ensure: first column always "Spec" (or "Composition"); last always "Notes"; `values` length matches `columns.length - 2`; use `isSubProperty: true` for child properties.

**Derive the coverage matrix (always, every run).** Once `data.sections` is finalized, run the five walk rules defined in §coverageMatrix (Step 4.D.2) against `_base.json` + the just-built `data.sections` and populate `data._extractionArtifacts.coverageMatrix` with the resulting `{ complete, totals, entries }` object. This pass is purely derivational — no new Figma calls, no new rows invented. If the walk surfaces `missing[]` on any entry, loop back to Step 4/5 and add the missing row from the evidence; re-run the walk until `complete === true` (or the miss is justified with a `pendingReason` per §coverageMatrix gate behaviour). Writing the envelope in Step 7 with `complete: false` without `pendingReason` is a protocol violation.

### Step 6: Audit

Re-read the instruction file, focusing on **Common Mistakes**, **Do NOT**, and **Property naming** conventions (camelCase, no platform units), then tick every box in this checklist before moving on. If any check fails, fix the output (or fire a Step 3-delta) and re-run the list.

```
Structure audit:
- [ ] Every row has a provenance field ("measured" | "inferred" | "not-measured")
- [ ] No row with provenance="not-measured" contains a numeric value — all columns are "—"
- [ ] Every row with provenance="inferred" cites the token in notes
- [ ] Every row with provenance="measured" has a display string that came from _base.json verbatim
- [ ] Not-measured row count is ≤ 20% of total rows (otherwise: Step 3-delta was fired)
- [ ] Every auto-layout container present in variants[*].treeHierarchical or revealedByVariantName[*] has at least one documented row
- [ ] **Per-property coverage:** for every auto-layout FRAME under R1–R3, every non-zero layout property family from R4 (padding / itemSpacing / cornerRadius / borderWidth) is matched by a row whose `spec` is in the accepted-names set from §coverageMatrix R5. Symmetric padding `{ vertical, horizontal }` emits BOTH `verticalPadding` and `horizontalPadding` rows, including when one side is `0`. Missing ≠ zero.
- [ ] `data._extractionArtifacts.coverageMatrix.complete === true`. The matrix was populated by walking the five rules in §coverageMatrix; every entry whose `missing[]` is non-empty MUST block the return. If coverage cannot be reached for a legitimate reason (e.g., a FRAME is a documented pass-through wrapper), still emit the entry with `complete: false` and a `pendingReason` on each missing family — do not silently set `complete: true`.
- [ ] `coverageMatrix.totals.framesWalked` matches an independent recount from `_base.json` using rules R1–R3 — the orchestrator's Step 9.5 gate re-runs this recount and will block on mismatch.
- [ ] **Sub-component variant walks consumed.** For every section whose columns correspond to a constitutive sub-component's OWN variant axis, every column is filled from `_base.json.subComponentVariantWalks[subCompSetId].variants[*]` with `provenance: "measured"`. `"—"` cells on those columns are permitted ONLY when the entry is `skipped: true` (cite `skippedReason` in row notes) or when a specific `variants[*]` combo is genuinely absent (cite the missing `variantKey` in row notes). A `_deltaExtractions[*]` entry for the sub-component axis is emitted ONLY when `subComponentVariantWalks` is missing from `_base.json` (legacy fixture) or when the matching block is `skipped` — never when Phase I walked the axis successfully.
- [ ] No typography prose in notes — every TEXT node emits textStyle OR inline-prop rows OR a not-measured row
- [ ] Every sub-component classified as subComponent has its own section
- [ ] Every slotContent section documents only hosting context + placement-specific deltas
- [ ] Sections referencing "See X spec" do not restate X's internal structure
- [ ] _deltaExtractions[] records every Step 3-delta call that fired this run
- [ ] _base.json._extractionNotes.warnings were surfaced in the summary if non-empty
- [ ] For every visual-only axis, `_extractionArtifacts.visualOnlyAxisDeltas[]` has one entry whose `columns` match the axis option list and whose `rows` each show a real delta (≥2 differing columns). No dimensional properties leak into this artifact.
- [ ] If the component has ≥2 distinct text elements, `_extractionArtifacts.typographyTable[]` has one row per element; each row carries `family`, `weight`, `size`, `lineHeight`, `letterSpacing`, and (`styleId`+`styleName` OR inline) populated.
- [ ] No row note or `generalNotes` string contains "layout-distributed", "evenly distributed", or "auto-spaced"; every `SPACE_BETWEEN` container uses the required note template and `"—"` value.
- [ ] When the API dictionary was loaded, every sub-component section name matches a `dictionary.subComponents[].name` OR carries a `_dictionaryMismatch` entry explaining the drift. Same rule for any state-axis column headers.
- [ ] When `_dictionaryUnavailable` is true, the output envelope records it so the orchestrator can downgrade confidence.
```

Return the completed checklist in your final summary so the orchestrator can aggregate it into the "Known gaps" block.

### Step 7: Write Cache and Return

Write the finalized `StructureSpecData` object as pretty-printed JSON to `{cachePath}/{componentSlug}-structure.json`. Envelope:

```json
{
  "_meta": {
    "schemaVersion": "1",
    "extractedAt": "<ISO 8601 timestamp>",
    "fileKey": "<fileKey>",
    "nodeId": "<nodeId>",
    "componentSlug": "<componentSlug>",
    "optionalContext": "<optionalContext or null>",
    "baseJsonPath": "<cachePath>/<componentSlug>-_base.json"
  },
  "data": {
    "componentName": "<name>",
    "generalNotes": "<string>",
    "sections": [ /* StructureSpecData.sections */ ],
    "_deltaExtractions": [ /* 0+ entries */ ],
    "_dictionaryUnavailable": false /* true when Step 2.5 could not locate the api-dictionary.json */,
    "_extractionArtifacts": {
      "variantAxes": { /* raw axes from _base.json.variantAxes, reshaped as { [axisName]: options[] } */ },
      "propertyDefs": { /* raw from _base.json.propertyDefinitions.rawDefs */ },
      "booleanDefs": { /* raw from _base.json.propertyDefinitions.booleans, reshaped as { rawKey: defaultValue } */ },
      "subComponentsSummary": [ { "name": "...", "mainComponentName": "...", "subCompSetId": "..." } ],
      "slotContentsSummary": [ { "slotName": "...", "preferredComponents": [ { "componentName": "...", "componentId": "..." } ] } ],
      "visualOnlyAxisDeltas": [ /* 0+ entries — see Step 4.D.1 */ ],
      "coverageMatrix": { /* always emitted — see Step 4.D.2 / §coverageMatrix.
                            { complete, totals: { framesWalked, framesWithNonZeroProps, missingFamilies }, entries: [...] } */ },
      "typographyTable": [ /* 0+ entries — see Step 4.D.3 */ ],
      "dictionaryMismatches": [ /* 0+ entries — see Step 2.5 mismatch protocol */ ]
    }
  }
}
```

Return:

```
Structure extracted: <N> sections, <M> sub-components, <K> slot contents → <cachePath>/<componentSlug>-structure.json
```

Where `N` = entries in `data.sections`, `M` = entries in `subComponentsSummary`, `K` = total preferred components across all `slotContentsSummary`.

Append `(warnings: <W>)` if `_base.json._extractionNotes.warnings` is non-empty.

## Not In Scope

- Extracting from Figma beyond the Step 3-delta escape hatch.
- Importing or detaching Figma templates.
- Rendering sections, header fields, or preview instances in Figma.
- Visual validation screenshots and the iterative fix loop.
- Re-reading `uspecs.config.json` — the orchestrator passes `mcpProvider` directly.

## Quality Guarantee

If the produced JSON is missing sections, has incorrect ownership, or violates the schema, the bug is either:

1. In the reasoning here (fix in both this skill and `create-structure`), or
2. In `_base.json` from the uSpec Extract plugin (fix the plugin's phase code, never duplicate extraction logic here).
