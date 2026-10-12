import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './module.mjs';

const { openProviderPopup, checkKamaitachiInput } = await loadModule('views/player-data');
const { validateRow } = await loadModule('usage-contract');

test('blocked OAuth popups count one finite connection failure before any authorization', () => {
  for (const provider of ['diving-fish', 'lxns']) {
    const calls = [],
      events = [];
    const popup = openProviderPopup(
      {
        open(...args) {
          calls.push(args);
          return null;
        },
      },
      provider,
      (...args) => events.push(args),
    );
    assert.equal(popup, null);
    assert.deepEqual(calls, [['about:blank', '_blank', 'popup,width=600,height=760']]);
    assert.deepEqual(events, [
      ['import_started', provider],
      ['provider_connect_started', provider],
      ['provider_connect_failed', provider, 'popup_blocked'],
      ['import_failed', provider, 'popup_blocked'],
    ]);
    for (const [event, detail, failure = ''] of events)
      assert(validateRow({ event, page: 'charts', detail, failure, count: 1 }));
  }
});

test('an opened OAuth popup leaves lifecycle counting to the coordinator', () => {
  const popup = { privateMarker: 'DO-NOT-LOG' },
    events = [];
  assert.equal(
    openProviderPopup({ open: () => popup }, 'diving-fish', (...args) => events.push(args)),
    popup,
  );
  assert.deepEqual(events, []);
});

test('native-invalid Kamaitachi submission counts one attempt without a provider read', () => {
  const events = [];
  let validations = 0;
  const input = {
    reportValidity() {
      validations++;
      return false;
    },
  };
  assert.equal(
    checkKamaitachiInput(input, (...args) => events.push(args)),
    false,
  );
  assert.equal(validations, 1);
  assert.deepEqual(events, [
    ['import_started', 'kamaitachi'],
    ['import_failed', 'kamaitachi', 'invalid'],
  ]);
  for (const [event, detail, failure = ''] of events)
    assert(validateRow({ event, page: 'charts', detail, failure, count: 1 }));
});

test('native-valid Kamaitachi submission leaves counting and account parsing to the coordinator', () => {
  const events = [];
  assert.equal(
    checkKamaitachiInput({ reportValidity: () => true }, (...args) => events.push(args)),
    true,
  );
  assert.deepEqual(events, []);
});
