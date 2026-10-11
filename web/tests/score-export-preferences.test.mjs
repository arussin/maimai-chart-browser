import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createScoreExportPreferences,
  scoreExportPreferencesKey,
} from '../src/runtime/score-export-preferences.ts';
import { knownScoreExportVersionIDs, versionChoices } from '../src/domain/score-export.ts';
import {
  defaultScoreExportPartner,
  scoreExportPartners,
} from '../src/views/score-export-partners.ts';

const versionIDs = knownScoreExportVersionIDs();
const partnerKeys = [
  defaultScoreExportPartner,
  ...scoreExportPartners.map((partner) => partner.key),
];
const empty = { versionID: null, partnerKey: 'none' };
function memory(initial = null) {
  let value = initial;
  const writes = [];
  return {
    writes,
    getItem(key) {
      assert.equal(key, scoreExportPreferencesKey);
      return value;
    },
    setItem(key, next) {
      assert.equal(key, scoreExportPreferencesKey);
      value = next;
      writes.push(next);
    },
    replace(next) {
      value = next;
    },
  };
}
const preferences = (storage) =>
  createScoreExportPreferences({ versionIDs, partnerKeys, storage: () => storage });

test('persistable release choices match the domain list and exclude custom report pools', () => {
  const choices = versionChoices({
    snapshots: {
      latest: { capturedAt: 1, phase: 'after', complete: true, versions: ['Custom pool'], pbs: {} },
    },
  });
  assert.deepEqual(
    versionIDs.toSorted(),
    choices
      .filter((choice) => choice.id !== 'snapshot')
      .map((choice) => choice.id)
      .toSorted(),
  );
  assert.equal(new Set(versionIDs).size, versionIDs.length);
  assert.equal(versionIDs.includes('snapshot'), false);
  assert.equal(partnerKeys[0], 'none');
  assert.equal(new Set(partnerKeys).size, partnerKeys.length);
});

test('reading preferences never persists detected/default values', () => {
  const storage = memory(),
    first = preferences(storage);
  assert.deepEqual(first.read(), empty);
  const copy = first.read();
  copy.partnerKey = 'kanadera-magical';
  assert.deepEqual(first.read(), empty);
  assert.deepEqual(storage.writes, []);
});

test('manual version and partner choices survive a new exporter session and preserve each other', () => {
  const storage = memory(),
    first = preferences(storage);
  first.setVersion('prismplus');
  first.setPartner('kanadera-magical');
  const restored = preferences(storage);
  assert.deepEqual(restored.read(), { versionID: 'prismplus', partnerKey: 'kanadera-magical' });
  restored.setVersion('circleplus');
  restored.setPartner('none');
  assert.deepEqual(preferences(storage).read(), { versionID: 'circleplus', partnerKey: 'none' });
  assert.deepEqual(JSON.parse(storage.writes.at(-1)), {
    schemaVersion: 1,
    versionID: 'circleplus',
    partnerKey: 'none',
  });
});

test('malformed data and unsupported schemas restore safe defaults', () => {
  for (const raw of [
    '{',
    'null',
    '[]',
    'true',
    '"prismplus"',
    '{}',
    'x'.repeat(2049),
    JSON.stringify({ schemaVersion: 2, versionID: 'prismplus', partnerKey: 'kanadera-magical' }),
  ]) {
    const storage = memory(raw);
    assert.deepEqual(preferences(storage).read(), empty, raw.slice(0, 80));
    assert.deepEqual(storage.writes, []);
  }
});

test('schema validation permits only stable release IDs and verified partner keys', () => {
  for (const versionID of ['snapshot', 'PRiSM PLUS', 'private player name', {}, 1, null]) {
    const storage = memory(JSON.stringify({ schemaVersion: 1, versionID, partnerKey: 'none' }));
    assert.deepEqual(preferences(storage).read(), empty);
  }
  const storage = memory(
    JSON.stringify({
      schemaVersion: 1,
      versionID: 'magical',
      partnerKey: 'https://private.example/partner',
      playerName: 'PRIVATE_NAME',
      records: { private: true },
    }),
  );
  const saved = preferences(storage);
  assert.deepEqual(saved.read(), { versionID: 'magical', partnerKey: 'none' });
  saved.setPartner('derakkuma-magical');
  const raw = storage.writes.at(-1);
  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), [
    'partnerKey',
    'schemaVersion',
    'versionID',
  ]);
  assert.doesNotMatch(raw, /PRIVATE_NAME|records|private\.example/);
});

test('selecting a report-specific version clears a previous saved stable release', () => {
  const storage = memory(),
    saved = preferences(storage);
  saved.setVersion('prismplus');
  saved.setPartner('kanadera-magical');
  saved.setVersion('snapshot');
  assert.deepEqual(preferences(storage).read(), {
    versionID: null,
    partnerKey: 'kanadera-magical',
  });
  saved.setPartner('unknown imported character');
  assert.deepEqual(preferences(storage).read(), empty);
  assert.doesNotMatch(storage.writes.join(''), /snapshot|unknown imported character/);
});

test('denied storage getters and reads retain manual choices in memory', () => {
  for (const storage of [
    () => {
      throw Error('Storage denied');
    },
    () => ({
      getItem() {
        throw Error('Read denied');
      },
      setItem() {
        throw Error('Write denied');
      },
    }),
  ]) {
    const saved = createScoreExportPreferences({ versionIDs, partnerKeys, storage });
    saved.setVersion('circle');
    saved.setPartner('derakkuma-magical');
    assert.deepEqual(saved.read(), { versionID: 'circle', partnerKey: 'derakkuma-magical' });
    assert.deepEqual(saved.read(), { versionID: 'circle', partnerKey: 'derakkuma-magical' });
  }
});

test('failed writes do not let older stored values replace this session choice', () => {
  const storage = memory(
    JSON.stringify({ schemaVersion: 1, versionID: 'prismplus', partnerKey: 'none' }),
  );
  const write = storage.setItem;
  storage.setItem = () => {
    throw Error('Quota exceeded');
  };
  const saved = preferences(storage);
  saved.setVersion('circleplus');
  saved.setPartner('kanadera-magical');
  assert.deepEqual(saved.read(), { versionID: 'circleplus', partnerKey: 'kanadera-magical' });
  storage.setItem = write;
  saved.setPartner('none');
  assert.deepEqual(preferences(storage).read(), { versionID: 'circleplus', partnerKey: 'none' });
});

test('successful storage reads pick up another page choice between exports', () => {
  const storage = memory(),
    first = preferences(storage),
    second = preferences(storage);
  assert.deepEqual(first.read(), empty);
  second.setVersion('magical');
  second.setPartner('kanadera-magical');
  assert.deepEqual(first.read(), { versionID: 'magical', partnerKey: 'kanadera-magical' });
  storage.replace('{');
  assert.deepEqual(first.read(), empty);
  second.setVersion('circleplus');
  assert.deepEqual(first.read(), { versionID: 'circleplus', partnerKey: 'none' });
  storage.replace(null);
  assert.deepEqual(first.read(), empty);
});
