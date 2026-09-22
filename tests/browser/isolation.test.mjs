import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {chromium, firefox, webkit} from '@playwright/test';
import {launchIsolated, startIsolationProxy, isolatedTest} from './isolation.mjs';

for (const [name, engine] of Object.entries({chromium, firefox, webkit, ...(process.env.MAIMAI_ISOLATION_BRANDED === "1" ? {chrome:chromium,edge:chromium} : {})})) {
  test(`${name}: popup, iframe, beacon, redirect and route escape cannot leave fixture origins`, async () => {
    let forbiddenHits = 0;
    const forbidden = http.createServer((_req, res) => { forbiddenHits++; res.end('must never arrive'); });
    await new Promise(resolve => forbidden.listen(0, '127.0.0.1', resolve));
    const server = http.createServer((req, res) => {
      if (req.url === '/local-redirect') {res.writeHead(302, {Location:'/'}).end(); return;}
      if (req.url === '/redirect') {res.writeHead(302, {Location:'https://redirect.example.invalid/'}).end(); return;}
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><title>Synthetic isolation fixture</title><button>Fixture</button>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const blockedOrigin = `http://127.0.0.1:${forbidden.address().port}`;
    const run = await launchIsolated(engine, {origins:[origin],launch:name==="chrome"?{channel:"chrome"}:name==="edge"?{channel:"msedge"}:{}});
    try {
      const page = await run.context.newPage();
      await page.goto(origin);
      assert.equal(await page.title(), 'Synthetic isolation fixture');
      await page.route('**/remapped', async route => {
        const response = await route.fetch({url:origin});
        await route.fulfill({response});
      });
      await page.goto(origin+'/remapped');
      assert.equal(await page.title(), 'Synthetic isolation fixture', 'Allowed APIRequestContext CONNECT works');
      await page.route('**/fetch-redirect', async route => {
        await assert.rejects(route.fetch({url:origin+'/redirect'}), /denied non-loopback/);
        await route.fulfill({body:'explicit blocked redirect'});
      });
      await page.goto(origin+'/fetch-redirect');
      assert.ok(run.unexpected.some(item=>item.kind==='route-fetch-redirect'));
      await assert.rejects(run.context.request.get(origin+'/redirect'), /denied non-loopback/);
      assert.ok(run.unexpected.some(item=>item.kind==='api-get-redirect'));
      await page.goto(origin);
      run.synthetic('https://synthetic.example.invalid');
      await run.context.route('https://synthetic.example.invalid/', route => route.fulfill({contentType:'text/html',body:'<title>Explicit synthetic origin</title>'}));
      const synthetic = await run.context.newPage();
      await synthetic.goto('https://synthetic.example.invalid/');
      assert.equal(await synthetic.title(), 'Explicit synthetic origin');
      await synthetic.route('**/fetch-escape', async route => {
        await assert.rejects(route.fetch(), /denied non-loopback/);
        await route.fulfill({body:'caught by the fixture'});
      });
      await synthetic.goto('https://synthetic.example.invalid/fetch-escape');
      assert.ok(run.unexpected.some(item=>item.kind==='route-fetch'), 'Caught fetch escapes remain fatal in the ledger');
      await synthetic.route('**/synthetic-escape', route => route.continue());
      await synthetic.goto('https://synthetic.example.invalid/synthetic-escape').catch(() => {});
      assert.ok(run.unexpected.some(item=>item.kind==='route-continue'), 'Declared origins cannot hide a route escape');
      await synthetic.close();
      await page.evaluate(() => {
        window.open('https://popup.example.invalid/', '_blank');
        const frame = document.createElement('iframe'); frame.src = 'https://iframe.example.invalid/'; document.body.append(frame);
        navigator.sendBeacon('https://beacon.example.invalid/', 'synthetic-only');
        // A maintenance-looking hostname is still forbidden when the app uses it.
        fetch('https://accounts.google.com/fixture-probe').catch(() => {});
        navigator.sendBeacon('https://aus5.mozilla.org/fixture-probe', 'synthetic-only');
        const ws = new WebSocket('wss://clients2.google.com/fixture-probe'); ws.onerror=()=>{};
      });
      // Deliberately bypass context routing: the network proxy must still deny both.
      await page.route('**/escape', route => route.continue());
      await page.evaluate(async blocked => {
        await Promise.all([
          fetch('https://escape.example.invalid/escape').catch(() => {}),
          fetch(blocked+'/escape').catch(() => {}),
        ]);
      }, blockedOrigin);
      const beforeBrowserRedirect=run.unexpected.length;
      await page.goto(origin+'/redirect').catch(() => {});
      for(let attempt=0;attempt<80&&!run.unexpected.slice(beforeBrowserRedirect).some(item=>item.target.includes('redirect.example.invalid'));attempt++)await new Promise(resolve=>setTimeout(resolve,25));
      assert.ok(run.unexpected.slice(beforeBrowserRedirect).some(item=>item.target.includes('redirect.example.invalid')), 'Browser redirects are attributed through routing or request events');
      assert.equal((await run.context.request.get(origin+'/local-redirect')).status(),200,'Explicit loopback GET redirects remain functional');
      const fixtures=isolatedTest({extend:value=>value},{origins:[origin]});
      await fixtures.context({context:run.context,baseURL:origin+'/configured-prefix/'},async context=>{
        assert.equal((await context.request.get('artwork.webp')).url(),origin+'/configured-prefix/artwork.webp','Default fixture API uses the configured base URL, not the current page');
        assert.equal((await context.request.get('/local-redirect')).status(),200);
        await assert.rejects(context.request.get('//accounts.google.com/escape'),/denied non-loopback/);
      });
      for (let attempt=0; attempt<80 && !["popup.example.invalid","iframe.example.invalid","beacon.example.invalid","redirect.example.invalid","escape.example.invalid","accounts.google.com","aus5.mozilla.org","clients2.google.com"].every(label=>run.unexpected.some(item=>item.target.includes(label))); attempt++) await new Promise(resolve => setTimeout(resolve,25));
      const targets = run.unexpected.map(item => item.target).join(' ');
      for (const label of ['popup.example.invalid','iframe.example.invalid','beacon.example.invalid','redirect.example.invalid','escape.example.invalid','accounts.google.com','aus5.mozilla.org','clients2.google.com']) assert.ok(targets.includes(label), `${name}: missing ${label}: ${targets}`);
      await assert.rejects(run.context.request.get('https://accounts.google.com/api-probe'), /denied non-loopback/);
      assert.ok(run.unexpected.some(item=>item.kind==='api-get'), 'Direct context API escapes stay fatal');
      assert.equal(forbiddenHits, 0, 'Even non-allowlisted loopback traffic must be blocked');
      assert.ok(run.unexpected.some(item => item.kind === 'route-continue'), 'Explicit route escapes were audited');
    } finally {
      await run.close(); server.closeAllConnections(); forbidden.closeAllConnections();
      await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => forbidden.close(resolve))]);
    }
  });
}

test('proxy denies raw HTTP/CONNECT escapes and retains deny-only synthetic transport ownership', async () => {
  let hits=0;
  const forbidden=http.createServer((_request,response)=>{hits++;response.end();});
  await new Promise(resolve=>forbidden.listen(0,'127.0.0.1',resolve));
  const proxy=await startIsolationProxy({origins:[]});
  const endpoint=new URL(proxy.server);
  async function request(method,path){
    return new Promise((resolve,reject)=>{
      const req=http.request({hostname:endpoint.hostname,port:endpoint.port,method,path});
      req.on('response',response=>{response.resume();response.on('end',()=>resolve(response.statusCode));});
      req.on('connect',(response,socket)=>{socket.destroy();resolve(response.statusCode);});
      req.on('error',reject);req.end();
    });
  }
  try {
    assert.equal(await request('GET',`http://127.0.0.1:${forbidden.address().port}/`),403);
    assert.equal(await request('CONNECT',`127.0.0.1:${forbidden.address().port}`),403);
    const release=proxy.declareSynthetic('https://synthetic.example.invalid');release();
    assert.equal(await request('CONNECT','synthetic.example.invalid:443'),403);
    assert.equal(proxy.unexpected.length,2);
    assert.equal(proxy.blockedTransports.length,3);
    assert.equal(hits,0);
  } finally {
    await proxy.close();forbidden.closeAllConnections();await new Promise(resolve=>forbidden.close(resolve));
  }
});

test('context-attributed proxy retains denied maintenance transports without granting access', async () => {
  const proxy=await startIsolationProxy({origins:[],contextRouting:true});
  const endpoint=new URL(proxy.server);
  try {
    const status=await new Promise((resolve,reject)=>{
      const request=http.request({hostname:endpoint.hostname,port:endpoint.port,method:'CONNECT',path:'accounts.google.com:443'});
      request.on('connect',(response,socket)=>{socket.destroy();resolve(response.statusCode);});
      request.on('error',reject);request.end();
    });
    assert.equal(status,403);
    assert.equal(proxy.unexpected.length,0);
    assert.deepEqual(proxy.blockedTransports,[{kind:'CONNECT',target:'accounts.google.com:443',attribution:'unattributed-browser-transport'}]);
  } finally { await proxy.close(); }
});