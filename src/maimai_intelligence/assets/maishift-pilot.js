(()=>{'use strict';
const $=id=>document.getElementById(id),i18n=maimaiI18n;
const messages={needs_baseline:'Read a baseline to start.',read_failed:'The latest read failed. Earlier test results were kept.',needs_changed_upload:'Waiting for a genuine score change. An unchanged profile is not a passed upload test.',
  mapping_or_coverage_review:'Some records need mapping or coverage review. Keep this summary.',needs_played_profile:'This profile needs played charts to test an upload.',
  timestamp_failed:'Scores changed without a newer source date. This needs review before release.',missing_records_review:'Some earlier records disappeared. This needs coverage review.',
  needs_lower_correction:'No lower corrected score was observed. This correction test is incomplete.',needs_stable_check:'The changed upload passed. Check again to confirm it is stable.',
  snapshot_changed_again:'The source changed again. Repeat the upload check when it is stable.',observed_pass:'This upload passed the observed timestamp, mapping and stability checks.'};
const errors={busy:'A read is already running.',attempt_limit:'This test has reached its six-read limit. Download the summary and start a new test tab later.',
  region_mismatch:'Maishift returned a different game region. Try the other region.',
  cooldown:'Please wait before reading again.',invalid_step:'Complete the earlier test step first.',consent_required:'Please agree to this public-profile test first.',
  invalid_profile:'Enter a valid public Maishift username or URL and matching game region.',service_unavailable:'The pilot service is not ready or is temporarily unavailable. Try again later.',
  source_failed:'The profile could not be read. Earlier test results were kept.',invalid_response:'The source response did not pass validation. Earlier test results were kept.',cancelled:'The read was cancelled.'};
let pilot=null,timer=null;
const say=value=>i18n.text($('status'),value);
function render(){
  if(!pilot)return;const state=pilot.status(),report=pilot.report(),waiting=Date.now()<state.retryAt,disabled=state.busy||waiting||state.attempts>=6;
  $('baseline').disabled=disabled||state.hasBaseline;$('updated').disabled=disabled||!state.hasBaseline;$('confirmed').disabled=disabled||!state.hasUpdated;
  $('profile').disabled=state.hasBaseline||state.busy;$('region').disabled=state.hasBaseline||state.busy;$('consent').disabled=state.hasBaseline||state.busy;
  $('clear').disabled=false;$('download').disabled=!state.attempts;$('results').hidden=!state.hasBaseline;
  if(state.attempts>=6&&!state.busy)say(errors.attempt_limit);
  i18n.text($('outcome'),messages[report.outcome]);$('counts').replaceChildren();
  const recent=report.confirmed||report.updated||report.baseline;
  if(recent)for(const [label,value]of [['Played charts: {0}',recent.played],['Exactly matched charts: {0}',recent.matched],['Unmatched charts: {0}',recent.unmatched],['Excluded records: {0}',recent.excluded],['Changed PBs: {0}',(report.changes?.added||0)+(report.changes?.changed||0)]]){
    const row=document.createElement('li');i18n.text(row,i18n.message(label,[value]));$('counts').append(row);
  }
  clearTimeout(timer);if(waiting&&!state.busy)timer=setTimeout(render,Math.min(2147483647,Math.max(50,state.retryAt-Date.now()+50)));
}
async function capture(phase){
  say('Reading the public profile…');
  const pending=pilot.capture({value:$('profile').value,region:$('region').value,consent:$('consent').checked,phase,changeKind:$('change').value});render();
  try{await pending;say('Read complete. Wait at least 30 seconds before the next check.');}catch(error){say(errors[error.message]||errors.source_failed);}render();
}
$('profile-form').onsubmit=event=>{event.preventDefault();void capture('baseline');};
$('updated').onclick=()=>{void capture('updated');};$('confirmed').onclick=()=>{void capture('confirmed');};
$('clear').onclick=()=>{pilot.clear();$('profile-form').reset();say('Test data cleared.');render();};
$('download').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(pilot.report(),null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='maishift-pilot-summary.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
window.addEventListener('pagehide',()=>{pilot?.clear();clearTimeout(timer);});
async function start(){
  try{
    if(['127.0.0.1','localhost','[::1]'].includes(location.hostname))i18n.text($('sharing-notice'),'This preview is only available on this computer. Nothing is sent automatically.');
    if(location.search||location.hash)throw Error();
    const response=await fetch('mapping.json',{credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error();const bytes=await maimaiPlayerData.bounded(response.body,12*1024*1024),config=JSON.parse(new TextDecoder().decode(bytes));
    if(config.schemaVersion!=='maishift-pilot-build-1'||! /^[a-f0-9]{64}$/.test(config.build)||config.mapping?.schema_version!=='maishift-mapping-1')throw Error();
    pilot=maimaiMaishiftPilot.create(config);say('Read a baseline to start.');render();
  }catch{say('The pilot could not start. Reload this page or contact the person who invited you.');}
}
void start();
})();
