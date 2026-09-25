import { resolve, relative } from 'node:path';

/** Dependencies of the hosted entry, including its immediately imported application. */
export function hostedPreloads(metafile, entry, assets) {
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
  return [...visited]
    .filter((path) => path !== root)
    .map((path) => relative(assets, path).replaceAll('\\', '/'))
    .sort();
}
