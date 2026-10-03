import {makeDashboardData} from '../dashboard-model.mjs';
const safeJSON = value => JSON.stringify(value).replaceAll('<','\\u003c').replaceAll('>','\\u003e').replaceAll('&','\\u0026').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029');
async function hash(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return btoa(String.fromCharCode(...bytes));
}
export async function renderHosted(input, capturedAt, assets) {
  const data = makeDashboardData(input, {capturedAt});
  const {template, script, style} = assets;
  const csp = "default-src 'none'; connect-src 'none'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; script-src 'sha256-" + await hash(script) + "'; style-src 'sha256-" + await hash(style) + "'";
  const html = template
    .replace('Private local snapshot','Authenticated private dashboard')
    .replace('Reload saved snapshot ↻','Refresh latest data ↻')
    .replace('This file makes no network requests and contains no credentials. Use your local refresh command to query Cloudflare through your existing login, then reload this snapshot. Do not publish or upload the generated file.',
      'Each page load queries the latest aggregate counters after verifying your access. Refresh latest data performs another read. No dashboard response is cached, and there are no background polling requests or credentials in this page.')
    .replace('__CSP__', csp.replace("frame-ancestors 'none'; ", ''))
    .replace('__STYLE__', () => style).replace('__DATA__', () => safeJSON(data)).replace('__SCRIPT__', () => script);
  return {html, csp};
}
