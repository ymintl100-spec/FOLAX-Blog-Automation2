function recoverable(error) {
  return error?.code === 'CODEX_EXEC_FAILED' || error?.code === 'CODEX_USAGE_LIMIT';
}
const usageKeys=['total','grossTotal','inputTokens','cachedInputTokens','outputTokens','promptCharacters'];
function createRetryTask(run, options, log) {
  let model = options.codexModel;
  return async args => {
    const failedUsage=Object.fromEntries(usageKeys.map(k=>[k,0]));
    for (;;) {
      const adjusted={...args,options:{...args.options,codexModel:model}};
      for(const [offset,key] of Object.entries({tokenOffset:'total',grossTokenOffset:'grossTotal',inputTokenOffset:'inputTokens',cachedInputTokenOffset:'cachedInputTokens',outputTokenOffset:'outputTokens',promptCharacterOffset:'promptCharacters'}))adjusted[offset]=(args[offset]||0)+failedUsage[key];
      try {
        const result=await run(adjusted);
        if(!Object.values(failedUsage).some(Boolean))return result;
        return {...result,tokenUsage:{...result.tokenUsage,...Object.fromEntries(usageKeys.map(k=>[k,Number(result.tokenUsage?.[k]||0)+failedUsage[k]]))}};
      }
      catch(error) {
        for(const k of usageKeys)failedUsage[k]+=Number(error.tokenUsage?.[k]||0);
        error.tokenUsage={...failedUsage};
        if(!recoverable(error))throw error;
        const automatic=typeof args.options?.onAutoRetry==='function'&&['research','writer','humanizer','main'].includes(args.agent);
        if(automatic){
          const detail=String(error.codexExecutionDetail||error.message||'');
          if(error.code==='CODEX_USAGE_LIMIT'||/\b(?:401|403|429|unauthorized|authentication|quota|usage.limit|rate.limit)\b|로그인|인증|사용.*한도/i.test(detail))throw error;
          try{await args.options.onAutoRetry('모델 응답 재시도',detail);}catch(limit){limit.tokenUsage={...failedUsage};throw limit;}
          log('수집 자료와 마지막 원고를 유지하고 실패한 모델 응답만 자동 재시도합니다.','warn','main');continue;
        }
        if(!options.onModelError)throw error;
        log('모델 응답 오류 · 수집 자료를 유지하고 사용자 선택을 기다립니다.','warn','main');
        const choice=await options.onModelError({model, detail:error.codexExecutionDetail || error.message, code:error.code});
        if(!choice || choice.action==='cancel')throw Object.assign(new Error('사용자가 모델 재시도를 취소했습니다.'),{code:'MODEL_RETRY_CANCELLED',tokenUsage:{...failedUsage}});
        model=choice.model ?? model;
        log('사용자 요청으로 실패한 모델 호출을 다시 시도합니다.','info','main');
      }
    }
  };
}
module.exports={createRetryTask};
