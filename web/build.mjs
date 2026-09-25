import { build } from 'esbuild';
import { readFile, writeFile, mkdir, readdir, unlink, realpath } from 'node:fs/promises';
import { resolve, dirname, relative, basename, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { hostedPreloads } from './build-graph.mjs';
const base = dirname(fileURLToPath(import.meta.url)),
  root = resolve(base, '..'),
  productionAssets = resolve(root, 'src/maimai_intelligence/assets');
const args = process.argv.slice(2);
const checking = args.length === 1 && args[0] === '--check';
const staging = args.length === 2 && args[0] === '--staging-output';
if (args.length && !checking && !staging)
  throw Error('Use --check or --staging-output NEW_EXTERNAL_DIRECTORY');
let assets = productionAssets;
if (staging) {
  const requested = resolve(args[1]);
  assets = resolve(await realpath(dirname(requested)), basename(requested));
  const source = await realpath(root);
  const withinSource = relative(source, assets);
  if (
    !isAbsolute(withinSource) &&
    withinSource !== '..' &&
    !withinSource.startsWith('../') &&
    !withinSource.startsWith('..\\')
  )
    throw Error('Staging output must be outside the source checkout');
  // A staging build never overwrites an accepted bundle or packaged production assets.
  await mkdir(assets);
}
const usageAdapter = staging
  ? [
      {
        name: 'explicit-staging-usage',
        setup(builder) {
          builder.onResolve({ filter: /^\.\/usage$/ }, (argument) =>
            resolve(argument.resolveDir, argument.path) === resolve(base, 'src/usage')
              ? { path: resolve(base, 'src/usage-staging.ts') }
              : undefined,
          );
        },
      },
    ]
  : [];
let stale = false;
const common = {
  bundle: true,
  write: false,
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  charset: 'utf8',
};
const digest = (bytes) => ({
  sha256: createHash('sha256').update(bytes).digest('hex'),
  bytes: bytes.length,
});
async function output(path, bytes) {
  if (checking) {
    try {
      if (!Buffer.from(bytes).equals(await readFile(path))) stale = true;
    } catch {
      stale = true;
    }
  } else {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }
}
const compatibility = { version: 1, tool: 'esbuild-0.28.2', assets: {} };
for (const name of staging
  ? []
  : [
      'localization',
      'song-search',
      'support-config',
      'support-client',
      'support-stripe',
      'settings-menu',
      'player-data-core',
      'player-maishift',
      'chart-visuals',
      'challenge-matching',
      'chart-overview',
      'analytics',
    ]) {
  const result = await build({
    ...common,
    entryPoints: [resolve(base, 'src/compat', name + '.ts')],
    format: 'iife',
  });
  const bytes = result.outputFiles[0].contents;
  compatibility.assets[name + '.js'] = digest(bytes);
  await output(resolve(assets, name + '.js'), bytes);
}
if (!staging)
  await output(
    resolve(base, 'generated-assets.json'),
    JSON.stringify(compatibility, null, 2) + '\n',
  );
const manifest = {
  version: 1,
  tool: 'esbuild-0.28.2',
  entries: {},
  assets: {},
  replaces: [
    'settings-menu.js',
    'player-import-config.js',
    'player-ranges.js',
    'player-data-core.js',
    'player-maishift.js',
    'player-sources.js',
    'player-storage.js',
    'player-session.js',
    'player-data.js',
    'usage.js',
    'seo-navigation.js',
    'feature-announcements.js',
    'analytics.js',
    'catalog-query.js',
    'view-navigation.js',
    'challenge-review.js',
    'lab-loader.js',
  ],
};
const hosted = await build({
  ...common,
  entryPoints: [resolve(base, 'src/browser-entry.ts')],
  format: 'esm',
  splitting: true,
  plugins: usageAdapter,
  outdir: resolve(assets, 'browser'),
  chunkNames: '[name]-[hash]',
  entryNames: '[name]-[hash]',
  metafile: true,
});
const offline = await build({
  ...common,
  entryPoints: [resolve(base, 'src/browser-offline.ts')],
  format: 'iife',
  outdir: resolve(assets, 'browser'),
  entryNames: '[name]-[hash]',
  metafile: true,
});
for (const [kind, result, source] of [
  ['hosted', hosted, 'browser-entry.ts'],
  ['offline', offline, 'browser-offline.ts'],
]) {
  const expected = resolve(base, 'src', source);
  const entries = Object.entries(result.metafile.outputs).filter(
    ([, value]) => value.entryPoint && resolve(value.entryPoint) === expected,
  );
  if (entries.length !== 1) throw Error('Expected exactly one generated browser entry');
  manifest.entries[kind] = relative(assets, resolve(entries[0][0])).replaceAll('\\', '/');
}
manifest.preloads = hostedPreloads(
  hosted.metafile,
  resolve(assets, manifest.entries.hosted),
  assets,
);
for (const file of [...hosted.outputFiles, ...offline.outputFiles]) {
  const path = relative(assets, file.path).replaceAll('\\', '/');
  manifest.assets[path] = digest(file.contents);
  await output(file.path, file.contents);
}
// This directory is generated exclusively by this build. Reject or prune stale JS chunks.
const generatedRoot = resolve(assets, 'browser');
for (const name of await readdir(generatedRoot, { recursive: true }).catch(() => [])) {
  const path = resolve(generatedRoot, name);
  if (!path.startsWith(generatedRoot + '/') && !path.startsWith(generatedRoot + '\\'))
    throw Error('Invalid generated output path');
  if (!name.endsWith('.js') || manifest.assets['browser/' + name.replaceAll('\\', '/')]) continue;
  if (checking) stale = true;
  else await unlink(path);
}
await output(resolve(assets, 'browser-assets.json'), JSON.stringify(manifest, null, 2) + '\n');
if (stale)
  throw Error(
    'Generated browser assets are stale; build in the approved workspace, then promote reviewed generated files.',
  );

if (staging) {
  const inputs = Object.keys(hosted.metafile.inputs).map((path) => resolve(path));
  if (
    !inputs.includes(resolve(base, 'src/usage-staging.ts')) ||
    inputs.includes(resolve(base, 'src/usage.ts'))
  )
    throw Error('Staging build did not select its exclusive usage adapter');
  await output(
    resolve(assets, 'staging-build.json'),
    JSON.stringify(
      {
        schema_version: 'maimai-staging-browser-1',
        usage_origin: 'https://maimai-party-staging.pages.dev',
        production_manifest_sha256: digest(
          await readFile(resolve(productionAssets, 'browser-assets.json')),
        ).sha256,
        staging_manifest_sha256: digest(await readFile(resolve(assets, 'browser-assets.json')))
          .sha256,
        usage_adapter: 'web/src/usage-staging.ts',
        shared_entry: 'web/src/browser-entry.ts',
      },
      null,
      2,
    ) + '\n',
  );
}
