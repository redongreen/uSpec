# uSpec — Codex agent instructions

uSpec generates design system documentation specs directly in Figma. This file tells Codex how to work with the project.

## Architecture

```
AI Agent (Codex) ──> Figma Console MCP ──> Figma Desktop
```

Skills extract component data via Figma Console MCP tools and render documentation frames directly in Figma using `figma_execute`.

## Skills

Only the `firstrun` skill is available in `.agents/skills/` by default. Run `firstrun` to select your environment and configure your template library — it will deploy all other skills automatically.

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

All skills require the **Figma Console MCP**. Configure it in `.codex/config.toml` (included in the repo). See `implementation.md` for the full tool surface.

## Key files

| File | Purpose |
|------|---------|
| `uspecs.config.json` | Template keys, font family, and environment — populated by `firstrun` |
| `implementation.md` | Full architecture reference for agents |
| `screen-reader/agent-screenreader-instruction.md` | Screen reader data schema and agent behavior |

## Running a skill

First, run the `firstrun` skill to set up your environment and template library. After that, type `$` to mention a skill explicitly, or describe what you need and Codex matches skills by description. For example:

```
$create-voice https://www.figma.com/design/abc123/Components?node-id=100:200
```

Use `/skills` to browse available skills.

## Constraints

- Use **GPT 5.4** or higher. Skills are token-intensive and require high context capacity.
- Start a fresh conversation for each skill run.
- Run one agent per Figma file at a time.
