import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliEntry = join(__dirname, '..', 'dist', 'index.js');
const template = resolve(
  __dirname,
  '..',
  '..',
  '..',
  'references',
  'component-md',
  'component-md-template.md',
);

const meta = {
  schemaVersion: '1',
  extractedAt: '2026-01-02T03:04:05.000Z',
  fileKey: 'file-key',
  nodeId: '1:2',
  componentSlug: 'sample',
};

async function json(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

test('render deterministically assembles validated specialist semantics', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'uspec-render-'));
  try {
    const cache = join(dir, 'cache');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(cache));
    const hash = 'sha256:test-hash';
    const output = join(dir, 'sample.md');
    const manifestPath = join(cache, 'sample-prepare-manifest.json');
    const planPath = join(cache, 'sample-render-plan.json');
    const rendererPath = join(cache, 'sample-evidence-renderer.json');
    const deepBranch = {
      id: '1:10',
      name: 'level 1',
      type: 'FRAME',
      children: [
        {
          id: '1:11',
          name: 'level 2',
          type: 'FRAME',
          children: [
            {
              id: '1:12',
              name: 'level 3',
              type: 'FRAME',
              children: [
                {
                  id: '1:13',
                  name: 'level 4',
                  type: 'FRAME',
                  children: [{ id: '1:14', name: 'level 5', type: 'FRAME' }],
                },
              ],
            },
          ],
        },
      ],
    };

    await json(manifestPath, {
      _meta: {
        schemaVersion: '1',
        preparedAt: meta.extractedAt,
        componentSlug: 'sample',
        baseJsonPath: join(cache, 'sample-_base.json'),
        baseBytes: 1,
        baseSourceHash: hash,
        pluginVersion: 'test',
        variantsWalked: 1,
        validation: { ok: true, errors: [] },
      },
      readiness: {},
      source: {
        fileKey: meta.fileKey,
        nodeId: meta.nodeId,
        figmaUrl: 'https://www.figma.com/design/file-key/?node-id=1-2',
        extractionSource: 'plugin',
      },
      summaries: {},
      paths: {
        cachePath: cache,
        stagedBasePath: join(cache, 'sample-_base.json'),
        outputPath: output,
        evidence: { renderer: rendererPath },
      },
    });
    await json(planPath, {
      _meta: {
        schemaVersion: '1',
        componentSlug: 'sample',
        baseSourceHash: hash,
        generatedAt: meta.extractedAt,
      },
      data: {
        overviewParagraph:
          'Sample is a compact status component. AI owns this semantic summary.',
      },
    });
    await json(rendererPath, {
      _meta: { schemaVersion: '1', domain: 'renderer', baseSourceHash: hash },
      data: {
        source: {
          extractedAt: meta.extractedAt,
          fileKey: meta.fileKey,
          nodeId: meta.nodeId,
          figmaUrl: 'https://www.figma.com/design/file-key/?node-id=1-2',
          optionalContext: null,
        },
        component: {
          componentName: 'sample',
          compSetNodeId: '1:2',
          isComponentSet: true,
        },
        variantAxes: [{ name: 'size', options: ['small'], defaultValue: 'small' }],
        defaultVariant: {
          id: '1:3',
          name: 'size=small',
          variantProperties: { size: 'small' },
        },
        defaultTree: {
          id: '1:3',
          name: 'sample',
          type: 'COMPONENT',
          children: [
            deepBranch,
            ...Array.from({ length: 36 }, (_, index) => ({
              id: `2:${index}`,
              name: `leaf ${index}`,
              type: 'FRAME',
            })),
          ],
        },
        variantTrees: [
          {
            id: '1:3',
            name: 'size=small',
            variantProperties: { size: 'small' },
            treeHierarchical: {
              id: '1:3',
              name: 'sample',
              type: 'COMPONENT',
              children: [deepBranch],
            },
          },
          {
            id: '1:4',
            name: 'size=large',
            variantProperties: { size: 'large' },
            treeHierarchical: {
              id: '1:4',
              name: 'sample large',
              type: 'COMPONENT',
              children: [
                { id: '3:2', name: 'alternate action', type: 'FRAME' },
              ],
            },
          },
        ],
        variantSelfChecks: [],
        propertyDefinitions: {
          rawDefs: {},
          booleans: [],
          slots: [],
        },
        childComposition: {
          children: [
            {
              name: 'child',
              mainComponentName: 'child',
              classification: 'referenced',
              subCompSetId: '9:9',
              componentProperties: {
                disabled: { type: 'BOOLEAN', value: false },
              },
            },
          ],
          ambiguousChildren: [],
        },
        subComponentVariantWalks: null,
        extractionNotes: { warnings: [] },
      },
    });
    await json(join(cache, 'sample-api.json'), {
      _meta: meta,
      data: {
        componentName: 'sample',
        generalNotes: 'AI-authored API guidance.',
        mainTable: {
          properties: [
            {
              property: 'size',
              values: 'small',
              default: 'small',
              notes: 'Controls size.',
            },
          ],
        },
        subComponentTables: [],
        configurationExamples: [
          {
            title: 'Default sample',
            properties: [{ property: 'size', value: 'small', notes: 'Default.' }],
          },
        ],
        _deltaExtractions: [],
        _extractionArtifacts: { booleanRelationshipAnalysis: [] },
      },
    });
    await json(join(cache, 'sample-api-dictionary.json'), {
      _meta: meta,
      data: {
        componentName: 'sample',
        axes: [
          {
            name: 'size',
            values: [{ name: 'small', figmaValue: null, runtimeCondition: null }],
          },
        ],
        booleanProps: [],
        states: [],
        slots: [],
      },
    });
    await json(join(cache, 'sample-structure.json'), {
      _meta: meta,
      data: {
        componentName: 'sample',
        generalNotes: 'AI-authored structure guidance.',
        sections: [
          {
            sectionName: 'Sample composition',
            sectionDescription: 'AI-authored section description.',
            columns: ['Spec', 'small', 'Notes'],
            subCompSetId: '9:9',
            _anchor: { layerName: '__root__', layerId: '1:3' },
            rows: [
              {
                spec: 'Child root',
                values: ['–'],
                notes: 'Sub-component-owned group.',
                provenance: 'measured',
                _layerName: 'child',
                _layerId: '1:3',
              },
              {
                spec: 'padding',
                values: ['8'],
                notes: 'Measured.',
                provenance: 'measured',
              },
            ],
          },
          {
            sectionName: 'Alternate composition',
            sectionDescription: 'Anatomy that exists only in the large variant.',
            columns: ['Spec', 'large', 'Notes'],
            variantProperties: { size: 'large' },
            _anchor: {
              layerName: '__root__',
              layerId: '1:4',
              variantId: '1:4',
            },
            rows: [
              {
                spec: 'Alternate action',
                values: ['–'],
                notes: 'Variant-only group.',
                provenance: 'measured',
                _layerName: 'alternate action',
                _layerId: '3:2',
                _targetVariantId: '1:4',
              },
              {
                spec: 'Wrong variant layer',
                values: ['–'],
                notes: 'Must not resolve across variant boundaries.',
                provenance: 'measured',
                _layerName: 'level 1',
                _layerId: '1:10',
                _targetVariantId: '1:4',
              },
            ],
          },
        ],
        _deltaExtractions: [],
        _extractionArtifacts: {
          variantAxes: { size: ['small'] },
          booleanDefs: {},
          visualOnlyAxisDeltas: [],
          coverageMatrix: {
            complete: true,
            totals: { framesWalked: 0, framesWithNonZeroProps: 0, missingFamilies: 0 },
            entries: [],
          },
        },
      },
    });
    await json(join(cache, 'sample-color.json'), {
      _meta: meta,
      data: {
        componentName: 'sample',
        generalNotes: 'AI-authored color guidance.',
        renderingStrategy: 'A',
        variants: [
          {
            name: 'small',
            tables: [
              {
                name: 'Spec',
                elements: [
                  { element: 'Container fill', token: 'surface/default', notes: 'Surface.' },
                ],
                elementHexes: [{ hex: '#FFFFFF' }],
              },
            ],
          },
        ],
        _deltaExtractions: [],
        _extractionArtifacts: {
          strategy: 'A',
          variantAxes: { size: ['small'] },
          modeDetection: { hasModeCollection: false },
        },
      },
    });
    const sections = ['VoiceOver (iOS)', 'TalkBack (Android)', 'ARIA (Web)'].map(
      (title) => ({
        title,
        tables: [
          {
            name: 'Sample',
            announcement: '"Sample"',
            focusOrderIndex: 1,
            layerName: 'sample',
            properties: [
              { property: 'Role', value: 'text', notes: 'Non-interactive.' },
            ],
          },
        ],
      }),
    );
    await json(join(cache, 'sample-voice.json'), {
      _meta: meta,
      data: {
        componentName: 'sample',
        guidelines: 'AI-authored accessibility guidance.',
        states: [
          {
            state: 'default',
            description: 'Default semantics.',
            slotInsertions: [
              {
                slotName: 'trailing',
                componentNodeId: '9:9',
                nestedOverrides: { disabled: false },
              },
            ],
            sections,
          },
        ],
        _deltaExtractions: [],
        _extractionArtifacts: {
          variantAxes: { size: ['small'] },
          booleanDefs: {},
        },
      },
    });
    await json(join(cache, 'sample-reconciliations.json'), {
      _meta: { schemaVersion: '1', generatedAt: meta.extractedAt },
      data: {
        autoReconciled: [],
        retries: [],
        unresolved: [],
        reviewedBenign: [],
      },
    });

    const directContractPath = join(dir, 'sample.direct-contract.json');
    const directContract = spawnSync(
      process.execPath,
      [
        cliEntry,
        'component-md',
        'contract',
        '--manifest',
        manifestPath,
        '--plan',
        planPath,
        '--output',
        directContractPath,
        '--json',
      ],
      { encoding: 'utf8' },
    );
    assert.equal(directContract.status, 0, directContract.stderr || directContract.stdout);
    const directContractResult = JSON.parse(directContract.stdout);
    assert.equal(directContractResult.schemaVersion, '1.0');
    assert.equal(directContractResult.componentSlug, 'sample');
    assert.equal(directContractResult.outputPath, directContractPath);
    const directContractJson = JSON.parse(await readFile(directContractPath, 'utf8'));
    assert.equal(directContractJson.component.slug, 'sample');

    const args = [
      cliEntry,
      'component-md',
      'render',
      '--manifest',
      manifestPath,
      '--plan',
      planPath,
      '--output',
      output,
      '--template',
      template,
      '--view',
      'audit',
      '--json',
    ];
    const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const renderResult = JSON.parse(first.stdout);
    assert.equal(renderResult.sourceCoverage.apiProperties, 1);
    assert.equal(renderResult.sourceCoverage.structureRows, 4);
    assert.equal(renderResult.sourceCoverage.colorElements, 1);
    assert.equal(renderResult.sourceCoverage.voicePlatforms, 3);
    assert.deepEqual(renderResult.sectionTargets, { resolved: 2, total: 2 });
    assert.deepEqual(renderResult.groupTargets, { resolved: 1, total: 3 });
    assert.deepEqual(renderResult.targetResolutionByVariant['parent:1:4'], {
      resolved: 2,
      total: 3,
    });
    const firstMarkdown = await readFile(output, 'utf8');
    const second = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(second.status, 0, second.stderr || second.stdout);
    const secondMarkdown = await readFile(output, 'utf8');

    assert.equal(firstMarkdown, secondMarkdown);
    assert.match(firstMarkdown, /AI owns this semantic summary/);
    assert.match(firstMarkdown, /AI-authored API guidance/);
    assert.match(firstMarkdown, /surface\/default \(#FFFFFF\)/);
    assert.match(firstMarkdown, /<!-- render-meta:start v=1 -->/);
    assert.match(
      firstMarkdown,
      /layer name "child" has no source-accurate node in sub-component set "9:9" tree/,
    );
    assert.match(firstMarkdown, /"sourceScope": "subcomponent"/);
    assert.match(firstMarkdown, /<!-- voice-render-meta v=1/);
    assert.match(firstMarkdown, /### Referenced components/);
    assert.match(firstMarkdown, /Prop passed to child/);
    assert.match(firstMarkdown, /### Slot insertions/);
    assert.match(firstMarkdown, /slot \*\*trailing\*\* populated with \*\*9:9\*\*/);
    assert.match(firstMarkdown, /… \(1 more nodes\)/);
    assert.doesNotMatch(firstMarkdown, /\{\{/);
    const contractPath = join(cache, 'sample-contract.json');
    const contract = JSON.parse(await readFile(contractPath, 'utf8'));
    assert.equal(contract.schemaVersion, '1.0');
    assert.equal(contract.component.slug, 'sample');
    assert.equal(contract.api.componentName, 'sample');
    assert.equal(contract.accessibility.componentName, 'sample');
    assert.equal(contract.provenance.obligationCoverage.api.total, 0);
    assert.equal(
      contract.structure._extractionArtifacts?.obligationLedger,
      undefined,
      'pipeline ledgers should not leak into the canonical semantic contract',
    );

    const conciseOutput = join(dir, 'sample.concise.md');
    const conciseArgs = [
      cliEntry,
      'component-md',
      'render',
      '--manifest',
      manifestPath,
      '--plan',
      planPath,
      '--output',
      conciseOutput,
      '--contract',
      contractPath,
      '--json',
    ];
    const conciseFirst = spawnSync(process.execPath, conciseArgs, { encoding: 'utf8' });
    assert.equal(conciseFirst.status, 0, conciseFirst.stderr || conciseFirst.stdout);
    const conciseResult = JSON.parse(conciseFirst.stdout);
    assert.equal(conciseResult.view, 'concise');
    assert.equal(conciseResult.contractPath, contractPath);
    const conciseMarkdown = await readFile(conciseOutput, 'utf8');
    const conciseSecond = spawnSync(process.execPath, conciseArgs, { encoding: 'utf8' });
    assert.equal(conciseSecond.status, 0, conciseSecond.stderr || conciseSecond.stdout);
    assert.equal(conciseMarkdown, await readFile(conciseOutput, 'utf8'));
    assert.ok(conciseMarkdown.length < firstMarkdown.length);
    assert.match(conciseMarkdown, /## Overview/);
    assert.match(conciseMarkdown, /## Composition/);
    assert.match(conciseMarkdown, /## Anatomy/);
    assert.match(conciseMarkdown, /## Implementation invariants/);
    assert.match(conciseMarkdown, /### Default sample/);
    assert.match(conciseMarkdown, /AI-authored API guidance/);
    assert.match(conciseMarkdown, /AI-authored color guidance/);
    assert.match(conciseMarkdown, /AI-authored accessibility guidance/);
    assert.match(conciseMarkdown, /### default/);
    assert.match(conciseMarkdown, /## Evidence coverage/);
    assert.match(conciseMarkdown, /Canonical JSON: `sample-contract\.json`/);
    assert.doesNotMatch(conciseMarkdown, /Full audit:/);
    assert.doesNotMatch(conciseMarkdown, /render-meta:start/);

    const malformedContractPath = join(cache, 'sample-contract-malformed.json');
    const malformedContract = structuredClone(contract);
    delete malformedContract.accessibility.states;
    await json(malformedContractPath, malformedContract);
    const malformed = spawnSync(
      process.execPath,
      conciseArgs.map((arg) => (arg === contractPath ? malformedContractPath : arg)),
      { encoding: 'utf8' },
    );
    assert.notEqual(malformed.status, 0);
    assert.match(malformed.stderr, /Canonical contract validation failed/);

    const renderedManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.ok(renderedManifest.metrics.render.specialistCacheBytes > 0);
    assert.ok(renderedManifest.metrics.render.contractBytes > 0);
    assert.ok(renderedManifest.metrics.render.outputBytes > 0);
    assert.ok(renderedManifest.metrics.render.durationMs >= 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
