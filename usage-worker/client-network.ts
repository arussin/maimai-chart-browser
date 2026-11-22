/** A transient limiter input only. Never persist, log or return this value. */
export function clientNetwork(address:string|null):string|null {
  // Longest legal IPv6 spelling, including a dotted IPv4 tail, is 45 bytes.
  // No ports, brackets, zones, lists, whitespace or non-ASCII spellings.
  if(!address||address.length>45)return null;
  if(!address.includes(':')){
    const octets=address.split('.');
    return octets.length===4&&octets.every(part=>/^(0|[1-9]\d{0,2})$/.test(part)&&Number(part)<=255)?address:null;
  }
  if(!/^[0-9a-fA-F:.]+$/.test(address))return null;
  let canonical:string;
  // The platform IPv6 parser validates compression, hextet count and IPv4 tails.
  try{canonical=new URL('http://['+address+']/').hostname.slice(1,-1);}catch{return null;}
  const halves=canonical.split('::');
  const left=halves[0]?halves[0].split(':'):[];
  const right=halves.length===2&&halves[1]?halves[1].split(':'):[];
  const words=(halves.length===2?[...left,...Array(8-left.length-right.length).fill('0'),...right]:left).map(word=>parseInt(word,16));
  if(words.slice(0,5).every(word=>word===0)&&words[5]===0xffff){
    return [words[6]>>>8,words[6]&255,words[7]>>>8,words[7]&255].join('.');
  }
  return words.slice(0,4).map(word=>word.toString(16)).join(':')+'::/64';
}
