# uSpec — Claude Code project instructions

uSpec generates design system documentation specs directly in Figma. This file tells Claude Code how to work with the project.

## Architecture

```
AI Agent (Claude Code) ──> Figma Console MCP ──> Figma Desktop
```

Skills extract component data via Figma Console MCP tools and render documentation frames directly in Figma using `figma_execute`.

## Skills

Only the `firstrun` skill is available in `.claude/skills/` by default. Run `firstrun` to select your environment and configure your template library — it will deploy all other skills automatically.

After running `firstrun`, the following skills become available:

| Skill | Purpose |
|-------|---------|
| `firstrun` | First-time environment setup and template library configuration |
| `create-anatomy` | Numbered markers and attribute table |
| `create-property` | Variant axes and boolean toggle exhibits |
| `create-voice` | Screen reader specs for VoiceOver, TalkBack, and ARIA |
| `create-color` | Color token annotations |
| `create-api` | API property tables and configuration examples |
| `create-structure` | Dimensional specs for spacing, padding, and sizing |
| `create-changelog` | Create a new changelog with first entry |
| `update-changelog` | Add entries to an existing changelog |
| `convert-changelog` | Convert an existing Figma changelog to JSON |
| `create-motion` | Animation timeline and easing spec from After Effects data |

## MCP dependency

All skills require the **Figma Console MCP** to be running. Configure it in your project `.mcp.json` (already included in the repo root). See `implementation.md` for tool details.

## Key files

| File | Purpose |
|------|---------|
| `uspecs.config.json` | Template keys, font family, and environment — populated by `firstrun` |
| `implementation.md` | Full architecture reference for agents |
| `screen-reader/agent-screenreader-instruction.md` | Screen reader data schema and agent behavior |
| `screen-reader/voiceover.md` | iOS VoiceOver property reference |
| `screen-reader/talkback.md` | Android TalkBack property reference |
| `screen-reader/aria.md` | Web ARIA roles and states reference |

## Running a skill

First, run the `firstrun` skill to set up your environment and template library. After that, mention any skill name or its trigger keywords in your prompt. For example:

```
Create a screen reader spec for this button: https://www.figma.com/design/abc123/Components?node-id=100:200
```

Claude Code will match the skill from `.claude/skills/` and execute the workflow.

## Constraints

- Use a high-context model (Claude 4.6 Opus or higher). Skills are token-intensive.
- Start a fresh conversation for each skill run to avoid context exhaustion.
- Run one agent per Figma file at a time — multiple agents sharing a file corrupt each other's output.
