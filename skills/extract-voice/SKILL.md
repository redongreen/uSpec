---
name: extract-voice
description: Interpret a component's screen-reader accessibility spec (focus order, merge analysis, per-state platform tables for VoiceOver/TalkBack/ARIA, slot insertion plans) from the `_base.json` produced by the uSpec Extract Figma plugin, and write the normalized JSON to disk. Read-only interpretation — no Figma calls except an optional tiny delta script.
---

# Extract Voice / Screen Reader Data

Interpretation-only companion to `create-voice`. This skill **does not extract data from Figma**. It reads `{cachePath}/{componentSlug}-_base.json` (produced by the uSpec Extract Figma plugin), applies the same reasoning layer as `create-voice`, and writes the finalized `VoiceSpecData` object to disk for the `create-component-md` orchestrator.

**Quality contract:** every reasoning step (visual parts listing, merge analysis, focus-stop counting, state grouping with `A11Y_AXES` filter, behavioral state detection, slot scenario selection, state-to-variant mapping, platform section population, audit) mirrors `create-voice/SKILL.md` and its platform reference files.

**Batch-mode contract.** This skill MUST NOT call `AskQuestion`, prompt for confirmation, or pause for user input. Behavioral states are inferred from `optionalContext` and platform defaults; if a state can't be inferred, omit it rather than asking. On missing `_base.json` sections, abort with a single-line diagnostic. No mid-interpretation clarifications.

## Invocation Contract

The orchestrator calls this skill with these inputs (already resolved — do NOT re-parse URLs or re-read `uspecs.config.json`):

- `componentSlug` — filename-safe slug
- `cachePath` — cache directory, typically `.uspec-cache/{componentSlug}/`
- `optionalContext` — free-form user context. **Especially important for voice specs** — behavioral states ("single-select vs multi-select", "collapsed vs expanded", "validation error") are typically only discoverable from user context.
- `mcpProvider` — `figma-console` or `figma-mcp` (only needed if a Step 3-delta escape hatch fires AND a live Figma link was provided to the orchestrator)
- `deltaAvailable` — boolean. When the orchestrator received only a `baseJsonPath` (no `figmaLink`), this is `false` and the Step 3-delta escape hatch must not fire; log the gap in `data._deltaExtractions[]` with `unavailable: "no-figma-link"` and continue with best-effort output.
- `apiDictionaryPath` — absolute or workspace-relative path to `{cachePath}/{componentSlug}-api-dictionary.json`. Optional. When present, the file is the canonical vocabulary for axis/value/sub-component/state naming (see Step 2.5). When absent, the skill continues with `_dictionaryUnavailable: true` in its output envelope.

`fileKey` and `nodeId` are **not** pass-through parameters anymore. Read them from `{cachePath}/{componentSlug}-_base.json._meta.fileKey` and `_meta.nodeId` at the start of Step 1.

**Output:**

- Writes `{cachePath}/{componentSlug}-voice.json` with a `{ _meta, data }` envelope. `data` follows the `VoiceSpecData` shape (`componentName`, `guidelines`, optional `focusOrder`, `states[]`).
- Returns a single-line summary: `"Voice extracted: N focus stops, M states, platforms=[VoiceOver, TalkBack, ARIA] → {path}"`.
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
- [ ] Step 1: Read instruction and platform reference files
- [ ] Step 2: Load _base.json and optionalContext
- [ ] Step 2.5: Load API dictionary (canonical vocabulary) — optional
- [ ] Step 3: Build working evidence set (elements, slotDefs, slotVisibility from _base.json)
- [ ] Step 3-delta: OPTIONAL — read-only Figma call if a fact is genuinely missing
- [ ] Step 4: Visual parts, merge analysis, focus stops, states, slot scenarios
- [ ] Step 5: Generate VoiceSpecData (guidelines, focusOrder, states with 3 platform sections)
- [ ] Step 6: Audit (re-read instruction file)
- [ ] Step 7: Write JSON to cache and return one-line summary
```

### Step 1: Read References

Read these files before generating output:
- [agent-screenreader-instruction.md]({{ref:screen-reader/agent-screenreader-instruction.md}}) — main instructions
- [voiceover.md]({{ref:screen-reader/voiceover.md}}) — iOS VoiceOver patterns
- [talkback.md]({{ref:screen-reader/talkback.md}}) — Android TalkBack patterns
- [aria.md]({{ref:screen-reader/aria.md}}) — Web ARIA patterns

These are the **same** references used by `create-voice`. They are the single source of truth for the `VoiceSpecData` schema, merge analysis, state grouping, announcement patterns, and the Validation Checklist.

#### Rendering-only sections to skip

The shared instruction file describes both extraction and Figma rendering. This skill only performs interpretation — ignore guidance below. The data schema and audit checklists still apply.

- **§Analysis Process — "The rendering script uses visibility-aware focus stop resolution for the Focus Order artwork…"** — rendering path. The preceding guidance about flagging conditional focus stops still applies.
- **§Validation Checklist — the entire "After Rendering in Figma" sub-section** — rendering-only. Replace in-mind with the extraction-side audit in Step 6.
- **§Validation Checklist — the "Before Rendering in Figma" sub-section** — DO still apply.
- **§Examples — narrative references to rendered output** — example data shapes still apply; rendered-table narration is irrelevant.

Note: Fields that look like rendering config but are part of the output schema (e.g., `slotInsertions`, `focusOrder.tables`, `variantProps`, per-state `sections`) must still be populated.

### Step 2: Load `_base.json`

Read `{cachePath}/{componentSlug}-_base.json`. If missing or required sections are `null`, abort with a diagnostic asking the user to re-run the uSpec Extract plugin.

Top-level keys this skill consumes:

- `component` — for `componentName` and `compSetNodeId`
- `variantAxes` — for `A11Y_AXES` filtering and state-to-variant mapping
- `defaultVariant` — for default variant properties
- `propertyDefinitions.booleans` — for boolean defaults
- `propertyDefinitions.slots` — for `slotDefs` including `defaultChildren`, `preferredInstances`
- `variants[<default>].treeFlat` — **primary evidence source** for voice. Ordered focus-order candidates with `bbox`, `slotIndex`, `nodeType`, `visible`.
- `variants[<default>].treeHierarchical` — optional supporting evidence when `treeFlat` needs disambiguation.
- `ownershipHints[]` where `evidenceType === "textNode"` — text-node hints useful for announcement authoring.
- `_extractionNotes.warnings`

Also absorb `optionalContext` as authoritative (voice especially depends on user-described behavioral states).

### Step 2.5: Load API dictionary (canonical vocabulary)

The `create-component-md` orchestrator writes `{cachePath}/{componentSlug}-api-dictionary.json` alongside `_base.json` after `extract-api` finishes. When present, this file is the **canonical vocabulary** for axis names, value names, sub-component names, and state runtime conditions. See the **`ApiDictionary` artifact** section in [api/agent-api-instruction.md]({{ref:api/agent-api-instruction.md}}) for the schema.

**Resolution order:**

1. If the orchestrator passed `apiDictionaryPath`, read that file.
2. Otherwise look for `{cachePath}/{componentSlug}-api-dictionary.json` on disk.
3. If neither resolves (e.g., the skill is being run standalone), continue with existing behavior but set `data._dictionaryUnavailable = true` on the output envelope.

**How this skill uses the dictionary** (keep it in scope through Steps 3–5):

- **State names.** When emitting `states[].state`, prefer the dictionary's canonical axis value names. When the dictionary is decomposed (a `states[]` entry exists with `runtimeCondition`), use the **runtime condition** as the state name — e.g., `"focused"` rather than `"active"`, `"validationState='error'"` rather than `"error"`. This keeps the voice spec aligned with the engineer-facing condition an implementer can check at runtime.
- **Behavioral state cross-check.** Every behavioral state you extract from `optionalContext` should map to a dictionary-listed value when one exists. If it does not, that is not necessarily a bug (voice often surfaces runtime states the API doesn't model), but emit a `_dictionaryMismatch` entry so the orchestrator's Step 8.5 can confirm.
- **Slot / sub-component names** inside focus stops — prefer `dictionary.subComponents[].name` over raw Figma layer names.

**Mismatch protocol — do NOT silently rename, do NOT silently keep.**

When your evidence (the focus walk, state grouping, or user-described behavioral states) contradicts the dictionary — for example, the dictionary lists a state value you cannot derive focus behavior for, or you documented a state value the dictionary did not list — emit the observed value AND attach a `_dictionaryMismatch` annotation:

```json
{
  "observed": "<what you measured / observed>",
  "dictionary": "<what the dictionary named; null when the dictionary listed a value you couldn't find>",
  "kind": "value-missing" | "value-extra" | "name-drift",
  "note": "<short rationale; ≤160 chars>"
}
```

Aggregate every mismatch into `data._extractionArtifacts.dictionaryMismatches[]`. The orchestrator's Step 8.5 reconciliation pass consumes this list.

**Retry semantics — the orchestrator may re-dispatch this skill.**

When `optionalContext` begins with the literal prefix `create-component-md retry: `, the rest of the string is an authoritative scope expansion from the orchestrator's Step 8.5 reconciliation step. Parse it as a comma-separated list of state values / sub-components the dictionary exposed but this skill previously did not cover. The retry run MUST emit evidence for every listed item — either a real `states[]` entry citing variant/behavioral evidence, or an explicit `_dictionaryMismatch` entry explaining why no evidence could be gathered. Never silently drop a listed item.

### Step 3: Build Working Evidence Set

Populate the voice evidence structure by reading **only** from `_base.json`. Key mappings:

| Evidence field | `_base.json` source |
| -------------- | ------------------- |
| `componentName` | `component.componentName` |
| `compSetNodeId` | `component.compSetNodeId` |
| `elements[]` | `variants[<default>].treeFlat` — array already contains `{ index, name, nodeType, visible, bbox, slotIndex? }`. Use as-is. |
| `variantAxes[]` | `variantAxes` — already shaped `{name, options, defaultValue}` |
| `booleanDefs` | `propertyDefinitions.booleans` → reshape as `{ rawKey: defaultValue }` |
| `slotDefs[]` | `propertyDefinitions.slots[*]` — each has `name` (`propName`), `description`, `preferredInstances` (resolved `componentKey`/`componentName`, and when available `defaultVariantProperties` + `booleanDefaults`), `defaultChildren` (with `mainComponentId`, `componentSetName`, `contextualOverrides`), and when the SLOT node has a `componentPropertyReferences.visible` binding, the precomputed `visibleRawKey` + `visiblePropName`. If `visibleRawKey` is absent, fall back to walking `rawDefs` for any BOOLEAN property whose `associatedLayerName` matches the slot name. |
| `slotVisibility` | Map of `slotName → visibleRawKey`, read directly from `propertyDefinitions.slots[*].visibleRawKey`; fall back to the `associatedLayerName` walk if absent. |

**No Figma calls** are needed for this step.

### Step 3-delta (optional, read-only)

If `propertyDefinitions.slots[*].visibleRawKey` is absent **and** the `associatedLayerName` fallback failed to find a match — or if a preferred-instance's variant axes / boolean defaults are still missing after checking `preferredInstances[*].defaultVariantProperties` and `.booleanDefaults` (e.g., for a deeper variant-axis dimension not captured by the default-variant snapshot) — issue a small `figma_execute` / `use_figma` call scoped to that fact.

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

### Step 4: Visual Parts, Merge Analysis, Focus Stops, States

Using evidence from Step 3:

**A. List all visual parts** per the instruction file (Step 1).

**B. Merge analysis** — classify each visual part as: focus stop, merged into parent, live region, or decorative. Follow the instruction file (Step 2).

**C. Count actual focus stops** — determines whether `focusOrder` is needed (2+ stops) or not (1 stop).

**D. Grouping structure** — apply the diagnostic questions from the instruction file. Does a container need its own semantics?

**E. States** — list all states to document. Note if focus order changes between states (e.g., error state adds a live region).

**E-bis. State grouping — collapse states with identical accessibility semantics.** Filter `variantAxes` using `A11Y_AXES` pattern `/state|mode|interaction/i` to identify axes that may affect accessibility semantics (skip purely visual axes like Size, Shape, Theme). Then apply the state-grouping rules from the instruction file (Step 4) to collapse states with identical screen reader behavior.

**E-ter. Behavioral states from user context.** Identify behavioral states per the instruction file (Step 4). Map each to default variant props. Behavioral states typically come from `optionalContext`.

**E-quater. Slot scenario selection.** When a focus stop lives inside slot content, decide whether the documented scenario should use the slot's default child content or a preferred interactive fill. Inspect `slotDefs` for `defaultChildren`, `preferredInstances`, and `visiblePropName`. If the default slot content already exposes the documented focus stop, prefer that. If the focus stop only exists when the slot is populated with a different interactive component, choose a representative preferred instance and record a slot insertion plan `{ slotName, componentNodeId, nestedOverrides?, textOverrides? }` for the focus-order entry and any affected states.

**F. State-to-variant mapping.** Using `variantAxes`, map each documented state to `{ [axisName]: value }`. Match state names to variant axis options (case-insensitive). When a state name matches an option on a variant axis, set that axis to the matching value; leave other axes at defaults. When no match (e.g., behavioral state "focused"), use the default variant properties. Save as `stateVariantProps`. In parallel, carry `slotInsertions` into state objects that need slot population beyond defaults.

### Step 5: Generate `VoiceSpecData`

Follow the schema in the instruction file. Build the data as:

- `componentName`: string
- `guidelines`: string — general accessibility guidelines for this component
- `focusOrder`: object (optional, only when 2+ focus stops):
  - `title`: exactly `"Focus order"`
  - `description`: string (optional)
  - `tables`: array, each with `name`, `announcement`, `properties: { property, value, notes }[]`, `focusOrderIndex` (1-based reading order)
  - `slotInsertions`: `SlotInsertion[]` (optional) — slot population plan for the Focus Order preview
  - `variantPropsForRichestPreview`: `Record<string, string>` (optional) — variant axis values that naturally show the most focus stops in a single preview
- `states`: array, each with:
  - `state`: string (e.g., `"enabled"`, `"disabled"`, `"error"`)
  - `description`: string (optional)
  - `variantProps`: `Record<string, string>` — from `stateVariantProps`
  - `slotInsertions`: `SlotInsertion[]` (optional)
  - `sections`: array of exactly 3 platform sections:
    - `title`: one of `"VoiceOver (iOS)"`, `"TalkBack (Android)"`, `"ARIA (Web)"` — exact strings
    - `tables`: array, one per focus stop / component part, each with `name`, `announcement`, `focusOrderIndex`, `properties: { property, value, notes }[]`

`SlotInsertion`: `{ slotName, componentNodeId, nestedOverrides?, textOverrides? }`. `componentNodeId` may point to a local `COMPONENT` or `COMPONENT_SET`; when a set, instantiate its default variant. Apply all overrides **before** `appendChild` into the slot.

For per-state `FOCUS_STOPS` reasoning:
- Use the same focus stops as the focus order entry, unless the state changes the focus order.
- For states where the component is entirely removed from the focus order (e.g., Disabled at the component level), the state carries zero focus stops but still includes its 3 platform sections documenting that the component is inert.

### Step 6: Audit (tick-mark checklist)

Run **every** check below against your assembled `VoiceSpecData`. An unchecked box is a blocker — fix the output before writing the cache file. Return the checklist verbatim in your final summary so the orchestrator can aggregate it into the "Known gaps" block.

```
- [ ] Every state has exactly 3 platform sub-sections: VoiceOver (iOS), TalkBack (Android), ARIA (Web)
- [ ] Every focus stop has focusOrderIndex set, starting at 1 and matching reading-order position
- [ ] No merged / decorative / live-region part is listed as a focus stop
- [ ] Section titles match verbatim: "Focus order", "VoiceOver (iOS)", "TalkBack (Android)", "ARIA (Web)"
- [ ] Behavioral states are backed by optionalContext or well-established platform defaults (never invented)
- [ ] Every slot insertion plan has `slotName`, `preferredInstanceName`, and `platformInsertionRules` for all three platforms
- [ ] Merge analysis is present: every visual part is classified as focus stop, merged, live region, or decorative
- [ ] _deltaExtractions[] records every Step 3-delta call that fired this run (empty array if none)
- [ ] _base.json._extractionNotes.warnings were surfaced in the summary if non-empty
- [ ] When the API dictionary was loaded, every state name matches a `dictionary.states[].runtimeCondition` (preferred) or `figmaValue` OR carries a `_dictionaryMismatch` entry.
- [ ] When `_dictionaryUnavailable` is true, the output envelope records it so the orchestrator can downgrade confidence.
```

### Step 7: Write Cache and Return

Write the finalized `VoiceSpecData` as pretty-printed JSON to `{cachePath}/{componentSlug}-voice.json`. Envelope:

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
    "guidelines": "<string>",
    "focusOrder": { /* optional */ },
    "states": [ /* VoiceSpecData.states */ ],
    "_deltaExtractions": [ /* 0+ entries */ ],
    "_dictionaryUnavailable": false /* true when Step 2.5 could not locate the api-dictionary.json */,
    "_extractionArtifacts": {
      "compSetNodeId": "<id>",
      "variantAxes": [ /* raw */ ],
      "booleanDefs": { /* raw */ },
      "elementsSummary": [ { "index": 1, "name": "...", "nodeType": "...", "visible": true } ],
      "slotDefsSummary": [ { "propName": "...", "visiblePropName": "...", "preferredInstanceNames": ["..."], "defaultChildNames": ["..."] } ],
      "slotVisibility": { "...": "..." },
      "focusStopsCount": <N>,
      "statesCount": <M>,
      "dictionaryMismatches": [ /* 0+ entries — see Step 2.5 mismatch protocol */ ]
    }
  }
}
```

Return:

```
Voice extracted: <N> focus stops, <M> states, platforms=[VoiceOver, TalkBack, ARIA] → <cachePath>/<componentSlug>-voice.json
```

Where `N` = `focusStopsCount`, `M` = `statesCount`, platforms is always the exact literal `[VoiceOver, TalkBack, ARIA]`.

Append `(warnings: <W>)` if `_base.json._extractionNotes.warnings` is non-empty.

## Not In Scope

- Extracting from Figma beyond the Step 3-delta escape hatch.
- Importing or detaching Figma templates.
- Rendering Focus Order artwork or per-state platform sections in Figma.
- Applying `SLOT_INSERTIONS` to live preview instances — slot insertion plans are recorded for future consumers.
- Visual validation screenshots.
- Re-reading `uspecs.config.json` — the orchestrator passes `mcpProvider` directly.

## Quality Guarantee

If the produced JSON is missing focus stops, has incorrect state grouping, or contains announcements that violate platform conventions, the bug is either:

1. In the reasoning here (fix in both this skill and `create-voice`), or
2. In `_base.json` from the uSpec Extract plugin (fix the plugin's phase code).
