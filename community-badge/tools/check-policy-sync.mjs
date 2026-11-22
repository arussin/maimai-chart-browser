// Release guard: compare the actual policy bytes with the dashboard feed's source.
// No imports/evaluation of the other Worker, credentials or network access.
import {readFile, realpath, readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const source = process.argv[2];
assert.ok(source, 'Pass the canonical Tidbyt traffic-worker directory');
const sourceReal=await realpath(source);
const badgeReal=await realpath(fileURLToPath(new URL('../',import.meta.url)));
assert.notEqual(sourceReal,badgeReal,'Dashboard source must not be the badge directory');
assert.ok(!(await readdir(sourceReal)).some(name=>name.toLowerCase()==='render.mjs'),
  'Dashboard source must not be a copied badge workspace (render.mjs present)');
for (const name of ['traffic-policy.mjs', 'traffic-networks.mjs']) {
  assert.deepEqual(await readFile(resolve(badgeReal,name)),
    await readFile(resolve(sourceReal, name)), name + ' differs from the dashboard policy; synchronize before publishing either Worker');
}
console.log('Both traffic policies match the dashboard feed byte-for-byte.');
