'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const W=require('../src/lib/writingRequest'),P=require('../src/lib/generationPrompts'),R=require('../src/lib/editorialRevision'),L=require('../src/lib/articleRequirements'),F=require('../src/lib/blogFormatProfiles');
const request='발바닥 지압 집에서 간편하게 하는 방법과 포렉스 꾹꾹 매트 활용법을 쓰고, 제품의 좋은 점을 강조해 주세요.';
test('per-article instructions reach research, writing, both repair protocols and final review separately from experience',()=>{
 const options={jobDir:'/tmp/request-test',writingRequest:request,articleLengthPolicy:4,compactWriting:true,formatGuidance:F.guidance('balanced'),revisionPolicy:1};
 const writer={title:'집에서 쓰는 꾹꾹 매트',article:'매트를 평평한 바닥에 놓고 발을 천천히 올려 보세요.\n\n물로 세척한 뒤 충분히 말려 사용하세요.'};
 for(const prompt of [P.researchPrompt(options),P.writerPrompt(options),P.reviewPrompt({...options,writerResult:writer}),... [1,2].map(revisionProtocol=>R.repairPrompt(writer,'사용 후 관리 설명을 보완하세요.',{...options,revisionProtocol}))]){
  assert(prompt.includes(request));assert(prompt.includes('실제 경험이나 사실의 증거가 아니므로'));
 }
 const first=P.writerPrompt(options),payload=JSON.parse(first.split('\n').find(l=>l.startsWith('{"brief":')));
 assert.equal(payload.brief.writingRequest,request);assert.equal(payload.brief.experienceNotes,undefined);
 assert.equal(payload.formatGuide.editing.sections.includes('4~6'),true);
 assert(!first.includes('짧은 편집:'));assert(!P.researchPrompt(options).includes('recommendedStructure는 필요한 1~3개'));
 assert(first.includes('coveragePlan'));assert(first.includes('세척/건조'));assert(P.reviewPrompt(options).includes('writingRequestReview'));
 // Planning cannot introduce a new mandatory length check or rewrite an old guide.
 assert.equal(L.articleLengthIssue({article:'근거 있는 짧은 본문'},options),'');assert(F.guidance('balanced').editing.sections.includes('1~3'));
});
test('request compliance needs an actual manuscript quote; unsupported requested effects are not fabricated evidence',()=>{
 const options={writingRequest:request},writer={article:'포렉스 꾹꾹 매트는 바닥에 두고 발을 올려 사용하는 방식이에요.'};
 const good={status:'PASS',writingRequestReview:{pass:true,reason:'요청한 제품의 사용 편의성을 설명합니다.',evidence:[{requirement:'제품 활용법',articleQuote:'바닥에 두고 발을 올려 사용하는 방식이에요.'}],omissions:[]}};
 assert.equal(W.evidenceIssue(good,writer,options),'');assert.equal(W.reviewIssue(good,options),'');
 assert.match(W.evidenceIssue({status:'PASS'},writer,options),/누락/);
 assert.match(W.evidenceIssue({...good,writingRequestReview:{...good.writingRequestReview,evidence:[{requirement:'장점',articleQuote:'직접 써보니 족저근막염이 치료됐어요.'}]}},writer,options),/실제 구절/);
 assert.match(W.reviewIssue({writingRequestReview:{pass:false,reason:'활용법이 누락됐습니다.'}},options),/활용법/);
 assert.equal(W.evidenceIssue({},writer,{}),'');assert.throws(()=>W.normalize('x'.repeat(2001)),/작성 요청/);assert.throws(()=>W.normalize({}),/작성 요청/);
 const review={status:'REVISION',lengthOnlyIssue:true,articleAnswersTitle:true,topicPreserved:true,factualityPass:true,sourceUsePass:true,riskExpressionPass:true,naturalnessPass:true,naverReadabilityPass:true,writingRequestReview:{pass:false}};
 assert.equal(L.advisoryReview(review,{articleLengthPolicy:4}).status,'REVISION');
});
test('keyword/link requests are passed to jobs and saved options without changing existing experience data',async t=>{
 const {Operations}=require('../src/lib/operations/service'),E=require('../src/lib/operations/editorial');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'folax-request-')),calls=[];
 const ops=new Operations(root,{accounts:()=>[{id:'a',blogId:'fixture'}],settings:()=>({}),history:()=>[],startJob:async form=>{calls.push(form);return form;}});
 t.after(()=>{ops.db.close();fs.rmSync(root,{recursive:true,force:true});});
 const category=require('../src/lib/operations/data').CATEGORIES[0],inputBrief={mode:'links',urls:['https://example.com/product'],keywords:[]};
 await ops.generateInputs('a',{inputBrief,category,writingRequest:request});
 assert.equal(calls[0].writingRequest,request);assert.equal(calls[0].experienceNotes,'');assert.equal(calls[0].publishAfterGenerate,false);
 await assert.rejects(()=>ops.generateInputs('a',{inputBrief,category,writingRequest:'x'.repeat(2001)}),/작성 요청/);assert.equal(calls.length,1);
 const legacy='지난주 직접 사용한 사실을 기록한 예전 메모',d=E.create(ops.db,'a',{title:'보존 원고',article:'기존 계정의 원고 내용입니다.',data:{options:{writingRequest:request,experienceNotes:legacy},writer:{}}});
 const options=ops.options('a',d,path.join(root,'review'));
 assert.equal(options.writingRequest,request);assert.equal(options.experienceNotes,legacy);assert.equal(E.read(ops.db,'a',d.id).data.options.experienceNotes,legacy);
});
test('2000-character prose can use more than three useful sections without changing legacy short-form limits',()=>{
 const layout=require('../src/lib/blogLayout'),article='제품 활용과 관리 방법을 차근차근 살펴볼게요.\n\n'+Array.from({length:5},(_,i)=>`[SECTION - 정보 ${i+1}]\n각 역할에 맞는 서로 다른 정보를 설명하는 본문입니다.`).join('\n\n');
 const options={articleLengthPolicy:4,formatGuidance:F.guidance('practical')};
 assert.equal(layout.issue({article},options),'');assert.match(layout.issue({article},{...options,articleLengthPolicy:3}),/최대 3개/);
});
