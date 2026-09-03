# uSpec Extract — Figma plugin

Extracts a Figma component (and its sub-components) into a single `_base.json` file that
feeds the `create-component-md` skill chain.

One extraction, one JSON, delivered to your clipboard or `~/Downloads/`.

This repository builds **two publications from the same source**:

| Edition | Name | File link |
|---|---|---|
| `external` (default) | Base uSpec Extract | Required. Public Community plugins cannot read `figma.fileKey`. |
| `internal` | Base uSpec Extract [Internal] | Not required. Organization plugins can use `figma.fileKey`. |

```bash
npm run build            # Community / public
npm run build:internal   # organization, no link field
```

The public Community plugin id lives in committed `editions.json` because it is already the [Figma Community listing](https://www.figma.com/community/plugin/1635184425006534227/uspec-extract). Organization plugin ids do **not** belong in git. Copy `editions.local.json.example` to `editions.local.json` (gitignored) and set the internal id before `npm run build:internal`.

`scripts/build.mjs --edition=…` writes `manifest.json` and compiles `__REQUIRE_FILE_LINK__` into the bundle.

## How it works

The plugin runs locally inside Figma Desktop's plugin sandbox. It walks the selected
`COMPONENT` or `COMPONENT_SET` in a fixed sequence of phases and produces a single
`_base.json` file that the four interpretation skills (`extract-api`, `extract-structure`,
`extract-color`, `extract-voice`) consume from disk.

Highlights:

- **Every variant is walked** — no default-variant sampling. Cross-variant diffs and
  state comparison are computed directly in the sandbox.
- **Sub-components are walked, not sampled.** Constitutive children with variant axes
  (e.g. `Input.size = large|medium|small`) get a Phase I cross-product walk, capped at 20
  combos, under `subComponentVariantWalks[subCompSetId]`. Plain-COMPONENT children get a
  single `(default)` walk whose nested-INSTANCE leaves carry an `instanceConfig` summary
  in lieu of recursion.
- **Designer-in-the-loop composition.** The plugin UI presents each top-level child
  instance with a first-guess classification (constitutive / referenced / decorative). The
  designer confirms or flips each guess; resolved answers land in
  `_base.json._childComposition.children[]` with `classificationEvidence: ["user-selected"]`.
- **Inline font properties are captured** alongside text style IDs, so typography data
  survives when a library-linked text style cannot be resolved.
- **Library-linked variables** are resolved via `figma.variables.getVariableByIdAsync`,
  exposing each variable's `name`, `codeSyntax`, alias chain, and remote collection
  metadata.
- **Library-linked components** are resolved through `resolveKey.ts`: node-id fast path →
  document-wide key index → `importComponent(Set)ByKeyAsync`. The document-wide layer is
  preferred so locally-published variants retain `.parent` (required to read
  `variantGroupProperties`).
- **Figma node ids** are stamped on every entry of `treeHierarchical`, `layoutTree`,
  `treeFlat`, `colorWalk`, and their revealed counterparts, so downstream consumers can
  resolve entries back to live layers without name- or path-based search.
- **Boolean-gated layers** are resolved via `componentPropertyReferences.visible`, with a
  sibling-variant fallback for layers omitted from the default state (e.g. a "clear"
  button that only exists when the input is active).
- **Defensive property accessors** (`safeLen`, `sg`, `sidStr`) let the walker tolerate
  `GROUP` / `SLOT` nodes whose property reads would otherwise throw.

## Install (dev)

```bash
cd figma-plugin
npm install
npm run build            # Community edition
# npm run build:internal  # requires figma-plugin/editions.local.json
```

Then in Figma Desktop: **Plugins → Development → Import plugin from manifest…** and pick
`figma-plugin/manifest.json`.

For rebuild-on-save during development:

```bash
npm run build:watch
```

## Use

1. In Figma, select a single `COMPONENT` or `COMPONENT_SET` (or a variant, which is auto-
   promoted to its component set).
2. Run **Plugins → Development → uSpec Extract**.
3. If you built the Community edition, paste the selected component's Figma link into the footer.
   Extraction remains disabled until the link is valid. The internal edition skips this field.
4. Review the sub-component checklist: the plugin pre-guesses whether each child instance is
   **constitutive** (owned by this component) or **referenced** (an instance of a widely-
   reused component). Flip any guess you disagree with. Non-instance children (vectors,
   frames, text) are locked to **decorative**.
5. Optionally paste context about the component in the text area (design intent, open
   questions, constraints).
6. Click **Extract & download** to save the JSON to `~/Downloads/`, or **Copy JSON** to
   put the full payload on your clipboard.

## The output

A single file named `{componentSlug}-_base.json` containing every field documented in
[`docs/base-json-schema.md`](docs/base-json-schema.md), plus `_meta.extractionSource: "plugin"`
so the `create-component-md` orchestrator knows how the file was produced.

`_childComposition.children[*].classificationEvidence` carries `["user-selected"]` for
every decision made in the plugin UI, so the orchestrator's Step 4.5 review short-circuits
to a confirmation-only pass.

## Hand it to the agent

```text
/create-component-md baseJsonPath=~/Downloads/textfield-_base.json
```

Or optionally pair it with a Figma link if you want the agent to run a delta measurement:

```text
/create-component-md baseJsonPath=~/Downloads/textfield-_base.json figmaLink=https://…
```

## Validate an emitted file

```bash
npm run validate -- ~/Downloads/textfield-_base.json
```

The same check runs inside the `create-component-md` orchestrator at Step 1.

## Architecture

```
figma-plugin/
├── manifest.json          Figma plugin manifest
├── package.json           Build deps (esbuild, ajv, typings)
├── tsconfig.json
├── docs/
│   └── base-json-schema.md  _base.json schema and traversal policy
├── scripts/
│   ├── build.mjs          esbuild bundler (writes dist/code.js, dist/ui.html)
│   └── validate-base.mjs  Ajv schema check
└── src/
    ├── code.ts            Sandbox entry point; orchestrates all phases
    ├── ui.html            Plugin UI iframe shell
    ├── ui.ts              UI logic (checklist, download, clipboard)
    ├── types.ts           Shared types between sandbox and iframe
    ├── safe.ts            Defensive property accessors
    ├── resolveKey.ts      Shared library publish-key resolver (node-id → doc index → library import)
    ├── phaseA.ts          Meta + axes + property definitions
    ├── phaseB.ts          Local variable collections + resolved values
    ├── phaseC.ts          Style resolution (with inline-sample fallback)
    ├── phaseD.ts          Library-linked variable resolution (name, codeSyntax, alias chains)
    ├── phaseE.ts          Per-variant walker with post-walk validation
    ├── phaseF.ts          Cross-variant diffs + axis classification
    ├── phaseG.ts          Revealed trees + slot host geometry
    ├── phaseH.ts          Ownership hints
    ├── phaseI.ts          Sub-component variant walks (cross-product for constitutive sets, `(default)` for plain COMPONENTs)
    └── childComposition.ts  Phase F' — first-guess child classification
```
