import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './module.mjs';

const {
  IMPORT_SERVICES,
  IMPORT_SERVICE_MONOGRAMS,
  importServiceForMethod,
  importMethodFileFormat,
} = await loadModule('views/player-import-services');

test('the small launch exposes five services and exactly six deliberate import methods', () => {
  const methods = IMPORT_SERVICES.flatMap((service) => service.methods);
  assert.deepEqual(
    Array.from(IMPORT_SERVICES, (service) => service.id),
    ['kamaitachi', 'diving-fish', 'lxns', 'maishift', 'session-report'],
  );
  assert.equal(new Set(methods.map((method) => method.value)).size, 6);
  for (const service of IMPORT_SERVICES)
    assert.match(IMPORT_SERVICE_MONOGRAMS[service.id], /^[A-Z]{1,2}$/);
  assert.deepEqual(
    Array.from(
      methods.filter((method) => method.fileFormat).map((method) => method.fileFormat),
    ).sort(),
    ['portable'],
  );
  for (const service of IMPORT_SERVICES)
    for (const method of service.methods) {
      assert.equal(importServiceForMethod(method.value).id, service.id);
      assert.equal(importMethodFileFormat(method.value), method.fileFormat ?? null);
    }
});

test('only Session Report accepts a file; Fish has no manual fallback and Kamaitachi is a username lookup', () => {
  const values = (id) =>
    Array.from(
      IMPORT_SERVICES.find((service) => service.id === id).methods,
      (method) => method.value,
    );
  assert.deepEqual(values('kamaitachi'), ['kamaitachi']);
  assert.deepEqual(values('diving-fish'), ['diving-fish']);
  assert.deepEqual(values('lxns'), ['lxns']);
  assert.deepEqual(values('session-report'), ['file', 'report']);
  assert.deepEqual(values('maishift'), ['maishift']);
  assert.equal(importServiceForMethod('file').title, 'maimai.party Session Report');
  assert.equal(importServiceForMethod('kamaitachi').methods[0].label, 'Import by username');
  for (const unsupported of [
    'invented',
    'file:diving-fish',
    'file:lxns',
    'file:tachi',
    'file:tomomai',
    'file:aqua',
    'file:jietng',
    'file:dxrating',
    'file:mai-tools',
  ])
    assert.throws(() => importServiceForMethod(unsupported), /Unknown player import method/);
});
