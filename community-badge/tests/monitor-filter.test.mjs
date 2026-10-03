
import {automationExclusions} from '../traffic-policy.mjs';
import test from 'node:test';
const accepts = (f, ua) => f.AND.every(c => c.userAgent_neq !== undefined ? ua !== c.userAgent_neq : !new RegExp('^' + c.userAgent_notlike.split('%').map(RegExp.escape).join('.*') + '$').test(ua));

import assert from 'node:assert/strict';
import {queryBody,monthPeriod,parseAnalytics,validSnapshot} from '../analytics.mjs';
import {handle,cacheKey} from '../handler.mjs';
import {renderBadge} from '../render.mjs';
import assets from '../assets.mjs';
const now=new Date('2026-10-01T23:13:00Z'), period=monthPeriod(now);
const env={CF_ACCOUNT_ID:'a'.repeat(32),CF_ANALYTICS_TOKEN:'fixture-only'};
const native='Mozilla/5.0 (compatible;Cloudflare-Healthchecks/1.0;+https://www.cloudflare.com/; healthcheck-id: 9d3d35aa9299c6ce)';
const local='Adam-Tidbyt-Suite/0.1 (read-only)';
const rows=[
 ['maimai.party','eyeball',native,'US',11000],
 ['maimai.party','eyeball',local,'US',1000],
 ['maimai.party','eyeball','ordinary browser','JP',90],
 ['maimai.party','eyeball','ordinary browser','US',60],
 ['maimai.party','eyeball','OtherBot/1.0','SG',10],
 ['maimai.party','eyeball',native+' altered','CA',9],
 ['other.maimai.party','eyeball','ordinary browser','US',800],
 ['maimai.party','healthcheck','other','US',500],
];
function responseFor(f) {
 const accepted=rows.filter(([host,source,ua])=>host===f.clientRequestHTTPHost && source===f.requestSource && accepts(f,ua));
 const countries=new Map();for(const row of accepted)countries.set(row[3],(countries.get(row[3])||0)+row[4]);
 return {data:{viewer:{accounts:[{total:[{sum:{visits:accepted.reduce((n,r)=>n+r[4],0)},avg:{sampleInterval:1}}],
 regions:[...countries].map(([countryName,visits])=>({dimensions:{countryName},sum:{visits},avg:{sampleInterval:1}}))}]}}};
}
test('automation exclusions retain ordinary visits in both total and country queries',async()=>{
 let calls=0;
 const result=await handle(new Request('https://maimai.party/badges/community.svg'),env,{}, {now,
 cache:{match:async()=>undefined,put:async()=>{}},fetcher:async(_,options)=>{
  calls++;const body=JSON.parse(options.body),f=body.variables.filter;
  assert.deepEqual(f.AND,automationExclusions());
  assert.equal(f.datetime_geq,period.start);assert.equal(f.datetime_lt,period.end);
  assert.equal((body.query.match(/filter: \$filter/g)||[]).length,2);
  const p=responseFor(f), snapshot=parseAnalytics(p,period);
  assert.equal(snapshot.visits,150);
  assert.deepEqual(snapshot.regions,[{country:'JP',visits:90},{country:'US',visits:60}]);
  return Response.json(p);
 }});
 assert.equal(calls,1);assert.equal(result.headers.get('X-Badge-State'),'fresh');
 assert.match(await result.text(),/150 visits, past 30 days/);
});
test('previous monitor-only v4 cache cannot reappear as filtered data even when upstream fails',async()=>{
 const current=parseAnalytics(responseFor(queryBody(env,period).variables.filter),period);
 const previous={...current,version:4,visits:41358};
 assert.equal(validSnapshot(current,now),true);assert.equal(validSnapshot(previous,now),false);
 const oldKey='https://maimai.party/.community-badge-cache/v4/http-visits-30d-known-monitors-excluded/'+env.CF_ACCOUNT_ID+'/maimai.party/'+period.month;
 const key=cacheKey(env,period.month,'https://maimai.party').url;
 assert.notEqual(key,oldKey);
 for(const storedKey of [oldKey,key])for(const offline of [false,true]) {
  const data=new Map([[storedKey,Response.json({snapshot:previous,retryAfter:now.getTime()+3600000})]]);
  const cache={match:async k=>data.get(k.url)?.clone(),put:async(k,v)=>data.set(k.url,v)};
  let calls=0;
  const result=await handle(new Request('https://maimai.party/badges/community.svg?v=2'),env,{}, {now,cache,fetcher:async()=>{calls++;if(offline)throw Error('offline');return Response.json(responseFor(queryBody(env,period).variables.filter));}});
  assert.equal(calls,1);assert.equal(result.headers.get('X-Badge-State'),offline?'unavailable':'fresh');
  assert.doesNotMatch(await result.text(),/41,358/);
 }
});
test('accurate label fits existing headline width with supported glyphs at count extremes',()=>{
 const snapshot=parseAnalytics(responseFor(queryBody(env,period).variables.filter),period);
 for(const visits of [0,169,9999,10000,41358,Number.MAX_SAFE_INTEGER]) {
  const svg=renderBadge({...snapshot,visits},'fresh',assets);
  assert.match(svg,/visits, past 30 days/);assert.doesNotMatch(svg,/visitors this month|monthly visitor/);
  const fit=Number(svg.match(/translate\(950 0\) scale\(([^ ]+) 1\)/)[1]);
  assert.ok(fit>0 && fit<=1);
  const label=' visits, past 30 days';
  assert.ok([...label].every(c=>assets.font.glyphs[c]),'New label must not use fallback glyphs');
  const text=[...svg.matchAll(/<g aria-label="([^"]*)" fill="[^"]+" transform="translate\([^)]*\) scale\(([^ ]+) ([^)]+)\)">/g)].slice(0,3);
  const width=text.reduce((n,g)=>n+[...g[1]].reduce((w,c)=>w+assets.font.glyphs[c].advance,0)*Number(g[2]),0);
  assert.ok(width*fit<=1045.000001);
 }
});
