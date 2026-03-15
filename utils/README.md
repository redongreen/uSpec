# Utils

## sync-skills.sh

Syncs skill files from `.cursor/skills/` (source of truth) to `.claude/skills/` and/or `.agents/skills/`.

### What it does

1. Copies every `SKILL.md` from `.cursor/skills/<name>/` to the target directories
2. Adjusts relative paths (`../../` → `../../../`) for the different directory depth
3. Replaces Cursor-specific `@skill-name` references with generic phrasing (e.g., `the \`firstrun\` skill`)

### When to run it

Run after editing any `SKILL.md` in `.cursor/skills/`:

```bash
./utils/sync-skills.sh                        # sync all skills to both targets
./utils/sync-skills.sh create-voice            # sync one skill to both targets
./utils/sync-skills.sh --target claude         # sync all skills to .claude/skills/ only
./utils/sync-skills.sh --target codex          # sync all skills to .agents/skills/ only
./utils/sync-skills.sh --target claude create-voice  # sync one skill to .claude/ only
```

The `--target` flag is used by the `firstrun` skill to deploy skills to the user's chosen platform. Without a flag, skills sync to both targets (developer workflow).

Never edit files in `.claude/skills/` or `.agents/skills/` directly — they get overwritten by the sync.
