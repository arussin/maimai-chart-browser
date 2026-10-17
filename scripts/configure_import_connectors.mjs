// Local manifest preparation only: this tool has no network or credential access.
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {CONNECTOR_METHODS, normalizeConnectorFlags, parseConnectorFlags} from '../player-import-worker/connector-flags.mjs';

export function configureConnectorFlags(manifest, enable = [], disable = []) {
  const result = normalizeConnectorFlags(manifest);
  if ([...enable, ...disable].some(method => !CONNECTOR_METHODS.includes(method))) throw Error('Unknown connector method.');
  if (enable.some(method => disable.includes(method))) throw Error('A connector cannot be both enabled and disabled.');
  for (const method of enable) result.methods[method] = true;
  for (const method of disable) result.methods[method] = false;
  return result;
}

export function main(args = process.argv.slice(2)) {
  const {values} = parseArgs({args, strict:true, allowPositionals:false, options:{
    input:{type:'string'}, output:{type:'string'},
    on:{type:'string', multiple:true}, off:{type:'string', multiple:true},
    help:{type:'boolean', short:'h'},
  }});
  if (values.help) {
    process.stdout.write('Usage: node scripts/configure_import_connectors.mjs [--input manifest.json] [--on METHOD] [--off METHOD] [--output NEW-FILE.json]\n\nOnly prepares local JSON. It never reads credentials or contacts Cloudflare.\nMethods: ' + CONNECTOR_METHODS.join(', ') + '\n');
    return;
  }
  const input = values.input ?? fileURLToPath(new URL('../config/import-connectors.json', import.meta.url));
  const manifest = configureConnectorFlags(parseConnectorFlags(readFileSync(input, 'utf8')), values.on ?? [], values.off ?? []);
  const text = JSON.stringify(manifest, null, 2) + '\n';
  if (values.output) writeFileSync(values.output, text, {encoding:'utf8', flag:'wx'});
  else process.stdout.write(text);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { process.stderr.write((error instanceof Error ? error.message : 'Manifest preparation failed.') + '\n'); process.exitCode = 1; }
}
