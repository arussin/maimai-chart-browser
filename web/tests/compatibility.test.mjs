import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {moduleSource} from './module.mjs';

const source = await moduleSource('compat/support-client');
test('standalone support consumes the supplied disabled configuration', () => {
  const config = {enabled:false, origin:'https://maimai.party', publishableKey:'pk_test_fixture', project:'maimai-party'};
  const context = vm.createContext({module:{exports:{}}, maimaiSupportConfig:config,
    location:new URL('https://maimai.party/support.html')});
  vm.runInContext(source, context);
  assert.equal(context.maimaiSupportClient.config, config);
  assert.equal(context.maimaiSupportClient.config.enabled, false);
});
