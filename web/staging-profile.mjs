import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/** Build-only policy: production/offline compiler inputs and fetch literals stay unchanged. */
export function stagingBrowserPlugin(base) {
  const publicTransports = new Set([
    resolve(base, 'src/usage-client.ts'),
    resolve(base, 'src/runtime/verified-data.ts'),
  ]);
  return {
    name: 'explicit-staging-profile',
    setup(builder) {
      builder.onResolve({ filter: /^\.\/usage$/ }, (argument) =>
        resolve(argument.resolveDir, argument.path) === resolve(base, 'src/usage')
          ? { path: resolve(base, 'src/usage-staging.ts') }
          : undefined,
      );
      builder.onLoad({ filter: /\.ts$/ }, async ({ path }) => {
        if (!publicTransports.has(path)) return;
        const source = await readFile(path, 'utf8');
        const literal = "credentials: 'omit'";
        if (source.split(literal).length !== 2)
          throw Error('Staging public transport must have exactly one credential policy: ' + path);
        return {
          contents: source.replace(literal, "credentials: 'same-origin'"),
          loader: 'ts',
          resolveDir: dirname(path),
        };
      });
    },
  };
}
