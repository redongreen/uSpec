# Utils

## Rendering skills locally for development

The canonical source of truth for skills is `skills/` (platform-neutral SKILL.md files using `{{skill:}}`, `{{ref:}}`, and `{{repo:}}` tokens) plus `references/` for shared instruction docs.

To render skills into your own working tree for testing, run the CLI's internal render command from the repo root:

```bash
cd packages/cli
npm install
npm run build

# render for one platform into the repo root (rendered output is gitignored)
node dist/index.js render --target cursor --out ../..
node dist/index.js render --target claude-code --out ../..
node dist/index.js render --target codex --out ../..
```

After rendering, `.cursor/skills/`, `.claude/skills/`, or `.agents/skills/` will contain the resolved per-platform output. These directories are listed in `.gitignore` — they are build artifacts, never committed.

## End-user install

End users do not run any of the above. They run:

```bash
npx uspec-skills init
```

which detects their agent platform, installs all skills + references into their project, and writes `uspecs.config.json`. See [packages/cli/README.md](../packages/cli/README.md) for the CLI's full command reference.
