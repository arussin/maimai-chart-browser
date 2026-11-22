import test from 'node:test';
import assert from 'node:assert/strict';
import {networkExclusions, AUTOMATION_NETWORKS, NETWORK_FILTER_SITES, NETWORK_POLICY} from '../traffic-networks.mjs';

test('network exclusions are exact, unique network numbers', () => {
  const filter = networkExclusions('maimai.party');
  assert.equal(filter.length, AUTOMATION_NETWORKS.length);
  assert.equal(new Set(AUTOMATION_NETWORKS).size, AUTOMATION_NETWORKS.length);
  for (const [index, clause] of filter.entries()) {
    assert.deepEqual(Object.keys(clause), ['clientAsn_neq']);
    assert.equal(clause.clientAsn_neq, AUTOMATION_NETWORKS[index]);
    // Cloudflare's filter takes the number as a string.
    assert.match(clause.clientAsn_neq, /^[1-9][0-9]{0,9}$/);
  }
  assert.ok(AUTOMATION_NETWORKS.includes('132203'));
  assert.match(NETWORK_POLICY, /^synthetic-hosting-networks-excluded-\d{8}$/);
});

test('only zones verified to accept the network field receive it', () => {
  assert.deepEqual([...NETWORK_FILTER_SITES], ['maimai.party']);
  // adamrussin.com is on the Free plan: sending the clause fails its whole query.
  for (const site of ['adamrussin.com', 'traffic.maimai.party', '', undefined])
    assert.deepEqual(networkExclusions(site), []);
});

test('ordinary consumer networks are not excluded', () => {
  // Verizon, Comcast, T-Mobile US, Korea Telecom, NTT, China Telecom, China Mobile.
  for (const asn of ['701', '7922', '21928', '4766', '4713', '4134', '9808'])
    assert.equal(AUTOMATION_NETWORKS.includes(asn), false, asn);
});
