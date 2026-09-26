import { build } from 'esbuild';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { stagingBrowserPlugin } from '../staging-profile.mjs';
export async function moduleSource(name, { staging = false } = {}) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/' + name + '.ts', import.meta.url))],
    bundle: true,
    write: false,
    format: 'cjs',
    target: 'es2022',
    minify: true,
    plugins: staging ? [stagingBrowserPlugin(fileURLToPath(new URL('..', import.meta.url)))] : [],
  });
  return result.outputFiles[0].text;
}
export function evaluateModule(source, globals = {}) {
  const module = { exports: {} },
    context = vm.createContext({ ...globals, module });
  vm.runInContext(source, context);
  return module.exports;
}
export async function loadModule(name, globals = {}) {
  return evaluateModule(await moduleSource(name), globals);
}
