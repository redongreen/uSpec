# uSpec Plugin for Claude Code

This plugin provides AI agent skills for automating design system documentation in Figma.

## Installation

Install via Claude Code CLI:

```bash
claude install /path/to/uSpec/plugin
```

Or manually copy the `plugin` directory to your Claude Code plugins folder:
- **macOS/Linux**: `~/.claude/plugins/uspec`
- **Windows**: `%USERPROFILE%\.claude\plugins\uspec`

## Prerequisites

This plugin requires the **Figma Console MCP** to be installed and configured. The MCP server provides the connection between Claude Code and your Figma files.

Install Figma Console MCP: [https://figma-console-mcp.southleft.com](https://figma-console-mcp.southleft.com)

## Available Skills

### Anatomy
Generate component anatomy annotations with numbered markers and attribute tables for every element.

**Usage**: Ask Claude to create an anatomy spec from a Figma component link.

### API
Generate API specifications with properties, values, defaults, and configuration examples.

**Usage**: Ask Claude to document the API for a Figma component.

### Changelog
Generate or update component changelogs documenting changes and updates.

**Usage**: Tell Claude what changed, and it will format it as a structured changelog entry in Figma.

### Color
Generate color annotations with design token mapping for every element and state.

**Usage**: Ask Claude to create a color spec from a Figma component link.

### Motion
Generate motion specifications with animation timeline bars and easing details from After Effects data.

**Usage**: Provide After Effects timeline data (exported via `export-timeline.jsx`), and Claude will create a motion spec.

### Screen Reader
Generate screen reader specifications for VoiceOver, TalkBack, and ARIA accessibility.

**Usage**: Ask Claude to create accessibility specs for a Figma component.

### Structure
Generate structure specifications with dimensions, spacing, and padding across density and size variants.

**Usage**: Ask Claude to document the structure and spacing for a Figma component.

## Example Usage

1. Open Claude Code in your project
2. Provide a Figma component link
3. Ask Claude to generate a specific spec type:

```
Can you create an API spec for this button component?
https://figma.com/design/abc123/DesignSystem?node-id=123-456
```

Claude will:
1. Connect to Figma via MCP
2. Analyze the component structure
3. Extract properties, tokens, and values
4. Generate a formatted specification
5. Render it directly in your Figma file

## Documentation

Full documentation available at [uSpec.design](https://uspec.design/)

## License

MIT License - see [LICENSE](../LICENSE) for details
