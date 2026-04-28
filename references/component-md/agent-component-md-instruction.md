# Agent Instruction — Component Markdown Source-of-Truth

This file tells the `create-component-md` orchestrator how to turn the 4 JSON cache files produced by `extract-api`, `extract-structure`, `extract-color`, and `extract-voice` into a single self-contained `.md` specification.

The `.md` is **the source of truth** — once generated, engineers should be able to implement the component from this file alone without opening Figma. Treat every rendered section as documentation that has to stand on its own.

## Inputs

The orchestrator passes the following to the renderer phase:

- `cachePath` — the directory containing the 4 cache files (typically `.uspec-cache/`).
- `componentSlug` — the filename-safe slug (e.g., `text-field`).
- `outputPath` — where to write the final `.md`.
- `fileKey`, `nodeId`, `optionalContext` — for the Provenance block and the Overview.
- `templatePath` — path to `component-md/component-md-template.md`.

The four domain cache files, all in `{ _meta, data }` envelope form:

- `{cachePath}/{componentSlug}-api.json` → `ApiOverviewData`
- `{cachePath}/{componentSlug}-structure.json` → `StructureSpecData`
- `{cachePath}/{componentSlug}-color.json` → `ColorAnnotationData` (Strategy A) or `ConsolidatedColorAnnotationData` (Strategy B)
- `{cachePath}/{componentSlug}-voice.json` → `VoiceSpecData`

Each `data` object carries a `_extractionArtifacts` block that the renderer uses for cross-references and invariants.

Two auxiliary artifacts produced by the orchestrator's Step 5 (`extract-api` projection) and Step 8.5 (reconciliation) are also consumed by the renderer:

- `{cachePath}/{componentSlug}-api-dictionary.json` → `ApiDictionary` — canonical vocabulary; the renderer consults it only for state-name relabeling fallbacks (see Color Strategy B step 2).
- `{cachePath}/{componentSlug}-reconciliations.json` → `{ autoReconciled[], retries[], unresolved[] }` — full log of every reconciliation action taken in Step 8.5. Drives the split Known-gaps block (see `## Known gaps`) and the per-section confidence headers' reconciliation counts. When the file is absent (standalone `create-component-md` run on a manually-authored cache set), treat every array as empty — the renderer must not hard-abort on missing reconciliation data.

## Placeholders

The template (`component-md/component-md-template.md`) uses `{{UPPER_SNAKE}}` placeholders. Each placeholder below has a **required renderer** that produces plain Markdown (tables, lists, paragraphs). Nothing below requires HTML.

| Placeholder | Source | Required |
|---|---|---|
| `{{COMPONENT_NAME}}` | `api.data.componentName` (fallback: structure, color, voice) | yes |
| `{{FIGMA_URL}}` | `https://www.figma.com/design/{fileKey}/?node-id={nodeId.replace(':','-')}` | yes |
| `{{GENERATED_AT}}` | ISO 8601 timestamp when the orchestrator writes the `.md` | yes |
| `{{OPTIONAL_CONTEXT}}` | `optionalContext` or `"none"` | yes |
| `{{NODE_ID}}` | `nodeId` (as passed in, e.g. `123:456`) | yes |
| `{{FILE_KEY}}` | `fileKey` | yes |
| `{{CACHE_PATH}}` | `cachePath` | yes |
| `{{OVERVIEW_PARAGRAPH}}` | 2–4 sentences synthesized from all four `data` objects | yes |
| `{{VARIANT_AXES_SUMMARY}}` | One-line summary of variant axes, their values, and defaults | yes |
| `{{COMPOSITION_SUBSECTION}}` | Composition classification summary (see **Composition subsection**). Emits `### Composition` plus one bullet per constitutive + referenced child. Empty string when `_childComposition.children` is empty. | yes |
| `{{KNOWN_GAPS}}` | Severity-tagged anomalies block (see **Known gaps**). Emit `_No gaps detected._` when empty. | yes |
| `{{FOLLOWUPS}}` | Optional next-step work block (see **Follow-ups**). Emit `_None._` when empty. NOT a defect list — describes optional, additive work like producing per-child canonical specs. | yes |
| `{{CROSS_SECTION_INVARIANTS}}` | Observations that hold across sections (see **Cross-section invariants**) | yes |
| `{{API_BODY}}` | Rendered API section (see **API body rendering**) | yes |
| `{{STRUCTURE_BODY}}` | Rendered Structure section (see **Structure body rendering**) | yes |
| `{{COLOR_BODY}}` | Rendered Color section (see **Color body rendering**) | yes |
| `{{VOICE_BODY}}` | Rendered Voice section (see **Voice body rendering**) | yes |
| `{{CROSS_REFERENCES}}` | Deduplicated cross-references (see **Cross-references**) | yes |

## Composition subsection (`{{COMPOSITION_SUBSECTION}}`)

Read `_childComposition` (top-level key) from `{cachePath}/{componentSlug}-_base.json`. Unlike the four domain caches, `_base.json` has no `data` envelope — `_childComposition` sits at the root alongside `component`, `variantAxes`, `variants[]`, etc. This block is produced by the uSpec Extract Figma plugin and reviewed at Step 4.5 of the `create-component-md` orchestrator.

**When to emit.** If `_childComposition.children` is empty AND `_childComposition.ambiguousChildren` is empty, emit the empty string — no subsection heading, no bullets. Otherwise emit the full subsection below.

**Structure:**

```markdown
### Composition

- **{child.name}** ({classification} {sub-component | component}) — {status line}
```

**Per-child rendering rules**, in the order they appear in `children[]` (then `ambiguousChildren[]` at the end):

- **Constitutive children (`classification === "constitutive"`):**
  - If `subCompSetId` is non-null: `- **{name}** (constitutive sub-component) — documented inline; also has its own spec at \`./{slug}.md\` (when present).` Slug is `name` lowercased with non-`[a-z0-9]` runs collapsed to `-`.
  - If `subCompSetId` is null: `- **{name}** (constitutive part) — documented inline in the API and Structure sections.`
- **Referenced children (`classification === "referenced"`):**
  - `- **{name}** (referenced — {mainComponentName}) — configured inline below; full spec at \`./{slug}.md\` (when present).`
  - If the evidence set contains `"instance-swap-fill"`, append ` _Slot contract; consumer provides the concrete instance._`
- **Decorative children (`classification === "decorative"`):**
  - Do NOT emit a bullet. Decorative children surface naturally in Structure dimensions and Color tokens. Instead, append a single summary line **after all other bullets**: `- _Decorative children: {N} — documented inline in Structure and Color._` (only when decorative count ≥ 1).
- **Ambiguous children (entries in `_childComposition.ambiguousChildren[]`, classification `null`):**
  - `- **{name}** (classification ambiguous — defaulted to referenced) — review and resolve in a follow-up run.`

**Exact wording for the trailing sentence.** After all bullets, emit one blank line, then:

```
_Classification produced by the uSpec Extract Figma plugin and reviewed at Step 4.5 of create-component-md. Constitutive children are part-of this component; referenced children are used-by it and own their own specs._
```

## Per-section confidence headers

Every section body (API, Structure, Color, Voice) begins with a one-line **confidence header** that tells the engineer up-front which parts of that section are measured, inferred, not-measured, or missing — derived purely from signals already computed for the Known-gaps block. The header is emitted as a single italic paragraph immediately before the section's general notes (or, when no general notes exist, before the first sub-heading).

### Reconciliation tail (appended to every section's confidence header)

After computing the main confidence sentence, every section appends a short **reconciliation tail** summarizing what Step 8.5 did to that specialist's output. Load `{cachePath}/{componentSlug}-reconciliations.json`:

- Let `autoN` = count of entries in `data.autoReconciled[]` whose `specialist` matches this section (`"api"` for the API section applies only when the specialist name appears; otherwise the API section's `autoN` is zero because `extract-api` is the source of truth and cannot be auto-rewritten).
- Let `retryN` = count of entries in `data.retries[]` whose `specialist` matches this section.
- Let `unresolvedN` = count of entries in `data.unresolved[]` whose `specialist` matches this section.

Tail rendering rules (append to the existing confidence line with a single leading space):

- When all three counts are zero, append nothing — keep the header to its unadorned confidence sentence.
- When any count is non-zero, append ` _Reconciliation: {autoN} auto-fixed, {retryN} retried, {unresolvedN} unresolved._` — include every count (even zeros) for grep-ability.
- The reconciliation tail NEVER lowers a section's main confidence classification — it is purely informational. A section with `_Confidence: high._` and `Reconciliation: 2 auto-fixed, 0 retried, 0 unresolved.` is still high-confidence (vocabulary-drift auto-fixes are semantic no-ops).
- When the reconciliations file is absent entirely, omit the tail from every section rather than rendering zeros. This keeps standalone (non-orchestrator) renders clean.

### Main confidence sentence

Compute each section's confidence independently from the same gap sources used by the Known-gaps block:

- **API confidence.** Count `api.data.subComponentTables[]` entries where `_identityResolved === false` (call it `identityGaps`). Count `api.data.properties[]` rows whose `notes` cite a parent-relationship that the rendering `isSubProperty` logic did **not** find in the JSON (this is a defensive check; normally zero). Count any `_extractionArtifacts.stateAxisMapping[]` rows with missing `runtimeCondition` (call it `mappingGaps`). Emit:
  - `_Confidence: high._` when all three counts are zero.
  - `_Confidence: medium — {identityGaps} sub-component(s) unresolved; see Known gaps._` when only `identityGaps > 0`.
  - `_Confidence: medium — state-axis mapping incomplete for {mappingGaps} Figma option(s); see Known gaps._` when only `mappingGaps > 0`.
  - `_Confidence: low — {summary of all failing counts}._` when more than one class of gap applies.
- **Structure confidence.** Count `not-measured` rows in the default-variant size bucket (`defaultNotMeasured`), `not-measured` rows in non-default buckets (`altNotMeasured`), and `inferred` rows across all sections (`inferred`). Also flag whether any `section.columns` only contains the default size when the API advertises more (reuse the prop-coverage-parity result — if a high-severity parity entry exists for any structure-relevant axis, record `parityGaps`). Emit:
  - `_Confidence: high._` when all four counts are zero.
  - `_Confidence: medium — {inferred} inferred row(s); {altNotMeasured} non-default-size row(s) unmeasured._` when `defaultNotMeasured === 0 && parityGaps === 0` but either `inferred > 0` or `altNotMeasured > 0`.
  - `_Confidence: low — {defaultNotMeasured} default-size row(s) unmeasured; {parityGaps} advertised axis value(s) never measured. Treat measured rows as the source of truth; surface gaps from Known gaps before implementing._` when `defaultNotMeasured > 0` or `parityGaps > 0`.
- **Color confidence.** This section has TWO independent signals: a base classification (`high` / `medium` / `low`) and an optional, append-only **container aside**. Container-ness NEVER lowers the base classification — the parent's tokens are flattened from `colorWalk[]` and are authoritative for the parent's painted pixels. The aside only points engineers at optional follow-up work for canonical per-child specs.

  **Base classification.** Let `modeGaps` be the count of entries in `color.data._extractionArtifacts.modeDetection.unresolvedModes || []` (zero when the key is absent). Let `strategyRisk` be `true` when `color.data._extractionArtifacts.strategy === "B"` AND `structure.confidence === "low"` (mode-indexed color on a low-confidence structure skeleton is higher-risk). Emit:
  - `_Confidence: high._` when neither signal applies.
  - `_Confidence: medium — {modeGaps} mode(s) unresolved._` when `modeGaps > 0`.
  - `_Confidence: low — consolidated strategy atop a low-confidence structure; verify token↔state alignment before implementing._` when `strategyRisk`.

  **Container aside (append-only).** When `color.data._containerRerunHint` is non-null, append the following sentence to the confidence line with a single leading space — DO NOT modify the base classification, DO NOT use the words "informational", "provisional", "placeholder", or "pending":

  > _Note: this component embeds constitutive sub-components; the parent's color tokens documented here are authoritative. Per-child canonical specs are an optional follow-up — see Follow-ups._

  A high-confidence container therefore renders as `_Confidence: high._ _Note: this component embeds constitutive sub-components; …_` — the engineer sees the parent is fully measured AND that a deeper recursion is available.
- **Voice confidence.** Let `platformGaps` be the count of state × platform cells in `voice.data.states` where the platform table is missing or explicitly flagged `> Missing from extraction — re-run extract-voice.` Let `antiPatternGaps` be the number of focus stops that failed the anti-pattern `Do NOT` checklist (when `voice.data._extractionArtifacts.antiPatternAudit` is emitted by extract-voice; when absent, treat as zero — the audit is advisory for now). Emit:
  - `_Confidence: high._` when both counts are zero.
  - `_Confidence: medium — {platformGaps} platform section(s) missing from extraction; re-run extract-voice._` when `platformGaps > 0` and `antiPatternGaps === 0`.
  - `_Confidence: low — {platformGaps} platform section(s) missing AND {antiPatternGaps} focus stop(s) missing required Do-NOT row(s)._` when both are non-zero.

Each confidence line is a **scannable summary**, not a second gap table — the authoritative counts live in the `## Known gaps` block. If an engineer needs the full story they follow the pointer (`see Known gaps`). Keep each line to one sentence. Never synthesize a count that is not derivable from JSON the renderer already reads — when the underlying signal is unavailable, default to `_Confidence: high._` and move on.

---

## API body rendering

Read `api.data` (`ApiOverviewData`). Render in this exact order:

0. **Confidence header** — emit the per-section confidence line specified in `## Per-section confidence headers` immediately before the general notes. This is the first line of the API body.
1. **General notes** — if `data.generalNotes` is present, emit it as a blockquote (`> ...`). Otherwise skip this block entirely.
2. **Properties table** — one table with columns `Property | Type | Values | Default | Notes`. Populate from `data.properties`. For variant-type properties, `Values` is a pipe-joined list from `variantOptions`; for booleans, use `true | false`; for instance-swap/slot, use `"(instance)"` or `"(slot)"`; for text, use `"(string)"`.
   - **No tree characters.** Never prefix the `Property` cell with `├`, `└`, or any box-drawing glyph — these are for terminal trees, not engineering specs, and they render ambiguously across Markdown consumers. When `row.isSubProperty === true`:
     1. Keep the `Property` cell as the bare camelCase name (no prefix, no indentation characters).
     2. Document the parent relationship in prose in the `Notes` cell, using the template `"Only meaningful when {parentProperty} = {triggerValue}. {existing notes...}"` — merge with any existing note content rather than replacing it.
     3. Place the row immediately after its parent row in the table, preserving the grouping by source order from `data.properties[]`.
   - The same rule applies inside sub-component tables (section 3). The parent-child relationship is expressed by row order + prose, never by tree glyphs.
3. **Sub-component tables** — one `###` sub-section per entry in `data.subComponentTables`. Each sub-section:
   - Heading: `### {subComponentTable.name}` (e.g., `### Leading content`). When `subComponentTable._identityResolved === false`, append ` [identity unresolved]` to the heading so the engineer sees the gap inline.
   - Optional description paragraph from `subComponentTable.description`.
   - When `_identityResolved === false`, add a second italic paragraph: `_The concrete component backing this role could not be resolved from Phase G's revealed walk. The role is known (boolean toggle / slot name) but the underlying component identity was not captured — see the Known gaps block for details._`
   - Table `Property | Type | Values | Default | Notes` populated the same way.
4. **Configuration examples** — one `###` sub-section per entry in `data.configurationExamples`:
   - Heading: `### {example.name}`.
   - Description paragraph from `example.description`.
   - A fenced code block (`pseudocode` or bare fence) with the `example.code` string.
5. **Referenced components** — one `###` sub-section titled `### Referenced components`, **only emitted** when `_base.json` (top-level) `_childComposition.children[]` contains at least one entry with `classification === "referenced"`. Placed immediately after the Configuration examples block (or after Sub-component tables if no configuration examples exist).
   - One `####` sub-section per referenced child, in the order they appear in `children[]`:
     - Heading: `#### {mainComponentName}` (fallback to `{name}` if `mainComponentName` is null).
     - Lead paragraph, verbatim template:
       ```
       This component embeds an instance of **{mainComponentName}** (node `{subCompSetId}`, spec: `./{slug}.md`). It is configured with:
       ```
       Slug is `mainComponentName` (or `name` when the main component is null) lowercased with non-`[a-z0-9]` runs collapsed to `-`.
     - One Markdown table with columns `Prop passed to {mainComponentName} | Value in this context | Notes`, populated from the child's `booleanOverrides` (map boolean overrides to rows) and any `subCompVariantAxes` pinned in the parent's tree — one row per configured prop. If nothing is configured, emit a single row `| — | defaults | No overrides captured |`.
     - Trailing paragraph, verbatim: `The full property surface of {mainComponentName} is documented in its own spec and is not repeated here.`
   - If the block follows from instance-swap children (evidence contains `"instance-swap-fill"`), prepend a single italic paragraph to the section body: `_Some entries below describe slot contracts: the parent declares the slot's required shape but does not own the concrete instance — each consumer passes a different one._`

Rules:
- Never invent properties. If a row is not in the JSON, it does not belong in the `.md`.
- Preserve the exact property keys and default values — do not normalize capitalization or punctuation.
- If `data.subComponentTables` is empty, skip section 3 entirely (do not emit a heading with no table).
- If `data.configurationExamples` is empty, skip section 4 entirely.
- If no referenced children exist in `_childComposition`, skip section 5 entirely. Never copy a referenced child's property table into section 2 (the Properties table) — the referenced child's own spec is the source of truth for its properties.

## Structure body rendering

Read `structure.data` (`StructureSpecData`). Render in this exact order:

0. **Confidence header** — emit the per-section confidence line specified in `## Per-section confidence headers` immediately before the general notes.
1. **General notes** — if `data.generalNotes` is present, emit it as a blockquote. Otherwise skip.
2. **Typography subsection (when present)** — if `structure.data._extractionArtifacts.typographyTable` is a non-empty array, emit a single `### Typography` subsection immediately after the general notes and before any dimensional section. Structure:
   - Heading: `### Typography`.
   - Optional lead line: `_Per-element typography for every text element in the component. Per-section typography rows below remain authoritative when they differ — this table is the consolidated index._`
   - One Markdown table with header `Element | Family | Weight | Size | Line height | Letter spacing | Style | Notes`. One row per entry in `typographyTable[]`:
     - `Element` = `entry.element`.
     - `Family`, `Weight`, `Size`, `Line height`, `Letter spacing` come from the matching fields; render `lineHeight === "auto"` as `auto`.
     - `Style` column prefers `entry.styleName`; when `styleName` is null and `styleId` is null, render `inline`. When `styleName` is null but `styleId` is set, render `inline (unresolved style)`.
     - `Notes` = `entry.notes || "—"`.
3. **State deltas subsection (when present)** — if `structure.data._extractionArtifacts.visualOnlyAxisDeltas` is a non-empty array, emit one `###` subsection per entry immediately after the Typography subsection (or after the general notes when no typography table exists) and before any dimensional section. For each `visualOnlyAxisDeltas[]` entry:
   - Heading: `### State deltas` when `entry.axis === "state"`; otherwise `### {axis} deltas`. If more than one entry exists, disambiguate by appending the axis name (e.g., `### State deltas`, `### Size deltas`).
   - Lead line: `_Non-dimensional properties that change across the {axis} axis. Dimensional values are documented in the sections below._`
   - Resolve column headers with the following precedence (same rule as Color Strategy B):
     1. If `api.data._extractionArtifacts.stateAxisMapping[]` exists and every value in `entry.columns` has a matching `figmaValue`, replace each header with the corresponding `runtimeCondition`.
     2. Otherwise, use `entry.columns` verbatim.
   - One Markdown table with header `Element | {col1} | {col2} | … | Notes`. One row per entry in `entry.rows[]`:
     - `Element` = `row.element`.
     - Each middle column shows `row.values[i]`; render `row.property === "visibility"` values verbatim (`visible` / `hidden`), numeric values plain, strings plain.
     - `Notes` = `row.notes || "—"`.
4. **One `###` sub-section per section** in `data.sections`, preserving order:
   - Heading: `### {section.sectionName}`.
   - Optional description paragraph from `section.sectionDescription`.
   - A Markdown table whose header is `section.columns`. Populate from `section.rows`.
     - The `spec` field is the first column.
     - Each entry in `row.values[]` fills the columns between "Spec"/"Composition" and "Notes".
     - `row.notes` fills the last column.
     - For `row.isSubProperty === true`, prefix the `spec` cell with `└ ` (last in group) or `├ ` (middle of group) using `isLastInGroup` to choose.
     - **Provenance badges.** Prefix the `spec` cell (after any hierarchy arrow) based on `row.provenance`:
       - `"measured"` → no prefix (default, uncluttered).
       - `"inferred"` → `[inferred via <token>] ` prefix. The token name is drawn from the `notes` field; if notes don't cite a token explicitly, use `[inferred]`.
       - `"not-measured"` → `[unmeasured] ` prefix. Every cell in `values[]` for that row must already be `"—"` from the extract-structure hard gate — the renderer does not coerce values, it only badges the row.
5. **Dimensional cell formatting** — cells already arrive pre-formatted via the `display` field from extraction (e.g., `"spacing-100 (16)"`). Do not reformat.

Rules:
- Never collapse or merge sections. If the section plan produced two `subComponent` sections for the same visual component under different structural configurations, keep both.
- Markdown tables must have header separators (`---`) and column counts matching the header row. Do not rely on alignment tricks.
- When a cell value contains a `|`, escape it as `\|` so the Markdown table stays well-formed.

## Color body rendering

Read `color.data`. Detect strategy by `data._extractionArtifacts.strategy`:

### Hex resolution (formatter rules — applies to both strategies)

The `extract-color` skill writes per-element hex values as envelope extensions on each `tables[]`:
- **Strategy A:** `tables[].elementHexes[]` — lockstep with `elements[]`. Each entry: `{ "hex": "#RRGGBB" | null }`.
- **Strategy B:** `tables[].elementHexesByState[]` — lockstep with `elements[]`. Each entry: `{ "hexByState": { "<originalFigmaState>": "#RRGGBB" | null } }` keyed identically to `elements[i].tokensByState`.

For every token cell (Strategy A `Token` column, Strategy B per-state column), apply this formatter using the resolved `token` value (a string, `null`, or `"none"`) and the matching `hex` value (a string or `null`):

| Token | Hex | Cell renders as |
|-------|-----|-----------------|
| Resolved name (e.g., `contentPrimary`) | `#RRGGBB` | `contentPrimary (#RRGGBB)` |
| Resolved name | `null` or extension absent | `contentPrimary` (back-compat) |
| `null` or `"none"` | `#RRGGBB` | `#RRGGBB` (hard-coded color, no token binding) |
| `null` or `"none"` | `null` or extension absent | `none` |

**Graceful degrade.** If `elementHexes` / `elementHexesByState` is absent from a cache (older extraction), fall back to today's behavior: emit just the token name (or `none`). Never abort rendering on missing extensions.

### Strategy A (`ColorAnnotationData`)

0. **Confidence header** — emit the per-section confidence line specified in `## Per-section confidence headers` immediately before the general notes. This is the first line of the Color body, regardless of strategy.
1. **General notes** — blockquote if present.
2. **One `###` sub-section per variant** in `data.variants`:
   - Heading: `### {variant.variantName}`.
   - One Markdown table per entry in `variant.tables`:
     - If the variant has multiple tables, prefix each table with a `####` heading = `table.name`.
     - Columns: `Element | Token | Notes`.
     - Rows: `element.element | <formatter(element.token, table.elementHexes[i]?.hex)> | element.notes`. Apply the **Hex resolution** formatter above using the matching `elementHexes[i].hex`.
     - For elements with `compositeChildren`, emit child rows immediately after the parent row. Prefix the child's `element` cell with `└ ` (last child) or `├ ` (middle). Child `Token` column uses `child.value` verbatim — composite children are not subject to the hex formatter (their `value` already encodes either a token or an `rgba()` / gradient string).

### Strategy B (`ConsolidatedColorAnnotationData`)

0. **Confidence header** — emitted once at the top of the Color body (see Strategy A step 0); do not re-emit per strategy.
1. **General notes** — blockquote if present.
2. **One `###` sub-section per `sections[]` entry**:
   - Heading: `### {section.sectionName}`.
   - One Markdown table per entry in `section.tables`:
     - Prefix with `####` heading if multiple tables per section.
     - Columns: `Element | {state1} | {state2} | … | Notes`. Resolve state column headers with the following precedence:
       1. **Runtime-condition relabeling (preferred).** Load `api.data._extractionArtifacts.stateAxisMapping[]`. If every Figma state column in `data.stateValues` (or the section's `stateColumns`) has a matching `figmaValue` in `stateAxisMapping[]`, replace each column header with the corresponding `runtimeCondition` in the same order. This surfaces the engineer-facing runtime condition (e.g., `focused`, `has value && not focused`, `validationState='error'`) instead of the raw Figma axis option.
       2. **Fallback.** When `stateAxisMapping[]` is absent, empty, or does not cover every state column (e.g., the Color section groups by a different axis than the decomposed one), use `data.stateValues` (or the section's `stateColumns`) verbatim. Do not fabricate a mapping.
     - Rows: `element.element | <formatter(tokens[state1], elementHexesByState[i]?.hexByState[state1])> | … | element.notes`. The row's token cells are always indexed by the **original Figma state values**; only the column headers get relabeled. Apply the **Hex resolution** formatter above per cell using the matching `elementHexesByState[i].hexByState[stateValue]`.
     - `compositeChildren` rows repeat the child `value` across every state column verbatim — no hex formatter applied (same rule as Strategy A).

Rules:
- Never drop tokens that resolved to `null` — when a hex is available, render the cell as the bare hex (`#RRGGBB`) so engineers can see the hard-coded color inline; when no hex is available either, render `none`. Engineers need to know when a binding is missing, and the inline hex makes the actual color visible without round-tripping to `_base.json`.
- Preserve `subComponentName` by weaving it into the element cell or notes (e.g., `"Button container fill (Button)"`) — matches what the `create-color` skill would print in Figma.
- Column-header relabeling via `stateAxisMapping[]` is the single mechanism the renderer uses to expose decomposed runtime conditions in the Color table. Do not invent column groupings, do not reorder columns, and do not merge columns whose tokens happen to match — the mapping is 1:1 with the Figma axis options.

## Voice body rendering

Read `voice.data` (`VoiceSpecData`). Render in this exact order:

0. **Confidence header** — emit the per-section confidence line specified in `## Per-section confidence headers` immediately before the guidelines blockquote.
1. **Guidelines** — emit `data.guidelines` as a blockquote.
2. **Focus order** — if `data.focusOrder` is present and has at least 2 tables:
   - `### Focus order`.
   - Optional description paragraph.
   - A single Markdown table with columns `#  | Part | Announcement | Role | Properties | Notes`. Populate from `data.focusOrder.tables`:
     - `#` = `focusOrderIndex`.
     - `Part` = `table.name`.
     - `Announcement` = `table.announcement` rendered in quotes.
     - `Role`, `Properties`, `Notes` columns are synthesized by joining the most common `property` rows from `table.properties[]`:
       - `Role` = the row where `property === "Role"` (or `"role"`). If absent, emit `"—"`.
       - `Properties` = a semicolon-joined list of other `properties[]` rows excluding "Role" and "Notes", rendered as `{property}: {value}`.
       - `Notes` = the row where `property === "Notes"`, or the first notes-like property row. If none, emit the table-level `notes` if available, otherwise `"—"`.
     - Note: per-platform property detail is **not** flattened here — the per-platform tables below are the authoritative source for platform-specific values.
3. **Per-state platform tables** — one `###` sub-section per entry in `data.states`:
   - Heading: `### State: {state.state}` (e.g., `### State: enabled`).
   - Optional description paragraph.
   - Inside, one `####` sub-section per entry in `state.sections` — heading is the section title (e.g., `#### VoiceOver (iOS)`).
   - Inside each platform sub-section, one Markdown table per focus stop entry (`section.tables[]`):
     - Prefix each table with `##### {table.name}` if the state has more than one focus stop.
     - Columns: `Property | Value | Notes`. Always include the row `Announcement | {table.announcement} | `.
     - Then rows from `table.properties[]`.
4. **Slot insertions** — if `data.focusOrder.slotInsertions` is non-empty, or any `state.slotInsertions` is non-empty, append a `### Slot insertions` block listing each insertion in prose:
   - `- In focus order preview: slot **{slotName}** populated with **{componentNodeId}**. Overrides: {nestedOverrides or '—'}`.

Rules:
- Always emit exactly three platform sub-sections per state (`VoiceOver (iOS)`, `TalkBack (Android)`, `ARIA (Web)`), in that order. If a state's platform section is missing in the JSON, emit the heading with an explicit `> Missing from extraction — re-run extract-voice.` blockquote so the engineer spots the gap.
- Behavioral states (not backed by a Figma variant) are rendered identically to Figma-variant states. The only difference is `state.variantProps` will match the default variant props.

## Known gaps

The `{{KNOWN_GAPS}}` block is the first substantive block after the Overview — it tells an engineer up front which parts of the spec are measured, inferred, or missing, and whether any extraction-time anomalies need attention before implementation.

**Block structure.** Starting with the API-first pipeline, the Known-gaps placeholder emits **two sub-blocks in fixed order** — `### Unresolved` first (what the engineer must act on), then `### Auto-reconciled` (what Step 8.5 already fixed, surfaced only for auditability). When there is nothing to report in either sub-block, emit the single line `_No gaps detected._` as the entire `{{KNOWN_GAPS}}` value (no headings, no empty sections). When only one of the two sub-blocks has content, still emit both headings — the empty one gets the single line `_None._` as its body, so the split is never ambiguous for the reader.

### Unresolved

This sub-block lists every gap the renderer could not auto-fix — it is the primary action list for the engineer. Aggregate the following sources:

1. **Extraction warnings** — read `base.data._extractionNotes.warnings` from `_base.json` (loaded separately by the renderer; path is `{cachePath}/{componentSlug}-_base.json`). Every entry is an anomaly the extraction layer couldn't silently resolve.
2. **Not-measured rows per structure section** — for each section in `structure.data.sections`, count rows where `row.provenance === "not-measured"`. Also split by `rootDimensions` default-size bucket vs. non-default sizes (the default variant is given in `base.data.defaultVariant.variantProperties`).
3. **Inferred rows per structure section** — same shape, rows where `row.provenance === "inferred"`.
4. **Identity-unresolved sub-components** — count entries in `api.data` where `_identityResolved === false`.
5. **Delta-extraction audit** — union of `_deltaExtractions[]` across the four cache files.
6. _(reserved — the former `_containerRerunHint` source moved to the Follow-ups block; container-ness is not a gap)._
7. **Self-check failures** — any `_selfCheck.missingChildren` entries recorded in `_base.json.variants[*]`.
8. **Composition gaps** — from `_base.json` top-level `_childComposition`:
   - **Referenced without spec (medium).** Any `referenced` child whose `./{slug}.md` cannot be located on disk. Severity: **Medium**. Action: `run create-component-md on {slug} (or document where its spec lives)`.
   - **Ambiguous children (medium).** Every entry still in `_childComposition.ambiguousChildren[]`. Severity: **Medium**. Action: `resolve classification for "{name}"; currently treated as referenced by default.`
   - **Note.** A pure container (every top-level child is a constitutive component-set, sibling specs missing) is NOT a defect — it is an expected shape and goes into the Follow-ups block, not Known gaps. The parent's API/Structure/Color/Voice surfaces are still measured and authoritative for the parent.
9. **Prop-coverage parity** — walk every enumerated property in `api.data.properties[]` (one with a comma-separated `values` list that is not `"true, false"`, `"string"`, `"number"`, or `"(instance)" / "(slot)"`). For each, compute:
   - `advertised` = the set of values listed in the API row (trim, lower-case).
   - `measured` = the set of values covered by Structure. Collection rules:
     1. For every section in `structure.data.sections`, read `section.columns` (skipping the first column, which is always `Spec` / `Composition`, and the last column, which is always `Notes`). Any column name that matches (case-insensitive) a value in `advertised` counts as measured.
     2. For sections whose rows include a `columns` entry under `row.values[]` (multi-column axis cells, e.g., size-grouped data), treat the column names from `section.columns` the same way.
     3. If a `visualOnlyAxisDeltas[]` entry's axis matches the property name, its `columns[]` are measured values.
   - If `measured ⊂ advertised` (strict subset), emit one **high**-severity gap entry per property:
     > **high**: `Axis "{name}" advertises [{all advertised values}] in API but Structure measured only [{measured values}]. Either narrow the API to the measured subset, or re-extract to measure [{unmeasured values}].`
   - If `measured` is empty and the property has >1 advertised value, emit the same entry with `Structure measured only []`.
   - Skip the check for properties whose `values === "true, false"` (booleans — structural coverage of every boolean state is not expected) and for enums with a single advertised value (there is no coverage to miss).

   This source surfaces the `size: large | medium | small` advertised-but-only-medium-measured pattern automatically. Do not dedupe with source 2 (not-measured row count) — that source reports row-level gaps within a single size column; this one reports axis-level coverage gaps.

**Severity mapping:**

| Condition | Severity |
|---|---|
| Extraction `warnings` with `code: "HIERWALK_MISSING_CHILDREN"` | `high` |
| Extraction `warnings` with `code: "SAMPLING_DEVIATION"` | `high` |
| Any `_selfCheck.missingChildren` entry | `high` |
| Not-measured row in the default size bucket of any section | `high` |
| Not-measured row in a non-default size bucket | `medium` |
| `_identityResolved === false` | `medium` |
| Inferred row in any section | `low` |
| `_deltaExtractions[]` entry | `low` (informational) |
| Composition: referenced without sibling spec | `medium` |
| Composition: ambiguous child (defaulted to referenced) | `medium` |
| Prop-coverage parity: axis advertised but not measured across all values | `high` |
| Specialist `_dictionaryUnavailable === true` | `medium` |
| Reconciliation unresolved (source 11, `data.unresolved[]`) | `high` |
| Any other warning | `medium` |

10. **Specialist-dictionary availability** — for each of `structure.data`, `color.data`, `voice.data`, check `_dictionaryUnavailable`. When `true` on any specialist, add one `medium`-severity entry per specialist: `{specialist} ran without api-dictionary.json; vocabulary is unchecked`. This happens only when a specialist was invoked standalone or when Step 5 failed to produce the dictionary for a follow-up pass — either way, the engineer should know.
11. **Unresolved reconciliation entries** — load `{cachePath}/{componentSlug}-reconciliations.json` and add every entry in `data.unresolved[]` to the severity buckets. All unresolved entries are **high** severity by construction (Step 8.5 only files an entry as unresolved when the class is `semantic-conflict`, or when a bounded retry for a `coverage-gap` failed). Summary template: `reconciliation ({class}): {specialist} · {detail}` — e.g., `reconciliation (semantic-conflict): color · element "label" fill references trailing-icon but structure.subComponents excludes it`. The detail string is copied verbatim from `entry.detail`; no paraphrasing.

**Rendering (Unresolved sub-block):**

Emit the heading `### Unresolved`, then one line per severity bucket that has at least one item, ordered `high → medium → low`:

```
- **High** — <N items>. <comma-joined compact summaries>.
- **Medium** — <N items>. <comma-joined compact summaries>.
- **Low** — <N items>. <comma-joined compact summaries>.
```

Compact summaries should be scannable, e.g. `3 not-measured rows in "Input" (default size)`, `HIERWALK_MISSING_CHILDREN: variant "size=Large"`, `identity unresolved: "trailing icon"`. Truncate the summary list after 6 items per severity with `… and <N> more`. When all three buckets are empty inside this sub-block, emit `_None._` as the sub-block body (the sub-block heading still appears when the Auto-reconciled sub-block has content; otherwise the whole `{{KNOWN_GAPS}}` value collapses to `_No gaps detected._` per the block structure rules).

**Action items.** Container hints are NOT rendered here — they go in the Follow-ups block (see `## Follow-ups` below). The Unresolved sub-block is reserved for actual defects the engineer must address before implementing.

### Auto-reconciled

This sub-block surfaces every fix Step 8.5 applied deterministically, so the engineer can audit the rewrite trail without digging into the cache JSONs. Load `{cachePath}/{componentSlug}-reconciliations.json` and read `data.autoReconciled[]` + `data.retries[]`.

**Rendering (Auto-reconciled sub-block):**

Emit the heading `### Auto-reconciled`, then:

1. **Vocabulary drift roll-up.** Group `autoReconciled[]` entries whose `class === "vocabulary-drift"` by `specialist`. Emit one line per non-empty group:
   ```
   - **{specialist}** — {N} vocabulary drift auto-rewritten: <comma-joined "{before} → {after}" pairs>.
   ```
   Cap at 6 pairs per line with `… and <N> more`. The goal is one scannable line per specialist, not a full audit log — the JSON remains authoritative.
2. **Retry roll-up.** Group `retries[]` entries by `specialist`. Emit one line per non-empty group:
   ```
   - **{specialist}** — {N} retry: missing {comma-joined missingItems[]}; outcome: {outcome} ({N_before_gaps}→{N_after_gaps} gaps).
   ```
   The outcome string is copied verbatim from `entry.outcome` (e.g., `"resolved"`, `"partial"`, `"unresolved"`). Before/after gap counts are read directly from the retry entry (`entry.gapCountBefore`, `entry.gapCountAfter`); when those fields are absent, render the line without the parenthetical.
3. **Disclaimer footer.** When either roll-up emitted at least one line, append one italic line at the end of the sub-block:
   ```
   _Auto-reconciliations are safe renames or bounded retries, not semantic changes. See `./{componentSlug}-reconciliations.json` for the full action log._
   ```
4. When both roll-ups are empty, emit `_None._` as the sub-block body.

### Failure modes

- The reconciliations file is missing → treat `autoReconciled = retries = unresolved = []`. The Unresolved sub-block still renders the other 9 sources; the Auto-reconciled sub-block renders `_None._` (and the footer is skipped).
- The reconciliations file is present but malformed → the Step 9.5 integrity check aborts the orchestrator before the renderer runs. The renderer never has to handle a malformed reconciliations file at render time.
- An `unresolved[]` entry references a specialist that is not `"structure" | "color" | "voice"` → render the summary line anyway, substituting the unknown specialist name verbatim. A strange specialist name is itself a signal the engineer needs to see.

## Follow-ups

The `{{FOLLOWUPS}}` block lists **optional, additive next steps** the user may run after this `.md` is produced. It is structurally separate from `## Known gaps` because nothing here is a defect — every item describes work that would deepen documentation coverage but is not required for the current `.md` to be implementable.

**Sources:**

1. **Container — per-child canonical specs.** When `color.data._containerRerunHint` is non-null, emit one bullet:

   ```
   - **Per-child canonical specs (optional).** This component embeds constitutive sub-components: `<comma-joined subCompSetNames>`. The parent's color/structure/API surfaces above are authoritative for the parent. Run `create-component-md` on each child node to also produce its own canonical spec at `./{child-slug}.md`. _(source: color._containerRerunHint)_
   ```

2. **Recursion manifest entries.** When the orchestrator's Step 10.5 recursion manifest lists any constitutive children with non-null `subCompSetId`, surface them here as a single bullet:

   ```
   - **Constitutive children:** `<comma-joined child slugs with node ids>`. See the Step 10.5 recursion manifest in the orchestrator's terminal output for copy-pasteable commands.
   ```

3. **Other extension hooks.** Reserved — additional sources may be added without expanding `Known gaps`.

**Rendering rules:**

- Emit each non-empty bullet in the order above.
- When no source fires, emit the single line `_None._` as the entire block body.
- DO NOT label any item as a gap, defect, or required action. Use neutral, additive language ("optional", "deepen coverage", "if you also want…").
- DO NOT downgrade any per-section confidence header on the strength of a Follow-ups item. Confidence is a property of what was measured for THIS spec; Follow-ups describes work outside it.

## Cross-section invariants

After rendering all four sections, compute a short bulleted list of invariants that hold across sections. Use the `_extractionArtifacts` blocks as the primary source:

1. **Variant axes alignment.** Take `structure._extractionArtifacts.variantAxes`, `color._extractionArtifacts.variantAxes`, and `voice._extractionArtifacts.variantAxes`. If they are not equal as sets, add a bullet: `- ⚠ Variant axes disagree between sections: structure=[…], color=[…], voice=[…]. Fix the extract-* skills before shipping this spec.` Otherwise, list them: `- Variant axes: {axes}`.
2. **Boolean properties alignment.** Same check against `structure._extractionArtifacts.booleanDefs` keys vs `color.propertyDefs` boolean keys vs `voice._extractionArtifacts.booleanDefs` keys.
3. **Sub-component alignment.** If `structure._extractionArtifacts.subComponentsSummary[].name` ∩ `color._extractionArtifacts.subComponentsReferenced` is non-empty, list the shared sub-components: `- Shared sub-components across structure and color: {names}`.
4. **Mode-controlled color check.** If `color._extractionArtifacts.modeDetection.hasModeCollection` is true, add a bullet: `- Color is mode-controlled by "{collectionName}" with modes: {modes.join(', ')}`. This tells the engineer they must wire theme/mode switching.

Keep this block to ≤ 6 bullets. Prefer silence over noise.

## Cross-references

The `{{CROSS_REFERENCES}}` block is a deduplicated map between sections so engineers can trace a single property across all four specs. Compute as follows:

1. **Property-axis cross-refs.** For each variant axis in the union from **Cross-section invariants**, emit one bullet: `- Axis **{axis}** — API: see Properties table · Structure: see sections grouped by {axis} · Color: see variants grouped by {axis} · Voice: see states grouped by {axis}`. Only include the sections that actually grouped by that axis.
2. **Token-to-element cross-refs.** For each unique token in `color._extractionArtifacts.uniqueTokens`, if the same element name appears in `structure.data.sections[*].rows[*].spec`, emit a bullet: `- Token \`{token}\` is applied to element **{element}** — see Structure section "{section}" and Color section "{section}".`. Cap at 10 bullets; if more than 10 matches exist, emit `… and {N} more` on the last line.
3. **Focus stop ↔ structure cross-refs.** For each focus stop in `voice._extractionArtifacts.elementsSummary` whose `name` matches a Structure row `spec`, emit a bullet: `- Focus stop **{name}** is documented in Structure section "{section}".`
4. **State-lockstep cross-refs.** For each candidate state (see below), compute the union of changes in API, Structure, Color, and Voice. If changes appear in **≥2 of the four**, emit one lockstep bullet. Cap at **4 bullets total**; if more than 4 states qualify, pick the 4 with the widest cross-section impact (tie-breaker: sum of |API|+|Structure|+|Color|+|Voice| token-level differences). Strict template:

   ```
   - **{state} lockstep**: {API: prop/default impact or "—"} + {Structure: delta row summary or "—"} + {Color: differing tokens or "—"} + {Voice: differing aria/role/properties or "—"}. _Implement together or the component ships half-broken._
   ```

   **Candidate states:** take the union of
   - `api.data._extractionArtifacts.stateAxisMapping[].runtimeCondition` when present (preferred — engineer-facing conditions);
   - otherwise, the Figma state-axis values from `structure.data._extractionArtifacts.variantAxes.state` (or whichever axis is classified as stateful).

   **Sources of change per state:**
   - **API impact:** any `api.data.properties[]` row whose `notes` or `default` references the state (case-insensitive substring match on the state name, its `figmaValue`, or any alias in `stateAxisMapping`). Summarize as `{propName}={value}` or `default→{value}`. If multiple, join with `, `. Use `"—"` when none match.
   - **Structure impact:** any row in `structure.data._extractionArtifacts.visualOnlyAxisDeltas[]` whose column for this state differs from the baseline column (the column matching the default variant's state value). Summarize as `{element}: {baseline}→{state}`. Cap at 3 items per bullet; if more, append ` + N more`. Use `"—"` when none differ.
   - **Color impact:** any element in the Color Strategy B section(s) whose `tokens[state]` differs from `tokens[baseline]`. Summarize as `{element}: {baseline_token}→{state_token}`. Cap at 3 items. Use `"—"` when none differ.
   - **Voice impact:** the `voice.data.states[]` entry for this state. Compute per-platform diff against the baseline state: list `role` or `properties` values that differ. Summarize as `{platform}: {propName}={value}`. Cap at 3 items. Use `"—"` when the entry is absent or identical to baseline.

   **Rules:**
   - Never paraphrase or editorialize the source data — computed bullets must only reference values that actually appear in the four caches. The template is fixed; only the four slot contents and the state name vary.
   - Skip the bullet when only 1 of the 4 slots is non-`"—"` — a single-section change does not qualify as a lockstep.
   - When `stateAxisMapping[].runtimeCondition` is available, use it as the `{state}` name in the bullet header; otherwise use the raw Figma value.
   - Append the lockstep bullets after the three preceding cross-ref categories. Never interleave.

If none of the above produce bullets, emit `No cross-references detected between sections.` as the only line.

## Audit (before writing the `.md`)

Before the orchestrator writes the final file, verify:

- [ ] Every placeholder in the template has been substituted (search for `{{` remaining).
- [ ] Every Markdown table is well-formed (same column count in header, separator, and every row).
- [ ] Every `###` heading has a body — no dangling empty sub-sections.
- [ ] Strategy A / Strategy B for color matches `color._extractionArtifacts.strategy`.
- [ ] The voice block has exactly 3 platform sub-sections per state.
- [ ] Cross-section invariants block is ≤ 6 bullets.
- [ ] Cross-references block either has bullets or explicitly says "No cross-references detected between sections."
- [ ] Known gaps block is present and aggregates provenance + `_extractionNotes.warnings` + `_deltaExtractions` + `_identityResolved=false` + `_selfCheck.missingChildren` + reconciliations (`data.unresolved[]`). It does NOT contain any container-hint–derived entries — those live in the Follow-ups block.
- [ ] Follow-ups block (`{{FOLLOWUPS}}`) is present. When `_containerRerunHint` is non-null, the block contains the per-child canonical-specs bullet (and the recursion-manifest pointer when applicable). When neither source fires, the block contains the literal `_None._`.
- [ ] No Color confidence header reads `_Confidence: medium — container component;…_`. Container-ness only appears as the append-only neutral aside on the confidence line, never as the base classification.
- [ ] When reconciliations.json exists with content, the Known gaps block has both `### Unresolved` and `### Auto-reconciled` sub-blocks (not a flat list). When it exists but every array is empty, and no other gap sources fire, the entire block collapses to `_No gaps detected._`.
- [ ] Every section confidence header that appends a reconciliation tail uses the exact template `_Reconciliation: {autoN} auto-fixed, {retryN} retried, {unresolvedN} unresolved._` — counts are integers (never omitted, never rendered as "none").
- [ ] Every structure row with `provenance="not-measured"` renders with the `[unmeasured]` badge and `"—"` in every value column.
- [ ] Every structure row with `provenance="inferred"` renders with the `[inferred via <token>]` badge.
- [ ] The Provenance block reflects the actual `cachePath`, `nodeId`, and `fileKey`.
- [ ] `{{COMPOSITION_SUBSECTION}}` is populated from `_base.json` top-level `_childComposition`. When non-empty, it contains a `### Composition` heading plus one bullet per non-decorative child. When all children are decorative or `_childComposition.children[]` is empty, the placeholder is replaced with an empty string (no dangling heading).
- [ ] When `_base.json` top-level `_childComposition.children[]` contains any `classification === "referenced"` entry, the API body has a `### Referenced components` sub-section. Every referenced child's property table is **omitted** — only `booleanOverrides` / `subCompVariantAxes` passed by the parent are listed.
- [ ] The Known gaps block aggregates the three Composition gap conditions (container / referenced-without-spec / ambiguous) and emits each with the specified wording and action line.
- [ ] Every Color table cell with a resolved token AND an available hex renders in `tokenName (#RRGGBB)` form — neither the token nor the hex appears alone when both are present.
- [ ] Every Color table cell where the token resolved to `null` / `"none"` AND a hex is available renders as the bare hex (`#RRGGBB`) in the cell — not as `none (hard-coded)`, not as `none` with the hex hidden in notes.
- [ ] Every Color table cell where neither a token nor a hex is available renders as `none`. When `elementHexes` / `elementHexesByState` is absent from the cache entirely, the table degrades cleanly to bare token names (or `none`) with no formatting errors.

If any check fails, fix the rendering code — do **not** patch the produced `.md` by hand.

## Writing the file

Write the final `.md` to `{outputPath}` using UTF-8. Do not include a trailing newline beyond one. Do not rewrite the four JSON cache files from this phase.

Return a single-line summary to the user:

```
Component Markdown written: sections={api,structure,color,voice}, bytes=<B> → <outputPath>
```
