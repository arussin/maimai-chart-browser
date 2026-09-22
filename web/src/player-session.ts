/** Player domain functions: no DOM, persistence, telemetry or provider requests. */
export interface ChartIdentity {chart_id:string;source_hash?:string;format:string;difficulty:string}
export interface ProviderRow {chart_id:string;source_hash?:string;format?:string;difficulty?:string;acceptance_basis?:string;aliasOf?:string;expected_source?:Record<string,unknown>}
export interface ProviderMapping {schema_version:string;provider?:string;game?:string;charts:Record<string,ProviderRow>}
export interface CatalogIdentity {catalog:ChartIdentity[];provider_mapping?:ProviderMapping;maishift_mapping?:ProviderMapping}
export function providerIndex(data:CatalogIdentity,provided?:ProviderMapping|null){
  const mapping=provided??data.provider_mapping,byId=new Map(data.catalog.map(c=>[c.chart_id,c]));
  const kamaitachi=new Map<string,string[]>(),maishift=new Map<string,string|null>();
  if(mapping&&['provider-mapping-1','provider-mapping-2'].includes(mapping.schema_version)){
    for(const [id,row] of Object.entries(mapping.charts)){
      const chart=byId.get(row.chart_id);
      if(!chart||(mapping.schema_version==='provider-mapping-1'?chart.source_hash!==row.source_hash:
        !['reviewed','legacy_published','policy_exact'].includes(row.acceptance_basis??'')||chart.format!==row.format||chart.difficulty!==row.difficulty))continue;
      const ids=kamaitachi.get(chart.chart_id)??[];ids.push(id);kamaitachi.set(chart.chart_id,ids);
    }
  }
  const shifts=data.maishift_mapping;
  if(shifts?.schema_version==='maishift-mapping-1'&&shifts.provider==='maishift'&&shifts.game==='maimaidx'){
    for(const [id,row] of Object.entries(shifts.charts)){
      const chart=byId.get(row.chart_id),region=/^maishift:(intl|jp):[1-9][0-9]{0,15}$/.exec(id)?.[1];
      if(!region||!chart||row.acceptance_basis!=='reviewed'||
        !['title','artist','format','difficulty'].every(k=>typeof row.expected_source?.[k]==='string')||
        chart.format!==row.expected_source?.format||chart.difficulty!==row.expected_source?.difficulty)continue;
      const key=region+':'+chart.chart_id;maishift.set(key,maishift.has(key)?null:id);
    }
  }
  return {byId,kamaitachi,maishift};
}
export function preferredProviderID(ids:readonly string[],pbs:ReadonlyMap<string,unknown>,dates:ReadonlyMap<string,number>,mapping?:ProviderMapping|null):string|null{
  return ids.filter(id=>pbs.has(id)).sort((a,b)=>(dates.get(b)??0)-(dates.get(a)??0)||
    Number(!!mapping?.charts[a]?.aliasOf)-Number(!!mapping?.charts[b]?.aliasOf)||a.localeCompare(b))[0]??ids[0]??null;
}
