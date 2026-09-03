# uSpec

Generate design system documentation for your UI components, directly from your AI agent.

Describe a component to your agent. uSpec captures it with the [uSpec Extract](https://www.figma.com/community/plugin/1635184425006534227/uspec-extract) Figma plugin, compiles a canonical component contract (`.json`) plus a portable implementation guide (`.md`), then renders sections of that specification back into Figma as annotation frames. Works with [Figma Console MCP](https://github.com/southleft/figma-console-mcp) or the [native Figma MCP](https://github.com/figma/figma-mcp), inside **Cursor**, **Claude Code**, or **Codex**.

> **The component contract is the machine source of truth.** `create-component-md` produces sibling `.json` and `.md` files covering API, structure, color, and screen-reader behavior. Automation consumes the schema-valid JSON; humans and LLM workflows use the concise Markdown. Both come from a `_base.json` capture produced by the [uSpec Extract Figma plugin](https://www.figma.com/community/plugin/1635184425006534227/uspec-extract) (free on the Figma Community; source is open in [`figma-plugin/`](figma-plugin/)). The public plugin asks for the selected component's Figma link on first use and remembers it for that document. Every `create-*` render skill then takes the `.md` as its required input and renders a section into Figma via your MCP.

## What you can generate

| Spec type | What you get |
|-----------|--------------|
| Component contract + Markdown | Canonical `.json` plus a concise `.md` covering API, structure, color, and screen-reader behavior |
| API Spec | Properties, values, defaults, and configuration examples |
| Color Annotation | Design token mapping for every element and state |
| Structure Spec | Dimensions, spacing, and padding across density and size variants |
| Screen Reader Spec | VoiceOver, TalkBack, and ARIA behavior for every element and state |
| Motion Spec | Animation timeline bars and easing details from After Effects data |
| Component Anatomy | Numbered markers and attribute tables for every element |
| Component Properties | Variant axes, boolean toggles, and variable mode exhibits |

## Get started

In your project, run:

```bash
npx uspec-skills init
```

The CLI detects whether you are using Cursor, Claude Code, or Codex, installs all skills and references into the right directory, and writes `uspecs.config.json`. Then ask your agent to run the `firstrun` skill to extract your Figma template keys.

Full documentation and examples at **[uSpec.design](https://uspec.design/)**.

## License

MIT — see [LICENSE](LICENSE) for details.

Designed by [Ian Guisard](https://www.linkedin.com/in/iguisard/).
