/** Read-only loopback artifact switch. This simulates routing, not Cloudflare Pages. */
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {readFile, realpath, stat, lstat} from 'node:fs/promises';
import path from 'node:path';
import {recoveryDerivation, derivedEntry} from './release-transition-recovery.mjs';
export {assertRecoveryBinding} from './release-transition-recovery.mjs';

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.gz': 'application/gzip',
};
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function artifactFile(root, pathname) {
  const decoded = decodeURIComponent(pathname);
  if (decoded.includes('\\') || decoded.includes('\0')) throw Error('Invalid artifact path');
  let filename = path.resolve(root, '.' + decoded);
  const inside = file => file.startsWith(root + path.sep);
  if (!inside(filename) && filename !== root) throw Error('Outside artifact root');
  if ((await stat(filename)).isDirectory()) filename = path.join(filename, 'index.html');
  filename = await realpath(filename);
  if (!inside(filename)) throw Error('Artifact link leaves its root');
  return {filename, bytes: await readFile(filename)};
}

export async function readRecoveryDerivation(filename, expectedSHA) {
  if (filename === undefined && expectedSHA === undefined) return null;
  if (typeof filename !== 'string' || !path.isAbsolute(filename)
    || typeof expectedSHA !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSHA))
    throw Error('Derived recovery requires an absolute receipt path and SHA-256');
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 32 * 1024 * 1024)
    throw Error('Invalid derived recovery completion receipt');
  const raw = await readFile(filename);
  if (raw.length !== info.size || sha256(raw) !== expectedSHA)
    throw Error('Derived recovery completion receipt changed');
  return recoveryDerivation(JSON.parse(raw.toString('utf8')), expectedSHA);
}

export async function inspectArtifact(directory, expectedRuntime, derivation = null) {
  if (!directory || !path.isAbsolute(directory)) throw Error('Artifact roots must be explicit absolute paths');
  const root = await realpath(directory);
  const html = (await artifactFile(root, '/index.html')).bytes;
  const scripts = [...html.toString('utf8').matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)].map(match => match[1]);
  const modular = scripts.find(value => /(?:^|\/)browser-entry(?:-[A-Za-z0-9]+)?\.js(?:\?|$)/.test(value));
  const kind = modular ? 'modular' : 'legacy';
  if (kind !== expectedRuntime) throw Error(`Expected ${expectedRuntime} runtime at ${root}; found ${kind}`);
  const runtimeReference = modular || (derivation ? derivedEntry(html, scripts, derivation)
    : scripts.find(value => /(?:^|\/)lab-loader\.js(?:\?|$)/.test(value)));
  if (!runtimeReference) throw Error('Artifact does not contain a recognized maintained browser entry');
  const reference = new URL(runtimeReference, 'http://artifact.invalid/');
  if (reference.origin !== 'http://artifact.invalid') throw Error('Runtime must be a local artifact asset');
  const runtime = await artifactFile(root, reference.pathname);
  let lateURL = reference.pathname + reference.search;
  if (modular) {
    const imports = [...runtime.bytes.toString('utf8').matchAll(/import\(["'](\.\/application-[^"']+\.js)["']\)/g)];
    if (imports.length !== 1) throw Error('Expected one actual lazy application import in browser entry');
    const late = new URL(imports[0][1], reference);
    lateURL = late.pathname + late.search;
  }
  const lateBytes = (await artifactFile(root, new URL(lateURL, reference).pathname)).bytes;
  let bundle = null, bundleURL = null;
  if (kind === 'legacy') {
    const targets = [...runtime.bytes.toString('utf8').matchAll(/script\.src=['"]([^'"]+)['"]/g)];
    if (targets.length !== 1) throw Error('Expected one actual legacy bundle target');
    const target = new URL(targets[0][1], reference);
    if (target.origin !== reference.origin || target.hash) throw Error('Legacy bundle must be local');
    bundleURL = target.pathname + target.search;
    bundle = (await artifactFile(root, target.pathname)).bytes;
  }
  const boundResources = {}, publicRoutes = [];
  const descriptor = html.toString('utf8').match(/<script\b(?=[^>]*\bid=["']browser-resources["'])[^>]*>([\s\S]*?)<\/script>/);
  if (descriptor) {
    const resources = JSON.parse(descriptor[1]);
    if (resources.version !== 1) throw Error('Unknown browser resource descriptor');
    for (const role of ['configuration', 'catalog', 'permalinks', 'styles', 'shell', 'seoStyle']) {
      const item = resources[role];
      if (!item) continue;
      const url = new URL(item.path, 'http://artifact.invalid/');
      if (url.origin !== 'http://artifact.invalid' || url.search || url.hash)
        throw Error('Bound resource must be a local artifact path');
      const bytes = (await artifactFile(root, url.pathname)).bytes;
      if (sha256(bytes) !== item.sha256 || bytes.length !== item.bytes)
        throw Error('Resource descriptor does not match actual artifact bytes: ' + role);
      boundResources[role] = {lateURL: url.pathname, lateSha256: item.sha256};
      if (role === 'permalinks') {
        const ledger = JSON.parse(bytes);
        for (const locale of ['en', 'ja', 'ko', 'zh-hans']) {
          for (const kind of ['songs', 'versions']) {
            for (const slug of Object.values(ledger[kind] || {})) {
              const route = `/${locale}/${kind}/${encodeURIComponent(slug)}/`;
              // This is explicit authored fixture discovery, not production closure inference.
              await artifactFile(root, route);
              publicRoutes.push(route);
            }
          }
        }
      }
    }
  }
  return {
    root, kind, htmlSha256: sha256(html), runtimeSha256: sha256(runtime.bytes),
    runtimeURL: reference.pathname + reference.search, lateURL, lateSha256: sha256(lateBytes),
    boundResources, publicRoutes,
    htmlBytes: html.length, runtimeBytes: runtime.bytes.length,
    bundleURL, bundleSha256: bundle ? sha256(bundle) : null, bundleBytes: bundle?.length ?? null,
  };
}

export async function startArtifactSwitch(artifacts) {
  let active = 'baseline';
  const requests = [];
  const server = createServer(async (request, response) => {
    const startedAt = active;
    let pathname, selected = active;
    try {
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(405).end(); return;
      }
      const url = new URL(request.url, 'http://127.0.0.1');
      pathname = url.pathname;
      // Snapshot routing at dispatch. Tests pause the browser request before it
      // reaches this server; an in-flight response never changes deployment.
      selected = startedAt;
      const {filename, bytes} = await artifactFile(artifacts[selected].root, pathname);
      requests.push({url: request.url, startedAt, servedBy: selected, status: 200, sha256: sha256(bytes)});
      response.writeHead(200, {
        'Content-Type': mime[path.extname(filename)] || 'application/octet-stream',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      requests.push({url: request.url, startedAt, servedBy: selected, status: 404, error: error.code || error.message});
      response.writeHead(404, {'Content-Type': 'text/plain', 'Cache-Control': 'no-store'}).end('Artifact path unavailable');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    requests,
    switchTo(name) {
      if (!Object.hasOwn(artifacts, name)) throw Error('Unknown artifact');
      active = name;
    },
    async close() {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}
