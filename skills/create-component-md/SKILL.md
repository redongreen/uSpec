---
name: create-component-md
description: Generate a single self-contained markdown specification for a Figma component covering API, structure, color, and screen-reader behavior. Reads a `_base.json` produced by the uSpec Extract plugin, runs four read-only interpretation skills in parallel, reconciles their outputs, and writes one `.md` to disk. Use when the user mentions "component md", "component markdown", "spec md", "source of truth", "create-component-md", or wants a portable Markdown spec that any LLM can build from.
---

# Create Component Markdown (Orchestrator)

This skill consumes a `_base.json` produced by the uSpec Extract Figma plugin (`figma-plugin/`), runs four **read-only interpretation** skills (`extract-api`, `extract-structure`, `extract-color`, `extract-voice`), and renders their combined output into one self-contained Markdown file. The `.md` is the artifact; Figma is only the source of extraction.

**Do not call the `create-*` skills from here.** They render Figma frames that overlap and do not compose into a single file.

## Why this orchestrator exists

The four `create-*` skills each cost ~100k tokens per run because the majority of their weight is Figma rendering (`setProperties`, `createInstance`, `loadFontAsync`, layout math). The `extract-*` skills strip all rendering. Because the Figma plugin produces a single shared `_base.json`, the four interpretation skills also stop calling Figma — they read that file from disk. This removes most of the Figma-side work and keeps the orchestrator's parent context small by discarding each phase's detail after its one-line summary lands.

**Token model (approximate):**

| Phase | Peak context in parent |
|---|---|
| extract-api (runs first, inline) | instruction + `_base.json` read + interpretation |
| parallel fan-out (structure + color + voice, subagent each) | three one-line summaries (subagents hold their own context) |
| reconciliation (Step 8.5) | mismatch lists + api dictionary (small) |
| rendering | 4 JSON cache files + template + instruction |

`extract-api` runs first in the parent so its dictionary can steer the three downstream specialists. After the dictionary lands, the parent dispatches `extract-structure`, `extract-color`, and `extract-voice` as three **parallel subagents** (`subagent_type=generalPurpose`, single batch). Each subagent holds its own `_base.json` + dictionary context; the parent keeps only the returned one-line summaries and cache-file paths.

## Inputs Expected

- **`baseJsonPath`** (required): absolute or workspace-relative path to the `_base.json` file produced by the uSpec Extract Figma plugin. Must validate against [figma-plugin/docs/base-json-schema.md]({{repo:figma-plugin/docs/base-json-schema.md}}). If this is not provided, abort and instruct the user to run the uSpec Extract plugin (see `figma-plugin/README.md`).
- **`figmaLink`** (optional): URL to the component set or standalone component. Accept `figma.com/design/:fileKey/...` and branch URLs (`/branch/:branchKey/`). Only consulted if an interpretation skill needs a Step 3-delta MCP call.
- **`optionalContext`** (optional): free-form guidance (e.g., "this is a compact variant only", "skip error states"). If the plugin already captured it in `_meta.optionalContext`, that wins; otherwise the value passed here is used. Forwarded verbatim to every sub-skill.

No output path is required — the default is `./components/{componentSlug}.md` in the current working directory.

## Workflow

Copy this checklist and update as you progress:

```
Task Progress:
- [ ] Step 1: Preflight — read config, load + validate _base.json, resolve metadata from _meta
- [ ] Step 2: Resolve componentSlug and output path
- [ ] Step 3: Announce the plan
- [ ] Step 3.5: Composition classification (reasoning gate — internalize before Step 4.5 review)
- [ ] Step 4: Stage _base.json into cachePath
- [ ] Step 4.5: Post-extract review — confirm _childComposition (user-selected classifications skip override pass)
- [ ] Step 5: Run extract-api (reads _base.json, no Figma), flush, verify cache + api-dictionary.json
- [ ] Step 6: Parallel fan-out — dispatch extract-structure, extract-color, extract-voice as three subagents in a single batch; join on all three summaries
- [ ] Step 8.5: Reconciliation — typed disagreement handling with bounded serial retries
- [ ] Step 9: Render the .md (follow {{ref:component-md/agent-component-md-instruction.md}})
- [ ] Step 9.5: Integrity check — validate all cache files and reconciliation artifact before rendering
- [ ] Step 10: Audit output and return a one-line summary
- [ ] Step 10.5: Emit recursion manifest (constitutive children only)
```

### Step 1: Preflight

Read `uspecs.config.json` at the project root. Extract:

- `mcpProvider` (`figma-console` or `figma-mcp`). Only used if `figmaLink` is also provided AND an interpretation skill's Step 3-delta triggers.
- `environment` (used only if you need to emit provider-specific guidance).

**Load and validate `_base.json`.** `baseJsonPath` is required. If it is missing, abort with a one-line diagnostic: "run the uSpec Extract plugin in Figma and rerun with `baseJsonPath=<path>` — see `figma-plugin/README.md`."

- Read the file.
- Run the Ajv schema check at `figma-plugin/scripts/validate-base.mjs` (shell out with `node figma-plugin/scripts/validate-base.mjs <path>`) — any non-zero exit aborts with the validator's FAIL output.
- On success, read `_meta.fileKey`, `_meta.nodeId`, `_meta.componentSlug`, `_meta.optionalContext`, `_meta.extractionSource`.
- If the caller also passed `optionalContext` and `_meta.optionalContext` is null, stamp it onto the loaded base.
- The MCP connection check is deferred — it is not needed unless a sub-skill triggers a delta.

If `figmaLink` is also passed alongside `baseJsonPath`, parse it and stash `{fileKey, nodeId}` for potential delta use — but trust `_meta` as the source of truth when they disagree and log a `META_DISAGREES_WITH_LINK` warning for the final summary.

### Step 2: Resolve componentSlug and output path

1. Resolve the component name from `_meta.componentSlug` (plus `component.componentName` for display). No MCP call needed.
2. Resolve `outputPath`:
   - If user passed an explicit path, use as-is.
   - Otherwise, `./components/{componentSlug}.md` in cwd. Create the `./components/` directory (recursive mkdir) if it does not exist — the `components/` folder is tracked in version control (it holds the source-of-truth `.md` specs).
3. Resolve `cachePath = .uspec-cache/{componentSlug}/`. Create it (recursive mkdir). `.uspec-cache/` is gitignored.

**Do not proceed until all of `componentSlug`, `outputPath`, `cachePath` are resolved.** Every subsequent step reads from them.

### Step 3: Announce the plan (non-blocking)

Print a single informational message to the user and then **immediately continue** to Step 4. Do **not** call `AskQuestion`. Do **not** wait for input. The chain runs start-to-finish without interruption.

> Generating Markdown source of truth for **{ComponentName}** (`{nodeId}`).
>
> Running 4 interpretation passes (API → Structure → Color → Voice) against the provided `_base.json`. Cache: `{cachePath}`. Output: `{outputPath}`.
>
> No phase touches Figma unless an interpretation skill's Step 3-delta fires (read-only). Every pass flushes to disk to stay under token budget.

If the user wants to correct the target node or the extraction context, they must cancel this run and start a new one with different inputs. There is no mid-chain correction point.

### Step 3.5: Composition classification (reasoning gate)

Before you interpret any of the extracted data, you must internalize how to classify every top-level child instance of the component being spec'd. This classification decides how each child appears in the final `.md` and whether a follow-up `create-component-md` run is needed. The mechanics of reading `_childComposition` happen at Step 4.5 (after `_base.json` lands). This step is the *reasoning model* you carry into that review.

Ask this question, in order, for each top-level child instance you will see in `variants[<default>].treeHierarchical`:

**Q1. If I removed this child, would the component still be the thing the user is asking me to spec?**

- No → **constitutive** (part-of). It is part of what this component *is*. Spec it.
- Yes → continue to Q2.

**Q2. Does this child have a name/identity that a different consumer would recognize and use independently in a different context?**

- Yes → **referenced** (uses-a). It is a self-contained component this one happens to embed. Name it and document the configuration passed to it; do not re-spec it.
- No → **decorative** (has-no-identity). A vector, glyph, or layout frame. Fold into structure or color inline.

#### Patterns to match against, with one illustration each

The column you should pattern-match on is **Pattern** — the shape of the relationship. The `Illustration` column is one concrete example so you can anchor the shape; **the agreement is with the pattern, not the specific names**. When you spec any component, ask: which of these patterns does each child match?

| # | Pattern | Classification | Illustration (one of many) |
|---|---|---|---|
| P1 | Child is a fixed, named anatomical part of the parent. Remove it and the parent loses a defined slot in its own anatomy, not just a feature. | **constitutive** | A form control's "helper text" row. Without the row, the control's anatomy no longer matches its own definition. |
| P2 | Child's name is only meaningful *inside* the parent (e.g., `ParentName` + role suffix like `Item`, `Row`, `Cell`, `Step`, `Tab`, `Segment`, `Panel`). The child was designed to live inside this parent and nowhere else. | **constitutive** | A list-like parent whose repeated child is named after the parent's role taxonomy (e.g., the repeated "item" of a list-navigation component). |
| P3 | Child is a component the parent reuses from elsewhere to fulfill one of its own anatomical roles — the parent *is not a button / icon / input*, but it contains one because its definition requires that role to be filled. The child has its own spec. | **referenced** | A composite control that hosts a standard button in its action row. The composite is not a kind of button; it uses one. |
| P4 | Child is a generic system primitive (icon, divider, loading indicator, avatar, badge) that multiple unrelated components embed. Its identity is orthogonal to the parent. | **referenced** | Any component that embeds an instance from the design system's icon set. The icon has its own spec; the parent documents only *which* glyph and *when*. |
| P5 | Child is a peer component the parent composes alongside its own behavior — the parent could exist without it, but in this usage chooses to embed it. | **referenced** | A layout/form-style component that embeds N independent controls. The parent documents the layout contract; each embedded control keeps its own spec. |
| P6 | Child is a pure vector, text layer, or auto-layout frame with no component identity at all. | **decorative** | A decorative glyph drawn directly on the canvas (not an instance of anything). Document its fill/size inline. |
| P7 | Child is an instance-swap target (`INSTANCE_SWAP` property) whose concrete fill is consumer-provided. The parent defines the **slot contract** but does not own any particular instance. | **referenced** (document the contract) | Any component with a swap-able icon/avatar/thumbnail slot. Parent documents "accepts: Icon (size=M)"; each concrete consumer passes a different instance. |
| P8 | Child is a component whose name could stand alone in the design system catalog without referencing the parent. If you found this child on its own page, would you still know what it is? Yes → it is a referenced component, not a constitutive one, even if the current parent depends on it. | **referenced** | Any widely-reused primitive — buttons, inputs, menus, tooltips, popovers — embedded into a more specific composition. |

#### How to apply the patterns

Most children match exactly one pattern, and the classification follows. For the stubborn cases:

- **P1 vs. P2.** Both are constitutive. Distinction matters only for rendering: P1 children that are **not** themselves component sets fold into sub-component tables; P2 children (which usually are component sets, repeated) emit a recursion entry.
- **P2 vs. P8.** This is the sharpest judgment call. Run the standalone-catalog test: "If I saw this child's main component in the design system catalog with no parent context, would its name and purpose be self-explanatory?" If yes → P8 (referenced). If it would be confusing without parent context → P2 (constitutive). *Name suffixes like `Item`, `Row`, `Cell`, `Step`, `Tab`, `Segment` are strong P2 signals; names that match common design-system primitives are strong P8 signals.*
- **P3 vs. P5.** Both are referenced. The difference is intent: P3 says "the parent's anatomy requires this role to be filled by some reusable component" (the role is inherent to the parent); P5 says "the parent embeds arbitrary other components as its content" (like a modal hosting whatever the consumer passes). When unclear, default to P5 — it makes the fewest ownership claims.
- **P4 vs. P6.** If the child is an `INSTANCE` whose main component has a name, it's P4 (referenced). If it is a raw vector / frame / text node with no main-component reference, it's P6 (decorative).

#### Anti-patterns — failure modes to catch yourself doing

**A1. Waiting for the color-extraction "container hint."** The `_containerRerunHint` emitted by `extract-color` is a *symptom* (all visible colors live on sub-components), not a *cause*. By the time it fires you have already processed API, Structure, and Color under the wrong mental model and are one step away from writing property tables that belong to children. Classify at Step 3.5 (and confirm at Step 4.5) so every downstream interpretation runs with the right frame.

**A2. Type-based shortcutting.** Do not classify on the `COMPONENT_SET` / `COMPONENT` type alone. Many referenced primitives (P3, P4, P8) are also component sets, and many constitutive parts (P1) are not. The type is evidence, not the decision — always run Q1 and Q2.

**A3. Copying child properties into the parent API.** When a child is referenced (P3/P4/P5/P7/P8), do not lift its property table into the parent's `## API` section. The parent documents the **configuration it passes** to the child, not the child's full surface. The child's own spec is the source of truth for its properties.

**A4. Over-recursing.** Just because a child is itself a `COMPONENT_SET` does not mean the parent's spec is incomplete without a dedicated child-spec run. If the child is referenced, the child already has (or will have) its own spec — one independent of this parent. Only constitutive children (P1/P2) drive the recursion manifest.

**A5. Under-recursing on name coincidence.** Do not skip recursion on a constitutive child just because its name matches a generic word. A child named `Row` nested inside a specific tabular parent, with no existence outside it, is still P2 — even though "Row" sounds generic. Run the standalone-catalog test (see "P2 vs. P8"), not the word-recognition test.

#### What each classification produces

- **Constitutive** → If the child is not itself a `COMPONENT_SET`, fold it into the parent's sub-component tables (current Step 5 behavior). If the child **is** a `COMPONENT_SET`, emit a "recurse" entry in Step 10.5's manifest. Either way, its properties are part of the parent's API section.
- **Referenced** → Emit a `Referenced components` subsection in the parent `.md`'s API body. One entry per referenced component containing: name, variant/props passed, Figma node ID of the referenced component set, and a link to its spec (expected path: `./{referenced-slug}.md`). **Do not include its property table.** The referenced component's `.md` is its own source of truth.
- **Decorative** → No entry. Shows up naturally in Structure dimensions and Color tokens.

#### What to do with ambiguity

If Q1 and Q2 produce contradictory answers, default to **referenced** and log the reasoning in `_base.json._childComposition.ambiguousChildren[]` (Step 4.5 persists this back to disk). Over-referencing is safer than over-spec'ing — a referenced child's spec can be promoted to constitutive later; a child whose property table has been mistakenly copied into the parent is much harder to disentangle.

### Step 4: Stage `_base.json` into the cache

1. Copy the file at `baseJsonPath` to `{cachePath}/{componentSlug}-_base.json`. If the source is already inside `{cachePath}` (user already moved it), skip the copy.
2. If the caller passed an `optionalContext` and `_meta.optionalContext` is null, update the copied file's `_meta.optionalContext` in place. This is the **only** mutation the orchestrator may do to `_base.json` at this step; the Step 4.5 `_childComposition` rewrite is the other.
3. Emit a one-line summary:

   ```
   base: variants=<V>, bytes=<B>, warnings=<W> → {cachePath}/{componentSlug}-_base.json
   ```

   `V` and `B` come from `variants.length` and the serialized byte count; `W` from `_extractionNotes.warnings.length`.
4. **Flush phase context.** Keep only: `_base.json` path + the one-line summary.
5. Verify the file has `_meta`, `component`, `variantAxes`, `propertyDefinitions`, `variants[]`, `ownershipHints[]`, `_childComposition`. `crossVariant` is allowed to be `null` (single-variant-axis component). If any required top-level key is missing, abort with a diagnostic asking the user to re-run the uSpec Extract plugin.
6. If `_extractionNotes.warnings.length > 0`, surface the warnings to the user before continuing. Common codes include `HIERWALK_MISSING_CHILDREN` and walk-validation warnings like "Walked tree is missing children for constitutive instance(s)" — both mean the `.md` may be incomplete and the user should re-extract with a corrected selection.

### Step 4.5: Post-extract review (composition classification)

Read `_base.json._childComposition`. The plugin UI asks the designer to resolve every top-level child instance at extraction time, so every entry in `children[]` carries `classificationEvidence: ["user-selected"]` and `ambiguousChildren[]` is empty by construction.

Treat the designer's choice as authoritative and **skip the override pass entirely**. Briefly cross-check by running Q1 from Step 3.5 on each entry — if any obviously wrong assignment jumps out (e.g., a generic Icon instance marked `constitutive`), raise it as a warning to the user in the Step 10 summary but leave the `_childComposition` untouched. The designer's choice wins; the orchestrator's job is to surface, not override.

If `_childComposition.children[]` contains entries without `user-selected` evidence, or if `ambiguousChildren[]` is non-empty, the file is malformed (the plugin UI did not reach the designer's confirmation step). Flag it as a warning and apply the Step 3.5 reasoning model to resolve each entry before continuing:

1. For each child in `children[]`, read `classification` and run Q1/Q2 from Step 3.5. If the classification is wrong, override it and append `"agent-override"` to `classificationEvidence[]`.
2. Walk `ambiguousChildren[]`. For each entry, make a decision via Q1/Q2 and the P1–P8 patterns, then **move** the entry into `children[]` with the resolved `classification`. On uncertainty, default to `referenced` and note the reasoning in `classificationReason`.
3. Persist the revised `_childComposition` back to `{cachePath}/{componentSlug}-_base.json`. This is the one explicit exception to the "`_base.json` is immutable" invariant.

Flush the review's working context. Keep only: the final classification counts (`constitutive=N, referenced=M, decorative=K, ambiguous=0`) as a one-line summary. Downstream interpretation skills will read the updated `_childComposition` from disk.

If `constitutive > 0` **and** every constitutive child has a non-null `subCompSetId`, this is a composition-heavy parent — Step 10.5's manifest will emit follow-up runs. If `referenced > 0`, the rendered `.md` will include a `### Referenced components` subsection (see Change 4 / `{{ref:component-md/agent-component-md-instruction.md}}`).

### Step 5: Run extract-api (inline, in the parent)

Follow `.cursor/skills/extract-api/SKILL.md` inline (not as a subagent — the parent needs the resulting dictionary directly). Pass `cachePath`, `componentSlug`, `optionalContext`, `deltaAvailable` (true only when the user provided a `figmaLink`), and — when `deltaAvailable` is true — `fileKey`, `nodeId`, and `mcpProvider` (from `uspecs.config.json`). When the input is plugin-only (no `figmaLink`), explicitly instruct the skill that delta calls are **not available** — any gap surfaces as `_deltaExtractions[]` with `unavailable: "no-figma-link"`.

The skill:

- Reads `_base.json` from disk (no fresh Figma walk).
- Optionally issues a tiny Step 3-delta call when `deltaAvailable` is true and a fact is genuinely missing.
- Writes `{cachePath}/{componentSlug}-api.json`.
- **Writes `{cachePath}/{componentSlug}-api-dictionary.json`** (Step 7.5 of `extract-api`) — the canonical vocabulary projected from api.json.
- Returns a single-line summary ending with `(+ dictionary at <path>)`.

**Flush phase context.** Keep only: the two paths + one-line summary. Verify both files exist and have `_meta` + `data`. Abort with a diagnostic if the dictionary file is missing — the parallel fan-out requires it.

Set `apiDictionaryPath = {cachePath}/{componentSlug}-api-dictionary.json` for use in Step 6.

### Step 6: Parallel fan-out (extract-structure + extract-color + extract-voice)

With the API dictionary on disk, dispatch **three subagents in a single batch** using the `Task` tool, `subagent_type="generalPurpose"`. Each subagent runs exactly one extract skill, holds its own `_base.json` + dictionary context, and returns a single-line summary to the parent. The parent keeps only those three strings, never three full contexts.

**Mandatory invocation shape** (all three tool calls go in one assistant message — do NOT dispatch sequentially):

For each specialist in `[extract-structure, extract-color, extract-voice]`:

- `description` — 3–5 words (e.g., `"Structure pass for Button"`).
- `subagent_type` — `"generalPurpose"`.
- `run_in_background` — `false`. The parent must wait for all three returns before proceeding.
- `prompt` — a fully self-contained instruction with **these seven fields** (no prior chat context is available to the subagent):
  1. The absolute path to the extract skill's SKILL.md file (e.g., `.cursor/skills/extract-structure/SKILL.md`). Instruct the subagent to read it and follow every step.
  2. `componentSlug` (string).
  3. `cachePath` (string).
  4. `apiDictionaryPath` — the path produced by Step 5.
  5. `optionalContext` — the orchestrator's `optionalContext` string (or `"none"` when absent).
  6. `mcpProvider` — the value from `uspecs.config.json`.
  7. `deltaAvailable` — boolean. `false` when the user provided only a `baseJsonPath`.
  - Instruct the subagent to return a single-line summary matching the skill's declared return format, followed by the written cache path. Nothing else — not the full payload, not checklists, not screenshots.

**Expected return shapes (the parent parses these):**

- Structure: `Structure extracted: N sections, M sub-components, K slot contents → <path>`
- Color: `Color extracted: strategy=<A|B>, N sections, M unique tokens, modes=[...] → <path>`
- Voice: `Voice extracted: N focus stops, M states, platforms=[VoiceOver, TalkBack, ARIA] → <path>`

**Join before proceeding.** Wait for all three subagent returns. Do NOT advance to Step 8.5 until every return has landed. If any subagent fails (returns an error or no path), abort with a diagnostic naming the failing specialist — partial completion is never silently tolerated.

**Container hint collection.** After all three subagents return, open `{cachePath}/{componentSlug}-color.json` with a targeted read and check `data._containerRerunHint`. If non-null, surface it to the user:

> Container component detected: all color entries belong to sub-components (`<subCompSetNames joined>`). The rendered .md will document the parent only. For complete color coverage, see the Step 10.5 recursion manifest for the full set of follow-up runs.

Collect the hint for inclusion in the Step 10 final summary. Continue past this — do not abort.

**Flush phase context.** Keep only: the three cache-file paths + three one-line summaries. The subagents already discarded their internal context when they returned; the parent was never exposed to it.

### Step 8.5: Reconciliation (typed disagreement handling)

After the three specialist caches land and before the Step 9.5 integrity gate, run a deterministic reconciliation pass. This step is **typed dispatch, not reasoning** — it recognizes exactly 3 classes of disagreement between the dictionary and the specialist outputs, and dispatches the right response for each.

**Load the dictionary + the three mismatch lists.**

1. Read `{cachePath}/{componentSlug}-api-dictionary.json` (`ApiDictionary`).
2. Read the `data._extractionArtifacts.dictionaryMismatches[]` arrays from the three specialist caches (`structure.json`, `color.json`, `voice.json`). Missing or empty arrays are fine — they indicate the specialist agreed with the dictionary.
3. Read `reconciliation.autoRetry` from `uspecs.config.json` (default: `true` when the key is absent). When `false`, skip retries and surface coverage gaps directly as `high` Known-gaps entries. Still run auto-rewrites for vocabulary drift.

**Classify every mismatch** into one of three buckets:

| Class | Detection rule | Response |
|---|---|---|
| **Vocabulary drift** | Dictionary has `{axis.name, value.figmaValue, value.runtimeCondition}`; specialist emitted a column / label that matches `figmaValue` but the dictionary canonical is `runtimeCondition` (or vice versa — a simple rename). Or the specialist's sub-component name matches a dictionary `subComponents[].name` modulo casing / whitespace / suffix. | **Auto-rewrite in place.** Open the specialist's cache file, rewrite the drifted labels/columns/section names to the dictionary canonical, add a reconciliation log entry. No retry. |
| **Coverage gap (scope miss)** | Dictionary lists a value/sub-component/state that has no corresponding row/column/section in the specialist's cache AND the value exists somewhere in `_base.json` as real evidence (variant option, revealed sub-component, etc.). | **Re-dispatch the specialist as a single subagent** with `optionalContext = "create-component-md retry: <comma-list of missing items>"` prepended to the original `optionalContext`. Max 1 retry per specialist per invocation. After the retry returns, re-run this entire Step 8.5 from the top — a successful retry may resolve gaps that would otherwise trigger further retries. |
| **Semantic conflict** | Dictionary and specialist disagree on a fact that cannot be auto-rewritten (e.g., API declares `size: small \| medium \| large`; Structure measured `compact` + `regular` which have no `figmaValue` in the dictionary). | **Surface as `high` Known gap immediately.** NEVER auto-resolve. NEVER retry (a retry will not fix a semantic disagreement — it needs human judgment). |

**Retry loop (bounded, serial, no declared specialist priority):**

Maintain a retry counter per specialist (`structureRetries`, `colorRetries`, `voiceRetries`), each starting at 0 and capped at 1.

```
while (any specialist has unresolved coverage gaps AND its retryCount < 1 AND reconciliation.autoRetry is true):
  pick the next specialist with unresolved coverage gaps, in the original run order
    (Structure → Color → Voice); this is iteration order, NOT a priority relationship
  re-dispatch ONE specialist as a generalPurpose subagent (serial — never parallel)
    prompt includes the same invocation contract as Step 6, plus
      optionalContext = "create-component-md retry: <missing items>\n\n<original optionalContext>"
  wait for its return
  increment that specialist's retryCount
  re-read the specialist's cache (it overwrote its own file)
  re-run Step 8.5 classification on all three specialists
    — a successful retry may resolve gaps in other specialists too,
      shortening the retry chain
  loop back
```

**After the loop terminates** (no specialist has unresolved coverage gaps OR every specialist with one has already retried once):

- Any remaining coverage gap becomes a `high` Known-gaps entry (the auto-retry couldn't recover it).
- Every semantic conflict is already a `high` Known-gaps entry.
- Every vocabulary drift has already been auto-rewritten in place; it becomes a `low`-severity informational entry in the auto-reconciled list (see renderer).

**Write the reconciliation artifact.** Every pass (auto-rewrite, retry, unresolved) is logged to `{cachePath}/{componentSlug}-reconciliations.json`. Envelope:

```json
{
  "_meta": {
    "schemaVersion": "1",
    "generatedAt": "<ISO 8601 timestamp>",
    "componentSlug": "<slug>",
    "autoRetryEnabled": <value read from uspecs.config.json reconciliation.autoRetry; default true>
  },
  "data": {
    "autoReconciled": [
      {
        "class": "vocabulary-drift",
        "specialist": "structure" | "color" | "voice",
        "before": "<drifted label>",
        "after": "<dictionary canonical>",
        "location": "<cache path + JSONPath>",
        "source": "<dictionary axis / sub-component / state reference>"
      }
    ],
    "retries": [
      {
        "specialist": "structure" | "color" | "voice",
        "missingItems": ["..."],
        "attemptedAt": "<ISO 8601>",
        "outcome": "resolved" | "still-missing",
        "retryCount": 1
      }
    ],
    "unresolved": [
      {
        "class": "coverage-gap" | "semantic-conflict",
        "specialist": "structure" | "color" | "voice",
        "detail": "<scannable summary ≤160 chars>",
        "severity": "high"
      }
    ]
  }
}
```

When `data.retries[].outcome === "resolved"`, the corresponding mismatch disappears from the specialist's cache on the next classification pass — that is how the re-run loop confirms success. When `"still-missing"`, the item is promoted into `unresolved[]` with severity `high`.

**Abort conditions:**

- A subagent returns a failure line → abort the whole orchestrator with a diagnostic naming the failing specialist and retry number. Do NOT continue past Step 8.5 with a half-broken cache set.
- A specialist's retry overwrites its cache file with a malformed envelope (missing `_meta`/`data`) → abort with the same diagnostic.

**Flush the reconciliation working context.** Keep only: the path `{cachePath}/{componentSlug}-reconciliations.json` + counts `(auto-rewrites=<A>, retries=<R>, unresolved=<U>)`.

### Step 9: Render the Markdown

Now the parent's context should contain:

- 4 domain cache-file paths (api, structure, color, voice). `_base.json` remains on disk at `{cachePath}/{componentSlug}-_base.json` for **targeted reads only** during rendering — specifically `_childComposition`, `_extractionNotes.warnings`, and `variants[*]._selfCheck.missingChildren`. Everything else renderable was already lifted into the four domain JSONs.
- `fileKey`, `nodeId`, `componentSlug`, `outputPath`, `cachePath`, `optionalContext`.
- Any container-rerun hints or delta-extraction records collected during Steps 5–8.
- Not much else.

Read:

1. All four **domain** JSON cache files in full.
2. `_base.json` — but only the narrow fields the renderer consumes: `_childComposition` (for Composition subsection + Referenced components + Known gaps), `_extractionNotes.warnings` (for Known gaps), `component.componentName` (for cross-check), `variants[*]._selfCheck.missingChildren` (for Known gaps). Do not load it wholesale.
3. `{{ref:component-md/component-md-template.md}}`.
4. `{{ref:component-md/agent-component-md-instruction.md}}`.

Follow `agent-component-md-instruction.md` section by section to produce:

- `{{COMPONENT_NAME}}`, `{{FIGMA_URL}}`, `{{GENERATED_AT}}`, `{{OPTIONAL_CONTEXT}}`, `{{NODE_ID}}`, `{{FILE_KEY}}`, `{{CACHE_PATH}}` (mechanical).
- `{{OVERVIEW_PARAGRAPH}}` (synthesis — 2–4 sentences drawn from all four `data` objects).
- `{{VARIANT_AXES_SUMMARY}}` (one-liner from the structure axes).
- `{{COMPOSITION_SUBSECTION}}` (rendered from `_base.json` top-level `_childComposition`).
- `{{API_BODY}}`, `{{STRUCTURE_BODY}}`, `{{COLOR_BODY}}`, `{{VOICE_BODY}}` (per-section renderers). API body's Referenced components subsection consumes `_base.json._childComposition.children[]` filtered to `classification === "referenced"`.
- `{{CROSS_SECTION_INVARIANTS}}` and `{{CROSS_REFERENCES}}` (computed from the `_extractionArtifacts` blocks).

Write the result to `outputPath` using UTF-8.

**Do not skip the audit checklist** at the end of `agent-component-md-instruction.md`. If an audit check fails, fix the renderer — do not hand-patch the `.md`.

### Step 9.5: Integrity check (read-only, before writing the `.md`)

After the four interpretation caches land on disk and **before** the renderer touches `outputPath`, run a read-only JSON validation pass. No Figma calls. No mutations. Purely: load each cache, check the invariants below, aggregate results.

Run the checklist in order — a hard failure short-circuits rendering.

```
For each of { _base.json, api.json, api-dictionary.json, structure.json, color.json, voice.json, reconciliations.json }:

- [ ] File exists at {cachePath}/{componentSlug}-<slice>.json
- [ ] Parses as JSON
- [ ] Has an _meta block with schemaVersion, extractedAt (or generatedAt for reconciliations.json)
- [ ] Has a data block (or, for _base.json, the top-level keys listed in Step 4 verify)

api-dictionary.json:
- [ ] data.componentName equals api.data.componentName
- [ ] data.axes is a non-empty array when api.data.mainTable.properties has at least one enum-typed row
- [ ] data.states is an array (possibly empty). When api.data._extractionArtifacts.stateAxisMapping[] is present, data.states.length === stateAxisMapping.length
- [ ] data.slots is an array (possibly empty). When api.data._extractionArtifacts.slotResolverStrategy[] is present, data.slots.length === slotResolverStrategy.length

reconciliations.json:
- [ ] data.autoReconciled is an array. Every entry has { class: "vocabulary-drift", specialist, before, after, location, source }
- [ ] For every entry in data.autoReconciled[], the specialist's cache at {cache path + JSONPath in entry.location} now contains `entry.after` at the cited location (not `entry.before`). A mismatch means the auto-rewrite was logged but never applied — abort.
- [ ] data.retries is an array. Every entry has { specialist, missingItems[], attemptedAt, outcome, retryCount }. retryCount ≤ 1 per specialist.
- [ ] data.unresolved is an array. Every entry has { class: "coverage-gap" | "semantic-conflict", specialist, detail, severity: "high" }
- [ ] For every data.unresolved[] entry, the Known gaps block the renderer is about to emit MUST include a matching high-severity summary line. This check runs AFTER a dry render of the Known gaps block (the renderer materializes the block string first, then this check greps it for each unresolved detail substring). Missing any → abort with a diagnostic naming the unresolved entry.

api.json:
- [ ] data.componentName equals _base.json.component.componentName
- [ ] If _base.json.slotHostGeometry.boolGatedFillers is non-empty, every SubComponentApiTable that corresponds to a boolean-gated filler has _identityResolved set (true | false). Missing _identityResolved is tolerated only when boolGatedFillers is empty or when the table's role does not correspond to a boolean-gated filler.
- [ ] No sub-component table title matches the regex /^[a-z]+=/ (i.e., no "size=medium"-style variant short names leaked through)
- [ ] data._deltaExtractions is an array (possibly empty)
- [ ] data._extractionArtifacts.booleanRelationshipAnalysis exists and is an array
- [ ] For every entry in booleanRelationshipAnalysis[]: evidence[] is non-empty OR relationship === "independent" with at least one negative-evidence signal in evidence[]
- [ ] Every sub-component in _base.json.propertyDefinitions.booleans (grouped by associatedLayerName) has a matching booleanRelationshipAnalysis[] entry whose subComponentName resolves to the same sub-component

structure.json:
- [ ] Every row in data.sections[*].rows has a provenance field
- [ ] Every row with provenance="not-measured" has values=["—", ...] — no numeric values
- [ ] Every row with provenance="inferred" cites a token in notes
- [ ] not-measured ratio across default-size rows ≤ 20% — if exceeded, a Step 3-delta must be recorded in data._deltaExtractions
- [ ] No typography prose in any notes field (regex: /font-size|line-height|letter-spacing|font-weight/i must not match a notes field alone — the field must be a structured row instead)
- [ ] data._extractionArtifacts.coverageMatrix is present with shape `{ complete, totals: { framesWalked, framesWithNonZeroProps, missingFamilies }, entries: [...] }`.
- [ ] data._extractionArtifacts.coverageMatrix.complete === true. When false, every entry with missing[].length > 0 MUST carry a parallel pendingReason[] with the same length as missing[] — otherwise abort.
- [ ] data._extractionArtifacts.coverageMatrix.totals.framesWalked equals an independent recount performed right here: walk _base.json.variants[<default>].treeHierarchical and every _base.json.variants[*].revealedByVariantName[*] under rules R1–R3 (see extract-structure SKILL §coverageMatrix), count distinct FRAME nodeIds, compare. **Mismatch is a blocking abort** — it means the specialist emitted a partial walk and falsely set complete=true. The diagnostic MUST include the independent count, the claimed count, and the first 3 missing FRAME nodeIds.
- [ ] For every data._extractionArtifacts.coverageMatrix.entries[*] whose missing.length > 0, the Known gaps block the renderer is about to emit surfaces that entry as a `high` line citing nodePath + the missing family names. Same dry-render + grep mechanism used for reconciliations.json > data.unresolved[].

color.json:
- [ ] data._extractionArtifacts.strategy is "A" or "B"
- [ ] If _base.json._childComposition exists and has at least one constitutive child with non-null subCompSetId AND at least one container symptom (all-sub / transparent-parent / background-only) fires, data._containerRerunHint is non-null and data._containerRerunHint.source === "derivative-of-_childComposition"
- [ ] When _base.json._childComposition exists and its constitutive-sub-component list is empty, data._containerRerunHint is null (symptom-only noise does NOT trigger the hint)
- [ ] When _base.json._childComposition is absent, data._containerRerunHint is null and data._extractionArtifacts.schemaWarnings[] includes a "missing _childComposition" entry (the plugin always populates _childComposition, so this path means the base JSON was not produced by the plugin and should be re-extracted)
- [ ] uniqueTokens is an array (possibly empty)
- [ ] Hex extension lockstep — for every tables[] in data.variants[].tables[] (Strategy A) or data.sections[].tables[] (Strategy B): when the table carries elementHexes[] (Strategy A) or elementHexesByState[] (Strategy B), its length MUST equal elements[].length. For Strategy B, every elementHexesByState[i].hexByState key set MUST equal the matching elements[i].tokensByState key set. Absence of the extension entirely on a table is OK (graceful degrade — renderer falls back to bare token names). Length mismatch or key-set mismatch is a blocking abort with a diagnostic citing the offending tables[] index.

voice.json:
- [ ] data.states is a non-empty array
- [ ] Every state has exactly 3 platform sub-sections (voiceOver, talkBack, aria)
- [ ] Every focus stop has focusOrderIndex set

Cross-file:
- [ ] variantAxes sets match across structure._extractionArtifacts, color._extractionArtifacts, voice._extractionArtifacts — any mismatch must appear in reconciliations.json (either auto-rewritten or surfaced as high). Unreconciled drift is a blocking failure.
- [ ] Every _deltaExtractions[] entry has { purpose, script, byteCount, timestamp }
- [ ] _base.json._extractionNotes.warnings is represented in the severity buckets the renderer will emit
- [ ] **Dictionary mismatch budget.** Let totalRows be the sum of row-level items across the three specialist caches (structure.sections[].rows + color element entries + voice state×platform tables). Let mismatchRows be the sum of _extractionArtifacts.dictionaryMismatches[] lengths minus the count of entries that were auto-reconciled. When mismatchRows / totalRows > 0.25 (hard 25% cap), abort with a diagnostic: "Dictionary mismatch rate exceeds 25% — API over-normalized the vocabulary and every specialist is flagging rows. Re-run extract-api with tighter naming discipline before continuing." The 25% threshold catches the pathological case where the dictionary renames a Figma value to something none of the specialists can evidence.
- [ ] **Dictionary availability.** When any specialist cache records `_dictionaryUnavailable: true`, surface it as a `medium`-severity Known gap (the specialist ran without the canonical vocabulary and may name things idiosyncratically). Do not abort — standalone-runs of a specialist outside the orchestrator are legal.
```

**Behavior on failure:**

- Any `[ ]` that stays unchecked → **abort rendering** and return a multi-line failure summary like:

  ```
  Integrity check failed at: api.json — 2 SubComponentApiTable entries missing _identityResolved
                             api.json — booleanRelationshipAnalysis missing entry for sub-component "Input" (booleans: Leading content, Leading artwork, Leading text)
                             api.json — booleanRelationshipAnalysis entry for "Label" has relationship="independent" with empty evidence[]
                             structure.json — 7 rows with provenance="not-measured" in default size (limit: ≤20%)
  No .md was written. Inspect {cachePath}/ and re-run the failing extract-* skill, then re-run create-component-md.
  ```

  This diagnostic channel is developer-facing only. It is **allowed** to name Figma-specific labels (property names, variant short names, associated layer names) because its audience is the author re-running the extraction, not the engineer reading the final `.md`. The `.md` itself remains Figma-blind.

- Any cross-file disagreement (e.g., variantAxes mismatch, sub-component name drift, state-column relabel) is **not** silently reconciled here. Step 8.5's typed reconciliation owns that responsibility — by the time rendering begins, every disagreement is either (a) auto-rewritten in place and logged to `{slug}-reconciliations.json > data.autoReconciled[]`, (b) resolved by a re-dispatched specialist (`data.retries[].outcome === "resolved"`), or (c) surfaced as a `high` Known-gaps entry via `data.unresolved[]`. Integrity check aborts when any category-(a) entry is missing a corresponding rewrite in the specialist cache, or when an unresolved entry exists but the Known gaps block does not surface it. See the typed version of the reconciliation rule in **Invariants**.

This step is the last chance to catch fabricated output before it ships to `outputPath`. Treat it as a blocking gate, not advisory.

### Step 10: Final summary

Return exactly one line to the user:

```
Component Markdown written: sections={api,structure,color,voice}, bytes=<B> → <outputPath>
```

Then a short paragraph:

> The `.md` is now the source of truth. Cache files at `{cachePath}` can be deleted once you're satisfied with the output (they're gitignored and will be re-generated on the next run).

If any phase reported warnings, delta extractions, or a container re-run hint, append a short bullet list summarizing them so the user can file follow-ups. The container hint (if present) should recommend specific sub-component node IDs as targets for a follow-up `create-component-md` run.

### Step 10.5: Recursion manifest (composition follow-ups)

After the final summary, read the revised `_childComposition` from `_base.json` and emit a **recursion manifest**. This is a copy-pasteable to-do block, not an automated loop — the orchestrator does not recurse on its own.

**Emit one "recurse" entry only for children that satisfy BOTH conditions:**
1. `classification === "constitutive"` (P1 or P2 match), AND
2. `subCompSetId` is non-null (i.e., the child is itself a `COMPONENT_SET` with its own spec surface).

Referenced and decorative children never appear in the recursion manifest. Referenced children are documented inline in the `.md` with a link to their expected sibling spec path (`./{slug}.md`) — the manifest only records whether that spec currently exists.

Format:

```
Composition of {COMPONENT}:
  constitutive:
    - {child-slug-1} (node {subCompSetId}) → needs create-component-md run
    - {child-slug-2} (node {subCompSetId}) → needs create-component-md run
  referenced (documented inline, no recursion):
    - {primitive-1} (node {subCompSetId}) — see ./{primitive-1-slug}.md [exists? yes/no]
    - {primitive-2} (node {subCompSetId}) — see ./{primitive-2-slug}.md [exists? yes/no]
  decorative: {count} (no listing)
  ambiguous (defaulted to referenced): {count}
```

Shape interpretation:
- A P1/P2-heavy component (constitutive parts dominate the anatomy) produces a long `constitutive:` block and short or empty `referenced:`.
- A P3/P5-heavy component (a composition that arranges independent primitives) produces the opposite shape.
- A P6-only component (no embedded components, only its own vectors and text) produces an empty manifest — no follow-ups.

For each `constitutive` entry, the user is expected to run `create-component-md` on that node next. For each `referenced` entry whose sibling spec does not exist, the user is expected to run `create-component-md` on that node or document where its spec lives.

Do NOT auto-chain runs. The manifest is terminal output for this invocation only.

## Invariants

- **The uSpec Extract plugin is the only Figma-writer.** All four interpretation skills are read-only. A Step 3-delta call in an interpretation skill must be a tiny (< 50 line) read-only script; anything larger means `_base.json` schema needs widening.
- **`_base.json` is immutable after the plugin finishes — with ONE exception.** The orchestrator's own Step 4.5 may rewrite `_base.json._childComposition` (overriding classifications and resolving `ambiguousChildren[]`). No other field may be touched. Interpretation skills never write to `_base.json` under any circumstance; they abort with a diagnostic if the base is wrong.
- **Mutation safety.** Every Figma mutation is on a temp instance. Every temp instance has a matching `.remove()` on all code paths. The component set and shipped variants are never mutated.
- **Never call a `create-*` skill from this orchestrator.** They render into Figma, not Markdown.
- **Never run the interpretation skills in parallel inside the parent's own context.** Running them as parallel subagents (one per specialist) after `extract-api` completes is explicitly allowed and is the prescribed Step 6 fan-out shape — each subagent holds its own `_base.json` + dictionary read and writes to a distinct cache file, so the parent's context is never exposed to three specialists simultaneously. Do not inline their reasoning into the parent.
- **Never lose quality for token savings.** Each interpretation skill is expected to carry the full reasoning chain from its `create-*` parent. If you notice a skill skipping steps, fix the skill, not the orchestrator.
- **Never rewrite the cache JSONs during rendering.** They are the interpretation skills' product. The **only** legal rewrite is Step 8.5's typed auto-reconciliation (vocabulary drift → in-place label rewrite), and every such rewrite must be logged to `{slug}-reconciliations.json > data.autoReconciled[]`.
- **Typed reconciliation only.** Step 8.5 recognizes exactly three disagreement classes: (1) **vocabulary drift** — auto-rewrite and log, no retry; (2) **coverage gap** — re-dispatch the specialist once as a subagent with an expanded `optionalContext`, then re-run Step 8.5; (3) **semantic conflict** — surface as `high` Known gap, never auto-resolve. Any disagreement that does not fit cleanly into one of these three classes is a `high` Known gap by default. Do NOT introduce a fourth class, do NOT run a free-form "reasoning pass" over the four JSONs, and do NOT silently reconcile classes (1) or (2).
- **Retries are bounded and serial.** Each specialist can be re-dispatched at most once per `create-component-md` invocation. When multiple specialists need retries, dispatch them one at a time in the original run order (Structure → Color → Voice — this is iteration order, not a priority relationship), and re-run Step 8.5 after each retry returns. A successful retry may resolve gaps that would otherwise trigger further retries, shortening the chain.
- **Never silently continue past a missing cache file.** If any interpretation skill fails, abort, report which phase failed, and let the user decide whether to retry.
- **Never commit the `.uspec-cache/` directory.** It is gitignored. The `.md` file is the only artifact that should live in version control.
- **Never call `AskQuestion` or pause for user input anywhere in this chain.** This skill runs in strict batch mode from Step 1 to Step 10. No confirmations, no clarifications, no "should I...?" prompts, and no mid-chain reviews. If data is missing, log a `_deltaExtractions[]` entry (for interpretation skills) or emit a row with `provenance: "not-measured"` (for structure), then continue. The only legal halts are (a) hard aborts with a one-line diagnostic when a cache file is missing or the MCP connection is dead, and (b) the Step 9.5 integrity gate when a blocking validation fails.
- **Sub-skills inherit the same rule.** `extract-api`, `extract-structure`, `extract-color`, and `extract-voice` are batch-mode contracts. They MUST NOT call `AskQuestion` under any circumstance. On ambiguity they abort with a diagnostic or emit structured output; they never pause for clarification.

## Recovery

If the orchestrator is interrupted between Step 4 and Step 9, the existing JSON cache files are still valid. Each interpretation skill overwrites its own domain JSON, so re-running any single phase is safe.

If the user reports the rendered `.md` is missing content that was obviously present in Figma, inspect the four domain JSONs first. If the fact is missing from all of them, inspect `_base.json`. In almost every case the gap is in an interpretation skill or in `_base.json` — not the renderer.
