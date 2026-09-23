import { build, transform } from 'esbuild';
import { parse } from 'acorn';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const base = fileURLToPath(new URL('.', import.meta.url));
const result = await build({
  absWorkingDir: base,
  entryPoints: ['src/browser-entry.ts', 'src/browser-offline.ts'],
  bundle: true,
  write: false,
  metafile: true,
  format: 'esm',
  outdir: 'architecture-check',
  logLevel: 'silent',
});
const graph = new Map(
  Object.entries(result.metafile.inputs).map(([path, entry]) => [
    path,
    entry.imports.filter((row) => !row.external).map((row) => row.path),
  ]),
);
const done = new Set(),
  active = new Set();
function visit(path, trail = []) {
  if (active.has(path)) throw Error('Browser dependency cycle: ' + [...trail, path].join(' -> '));
  if (done.has(path)) return;
  active.add(path);
  for (const next of graph.get(path) || []) visit(next, [...trail, path]);
  active.delete(path);
  done.add(path);
}
for (const path of graph.keys()) visit(path);
const pureDomains = new Set([
  'src/catalog-query.ts',
  'src/player-session.ts',
  'src/views/player-data-core.js',
  'src/views/player-maishift.js',
  'src/views/challenge-matching.js',
]);
for (const path of pureDomains)
  for (const dependency of graph.get(path) || []) {
    if (!pureDomains.has(dependency))
      throw Error('Side-effect dependency in pure domain: ' + path + ' -> ' + dependency);
  }
const forbiddenDomainGlobals = new Set([
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'fetch',
  'XMLHttpRequest',
]);
let moduleCount = 0,
  browserStateInstances = 0,
  sessionOwnerInstances = 0;
for (const path of graph.keys()) {
  if (!/\.[jt]s$/.test(path) || path.includes('node_modules')) continue;
  moduleCount++;
  const source = await readFile(resolve(base, path), 'utf8');
  const js = path.endsWith('.ts')
    ? (await transform(source, { loader: 'ts', target: 'esnext' })).code
    : source;
  const ast = parse(js, { ecmaVersion: 'latest', sourceType: 'module' });
  function visit(node, parent) {
    if (
      node.type === 'Literal' &&
      ['popstate', 'hashchange'].includes(node.value) &&
      !path.endsWith('/runtime/history.ts')
    )
      throw Error('Native route event outside HistoryPort: ' + path);
    if (node.type === 'NewExpression' && node.callee.name === 'ImportCoordinator') {
      if (path !== 'src/views/player-data.js')
        throw Error('Session state allocated outside player composition: ' + path);
      sessionOwnerInstances++;
    }
    if (node.type === 'NewExpression' && node.callee.name === 'BrowserState') {
      if (path !== 'src/application.ts')
        throw Error('Public state allocated outside application: ' + path);
      browserStateInstances++;
    }
    if (
      node.type === 'Identifier' &&
      pureDomains.has(path) &&
      forbiddenDomainGlobals.has(node.name) &&
      !(parent?.type === 'Property' && parent.key === node)
    )
      throw Error('Side-effect capability in pure domain: ' + path + ': ' + node.name);
    if (
      path === 'src/views/challenge-review.js' &&
      node.type === 'VariableDeclarator' &&
      [
        'visible',
        'format',
        'sortRules',
        'selectedVersions',
        'selectedCharts',
        'expandedRows',
      ].includes(node.id.name)
    )
      throw Error('Duplicate browser state in DOM view: ' + node.id.name);
    if (
      node.type === 'MemberExpression' &&
      node.object.type === 'Identifier' &&
      ['window', 'globalThis'].includes(node.object.name) &&
      /^maimai[A-Z]/.test(node.property.name) &&
      node.property.name !== 'maimaiUsageEnabled'
    )
      throw Error('Legacy service global in maintained graph: ' + path);
    if (
      node.type === 'Identifier' &&
      /^maimai[A-Z]/.test(node.name) &&
      node.name !== 'maimaiUsageEnabled' &&
      !(parent?.type === 'MemberExpression' && parent.property === node) &&
      !(parent?.type === 'Property' && parent.key === node)
    )
      throw Error('Bare legacy service identifier: ' + path + ': ' + node.name);
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'MemberExpression' &&
      node.callee.object.name === 'history' &&
      ['pushState', 'replaceState'].includes(node.callee.property.name) &&
      !path.endsWith('/runtime/history.ts')
    )
      throw Error('History mutation outside HistoryPort: ' + path);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) if (child?.type) visit(child, node);
      } else if (value?.type) visit(value, node);
    }
  }
  visit(ast);
}
const application = await readFile(resolve(base, 'src/application.ts'), 'utf8'),
  counts = new Map();
for (const match of application.matchAll(/(?<![.\w])(create[A-Z]\w*)\(/g))
  if (match[1] !== 'createApplication') counts.set(match[1], (counts.get(match[1]) || 0) + 1);
for (const [name, count] of counts)
  if (count !== 1) throw Error('Duplicate application initialization: ' + name);
if (browserStateInstances !== 1) throw Error('Expected one authoritative BrowserState instance');
if (sessionOwnerInstances !== 1) throw Error('Expected one authoritative player session instance');
const report = {
  version: 1,
  browserStateInstances,
  sessionOwnerInstances,
  pureDomainModules: pureDomains.size,
  nativeRouteEventOwners: 1,
  modules: moduleCount,
  cycles: 0,
  legacyServiceIdentifiers: 0,
  historyMutationOwners: 1,
  initializedFactories: Object.fromEntries(counts),
};
if (process.env.MAIMAI_ARCHITECTURE_REPORT)
  await writeFile(process.env.MAIMAI_ARCHITECTURE_REPORT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
