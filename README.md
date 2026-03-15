# uSpec

Automate design system documentation — from Figma to finished specs, powered by AI agent skills.

uSpec connects AI assistants (Cursor, Claude Code) to your Figma files through the Figma Console MCP. Agent skills extract component structure, design tokens, variables, and styles directly from your file and render structured documentation right in Figma. No manual spec writing required.

## What you can generate

| Spec type | What you get |
|-----------|--------------|
| API Spec | Properties, values, defaults, and configuration examples |
| Color Annotation | Design token mapping for every element and state |
| Structure Spec | Dimensions, spacing, and padding across density and size variants |
| Screen Reader Spec | VoiceOver, TalkBack, and ARIA accessibility specs |
| Motion Spec | Animation timeline bars and easing details from After Effects data |
| Component Anatomy | Numbered markers and attribute tables for every element |
| Component Properties | Variant axes, boolean toggles, and variable mode exhibits |

## Get started

Full documentation, installation guide, and examples at **[uSpec.design](https://uspec.design/)**.

## Using with Claude Code

uSpec is available as a Claude Code plugin. Install it to use these skills with the Claude Code CLI:

```bash
# Install from this repository
claude install /path/to/uSpec/plugin

# Or install from a published package
claude install uspec
```

See [plugin/README.md](plugin/README.md) for detailed plugin installation and usage instructions.

## Project Structure

```
uSpec/
├── plugin/              # Claude Code plugin (installable)
│   ├── .claude-plugin/  # Plugin manifest
│   └── skills/          # Agent skills
├── anatomy/             # Anatomy spec source files
├── api/                 # API spec source files
├── changelog/           # Changelog spec source files
├── color/               # Color spec source files
├── motion/              # Motion spec source files
├── screen-reader/       # Screen reader spec source files
├── structure/           # Structure spec source files
└── docs/                # Documentation site
```

## License

MIT — see [LICENSE](LICENSE) for details.

Designed by [Ian Guisard](https://www.linkedin.com/in/iguisard/).
