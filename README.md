# uSpec

Generate design system documentation for your UI components, directly from your AI agent.

You describe a component, an agent skill analyzes it using your Figma file as context, and the output is rendered into Figma or written to a portable `.md` file. Supports both [Figma Console MCP](https://github.com/southleft/figma-console-mcp) and [native Figma MCP](https://github.com/figma/figma-mcp).

Works with **Cursor**, **Claude Code**, and **Codex**.

> **New in v2.0** — `create-component-md`: generate one markdown file per component (API, structure, color, screen-reader). An artifact LLM tools can build from and humans can query. Requires the [uSpec Extract Figma plugin](figma-plugin/) (built locally from this repo); the other skills work directly through your Figma MCP and need no plugin.

## What you can generate

| Spec type | What you get |
|-----------|--------------|
| Component Markdown | One `.md` per component covering API, structure, color, and screen-reader behavior |
| API Spec | Properties, values, defaults, and configuration examples |
| Color Annotation | Design token mapping for every element and state |
| Structure Spec | Dimensions, spacing, and padding across density and size variants |
| Screen Reader Spec | VoiceOver, TalkBack, and ARIA accessibility specs |
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
