#!/usr/bin/env node
/**
 * Validates a plugin-produced _base.json against the schema documented in
 * docs/base-json-schema.md.
 *
 * Used in two places:
 *   - By the create-component-md orchestrator at Step 1 (pre-flight gate).
 *   - Standalone via `node scripts/validate-base.mjs path/to/_base.json`.
 *
 * This is a pragmatic structural check — not a literal conversion of the JSONC doc. It covers
 * every invariant the interpretation skills rely on so a malformed dump is caught before it
 * burns any tokens downstream.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Ajv from 'ajv';

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
            // Variant root entry: always an object with name/type/visible/dimensions.
            type: 'object',
            required: ['name', 'type', 'visible', 'dimensions'],
          },
        },
      },
    },
    crossVariant: {
      anyOf: [{ type: 'null' }, { type: 'object' }],
    },
    slotHostGeometry: {
      anyOf: [{ type: 'null' }, { type: 'object' }],
    },
    ownershipHints: { type: 'array' },
    subComponentVariantWalks: {
      // Optional — absent on legacy _base.json files produced before Phase I shipped.
      // When present, it's a map keyed by subCompSetId whose entries describe a
      // constitutive child's variant cross-product walk.
      type: 'object',
      additionalProperties: {
        type: 'object',
        required: ['name', 'subCompSetId', 'axes', 'variants'],
        properties: {
          name: { type: 'string', minLength: 1 },
          subCompSetId: { type: 'string', minLength: 1 },
          subCompSetName: { type: ['string', 'null'] },
          axes: {
            type: 'object',
            additionalProperties: { type: 'array', items: { type: 'string' } },
          },
          variants: {
            type: 'array',
            items: {
              type: 'object',
              required: ['variantKey', 'variantProperties', 'dimensions', 'treeHierarchical'],
              properties: {
                variantKey: { type: 'string', minLength: 1 },
                variantProperties: { type: 'object' },
                dimensions: { type: 'object' },
                treeHierarchical: {
                  type: 'object',
                  required: ['name', 'type', 'visible', 'dimensions'],
                },
              },
            },
          },
          skipped: { type: 'boolean' },
          skippedReason: { type: 'string' },
        },
      },
    },
    _childComposition: {
      type: 'object',
      required: ['children', 'ambiguousChildren', 'guessConfidence'],
      properties: {
        children: {
          type: 'array',
          items: {
            type: 'object',
            required: [
              'name',
              'nodeType',
              'topLevelInstanceId',
              'classification',
              'classificationReason',
              'classificationEvidence',
            ],
            properties: {
              classification: { enum: ['constitutive', 'referenced', 'decorative', null] },
              classificationEvidence: { type: 'array', items: { type: 'string' } },
            },
          },
        },
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

export function validateBase(data) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const ok = validate(data);
  return { ok, errors: validate.errors || [] };
}

export async function validateBaseFile(filePath) {
  const raw = await readFile(filePath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, errors: [{ message: `Invalid JSON: ${err.message}` }] };
  }
  return validateBase(parsed);
}

// CLI entrypoint.
if (import.meta.url === `file://${process.argv[1]}`) {
  const target = process.argv[2];
  if (!target) {
    console.error('usage: validate-base.mjs <path/to/_base.json>');
    process.exit(2);
  }
  const abs = path.resolve(target);
  const result = await validateBaseFile(abs);
  if (result.ok) {
    console.log(`OK  ${abs}`);
    process.exit(0);
  } else {
    console.error(`FAIL  ${abs}`);
    for (const e of result.errors) {
      console.error(`  ${e.instancePath || '(root)'} — ${e.message}`);
    }
    process.exit(1);
  }
}
