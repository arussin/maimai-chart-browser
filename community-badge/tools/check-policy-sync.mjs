// Release guard: compare the actual policy bytes with the dashboard feed's source.
// No imports/evaluation of the other Worker, credentials or network access.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

const source = process.argv[2];
assert.ok(source, 'Pass the canonical Tidbyt traffic-worker directory');
for (const name of ['traffic-policy.mjs', 'traffic-networks.mjs']) {
  assert.deepEqual(await readFile(new URL('../' + name, import.meta.url)),
    await readFile(resolve(source, name)), name + ' differs from the dashboard policy; synchronize before publishing either Worker');
}
console.log('Both traffic policies match the dashboard feed byte-for-byte.');
