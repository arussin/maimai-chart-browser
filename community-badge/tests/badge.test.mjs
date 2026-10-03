import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCount, formatExactCount, monthPeriod, queryBody, parseAnalytics, readJsonBounded, validSnapshot } from '../analytics.mjs';
import { handle, cacheKey } from '../handler.mjs';
import { renderBadge } from '../render.mjs';
import assets from '../assets.mjs';

const env = { CF_ACCOUNT_ID: 'a'.repeat(32), CF_ANALYTICS_TOKEN: 'test-only-not-a-real-token' };
const now = new Date('2026-09-20T12:00:00Z');
const period = monthPeriod(now);
function payload(total = 12000) {
  return { data: { viewer: { accounts: [{
    total: [{ sum: { visits: total }, avg: { sampleInterval: 1 } }],
    regions: [['US',9600],['KR',1200],['JP',600],['SG',300],['TW',200],['AU',100]].map(([countryName,visits]) =>
      ({ dimensions: { countryName }, sum: { visits }, avg: { sampleInterval: 1 } })),
  }] } } };
}
class Cache {
  data = new Map();
  async match(key) { return this.data.get(key.url)?.clone(); }
  async put(key, value) { this.data.set(key.url, value.clone()); }
}
const request = (suffix = '', options) => new Request('https://maimai.party/badges/community.svg' + suffix, options);
const fetcher = async () => Response.json(payload());

test('numbers stay exact below 10,000 and compact from 10,000 with unit promotion', () => {
  for (const [input, output] of [[0,'0'],[999,'999'],[1000,'1,000'],[9600,'9,600'],[9999,'9,999'],[10000,'10k'],[12000,'12k'],[12450,'12.5k'],[1200000,'1.2m'],[999950,'1m'],[999949,'999.9k'],[1000000000,'1b'],[Number.MAX_SAFE_INTEGER,'9007.2t']])
    assert.equal(formatCount(input),output);
  assert.equal(formatExactCount(1200000),'1,200,000');
  assert.equal(formatExactCount(Number.MAX_SAFE_INTEGER),'9,007,199,254,740,991');
  for (const n of [-1,NaN,Infinity,1.1,'9600',Number.MAX_SAFE_INTEGER+1]) {
    assert.throws(()=>formatCount(n)); assert.throws(()=>formatExactCount(n));
  }
});

test('rolling window covers exactly 30 days across month, year, leap-year and DST boundaries', () => {
  for (const [end,start] of [
    ['2026-09-20T12:00:00Z','2026-08-21T12:00:00.000Z'],
    ['2028-02-29T23:59:59Z','2028-01-30T23:59:59.000Z'],
    ['2026-01-15T12:00:00Z','2025-12-16T12:00:00.000Z'],
    ['2026-11-01T03:30:00-05:00','2026-10-02T08:30:00.000Z'],
  ]) {
    const window=monthPeriod(new Date(end));
    assert.equal(window.start,start);
    assert.equal(window.end,new Date(end).toISOString());
    assert.equal(Date.parse(window.end)-Date.parse(window.start),30*86400000);
  }
  assert.equal(monthPeriod(new Date('2026-09-30T23:59:59-04:00')).month,'2026-10');
});
test('analytics query uses dashboard visits restricted to the production hostname', () => {
  const body = queryBody(env,period);
  assert.deepEqual(body.variables.filter, {clientRequestHTTPHost:'maimai.party',requestSource:'eyeball',AND:[{userAgent_neq:"Mozilla/5.0 (compatible;Cloudflare-Healthchecks/1.0;+https://www.cloudflare.com/; healthcheck-id: 9d3d35aa9299c6ce)"},{userAgent_neq:"Adam-Tidbyt-Suite/0.1 (read-only)"}],datetime_geq:period.start,datetime_lt:period.end});
  assert.match(body.query,/sum \{ visits \}/);
  assert.match(body.query,/httpRequestsAdaptiveGroups/);
  assert.match(body.query,/countryName: clientCountryName/);
  assert.doesNotMatch(body.query,/rumPageload|siteTag|pageViews|clientIP|userId|uniq/);
});
test('uses independent total and visit metric, not page views or top-five sum', () => {
  const p=payload(); p.data.viewer.accounts[0].total[0].count=999999;
  const result=parseAnalytics(p,period);
  assert.equal(result.visits,12000);
  assert.equal(result.regions.length,5);
  assert.equal(result.regions[0].visits,9600);
});
test('sampled responses keep source estimates and mark them explicitly', () => {
  const p=payload(); p.data.viewer.accounts[0].total[0].avg.sampleInterval=10;
  assert.equal(parseAnalytics(p,period).estimated,true);
});
test('unknown countries are not turned into invented flags; ties deterministic', () => {
  const p=payload(); p.data.viewer.accounts[0].regions=[
    {dimensions:{countryName:'XX'},sum:{visits:99},avg:{sampleInterval:1}},
    ...['KR','JP','US'].map(countryName=>({dimensions:{countryName},sum:{visits:10},avg:{sampleInterval:1}}))];
  assert.deepEqual(parseAnalytics(p,period).regions.map(r=>r.country),['JP','KR','US']);
});
test('upstream errors, missing metrics, invalid counts, and truncated results never become zero', () => {
  for(const value of [null,{}, {errors:[{message:'private upstream detail'}],...payload()}, {data:{viewer:{accounts:[]}}}])
    assert.throws(()=>parseAnalytics(value,period));
  const p=payload(); p.data.viewer.accounts[0].total[0].sum.visits=null;
  assert.throws(()=>parseAnalytics(p,period));
  const large=payload(); large.data.viewer.accounts[0].regions=Array(250).fill(large.data.viewer.accounts[0].regions[0]);
  assert.throws(()=>parseAnalytics(large,period));
});
test('successful empty measurements are zero with no invented regions', () => {
  const p={data:{viewer:{accounts:[{total:[],regions:[]}]}}};
  assert.deepEqual(parseAnalytics(p,period).regions,[]);
  assert.equal(parseAnalytics(p,period).visits,0);
});
test('oversized and invalid JSON responses fail closed', async () => {
  await assert.rejects(readJsonBounded(new Response('x'.repeat(200)),100));
  await assert.rejects(readJsonBounded(new Response('not json')));
  await assert.rejects(readJsonBounded(new Response('{}',{status:403})));
});
test('SVG is self contained, uses library flags, compact display, exact descriptions, and an accurate past-30-day visits label', () => {
  const svg=renderBadge({...parseAnalytics(payload(),period),estimated:true},'fresh',assets);
  assert.match(svg,/12,000 visits/); assert.match(svg,/aria-label="12k"/); assert.match(svg,/9,600 visits/);
  assert.match(svg,/Cloudflare HTTP traffic analytics visits/);
  assert.match(svg,/Rolling past 30 days \(UTC\): 2026-08-21T12:00:00.000Z to 2026-09-20T12:00:00.000Z/);
  assert.match(svg,/May include other automated traffic/);
  assert.doesNotMatch(svg,/known bots excluded|Cloudflare Web Analytics/);
  assert.match(svg,/not unique people or players/); assert.match(svg,/Cloudflare sampled estimates/); assert.match(svg,/Cloudflare analytics - Updated: 2026-09-20 12:00 UTC/); assert.doesNotMatch(svg,/~/);
  assert.doesNotMatch(svg,/<script|<foreignObject|@font-face|href="https?:|onload=|test-only|~/);
  assert.equal((svg.match(/data:image\/png;base64,/g)||[]).length,6);
  assert.ok(Buffer.byteLength(svg)<3000000);
});
test('fresh cache is reused, regardless of caller query strings', async () => {
  const cache=new Cache(); let calls=0;
  const deps={now,cache,fetcher:async()=>{calls++; return fetcher();}};
  const first=await handle(request('?count=999999&country=ZZ'),env,{},deps);
  assert.equal(first.headers.get('X-Badge-State'),'fresh');
  await handle(request('?different=1'),env,{}, {...deps,now:new Date(now.getTime()+1800000)});
  assert.equal(calls,1);
});
test('stale data is labelled and upstream failures are backed off', async () => {
  const cache=new Cache(); await handle(request(),env,{}, {now,cache,fetcher});
  let calls=0; const later=new Date(now.getTime()+7200000);
  const deps={now:later,cache,fetcher:async()=>{calls++; throw new Error('secret details');}};
  const result=await handle(request(),env,{},deps);
  assert.equal(result.headers.get('X-Badge-State'),'stale');
  assert.match(await result.text(),/Cached result/);
  await handle(request(),env,{},deps); assert.equal(calls,1);
});
test('old month and data older than one day are never labelled as this month', async () => {
  for(const future of [new Date('2026-09-21T12:00:01Z'),new Date('2026-10-01T00:00:00Z')]){
    const cache=new Cache(); await handle(request(),env,{}, {now,cache,fetcher});
    const result=await handle(request(),env,{}, {now:future,cache,fetcher:async()=>{throw Error('offline');}});
    assert.equal(result.headers.get('X-Badge-State'),'unavailable');
    assert.doesNotMatch(await result.text(),/12,000 visits/);
  }
});
test('missing credentials and access errors produce a usable unavailable image without leaking errors', async () => {
  for(const settings of [{...env,CF_ANALYTICS_TOKEN:''},env]){
    const result=await handle(request(),settings,{}, {now,cache:new Cache(),fetcher:async()=>new Response('private provider failure',{status:403})});
    assert.equal(result.status,200);
    assert.match(result.headers.get('Content-Type'),/image\/svg\+xml/);
    assert.equal(result.headers.get('X-Badge-State'),'unavailable');
    const svg=await result.text();
    assert.match(svg,/temporarily unavailable/);
    assert.doesNotMatch(svg,/private provider failure|test-only-not-a-real-token|12,000 visits/);
  }
});
test('cache write/read failures do not break a valid live image', async () => {
  const cache={match:async()=>{throw Error('cache offline');},put:async()=>{throw Error('cache offline');}};
  const result=await handle(request(),env,{}, {now,cache,fetcher});
  assert.equal(result.headers.get('X-Badge-State'),'fresh');
});
test('HEAD, ETag, method and route semantics are GitHub image compatible', async () => {
  const deps={now,cache:new Cache(),fetcher};
  const result=await handle(request(),env,{},deps);
  const head=await handle(request('',{method:'HEAD'}),env,{},deps);
  assert.equal(await head.text(),'');
  assert.equal(head.headers.get('ETag'),result.headers.get('ETag'));
  const unchanged=await handle(request('',{headers:{'If-None-Match':'W/'+result.headers.get('ETag')}}),env,{},deps);
  assert.equal(unchanged.status,304);
  assert.equal((await handle(request('',{method:'POST'}),env,{},deps)).status,405);
  assert.equal((await handle(new Request('https://maimai.party/'),env,{},deps)).status,404);
});
test('zero and fewer-than-five states have no fabricated sample flags/counts', () => {
  const p={data:{viewer:{accounts:[{total:[],regions:[]}]}}};
  const svg=renderBadge(parseAnalytics(p,period),'fresh',assets);
  assert.match(svg,/0 visits/);
  assert.equal((svg.match(/data:image\/png;base64,/g)||[]).length,1);
  assert.match(svg,/fewer than five measured regions/);
});



test('switching sources never reuses browser visit totals, even during an outage', async () => {
  const current = parseAnalytics(payload(), period);
  const previous = {...current,version:1,visits:380};
  delete previous.source;
  assert.equal(validSnapshot(current,now),true);
  assert.equal(validSnapshot(previous,now),false);
  assert.equal(validSnapshot({...current,source:'rumPageloadEventsAdaptiveGroups'},now),false);
  const oldKey = new Request('https://maimai.party/.community-badge-cache/v1/' + env.CF_ACCOUNT_ID + '/' + 'b'.repeat(32) + '/' + period.month);
  assert.notEqual(cacheKey(env,period.month,'https://maimai.party').url,oldKey.url);
  for (const offline of [false,true]) {
    const cache = new Cache();
    await cache.put(oldKey,Response.json({snapshot:previous,retryAfter:now.getTime()+3600000}));
    let calls=0;
    const result = await handle(request(),env,{}, {now,cache,fetcher:async () => { calls++; if (offline) throw Error('offline'); return fetcher(); }});
    assert.equal(calls,1);
    assert.equal(result.headers.get('X-Badge-State'),offline ? 'unavailable' : 'fresh');
    const svg = await result.text();
    assert.doesNotMatch(svg,/380 visits/);
    if (!offline) assert.match(svg,/12,000 visits/);
  }
});

test('regional numbers keep proportional glyphs and a consistent font size at large counts', () => {
  const snapshot=parseAnalytics(payload(),period);
  snapshot.regions=[9999,12400,999949,1200000,Number.MAX_SAFE_INTEGER].map((visits,i)=>({country:['US','SG','CA','NL','JP'][i],visits}));
  const svg=renderBadge(snapshot,'fresh',assets);
  const groups=[...svg.matchAll(/<g aria-label="([^"]+)" fill="#[a-f0-9]+" transform="translate\([^)]*\) scale\(([^ ]+) ([^)]+)\)">/g)];
  const scales=snapshot.regions.map(row=>{
    const group=groups.find(match=>match[1]===formatCount(row.visits));
    assert.ok(group,'Displayed regional value missing');
    const sx=Number(group[2]),sy=Number(group[3]);
    assert.ok(Math.abs(sx+sy)<1e-12,'Digits must not be compressed sideways');
    return sx;
  });
  assert.ok(scales.every(scale=>scale===scales[0]),'All region counts use the same font size');
  assert.match(svg,/Japan: 9,007,199,254,740,991 visits/);
});

test('refresh advances both ends of the rolling window after one hour', async () => {
  const cache=new Cache(), filters=[];
  const capture=async (url,options)=>{filters.push(JSON.parse(options.body).variables.filter);return fetcher();};
  await handle(request(),env,{}, {now,cache,fetcher:capture});
  const later=new Date(now.getTime()+3600000);
  const result=await handle(request(),env,{}, {now:later,cache,fetcher:capture});
  assert.equal(result.headers.get('X-Badge-State'),'fresh');
  assert.equal(filters.length,2);
  for(const field of ['datetime_geq','datetime_lt'])
    assert.equal(Date.parse(filters[1][field])-Date.parse(filters[0][field]),3600000);
});

test('rolling snapshots cannot reuse calendar-month totals, including during an outage', async () => {
  const current=parseAnalytics(payload(),period);
  const previous={...current,version:2,start:'2026-09-01T00:00:00.000Z',visits:7494};
  assert.equal(validSnapshot(previous,now),false);
  assert.equal(validSnapshot({...previous,version:3},now),false);
  const oldKey=new Request('https://maimai.party/.community-badge-cache/v2/http-visits/'+env.CF_ACCOUNT_ID+'/maimai.party/'+period.month);
  const key=cacheKey(env,period.month,'https://maimai.party');
  assert.notEqual(key.url,oldKey.url);
  for(const storedKey of [oldKey,key]) {
    const cache=new Cache();
    await cache.put(storedKey,Response.json({snapshot:previous,retryAfter:now.getTime()}));
    const result=await handle(request(),env,{}, {now,cache,fetcher:async()=>{throw Error('offline');}});
    assert.equal(result.headers.get('X-Badge-State'),'unavailable');
    assert.doesNotMatch(await result.text(),/7,494 visits/);
  }
});
