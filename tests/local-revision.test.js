'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const R=require('../src/lib/editorialRevision'),P=require('../src/lib/generationPrompts'),{generate}=require('../src/lib/generationPipeline'),runner=require('../src/lib/codexRunner')._private;
const opening='걷기 전에는 신발 상태와 움직일 공간을 함께 살펴보면 준비할 조건을 구분하기 쉽습니다.',help='서로 다른 조건은 필요한 위치에서 한 번씩 설명하면 선택할 기준을 알아보기 쉽습니다.';
function writer(){let article=opening+'\n\n[SECTION - 조건을 살펴보는 순서]\n'+help+'\n\n원고에서 실제로 바꿀 구절을 확인하는 검증용 문장입니다.';article+='검'.repeat(1427-require('../src/lib/articleRequirements').articleCharacterCount(article));return {status:'success',title:'걷기 전 준비, 어떤 조건부터 살펴볼까요?',article,tags:Array.from({length:15},(_,i)=>'걷기준비'+i),citations:[],bodyImages:[],titleImagePrompt:'',titleImageText:[],boldSentences:[opening]};}
const review=pass=>({status:pass?'PASS':'REVISION',publishable:pass,articleAnswersTitle:true,topicPreserved:true,factualityPass:true,sourceUsePass:true,riskExpressionPass:true,naturalnessPass:pass,naverReadabilityPass:pass,readerValueAssessment:{openingAnswer:opening,decisionHelp:help},humanizerDecisions:[],issues:[],failureReason:pass?'':'같은 설명을 정리하세요.',revisionInstructions:pass?[]:['마지막 문단의 반복 설명을 합치고 필요한 조건을 직접 설명하세요.']});
function harness(t,{reply,passAt=2,options={}}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'folax-bound-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const calls=[],cp=[],w=writer();let mains=0;
 const opts={jobDir:root,...require('../src/lib/generationDefaults').options,topicMode:'manual',includeTitleImage:false,maxBodyImages:0,searchResults:[],...options,onGenerationCheckpoint:c=>cp.push(structuredClone(c))};
 const deps={bodyImageLimit:Number,researchPrompt:P.researchPrompt,researchRetry:P.researchPrompt,writerPrompt:P.writerPrompt,writerRetry:P.writerPrompt,reviewPrompt:P.reviewPrompt,writerIssue:runner.writerOutputIssueReason,imagePromptIssue:runner.writerImageContractIssueReason,reviewIssue:runner.mainReviewPassIssueReason,applyImages:w=>w,runTask:async args=>{
  calls.push(args);if(args.agent==='research')return {status:'PASS',finalTitle:w.title,factBased:false,factChecks:[],searchNeed:'skip'};
  if(args.agent==='main')return review(++mains>=passAt);
  if(args.promptFileName.startsWith('article-revision-')){const p=JSON.parse(args.prompt.split('\n').find(s=>s.startsWith('{"revisionProtocol"')));return reply?reply(p,args):{status:'success',edits:[{paragraphId:p.document.filter(p=>p.id).at(-1).id,after:p.document.filter(p=>p.id).at(-1).text.replace('바꿀 구절','고칠 부분')}]};}
  if(args.agent==='writer')return w;throw Error('Unexpected '+args.agent);
 }};
 return {root,w,opts,deps,calls,cp,run:()=>generate(opts,()=>{},deps)};
}
test('paragraph edits need no echoed fingerprint and preserve all unaffected data',()=>{
 const w=writer(),before=JSON.stringify(w),c=R.context(w),p=c.document.find(p=>p.id==='p3'),result=R.apply(w,{status:'success',edits:[{paragraphId:'p3',after:p.text.replace('바꿀 구절','고칠 부분')}]},c);
 assert.equal(JSON.stringify(w),before);assert.equal(result.article,w.article.replace('바꿀 구절','고칠 부분'));for(const k of ['title','tags','citations','bodyImages','boldSentences'])assert.deepEqual(result[k],w[k]);
 const prompt=R.repairPrompt(w,'반복 정리',require('../src/lib/generationDefaults').options,c),payload=JSON.parse(prompt.split('\n').at(-1));assert.equal(payload.revisionProtocol,2);assert.equal(payload.fingerprint,undefined);assert.equal(payload.writer.article,undefined);assert.equal(payload.articleCharacters,1427);assert.deepEqual(payload.lengthBudget,{target:2000,enforced:false});assert.equal(payload.lengthBudget.minimumChange,undefined);
});
test('app-owned binding safely accepts an exact literal edit even if the model omitted or mistyped the obsolete hash',()=>{
 const w=writer(),c=R.context(w);for(const fingerprint of [undefined,'wrong-hash']){const result=R.apply(w,{status:'success',fingerprint,edits:[{before:help,after:help.replace('선택할 기준','고를 기준')}]},c);assert(result.article.includes('고를 기준'));}
 assert.throws(()=>R.apply(w,{status:'success',fingerprint:'wrong',edits:[{before:help,after:help+' 수정'}]}),e=>e.code==='REVISION_FINGERPRINT_MISMATCH');
});
test('changed article, tags or image identity cannot use another request binding, including a model-supplied fake context',()=>{
 const w={...writer(),bodyImages:[{sequence:1,sectionHeading:'기존 위치',prompt:'원래 설명',path:'accepted.png'}]},c=R.context(w),response={status:'success',edits:[{paragraphId:'p2',after:help+' 수정'}]};
 for(const changed of [{...w,article:w.article+' 추가'},{...w,tags:['다른태그']},{...w,bodyImages:[{...w.bodyImages[0],sectionHeading:'다른 위치'}]},{...w,bodyImages:[{...w.bodyImages[0],path:'other.png'}]}])assert.throws(()=>R.apply(changed,{...response,context:R.context(changed)},c),e=>e.code==='REVISION_SOURCE_CHANGED');
});
test('paragraph ids distinguish repeated text and preserve CRLF, emoji, headings and image markers',()=>{
 const duplicate='같은 문장이 반복되어도 선택한 문단만 고쳐야 합니다.',article='첫 설명입니다. 😀\r\n의미 단위 줄입니다.\r\n\r\n[SECTION - 조건]\r\n'+duplicate+'\r\n\r\n[IMAGE INSERT - 1]\r\n\r\n'+duplicate,w={...writer(),article},c=R.context(w);assert.equal(c.document.filter(p=>p.id).length,3);const out=R.apply(w,{status:'success',edits:[{paragraphId:'p3',after:'마지막 문단만 바꿔서 조건을 분명히 설명합니다.'}]},c);assert(out.article.startsWith(article.slice(0,article.lastIndexOf(duplicate))));assert(out.article.includes('[IMAGE INSERT - 1]'));assert(out.article.includes(duplicate));assert(out.article.includes('😀\r\n'));
 assert.throws(()=>R.apply(w,{status:'success',edits:[{paragraphId:'missing',after:'수정'}]},c),e=>e.code==='REVISION_PARAGRAPH_ID');assert.throws(()=>R.apply(w,{status:'success',edits:[{paragraphId:'p2',after:'[IMAGE INSERT - 9]'}]},c),/표식/);assert.throws(()=>R.apply(w,{status:'success',edits:[{paragraphId:'p2',after:'수정1'},{paragraphId:'p2',after:'수정2'}]},c),/겹칩니다/);
});
test('failed status retains its real reason, while missing status and shape get distinct diagnostics',()=>{
 const w=writer(),c=R.context(w);assert.throws(()=>R.apply(w,{status:'failed',failureReason:'제공 자료로 필수 분량을 충족할 수 없습니다.'},c),e=>e.code==='REVISION_REJECTED'&&e.message.includes('필수 분량'));
 assert.throws(()=>R.apply(w,{edits:[]},c),e=>e.code==='REVISION_RESPONSE_STATUS');assert.throws(()=>R.apply(w,{status:'success',article:'전체 원고'},c),e=>e.code==='REVISION_RESPONSE_SHAPE');
 const p=c.document.find(p=>p.id==='p2'),wrapped=R.apply(w,{status:'success',result:{edits:[{paragraphId:'p2',after:p.text+' 수정'}]}},c);assert(wrapped.article.includes(' 수정'));
 assert.throws(()=>R.apply(w,{status:'success',result:{edits:[]},data:{edits:[]}},c),e=>e.code==='REVISION_RESPONSE_SHAPE');
});
test('the reported 1427-character draft proceeds with one hash-free paragraph correction and Main review',async t=>{
 const h=harness(t),result=await h.run();assert.equal(result.publishable,true,result.failureReason);assert.equal(result.autoRetry.used,1);assert.deepEqual(h.calls.map(c=>c.agent),['research','writer','main','writer','main']);assert.equal(result.tags.length,15);assert(result.article.includes('고칠 부분'));
 const key='1:article-revision-2.txt',cp=h.cp.at(-1);assert.equal(cp.stepBindings[key].version,2);assert(cp.stepBindings[key].sourceFingerprint);assert(cp.stepBindings[key].promptHash);
 h.calls.length=0;const replay=await generate({...h.opts,generationCheckpoint:cp},()=>{},h.deps);assert.equal(replay.article,result.article);assert.equal(h.calls.length,0);assert.equal(replay.autoRetry.used,1);
});
test('substantive failed response stops after one correction and preserves its real reason and draft',async t=>{
 const h=harness(t,{reply:()=>({status:'failed',failureReason:'새 근거 없이 필수 설명을 추가할 수 없습니다.'})}),r=await h.run();assert.equal(r.status,'failed');assert.equal(r.autoRetry.used,1);assert(r.failureReason.includes('새 근거 없이'));assert.equal(r.article,h.w.article);assert.equal(h.calls.filter(c=>c.promptFileName.startsWith('article-revision-')).length,1);
 const file=path.join(h.root,'attempt-1','revision-response-diagnostics.jsonl'),diagnostics=fs.readFileSync(file,'utf8').trim().split('\n').map(s=>JSON.parse(s));assert.equal(diagnostics[0].code,'REVISION_REJECTED');
});
test('two identical response protocol errors stop instead of consuming all five calls',async t=>{
 const h=harness(t,{reply:()=>({status:'success',article:'부분 수정 대신 잘못된 전체 원고'})}),r=await h.run();assert.equal(r.status,'failed');assert.equal(r.autoRetry.used,2);assert.match(r.failureReason,/연속 두 번/);assert.equal(r.article,h.w.article);assert.equal(h.calls.filter(c=>c.promptFileName.startsWith('article-revision-')).length,2);
});
test('one malformed response can be repaired once without changing the original request scope',async t=>{
 let count=0;const h=harness(t,{reply:p=>++count===1?{status:'PASS'}:{status:'success',edits:[{paragraphId:'p3',after:p.document.find(p=>p.id==='p3').text.replace('바꿀 구절','고칠 부분')}]}}),r=await h.run();assert.equal(r.publishable,true,r.failureReason);assert.equal(r.autoRetry.used,2);assert.equal(h.calls.filter(c=>c.agent==='research').length,1);assert.equal(h.calls.filter(c=>c.agent==='main').length,2);
});
test('a cache from another source or an unbound old request is rejected and only the correction is called anew',async t=>{
 const h=harness(t),first=await h.run();assert(first.publishable);const cp=h.cp.at(-1),key='1:article-revision-2.txt';delete cp.steps['1:main-review-2.txt'];
 for(const variant of ['different-source','unbound']){
  const saved=structuredClone(cp);if(variant==='different-source')saved.stepBindings[key].sourceFingerprint='other-source';else delete saved.stepBindings[key];
  saved.autoRetry={version:1,used:0,max:5,round:2,history:[]};h.calls.length=0;const r=await generate({...h.opts,generationCheckpoint:saved},()=>{},h.deps);assert.equal(r.publishable,true,r.failureReason);assert.deepEqual(h.calls.map(c=>c.agent),['writer','main']);
 }
});
