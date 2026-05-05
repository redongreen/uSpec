# `_base.json` Schema

This file defines the `_base.json` schema, traversal policy, mutation safety contract, and audit checklist produced by the uSpec Extract Figma plugin (`figma-plugin/`). The plugin is the sole writer of `_base.json`; the interpretation skills below only read it.

Downstream interpretation skills (`extract-api`, `extract-structure`, `extract-color`, `extract-voice`) read this file to understand the shape of `_base.json` and where their evidence lives. They never write to `_base.json`.

---

## `_base.json` Schema

```jsonc
{
  "_meta": {
    "schemaVersion": "1",
    "extractedAt": "<ISO 8601>",
    "fileKey": "<figma file key>",
    "nodeId": "<compound or simple node id>",
    "componentSlug": "<slug>",
    "optionalContext": "<string or null>"
  },

  "component": {
    "componentName": "<string>",
    "compSetNodeId": "<nodeId echoed>",
    "isComponentSet": true
  },

  "variantAxes": [
    { "name": "<axis>", "options": ["<v1>", "<v2>"], "defaultValue": "<v1>" }
  ],

  "defaultVariant": {
    "id": "<variantNodeId>",
    "name": "<variant name>",
    "variantProperties": { "<axis>": "<value>" }
  },

  "propertyDefinitions": {
    "rawDefs": {
      "<rawKey>": {
        "type": "VARIANT|BOOLEAN|INSTANCE_SWAP|SLOT|TEXT",
        "defaultValue": "<varies>",
        "variantOptions": ["<...>"] | null,
        "description": "<string or null>"
      }
    },
    "booleans": [
      { "name": "<clean>", "rawKey": "<raw#id>", "defaultValue": false, "associatedLayerId": "<id or null>", "associatedLayerName": "<name or null>" }
    ],
    "instanceSwaps": [
      { "name": "<clean>", "rawKey": "<raw>", "defaultValue": "<nodeId>", "defaultComponentName": "<name or null>" }
    ],
    "slots": [
      {
        "name": "<clean>",
        "rawKey": "<raw>",
        "description": "<string>",
        "visibleRawKey": "<raw boolean key from SLOT.componentPropertyReferences.visible, optional>",
        "visiblePropName": "<clean visible prop name, optional>",
        "preferredInstances": [{
          "componentKey": "<key>",
          "componentName": "<name>",
          "componentSetId": "<parent COMPONENT_SET id when the preferred value is part of a set; otherwise falls back to the plain COMPONENT's own id so the field is never absent; optional>",
          "componentSetName": "<parent set name; falls back to the plain COMPONENT name when no set exists; optional>",
          "isComponentSet": "<bool — true when the preferred value resolves to (or lives inside) a COMPONENT_SET; false when it's a plain COMPONENT with no parent set. Prefer reading this flag over inferring from presence-of-variantAxes.>",
          "variantAxes": { "<axis>": ["<option>"] } /* optional; populated when the preferred value's parent is a COMPONENT_SET with variantGroupProperties */,
          "defaultVariantProperties": { "<axis>": "<value>" } /* optional; only when preferred is a COMPONENT_SET */,
          "booleanDefaults": { "<cleanKey>": false } /* optional; from componentPropertyDefinitions of type BOOLEAN */,
          "slotProps": ["<cleanKey>"] /* optional; SLOT property names the referenced component exposes */,
          "instanceSwapDefaults": { "<cleanKey>": "<defaultComponentId>" } /* optional; default values of INSTANCE_SWAP properties */,
          "textDefaults": { "<cleanKey>": "<defaultValue>" } /* optional; default values of TEXT properties */
        }],
        "defaultChildren": [
          {
            "name": "<layer name>",
            "nodeType": "INSTANCE|FRAME|...",
            "visible": true,
            "mainComponentId": "<id>",
            "mainComponentKey": "<key>",
            "mainComponentName": "<name>",
            "componentSetName": "<name>",
            "componentSetId": "<id or null>",
            "isComponentSet": true,
            "contextualOverrides": { "<prop>": "<value>" }
          }
        ],
        "defaultChildMainIds": ["<componentId>"]
      }
    ]
  },

  "variables": {
    "localCollections": [
      { "id": "<id>", "name": "<name>", "modes": [{ "modeId": "<id>", "name": "<mode>" }], "variableIds": ["<id>"] }
    ],
    "remoteCollections": [
      { "id": "<id>", "name": "<name>", "modes": [{ "modeId": "<id>", "name": "<mode>" }], "variableIds": ["<id>"], "isFromLibrary": true }
    ],
    "resolvedVariables": {
      "<variableId>": {
        "name": "<variable name>",
        "codeSyntax": "<WEB code syntax or null>",
        "collectionId": "<id>",
        "valuesByMode": {
          "<modeName>": { "kind": "color|alias|number|string|boolean", "...": "kind-specific fields" }
        },
        "resolvedType": "COLOR|FLOAT|STRING|BOOLEAN",
        "isFromLibrary": true,
        "_unresolved": true
      }
    }
  },

  "styles": {
    "resolvedStyles": {
      "<styleId>": { "name": "<style name>", "type": "PAINT|TEXT|EFFECT", "description": "<string or null>" }
    }
  },

  "variants": [
    {
      "id": "<variantId>",
      "name": "<variant name>",
      "variantProperties": { "<axis>": "<value>" },
      "dimensions": { /* collapsed {value, token, display} per extractDims */ },
      "layoutTree": { /* structure-style layout tree; see Traversal policy */ },
      "treeHierarchical": [ /* recursive tree, stops at nested INSTANCE (except top-level); each node: name, type, visible, dimensions, typography?, mainComponentName?, parentSetName?, subCompSetId?, subCompVariantAxes?, booleanOverrides?, children? */ ],
      "treeFlat": [ /* flat list for voice: index, name, nodeType, visible, bbox, slotIndex? */ ],
      "colorWalk": [ /* path-qualified color entries; see Traversal policy */ ],
      "revealedTree": { /* optional; hierarchical walk with all booleans enabled, populated by Phase G */ },
      "revealedColorWalk": [ /* optional; colorWalk performed on the all-booleans-enabled temp instance, populated by Phase G. Same entry shape as colorWalk. Enables booleanDelta derivation without re-walking Figma. */ ]
    }
  ],

  "crossVariant": {
    "axisDiffs": {
      "<axis>": { "<value>": { "root": { "<dimKey>": <num> }, "children": [{ "name": "<n>", "type": "<t>", "visible": true, "dims": { ... } }] } | null }
    },
    "stateComparison": { "<stateValue>": { "<dimKey>": <num> } } | null,
    "axisTokenFingerprints": { "<axis>": { "<value>": "<pipe-joined tokens>" } },
    "axisClassification": { "<axis>": { "values": ["<...>"], "isState": false, "colorRelevant": true } },
    "sizeAxis": "<axis or null>",
    "stateAxis": "<axis or null>",
    "dimensionAxes": ["<axis>"]
  },

  "slotHostGeometry": {
    "swapResults": {
      "<slotName>": {
        "<preferredComponentId>": {
          "prefDims": { /* collapsed dims of the swapped-in preferred instance */ },
          "slotDims": { /* collapsed dims of the slot node hosting it */ }
        }
      }
    }
  },

  "ownershipHints": [
    {
      "propertyName": "<string>",
      "evidenceType": "rootVariant|rootBoolean|rootInstanceSwap|rootSlot|childOverride|textNode|variableMode",
      "sourceNodeName": "<name>",
      "sourceLayerName": "<name or null>",
      "suggestedExposure": "parent|child_or_parent|parent_or_child",
      "rationale": "<string>",
      "textContent": "<string, only for textNode>",
      "collectionId": "<id, only for variableMode>",
      "modeNames": ["<name>", "..."]
    }
  ],

  "subComponentVariantWalks": {
    "<subCompSetId>": {
      "name": "<child instance name as it appears in the parent>",
      "subCompSetId": "<echoed id — COMPONENT_SET id when the child resolves to a set, COMPONENT id when the child is a plain component with no variants>",
      "subCompSetName": "<name of the COMPONENT_SET or plain COMPONENT>",
      "classification": "constitutive|referenced" /* mirrored from _childComposition.children[] so consumers can read walk-vs-summary shape off the record */,
      "axes": { "<axisName>": ["<option>", "..."] } /* {} when the child is a plain COMPONENT with no variants */,
      "variants": [
        {
          "variantKey": "<axis1=value1|axis2=value2>  OR  '(default)' for plain-COMPONENT walks>",
          "variantProperties": { "<axisName>": "<value>" } /* {} for plain-COMPONENT walks */,
          "dimensions": { /* collapsed {value, token, display} per extractDims, for the variant's root COMPONENT */ },
          "treeHierarchical": {
            /* recursive walk of the variant's body. Each node carries `name`, `type`,
               `visible`, `dimensions`, and `children[]`. Recursion stops at nested
               INSTANCE boundaries (depth >= 1 INSTANCEs are leaves). INSTANCE nodes —
               including the root when the walk target itself is an INSTANCE, and every
               nested-instance leaf — additionally carry an `instanceConfig`: */
            "instanceConfig": {
              "mainComponentId": "<id or null>",
              "mainComponentName": "<string or null>",
              "parentSetId": "<id or null>",
              "parentSetName": "<string or null>",
              "isComponentSet": "<bool>",
              "variantProperties": { "<axis>": "<value>" } /* variant axes the instance is set to */,
              "booleanOverrides": { "<propName>": "<bool>" },
              "instanceSwapOverrides": { "<propName>": "<id>" },
              "textOverrides": { "<propName>": "<string>" }
            }
          }
        }
      ],
      "skipped": true,
      "skippedReason": "<string — e.g. 'cross-product N exceeds cap 20'; only present when skipped===true>"
    }
  },

  "_childComposition": {
    "children": [
      {
        "name": "<child instance name>",
        "mainComponentName": "<string or null>",
        "parentSetName": "<string or null>",
        "subCompSetId": "<id or null>",
        "topLevelInstanceId": "<idx:N for top-level children of the *effective* container (see Layout-Wrapper Descent below) | wrapper:<depth> for layout wrapper FRAMEs that were descended through (depth 0 = outermost) | slot:<slotName>:pref:<componentKey> for slot-preferred | slot:<slotName>:child:<idx>:<nodeId> for slot-default-child>",
        "nodeType": "INSTANCE|FRAME|TEXT|VECTOR|...",
        "booleanOverrides": { "<propName>": "<bool>" } /* instance-scoped overrides from componentProperties on the placed instance; slot-preferred entries leave this empty — read preferredInstances[].booleanDefaults for the referenced component's defaults */,
        "subCompVariantAxes": { "<axisName>": ["<option>", "..."] } /* axes the sub-component itself exposes; for slot-preferred entries, mirrored from preferredInstances[].variantAxes so Phase I can walk it when constitutive */,
        "classification": "constitutive|referenced|decorative",
        "classificationReason": "<one-line reason>",
        "classificationEvidence": ["<signal>", "..."],
        "origin": "top-level|slot-preferred|slot-default-child",
        "slotName": "<slot property name when origin !== 'top-level'; null otherwise>",
        "placementCount": "<integer; how many sibling placements share this entry's sub-component identity. 1 for solo placements; N for the homogeneous-array pattern (e.g. 6 for 'button group contains 6 selection-button instances'). Always 1 for wrapper:N entries and slot-origin entries.>",
        "placementIndices": "<array of integers; original positions of all placements in the effective container's children, in order. [<self-index>] for solo top-level placements; [i, j, ...] for dedup'd top-level placements; [] for wrapper:N entries and slot-origin entries (which have no idx:N counterpart).>",
        "placementsVary": "<bool; true when ≥2 placements differ on (mainComponentName, booleanOverrides) — i.e. the array is heterogeneous and the spec author may want to surface state demonstration. false for solo placements and homogeneous arrays. Read variants[*].treeHierarchical[<index>].instanceConfig for per-placement detail when this is true.>"
      }
    ],
    "ambiguousChildren": [
      { /* same shape; classification: null until the orchestrator's Step 4.5 resolves it */ }
    ],
    "guessConfidence": "high|medium|low"
  },

  "_extractionNotes": {
    "variantsWalked": ["<variant name>"],
    "mutationsPerformed": [{ "action": "createInstance|setProperties|slot-swap|remove", "target": "<string>" }],
    "warnings": [{ "code": "HIERWALK_MISSING_CHILDREN|<other structured code>", "...": "code-specific fields" }]
  }
}
```

---

## Traversal Policy

The plugin walks the component tree **once** per variant and emits three distinct views of that single walk, so the four interpretation skills can share one traversal.

| View | Used by | Semantics |
| ---- | ------- | --------- |
| `treeHierarchical` | `extract-api`, `extract-structure` | Recurse into containers. **Do NOT descend into nested INSTANCE children** except for the **top-level INSTANCEs of the variant** (depth 0). Preserves `layoutTree` semantics for structure and lets api inspect direct sub-component properties. |
| `treeFlat` | `extract-voice` | Flat list with absolute-to-variant-relative `bbox`. SLOT children are hoisted into the flat list. Identically-named sibling INSTANCEs carry `slotIndex` for index-based matching. |
| `colorWalk` | `extract-color` | Full recursion — does **not** stop at INSTANCE boundaries. Each entry carries `path` (`Parent > Child > Leaf`) and, when inside an INSTANCE, a `subComponentName` stamp. |
| `revealedColorWalk` | `extract-color` (booleanDelta) | Phase G emits this **once per temp instance** (default variant only) after `setProperties({ ...allBooleansEnabled })`. Same entry shape as `colorWalk`. Lets interpretation skills diff revealed vs baseline entries without re-walking Figma. |

All three views are produced from the same Figma walk inside Phase E per variant; the script emits into three separate arrays rather than walking three times. `revealedColorWalk` is produced in Phase G alongside `revealedTree`.

**Layout tree** (`variants[].layoutTree`) is a compact Figma-only structure describing auto-layout nesting. Emitted once per variant from the `treeHierarchical` pass. Consumed by `extract-structure` Step 7 reasoning.

### Layout-Wrapper Descent

Designers commonly wrap a component's real sub-components in a single auto-layout FRAME (for clipping, scroll containers, padding, or visual grouping — e.g. Button group's `group` wrapper for the `overflow=scroll` variant). Without descent, the classification UI and `_childComposition.children[]` would only see the wrapper and miss the actual sub-components inside.

**Rule (`getEffectiveChildContainer` in `safe.ts`):** while a node has exactly one child, that child is a `FRAME`, and the child has `layoutMode !== 'NONE'`, descend into it. Recurse so nested wrappers (`Variant > FRAME > FRAME > instances`) are also unwrapped.

The rule is applied uniformly in:

- `sendPreview()` — checklist enumeration
- `buildFirstGuess()` — `_childComposition.children[]` synthesis
- `extract()` post-walk validation — for `idx:N` lookups against `treeHierarchical`
- `flatWalk()` in Phase E — for `slotIndex` detection
- `hierWalk()` in Phase E — for `effective depth 0` promotion (see Depth Contract below)

**`treeHierarchical` itself is unchanged in shape** — it still walks the real tree from the variant root, so wrapper FRAMEs remain visible there with all their dimensions, padding, and clipsContent data intact. The only change is the *depth metadata* attached to inner nodes: an INSTANCE sitting inside a wrapper chain now carries the same `subCompSetId`, `subCompVariantAxes`, and `booleanOverrides` it would carry if it were a direct child of the variant root, and its own children are walked one level (matching the existing top-level-INSTANCE descent rule).

Each descended-through wrapper is emitted as an explicit `{ classification: "decorative", origin: "top-level", topLevelInstanceId: "wrapper:<depth>", classificationEvidence: ["layout-wrapper"] }` entry in `_childComposition.children[]` so the layout chrome is never silently dropped.

`idx:N` in `topLevelInstanceId` indexes into the **effective container's** children, not the variant root's. Phase I is unaffected (it dispatches on `subCompSetId`, not on `idx`).

### Sub-Component Placement Dedup

The classification UI asks one question per distinct sub-component — "constitutive or referenced?" — so N placements of the same main component (e.g. six "selection button" placements inside a button group) collapse to **one** `_childComposition.children[]` entry instead of N. This matches the structural intent: an array sub-component is one classification with a count, not N independent decisions. Same principle as the slot-preferred dedup that's been in `sendPreview` since v1 (`seenMainIds`), now extended to top-level direct children via the shared `groupBySubComp` helper.

**Dedup key:** `subCompSetId || mainComponentName` (set id when the sub-component is a `COMPONENT_SET` member, name fallback for plain components without a parent set).

**Equivalence fingerprint (v1):** `mainComponentName + JSON-stringified booleanOverrides`. `mainComponentName` encodes the variant choice for `COMPONENT_SET` members (e.g. `"state=default, size=medium"`), so variant-different and boolean-different placements are detected. Instance-swap and text-override differences are intentionally not in the v1 fingerprint — extend `safe.ts` `groupBySubComp` callers in both `sendPreview` and `buildFirstGuess` simultaneously if you need them.

The first occurrence of each group becomes the representative entry; multiplicity is preserved in `placementCount`, `placementIndices`, and `placementsVary` so consumers can:

- Render arrays as arrays without re-walking the tree (`placementCount > 1`).
- Detect heterogeneous arrays that may need state demonstration (`placementsVary: true`).
- Map back to specific nodes inside `variants[*].treeHierarchical` when per-placement detail is needed (`placementIndices`).

`treeHierarchical` / `treeFlat` / `colorWalk` are unaffected — they still emit one entry per actual Figma node.

---

## Variant Sampling

**Default: walk every variant.** The emitted `_base.json` is a **superset** of what any single interpretation skill needs, so the skills can filter instead of triggering an additional extraction.

Interpretation skills apply their own filters **on top of** the full sample:

- `extract-color` reads `_base.json.crossVariant.axisClassification` to decide which axes are color-relevant and then re-filters the variants array.
- `extract-structure` picks variants along `sizeAxis` (+ optional `stateAxis`) and ignores the rest.
- `extract-api` reads only the default variant from the `variants` array.
- `extract-voice` reads only the default variant for focus-order evidence.

The orchestrator MAY pass an `optionalContext` hint (e.g., `"focus: primary variant only"`) that the plugin honors by narrowing the walked set. Any restriction is documented in `_extractionNotes.variantsWalked`.

---

## Cross-Variant Computations

Computed in Phase F from Figma directly (not re-walked through `variants[]`) so the downstream interpretation layers do not have to touch the tree at all:

- **`axisDiffs`** (structure): for every non-dimensional axis value, a temp-instance measurement of root + direct children.
- **`stateComparison`** (structure): root measurements at default size across all values of the detected state axis.
- **`axisTokenFingerprints`** (color): per axis value, the set of tokens and style IDs found in its variants, joined.
- **`axisClassification`** (color + structure): per-axis flags `isState`, `colorRelevant`.
- **`sizeAxis`, `stateAxis`, `dimensionAxes`**: detected from axis names (regex: size|density|shape and state).

---

## Mutation Safety Contract

The plugin is the **only** Figma-writer in the pipeline. Rules:

1. **Temp instances only.** The set of allowed mutations is `createInstance`, `setProperties`, `appendChild` into a SLOT on a temp instance, `remove` on a SLOT child, and `remove` on a temp instance.
2. **No mutation of shipped nodes.** Never set properties on the component set, variants, main components, or anything a designer could open in Figma.
3. **Guaranteed cleanup.** Every temp instance has a matching `.remove()` on success and error paths.
4. **Audit log.** Every mutation is pushed into `_extractionNotes.mutationsPerformed` with `{ action, target }`.

Interpretation skills are **forbidden** from calling any of the mutating APIs, even via their Step 3-delta escape hatch. Any delta script must be read-only.

---

## Phase Map

The plugin produces `_base.json` by running a fixed sequence of phases inside Figma's plugin sandbox. Each phase has a specific responsibility:

| Phase | Purpose |
| ----- | ------- |
| A | Meta + variant axes + property definitions |
| B | Local variable collections + resolved values |
| C | Style resolution (with inline-sample fallback for library-linked styles) |
| D | Library-linked variable resolution (name, codeSyntax, alias chains, remote collection metadata) |
| E | Per-variant walker — emits `treeHierarchical`, `treeFlat`, `colorWalk`, `layoutTree`, and `dimensions` |
| F | Cross-variant diffs, state comparison, axis token fingerprints, axis classification |
| G | Revealed trees (all booleans enabled) + slot host geometry + `revealedColorWalk` |
| H | Ownership hints |
| F′ | Child composition first-guess (constitutive / referenced / decorative) |
| I | Sub-component walks — emits `dimensions` + `treeHierarchical` into `subComponentVariantWalks[subCompSetId]`. Coverage by (classification × target shape): constitutive + COMPONENT_SET → cross-product walk (capped at 20); constitutive + plain COMPONENT → single `(default)` walk; referenced + plain COMPONENT → single `(default)` walk (captures recipe composition's container + nested-instance configs without recursing into those instances' own variant matrices); referenced + COMPONENT_SET → skipped (Phase A interface summary covers it). INSTANCE nodes in `treeHierarchical` additionally carry an `instanceConfig` summary (`mainComponentName`, `parentSetName`, `variantProperties`, `booleanOverrides`, `instanceSwapOverrides`, `textOverrides`). Runs after F′ so user classifications are already applied. Dimensions + instance-config summaries only — no colorWalk / treeFlat / layoutTree / style + variable collection. |

Because the plugin runs locally inside Figma and streams the full payload through its own UI, `_base.json` is produced in a single pass and written to disk as one file. There is no chunking protocol, no partial-write file, and no retry loop.

---

## Audit Checklist

Run after changing the schema or updating any of the plugin phases:

**Schema coverage.** For every field any `extract-*` skill consumes, confirm it has a place in `_base.json`:

- [ ] `component.componentName` / `compSetNodeId` / `isComponentSet`
- [ ] `variantAxes[]` with `{name, options, defaultValue}`
- [ ] `defaultVariant.{id, name, variantProperties}`
- [ ] `propertyDefinitions.rawDefs`, `booleans`, `instanceSwaps`, `slots` (with `defaultChildren.contextualOverrides`)
- [ ] `propertyDefinitions.slots[].preferredInstances[]` carries the full property summary for the referenced component (`componentSetId`, `componentSetName`, `variantAxes`, `defaultVariantProperties`, `booleanDefaults`, `slotProps`, `instanceSwapDefaults`, `textDefaults` — each omitted when empty)
- [ ] `variables.localCollections` + `remoteCollections` + `resolvedVariables` (with `valuesByMode` including alias chains, and `isFromLibrary: true` on library-sourced entries)
- [ ] `styles.resolvedStyles` (lazy; only referenced style IDs)
- [ ] `variants[].dimensions` (collapsed `{value, token, display}`)
- [ ] `variants[].treeHierarchical` (structure + api evidence)
- [ ] `variants[].treeFlat` (voice focus order)
- [ ] `variants[].colorWalk` (color entries with `path`, `subComponentName`, `compositeDetail` when 2+ layers share a style)
- [ ] `variants[].layoutTree`
- [ ] `variants[].revealedTree` (from Phase G)
- [ ] `variants[].revealedColorWalk` (from Phase G, default variant only; enables `booleanDelta` in `extract-color`)
- [ ] `crossVariant.axisDiffs`, `stateComparison`, `axisTokenFingerprints`, `axisClassification`, `sizeAxis`, `stateAxis`, `dimensionAxes`
- [ ] `slotHostGeometry.swapResults.{slotName}.{componentId}.{prefDims, slotDims}`
- [ ] `ownershipHints[]` with `rootVariant|rootBoolean|rootInstanceSwap|rootSlot|childOverride|textNode|variableMode`
- [ ] `_childComposition.children[]` with `classification`, `classificationReason`, `classificationEvidence[]`, `origin` (`top-level` | `slot-preferred` | `slot-default-child`), and `slotName` (set whenever origin !== top-level)
- [ ] `subComponentVariantWalks` (from Phase I): constitutive + COMPONENT_SET → one `variants[*]` per axis-combo OR `skipped: true` with `skippedReason`; constitutive + plain COMPONENT → single `(default)` walk with `axes: {}`; referenced + plain COMPONENT → single `(default)` walk; referenced + COMPONENT_SET → absent (covered by Phase A interface summary). Every walk record carries `classification`. Every INSTANCE node inside `treeHierarchical` carries an `instanceConfig` with `mainComponentName`, `parentSetName`, `variantProperties`, `booleanOverrides`, `instanceSwapOverrides`, `textOverrides`.

**Mutation safety.** Walk every `createInstance` in the plugin source and confirm a matching `.remove()` on all code paths (including error).

**Warnings visibility.** Confirm the final `_base.json` preserves `_extractionNotes.warnings` so interpretation skills can surface them.
