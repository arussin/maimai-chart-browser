// Frozen, inert subset of the public client's observed transport. Never eval
// upstream JavaScript or hydrate arbitrary Seroval types. See observed-contract.json.
export const ORIGIN = 'https://maimai.shiftpsh.com';
export const FUNCTIONS = Object.freeze({
  profile: '8cc17f2a26e01e823beaeca45b578af6db3bd0bc627a603a0add3b0772a33301',
  tracks: '4596ec22247ca585a111f9481e9c4ce1f2553f7b0f3fc7b98a4324205365ef54',
});
export class ImportError extends Error {
  constructor(code, status = 502, retryAt = null) { super(code); this.code = code; this.status = status; this.retryAt = retryAt; }
}
const fail = () => { throw new ImportError('contract_changed'); };
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const integer = (v, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v >= 0 && v <= max;
const text = (v, max = 512, empty = false) => typeof v === 'string' && (empty || v.length > 0) && v.length <= max && !/[\x00-\x1f\uD800-\uDFFF]/u.test(v);
const difficulty = Object.freeze({BASIC:'BASIC', ADVANCED:'ADVANCED', EXPERT:'EXPERT', MASTER:'MASTER', RE_MASTER:'RE:MASTER'});
const combos = new Set(['FULL_COMBO','FULL_COMBO_PLUS','ALL_PERFECT','ALL_PERFECT_PLUS']);
const syncs = new Set(['SYNC_PLAY','FULL_SYNC','FULL_SYNC_PLUS','FULL_SYNC_DX','FULL_SYNC_DX_PLUS']);
// The observed transport escapes strings once in addition to JSON encoding.
// Decode only its literal escape table, in one pass; never interpret JS.
const escapes = Object.freeze({'\\\\':'\\','\\"':'"','\\n':'\n','\\r':'\r','\\b':'\b','\\t':'\t','\\f':'\f','\\x3C':'<','\\u2028':'\u2028','\\u2029':'\u2029'});
const unescape = value => value.replace(/\\(?:\\|"|n|r|b|t|f|x3C|u2028|u2029)/g, token => escapes[token]);

export function validInput(v) {
  return object(v) && Object.keys(v).sort().join(',') === 'handle,manual,region' &&
    typeof v.handle === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v.handle) &&
    ['intl','jp'].includes(v.region) && typeof v.manual === 'boolean';
}
export function upstreamURL(kind, input) {
  if (!Object.hasOwn(FUNCTIONS, kind) || !validInput(input)) fail();
  const payload = {t:{t:10,i:0,p:{k:['data'],v:[{t:10,i:1,p:{k:['handle','region'],v:[
    {t:1,s:input.handle},{t:1,s:input.region === 'jp' ? 'JAPAN' : 'ASIA'},
  ]},o:0}]},o:0},f:63,m:[]};
  return ORIGIN + '/_serverFn/' + FUNCTIONS[kind] + '?payload=' + encodeURIComponent(JSON.stringify(payload));
}
export function decode(root) {
  let nodes = 0;
  function read(n, depth = 0) {
    if (++nodes > 300000 || depth > 32 || !object(n)) fail();
    switch (n.t) {
      case 0: if (typeof n.s !== 'number' || !Number.isFinite(n.s)) fail(); return n.s;
      case 1: if (typeof n.s !== 'string' || n.s.length > 8192) fail(); return unescape(n.s);
      case 2: if (![0,1,2,3].includes(n.s)) fail(); return [null,undefined,true,false][n.s];
      case 5: if (typeof n.s !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(n.s) || !Number.isFinite(Date.parse(n.s))) fail(); return n.s;
      case 9: if (!Array.isArray(n.a) || n.a.length > 20000) fail(); return n.a.map(v => read(v, depth + 1));
      case 10: case 11: {
        if (!object(n.p) || !Array.isArray(n.p.k) || !Array.isArray(n.p.v) || n.p.k.length !== n.p.v.length || n.p.k.length > 128) fail();
        const out = Object.create(null);
        n.p.k.forEach((k,i) => {
          if (typeof k !== 'string' || k.length > 128) fail();
          k = unescape(k);
          if (['__proto__','constructor','prototype'].includes(k) || Object.hasOwn(out,k)) fail();
          out[k] = read(n.p.v[i], depth + 1);
        });
        return out;
      }
      default: fail();
    }
  }
  const envelope = read(root);
  if (!object(envelope) || !Object.hasOwn(envelope,'result') || !Object.hasOwn(envelope,'error') || envelope.error != null) fail();
  return envelope.result;
}
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value) || !integer(Date.parse(value))) fail();
  return Date.parse(value);
}
export function profile(value, input) {
  if (value == null || value?.ban?.banned === true || value?.userRecord == null) throw new ImportError('profile_unavailable',404);
  if (!object(value) || value.handle !== input.handle || value.region !== (input.region === 'jp' ? 'JAPAN' : 'ASIA') || value.versionOverride !== null || value?.ban?.banned !== false) fail();
  const p = value.userRecord.profile;
  if (!object(p) || !text(p.name,200)) fail();
  const createdAt = timestamp(p.createdAt), updatedAt = timestamp(p.updatedAt);
  if (updatedAt < createdAt) fail();
  return {handle:input.handle,region:input.region,displayName:p.name,createdAt,updatedAt};
}
export function minimize(value, identity) {
  if (!object(value) || !Array.isArray(value.songs) || !Array.isArray(value.tracks) || value.songs.length > 5000 || value.tracks.length > 20000) fail();
  const records = [], diagnostics = [], ids = new Set(); let diagnosticCount = 0, played = 0;
  for (const [rowIndex,t] of value.tracks.entries()) {
    if (!object(t)) fail();
    if (t.r == null) continue;
    played++;
    if (!object(t.r)) fail();
    const song = integer(t.s) ? value.songs[t.s] : null;
    if (!integer(t.i) || t.i === 0 || !object(song) || !text(song.title,512,true) || !text(song.artist,512,true) || !['STANDARD','DX'].includes(song.type) || !Object.hasOwn(difficulty,t.d)) {
      diagnosticCount++; if (diagnostics.length < 100) diagnostics.push({rowIndex,reason:'insufficient_chart_identity'}); continue;
    }
    if (ids.has(t.i)) fail(); ids.add(t.i);
    const r = t.r;
    // Unknown numbers stay null. Invalid supplied measurements invalidate the
    // response rather than silently dropping a corrected or malformed PB.
    for (const [field,max] of [['a',1010000],['d',1000000],['m',1000000]]) if (r[field] != null && !integer(r[field],max)) fail();
    // The live source supplies fractional ratings. v1's integer rate has no
    // verified lossless conversion, so leave it unknown instead of rounding.
    if (r.g != null && (typeof r.g !== 'number' || !Number.isFinite(r.g) || r.g < 0 || r.g > 10000)) fail();
    if (r.d != null && r.m != null && r.d > r.m) fail();
    if (r.c != null && !combos.has(r.c) || r.y != null && !syncs.has(r.y)) fail();
    if (t.l != null && !integer(t.l,200) || t.dl != null && !text(t.dl,20)) fail();
    records.push({id:String(t.i),title:song.title,artist:song.artist,format:song.type === 'STANDARD' ? 'STD' : 'DX',difficulty:difficulty[t.d],
      constant:t.x === 0 ? null : t.l ?? null,level:t.dl ?? '',achievement:r.a ?? null,dxScore:r.d ?? null,maxDxScore:r.m ?? null,rate:null,lamp:r.c ?? '',sync:r.y ?? ''});
  }
  records.sort((a,b) => Number(a.id)-Number(b.id));
  return {schemaVersion:1,adapterVersion:1,provider:'maishift',identity,coverage:{kind:'partial',totalCharts:value.tracks.length,playedCharts:played,importedCharts:records.length,diagnosticCount},records,diagnostics};
}
