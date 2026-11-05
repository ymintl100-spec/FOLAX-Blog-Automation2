'use strict';
const crypto=require('node:crypto');
const {canonicalUrl}=require('./evidenceText');
const readable=s=>Boolean(String(s?.excerpt||'').trim());
const group=s=>s.inputKind&&s.inputValue?s.inputKind+':'+s.inputValue:'';
const signature=s=>JSON.stringify([canonicalUrl(s.url||s.fetchedUrl),String(s.excerpt||'').trim()]);
const digest=s=>crypto.createHash('sha256').update(s).digest('hex').slice(0,16);
// Previously delivered IDs identify exact excerpts. Never repoint one to a new
// window, and never replace a readable input with a search snippet of its URL.
function merge(previous=[],incoming=[],selectedIds=[]){
  const records=[],ids=new Map(),exact=new Map();
  for(const [fresh,values] of [[false,previous],[true,incoming]])for(const value of Array.isArray(values)?values:[]){
    if(!value||!canonicalUrl(value.url||value.fetchedUrl))continue;
    const sig=signature(value),key=sig+'|'+group(value),duplicate=exact.get(key)||(!group(value)&&records.find(r=>r.sig===sig));
    if(duplicate){if(fresh)duplicate.fresh=true;continue;}
    let id=String(value.sourceId||'src-'+digest(sig));
    if(ids.has(id)&&ids.get(id)!==key)id='src-'+digest(key);
    while(ids.has(id)&&ids.get(id)!==key)id+='x';
    const record={value:{...value,sourceId:id},sig,fresh};records.push(record);ids.set(id,key);exact.set(key,record);
  }
  const mandatory=new Set(),seen=new Set(),selected=new Set(selectedIds);
  for(const r of records){const g=group(r.value);if(g&&readable(r.value)&&!seen.has(g)){mandatory.add(r.value.sourceId);seen.add(g);}}
  const rank=r=>mandatory.has(r.value.sourceId)?3:selected.has(r.value.sourceId)?2:r.fresh?1:0;
  const required=records.filter(r=>mandatory.has(r.value.sourceId)||selected.has(r.value.sourceId)).length;
  return records.sort((a,b)=>rank(b)-rank(a)).slice(0,Math.max(20,required)).map(r=>r.value);
}
function cachedInputs(checkpoint){return Object.values(checkpoint.inputSources||{}).flat().filter(readable);}
// Repair only a failed research checkpoint: there must be saved original text
// missing from the delivered supplement, and no completed article to rewrite.
function recover(checkpoint){
  if(checkpoint.imageCheckpoint||checkpoint.articleCheckpoint||Object.keys(checkpoint.steps||{}).some(k=>/:(?:prompt|prompt-retry-\d+)\.txt$/.test(k)))return null;
  const originals=cachedInputs(checkpoint);if(!originals.length)return null;
  const prefix=checkpoint.attemptNumber+':';
  const damaged=Object.entries(checkpoint.retrievals||{}).filter(([k,p])=>k.startsWith(prefix)&&originals.some(s=>!(p.searchResults||[]).some(v=>v.sourceId===s.sourceId&&group(v)===group(s)&&signature(v)===signature(s))));
  if(!damaged.length)return null;
  const out=JSON.parse(JSON.stringify(checkpoint));
  for(const [key,payload] of damaged)out.retrievals[key]={...payload,searchResults:merge(originals,payload.searchResults)};
  for(const key of Object.keys(out.steps||{}))if(key.startsWith(prefix)&&key.includes('research-title-search-'))delete out.steps[key];
  return out;
}
module.exports={merge,recover,cachedInputs};
