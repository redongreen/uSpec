---
name: create-component-md
description: Generate a canonical JSON contract and a self-contained implementation Markdown specification for a Figma component covering API, structure, color, and screen-reader behavior. Reads a `_base.json` produced by the uSpec Extract plugin, runs four read-only interpretation skills in parallel, reconciles their outputs, and writes sibling `.json` and `.md` artifacts. Use when the user mentions "component md", "component markdown", "spec md", "source of truth", "create-component-md", or wants a portable component specification.
---

# Create Component Markdown (Orchestrator)

This skill consumes a `_base.json` produced by the uSpec Extract Figma plugin (`figma-plugin/`), runs four **read-only interpretation** skills (`extract-api`, `extract-structure`, `extract-color`, `extract-voice`), and writes two sibling artifacts: a canonical `.json` contract and a polished implementation `.md`. Figma is only the source of extraction. Exhaustive `.audit.md` is an opt-in diagnostic view, not a default artifact.

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

No output path is required — the defaults are `./components/{componentSlug}.md` and `./components/{componentSlug}.json` in the current working directory.

## Workflow

Copy this checklist and update as you progress:

```
Task Progress:
- [ ] Step 1: Preflight — read config, run `uspec-skills component-md prepare`, load manifest
- [ ] Step 2: Resolve componentSlug and output path (from manifest)
- [ ] Step 3: Announce the plan
- [ ] Step 3.5: Composition classification (reasoning gate — internalize before Step 4.5 review)
- [ ] Step 4: Stage _base.json into cachePath (handled by CLI prepare — verify manifest only)
- [ ] Step 4.5: Post-extract review — confirm _childComposition (user-selected classifications skip override pass)
- [ ] Step 5: Run extract-api (reads _base.json, no Figma), flush, verify cache + api-dictionary.json
- [ ] Step 6: Parallel fan-out — dispatch extract-structure, extract-color, extract-voice as three subagents in a single batch; join on all three summaries
- [ ] Step 8.5: Reconciliation — typed disagreement handling with bounded serial retries
- [ ] Step 9: Build the canonical JSON contract, then render the implementation Markdown
- [ ] Step 9.5: Integrity check — validate all cache files and reconciliation artifact before rendering
- [ ] Step 10: Audit output and return a one-line summary
- [ ] Step 10.5: Emit recursion manifest (constitutive children only)
```

### Step 1: Preflight (CLI prepare)

Read `uspecs.config.json` at the project root. Extract:

- `mcpProvider` (`figma-console` or `figma-mcp`). Only used if `figmaLink` is also provided AND an interpretation skill's Step 3-delta triggers.
- `environment` (`cursor` | `claude-code` | `codex`) — used to resolve the skills directory for subagent dispatch (see Step 6).

**`baseJsonPath` is required.** If it is missing, abort with a one-line diagnostic: "run the uSpec Extract plugin in Figma and rerun with `baseJsonPath=<path>` — see `figma-plugin/README.md`."

**Run the deterministic prepare stage first.** Resolve the CLI executable **before** shelling out — do not assume `npx uspec-skills` is new enough to expose `component-md prepare`.

**CLI resolution order** (try each; stop at the first that works):

1. **Local dev checkout** — when `packages/cli/dist/index.js` exists in the project root:
   ```bash
   node packages/cli/dist/index.js component-md prepare --base "<baseJsonPath>" --json
   ```
   If missing but `packages/cli/` exists, run `npm run build:cli` from the project root once, then retry step 1.

2. **Published npm** — when step 1 is unavailable:
   ```bash
   npx uspec-skills component-md prepare --base "<baseJsonPath>" --json
   ```
   When this fails with `unknown command: component-md`, retry once with an explicit version pin:
   ```bash
   npx uspec-skills@0.3.3 component-md prepare --base "<baseJsonPath>" --json
   ```

3. **Abort** — when both paths fail, stop with:
   > `component-md prepare` is unavailable. In the uSpec repo run `npm run build:cli`, then rerun create-component-md. Else run `npx uspec-skills update` after upgrading to uspec-skills ≥ 0.3.3.

Append `--context "<optionalContext>"` when the orchestrator received non-empty `optionalContext`. Append `--output "<outputPath>"` when the user passed an explicit output path.

- Any non-zero exit from a working CLI → abort with stderr (validation/staging failure). Do **not** fall back to manual validation or staging once a CLI with `component-md prepare` is available.
- Parse the JSON manifest from stdout. Keep: `componentSlug`, `cachePath`, `stagedBasePath`, `outputPath`, `baseSourceHash`, `readiness`, `summaries`, `paths.contractPath`, `paths.evidence`, and the one-line `summaryLine`.

Read the effective Figma target from manifest `source.{fileKey,nodeId,figmaUrl}`. The prepare command derives these fields from `_base.json._meta`; `figmaUrl` falls back to a URL constructed from the required `fileKey` + `nodeId`. Read the staged base only when an older manifest lacks `source`.

The MCP connection check is deferred — it is not needed unless a sub-skill triggers a delta.

If `figmaLink` is also passed alongside `baseJsonPath`, parse it for comparison — but trust manifest / `_meta` as the source of truth when they disagree and log a `META_DISAGREES_WITH_LINK` warning for the final summary.

Set `deltaAvailable = true` whenever manifest `source.fileKey` and `source.nodeId` are non-empty. A separately-passed `figmaLink` is **not required**. If a targeted delta later fails because the configured MCP cannot connect, record `unavailable: "mcp-unavailable"`; never mislabel an embedded target as `no-figma-link`.

**Skills directory for downstream dispatch** (from `environment`):

| `environment` | Skills root |
|---|---|
| `cursor` | `.cursor/skills/` |
| `claude-code` | `.claude/skills/` |
| `codex` | `.agents/skills/` |

### Step 2: Resolve componentSlug and output path

Use the manifest from Step 1 — do **not** re-derive paths:

1. `componentSlug` = manifest `componentSlug`
2. `outputPath` = manifest `outputPath`
3. `cachePath` = manifest `cachePath`
4. `stagedBasePath` = manifest `stagedBasePath`
5. `baseSourceHash` = manifest `baseSourceHash`
6. `evidencePaths` = manifest `paths.evidence`
7. `contractPath` = manifest `paths.contractPath` (or replace the final `.md` suffix
   of `outputPath` with `.json` for an older manifest)

**Do not proceed until all of the above are resolved.** Every subsequent step reads from them.

Surface manifest `readiness.warnings` and any `readiness.layoutTreeHasNodeIds === false` flag before continuing (same framing as the legacy Step 4 render-meta freshness check).

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

Ask this question, in order, for each identity in the full cross-variant `_childComposition.children[]` union. Use `presentInVariants`, `defaultVariantPresent`, and `placementsByVariant`; never limit classification to the default tree.

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

### Step 4: Verify staged cache (CLI prepare output)

The CLI prepare step already validated, staged, and wrote evidence slices. **Do not re-run validation or copy `_base.json` manually.**

1. Confirm `{cachePath}/{componentSlug}-_base.json` exists (manifest `stagedBasePath`).
2. Confirm the four evidence files exist at manifest `paths.evidence` and each envelope's `_meta.baseSourceHash` equals manifest `baseSourceHash`. If any hash mismatches, re-run Step 1 prepare — do not proceed with stale evidence.
3. Emit the manifest one-line summary verbatim:

   ```
   {summaryLine from manifest}
   ```

   Example shape: `base: variants=36, bytes=509363, warnings=0 → .uspec-cache/tag/tag-_base.json`

4. **Flush phase context.** Keep only: staged base path + evidence paths + one-line summary + manifest readiness flags.
5. Verify the staged file has `_meta`, `component`, `variantAxes`, `propertyDefinitions`, `variants[]`, `ownershipHints[]`, `_childComposition`. `crossVariant` is allowed to be `null`. If any required top-level key is missing, abort — re-run the uSpec Extract plugin.
6. If manifest `readiness.warnings` is non-empty, surface those warnings before continuing.
7. If `readiness.layoutTreeHasNodeIds === false`, surface the render-meta freshness warning (pre-render-meta plugin build) before continuing.
8. Require `readiness.variantTreesComplete === true`. If false or absent on a newly prepared extraction, abort: target validation cannot be variant-scoped.

### Step 4.5: Post-extract review (composition classification)

Read `_base.json._childComposition`. The plugin UI asks the designer to resolve every top-level **INSTANCE** child at extraction time, so every entry in `children[]` with `nodeType === "INSTANCE"` carries `classificationEvidence: ["user-selected"]` and `ambiguousChildren[]` is empty by construction. Non-INSTANCE entries (layout-wrapper FRAMEs with evidence `["layout-wrapper"]`, raw vectors/text with evidence `["not-instance"]`) are auto-classified as `decorative` by the plugin and are not surfaced for designer confirmation.

Treat the designer's choice as authoritative and **skip the override pass entirely**. Briefly cross-check by running Q1 from Step 3.5 on each INSTANCE entry — if any obviously wrong assignment jumps out (e.g., a generic Icon instance marked `constitutive`), raise it as a warning to the user in the Step 10 summary but leave the `_childComposition` untouched. The designer's choice wins; the orchestrator's job is to surface, not override.

If `_childComposition.children[]` contains any entry where `nodeType === "INSTANCE"` and `classificationEvidence` does not include `"user-selected"`, or if `ambiguousChildren[]` is non-empty, the file is malformed (the plugin UI did not reach the designer's confirmation step). Flag it as a warning and apply the Step 3.5 reasoning model to resolve each affected INSTANCE entry before continuing. Non-INSTANCE entries (wrappers / vectors / text) keep their plugin-assigned `decorative` classification and are skipped by the override pass:

1. For each child in `children[]`, read `classification` and run Q1/Q2 from Step 3.5. If the classification is wrong, override it and append `"agent-override"` to `classificationEvidence[]`.
2. Walk `ambiguousChildren[]`. For each entry, make a decision via Q1/Q2 and the P1–P8 patterns, then **move** the entry into `children[]` with the resolved `classification`. On uncertainty, default to `referenced` and note the reasoning in `classificationReason`.
3. Persist the revised `_childComposition` back to `{cachePath}/{componentSlug}-_base.json`. This is the one explicit exception to the "`_base.json` is immutable" invariant.
4. If Step 4.5 changed `_childComposition`, immediately rerun the Step 1-resolved `component-md prepare` command with the staged base as `--base` and the same `--output`. Replace the in-memory manifest with the new stdout manifest. This refreshes all evidence hashes and, critically, `{componentSlug}-evidence-renderer.json`; specialists must never consume pre-review composition evidence.

Flush the review's working context. Keep only: the final classification counts (`constitutive=N, referenced=M, decorative=K, ambiguous=0`) as a one-line summary. Downstream interpretation skills will read the updated `_childComposition` from disk.

If `constitutive > 0` **and** every constitutive child has a non-null `subCompSetId`, this is a composition-heavy parent — Step 10.5's manifest will emit follow-up runs. If `referenced > 0`, the rendered `.md` will include a `### Referenced components` subsection (see Change 4 / `{{ref:component-md/agent-component-md-instruction.md}}`).

### Step 5: Run extract-api (inline, in the parent)

Follow `{skillsRoot}extract-api/SKILL.md` inline (not as a subagent — the parent needs the resulting dictionary directly). Pass `cachePath`, `componentSlug`, `optionalContext`, `deltaAvailable` (derived from manifest source identity), `evidenceApiPath` (from manifest `paths.evidence.api`), and — when `deltaAvailable` is true — `fileKey`, `nodeId`, `figmaUrl`, and `mcpProvider` (from `uspecs.config.json`).

The skill:

- Reads `_base.json` from disk (no fresh Figma walk).
- Optionally issues a tiny Step 3-delta call when `deltaAvailable` is true and a fact is genuinely missing.
- Writes `{cachePath}/{componentSlug}-api.json`.
- **Writes `{cachePath}/{componentSlug}-api-dictionary.json`** (Step 7.5 of `extract-api`) — the canonical vocabulary projected from api.json.
- Returns a single-line summary ending with `(+ dictionary at <path>)`.

Immediately run the Step 1-resolved CLI executable twice:

```bash
<CLI> component-md validate --cache "<cachePath>" --slug "<componentSlug>" --domain api --normalize --json
<CLI> component-md validate --cache "<cachePath>" --slug "<componentSlug>" --domain api-dictionary --json
```

A non-zero exit means `extract-api` must repair its own cache before fan-out.

**Flush phase context.** Keep only: the two paths + one-line summary. Abort with a diagnostic if the dictionary file is missing or invalid — the parallel fan-out requires it.

Set `apiDictionaryPath = {cachePath}/{componentSlug}-api-dictionary.json` for use in Step 6.

### Step 6: Parallel fan-out (extract-structure + extract-color + extract-voice)

With the API dictionary on disk, dispatch **three subagents in a single batch** using the `Task` tool, `subagent_type="generalPurpose"`. Each subagent runs exactly one extract skill, holds its own `_base.json` + dictionary context, and returns a single-line summary to the parent. The parent keeps only those three strings, never three full contexts.

**Mandatory invocation shape** (all three tool calls go in one assistant message — do NOT dispatch sequentially):

For each specialist in `[extract-structure, extract-color, extract-voice]`:

- `description` — 3–5 words (e.g., `"Structure pass for Button"`).
- `subagent_type` — `"generalPurpose"`.
- `run_in_background` — `false`. The parent must wait for all three returns before proceeding.
- `prompt` — a fully self-contained instruction with **these eight fields** (no prior chat context is available to the subagent):
  1. The absolute path to the extract skill's SKILL.md file (e.g., `{skillsRoot}extract-structure/SKILL.md`). Instruct the subagent to read it and follow every step.
  2. `componentSlug` (string).
  3. `cachePath` (string).
  4. `apiDictionaryPath` — the path produced by Step 5.
  5. `optionalContext` — the orchestrator's `optionalContext` string (or `"none"` when absent).
  6. `mcpProvider` — the value from `uspecs.config.json`.
  7. `deltaAvailable` — boolean derived from manifest `source.fileKey` + `source.nodeId`; plugin-produced base files normally make this `true` even when the user did not pass a separate `figmaLink`.
  8. `evidencePath` — the matching manifest evidence file for this specialist (`paths.evidence.structure` | `.color` | `.voice`).
  - Instruct the subagent to return a single-line summary matching the skill's declared return format, followed by the written cache path. Nothing else — not the full payload, not checklists, not screenshots.

**Expected return shapes (the parent parses these):**

- Structure: `Structure extracted: N sections, M sub-components, K slot contents → <path>`
- Color: `Color extracted: strategy=<A|B>, N sections, M unique tokens, modes=[...] → <path>`
- Voice: `Voice extracted: N focus stops, M states, platforms=[VoiceOver, TalkBack, ARIA] → <path>`

**Join before proceeding.** Wait for all three subagent returns. Do NOT advance to Step 8.5 until every return has landed. If any subagent fails (returns an error or no path), abort with a diagnostic naming the failing specialist — partial completion is never silently tolerated.

Validate the three returned caches in parallel with the Step 1-resolved CLI:

```bash
<CLI> component-md validate --cache "<cachePath>" --slug "<componentSlug>" --domain structure --normalize --json
<CLI> component-md validate --cache "<cachePath>" --slug "<componentSlug>" --domain color --normalize --json
<CLI> component-md validate --cache "<cachePath>" --slug "<componentSlug>" --domain voice --normalize --json
```

Re-dispatch only a specialist whose validator exits non-zero.

**Container hint collection.** After all three subagents return, open `{cachePath}/{componentSlug}-color.json` with a targeted read and check `data._containerRerunHint`. If non-null, surface it to the user using the neutral, authoritative framing below. **Do not** describe the parent's color spec as informational, provisional, placeholder, or pending — the parent's tokens are flattened from `colorWalk[]` and the parent .md is shippable as-is.

> Constitutive sub-components detected (`<subCompSetNames joined>`). The parent .md fully documents the parent's own color tokens (authoritative, measured from `colorWalk[]`). The recursion manifest in Step 10.5 lists each constitutive child as an **optional follow-up** if you also want a per-child canonical color spec; running them is not required for the parent .md to be complete.

Collect the hint for inclusion in the Step 10 Follow-ups (not Known gaps). Continue past this — do not abort.

**Flush phase context.** Keep only: the three cache-file paths + three one-line summaries. The subagents already discarded their internal context when they returned; the parent was never exposed to it.

### Step 8.5: Reconciliation (typed disagreement handling)

After the three specialist caches land and before the Step 9.5 integrity gate, run a deterministic reconciliation pass. This step is **typed dispatch, not reasoning** — it recognizes exactly 4 classes of disagreement (3 actionable + 1 benign) between the dictionary and the specialist outputs, and dispatches the right response for each.

**Load the dictionary + the three mismatch lists.**

1. Read `{cachePath}/{componentSlug}-api-dictionary.json` (`ApiDictionary`).
2. Read the `data._extractionArtifacts.dictionaryMismatches[]` arrays from the three specialist caches (`structure.json`, `color.json`, `voice.json`). Missing or empty arrays are fine — they indicate the specialist agreed with the dictionary.
3. Read `reconciliation.autoRetry` from `uspecs.config.json` (default: `true` when the key is absent). When `false`, skip retries and surface coverage gaps directly as `high` Known-gaps entries. Still run auto-rewrites for vocabulary drift.

**Classify every mismatch** into one of four buckets:

| Class | Detection rule | Response |
|---|---|---|
| **Vocabulary drift** | Dictionary has `{axis.name, value.figmaValue, value.runtimeCondition}`; specialist emitted a column / label that matches `figmaValue` but the dictionary canonical is `runtimeCondition` (or vice versa). Or a component name matches `subComponents[]` / `referencedComponents[]` modulo casing, whitespace, or suffix. | **Auto-rewrite in place.** Open the specialist's cache file, rewrite the drifted labels/columns/section names to the dictionary canonical, add a reconciliation log entry. No retry. |
| **Coverage gap (scope miss)** | Dictionary lists a value/sub-component/state that has no corresponding row/column/section in the specialist's cache AND the value exists somewhere in `_base.json` as real evidence (variant option, revealed sub-component, etc.). | **Re-dispatch the specialist as a single subagent** with `optionalContext = "create-component-md retry: <comma-list of missing items>"` prepended to the original `optionalContext`. Max 1 retry per specialist per invocation. After the retry returns, re-run this entire Step 8.5 from the top — a successful retry may resolve gaps that would otherwise trigger further retries. |
| **Benign value-extra** | The observed item resolves to `booleanProps[]`, `states[]`, `subComponents[]`, `referencedComponents[]`, a real variant option, or a runtime substate explicitly linked to a canonical parent API assignment. | **Log to `reviewedBenign[]` and move on.** No rewrite, retry, or Known-gaps entry. |
| **Semantic conflict** | Dictionary and specialist disagree on a fact that cannot be auto-rewritten AND the observed item resolves to nothing in the dictionary or `_base.json` (e.g., API declares `size: small \| medium \| large`; Structure measured `compact` + `regular` which have no `figmaValue` in the dictionary and no backing axis option). | **Surface as `high` Known gap immediately.** NEVER auto-resolve. NEVER retry (a retry will not fix a semantic disagreement — it needs human judgment). |

A `value-extra` that does not resolve through any vocabulary list, a real variant option, or a parent-linked runtime substate is a semantic conflict. Measurements, layer names, tokens, announcements, and topology are not vocabulary-controlled and must be rejected as malformed mismatch records rather than promoted to semantic conflicts.

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
- Every benign value-extra is already logged to `reviewedBenign[]`; it produces NO Known-gaps entry and NO confidence downgrade — it is an audit-trail note only.

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
    ],
    "reviewedBenign": [
      {
        "class": "value-extra",
        "specialist": "structure" | "color" | "voice",
        "observed": "<the value-extra the specialist emitted>",
        "resolvesTo": "booleanProps:isDisabled" | "states:loading" | "variantAxis:<name>=<option>",
        "note": "<why it is part of the API surface and not a gap; ≤160 chars>"
      }
    ]
  }
}
```

`reviewedBenign[]` is the formal home for the **Benign value-extra** class — it is an audit trail only, never a defect list. The renderer does NOT surface it in Known gaps. When there is nothing benign to log, emit `reviewedBenign: []`. Do **not** invent ad-hoc keys (e.g. a leading-underscore `_reviewedBenign`) — `reviewedBenign[]` is the schema-defined bucket and Step 9.5 validates its shape.

When `data.retries[].outcome === "resolved"`, the corresponding mismatch disappears from the specialist's cache on the next classification pass — that is how the re-run loop confirms success. When `"still-missing"`, the item is promoted into `unresolved[]` with severity `high`.

**Abort conditions:**

- A subagent returns a failure line → abort the whole orchestrator with a diagnostic naming the failing specialist and retry number. Do NOT continue past Step 8.5 with a half-broken cache set.
- A specialist's retry overwrites its cache file with a malformed envelope (missing `_meta`/`data`) → abort with the same diagnostic.

**Flush the reconciliation working context.** Keep only: the path `{cachePath}/{componentSlug}-reconciliations.json` + counts `(auto-rewrites=<A>, retries=<R>, unresolved=<U>, benign=<B>)`.

**Render-meta handoff note.** Step 9 validates each section/group node ID against its declared parent or sub-component variant tree. Identity comes from the specialist's stamped variant fields, not fuzzy matching against the default layout tree.

### Step 9: AI synthesis handoff + deterministic validation/render

The AI's final semantic responsibility is deliberately small: read the four
specialist caches and write `{cachePath}/{componentSlug}-render-plan.json`:

```json
{
  "_meta": {
    "schemaVersion": "1",
    "componentSlug": "<slug>",
    "baseSourceHash": "<manifest._meta.baseSourceHash>",
    "generatedAt": "<ISO 8601>"
  },
  "data": {
    "overviewParagraph": "<2–4 sentence cross-section synthesis>",
    "confidence": {
      "api": "high",
      "structure": "high",
      "color": "high",
      "voice": "high"
    }
  }
}
```

`overviewParagraph` is where AI reasoning remains a superpower: explain what the
component is, how its important axes interact, its composition, and its
accessibility contract. Do not put tables, render-meta, Known gaps, or mechanical
summaries in the plan.

After **each** specialist writes its cache, validate immediately:

```bash
<CLI> component-md validate \
  --cache "<cachePath>" --slug "<componentSlug>" \
  --domain "<api|structure|color|voice>" --normalize --json
```

A prepared evidence slice carries `data.obligations[]`. Each specialist must
account for every obligation in
`data._extractionArtifacts.obligationLedger[]`, using JSON Pointer targets into
its final output. The validator enforces both directions:

1. every extracted fact is emitted, intentionally merged, or explicitly
   dispositioned under its policy; `must-emit` facts cannot be omitted; and
2. every rendered semantic record (API property, Structure row, Color element,
   Voice table/property) is targeted by evidence.

Obligations may also carry a `representation` contract. This preserves semantic
quality across the AI/deterministic boundary: named instance swaps remain
engineer-facing types, typography metrics remain structured rows, and
sub-component geometry remains attached to its own source tree. A valid pointer
to the wrong kind of record does not satisfy the obligation.

An `unaccounted`, `unresolved`, `must-emit ... omitted`, `unresolved output
target`, or `semantic output ... has no evidence obligation` diagnostic belongs
to the specialist that wrote that cache. Re-dispatch only that specialist and
include the validator errors verbatim. Do not weaken, delete, or hand-edit the
obligation inventory to make validation pass.

The renderer independently validates Figma target identity. For a Structure
section carrying `subCompSetId`, group target IDs must exist in that set's
`subComponentVariantWalks` tree; a parent placement ID is not a substitute. An
invalid target is nulled and surfaced as a Known gap instead of being counted
as resolved.

After reconciliation, validate `api-dictionary` and `reconciliations`, then run
all-domain validation once. A non-zero exit re-dispatches only the owning
specialist; never wait until rendering to discover a malformed cache.

Build the canonical, schema-validated component contract first:

```bash
<CLI> component-md contract \
  --manifest "<cachePath>/<componentSlug>-prepare-manifest.json" \
  --plan "<cachePath>/<componentSlug>-render-plan.json" \
  --output "<contractPath>" --json
```

This contract is the durable machine-readable source of truth. It unifies API,
anatomy, variants, Structure, Color, accessibility, source identity, dictionary
vocabulary, reconciliations, and evidence-coverage totals. Specialist
`obligationLedger` internals are summarized under provenance rather than copied
into semantic domains.

Render the deterministic human view from the written contract:

```bash
<CLI> component-md render \
  --manifest "<cachePath>/<componentSlug>-prepare-manifest.json" \
  --plan "<cachePath>/<componentSlug>-render-plan.json" \
  --contract "<contractPath>" \
  --view concise --output "<outputPath>" --json
```

The `.json` is the complete machine-readable contract. The `.md` is its
evidence-linked implementation view: composition, anatomy, API examples,
high-signal Structure, contextual Color mappings, and platform accessibility
guidance. The renderer runs structural and semantic acceptance checks before
writing it. Any non-zero exit aborts without hand-patching either artifact.

Generate an exhaustive diagnostic view only when the user explicitly asks for
it or when investigating renderer evidence:

```bash
<CLI> component-md render \
  --manifest "<cachePath>/<componentSlug>-prepare-manifest.json" \
  --plan "<cachePath>/<componentSlug>-render-plan.json" \
  --contract "<contractPath>" \
  --view audit --output "<outputPath-with-.audit.md>" --json
```

### Legacy Step 9 reference (do not execute)

The block below documents the pre-deterministic renderer contract for maintainers.
Do not generate temporary JavaScript or render Markdown in the agent. The CLI
command above is authoritative.

Now the parent's context should contain:

- `contractPath` and `outputPath`. Rendering reads the canonical contract; it
  does not reinterpret specialist caches.
- `fileKey`, `nodeId`, `componentSlug`, `outputPath`, `cachePath`, `optionalContext`.
- Any container-rerun hints or delta-extraction records collected during Steps 5–8.
- Not much else.

Read:

1. All four **domain** JSON cache files in full.
2. `_base.json` — only the narrow fields the renderer consumes (do not load wholesale):
   - `_meta` (full) — for render-meta `extractedAt`, `fileKey`, `nodeId`, `sourceHash` recomputation
   - `_childComposition` — for Composition subsection + Referenced components + Known gaps + render-meta `subComponents[]`
   - `_extractionNotes.warnings` — for Known gaps
   - `component` (full) — for cross-check + render-meta `component`
   - `variantAxes` + `defaultVariant` — for variant-axes summary + render-meta `variantAxes` / `variantAxesDefaults`
   - `propertyDefinitions` (full) — for render-meta `propertyDefs` + `booleanDefs` + `slotContents`
   - `slotHostGeometry` — for render-meta `slotContents.preferredComponents` enrichment
   - `variants[<defaultVariantName>].layoutTree` (full walk) — for render-meta `sectionTargets[*].nodeId` + `groupTargets[*][*].nodeId` resolution
   - `variants[<defaultVariantName>].treeHierarchical` (full walk) — for the `{{ANATOMY_SCAFFOLD}}` layer-composition tree (mechanical pass-through; see `agent-component-md-instruction.md` > ## Anatomy scaffold)
   - `variants[*]._selfCheck.missingChildren` — for Known gaps
   - `subComponentVariantWalks` (when present) — for render-meta `subComponents[*].subCompVariantAxesDefaults`
   - This widening from the prior `_childComposition` + `_extractionNotes.warnings` + `component.componentName` + `_selfCheck` set is intentional: render-meta needs the canonical pre-interpretation shape and the four domain caches do not preserve it. Read these fields once, then re-flush.
3. `{cachePath}/{componentSlug}-reconciliations.json` — for render-meta name-lookup retries (read `data.autoReconciled[]` for `before`/`after` pairs). When the file is absent, treat as empty (no rewrites).
4. `{{ref:component-md/component-md-template.md}}`.
5. `{{ref:component-md/agent-component-md-instruction.md}}`.

Follow `agent-component-md-instruction.md` section by section to produce:

- `{{COMPONENT_NAME}}`, `{{FIGMA_URL}}`, `{{GENERATED_AT}}`, `{{OPTIONAL_CONTEXT}}`, `{{NODE_ID}}`, `{{FILE_KEY}}`, `{{CACHE_PATH}}` (mechanical).
- `{{OVERVIEW_PARAGRAPH}}` (synthesis — 2–4 sentences drawn from all four `data` objects).
- `{{VARIANT_AXES_SUMMARY}}` (one-liner from the structure axes).
- `{{COMPOSITION_SUBSECTION}}` (rendered from `_base.json` top-level `_childComposition`).
- `{{ANATOMY_SCAFFOLD}}` (mechanical pass-through of `variants[<default>].treeHierarchical` into a `### Anatomy` tree at the top of the Structure section — see `agent-component-md-instruction.md` > ## Anatomy scaffold).
- `{{API_BODY}}`, `{{STRUCTURE_BODY}}`, `{{COLOR_BODY}}`, `{{VOICE_BODY}}` (per-section renderers). API body's Referenced components subsection consumes `_base.json._childComposition.children[]` filtered to `classification === "referenced"`. The Voice body ends with the hidden `<!-- voice-render-meta v=1 ... -->` focus-stop layer-name carry (see `agent-component-md-instruction.md` > Voice body rendering step 5) so `create-voice` can resolve focus markers from the `.md` alone.
- `{{CROSS_SECTION_INVARIANTS}}` and `{{CROSS_REFERENCES}}` (computed from the `_extractionArtifacts` blocks).
- **`{{RENDER_META_JSON}}`** — built per `agent-component-md-instruction.md > ## RENDER_META_JSON`. Source: `_base.json` (the narrow fields above) + structure cache `data.sections[]` — modern caches stamp `section._anchor` and group-header `row._layerName` / `row._layerId` directly, which the resolver consumes as mechanical pass-through (preferred path). Reconciliations cache is consulted only by the legacy name-walk fallback for caches produced before identity stamping. Render-meta is mechanical pass-through — never read it from `api.json` even where the fields overlap.

Write the result to `outputPath` using UTF-8.

**Do not skip the audit checklist** at the end of `agent-component-md-instruction.md`. If an audit check fails, fix the renderer — do not hand-patch the `.md`.

### Legacy Step 9.5 integrity checklist (CLI-owned; do not execute manually)

The checklist below is retained as the behavioral specification for the CLI
validator. The agent must not reimplement it, reread the full `_base.json`, or
run a second render/audit pass.

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
- [ ] data.booleanProps is an array (possibly empty). Its length equals the count of api.data.mainTable.properties[] rows whose `values === "true, false"`; every entry has `{ name, default }`. (This is the canonical home for top-level booleans like isDisabled/isLoading; without it the specialists emit perpetual value-extra mismatches.)
- [ ] data.states is an array (possibly empty). When api.data._extractionArtifacts.stateAxisMapping[] is present, data.states.length === stateAxisMapping.length
- [ ] data.slots is an array (possibly empty). When api.data._extractionArtifacts.slotResolverStrategy[] is present, data.slots.length === slotResolverStrategy.length

reconciliations.json:
- [ ] data.autoReconciled is an array. Every entry has { class: "vocabulary-drift", specialist, before, after, location, source }
- [ ] For every entry in data.autoReconciled[], the specialist's cache at {cache path + JSONPath in entry.location} now contains `entry.after` at the cited location (not `entry.before`). A mismatch means the auto-rewrite was logged but never applied — abort.
- [ ] data.retries is an array. Every entry has { specialist, missingItems[], attemptedAt, outcome, retryCount }. retryCount ≤ 1 per specialist.
- [ ] data.unresolved is an array. Every entry has { class: "coverage-gap" | "semantic-conflict", specialist, detail, severity: "high" }
- [ ] For every data.unresolved[] entry, the Known gaps block the renderer is about to emit MUST include a matching high-severity summary line. This check runs AFTER a dry render of the Known gaps block (the renderer materializes the block string first, then this check greps it for each unresolved detail substring). Missing any → abort with a diagnostic naming the unresolved entry.
- [ ] data.reviewedBenign is an array (possibly empty). Every entry has { class: "value-extra", specialist, observed, resolvesTo, note }, and `resolvesTo` is non-empty (it must name the API-surface element the extra traced to — e.g. `booleanProps:isDisabled`, `states:loading`, `variantAxis:size=large`). NO data.reviewedBenign[] entry may appear in the Known gaps block. Reject any leading-underscore variant key (e.g. `_reviewedBenign`) — the canonical bucket is `reviewedBenign` with no underscore; its presence means a non-conformant writer.

api.json:
- [ ] data.componentName equals _base.json.component.componentName
- [ ] If _base.json.slotHostGeometry.boolGatedFillers is non-empty, every SubComponentApiTable that corresponds to a boolean-gated filler has _identityResolved set (true | false). Missing _identityResolved is tolerated only when boolGatedFillers is empty or when the table's role does not correspond to a boolean-gated filler.
- [ ] No sub-component table title matches the regex /^[a-z]+=/ (i.e., no "size=medium"-style variant short names leaked through)
- [ ] data._deltaExtractions is an array (possibly empty)
- [ ] data.configurationExamples is an array (1–4 entries). Every entry has a non-empty `title` string and a `properties` array; every `properties[]` row has `property`, `value`, and `notes` keys. No entry carries a `name`, `description`, or `code` field (those are the renderer's old, wrong shape — their presence means a stale producer). The renderer consumes `title` + `properties[]` only (see `{{ref:component-md/agent-component-md-instruction.md}}` > API body rendering step 4).
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
- [ ] Every focus-stop table (focus order + per-state) carries a `layerName` field (string or `null`). This is the live Figma layer name `create-voice` name-matches against; the renderer projects it into the Voice body's hidden `voice-render-meta` carry. A missing `layerName` key (not `null`, but absent) means extract-voice predates the producer fix — surface a `medium` Known gap: `voice: focus stops missing layerName; re-run extract-voice`.

Cross-file:
- [ ] variantAxes sets match across structure._extractionArtifacts, color._extractionArtifacts, voice._extractionArtifacts — any mismatch must appear in reconciliations.json (either auto-rewritten or surfaced as high). Unreconciled drift is a blocking failure.
- [ ] Every _deltaExtractions[] entry has { purpose, script, byteCount, timestamp }
- [ ] _base.json._extractionNotes.warnings is represented in the severity buckets the renderer will emit
- [ ] **Dictionary mismatch budget.** Let totalRows be the sum of row-level items across the three specialist caches (structure.sections[].rows + color element entries + voice state×platform tables). Let mismatchRows be the sum of _extractionArtifacts.dictionaryMismatches[] lengths minus the count of entries that were auto-reconciled **minus the count of entries logged to reconciliations.json > data.reviewedBenign[]** (benign value-extras are not real mismatches — subtract them so a component with several benign boolean states cannot trip the cap). When mismatchRows / totalRows > 0.25 (hard 25% cap), abort with a diagnostic: "Dictionary mismatch rate exceeds 25% — API over-normalized the vocabulary and every specialist is flagging rows. Re-run extract-api with tighter naming discipline before continuing." The 25% threshold catches the pathological case where the dictionary renames a Figma value to something none of the specialists can evidence.
- [ ] **Dictionary availability.** When any specialist cache records `_dictionaryUnavailable: true`, surface it as a `medium`-severity Known gap (the specialist ran without the canonical vocabulary and may name things idiosyncratically). Do not abort — standalone-runs of a specialist outside the orchestrator are legal.

Render-meta (these gates run on the about-to-render render-meta object before it is serialized into the .md):
- [ ] Every booleanDefs[].associatedLayerId in render-meta equals the corresponding _base.json.propertyDefinitions.booleans[<i>].associatedLayerId byte-for-byte. Any drift means the renderer post-processed the field — abort with a diagnostic: "render-meta booleanDefs.associatedLayerId drift for key <key>: render-meta=<value>, _base.json=<value>".
- [ ] Every sectionTargets[<sectionName>] entry whose `name` is non-null and !== "__root__" has a non-null nodeId. The renderer's preferred path reads `section._anchor` from the structure cache directly; the legacy fallback name-walks `_base.json.variants[<default>].layoutTree`. When any entry leaves nodeId=null (from either path), the about-to-render Known-gaps block MUST contain a matching `medium`-severity line whose substring `render-meta: could not resolve nodeId for sectionTargets["<sectionName>"]` is greppable. Same dry-render + grep mechanism used for reconciliations.json > data.unresolved[]. Missing → abort.
- [ ] Every groupTargets[<sectionName>][<groupName>] entry has both non-null `name` and non-null `nodeId`. The renderer's preferred path reads `row._layerName` / `row._layerId` from the structure cache's group-header rows; the legacy fallback name-walks layoutTree. Same Known-gaps coupling rule and abort behavior on failure.
- [ ] When _base.json.variants[<defaultVariantName>].layoutTree's root entry has no `id` field (pre-render-meta plugin build), the diagnostic on the first failing render-meta gate above MUST include the additional line: "looks like _base.json was produced by a pre-render-meta plugin build (no `id` on layoutTree nodes) — re-extract with the current uSpec Extract plugin and re-run create-component-md."
- [ ] When the structure cache's `data.sections[]` entries lack `_anchor` (legacy cache), and the legacy fallback resolver had to engage for any section/group, the about-to-render Known-gaps block MUST contain one `low`-severity informational line: `render-meta: structure cache lacked _anchor / _layerId fields; legacy layoutTree name-walk fallback engaged. Re-run extract-structure to regenerate the cache with identity stamping.` This is informational, not a defect — but surfacing it nudges authors toward modern caches.
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
Component spec written: contract=<contractPath>, markdown=<outputPath>, sections={api,structure,color,voice}, bytes=<B>
```

Then a short paragraph:

> The `.json` contract is the machine source of truth; the `.md` is its implementation guide. Cache files at `{cachePath}` can be deleted once you're satisfied with the outputs (they're gitignored and will be re-generated on the next run).

If any phase reported warnings or delta extractions, append a short bullet list summarizing them so the user can file follow-ups. A container re-run hint (if present) is **not** a defect — describe it as an *optional* per-child canonical-spec follow-up, and reuse the neutral framing from Step 6: the parent's color tokens are authoritative and the parent .md is shippable as-is.

### Step 10.5: Recursion manifest (composition follow-ups)

After the final summary, read the revised `_childComposition` from `_base.json` and emit a **recursion manifest**. This is a copy-pasteable to-do block, not an automated loop — the orchestrator does not recurse on its own. The manifest lists **optional** follow-up runs to produce per-child canonical specs; the parent .md emitted in Step 10 is already complete and shippable on its own merits.

**Emit one "recurse" entry only for children that satisfy BOTH conditions:**
1. `classification === "constitutive"` (P1 or P2 match), AND
2. `subCompSetId` is non-null (i.e., the child is itself a `COMPONENT_SET` with its own spec surface).

Referenced and decorative children never appear in the recursion manifest. Referenced children are documented inline in the `.md` with a link to their expected sibling spec path (`./{slug}.md`) — the manifest only records whether that spec currently exists.

Format:

```
Composition of {COMPONENT}:
  constitutive:
    - {child-slug-1} (node {subCompSetId}) → optional create-component-md run for child canonical spec
    - {child-slug-2} (node {subCompSetId}) → optional create-component-md run for child canonical spec
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

For each `constitutive` entry, the user **may optionally** run `create-component-md` on that node to produce a per-child canonical spec — the parent .md is already complete without those runs. For each `referenced` entry whose sibling spec does not exist, the user is expected to run `create-component-md` on that node or document where its spec lives.

Do NOT auto-chain runs. The manifest is terminal output for this invocation only.

## Invariants

- **The uSpec Extract plugin is the only Figma-writer.** All four interpretation skills are read-only. A Step 3-delta call in an interpretation skill must be a tiny (< 50 line) read-only script; anything larger means `_base.json` schema needs widening.
- **`_base.json` is immutable after the plugin finishes — with ONE exception.** The orchestrator's own Step 4.5 may rewrite `_base.json._childComposition` (overriding classifications and resolving `ambiguousChildren[]`). No other field may be touched. Interpretation skills never write to `_base.json` under any circumstance; they abort with a diagnostic if the base is wrong.
- **Mutation safety.** Every Figma mutation is on a temp instance. Every temp instance has a matching `.remove()` on all code paths. The component set and shipped variants are never mutated.
- **Never call a `create-*` skill from this orchestrator.** They render into Figma, not Markdown.
- **Never run the interpretation skills in parallel inside the parent's own context.** Running them as parallel subagents (one per specialist) after `extract-api` completes is explicitly allowed and is the prescribed Step 6 fan-out shape — each subagent holds its own `_base.json` + dictionary read and writes to a distinct cache file, so the parent's context is never exposed to three specialists simultaneously. Do not inline their reasoning into the parent.
- **Never lose quality for token savings.** Each interpretation skill is expected to carry the full reasoning chain from its `create-*` parent. If you notice a skill skipping steps, fix the skill, not the orchestrator.
- **Never rewrite the cache JSONs during rendering.** They are the interpretation skills' product. The **only** legal rewrite is Step 8.5's typed auto-reconciliation (vocabulary drift → in-place label rewrite), and every such rewrite must be logged to `{slug}-reconciliations.json > data.autoReconciled[]`.
- **Typed reconciliation only.** Step 8.5 recognizes exactly four disagreement classes: (1) **vocabulary drift** — auto-rewrite and log, no retry; (2) **coverage gap** — re-dispatch the specialist once as a subagent with an expanded `optionalContext`, then re-run Step 8.5; (3) **benign value-extra** — a `value-extra` whose observed item resolves to a real API-surface element (`dictionary.booleanProps[]`, `dictionary.states[]`, or a `_base.json` variant axis), logged to `reviewedBenign[]` with no gap and no retry; (4) **semantic conflict** — surface as `high` Known gap, never auto-resolve. Any disagreement that does not fit cleanly into one of these four classes is a `high` Known gap by default. Do NOT introduce a fifth class, do NOT run a free-form "reasoning pass" over the four JSONs, do NOT silently reconcile classes (1) or (2), and do NOT use class (3) for any extra that cannot be traced to a real API-surface element (that is a semantic conflict → `high`).
- **Retries are bounded and serial.** Each specialist can be re-dispatched at most once per `create-component-md` invocation. When multiple specialists need retries, dispatch them one at a time in the original run order (Structure → Color → Voice — this is iteration order, not a priority relationship), and re-run Step 8.5 after each retry returns. A successful retry may resolve gaps that would otherwise trigger further retries, shortening the chain.
- **Never silently continue past a missing cache file.** If any interpretation skill fails, abort, report which phase failed, and let the user decide whether to retry.
- **Never commit the `.uspec-cache/` directory.** It is gitignored. The sibling `.json` contract and `.md` implementation guide are the default artifacts that should live in version control. An `.audit.md` is generated only on explicit request and is normally transient.
- **Never call `AskQuestion` or pause for user input anywhere in this chain.** This skill runs in strict batch mode from Step 1 to Step 10. No confirmations, no clarifications, no "should I...?" prompts, and no mid-chain reviews. If data is missing, log a `_deltaExtractions[]` entry (for interpretation skills) or emit a row with `provenance: "not-measured"` (for structure), then continue. The only legal halts are (a) hard aborts with a one-line diagnostic when a cache file is missing or the MCP connection is dead, and (b) the Step 9.5 integrity gate when a blocking validation fails.
- **Sub-skills inherit the same rule.** `extract-api`, `extract-structure`, `extract-color`, and `extract-voice` are batch-mode contracts. They MUST NOT call `AskQuestion` under any circumstance. On ambiguity they abort with a diagnostic or emit structured output; they never pause for clarification.

## Recovery

If the orchestrator is interrupted between Step 4 and Step 9, the existing JSON cache files are still valid. Each interpretation skill overwrites its own domain JSON, so re-running any single phase is safe.

If the user reports the rendered `.md` is missing content that was obviously present in Figma, inspect the four domain JSONs first. If the fact is missing from all of them, inspect `_base.json`. In almost every case the gap is in an interpretation skill or in `_base.json` — not the renderer.
