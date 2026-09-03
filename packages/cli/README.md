# uspec-skills

Install [uSpec](https://uspec.design/) design-system documentation skills into your AI coding agent (Cursor, Claude Code, or Codex).

## Quick start

In your project directory, run:

```bash
npx uspec-skills init
```

The CLI:

1. Asks which agent you use (Cursor, Claude Code, or Codex) and which Figma MCP.
2. Installs all uSpec skills into the right place for that agent (`.cursor/skills/`, `.claude/skills/`, or `.agents/skills/`).
3. Copies shared reference docs into `./references/` so the skills can link to them.
4. Writes `uspecs.config.json` at your project root with your selections.

After `init`, ask your agent to run the `firstrun` skill to extract template keys from your Figma library. uSpec is then ready to use.

## Commands

| Command | What it does |
|---|---|
| `npx uspec-skills init` | Interactive setup. Run this first. |
| `npx uspec-skills install [--platform p]` | Non-interactive install. Reads `uspecs.config.json` if present, or accepts `--platform cursor \| claude-code \| codex`. Idempotent. |
| `npx uspec-skills update` | Re-render skills from the installed CLI version. Run after upgrading the package. |
| `npx uspec-skills doctor` | Verify your install. Reports missing skills, missing references, or broken links. |
| `npx uspec-skills component-md prepare --base <path> [--json]` | Validate and stage a plugin `_base.json`; writes prepare manifest + evidence slices to `.uspec-cache/`. Used by `create-component-md`. |
| `npx uspec-skills component-md validate --cache <dir> --slug <slug> [--domain <name>] [--normalize]` | Normalize unavailable deltas and validate each specialist cache as soon as it is written. |
| `npx uspec-skills component-md contract --manifest <path> --plan <path> [--json]` | Compile validated specialist semantics into one schema-valid canonical JSON contract. |
| `npx uspec-skills component-md render --manifest <path> --plan <path> --contract <path> [--view concise\|audit] [--json]` | Render the implementation Markdown deterministically from the canonical contract. `concise` is the default; `audit` is opt-in diagnostics. |

## What gets installed

```
your-project/
├── .cursor/skills/        # (or .claude/skills/, or .agents/skills/)
│   ├── firstrun/
│   ├── create-api/
│   ├── create-color/
│   ├── create-component-md/
│   └── ... (13 skills total)
├── references/            # shared docs the skills link to
│   ├── api/
│   ├── color/
│   ├── screen-reader/
│   └── ... (8 reference dirs)
└── uspecs.config.json     # your platform + MCP + (after firstrun) template keys
```

## Configuration

`uspecs.config.json` is written by `init` and updated by the `firstrun` skill. The CLI sets:

```json
{
  "mcpProvider": "figma-mcp",
  "environment": "cursor",
  "cliVersion": "0.3.3"
}
```

The `firstrun` skill adds `fontFamily` and `templateKeys` to that file once you point it at your Figma template library.

## Requirements

- Node.js 18 or newer
- An AI agent host (Cursor, Claude Code, or Codex)
- A Figma MCP (either [Figma Console MCP](https://github.com/southleft/figma-console-mcp) or the [native Figma MCP](https://github.com/figma/figma-mcp))

## Required: uSpec Extract Figma plugin

uSpec runs one pipeline. The **uSpec Extract** Figma plugin captures a component to a `_base.json` file, and `create-component-md` turns that into sibling canonical contract (`.json`) and implementation guide (`.md`) artifacts. The render skills (`create-anatomy`, `create-api`, `create-color`, `create-structure`, `create-property`, `create-voice`) take the `.md` as their **required** input and draw a section into Figma. (`create-motion` is the one exception — it renders from an After Effects export and does not use the `.md`.) An exhaustive `.audit.md` can be rendered explicitly for diagnostics, but is not produced by default.

The plugin is *not* installed by `npx uspec-skills` because Figma plugins live in Figma Desktop, not in your project's `node_modules`. Install it from the Figma Community:

1. Open [uSpec Extract](https://www.figma.com/community/plugin/1635184425006534227/uspec-extract) on the Figma Community
2. Click **Open in…** to add it to your Figma
3. Select a `COMPONENT` or `COMPONENT_SET` and run **Plugins → uSpec Extract**
4. Paste the selected component's Figma link when prompted; the public Community plugin remembers
   it for later runs in the same document

The plugin is open source — the source lives in `figma-plugin/` in the [uSpec repo](https://github.com/redongreen/uSpec) if you want to build a modified version locally. See the [component-md walkthrough](https://uspec.design/specs/component-md) for the full workflow.

## Links

- Documentation: [uspec.design](https://uspec.design/)
- Source: [github.com/redongreen/uSpec](https://github.com/redongreen/uSpec)
- Issues: [github.com/redongreen/uSpec/issues](https://github.com/redongreen/uSpec/issues)

## License

MIT
