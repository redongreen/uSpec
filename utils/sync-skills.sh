#!/usr/bin/env bash
#
# Sync skills from .cursor/skills/ (source of truth) to .claude/skills/ and/or .agents/skills/.
#
# What it does:
#   1. Copies every SKILL.md from .cursor/skills/<name>/ to the target directories
#   2. Adjusts relative paths (../../ → ../../../) for the extra directory depth
#   3. Replaces Cursor-specific `@skill-name` invocation references with generic phrasing
#
# Usage:
#   ./utils/sync-skills.sh                       # sync all skills to both targets
#   ./utils/sync-skills.sh create-voice           # sync one skill to both targets
#   ./utils/sync-skills.sh --target claude        # sync all skills to .claude/skills/ only
#   ./utils/sync-skills.sh --target codex         # sync all skills to .agents/skills/ only
#   ./utils/sync-skills.sh --target claude create-voice  # sync one skill to .claude/ only

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CURSOR_DIR="$REPO_ROOT/.cursor/skills"
CLAUDE_DIR="$REPO_ROOT/.claude/skills"
AGENTS_DIR="$REPO_ROOT/.agents/skills"

TARGET=""
SKILL_NAMES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      TARGET="$2"
      shift 2
      ;;
    *)
      SKILL_NAMES+=("$1")
      shift
      ;;
  esac
done

case "$TARGET" in
  claude)  TARGET_DIRS=("$CLAUDE_DIR") ;;
  codex)   TARGET_DIRS=("$AGENTS_DIR") ;;
  "")      TARGET_DIRS=("$CLAUDE_DIR" "$AGENTS_DIR") ;;
  *)
    echo "Error: unknown target '$TARGET'. Use 'claude' or 'codex'." >&2
    exit 1
    ;;
esac

sync_skill() {
  local name="$1"
  local src="$CURSOR_DIR/$name/SKILL.md"

  if [[ ! -f "$src" ]]; then
    echo "  SKIP  $name (no SKILL.md found)"
    return
  fi

  for target_dir in "${TARGET_DIRS[@]}"; do
    mkdir -p "$target_dir/$name"
    local dest="$target_dir/$name/SKILL.md"

    sed \
      -e 's|(../../|(../../../|g' \
      -e 's|`@\([a-z-]*\)`|the `\1` skill|g' \
      -e 's|Run `@\([a-z-]*\)` |Run the `\1` skill |g' \
      -e 's|via `@\([a-z-]*\)`|via the `\1` skill|g' \
      "$src" > "$dest"

    echo "  SYNC  $name → $(basename "$(dirname "$target_dir")")/$(basename "$target_dir")/$name"
  done
}

if [[ ${#SKILL_NAMES[@]} -gt 0 ]]; then
  for name in "${SKILL_NAMES[@]}"; do
    sync_skill "$name"
  done
else
  echo "Syncing all skills from .cursor/skills/ ..."
  for skill_dir in "$CURSOR_DIR"/*/; do
    name="$(basename "$skill_dir")"
    sync_skill "$name"
  done
fi

echo ""
echo "Done. Remember to update CLAUDE.md, AGENTS.md, and implementation.md if you added a new skill."
