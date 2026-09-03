import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EvidenceDisposition, EvidenceObligation } from './types.js';

export const CACHE_DOMAINS = [
  'api',
  'api-dictionary',
  'structure',
  'color',
  'voice',
  'reconciliations',
] as const;

export type CacheDomain = (typeof CACHE_DOMAINS)[number];

export interface CacheValidationResult {
  domain: CacheDomain;
  path: string;
  ok: boolean;
  normalized: number;
  bytes: number;
  errors: string[];
}

type JsonObject = Record<string, any>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeDeltaRecords(document: JsonObject): number {
  const records = document?.data?._deltaExtractions;
  if (!Array.isArray(records)) return 0;
  const fallbackTimestamp =
    document?._meta?.extractedAt ??
    document?._meta?.generatedAt ??
    '1970-01-01T00:00:00.000Z';
  let changed = 0;

  for (const record of records) {
    if (!isObject(record)) continue;
    if (!('script' in record)) {
      record.script = record.unavailable ? null : '';
      changed++;
    }
    if (!('byteCount' in record)) {
      record.byteCount = 0;
      changed++;
    }
    if (!('timestamp' in record)) {
      record.timestamp = fallbackTimestamp;
      changed++;
    }
  }
  return changed;
}

function validateDeltaRecords(document: JsonObject, errors: string[]): void {
  const records = document?.data?._deltaExtractions;
  if (!Array.isArray(records)) {
    errors.push('data._deltaExtractions must be an array');
    return;
  }
  records.forEach((record: unknown, index: number) => {
    if (!isObject(record)) {
      errors.push(`data._deltaExtractions[${index}] must be an object`);
      return;
    }
    if (typeof record.purpose !== 'string' || !record.purpose.trim()) {
      errors.push(`data._deltaExtractions[${index}].purpose must be a non-empty string`);
    }
    const unavailable = typeof record.unavailable === 'string' && record.unavailable.length > 0;
    if (unavailable) {
      if (record.script !== null && typeof record.script !== 'string') {
        errors.push(
          `data._deltaExtractions[${index}].script must be null or string when unavailable`,
        );
      }
    } else if (typeof record.script !== 'string' || !record.script.trim()) {
      errors.push(`data._deltaExtractions[${index}].script must describe the executed script`);
    }
    if (typeof record.byteCount !== 'number' || record.byteCount < 0) {
      errors.push(`data._deltaExtractions[${index}].byteCount must be a non-negative number`);
    }
    if (typeof record.timestamp !== 'string' || Number.isNaN(Date.parse(record.timestamp))) {
      errors.push(`data._deltaExtractions[${index}].timestamp must be ISO 8601`);
    }
  });
}

function validateDomain(document: JsonObject, domain: CacheDomain, errors: string[]): void {
  const data = document.data;
  if (!isObject(data)) return;

  if (domain === 'api') {
    if (typeof data.componentName !== 'string') errors.push('data.componentName is required');
    if (!Array.isArray(data?.mainTable?.properties)) {
      errors.push('data.mainTable.properties must be an array');
    }
    if (!Array.isArray(data.configurationExamples)) {
      errors.push('data.configurationExamples must be an array');
    } else {
      if (data.configurationExamples.length < 1 || data.configurationExamples.length > 4) {
        errors.push('data.configurationExamples must contain 1–4 examples');
      }
      data.configurationExamples.forEach((example: any, index: number) => {
        if (typeof example.title !== 'string' || !Array.isArray(example.properties)) {
          errors.push(
            `data.configurationExamples[${index}] requires title and properties[]`,
          );
        }
        for (const forbidden of ['name', 'description', 'code']) {
          if (forbidden in example) {
            errors.push(
              `data.configurationExamples[${index}].${forbidden} is not part of the contract`,
            );
          }
        }
      });
    }
  } else if (domain === 'api-dictionary') {
    if (typeof data.componentName !== 'string') errors.push('data.componentName is required');
    for (const field of ['axes', 'booleanProps', 'states', 'slots']) {
      if (!Array.isArray(data[field])) errors.push(`data.${field} must be an array`);
    }
    if (
      data.referencedComponents !== undefined &&
      !Array.isArray(data.referencedComponents)
    ) {
      errors.push('data.referencedComponents must be an array when present');
    }
  } else if (domain === 'structure') {
    if (!Array.isArray(data.sections)) {
      errors.push('data.sections must be an array');
    } else {
      data.sections.forEach((section: any, sectionIndex: number) => {
        if (!Array.isArray(section.columns)) {
          errors.push(`data.sections[${sectionIndex}].columns must be an array`);
        }
        if (!Array.isArray(section.rows)) {
          errors.push(`data.sections[${sectionIndex}].rows must be an array`);
          return;
        }
        section.rows.forEach((row: any, rowIndex: number) => {
          if (typeof row.provenance !== 'string') {
            errors.push(
              `data.sections[${sectionIndex}].rows[${rowIndex}].provenance is required`,
            );
          }
          if (!Array.isArray(row.values)) {
            errors.push(`data.sections[${sectionIndex}].rows[${rowIndex}].values must be an array`);
        } else if (
          Array.isArray(section.columns) &&
          row.values.length !== Math.max(0, section.columns.length - 2)
        ) {
          errors.push(
            `data.sections[${sectionIndex}].rows[${rowIndex}].values length must equal columns - 2`,
          );
        }
        if (
          row.provenance === 'not-measured' &&
          (!Array.isArray(row.values) || row.values.some((value: unknown) => value !== '—'))
        ) {
          errors.push(
            `data.sections[${sectionIndex}].rows[${rowIndex}] not-measured values must all be —`,
          );
          }
        });
      });
    }
    if (!isObject(data?._extractionArtifacts?.coverageMatrix)) {
      errors.push('data._extractionArtifacts.coverageMatrix is required');
    } else if (data._extractionArtifacts.coverageMatrix.complete !== true) {
      errors.push('data._extractionArtifacts.coverageMatrix.complete must be true');
    }
  } else if (domain === 'color') {
    const strategy = data?._extractionArtifacts?.strategy ?? data.renderingStrategy;
    if (strategy !== 'A' && strategy !== 'B') {
      errors.push('color rendering strategy must be A or B');
    }
    if (
      data.renderingStrategy &&
      data?._extractionArtifacts?.strategy &&
      data.renderingStrategy !== data._extractionArtifacts.strategy
    ) {
      errors.push('data.renderingStrategy and _extractionArtifacts.strategy must agree');
    }
    if (strategy === 'A' && !Array.isArray(data.variants)) {
      errors.push('data.variants must be an array for Strategy A');
    } else if (strategy === 'A') {
      data.variants.forEach((variant: any, variantIndex: number) => {
        (variant.tables ?? []).forEach((table: any, tableIndex: number) => {
          if (
            Array.isArray(table.elementHexes) &&
            table.elementHexes.length !== (table.elements?.length ?? 0)
          ) {
            errors.push(
              `data.variants[${variantIndex}].tables[${tableIndex}].elementHexes must match elements length`,
            );
          }
        });
      });
    }
    if (strategy === 'B' && !Array.isArray(data.sections)) {
      errors.push('data.sections must be an array for Strategy B');
    } else if (strategy === 'B') {
      data.sections.forEach((section: any, sectionIndex: number) => {
        (section.tables ?? []).forEach((table: any, tableIndex: number) => {
          if (
            Array.isArray(table.elementHexesByState) &&
            table.elementHexesByState.length !== (table.elements?.length ?? 0)
          ) {
            errors.push(
              `data.sections[${sectionIndex}].tables[${tableIndex}].elementHexesByState must match elements length`,
            );
          }
        });
      });
    }
  } else if (domain === 'voice') {
    if (!Array.isArray(data.states) || data.states.length === 0) {
      errors.push('data.states must be a non-empty array');
    } else {
      data.states.forEach((state: any, index: number) => {
        if (!Array.isArray(state.sections) || state.sections.length !== 3) {
          errors.push(`data.states[${index}].sections must contain exactly 3 platforms`);
        } else {
          const titles = state.sections.map((section: any) => section.title).sort();
          const expected = ['ARIA (Web)', 'TalkBack (Android)', 'VoiceOver (iOS)'];
          if (JSON.stringify(titles) !== JSON.stringify(expected)) {
            errors.push(
              `data.states[${index}].sections must contain VoiceOver, TalkBack, and ARIA exactly once`,
            );
          }
        }
        for (const section of state.sections ?? []) {
          for (const table of section.tables ?? []) {
            if (typeof table.focusOrderIndex !== 'number') {
              errors.push(
                `data.states[${index}] focus-stop tables require numeric focusOrderIndex`,
              );
            }
            if (!('layerName' in table)) {
              errors.push(`data.states[${index}] focus-stop tables require layerName key`);
            }
          }
        }
      });
    }
  } else if (domain === 'reconciliations') {
    for (const field of ['autoReconciled', 'retries', 'unresolved', 'reviewedBenign']) {
      if (!Array.isArray(data[field])) errors.push(`data.${field} must be an array`);
    }
  }
}

function resolveJsonPointer(document: JsonObject, pointer: string): unknown {
  if (pointer === '') return document;
  if (!pointer.startsWith('/')) return undefined;
  let current: unknown = document;
  for (const rawSegment of pointer.slice(1).split('/')) {
    const segment = rawSegment.replaceAll('~1', '/').replaceAll('~0', '~');
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/u.test(segment)) return undefined;
      current = current[Number(segment)];
    } else if (isObject(current)) {
      current = current[segment];
    } else {
      return undefined;
    }
    if (current === undefined) return undefined;
  }
  return current;
}

function semanticRecordPointers(document: JsonObject, domain: CacheDomain): string[] {
  const data = document.data ?? {};
  const pointers: string[] = [];
  if (domain === 'api') {
    (data.mainTable?.properties ?? []).forEach((_: unknown, index: number) =>
      pointers.push(`/data/mainTable/properties/${index}`),
    );
    (data.subComponentTables ?? []).forEach((table: JsonObject, tableIndex: number) =>
      (table.properties ?? []).forEach((_: unknown, propertyIndex: number) =>
        pointers.push(`/data/subComponentTables/${tableIndex}/properties/${propertyIndex}`),
      ),
    );
  } else if (domain === 'structure') {
    (data.sections ?? []).forEach((section: JsonObject, sectionIndex: number) =>
      (section.rows ?? []).forEach((_: unknown, rowIndex: number) =>
        pointers.push(`/data/sections/${sectionIndex}/rows/${rowIndex}`),
      ),
    );
  } else if (domain === 'color') {
    const strategy = data?._extractionArtifacts?.strategy ?? data.renderingStrategy;
    const groups = strategy === 'A' ? data.variants ?? [] : data.sections ?? [];
    const groupName = strategy === 'A' ? 'variants' : 'sections';
    groups.forEach((group: JsonObject, groupIndex: number) =>
      (group.tables ?? []).forEach((table: JsonObject, tableIndex: number) =>
        (table.elements ?? []).forEach((_: unknown, elementIndex: number) =>
          pointers.push(
            `/data/${groupName}/${groupIndex}/tables/${tableIndex}/elements/${elementIndex}`,
          ),
        ),
      ),
    );
  } else if (domain === 'voice') {
    (data.states ?? []).forEach((state: JsonObject, stateIndex: number) =>
      (state.sections ?? []).forEach((section: JsonObject, sectionIndex: number) =>
        (section.tables ?? []).forEach((table: JsonObject, tableIndex: number) => {
          const tablePath =
            `/data/states/${stateIndex}/sections/${sectionIndex}/tables/${tableIndex}`;
          pointers.push(tablePath);
          (table.properties ?? []).forEach((_: unknown, propertyIndex: number) =>
            pointers.push(`${tablePath}/properties/${propertyIndex}`),
          );
        }),
      ),
    );
  }
  return pointers;
}

function normalizedSemanticValue(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '');
}

function targetKindMatches(pointer: string, kind: NonNullable<EvidenceObligation['representation']>['targetKind']): boolean {
  const patterns = {
    'api-property': /^\/data\/(?:mainTable|subComponentTables\/\d+)\/properties\/\d+$/u,
    'structure-row': /^\/data\/sections\/\d+\/rows\/\d+$/u,
    'color-element': /^\/data\/(?:variants|sections)\/\d+\/tables\/\d+\/elements\/\d+$/u,
    'voice-record': /^\/data\/states\/\d+\/sections\/\d+\/tables\/\d+(?:\/properties\/\d+)?$/u,
  };
  return patterns[kind].test(pointer);
}

function validateRepresentationTarget(
  obligation: EvidenceObligation,
  pointer: string,
  target: unknown,
  errors: string[],
): void {
  const requirement = obligation.representation;
  if (!requirement) return;
  if (!targetKindMatches(pointer, requirement.targetKind)) {
    errors.push(
      `obligation ${obligation.id} target ${pointer} must be a ${requirement.targetKind}`,
    );
    return;
  }
  if (requirement.pathPrefix && !pointer.startsWith(requirement.pathPrefix)) {
    errors.push(
      `obligation ${obligation.id} target ${pointer} must start with ${requirement.pathPrefix}`,
    );
  }
  if (!requirement.field) return;
  const fieldValue = isObject(target) ? target[requirement.field] : undefined;
  if (fieldValue === undefined) {
    errors.push(
      `obligation ${obligation.id} target ${pointer} requires field ${requirement.field}`,
    );
    return;
  }
  if (
    requirement.equals !== undefined &&
    normalizedSemanticValue(fieldValue) !== normalizedSemanticValue(requirement.equals)
  ) {
    errors.push(
      `obligation ${obligation.id} target ${pointer}.${requirement.field} must equal ${requirement.equals}`,
    );
  }
  if (
    requirement.oneOf &&
    !requirement.oneOf.some(
      (expected) =>
        normalizedSemanticValue(fieldValue) === normalizedSemanticValue(expected),
    )
  ) {
    errors.push(
      `obligation ${obligation.id} target ${pointer}.${requirement.field} must be one of [${requirement.oneOf.join(', ')}]`,
    );
  }
  if (requirement.pattern) {
    try {
      if (!new RegExp(requirement.pattern, 'u').test(String(fieldValue))) {
        errors.push(
          `obligation ${obligation.id} target ${pointer}.${requirement.field} must match /${requirement.pattern}/`,
        );
      }
    } catch {
      errors.push(`obligation ${obligation.id} has invalid representation pattern`);
    }
  }
  if (requirement.arrayField && requirement.arrayEquals) {
    const actual = isObject(target) ? target[requirement.arrayField] : undefined;
    if (
      !Array.isArray(actual) ||
      actual.length !== requirement.arrayEquals.length ||
      actual.some(
        (value, index) =>
          normalizedSemanticValue(value) !==
          normalizedSemanticValue(requirement.arrayEquals?.[index]),
      )
    ) {
      errors.push(
        `obligation ${obligation.id} target ${pointer}.${requirement.arrayField} must equal [${requirement.arrayEquals.join(', ')}]`,
      );
    }
  }
}

function validateObligationCoverage(
  document: JsonObject,
  domain: CacheDomain,
  obligations: EvidenceObligation[],
  errors: string[],
): void {
  if (!['api', 'structure', 'color', 'voice'].includes(domain)) return;
  if (obligations.length === 0) {
    errors.push('evidence obligations must be a non-empty array');
    return;
  }
  const obligationIds = new Set<string>();
  obligations.forEach((entry, index) => {
    if (!entry || typeof entry.id !== 'string' || !entry.id) {
      errors.push(`evidence obligations[${index}].id is required`);
      return;
    }
    if (obligationIds.has(entry.id)) {
      errors.push(`evidence obligation ${entry.id} is duplicated`);
    }
    obligationIds.add(entry.id);
    if (entry.domain !== domain) {
      errors.push(`evidence obligation ${entry.id} domain must be ${domain}`);
    }
    if (!['must-emit', 'account'].includes(entry.policy)) {
      errors.push(`evidence obligation ${entry.id} has invalid policy`);
    }
    if (!Array.isArray(entry.sourcePaths) || entry.sourcePaths.length === 0) {
      errors.push(`evidence obligation ${entry.id} requires sourcePaths`);
    }
    if (!isObject(entry.facts)) {
      errors.push(`evidence obligation ${entry.id} requires facts`);
    }
    if (entry.representation && !isObject(entry.representation)) {
      errors.push(`evidence obligation ${entry.id} representation must be an object`);
    }
  });
  const rawLedger = document?.data?._extractionArtifacts?.obligationLedger;
  if (!Array.isArray(rawLedger)) {
    errors.push('data._extractionArtifacts.obligationLedger is required');
    return;
  }

  const known = new Map(obligations.map((entry) => [entry.id, entry]));
  const seen = new Set<string>();
  const supportedTargets = new Set<string>();
  rawLedger.forEach((raw: unknown, index: number) => {
    if (!isObject(raw)) {
      errors.push(`obligationLedger[${index}] must be an object`);
      return;
    }
    const entry = raw as EvidenceDisposition;
    if (typeof entry.obligationId !== 'string' || !entry.obligationId) {
      errors.push(`obligationLedger[${index}].obligationId is required`);
      return;
    }
    const obligation = known.get(entry.obligationId);
    if (!obligation) {
      errors.push(`obligationLedger[${index}] references unknown obligation ${entry.obligationId}`);
      return;
    }
    if (seen.has(entry.obligationId)) {
      errors.push(`obligation ${entry.obligationId} has more than one disposition`);
      return;
    }
    seen.add(entry.obligationId);
    if (!['emitted', 'merged', 'omitted', 'unresolved'].includes(entry.disposition)) {
      errors.push(`obligation ${entry.obligationId} has invalid disposition`);
      return;
    }
    if (!Array.isArray(entry.targets)) {
      errors.push(`obligation ${entry.obligationId}.targets must be an array`);
      return;
    }
    if (typeof entry.reason !== 'string') {
      errors.push(`obligation ${entry.obligationId}.reason must be a string`);
    }
    if (
      ['merged', 'omitted', 'unresolved'].includes(entry.disposition) &&
      (typeof entry.reason !== 'string' || !entry.reason.trim())
    ) {
      errors.push(`obligation ${entry.obligationId} requires a reason`);
    }
    if (entry.disposition === 'unresolved') {
      errors.push(`obligation ${entry.obligationId} is unresolved`);
    }
    if (obligation.policy === 'must-emit' && entry.disposition === 'omitted') {
      errors.push(`must-emit obligation ${entry.obligationId} cannot be omitted`);
    }
    if (
      obligation.representation?.allowMerge === false &&
      entry.disposition === 'merged'
    ) {
      errors.push(`obligation ${entry.obligationId} may not use merged disposition`);
    }
    if (['emitted', 'merged'].includes(entry.disposition) && entry.targets.length === 0) {
      errors.push(`obligation ${entry.obligationId} requires at least one output target`);
    }
    for (const target of entry.targets) {
      const resolved =
        typeof target === 'string' ? resolveJsonPointer(document, target) : undefined;
      if (typeof target !== 'string' || resolved === undefined) {
        errors.push(`obligation ${entry.obligationId} has unresolved output target ${String(target)}`);
      } else {
        supportedTargets.add(target);
        validateRepresentationTarget(obligation, target, resolved, errors);
      }
    }
  });

  for (const obligation of obligations) {
    if (!seen.has(obligation.id)) {
      errors.push(`evidence obligation ${obligation.id} is unaccounted`);
    }
  }
  for (const pointer of semanticRecordPointers(document, domain)) {
    if (!supportedTargets.has(pointer)) {
      errors.push(`semantic output ${pointer} has no evidence obligation`);
    }
  }
}

async function validateEvidenceObligations(
  document: JsonObject,
  domain: CacheDomain,
  cachePath: string,
  slug: string,
  errors: string[],
): Promise<void> {
  if (!['api', 'structure', 'color', 'voice'].includes(domain)) return;
  const evidencePath = join(cachePath, `${slug}-evidence-${domain}.json`);
  let evidence: JsonObject;
  try {
    evidence = JSON.parse(await readFile(evidencePath, 'utf8')) as JsonObject;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    errors.push(`could not read evidence obligations: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const obligations = evidence?.data?.obligations;
  if (!Array.isArray(obligations)) {
    errors.push(`${evidencePath} data.obligations must be an array`);
    return;
  }
  validateObligationCoverage(
    document,
    domain,
    obligations as EvidenceObligation[],
    errors,
  );
}

export async function validateCacheFile(opts: {
  cachePath: string;
  slug: string;
  domain: CacheDomain;
  normalize?: boolean;
}): Promise<CacheValidationResult> {
  const suffix = opts.domain;
  const path = join(opts.cachePath, `${opts.slug}-${suffix}.json`);
  const errors: string[] = [];
  let document: JsonObject;
  let raw: string;

  try {
    raw = await readFile(path, 'utf8');
    document = JSON.parse(raw) as JsonObject;
  } catch (error) {
    return {
      domain: opts.domain,
      path,
      ok: false,
      normalized: 0,
      bytes: 0,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }

  if (!isObject(document._meta)) errors.push('_meta block is required');
  else {
    if (typeof document._meta.schemaVersion !== 'string') {
      errors.push('_meta.schemaVersion is required');
    }
    const timestamp = document._meta.extractedAt ?? document._meta.generatedAt;
    if (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) {
      errors.push('_meta.extractedAt or _meta.generatedAt must be ISO 8601');
    }
    if (opts.domain !== 'reconciliations') {
      for (const field of ['fileKey', 'nodeId', 'componentSlug']) {
        if (typeof document._meta[field] !== 'string' || !document._meta[field]) {
          errors.push(`_meta.${field} is required`);
        }
      }
    }
  }
  if (!isObject(document.data)) errors.push('data block is required');

  let normalized = 0;
  if (opts.domain !== 'api-dictionary' && opts.domain !== 'reconciliations') {
    normalized = normalizeDeltaRecords(document);
    validateDeltaRecords(document, errors);
  }
  validateDomain(document, opts.domain, errors);
  await validateEvidenceObligations(document, opts.domain, opts.cachePath, opts.slug, errors);

  if (opts.normalize && normalized > 0 && errors.length === 0) {
    await writeFile(path, JSON.stringify(document, null, 2) + '\n', 'utf8');
  }

  const serialized = normalized > 0 && opts.normalize ? JSON.stringify(document, null, 2) + '\n' : raw;
  return {
    domain: opts.domain,
    path,
    ok: errors.length === 0,
    normalized,
    bytes: Buffer.byteLength(serialized),
    errors,
  };
}

export async function validateCaches(opts: {
  cachePath: string;
  slug: string;
  domains?: CacheDomain[];
  normalize?: boolean;
}): Promise<CacheValidationResult[]> {
  const domains = opts.domains ?? [...CACHE_DOMAINS];
  const results = await Promise.all(
    domains.map((domain) =>
      validateCacheFile({
        cachePath: opts.cachePath,
        slug: opts.slug,
        domain,
        normalize: opts.normalize,
      }),
    ),
  );

  if (
    domains.includes('structure') &&
    domains.includes('color') &&
    domains.includes('voice') &&
    results.every((result) => result.ok)
  ) {
    const documents = Object.fromEntries(
      await Promise.all(
        (['structure', 'color', 'voice'] as const).map(async (domain) => [
          domain,
          JSON.parse(
            await readFile(join(opts.cachePath, `${opts.slug}-${domain}.json`), 'utf8'),
          ) as JsonObject,
        ]),
      ),
    ) as Record<'structure' | 'color' | 'voice', JsonObject>;
    const axisNames = (document: JsonObject): string[] => {
      const axes = document.data?._extractionArtifacts?.variantAxes;
      return (Array.isArray(axes)
        ? axes.map((axis: JsonObject) => axis.name)
        : Object.keys(axes ?? {})
      ).sort();
    };
    const sets = {
      structure: axisNames(documents.structure),
      color: axisNames(documents.color),
      voice: axisNames(documents.voice),
    };
    if (
      JSON.stringify(sets.structure) !== JSON.stringify(sets.color) ||
      JSON.stringify(sets.color) !== JSON.stringify(sets.voice)
    ) {
      for (const domain of ['structure', 'color', 'voice'] as const) {
        const result = results.find((candidate) => candidate.domain === domain);
        if (result) {
          result.ok = false;
          result.errors.push(
            `variant axes disagree across specialist caches: ` +
              `structure=[${sets.structure}], color=[${sets.color}], voice=[${sets.voice}]`,
          );
        }
      }
    }

    const identities = (['structure', 'color', 'voice'] as const).map((domain) => ({
      domain,
      fileKey: documents[domain]._meta?.fileKey,
      nodeId: documents[domain]._meta?.nodeId,
      componentSlug: documents[domain]._meta?.componentSlug,
    }));
    const identityKey = (identity: (typeof identities)[number]): string =>
      JSON.stringify([identity.fileKey, identity.nodeId, identity.componentSlug]);
    if (new Set(identities.map(identityKey)).size !== 1) {
      for (const identity of identities) {
        const result = results.find((candidate) => candidate.domain === identity.domain);
        if (result) {
          result.ok = false;
          result.errors.push('fileKey, nodeId, or componentSlug disagrees across specialist caches');
        }
      }
    }
  }

  if (
    domains.includes('api') &&
    domains.includes('api-dictionary') &&
    results
      .filter((result) => result.domain === 'api' || result.domain === 'api-dictionary')
      .every((result) => result.ok)
  ) {
    const [api, dictionary] = await Promise.all([
      readFile(join(opts.cachePath, `${opts.slug}-api.json`), 'utf8').then(JSON.parse),
      readFile(join(opts.cachePath, `${opts.slug}-api-dictionary.json`), 'utf8').then(JSON.parse),
    ]);
    if (api.data?.componentName !== dictionary.data?.componentName) {
      for (const domain of ['api', 'api-dictionary'] as const) {
        const result = results.find((candidate) => candidate.domain === domain);
        if (result) {
          result.ok = false;
          result.errors.push('api and api-dictionary componentName must agree');
        }
      }
    }
  }
  return results;
}
