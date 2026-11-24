import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './module.mjs';
const { importErrorMessage } = await loadModule('runtime/import-error-message');
const tag = Symbol.for('maimai.party.diagnostic-error-v1');
const error = (reason, stage) => ({
  [tag]: { reason, stage },
  message: 'private-player https://secret.test/ record[14].score',
});
test('practical import failures give fixed causes and next steps without provider data', () => {
  for (const [reason, stage, context, expected] of [
    ['profile_unavailable', 'response', 'source', /Check the profile name/],
    ['rate_limited', 'response', 'source', /Wait a few minutes/],
    ['authorization_failed', 'authorization', 'source', /Start Connect again/],
    ['contract_field', 'response', 'source', /format Party cannot read safely/],
    ['malformed_response', 'decode', 'file', /not recognised/],
    ['record_identity', 'normalize', 'file', /Export it again/],
    ['normalization', 'normalize', 'file', /Export it again/],
  ]) {
    const message = importErrorMessage(error(reason, stage), context);
    assert.match(message, expected);
    for (const value of ['private-player', 'https:', 'record[14]', reason, stage])
      if (value.length > 8) assert(!message.includes(value));
  }
  assert.match(importErrorMessage(error('unknown', 'read'), 'file'), /Export it again/);
});
