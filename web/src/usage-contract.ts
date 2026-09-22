/** Finite public product counts. This module accepts no application state. */
export const VERSION = 1;
export const PAGES = ['charts','patterns','compare','about','song','version'] as const;
export type Page = typeof PAGES[number];
const methods=['file','report','maishift'];
export const DETAILS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  page_view:[''], settings_opened:[''], filters_opened:['catalog','personal'],
  filter_first_used:['format','region','international','difficulty','level','genre','version','bpm','constant','pattern','coverage','profile','personal_scope','grade','lamp','sync','achievement','rating'],
  filters_reset:['catalog','personal','all'], search_used:['charts','patterns','compare'],
  chart_opened:[''], chart_section_opened:['chart','player'],
  compare_requested:[''], compare_loaded:[''], similar_requested:[''],
  import_opened:[''], import_started:methods, import_completed:methods, import_failed:methods, import_cancelled:methods,
  data_action:['show','hide','forget','clear'],
  share_opened:[''], share_destination_clicked:['facebook','whatsapp','reddit','x','facebook_messenger','line','hatena','kakao','naver','wechat','sina_weibo','qzone','more'],
  share_native_result:['resolved','cancelled','failed'], share_copied:[''],
  resource_opened:['youtube','mai_notes','maishift','session_report','import_help'], report_issue_opened:['']
});
export type EventName = keyof typeof DETAILS;
export interface UsageRow {event:string;page:Page;detail:string;failure:string;count:number}
export interface Batch {version:1;events:UsageRow[]}
const failures=['invalid','unavailable','storage','unknown'];
const record=(x:unknown):x is Record<string,unknown> => x!==null&&typeof x==='object'&&!Array.isArray(x);
export function validateRow(value:unknown):UsageRow|null{
  if(!record(value)||Object.keys(value).some(k=>!['event','page','detail','failure','count'].includes(k)))return null;
  const {event,page,detail,count}=value, failure=value.failure??'';
  if(typeof event!=='string'||!Object.hasOwn(DETAILS,event)||typeof detail!=='string'||!DETAILS[event].includes(detail)||
    !PAGES.includes(page as Page)||!Number.isSafeInteger(count)||Number(count)<1||Number(count)>100)return null;
  if(typeof failure!=='string'||(event==='import_failed'?!failures.includes(failure):failure!==''))return null;
  if(['filters_opened','filter_first_used','filters_reset'].includes(event)&&!['charts','patterns','compare','version','song'].includes(String(page)))return null;
  return {event,page:page as Page,detail,failure,count:Number(count)};
}
export function validateBatch(value:unknown):Batch|null{
  if(!record(value)||Object.keys(value).sort().join(',')!=='events,version'||value.version!==VERSION||
    !Array.isArray(value.events)||!value.events.length||value.events.length>16)return null;
  const events:UsageRow[]=[];
  for(const row of value.events){const safe=validateRow(row);if(!safe)return null;events.push(safe);}
  return {version:VERSION,events};
}
