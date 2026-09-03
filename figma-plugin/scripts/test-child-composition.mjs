import assert from 'node:assert/strict';
import { build } from 'esbuild';

globalThis.figma = { mixed: Symbol('mixed') };

async function importBundled(relativePath) {
  const bundled = await build({
    entryPoints: [new URL(relativePath, import.meta.url).pathname],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(
    bundled.outputFiles[0].text,
  ).toString('base64')}`;
  return import(moduleUrl);
}

const { buildFirstGuess } = await importBundled('../src/childComposition.ts');

const instance = (id, name, setId, enabled) => ({
  id,
  name,
  type: 'INSTANCE',
  mainComponentName: name,
  parentSetName: name,
  subCompSetId: setId,
  booleanOverrides: { enabled },
  componentProperties: {
    enabled: { type: 'BOOLEAN', value: enabled },
  },
  subCompVariantAxes: {},
  children: [{ id: `${id}:child`, name: 'vector', type: 'VECTOR' }],
});

const variants = [
  {
    id: 'variant:default',
    name: 'type=forward',
    treeHierarchical: {
      id: 'variant:default',
      name: 'forward',
      type: 'COMPONENT',
      children: [instance('node:right:1', 'chevron right', 'set:right', true)],
    },
  },
  {
    id: 'variant:disclosure',
    name: 'type=disclosure',
    treeHierarchical: {
      id: 'variant:disclosure',
      name: 'disclosure',
      type: 'COMPONENT',
      children: [instance('node:down:1', 'chevron down', 'set:down', true)],
    },
  },
  {
    id: 'variant:count',
    name: 'type=count-forward',
    treeHierarchical: {
      id: 'variant:count',
      name: 'count-forward',
      type: 'COMPONENT',
      children: [
        { id: 'node:label', name: 'count label', type: 'TEXT', children: [] },
        {
          id: 'node:icon-frame',
          name: 'icon frame',
          type: 'FRAME',
          children: [instance('node:right:2', 'chevron right', 'set:right', false)],
        },
      ],
    },
  },
];

const composition = buildFirstGuess(
  'micro button',
  variants,
  'variant:default',
  { instanceSwaps: [] },
);
const entries = [...composition.children, ...composition.ambiguousChildren];
const instanceEntries = entries.filter((entry) => entry.nodeType === 'INSTANCE');

assert.equal(instanceEntries.length, 2, 'deduplicates component identities across variants');
const right = instanceEntries.find((entry) => entry.subCompSetId === 'set:right');
const down = instanceEntries.find((entry) => entry.subCompSetId === 'set:down');
assert.deepEqual(right.presentInVariants, ['type=forward', 'type=count-forward']);
assert.equal(right.defaultVariantPresent, true);
assert.equal(right.placementCount, 2);
assert.equal(right.placementsVary, true);
assert.deepEqual(right.placementsByVariant['type=count-forward'].nodeIds, ['node:right:2']);
assert.deepEqual(down.presentInVariants, ['type=disclosure']);
assert.equal(down.defaultVariantPresent, false);
assert.equal(down.topLevelInstanceId, 'component:set:down');

const { walkRevealedTree } = await importBundled('../src/phaseG.ts');
const revealed = await walkRevealedTree({
  id: 'revealed:root',
  name: 'revealed root',
  type: 'INSTANCE',
  visible: true,
  getMainComponentAsync: async () => null,
  children: [
    {
      id: 'revealed:frame',
      name: 'content',
      type: 'FRAME',
      visible: true,
      children: [instance('revealed:child', 'nested component', 'set:nested', true)],
    },
  ],
});
assert.equal(revealed.children.length, 1, 'walks the revealed root instance children');
assert.equal(revealed.children[0].children[0].id, 'revealed:child');
assert.equal(
  revealed.children[0].children[0].children,
  undefined,
  'stops at nested instance boundaries',
);

console.log('child composition cross-variant test passed');
