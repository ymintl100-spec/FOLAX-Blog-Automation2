'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const P=require('../src/lib/generationPrompts'),{generate}=require('../src/lib/generationPipeline'),runner=require('../src/lib/codexRunner')._private,{retryPlan}=require('../src/lib/historyRetry'),{Operations}=require('../src/lib/operations/service'),D=require('../src/lib/operations/data');
const title='종아리 스트레칭, 벽과 경사대를 활용하는 방법',opening='집에서 움직일 공간과 도구의 쓰임을 먼저 살펴보면 준비할 조건을 구분하기 쉽습니다.',help='각 도구가 필요한 상황과 사용 방법을 함께 읽으면 선택할 기준을 알아보기 쉽습니다.';
function writer(){let article=opening+'\n\n[SECTION - 도구 사용 상황]\n'+help+'\n\n';article+='검'.repeat(1500-require('../src/lib/articleRequirements').articleCharacterCount(article));return {status:'success',title,article,tags:Array.from({length:15},(_,i)=>'검증태그'+i),bodyImages:[],boldSentences:[opening]};}
const research=()=>({status:'PASS',finalTitle:title,factBased:false,factChecks:[],searchNeed:'skip',novelty:{duplicate:true,reason:'벽과 경사대를 쓰는 종아리 스트레칭 소재가 같습니다.'}});
const review=()=>({status:'PASS',publishable:true,articleAnswersTitle:true,topicPreserved:true,factualityPass:true,sourceUsePass:true,riskExpressionPass:true,naturalnessPass:true,naverReadabilityPass:true,readerValueAssessment:{openingAnswer:opening,decisionHelp:help},humanizerDecisions:[],issues:[]});
function harness(t,{reply,options={}}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'folax-topic-reuse-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const calls=[],cp=[],logs=[];let titleChecks=0;
 const opts={jobDir:root,...require('../src/lib/generationDefaults').options,topicMode:'manual',topic:title,includeTitleImage:false,maxBodyImages:0,publishedTopics:[{id:'published-1',title}],historyTitles:[title],onFinalTitleCandidate:()=>{titleChecks++;return {duplicate:true};},onGenerationCheckpoint:c=>cp.push(structuredClone(c)),...options};
 const deps={bodyImageLimit:Number,researchPrompt:P.researchPrompt,researchRetry:P.researchPrompt,writerPrompt:P.writerPrompt,writerRetry:P.writerPrompt,reviewPrompt:P.reviewPrompt,writerIssue:runner.writerOutputIssueReason,imagePromptIssue:runner.writerImageContractIssueReason,reviewIssue:runner.mainReviewPassIssueReason,applyImages:w=>w,runTask:async args=>{calls.push(args);if(args.agent==='research')return reply?reply(args):research();if(args.agent==='writer')return writer();if(args.agent==='main')return review();throw Error('Unexpected stage '+args.agent);}};
 return {root,opts,deps,calls,cp,logs,titleChecks:()=>titleChecks,run:()=>generate(opts,m=>logs.push(m),deps)};
}
test('same subject and exact existing title proceed through Writer and Main with no history-comparison call',async t=>{
 const h=harness(t),r=await h.run();assert.equal(r.publishable,true,r.failureReason);assert.deepEqual(h.calls.map(c=>c.agent),['research','writer','main']);assert.equal(h.titleChecks(),0);assert(h.logs.some(s=>s.includes('중복되지만 작성 계속')));assert.equal(r.tags.length,15);assert.equal(r.autoRetry.used,0);
 const p=JSON.parse(h.calls[0].prompt.split('\n').find(s=>s.startsWith('{"brief"')));assert.equal(p.brief.allowDuplicateTopics,true);assert.equal(p.brief.publishedTopics,undefined);assert.equal(p.brief.historyTitles,undefined);assert(!h.calls[0].prompt.includes('Do not repeat a subject just because time has passed'));
});
test('omitting novelty is allowed and legacy explicit strict mode still enforces its configured gate',async t=>{
 const h=harness(t,{reply:()=>{const r=research();delete r.novelty;return r;}}),r=await h.run();assert.equal(r.publishable,true,r.failureReason);
 const strict=harness(t,{options:{allowDuplicateTopics:false}}),blocked=await strict.run();assert.equal(blocked.status,'duplicate_retry');assert.deepEqual(strict.calls.map(c=>c.agent),['research']);
});
test('a cached older duplicate BLOCK is reconsidered once without turning BLOCK directly into PASS',async t=>{
 const h=harness(t),cached={...research(),status:'BLOCK',failureReason:'기발행 소재입니다.'},cp={version:2,attemptNumber:1,generationOptions:{...h.opts,allowDuplicateTopics:false,onGenerationCheckpoint:undefined},steps:{'1:research-title-prompt.txt':cached},retrievals:{}},before=JSON.stringify(cp);
 const r=await generate({...h.opts,generationCheckpoint:cp},()=>{},h.deps);assert.equal(r.publishable,true,r.failureReason);assert.deepEqual(h.calls.map(c=>[c.agent,c.promptFileName]),[['research','research-topic-reuse.txt'],['writer','prompt.txt'],['main','main-review-1.txt']]);assert.equal(r.autoRetry.used,1);assert.equal(JSON.stringify(cp),before);assert.equal(h.cp.at(-1).generationOptions.allowDuplicateTopics,true);
});
test('genuine missing evidence still stops and repeated duplicate BLOCK cannot loop five times',async t=>{
 const h=harness(t,{reply:()=>({...research(),status:'BLOCK',factBased:true,factChecks:[{claim:'핵심 주장',essential:true,supported:false,sourceIds:[]}],failureReason:'핵심 주장에 근거가 없습니다.'})}),r=await h.run();assert.equal(r.status,'failed');assert(r.failureReason.includes('근거'));assert.equal(h.calls.filter(c=>c.agent==='research').length,2);assert.equal(r.autoRetry.used,1);assert(!h.calls.some(c=>c.agent==='writer'));
});
test('supplemented research may mark the same topic duplicate and still continue',async t=>{
 const h=harness(t,{reply:args=>args.promptFileName==='research-title-prompt.txt'?{...research(),status:'REVISION',novelty:{duplicate:false},searchNeed:'light',searchQueries:['동작 설명 원문']}:research(),options:{onSearchNeeded:async()=>({searchResults:[{sourceId:'extra',url:'https://example.org/conditions',excerpt:'이번 글의 동작 범위를 설명한 검증용 발췌입니다.'}]})}}),r=await h.run();assert.equal(r.publishable,true,r.failureReason);assert.deepEqual(h.calls.map(c=>c.agent),['research','research','writer','main']);
});
test('same-title independent jobs do not steal retry lineage; a completed retry of this job remains blocked',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'folax-reuse-history-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const item={id:'job_100',account_id:'a',blog_id:'fixture',category:'기존 분류',title,status:'duplicate_retry',failure_phase:'title_duplicate',create_at:'2026-11-06T01:00:00Z'},other={...item,id:'job_200',status:'success',create_at:'2026-11-06T02:00:00Z'},accounts=[{id:'a',blogId:'fixture',categories:[{id:'c',name:'기존 분류'}]}],checkpoint={version:2,attemptNumber:1,generationOptions:{},steps:{'1:research-title-prompt.txt':research()},retrievals:{}},settings={pendingGenerationDraft:{jobId:item.id,checkpoint}},before=JSON.stringify(settings);
 const plan=retryPlan(root,item,[other,item],settings,accounts);assert.equal(plan.allowed,true);assert.equal(plan.mode,'checkpoint');assert.equal(plan.sourceId,item.id);assert.equal(plan.checkpoint.generationOptions.allowDuplicateTopics,true);assert.equal(JSON.stringify(settings),before);
 const completed={...other,retry_root_id:item.id};assert.equal(retryPlan(root,item,[completed,item],settings,accounts).allowed,false);assert.equal(retryPlan(root,other,[other],{},accounts).allowed,false);
});
function operations(t,hook){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'folax-reuse-ops-'));let settings={};const calls=[],ops=new Operations(root,{accounts:()=>[{id:'a',blogId:'fixture'}],history:()=>[{id:'old',title,status:'success'}],settings:()=>settings,startJob:async f=>{calls.push(f);return hook?hook(f):{status:'generated'};}});t.after(()=>{ops.db.close();fs.rmSync(root,{recursive:true,force:true});});return {ops,calls,setSettings:v=>settings=v};
}
test('a recommended duplicate is writable and a published topic creates a distinct plan without modifying its old row',async t=>{
 const h=operations(t),topic=h.ops.addTopic('a',{title,keyword:'종아리 스트레칭',category:D.CATEGORIES[0]});await h.ops.generate('a',topic.id);assert.equal(h.calls.length,1);h.ops.db.prepare('UPDATE ops_topics SET status=? WHERE id=?').run('published',topic.id);const before=h.ops.db.prepare('SELECT * FROM ops_topics WHERE id=?').get(topic.id);
 await h.ops.generate('a',topic.id);assert.equal(h.calls.length,2);assert.notEqual(h.calls[1].operationsTopicId,topic.id);assert.deepEqual(h.ops.db.prepare('SELECT * FROM ops_topics WHERE id=?').get(topic.id),before);assert.equal(h.calls[1].requireApproval,true);assert.equal(h.calls[1].publishAfterGenerate,false);assert(h.ops.snapshot('a').topics.candidates.some(x=>x.id===topic.id));
});
test('identical inputs can create another draft while their completed topic and pending-job guard remain intact',async t=>{
 const h=operations(t),input={inputBrief:{mode:'keywords',keywords:['종아리 스트레칭'],urls:[]},category:D.CATEGORIES[0],images:false};await h.ops.generateInputs('a',input);const old=h.calls[0].operationsTopicId;h.ops.db.prepare('UPDATE ops_topics SET status=? WHERE id=?').run('published',old);const before=h.ops.db.prepare('SELECT * FROM ops_topics WHERE id=?').get(old);
 await h.ops.generateInputs('a',input);assert.notEqual(h.calls[1].operationsTopicId,old);assert.deepEqual(h.ops.db.prepare('SELECT * FROM ops_topics WHERE id=?').get(old),before);h.setSettings({pendingGenerationDraft:{jobId:'running'}});await assert.rejects(()=>h.ops.generateInputs('a',input),/중단된 기존 작업/);assert.equal(h.calls.length,2);
});
test('allowing reused topics does not allow two concurrent generation requests',async t=>{
 let release;const h=operations(t,()=>new Promise(r=>release=r)),topic=h.ops.addTopic('a',{title,keyword:'종아리 스트레칭',category:D.CATEGORIES[0]}),first=h.ops.generate('a',topic.id);await assert.rejects(()=>h.ops.generate('a',topic.id),/현재 작업/);assert.equal(h.calls.length,1);release({status:'generated'});await first;
});
