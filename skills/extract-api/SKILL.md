---
name: extract-api
description: Interpret a component's API (properties, sub-components, configuration examples) from the `_base.json` produced by the uSpec Extract Figma plugin, and write the normalized JSON to disk. Read-only interpretation — no Figma calls except an optional tiny delta script. Use as a sub-skill of create-component-md.
---

# Extract API Data

Interpretation-only companion to `create-api`. This skill **does not extract data from Figma**. It reads `{cachePath}/{componentSlug}-_base.json` (produced by the uSpec Extract Figma plugin), applies the same reasoning layer as `create-api`, and writes the normalized `ApiOverviewData` JSON to disk for the `create-component-md` orchestrator to consume.

**Quality contract:** every reasoning step (context gathering from `_base.json`, override promotion pass, audit) mirrors `create-api/SKILL.md`. Any improvement to API-extraction quality must be made in both places.

**Batch-mode contract.** This skill MUST NOT call `AskQuestion`, prompt for confirmation, or pause for user input. On ambiguous evidence, emit the best-effort structured output (with `_deltaExtractions[]` logged if a delta fired). On missing evidence that cannot be resolved, abort with a single-line diagnostic pointing at the missing `_base.json` field. No mid-interpretation clarifications.

## Invocation Contract

The orchestrator calls this skill with these inputs (already resolved — do NOT re-parse URLs or re-read `uspecs.config.json`):

- `componentSlug` — filename-safe slug
- `cachePath` — cache directory, typically `.uspec-cache/{componentSlug}/`
- `optionalContext` — free-form string from the user (may be `"none"`)
- `mcpProvider` — `figma-console` or `figma-mcp` (only needed if a Step 3-delta escape hatch fires AND a live Figma link was provided to the orchestrator)
- `deltaAvailable` — boolean. When the orchestrator received **only** a `baseJsonPath` (no `figmaLink`), this is `false` and the Step 3-delta escape hatch must not fire; log the gap in `data._deltaExtractions[]` with `unavailable: "no-figma-link"` and continue with best-effort output.

`fileKey` and `nodeId` are **not** pass-through parameters. Read them from `{cachePath}/{componentSlug}-_base.json._meta.fileKey` and `_meta.nodeId` at the start of Step 1 — `_base.json` is the single source of truth for them.

**Output:**

- Writes `{cachePath}/{componentSlug}-api.json` containing the full `ApiOverviewData` object.
- Writes `{cachePath}/{componentSlug}-api-dictionary.json` — a canonical vocabulary projected from the api.json, consumed by the downstream `extract-structure`, `extract-color`, and `extract-voice` specialists. See Step 7.5 and the **ApiDictionary artifact** section in [api/agent-api-instruction.md]({{ref:api/agent-api-instruction.md}}).
- Returns a single-line summary to the orchestrator: `"API extracted: N properties, M sub-components, K examples → {path} (+ dictionary at {dictionaryPath})"`.
- Never creates or mutates Figma nodes (not even during the delta escape hatch — delta is read-only).

## MCP Adapter

This skill typically makes **zero** MCP calls — it reads `_base.json` from disk. The adapter table below applies only to the optional Step 3-delta escape hatch.

| Operation | `figma-console` | `figma-mcp` |
|-----------|-----------------|-------------|
| Execute Plugin JS (delta only) | `figma_execute` with `code` | `use_figma` with `fileKey`, `code`, `description` |

For `figma-mcp` delta scripts, always include the page-focus preamble immediately after `getNodeByIdAsync`:

```javascript
let _p = node; while (_p.parent && _p.parent.type !== 'DOCUMENT') _p = _p.parent;
if (_p.type === 'PAGE') await figma.setCurrentPageAsync(_p);
```

## Workflow

```
Task Progress:
- [ ] Step 1: Read instruction file
- [ ] Step 2: Load _base.json and optionalContext
- [ ] Step 3: Build working evidence set (from _base.json fields only)
- [ ] Step 3-delta: OPTIONAL — read-only Figma call if a fact is genuinely missing
- [ ] Step 4: Identify properties and sub-components (Override Promotion Pass)
- [ ] Step 5: Generate ApiOverviewData object
- [ ] Step 6: Audit (re-read instruction file)
- [ ] Step 7: Write JSON to cache
- [ ] Step 7.5: Project `ApiDictionary` from the finalized data and write `{slug}-api-dictionary.json`
- [ ] Step 8: Return one-line summary
```

### Step 1: Read Instructions

Read [api/agent-api-instruction.md]({{ref:api/agent-api-instruction.md}}). This is the **same** instruction file used by `create-api` — it defines the `ApiOverviewData` schema, property classification rules, naming conventions, and audit checklists.

#### Rendering-only sections to skip

The shared instruction file describes both extraction and Figma rendering. This skill only performs interpretation — ignore guidance in the sections below. The data schema and audit checklists still apply.

- **Any phrase like "passed directly into Figma template placeholders — no JSON output is needed"** — inverted for this skill: we **do** output JSON to disk. Keep the schema; discard the "no JSON" framing.
- **§Configuration Examples — prose about how `nestedOverrides`, `textOverrides`, and `slotInsertions` are applied via `setProperties()` or inserted into SLOT nodes** — describes the rendering path. The fields themselves are part of `ApiOverviewData` and must still be populated.
- **§Common Mistakes — bullets describing rendering-path failures** (e.g., "preview will show an empty slot", "SKILL.md script handles the replacement automatically") — cautions for the rendering skill, not interpretation. Data-level mistakes in the same section still apply.

Note: Fields that look like rendering config but are part of the output schema (e.g., `slotInsertions`, `textOverrides`, `nestedOverrides`, `variantProperties`) must still be populated.

### Step 2: Load `_base.json`

Read `{cachePath}/{componentSlug}-_base.json` with the `Read` tool. If the file is missing, or if any of the sections listed in Step 3 below are `null` / missing, abort with a clear diagnostic asking the user to re-run the uSpec Extract plugin.

The file schema is defined in [figma-plugin/docs/base-json-schema.md]({{repo:figma-plugin/docs/base-json-schema.md}}). Familiarize yourself with the top-level keys:

- `component` — component name + is-set flag
- `variantAxes` — `[{ name, options, defaultValue }]`
- `defaultVariant` — `{ id, name, variantProperties }`
- `propertyDefinitions.rawDefs` / `booleans` / `instanceSwaps` / `slots`
- `variables.localCollections` / `resolvedVariables`
- `variants[]` — per variant: `dimensions`, `treeHierarchical`, `treeFlat`, `colorWalk`, `revealedTree`
- `ownershipHints[]` — pre-built hints from the plugin
- `_extractionNotes.warnings` — surface to the user if any warnings are present

Also: absorb `optionalContext` from the orchestrator as authoritative user guidance.

### Step 3: Build Working Evidence Set

Populate the `ComponentEvidence` structure (defined in the instruction file) by reading **only** from `_base.json`. The mapping:

| `ComponentEvidence` field | `_base.json` source |
| ------------------------- | ------------------- |
| `componentName` | `component.componentName` |
| `variantAxes` | `variantAxes` (already shaped `{name, options, defaultValue}`) |
| `booleanProps` | `propertyDefinitions.booleans` → map to `{ name, defaultValue, associatedLayer: associatedLayerName, rawKey }` |
| `instanceSwapProps` | `propertyDefinitions.instanceSwaps` |
| `slotProps` | `propertyDefinitions.slots` (includes `defaultChildren[].contextualOverrides`) |
| `composableChildren` | Derived from `variants[<default>].treeHierarchical` top-level INSTANCE entries that are **not** inside a SLOT node. Each entry carries `mainComponentName`, `parentSetName` (name of the component set when the main component is a variant), `booleanOverrides`, and child dims. **Precedence rule:** when populating `composableChildren[].componentName`, prefer `parentSetName` over `mainComponentName`. `mainComponentName` alone returns the variant short name (e.g., `"size=medium"`) when the child is a variant of a component set — never use that as a sub-component title. Emit both keys alongside the resolved `componentName` so downstream audits can verify the rule. |
| `relevantVariableCollections` | `ownershipHints[]` where `evidenceType === "variableMode"` → `{ name: propertyName, modes: modeNames }` |
| `textNodeMap` | `ownershipHints[]` where `evidenceType === "textNode"` → `{ name: propertyName, characters: textContent, parentName: sourceLayerName }` |
| `ownershipHints` | `ownershipHints[]` verbatim (schema is identical to what the old Step 3 script produced) |
| `defaultProps` | `defaultVariant.variantProperties` |
| `defaultVariantName` | `defaultVariant.name` |

No Figma calls are needed for Step 3. Any field you cannot derive from the table above means either (a) the `_base.json` schema needs widening — file a note for a follow-up — or (b) you need a Step 3-delta extraction.

### Step 3-delta (optional, read-only)

If during Step 4 you discover a fact that is genuinely missing from `_base.json` (e.g., a rare property description, a variable collection mode value not present in `variables.resolvedVariables`), you MAY issue a tiny `figma_execute` / `use_figma` call scoped to exactly that missing fact. Rules:

- **Read-only.** No `createInstance`, `setProperties`, `appendChild`, or `remove`. If you need mutation, file a bug against the uSpec Extract plugin instead.
- **< 50 lines of JS.** If your script is longer than 50 lines, the `_base.json` schema needs widening — do that instead of a large delta.
- **Audit every call.** Append one entry to `data._deltaExtractions[]` per delta script you run:

```json
{
  "purpose": "<why the fact was missing from _base.json>",
  "script": "<first 200 chars of the script>",
  "byteCount": <returned bytes>,
  "timestamp": "<ISO 8601>"
}
```

An empty array (zero delta calls) is the expected default. Multiple entries across components signal pressure to widen the `_base.json` schema in the plugin; treat the escape hatch as a diagnostic channel, not a regular path.

### Step 4: Identify Properties

Using the working evidence set from Step 3, identify:

**A. Variant properties** from `variantAxes`
- If a broad axis mixes transient and persistent states, decompose it into engineer-friendly API properties instead of copying the axis verbatim.
- Drop transient interaction visuals (hovered, pressed, focused) unless the component exposes them as persistent configuration.

**B. Boolean toggles** from `booleanProps`
- Separate simple modifiers (`isDisabled`, `showBadge`) from slot-selection booleans that should become enums with `none`.
- Check whether a child-level toggle actually changes the parent component contract. If it does, promote it to the parent API.

**Mandatory: Override Promotion Pass**

For each entry in `composableChildren`, walk every key in `contextualOverrides` and classify it:

| Override key | Does it change what the parent looks like to a consumer? | Action |
|---|---|---|
| Yes (e.g., `Leading content`, `Trailing content`, `Character count`) | Promote to parent API as an enum or boolean |
| No (e.g., `Size` that mirrors the parent's own size axis) | Keep in sub-component table only |
| Unclear | Ask: would an engineer set this when USING the parent? If yes, promote. |

When a master boolean (e.g., `Leading content: true/false`) gates sub-booleans, do not copy the Figma shape. Run Step 4-B.1 below to decide the relationship and produce the correct API shape. See the instruction file's **Boolean Relationship Reasoning Protocol** for the canonical definition.

Do not skip this pass — the most common failure mode is leaving child-level capabilities buried in sub-component tables when they belong on the parent API.

**Step 4-B.1: Boolean Relationship Reasoning (mandatory)**

For **every** sub-component in `composableChildren` (or in `propertyDefinitions.booleans` grouped by `associatedLayerName`) that has one or more booleans — whether a master wraps them or not — run the protocol and emit one entry into `data._extractionArtifacts.booleanRelationshipAnalysis[]`.

Evidence sources (cite all that apply — see the instruction file for the canonical list):

1. **Naming substring containment** between the booleans in `propertyDefinitions.booleans`.
2. **Wrapper FRAME in `variants[<default>].treeHierarchical`** that groups the affected layers.
3. **`associatedLayerName` sibling/nested relationships** from each boolean's `associatedLayerName`.
4. **`optionalContext` cues** ("one at a time", "priority", "only when", "either/or").
5. **Revealed-tree impossibility** from `variants[*].revealedTree` / `slotHostGeometry` (Phase G): combinations the forced-visibility walk proves impossible.

Entry shape (strict):

```json
{
  "subComponentName": "<engineer-facing name of the sub-component the booleans belong to>",
  "booleansConsidered": ["<rawKey>", "..."],
  "relationship": "orthogonal | mutually-exclusive | progression | master-sub-mixed | independent",
  "evidence": [
    { "source": "naming | treeHierarchical | associatedLayer | optionalContext | revealedTree", "note": "<≤160-char citation of the specific signal>" }
  ],
  "apiDecision": "merged | kept-separate",
  "apiShape": "<enum signature when merged, e.g., 'leadingContent: none, icon, text, iconAndText'> or null"
}
```

Rules:

- `evidence[]` must contain **≥1 entry** unless `relationship === "independent"`.
- `relationship: "independent"` is only legal when the protocol found **zero** dependency/exclusion/progression signals AND records at least one negative-evidence signal in `evidence[]` (e.g., `{ source: "naming", note: "no substring containment among bool names" }`). An independent conclusion without negative evidence is an audit failure.
- `relationship: "master-sub-mixed"` is reserved for the genuine edge case where some sub-booleans are progression-gated and others are orthogonal within the same sub-component. Split the analysis into multiple entries before falling back to this label.
- `apiDecision: "merged"` must be accompanied by a non-null `apiShape`. `apiDecision: "kept-separate"` must leave `apiShape: null` and justify the choice in `evidence[]`.
- `subComponentName` must be an engineer-facing name (prefer `parentSetName` / `componentSetName`), never a Figma property label (`Leading content`) or a variant short name (`size=medium`).

This artifact lives in `data._extractionArtifacts.booleanRelationshipAnalysis[]` and is consumed only by the orchestrator's Step 9.5 integrity check. The renderer does not read it; the `.md` stays Figma-blind.

**Step 4-B.2: State Axis Mapping (required when a Figma axis is decomposed)**

See the instruction file's **State Axis Mapping** subsection for the reasoning rule. When the decomposition pass in Step 4A collapses a single Figma axis into two or more runtime API props, emit one entry per Figma option into `data._extractionArtifacts.stateAxisMapping[]`. Strict entry shape:

```json
{
  "figmaAxis": "<name of the Figma axis, e.g. 'state'>",
  "figmaValue": "<the exact Figma axis option, e.g. 'active', 'rest (enabled)'>",
  "apiAssignments": { "<apiPropName>": "<value>", "...": "..." },
  "runtimeCondition": "<short engineer-readable condition, e.g. 'focused', 'has value && not focused'>"
}
```

Rules:

- One row per Figma option. If the axis has 7 options and was decomposed, emit 7 rows.
- `apiAssignments` keys are API prop names (e.g., `validationState`, `isDisabled`, `isReadOnly`) with the runtime value each Figma option maps to. Never leave it empty — every decomposed prop must appear with the value that corresponds to this Figma option.
- `runtimeCondition` is prose an engineer can read. Prefer short active-voice phrases: `"focused"`, `"focused && value === ''"`, `"validationState === 'error'"`. The renderer uses this exact string as a column header.
- Skip the whole artifact (emit an empty array or omit the field) when **no** decomposition happened — every Figma axis option maps 1:1 to the same API prop. Do not fabricate a mapping when it isn't needed.

Downstream consumers: `{{ref:component-md/agent-component-md-instruction.md}}` Color body rendering (Strategy B) uses this mapping to relabel `stateColumns` headers from Figma names to `runtimeCondition`. Structure body rendering also uses it to relabel the `### State deltas` artifact columns when the deltas axis matches.

**Step 4-B.3: Slot Resolver Strategy (required when a slot's API was shape-chosen)**

See the instruction file's **Slot Merger Rule** subsection for the reasoning rule. For every visual slot whose API shape was decided by the Slot Merger Rule (Shape A: enum-only; Shape B: behavioral booleans), emit one entry per slot into `data._extractionArtifacts.slotResolverStrategy[]`. Strict entry shape:

```json
{
  "slotName": "<engineer-facing slot name, e.g. 'trailingContent', 'leadingContent'>",
  "shape": "declarative | behavioral",
  "enumProp": "<the enum prop when shape='declarative', e.g. 'trailingContent'>",
  "behavioralProps": ["<list of booleans/sub-props when shape='behavioral', e.g. 'isLoading', 'showClear', 'trailingLabel'>"],
  "priorityOrder": ["<ordered list of conditions when multiple can be true, e.g. 'loading', 'clear', 'label'>"],
  "rationale": "<≤160-char citation of why this shape was chosen (sibling is* prop present → Shape B; otherwise Shape A; see instruction file)>"
}
```

Rules:

- `shape === "declarative"`: `enumProp` is required; `behavioralProps` is the derived-values list (still present so the renderer can reference it in generalNotes), `priorityOrder` matches the enum's resolve order.
- `shape === "behavioral"`: `enumProp` is `null`; `behavioralProps` is the exposed booleans; `priorityOrder` is the resolve order documented in generalNotes.
- Never emit a `slotResolverStrategy` entry AND parallel exposures — the API must match the declared shape. If the `properties[]` table has both an enum and its inputs at the same nesting level, the audit fails.

Downstream consumers: the orchestrator's Step 9.5 integrity gate uses this field to verify the audit rule. Renderer does not read it.

**C. Variable mode properties** from `relevantVariableCollections`
- Treat density, shape, and similar mode-controlled properties as first-class API inputs when they materially affect the component.
- Do not omit variable modes just because they are controlled at the container level.

**D. Ownership and nesting decisions**
- Decide whether each property belongs on the parent API, in a sub-component table, or both.
- Use the parent API for properties that affect the component's external contract, behavior, or common usage.
- Use sub-component tables for implementation/configuration details of nested children.
- Use `isSubProperty` when a property is best understood as part of a parent capability rather than a standalone top-level row.

**E. Sub-component configurations** (Pattern A: slot content types; Pattern B: fixed sub-components — see instruction file for decision criteria)
- Check both fixed children and interchangeable slot content types.
- For compound components, prefer documenting the user-facing contract on the parent and the child-specific mechanics in the sub-component tables.

**F. Boolean-gated slot fillers (identity resolution)**

Read `_base.json.slotHostGeometry.boolGatedFillers` — Phase G records every INSTANCE that is hidden by default and revealed by toggling a BOOLEAN component property. Each entry has shape:

```json
{ "slotRole": "trailingIcon", "boolPropName": "Trailing icon", "componentKey": "...", "componentName": "Icon, size=Medium", "componentSetName": "Icon", "parentSetName": "Icon" }
```

For every boolean-gated sub-component role you expose in the API:

1. Try to match it to an entry in `boolGatedFillers[]` by `boolPropName` or `slotRole`.
2. If matched, use `parentSetName || componentSetName` as the sub-component title and set `_identityResolved: true` on that sub-component table entry.
3. If **no match** (the filler has never been created in any walked variant), still emit the sub-component table using the role name as a fallback title — but set `_identityResolved: false` and include a note pointing the renderer at the `[identity unresolved]` badge.
4. Every `SubComponentApiTable` you emit must carry `_identityResolved: true | false`. Missing the field is a hard failure.

This is the only way an engineer can tell the difference between "the sub-component is fully resolved to a real component" and "the API contract names a slot but we could not identify its component."

### Step 5: Generate `ApiOverviewData` Object

Follow the `ApiOverviewData` schema defined in the instruction file. Build the data as a structured object matching those interfaces.

Before finalizing, mentally separate:
- deterministic facts: what `_base.json` proves,
- semantic API decisions: how those facts should be exposed to engineers.

Do not ask the model to infer facts that are already in `_base.json`. Do not bury semantic decisions inside the data structure — interpretation happens here explicitly.

### Step 6: Audit (tick-mark checklist)

Run **every** check below against your assembled `ApiOverviewData`. An unchecked box is a blocker — fix the output before writing the cache file. Return the checklist verbatim in your final summary so the orchestrator can aggregate it into the "Known gaps" block.

```
- [ ] componentName is present and matches _base.json.component.componentName
- [ ] mainTable.properties has one row per variantAxes entry, per booleanProp (after override-promotion), and per promoted child property
- [ ] Every sub-component table uses parentSetName over mainComponentName when the main component's parent is COMPONENT_SET
- [ ] Every SubComponentApiTable has an _identityResolved boolean (true | false — never missing)
- [ ] Every entry in _base.json.slotHostGeometry.boolGatedFillers is either matched to a sub-component table with _identityResolved=true, or explicitly acknowledged with _identityResolved=false
- [ ] No sub-component table has a variant short name (e.g., "size=medium") as its title
- [ ] Property names are camelCase and engineer-friendly
- [ ] Broad Figma axes that mix transient and persistent state have been decomposed into engineer-friendly API properties
- [ ] Override-promotion pass was run: every composableChildren contextualOverride key is either promoted to parent API or kept in the sub-component table, with a documented reason
- [ ] `_extractionArtifacts.booleanRelationshipAnalysis` exists
- [ ] Every sub-component with ≥1 boolean has an entry in `booleanRelationshipAnalysis[]`
- [ ] Every entry has a non-empty `evidence[]`
- [ ] Every `"independent"` conclusion cites at least one negative-evidence signal in `evidence[]`
- [ ] No merged enum uses a Figma property name as its API name (no `showLeadingContent`, `show_trailing_label`, etc.)
- [ ] If any Figma axis was decomposed in Step 4A, `_extractionArtifacts.stateAxisMapping[]` has one row per Figma option with `figmaAxis`, `figmaValue`, `apiAssignments`, and `runtimeCondition`. When no decomposition happened, the field is absent or empty.
- [ ] For every visual slot whose API was shape-chosen, `_extractionArtifacts.slotResolverStrategy[]` has one entry with `shape`, `enumProp`/`behavioralProps`, `priorityOrder`, and `rationale`. No slot exposes both a merged enum AND its behavioral inputs at the same nesting level.
- [ ] Variable-mode properties are treated as first-class API inputs when they materially affect the component
- [ ] isSubProperty is used only when the relationship is clear and meaningful
- [ ] _deltaExtractions[] records every Step 3-delta call that fired this run (empty array if none)
- [ ] configurationExamples has 1–4 entries and each one uses only property keys defined in mainTable
- [ ] _base.json._extractionNotes.warnings were surfaced in the summary if non-empty
```

### Step 7: Write Cache and Return

Write the finalized `ApiOverviewData` object as pretty-printed JSON to `{cachePath}/{componentSlug}-api.json` using the `Write` tool. Envelope:

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
    "_deltaExtractions": [ /* 0+ entries if Step 3-delta fired */ ],
    /* full ApiOverviewData object — matches the schema in {{ref:api/agent-api-instruction.md}} */
  }
}
```

### Step 7.5: Project `ApiDictionary` and write the dictionary cache

After `{componentSlug}-api.json` is written, project the `ApiDictionary` artifact as specified in the **`ApiDictionary` artifact** section of [api/agent-api-instruction.md]({{ref:api/agent-api-instruction.md}}). This is a pure re-projection — no new reasoning, no new Figma calls, no inference. Every field has a documented 1:1 source already captured in the api.json payload.

Projection rules (no interpretation beyond what the instruction file already codified):

1. **`componentName`** — copy from `data.componentName`.
2. **`axes[]`** — walk `data.mainTable.properties[]`. For every row whose `values` is a comma-separated enum (i.e. not `"true, false"`, not `"string"`, not `"number"`, not a single `"(instance)"` / `"(slot)"` marker), emit one entry:
   - `name` = `row.property`.
   - `values[].name` = each comma-split, trimmed value.
   - If `data._extractionArtifacts.stateAxisMapping[]` contains any entry whose `apiAssignments` has a key equal to `row.property`, set `decomposedFrom` to that entry's `figmaAxis`, `classification` to `"state"`, and populate every value's `figmaValue` and `runtimeCondition` by looking up the matching `stateAxisMapping[]` row. When no mapping row matches a given value name, leave `figmaValue: null` and `runtimeCondition: null`.
   - Otherwise set `classification` to `"variable-mode"` when `row.notes` mentions a variable collection mode (substring match on "variable mode"), otherwise `"variant"`.
3. **`subComponents[]`** — walk `data.subComponentTables[]`. For each table, emit `{ name: table.name, parentSetName: null, mainComponentName: null, _identityResolved: table._identityResolved ?? true, role: null }`. If the source extraction preserved `parentSetName` / `mainComponentName` in the table name or a sibling field, carry those through; otherwise leave them `null`. Populate `role` from `_base.json.slotHostGeometry.boolGatedFillers[*].slotRole` when one matches the sub-component's role (by boolean prop name or slot name); otherwise `null`.
4. **`booleanRelationships[]`** — copy `data._extractionArtifacts.booleanRelationshipAnalysis[]` verbatim but drop `evidence[]`. Keep `{ subComponentName, booleansConsidered, relationship, apiDecision, apiShape }`.
5. **`states[]`** — copy `data._extractionArtifacts.stateAxisMapping[]` verbatim. Empty array when the field is absent.
6. **`slots[]`** — copy `data._extractionArtifacts.slotResolverStrategy[]` verbatim but drop `rationale`. Keep `{ slotName, shape, enumProp, behavioralProps, priorityOrder }`. Empty array when the field is absent.

Write the finalized dictionary as pretty-printed JSON to `{cachePath}/{componentSlug}-api-dictionary.json` using the `Write` tool. Envelope:

```json
{
  "_meta": {
    "schemaVersion": "1",
    "extractedAt": "<ISO 8601 timestamp>",
    "fileKey": "<fileKey>",
    "nodeId": "<nodeId>",
    "componentSlug": "<componentSlug>",
    "source": "derivative-of-api.json",
    "apiJsonPath": "<cachePath>/<componentSlug>-api.json"
  },
  "data": {
    /* ApiDictionary object per the schema */
  }
}
```

**Do not mutate `api.json`** during this step. The dictionary is a *new* file; api.json stays unchanged.

### Step 8: Return one-line summary

Return a **single-line summary** to the orchestrator:

```
API extracted: <N> properties, <M> sub-components, <K> examples → <cachePath>/<componentSlug>-api.json (+ dictionary at <cachePath>/<componentSlug>-api-dictionary.json)
```

Where:
- `N` = number of entries in `data.properties`
- `M` = number of entries in `data.subComponentTables` (0 if none)
- `K` = number of entries in `data.configurationExamples` (0 if none)

Append `(warnings: <W>)` to the summary if `_base.json._extractionNotes.warnings` is non-empty.

Do **not** include the full payload, screenshots, or interpretation prose in the return message.

## Not In Scope

- Extracting from Figma beyond the Step 3-delta escape hatch.
- Importing or detaching Figma templates.
- Rendering tables or previews in Figma.
- Visual validation screenshots and the iterative fix loop.
- Re-reading `uspecs.config.json` — the orchestrator passes `mcpProvider` directly.

## Quality Guarantee

This skill is the **interpretation half** of the `create-component-md` pipeline for API data. If the produced JSON is missing properties, has incorrect ownership, or violates the schema, the bug is either:

1. In the reasoning here (fix in both this skill and `create-api`), or
2. In `_base.json` from the uSpec Extract plugin (fix the plugin's phase code, never duplicate extraction logic here).

The Step 3-delta escape hatch is a short-term mitigation, not a permanent home for missed facts.
