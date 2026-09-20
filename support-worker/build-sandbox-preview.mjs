// Build a separate test-only preview from canonical support assets. No credentials
// or production configuration are written to the sandbox output.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const origin = 'https://maimai-support-sandbox.adam-russin.workers.dev';
const [output, publishableKey] = process.argv.slice(2);
if (!output || !/^pk_test_[A-Za-z0-9]+$/.test(publishableKey || '') ||
    !path.resolve(output).toLowerCase().startsWith('c:\\devcache\\')) {
  throw new Error('Provide a DevCache output directory and a sandbox publishable key.');
}
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.join(here, '../src/maimai_intelligence/assets');
const readAsset = name => readFile(path.join(assets, name), 'utf8');
const files = {};
for (const name of ['site-brand.css', 'support-footer.css', 'support-checkout.css',
  'support-client.js', 'support-stripe.js', 'support-return.html', 'support-return.js',
  'stripe-wordmark.svg', 'support.html', 'support-page.js', 'support-page.css']) files['/' + name] = await readAsset(name);
const publicConfig = await readAsset('support-config.js');
for (const pattern of [/enabled: (?:true|false)/g, /publishableKey: '[^']*'/g,
  /origin: 'https:\/\/maimai\.party'/g]) {
  if ([...publicConfig.matchAll(pattern)].length !== 1) throw new Error('Unexpected public configuration.');
}
files['/support-config.js'] = publicConfig.replace(/enabled: (?:true|false)/, 'enabled: true')
  .replace("origin: 'https://maimai.party'", `origin: '${origin}'`)
  .replace(/publishableKey: '[^']*'/, `publishableKey: '${publishableKey}'`);
if (/pk_live_/.test(files['/support-config.js'])) throw new Error('Live key in sandbox output.');
files['/preview.css'] = 'body{margin:0;background:#f4fafb;color:#183b43;font:16px/1.6 system-ui,sans-serif}main{box-sizing:border-box;max-width:760px;margin:8vh auto;padding:24px}h1{font-size:24px;font-weight:600;margin-top:40px}.preview-note{color:#52676d;font-size:14px}';
files['/'] = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer">
<title>Support checkout preview · maimai.party</title>
<link rel="stylesheet" href="/preview.css"><link rel="stylesheet" href="/site-brand.css">
<link rel="stylesheet" href="/support-footer.css"><link rel="stylesheet" href="/support-checkout.css">
<script defer src="/support-config.js"></script><script defer src="/support-client.js"></script>
<script defer src="/support-stripe.js"></script></head><body><main>
${await readAsset('site-brand.html')}
<h1>Support checkout preview</h1><p class="preview-note">Stripe sandbox — test payments only.</p>
${(await readAsset('support-footer.html')).split('<footer')[0].replace('__CREATOR_SUPPORT__',
  await readAsset('creator-support.html'))}
</main></body></html>`;
// The main site's exact Stripe allowlist, omitting analytics and the old provider.
const csp = "default-src 'none'; script-src 'self' https://js.stripe.com https://*.js.stripe.com https://checkout.stripe.com; style-src 'self'; img-src 'self' data: https://*.stripe.com https://*.link.com; connect-src 'self' https://api.stripe.com https://checkout.stripe.com https://link.com https://*.link.com; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'; frame-src https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com https://checkout.stripe.com https://link.com https://*.link.com";
let checkout = await readFile(path.join(here, 'index.mjs'), 'utf8');
if (checkout.split("origin: 'https://maimai.party'").length !== 2) throw new Error('Unexpected project origins.');
checkout = checkout.replace("origin: 'https://maimai.party'", `origin: '${origin}'`);
const wrapper = `import checkout from './checkout.mjs';
const files = ${JSON.stringify(files)};
const common = {'Cache-Control':'no-store','Referrer-Policy':'no-referrer',
 'X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow, noarchive',
 'Permissions-Policy':'payment=(self "https://checkout.stripe.com" "https://js.stripe.com" "https://hooks.stripe.com")'};
export default {async fetch(request, env) {
 const url = new URL(request.url);
 if (url.origin !== ${JSON.stringify(origin)} || env.STRIPE_MODE !== 'test' ||
     (env.STRIPE_SECRET_KEY && !/^(sk|rk)_test_[A-Za-z0-9]+$/.test(env.STRIPE_SECRET_KEY)))
   return new Response('Sandbox unavailable', {status:503,headers:common});
 if (url.pathname.startsWith('/api/support/')) return checkout.fetch(request, env);
 if (!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed',{status:405,headers:common});
 const name = url.pathname === '/support-return' ? '/support-return.html' : url.pathname;
 if (url.search || !Object.hasOwn(files,name)) return new Response('Not found',{status:404,headers:common});
 const type = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' :
   name.endsWith('.svg') ? 'image/svg+xml' : 'text/html';
 const policy = name === '/support-return.html' ? "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'" : ${JSON.stringify(csp)};
 return new Response(request.method==='HEAD'?null:files[name], {headers:{...common,
   'Content-Type':type+'; charset=utf-8','Content-Security-Policy':policy}});
}};`;
await mkdir(output, {recursive: true});
await writeFile(path.join(output, 'preview.mjs'), wrapper);
await writeFile(path.join(output, 'checkout.mjs'), checkout);
// Dashboard editing uses one module; keep its source identical to the two-module build.
await writeFile(path.join(output, 'worker.js'), checkout.replace('export default {', 'const checkout = {') + '\n' +
  wrapper.replace("import checkout from './checkout.mjs';\n", ''));
await writeFile(path.join(output, 'upload.json'), JSON.stringify({origin, modules: {
  'preview.mjs': wrapper, 'checkout.mjs': checkout}}));
console.log(JSON.stringify({origin, files:Object.keys(files).length, output:path.resolve(output)}));
