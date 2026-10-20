import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './module.mjs';

const {
  IMPORT_SERVICES,
  IMPORT_SERVICE_MONOGRAMS,
  importServiceForMethod,
  importMethodFileFormat,
  visibleImportServices,
} = await loadModule('views/player-import-services');

test('every supported upload belongs to a named service with a deliberate parser', () => {
  const methods = IMPORT_SERVICES.flatMap((service) => service.methods);
  assert.deepEqual(
    Array.from(IMPORT_SERVICES, (service) => service.id),
    [
      'kamaitachi',
      'diving-fish',
      'lxns',
      'maishift',
      'session-report',
      'tomomai',
      'mai-tools',
      'dxrating',
      'jietng',
      'aqua',
    ],
  );
  assert.equal(new Set(methods.map((method) => method.value)).size, 12);
  for (const service of IMPORT_SERVICES)
    assert.match(IMPORT_SERVICE_MONOGRAMS[service.id], /^[A-Z]{1,2}$/);
  assert.deepEqual(
    Array.from(
      methods.filter((method) => method.fileFormat).map((method) => method.fileFormat),
    ).sort(),
    ['aqua', 'dxrating', 'jietng', 'mai-tools', 'portable', 'tachi', 'tomomai'],
  );
  for (const service of IMPORT_SERVICES)
    for (const method of service.methods) {
      assert.equal(importServiceForMethod(method.value).id, service.id);
      assert.equal(importMethodFileFormat(method.value), method.fileFormat ?? null);
    }
});

test('OAuth services stay connection only while Kamaitachi groups its interchange upload', () => {
  const values = (id) =>
    Array.from(
      IMPORT_SERVICES.find((service) => service.id === id).methods,
      (method) => method.value,
    );
  assert.deepEqual(values('kamaitachi'), ['kamaitachi', 'file:tachi']);
  assert.deepEqual(values('diving-fish'), ['diving-fish']);
  assert.deepEqual(values('lxns'), ['lxns']);
  assert.deepEqual(values('session-report'), ['file', 'report']);
  assert.deepEqual(values('maishift'), ['maishift']);
  assert.equal(importServiceForMethod('file').title, 'maimai.party Session Report');
  assert.equal(importServiceForMethod('kamaitachi').methods[0].label, 'Import by username');
  assert.equal(importServiceForMethod('file:tachi').id, 'kamaitachi');
  for (const unsupported of ['invented', 'file:diving-fish', 'file:lxns'])
    assert.throws(() => importServiceForMethod(unsupported), /Unknown player import method/);
});

test('visibility filters both methods and empty service boxes without changing their identity', () => {
  assert.deepEqual(Array.from(visibleImportServices({})), []);
  const services = visibleImportServices({ 'file:tachi': true, 'file:tomomai': true, file: false });
  assert.deepEqual(
    Array.from(services, (service) => service.id),
    ['kamaitachi', 'tomomai'],
  );
  assert.deepEqual(
    Array.from(services[0].methods, (method) => method.value),
    ['file:tachi'],
  );
  assert.equal(importServiceForMethod('kamaitachi').methods.length, 2);
});
