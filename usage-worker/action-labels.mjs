/** Owner-report presentation of finite counters; never accept application text here. */
export const actionLabels = Object.freeze({
  score_export_opened: 'Image exporter opened',
  score_export_option_changed: 'Export option changed',
  score_export_started: 'Create image requested',
  score_export_completed: 'Image ready',
  score_export_failed: 'Image creation failed',
  score_export_download_clicked: 'PNG download clicked',
  best50: 'Best 50 image',
  achievement_pb: 'Personal best image',
  achievement_play: 'Recorded play image',
  clear: 'Forget / clear player data',
  file: 'Session Report file',
  report: 'Session Report URL',
  maishift: 'Maishift',
  kamaitachi: 'Kamaitachi',
  'diving-fish': 'Diving-Fish',
  lxns: 'LXNS',
  import_started: 'Import attempted',
  import_previewed: 'Import preview shown',
  import_confirmed: 'Import confirmed',
  import_completed: 'Import saved locally',
  import_cancelled: 'Import cancelled',
  import_failed: 'Import failed',
  invalid: 'Invalid input or response',
  unavailable: 'Source unavailable',
  storage: 'Local storage',
  unknown: 'Unclassified',
  popup_blocked: 'Authorization window blocked',
  authorization_failed: 'Authorization failed',
  timeout: 'Request timed out',
  network: 'Network failure',
  rate_limited: 'Rate limited',
  connection_expired: 'Connection expired or revoked',
  agreement_required: 'Tracker agreement required',
  profile_missing: 'Player profile missing',
  empty_scores: 'No supported scores',
  invalid_response: 'Invalid provider response',
  account_mismatch: 'Player identity changed',
  cleanup_required: 'Connection cleanup required',
});
export const actionLabel = value => actionLabels[value] || (value ? value.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase()) : '—');
export const isScoreExport = event => event.startsWith('score_export_');

/** Shared by the CLI and its CSP-hashed dashboard script; input is validated aggregates. */
export function summarizeImports(rows) {
  const methods=['file','report','maishift','kamaitachi','diving-fish','lxns'];
  const stages=['started','previewed','confirmed','completed','cancelled','failed'];
  const summaries=new Map(),failures=new Map();
  const receipts=(target,row)=>{
    if(row.first_received_at && (!target.first_received_at || row.first_received_at<target.first_received_at))target.first_received_at=row.first_received_at;
    if(row.last_received_at && (!target.last_received_at || row.last_received_at>target.last_received_at))target.last_received_at=row.last_received_at;
  };
  for(const row of rows){
    if(!methods.includes(row.detail)||!(row.event.startsWith('import_')||row.event.startsWith('provider_')))continue;
    let summary=summaries.get(row.detail);
    if(!summary){summary={provider:row.detail,...Object.fromEntries(stages.map(stage=>[stage,null])),first_received_at:null,last_received_at:null,latest_attempt_at:null,latest_completed_at:null,latest_failure_at:null};summaries.set(row.detail,summary);}
    const stage=row.event.startsWith('import_')?row.event.slice(7):null;
    if(stages.includes(stage))summary[stage]=(summary[stage]??0)+row.count;
    receipts(summary,row);
    const receiptKey=stage==='started'?'latest_attempt_at':stage==='completed'?'latest_completed_at':row.event.endsWith('_failed')?'latest_failure_at':null;
    if(receiptKey&&row.last_received_at&&(!summary[receiptKey]||row.last_received_at>summary[receiptKey]))summary[receiptKey]=row.last_received_at;
    if(row.event.endsWith('_failed')){
      const key=JSON.stringify([row.detail,row.event,row.failure]);
      let failure=failures.get(key);
      if(!failure){failure={provider:row.detail,event:row.event,failure:row.failure,count:0,first_received_at:null,last_received_at:null};failures.set(key,failure);}
      failure.count+=row.count;receipts(failure,row);
    }
  }
  return {summaries:[...summaries.values()].sort((a,b)=>methods.indexOf(a.provider)-methods.indexOf(b.provider)),failures:[...failures.values()].sort((a,b)=>b.count-a.count||a.provider.localeCompare(b.provider)||a.event.localeCompare(b.event)||a.failure.localeCompare(b.failure))};
}
