import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recoveryTarget } from '../src/runtime/recovery.ts';
import { publicPath } from '../src/runtime/public-routes.ts';
const path = '/en/songs/fixture/';
const fixture = (target = path) => ({
  markers: [{ version: 'static-v1', path: target, inHead: true }],
  mainCount: 1,
  scriptCount: 0,
  templateCount: 0,
  browserEntryCount: 0,
  resourceDescriptorCount: 0,
});

function rejected(facts, ...route) {
  const requestedPath = route.length ? route[0] : path;
  const kind = route.length > 1 ? route[1] : 'song';
  assert.throws(() => recoveryTarget(facts, requestedPath, kind));
}

test('unmarked documents use normal navigation; detached marker facts are required', () => {
  assert.equal(recoveryTarget({ markers: [] }, path, 'song'), null);
  assert.equal(recoveryTarget({ ...fixture(), markers: [], scriptCount: 3 }, path, 'song'), null);
  for (const facts of [undefined, null, [], 'static-v1', 1, {}, { markers: null }, { markers: {} }])
    rejected(facts);
});

test('every public language and route kind accepts exactly its canonical static document', () => {
  for (const locale of ['en', 'ja', 'ko', 'zh-hans'])
    for (const [routeKind, pageKind] of [
      ['songs', 'song'],
      ['versions', 'version'],
    ]) {
      const canonical = publicPath(locale, routeKind, 'fixture');
      const facts = fixture(canonical);
      assert.equal(recoveryTarget(facts, canonical, pageKind), canonical);
      assert.deepEqual(facts, fixture(canonical), 'the decision cannot mutate detached input');
    }
});

test('Unicode and reserved punctuation retain their canonical identity; request hex case is immaterial', () => {
  for (const slug of ['青空', '별빛', 'é', 'e\u0301', '星と光', "song !'()*", '100%']) {
    const canonical = publicPath('ja', 'songs', slug);
    const lowercase = canonical.replace(/%[0-9A-F]{2}/g, (value) => value.toLowerCase());
    assert.equal(recoveryTarget(fixture(canonical), canonical, 'song'), canonical);
    assert.equal(recoveryTarget(fixture(canonical), lowercase, 'song'), canonical);
  }
  const composed = publicPath('en', 'songs', 'é');
  const decomposed = publicPath('en', 'songs', 'e\u0301');
  assert.notEqual(composed, decomposed);
  rejected(fixture(composed), decomposed);
  rejected(fixture('/ja/songs/%e9%9d%92%e7%a9%ba/'), '/ja/songs/%E9%9D%92%E7%A9%BA/');
});

test('a marker is singular, in the head, exact-versioned and bound to one matching main', () => {
  for (const markers of [
    [fixture().markers[0], fixture().markers[0]],
    [null],
    [[]],
    ['static-v1'],
    [{}],
    [{ ...fixture().markers[0], inHead: false }],
    [{ ...fixture().markers[0], inHead: 'true' }],
    [{ ...fixture().markers[0], version: 'static-v2' }],
    [{ ...fixture().markers[0], version: null }],
    [{ ...fixture().markers[0], version: ' STATIC-V1 ' }],
    [{ ...fixture().markers[0], path: '/en/songs/another/' }],
    [{ ...fixture().markers[0], path: undefined }],
  ])
    rejected({ ...fixture(), markers });
  for (const mainCount of [0, 2, '1', undefined]) rejected({ ...fixture(), mainCount });
  for (const kind of [undefined, null, 'version', 'songs', 'Song']) rejected(fixture(), path, kind);
  rejected(fixture('/en/versions/fixture/'), '/en/versions/fixture/', 'song');
});

test('recovery never activates a document with scripts, templates or application resources', () => {
  for (const key of [
    'scriptCount',
    'templateCount',
    'browserEntryCount',
    'resourceDescriptorCount',
  ])
    for (const count of [1, 2, -1, '0', undefined, null, Number.NaN])
      rejected({ ...fixture(), [key]: count });
});

test('requested recovery paths reject authorities, queries, fragments, controls and route aliases', () => {
  for (const requestedPath of [
    undefined,
    null,
    7,
    'https://maimai.party/en/songs/fixture/',
    'https://other.invalid/en/songs/fixture/',
    '//other.invalid/en/songs/fixture/',
    '/en/songs/fixture/?view=compare',
    '/en/songs/fixture/#chart-1',
    '/en/songs/fi\\xture/',
    '/en/songs/fi xture/',
    '/en/songs/fi\nxture/',
    '/en/songs/fi\u007fxture/',
    '/en/songs/%00/',
    '/en/songs/%09/',
    '/en/songs/%7F/',
    '/en/songs/%2F/',
    '/en/songs/%5C/',
    '/en/songs/%3F/',
    '/en/songs/%23/',
    '/en/songs/%66ixture/',
    '/en/songs/./',
    '/en/songs/../',
    '/en/songs/%2e/',
    '/en/songs/%2E%2e/',
    '/en/songs/%/',
    '/en/songs/%ZZ/',
    '/en/songs/%C0%AF/',
    '/en/songs/青空/',
    '/en//songs/fixture/',
    '/en/songs/fixture',
    '/en/songs/fixture//',
    '/en/songs/a/b/',
    '/EN/songs/fixture/',
    '/jp/songs/fixture/',
    '/fr/songs/fixture/',
    '/en/charts/fixture/',
    '/',
  ])
    rejected(fixture(typeof requestedPath === 'string' ? requestedPath : path), requestedPath);
});

test('marker destinations cannot choose another authority, route, locale, query, or fragment', () => {
  for (const destination of [
    'https://maimai.party' + path,
    'https://other.invalid' + path,
    '//other.invalid' + path,
    '/ja/songs/fixture/',
    '/en/versions/fixture/',
    '/en/songs/other/',
    path + '?x=1',
    path + '#chart-fixture',
    '/en/songs/%66ixture/',
    path.slice(1),
    null,
    7,
  ])
    rejected(fixture(destination));
});
