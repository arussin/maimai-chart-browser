// Inventory all prose-bearing literals in the shipped browser. Run from tests/browser.
// Acorn is a pinned development dependency, never a production build dependency.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createLiteralClassifier, isSvgPath} from './localization_literals.mjs';
const root = path.resolve(process.argv[2] || '.');
const require = createRequire(path.join(process.env.MAIMAI_NODE_MODULES_ROOT || root, 'tests/browser/package.json'));
const {parse} = require('acorn');
// These are separate historical research viewers, not part of the public chart
// browser. Runtime/catalog data are inspected by their own validators.
const excluded = new Set(['site.js','explore.js','explore-wire.js','explore-similarity.js','localization.js','song-search.js']);
export const scripts = fs.readdirSync(path.join(root,'src/maimai_intelligence/assets')).filter(name=>name.endsWith('.js')&&!excluded.has(name)).map(name=>name.slice(0,-3));
const inventory = new Map();
function templateVariants(node) {
  let values=[''], parameter=0;
  node.quasis.forEach((q,i)=>{
    values=values.map(value=>value+q.value.cooked);
    const expression=node.expressions[i];if(!expression)return;
    const choices=expression.type==='ConditionalExpression' &&
      [expression.consequent,expression.alternate].every(n=>n.type==='Literal'&&typeof n.value==='string') ?
      [expression.consequent.value,expression.alternate.value] : [`{${parameter++}}`];
    values=values.flatMap(value=>choices.map(choice=>value+choice));
  });
  return values;
}
function walk(node, visit, parent) {
  if (!node || typeof node !== 'object') return;
  if (node.type) visit(node, parent);
  for (const [key, value] of Object.entries(node)) if (!['loc','start','end'].includes(key)) {
    if (Array.isArray(value)) value.forEach(child => walk(child, visit, node));
    else if (value && typeof value === 'object') walk(value, visit, node);
  }
}
for (const name of scripts) {
  const filename = `src/maimai_intelligence/assets/${name}.js`;
  const source = fs.readFileSync(path.join(root,filename),'utf8');
  walk(parse(source,{ecmaVersion:'latest',locations:true}), (node,parent) => {
    const call=parent?.type==='CallExpression' || parent?.type==='NewExpression' ? parent : null;
    const name=call?.callee?.name || call?.callee?.property?.name;
    const argument=call?.arguments.indexOf(node);
    const copySlot={text:1,attribute:2,option:0,Option:0,make:1,element:2,svg:2,svgNode:2,message:0};
    const ui=Object.hasOwn(copySlot,name||'')&&argument===copySlot[name];
    const values=node.type==='Literal'&&typeof node.value==='string' ? [node.value] :
      node.type==='TemplateLiteral' ? templateVariants(node) : [];
    for(const raw of values) {
    if(!/[a-zA-Z]/.test(raw) || !(/\s|^[A-Z]/.test(raw)||ui) ||
       parent?.type==='Property'&&parent.key===node) continue;
    // Minification folds path templates into literals; neither carries UI prose.
    if(!ui&&isSvgPath(raw.trim()))continue;
    // Other compact interpolation protocols carry no UI prose.
    if(node.type==='TemplateLiteral'&&!ui&&!/[a-zA-Z]{2,}\s|\s[a-zA-Z]{2,}/.test(raw))continue;
    const value=raw.trim();
    if (!inventory.has(value)) inventory.set(value,[]);
    inventory.get(value).push(`${filename}:${node.loc.start.line}`);
    }
  });
}
if(process.argv.includes('--inventory')) {
  process.stdout.write(JSON.stringify(Object.fromEntries([...inventory].sort()),null,2)+'\n');
} else {
  const folder=path.join(root,'src/maimai_intelligence/assets/locales');
  const known=new Set(fs.readdirSync(folder).filter(name=>name.endsWith('.json')).flatMap(name=>{
    const catalog=JSON.parse(fs.readFileSync(path.join(folder,name),'utf8'));
    return [...Object.keys(catalog.messages||{}),...Object.keys(catalog.invariants||{})];
  }));
  const classified=createLiteralClassifier(known);
  const missing=[...inventory].filter(([text])=>!classified(text));
  for(const [text,locations] of missing) console.error(`${JSON.stringify(text)}: ${locations.join(', ')}`);
  if(missing.length) { console.error('Classify new prose in locales/messages.json and supply all translations.'); process.exitCode=1; }
}
