# uSpec Implementation

> **Purpose of this file:** This is an architecture reference for AI agents working in this codebase. It covers how the system connects (skills, MCP, Figma, the extract plugin) — not the details of each spec type.
>
> **Two rendering paths:**
> - **Figma-native path** (`create-*` skills + Figma MCP): each spec type writes its own annotation frame into Figma next to the component. Figma is the source of truth.
> - **Component markdown path** (`figma-plugin/` + `create-component-md` + `extract-*` skills): the plugin emits a single `_base.json`; interpreter skills turn it into a standalone `.md` spec. The `.md` — not Figma — becomes the implementation source of truth.
>
> **What belongs here:**
> - System architecture and data flow for both paths
> - Template registry pattern and extensibility (Figma path)
> - Figma plugin phase map and `_base.json` contract (MD path)
> - Cross-cutting utilities (cloning, error handling)
> - Build, test, and documentation setup
> - Reference file pointers
>
> **What does NOT belong here:**
> - Per-spec-type JSON schemas and examples — those live in each skill's instruction file (e.g., `screen-reader/agent-screenreader-instruction.md`, `component-md/agent-component-md-instruction.md`)
> - Hardcoded template component keys — those are configured via the `firstrun` skill and stored in `uspecs.config.json`
> - The `_base.json` field reference — that lives in `figma-plugin/docs/base-json-schema.md`
>
> **Adding a new spec type:** Author the new skill in the platform-neutral `skills/<name>/SKILL.md` source (use `{{skill:name}}` and `{{ref:path}}` tokens for cross-references — see the [Skill Source and CLI](#skill-source-and-cli-packagescli) section). Add any shared docs to `references/<area>/`. Update the skills table, template type table, and reference files table below. Document the spec's schema, examples, and template structure in its own instruction file. If the new spec should participate in the component markdown path, pair it with a read-only `extract-<type>` sibling skill and wire it into `create-component-md`'s Step 6 fan-out. Bump `packages/cli/package.json` and rebuild so existing installs can pick up the new skill via `npx uspec-skills update`.
>
> **Operator's manual.** This file is the architecture reference. For the human-facing release process — when to bump versions, how to publish to npm, troubleshooting failed publishes, and the smoke-test workflow — see [`maintaining.md`](maintaining.md).

## Contents

- [Overview](#overview) — the two rendering paths and supported spec types
- [Skills](#skills) — host directories, full skill list, source-of-truth rules
- [Figma MCP Tools](#figma-mcp-tools) — Console vs Native MCP, complete tool mapping
  - [Native MCP Page Context](#native-mcp-page-context) — required `setCurrentPageAsync` pattern
  - [Font Loading in `use_figma`](#font-loading-in-use_figma) — `loadAllFonts` recipe and when to call it
  - [SLOT Node Handling](#slot-node-handling) — slot mutation ordering, default child workaround
  - [Console MCP Tools](#console-mcp-tools) / [Native MCP Tools](#native-mcp-tools) — per-provider tool catalog
- [Architecture](#architecture) — host-specific configuration and template keys
- [Components](#components) — render pipeline, two-tier extraction, template infrastructure
  - [Skill and Agent Instruction Architecture](#skill-and-agent-instruction-architecture) — SKILL.md vs instruction file split
  - [Template Key Config](#template-key-config) — `uspecs.config.json` shape and fields
- [Cloning Logic](#cloning-logic) — shared template clone-fill-remove pattern
- [Stability](#stability) — multi-call splitting to avoid Figma timeouts
- [Component Markdown Pipeline](#component-markdown-pipeline) — `_base.json` → `.md` spec flow
  - [Figma plugin (`figma-plugin/`)](#figma-plugin-figma-plugin) — phase map A–I
  - [`create-component-md` orchestrator](#create-component-md-orchestrator) — workflow steps 1–10.5
  - [`.uspec-cache/` layout](#uspec-cache-layout) — per-component cache files
- [Skill Source and CLI (`packages/cli/`)](#skill-source-and-cli-packagescli) — token rewriting, render engine, CLI commands
  - [Tokenized cross-references](#tokenized-cross-references) — `{{skill:}}` and `{{ref:}}` rewrite rules
  - [CLI package layout](#cli-package-layout) — files inside `packages/cli/`
  - [Commands](#commands) — `init` / `install` / `update` / `doctor`
  - [Publish safety](#publish-safety) — three layers preventing wrong-registry publishes
- [Documentation Site](#documentation-site) — Mintlify, deploy flow, file structure
- [Reference Files](#reference-files) — full file inventory by area

## Overview

uSpec generates documentation specifications for UI components. The system ships two rendering paths that share the same interpretation patterns but produce different artifacts:

- **Figma-native path.** `create-*` skills extract data via a Figma MCP (Console or native) and render annotations directly in Figma using Plugin API JavaScript. Each spec type has its own template frame. The motion skill is an exception — it reads pre-computed data from an After Effects export script rather than inspecting Figma components.
- **Component markdown path.** The `figma-plugin/` Figma Desktop plugin walks a component locally and emits a single `_base.json`. The `create-component-md` orchestrator runs four read-only `extract-*` interpreter skills against that file, reconciles their outputs, and renders one self-contained `.md` spec. The `.md` becomes the implementation source of truth; Figma is only the source of extraction.

Spec types currently supported (either path unless noted):

1. **Anatomy** - Numbered markers on a component instance with an attribute table _(Figma-native only)_
2. **Property** - Variant axes and boolean toggles with instance previews _(Figma-native only)_
3. **Screen Reader Specs** - Accessibility specifications for VoiceOver, TalkBack, and ARIA
4. **Color Annotation** - Design token specifications for component colors
5. **API Overview** - Component property documentation with configuration examples
6. **Structure Specification** - Dimensional properties documentation (spacing, padding, density variants)
7. **Motion Specification** - Animation timeline documentation from After Effects export data (pre-computed segments, no raw keyframes) _(Figma-native only)_
8. **Component Markdown** - Single standalone `.md` that bundles API, Structure, Color, and Voice into one implementation source of truth _(component markdown path only)_

## Skills

Agent workflows are defined as skills. Each skill has a `SKILL.md` with frontmatter (`name`, `description`), inputs, an MCP Adapter mapping table, a step-by-step workflow, and Plugin API code blocks. The skill content is identical across hosts and MCP providers — only the directory location, invocation syntax, and tool call names differ (handled by the MCP Adapter section in each skill).

### Skill locations by host

| Host | Skill directory | Invocation |
|------|----------------|------------|
| Cursor | `.cursor/skills/` | `@skill-name` in chat |
| Claude Code | `.claude/skills/` | `/skill-name` or natural language (auto-discovered by description) |
| Codex | `.agents/skills/` | `$skill-name` to invoke explicitly, or natural language (matched by description) |

### Available skills

**Figma-native (render into Figma):**

| Skill | Trigger Keywords | Purpose |
|-------|------------------|---------|
| `create-anatomy` | anatomy, component anatomy, create anatomy | Numbered markers and attribute table |
| `create-property` | property, properties, create property | Variant axes and boolean toggle exhibits |
| `create-voice` | voice, voiceover, screen reader, talkback, aria | Screen reader spec generation |
| `create-color` | color, color annotation, tokens | Color annotation generation |
| `create-api` | api, props, properties, component api | API overview generation |
| `create-structure` | structure, structure spec, dimensions, spacing, density, sizing | Structure spec generation |
| `create-motion` | motion, motion spec, animation spec, timeline | Motion specification from AE export (JSON paste, file ref, or Figma destination link) |

**Component markdown path (consume `_base.json`, render `.md`):**

| Skill | Trigger Keywords | Purpose |
|-------|------------------|---------|
| `create-component-md` | component md, component markdown, spec md, source of truth, migrate to md | Orchestrator: validates a plugin-produced `_base.json`, runs the four `extract-*` interpreter skills, reconciles their outputs, and renders a standalone `components/{componentSlug}.md`. See the [Component Markdown Pipeline](#component-markdown-pipeline) section below. |
| `extract-api` | _(sub-skill, invoked by `create-component-md`)_ | Read-only: interpret properties, sub-components, and configuration examples from `_base.json`. Produces the shared **API dictionary** that steers the three downstream specialists. Runs inline in the orchestrator's parent context. |
| `extract-structure` | _(sub-skill, invoked by `create-component-md`)_ | Read-only: interpret variant axes, dimensions, sub-component variant walks (Phase I output), slot contents, and cross-variant diffs from `_base.json`. |
| `extract-color` | _(sub-skill, invoked by `create-component-md`)_ | Read-only: interpret per-element fills/strokes/effects, axis classification, boolean delta, variable-mode detection, and rendering strategy from `_base.json`. |
| `extract-voice` | _(sub-skill, invoked by `create-component-md`)_ | Read-only: interpret focus order, merge analysis, per-state VoiceOver/TalkBack/ARIA tables, and slot insertion plans from `_base.json`. |

**Setup:**

| Skill | Trigger Keywords | Purpose |
|-------|------------------|---------|
| `firstrun` | firstrun, first run, setup, setup library, configure templates | First-time environment setup and template library configuration |

**Usage:** Mention trigger keywords in your prompt (e.g., "Create voice spec for this button"). In Cursor, you can also reference directly with `@create-voice`.

**Skill source of truth.** The platform-neutral `skills/<name>/SKILL.md` files at the repo root are the source of truth — they contain `{{skill:name}}` and `{{ref:path}}` tokens that the CLI rewrites at install time. Per-platform directories (`.cursor/skills/`, `.claude/skills/`, `.agents/skills/`) and the bundled `packages/cli/templates/` directory are **generated artifacts** — never edit them directly. See the [Skill Source and CLI](#skill-source-and-cli-packagescli) section below.

**Editing skills:** Edit `skills/<name>/SKILL.md` (and any `references/` files), then `cd packages/cli && npm run build` to refresh the bundled `templates/` copy. Run `npx uspec-skills update` from any consumer project to pick up the changes. The legacy `utils/sync-skills.sh` script is retained for now but is no longer the supported install path.

## Figma MCP Tools

uSpec supports two Figma MCP providers, configured via `mcpProvider` in `uspecs.config.json`:

| Provider | Value | Description |
|----------|-------|-------------|
| Figma Console MCP (Southleft) | `figma-console` | Requires Desktop Bridge plugin. Provides dedicated tools for navigation, screenshots, variables, styles, and component search. |
| Figma MCP (Native) | `figma-mcp` | Official Figma MCP with write access. Uses `use_figma` for Plugin API execution and dedicated tools for screenshots, metadata, and design system search. |

Each skill has an **MCP Adapter** section at the top that maps operations to the correct tool calls for either provider. The Plugin API JavaScript in all `figma_execute` / `use_figma` code blocks is identical — no code changes are needed between providers. The only per-call differences on the native path are supplying `fileKey` and `description` parameters.

### Complete Tool Mapping

| Console MCP | Native MCP | Notes |
|-------------|------------|-------|
| `figma_execute(code)` | `use_figma(fileKey, code, description)` | JS code is identical. Both support top-level await + return. Native requires `fileKey` + `description`. |
| `figma_get_status` | *(none)* | Connection is implicit on native. Verify by making any call. |
| `figma_navigate(url)` | *(none)* | Not needed — `use_figma` takes `fileKey` directly. Agent extracts `fileKey` from URL. |
| `figma_take_screenshot` | `get_screenshot(fileKey, nodeId)` | Functionally equivalent. Native requires explicit `fileKey` + `nodeId`. |
| `figma_capture_screenshot` | `get_screenshot(fileKey, nodeId)` | Same mapping. |
| `figma_get_file_data` | `get_metadata(fileKey, nodeId)` or `get_design_context(fileKey, nodeId)` | `get_metadata` returns structural XML. `get_design_context` is richer (includes code + screenshot). |
| `figma_get_component` | `get_metadata(fileKey, nodeId)` | Replacement for component inspection. Can also use `use_figma` for full detail. |
| `figma_get_component_for_development` | `get_design_context(fileKey, nodeId)` | Replacement for component data + visual reference. |
| `figma_get_variables` | `use_figma` script: `figma.variables.getLocalVariableCollectionsAsync()` | Console returns file-wide collections. Native `get_variable_defs` is node-scoped only — use a script for file-wide access. |
| `figma_get_token_values` | `use_figma` script reading variable values per mode | Same gap as above. Mode/value data needs `use_figma` scripts. |
| `figma_get_styles` | `search_design_system(query, fileKey, includeStyles: true)` | Console lists all styles directly. Native requires a search query, or use a `use_figma` script: `figma.getLocalPaintStyles()`. |
| `figma_search_components(name)` | `search_design_system(query, fileKey, includeComponents: true)` | Functionally equivalent. Native also searches variables/styles in the same call. |
| `figma_get_selection` | `use_figma` script: `figma.currentPage.selection` | No direct tool equivalent on native. |

### Native MCP Page Context

`use_figma` resets `figma.currentPage` to the first page on every call. In multi-step workflows where a script accesses a node from a previous step via `getNodeByIdAsync(ID)`, the page content may not be loaded — `findAll`, `findOne`, and `characters` will fail with `TypeError` until the page is activated. Insert this page-loading block immediately after `getNodeByIdAsync`:

```javascript
let _p = node; while (_p.parent && _p.parent.type !== 'DOCUMENT') _p = _p.parent;
if (_p.type === 'PAGE') await figma.setCurrentPageAsync(_p);
```

This walks up to the PAGE ancestor and loads its content. Once the page is loaded, `findAll`, `findOne`, and other traversal methods work normally. Console MCP does not need this — `figma_execute` inherits the Desktop page context from `figma_navigate`.

### Font Loading in `use_figma`

`getRangeAllFontNames` is **not available** in the `use_figma` sandbox and will throw `TypeError`. Use `tn.fontName` instead, which returns `{ family, style }` for uniformly-styled text or `figma.mixed` for mixed-font text.

**Collecting fonts from existing text nodes** — use this pattern in all skills:

```javascript
const textNodes = frame.findAll(n => n.type === 'TEXT');
const fontSet = new Set();
const fontsToLoad = [];
for (const tn of textNodes) {
  try {
    const fn = tn.fontName;
    if (fn && fn !== figma.mixed && fn.family) {
      const key = fn.family + '|' + fn.style;
      if (!fontSet.has(key)) { fontSet.add(key); fontsToLoad.push(fn); }
    }
  } catch {}
}
await Promise.all(fontsToLoad.map(f => figma.loadFontAsync(f).catch(() => {})));
```

**Loading fonts from component instances** — component instances may use fonts not present in the template's static text nodes (e.g., a component using "Uber Move" when the template uses "Inter"). After creating a component instance via `createInstance()`, and after any operation that may reveal new text nodes (`setProperties`, `appendChild` for slot content, `directUnhide`), call `loadAllFonts` on the instance before performing further mutations.

**Slot safety:** Component instances containing SLOT nodes cannot be traversed with `findAll` or `findOne` — these methods crash with `"Node with id ... not found"` when they encounter default slot children with compound IDs (see Slot mutation ordering constraint above). The `loadAllFonts` function uses a manual recursive collector with per-node try-catch instead of `findAll` to handle this safely:

```javascript
async function loadAllFonts(rootNode) {
  const textNodes = [];
  function collect(node) {
    try {
      if (node.type === 'TEXT') textNodes.push(node);
      if ('children' in node && node.children) {
        for (const c of node.children) { try { collect(c); } catch {} }
      }
    } catch {}
  }
  collect(rootNode);
  const fontSet = new Set();
  const fontsToLoad = [];
  for (const tn of textNodes) {
    try {
      const fn = tn.fontName;
      if (fn && fn !== figma.mixed && fn.family) {
        const key = fn.family + '|' + fn.style;
        if (!fontSet.has(key)) { fontSet.add(key); fontsToLoad.push(fn); }
      }
    } catch {}
  }
  await Promise.all(fontsToLoad.map(f => figma.loadFontAsync(f).catch(() => {})));
}
```

Call `loadAllFonts(instance)` at these critical points:
1. After `createInstance()` — the instance may contain text nodes with non-template fonts
2. After `setProperties()` — toggling booleans or swapping variants may reveal hidden text nodes with different fonts
3. After `appendChild()` into a SLOT — the inserted child may bring new fonts
4. After `directUnhide()` — making hidden nodes visible may expose text with unloaded fonts

This prevents `"unloaded font"` errors when Figma tries to reflow auto-layout after a mutation.

**Loading a font by family name** — font style names vary per file (`"SemiBold"` vs `"Semi Bold"`). Use `listAvailableFontsAsync` to discover exact style strings:

```javascript
async function loadFontWithFallback(family, preferredStyle, fallbackStyle) {
  fallbackStyle = fallbackStyle || 'Regular';
  const allFonts = await figma.listAvailableFontsAsync();
  const familyFonts = allFonts.filter(f => f.fontName.family === family);
  const match = familyFonts.find(f => f.fontName.style === preferredStyle);
  if (match) { await figma.loadFontAsync(match.fontName); return match.fontName; }
  const fallback = familyFonts.find(f => f.fontName.style === fallbackStyle);
  if (fallback) { await figma.loadFontAsync(fallback.fontName); return fallback.fontName; }
  if (familyFonts.length > 0) { await figma.loadFontAsync(familyFonts[0].fontName); return familyFonts[0].fontName; }
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  return { family: 'Inter', style: 'Regular' };
}
```

See [Figma MCP server guide — text-style-patterns](https://github.com/figma/mcp-server-guide/blob/main/skills/figma-use/references/text-style-patterns.md) for the upstream reference.

### SLOT Node Handling

Figma introduced **Slots** as a native component property type (currently in open beta). A `SlotNode` (`type: 'SLOT'`) is a child frame of a component that allows freeform content editing in instances — designers can add, remove, and rearrange children without detaching the instance. This mirrors how components work in code (e.g., React `children` or named slots in Vue/Svelte).

**SLOT is a fifth component property type** alongside BOOLEAN, TEXT, INSTANCE_SWAP, and VARIANT:

```javascript
type ComponentPropertyType = 'BOOLEAN' | 'TEXT' | 'INSTANCE_SWAP' | 'VARIANT' | 'SLOT'
```

**Creating slots** — `ComponentNode` exposes `createSlot()`:

```javascript
const slot = comp.createSlot(); // returns SlotNode, also creates a SLOT property in componentPropertyDefinitions
```

Slots can also be created via `addComponentProperty('name', 'SLOT', ...)`. The `editComponentProperty` method supports `preferredValues` (array of `InstanceSwapPreferredValue` — curated components suggested when adding content to the slot) and `description` (string — only SLOT properties support descriptions). `deleteComponentProperty` also supports SLOT type.

**Traversal** — skills that walk component trees to find meaningful children must handle SLOT nodes. The `resolveChildContainer` pattern used in anatomy treats a single-child SLOT the same way it treats a single-child auto-layout FRAME — as a transparent wrapper:

```javascript
// After walking through single-child auto-layout FRAMEs:
if (cc.children.length === 1 && cc.children[0].type === 'SLOT') {
  cc = cc.children[0];
}
```

When iterating `childContainer.children`, SLOT children appear as regular `SceneNode` entries — INSTANCE, TEXT, FRAME, etc. The SLOT itself only appears when it is a direct child of the container being iterated.

**Populating slot content** — use `appendChild` to insert content into a SLOT node on a component instance:

```javascript
const slotNode = compInstance.findOne(n => n.type === 'SLOT');
const contentInstance = contentComponent.createInstance();
slotNode.appendChild(contentInstance);
await loadAllFonts(compInstance); // inserted child may bring new fonts — see Font Loading above
```

Inserting into a SLOT triggers auto-layout reflow on the parent. Re-read dimensions and bounding boxes after population if marker placement or sizing depends on them.

**Slot mutation ordering constraint** — after `appendChild` into a SLOT, the child instance's internal nodes receive compound IDs (e.g., `I6291:650;6015:5301`). These compound references are **inaccessible** via `findOne`, `findAll`, and `setProperties` — calls will crash with `"The node with id ... does not exist"`. All mutations on a child instance must happen **before** `appendChild` into the slot:

```javascript
// CORRECT: mutate first, then adopt into slot
const child = contentComponent.createInstance();
await loadAllFonts(child);
child.setProperties({ 'show subtext#6015:7': true }); // works — child is free-floating
await loadAllFonts(child);
const textNode = child.findOne(n => n.type === 'TEXT' && n.name === 'subtext'); // works
if (textNode) textNode.characters = 'Supporting context';
slotNode.appendChild(child); // compound IDs assigned here — no more mutations on child internals
await loadAllFonts(parentInstance);
```

```javascript
// INCORRECT: mutate after adoption — will crash
const child = contentComponent.createInstance();
slotNode.appendChild(child);
child.setProperties({ ... }); // may crash — compound IDs
child.findOne(n => n.type === 'TEXT'); // crashes: "node with id ... does not exist"
```

**Default slot children** (instances already inside a slot when the parent instance is created) have compound IDs from the start. Calling `setProperties` or `findOne` on them after any mutation may crash or leave references stale. The workaround is to remove the default child and insert a fresh instance with pre-applied overrides:

```javascript
const slot = parentInstance.findOne(n => n.type === 'SLOT' && n.name === 'title slot');
// Remove inaccessible default child
while (slot.children.length > 0) slot.children[0].remove();
// Insert fresh instance with overrides applied before adoption
const fresh = titleContentComponent.createInstance();
await loadAllFonts(fresh);
fresh.setProperties({ 'show subtext#6015:7': true });
await loadAllFonts(fresh);
const tn = fresh.findOne(n => n.type === 'TEXT' && n.name === 'subtext');
if (tn) tn.characters = 'Supporting context';
slot.appendChild(fresh);
await loadAllFonts(parentInstance);
```

**Resetting slots** — `slotNode.resetSlot()` reverts slot content to the main component's default. Useful for cleanup or undo scenarios.

**Reading slot properties** — `componentPropertyDefinitions` entries with `type: 'SLOT'` expose:
- `preferredValues` — array of `{ type: 'COMPONENT', key: string }` pointing to recommended components for the slot
- `description` — string describing the slot's purpose (only SLOT properties support this field)

**Boolean bindings** — a slot's `componentPropertyReferences.visible` may point to a boolean property that controls slot visibility. Read it to detect hidden/conditional slots:

```javascript
const cpRefs = slotNode.componentPropertyReferences || {};
if (cpRefs.visible) {
  // cpRefs.visible is the raw key of the controlling boolean property
}
```

**Current skill support:** `create-anatomy` handles SLOT nodes with dedicated extraction, classification, preferred-instance resolution, and rendering logic. `create-structure` detects SLOT properties with `preferredValues` and generates dedicated `slotContent` sections per preferred component — measuring contextual dimensions (padding, constraints, alignment) when each preferred component is placed inside the slot across all parent sizes. `create-api` extracts `slotProps` with preferred instances and default children for Pattern A sub-component tables. `create-property` extracts `slotProps` for informational completeness and detects boolean-to-slot linkage — when a boolean controls a SLOT's visibility, the property exhibit description reads "Controls slot" with preferred content names instead of the generic "Controls layer". SLOT properties do not produce their own property chapters (slot content is freeform). `create-voice` deep-recurses into SLOT nodes during extraction, resolves `preferredValues`, records default slot children, and reads `slotVisibility` so the AI can reason about slot-hosted focus stops. When the documented focus order depends on preferred slot content rather than the default child, voice carries a slot insertion plan into artwork rendering and populates the slot before marker resolution. `create-color` uses the slot-safe `loadAllFonts` pattern for extraction (Step 4b boolean enrichment) and rendering (Step 11 preview instances). The AI reasoning layer (Step 4c) evaluates sub-component token ownership — entries with `subComponentName` from slot-hosted sub-components are filtered based on whether the parent or the sub-component owns the color (see the instruction file's token ownership framework). Other skills interact with slot-based components at the design-pattern level (composable children, container detection) without SLOT-specific node handling.

### Console MCP Tools

For the latest Console MCP tools and usage, see: https://docs.figma-console-mcp.southleft.com/tools

| Tool | Purpose |
|------|---------|
| `figma_navigate` | Open a Figma URL to start monitoring |
| `figma_take_screenshot` | Capture visual of component and variants |
| `figma_get_file_data` | Get component structure, variant axes, properties |
| `figma_get_component` | Get detailed component metadata |
| `figma_get_component_for_development` | Get component data + visual reference in one call |
| `figma_get_variables` | Get variable collections and token definitions |
| `figma_get_token_values` | Get variable values organized by collection and mode |
| `figma_get_styles` | Get color, text, effect styles |
| `figma_get_design_system_summary` | Get overview of entire design system |
| `figma_search_components` | Find components by name |

### Native MCP Tools

| Tool | Purpose |
|------|---------|
| `use_figma` | Execute Plugin API JavaScript (equivalent of `figma_execute`) |
| `get_screenshot` | Capture visual of a node |
| `get_metadata` | Structural XML inspection of a node |
| `get_design_context` | Rich node context with code, screenshot, metadata |
| `search_design_system` | Search components, variables, and styles by query |
| `get_variable_defs` | Variable definitions bound to a specific node |

### Tool Selection by Spec Type

| Spec Type | Key Operations |
|-----------|----------------|
| Anatomy / Property | Plugin JS execution (extraction, template import, rendering), screenshot (validation) |
| Screen Reader | Screenshot, file data (for states/variants), Plugin JS execution (template import, rendering) |
| Color Annotation | Variables, token values, styles, Plugin JS execution (template import, rendering) |
| API Overview | File data (variant axes), component metadata (properties), Plugin JS execution (template import, rendering) |
| Structure Spec | Token values, Plugin JS execution (for measurements, template import, rendering) |
| Motion Spec | Plugin JS execution (template import, rendering), screenshot (validation) |

## Architecture

uSpec supports two Figma MCP providers. The `mcpProvider` field in `uspecs.config.json` determines which tool calls the agent uses. Each skill's MCP Adapter section translates generic operations to the correct provider-specific calls.

```
                                ┌─── Figma Console MCP ──── figma_execute ───┐
AI Agent (Cursor / Claude /  ───┤                                            ├──> Figma
         Code / Codex)          └─── Figma MCP (Native) ─── use_figma ──────┘
```

```
Agent Host          Figma MCP           Figma
   |                    |                  |
   |-- get context ---->|                  |
   |<-- component data -|                  |
   |                    |                  |
   |-- execute JS ------|----------------->|
   |  (import template, |                  |-- render annotation
   |   create instances,|                  |-- place markers
   |   fill tables)     |                  |-- build exhibits
```

### Host-specific configuration

| Host | Project instructions | MCP config | Skill directory |
|------|---------------------|------------|-----------------|
| Cursor | `.cursor/rules/` | `.cursor/mcp.json` (user-level) | `.cursor/skills/` (all skills) |
| Claude Code | `CLAUDE.md` | `.mcp.json` (project root) | `.claude/skills/` (only `firstrun` until user runs it) |
| Codex | `AGENTS.md` | `.codex/config.toml` | `.agents/skills/` (only `firstrun` until user runs it) |

Most skills extract component data via MCP, then render annotations directly in Figma using Plugin API JavaScript (`figma_execute` on Console MCP, `use_figma` on native MCP). Each skill imports its documentation template (by component key from `uspecs.config.json`), detaches it, and fills text fields, clones sections, and builds tables programmatically. The motion skill is different: its data comes from an After Effects export script (`motion/export-timeline.jsx`) that pre-computes segments, easing values, formatted labels, and `composition.durationMs`. Raw keyframes are stripped from the output — the JSON contains only segments. The agent passes segment data and `pxPerMs` to the Figma code, which computes bar positions at render time.

The anatomy and property skills share a single template (`anatomyOverview`); anatomy clones and fills its sections first, then property re-uses the same detached frame to build its own chapters. The voice, color, API, structure, and motion skills each have their own template and render independently.

### Template Keys

Template component keys are stored in `uspecs.config.json` and configured via the `firstrun` skill. Skills read the key for their template type and import it via `figma.importComponentByKeyAsync`:

| Config key | Template |
|------------|----------|
| `screenReader` | Screen reader spec |
| `colorAnnotation` | Color annotation |
| `anatomyOverview` | Anatomy annotation template |
| `apiOverview` | API overview |
| `structureSpec` | Structure specification |
| `propertyOverview` | Property overview |
| `motionSpec` | Motion specification |

## Components

### Skills

All skills render directly in Figma via Plugin API JavaScript (`figma_execute` on Console MCP, `use_figma` on native MCP), following a shared pattern:

1. **Extract** — Gather component data via MCP tools and AI reasoning (motion skill reads pre-computed data from AE export JSON instead)
2. **Import template** — `figma.importComponentByKeyAsync` with the skill's template key (from `uspecs.config.json`), create instance, detach, and place on the **component's page** to the right of the component (see Spec Placement below)
3. **Fill header** — Set component name, description, and header text
4. **Build content** — Clone template sections, fill text fields, build tables, create component instances where needed
5. **Validate** — Screenshot to verify output (`figma_take_screenshot` or `get_screenshot`)
6. **Completion link** — Print a clickable Figma deep-link URL to the rendered spec frame in chat: `https://www.figma.com/design/{fileKey}/?node-id={frameId}` (with `:` replaced by `-` in the node ID)

**Template keys:** All template keys are stored in `uspecs.config.json` under the `templateKeys` object and configured via the `firstrun` skill. Each skill has its own template key.

**Variant matching (Anatomy/Property):** When creating component instances for a specific property value, the skill first attempts an exact match across all variant axes. If no exact match exists, it falls back to the best partial match.

**Variant selection (Anatomy):** Step 3 uses the default variant for extraction. If the default variant produces 0 elements after wrapper traversal (e.g., an unchecked checkbox whose default state has an empty structure frame), the script falls back to the richest variant (most descendant children). The selected variant's ID is returned as `selectedVariantId` and reused by Step 8 for rendering, ensuring the artwork matches the extraction data.

**Marker positioning (Anatomy & Voice):** After placing the component instance in the artwork, the skill re-reads actual child positions from the instance using `absoluteTransform` rather than relying on extraction-time positions. Marker placement uses the **nearest-edge + collision avoidance** algorithm: for each element, score all four sides by distance from the element's edge to the component boundary, pick the shortest, then check for overlap with already-placed markers (8px minimum gap). If overlap exists, apply perpendicular offset; if offset exceeds artwork bounds, try the next-best side. In Anatomy, when multiple sides tie at the same distance, a tiebreaker prefers top/bottom over left/right (producing cleaner vertical connector lines for wide components). Connectors are always straight lines from the marker to the element's nearest edge; when a perpendicular collision-avoidance offset is applied, the anchor point on the element edge shifts by the same offset so the line stays axis-aligned. Anatomy also supports **inline markers** for elements nested inside other annotated elements — these sit on the nearest edge with a short stub line (16px) and are excluded from the perimeter collision pool.

**Slot preferred instances (Anatomy):** The Step 3 extraction script reads `componentPropertyDefinitions` for SLOT-type properties with `preferredValues`, resolves component keys via local page traversal, and reads `componentPropertyReferences.visible` for boolean bindings. Step 4 enriches slot notes with preferred component names, marks hidden/empty slots for artwork population, and sets section eligibility. Step 8 inserts preferred component instances directly into the SLOT node via `appendChild`; if slot insertion fails, it falls back to a ghost instance overlay. Step 8b creates sub-component anatomy sections for eligible preferred instances, deduplicating against existing default slot children.

**Property extraction (Property):** `create-property` uses a two-tier extraction model. **Tier 1 (deterministic scripts):** Steps 3, 3a, 3c, and 3d are `figma_execute` scripts that extract properties, resolve variant-gated booleans, link controlling booleans to child components by node ID, and normalize the data (coupled axes, unified slot chapters, sibling boolean collapsing). **Tier 2 (AI reasoning):** Step 3b (variable mode search) requires AI judgment for collection matching, and Step 3e is a validation layer that cross-checks the deterministic output for semantic mismatches, structural anomalies, and combination count sanity before rendering.

**Structure extraction (Structure):** `create-structure` uses the same two-tier extraction model. **Tier 1 (deterministic scripts):** Steps 4b (enhanced extraction: dimensions, tokens, sub-components, collapsed dimensions) and 4d (cross-variant dimensional comparison) are `figma_execute` scripts that measure every variant, resolve token bindings, walk sub-component trees, and build the raw comparison data. **Tier 2 (AI reasoning):** Step 6 is an AI interpretation layer that builds the section plan, writes design-intent notes, detects anomalies, and judges completeness before the deterministic rendering step fills the template.

**Color extraction (Color):** `create-color` uses the same two-tier extraction model. **Tier 1 (deterministic script):** Step 4b is a single consolidated `figma_execute` script that walks the component tree, resolves color variable bindings (paint/stroke style names take precedence over variable bindings), classifies variant axes by token fingerprint, detects boolean-gated elements (with nested boolean enablement), tags sub-component instances with their parent component set name, discovers mode-controlled collections, and detects composite paint styles (2+ visible fill layers) — emitting a `compositeDetail` object with layer stacking order, blend modes, opacities, and gradient stops. **Tier 2 (AI reasoning):** Step 4c interprets the extraction output — chooses the rendering strategy (Strategy A vs B via the two-gate model), builds the variant plan, resolves mode-specific token aliases, maps elements to tokens, and constructs `compositeChildren` breakdowns for multi-layer styles.

**Spec placement:** The import template step places the spec frame on the **same page as the source component**, positioned to its right with a 200 px gap. The script resolves the component node via `getNodeByIdAsync`, walks up to its PAGE ancestor, calls `setCurrentPageAsync` to activate that page, then positions the frame at `compNode.x + compNode.width + 200, compNode.y`. This works identically for both MCP providers — the page-loading block is harmless on Console MCP where the page is already active. For skills that accept a cross-file destination URL (anatomy, property, structure, motion), the cross-file branch keeps the existing viewport-center placement; the component-relative placement only applies when the spec stays in the same file as the component.

**Completion link:** After the final validation step, the agent constructs a Figma deep-link URL from the `fileKey` (extracted from the user's input URL) and the `frameId` (returned by the import step), replacing `:` with `-` in the node ID. The agent prints this URL in chat so the user can click directly to the rendered spec.

**Clone visibility:** All cloned sections explicitly set `visible = true` after cloning, since template sources are hidden. Some templates (e.g., color's `#variant-template` and `#hierarchy-indicator`) default to `visible = false`; rendering scripts only flip sub-elements to `visible = true` when needed (e.g., hierarchy indicators on composite child rows) rather than hiding them after the fact.

| Skill | Template | Sections Generated |
|-------|----------|-------------------|
| `create-anatomy` | Anatomy | Component structure with numbered markers and attribute table |
| `create-property` | Property | One chapter per variant axis (with instance previews) and per boolean toggle |
| `create-voice` | Screen reader | Focus order, per-state platform sections (VoiceOver, TalkBack, ARIA) with property tables |
| `create-color` | Color annotation | Per-variant sections with element-to-token mapping tables (Strategy A for ≤6 variants; Strategy B consolidates states into columns for >6). Composite paint styles render as nested child rows with hierarchy indicators. |
| `create-api` | API overview | Main property table, sub-component tables, configuration examples |
| `create-structure` | Structure spec | Per-section dimensional tables with dynamic columns for size/density variants |
| `create-motion` | Motion spec | Timeline bars with easing-colored segments (bar positions computed in Figma code), detail table from pre-computed segments |

### Skill and Agent Instruction Architecture

Each skill has two layers:

- **SKILL.md** is the orchestration layer — it defines WHAT to do and WHEN. It contains the
  step-by-step workflow, MCP adapter mapping, executable Figma Plugin API scripts, script output
  contracts, intermediate data structures, and template mechanics.

- **Agent instruction file** (e.g., `structure/agent-structure-instruction.md`) is the domain
  knowledge layer — it defines HOW to think and decide. It contains interpretation guidance for
  extraction output, decision frameworks, property naming conventions, value formatting rules,
  worked examples, common mistakes, edge cases, and validation checklists.

SKILL.md should not re-teach domain concepts that the instruction file covers. The instruction file
should not describe script implementation details or workflow step numbers. The script output
contract in SKILL.md (what each script returns) is the bridge between the two layers — SKILL.md
describes the data shapes, the instruction file teaches the agent what to do with them.

See the Reference Files table at the bottom for each spec type's instruction file.

### Template Infrastructure

Template component keys are stored in `uspecs.config.json` at the project root and configured via the `firstrun` skill. Each skill reads its key from this file and imports the template via Plugin API JavaScript calling `figma.importComponentByKeyAsync`.

### Template Key Config

The template infrastructure uses a config file for extensibility:

**Template key config (`uspecs.config.json`):**

```json
{
  "mcpProvider": "figma-mcp",
  "environment": "cursor",
  "extractionSource": "plugin",
  "fontFamily": "Inter",
  "templateKeys": {
    "screenReader": "key-from-firstrun",
    "colorAnnotation": "key-from-firstrun",
    "anatomyOverview": "key-from-firstrun",
    "apiOverview": "key-from-firstrun",
    "propertyOverview": "key-from-firstrun",
    "structureSpec": "key-from-firstrun",
    "motionSpec": "key-from-firstrun"
  },
  "reconciliation": {
    "autoRetry": true
  }
}
```

**`mcpProvider`:** Determines which Figma MCP the `create-*` skills use. Values: `"figma-console"` (Southleft Console MCP with Desktop Bridge) or `"figma-mcp"` (native Figma MCP with write access). Set by the `firstrun` skill. Each skill reads this value and follows the matching tool-call path in its MCP Adapter section. The component markdown path does not use the MCP for measurements — it reads `_base.json` from disk — but the field is still consulted if a sub-skill's optional Step 3-delta triggers.

**`extractionSource`:** Signals where the component markdown path expects its input to come from. Current value: `"plugin"` (produced by `figma-plugin/`). Non-plugin extraction sources are not currently supported; the orchestrator's Step 1 aborts if the input cannot be validated against `figma-plugin/docs/base-json-schema.md`.

**`reconciliation.autoRetry`:** Toggles the `create-component-md` orchestrator's Step 8.5 bounded serial retry loop. When `true`, typed disagreements between `extract-structure` / `extract-color` / `extract-voice` trigger up to N targeted re-runs of the offending specialist with the mismatch payload attached. When `false`, mismatches are recorded into `reconciliation.json` and carried through to the final audit without retries.

**`fontFamily` and the `__FONT_FAMILY__` placeholder:** The `fontFamily` value (detected by `firstrun` from the template library) is used in rendering scripts that create text labels in Figma. Skills declare `const FONT_FAMILY = '__FONT_FAMILY__';` at the top of each rendering script, and the agent replaces `__FONT_FAMILY__` with the value from `uspecs.config.json` before execution. This follows the same `__PLACEHOLDER__` convention used for all dynamic values in `figma_execute` scripts.

**Adding a new template type requires:**

1. Add a new key to `uspecs.config.json` under `templateKeys`
2. Create a new SKILL.md in the platform-neutral source at `skills/<name>/SKILL.md` with the MCP Adapter preamble and a workflow that reads the key and uses `figma.importComponentByKeyAsync` to import the template. Use `{{skill:name}}` and `{{ref:path}}` tokens for any cross-references to other skills or shared docs.
3. Update the `firstrun` skill (in `skills/firstrun/SKILL.md`) to search for and extract the new template's component key
4. Rebuild the CLI bundle with `cd packages/cli && npm run build` so the new skill ships in the published `templates/` artifact, then bump the package version and publish (`npm publish --access public`). Existing installs pick up the new skill via `npx uspec-skills update`.
5. Add the new skill to the tables in `CLAUDE.md`, `AGENTS.md`, and this file

## Cloning Logic

All skills follow a shared "clone from pristine template, fill, hide/remove original" pattern implemented inline within each Plugin API call (`figma_execute` / `use_figma`):

1. **Find template** — Locate the hidden template node by name (e.g., `#section-template`, `#variant-template`, `#row-template`)
2. **Clone per data item** — For each item in the data array, call `template.clone()` and append the clone to the template's parent
3. **Set visible** — Each clone sets `visible = true` (templates are hidden by default)
4. **Fill content** — Load fonts, set text fields, configure properties on each clone
5. **Remove or hide original** — After all clones are created, either `template.remove()` (for row-level templates) or `template.visible = false` (for section-level templates). Templates that default to `visible = false` (e.g., color's `#variant-template`) skip this step.

This pattern nests at multiple levels. For example, the screen reader skill clones state templates, then within each state clones platform section templates, then within each section clones table templates, then within each table clones row templates. Each nesting level follows the same clone-fill-remove pattern within a single Plugin API call.

## Stability

Each skill splits work across multiple Plugin API calls (`figma_execute` / `use_figma`) to avoid timeouts — typically one call per section, variant, or state. This keeps each call's execution time short and lets Figma process between calls. Complex specs (e.g., structure with many sections, screen reader with many states) benefit most from this pattern.

## Component Markdown Pipeline

The component markdown path produces a single standalone `.md` spec per component. It bypasses the Figma MCP for measurements — data comes from a locally-installed Figma Desktop plugin that runs inside the Figma plugin sandbox and writes a `_base.json` file to disk. Interpreter skills then read that file and render the `.md`.

### Why this path exists

Each `create-*` Figma-native skill costs roughly 100k tokens per run because the majority of the weight is the Figma render pass: `setProperties`, `createInstance`, `loadFontAsync`, layout math, cloning templates, placing markers. The `extract-*` skills strip all of that. Because the plugin produces a single shared `_base.json`, the interpreters also stop calling the MCP for measurements — they read that file from disk. Per-spec token cost drops into the low tens of thousands and the parent orchestrator only holds one-line summaries from each specialist. The `.md` artifact is also easier to diff, review, and hand to downstream code-generation tools than seven separate Figma frames.

### Figma plugin (`figma-plugin/`)

A local Figma Desktop plugin installed via **Plugins → Development → Import plugin from manifest…**. Not published to Figma Community — the source lives in-repo under `figma-plugin/` and is built with esbuild.

The plugin walks the selected `COMPONENT` or `COMPONENT_SET` (a selected variant is auto-promoted to its component set) through a fixed sequence of phases and emits `{componentSlug}-_base.json`. Every variant is walked — no default-variant sampling — so cross-variant diffs are computed in the sandbox rather than reconstructed by the agent.

| Phase | File | Purpose |
|-------|------|---------|
| A | `phaseA.ts` | Meta, axes, component property definitions |
| B | `phaseB.ts` | Local variable collections + resolved values per mode |
| C | `phaseC.ts` | Style resolution with inline-sample fallback when library styles are unresolvable |
| D | `phaseD.ts` | Library-linked variable resolution (`name`, `codeSyntax`, alias chains, remote collection metadata) via `figma.variables.getVariableByIdAsync` |
| E | `phaseE.ts` | Per-variant walker: dimensions, hierarchical tree, color walk, post-walk validation. `extractDims` is exported for reuse by Phase I. |
| F | `phaseF.ts` | Cross-variant diffs + axis classification |
| F′ | `childComposition.ts` | First-guess classification for each top-level child instance (constitutive / referenced / decorative). Designer confirms or flips each guess in the plugin UI before extraction completes. |
| G | `phaseG.ts` | Revealed trees + slot host geometry |
| H | `phaseH.ts` | Ownership hints (which element "owns" a given color / dimension) |
| I | `phaseI.ts` | Constitutive sub-component variant walks: enumerates each constitutive child's own variant axes (cross-product capped at 20 combos per sub), measures `dimensions` + `treeHierarchical` per combo, emits `subComponentVariantWalks` keyed by `subCompSetId`. Fixes the case where a parent-variant walk captures a child only in its embedded configuration and misses the child's own size/density/etc. axes. |

**Designer-in-the-loop composition.** Phase F′ pre-classifies children using node metadata (name, main component set, variant axes), but the plugin UI surfaces each top-level child for designer review. Confirmed or flipped guesses land in `_childComposition.children[*]` with `classificationEvidence: ["user-selected"]`. The orchestrator's Step 4.5 review short-circuits to a confirmation-only pass when every child carries that evidence.

**Defensive accessors.** `src/safe.ts` provides `safeLen`, `sg`, and `sidStr` wrappers that let the walker tolerate `GROUP` and `SLOT` nodes whose property reads would otherwise throw under the plugin sandbox's strict mode.

**Inline font capture.** Text style IDs are recorded, but inline font family + style + size + weight are also captured on every text node so typography data survives even when a library-linked text style cannot be resolved.

**Schema + validator.** The full `_base.json` shape is documented in [`figma-plugin/docs/base-json-schema.md`](figma-plugin/docs/base-json-schema.md). An Ajv validator lives at `figma-plugin/scripts/validate-base.mjs` and is shell-executed by the orchestrator's Step 1 — non-zero exit aborts the run with the validator's FAIL output.

### `create-component-md` orchestrator

Inputs:

- `baseJsonPath` _(required)_ — path to the plugin's output. Missing → abort with "run the uSpec Extract plugin".
- `figmaLink` _(optional)_ — only consulted if an interpreter's Step 3-delta MCP call fires. `_meta.fileKey` / `_meta.nodeId` from `_base.json` win when the two disagree; the parent logs a `META_DISAGREES_WITH_LINK` warning.
- `optionalContext` _(optional)_ — free-form design intent forwarded verbatim to every sub-skill. `_base.json._meta.optionalContext` wins when both are set.

Workflow (abridged — the canonical checklist lives in `.cursor/skills/create-component-md/SKILL.md`):

1. **Preflight.** Read `uspecs.config.json`, load `_base.json`, run the Ajv validator. Extract `_meta.{fileKey, nodeId, componentSlug, optionalContext, extractionSource}`.
2. **Resolve `componentSlug`** and the output path (default `./components/{componentSlug}.md`). Create `./components/` (tracked) and `.uspec-cache/{componentSlug}/` (gitignored).
3. **Announce the plan.** One-line summary of what will be generated.
4. **Stage `_base.json`** into `.uspec-cache/{componentSlug}/_base.json`.
5. **Run `extract-api` inline in the parent.** Produces `{componentSlug}-api.json` and `api-dictionary.json`. The dictionary lands in the parent so downstream specialists can read it.
6. **Parallel fan-out.** Dispatch `extract-structure`, `extract-color`, `extract-voice` as three `generalPurpose` subagents in a single batch. Each subagent holds its own `_base.json` + `api-dictionary.json` context; the parent keeps only the returned one-line summary + cache-file path from each.
7. **Reconciliation (Step 8.5).** Compare the three specialist artifacts for typed disagreements (e.g., same element classified as `constitutive` in structure but `referenced` in voice; variant axis present in one artifact and absent in another). When `reconciliation.autoRetry === true`, re-run the offending specialist with the mismatch payload attached, up to a bounded retry count. Write the final verdict to `reconciliation.json`.
8. **Render the `.md`** per `component-md/agent-component-md-instruction.md` using all four cache files + `api-dictionary.json`.
9. **Integrity check (Step 9.5).** Validate every cache file's shape, assert axis-name consistency across artifacts, assert voice state platform coverage, assert the `coverageMatrix` artifact from `extract-structure` is `complete === true`, and recount `framesWalked` independently. Abort on failure.
10. **Audit + summary.** Emit a one-line run summary.
11. **Recursion manifest (Step 10.5).** Emit a manifest of constitutive children so the caller can fan out to generate per-child `.md` specs without re-walking `_base.json`.

### `.uspec-cache/` layout

Produced per component by the orchestrator. `.uspec-cache/` is gitignored.

```
.uspec-cache/{componentSlug}/
├── _base.json                      staged copy of plugin output
├── {componentSlug}-api.json        from extract-api
├── {componentSlug}-structure.json  from extract-structure
├── {componentSlug}-color.json      from extract-color
├── {componentSlug}-voice.json      from extract-voice
├── api-dictionary.json             shared dictionary that steers structure/color/voice
└── reconciliation.json             Step 8.5 verdicts + retry log
```

### `extract-*` interpreter skills

Shared shape across all four:

- **Read-only.** No MCP calls except an optional Step 3-delta ping if a measurement is missing from `_base.json` and `figmaLink` was passed. The delta path writes tiny `_deltaExtractions` entries into the cache artifact so the orchestrator can surface them in the audit.
- **Paired instruction file.** Each `extract-<type>` references the canonical `agent-<type>-instruction.md` for domain rules (same instruction file the Figma-native `create-<type>` skill uses). The skill teaches the read-path over `_base.json` fields; the instruction file teaches the interpretation rules.
- **Deterministic output paths.** `{componentSlug}-<type>.json` under the component's cache directory, plus any `_deltaExtractions` requests.
- **Provenance flags.** Every row / cell carries a `provenance` tag (`measured`, `inferred`, `delta`, or `"—"` with a reason) so the orchestrator and downstream readers can trust or challenge values without re-running the pipeline.

`extract-structure` is the largest of the four. It consumes the Phase I `subComponentVariantWalks` block to populate per-column values for constitutive sub-components across their own variant axes (e.g., `Input` size=`large|medium|small`), replacing the old "—" placeholders. When a matching walk entry exists, cells are sourced from `variants[*].dimensions` (or `treeHierarchical` for hierarchical properties) with `provenance: 'measured'`; when it is missing or the walk was skipped, a `_deltaExtractions` gap is emitted instead of a silent "—".

### Source-of-truth semantics

The Figma-native skills treat the Figma file as the source of truth for the component spec and write annotation frames beside the component. `create-component-md` inverts that relationship: the `.md` file is the source of truth for implementation, and Figma is only the source of extraction. Downstream code generators, documentation sites, and review tools should consume the `.md`; regenerating it is cheap because the plugin + interpreter chain is deterministic given the same `_base.json`.

## Skill Source and CLI (`packages/cli/`)

Skills, references, and the CLI that installs them are versioned together but live in separate trees:

```
skills/<name>/SKILL.md            platform-neutral source of truth, with {{skill:}} / {{ref:}} tokens
references/<area>/*.md            shared instruction and reference files
packages/cli/                     the uspec-skills npm package (CLI + render engine)
packages/cli/templates/           bundled copy of skills/ and references/ — built artifact
.cursor/skills/                   generated per-host artifact (DO NOT edit)
.claude/skills/                   generated per-host artifact (DO NOT edit)
.agents/skills/                   generated per-host artifact (DO NOT edit)
```

### Tokenized cross-references

Because the same `SKILL.md` is rendered into three different per-host directories whose relative paths to `references/` differ (e.g., `.cursor/skills/<name>/SKILL.md` reaches references via `../../references/...`, while `.claude/skills/<name>/SKILL.md` reaches them via `../../../references/...`), bare relative paths inside a SKILL.md cannot work across hosts. The CLI's render engine rewrites two token forms at install time:

| Token | Rewritten to | Purpose |
|---|---|---|
| `{{skill:other-skill}}` | host-specific invocation phrasing (e.g., `@other-skill` for Cursor, "the other-skill skill" elsewhere) | Cross-skill references |
| `{{ref:area/file.md}}` | host-correct relative path to `references/area/file.md` | Pointers to shared instruction files |

Authors should always use these tokens in the source `skills/<name>/SKILL.md`. Bare relative paths to `references/...` will resolve correctly only on Cursor and break on Claude Code / Codex.

### CLI package layout

```
packages/cli/
├── package.json                 published to npm as "uspec-skills"
├── src/
│   ├── cli.ts                   command dispatcher
│   ├── render.ts                token rewrite + per-host writer
│   ├── paths.ts                 source-dir resolution (dev vs production)
│   ├── config.ts                uspecs.config.json reader/writer
│   ├── version.ts               reads CLI version into config.cliVersion
│   └── commands/
│       ├── init.ts              interactive setup; bootstraps empty dirs
│       ├── install.ts           non-interactive (re-)install for a platform
│       ├── update.ts            wraps install — re-render after package upgrade
│       ├── doctor.ts            verify install + report drift
│       └── render.ts            internal render driver
├── scripts/
│   ├── build.mjs                esbuild → dist/index.js + copy templates/
│   └── check-registry.mjs       prepublishOnly safety guard (blocks non-public registries)
├── templates/                   built copy of /skills and /references (gitignored)
└── .npmrc                       pins this package's registry to npmjs.org
```

### Commands

| Command | Purpose |
|---|---|
| `npx uspec-skills init` | Interactive setup: prompts for platform + MCP, installs skills + references, writes `uspecs.config.json`. Bootstraps a fresh project when no `.git/`, `package.json`, or `uspecs.config.json` is found above the current directory. |
| `npx uspec-skills install [--platform p]` | Non-interactive (re-)install. Reads `environment` from `uspecs.config.json` if `--platform` is omitted. Idempotent. When called with `--platform` for a secondary host, preserves the primary `environment` field already in the config. |
| `npx uspec-skills update` | Re-renders skills against the currently installed CLI version. Run after upgrading the package. |
| `npx uspec-skills doctor` | Verifies install: checks `uspecs.config.json` exists and has `environment`, the platform's skills directory is populated, all `.md`-relative links resolve, and reports CLI version drift. |

### Source-dir resolution

`paths.ts → resolveSourceDirs()` looks for skills and references in two places:

1. **Production** — `<package>/templates/skills` and `<package>/templates/references` inside the installed npm package. The build script copies the repo's `skills/` and `references/` into `templates/` on every build.
2. **Development** — when running directly from a checkout with no `templates/` dir, walks up from the CLI module location until it finds sibling `skills/` and `references/` directories.

Production wins when both are present, so a published package never accidentally serves files from a stale checkout.

### Publish safety

Three defensive layers prevent accidentally publishing this package to a non-public registry (e.g., an Uber internal registry that may be configured globally):

1. `package.json → publishConfig.registry` pins the publish target to `https://registry.npmjs.org/`
2. A local `packages/cli/.npmrc` overrides any user-level registry config for this directory
3. `prepublishOnly → scripts/check-registry.mjs` runs before every `npm publish` and aborts with a non-zero exit if the resolved registry isn't `registry.npmjs.org`

Always publish from inside `packages/cli/` so the local `.npmrc` is honored.

### `uspecs.config.json` fields written by the CLI

| Field | Written by | Notes |
|---|---|---|
| `environment` | `init` (always) and `install` only when no value already present | Primary host: `cursor` \| `claude-code` \| `codex` |
| `mcpProvider` | `init` (always) | `figma-mcp` \| `figma-console` |
| `cliVersion` | `init`, `install`, `update` | Used by `doctor` to surface drift between recorded version and installed CLI |
| `templateKeys`, `fontFamily` | `firstrun` skill (not the CLI) | Filled by the agent on first run after install |

## Documentation Site

The uSpec docs are hosted at **https://docs.uspec.design** using [Mintlify](https://mintlify.com).

### Updating docs

1. Reference the Mintlify writing rule (`.cursor/rules/mintlify.mdc` in Cursor, or read it directly in other hosts) so the agent uses the correct writing style and Mintlify components
2. Edit the MDX files in `docs/` (and update `docs/docs.json` if adding or removing pages)
3. Push to `main` — Mintlify auto-deploys within 1–2 minutes

### Docs file structure

```
docs/
├── docs.json              # Site config: theme, navigation, colors, metadata
├── index.mdx              # Homepage
├── getting-started.mdx    # Setup and first spec guide
├── how-it-works.mdx       # System overview
├── specs/                 # Specification type docs
├── help/                  # Troubleshooting, contribute, changelog
├── images/                # Screenshots, videos, and spec output demos
├── logo/                  # Logo files (light.svg, dark.svg)
└── favicon.svg
```

### Key references

- **Writing rule**: `.cursor/rules/mintlify.mdc` — component syntax, writing style, content standards
- **Mintlify MCP**: `SearchMintlify` tool — look up component syntax, configuration, and best practices
- **Local preview**: `npx mintlify dev` from `docs/` directory (port 3000)
- **Site config schema**: https://mintlify.com/docs.json

## Reference Files

### Skill source (platform-neutral — `skills/`)

Every skill is authored once at the repo root in `skills/<name>/SKILL.md` with `{{skill:name}}` and `{{ref:path}}` tokens. The CLI's render engine rewrites those tokens per host at install time. **Always edit these source files**, never the per-host generated copies.

**Figma-native path:**

| File | Content |
|------|---------|
| `skills/create-anatomy/SKILL.md` | Anatomy: extraction, marker rendering, attribute table |
| `skills/create-property/SKILL.md` | Property: variant axis and boolean toggle exhibits |
| `skills/create-voice/SKILL.md` | Screen reader: merge analysis, platform sections, property tables |
| `skills/create-color/SKILL.md` | Color: consolidated extraction (style-over-variable token resolution, composite style detection, axis classification, boolean gating, sub-component tagging, mode discovery), AI strategy selection, element-to-token mapping tables, composite breakdown with hierarchy indicators |
| `skills/create-api/SKILL.md` | API: main table, sub-component tables, configuration examples |
| `skills/create-structure/SKILL.md` | Structure: dynamic columns, hierarchy indicators, dimensional tables |
| `skills/create-motion/SKILL.md` | Motion: timeline bars, pre-computed easing segments, detail table |

**Component markdown path:**

| File | Content |
|------|---------|
| `skills/create-component-md/SKILL.md` | Orchestrator: preflight + schema validation, Step 4.5 composition review, `extract-api` inline run, parallel fan-out of `extract-structure` / `extract-color` / `extract-voice` as subagents, Step 8.5 reconciliation, Step 9 `.md` render, Step 9.5 integrity check, Step 10.5 recursion manifest |
| `skills/extract-api/SKILL.md` | Interpret API / properties / sub-components / examples from `_base.json`; emit `{slug}-api.json` + shared `api-dictionary.json` |
| `skills/extract-structure/SKILL.md` | Interpret variant axes, dimensions, `subComponentVariantWalks`, slot contents, cross-variant diffs; emit `{slug}-structure.json` with `coverageMatrix` audit artifact |
| `skills/extract-color/SKILL.md` | Interpret per-element fills/strokes/effects, axis classification, boolean delta, variable-mode detection, rendering strategy; emit `{slug}-color.json` |
| `skills/extract-voice/SKILL.md` | Interpret focus order, merge analysis, per-state VoiceOver/TalkBack/ARIA tables, slot insertion plans; emit `{slug}-voice.json` |

**Setup:**

| File | Content |
|------|---------|
| `skills/firstrun/SKILL.md` | First run: prompts for MCP provider and environment, syncs skills to the chosen platform via the CLI, configures the Figma template library |

### Per-host generated artifacts

These directories are produced by `npx uspec-skills install`/`update` from the platform-neutral source above. They are **gitignored in consumer projects** and **never edited directly**:

- `.cursor/skills/` — Cursor host. Cross-skill references rendered as `@skill-name`; relative paths to `references/` use `../../`.
- `.claude/skills/` — Claude Code CLI host. Cross-skill references rendered as `the skill-name skill`; relative paths to `references/` use `../../../`.
- `.agents/skills/` — Codex CLI host. Same rendering as Claude Code.

In this monorepo we keep a checked-in copy of `.cursor/skills/` because the development repo itself uses uSpec; consumer projects only have the directory matching their chosen host.

### Host configuration and utilities

| File | Content |
|------|---------|
| `CLAUDE.md` | Claude Code project instructions and skill index |
| `AGENTS.md` | Codex agent instructions and skill index |
| `.mcp.json` | Shared MCP config (Claude Code reads this by default) |
| `.codex/config.toml` | Codex MCP config |
| `.cursor/mcp.json` | Cursor MCP config (gitignored — user configures locally) |
| `utils/sync-skills.sh` | **Legacy.** Pre-CLI sync script kept for backward compatibility. New work should rely on `npx uspec-skills install` / `update` instead — see the [Skill Source and CLI](#skill-source-and-cli-packagescli) section. |

### Agent Instruction Files

Each domain owns one canonical instruction file that both the Figma-native `create-<type>` skill and the read-only `extract-<type>` sub-skill reference. The `component-md` instruction file is unique to the markdown path.

All instruction files live under `references/<area>/` at the repo root and are shipped to consumer projects by the CLI as `./references/<area>/...`. From inside a `SKILL.md`, link to them via the `{{ref:area/filename.md}}` token (the render engine inserts the host-correct relative path).

| File | Content |
|------|---------|
| `references/anatomy/agent-anatomy-instruction.md` | Anatomy annotation: extraction validation checklist, note-writing guidelines, property-aware unhide decisions, nearest-edge marker placement, inline marker detection, slot preferred instance enrichment |
| `references/screen-reader/agent-screenreader-instruction.md` | Screen reader spec: data schema, platform reference (VoiceOver/TalkBack/ARIA), merge analysis guidance. Consumed by both `create-voice` and `extract-voice`. |
| `references/screen-reader/voiceover.md` | iOS accessibility properties reference |
| `references/screen-reader/talkback.md` | Android semantics and roles reference |
| `references/screen-reader/aria.md` | ARIA roles and states reference |
| `references/color/agent-color-instruction.md` | Color annotation: strategy selection (A vs B), token resolution rules (styles over variables), element-to-token mapping, composite style breakdown, hierarchy indicator rendering, rendering decisions. Consumed by both `create-color` and `extract-color`. |
| `references/api/agent-api-instruction.md` | API overview: property classification rules, sub-component patterns (slot vs fixed), naming conventions, validation checklist. Consumed by both `create-api` and `extract-api`. |
| `references/api/api-library.md` | API documentation reference patterns |
| `references/structure/agent-structure-instruction.md` | Structure spec: interpretation guidance, section planning, dimensional comparison rules, sub-component variant walk read-path, anomaly detection. Consumed by both `create-structure` and `extract-structure`. |
| `references/motion/agent-motion-instruction.md` | Motion spec: JSON schema (with pre-computed segments), rendering rules, timeline layout |
| `references/motion/export-timeline.jsx` | After Effects export script: keyframe extraction, segment computation, cubic-bezier conversion, value formatting, keyframe stripping |
| `references/property/agent-property-instruction.md` | Property exhibit interpretation: variant axis classification, boolean-to-slot linkage, validation. Consumed by `create-property`. |
| `references/component-md/agent-component-md-instruction.md` | Component markdown renderer: section plan, how to compose API + Structure + Color + Voice into a single `.md`, referenced-child disclosure rules, recursion manifest format |
| `references/component-md/component-md-template.md` | Reference template for the final `.md` output (headings, table shapes, disclaimers) |

### Figma plugin (`figma-plugin/`)

| File | Content |
|------|---------|
| `figma-plugin/README.md` | Install, use, validate, and hand-off instructions for the uSpec Extract plugin |
| `figma-plugin/docs/base-json-schema.md` | Canonical `_base.json` field reference, phase map, audit checklist |
| `figma-plugin/manifest.json` | Figma plugin manifest |
| `figma-plugin/scripts/build.mjs` | esbuild bundler (writes `dist/code.js`, `dist/ui.html`) |
| `figma-plugin/scripts/validate-base.mjs` | Ajv schema validator — shell-executed by `create-component-md` Step 1 |
| `figma-plugin/src/code.ts` | Sandbox entry point; orchestrates all phases |
| `figma-plugin/src/ui.html` + `src/ui.ts` | Plugin UI iframe (checklist for child classification, download, clipboard) |
| `figma-plugin/src/types.ts` | Shared types between sandbox and iframe |
| `figma-plugin/src/safe.ts` | Defensive property accessors (`safeLen`, `sg`, `sidStr`) |
| `figma-plugin/src/phaseA.ts` … `phaseH.ts` | Extraction phases A–H (see the [phase map](#figma-plugin-figma-plugin) above) |
| `figma-plugin/src/phaseI.ts` | Phase I — constitutive sub-component variant walks; uses `extractDims` exported from `phaseE.ts` |
| `figma-plugin/src/childComposition.ts` | Phase F′ — first-guess child classification |
