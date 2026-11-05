'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const A=require('../src/lib/automaticRetries'),R=require('../src/lib/editorialRevision'),L=require('../src/lib/articleRequirements'),T=require('../src/lib/articleTags'),P=require('../src/lib/generationPrompts'),{generate}=require('../src/lib/generationPipeline'),runner=require('../src/lib/codexRunner')._private,{createRetryTask}=require('../src/lib/modelRetry');
const opening='걷기 전에 신발의 상태와 움직일 공간을 함께 살펴보면 준비할 조건을 구분하기 쉽습니다.',help='자주 쓰는 물건을 가까운 곳에 두는 것처럼 필요한 조건부터 순서대로 살펴보세요.',unique='원고 길이와 수정 흐름을 검증하는 문장입니다.';
function writer(count=1500,tags=15){const w={status:'success',title:'걷기 전 준비는 어떤 순서로 살펴볼까요?',article:opening+'\n\n[SECTION - 먼저 살펴볼 조건]\n'+help+'\n\n'+unique,tags:Array.from({length:tags},(_,i)=>'걷기준비'+i),citations:[],bodyImages:[],titleImagePrompt:'',titleImageText:[],boldSentences:[opening]};w.article+='검'.repeat(count-L.articleCharacterCount(w.article));return w;}
const research={status:'PASS',finalTitle:writer().title,factBased:false,factChecks:[],searchNeed:'skip',novelty:{duplicate:false,reason:'새 질문'}};
const review=pass=>({status:pass?'PASS':'REVISION',publishable:pass,articleAnswersTitle:true,topicPreserved:true,factualityPass:true,sourceUsePass:true,riskExpressionPass:true,naturalnessPass:pass,naverReadabilityPass:pass,readerValueAssessment:{openingAnswer:opening,decisionHelp:help},humanizerDecisions:[],failureReason:pass?'':'같은 조건을 다시 해석한 설명을 합치세요.',revisionInstructions:pass?[]:['원고 길이와 수정 흐름을 검증하는 문장을 쉽게 정리하세요.'],issues:[]});
function harness(t,{passAt=1,initial=writer(),partial,intercept,options={}}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'folax-five-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const calls=[],checkpoints=[],progress=[];let mains=0;
 const opts={jobDir:root,revisionPolicy:1,maxAutoRetries:5,articleLengthPolicy:3,tagCount:15,emphasisPolicy:1,topicMode:'manual',includeTitleImage:false,maxBodyImages:0,...options,onGenerationCheckpoint:c=>checkpoints.push(structuredClone(c)),onRetryProgress:p=>progress.push(structuredClone(p))};
 const base=async args=>{
  calls.push(args);if(intercept){const value=await intercept(args);if(value!==undefined)return value;}
  if(args.agent==='research')return research;
  if(args.agent==='main')return review(++mains>=passAt);
  if(args.promptFileName.startsWith('tags-repair-')){const c=JSON.parse(args.prompt.split('\n').at(-1));return {status:'success',fingerprint:c.fingerprint,tags:writer().tags};}
  if(args.promptFileName.startsWith('article-revision-')){const c=JSON.parse(args.prompt.split('\n').find(s=>s.startsWith('{"fingerprint"')));if(partial)return partial(c,args);const before=c.writer.article.includes(unique)?unique:unique.replace('검증','확인');return {status:'success',fingerprint:c.fingerprint,edits:[{before,after:before.includes('검증')?before.replace('검증','확인'):before.replace('확인','검증')}]};}
  if(args.agent==='writer')return initial;
  throw Error('Unexpected '+args.agent);
 };
 const deps={runTask:base,bodyImageLimit:Number,researchPrompt:P.researchPrompt,researchRetry:P.researchPrompt,writerPrompt:P.writerPrompt,writerRetry:P.writerPrompt,reviewPrompt:P.reviewPrompt,writerIssue:runner.writerOutputIssueReason,imagePromptIssue:runner.writerImageContractIssueReason,reviewIssue:runner.mainReviewPassIssueReason,applyImages:w=>w};
 return {root,opts,deps,calls,checkpoints,progress,run:()=>generate(opts,()=>{},deps)};
}
test('new articles target 1500 characters and 15 tags while legacy policies retain their original ranges',()=>{
 assert.deepEqual(L.limits({articleLengthPolicy:3}),{min:1400,max:1600,target:1500});assert.equal(L.articleLengthIssue(writer(1400),{articleLengthPolicy:3}),'');assert.equal(L.articleLengthIssue(writer(1600),{articleLengthPolicy:3}),'');assert.match(L.articleLengthIssue(writer(1399),{articleLengthPolicy:3}),/1400~1600/);assert.match(L.articleLengthIssue(writer(1601),{articleLengthPolicy:3}),/1400~1600/);assert.equal(L.limits({articleLengthPolicy:2}).target,1300);assert.equal(L.limits({articleLengthPolicy:1}).max,1200);
 assert.equal(T.issue(writer(),{tagCount:15}),'');assert.match(T.issue(writer(1500,14),{tagCount:15}),/15개/);assert.equal(T.forPlatform(writer().tags,'naver').length,15);assert.equal(T.forPlatform(writer().tags,'tistory').length,10);assert.equal(R.feedback(['본문 1000~1500자'],{articleLengthPolicy:3}),'본문 1400~1600자');
});
test('first-pass success spends zero automatic retries',async t=>{
 const h=harness(t),r=await h.run();assert.equal(r.publishable,true,r.failureReason);assert.equal(r.autoRetry.used,0);assert.deepEqual(h.progress.map(p=>p.used),[0]);assert.deepEqual(h.calls.map(c=>c.agent),['research','writer','main']);assert.equal(r.tags.length,15);assert.equal(r.writingApplication.lengthBudget.target,1500);
});
test('the fifth automatic content correction can pass without a manual click or an extra sixth correction',async t=>{
 const h=harness(t,{passAt:6}),r=await h.run();assert.equal(r.publishable,true,r.failureReason);assert.equal(r.autoRetry.used,5);assert.deepEqual(h.progress.map(p=>p.used),[0,1,2,3,4,5]);assert.equal(h.calls.filter(c=>c.agent==='research').length,1);assert.equal(h.calls.filter(c=>c.agent==='writer').length,6);assert.equal(h.calls.filter(c=>c.agent==='main').length,6);assert.equal(r.autoRetry.history.length,5);assert.equal(L.articleCharacterCount(r.article),1500);
});
test('persistent content rejection stops at five and replaying the checkpoint makes no additional model call',async t=>{
 const h=harness(t,{passAt:99}),r=await h.run();assert.equal(r.status,'failed');assert.equal(r.autoRetry.used,5);assert.equal(h.calls.filter(c=>c.agent==='writer').length,6);assert.equal(h.calls.filter(c=>c.agent==='main').length,6);const cp=h.checkpoints.at(-1);assert(cp.articleCheckpoint.writer.article);h.calls.length=0;
 const second=await generate({...h.opts,generationCheckpoint:cp},()=>{},h.deps);assert.equal(second.status,'failed');assert.equal(second.autoRetry.used,5);assert.equal(h.calls.length,0);assert.equal(second.article,r.article);
});
test('success after the first correction stops immediately',async t=>{
 const h=harness(t,{passAt:2}),r=await h.run();assert.equal(r.publishable,true);assert.equal(r.autoRetry.used,1);assert.equal(h.calls.filter(c=>c.agent==='writer').length,2);assert.equal(h.calls.filter(c=>c.agent==='main').length,2);
});
test('unchanged partial responses automatically retry but cannot exceed the shared five-call repair budget',async t=>{
 const h=harness(t,{passAt:99,partial:c=>({status:'success',fingerprint:c.fingerprint,edits:[]})}),r=await h.run();assert.equal(r.status,'failed');assert.equal(r.autoRetry.used,5);assert.match(r.failureReason,/최대 5회/);assert.equal(r.article,writer().article);assert.equal(h.calls.filter(c=>c.promptFileName.startsWith('article-revision-')).length,5);assert.equal(h.calls.filter(c=>c.agent==='main').length,1);assert(!Object.keys(h.checkpoints.at(-1).steps).some(k=>k.includes('article-revision-')));
});
test('a malformed partial response is retried locally and then proceeds with the same draft',async t=>{
 let repairs=0;const h=harness(t,{passAt:2,partial:c=>{if(++repairs<=2)return {status:'success',fingerprint:'wrong',edits:[]};return {status:'success',fingerprint:c.fingerprint,edits:[{before:unique,after:unique.replace('검증','확인')}]};}}),r=await h.run();assert.equal(r.publishable,true,r.failureReason);assert.equal(r.autoRetry.used,3);assert.equal(h.calls.filter(c=>c.agent==='research').length,1);assert.equal(h.calls.filter(c=>c.agent==='main').length,2);assert.equal(h.calls.filter(c=>c.promptFileName==='prompt.txt').length,1);
});
test('tag-only repair and prose corrections consume one combined budget',async t=>{
 const h=harness(t,{initial:writer(1500,10),passAt:2}),r=await h.run();assert.equal(r.publishable,true,r.failureReason);assert.equal(r.tags.length,15);assert.equal(r.autoRetry.used,2);assert.deepEqual(r.autoRetry.history.map(h=>h.kind),['태그 보완','본문 부분 보완']);
});
test('invalid Main evidence is corrected automatically without rewriting acceptable prose',async t=>{
 let mains=0;const h=harness(t,{intercept:args=>args.agent==='main'&&++mains===1?{...review(true),readerValueAssessment:{openingAnswer:'본문에 없는 검수 문장입니다.',decisionHelp:help}}:undefined}),r=await h.run();assert.equal(r.publishable,true,r.failureReason);assert.equal(r.autoRetry.used,1);assert.equal(h.calls.filter(c=>c.agent==='writer').length,1);assert.equal(h.calls.filter(c=>c.agent==='main').length,2);assert.equal(r.article,writer().article);
});
test('a substantive BLOCK is never bypassed by five-retry automation',async t=>{
 const h=harness(t,{intercept:args=>args.agent==='main'?{...review(false),status:'BLOCK',failureReason:'핵심 주장이 원문으로 뒷받침되지 않습니다.'}:undefined}),r=await h.run();assert.equal(r.status,'failed');assert.equal(r.autoRetry.used,0);assert.equal(h.calls.filter(c=>c.agent==='writer').length,1);
});
test('transient text execution failures are retried automatically and reported usage is added once',async t=>{
 let tries=0;const h=harness(t,{intercept:args=>{if(args.agent==='research'&&++tries<=2)throw Object.assign(Error('temporary connection failure'),{code:'CODEX_EXEC_FAILED',tokenUsage:{total:7,inputTokens:5,outputTokens:2}});}});const base=h.deps.runTask;h.deps.runTask=createRetryTask(base,{onModelError:()=>{throw Error('No manual retry dialog expected');}},()=>{});
 const r=await h.run();assert.equal(r.publishable,true,r.failureReason);assert.equal(r.autoRetry.used,2);assert.equal(r.tokenUsage.total,14);assert.equal(h.calls.filter(c=>c.agent==='research').length,3);assert.equal(h.calls[1].tokenOffset,7);assert.equal(h.calls[2].tokenOffset,14);
});
test('a permanently failing text call runs once plus five automatic retries and stops',async t=>{
 const h=harness(t,{intercept:()=>{throw Object.assign(Error('temporary connection failure'),{code:'CODEX_EXEC_FAILED'});}});h.deps.runTask=createRetryTask(h.deps.runTask,{},()=>{});await assert.rejects(h.run,/최대 5회/);assert.equal(h.calls.length,6);assert.equal(h.checkpoints.at(-1).autoRetry.used,5);assert.equal(h.progress.at(-1).used,5);
});
test('quota and login errors stop without wasting automatic retries',async()=>{
 for(const error of [Object.assign(Error('usage limit'),{code:'CODEX_USAGE_LIMIT'}),Object.assign(Error('401 unauthorized'),{code:'CODEX_EXEC_FAILED'})]){let calls=0,reservations=0;const run=createRetryTask(async()=>{calls++;throw error;},{onModelError:()=>{throw Error('No dialog on automatic quota stop');}},()=>{});await assert.rejects(()=>run({agent:'writer',options:{onAutoRetry:async()=>reservations++}}));assert.equal(calls,1);assert.equal(reservations,0);}
});
test('budget state resumes accurately and an explicit manual round preserves the previous round summary',async()=>{
 const snapshots=[],b=A.create(undefined,async s=>snapshots.push(s));for(let i=0;i<5;i++)await b.reserve('본문 부분 보완','검증');await assert.rejects(()=>b.reserve('본문 부분 보완','초과'),/최대 5회/);const restored=A.create(snapshots.at(-1));assert.equal(restored.snapshot().used,5);await assert.rejects(()=>restored.reserve('다음','초과'),/최대 5회/);
 const cp={version:2,generationOptions:{articleLengthPolicy:2,tagCount:10},autoRetry:b.snapshot(),steps:{},retrievals:{}},bytes=JSON.stringify(cp),manual=A.manualRound(cp);assert.equal(JSON.stringify(cp),bytes);assert.equal(manual.autoRetry.used,0);assert.equal(manual.autoRetry.round,2);assert.deepEqual(manual.autoRetry.priorRounds,[{round:1,used:5}]);assert.equal(manual.generationOptions.articleLengthPolicy,2);assert.equal(manual.generationOptions.tagCount,10);
});
test('resuming an old draft adopts only the requested retry budget and retains its saved length and tags',async t=>{
 const w=writer(1177,10),h=harness(t,{initial:w}),cp={version:2,attemptNumber:1,generationOptions:{articleLengthPolicy:2,tagCount:10,includeTitleImage:false,maxBodyImages:0},steps:{'1:research-title-prompt.txt':research,'1:prompt.txt':w},retrievals:{}};
 const r=await generate({...h.opts,generationCheckpoint:cp},()=>{},h.deps);assert.equal(r.publishable,true,r.failureReason);assert.equal(r.tags.length,10);assert.equal(r.writingApplication.lengthBudget.max,1500);assert.equal(r.autoRetry.used,0);assert.equal(h.checkpoints.at(-1).generationOptions.maxAutoRetries,5);
});
test('automatic mode never restarts the whole research topic even with token-saving disabled',async t=>{
 const h=harness(t,{options:{tokenSaving:false},intercept:args=>args.agent==='research'?{...research,status:'BLOCK',failureReason:'핵심 자료가 없습니다.'}:undefined}),r=await h.run();assert.equal(r.status,'failed');assert.deepEqual(h.calls.map(c=>c.agent),['research']);assert.equal(r.autoRetry.used,0);
});
test('usage from failed automatic repair calls remains in the preserved failed result',async t=>{
 const h=harness(t,{passAt:99,intercept:args=>{if(args.promptFileName.startsWith('article-revision-'))throw Object.assign(Error('temporary response failure'),{code:'CODEX_EXEC_FAILED',tokenUsage:{total:7,inputTokens:5,outputTokens:2}});}});h.deps.runTask=createRetryTask(h.deps.runTask,{},()=>{});
 const r=await h.run();assert.equal(r.status,'failed');assert.equal(r.failurePhase,'article_revision');assert.equal(r.autoRetry.used,5);assert.equal(r.tokenUsage.total,35);assert.equal(r.tokenUsage.inputTokens,25);assert.equal(h.calls.filter(c=>c.promptFileName.startsWith('article-revision-')).length,5);assert.equal(r.article,writer().article);
});
