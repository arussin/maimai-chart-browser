import {validateDiagnostic,INSTRUMENTATION} from '../web/src/diagnostic-contract.ts';
const keys='count,day,duration,first_received_at,instrumentation,last_received_at,mode,operation,outcome,reason,source,stage,version';
const dayKey=date=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
export const diagnosticColumns='day,version,instrumentation,operation,stage,reason,outcome,source,mode,duration,count,first_received_at,last_received_at';
export const diagnosticQuery='SELECT '+diagnosticColumns+' FROM usage_diagnostics_daily';
export function diagnosticReport(rows,now=new Date()){
  if(rows===undefined)return {diagnostics:[],diagnostic_health:{schema:'unknown',last_receipt:null,collector:'unknown',coverage:'unknown'}};
  if(!Array.isArray(rows)||rows.length>50000)throw Error('Incomplete diagnostic query');
  const seen=new Set();
  const diagnostics=rows.map(row=>{
    if(!row||typeof row!=='object'||Object.keys(row).sort().join(',')!==keys||row.version!==2||!Number.isSafeInteger(row.count)||row.count<1)throw Error('Invalid diagnostic aggregate');
    const {day,version,first_received_at,last_received_at,count,...dimensions}=row;
    const safe=validateDiagnostic({...dimensions,count:1});if(!safe)throw Error('Invalid diagnostic aggregate');
    if(typeof day!=='string'||!/^\d{4}-\d\d-\d\d$/.test(day))throw Error('Invalid diagnostic day');
    for(const stamp of [first_received_at,last_received_at]){
      if(typeof stamp!=='string'||!Number.isFinite(Date.parse(stamp))||new Date(stamp).toISOString()!==stamp||dayKey(new Date(stamp))!==day||Date.parse(stamp)>now.getTime()+60000)throw Error('Invalid diagnostic receipt');
    }
    if(first_received_at>last_received_at)throw Error('Invalid diagnostic receipt range');
    const key=JSON.stringify([day,version,...Object.values({...safe,count:0})]);if(seen.has(key))throw Error('Duplicate diagnostic aggregate');seen.add(key);
    return {day,version,...safe,count,first_received_at,last_received_at};
  });
  if(!Number.isSafeInteger(diagnostics.reduce((n,r)=>n+r.count,0)))throw Error('Diagnostic count overflow');
  return {diagnostics,diagnostic_health:{schema:INSTRUMENTATION,last_receipt:diagnostics.map(r=>r.last_received_at).sort().at(-1)??null,collector:'unknown',coverage:'incomplete'}};
}
export function diagnosticMarkdown(report){
  const health=report.diagnostic_health??{schema:'unknown',last_receipt:null};
  return ['## Diagnostic outcomes','',`Schema: ${health.schema}. Latest known diagnostic receipt: ${health.last_receipt??'unknown'}. Current collector write health: unknown.`,
    'Coverage is incomplete. Opt-outs, dropped or unconfirmed sends and rejected batches cannot be reconstructed. No received rows means unknown, not zero. Schema compatibility proves the query can read this schema, not that current browsers or the collector deployed it.','',
    'The diagnostics-1 vocabulary includes additive connector categories. Older clients or collectors can lack those categories; a known receipt does not establish their rollout or coverage.','',
    '| Day | Operation | Source | Mode | Stage | Outcome | Reason | Duration | Instrumentation | Received |',
    '|---|---|---|---|---|---|---|---|---|---:|',
    ...(report.diagnostics??[]).map(r=>'| '+[r.day,r.operation,r.source,r.mode,r.stage,r.outcome,r.reason,r.duration,r.instrumentation,r.count].join(' | ')+' |'),''].join('\n');
}
