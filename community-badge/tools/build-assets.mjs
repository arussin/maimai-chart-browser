import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
if (!/^C:[\\/]DevCache[\\/]/i.test(root)) throw new Error('Build only in a current-source DevCache snapshot');
const assets = {
  artwork: (await readFile(new URL('../artwork/template.png', import.meta.url))).toString('base64'),
  flags: JSON.parse(await readFile(new URL('../artwork/flags.json', import.meta.url), 'utf8')),
  font: JSON.parse(await readFile(new URL('../artwork/lettering.json', import.meta.url), 'utf8')),
};
await writeFile(new URL('../assets.mjs', import.meta.url), 'export default ' + JSON.stringify(assets) + ';\n');
console.log('Bundled artwork, font outlines, and ' + Object.keys(assets.flags).length + ' flags; no external image/font requests.');
