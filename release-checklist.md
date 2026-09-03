# uSpec V2.7 Release Checklist

Use this checklist to release the work currently on
`experiment/component-md-deterministic-render`. The detailed operating procedures live in
[`maintaining.md`](maintaining.md); architecture and package boundaries live in
[`implementation.md`](implementation.md).

## Release targets

- Product and GitHub release: **uSpec V2.7**, tag `v2.7.0`
- Public Figma Community plugin: **uSpec Extract 2.7.0**
- npm package: **`uspec-skills` 0.3.3** (proposed patch bump from 0.3.2)
- `_base.json` schema: **version 1**, provided the final compatibility review confirms that
  every change is additive
- Public plugin identity: `1635184425006534227`
- Public plugin behavior: requires a pasted Figma component link; the link is remembered per
  document after first use

The public Community plugin in this repository is the link-required build. Do not substitute an
internal no-link build when publishing from Figma Desktop.

## Already verified on this branch

- [x] Public versus internal plugin behavior identified and documented
- [x] Plugin version set to 2.7.0 in `package.json`, `package-lock.json`, extraction metadata,
      and the UI footer
- [x] Plugin typecheck, tests, and production build pass
- [x] A fresh 2.7.0 extraction reports `_meta.pluginVersion: "2.7.0"` with no warnings
- [x] Cross-variant child composition records `chevron_right_small` in both `forward` and
      `count-forward`
- [x] Revealed trees contain children for all four micro-button variants

Re-run every automated check below against the final release commit. The checks above are evidence
from development, not a substitute for release-candidate validation.

## 1. Freeze and review the release candidate

- [x] Stop feature work and define the final V2.7 scope
- [x] Review every modified and untracked file on the branch
- [x] Confirm generated files, local extraction fixtures, credentials, and machine-specific
      configuration are not accidentally included
- [x] Confirm the branch contains only source and documentation intended for the public repository
- [x] Consolidate the work into reviewable commits
- [ ] Open a pull request into `main`
- [ ] Resolve review comments and required CI checks
- [ ] Confirm the final release commit is reproducible from a clean checkout

## 2. Finalize versions and release documentation

- [x] Bump `packages/cli/package.json` from 0.3.2 to 0.3.3
- [x] Bump the root entries in `packages/cli/package-lock.json` to 0.3.3
- [x] Set the plugin package and extraction version to 2.7.0
- [x] Confirm the root private package remains `0.0.0` and is not published
- [x] Confirm `_meta.schemaVersion` can remain `"1"`; bump it only if the final contract is
      backward-incompatible
- [x] Confirm npm version 0.3.3, Git tag `v2.7.0`, and GitHub Release `v2.7.0` do not already exist
- [x] Add a V2.7 entry to `docs/help/changelog.mdx`
- [x] Describe both release channels in the changelog:
  - `uspec-skills` 0.3.3 on public npm
  - uSpec Extract 2.7.0 on the Figma Community
- [x] Document the deterministic contract/render pipeline and its new CLI commands
- [x] Document cross-variant extraction, revealed-tree, target-identity, stroke-semantics, and
      accessibility-rendering fixes
- [x] Update active version pins such as `npx uspec-skills@0.3.2` to `@0.3.3`; do not rewrite
      historical changelog entries
- [x] Update active V2.6 release examples in `maintaining.md` to V2.7 after the target versions
      are final
- [x] Prepare `/tmp/v2.7-release-notes.md` from the final V2.7 changelog entry

## 3. Validate the npm package

Run from `packages/cli/`:

```bash
npm ci
npm run typecheck
npm test
npm publish --dry-run
```

- [x] TypeScript typecheck passes
- [x] All prepare, cache-validation, contract, and render tests pass
- [x] CLI argument paths for `component-md validate` and `component-md contract` are exercised
      directly by regression tests
- [x] The build regenerates `dist/index.js` and `templates/`
- [x] `npm audit` reports zero vulnerabilities
- [x] `npm publish --dry-run` ends with `uspec-skills@0.3.3`
- [x] The dry run targets `https://registry.npmjs.org/`
- [x] The tarball contains `dist/`, `templates/`, `README.md`, and `LICENSE`
- [x] The tarball does not contain local caches, extraction fixtures, credentials, or unrelated
      repository files

Smoke-test the exact tarball in fresh directories using the workflow in
[`maintaining.md`](maintaining.md#smoke-testing-before-publish):

- [x] Fresh Cursor installation succeeds
- [x] Fresh Claude Code installation succeeds
- [x] Fresh Codex installation succeeds
- [x] `uspec-skills doctor` succeeds for every installed host
- [x] Installed skill links resolve correctly
- [x] The exact packed 0.3.3 tarball prepares an existing schema-v1/plugin-2.5 fixture, confirming
      backward compatibility
- [ ] `component-md prepare` accepts a new 2.7.0 plugin extraction
- [ ] `component-md validate`, `contract`, and `render` complete on a representative component
- [ ] Concise Markdown and optional audit output contain no unresolved targets or obligation gaps

## 4. Validate the public Figma plugin

Run from `figma-plugin/`:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run validate -- /absolute/path/to/a/recent-_base.json
```

- [x] Typecheck, tests, build, and validator all pass on the current release candidate
- [x] `npm audit --registry=https://registry.npmjs.org/` reports zero vulnerabilities
- [x] `dist/code.js` and `dist/ui.html` were generated from the current release candidate
- [x] The footer displays `extractor v2.7.0`
- [ ] The public UI requires a valid Figma component link before extraction
- [ ] A valid link is remembered and prefilled on a second run in the same document
- [x] The plugin manifest still uses Community plugin id `1635184425006534227`
- [ ] A clean development import from `figma-plugin/manifest.json` starts successfully
- [x] A representative multi-variant component exports all variants
- [x] Variant-only and nested child instances appear in `_childComposition`
- [x] Every distinct revealed topology has a populated `revealedTree`
- [x] The emitted file reports plugin version 2.7.0, schema version 1, and no unexpected warnings
- [ ] The emitted file passes both the plugin validator and CLI `component-md prepare`

## 5. Validate documentation

- [x] Public documentation consistently says that the Community plugin requires a component link
- [x] Documentation does not claim that the internal no-link build lives in this repository
- [x] `README.md`, `figma-plugin/README.md`, `packages/cli/README.md`, `maintaining.md`, and
      `implementation.md` agree on package boundaries and release versions
- [x] New or changed CLI commands are documented with current flags
- [x] `mintlify validate` passes in strict mode
- [ ] Mintlify preview renders the V2.7 changelog and affected pages without errors
- [x] `mintlify broken-links --check-anchors` reports no broken links

## 6. Merge and publish

Publish from the final commit on `main`, not from the experiment branch or a dirty worktree.

- [ ] Merge the approved pull request to `main`
- [ ] Pull the final `main` commit into a clean local checkout
- [ ] Record the release commit SHA
- [x] Verify npm authentication with
      `npm whoami --registry=https://registry.npmjs.org/`
- [ ] Publish `uspec-skills` 0.3.3 from `packages/cli/`:

```bash
npm publish --access public
npm view uspec-skills version
```

- [ ] Confirm npm reports 0.3.3
- [ ] Publish the link-required uSpec Extract 2.7.0 build to the Figma Community from Figma Desktop
- [ ] Confirm the Community listing opens and the installed plugin shows version 2.7.0
- [ ] Confirm Mintlify deployed the V2.7 changelog from `main`

Publishing npm before the plugin is the safer order for this release: the new CLI remains compatible
with older schema-v1 exports, while plugin 2.7.0 adds evidence that older CLI versions may not use.

## 7. Tag and announce

- [ ] Tag the exact release commit:

```bash
git tag -a v2.7.0 -m "uSpec V2.7 / uspec-extract 2.7.0 / uspec-skills 0.3.3"
git push origin v2.7.0
```

- [ ] Create the GitHub Release:

```bash
gh release create v2.7.0 \
  --title "uSpec V2.7" \
  --notes-file /tmp/v2.7-release-notes.md \
  --latest
```

- [ ] Confirm the GitHub Release points to the same commit published to npm and Figma
- [ ] Include npm update and Figma Community installation instructions in the announcement

## 8. Post-release verification

- [ ] In a fresh directory, run `npx --yes uspec-skills@0.3.3 init`
- [ ] Run `npx --yes uspec-skills@0.3.3 doctor`
- [ ] Install the Community plugin fresh rather than using the development import
- [ ] Produce and validate one extraction with the Community build
- [ ] Run one end-to-end `create-component-md` workflow from that extraction
- [ ] Check npm, GitHub, Figma Community, and docs links from an unauthenticated browser
- [ ] Monitor initial reports; ship a patch instead of unpublishing if a defect is found
