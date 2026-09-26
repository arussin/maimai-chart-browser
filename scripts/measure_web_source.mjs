/** Parse data only; never import or execute the measured source. */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';

const runtime=path.resolve(process.argv[2]);
const lockBytes=fs.readFileSync(path.join(runtime,'package-lock.json'));
const lock=JSON.parse(lockBytes),require=createRequire(path.join(runtime,'package.json'));
const versions={};
for(const name of ['acorn','esbuild']){
  const resolved=require.resolve(name+'/package.json');
  if(!resolved.startsWith(path.join(runtime,'node_modules')+path.sep))throw Error('Dependency resolved outside the explicit runtime: '+name);
  const installed=JSON.parse(fs.readFileSync(resolved,'utf8'));
  const expected=lock.packages?.['node_modules/'+name]?.version;
  if(!expected||installed.version!==expected||lock.packages[''].devDependencies[name]!==expected)throw Error('Installed dependency differs from the exact lock: '+name);
  versions[name]=expected;
}
const {parse}=require('acorn'),{transformSync}=require('esbuild');
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const hash=value=>createHash('sha256').update(value).digest('hex');
const functionTypes=new Set(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression']);
const singleDecisions=new Set(['IfStatement','ConditionalExpression','ForStatement','ForInStatement','ForOfStatement','WhileStatement','DoWhileStatement','CatchClause','LogicalExpression','AssignmentPattern']);
function children(node){return Object.values(node).flatMap(value=>Array.isArray(value)?value.filter(child=>child?.type):value?.type?[value]:[]);}
function complexity(root){
  let score=1;
  function visit(node){
    if(node!==root&&functionTypes.has(node.type))return;
    if(singleDecisions.has(node.type)||(node.type==='SwitchCase'&&node.test!==null)
      ||(node.type==='AssignmentExpression'&&['&&=','||=','??='].includes(node.operator))
      ||(['MemberExpression','CallExpression'].includes(node.type)&&node.optional))score++;
    for(const child of children(node))visit(child);
  }
  visit(root);return score;
}
function normalized(value){
  if(typeof value==='bigint')return {bigint:String(value)};
  if(Array.isArray(value))return value.map(normalized);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(key=>!['start','end','loc','range','raw'].includes(key)).map(key=>[key,normalized(value[key])]));
  return value;
}
// Decode the standard source-map VLQ positions emitted by the pinned esbuild.
function sourceLocator(raw){
  const mapping=JSON.parse(raw).mappings,alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let source=0,line=0,column=0;
  const rows=mapping.split(';').map(row=>{
    let generated=0;
    return row.split(',').filter(Boolean).map(segment=>{
      const values=[];let value=0,shift=0;
      for(const char of segment){const digit=alphabet.indexOf(char);if(digit<0)throw Error('Invalid source map');value+=(digit&31)*2**shift;if(digit&32){shift+=5;continue;}values.push(value&1?-(value>>1):value>>1);value=shift=0;}
      generated+=values[0];
      if(values.length<4)return {generated};
      source+=values[1];line+=values[2];column+=values[3];
      return {generated,source,line:line+1,column};
    });
  });
  return position=>{
    let selected;
    for(const segment of rows[position.line-1]||[]){if(segment.generated>position.column)break;if(segment.line!==undefined)selected=segment;}
    return selected?{line:selected.line,column:selected.column}:null;
  };
}
const functions=[],bodies=new Map(),fileRows=[];
for(const file of input.files){
  const typescript=file.path.endsWith('.ts');
  let code=file.source,locate=position=>position;
  if(typescript){
    const result=transformSync(code,{loader:'ts',target:'esnext',sourcefile:file.path,sourcemap:'external',sourcesContent:false,minify:false,treeShaking:false,logLevel:'silent'});
    code=result.code;locate=sourceLocator(result.map);
  }
  const ast=parse(code,{ecmaVersion:'latest',sourceType:file.path.endsWith('.cjs')?'script':'module',allowReturnOutsideFunction:file.path.endsWith('.cjs'),locations:true});
  let count=0;
  function visit(node,parent){
    if(functionTypes.has(node.type)){
      const first=locate(node.loc.start),last=locate(node.loc.end);
      const name=node.id?.name||parent?.id?.name||parent?.key?.name||parent?.key?.value
        ||(parent?.type==='AssignmentExpression'?code.slice(parent.left.start,parent.left.end).slice(0,100):'<anonymous>');
      const record={path:file.path,line:first?.line??null,column:first?.column??null,name,complexity:complexity(node),lines:first&&last?last.line-first.line+1:null,language:typescript?'typescript':'javascript'};
      // Transformed coordinates stay explicit when the source-map has no position.
      if(!first||!last)record.transformed_location={start:node.loc.start,end:node.loc.end};
      functions.push(record);count++;
      if(node.body.type==='BlockStatement'&&node.body.body.length>=5){
        const digest=hash(JSON.stringify(normalized(node.body.body)));
        if(!bodies.has(digest))bodies.set(digest,[]);
        bodies.get(digest).push({path:record.path,line:record.line,column:record.column,name});
      }
    }
    for(const child of children(node))visit(child,node);
  }
  visit(ast,null);fileRows.push({path:file.path,language:typescript?'typescript':'javascript',function_count:count});
}
function summarize(rows){
  const ordered=rows.map(row=>row.complexity).sort((a,b)=>a-b);
  return {function_count:rows.length,complexity:{mean:ordered.reduce((a,b)=>a+b,0)/Math.max(1,ordered.length),p95:ordered[Math.min(ordered.length-1,Math.floor(ordered.length*0.95))]||0,maximum:ordered.at(-1)||0},largest_functions:rows.toSorted((a,b)=>b.complexity-a.complexity||a.path.localeCompare(b.path)||a.line-b.line||a.column-b.column).slice(0,30)};
}
process.stdout.write(JSON.stringify({status:'measured',...summarize(functions),languages:Object.fromEntries(['javascript','typescript'].map(language=>[language,summarize(functions.filter(row=>row.language===language))])),files:fileRows,identical_function_bodies_at_least_5_statements:[...bodies.values()].filter(rows=>rows.length>1),runtime:{node:process.version,executable:process.execPath,packages:versions,lock_sha256:hash(lockBytes)},method:'Static branch count: 1 plus if/ternary/loop/catch/non-default switch cases, logical/nullish expressions and assignments, optional property/call operations and default arguments. Nested function bodies counted independently. Exact normalized AST body duplicates require >=5 direct statements; identifiers retained. JS parsed directly; TS types erased by pinned esbuild, locations mapped to source. TS runtime constructs can introduce compiler helpers and are included in the runtime AST; metrics are structural indicators, not behavioral proofs.'}));
