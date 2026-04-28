# Maintaining uSpec

> **Audience.** This is the operator's manual for the person who maintains this repo. It explains how the code on disk turns into the `uspec-skills` npm package that strangers install with `npx uspec-skills init`, and exactly what to do when you want to change something.
>
> Written for someone seeing CLI publishing for the first time. If you've shipped npm packages before, the [Quick reference](#quick-reference) at the bottom is probably enough.
>
> **Architecture deep-dive.** This file is the release manual. For the system architecture — how skills, MCP, the Figma plugin, and the CLI fit together at a code level — see [`implementation.md`](implementation.md). The two files are deliberately separate: this one tells you *how to ship*, that one tells you *how the system works*.

## Mental model in one diagram

```
┌────────────────────────────────────────────────────────────────────┐
│  THIS REPO (source of truth)                                       │
│                                                                    │
│  skills/<name>/SKILL.md          ──┐                               │
│  references/<area>/*.md          ──┤                               │
│                                    │                               │
│                                    ▼                               │
│                       packages/cli/scripts/build.mjs               │
│                                    │                               │
│                                    ▼                               │
│                       packages/cli/templates/                      │
│                       packages/cli/dist/index.js                   │
│                                    │                               │
└────────────────────────────────────┼───────────────────────────────┘
                                     │
                                     │  npm publish --access public
                                     ▼
                  ┌──────────────────────────────────┐
                  │  registry.npmjs.org              │
                  │  uspec-skills@0.2.x              │
                  └──────────────────────────────────┘
                                     │
                                     │  npx uspec-skills@latest init
                                     ▼
┌────────────────────────────────────────────────────────────────────┐
│  USER PROJECT (e.g. /tmp/my-design-system)                         │
│                                                                    │
│  .cursor/skills/  (or .claude/skills/, .agents/skills/)            │
│  references/                                                       │
│  uspecs.config.json                                                │
└────────────────────────────────────────────────────────────────────┘
```

The headline rule: **`skills/` and `references/` at the repo root are the source of truth. Everything else is derived.**

## Folder map

```
uSpec/
├── skills/                       SOURCE OF TRUTH for skills (platform-neutral)
│   └── <name>/SKILL.md           uses {{skill:name}} and {{ref:area/file.md}} tokens
├── references/                   SOURCE OF TRUTH for shared docs
│   └── <area>/*.md               agent instructions, reference material
│
├── packages/cli/                 the published CLI lives here
│   ├── package.json              "name": "uspec-skills", "version": "0.2.x"
│   ├── .npmrc                    pins this folder's npm registry to public npm
│   ├── src/                      TypeScript source for the CLI
│   ├── scripts/
│   │   ├── build.mjs             bundles src/ → dist/, copies skills+refs → templates/
│   │   └── check-registry.mjs    safety guard, runs before every publish
│   ├── dist/                     BUILT ARTIFACT (not committed in production sense — see below)
│   └── templates/                BUILT ARTIFACT (copy of /skills + /references)
│
├── .cursor/skills/               GENERATED — what `npx uspec-skills install --platform cursor` writes
├── .claude/skills/               (same, for claude-code)                 ← gitignored in user projects
├── .agents/skills/               (same, for codex)                       ← gitignored in user projects
│
├── figma-plugin/                 the Figma Desktop plugin (separate from npm package)
├── docs/                         Mintlify docs site (uspec.design)
├── README.md                     GitHub-facing README
├── implementation.md             system architecture reference for AI agents
└── maintaining.md                this file
```

The `dist/` and `templates/` folders inside `packages/cli/` are **build outputs**. They're regenerated by `npm run build` and they ship inside the npm tarball, but you do not edit them by hand.

## How the install actually works

When a user runs `npx uspec-skills@latest init` in some random folder, here's the chain:

1. **`npx`** queries `registry.npmjs.org` for the package called `uspec-skills`, gets the version tagged `latest` (currently `0.2.0`), and downloads the tarball.
2. The tarball contains `dist/index.js` (the bundled CLI) and `templates/` (the skills + references that ship with this version).
3. `npx` runs the `bin` defined in `package.json` (`uspec-skills` → `./dist/index.js`).
4. The CLI walks up from the user's current directory looking for a project marker (`.git/`, `package.json`, or `uspecs.config.json`). If none is found, it bootstraps into the current directory (this is the fix that shipped in `0.1.1`).
5. The CLI's render engine reads each `SKILL.md` from `templates/skills/`, rewrites the `{{skill:...}}` and `{{ref:...}}` tokens to host-correct values, and writes the result into `.cursor/skills/<name>/SKILL.md` (or `.claude/skills/`, `.agents/skills/` depending on the platform choice).
6. It copies `templates/references/` verbatim into `./references/` in the user's project.
7. It writes `uspecs.config.json` with their environment + MCP choice + the CLI version that did the install.

The user is then "installed". They never need this repo or `git` to use uSpec.

## What changes in this repo, and how each kind of change ships

### Editing a skill or reference file

This is the most common change. You edited `skills/create-color/SKILL.md`, or `references/structure/agent-structure-instruction.md`.

```
┌─────────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ edit skills/ or │ ─▶ │ bump version │ ─▶ │ npm publish  │ ─▶ │ users get it │
│ references/     │    │ in package.  │    │              │    │ via update   │
│                 │    │ json         │    │              │    │              │
└─────────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
```

Step by step:

```bash
# 1. Make your edits to skills/<name>/SKILL.md or references/<area>/*.md.
#    Use {{skill:other-skill}} and {{ref:area/file.md}} for cross-references —
#    bare relative paths break on Claude Code and Codex.

# 2. Bump the patch version in packages/cli/package.json
#    (e.g. 0.2.0 → 0.2.1). The "version" field is the only required edit.

# 3. From inside packages/cli, rebuild — this re-copies skills/ and
#    references/ into templates/ and re-bundles dist/index.js
cd packages/cli
npm run build

# 4. Locally smoke test (optional but recommended) — see
#    "Smoke testing before publish" section below.

# 5. Publish (will prompt for your npm 2FA code)
npm publish --access public --otp=YOUR_6_DIGIT_CODE

# 6. Verify it landed
npm view uspec-skills version   # should print your new version
```

That's it — the package is now live on npm. The next time anyone runs `npx uspec-skills update` (or `init` in a new project), they'll get your changes.

### Editing the CLI itself (commands, render engine, error messages)

You changed something under `packages/cli/src/`. Same flow as above — bump the version, rebuild, publish. The build script bundles `src/index.ts` into `dist/index.js` via esbuild.

### Adding a new skill

1. Create `skills/<new-skill-name>/SKILL.md` following the structure of an existing one. Use tokens for cross-references.
2. If it needs new shared docs, create `references/<area>/*.md` and link to them from the SKILL.md via `{{ref:area/file.md}}`.
3. If the skill is a new spec type with its own template, also update `firstrun` (`skills/firstrun/SKILL.md`) so it knows to extract the new template's component key during onboarding.
4. Update the skills tables in `implementation.md`, `CLAUDE.md`, and `AGENTS.md`.
5. Bump version, rebuild, publish.

### Editing the Figma plugin (`figma-plugin/`)

The Figma plugin **does not ship in the npm package**. It's a separate artifact installed manually into Figma Desktop. Users get it by cloning the repo and running `npm install && npm run build` inside `figma-plugin/`.

If you change the plugin:

1. Edit files under `figma-plugin/src/`.
2. Test locally (see `figma-plugin/README.md`).
3. Commit and push to GitHub. **No npm publish involved.**

The npm package is only the AI skills + the install CLI. The plugin and the npm package can drift in version — they're loosely coupled via the `_base.json` schema. If you change the schema, bump both: edit the plugin, then update the validator and any consumer skills (mainly `extract-*` and `create-component-md`), and publish a new npm version.

### Editing docs (`docs/`)

The Mintlify docs at [uspec.design](https://uspec.design) auto-deploy from `main`:

1. Edit `.mdx` files under `docs/`.
2. Push to `main`.
3. Mintlify deploys within 1–2 minutes. No publish step.

If you add or remove a page, update `docs/docs.json` so it appears in the navigation.

## Versioning rules of thumb

You're on `0.2.x`. The `0.x.y` range is npm's convention for "early, expect breakage." Use it deliberately:

| What you changed | Bump | Example |
|---|---|---|
| Fixed a bug, edited a skill, improved an error message | patch | `0.2.0` → `0.2.1` |
| Added a new skill, added a new CLI command, added a new field to `uspecs.config.json` | patch (still 0.x — anything goes) | `0.2.1` → `0.2.2` |
| Renamed a CLI flag, changed config schema, removed a skill | minor | `0.2.x` → `0.3.0` |
| You're confident the CLI surface is stable and you'll commit to not breaking it | major | `0.x.y` → `1.0.0` |

Bumps in `0.2.x` are cheap. Don't agonize. Once you ship `1.0.0`, every breaking change costs a major bump.

**Versioning the product vs. the CLI.** "uSpec" the product is at V2.0 (per the changelog and docs). `uspec-skills` the npm package is at `0.2.0` and versions on its own track. They are not the same number — and shouldn't be. Compare React (v18, the framework) vs. `create-react-app` (v5, the CLI). The product version goes in the changelog and docs; the npm version goes in `package.json`.

## Publishing in detail

You'll do this every time you ship. This is the canonical sequence.

### Prerequisites (one-time)

- An npm account with publish rights to `uspec-skills`. You're `iguisard`.
- 2FA enabled on your npm account (npm requires it for new publishers by default). The OTP is a 6-digit code from your authenticator app.
- Logged in: `npm whoami --registry=https://registry.npmjs.org/` should print `iguisard`. If it doesn't, run `npm login --registry=https://registry.npmjs.org/`.

### The publish sequence

Always run from inside `packages/cli/` so the local `.npmrc` (which pins this folder's registry to public npm) is honored.

```bash
cd packages/cli

# 1. Bump version. Edit package.json's "version" field by hand,
#    or use `npm version patch` to bump and tag in one step.

# 2. Rebuild
npm run build

# 3. Sanity-check what would be published, no upload yet
npm publish --dry-run
#    Verify the output ends with: + uspec-skills@<your-new-version>
#    and that it lists Publishing to https://registry.npmjs.org/

# 4. Real publish (will prompt for your OTP)
npm publish --access public --otp=YOUR_6_DIGIT_CODE

# 5. Verify it landed
npm view uspec-skills version
#    Should print your new version. Sometimes there's a few-second lag.
```

You'll see warnings like:

```
npm warn publish "bin[uspec-skills]" script name was cleaned
npm warn publish "repository.url" was normalized to "git+https://..."
```

These are auto-corrections npm makes silently. They are harmless and don't affect the published package.

### Layered registry safety

Before any `npm publish` runs, three layers of protection check that you're publishing to public npm.

1. **`packages/cli/package.json` → `publishConfig.registry`** pins `https://registry.npmjs.org/` for this package.
2. **`packages/cli/.npmrc`** sets `registry=https://registry.npmjs.org/` for this directory, overriding any user-level or environment registry config.
3. **`packages/cli/scripts/check-registry.mjs`** runs as `prepublishOnly` and aborts with a clear error if the effective registry is not public npm.

If any of these is broken or missing, the publish stops. This is paranoid by design — it's much easier to recover from a failed publish than from accidentally pushing source code to a private registry.

If you ever see `ABORTED: npm publish would target the wrong registry`, do not bypass it. Fix the registry config and try again.

## Smoke testing before publish

Highly recommended for any change that touches the CLI commands themselves, or any non-trivial edit. Lets you run the package in a fresh empty directory exactly as a user would, but without uploading anything.

```bash
cd packages/cli

# 1. Build and pack into a local tarball
npm run build
npm pack
# Produces uspec-skills-<version>.tgz in the current dir.

# 2. Set up a sandbox to install into
mkdir /tmp/uspec-tooldir
cd /tmp/uspec-tooldir
npm init -y >/dev/null
npm install /Users/ian.guisard/uSpec/packages/cli/uspec-skills-<version>.tgz

# 3. Try the CLI in another fresh, empty dir
mkdir /tmp/uspec-fresh
cd /tmp/uspec-fresh
/tmp/uspec-tooldir/node_modules/.bin/uspec-skills init --platform cursor --mcp figma-console --yes
/tmp/uspec-tooldir/node_modules/.bin/uspec-skills doctor

# 4. Inspect the output: .cursor/skills/, references/, uspecs.config.json
ls -la
cat uspecs.config.json

# 5. Cleanup
cd /Users/ian.guisard/uSpec/packages/cli
rm uspec-skills-<version>.tgz
rm -rf /tmp/uspec-tooldir /tmp/uspec-fresh
```

If `init` and `doctor` succeed in the sandbox, you're safe to publish.

## When something goes wrong

### "I published a broken version"

You can't unpublish a version older than 72 hours from npm without contacting support. Don't try. Instead, ship a patch.

1. Edit the bug.
2. Bump the patch version (`0.2.0 → 0.2.1`).
3. Rebuild and publish.
4. Tell users in the changelog. The bad version is forever in the version list, but `latest` now points at the fix, so anyone running `npx uspec-skills@latest` gets the good one.

If the bug is severe (e.g. data loss, accidental destructive action), you can also `npm deprecate uspec-skills@<bad-version> "use 0.2.1+ instead"` which adds a warning when anyone tries to install that version specifically.

### "`npx` keeps using the old version"

`npx` caches packages in `~/.npm/_npx/`. After publishing a new version, users (and you, when verifying) may keep hitting the old cached binary even with `@latest`.

Fix: pin the exact version (`npx uspec-skills@0.2.1 init` instead of `@latest`). That forces a fresh download because the cache key changes.

For a stuck local cache:

```bash
rm -rf ~/.npm/_npx
```

### "publish failed with EOTP"

```
npm error code EOTP
npm error This operation requires a one-time password from your authenticator.
```

Your 2FA code expired (they rotate every 30 seconds) or you didn't pass `--otp=...`. Re-run with a fresh code:

```bash
npm publish --access public --otp=123456
```

### "publish failed with E403 / Forbidden"

Either:
- You're not logged in. Run `npm whoami --registry=https://registry.npmjs.org/`.
- Someone else owns the package name (shouldn't happen for `uspec-skills` since you own it).
- The version already exists on npm. You can't republish the same version. Bump and try again.

### "publish failed with ABORTED: wrong registry"

The safety guard caught you. See [Layered registry safety](#layered-registry-safety). Don't bypass — fix the registry config:

```bash
cd packages/cli
npm config get registry          # what your shell currently uses
cat .npmrc                       # what this folder pins it to
```

If `npm config get registry` doesn't print `https://registry.npmjs.org/`, run:

```bash
npm publish --access public --registry=https://registry.npmjs.org/ --otp=YOUR_OTP
```

The `--registry` flag overrides everything else for that one command.

## Quick reference

For when you've done this enough times to skip the explanations:

```bash
# Standard ship
cd packages/cli
# bump "version" in package.json
npm run build
npm publish --dry-run            # sanity check
npm publish --access public --otp=YOUR_OTP
npm view uspec-skills version    # verify
```

```bash
# Verify a fresh install works (use the version you just published)
rm -rf /tmp/uspec-real && mkdir /tmp/uspec-real && cd /tmp/uspec-real
npx --yes uspec-skills@<just-published-version> init --platform cursor --mcp figma-console --yes
npx --yes uspec-skills@<just-published-version> doctor
```

| Want to... | Do this |
|---|---|
| Edit a skill | Edit `skills/<name>/SKILL.md`, bump version, build, publish |
| Edit a reference doc | Edit `references/<area>/*.md`, bump version, build, publish |
| Add a new skill | New folder under `skills/`, update `implementation.md`/`CLAUDE.md`/`AGENTS.md`, bump, build, publish |
| Edit CLI behavior | Edit `packages/cli/src/`, bump, build, publish |
| Edit docs site | Edit `docs/*.mdx`, push to `main`. No publish. |
| Edit Figma plugin | Edit `figma-plugin/src/`, push to `main`. No publish. |
| Roll back a bad publish | Ship a patch. Don't unpublish. |
| Get out of npx cache jail | Pin the exact version: `npx uspec-skills@<exact> ...` |

## Useful pointers

- npm package page: [npmjs.com/package/uspec-skills](https://www.npmjs.com/package/uspec-skills)
- Package settings (deprecate, transfer ownership): [npmjs.com/package/uspec-skills/access](https://www.npmjs.com/package/uspec-skills/access)
- Architecture deep-dive for AI agents: [`implementation.md`](implementation.md), specifically the [Skill Source and CLI](implementation.md#skill-source-and-cli-packagescli) section
- Token / cross-reference convention (`{{skill:}}`, `{{ref:}}`): [`packages/cli/src/render.ts`](packages/cli/src/render.ts)
- Build script: [`packages/cli/scripts/build.mjs`](packages/cli/scripts/build.mjs)
- Registry safety guard: [`packages/cli/scripts/check-registry.mjs`](packages/cli/scripts/check-registry.mjs)
- User-facing changelog: [`docs/help/changelog.mdx`](docs/help/changelog.mdx)
