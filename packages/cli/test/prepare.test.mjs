import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tagFixture = join(__dirname, 'fixtures', 'tag-_base.json');
const cliEntry = join(__dirname, '..', 'dist', 'index.js');

function runPrepare(cwd, extraArgs = []) {
  const result = spawnSync(
    process.execPath,
    [cliEntry, 'component-md', 'prepare', '--base', tagFixture, '--json', ...extraArgs],
    { cwd, encoding: 'utf8' },
  );
  return result;
}

test('validate rejects invalid JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'uspec-prepare-'));
  try {
    const badPath = join(dir, 'bad-_base.json');
    await cp(tagFixture, badPath);
    const raw = await readFile(badPath, 'utf8');
    await import('node:fs/promises').then(({ writeFile }) =>
      writeFile(badPath, raw.slice(0, -2), 'utf8'),
    );
    const result = spawnSync(
      process.execPath,
      [cliEntry, 'component-md', 'prepare', '--base', badPath, '--json'],
      { cwd: dir, encoding: 'utf8' },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid JSON|Validation failed/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('prepare stages tag fixture and emits manifest + evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'uspec-prepare-'));
  try {
    const result = runPrepare(dir);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const manifest = JSON.parse(result.stdout);
    assert.equal(manifest.componentSlug, 'tag');
    assert.equal(manifest.summaries.variantAxes.size.length, 2);
    assert.equal(manifest.summaries.composition.constitutive, 1);
    assert.match(manifest.baseSourceHash, /^sha256:/);
    assert.equal(manifest.readiness.layoutTreeHasNodeIds, true);

    const apiEvidence = JSON.parse(
      await readFile(manifest.paths.evidence.api, 'utf8'),
    );
    assert.equal(apiEvidence._meta.domain, 'api');
    assert.equal(apiEvidence._meta.baseSourceHash, manifest.baseSourceHash);
    assert.equal(apiEvidence.data.componentName, 'tag');
    assert.ok(Array.isArray(apiEvidence.data.composableChildren));

    const structureEvidence = JSON.parse(
      await readFile(manifest.paths.evidence.structure, 'utf8'),
    );
    assert.equal(structureEvidence._meta.domain, 'structure');
    assert.ok(structureEvidence.data.rootDimensions.small);
    assert.ok(structureEvidence.data.rootDimensions.medium);

    const colorEvidence = JSON.parse(
      await readFile(manifest.paths.evidence.color, 'utf8'),
    );
    assert.equal(colorEvidence._meta.domain, 'color');
    assert.equal(colorEvidence.data.variantColorData.length, 36);
    assert.ok(colorEvidence.data.uniqueTokens.length > 0);

    const voiceEvidence = JSON.parse(
      await readFile(manifest.paths.evidence.voice, 'utf8'),
    );
    assert.equal(voiceEvidence._meta.domain, 'voice');
    assert.equal(voiceEvidence.data.elements.length, 4);

    const staged = JSON.parse(
      await readFile(manifest.stagedBasePath, 'utf8'),
    );
    assert.equal(staged._meta.componentSlug, 'tag');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('prepare is deterministic for evidence payloads', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'uspec-prepare-'));
  try {
    const first = JSON.parse(runPrepare(dir).stdout);
    const second = JSON.parse(runPrepare(dir).stdout);

    assert.equal(first.baseSourceHash, second.baseSourceHash);

    const stripTimestamps = (obj) =>
      JSON.parse(
        JSON.stringify(obj, (_, v) =>
          typeof v === 'string' && v.match(/^\d{4}-\d{2}-\d{2}T/) ? '<TS>' : v,
        ),
      );

    const api1 = stripTimestamps(
      JSON.parse(await readFile(first.paths.evidence.api, 'utf8')),
    );
    const api2 = stripTimestamps(
      JSON.parse(await readFile(second.paths.evidence.api, 'utf8')),
    );
    assert.deepEqual(api1, api2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('optional context stamps staged base when null', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'uspec-prepare-'));
  try {
    const localBase = join(dir, 'tag-_base.json');
    await cp(tagFixture, localBase);
    const result = spawnSync(
      process.execPath,
      [
        cliEntry,
        'component-md',
        'prepare',
        '--base',
        localBase,
        '--context',
        'compact variant only',
        '--json',
      ],
      { cwd: dir, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(result.stdout);
    const staged = JSON.parse(
      await readFile(manifest.stagedBasePath, 'utf8'),
    );
    assert.equal(staged._meta.optionalContext, 'compact variant only');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
