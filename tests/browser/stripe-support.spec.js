import {test, expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {readFile} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(process.env.MAIMAI_BROWSER_OUTPUT || fileURLToPath(new URL('../../output/browser-tests/', import.meta.url)));
const storageKey = 'support.checkout.v2.maimai-party';
const mime = {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml'};
// No Stripe account or hosted site is contacted. This models the SDK lifecycle;
// actual regional method rendering remains a separate owner-run sandbox gate.
const sdk = `window.Stripe = () => ({createEmbeddedCheckoutPage: async options => {
  await options.fetchClientSecret();
  let frame;
  const receive = e => {if(e.origin === 'https://checkout.stripe.com' && e.data === 'fixture-complete') options.onComplete();};
  window.addEventListener('message', receive);
  return {mount: node => {frame=document.createElement('iframe'); frame.title='Stripe checkout fixture';
    frame.src='https://checkout.stripe.com/fixture'; frame.setAttribute('allow','payment');
    frame.style.cssText='width:100%;height:300px;border:0'; node.append(frame);},
    destroy: () => {frame?.remove();window.removeEventListener('message', receive);}};
}});`;
const frameHTML = `<!doctype html><html lang="en"><head><title>Checkout fixture</title></head>
<body><main><h1>Stripe test double</h1><p>No real payment. This is a test fixture, not Stripe's design.</p>
<label>Amount (test fixture only) <input id="amount" value="5.00"></label><p role="status" id="result"></p>
<button id="pay">Complete test payment</button><button id="decline">Decline test payment</button>
<script>document.getElementById('pay').onclick=()=>parent.postMessage('fixture-complete','https://maimai.party');
document.getElementById('decline').onclick=()=>document.getElementById('result').textContent='Your card was declined. Try another payment method.';</script></main></body></html>`;

async function hosted(context, {enabled = true, failScript = false, failCreate = 0, stallInit = false} = {}) {
  const state = {api: [], external: [], sessions: new Map(), status: 'open', failStatus: false};
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname !== 'maimai.party') {
      state.external.push({url: request.url(), body: request.postData() || '', headers: await request.allHeaders()});
      if (url.hostname === 'js.stripe.com') return failScript ? route.abort() :
        route.fulfill({contentType: 'application/javascript', body: stallInit ?
          sdk.replace('let frame;', 'window.__stripeInitWaiting = true; return new Promise(() => {}); let frame;') : sdk});
      if (url.hostname === 'checkout.stripe.com') return route.fulfill({contentType: 'text/html', body: frameHTML});
      return route.fulfill({status: 204, body: ''});
    }
    if (url.pathname.startsWith('/api/support/')) {
      const data = request.postDataJSON();
      state.api.push({path: url.pathname, data, headers: await request.allHeaders(), url: request.url()});
      if (url.pathname.endsWith('/status')) return route.fulfill({status: state.failStatus ? 503 : 200,
        json: state.failStatus ? {error: 'unavailable'} : {status: state.status}});
      // Model Stripe accepting a create even if its response is lost in transit.
      if (!state.sessions.has(data.attempt)) state.sessions.set(data.attempt, {
        session: 'cs_test_' + data.attempt.replaceAll('-', '')});
      const value = state.sessions.get(data.attempt);
      if (failCreate-- > 0) return route.fulfill({status: 502, json: {error: 'unavailable'}});
      return route.fulfill({json: {status: state.status, session: value.session, clientSecret: 'fixture_client_secret'}});
    }
    // Serve the actual allowlisted release, including its stricter return page.
    const path = resolve(root, 'registry', '.' + url.pathname + (url.pathname.endsWith('/') ? 'index.html' : ''));
    if (!path.startsWith(resolve(root, 'registry') + sep)) return route.abort();
    try {
      let bytes = await readFile(path);
      if (url.pathname.endsWith('/support-config.js'))
        bytes = Buffer.from(bytes.toString().replace(/enabled: (?:true|false)/, 'enabled: ' + enabled)
          .replace(/publishableKey: '[^']*'/, "publishableKey: 'pk_test_fixture'"));
      return route.fulfill({contentType: mime[extname(path)] || 'application/octet-stream', body: bytes});
    } catch { return route.fulfill({status: 404, body: 'Missing fixture'}); }
  });
  return state;
}
async function open(page, {keepNotice = false} = {}) {
  if (!keepNotice && await page.locator('#analytics-notice').isVisible())
    await page.locator('#analytics-notice [data-analytics-choice=denied]').click();
  await page.locator('#about-tab').click();
  await page.locator('#support-open').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#support-checkout-dialog')).toBeVisible();
  await expect(page.locator('#support-checkout-dialog')).toHaveCSS('opacity', '1');
}
const frame = page => page.frameLocator('iframe[title="Stripe checkout fixture"]');
const payment = page => frame(page).getByRole('button', {name: 'Complete test payment'});

test('separate support page uses native checkout and keeps wallet returns on that page', async ({page, context}) => {
  const state = await hosted(context);
  await page.goto('https://maimai.party/support.html');
  await expect(page.locator('#support-checkout-dialog')).toBeVisible();
  await expect(frame(page).getByRole('heading')).toHaveText('Stripe test double');
  await expect(page.locator('.support-invitation')).toHaveText(
    'maimai.party is free for everyone. If you’d like to help with hosting and domain costs, a few dollars is more than enough.');
  const stored = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), storageKey);
  expect(stored.entry).toBe('support');
  expect(state.api[0].data).toEqual({project: 'maimai-party', attempt: stored.attempt});
  await page.goto('https://maimai.party/support-return.html');
  const back = page.getByRole('link', {name: 'Return to checkout'});
  await expect(back).toHaveAttribute('href', '/support.html');
  await back.click();
  await expect(frame(page).getByRole('heading')).toHaveText('Stripe test double');
  expect(state.sessions.size).toBe(1);
  expect(state.external.every(item => /^https:\/\/(?:js|checkout)\.stripe\.com\//.test(item.url))).toBe(true);
  expect(await page.locator('script[src*="analytics"], script[src*="player-data"]').count()).toBe(0);
});

test('separate support page hides the button and makes no payment request when disabled', async ({page, context}) => {
  const state = await hosted(context, {enabled: false});
  await page.goto('https://maimai.party/support.html');
  await expect(page.getByRole('status')).toContainText('currently unavailable');
  await expect(page.locator('#support-open')).toBeHidden();
  expect(state.api).toEqual([]);
  expect(state.external).toEqual([]);
});

test('native embedded checkout, lazy loading, consent and verified completion stay private', async ({page, context}, testInfo) => {
  const state = await hosted(context);
  await page.goto('https://maimai.party/?view=about&search=PRIVATE_SEARCH#PRIVATE_HASH');
  await page.evaluate(() => localStorage.setItem('PRIVATE_PLAYER', 'PRIVATE_SCORES'));
  expect(state.api).toEqual([]); expect(state.external).toEqual([]);
  await open(page);
  await expect(payment(page)).toBeVisible();
  expect(await page.evaluate(() => window.dataLayer)).toBeUndefined();
  await expect(page.getByRole('heading', {name: 'Support maimai.party', exact: true})).toBeVisible();
  await expect(page.locator('#support-open')).toHaveText('Support maimai.party');
  await expect(page.locator('.support-button-provider')).not.toHaveAttribute('hidden');
  await expect(page.locator('.support-button-provider img')).toHaveAttribute('alt', 'Stripe');
  await expect(page.locator('.support-invitation')).toHaveText('maimai.party is free for everyone. If you’d like to help with hosting and domain costs, a few dollars is more than enough.');
  await expect(page.locator('#support-dialog-title .party-suffix')).toHaveText('.party');
  await expect(page.locator('.support-secure-hint')).toHaveCount(0);
  await expect(page.locator('.creator-support-via')).toHaveCount(0);
  await expect(page.locator('.support-amount-form')).toHaveCount(0);
  await expect(page.locator('#support-checkout-dialog')).not.toContainText('Buy Me a Coffee');
  await expect(page.locator('.support-payment-details')).toHaveCount(0);
  expect((await new AxeBuilder({page}).include('#support-checkout-dialog').analyze()).violations).toEqual([]);
  await page.locator('#support-checkout-dialog').screenshot({path: testInfo.outputPath('stripe-embedded-shell.png')});
  expect(state.sessions.size).toBe(1); expect(state.api.filter(x => x.path.endsWith('checkout'))).toHaveLength(1);
  // Provider-owned amount changes stay inside Stripe's frame, not our API/storage.
  await frame(page).getByRole('textbox', {name: 'Amount (test fixture only)'}).fill('7.25');
  expect(state.api[0].data.amount).toBeUndefined();
  expect(await page.evaluate(key => sessionStorage.getItem(key), storageKey)).not.toContain('7.25');
  await frame(page).getByRole('button', {name: 'Decline test payment'}).click();
  await expect(frame(page).getByRole('status')).toContainText('declined');
  await expect(page.locator('.support-stripe-status')).not.toContainText('Thank you');
  const box = await page.locator('#support-checkout-dialog').boundingBox();
  expect(box.width).toBeLessThanOrEqual(page.viewportSize().width);
  expect(await page.locator('.support-stripe-body').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  state.status = 'paid'; await payment(page).click();
  await expect(page.locator('.support-stripe-status')).toContainText('Thank you');
  expect(state.api.at(-1).path).toBe('/api/support/status');
  expect(await page.evaluate(() => window.dataLayer)).toBeUndefined();
  for (const row of state.api) {
    expect(Object.keys(row.data).sort()).toEqual((row.data.session ? ['project', 'attempt', 'session'] : ['project', 'attempt']).sort());
    expect(row.headers.referer).toBeUndefined();
    expect(row.headers.cookie).toBeUndefined();
    expect(row.url).not.toMatch(/PRIVATE|cs_test/);
  }
  expect(JSON.stringify([...state.api, ...state.external])).not.toContain('PRIVATE');
  await page.keyboard.press('Escape'); await expect(page.locator('#support-open')).toBeFocused();
  await page.locator('.project-actions').screenshot({path: testInfo.outputPath('support-actions.png')});
});

test('failed creation, repeated opens, close, reload and back resume one attempt', async ({page, context}) => {
  const state = await hosted(context, {failCreate: 1});
  await page.goto('https://maimai.party/'); await open(page);
  await expect(page.getByRole('button', {name: 'Try again', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Try again', exact: true}).click(); await expect(payment(page)).toBeVisible();
  expect(state.api[0].data).toEqual(state.api[1].data);
  await page.evaluate(() => { document.getElementById('support-open').click(); document.getElementById('support-open').click(); });
  expect(state.api.filter(x => x.path.endsWith('checkout'))).toHaveLength(2);
  await page.keyboard.press('Escape'); await page.locator('#support-open').click(); await expect(payment(page)).toBeVisible();
  await page.reload();
  await expect(page.locator('#support-checkout-dialog')).toBeHidden();
  await open(page); await expect(payment(page)).toBeVisible();
  await page.goto('https://maimai.party/support-return.html');
  await expect(page.locator('#support-return-status')).toContainText('unfinished');
  await page.goBack(); await open(page); await expect(payment(page)).toBeVisible();
  expect(state.sessions.size).toBe(1);
});

test('return page distinguishes pending, cancellation, verified success and missing state', async ({page, context}) => {
  const state = await hosted(context);
  await page.goto('https://maimai.party/'); await open(page);
  await expect(payment(page)).toBeVisible();
  state.status = 'pending';
  await page.goto('https://maimai.party/support-return.html?success=true#PRIVATE');
  await expect(page).toHaveURL('https://maimai.party/support-return.html');
  await expect(page.getByRole('status')).toContainText('processing');
  expect(await page.locator('script[src*="analytics"]').count()).toBe(0);
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(policy).not.toContain('stripe.com'); expect(policy).not.toContain('cloudflare');
  state.status = 'open'; await page.getByRole('button', {name: 'Check again'}).click();
  await expect(page.getByRole('status')).toContainText('unfinished');
  await page.getByRole('link', {name: 'Return to checkout'}).click(); await expect(payment(page)).toBeVisible();
  state.status = 'paid'; await page.goto('https://maimai.party/support-return.html');
  await expect(page.getByRole('status')).toContainText('Thank you');
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  await page.evaluate(key => sessionStorage.removeItem(key), storageKey); await page.reload();
  await expect(page.getByRole('status')).toContainText('could not find');
  await expect(page.getByRole('status')).not.toContainText('Thank you');
});

test('Stripe load failure offers retry and temporary-storage failure creates no session', async ({page, context}) => {
  const state = await hosted(context, {failScript: true});
  await page.goto('https://maimai.party/'); await open(page);
  await expect(page.locator('.support-stripe-status')).toContainText('could not load');
  await expect(page.getByRole('button', {name: 'Try again', exact: true})).toBeVisible();
  await expect(page.locator('#support-checkout-dialog')).not.toContainText('Buy Me a Coffee');
  expect(state.api).toEqual([]);
  await page.evaluate(key => sessionStorage.removeItem(key), storageKey);
  await page.reload();
  await page.evaluate(() => {Storage.prototype.setItem = () => {throw new DOMException('denied', 'SecurityError');};});
  await open(page, {keepNotice: true});
  await expect(page.locator('.support-stripe-status')).toContainText('temporary storage');
  expect(state.api).toEqual([]);
});

test('support analytics accepts only fixed events after consent and never queues past events', async ({page, context}) => {
  await hosted(context);
  await page.goto('https://maimai.party/'); await open(page, {keepNotice: true}); await expect(payment(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#analytics-notice [data-analytics-choice=granted]').click();
  await page.locator('#support-open').click();
  await expect(payment(page)).toBeVisible();
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('maimai:support', {detail: {name: 'support_opened', amount: 500, session: 'PRIVATE'}}));
    window.dispatchEvent(new CustomEvent('maimai:support', {detail: 'PRIVATE_PLAYER'}));
  });
  const events = await page.evaluate(() => window.dataLayer.filter(x => x[0] === 'event').map(x => Array.from(x)));
  expect(events.filter(x => x[1] === 'support_opened')).toHaveLength(1);
  expect(JSON.stringify(events)).not.toMatch(/PRIVATE|amount|cs_test/);
  await page.keyboard.press('Escape');
  await page.locator('#settings-toggle').click(); await page.locator('#analytics-settings').click();
  await page.locator('#analytics-dialog [data-analytics-choice=denied]').click();
  await page.locator('#support-open').click();
  expect(await page.evaluate(() => window.dataLayer.filter(x => x[0] === 'event').length)).toBe(events.length);
});

test('unconfirmed completion is retried before success; expiry allows a new checkout', async ({page, context}) => {
  const state = await hosted(context);
  await page.goto('https://maimai.party/'); await open(page);
  await expect(payment(page)).toBeVisible();
  state.failStatus = true; await payment(page).click();
  await expect(page.getByRole('button', {name: 'Try again', exact: true})).toBeVisible();
  await expect(page.locator('.support-stripe-status')).not.toContainText('Thank you');
  state.failStatus = false; state.status = 'pending';
  await page.getByRole('button', {name: 'Try again', exact: true}).click();
  await expect(page.locator('.support-stripe-status')).toContainText('processing');
  await expect(page.getByRole('button', {name: 'Start a new checkout'})).toBeHidden();
  state.status = 'expired'; await page.getByRole('button', {name: 'Check payment status'}).click();
  await expect(page.locator('.support-stripe-status')).toContainText('expired');
  state.status = 'open'; await page.getByRole('button', {name: 'Start a new checkout', exact: true}).click();
  await expect(payment(page)).toBeVisible(); expect(state.sessions.size).toBe(2);
});

test('disabling the public feature hides support without a fallback while existing returns still work', async ({page, context}) => {
  const state = await hosted(context, {enabled: false});
  await page.goto('https://maimai.party/');
  await page.locator('#about-tab').click();
  await expect(page.locator('.support-button-group')).toBeHidden();
  await expect(page.locator('#support-open')).not.toHaveAttribute('data-checkout-ready');
  await expect(page.locator('#support-checkout-dialog')).toHaveCount(0);
  await expect(page.locator('a[href*="buymeacoffee"],script[src*="support-checkout.js"]')).toHaveCount(0);
  await expect(page.locator('.support-button-provider')).toHaveAttribute('hidden', '');
  expect(state.external).toEqual([]); expect(state.api).toEqual([]);
  await page.evaluate(key => sessionStorage.setItem(key, JSON.stringify({attempt: crypto.randomUUID(),
    created: Date.now(), session: 'cs_test_abcdefghijk12345'})), storageKey);
  state.status = 'paid'; await page.goto('https://maimai.party/support-return.html');
  await expect(page.getByRole('status')).toContainText('Thank you');
  expect(state.external).toEqual([]);
});

for (const signal of ['globalPrivacyControl', 'doNotTrack']) test('support events respect ' + signal, async ({page, context}) => {
  await hosted(context);
  await page.addInitScript(signal => {
    Object.defineProperty(navigator, signal, {value: signal === 'globalPrivacyControl' ? true : '1'});
    localStorage.setItem('maimai.party.analytics.v1', JSON.stringify({choice: 'granted', expires: Date.now() + 86400000}));
  }, signal);
  await page.goto('https://maimai.party/'); await open(page);
  await expect(payment(page)).toBeVisible();
  expect(await page.evaluate(() => window.dataLayer)).toBeUndefined();
});

test('a stalled embedded SDK times out with retry and retains the same attempt', async ({page, context}) => {
  const state = await hosted(context, {stallInit: true});
  await page.clock.install();
  await page.goto('https://maimai.party/'); await open(page);
  await page.waitForFunction(() => window.__stripeInitWaiting);
  await page.clock.fastForward(21000);
  await expect(page.locator('.support-stripe-status')).toContainText('taking too long');
  await expect(page.locator('#support-checkout-dialog')).not.toContainText('Buy Me a Coffee');
  await page.getByRole('button', {name: 'Try again', exact: true}).click();
  await expect.poll(() => state.api.filter(row => row.path.endsWith('/checkout')).length).toBe(2);
  expect(state.sessions.size).toBe(1);
});
