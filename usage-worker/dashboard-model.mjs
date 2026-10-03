/** Private read-only presentation of the maintained finite usage contract. */
import {VERSION, validateRow} from '../web/src/usage-contract.ts';
export const TIMEZONE = 'America/New_York';
export const dayKey = date => new Intl.DateTimeFormat('en-CA', {timeZone: TIMEZONE, year:'numeric', month:'2-digit', day:'2-digit'}).format(date);
export const addDay = (day, amount) => new Date(Date.parse(day+'T12:00:00Z')+amount*86400000).toISOString().slice(0,10);
const validDay = day => typeof day==='string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day+'T00:00:00Z')) && new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day;
const record = value => value!==null && typeof value==='object' && !Array.isArray(value);
const keys = (value, expected) => record(value) && Object.keys(value).sort().join(',')===expected.split(',').sort().join(',');
export function validateExport(input, now=new Date()) {
  if (!keys(input,'schema_version,query_status,activation,totals,coverage') || input.schema_version!=='usage-export-1' || input.query_status!=='ok' || !validDay(input.activation) || !Array.isArray(input.totals) || !Array.isArray(input.coverage)) throw Error('A successful aggregate export with an activation date is required. Missing data is not zero.');
  const today=dayKey(now), seen=new Set(), ledgerSeen=new Set();
  const totals=input.totals.map(row=>{
    if (!keys(row,'day,version,event,page,detail,failure,count') || !validDay(row.day) || row.day<input.activation || row.day>today || row.version!==VERSION || !Number.isSafeInteger(row.count) || row.count<0) throw Error('Invalid or unsupported aggregate row.');
    const safe=validateRow({event:row.event,page:row.page,detail:row.detail,failure:row.failure,count:1});
    if (!safe) throw Error('Aggregate row is outside the maintained usage contract.');
    const key=JSON.stringify([row.day,row.version,row.event,row.page,row.detail,row.failure]);
    if (seen.has(key)) throw Error('Duplicate aggregate row.'); seen.add(key);
    return {day:row.day,version:row.version,...safe,count:row.count};
  });
  const coverage=input.coverage.map(row=>{
    if (!keys(row,'day,version,status') || !validDay(row.day) || row.day<input.activation || row.day>today || row.version!==VERSION || !['complete','partial','off','unknown'].includes(row.status)) throw Error('Invalid or unsupported coverage row.');
    const key=row.day+':'+row.version; if(ledgerSeen.has(key)) throw Error('Duplicate coverage row.'); ledgerSeen.add(key);
    return {...row};
  });
  const sum=totals.reduce((n,r)=>n+r.count,0); if(!Number.isSafeInteger(sum)) throw Error('Aggregate sum exceeds safe integer range.');
  return {schema_version:'usage-export-1',query_status:'ok',activation:input.activation,totals,coverage};
}
export function makeDashboardData(input,{capturedAt,now=new Date()}={}) {
  if (!capturedAt || !Number.isFinite(Date.parse(capturedAt)) || new Date(capturedAt).getTime()>now.getTime()+60000) throw Error('A valid capture timestamp is required.');
  const exportData=validateExport(input,now),today=dayKey(now);
  return {...exportData,schema_version:'usage-dashboard-1',timezone:TIMEZONE,today,captured_at:new Date(capturedAt).toISOString(),
    limitations:['Received counts are actions, not unique people or sessions.','Launch-day totals include acceptance checks and one synthetic canary.','Missing coverage is unknown; only a completed day marked complete establishes measured zero.','Owner activity, blocked requests and dropped batches cannot be separated.']};
}
