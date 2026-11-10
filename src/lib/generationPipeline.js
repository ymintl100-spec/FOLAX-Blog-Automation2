// Bounded orchestration. Only agents decide meaning, relevance and factual support.
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {sourcesFor}=require('./generationPrompts');
const {cleanPublicationUrls}=require('./publicationFormat');
const {articleCharacterCount}=require('./articleRequirements');
const {canonicalUrl}=require('./evidenceText');
const naverQuality=require('./naverQuality');
const blogLayout=require('./blogLayout');
const formats=require('./blogFormatProfiles'),rhythm=require('./readingRhythm');
const imageLayout=require('./imageLayout');
const articleTags=require('./articleTags');
const relevance=require('./articleRelevance');
const reviewContract=require('./reviewContract');
const editorialRevision=require('./editorialRevision');
const automaticRetries=require('./automaticRetries');
const researchEvidence=require('./researchEvidence');
const inputScope=require('./inputScope');
const topicReuse=require('./topicReuse');
const revisionEvidence=require('./revisionEvidence');
const {humanize,applyReview}=require('../../packages/blog-humanizer');
const {resolveImageStyle}=require('./accountImageStyle');
const normalizeTitle=s=>String(s || '').trim();
function usableImages(result,jobDir){
  if(!result)return null;
  const resolve=file=>file?(path.isAbsolute(file)?file:path.resolve(jobDir || '.',file)):'';
  const titleImagePath=resolve(result.titleImagePath);
  return {...result,titleImagePath,titleImageVerified:result.titleImageVerified===true && Boolean(titleImagePath && fs.existsSync(titleImagePath)),
    bodyImages:(result.bodyImages || []).map(image=>{const file=resolve(image.path);return {...image,path:file,summaryVerified:image.summaryVerified===true && Boolean(file && fs.existsSync(file))};})};
}
function evidenceIssue(research, sources, options={}) {
  // User-selected source-only mode checks readable input, not source authority
  // or independent corroboration. Content fidelity remains the agents' job.
  if(options.trustBlogAsSource===true)return sources.some(s=>String(s.excerpt || '').trim())?'':'요약·리뷰에 사용할 원문 내용이 필요합니다.';
  // No more searching does not mean that no evidence has been collected.
  if(research.searchNeed==='skip' && research.factBased===false && !(research.factChecks || []).some(f=>f.essential===true))return '';
  const facts=Array.isArray(research.factChecks)?research.factChecks:[];
  const byId=new Map(sources.map(s=>[s.sourceId,s]));
  if(!facts.some(f=>f.essential===true))return '핵심 주장과 원문 출처 연결(factChecks)이 필요합니다.';
  for(const fact of facts.filter(f=>f.essential===true)){
    if(fact.supported!==true || !Array.isArray(fact.sourceIds) || !fact.sourceIds.length || !fact.sourceIds.every(id=>String(byId.get(id)?.excerpt || '').trim()))return `핵심 주장 출처 연결을 확인해 주세요: ${fact.claim || ''}`;
  }
  return '';
}
const fingerprint=sources=>crypto.createHash('sha256').update(JSON.stringify(sources.map(s=>[canonicalUrl(s.url),s.excerpt]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))))).digest('hex');
async function generateAttempt(options, log, deps) {
  const progress=(message,level='info',agent='main')=>{
    log(message,level,'main');
    if(['research','writer'].includes(agent))log(message,level,agent);
  };
  const reasons=values=>[...new Set(values.filter(Boolean))].join(' / ');
  let effective={...options,searchResults:options.searchResults || [],sourceQuality:options.sourceQuality || {status:'not_requested'},...(options.revisionEvidenceContext||{}),...(options.articleResume?.evidenceContext||{})};
  const usage={total:0,grossTotal:0,inputTokens:0,cachedInputTokens:0,outputTokens:0,promptCharacters:0,agents:{},grossAgents:{},promptCharactersByAgent:{}};
  const snapshot=()=>({...usage,estimatedPromptTokens:Math.ceil(usage.promptCharacters/3)});
  const automatic=automaticRetries.enabled(options);
  const run=async(agent,prompt,file,resultFile,retryRequest,revisionBinding)=>{
    let result;
    try{result=await deps.runTask({options:effective,prompt,promptFileName:file,resultFileName:resultFile,log,agent,retryRequest,revisionBinding,
      tokenOffset:usage.total,grossTokenOffset:usage.grossTotal,inputTokenOffset:usage.inputTokens,cachedInputTokenOffset:usage.cachedInputTokens,outputTokenOffset:usage.outputTokens,promptCharacterOffset:usage.promptCharacters,agentTokenOffset:usage.agents[agent] || 0});}
    catch(error){
      const u=error.tokenUsage||{};
      for(const key of ['total','grossTotal','inputTokens','cachedInputTokens','outputTokens','promptCharacters'])usage[key]+=Number(u[key]||0);
      usage.agents[agent]=(usage.agents[agent]||0)+Number(u.total||0);usage.grossAgents[agent]=(usage.grossAgents[agent]||0)+Number(u.grossTotal||0);
      usage.promptCharactersByAgent[agent]=(usage.promptCharactersByAgent[agent]||0)+Number(u.promptCharacters||0);throw error;
    }
    const u=result.tokenUsage || {};
    for(const key of ['total','grossTotal','inputTokens','cachedInputTokens','outputTokens','promptCharacters'])usage[key]+=Number(u[key] || 0);
    usage.agents[agent]=(usage.agents[agent] || 0)+Number(u.total || 0);usage.grossAgents[agent]=(usage.grossAgents[agent] || 0)+Number(u.grossTotal || 0);
    usage.promptCharactersByAgent[agent]=(usage.promptCharactersByAgent[agent] || 0)+Number(u.promptCharacters || 0);if(u.rateLimits)usage.rateLimits=u.rateLimits;
    return result;
  };
  const repairTask=async(agent,prompt,file,resultFile,kind,apply,revisionBinding)=>{
    let previousProtocolError='';
    for(let n=0;;n++){
      const retryFile=n?file.replace(/\.txt$/,`-retry-${n}.txt`):file;
      try{return apply(await run(agent,prompt,retryFile,resultFile,{kind,reason:kind},revisionBinding));}
      catch(error){
        if(automatic)await options.onInvalidTextResult?.(retryFile,error);
        if(['REVISION_SOURCE_CHANGED','REVISION_REJECTED'].includes(error.code))throw error;
        if(automatic&&revisionBinding?.version===2&&/^REVISION_(?:RESPONSE_|PARAGRAPH_|BEFORE_|FINGERPRINT_)/.test(error.code||'')){
          if(previousProtocolError===error.code)throw Object.assign(Error(error.message+' 같은 응답 형식 오류가 연속 두 번 발생해 추가 호출을 중지했습니다.'),{code:'REPEATED_RESPONSE_PROTOCOL'});
          previousProtocolError=error.code;
        }
        if(!automatic||error.code==='AUTO_RETRY_LIMIT'||error.code==='MODEL_RETRY_CANCELLED'||error.code==='CODEX_USAGE_LIMIT'||error.code==='CODEX_EXEC_FAILED')throw error;
        if(n>=automaticRetries.MAX)throw error;
        progress('마지막 원고 보존 · 응답 보완: '+error.message,'warn','writer');
        prompt+='\n직전 응답 오류: '+error.message+' 같은 응답을 반복하지 말고 전달된 원문 범위에서 실제 수정 또는 올바른 판정을 반환하세요.';
      }
    }
  };
  let research=null,writer=null,review=null,retrievalStopped=false,reuseReviewed=false,reuseLogged=false;
  const inspectReuse=async value=>{
    if(!topicReuse.enabled(effective)||value?.novelty?.duplicate!==true)return value;
    if(!reuseLogged){progress('기존 소재와 중복되지만 작성 계속 · 근거와 품질은 그대로 검수합니다.','info','research');reuseLogged=true;}
    if(value.status==='PASS'||reuseReviewed)return value;
    reuseReviewed=true;
    return run('research',deps.researchRetry({...effective,researchRevisionContext:topicReuse.instruction(effective)+' 이전 중복 사유로 생략한 자료 판단과 작성 기획을 완료하세요. 실제 근거가 부족하면 구체적으로 밝히세요.'},value),'research-topic-reuse.txt','research-title-result.json',{kind:'중복 소재 허용 검토',reason:value.novelty.reason||'기존 소재 재사용'});
  };
  const resume=options.imageCheckpoint;
  let finalTitle='';
  const failed=(phase,reason,failureKind=phase==='humanizer'?'execution':'quality')=>({status:'failed',failureKind,retrievalStopped,failurePhase:phase,failureReason:reason,relevanceReport:writer?relevance.report(writer,{...effective,researchTitleResult:research},review):null,title:writer?.title || '',article:writer?.article || '',tags:writer?.tags || [],bodyImages:[],titleImagePath:'',notes:[reason],researchTitleResult:research,mainReviewResult:review,tokenUsage:snapshot()});
  const usesImages=options.includeTitleImage!==false || deps.bodyImageLimit(options.maxBodyImages)>0;
  if(resume){
    if(resume.version!==1 || resume.review?.status!=='PASS' || !resume.writer?.article || !resume.title)throw new Error('저장된 이미지 재개 원고가 유효하지 않습니다. 기존 작업을 확인하세요.');
    research=resume.research;writer=imageLayout.normalize(cleanPublicationUrls(resume.writer),{renumber:false});review=resume.review;finalTitle=resume.title;
    // Older checkpoints kept evidence only under recovery.retrievals. Restoring
    // the article without it falsely rejects valid citations before any call.
    effective={...effective,...(resume.evidenceContext || options.imageEvidenceContext)};
    effective.formatGuidance=formats.resolve(effective.formatGuidance,research,effective.experienceNotes);
    const resumedIssue=reasons([deps.writerIssue(writer,{...effective,researchTitleResult:research}),deps.imagePromptIssue(writer,effective)]);
    if(resumedIssue)return failed('image_resume',`저장된 원고의 이미지 재개 확인이 필요합니다. 본문은 다시 쓰지 않았습니다: ${resumedIssue}`,'execution');
    options.onResearchTitle?.(research);
    progress('승인된 본문 재사용 · 조사·본문 생성·윤문·검수를 건너뛰고 이미지 단계부터 재개합니다.');
  }else{
  // One initial planning/research call; at most two evidence rounds. Never re-run on identical retrieval.
  progress('주제 조사 1차 시작','info','research');
  research=await run('research',deps.researchPrompt(effective),'research-title-prompt.txt','research-title-result.json');
  research=await inspectReuse(research);
  options.onResearchTitle?.(research);
  if(!topicReuse.enabled(effective)&&research.novelty?.duplicate===true)return {...failed('title_duplicate',research.novelty.reason || '최근 발행 글과 소재가 중복됩니다.'),status:'duplicate_retry',title:research.finalTitle || ''};
  const scoped=inputScope.enabled(effective);
  if(scoped&&research.status==='BLOCK')return failed('research',research.failureReason||'입력 링크의 핵심 내용을 지원할 수 없습니다.');
  let planProblem=inputScope.planIssue(research,effective);
  if(planProblem&&research.status!=='BLOCK'){
    progress('입력 링크 주제 기획 응답 보완 · 원문과 키워드 연결을 확인합니다.','info','research');
    research=await run('research',deps.researchRetry({...effective,researchRevisionContext:planProblem},research),'research-input-scope.txt','research-title-result.json',{kind:'링크 주제 기획 보완',reason:planProblem});
    research=await inspectReuse(research);
    options.onResearchTitle?.(research);planProblem=inputScope.planIssue(research,effective);
  }
  if(planProblem){await options.onInvalidTextResult?.('research-input-scope.txt',Object.assign(Error(planProblem),{code:'INPUT_SCOPE_RESPONSE'}));return failed('research',planProblem,'execution');}
  let issue=evidenceIssue(research,effective.searchResults,effective);
  for(let round=1;round<=2 && (research.status==='REVISION' || (research.status==='PASS' && issue));round++){
    if(effective.inputBrief?.mode==='links'||typeof options.onSearchNeeded!=='function' || research.searchNeed==='skip')break;
    const before=fingerprint(sourcesFor({...effective,researchTitleResult:research}));
    progress(`주제 조사 ${round}차 · 자료 보강 필요: ${reasons([research.failureReason,issue]) || '추가 원문 확인 요청'} · 검색 보강 ${round}/2 시작`,'info','research');
    if(scoped&&inputScope.planIssue(research,effective))break;
    const request=inputScope.queryRequest(research,effective);
    if(scoped&&!request.searchQueries.length)break;
    const payload=await options.onSearchNeeded(request,{round,previousSearchResults:effective.searchResults,sourceQuality:effective.sourceQuality,inputScope:scoped?research.linkScope:undefined,inputBrief:scoped?effective.inputBrief:undefined});
    const sources=researchEvidence.merge(effective.searchResults,payload?.searchResults,(research.factChecks||[]).flatMap(f=>f.sourceIds||[]));
    if(before===fingerprint(sourcesFor({...effective,searchResults:sources,researchTitleResult:research}))){retrievalStopped=true;issue=sources.length?'새로운 원문 근거가 없어 추가 검토·전체 재시도를 중지했습니다.':'선택한 검색 범위에서 읽을 수 있는 원문을 확보하지 못해 추가 검토·전체 재시도를 중지했습니다.';log(issue,'warn','research');break;}
    const deliveredKey=normalizeTitle(research.finalTitle)+'|'+fingerprint(sourcesFor({...effective,searchResults:sources,researchTitleResult:research}));
    if(options.reviewedEvidence?.has(deliveredKey)){retrievalStopped=true;issue='이 주제의 동일 근거는 앞선 시도에서 검토하여 추가 호출·전체 재시도를 중지했습니다.';log(issue,'warn','research');break;}
    options.reviewedEvidence?.add(deliveredKey);
    effective={...effective,searchResults:sources,sourceQuality:payload.sourceQuality,researchRevisionContext:issue};
    progress(`주제 조사 ${round+1}차 · 보강 자료 검토 시작`,'info','research');
    research=await run('research',deps.researchRetry(effective,research),`research-title-search-${round}.txt`,'research-title-result.json');
    research=await inspectReuse(research);
    options.onResearchTitle?.(research);issue=reasons([evidenceIssue(research,sources,effective),inputScope.planIssue(research,effective)]);
    if(!topicReuse.enabled(effective)&&research.novelty?.duplicate===true)return {...failed('title_duplicate',research.novelty.reason || '최근 발행 글과 소재가 중복됩니다.'),status:'duplicate_retry',title:research.finalTitle || ''};
  }
  if(scoped&&research.status!=='BLOCK'&&(research.status!=='PASS'||issue)){
    progress('보강 자료 검토 후 원문 범위로 최종 기획 조정 · 추가 검색 없이 확인합니다.','info','research');
    research=await run('research',deps.researchRetry({...effective,researchRevisionContext:reasons([issue,research.failureReason])+' 추가 검색은 끝났습니다. 입력 링크의 실제 대상·사용 목적 범위로 제목과 필수 주장을 다시 정리하세요. 지원되지 않는 확장 주장은 제외하며 링크의 핵심 자체가 지원되지 않으면 BLOCK하세요.'},research),'research-input-final.txt','research-title-result.json',{kind:'입력 링크 범위 조정',reason:issue||research.failureReason});
    research=await inspectReuse(research);
    options.onResearchTitle?.(research);issue=reasons([evidenceIssue(research,effective.searchResults,effective),inputScope.planIssue(research,effective)]);
  }
  if(!topicReuse.enabled(effective)&&research.novelty?.duplicate===true)return {...failed('title_duplicate',research.novelty.reason||'최근 발행 글과 소재가 중복됩니다.'),status:'duplicate_retry',title:research.finalTitle||''};
  issue=reasons([issue,require('./inputWorkflow').analysisIssue(research,effective.inputBrief)]);
  if(research.status!=='PASS' || issue)return failed('research',[research.failureReason,issue].filter(Boolean).filter((s,i,a)=>a.indexOf(s)===i).join('\n') || '핵심 주장의 근거를 확보하지 못했습니다.');
  if(options.revisionEvidenceContext?.research?.finalTitle===research.finalTitle)research=JSON.parse(JSON.stringify(options.revisionEvidenceContext.research));
  finalTitle=normalizeTitle(research.finalTitle);if(!finalTitle)return failed('research','최종 제목이 없습니다.');
  effective.formatGuidance=formats.resolve(effective.formatGuidance,research,effective.experienceNotes);
  if(!topicReuse.enabled(effective)&&(options.publishedTopics || []).length){
    if(!topicReuse.enabled(effective)&&research.novelty?.duplicate===true)return {...failed('title_duplicate',research.novelty.reason || '최근 발행 글과 소재가 중복됩니다.'),status:'duplicate_retry',title:finalTitle};
    if(research.novelty?.duplicate!==false || !String(research.novelty.reason || '').trim())return failed('research','최근 발행 글과의 소재 중복 판단이 누락됐습니다. 본문 생성을 중지했습니다.');
  }
  const duplicate=topicReuse.enabled(effective)?null:await options.onFinalTitleCandidate?.(finalTitle,research);
  if(duplicate?.duplicate)return {...failed('title_duplicate',duplicate.reason || '동일한 제목이 있습니다.'),status:'duplicate_retry',title:finalTitle};
  progress('주제 선정 통과 · 본문 작성으로 이동','info','research');
  const guided=effective.revisionPolicy===1,seed=guided?options.articleResume:null,maxWrites=automatic?(seed?5:6):guided?3:2;
  let reviewPending=Boolean(seed?.reviewPending);
  let feedback=seed?.feedback||'',layoutRepairUsed=false,scopeRepairUsed=false,formatCorrections=0,qualityCorrections=0,correctionKind='';
  if(seed?.writer){writer=JSON.parse(JSON.stringify(seed.writer));if(seed.research)research=JSON.parse(JSON.stringify(seed.research));correctionKind=seed.phase==='writer'?'format':'quality';if(correctionKind==='format')formatCorrections++;else qualityCorrections++;progress('마지막 원고·완료 조사·검수 지침 재사용 · 지적된 부분만 보완합니다.','info','writer');}
  const saveArticle=()=>options.onArticleCheckpoint?.({version:1,writer,review,research,feedback,evidenceContext:{searchResults:effective.searchResults,sourceQuality:effective.sourceQuality}});
  const supplementEvidence=async(error)=>{
    if(!automatic||!revisionEvidence.eligible(error,effective)||typeof options.onSearchNeeded!=='function')return false;
    const requestKey=revisionEvidence.key(writer,error.message),queryList=revisionEvidence.queries(writer,research,effective,error);
    for(let round=1;round<=queryList.length;round++){
      if(options.getAutoRetryState?.()?.used>=5)break;
      progress('분량·중복 보완에 필요한 키워드 자료 보강 · 원고는 보존합니다.','info','research');
      const before=new Set((effective.searchResults||[]).map(s=>JSON.stringify([s.sourceId,s.excerpt])));
      const payload=await options.onSearchNeeded({...research,searchNeed:'light',searchQueries:[queryList[round-1]],verificationQueries:[]},{round,writerSupplement:true,supplementKey:requestKey,writerIssueReason:error.message,previousSearchResults:effective.searchResults,inputScope:research.linkScope||{articleScope:research.topicThesis||writer.title,links:[]},inputBrief:effective.inputBrief});
      effective={...effective,searchResults:researchEvidence.merge(effective.searchResults,payload?.searchResults,(research.factChecks||[]).flatMap(f=>f.sourceIds||[])),sourceQuality:payload?.sourceQuality||effective.sourceQuality};
      const candidateIds=effective.searchResults.filter(s=>String(s.excerpt||'').trim()&&!before.has(JSON.stringify([s.sourceId,s.excerpt]))).map(s=>s.sourceId);
      await saveArticle();
      if(!candidateIds.length){progress('새로 읽은 보강 원문 없음 · 다음 키워드 질문을 확인합니다.','warn','research');continue;}
      const evidenceOptions={...effective,revisionEvidenceCandidates:candidateIds,researchTitleResult:{...research,factChecks:[...(research.factChecks||[]),...candidateIds.map(id=>({sourceIds:[id]}))]}};
      const file=`writer-evidence-${requestKey}-${round}.txt`;
      let result=await run('research',revisionEvidence.reviewPrompt(writer,research,evidenceOptions,error.message),file,`writer-evidence-${requestKey}-${round}.json`);
      let supported;
      try{supported=revisionEvidence.accepted(result,research,effective.searchResults,candidateIds);}catch(problem){await options.onInvalidTextResult?.(file,problem);throw problem;}
      if(supported){research=supported;await saveArticle();progress('보강 원문 사용 가능 · 같은 제목·저장 원고의 필요한 문단만 보완합니다.','info','writer');return true;}
      progress('현재 원고에 쓸 수 없는 보강 자료 · 다음 키워드 질문을 확인합니다.','warn','research');
    }
    return false;
  };
  // A nearby length miss joins the same content review. Other format errors
  // have one separate correction, so they cannot consume the quality repair.
  for(let attempt=1;attempt<=maxWrites;attempt++){
    const previousWriter=writer;
    let params={...effective,topic:finalTitle,researchTitleResult:research,writerRevisionFeedback:feedback,writerAttempt:attempt,maxWriterAttempts:maxWrites};
    const partial=guided&&writer&&correctionKind!=='format';
    progress(`본문 ${attempt}차 ${partial?'부분 보완':attempt===1?'작성':'형식 보완'} 시작`,'info','writer');
    if(reviewPending){reviewPending=false;progress('보강 원고 재사용 · 본문 재작성 없이 검수부터 재개합니다.','info','writer');}
    else if(partial){
      const requestKey=editorialRevision.requestKey(writer,feedback,effective);
      if(!automatic&&options.blockedRevisionRequest===requestKey)return failed('article_revision','동일 원고와 동일 지적의 부분 수정에서 변경이 없었습니다. 중복 모델 호출을 생략했습니다. 원고 또는 입력 근거를 보완해 주세요.','execution');
      let patchRound=0;
      for(;;){
        const binding=effective.revisionProtocol===2?editorialRevision.context(writer):null;
        const file=patchRound?`article-revision-${attempt}-evidence-${patchRound}.txt`:`article-revision-${attempt}.txt`;
        try{writer=await repairTask('writer',editorialRevision.repairPrompt(writer,feedback,params,binding),file,`article-revision-result-${attempt}.json`,'본문 부분 보완',patch=>editorialRevision.apply(writer,patch,binding,params),binding?{version:2,sourceFingerprint:binding.sourceFingerprint}:undefined);break;}
        catch(error){
          if(error.code==='REVISION_REJECTED'){
            try{if(await supplementEvidence(error)){patchRound++;params={...params,...effective,researchTitleResult:research};continue;}}catch(problem){await saveArticle();return failed('article_revision',problem.message,'execution');}
          }
          if(!automatic&&error.code==='NO_REVISION_CHANGE')await options.onBlockedRevisionRequest?.(requestKey);
          await saveArticle();return {...failed('article_revision',error.message,'execution'),failureStep:file};
        }
      }
    }else try{writer=await run('writer',attempt===1&&!writer?deps.writerPrompt(params):deps.writerRetry(params,writer),attempt===1?'prompt.txt':`prompt-retry-${attempt}.txt`,'agent-result.json',attempt>1||seed?{kind:'본문 형식 보완',reason:feedback}:undefined);}catch(error){if(error.code==='AUTO_RETRY_LIMIT')return failed('writer',error.message,'execution');throw error;}
    if(writer?.status==='failed'&&revisionEvidence.eligible({message:writer.failureReason,diagnostic:{failureCode:writer.failureCode}},effective)){
      const error=Object.assign(Error(writer.failureReason||'본문을 작성할 근거가 부족합니다.'),{diagnostic:{failureCode:writer.failureCode}});
      await options.onInvalidTextResult?.(attempt===1?'prompt.txt':`prompt-retry-${attempt}.txt`,error);
      if(previousWriter?.status==='success')writer=previousWriter;
      else writer={...writer,title:finalTitle,article:String(writer.article||'')};
      feedback=editorialRevision.feedback([feedback,error.message],effective);
      try{if(await supplementEvidence(error)){correctionKind=writer.status==='success'?'quality':'format';await saveArticle();continue;}}catch(problem){return failed('writer',problem.message,'execution');}
      return failed('writer',error.message);
    }
    review=null;
    const cleanWriter=cleanPublicationUrls(writer);
    writer=imageLayout.normalize(cleanWriter);
    if(writer.article!==cleanWriter.article)progress('이미지 마커 표기·번호 정리 · 본문 문장은 유지했습니다.','info','writer');
    const contentQualityIssue=options.qualityPolicyVersion===1?naverQuality.articleIssue(writer):'';
    if(writer?.article)writer={...writer,article:rhythm.apply(writer.article,effective.formatGuidance,effective.writingGuidance)};
    const lengthLimits=require('./articleRequirements').limits(effective);
    progress(`본문 ${attempt}차 글자수: 공백 제외 ${articleCharacterCount(writer.article)}자 · ${lengthLimits.enforced===false?'목표 약 '+lengthLimits.target+'자 · 분량 차이로 중단하지 않습니다':'기준 '+lengthLimits.min+'~'+lengthLimits.max+'자'}`,'info','writer');
    const writerIssue=deps.writerIssue(writer,params),layoutIssue=blogLayout.issue(writer,effective);
    const deferredLength=guided&&qualityCorrections===0&&!layoutIssue&&!contentQualityIssue&&editorialRevision.deferLength(writer,effective,writerIssue)?writerIssue:'';
    const textStructural=reasons([deferredLength?'':writerIssue,layoutIssue,contentQualityIssue,options.qualityPolicyVersion===1?naverQuality.articleIssue(writer):'']);
    await saveArticle();
    if(deferredLength)progress('분량 보정은 내용 검수 지침과 한 번에 반영합니다. 현재 원고는 아직 통과하지 않았습니다.','info','writer');
    let imageStructural=deps.imagePromptIssue(writer,effective);
    if(!textStructural&&imageStructural){
      progress('본문 문장 보존 · 이미지 배치만 보완합니다: '+imageStructural,'warn','writer');
      if(layoutRepairUsed&&!automatic)return failed('image_layout','이미지 배치 보완 한도에 도달했습니다. 원고와 완료된 단계를 보존했습니다.','execution');
      layoutRepairUsed=true;
      try{
        const repaired=await repairTask('writer',imageLayout.repairPrompt(writer,effective),`image-layout-repair-${attempt}.txt`,`image-layout-result-${attempt}.json`,'이미지 배치 보완',placements=>imageLayout.applyRepair(writer,placements,effective));
        imageStructural=deps.imagePromptIssue(repaired,effective);
        if(imageStructural)throw Error(imageStructural);
        writer=repaired;progress('이미지 배치 보완 완료 · 본문 재작성 없이 최종 검수로 이동','info','writer');
      }catch(error){return failed('image_layout','본문을 보존했습니다. 이미지 배치 보완 확인이 필요합니다: '+error.message,'execution');}
    }
    const structural=reasons([textStructural,imageStructural]);
    if(structural){
      progress(`본문 ${attempt}차 형식 확인 실패: ${structural}`,'warn','writer');
      if(automatic&&effective.revisionEvidencePolicy===1&&writerIssue===require('./articleRequirements').articleLengthIssue(writer,effective)&&articleCharacterCount(writer.article)<lengthLimits.min&&!layoutIssue&&!imageStructural){
        try{if(await supplementEvidence(Error(writerIssue))){feedback=editorialRevision.feedback([feedback,structural],effective);correctionKind='quality';await saveArticle();continue;}}catch(problem){return failed('writer',problem.message,'execution');}
      }
      if(writer.failureCode!=='INSUFFICIENT_EVIDENCE'&&(automatic?attempt<maxWrites:guided?formatCorrections<1&&attempt<maxWrites:attempt===1)){formatCorrections++;correctionKind='format';feedback=editorialRevision.feedback([feedback,structural],effective);await saveArticle();continue;}
      return failed('writer',structural);
    }
    if([10,15,30].includes(effective.tagCount)){
      writer={...writer,tags:articleTags.normalize(writer.tags,effective.tagCount)};
      const tagIssue=articleTags.issue(writer,effective);
      if(tagIssue){
        progress('본문 문장 보존 · 태그만 '+effective.tagCount+'개로 정리합니다: '+tagIssue,'warn','writer');
        try{
          writer=await repairTask('writer',articleTags.repairPrompt(writer,effective),`tags-repair-${attempt}.txt`,`tags-result-${attempt}.json`,'태그 보완',tagResult=>articleTags.applyRepair(writer,tagResult,effective));
        }catch(error){return {...failed('tags','본문을 보존했습니다. 태그 정리 확인이 필요합니다: '+error.message,'execution'),failureStep:`tags-repair-${attempt}.txt`};}
      }
      progress('주제 관련 태그 '+effective.tagCount+'개 정리 완료 · 본문과 별도로 저장','info','writer');
    }
    let humanized={article:writer.article,changes:[],cached:false};
    if(effective.tokenSaving!==false){
      progress('작성 응답에서 문장 다듬기 완료 · 별도 윤문 호출 없이 최종 검수로 이동','info','writer');
    }else{
    progress(`본문 ${attempt}차 작성 완료 · 블로그 문장 다듬기 시작`,'info','writer');
    options.onArticleReady?.({...writer,previewStage:'humanizing',writerAttempt:attempt});
    const originalWriter=writer;
    try {
      humanized=await humanize({article:writer.article,title:finalTitle,category:effective.category,tone:effective.preferredTone,revisionInstructions:feedback}, {
        cacheDir:effective.jobDir?path.join(effective.jobDir,'humanizer-cache'):undefined,
        signal:options.signal,
        complete:prompt=>run('humanizer',prompt+`\nOutput JSON file: ${path.join(effective.jobDir || '.',`humanizer-result-${attempt}.json`)}\nSave the JSON file, then print BLOGAUTO_RESULT_READY.`, `humanizer-prompt-${attempt}.txt`,`humanizer-result-${attempt}.json`)
      });
      writer=imageLayout.normalize({...writer,article:require('./publicationFormat').omitReferences(humanized.article)});
      const issue=reasons([deps.writerIssue(writer,params),deps.imagePromptIssue(writer,effective)]);
      if(issue&&!(guided&&editorialRevision.deferLength(writer,effective,issue))){
        progress(`윤문 후 본문 조건 보완 필요: ${issue}`,'warn','writer');
        if(automatic?attempt<maxWrites:guided?formatCorrections<1&&attempt<maxWrites:attempt===1){formatCorrections++;correctionKind='format';feedback=editorialRevision.feedback([feedback,issue],effective);await saveArticle();continue;}
        return failed('writer',issue);
      }
    } catch(error) {
      writer=originalWriter;
      progress(`본문 문장 다듬기 중지 · 원본 보존: ${error.message}`,'warn','writer');
      return failed('humanizer',`본문을 보존했습니다. 문장 다듬기 단계 확인이 필요합니다: ${error.message}`);
    }
    progress(humanized.cached?'저장된 윤문 결과 재사용 · 검수 시작':humanized.changes.length?'블로그 문장 다듬기 완료 · 검수 시작':'불필요한 문장 수정 없이 원문 유지 · 검수 시작','info','writer');
    }
    options.onArticleReady?.({...writer,previewStage:'reviewing',writerAttempt:attempt});
    review=await run('main',deps.reviewPrompt({...effective,researchTitleResult:research,writerResult:writer,finalTitle,revisionFocus:guided?feedback:undefined,humanizerChanges:humanized.changes}),`main-review-${attempt}.txt`,'main-review-result.json');
    review=require('./articleRequirements').advisoryReview(review,effective);
    const scopeIssue=reviewContract.violation(review);
    if(scopeIssue){
      progress('본문 보존 · 검수 단계 오류를 한 번 바로잡습니다: '+scopeIssue,'warn','writer');
      if(scopeRepairUsed&&!automatic)return failed('main_review',scopeIssue+' 본문과 완료 단계를 보존했습니다.','execution');
      scopeRepairUsed=true;
      try{review=await repairTask('main',deps.reviewPrompt({...effective,researchTitleResult:research,writerResult:writer,finalTitle,revisionFocus:guided?feedback:undefined,humanizerChanges:humanized.changes,reviewContractCorrection:scopeIssue}),`main-review-scope-${attempt}.txt`,'main-review-result.json','검수 단계 보완',value=>{const issue=reviewContract.violation(value);if(issue&&automatic)throw Error(issue);return value;});}catch(error){return failed('main_review',error.message,'execution');}
      review=require('./articleRequirements').advisoryReview(review,effective);
      const repeatedScope=reviewContract.violation(review);
      if(repeatedScope)return failed('main_review',repeatedScope+' 본문은 재작성하지 않았습니다.','execution');
    }
    try {
      const reviewed=applyReview(writer.article,humanized.changes,review.humanizerDecisions);
      writer=imageLayout.normalize({...writer,article:reviewed.article});
      writer={...writer,article:rhythm.apply(writer.article,effective.formatGuidance,effective.writingGuidance)};
      if(reviewed.restoredIds.length)progress('메인 검증 · 불필요하거나 의미가 달라질 수 있는 윤문을 원문으로 복원했습니다.','info','writer');
    }catch(error){return failed('main_review',error.message,'execution');}
    if(review.relevanceEvidence)review={...review,relevanceInputHash:relevance.inputHash(writer)};
    const relevanceOptions={...effective,researchTitleResult:research};
    await saveArticle();
    const reviewEvidenceIssue=reasons([options.qualityPolicyVersion===1?naverQuality.reviewEvidenceIssue(review,writer,effective):'',relevance.evidenceIssue(review,writer,relevanceOptions),inputScope.reviewEvidenceIssue(review,writer,effective),require('./writingRequest').evidenceIssue(review,writer,effective)]);
    if(reviewEvidenceIssue){
      if(!automatic)return failed('main_review',reviewEvidenceIssue,'execution');
      try{review=await repairTask('main',deps.reviewPrompt({...effective,researchTitleResult:research,writerResult:writer,finalTitle,revisionFocus:feedback,humanizerChanges:humanized.changes,reviewContractCorrection:reviewEvidenceIssue}),`main-review-evidence-${attempt}.txt`,'main-review-result.json','검수 응답 보완',value=>{value=require('./articleRequirements').advisoryReview(value,effective);const issue=reasons([reviewContract.violation(value),naverQuality.reviewEvidenceIssue(value,writer,effective),relevance.evidenceIssue(value,writer,relevanceOptions),inputScope.reviewEvidenceIssue(value,writer,effective),require('./writingRequest').evidenceIssue(value,writer,effective)]);if(issue)throw Error(issue);return value;});await saveArticle();}
      catch(error){return failed('main_review',error.message,'execution');}
    }
    review=require('./articleRequirements').advisoryReview(review,effective);
    const relevanceReport=relevance.report(writer,relevanceOptions,review);
    if(effective.relevancePolicy===1)progress(`앱 내부 연관성: ${relevanceReport.score??'미측정'}/100 · 목표 95 · NDEX 외부 점수와 별도`,'info','writer');
    const reviewIssue=reasons([inputScope.reviewIssue(review,effective),require('./writingRequest').reviewIssue(review,effective),relevance.qualityIssue(writer,relevanceOptions,review),deps.writerIssue(writer,params),deps.imagePromptIssue(writer,effective),deps.reviewIssue(review),blogLayout.issue(writer,effective),options.qualityPolicyVersion===1?[naverQuality.verdictIssue(review,effective),naverQuality.articleIssue(writer)].filter(Boolean).join(' / '):'']);
    if(review.status==='PASS' && !reviewIssue){progress(`본문 ${attempt}차 검수 통과`,'info','writer');break;}
    progress(`본문 ${attempt}차 검수 ${review.status==='BLOCK'?'중단':'반려'}: ${reasons([reviewIssue,review.failureReason,...(review.revisionInstructions || [])]) || '구체적인 수정 지침 없음'}${(automatic?attempt<maxWrites:guided?attempt<maxWrites&&qualityCorrections<1:attempt===1) && review.status!=='BLOCK'?' · 지적된 부분 보완 준비':' · 검수 지침 보존'}`,'warn','writer');
    if(review.status==='BLOCK')return failed('main_review',reviewIssue || review.failureReason || '핵심 근거가 없어 중지했습니다.');
    feedback=editorialRevision.feedback([reviewIssue,review.failureReason,review.issues||[],review.revisionInstructions||[]],effective);
    await saveArticle();
    if(guided){
      const finalWriterIssue=deps.writerIssue(writer,params),needsFormat=Boolean(finalWriterIssue);
      const needsQuality=review.status!=='PASS'||Boolean(reasons([inputScope.reviewIssue(review,effective),require('./writingRequest').reviewIssue(review,effective),relevance.qualityIssue(writer,relevanceOptions,review),deps.reviewIssue(review),naverQuality.verdictIssue(review,effective)]));
      if(attempt===maxWrites||!automatic&&(needsQuality&&qualityCorrections>=1||needsFormat&&formatCorrections>=1))return failed('main_review',reviewIssue || review.failureReason || '수정 후에도 기준을 충족하지 못했습니다. 마지막 원고와 검수 지침을 보존했습니다.');
      if(needsQuality)qualityCorrections++;if(needsFormat)formatCorrections++;correctionKind=needsQuality?'quality':'length';
    }else if(attempt===2)return failed('main_review',reviewIssue || review.failureReason || '최종 검수에서 핵심 수정이 필요합니다.');
    if(!feedback)return failed('main_review','구체적인 수정 지침 없이 재생성을 요청하여 중지했습니다.');
  }
  }
  const relevanceReport=relevance.report(writer,{...effective,researchTitleResult:research},review);
  writer={...writer,relevanceReport,boldSentences:require('./emphasis').select(writer,review,effective)};
  const writingApplication=blogLayout.report(writer,effective);
  options.onArticleReady?.({...writer,previewStage:'approved',writingApplication});
  let savedImages=usableImages(resume?.images,options.jobDir);
  const checkpoint=()=>options.onImageCheckpoint?.({version:1,title:finalTitle,writer,research,review,images:savedImages,
    evidenceContext:{searchResults:effective.searchResults,sourceQuality:effective.sourceQuality},
    imageOptions:{includeTitleImage:options.includeTitleImage,maxBodyImages:options.maxBodyImages,titleImageAspectRatio:options.titleImageAspectRatio,bodyImageAspectRatio:options.bodyImageAspectRatio}});
  const needsImageWork=usesImages && (options.includeTitleImage!==false || writer.bodyImages?.length>0);
  if(options.minimumImageCount===4)progress(`이미지 계획: 대표 ${options.includeTitleImage!==false?1:0}장 · 본문 ${writer.bodyImages?.length || 0}장 · 총 최소 4장`);
  if(needsImageWork)await checkpoint();
  effective.accountImageStylePrompt='';
  if(needsImageWork){
    try{
      effective.accountImageStylePrompt=await resolveImageStyle({
        read:options.getAccountImageStyle || (()=>options.accountImageStyle || {}),exists:fs.existsSync,log:progress,
        analyze:style=>run('imageStyle',deps.stylePrompt({...effective,...style}),'image-style-prompt.txt','image-style-result.json'),
        save:(source,result)=>options.onAccountImageStylePrompt?.({...result,sampleImageHash:source.sampleImageHash},source)
      });
    }catch(error){const reason=`본문은 보존했습니다. 이미지 스타일 확인 실패: ${error.message}`;progress(reason,'warn');return {...writer,status:'success',publishable:false,failurePhase:'image',failureKind:'execution',failureReason:reason,notes:[reason],tokenUsage:snapshot(),researchTitleResult:research,mainReviewResult:review};}
  }
  let result={...writer,title:finalTitle,publishable:true};
  if(needsImageWork){
    let images=savedImages,issue=images?deps.imageIssue(images,writer,effective):'이미지 생성 필요';
    for(let attempt=1;attempt<=(automatic?6:2);attempt++){
      if(images && !issue)break;
      progress(`이미지 ${attempt}차 ${attempt===1?'생성':'보완'} 시작`);
      const request=images?deps.pendingImages(writer,images,effective):writer;
      try{
        const feedback=images?[issue,images.failureReason,...(images.notes || [])].filter(Boolean).join(' / ').slice(0,2500):'';
        const generated=await run('image',deps.imagePrompt({...effective,researchTitleResult:research,articleOpening:String(writer.article || '').slice(0,900),includeTitleImage:images?Boolean(request.titleImagePrompt):effective.includeTitleImage!==false,writerResult:request,finalTitle,imageRevisionFeedback:feedback}),`image-worker-${attempt}.txt`,'image-worker-result.json',attempt>1?{kind:'미완료 이미지 보완',reason:feedback}:undefined);
        images=deps.mergeImages(images,usableImages(generated,options.jobDir));savedImages=images;await checkpoint();issue=deps.imageIssue(images,writer,effective);if(!issue){progress('이미지 생성 및 확인 완료');break;}
        progress(`이미지 ${attempt}차 확인: ${issue}`,'warn');
      }catch(error){
        // Execution failures already pass through the user-controlled model retry.
        // Do not retry again here: the user may have cancelled, or images may
        // have been generated before the response was lost. Only a returned
        // image verification failure permits the targeted correction above.
        issue=error.message;progress(`이미지 ${attempt}차 생성 실패: ${issue}`,'warn');break;
      }
    }
    result=deps.applyImages(result,images || {},effective);
    if(issue){result.publishable=false;result.failurePhase='image';result.failureKind='execution';result.failureReason=issue;result.notes=[...(result.notes || []),`본문은 보존했습니다. 이미지 확인 후 발행하세요: ${issue}`];log(result.notes.at(-1),'warn','image');}
  }
  return {...result,relevanceReport:relevance.report(result,{...effective,researchTitleResult:research},review),status:'success',writingApplication,researchTitleResult:research,mainReviewResult:review,tokenUsage:snapshot()};
}
async function generate(options,log,deps) {
  options={tokenSaving:true,qualityPolicyVersion:1,...options};
  const restored=options.generationCheckpoint;
  if(restored && restored.version!==2)throw new Error('재개 기록 버전을 확인할 수 없습니다. 기존 작업을 취소한 뒤 다시 시작하세요.');
  const optionKeys=['tokenSaving','qualityPolicyVersion','writingGuidance','formatGuidance','compactWriting','maxAutoRetries','revisionProtocol','revisionEvidencePolicy','allowDuplicateTopics','inputScopePolicy','revisionPolicy','articleLengthPolicy','emphasisPolicy','inputBrief','relevancePolicy','tagCount','requireApproval','operationsTopicId','operationsDraft','approvedEditorial','requiredWritingInstructions','contentPolicy','platform','blogDirection','writingRequest','experienceNotes','experienceNotesId','topic','keyword','category','topicMode','currentDateLabel','includeTitleImage','maxBodyImages','minimumImageCount','titleImageAspectRatio','bodyImageAspectRatio','excludedTopics','publishPurpose','preferredTone','freshnessLevel','searchChannel','trustBlogAsSource','keywordLanes','recommendedKeywordLanes','historyTitles','searchResults','sourceQuality'];
  const requestedAutomatic=automaticRetries.enabled(options);
  const recovery=restored?JSON.parse(JSON.stringify(restored)):{version:2,steps:{},retrievals:{},generationOptions:Object.fromEntries(optionKeys.filter(k=>options[k]!==undefined).map(k=>[k,options[k]])),attemptNumber:1};
  if(restored&&options.articleLengthPolicy===4&&recovery.generationOptions.articleLengthPolicy!==4){
    recovery.generationOptions.articleLengthPolicy=4;
    if(!recovery.imageCheckpoint){
      if(recovery.articleCheckpoint?.writer?.status==='success'){
        const saved=recovery.articleCheckpoint;
        recovery.articleResume={version:1,writer:saved.writer,review:saved.review,research:saved.research,feedback:saved.feedback||'',phase:'main_review',evidenceContext:saved.evidenceContext,reviewPending:true};
        delete recovery.articleCheckpoint;
      }
      if(recovery.articleResume)recovery.articleResume.reviewPending=true;
      for(const key of Object.keys(recovery.steps||{}))if(key.includes('main-review'))delete recovery.steps[key];
    }
    log('저장 원고·완료 자료 보존 · 분량은 약 2000자 권장 목표로 전환합니다. 글자수 차이만으로 중단하지 않습니다.','info','writer');
  }
  if(restored&&requestedAutomatic&&!Object.hasOwn(recovery.generationOptions,'maxAutoRetries')){recovery.generationOptions.maxAutoRetries=5;recovery.generationOptions.revisionPolicy=1;}
  if(restored&&topicReuse.enabled(options))recovery.generationOptions.allowDuplicateTopics=true;
  if(restored&&options.revisionEvidencePolicy===1)recovery.generationOptions.revisionEvidencePolicy=1;
  if(restored&&options.revisionProtocol===2)recovery.generationOptions.revisionProtocol=2;
  if(restored&&options.revisionEvidencePolicy===1&&!recovery.articleResume&&recovery.articleCheckpoint?.research?.revisionEvidenceSourceIds?.length){const saved=recovery.articleCheckpoint,continued=editorialRevision.recover(recovery,'article_revision',saved.feedback||'보강 자료를 확인했습니다. 저장 원고부터 이어갑니다.');if(continued){continued.articleResume.reviewPending=!saved.review;Object.assign(recovery,continued);}}
  if(restored&&options.inputScopePolicy===1){const centered=inputScope.recover(recovery);if(centered){Object.assign(recovery,centered);log('입력 링크의 주제·사용 목적을 중심으로 기획 재검토 · 저장된 수집 자료는 유지합니다.','info','research');}}
  if(restored){const repaired=researchEvidence.recover(recovery);if(repaired){Object.assign(recovery,repaired);log('저장된 입력 원문·출처 ID 복원 · 보강 조사 검토만 다시 진행합니다.','info','research');}}
  options={...options,...recovery.generationOptions};
  if(restored)for(const key of ['maxAutoRetries','revisionProtocol','revisionEvidencePolicy','allowDuplicateTopics','inputScopePolicy','revisionPolicy','emphasisPolicy','inputBrief','relevancePolicy','tagCount','minimumImageCount','articleLengthPolicy','approvedEditorial','requiredWritingInstructions','contentPolicy','platform','requireApproval','operationsTopicId','operationsDraft','compactWriting','writingRequest','experienceNotes','experienceNotesId','blogDirection','writingGuidance','formatGuidance'])if(!Object.hasOwn(recovery.generationOptions,key))options[key]=undefined;
  options.writingRequest=require('./writingRequest').normalize(options.writingRequest);
  if(typeof(options.experienceNotes??'')!=='string'||String(options.experienceNotes||'').length>2000)throw new Error('이번 글의 실제 경험 메모는 2,000자 이내로 입력하세요.');
  if(options.formatGuidance?.version>=3&&options.formatGuidance.id==='essay'&&!String(options.experienceNotes||'').trim())return {status:'failed',failureKind:'execution',failurePhase:'input',failureReason:'일상·경험형에는 이번 글의 실제 경험 메모가 필요합니다. 경험을 입력하거나 자동·건강 설명형을 선택하세요.',article:'',title:''};
  const saveRecovery=async()=>{await options.onGenerationCheckpoint?.(JSON.parse(JSON.stringify(recovery)));};
  let retryBudget;
  if(automaticRetries.enabled(options)){
    retryBudget=automaticRetries.create(recovery.autoRetry,async state=>{recovery.autoRetry=state;await saveRecovery();},state=>{options.onRetryProgress?.(state);if(state.used)log(`자동 재시도 ${state.used}/${state.max} · ${state.history.at(-1)?.kind||''}`,'info','main');});
    recovery.autoRetry=retryBudget.snapshot();retryBudget.publish();
  }
  await saveRecovery();
  if(options.inputBrief){
    try{
      options.inputBrief=require('./inputWorkflow').normalize(options.inputBrief);
      recovery.inputSources ||= {};
      const sources=await require('./inputWorkflow').collect(options.inputBrief,recovery.inputSources,{readLink:options.readInputLink,searchKeyword:options.searchInputKeyword,save:saveRecovery,log:message=>log(message,'info','research'),deferKeywordSearch:inputScope.enabled(options)});
      if(inputScope.enabled(options))log('입력 링크 주제 우선 분석 · 부족한 설명만 입력 키워드로 검색합니다.','info','research');
      options.searchResults=researchEvidence.merge(sources,options.searchResults);
      recovery.generationOptions.searchResults=options.searchResults;await saveRecovery();
    }catch(error){return {status:'failed',failureKind:'execution',failurePhase:'input_links',failureReason:error.message,article:'',title:''};}
  }
  if(options.writingRequest)log('작성 요청 적용 · 조사·구성·본문·검수에 반영합니다. 실제 경험으로 간주하지 않습니다.','info','main');
  options.onWritingApplication?.({...blogLayout.report(null,options),experienceNotesId:options.experienceNotesId||'',resumed:Boolean(restored)});
  if(restored)log('중단된 생성 작업 재개 · 완료된 단계는 저장 결과를 재사용합니다.','info','main');
  const limit=retryBudget?1:options.tokenSaving===false && ['auto','manual'].includes(options.topicMode)?3:1;
  const reviewedEvidence=new Set(recovery.priorEvidence || []),attemptedQueries=new Set(recovery.priorQueries || []);
  const attempts=[...(recovery.priorAttempts || [])];const totals={total:0,grossTotal:0,inputTokens:0,cachedInputTokens:0,outputTokens:0,promptCharacters:0,agents:{}};
  const persist=()=>{if(options.jobDir)fs.writeFileSync(path.join(options.jobDir,'attempts.json'),JSON.stringify(attempts,null,2));};
  let result;
  for(let number=recovery.attemptNumber || 1;number<=limit;number++) {
    recovery.attemptNumber=number;await saveRecovery();
    const jobDir=options.jobDir?path.join(options.jobDir,`attempt-${number}`):undefined;
    if(jobDir)fs.mkdirSync(jobDir,{recursive:true});
    const entry={attempt:number,status:'running',startedAt:new Date().toISOString(),steps:[]};attempts.push(entry);persist();
    log(`${retryBudget?'작업 단계':`전체 시도 ${number}/${limit}`} · ${number===1?'주제 조사 시작':options.topicMode==='auto'?'실패 근거를 반영해 다른 주제·범위 탐색':'입력 주제를 유지하고 검색 방법 변경'}`,'info','main');
    const priorAttempts=attempts.slice(0,-1).map(a=>({title:a.title,reason:a.reason,phase:a.phase,queries:a.queries}));
    const runTask=async args=>{
      const key=number+':'+args.promptFileName;
      const binding=args.revisionBinding?{...args.revisionBinding,promptHash:crypto.createHash('sha256').update(args.prompt).digest('hex')}:null;
      if(recovery.steps[key]&&binding){
        const saved=recovery.stepBindings?.[key];
        if(!(saved?.version===binding.version&&saved.sourceFingerprint===binding.sourceFingerprint&&saved.promptHash===binding.promptHash)){delete recovery.steps[key];if(recovery.stepBindings)delete recovery.stepBindings[key];await saveRecovery();}
      }
      if(recovery.steps[key]){
        log(`${args.agent} 완료 결과 재사용`,'info','main');
        return {...JSON.parse(JSON.stringify(recovery.steps[key])),tokenUsage:{}};
      }
      const step={step:entry.steps.length+1,agent:args.agent,kind:args.promptFileName.startsWith('tags-repair-')?'tags':args.promptFileName.startsWith('image-layout-repair-')?'image_layout':args.agent,startedAt:new Date().toISOString()};entry.steps.push(step);persist();
      const adjusted={...args,options:{...args.options,...(retryBudget?{onAutoRetry:retryBudget.reserve}:{} )}};
      if(retryBudget&&args.retryRequest)await retryBudget.reserve(args.retryRequest.kind,args.retryRequest.reason);
      for(const [offset,key] of Object.entries({tokenOffset:'total',grossTokenOffset:'grossTotal',inputTokenOffset:'inputTokens',cachedInputTokenOffset:'cachedInputTokens',outputTokenOffset:'outputTokens',promptCharacterOffset:'promptCharacters'}))adjusted[offset]=(args[offset] || 0)+totals[key];
      adjusted.agentTokenOffset=(args.agentTokenOffset || 0)+(totals.agents[args.agent] || 0);
      try {
        const value=await deps.runTask(adjusted);
        // Image outputs are checkpointed after merging, style is keyed by the
        // live sample identity. Neither may be replayed by task filename alone.
        if(!['image','imageStyle'].includes(args.agent)){
          recovery.steps[key]=JSON.parse(JSON.stringify(value));if(binding){recovery.stepBindings||={};recovery.stepBindings[key]=binding;}await saveRecovery();
        }
        Object.assign(step,{status:value.status,reason:value.failureReason || '',title:value.finalTitle || value.title || '',tokenUsage:value.tokenUsage,finishedAt:new Date().toISOString()});
        if(jobDir){const base=String(step.step).padStart(2,'0')+'-'+args.agent;fs.writeFileSync(path.join(jobDir,base+'-result.json'),JSON.stringify(value,null,2));fs.writeFileSync(path.join(jobDir,base+'-prompt.txt'),args.prompt);}
        persist();return value;
      }catch(error){Object.assign(step,{status:'execution_error',reason:error.message,finishedAt:new Date().toISOString()});persist();throw error;}
    };
    try {
      result=await generateAttempt({...options,jobDir,attemptNumber:number,maxAttempts:limit,priorAttempts,reviewedEvidence,
        revisionEvidenceContext:recovery.revisionEvidenceContext?.attemptNumber===number?recovery.revisionEvidenceContext:undefined,getAutoRetryState:()=>retryBudget?.snapshot(),imageCheckpoint:recovery.imageCheckpoint,articleResume:recovery.articleResume,blockedRevisionRequest:recovery.blockedRevisionRequest,
        onInvalidTextResult:async(file,error)=>{delete recovery.steps[number+':'+file];if(recovery.stepBindings)delete recovery.stepBindings[number+':'+file];if(jobDir)fs.appendFileSync(path.join(jobDir,'revision-response-diagnostics.jsonl'),JSON.stringify({file,code:error?.code||'INVALID_RESPONSE',message:error?.message||'',detail:error?.diagnostic||{},at:new Date().toISOString()})+'\n');await saveRecovery();},
        onBlockedRevisionRequest:async key=>{recovery.blockedRevisionRequest=key;await saveRecovery();},
        onArticleCheckpoint:async value=>{recovery.articleCheckpoint=JSON.parse(JSON.stringify(value));if(value.research?.revisionEvidenceSourceIds?.length)recovery.revisionEvidenceContext={attemptNumber:number,research:JSON.parse(JSON.stringify(value.research)),...JSON.parse(JSON.stringify(value.evidenceContext))};await saveRecovery();},
        imageEvidenceContext:require('./generationRecovery').imageEvidenceContext(recovery),
        onImageCheckpoint:async checkpoint=>{recovery.imageCheckpoint=checkpoint;await saveRecovery();},
        onSearchNeeded:options.onSearchNeeded?async(research,context)=>{
          const retrievalKey=context.writerSupplement?`${number}:writer:${context.supplementKey}:${context.round}`:number+':'+context.round;
          if(recovery.retrievals[retrievalKey]){
            for(const key of recovery.retrievalQueries?.[retrievalKey] || [])attemptedQueries.add(key);
            return JSON.parse(JSON.stringify(recovery.retrievals[retrievalKey]));
          }
          const freshQueries=(queries,scope)=>(queries || []).filter(q=>{const normalized=String(q).replace(/\s+/g,' ').trim().toLowerCase();const key=scope+':'+normalized;if(!normalized || attemptedQueries.has(key))return false;attemptedQueries.add(key);return true;});
          const supplement=context.round>1;
          const verification=options.trustBlogAsSource===true?[]:freshQueries((research.verificationQueries || []).slice(0,supplement?2:1),'verification');
          const fresh=freshQueries((research.searchQueries || []).slice(0,supplement?Math.max(0,2-verification.length):2),'discovery');
          if(!fresh.length && !verification.length){log('이미 실행한 검색어뿐이어서 동일 검색을 생략합니다.','warn','research');return {searchResults:context.previousSearchResults};}
          if(context.writerSupplement&&retryBudget)await retryBudget.reserve('키워드 자료 보강',context.writerIssueReason);
          entry.queries=[...(entry.queries || []),...fresh,...verification];persist();
          const fetched=await options.onSearchNeeded({...research,searchQueries:fresh,verificationQueries:verification},{...context,attempt:number});
          const payload={...fetched,searchResults:researchEvidence.merge(context.previousSearchResults,fetched?.searchResults,(research.factChecks||[]).flatMap(f=>f.sourceIds||[]))};
          recovery.retrievals[retrievalKey]=payload;
          recovery.retrievalQueries ||= {};recovery.retrievalQueries[retrievalKey]=[...attemptedQueries];await saveRecovery();
          const visible=sourcesFor({searchResults:payload?.searchResults || [],researchTitleResult:research});
          const searchRecord={round:context.round,queries:fresh,verificationQueries:verification,deliveredSources:visible};
          if(jobDir)fs.writeFileSync(path.join(jobDir,`search-${context.round}.json`),JSON.stringify(searchRecord,null,2));
          return payload;
        }:undefined},log,{...deps,runTask});
    }catch(error){entry.status='execution_error';entry.reason=error.message;entry.finishedAt=new Date().toISOString();persist();error.attempts=attempts;throw error;}
    const u=result.tokenUsage || {};
    for(const key of ['total','grossTotal','inputTokens','cachedInputTokens','outputTokens','promptCharacters'])totals[key]+=Number(u[key] || 0);
    for(const [agent,n] of Object.entries(u.agents || {}))totals.agents[agent]=(totals.agents[agent] || 0)+n;
    if(u.rateLimits)totals.rateLimits=u.rateLimits;
    Object.assign(entry,{status:result.status,phase:result.failurePhase || '',verdict:result.researchTitleResult?.status || '',reason:result.failureReason || '',title:result.researchTitleResult?.finalTitle || result.title,tokenUsage:u,finishedAt:new Date().toISOString()});persist();
    if(result.status==='success')break;
    if(result.status==='duplicate_retry'){
      log('기존 발행 소재와 중복되어 검색·본문·이미지 생성을 더 진행하지 않습니다.','warn','main');
      break;
    }
    if(result.failureKind==='execution'){
      // A returned but invalid response is not a completed step. Re-run only
      // that agent, retaining its preceding accepted results.
      const agent=result.failurePhase==='humanizer'?'humanizer':result.failurePhase==='main_review'?'main':result.failurePhase==='image_layout'?'image_layout':result.failurePhase==='tags'?'tags':result.failurePhase==='article_revision'?'article_revision':null;
      if(agent){const prefix=number+':';const keys=Object.keys(recovery.steps).filter(k=>k.startsWith(prefix) && (['tags','article_revision'].includes(agent)?k===prefix+result.failureStep:agent==='humanizer'?k.includes('humanizer-prompt'):agent==='image_layout'?k.includes('image-layout-repair-'):k.includes('main-review')));if(keys.length)delete recovery.steps[keys.at(-1)];await saveRecovery();}
      break;
    }
    if(['writer','main_review','humanizer'].includes(result.failurePhase)){
      result.contentRevisionStopped=true;
      log(result.failurePhase==='humanizer'?'윤문 단계 중지: 원본 본문을 보존하고 주제 재탐색·전체 재생성을 중지했습니다.':options.revisionPolicy===1?'본문 보완 종료 · 마지막 원고와 검수 지침을 보존했습니다. 추가 전체 재생성은 하지 않습니다.':'본문 보완 종료: 같은 근거로 한 번 수정한 뒤에도 통과하지 못해 주제 재탐색·전체 재생성을 중지했습니다.','warn','main');
      break;
    }
    if(result.retrievalStopped){log(`전체 시도 ${number}/${limit} · 추가 조사 중지: ${entry.reason}`,'warn','main');break;}
    log(`${retryBudget?'작업 보완 중단':`전체 시도 ${number}/${limit}`} · ${entry.phase || '생성'} 단계 종료: ${entry.reason}`,'warn','main');
    recovery.priorAttempts=JSON.parse(JSON.stringify(attempts));recovery.priorQueries=[...attemptedQueries];recovery.priorEvidence=[...reviewedEvidence];
    // Execution/quota errors throw; a preserved draft with incomplete images returns success.
  }
  totals.estimatedPromptTokens=Math.ceil(totals.promptCharacters/3);
  return {...result,autoRetry:retryBudget?.snapshot(),attempts,tokenUsage:totals,failureReason:result.status==='success'?result.failureReason:`${result.status==='duplicate_retry'?'중복 소재 제외':result.contentRevisionStopped?'본문 보완 중단':result.retrievalStopped?'검색 근거 확보 중단':retryBudget?`작업 보완 중단 · 자동 재시도 ${retryBudget.snapshot().used}/5 사용`:`전체 ${attempts.length}회 시도 소진`} · ${result.failureReason || '생성 실패'}`};
}
module.exports={generate,evidenceIssue};
