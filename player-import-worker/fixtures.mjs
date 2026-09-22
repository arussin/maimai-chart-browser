// Fictional records, synthesized from the frozen observed field/type contract.
// This encoder is test-only, never used to interpret a live response.
const escape = value => JSON.stringify(value).slice(1,-1).replace(/</g,'\\x3C').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
export function encode(value) {
  if (value === null) return {t:2,s:0};
  if (value === undefined) return {t:2,s:1};
  if (typeof value === 'boolean') return {t:2,s:value ? 2 : 3};
  if (typeof value === 'number') return {t:0,s:value};
  if (typeof value === 'string') return {t:1,s:escape(value)};
  if (value instanceof Date) return {t:5,i:0,s:value.toISOString()};
  if (Array.isArray(value)) return {t:9,i:0,a:value.map(encode),o:0};
  return {t:10,i:0,p:{k:Object.keys(value).map(escape),v:Object.values(value).map(encode)},o:0};
}
export const wire = value => encode({result:value,error:undefined,context:Object.create(null)});
export function publicProfile(region='ASIA') {
  return {handle:'fictional-player',region,versionOverride:null,isPrimaryRegion:true,ban:{banned:false},userRecord:{tracksComplete:false,profile:{
    name:'Fictional Player',rating:15432,createdAt:new Date('2026-01-01T00:00:00Z'),updatedAt:new Date('2026-09-20T00:00:00Z'),
    friendCode:'SYNTHETIC-PRIVATE',profileImageSrc:'https://private.example/fictional-avatar',playCount:{total:12345},
  }}};
}
export function tracks() {
  return {songs:[{title:'Fictional Song',artist:'Fictional Artist',type:'STANDARD',jacketUrl:'https://private.example/jacket'},
    {title:'Fictional Song',artist:'Fictional Artist',type:'DX'}],tracks:[
    {s:0,i:1,d:'BASIC',l:30,r:{a:987654,d:123,m:300,g:12.3456,c:'FULL_COMBO'}},
    {s:0,i:2,d:'MASTER',l:140,r:{a:1009999,d:1500,m:2000,g:315.789,y:'FULL_SYNC_DX'}},
    {s:1,i:3,d:'ADVANCED',l:70,x:0,r:{a:null,d:null,m:null,g:null}},
    {s:1,i:4,d:'RE_MASTER',l:150},
  ]};
}
