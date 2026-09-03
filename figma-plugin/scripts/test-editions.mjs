import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const editions = JSON.parse(await readFile(path.join(root, 'editions.json'), 'utf8'));

assert.equal(editions.internal.requireFileLink, false);
assert.equal(editions.external.requireFileLink, true);
assert.match(editions.internal.name, /\[Internal\]$/);
assert.doesNotMatch(editions.external.name, /\[Internal\]/);
assert.ok(editions.external.id, 'public Community plugin id belongs in committed editions.json');
assert.equal(editions.internal.id, undefined, 'organization plugin id must not be committed');

console.log('editions tests: committed config has no organization plugin id');
console.log('OK');
