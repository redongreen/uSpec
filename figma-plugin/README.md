# uSpec Extract — Figma plugin

Extracts a Figma component (and its sub-components) into a single `_base.json` file that
feeds the `create-component-md` skill chain.

One extraction, one JSON, delivered to your clipboard or `~/Downloads/`.

## How it works

The plugin runs locally inside Figma Desktop's plugin sandbox. It walks the selected
`COMPONENT` or `COMPONENT_SET` in a fixed sequence of phases and produces a single
`_base.json` file that the four interpretation skills (`extract-api`, `extract-structure`,
`extract-color`, `extract-voice`) consume from disk.

Highlights:

- **Every variant is walked** — no default-variant sampling. Cross-variant diffs and
  state comparison are computed directly in the sandbox.
- **Designer-in-the-loop composition.** Before extraction, the plugin UI presents each
  top-level child instance with a first-guess classification (constitutive / referenced /
  decorative). The designer confirms or flips each guess; the resolved answers land in
  `_base.json._childComposition.children[]` with `classificationEvidence: ["user-selected"]`.
- **Inline font properties are always captured** alongside text style IDs, so typography
  data survives even when a library-linked text style cannot be resolved.
- **Library-linked variables are resolved** via `figma.variables.getVariableByIdAsync`,
  exposing each variable's Figma `name`, `codeSyntax`, alias chain, and remote collection
  metadata.
- **Defensive property accessors** (`safeLen`, `sg`, `sidStr`) let the walker tolerate
  `GROUP` / `SLOT` nodes whose property reads would otherwise throw.

## Install (dev)

```bash
cd figma-plugin
npm install
npm run build
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
3. Review the sub-component checklist: the plugin pre-guesses whether each child instance is
   **constitutive** (owned by this component) or **referenced** (an instance of a widely-
   reused component). Flip any guess you disagree with. Non-instance children (vectors,
   frames, text) are locked to **decorative**.
4. Optionally paste context about the component in the text area (design intent, open
   questions, constraints).
5. Click **Extract & download** to save the JSON to `~/Downloads/`, or **Copy JSON** to
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
    ├── phaseA.ts          Meta + axes + property definitions
    ├── phaseB.ts          Local variable collections + resolved values
    ├── phaseC.ts          Style resolution (with inline-sample fallback)
    ├── phaseD.ts          Library-linked variable resolution (name, codeSyntax, alias chains)
    ├── phaseE.ts          Per-variant walker with post-walk validation
    ├── phaseF.ts          Cross-variant diffs + axis classification
    ├── phaseG.ts          Revealed trees + slot host geometry
    ├── phaseH.ts          Ownership hints
    └── childComposition.ts  Phase F' — first-guess child classification
```
