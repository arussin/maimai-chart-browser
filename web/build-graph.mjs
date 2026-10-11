import { resolve, relative } from 'node:path';

/** Static dependencies plus explicitly declared, immediately imported startup entries. */
export function hostedPreloads(metafile, entry, assets, startupEntryPoints = []) {
  const outputs = new Map(
    Object.entries(metafile.outputs).map(([path, output]) => [resolve(path), output]),
  );
  const visited = new Set(),
    active = new Set(),
    root = resolve(entry);
  function visit(path) {
    if (active.has(path)) throw Error('Cyclic hosted module dependency');
    if (visited.has(path)) return;
    const output = outputs.get(path),
      name = relative(assets, path).replaceAll('\\', '/');
    if (!output || !/^browser\/[A-Za-z0-9][A-Za-z0-9._-]*\.js$/.test(name))
      throw Error('Hosted module dependency is outside the generated browser assets');
    active.add(path);
    for (const dependency of output.imports) {
      if (dependency.external || !['import-statement', 'dynamic-import'].includes(dependency.kind))
        throw Error('Unsupported hosted module dependency');
      visit(resolve(dependency.path));
    }
    active.delete(path);
    visited.add(path);
  }
  visit(root);
  // Validate the whole reachable graph above, including lazy branches, before choosing
  // preloads. A user-triggered import must remain lazy without bypassing asset checks.
  const startup = startupEntryPoints.map((source) => {
    const expected = resolve(source),
      matches = [...outputs].filter(
        ([path, output]) =>
          visited.has(path) && output.entryPoint && resolve(output.entryPoint) === expected,
      );
    if (matches.length !== 1) throw Error('Expected exactly one reachable startup entry');
    return matches[0][0];
  });
  const preloaded = new Set();
  function preload(path) {
    if (preloaded.has(path)) return;
    preloaded.add(path);
    for (const dependency of outputs.get(path).imports)
      if (dependency.kind === 'import-statement') preload(resolve(dependency.path));
  }
  for (const path of [root, ...startup]) preload(path);
  return [...preloaded]
    .filter((path) => path !== root)
    .map((path) => relative(assets, path).replaceAll('\\', '/'))
    .sort();
}

/** Match the packaged graph's byte limits; only its self-contained offline entry is larger. */
export function validateBrowserAssetSizes(manifest) {
  const mib = 1024 * 1024,
    offline = manifest.entries.offline;
  if (
    offline === manifest.entries.hosted ||
    !/^browser\/browser-offline-[A-Za-z0-9_-]+\.js$/.test(offline) ||
    !Object.hasOwn(manifest.assets, offline)
  )
    throw Error('Invalid self-contained offline entry');
  let total = 0;
  for (const [path, record] of Object.entries(manifest.assets)) {
    const limit = (path === offline ? 8 : 2) * mib;
    if (!Number.isSafeInteger(record.bytes) || record.bytes <= 0 || record.bytes > limit)
      throw Error('Generated browser asset exceeds its byte limit: ' + path);
    total += record.bytes;
  }
  if (total > 16 * mib) throw Error('Generated browser asset graph exceeds its byte limit');
}
