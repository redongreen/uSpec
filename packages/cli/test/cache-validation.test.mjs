import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliEntry = join(__dirname, '..', 'dist', 'index.js');

test('validate normalizes unavailable delta records deterministically', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'uspec-cache-validation-'));
  try {
    const path = join(dir, 'sample-structure.json');
    await writeFile(
      path,
      JSON.stringify({
        _meta: {
          schemaVersion: '1',
          extractedAt: '2026-01-02T03:04:05.000Z',
          fileKey: 'file-key',
          nodeId: '1:2',
          componentSlug: 'sample',
        },
        data: {
          sections: [
            {
              columns: ['Spec', 'Default', 'Notes'],
              rows: [
                {
                  spec: 'padding',
                  values: ['8'],
                  notes: 'Measured',
                  provenance: 'measured',
                },
              ],
            },
          ],
          _deltaExtractions: [
            {
              purpose: 'Inspect a missing fact',
              unavailable: 'mcp-unavailable',
            },
          ],
          _extractionArtifacts: {
            coverageMatrix: {
              complete: true,
              totals: { framesWalked: 1, framesWithNonZeroProps: 1, missingFamilies: 0 },
              entries: [],
            },
          },
        },
      }),
      'utf8',
    );

    const result = spawnSync(
      process.execPath,
      [
        cliEntry,
        'component-md',
        'validate',
        '--cache',
        dir,
        '--slug',
        'sample',
        '--domain',
        'structure',
        '--normalize',
        '--json',
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output[0].ok, true);
    assert.equal(output[0].normalized, 3);

    const normalized = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(normalized.data._deltaExtractions[0].script, null);
    assert.equal(normalized.data._deltaExtractions[0].byteCount, 0);
    assert.equal(
      normalized.data._deltaExtractions[0].timestamp,
      '2026-01-02T03:04:05.000Z',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('validate rejects malformed executed delta records', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'uspec-cache-validation-'));
  try {
    await writeFile(
      join(dir, 'sample-api.json'),
      JSON.stringify({
        _meta: {
          schemaVersion: '1',
          extractedAt: '2026-01-02T03:04:05.000Z',
          fileKey: 'file-key',
          nodeId: '1:2',
          componentSlug: 'sample',
        },
        data: {
          componentName: 'sample',
          mainTable: { properties: [] },
          configurationExamples: [],
          _deltaExtractions: [
            {
              purpose: 'Ran a delta',
              script: null,
              byteCount: 10,
              timestamp: '2026-01-02T03:04:05.000Z',
            },
          ],
        },
      }),
      'utf8',
    );
    const result = spawnSync(
      process.execPath,
      [
        cliEntry,
        'component-md',
        'validate',
        '--cache',
        dir,
        '--slug',
        'sample',
        '--domain',
        'api',
        '--json',
      ],
      { encoding: 'utf8' },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /script must describe the executed script/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('validate rejects color hex arrays that drift from elements', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'uspec-cache-validation-'));
  try {
    await writeFile(
      join(dir, 'sample-color.json'),
      JSON.stringify({
        _meta: {
          schemaVersion: '1',
          extractedAt: '2026-01-02T03:04:05.000Z',
          fileKey: 'file-key',
          nodeId: '1:2',
          componentSlug: 'sample',
        },
        data: {
          componentName: 'sample',
          renderingStrategy: 'A',
          variants: [
            {
              name: 'default',
              tables: [
                {
                  name: 'Spec',
                  elements: [{ element: 'Fill', token: 'surface' }],
                  elementHexes: [],
                },
              ],
            },
          ],
          _deltaExtractions: [],
          _extractionArtifacts: { strategy: 'A' },
        },
      }),
      'utf8',
    );
    const result = spawnSync(
      process.execPath,
      [
        cliEntry,
        'component-md',
        'validate',
        '--cache',
        dir,
        '--slug',
        'sample',
        '--domain',
        'color',
        '--json',
      ],
      { encoding: 'utf8' },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /elementHexes must match elements length/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('validate blocks unaccounted evidence and unsupported semantic rows', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'uspec-cache-validation-'));
  try {
    const obligationId = 'structure:root-dimension:padding:test';
    await writeFile(
      join(dir, 'sample-evidence-structure.json'),
      JSON.stringify({
        _meta: { schemaVersion: '1', domain: 'structure' },
        data: {
          obligations: [
            {
              id: obligationId,
              domain: 'structure',
              kind: 'root-dimension',
              label: 'Root padding',
              policy: 'must-emit',
              sourcePaths: ['/variants/0/dimensions/padding'],
              facts: { property: 'padding', value: 8 },
            },
          ],
        },
      }),
      'utf8',
    );
    const cachePath = join(dir, 'sample-structure.json');
    const document = {
      _meta: {
        schemaVersion: '1',
        extractedAt: '2026-01-02T03:04:05.000Z',
        fileKey: 'file-key',
        nodeId: '1:2',
        componentSlug: 'sample',
      },
      data: {
        sections: [
          {
            columns: ['Spec', 'Default', 'Notes'],
            rows: [
              {
                spec: 'padding',
                values: ['8'],
                notes: 'Measured',
                provenance: 'measured',
              },
            ],
          },
        ],
        _deltaExtractions: [],
        _extractionArtifacts: {
          coverageMatrix: {
            complete: true,
            totals: { framesWalked: 1, framesWithNonZeroProps: 1, missingFamilies: 0 },
            entries: [],
          },
          obligationLedger: [],
        },
      },
    };
    await writeFile(cachePath, JSON.stringify(document), 'utf8');

    const invalid = spawnSync(
      process.execPath,
      [
        cliEntry,
        'component-md',
        'validate',
        '--cache',
        dir,
        '--slug',
        'sample',
        '--domain',
        'structure',
        '--json',
      ],
      { encoding: 'utf8' },
    );
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stdout, /evidence obligation .* is unaccounted/);
    assert.match(invalid.stdout, /semantic output .* has no evidence obligation/);

    document.data._extractionArtifacts.obligationLedger = [
      {
        obligationId,
        disposition: 'emitted',
        targets: ['/data/sections/0/rows/0'],
        reason: '',
      },
    ];
    await writeFile(cachePath, JSON.stringify(document), 'utf8');
    const valid = spawnSync(
      process.execPath,
      [
        cliEntry,
        'component-md',
        'validate',
        '--cache',
        dir,
        '--slug',
        'sample',
        '--domain',
        'structure',
        '--json',
      ],
      { encoding: 'utf8' },
    );
    assert.equal(valid.status, 0, valid.stderr || valid.stdout);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('validate enforces engineer-facing instance types', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'uspec-cache-validation-'));
  try {
    const obligationId = 'api:instance-swap:icon:test';
    await writeFile(
      join(dir, 'sample-evidence-api.json'),
      JSON.stringify({
        _meta: { schemaVersion: '1', domain: 'api' },
        data: {
          obligations: [
            {
              id: obligationId,
              domain: 'api',
              kind: 'instance-swap',
              label: 'Named icon API',
              policy: 'must-emit',
              sourcePaths: ['/_childComposition/children/0/componentProperties/icon'],
              facts: { propertyName: 'icon' },
              representation: {
                targetKind: 'api-property',
                field: 'type',
                pattern: '^[A-Z][A-Za-z0-9]*Name$',
                allowMerge: true,
              },
            },
          ],
        },
      }),
      'utf8',
    );
    const cachePath = join(dir, 'sample-api.json');
    const document = {
      _meta: {
        schemaVersion: '1',
        extractedAt: '2026-01-02T03:04:05.000Z',
        fileKey: 'file-key',
        nodeId: '1:2',
        componentSlug: 'sample',
      },
      data: {
        componentName: 'sample',
        mainTable: {
          properties: [
            { property: 'leadingIcon', type: '(instance)', values: '—', default: '–' },
          ],
        },
        configurationExamples: [{ title: 'Default', properties: [] }],
        _deltaExtractions: [],
        _extractionArtifacts: {
          obligationLedger: [
            {
              obligationId,
              disposition: 'emitted',
              targets: ['/data/mainTable/properties/0'],
              reason: '',
            },
          ],
        },
      },
    };
    await writeFile(cachePath, JSON.stringify(document), 'utf8');
    const args = [
      cliEntry,
      'component-md',
      'validate',
      '--cache',
      dir,
      '--slug',
      'sample',
      '--domain',
      'api',
      '--json',
    ];
    const invalid = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stdout, /must match/);

    document.data.mainTable.properties[0].type = 'IconName';
    await writeFile(cachePath, JSON.stringify(document), 'utf8');
    const valid = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(valid.status, 0, valid.stderr || valid.stdout);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('validate requires separate structured typography rows', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'uspec-cache-validation-'));
  try {
    const obligationId = 'structure:typography-field:font-family:test';
    await writeFile(
      join(dir, 'sample-evidence-structure.json'),
      JSON.stringify({
        _meta: { schemaVersion: '1', domain: 'structure' },
        data: {
          obligations: [
            {
              id: obligationId,
              domain: 'structure',
              kind: 'typography-field',
              label: 'Font family',
              policy: 'must-emit',
              sourcePaths: ['/variants/0/tree/typography/fontFamily'],
              facts: { property: 'fontFamily', value: 'Example Sans' },
              representation: {
                targetKind: 'structure-row',
                field: 'spec',
                oneOf: ['fontFamily'],
                allowMerge: false,
              },
            },
          ],
        },
      }),
      'utf8',
    );
    const cachePath = join(dir, 'sample-structure.json');
    const document = {
      _meta: {
        schemaVersion: '1',
        extractedAt: '2026-01-02T03:04:05.000Z',
        fileKey: 'file-key',
        nodeId: '1:2',
        componentSlug: 'sample',
      },
      data: {
        sections: [
          {
            columns: ['Spec', 'Default', 'Notes'],
            rows: [
              {
                spec: 'textStyle',
                values: ['Body'],
                notes: 'Includes family.',
                provenance: 'measured',
              },
            ],
          },
        ],
        _deltaExtractions: [],
        _extractionArtifacts: {
          coverageMatrix: {
            complete: true,
            totals: { framesWalked: 0, framesWithNonZeroProps: 0, missingFamilies: 0 },
            entries: [],
          },
          obligationLedger: [
            {
              obligationId,
              disposition: 'merged',
              targets: ['/data/sections/0/rows/0'],
              reason: 'Folded into textStyle.',
            },
          ],
        },
      },
    };
    await writeFile(cachePath, JSON.stringify(document), 'utf8');
    const args = [
      cliEntry,
      'component-md',
      'validate',
      '--cache',
      dir,
      '--slug',
      'sample',
      '--domain',
      'structure',
      '--json',
    ];
    const invalid = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stdout, /may not use merged disposition/);
    assert.match(invalid.stdout, /must be one of \[fontFamily\]/);

    document.data.sections[0].rows[0].spec = 'fontFamily';
    document.data._extractionArtifacts.obligationLedger[0].disposition = 'emitted';
    document.data._extractionArtifacts.obligationLedger[0].reason = '';
    await writeFile(cachePath, JSON.stringify(document), 'utf8');
    const valid = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(valid.status, 0, valid.stderr || valid.stdout);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
