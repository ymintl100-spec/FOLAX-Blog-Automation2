'use strict';
// Local-only, read-only FOLAX index; nothing here approves an external claim.
const fs=require('node:fs');
const path=require('node:path');
const VALID=new Set(['master_product','storefront_page','storefront_option','media_sha256','test_evidence_observation']);
const COUNT=4945;
let cache=null;
const norm=v=>String(v||'').toLocaleLowerCase('ko').replace(/\s+/g,' ').replace(/엑티브/g,'액티브').replace(/슬립업/g,'슬림업').trim();
function loadEvidence(runtimeRoot){
  const root=runtimeRoot||process.env.BLOGAUTO_RUNTIME_ROOT;
  if(!root)return {status:'INDEX_NOT_CONFIGURED',records:[]};
  const file=path.resolve(root,'folax','evidence.jsonl');
  let st;
  try{st=fs.statSync(file);}catch(e){if(e.code==='ENOENT')return {status:'INDEX_NOT_INSTALLED',records:[]};throw e;}
  if(!st.isFile()||st.size>20*1024*1024)throw Error('Invalid FOLAX local index file');
  const stamp=file+':'+st.size+':'+st.mtimeMs;
  if(cache?.stamp===stamp)return cache.result;
  const lines=fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean);
  if(lines.length!==COUNT)throw Error('FOLAX index count mismatch: '+lines.length);
  const ids=new Set();
  const records=lines.map(line=>{
    const r=JSON.parse(line);
    if(!VALID.has(r.record_type)||typeof r.record_id!=='string')throw Error('FOLAX index schema invalid');
    const key=r.record_type+':'+r.record_id;
    if(ids.has(key))throw Error('Duplicate FOLAX index record');
    ids.add(key);
    return r;
  });
  const result={status:'INTERNAL_REVIEW_ONLY',records};
  cache={stamp,result};return result;
}
function lookupEvidence({runtimeRoot,query,limit=6}={}){
  const q=norm(query);
  if(!q)return {status:'EMPTY_QUERY',matches:[],approval:false};
  const db=loadEvidence(runtimeRoot);
  if(db.status!=='INTERNAL_REVIEW_ONLY')return {status:db.status,matches:[],approval:false};
  const tokens=q.split(/\s+/).filter(t=>t.length>=2&&!['포렉스','folax','깔창'].includes(t));
  const candidates=[];
  for(const r of db.records){
    if(!['master_product','storefront_page'].includes(r.record_type))continue;
    const label=norm([r.display_name_source_master,r.observed_title].filter(Boolean).join(' '));
    if(!(tokens.length?tokens.some(t=>label.includes(t)):label.includes(q)))continue;
    const promo=/(테스트|프로모션|공동구매|전제품|한정|특가|증정|세트|오프)/i.test(r.observed_title||'');
    candidates.push({rank:(r.record_type==='master_product'?3:2)-(promo?2:0),
      record_type:r.record_type,record_id:r.record_id,
      source_title:String(r.display_name_source_master||r.observed_title||'').slice(0,130),
      source_url:String(r.source_url||'').slice(0,300),
      observed_on:String(r.observed_on||'2026-09-30').slice(0,60),
      use_status:'historical_source_only',current_claim_approved:false,publication_approved:false});
  }
  const matches=candidates.sort((a,b)=>b.rank-a.rank).slice(0,Math.max(1,Math.min(10,Number(limit)||6))).map(({rank,...item})=>item);
  return {status:'INTERNAL_REVIEW_ONLY',source_record_count:db.records.length,matches,approval:false};
}
function buildReviewBrief({runtimeRoot,topic,keyword}={}){
  const q=String(topic||'')+' '+String(keyword||'');
  if(!/(folax|포렉스|하이볼륨|아치서포트|뉴아치|슬림업|밸런스링|밸런스텝|솔리드젤|액티브\s*깔창|소프트젤)/i.test(q))return undefined;
  try{
    const r=lookupEvidence({runtimeRoot,query:q,limit:6});
    return {status:r.status,source_count:r.source_record_count||0,available_source_titles:r.matches||[],
      instructions:'이 목록은 과거 수집자료를 찾는 단서다. 현재 가격, 성능/치료 효능, 실물 SKU, 사진 권리, 현행 제품 동일성을 입증하지 않는다. 검증되지 않은 수치/홍보문구를 원고에 쓰지 말고, 공개 전 반드시 별도 검토하라.',
      external_publication_approved:false};
  }catch(e){return {status:'INDEX_INVALID',reason:String(e.message).slice(0,160),external_publication_approved:false};}
}
module.exports={loadEvidence,lookupEvidence,buildReviewBrief};
