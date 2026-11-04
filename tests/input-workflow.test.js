'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const inputs=require('../src/lib/inputWorkflow'),prompts=require('../src/lib/generationPrompts'),lengths=require('../src/lib/articleRequirements'),tags=require('../src/lib/articleTags'),emphasis=require('../src/lib/emphasis');
const {articlePlan,textRuns}=require('../extension/article-plan'),{tistoryDocument}=require('../extension/tistory-writer'),{matchingWriterPrefix}=require('../extension/writer');
const {Operations}=require('../src/lib/operations/service'),E=require('../src/lib/operations/editorial');
const keywordList=['걷기','운동화','깔창'],urlList=['https://example.com/a','https://example.com/b','https://example.com/c'];
test('keyword, link and mixed modes consume exactly 1, 2 or 3 populated fields, deduplicate, and reject invalid inputs',async()=>{
 for(const mode of ['keywords','links','mixed'])for(let n=1;n<=3;n++){
  const brief=inputs.normalize({mode,keywords:mode==='links'?[]:keywordList.slice(0,n).concat(Array(3-n).fill(' ')),urls:mode==='keywords'?[]:urlList.slice(0,n).concat(Array(3-n).fill(''))}),calls=[];
  const sources=await inputs.collect(brief,{}, {readLink:async url=>{calls.push(url);return {url,excerpt:'공개 원문에서 읽은 내용입니다.'};},searchKeyword:async q=>{calls.push(q);return [{url:'https://example.com/'+encodeURIComponent(q),excerpt:'해당 키워드 검색 근거입니다.'}];}});
  assert.deepEqual(calls,[...brief.urls,...brief.keywords]);assert.equal(sources.length,n*(mode==='mixed'?2:1));
  assert.equal(inputs.analysisIssue({inputAnalysis:{keywords:brief.keywords.map(keyword=>({keyword,summary:'입력 키워드마다 제공된 근거를 분석했습니다.'})),links:brief.urls.map(url=>({url,summary:'입력한 원문의 내용을 분석했습니다.'}))}},brief),'');
 }
 assert.deepEqual(inputs.normalize({mode:'mixed',keywords:['걷기',' 걷기 ',''],urls:['https://example.com/a#x','https://example.com/a#y']}),{mode:'mixed',keywords:['걷기'],urls:['https://example.com/a']});
 for(const bad of [{mode:'mixed',keywords:['걷기']},{mode:'links',urls:['file:///private']},{mode:'links',urls:['https://user:pass@example.com']},{mode:'keywords',keywords:['a','b','c','d']},{mode:'keywords',keywords:[' ']}])assert.throws(()=>inputs.normalize(bad));
 assert.match(inputs.analysisIssue({inputAnalysis:{keywords:[],links:[]}},inputs.normalize({mode:'keywords',keywords:['걷기']})),/전체/);
});
test('unreadable link blocks writing, preserves prior reads and resumes only incomplete inputs',async()=>{
 const brief=inputs.normalize({mode:'mixed',keywords:['걷기'],urls:urlList.slice(0,2)}),cache={},reads=[];let saves=0;
 await assert.rejects(()=>inputs.collect(brief,cache,{readLink:async url=>{reads.push(url);return {url,excerpt:url.endsWith('a')?'첫 원문을 읽었습니다.':''};},searchKeyword:async()=>{throw Error('must not search yet');},save:async()=>saves++}),/본문을 읽지 못했습니다/);
 assert.equal(saves,1);assert.equal(Object.keys(cache).length,1);
 await inputs.collect(brief,cache,{readLink:async url=>{reads.push(url);return {url,excerpt:'두 번째 원문입니다.'};},searchKeyword:async q=>[{url:'https://example.org',excerpt:q+' 검색 자료'}],save:async()=>saves++});
 assert.deepEqual(reads,[urlList[0],urlList[1],urlList[1]]);assert.equal(saves,3);
});
test('all six input groups remain visible within the bounded research prompt',()=>{
 const searchResults=[];for(const [inputKind,values] of [['link',urlList],['keyword',keywordList]])for(const inputValue of values)for(let i=0;i<5;i++)searchResults.push({sourceId:inputKind+inputValue+i,inputKind,inputValue,url:'https://example.com/'+searchResults.length,excerpt:'본문 '+i});
 const visible=prompts.sourcesFor({searchResults});assert.equal(visible.length,8);assert.equal(new Set(visible.map(s=>s.inputKind+s.inputValue)).size,6);
});
test('new length, tags and emphasis policies coexist with frozen legacy jobs',()=>{
 assert.deepEqual(lengths.limits({articleLengthPolicy:2}),{min:1000,max:1500,target:1300});assert.equal(lengths.articleLengthIssue({article:'가'.repeat(1500)},{articleLengthPolicy:2}),'');assert.match(lengths.articleLengthIssue({article:'가'.repeat(1501)},{articleLengthPolicy:2}),/1500/);assert.equal(lengths.limits({articleLengthPolicy:1}).max,1200);
 const list=Array.from({length:30},(_,i)=>'걷기태그'+i);assert.equal(tags.normalize(list,10).length,10);assert.equal(tags.normalize(list).length,30);assert.equal(tags.issue({tags:list.slice(0,10)},{tagCount:10}),'');assert.match(tags.issue({tags:list.slice(0,9)},{tagCount:10}),/10개/);assert.match(tags.issue({tags:list.slice(0,10)},{tagCount:30}),/30개/);
 const article='자주 걷는 길에 맞춰 신발을 고르는 것이 중요합니다.\n\n필요한 조건을 함께 살펴보면 선택하기 쉽습니다.',writer={article,boldSentences:['원문에 존재하지 않는 강조 문장입니다.']};assert.deepEqual(emphasis.select(writer,null,{}),[]);const bold=emphasis.select(writer,null,{emphasisPolicy:1});assert.equal(bold.length,1);assert(article.includes(bold[0]));assert.equal(writer.article,article);
});
test('bold runs preserve every character and render safe native HTML, while missing Naver bold fails reconciliation',()=>{
 const quote='맞춤형이라는 이름만으로 고르지 않아도 괜찮아요.',article='다음 문장이 중요합니다. '+quote+'\n조건과 예외도 함께 살펴보세요.';
 const runs=textRuns(article,[quote]);assert.equal(runs.map(r=>r.text).join(''),article);assert.deepEqual(runs.filter(r=>r.bold).map(r=>r.text),[quote]);
 const plan=articlePlan(article,{preserveParagraphs:true,boldSentences:[quote]}),result=tistoryDocument('검증용',plan,{},{});assert(result.html.includes('<strong>'+quote+'</strong>'));assert.equal(result.texts[1],article);
 const unsafe=articlePlan('안내 <script>alert(1)</script> '+quote,{preserveParagraphs:true,boldSentences:[quote]});assert(!tistoryDocument('검증용',unsafe,{},{}).html.includes('<script>'));
 const steps=[{type:'title',text:'검증용'},...plan],snapshot={title:'검증용',blocks:[{type:'paragraph',text:article,boldText:quote}]};assert.equal(matchingWriterPrefix(snapshot,steps),2);assert.equal(matchingWriterPrefix({...snapshot,blocks:[{type:'paragraph',text:article}]},steps),-1);assert.equal(matchingWriterPrefix({...snapshot,blocks:[{type:'paragraph',text:article}]},[{type:'title',text:'검증용'},{type:'paragraph',text:article}]),2);
 const wrapped=quote.replace('이름만으로','이름만으로\n');assert.equal(textRuns(wrapped,[quote]).filter(r=>r.bold).map(r=>r.text).join(''),wrapped);
});
test('input workflow hooks select one draft, preserve existing work and keep emphasis on the current document only',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'folax-inputs-'));let settings={},calls=[];
 const ops=new Operations(root,{accounts:()=>[{id:'a',blogId:'fixture',tistoryBlogId:'fixture-other'}],settings:()=>settings,history:()=>[],startJob:async form=>{calls.push(form);return {documentId:'fixture'};}});t.after(()=>{ops.db.close();fs.rmSync(root,{recursive:true,force:true});});
 const category=require('../src/lib/operations/data').CATEGORIES[0],brief={mode:'mixed',keywords:['걷기'],urls:[urlList[0]]};
 assert.equal((await ops.generateInputs('a',{inputBrief:brief,category})).documentId,'fixture');assert.equal(calls.length,1);assert.deepEqual(calls[0].inputBrief,brief);assert.equal(calls[0].requireApproval,true);assert.equal(calls[0].publishAfterGenerate,false);
 settings={pendingGenerationDraft:{jobId:'old-job'}};await assert.rejects(()=>ops.generateInputs('a',{inputBrief:brief,category}),/중단된 기존 작업/);assert.equal(calls.length,1);assert.equal(settings.pendingGenerationDraft.jobId,'old-job');
 const article='함께 읽으면 이해하기 쉬운 중요한 문장입니다.\n\n다른 설명도 차근차근 이어갑니다.',d=E.create(ops.db,'a',{title:'검증용',article,data:{options:{emphasisPolicy:1},writer:{boldSentences:['함께 읽으면 이해하기 쉬운 중요한 문장입니다.']}}});assert.equal(d.boldSentences.length,1);const edited=E.save(ops.db,'a',d.id,{title:d.current.title,article:'원래 강조 문장을 지운 뒤 새 내용을 살펴보겠습니다.',expectedVersion:1});assert(!edited.boldSentences.includes(d.boldSentences[0]));assert.equal(edited.approved_version,null);assert.equal(E.read(ops.db,'a',d.id).original.article,article);
});
test('all input analysis and bolding share the existing three model calls and successful retry reuses sources/results',async t=>{
 const {generate}=require('../src/lib/generationPipeline'),runner=require('../src/lib/codexRunner')._private;
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'folax-input-pipeline-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const calls=[],fetches=[],checkpoints=[];
 const inputBrief=inputs.normalize({mode:'mixed',keywords:keywordList,urls:urlList}),opening='자주 쓰는 도구는 손이 닿는 곳에 두면 찾는 순서가 단순해집니다.',help='도구마다 쓰는 목적을 구분하면 놓을 자리를 정하기 쉽습니다.',article=opening+'\n\n'+help+'\n\n'+'설명을 위한 자료를 살펴봅니다.'.repeat(90),writer={status:'success',title:'도구를 놓을 때 어떤 기준을 세울까',article,tags:tags.normalize(Array.from({length:10},(_,i)=>'도구정리'+i)),bodyImages:[],boldSentences:[opening]};
 const options={jobDir:root,topicMode:'input',inputBrief,includeTitleImage:false,maxBodyImages:0,tagCount:10,emphasisPolicy:1,articleLengthPolicy:2,readInputLink:async url=>{fetches.push(url);return {url,excerpt:'입력 원문의 상세 설명입니다.'};},searchInputKeyword:async q=>{fetches.push(q);return [{url:'https://example.net/'+encodeURIComponent(q),excerpt:'키워드 자료 설명입니다.'}];},onGenerationCheckpoint:c=>checkpoints.push(c)};
 const deps={runTask:async args=>{calls.push(args.agent);if(args.agent==='research')return {status:'PASS',finalTitle:writer.title,factBased:false,searchNeed:'skip',inputAnalysis:{keywords:keywordList.map(keyword=>({keyword,summary:'각 입력 키워드의 근거와 관련 내용을 분석합니다.'})),links:urlList.map(url=>({url,summary:'각 링크 원문 내용을 분석하고 연결합니다.'}))}};if(args.agent==='writer')return writer;if(args.agent==='main')return {status:'PASS',publishable:true,articleAnswersTitle:true,topicPreserved:true,factualityPass:true,sourceUsePass:true,riskExpressionPass:true,inputCoveragePass:true,naturalnessPass:true,naverReadabilityPass:true,readerValueAssessment:{openingAnswer:opening,decisionHelp:help},issues:[],humanizerDecisions:[]};throw Error('extra model call');},bodyImageLimit:()=>0,researchPrompt:prompts.researchPrompt,researchRetry:prompts.researchPrompt,writerPrompt:prompts.writerPrompt,writerRetry:prompts.writerPrompt,reviewPrompt:prompts.reviewPrompt,writerIssue:()=>'',imagePromptIssue:()=>'',reviewIssue:runner.mainReviewPassIssueReason,imageIssue:()=>'',pendingImages:()=>{},applyImages:w=>w};
 const result=await generate(options,()=>{},deps);assert.equal(result.status,'success',result.failureReason);assert.deepEqual(calls,['research','writer','main']);assert.equal(fetches.length,6);assert.equal(result.tags.length,10);assert(result.boldSentences.includes(opening));
 const replay=await generate({...options,generationCheckpoint:checkpoints.at(-1)},()=>{},deps);assert.equal(replay.article,result.article);assert.equal(fetches.length,6);assert.equal(calls.length,3);
});
test('link-only requests never expand into a search when the provided text is insufficient',async t=>{
 const {generate}=require('../src/lib/generationPipeline');const root=fs.mkdtempSync(path.join(os.tmpdir(),'folax-links-only-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let searched=0,wrote=0;
 const brief=inputs.normalize({mode:'links',urls:[urlList[0]]});
 const result=await generate({jobDir:root,inputBrief:brief,topicMode:'input',includeTitleImage:false,maxBodyImages:0,trustBlogAsSource:true,readInputLink:async url=>({url,excerpt:'분석할 수 있지만 핵심 주장이 부족한 원문입니다.'}),onSearchNeeded:async()=>{searched++;throw Error('must not search');}},()=>{},{bodyImageLimit:()=>0,researchPrompt:prompts.researchPrompt,researchRetry:prompts.researchPrompt,runTask:async args=>{if(args.agent!=='research'){wrote++;throw Error('must not write');}return {status:'REVISION',finalTitle:'부족한 자료',failureReason:'원문에 핵심 정보가 없습니다.',searchNeed:'strict',searchQueries:['다른 글 검색']};}});
 assert.equal(result.status,'failed');assert.equal(searched,0);assert.equal(wrote,0);assert(prompts.researchPrompt({jobDir:root,inputBrief:brief}).includes('추가 검색·외부 링크 확장은 하지 않는다'));
});
