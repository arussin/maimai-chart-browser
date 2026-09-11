/* Lossless maimai-dictionary-1. Wire results are deeply frozen shared records.
   Consumers must treat catalogs as read-only; clone explicitly before mutation.
   Legacy objects pass through unchanged. Python decoding returns independent containers. */
(() => {
  'use strict';
  const fail=message=>{throw new Error(message);};
  const integer=Number.isSafeInteger;
  const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
  window.maimaiDecodeExplorationPack=value=>{
    if(!value||typeof value!=='object'||Array.isArray(value)) fail('Catalog must be an object');
    if(!Object.hasOwn(value,'wire_version')) return value;
    if(value.wire_version!=='maimai-dictionary-1'||Object.keys(value).sort().join(',')!==
       'nodes,root,schemas,strings,wire_version') fail('Unsupported wire format');
    if(bytes(value)>33554432) fail('Wire input exceeds 32 MiB');
    const {strings,schemas,nodes,root}=value;
    for(const [table,limit] of [[strings,1000000],[schemas,100000],[nodes,1000000]])
      if(!Array.isArray(table)||table.length>limit) fail('Wire table limit');
    if(strings.some(s=>typeof s!=='string')||new Set(strings).size!==strings.length)
      fail('Invalid wire string table');
    const sizes=strings.map(bytes),keySchemas=[];
    for(const schema of schemas) {
      if(!Array.isArray(schema)||schema.length>100000||schema.some(i=>
        !integer(i)||i<0||i>=strings.length)) fail('Invalid wire schema');
      const keys=schema.map(i=>strings[i]);
      if(new Set(keys).size!==keys.length||keys.some(k=>
        ['__proto__','constructor','prototype'].includes(k))) fail('Unsafe wire key');
      keySchemas.push(keys);
    }
    const costs=[];
    function cost(atom,before) {
      if(atom===null||typeof atom==='boolean') return [1,5,0];
      if(typeof atom==='number') {
        if(!Number.isFinite(atom)||(Number.isInteger(atom)&&!integer(atom))) fail('Wire number');
        return [1,bytes(atom),0];
      }
      if(!Array.isArray(atom)||atom.length!==2||!atom.every(integer)) fail('Wire atom');
      const [tag,id]=atom;
      if(tag===-1&&id>=0&&id<strings.length) return [1,sizes[id],0];
      if(tag===-2&&id>=0&&id<before) return costs[id];
      fail('Invalid or forward wire reference');
    }
    for(let i=0;i<nodes.length;i++) {
      const record=nodes[i];
      if(!Array.isArray(record)||!record.length||record.length>100001) fail('Wire record');
      const schema=record[0];
      if(!integer(schema)||schema< -1||schema>=schemas.length) fail('Wire record schema');
      if(schema>=0&&record.length!==schemas[schema].length+1) fail('Wire schema arity');
      let count=1,size=2,depth=1;
      for(const child of record.slice(1)) {const c=cost(child,i);
        count+=c[0];size+=c[1]+1;depth=Math.max(depth,1+c[2]);}
      if(schema>=0) for(const id of schemas[schema]) size+=sizes[id]+1;
      if(count>10000000||size>268435456||depth>64) fail('Wire expansion budget');
      costs.push([count,size,depth]);
    }
    cost(root,nodes.length);
    if(!Array.isArray(root)||root[0]!==-2||nodes[root[1]][0]<0) fail('Wire root object');
    const decoded=[];
    function resolve(atom) {
      if(!Array.isArray(atom)) return atom;
      if(atom[0]===-1) return strings[atom[1]];
      return decoded[atom[1]];
    }
    // Backward-only references ensure every child is already deeply frozen.
    for(const record of nodes) {
      if(record[0]===-1) {
        decoded.push(Object.freeze(record.slice(1).map(resolve)));
      } else {
        const result=Object.create(null),keys=keySchemas[record[0]];
        for(let i=0;i<keys.length;i++) result[keys[i]]=resolve(record[i+1]);
        decoded.push(Object.freeze(result));
      }
    }
    return decoded[root[1]];
  };
})();
