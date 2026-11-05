'use strict';
const MAX=5;
function enabled(options={}){return options.maxAutoRetries===MAX;}
function create(saved,onSave=async()=>{},onProgress=()=>{}){
  const state=saved?JSON.parse(JSON.stringify(saved)):{version:1,used:0,max:MAX,round:1,history:[]};
  if(state.version!==1||!Number.isInteger(state.used)||state.used<0||state.used>MAX||state.max!==MAX||!Array.isArray(state.history)||state.history.length!==state.used)throw Error('자동 재시도 횟수 기록을 확인할 수 없습니다. 원고는 보존했습니다.');
  const snapshot=()=>JSON.parse(JSON.stringify(state));
  return {snapshot,async reserve(kind,reason){
    if(state.used>=MAX)throw Object.assign(Error('자동 재시도 최대 5회에 도달했습니다. 마지막 원고와 검수 지침을 보존했습니다.'),{code:'AUTO_RETRY_LIMIT'});
    state.used++;state.history.push({number:state.used,kind,reason:String(reason||'').slice(0,500),at:new Date().toISOString()});
    await onSave(snapshot());onProgress(snapshot());return true;
  },publish(){onProgress(snapshot());}};
}
function manualRound(checkpoint){
  if(!checkpoint)return checkpoint;
  const next=JSON.parse(JSON.stringify(checkpoint)),previous=next.autoRetry;
  next.generationOptions={...next.generationOptions,revisionPolicy:1,maxAutoRetries:MAX};
  next.autoRetry={version:1,max:MAX,used:0,round:(previous?.round||0)+1,history:[],priorRounds:[...(previous?.priorRounds||[]),...(previous?[{round:previous.round,used:previous.used}]:[])].slice(-10)};
  return next;
}
module.exports={MAX,enabled,create,manualRound};
