import { readFile, writeFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { relative, isAbsolute, sep } from 'node:path';
const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const temporaryRoot = process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_TEMP
  ? await realpath(process.env.RUNNER_TEMP) : null;
const child = temporaryRoot ? relative(temporaryRoot, root) : '';
const runnerSnapshot = Boolean(child) && child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child);
if (!/^C:[\\/]DevCache[\\/]/i.test(root) && !runnerSnapshot)
  throw new Error('Build only in a current-source DevCache or GitHub runner temporary snapshot');
const assets = {
  artwork: (await readFile(new URL('../artwork/template.png', import.meta.url))).toString('base64'),
  flags: JSON.parse(await readFile(new URL('../artwork/flags.json', import.meta.url), 'utf8')),
  font: JSON.parse(await readFile(new URL('../artwork/lettering.json', import.meta.url), 'utf8')),
};
await writeFile(new URL('../assets.mjs', import.meta.url), 'export default ' + JSON.stringify(assets) + ';\n');
console.log('Bundled artwork, font outlines, and ' + Object.keys(assets.flags).length + ' flags; no external image/font requests.');
