/** One bounded reader for all public content references. */
export interface SingleVerifiedRef {path:string;sha256:string;bytes:number}
export interface MultipartVerifiedRef {sha256:string;bytes:number;parts:SingleVerifiedRef[]}
export type VerifiedRef=SingleVerifiedRef|MultipartVerifiedRef;
export const MiB=1024*1024;
const digestPattern=/^[a-f0-9]{64}$/;
export const sha256=async(bytes:Uint8Array):Promise<string>=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource))].map(x=>x.toString(16).padStart(2,'0')).join('');
export function singleReference(value:unknown,folder:string,maximum:number):SingleVerifiedRef {
  if(!value||typeof value!=='object')throw Error('Invalid public data reference');
  const ref=value as SingleVerifiedRef;
  if(!digestPattern.test(ref.sha256)||ref.path!==`${folder}/${ref.sha256}.json`||!Number.isSafeInteger(ref.bytes)||ref.bytes<1||ref.bytes>maximum)throw Error('Invalid public data reference');
  return {path:ref.path,sha256:ref.sha256,bytes:ref.bytes};
}
export function multipartReference(value:unknown,folder:string,maximum:number,count:number):MultipartVerifiedRef {
  if(!value||typeof value!=='object')throw Error('Invalid catalog parts');
  const ref=value as MultipartVerifiedRef;
  if(!digestPattern.test(ref.sha256)||!Array.isArray(ref.parts)||!ref.parts.length||ref.parts.length>count)throw Error('Invalid catalog parts');
  const parts=ref.parts.map(part=>singleReference(part,folder,8*MiB));
  const bytes=parts.reduce((total,part)=>total+part.bytes,0);
  if(bytes>maximum||bytes!==ref.bytes)throw Error('Invalid catalog parts');
  return {sha256:ref.sha256,bytes,parts};
}
export class PublicReader {
  constructor(readonly base:URL){}
  async read(path:string,maximum:number,signal?:AbortSignal):Promise<Uint8Array>{
    const url=new URL(path,this.base);
    if(url.origin!==this.base.origin)throw Error('Invalid public data reference');
    const response=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',signal});
    if(!response.ok||!response.body)throw Error('Research catalog could not be loaded');
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
    try {
      for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maximum)throw Error('Research catalog exceeds its size limit');chunks.push(value);}
    }catch(error){await reader.cancel();throw error;}
    const bytes=new Uint8Array(size);let offset=0;
    for(const value of chunks){bytes.set(value,offset);offset+=value.length;}return bytes;
  }
  async verified(ref:VerifiedRef,signal?:AbortSignal):Promise<Uint8Array>{
    let bytes:Uint8Array;
    if('parts' in ref){
      bytes=new Uint8Array(ref.bytes);let offset=0;
      // Bounded concurrency applies equally to a full catalog and its startup index.
      for(let i=0;i<ref.parts.length;i+=2){
        const batch=await Promise.all(ref.parts.slice(i,i+2).map(part=>this.verified(part,signal)));
        for(const part of batch){bytes.set(part,offset);offset+=part.length;}
      }
    }else bytes=await this.read(ref.path,ref.bytes,signal);
    if(bytes.length!==ref.bytes||await sha256(bytes)!==ref.sha256)throw Error('Public data integrity check failed');
    return bytes;
  }
}
export function decodeJSON<T=unknown>(bytes:Uint8Array):T{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as T;}
