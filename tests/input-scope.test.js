'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const S=require('../src/lib/inputScope'),P=require('../src/lib/generationPrompts'),{generate}=require('../src/lib/generationPipeline'),runner=require('../src/lib/codexRunner')._private;
const url='https://example.org/mat-use',keyword='지압',source={sourceId:'input-link-1-1',inputKind:'link',inputValue:url,url,excerpt:'검증용 원문: 지압매트는 편안한 강도로 사용하고 체중을 조절합니다. 도구가 없으면 앉아서 손으로 부드럽게 누르는 방법을 소개합니다.'},extra={sourceId:'more-1',url:'https://example.org/conditions',excerpt:'검증용 보충 자료: 해당 도구에 적용되는 사용 환경과 조절 조건을 설명합니다.'};
const opening='지압매트 사용 방법을 살펴볼 때는 원문에 나온 도구와 사용 상황을 함께 구분해 볼 수 있어요.',help='편안한 강도로 사용하는 조언과 체중을 조절하는 설명을 같은 사용 상황 안에서 읽어보세요.';
const brief={mode:'mixed',keywords:[keyword],urls:[url]},scope=(gaps=[])=>({articleScope:'원문에 나온 지압매트의 사용 방법',links:[{url,sourceId:source.sourceId,subject:'지압매트 사용',purpose:'도구 사용 방법 설명',quote:'지압매트는 편안한 강도로 사용하고 체중을 조절합니다.'}],gaps});
const fact=s=>({claim:s.excerpt,essential:true,supported:true,sourceIds:[s.sourceId]});
function research(status='PASS',gaps=[]){return {status,finalTitle:'지압매트 사용 방법, 원문에서는 어떻게 설명할까요?',factBased:true,factChecks:[fact(source)],searchNeed:status==='PASS'?'skip':'strict',searchQueries:['발바닥 지압 통증 임상 중단 기준'],verificationQueries:['ICU 환자 발 마사지 통증'],linkScope:scope(gaps),inputAnalysis:{keywords:[{keyword,summary:'원문의 지압매트 사용 방법과 연결되는 입력 키워드입니다.'}],links:[{url,summary:'편안한 강도와 체중 조절을 설명한 원문입니다.'}]}};}
function writer(){let article=opening+'\n\n[SECTION - 도구 사용 상황]\n'+help+'\n\n';article+='검'.repeat(1500-require('../src/lib/articleRequirements').articleCharacterCount(article));return {status:'success',title:research().finalTitle,article,citations:[{sourceId:source.sourceId,url}],tags:Array.from({length:15},(_,i)=>'검증태그'+i),bodyImages:[],boldSentences:[opening]};}
const review=()=>({status:'PASS',publishable:true,articleAnswersTitle:true,topicPreserved:true,factualityPass:true,sourceUsePass:true,riskExpressionPass:true,naturalnessPass:true,naverReadabilityPass:true,inputCoveragePass:true,inputScopePass:true,inputScopeEvidence:[{url,sourceId:source.sourceId,sourceQuote:scope().links[0].quote,articleQuote:help}],readerValueAssessment:{openingAnswer:opening,decisionHelp:help},humanizerDecisions:[],issues:[]});
function harness(t,{researchReply,reviewReply,onSearch,options={}}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'folax-link-scope-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const calls=[],reads=[],searches=[],cp=[];
 const opts={jobDir:root,...require('../src/lib/generationDefaults').options,inputBrief:brief,topicMode:'input',includeTitleImage:false,maxBodyImages:0,readInputLink:async u=>{reads.push(u);return source;},searchInputKeyword:async()=>{throw Error('Mixed initial collection must not search unrelated keywords');},onSearchNeeded:async(r,c)=>{searches.push({r,c});return onSearch?onSearch(r,c):{searchResults:[extra]};},onGenerationCheckpoint:c=>cp.push(structuredClone(c)),...options};
 let researches=0,reviews=0;
 const deps={bodyImageLimit:Number,researchPrompt:P.researchPrompt,researchRetry:P.researchPrompt,writerPrompt:P.writerPrompt,writerRetry:P.writerPrompt,reviewPrompt:P.reviewPrompt,writerIssue:runner.writerOutputIssueReason,imagePromptIssue:runner.writerImageContractIssueReason,reviewIssue:runner.mainReviewPassIssueReason,applyImages:w=>w,runTask:async args=>{calls.push(args);if(args.agent==='research')return researchReply?researchReply(++researches,args):research();if(args.agent==='writer')return writer();if(args.agent==='main')return reviewReply?reviewReply(++reviews,args):review();throw Error('Unexpected model '+args.agent);}};
 return {root,opts,deps,calls,reads,searches,cp,run:()=>generate(opts,()=>{},deps)};
}
test('all three existing prompts hand off the original link scope without an extra agent',()=>{
 const opts={inputScopePolicy:1,inputBrief:brief,jobDir:'/tmp/fixture',searchResults:[source],researchTitleResult:research(),writerResult:writer()};
 for(const prompt of [P.researchPrompt(opts),P.writerPrompt(opts),P.reviewPrompt(opts)]){assert(prompt.includes('의학적 기준'));assert(prompt.includes('입력 링크의 실제 주제'));}
 const payload=JSON.parse(P.writerPrompt(opts).split('\n').find(s=>s.startsWith('{"brief"')));assert.deepEqual(payload.research.linkScope,scope());assert(P.reviewPrompt(opts).includes('위 JSON에 inputScopePass'));assert(P.researchPrompt(opts).includes('위 JSON에 linkScope'));
});
test('every link scope requires real original quotations and exact supplied IDs',()=>{
 const opts={inputScopePolicy:1,inputBrief:brief,searchResults:[source]};assert.equal(S.planIssue(research(),opts),'');
 for(const change of [{sourceId:'imagined'},{quote:'이 원문에 전혀 없는 보편적인 임상 기준입니다.'},{url:'https://example.org/other'}]){const r=research();Object.assign(r.linkScope.links[0],change);assert(S.planIssue(r,opts));}
 const r=research();r.linkScope.gaps=[{keyword:'ICU 환자',question:'통증 치료 효과'}];assert(S.planIssue(r,opts));
});
test('mixed inputs with sufficient original text skip initial keyword search and finish in three calls',async t=>{
 const h=harness(t),r=await h.run();assert.equal(r.publishable,true,r.failureReason);assert.deepEqual(h.calls.map(c=>c.agent),['research','writer','main']);assert.deepEqual(h.reads,[url]);assert.equal(h.searches.length,0);assert.equal(r.tags.length,15);assert.equal(r.autoRetry.used,0);
 const replay=await generate({...h.opts,generationCheckpoint:h.cp.at(-1)},()=>{},h.deps);assert.equal(replay.article,r.article);assert.equal(h.calls.length,3);assert.equal(h.reads.length,1);
});
test('only declared gaps search the user keyword and original subject, never stale broad clinical queries',async t=>{
 const gaps=[{keyword,question:'해당 도구의 사용 환경과 조절 조건'}],h=harness(t,{researchReply:n=>n===1?research('REVISION',gaps):research()}),r=await h.run();assert.equal(r.publishable,true,r.failureReason);assert.equal(h.searches.length,1);const {r:request,c}=h.searches[0];assert.deepEqual(request.searchQueries,['지압 지압매트 사용 해당 도구의 사용 환경과 조절 조건']);assert.deepEqual(request.verificationQueries,[]);assert.equal(c.inputScope.articleScope,scope().articleScope);assert.deepEqual(c.inputBrief,brief);assert.deepEqual(h.calls.map(c=>c.agent),['research','research','writer','main']);
});
test('after unsupported expansion the same source can support one bounded return to its actual scope',async t=>{
 const gaps=[{keyword,question:'도구 사용 환경'}];const h=harness(t,{researchReply:(n,args)=>args.promptFileName==='research-input-final.txt'?research():{...research('REVISION',gaps),factChecks:[{claim:'모든 자가 지압의 임상 기준',essential:true,supported:false,sourceIds:[]}],failureReason:'새로 넓힌 주장에 직접 임상 근거가 없습니다.'},onSearch:async()=>({searchResults:[]})});const r=await h.run();assert.equal(r.publishable,true,r.failureReason);assert.equal(h.searches.length,1);assert.equal(h.calls.filter(c=>c.promptFileName==='research-input-final.txt').length,1);assert.equal(r.autoRetry.used,1);assert.equal(r.researchTitleResult.factChecks[0].sourceIds[0],source.sourceId);
});
test('a still unsupported core is blocked after scoped replanning without forcing PASS or writing',async t=>{
 const h=harness(t,{researchReply:(n,args)=>args.promptFileName==='research-input-final.txt'?{...research(),status:'BLOCK',failureReason:'링크 핵심 주장 자체에 필요한 근거가 없습니다.'}:{...research('REVISION'),factChecks:[{...fact(source),supported:false}]}}),r=await h.run();assert.equal(r.status,'failed');assert(r.failureReason.includes('핵심 주장'));assert(!h.calls.some(c=>c.agent==='writer'));assert.equal(h.searches.length,0);
});
test('Main cannot accept drift using only agreement between its own generated title and article',async t=>{
 const h=harness(t,{reviewReply:()=>({...review(),inputScopePass:false,failureReason:'특정 매트 사용 조언을 모든 발 지압의 임상 기준으로 넓혔습니다.'}),options:{maxAutoRetries:undefined,revisionPolicy:undefined}}),r=await h.run();assert.equal(r.status,'failed');assert(r.failureReason.includes('입력 링크'));assert.equal(h.calls.filter(c=>c.agent==='writer').length,2);
});
test('scope PASS requires actual source and article quotes; an invalid review repairs only Main',async t=>{
 const h=harness(t,{reviewReply:n=>n===1?{...review(),inputScopeEvidence:[{...review().inputScopeEvidence[0],articleQuote:'원고에 없는 구절로 검수 근거를 꾸몄습니다.'}]}:review()}),r=await h.run();assert.equal(r.publishable,true,r.failureReason);assert.equal(h.calls.filter(c=>c.agent==='writer').length,1);assert.equal(h.calls.filter(c=>c.agent==='main').length,2);assert.equal(r.autoRetry.used,1);
});
test('a malformed scope plan gets one bounded response correction with no unrelated searches',async t=>{
 const h=harness(t,{researchReply:()=>{const r=research();delete r.linkScope;return r;}}),r=await h.run();assert.equal(r.status,'failed');assert.equal(r.autoRetry.used,1);assert.equal(h.calls.filter(c=>c.agent==='research').length,2);assert.equal(h.searches.length,0);assert(!h.calls.some(c=>c.agent==='writer'));
});
test('legacy research failure keeps all saved material but discards the broadened title and round caches',async t=>{
 const h=harness(t);const cp={version:2,attemptNumber:1,generationOptions:{...h.opts,inputScopePolicy:undefined,articleLengthPolicy:3,tagCount:15,onGenerationCheckpoint:undefined},inputSources:{['link:'+url]:[source]},steps:{'1:research-title-prompt.txt':{...research(),status:'REVISION',finalTitle:'아플 만큼 세게 눌러야 할까요?'}},retrievals:{'1:1':{searchResults:[extra]}},retrievalQueries:{'1:1':['verification:old query']}};const before=JSON.stringify(cp),r=await generate({...h.opts,generationCheckpoint:cp},()=>{},h.deps);assert.equal(r.publishable,true,r.failureReason);assert.equal(h.calls[0].promptFileName,'research-title-prompt.txt');assert(h.calls[0].prompt.includes(extra.excerpt));assert.equal(h.reads.length,0);assert.equal(h.searches.length,0);assert.equal(JSON.stringify(cp),before);assert(h.cp.at(-1).inputScopePriorRetrievals['1:1']);
});
test('completed draft, approved image and keyword-only checkpoints never migrate to a new source scope',()=>{
 const cp={version:2,attemptNumber:1,generationOptions:{inputBrief:brief},inputSources:{original:[source]},steps:{},retrievals:{}};assert(S.recover(cp));for(const part of [{articleCheckpoint:{writer:writer()}},{imageCheckpoint:{writer:writer()}},{steps:{'1:prompt.txt':writer()}},{generationOptions:{inputBrief:{mode:'keywords',keywords:[keyword],urls:[]}}}])assert.equal(S.recover({...cp,...part},true),null);
});
test('multiple mixed inputs retain every link and keyword with gaps tied to the selected keyword',async t=>{
 const urls=[url,'https://example.org/second','https://example.org/third'],keywords=[keyword,'체중 조절','도구 사용'],sources=urls.map((u,i)=>({...source,sourceId:'input-link-'+(i+1)+'-1',inputValue:u,url:u})),o={inputScopePolicy:1,inputBrief:{mode:'mixed',keywords,urls},searchResults:sources},r=research();r.linkScope.links=sources.map(s=>({...scope().links[0],url:s.url,sourceId:s.sourceId}));r.linkScope.gaps=[{keyword:keywords[2],question:'같은 도구의 사용 조건'}];assert.equal(S.planIssue(r,o),'');assert(S.queryRequest(r,o).searchQueries[0].startsWith(keywords[2]+' '));
});
test('long keywords still produce a query accepted by the actual search lane length limit',()=>{
 const key='가'.repeat(100),o={inputScopePolicy:1,inputBrief:{...brief,keywords:[key]}},r=research('REVISION',[{keyword:key,question:'필요한 설명 '.repeat(20)}]),q=S.queryRequest(r,o).searchQueries[0];assert(q.length<=140);assert(q.startsWith(key+' '));assert(q.includes('필요한'));assert(q.includes('지압매트'));
});
test('a malformed followup plan cannot trigger an invalid query or bypass the one final scoped correction',async t=>{
 const gaps=[{keyword,question:'도구 사용 환경'}],h=harness(t,{researchReply:(n,args)=>args.promptFileName==='research-input-final.txt'?research():n===1?research('REVISION',gaps):{...research('REVISION'),linkScope:{...scope(),gaps:'invalid'}}}),r=await h.run();assert.equal(r.publishable,true,r.failureReason);assert.equal(h.searches.length,1);assert.equal(h.calls.filter(c=>c.promptFileName==='research-input-final.txt').length,1);
});
test('a scope adjustment does not bypass a genuine existing-topic duplicate verdict',async t=>{
 const h=harness(t,{options:{allowDuplicateTopics:false},researchReply:(n,args)=>args.promptFileName==='research-input-final.txt'?{...research(),novelty:{duplicate:true,reason:'같은 주제가 이미 발행됐습니다.'}}:{...research('REVISION'),factChecks:[{...fact(source),supported:false}]}}),r=await h.run();assert.equal(r.status,'duplicate_retry');assert(!h.calls.some(c=>c.agent==='writer'));
});
test('a failed scope response is not cached as completed and explicit retry calls only that response again',async t=>{
 let valid=false;const h=harness(t,{researchReply:()=>{const r=research();if(!valid)delete r.linkScope;return r;}}),first=await h.run();assert.equal(first.status,'failed');const cp=h.cp.at(-1);assert.equal(cp.steps['1:research-input-scope.txt'],undefined);valid=true;h.calls.length=0;const second=await generate({...h.opts,generationCheckpoint:cp},()=>{},h.deps);assert.equal(second.publishable,true,second.failureReason);assert.deepEqual(h.calls.map(c=>c.agent),['research','writer','main']);assert.equal(h.reads.length,1);
});
