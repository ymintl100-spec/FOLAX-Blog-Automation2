'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const E=require('../src/lib/researchEvidence'),P=require('../src/lib/generationPrompts'),{generate,evidenceIssue}=require('../src/lib/generationPipeline'),runner=require('../src/lib/codexRunner')._private;
const url='https://blog.naver.com/fixture_not_real/12345',input={sourceId:'input-link-1-1',inputKind:'link',inputValue:url,url,excerpt:'입력 원문의 검증용 설명: 편안한 강도로 사용하고 체중으로 압력을 조절합니다. 도구가 없으면 앉아서 손으로 부드럽게 누릅니다.'};
const keyword='압력 조절',keywordSource={sourceId:'input-keyword-1-1',inputKind:'keyword',inputValue:keyword,url:'https://example.org/keyword',excerpt:'키워드 검색으로 읽은 실제 조건을 담은 검증용 원문입니다.'};
const extras=Array.from({length:24},(_,i)=>({sourceId:'supplement-'+i,url:'https://example.org/evidence/'+i,excerpt:'보강 자료 '+i+'에서 읽은 원문과 적용 조건입니다.'}));
const opening='걷기 전에는 신발 상태와 움직일 공간을 함께 살펴보면 준비할 조건을 구분하기 쉽습니다.',help='서로 다른 조건은 필요한 위치에서 한 번씩 설명하면 선택할 기준을 알아보기 쉽습니다.';
function writer(){let article=opening+'\n\n[SECTION - 준비할 조건]\n'+help+'\n\n';article+='검'.repeat(1500-require('../src/lib/articleRequirements').articleCharacterCount(article));return {status:'success',title:'준비할 조건은 어떤 순서로 볼까요?',article,tags:Array.from({length:15},(_,i)=>'검증태그'+i),bodyImages:[],citations:[input,extras[0]].map(s=>({sourceId:s.sourceId,url:s.url})),boldSentences:[opening]};}
const fact=s=>({claim:s.excerpt,essential:true,supported:true,sourceIds:[s.sourceId]});
const analysis={keywords:[{keyword,summary:'입력 키워드의 원문 조건을 분석했습니다.'}],links:[{url,summary:'입력 링크의 강도와 도구 사용 조건을 분석했습니다.'}]};
function harness(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'folax-evidence-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const calls=[],reads=[],snapshots=[];let searches=0;
 const opts={jobDir:root,...require('../src/lib/generationDefaults').options,topicMode:'input',inputBrief:{mode:'mixed',keywords:[keyword],urls:[url]},includeTitleImage:false,maxBodyImages:0,readInputLink:async u=>{reads.push(u);return input;},searchInputKeyword:async k=>{reads.push(k);return [keywordSource];},onSearchNeeded:async()=>{searches++;return {searchResults:extras};},onGenerationCheckpoint:c=>snapshots.push(structuredClone(c))};
 const deps={bodyImageLimit:Number,researchPrompt:P.researchPrompt,researchRetry:P.researchPrompt,writerPrompt:P.writerPrompt,writerRetry:P.writerPrompt,reviewPrompt:P.reviewPrompt,writerIssue:runner.writerOutputIssueReason,imagePromptIssue:runner.writerImageContractIssueReason,reviewIssue:runner.mainReviewPassIssueReason,applyImages:w=>w,runTask:async args=>{
  calls.push(args);if(args.agent==='research'){
   if(args.promptFileName==='research-title-prompt.txt')return {status:'REVISION',finalTitle:writer().title,factBased:true,searchNeed:'strict',searchQueries:['빠진 조건 원문'],factChecks:[fact(input)],inputAnalysis:analysis};
   const p=JSON.parse(args.prompt.split('\n').find(s=>s.startsWith('{"brief"')));for(const required of [input,keywordSource]){const delivered=p.sources.find(s=>s.sourceId===required.sourceId);assert(delivered,'Lost original '+required.sourceId);assert.equal(delivered.excerpt,required.excerpt);assert.equal(delivered.inputValue,required.inputValue);}
   return {status:'PASS',finalTitle:writer().title,factBased:true,searchNeed:'skip',factChecks:[fact(input),fact(extras[0])],inputAnalysis:analysis};
  }
  if(args.agent==='writer')return writer();if(args.agent==='main')return {status:'PASS',publishable:true,articleAnswersTitle:true,topicPreserved:true,factualityPass:true,sourceUsePass:true,riskExpressionPass:true,naturalnessPass:true,naverReadabilityPass:true,inputCoveragePass:true,readerValueAssessment:{openingAnswer:opening,decisionHelp:help},humanizerDecisions:[],issues:[]};throw Error('Unexpected stage '+args.agent);
 }};
 return {root,opts,deps,calls,reads,snapshots,searches:()=>searches,run:()=>generate(opts,()=>{},deps)};
}
test('supplements pin readable input groups, retain IDs and stay bounded at twenty sources',()=>{
 const prior=JSON.stringify([input,keywordSource]),result=E.merge([input,keywordSource],extras);assert.equal(result.length,20);for(const s of [input,keywordSource])assert.deepEqual(result.find(v=>v.sourceId===s.sourceId),s);assert.equal(JSON.stringify([input,keywordSource]),prior);assert(result.some(s=>s.sourceId===extras[0].sourceId));
});
test('same URL with a new excerpt cannot overwrite the input excerpt or reassign its ID',()=>{
 const next={...input,inputKind:undefined,inputValue:undefined,excerpt:'같은 원문에서 새로 읽은 다른 위치의 조건입니다.'},result=E.merge([input],[next]);assert.equal(result.length,2);assert.deepEqual(result[0],input);assert.notEqual(result[1].sourceId,input.sourceId);assert.equal(result[1].excerpt,next.excerpt);
 const empty=E.merge([input],[{url,excerpt:'',sourceId:input.sourceId}]);assert.deepEqual(empty[0],input);const alias=E.merge([input],[{url:url.replace('blog.naver.com','m.blog.naver.com'),excerpt:input.excerpt,sourceId:'different'}]);assert.equal(alias.length,1);assert.equal(alias[0].sourceId,input.sourceId);
});
test('reused provider IDs cannot point prior citations to another URL or excerpt',()=>{
 const incoming={...extras[0],sourceId:input.sourceId},result=E.merge([input],[incoming]);assert.equal(new Set(result.map(s=>s.sourceId)).size,2);assert.equal(result.find(s=>s.sourceId===input.sourceId).url,input.url);assert(result.some(s=>s.excerpt===incoming.excerpt));
});
test('followup Research and Writer/Main receive mandatory input text even outside the chosen fact checks',()=>{
 const sources=[...extras,input,keywordSource],options={jobDir:'/tmp/fixture',searchResults:sources,researchTitleResult:{factChecks:[fact(extras[23])]},writerResult:writer()};
 const research=JSON.parse(P.researchPrompt(options,options.researchTitleResult).split('\n').find(s=>s.startsWith('{"brief"')));for(const id of [input.sourceId,keywordSource.sourceId,extras[23].sourceId])assert(research.sources.some(s=>s.sourceId===id));
 for(const prompt of [P.writerPrompt(options),P.reviewPrompt(options)]){const json=JSON.parse(prompt.split('\n').find(s=>s.startsWith('{"brief"')||s.startsWith('{"currentRequirements"')));for(const s of [input,keywordSource])assert.equal(json.sources.find(v=>v.sourceId===s.sourceId).excerpt,s.excerpt);assert(!json.sources.some(s=>s.sourceId===extras[7].sourceId));}
});
test('mixed inputs survive a supplement-only callback through Research, Writer, Main and checkpoint replay',async t=>{
 const h=harness(t),result=await h.run();assert.equal(result.publishable,true,result.failureReason);assert.deepEqual(h.calls.map(c=>c.agent),['research','research','writer','main']);assert.equal(h.searches(),1);assert.deepEqual(h.reads,[url,keyword]);
 const saved=h.snapshots.at(-1),sources=saved.retrievals['1:1'].searchResults;assert.equal(sources.find(s=>s.sourceId===input.sourceId).excerpt,input.excerpt);assert.equal(result.citations[0].sourceId,input.sourceId);
 const replay=await generate({...h.opts,generationCheckpoint:saved},()=>{},h.deps);assert.equal(replay.article,result.article);assert.equal(h.searches(),1);assert.equal(h.calls.length,4);assert.equal(h.reads.length,2);
});
test('legacy failed research restores cached input text and reruns only the damaged followup without fetching again',async t=>{
 const h=harness(t);await h.run();const cp=structuredClone(h.snapshots.at(-1));delete cp.articleCheckpoint;delete cp.steps['1:prompt.txt'];delete cp.steps['1:main-review-1.txt'];cp.retrievals['1:1'].searchResults=extras.slice(0,20);cp.steps['1:research-title-search-1.txt']={status:'REVISION',finalTitle:writer().title,factChecks:[fact(input)],failureReason:'필수 입력 링크는 이전 요약만 있고 원문 발췌가 없습니다.'};const before=JSON.stringify(cp);h.calls.length=0;
 const result=await generate({...h.opts,generationCheckpoint:cp},()=>{},h.deps);assert.equal(result.publishable,true,result.failureReason);assert.deepEqual(h.calls.map(c=>[c.agent,c.promptFileName]),[['research','research-title-search-1.txt'],['writer','prompt.txt'],['main','main-review-1.txt']]);assert.equal(h.searches(),1);assert.equal(h.reads.length,2);assert.equal(JSON.stringify(cp),before);
});
test('history retry restores a damaged research checkpoint while preserving original files and settings',async t=>{
 const h=harness(t);await h.run();const cp=structuredClone(h.snapshots.at(-1));delete cp.articleCheckpoint;delete cp.steps['1:prompt.txt'];delete cp.steps['1:main-review-1.txt'];cp.retrievals['1:1'].searchResults=extras.slice(0,20);cp.steps['1:research-title-search-1.txt']={status:'REVISION',failureReason:'원문 발췌가 없습니다.'};
 const item={id:'job_100',account_id:'a',blog_id:'fixture',category:'기존 분류',status:'failed',failure_phase:'research',failure_kind:'quality'},accounts=[{id:'a',blogId:'fixture',categories:[{id:'c',name:'기존 분류'}]}],settings={pendingGenerationDraft:{jobId:item.id,checkpoint:cp}},before=JSON.stringify(settings);
 const plan=require('../src/lib/historyRetry').retryPlan(h.root,item,[item],settings,accounts);assert.equal(plan.allowed,true);assert.equal(plan.mode,'checkpoint');assert(plan.checkpoint.steps['1:research-title-prompt.txt']);assert.equal(plan.checkpoint.steps['1:research-title-search-1.txt'],undefined);assert.equal(JSON.stringify(settings),before);
});
test('repair never invents absent original text or modifies an article/image checkpoint',()=>{
 const cp={version:2,attemptNumber:1,inputSources:{},steps:{},retrievals:{'1:1':{searchResults:extras}}};assert.equal(E.recover(cp),null);cp.inputSources={original:[input]};assert(E.recover(cp));for(const part of [{articleCheckpoint:{writer:writer()}},{imageCheckpoint:{writer:writer()}},{steps:{'1:prompt.txt':writer()}}])assert.equal(E.recover({...cp,...part}),null);
});
test('restoring input text does not turn an unsupported claim or unknown source ID into evidence',()=>{
 const sources=E.merge([input],extras);assert.match(evidenceIssue({factBased:true,factChecks:[{claim:'없는 자료로 주장',essential:true,supported:true,sourceIds:['unknown']}]},sources),/출처 연결/);assert.match(evidenceIssue({factBased:true,factChecks:[{...fact(input),supported:false}]},sources),/출처 연결/);
});
