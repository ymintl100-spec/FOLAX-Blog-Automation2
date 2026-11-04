'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {generate}=require('../src/lib/generationPipeline'),R=require('../src/lib/editorialRevision'),L=require('../src/lib/articleRequirements'),P=require('../src/lib/generationPrompts'),runner=require('../src/lib/codexRunner')._private,{retryPlan}=require('../src/lib/historyRetry');
const title='종아리 스트레칭 도구, 꼭 준비해야 할까요?',opening='종아리 스트레칭은 도구를 고르기 전에 움직임의 조건을 먼저 살펴볼 수 있습니다.',help='벽을 이용한 자세와 경사면에서의 자세는 발을 두는 바닥의 조건이 다릅니다.';
const source={sourceId:'fixture-source',url:'https://example.org/fixture',excerpt:'벽 자세와 경사면 자세의 실제 차이, 움직임 조건을 다룬 검증용 원문입니다.'};
const research={status:'PASS',finalTitle:title,searchNeed:'skip',factBased:true,factChecks:[{claim:'검증용 원문 범위',essential:true,supported:true,sourceIds:[source.sourceId]}],novelty:{duplicate:false,reason:'검증용 신규 질문'},writerContract:{relevancePlan:{primaryKeyword:'종아리 스트레칭',relatedConcepts:['벽 자세','경사면']},oldLength:'본문 공백 제외 1000~1200자'}};
function writer(n=1177,images=false){
 const w={status:'success',title,article:opening+'\n\n[SECTION - 벽에서 살펴볼 자세]\n'+help+'\n\n[SECTION - 도구를 고를 때]\n',citations:[{sourceId:source.sourceId,url:source.url}],tags:Array.from({length:10},(_,i)=>'스트레칭조건'+i),bodyImages:[],titleImagePrompt:'',titleImageText:[],boldSentences:[opening]};
 if(images){w.titleImagePrompt='벽 자세와 경사면의 조건을 나란히 보여주는 검증용 그림';w.titleImageText=['도구 선택 전 조건'];w.bodyImages=[1,2,3].map(sequence=>({sequence,sectionHeading:'도구를 고를 때',prompt:'서로 다른 자세 조건을 나타내는 검증용 장면 '+sequence}));w.article+='\n'+w.bodyImages.map(i=>'[IMAGE INSERT - '+i.sequence+']').join('\n')+'\n\n';}
 // Counts are exact test fixtures; these are never presented as real AI prose.
 w.article+='원고 길이 검증을 위한 설명입니다.'+'검'.repeat(n-L.articleCharacterCount(w.article)-L.articleCharacterCount('원고 길이 검증을 위한 설명입니다.'));assert.equal(L.articleCharacterCount(w.article),n);return w;
}
function review(w,pass=true){return {status:pass?'PASS':'REVISION',publishable:pass,articleAnswersTitle:true,topicPreserved:true,factualityPass:true,sourceUsePass:true,riskExpressionPass:true,naturalnessPass:pass,naverReadabilityPass:pass,readerValueAssessment:{openingAnswer:opening,decisionHelp:help},humanizerDecisions:[],issues:pass?[]:['같은 자세를 뒤에서 다시 해석한 설명이 반복됩니다.'],failureReason:pass?'':'동작 조건의 중복 설명을 합치세요.',revisionInstructions:pass?[]:['뒤꿈치와 무릎 조건은 첫 동작 문단에 함께 남기고 중복 해석을 합치세요. 본문 공백 제외 1000~1200자를 유지하세요.'],relevanceEvidence:{primaryKeyword:'종아리 스트레칭',answerAligned:true,answerQuote:opening,conceptChecks:[{term:'벽 자세',quote:help,relevant:true,matchedPhrase:'벽을 이용한 자세',explanation:'벽을 이용하는 자세를 직접 설명합니다.'},{term:'경사면',quote:help,relevant:true}],tagsAligned:true,tagExamples:[{tag:w.tags[0],quote:opening}],imagesAligned:true,imageChecks:require('../src/lib/articleRelevance').imagePlans(w).map(i=>({key:i.key,promptQuote:i.prompt,articleQuote:help,aligned:true})),naturalUsage:pass,reason:pass?'실제 조건을 설명합니다.':'같은 조건의 반복을 줄이세요.'}};}
function patchFor(w,after){const before=w.article.slice(w.article.lastIndexOf('\n\n')+2);return {status:'success',fingerprint:R.fingerprint(w),edits:[{before,after:after.article.slice(after.article.lastIndexOf('\n\n')+2)}]};}
function harness(t,{initial=writer(),reviews,patch,images=false,options={}}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'folax-guided-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const calls=[],checkpoints=[],logs=[];let writes=0,mains=0,lastWriter=initial;
 const opts={jobDir:root,revisionPolicy:1,articleLengthPolicy:2,relevancePolicy:1,tagCount:10,emphasisPolicy:1,topicMode:'manual',searchResults:[source],includeTitleImage:images,maxBodyImages:images?3:0,minimumImageCount:images?4:0,...options,onGenerationCheckpoint:c=>checkpoints.push(structuredClone(c))};
 const deps={bodyImageLimit:Number,researchPrompt:P.researchPrompt,researchRetry:P.researchPrompt,writerPrompt:P.writerPrompt,writerRetry:P.writerPrompt,reviewPrompt:P.reviewPrompt,writerIssue:runner.writerOutputIssueReason,imagePromptIssue:runner.writerImageContractIssueReason,reviewIssue:runner.mainReviewPassIssueReason,imagePrompt:runner.buildImageWorkerPrompt,imageIssue:runner.imageWorkerContractIssueReason,pendingImages:runner.pendingImageWriterResult,mergeImages:runner.mergeImageWorkerAttempts,applyImages:(w,i)=>({...w,...i}),runTask:async args=>{
  calls.push(args);if(args.agent==='research')return research;
  if(args.agent==='writer'){
   if(args.promptFileName.startsWith('article-revision-')){const context=JSON.parse(args.prompt.split('\n').at(-1));lastWriter=context.writer;return patch?patch(context,args):patchFor(context.writer,writer(1177,images));}
   writes++;lastWriter=typeof initial==='function'?initial(writes):initial;return lastWriter;
  }
  if(args.agent==='main'){mains++;const context=JSON.parse(args.prompt.split('\n').find(s=>s.startsWith('{"currentRequirements"')));lastWriter=context.article;return reviews?reviews(lastWriter,mains):review(lastWriter);}
  if(args.agent==='image'){const file=n=>{const f=path.join(args.options.jobDir,n+'.png');fs.writeFileSync(f,'fixture '+n);return f;};return {status:'success',titleImagePath:file('title'),titleImageVerified:true,bodyImages:lastWriter.bodyImages.map(i=>({...i,path:file('body-'+i.sequence),summaryVerified:true}))};}
  throw Error('Unexpected '+args.agent);
 }};
 return {root,opts,deps,calls,checkpoints,logs,run:()=>generate(opts,m=>logs.push(m),deps)};
}
test('a valid first draft needs only Research, Writer and Main, with current bounds overriding stale briefs',async t=>{
 const h=harness(t),r=await h.run();assert.equal(r.publishable,true,r.failureReason);assert.deepEqual(h.calls.map(c=>c.agent),['research','writer','main']);assert.equal(r.tags.length,10);assert(r.boldSentences.includes(opening));
 for(const a of h.calls){assert(a.prompt.includes('1300자'));assert(a.prompt.includes('1000~1500자'));}assert.equal(R.requirements(h.opts).bodyCharacters.max,1500);
});
test('the 989 → 1177 case combines length and 90-point quality feedback in one partial repair, then creates four images',async t=>{
 const h=harness(t,{initial:writer(989,true),images:true,reviews:(w,n)=>review(w,n>1)}),r=await h.run();assert.equal(r.publishable,true,r.failureReason);assert.equal(L.articleCharacterCount(r.article),1177);assert.equal(r.relevanceReport.score,100);
 assert.deepEqual(h.calls.map(c=>c.agent),['research','writer','main','writer','main','image']);const repair=h.calls.find(c=>c.promptFileName.startsWith('article-revision-'));assert(repair.prompt.includes('뒤꿈치와 무릎'));assert(!repair.prompt.includes('1000~1200자'));assert(h.logs.some(s=>s.includes('90/100')));assert.equal(r.bodyImages.length,3);assert(r.titleImagePath);assert(h.logs.some(s=>s.includes('한 번에 반영')));
});
test('a nearby length miss cannot pass even when Main says PASS',async t=>{
 const h=harness(t,{initial:writer(989)}),r=await h.run();assert.equal(r.publishable,true,r.failureReason);assert.equal(L.articleCharacterCount(r.article),1177);assert.equal(h.calls.filter(c=>c.agent==='writer').length,2);assert.equal(h.calls.filter(c=>c.agent==='main').length,2);
});
test('a format-only repair does not consume the later quality repair',async t=>{
 const h=harness(t,{initial:n=>writer(n===1?500:1177),reviews:(w,n)=>review(w,n>1),patch:c=>{const before='원고 길이 검증을 위한 설명입니다.';return {status:'success',fingerprint:c.fingerprint,edits:[{before,after:before.slice(0,-1)+'수'}]};}}),r=await h.run();assert.equal(r.publishable,true,r.failureReason);assert.deepEqual(h.calls.map(c=>c.agent),['research','writer','writer','main','writer','main']);assert.equal(h.calls.filter(c=>c.promptFileName.startsWith('article-revision-')).length,1);
});
test('repeated quality rejection stops within budget and preserves the latest draft plus all correction instructions',async t=>{
 const h=harness(t,{initial:writer(989),reviews:w=>review(w,false)}),r=await h.run();assert.equal(r.status,'failed');assert.equal(r.failurePhase,'main_review');assert.equal(h.calls.filter(c=>c.agent==='writer').length,2);assert.equal(h.calls.filter(c=>c.agent==='main').length,2);assert(!h.calls.some(c=>c.agent==='image'));
 const cp=h.checkpoints.at(-1);assert.equal(L.articleCharacterCount(cp.articleCheckpoint.writer.article),1177);assert(cp.articleCheckpoint.feedback.includes('뒤꿈치와 무릎'));assert(cp.articleCheckpoint.feedback.includes('1000~1500자'));assert.deepEqual(cp.articleCheckpoint.evidenceContext.searchResults,[source]);
});
test('missing citations are never deferred as a mere length problem',async t=>{
 const h=harness(t,{initial:{...writer(989),citations:[]}}),r=await h.run();assert.equal(r.status,'failed');assert.equal(r.failurePhase,'writer');assert.equal(h.calls.filter(c=>c.agent==='writer').length,2);assert(!h.calls.some(c=>c.agent==='main'));
});
test('legacy history retry keeps the second draft and specific Main instructions instead of starting over',async t=>{
 const h=harness(t),w=writer(1177),bad=review(w,false),cp={version:2,attemptNumber:1,generationOptions:{...h.opts,onGenerationCheckpoint:undefined,revisionPolicy:undefined},steps:{'1:research-title-prompt.txt':research,'1:prompt.txt':writer(989),'1:prompt-retry-2.txt':w,'1:main-review-2.txt':bad},retrievals:{'1:2':{searchResults:[source]}}};delete cp.generationOptions.revisionPolicy;
 const item={id:'job_100',account_id:'a',blog_id:'fixture-blog',category:'건강·신체 상식',title,status:'failed',failure_phase:'main_review',failure_kind:'quality',reason:'앱 내부 연관성 90/100 · 목표 95 이상.'},accounts=[{id:'a',blogId:'fixture-blog',categories:[{id:'c',name:item.category}]}],settings={pendingGenerationDraft:{jobId:item.id,checkpoint:cp}};
 const before=JSON.stringify(settings);const folder=path.join(h.root,'jobs',item.id);fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'generation-checkpoint.json'),JSON.stringify(cp));
 const plan=retryPlan(h.root,item,[item],settings,accounts);assert.equal(plan.allowed,true);assert.equal(plan.mode,'writer');assert(plan.reason.includes('지적된 부분'));assert.equal(plan.checkpoint.articleResume.writer.article,w.article);assert(plan.checkpoint.articleResume.feedback.includes('뒤꿈치와 무릎'));assert(!plan.checkpoint.articleResume.feedback.includes('1000~1200자'));assert.equal(JSON.stringify(settings),before);assert.equal(fs.readFileSync(path.join(folder,'generation-checkpoint.json'),'utf8'),JSON.stringify(cp));
 h.deps.runTask=async args=>{h.calls.push(args);if(args.agent==='writer'){assert(args.promptFileName.startsWith('article-revision-'));const c=JSON.parse(args.prompt.split('\n').at(-1)),before='원고 길이 검증을 위한 설명입니다.';return {status:'success',fingerprint:c.fingerprint,edits:[{before,after:before.slice(0,-1)+'수'}]};}if(args.agent==='main'){const context=JSON.parse(args.prompt.split('\n').find(s=>s.startsWith('{"currentRequirements"')));return review(context.article);}throw Error('No research, new search or image call expected');};
 const r=await generate({...h.opts,generationCheckpoint:plan.checkpoint,onSearchNeeded:async()=>{throw Error('No new search');}},()=>{},h.deps);assert.equal(r.publishable,true,r.failureReason);assert.deepEqual(h.calls.map(c=>c.agent),['writer','main']);assert.deepEqual(r.citations,w.citations);assert.deepEqual(r.tags,w.tags);
});
test('invalid partial response preserves the draft and retries only that response with no new research or first draft',async t=>{
 let patches=0;const h=harness(t,{initial:writer(989),reviews:(w,n)=>review(w,n>1),patch:c=>++patches===1?{status:'success',fingerprint:'wrong',edits:[]}:patchFor(c.writer,writer(1177))});
 const a=await h.run();assert.equal(a.failurePhase,'article_revision');assert.equal(a.article,writer(989).article);const cp=h.checkpoints.at(-1);assert(cp.steps['1:prompt.txt']);assert(cp.steps['1:main-review-1.txt']);assert(!cp.steps['1:article-revision-2.txt']);h.calls.length=0;
 const b=await generate({...h.opts,generationCheckpoint:cp},()=>{},h.deps);assert.equal(b.publishable,true,b.failureReason);assert.deepEqual(h.calls.map(c=>c.agent),['writer','main']);
});
test('an unchanged correction stops and an identical retry incurs no additional model call',async t=>{
 const h=harness(t,{initial:writer(989),reviews:w=>review(w,false),patch:c=>({status:'success',fingerprint:c.fingerprint,edits:[]})}),a=await h.run();assert.equal(a.failurePhase,'article_revision');const cp=h.checkpoints.at(-1);assert(cp.blockedRevisionRequest);h.calls.length=0;
 const b=await generate({...h.opts,generationCheckpoint:cp},()=>{},h.deps);assert.equal(b.status,'failed');assert.match(b.failureReason,/중복 모델 호출/);assert.equal(h.calls.length,0);assert.equal(b.article,writer(989).article);
});
test('a partial edit preserves title, tags, citations, image identities and untouched paragraphs, and rejects unsafe ranges',()=>{
 const w=writer(1177,true),before='원고 길이 검증을 위한 설명입니다.',p={status:'success',fingerprint:R.fingerprint(w),edits:[{before,after:before.slice(0,-1)+'수'}]},bytes=JSON.stringify(w),out=R.apply(w,p);assert.equal(JSON.stringify(w),bytes);assert(out.article.startsWith(w.article.slice(0,w.article.indexOf(before))));for(const k of ['title','tags','citations','bodyImages','titleImageText'])assert.deepEqual(out[k],w[k]);
 assert.throws(()=>R.apply(w,{...p,fingerprint:'wrong'}),/일치/);assert.throws(()=>R.apply(w,{...p,edits:[{before:'본문에 없는 유일한 문자열입니다.',after:'바꾼 문장'}]}),/정확히 한 번/);assert.throws(()=>R.apply(w,{...p,edits:[p.edits[0],p.edits[0]]}),/겹칩니다/);assert.throws(()=>R.apply(w,{...p,edits:[{before:'[IMAGE INSERT - 1]',after:'[IMAGE INSERT - 5]'}]}),/표식/);assert.throws(()=>R.apply(w,{...p,bodyImagePrompts:[{sequence:99,prompt:'없는 그림 설명'}]}),/현재 계획/);
});
test('feedback drops duplicate instructions and adjusts only obsolete character requirements without changing source snapshots',()=>{
 const m='기존 본문은 공백 제외 1000~1200자를 유지하세요.',raw={revisionInstructions:[m],sourceQuote:'근거의 실제 표현 1000~1200자'};const before=JSON.stringify(raw),s=R.feedback([m,m,raw.revisionInstructions],{articleLengthPolicy:2});assert.equal(s,'기존 본문은 공백 제외 1000~1500자를 유지하세요.');assert.equal(JSON.stringify(raw),before);assert.equal(R.feedback([m],{articleLengthPolicy:1}),m);
});
test('a saved draft awaiting approval cannot trigger another generation from its old failed history',t=>{
 const h=harness(t),old={id:'job_100',account_id:'a',blog_id:'fixture',category:'건강·신체 상식',title,status:'failed'},ready={...old,id:'job_200',status:'awaiting_approval',retry_root_id:'job_100'},accounts=[{id:'a',blogId:'fixture',categories:[{id:'c',name:old.category}]}];
 assert.equal(retryPlan(h.root,ready,[ready],{},accounts).allowed,false);const p=retryPlan(h.root,old,[ready,old],{},accounts);assert.equal(p.allowed,false);assert.match(p.reason,/완료된 작업/);
});
