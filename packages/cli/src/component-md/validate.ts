/**
 * Validates plugin-produced _base.json. Mirrors figma-plugin/scripts/validate-base.mjs
 * so npm consumers do not depend on the figma-plugin package.
 */
import { readFile } from 'node:fs/promises';
import Ajv, { type ErrorObject } from 'ajv';

const schema = {
  $id: 'uspec-base-json',
  type: 'object',
  required: [
    '_meta',
    'component',
    'variantAxes',
    'defaultVariant',
    'propertyDefinitions',
    'variables',
    'styles',
    'variants',
    'ownershipHints',
    '_childComposition',
    '_extractionNotes',
  ],
  properties: {
    _meta: {
      type: 'object',
      required: ['schemaVersion', 'extractedAt', 'fileKey', 'nodeId', 'componentSlug'],
      properties: {
        schemaVersion: { const: '1' },
        extractedAt: { type: 'string', minLength: 10 },
        fileKey: { type: 'string', minLength: 1 },
        nodeId: { type: 'string', minLength: 1 },
        componentSlug: { type: 'string', minLength: 1 },
        optionalContext: { type: ['string', 'null'] },
        figmaUrl: { type: ['string', 'null'] },
        extractionSource: { enum: ['plugin', 'mcp'] },
        pluginVersion: { type: 'string' },
      },
    },
    component: {
      type: 'object',
      required: ['componentName', 'compSetNodeId', 'isComponentSet'],
      properties: {
        componentName: { type: 'string', minLength: 1 },
        compSetNodeId: { type: 'string', minLength: 1 },
        isComponentSet: { type: 'boolean' },
      },
    },
    variantAxes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'options', 'defaultValue'],
        properties: {
          name: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          defaultValue: { type: 'string' },
        },
      },
    },
    defaultVariant: {
      type: 'object',
      required: ['id', 'name', 'variantProperties'],
      properties: {
        id: { type: 'string', minLength: 1 },
        name: { type: 'string' },
        variantProperties: { type: 'object' },
      },
    },
    propertyDefinitions: {
      type: 'object',
      required: ['rawDefs', 'booleans', 'instanceSwaps', 'slots'],
      properties: {
        rawDefs: { type: 'object' },
        booleans: { type: 'array' },
        instanceSwaps: { type: 'array' },
        slots: { type: 'array' },
      },
    },
    variables: {
      type: 'object',
      required: ['localCollections', 'resolvedVariables'],
    },
    styles: {
      type: 'object',
      required: ['resolvedStyles'],
      properties: { resolvedStyles: { type: 'object' } },
    },
    variants: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: [
          'id',
          'name',
          'variantProperties',
          'dimensions',
          'treeHierarchical',
          'treeFlat',
          'colorWalk',
          'layoutTree',
        ],
        properties: {
          id: { type: 'string', minLength: 1 },
          name: { type: 'string' },
          treeFlat: { type: 'array' },
          colorWalk: { type: 'array' },
          treeHierarchical: {
            type: 'object',
            required: ['name', 'type', 'visible', 'dimensions'],
          },
        },
      },
    },
    crossVariant: { anyOf: [{ type: 'null' }, { type: 'object' }] },
    slotHostGeometry: { anyOf: [{ type: 'null' }, { type: 'object' }] },
    ownershipHints: { type: 'array' },
    subComponentVariantWalks: { type: 'object' },
    _childComposition: {
      type: 'object',
      required: ['children', 'ambiguousChildren', 'guessConfidence'],
      properties: {
        children: { type: 'array' },
        ambiguousChildren: { type: 'array' },
        guessConfidence: { enum: ['high', 'medium', 'low'] },
      },
    },
    _extractionNotes: {
      type: 'object',
      properties: {
        warnings: { type: 'array' },
        mutationsPerformed: { type: 'array' },
      },
    },
  },
};

const ajv = new Ajv({ allErrors: true, strict: false });
const validateCompiled = ajv.compile(schema);

export function validateBase(data: unknown): { ok: boolean; errors: ErrorObject[] } {
  const ok = validateCompiled(data) as boolean;
  return { ok, errors: validateCompiled.errors ?? [] };
}

export async function validateBaseFile(
  filePath: string,
): Promise<{ ok: boolean; errors: Array<{ instancePath?: string; message?: string }> }> {
  const raw = await readFile(filePath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, errors: [{ message: `Invalid JSON: ${message}` }] };
  }
  const result = validateBase(parsed);
  const lineSep = (raw.match(/\u2028/g) || []).length;
  const paraSep = (raw.match(/\u2029/g) || []).length;
  if (lineSep || paraSep) {
    return {
      ok: false,
      errors: [
        ...result.errors,
        {
          instancePath: '(file)',
          message: `contains ${lineSep} literal U+2028 and ${paraSep} literal U+2029 character(s); these must be \\u-escaped`,
        },
      ],
    };
  }
  return result;
}

export function assertBaseJson(data: unknown): asserts data is import('./types.js').BaseJson {
  const result = validateBase(data);
  if (!result.ok) {
    const lines = result.errors.map(
      (e) => `  ${e.instancePath || '(root)'} — ${e.message}`,
    );
    throw new Error(`_base.json validation failed:\n${lines.join('\n')}`);
  }
}
