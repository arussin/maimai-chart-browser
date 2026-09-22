import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadModule} from './module.mjs';
const player=await loadModule('player-session',{DOMException}),catalog=await loadModule('catalog-query');
test('policy_exact joins only the matching format/difficulty; provider evidence remains distinct',()=>{
  const data={catalog:[{chart_id:'c',source_hash:'h',format:'DX',difficulty:'MASTER'}],provider_mapping:{schema_version:'provider-mapping-2',charts:{a:{chart_id:'c',format:'DX',difficulty:'MASTER',acceptance_basis:'policy_exact'},b:{chart_id:'c',format:'STD',difficulty:'MASTER',acceptance_basis:'policy_exact'}}}};
  assert.equal(JSON.stringify(player.providerIndex(data).kamaitachi.get('c')),'["a"]');
  data.maishift_mapping={schema_version:'maishift-mapping-1',provider:'maishift',game:'maimaidx',charts:{'maishift:intl:1':{chart_id:'c',acceptance_basis:'policy_exact',expected_source:{title:'x',artist:'a',format:'DX',difficulty:'MASTER'}}}};
  assert.equal(player.providerIndex(data).maishift.size,0);
});
test('regional projection cannot modify canonical title or navigation',()=>{
  const original={catalog:[{chart_id:'c',title:'JP',artist:'a',regional:{INTL:{metadata:{title:'International'},level:'14'}}}],navigation:{charts:{c:{genre:'original',regional_metrics:{bpm:{INTL:180}}}},genres:[]}};
  const view=catalog.createView(original),projection=catalog.regionalValues(view.catalog[0],view.navigation.charts.c,true);
  Object.assign(view.catalog[0],projection.fields);Object.assign(view.navigation.charts.c,projection.navigation);
  assert.equal(original.catalog[0].title,'JP');assert.equal(original.navigation.charts.c.bpm,undefined);assert.equal(view.catalog[0].title,'International');
  assert.equal(catalog.titleLabel({title:'　',title_state:'intentional_blank'},'en'),'Untitled (intentional)');
});


test('regional titles carry their own display state and restore canonical blank proof',()=>{
  const original={chart_id:'blank',title:'　',artist:'a',title_state:'intentional_blank',regional:{INTL:{metadata:{title:'Regional title'}}}};
  const projection=catalog.regionalValues(original,{},true);
  assert.equal(catalog.titleLabel(projection.fields),'Regional title');
  assert.equal(catalog.regionalValues(original,{},false).fields.title_state,'intentional_blank');
  const unproven={...original,title:'Named',title_state:'present',regional:{INTL:{metadata:{title:'　'}}}};
  assert.equal(catalog.titleLabel(catalog.regionalValues(unproven,{},true).fields),'Title unavailable');
});
