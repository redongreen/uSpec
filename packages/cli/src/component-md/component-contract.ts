import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import Ajv, { type ErrorObject } from 'ajv';
import { validateCaches, type CacheValidationResult } from './cache-validation.js';
import { normalizeStructureTargetIdentity } from './target-identity.js';
import type {
  CanonicalComponentContract,
  EvidenceDomain,
  PrepareManifest,
  RenderPlan,
} from './types.js';

type JsonObject = Record<string, any>;

const contractSchema = {
  $id: 'https://uspec.design/schemas/component-contract-1.0.json',
  type: 'object',
  additionalProperties: false,
  required: [
    '$schema',
    'schemaVersion',
    'generatedAt',
    'component',
    'source',
    'summary',
    'variants',
    'anatomy',
    'api',
    'structure',
    'color',
    'accessibility',
    'dictionary',
    'reconciliations',
    'sourceModel',
    'provenance',
  ],
  properties: {
    $schema: { const: 'https://uspec.design/schemas/component-contract-1.0.json' },
    schemaVersion: { const: '1.0' },
    generatedAt: { type: 'string', minLength: 1 },
    component: {
      type: 'object',
      additionalProperties: false,
      required: ['slug', 'name'],
      properties: {
        slug: { type: 'string', minLength: 1 },
        name: { type: 'string', minLength: 1 },
      },
    },
    source: {
      type: 'object',
      additionalProperties: false,
      required: [
        'fileKey',
        'nodeId',
        'figmaUrl',
        'extractionSource',
        'baseSourceHash',
      ],
      properties: {
        fileKey: { type: 'string', minLength: 1 },
        nodeId: { type: 'string', minLength: 1 },
        figmaUrl: { type: 'string', minLength: 1 },
        extractionSource: { type: ['string', 'null'] },
        baseSourceHash: { type: 'string', pattern: '^sha256:' },
      },
    },
    summary: {
      type: 'object',
      additionalProperties: false,
      required: ['overview', 'confidence'],
      properties: {
        overview: { type: 'string', minLength: 1 },
        confidence: {
          type: 'object',
          additionalProperties: false,
          required: ['api', 'structure', 'color', 'voice'],
          properties: {
            api: { type: 'string' },
            structure: { type: 'string' },
            color: { type: 'string' },
            voice: { type: 'string' },
          },
        },
      },
    },
    variants: {
      type: 'object',
      additionalProperties: false,
      required: ['axes', 'default'],
      properties: {
        axes: { type: 'array' },
        default: {},
      },
    },
    anatomy: {
      type: 'object',
      additionalProperties: false,
      required: ['defaultTree', 'composition', 'subcomponents'],
      properties: {
        defaultTree: {},
        composition: {},
        subcomponents: {},
      },
    },
    api: {
      type: 'object',
      required: ['componentName', 'mainTable', 'subComponentTables', 'configurationExamples'],
      properties: {
        componentName: { type: 'string', minLength: 1 },
        mainTable: {
          type: 'object',
          required: ['properties'],
          properties: { properties: { type: 'array' } },
        },
        subComponentTables: { type: 'array' },
        configurationExamples: { type: 'array' },
      },
    },
    structure: {
      type: 'object',
      required: ['componentName', 'sections'],
      properties: {
        componentName: { type: 'string', minLength: 1 },
        sections: { type: 'array' },
      },
    },
    color: {
      type: 'object',
      required: ['componentName'],
      properties: { componentName: { type: 'string', minLength: 1 } },
    },
    accessibility: {
      type: 'object',
      required: ['componentName', 'states'],
      properties: {
        componentName: { type: 'string', minLength: 1 },
        states: { type: 'array' },
      },
    },
    dictionary: {
      type: 'object',
      required: ['componentName', 'axes', 'booleanProps', 'states', 'slots'],
      properties: {
        componentName: { type: 'string', minLength: 1 },
        axes: { type: 'array' },
        booleanProps: { type: 'array' },
        states: { type: 'array' },
        slots: { type: 'array' },
      },
    },
    reconciliations: {
      type: 'object',
      required: ['autoReconciled', 'retries', 'unresolved', 'reviewedBenign'],
      properties: {
        autoReconciled: { type: 'array' },
        retries: { type: 'array' },
        unresolved: { type: 'array' },
        reviewedBenign: { type: 'array' },
      },
    },
    sourceModel: {
      type: 'object',
      required: [
        'source',
        'component',
        'variantAxes',
        'defaultTree',
        'propertyDefinitions',
        'childComposition',
      ],
      properties: {
        source: { type: 'object' },
        component: { type: 'object' },
        variantAxes: { type: 'array' },
        defaultTree: { type: 'object' },
        propertyDefinitions: { type: 'object' },
        childComposition: { type: 'object' },
      },
    },
    provenance: {
      type: 'object',
      additionalProperties: false,
      required: ['preparedAt', 'obligationCoverage'],
      properties: {
        preparedAt: { type: 'string', minLength: 1 },
        obligationCoverage: {
          type: 'object',
          additionalProperties: false,
          required: ['api', 'structure', 'color', 'voice'],
          properties: Object.fromEntries(
            ['api', 'structure', 'color', 'voice'].map((domain) => [
              domain,
              {
                type: 'object',
                additionalProperties: false,
                required: ['total', 'emitted', 'merged', 'omitted', 'unresolved'],
                properties: {
                  total: { type: 'integer', minimum: 0 },
                  emitted: { type: 'integer', minimum: 0 },
                  merged: { type: 'integer', minimum: 0 },
                  omitted: { type: 'integer', minimum: 0 },
                  unresolved: { type: 'integer', minimum: 0 },
                },
              },
            ]),
          ),
        },
      },
    },
  },
} as const;

const ajv = new Ajv({ allErrors: true, strict: false });
const validateCompiled = ajv.compile(contractSchema);

function sorted(value: any): any {
  if (Array.isArray(value)) return value.map(sorted);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sorted(value[key])]),
  );
}

async function readJson<T = JsonObject>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function resolveReconciliations(cachePath: string, slug: string): Promise<JsonObject> {
  const plural = join(cachePath, `${slug}-reconciliations.json`);
  const singular = join(cachePath, `${slug}-reconciliation.json`);
  return readJson(existsSync(plural) ? plural : singular);
}

function semanticData(envelope: JsonObject): JsonObject {
  const data = structuredClone(envelope.data ?? {});
  if (data._extractionArtifacts) {
    delete data._extractionArtifacts.obligationLedger;
  }
  return data;
}

function coverageFor(envelope: JsonObject) {
  const ledger = envelope?.data?._extractionArtifacts?.obligationLedger ?? [];
  const result = {
    total: ledger.length,
    emitted: 0,
    merged: 0,
    omitted: 0,
    unresolved: 0,
  };
  for (const entry of ledger) {
    const disposition = entry?.disposition as keyof typeof result;
    if (disposition && disposition !== 'total' && disposition in result) {
      result[disposition]++;
    }
  }
  return result;
}

export function validateCanonicalContract(contract: unknown): {
  ok: boolean;
  errors: ErrorObject[];
} {
  const ok = validateCompiled(contract) as boolean;
  return { ok, errors: ok ? [] : [...(validateCompiled.errors ?? [])] };
}

export interface BuildContractOptions {
  manifestPath: string;
  planPath: string;
  outputPath?: string;
  normalizeCaches?: boolean;
}

export interface BuildContractResult {
  contract: CanonicalComponentContract;
  outputPath: string;
  bytes: number;
  cacheValidations: CacheValidationResult[];
}

export async function loadCanonicalComponentContract(
  path: string,
): Promise<BuildContractResult> {
  const serialized = await readFile(path, 'utf8');
  const contract = JSON.parse(serialized) as CanonicalComponentContract;
  const validation = validateCanonicalContract(contract);
  if (!validation.ok) {
    throw new Error(
      `Canonical contract validation failed:\n${validation.errors
        .map((error) => `  ${error.instancePath || '(root)'} — ${error.message}`)
        .join('\n')}`,
    );
  }
  return {
    contract,
    outputPath: path,
    bytes: Buffer.byteLength(serialized),
    cacheValidations: [],
  };
}

export async function buildCanonicalComponentContract(
  opts: BuildContractOptions,
): Promise<BuildContractResult> {
  const manifest = await readJson<PrepareManifest>(opts.manifestPath);
  const plan = await readJson<RenderPlan>(opts.planPath);
  const slug = manifest._meta.componentSlug;
  const cachePath = manifest.paths.cachePath;

  if (plan._meta.componentSlug !== slug) {
    throw new Error(`Render plan slug mismatch: ${plan._meta.componentSlug} !== ${slug}`);
  }
  if (plan._meta.baseSourceHash !== manifest._meta.baseSourceHash) {
    throw new Error('Render plan baseSourceHash does not match prepare manifest');
  }
  if (!plan.data.overviewParagraph?.trim()) {
    throw new Error('Render plan data.overviewParagraph is required');
  }

  const cacheValidations = await validateCaches({
    cachePath,
    slug,
    normalize: opts.normalizeCaches ?? true,
  });
  const invalid = cacheValidations.filter((result) => !result.ok);
  if (invalid.length) {
    throw new Error(
      `Cache validation failed:\n${invalid
        .flatMap((result) => result.errors.map((error) => `  ${result.domain}: ${error}`))
        .join('\n')}`,
    );
  }

  const [
    rendererEnvelope,
    apiEnvelope,
    dictionaryEnvelope,
    structureEnvelope,
    colorEnvelope,
    voiceEnvelope,
    reconciliationEnvelope,
  ] = await Promise.all([
    readJson<JsonObject>(manifest.paths.evidence.renderer),
    readJson<JsonObject>(join(cachePath, `${slug}-api.json`)),
    readJson<JsonObject>(join(cachePath, `${slug}-api-dictionary.json`)),
    readJson<JsonObject>(join(cachePath, `${slug}-structure.json`)),
    readJson<JsonObject>(join(cachePath, `${slug}-color.json`)),
    readJson<JsonObject>(join(cachePath, `${slug}-voice.json`)),
    resolveReconciliations(cachePath, slug),
  ]);

  if (rendererEnvelope._meta?.baseSourceHash !== manifest._meta.baseSourceHash) {
    throw new Error('Renderer evidence hash does not match prepare manifest');
  }

  const sourceModel = semanticData(rendererEnvelope);
  const api = semanticData(apiEnvelope);
  const structure = semanticData(structureEnvelope);
  const color = semanticData(colorEnvelope);
  const accessibility = semanticData(voiceEnvelope);
  const dictionary = semanticData(dictionaryEnvelope);
  const reconciliations = semanticData(reconciliationEnvelope);
  normalizeStructureTargetIdentity(sourceModel, structure);

  const confidence = {
    api: plan.data.confidence?.api ?? 'high',
    structure: plan.data.confidence?.structure ?? 'high',
    color: plan.data.confidence?.color ?? 'high',
    voice: plan.data.confidence?.voice ?? 'high',
  };
  const coverageEnvelopes: Record<EvidenceDomain, JsonObject> = {
    api: apiEnvelope,
    structure: structureEnvelope,
    color: colorEnvelope,
    voice: voiceEnvelope,
  };
  const obligationCoverage = Object.fromEntries(
    (Object.keys(coverageEnvelopes) as EvidenceDomain[]).map((domain) => [
      domain,
      coverageFor(coverageEnvelopes[domain]),
    ]),
  ) as CanonicalComponentContract['provenance']['obligationCoverage'];

  const contract: CanonicalComponentContract = {
    $schema: 'https://uspec.design/schemas/component-contract-1.0.json',
    schemaVersion: '1.0',
    generatedAt: plan._meta.generatedAt,
    component: {
      slug,
      name: api.componentName ?? manifest.summaries.componentName,
    },
    source: {
      fileKey: manifest.source.fileKey,
      nodeId: manifest.source.nodeId,
      figmaUrl: manifest.source.figmaUrl,
      extractionSource: manifest.source.extractionSource,
      baseSourceHash: manifest._meta.baseSourceHash,
    },
    summary: {
      overview: plan.data.overviewParagraph.trim(),
      confidence,
    },
    variants: {
      axes: sourceModel.variantAxes ?? [],
      default: sourceModel.defaultVariant ?? null,
    },
    anatomy: {
      defaultTree: sourceModel.defaultTree ?? null,
      composition: sourceModel.childComposition ?? null,
      subcomponents: sourceModel.subComponentVariantWalks ?? null,
    },
    api,
    structure,
    color,
    accessibility,
    dictionary,
    reconciliations,
    sourceModel,
    provenance: {
      preparedAt: manifest._meta.preparedAt,
      obligationCoverage,
    },
  };

  const validation = validateCanonicalContract(contract);
  if (!validation.ok) {
    throw new Error(
      `Canonical contract validation failed:\n${validation.errors
        .map((error) => `  ${error.instancePath || '(root)'} — ${error.message}`)
        .join('\n')}`,
    );
  }

  const outputPath =
    opts.outputPath ??
    manifest.paths.contractPath ??
    join(cachePath, `${slug}-contract.json`);
  const serialized = JSON.stringify(sorted(contract), null, 2) + '\n';
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialized, 'utf8');

  return {
    contract,
    outputPath,
    bytes: Buffer.byteLength(serialized),
    cacheValidations,
  };
}
