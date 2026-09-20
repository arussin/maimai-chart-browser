// Optional review workbook. Uses the desktop's bundled artifact-tool, never site dependencies.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const [input, output, previews] = process.argv.slice(2);
assert(input && output && previews, 'Pass review-source.json, output.xlsx and a preview directory');
assert(process.env.MAIMAI_ARTIFACT_MODULES, 'Set MAIMAI_ARTIFACT_MODULES to bundled node_modules');
const require = createRequire(path.join(process.env.MAIMAI_ARTIFACT_MODULES, '..', 'package.json'));
const {Workbook, SpreadsheetFile} = await import(pathToFileURL(require.resolve('@oai/artifact-tool')));
const source = JSON.parse(await fs.readFile(input, 'utf8'));
assert.equal(source.schema_version, 'localization-review-1');
await assert.rejects(fs.access(output), {code: 'ENOENT'}, 'Do not overwrite a review workbook');
const wb = Workbook.create();
const overview = wb.worksheets.add('Start here');
const languages = [['Korean', 'ko'], ['Chinese', 'zh-Hans'], ['Japanese', 'ja']];
const uiSheets = languages.map(([name, locale]) => ({sheet: wb.worksheets.add(`UI ${name}`), name, locale}));
const search = wb.worksheets.add('Search aliases');
const first = 8;
const colors = {ink:'#20374D', header:'#334D65', input:'#FFF3CD', line:'#D8E0E7', muted:'#526579'};
const statuses = ['Needs review', 'Approved', 'Correction proposed', 'Needs context'];
const literal = value => typeof value === 'string' && value.startsWith('=') ? "'" + value : value;
const safeRows = rows => rows.map(row => row.map(literal));
function style(sheet, lastColumn, lastRow, widths) {
  sheet.showGridLines = false;
  const body = sheet.getRange(`A1:${lastColumn}${lastRow}`);
  body.format.font = {name:'Arial',size:10,color:colors.ink};
  body.format.verticalAlignment = 'top';
  body.format.wrapText = true;
  body.format.rowHeightPx = 36;
  sheet.getRange(`A1:${lastColumn}1`).format.rowHeightPx = 14;
  sheet.getRange('A2').format.font = {name:'Arial',size:16,bold:true,color:colors.ink};
  sheet.getRange('A2').format.wrapText = false;
  sheet.getRange(`A2:${lastColumn}2`).format.rowHeightPx = 28;
  sheet.getRange(`A3:${lastColumn}3`).format.borders = {bottom:{style:'thin',color:colors.line}};
  for(const [column,width] of Object.entries(widths)) sheet.getRange(`${column}1:${column}${lastRow}`).format.columnWidthPx = width;
  sheet.getRange(`A7:${lastColumn}7`).format = {
    fill:colors.header,font:{name:'Arial',size:10,bold:true,color:'#FFFFFF'},
    rowHeightPx:42,wrapText:true,verticalAlignment:'center',horizontalAlignment:'center',
    borders:{insideVertical:{style:'thin',color:'#FFFFFF'}}
  };
  sheet.freezePanes.freezeRows(7);
  sheet.freezePanes.freezeColumns(2);
}
function height(text, width) {
  return String(text).split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil([...line].reduce((sum,c)=>sum+(c.charCodeAt(0)>255?2:1),0)/(width/6))),0)*17+16;
}
function inputRange(sheet, columns, last) {
  for(const column of columns) sheet.getRange(`${column}${first}:${column}${last}`).format.fill = colors.input;
}
function reviewFormula(row, status, reviewer, correction) {
  return `=IF(${status}${row}="Needs review","Pending",IF(${status}${row}="Needs context","Needs context",IF(${reviewer}${row}="","Reviewer needed",IF(${status}${row}="Correction proposed",IF(${correction}${row}="","Correction needed","Ready"),IF(${status}${row}="Approved",IF(${correction}${row}="","Ready","Choose correction status"),"Choose status")))))`;
}
function reviewColumns(sheet, last, status, reviewer, correction, check) {
  sheet.getRange(`${status}${first}:${status}${last}`).dataValidation = {rule:{type:'list',values:statuses}};
  sheet.getRange(`${check}${first}:${check}${last}`).formulas = Array.from({length:last-first+1},(_,i)=>[reviewFormula(first+i,status,reviewer,correction)]);
  const range = sheet.getRange(`${check}${first}:${check}${last}`);
  for(const text of ['Reviewer needed','Correction needed','Choose correction status','Choose status'])
    range.conditionalFormats.add('containsText',{text,format:{fill:'#FDE8E7',font:{color:'#9B2420'}}});
}
function addTable(sheet, address, name) {
  const table = sheet.tables.add(address,true,name);
  table.style = 'TableStyleLight1';
  table.showFilterButton = true;
  table.showBandedColumns = false;
}

for(const {sheet,name,locale} of uiSheets) {
  const rows = source.ui.map(r=>[r.feature,r.english,r.translations[locale],'','Needs review','','',r.placeholders.join(' '),'',r.source_file,r.review_id,r.source_sha256]);
  const last = first + rows.length - 1;
  style(sheet,'L',last,{A:155,B:315,C:315,D:315,E:130,F:135,G:165,H:100,I:315,J:180,K:205,L:250});
  sheet.getRange('A2').values = [[`UI ${name}`]];
  sheet.getRange('A4').values = [['Review order']];
  sheet.getRange('B4').values = [['Support first, then controls and the remaining site text.']];
  sheet.getRange('C4').values = [['Edit amber cells. Leave a correction blank to approve current text.']];
  sheet.getRange('D4').values = [['Keep placeholders such as {0} and {1} unchanged.']];
  sheet.getRange('A4:D4').format.rowHeightPx = 58;
  sheet.getRange('A7:L7').values = [['Area','English (unchanged)','Current translation','Proposed correction','Review status','Reviewer','Entry check','Placeholders','Notes or evidence','Catalog source','Review ID','Source fingerprint']];
  sheet.getRange(`A${first}:L${last}`).values = safeRows(rows);
  addTable(sheet,`A7:L${last}`,`UI${name}Review`);
  inputRange(sheet,['D','E','F','I'],last);
  reviewColumns(sheet,last,'E','F','D','G');
  rows.forEach((r,i)=>sheet.getRange(`A${first+i}:L${first+i}`).format.rowHeightPx = Math.max(52,height(r[1],315),height(r[2],315)));
}

const aliasRows = source.aliases.map(r=>[r.priority,r.title,r.artist,r.aliases.ko.join('\n'),'','Needs review','','',r.aliases['zh-Hans'].join('\n'),'','Needs review','','',r.aliases['zh-Latn'].join('\n'),r.reason,'',r.song_id,r.source_sha256]);
const aliasLast=first+aliasRows.length-1;
style(search,'R',aliasLast,{A:85,B:240,C:200,D:280,E:280,F:130,G:135,H:165,I:280,J:280,K:130,L:135,M:165,N:280,O:350,P:315,Q:320,R:250});
search.getRange('A2').values=[['Search aliases']];
search.getRange('B4').values=[['Search terms only. Keep official song titles and artists unchanged.']];
search.getRange('D4').values=[['Review every current alias. For changes, enter the complete desired list, one term per line.']];
search.getRange('I4').values=[['Simplified Chinese. Pinyin is regenerated from accepted Chinese aliases.']];
search.getRange('O4').values=[['First = unresolved scripts or words. Next = other draft entries. This is triage, not a confidence score.']];
search.getRange('A4:R4').format.rowHeightPx=88;
search.getRange('A7:R7').values=[['Priority','Official song title','Artist','Current Korean aliases','Proposed Korean aliases','Korean status','Korean reviewer','Korean entry check','Current Chinese aliases','Proposed Chinese aliases','Chinese status','Chinese reviewer','Chinese entry check','Current pinyin','Reason for review','Notes or evidence','Song ID','Source fingerprint']];
search.getRange(`A${first}:R${aliasLast}`).values=safeRows(aliasRows);
addTable(search,`A7:R${aliasLast}`,'SearchAliasReview');
inputRange(search,['E','F','G','J','K','L','P'],aliasLast);
reviewColumns(search,aliasLast,'F','G','E','H');
reviewColumns(search,aliasLast,'K','L','J','M');
aliasRows.forEach((r,i)=>search.getRange(`A${first+i}:R${first+i}`).format.rowHeightPx=Math.max(96,height(r[1],240),height(r[2],200),height(r[3],280),height(r[8],280),height(r[13],280),height(r[14],350)));

style(overview,'F',31,{A:270,B:170,C:170,D:170,E:170,F:240});
overview.freezePanes.unfreeze();
overview.tabColor=colors.ink;
overview.getRange('A2').values=[['Localization review']];
overview.getRange('A4:F4').values=[['Current phrases',source.counts.ui_phrases,'Support phrases',source.counts.support_phrases,'Queued songs',source.counts.queued_songs]];
overview.getRange('B4').setNumberFormat('#,##0');overview.getRange('D4').setNumberFormat('#,##0');overview.getRange('F4').setNumberFormat('#,##0');
for(const cell of ['B4','D4','F4']) overview.getRange(cell).format.horizontalAlignment='center';
overview.getRange('A7:F7').values=[['Review area','Entries','Ready to apply','Remaining','Needs context','Action']];
const progress=[...uiSheets.map(({sheet,name})=>[`${name} interface`,sheet.name,source.ui.length,'G','E']),['Korean search aliases',search.name,source.aliases.length,'H','F'],['Chinese search aliases',search.name,source.aliases.length,'M','K']];
progress.forEach(([label,sheetName,count,check,status],i)=>{
  const r=first+i,last=first+count-1;
  overview.getRange(`A${r}:B${r}`).values=[[label,count]];
  overview.getRange(`C${r}:E${r}`).formulas=[[
    `=COUNTIFS('${sheetName}'!${check}${first}:${check}${last},"Ready")`,
    `=B${r}-C${r}`,
    `=COUNTIFS('${sheetName}'!${status}${first}:${status}${last},"Needs context")`
  ]];
  overview.getRange(`F${r}`).values=[[i===0?'Start with Support':i<3?'Review translation and wording':'Confirm search terms and pronunciation']];
});
overview.getRange('B8:E12').setNumberFormat('#,##0');
overview.getRange('A8:F12').format.rowHeightPx=48;
overview.getRange('A15').values=[['How to review']];overview.getRange('A15').format.font.bold=true;
const guidance=[
  ['1. Choose your language','Use its UI tab. Each English phrase appears beside the current translation.'],
  ['2. Enter corrections','Edit amber cells. Use Approved for unchanged text or Correction proposed for a complete replacement.'],
  ['3. Record the reviewer','Enter a name or handle. Add evidence or a question in Notes. Use Needs context when unsure.'],
  ['4. Preserve literal text','Keep song titles, artists, version names, game labels and template placeholders unchanged.'],
  ['5. Return the workbook','Return this edited file for review and application to the canonical catalogs. Workbook edits do not update the site.'],
  ['Search coverage',`${source.counts.queued_songs} queued songs are included from a catalog of ${source.counts.catalog_songs}. Other songs are outside this queue; their absence does not mean native review.`],
  ['Search order',`${source.counts.priority.First || 0} entries marked First retain unresolved words or scripts. The remaining ${source.counts.priority.Next || 0} are other drafts.`],
  ['Provider text','Support translations cover site-owned text. Stripe controls the embedded payment form and receipts.'],
  ['Source snapshot','Catalogs: assets/locales/*.json. Aliases: assets/song-localizations.json and song-pronunciations.json.'],
  ['Snapshot ID',source.snapshot_sha256],
  ['Review status','All entries begin as Needs review. No native-speaker approval is inferred or recorded by this export.']
];
guidance.forEach(([label,text],i)=>{
  const row=16+i;overview.getRange(`A${row}`).values=[[label]];overview.getRange(`B${row}`).values=[[text]];
  // Text spans empty neighboring cells in Excel without merging working cells.
  overview.getRange(`B${row}`).format.wrapText=false;
  overview.getRange(`A${row}:F${row}`).format.rowHeightPx=30;
});
// Short lines keep the full instructions readable in the opening view.
overview.getRange('B16:B26').format.font.size=10;

// Exercise progress logic with incomplete and complete reviewer entries, then restore.
const sample=uiSheets[0].sheet;
sample.getRange('E8').values=[['Approved']];
assert.equal(sample.getRange('G8').values[0][0],'Reviewer needed');
assert.equal(overview.getRange('C8').values[0][0],0);
sample.getRange('F8').values=[['QA check']];
assert.equal(sample.getRange('G8').values[0][0],'Ready');
assert.equal(overview.getRange('C8').values[0][0],1);
sample.getRange('E8').values=[['Correction proposed']];
assert.equal(sample.getRange('G8').values[0][0],'Correction needed');
sample.getRange('D8').values=[['QA correction']];
assert.equal(sample.getRange('G8').values[0][0],'Ready');
sample.getRange('D8:F8').values=[['','Needs review','']];
wb.recalculate();
for(const row of overview.getRange('C8:C12').values) assert.equal(row[0],0);
console.log((await wb.inspect({kind:'table',range:"'Start here'!A7:F12",include:'values,formulas',tableMaxRows:6,tableMaxCols:6,maxChars:2300})).ndjson);
const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:20},maxChars:2000});
console.log(errors.ndjson);
await fs.mkdir(previews,{recursive:true});
for(const [name,range,file] of [
  [overview.name,'A1:F26','overview'],
  ...uiSheets.map(({sheet,name})=>[sheet.name,'A1:G12',name.toLowerCase()]),
  [search.name,'A1:H11','aliases-korean'],[search.name,'I7:P11','aliases-chinese']
]) {
  const image=await wb.render({sheetName:name,range,scale:1,format:'png'});
  await fs.writeFile(path.join(previews,file+'.png'),new Uint8Array(await image.arrayBuffer()));
}
await fs.mkdir(path.dirname(output),{recursive:true});
const file=await SpreadsheetFile.exportXlsx(wb);
await file.save(output);
console.log(JSON.stringify({output,ui:source.counts.ui_phrases,aliases:source.counts.queued_songs,snapshot:source.snapshot_sha256}));
