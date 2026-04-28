---
name: extract-color
description: Interpret a component's color-token mapping (per-element fills/strokes/effects, axis classification, boolean delta, variable mode detection, strategy plan) from the `_base.json` produced by the uSpec Extract Figma plugin, and write the normalized JSON to disk. Read-only interpretation — no Figma calls except an optional tiny delta script.
---

# Extract Color Data

Interpretation-only companion to `create-color`. This skill **does not extract data from Figma**. It reads `{cachePath}/{componentSlug}-_base.json` (produced by the uSpec Extract Figma plugin), applies the same reasoning layer as `create-color`, and writes the finalized color dataset (either `ColorAnnotationData` or `ConsolidatedColorAnnotationData`) to disk for the `create-component-md` orchestrator.

**Quality contract:** every reasoning step (axis classification review, boolean enrichment, mode detection, container detection, composite breakdown, strategy selection, variant reduction plan, audit) mirrors `create-color/SKILL.md`. Any improvement to color-extraction quality must be made in both places.

**Batch-mode contract.** This skill MUST NOT call `AskQuestion`, prompt for confirmation, or pause for user input. On ambiguous rendering-strategy or container-detection decisions, pick the most defensible option based on the evidence and record the reasoning in `generalNotes` or `_containerRerunHint`. No mid-interpretation clarifications.

## Invocation Contract

The orchestrator calls this skill with these inputs (already resolved — do NOT re-parse URLs or re-read `uspecs.config.json`):

- `componentSlug` — filename-safe slug
- `cachePath` — cache directory, typically `.uspec-cache/{componentSlug}/`
- `optionalContext` — free-form string from the user (may be `"none"`)
- `mcpProvider` — `figma-console` or `figma-mcp` (only needed if a Step 3-delta escape hatch fires AND a live Figma link was provided to the orchestrator)
- `deltaAvailable` — boolean. When the orchestrator received only a `baseJsonPath` (no `figmaLink`), this is `false` and the Step 3-delta escape hatch must not fire; log the gap in `data._deltaExtractions[]` with `unavailable: "no-figma-link"` and continue with best-effort output.
- `apiDictionaryPath` — absolute or workspace-relative path to `{cachePath}/{componentSlug}-api-dictionary.json`. Optional. When present, the file is the canonical vocabulary for axis/value/sub-component/state naming (see Step 2.5). When absent, the skill continues with `_dictionaryUnavailable: true` in its output envelope.

`fileKey` and `nodeId` are **not** pass-through parameters anymore. Read them from `{cachePath}/{componentSlug}-_base.json._meta.fileKey` and `_meta.nodeId` at the start of Step 1.

**Output:**

- Writes `{cachePath}/{componentSlug}-color.json` with a `{ _meta, data }` envelope. `data` is the finalized color dataset (Strategy A or Strategy B shape).
- Returns a single-line summary: `"Color extracted: strategy={A|B}, N sections, M unique tokens, modes=[...] → {path}"`.
- Never creates or mutates Figma nodes.

## MCP Adapter

Typically **zero** MCP calls — this skill reads `_base.json` from disk. The adapter applies only to the optional Step 3-delta escape hatch.

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
- [ ] Step 3: Build working evidence set (resolve colorWalk entries into tokens)
- [ ] Step 3-delta: OPTIONAL — read-only Figma call if a fact is genuinely missing
- [ ] Step 4: Interpret — strategy selection, variant plan, container detection, composite breakdown
- [ ] Step 5: Organize into ColorAnnotationData / ConsolidatedColorAnnotationData
- [ ] Step 6: Audit (re-read instruction file)
- [ ] Step 7: Write JSON to cache and return one-line summary
```

### Step 1: Read Instructions

Read [agent-color-instruction.md]({{ref:color/agent-color-instruction.md}}). This is the **same** instruction file used by `create-color`. Treat it as the single source of truth for the data structure, rendering strategies, the two-gate decision model, composite-style handling, variable-mode rules, and audit checklists.

#### Rendering-only sections to skip

The shared instruction file describes both extraction and Figma rendering. This skill only performs interpretation — ignore guidance below. The data schema and audit checklists still apply.

- **§Handling Special Cases — Composite Styles §Rendering block** (frame-visibility recipe for `#hierarchy-indicator`) — template-frame contract used only at render time. Still populate `compositeChildren` with `element`, `value`, `notes`.
- **§Handling Special Cases — "Preview rendering limitations"** — does not apply.
- **§Data Structure Reference — "no JSON output is needed"** — inverted: we **do** output JSON.
- **§Structure Rules — "Each entry renders as a heading + preview + table(s)"** — rendering commentary. Schema retained.
- **§Common Mistakes — rows about previews or rendered output** — rendering-path cautions. Data-level mistakes still apply.

**IMPORTANT — fields that look rendering-adjacent but are NOT skippable:**

- **`renderingStrategy: "A" | "B"`** — required discriminant field. Run the full two-gate decision model.
- `variantProperties`, `modeId`, `collectionId`, `stateColumns`, `stateAxisName` — all part of the schema.
- `compositeChildren` — required; only the frame-visibility recipe is rendering-only.

### Step 2: Load `_base.json`

Read `{cachePath}/{componentSlug}-_base.json`. If missing or required sections are `null`, abort with a diagnostic asking the user to re-run the uSpec Extract plugin.

Top-level keys this skill consumes:

- `component`, `variantAxes`, `defaultVariant`, `propertyDefinitions.rawDefs`
- `variables.localCollections` + `resolvedVariables` (for mode detection and token name resolution)
- `styles.resolvedStyles` (for style-name resolution)
- `variants[*].colorWalk` — path-qualified fill/stroke/effect entries with style IDs, bound variable IDs, and (when fills have 2+ visible layers) an extra `fill-composite` entry with `layers[]`.
- `variants[<default>].revealedColorWalk` — Phase G produces this by colorWalking the default variant after setting all booleans to `true`. Used to derive `booleanDelta` (elements only visible when a boolean flips on).
- `variants[*].variantProperties`
- `crossVariant.axisTokenFingerprints` and `crossVariant.axisClassification` (already pre-computed, including `isState` and `colorRelevant` per axis)
- `ownershipHints[]` where `evidenceType === "variableMode"` (for mode collection discovery)
- `_childComposition.children[]` where `classification === "constitutive"` (primary signal for container detection in Step 4 §1b)
- `_extractionNotes.warnings`

Also absorb `optionalContext`.

### Step 2.5: Load API dictionary (canonical vocabulary)

The `create-component-md` orchestrator writes `{cachePath}/{componentSlug}-api-dictionary.json` alongside `_base.json` after `extract-api` finishes. When present, this file is the **canonical vocabulary** for axis names, value names, sub-component names, and state runtime conditions. See the **`ApiDictionary` artifact** section in [api/agent-api-instruction.md]({{ref:api/agent-api-instruction.md}}) for the schema.

**Resolution order:**

1. If the orchestrator passed `apiDictionaryPath`, read that file.
2. Otherwise look for `{cachePath}/{componentSlug}-api-dictionary.json` on disk.
3. If neither resolves (e.g., the skill is being run standalone), continue with existing behavior but set `data._dictionaryUnavailable = true` on the output envelope. The orchestrator's Step 9.5 integrity check uses this flag to mark the produced cache as lower confidence.

**How this skill uses the dictionary** (keep it in scope through Steps 3–5):

- **Strategy B state columns.** The state axis columns you emit under `data.stateValues` (or `sections[].stateColumns`) MUST remain the raw Figma option names — the renderer relabels them via `stateAxisMapping[]` at `.md` render time. Do **not** pre-substitute `runtimeCondition` into the stored JSON. But check: every value in `data.stateValues` should correspond to a `dictionary.states[].figmaValue`. When a column has no matching `figmaValue`, emit a `_dictionaryMismatch` entry for it (see below).
- **Sub-component element naming.** When annotating color entries that carry a `subComponentName` (Step 4 §3), prefer the dictionary's canonical `subComponents[].name` over the raw Figma layer name. Keep the original in a `_dictionaryMismatch` annotation when the two disagree.
- **Container hint sub-component list.** When emitting `_containerRerunHint.subCompSetNames`, prefer the dictionary's `subComponents[].name` when a match exists; fall back to the raw tree names otherwise.

**Mismatch protocol — do NOT silently rename, do NOT silently keep.**

When your evidence (from `_base.json`'s color walk) contradicts the dictionary — for example, the dictionary names a state column the color walk did not cover, or the walk surfaces a state the dictionary does not list — emit the observed value AND attach a `_dictionaryMismatch` annotation. Shape:

```json
{
  "observed": "<what you measured / observed>",
  "dictionary": "<what the dictionary named; null when the dictionary listed a value you couldn't find>",
  "kind": "value-missing" | "value-extra" | "name-drift",
  "note": "<short rationale; ≤160 chars>"
}
```

Aggregate every mismatch into `data._extractionArtifacts.dictionaryMismatches[]`. The orchestrator's Step 8.5 reconciliation pass consumes this list to decide whether to auto-rewrite vocabulary, re-dispatch this skill with an expanded scope, or surface a semantic conflict.

**Retry semantics — the orchestrator may re-dispatch this skill.**

When `optionalContext` begins with the literal prefix `create-component-md retry: `, the rest of the string is an authoritative scope expansion from the orchestrator's Step 8.5 reconciliation step. Parse it as a comma-separated list of items (state values, sub-components, axes) the dictionary exposed but this skill previously did not cover. The retry run MUST emit evidence for every listed item — either a real section/row citing evidence from `_base.json`, or an explicit `_dictionaryMismatch` entry explaining why no evidence could be gathered. Never silently drop a listed item.

### Step 3: Build Working Evidence Set

For each variant in `_base.json.variants`, resolve its `colorWalk` entries into the shape the old `variantColorData[*].colorEntries` had:

```
colorEntry = {
  element: colorWalk[i].element,
  path: colorWalk[i].path,
  property: colorWalk[i].property,  // "fill" | "text fill" | "stroke" | "drop shadow" | "inner shadow" | "fill-composite"
  hex: colorWalk[i].hex,
  token: resolveToken(colorWalk[i].styleId, colorWalk[i].boundVariableId),
  opacity: colorWalk[i].opacity,
  subComponentName: colorWalk[i].subComponentName || undefined,
  compositeDetail: <build from fill-composite entries, see below>,
  stops: colorWalk[i].stops,  // for gradients
  angleDegrees: colorWalk[i].angleDegrees
}
```

**Token resolution priority** (matches `create-color` semantics):
1. If `styleId` is present and resolves via `styles.resolvedStyles[styleId].name`, use the style name (highest precedence).
2. Else if `boundVariableId` is present and resolves via `variables.resolvedVariables[boundVariableId]`, use `codeSyntax` (`WEB` code syntax if present) falling back to `name`.
3. Else `token: null` (hard-coded color — flag in notes).

**Composite detail.** `colorWalk` emits a separate entry with `property: "fill-composite"` whenever a node's `fills` has 2+ visible layers sharing a style. Group the composite entry with the matching element and build `compositeDetail`:

```
compositeDetail = {
  styleName: resolved style name,
  layers: composite.layers.map(layer => {
    solid → { type: 'solid', hex, token (resolved), blendMode, opacity }
    gradient → { type: 'gradient', gradientType, angleDegrees, stops: [{ position, color, token }], blendMode, opacity }
    image → { type: 'image', blendMode, opacity }
  })  // order top-to-bottom (same order as fill-composite.layers)
}
```

**Boolean delta.** `booleanDelta` is derivable from `variants[<default>].revealedColorWalk` (populated by Phase G of the plugin). Subtract baseline entries (from `variants[<default>].colorWalk`) from `revealedColorWalk` by key `element|property|(token || hex)`. Any extra entries that only appear in `revealedColorWalk` become `booleanDelta.delta[]`. If you don't need a separate delta block (typical for Strategy A), skip this step.

If `revealedColorWalk` is absent, fall back to a Step 3-delta read-only script scoped to the specific boolean-gated elements you need.

**Per-variant summary.** For each variant build:

```
{
  name: variant.name,
  variantProperties: variant.variantProperties,
  colorEntries: [...resolved entries]
}
```

**Axis classification and fingerprints.** Read `crossVariant.axisTokenFingerprints[axis][value]` (already pre-computed by Phase F of the plugin) and `crossVariant.axisClassification[axis]` directly. No additional computation needed.

**Mode detection.** Walk `variables.localCollections`. For each collection:
- If `modes.length <= 1`, skip.
- If `name` matches `/density|shape|size|spacing|radius|tone|color|state|variant|theme|mode/i` **or** any token referenced in any `colorWalk` entry's bound variable lives in this collection, treat it as a candidate.
- Build `modeTokenMap[modeName] = {}` by iterating the collection's variable IDs in `variables.resolvedVariables`. For each variable's `valuesByMode[modeName]`:
  - If `{ kind: 'alias', targetName }`, map `variable.codeSyntax → targetName`.
  - Else map `variable.codeSyntax → variable.codeSyntax || variable.name` (self-resolution for non-alias values).
- Pick the first candidate with a mode count > 1 and at least one variable that resolves to a color alias. Record:

```
modeDetection = {
  hasModeCollection: true,
  collectionName, collectionId,
  modes: [...modeNames],
  modeIds: { modeName → modeId },
  modeTokenMap
}
```

If no candidate qualifies, `modeDetection.hasModeCollection = false`.

### Step 3-delta (optional, read-only)

If a token appears in `colorWalk` but has no entry in `styles.resolvedStyles` / `variables.resolvedVariables`, or if a mode collection discovered through `ownershipHints[*].evidenceType === "variableMode"` is missing from `variables.localCollections`, issue a small `figma_execute` / `use_figma` call to resolve just that one fact.

Rules:
- **Read-only.** No mutation APIs.
- **< 50 lines of JS.**
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

### Step 4: Interpret

**1. Validate evidence.** Confirm `variants` is non-empty. If standalone `COMPONENT` (not a set), expect a single variant entry.

**1b. Container detection (derivative).** Container-ness is no longer decided here. Read `_base.json._childComposition.children[]`:

- Collect entries with `classification === "constitutive"` that have a non-null `subCompSetId`. These are the **authoritative** constitutive sub-components. This list is the source of truth for the container hint.
- If that collection is non-empty, the parent is composition-heavy. Continue into the confirming-symptom checks below.
- If that collection is empty, do NOT emit `_containerRerunHint` — any color-only "symptom" in that case is noise and must be recorded in `_extractionArtifacts.containerSymptoms` without firing a hint.

**Confirming symptoms** (used only to record evidence, not to decide):

1. ALL entries across all variants have `subComponentName` and the parent contributes no direct entries.
2. The parent's own fills/strokes are all `transparent` / `none` (every non-subComponent entry resolves to `"transparent"`, `"none"`, or `null` with zero opacity) **and** `subComponentDimensions` is populated.
3. The parent has only direct container-background entries that are transparent / none, and every visible color entry is carried by a sub-component.

**When to emit `_containerRerunHint`.** Emit iff the constitutive-sub-component collection is non-empty **AND** at least one of symptoms 1–3 holds. This keeps the color hint aligned with the orchestrator's structural classification — same decision, two confirming sources.

When the hint fires:
- Use `subCompSetIds` / `subCompSetNames` from the constitutive entries in `_childComposition` (NOT from `treeHierarchical` directly — the classification has already filtered referenced/decorative children out).
- **Emit a `_containerRerunHint` in the output envelope** (see Step 7). Shape:
  ```json
  {
    "subCompSetIds": ["<id>", "..."],
    "subCompSetNames": ["<name>", "..."],
    "trigger": "all-sub" | "transparent-parent" | "background-only",
    "source": "derivative-of-_childComposition",
    "reason": "Some painted pixels on this parent are rendered inside constitutive sub-component instances; the canonical color spec for those pixels lives on each child's own .md. The parent's flattened color attribution is fully measured here from colorWalk[] and is authoritative for the parent.",
    "action": "Optional: run create-component-md on each constitutive child to produce the per-child canonical color spec. The parent .md is shippable as-is — do not treat this hint as a gap."
  }
  ```
- Keep the parent component name as the annotation title for the current run.
- Note the container relationship in `generalNotes` using **neutral, authoritative framing**: the parent's tokens are flattened from `colorWalk[]` and are authoritative for shipping the parent; child specs hold the per-child internal canon. Do **not** editorialize the parent's Color section as informational, provisional, placeholder, or pending. The hint suggests deeper recursion into child specs; it does not weaken the parent's own spec.
- Do **not** issue a Step 3-delta to reproduce the plugin's work — the delta budget (50 lines) is too small, and a container re-run is an orchestrator-level decision.

**Malformed input.** If `_base.json._childComposition` is missing, the file was not produced by the uSpec Extract plugin. Record a `_base.json` schema warning in `_extractionArtifacts.schemaWarnings[]` ("missing _childComposition in _base.json — re-run the uSpec Extract plugin") and leave `_containerRerunHint` null. Do not attempt to infer a hint from color symptoms alone.

**2. Merge boolean delta.** If a `booleanDelta` was built in Step 3 and has entries, merge them into the default variant's color entries as elements hidden behind boolean toggles.

**3. Annotate sub-component entries.** Entries with `subComponentName` come from nested INSTANCE walks. Include their actual tokens — use the sub-component name in descriptive notes (e.g., `"Button container fill"`). Group sub-component entries together in the table when readability benefits.

**4. Map elements to tokens.** From the resolved entries. Entries with `token === null` are hard-coded colors — flag in notes.

**4a. Build composite breakdowns.** For each entry with `compositeDetail`, construct a `compositeChildren` array on the corresponding `ColorElement`/`ConsolidatedElement`. Iterate layers in top-to-bottom order (same order as `compositeDetail.layers`):
- **Solid**: element = `"Solid fill"`, value = token or hex, notes = `"{blendMode} blend, {opacity}% opacity"`. Prefix `"Top layer."` / `"Bottom layer."` when 2+ layers exist.
- **Gradient**: element = `"{gradientType} gradient"` (e.g., `"Linear gradient"`), value = `"linear-gradient({angle}deg, ...)"`, notes = `"{blendMode} blend, {opacity}% opacity"` with position prefix. Then append one child per stop: element = `"Stop at {position}%"`, value = `"rgba(r, g, b, a)"` or token if bound, notes = position description (e.g., `"Transparent"`, `"Opaque"`).
- **Image**: element = `"Image fill"`, value = `"image"`, notes = blend and opacity.

**5. Capture Figma property keys.** Use `propertyDefinitions.rawDefs` and `variantAxes` to map variant section names to Figma property values.

**6. Choose rendering strategy** — see Step 4-i.

**7. Build variant plan** — see Step 4-ii.

#### Step 4-i: Determine Rendering Strategy

Using `crossVariant.axisClassification` and the `modeDetection` built above, follow the **Rendering Strategies** and **Decision Logic (Two-Gate Model)** sections in the instruction file to pick Strategy A or Strategy B.

If Strategy B, also record:
- `stateAxisName`: name of the state axis (e.g., `"State"`)
- `stateValues`: ordered list of state values (columns)
- `nonStateAxes`: remaining color-relevant axes whose combinations form sections

Strategy selection drives the **shape of the JSON on disk**: Strategy A → `ColorAnnotationData`; Strategy B → `ConsolidatedColorAnnotationData`. The orchestrator and `.md` template switch layout accordingly.

#### Step 4-ii: Build Variant Reduction Plan

Follow the **Variable Mode Colors** section for mode-controlled components and the **Color-Irrelevant Axes** section for axis filtering.

- **Color-irrelevant axes**: pick one representative value (typically default). Never create sections for these axes.
- **Strategy A sections**: one section per color-relevant axis combination.
- **Strategy B sections**: one section per non-state color-relevant combination, with all state values as columns.

**Mode-controlled components.** If `modeDetection.hasModeCollection` is true:
- Record `collectionId` on the top-level data structure.
- Record `modeId` per section so downstream consumers can apply the correct variable mode.
- Use `modeDetection.modeTokenMap[modeName]` to resolve generic tokens to semantic aliases per mode.

Every variant is already walked by the plugin, so **no re-extraction is needed here** — just filter the color-irrelevant axes out of the section plan. If the component has > 50 variants and the orchestrator wants a subset, it can pass `optionalContext: "focus: primary configuration only"` upstream.

### Step 5: Organize into `ColorAnnotationData` / `ConsolidatedColorAnnotationData`

Follow the **Data Structure Reference** in the instruction file — use the Strategy A or Strategy B interfaces exactly.

Preserve the following fields even though they are normally consumed only by rendering scripts:

- `variantProperties` on each section
- `collectionId` / `modeId` on Strategy B sections
- `compSetNodeId` on the top-level object

#### Hex extension fields (Markdown renderer companions)

Alongside each `tables[].elements[]`, attach a parallel-indexed array carrying the resolved hex value per element. These fields are envelope **extensions** consumed only by the `create-component-md` Markdown renderer — the shared schema in `{{ref:color/agent-color-instruction.md}}` does not know about them, and the `create-color` Figma renderer ignores them. Source the hex values from the Step 3 working evidence (`colorEntry.hex` on the matching element).

**Strategy A.** On every `tables[]` object, emit `elementHexes[]` as a sibling of `elements[]`. Lockstep with `elements[]`: same length, same order. Each entry has shape `{ "hex": "#RRGGBB" | null }`. Use uppercase six-digit hex. Use `null` when the element resolves to no color (token === `"none"`, fully transparent fill, or unresolvable). For elements with `compositeChildren`, the parent element's hex is the resolved composite-style top-line color when one exists, otherwise `null` — composite child hexes are **not** carried here (children render via `child.value` which already accepts mixed token/rgba strings).

**Strategy B.** On every `tables[]` object, emit `elementHexesByState[]` as a sibling of `elements[]`. Lockstep with `elements[]`: same length, same order. Each entry has shape `{ "hexByState": { "<originalFigmaState>": "#RRGGBB" | null, ... } }`. The key set of `hexByState` MUST equal the key set of the matching `elements[i].tokensByState` exactly — same Figma state values, no relabeling. Uppercase six-digit hex; `null` when the element/state combination resolves to no color. Composite-child hexes are not carried (same rule as Strategy A).

**Graceful absence.** If the working evidence cannot supply a hex for an element (e.g., a delta-rerun supplied tokens but no fill data), emit `null` rather than omitting the entry — the Markdown renderer relies on lockstep length to index correctly.

### Step 6: Audit (tick-mark checklist)

Run **every** check below against your assembled color dataset. An unchecked box is a blocker — fix the output before writing the cache file. Return the checklist verbatim in your final summary so the orchestrator can aggregate it into the "Known gaps" block.

```
- [ ] Every token name is copied verbatim from codeSyntax.WEB or variable names — not editorialized
- [ ] Every compositeChildren array preserves the top-to-bottom layer order from compositeDetail.layers
- [ ] Hard-coded colors (token === null) are explicitly flagged in notes
- [ ] For mode-controlled components, every `Type × Mode` combination has its own section with tokens resolved via modeDetection.modeTokenMap
- [ ] Sub-component entries carry their subComponentName into element names or notes
- [ ] Rendering strategy (A or B) is recorded in _extractionArtifacts.strategy and matches the decision rules
- [ ] Container detection (Step 4 §1b) uses _base.json._childComposition.children[] filtered to classification === "constitutive" as the primary signal; symptom checks are only confirming evidence
- [ ] _containerRerunHint is emitted only when the constitutive-sub-component list is non-empty AND at least one symptom (all-sub / transparent-parent / background-only) also holds
- [ ] When the hint fires, `source` is set to "derivative-of-_childComposition"
- [ ] generalNotes mentions the container relationship using neutral/authoritative framing when _containerRerunHint is non-null — parent tokens are described as measured from colorWalk[] (authoritative); child specs hold child-internal canon. No "pure container", "informational", "provisional", "placeholder", or "pending" framing.
- [ ] Every note is 3–8 words
- [ ] _deltaExtractions[] records every Step 3-delta call that fired this run (empty array if none)
- [ ] _base.json._extractionNotes.warnings were surfaced in the summary if non-empty
- [ ] When the API dictionary was loaded, every Strategy B state column has a matching `dictionary.states[].figmaValue` OR carries a `_dictionaryMismatch` entry. Same rule for sub-component element names that drift from `dictionary.subComponents[].name`.
- [ ] When `_dictionaryUnavailable` is true, the output envelope records it so the orchestrator can downgrade confidence.
- [ ] Every `tables[].elementHexes[]` (Strategy A) or `tables[].elementHexesByState[]` (Strategy B) array has the same length as its sibling `tables[].elements[]` — no missing or extra entries
- [ ] (Strategy B) Every `elementHexesByState[i].hexByState` key set exactly matches the key set of `elements[i].tokensByState` — same Figma state values, no relabeling
- [ ] Every non-null hex value is uppercase six-digit `#RRGGBB` format; unresolvable colors are emitted as `null`, never as empty string or lowercase hex
```

### Step 7: Write Cache and Return

Write the finalized color dataset as pretty-printed JSON to `{cachePath}/{componentSlug}-color.json`. Per-table extension fields `elementHexes[]` (Strategy A) and `elementHexesByState[]` (Strategy B) ride alongside `elements[]` inside `data.variants[].tables[]` / `data.sections[].tables[]`; see Step 5 for shape and lockstep rules. Envelope:

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
    /* ColorAnnotationData (Strategy A) or ConsolidatedColorAnnotationData (Strategy B) */
    "_deltaExtractions": [ /* 0+ entries */ ],
    "_dictionaryUnavailable": false /* true when Step 2.5 could not locate the api-dictionary.json */,
    "_containerRerunHint": null /* or { subCompSetIds: [...], subCompSetNames: [...], reason: "..." } when Step 4 §1b detects a container component */,
    "_extractionArtifacts": {
      "strategy": "A" | "B",
      "variantAxes": { /* derived from _base.json.variantAxes, reshaped as { axisName: options[] } */ },
      "axisClassification": { "<axis>": { "isState": <bool>, "colorRelevant": <bool> } },
      "modeDetection": { "hasModeCollection": <bool>, "collectionName": "...", "collectionId": "...", "modes": ["..."] },
      "uniqueTokens": ["..."],
      "subComponentsReferenced": ["..."],
      "containerSymptoms": [ /* symptom names that fired — "all-sub" | "transparent-parent" | "background-only"; recorded regardless of whether _containerRerunHint fires */ ],
      "schemaWarnings": [ /* e.g., "missing _childComposition in _base.json — re-run the uSpec Extract plugin" */ ],
      "dictionaryMismatches": [ /* 0+ entries — see Step 2.5 mismatch protocol */ ]
    }
  }
}
```

Return:

```
Color extracted: strategy=<A|B>, <N> sections, <M> unique tokens, modes=[<comma-separated mode names or "none">] → <cachePath>/<componentSlug>-color.json
```

Where `N` = entries in `data.variants` (Strategy A) or `data.sections` (Strategy B); `M` = `uniqueTokens.length`; modes = comma-separated or `"none"`.

Append `(warnings: <W>)` if `_base.json._extractionNotes.warnings` is non-empty.

## Not In Scope

- Extracting from Figma beyond the Step 3-delta escape hatch.
- Importing or detaching Figma templates.
- Rendering variant sections, tables, header fields, or preview instances.
- Calling `setExplicitVariableModeForCollection` on preview wrappers.
- Visual validation screenshots.
- Re-reading `uspecs.config.json` — the orchestrator passes `mcpProvider` directly.

## Quality Guarantee

If the produced JSON is missing variants, has incorrect axis classification, mismatched composite breakdowns, or wrong mode resolution, the bug is either:

1. In the reasoning here (fix in both this skill and `create-color`), or
2. In `_base.json` from the uSpec Extract plugin (fix the plugin's phase code, never duplicate extraction logic here).
