const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../src/lib/articleRelevance');
const opening='굳은살이 있는 발바닥통증을 살필 때는 피부 변화와 생활 조건을 함께 구분해 설명해야 합니다.';
const descriptions=['압력은 한곳에 힘이 실리는 조건과 연결해 설명하고 이번 질문의 범위에서 살펴봅니다.','마찰은 피부에 반복해 닿는 상황을 구체적인 생활 조건과 함께 구분해 설명합니다.','각질은 눈에 보이는 변화와 불편한 증상을 혼동하지 않도록 이번 질문 안에서 설명합니다.'];
const writer={title:'굳은살과 발바닥통증, 관리할 때 무엇을 볼까요?',article:opening+'\n\n'+descriptions.join('\n\n'),tags:['굳은살','발바닥통증','압력','마찰','각질'],bodyImages:[],titleImagePrompt:''};
const options={relevancePolicy:1,researchTitleResult:{writerContract:{relevancePlan:{primaryKeyword:'굳은살',relatedConcepts:['압력','마찰','각질']}}}};
const evidence=()=>({primaryKeyword:'굳은살',answerAligned:true,answerQuote:opening,conceptChecks:options.researchTitleResult.writerContract.relevancePlan.relatedConcepts.map((term,i)=>({term,quote:descriptions[i],relevant:true})),tagsAligned:true,tagExamples:[{tag:'굳은살',quote:opening}],imagesAligned:true,imageChecks:[],naturalUsage:true,reason:'실제 질문의 설명 근거'});
test('internal relevance requires evidence; a missing NDEX result never becomes a measured score',()=>{
 const unmeasured=R.report(writer,options);assert.equal(unmeasured.score,null);assert.equal(unmeasured.externalScore,null);assert.equal(unmeasured.assessed,25);
 const review={relevanceEvidence:evidence()},result=R.report(writer,options,review);
 assert.equal(R.evidenceIssue(review,writer,options),'');assert.equal(result.score,100);assert.equal(result.max,90);assert.equal(result.assessed,90);assert.equal(result.externalScore,null);assert.equal(result.concepts.filter(c=>c.matched).length,3);
 assert.equal(R.qualityIssue(writer,options,review),'');
});
test('fabricated semantic, tag or image quotations cannot manufacture a passing internal score',()=>{
 for(const corrupt of [e=>{e.conceptChecks[0].quote='실제 원고에는 존재하지 않는 가짜 개념 설명입니다.';},e=>{e.tagExamples[0].tag='원고에없는태그';},e=>{e.primaryKeyword='무관한주제';},e=>{e.conceptChecks.push(e.conceptChecks[0]);}]){
  const e=evidence();corrupt(e);assert(R.evidenceIssue({relevanceEvidence:e},writer,options));assert.equal(R.report(writer,options,{relevanceEvidence:e}).score,null);
 }
 const withImages={...writer,titleImagePrompt:'굳은살을 다룬 대표 이미지 설명',bodyImages:[{sequence:1,prompt:'압력 조건을 구분한 본문 설명 그림'}]},e=evidence();
 assert.match(R.evidenceIssue({relevanceEvidence:e},withImages,options),/각 이미지/);
 e.imageChecks=R.imagePlans(withImages).map(i=>({key:i.key,promptQuote:i.prompt,articleQuote:opening,aligned:true}));
 assert.equal(R.evidenceIssue({relevanceEvidence:e},withImages,options),'');assert.equal(R.report(withImages,options,{relevanceEvidence:e}).score,100);
 e.imageChecks[0].promptQuote='이미지 설명에 없는 문구';assert(R.evidenceIssue({relevanceEvidence:e},withImages,options));
});
test('valid negative judgments reduce the score; keyword stuffing does not increase it',()=>{
 const e=evidence();e.conceptChecks[0]={term:'압력',quote:'',relevant:false};e.tagsAligned=false;
 const result=R.report(writer,options,{relevanceEvidence:e});assert(result.score<95);assert.match(R.qualityIssue(writer,options,{relevanceEvidence:e}),/보완|정리|설명/);
 const stuffed={...writer,article:writer.article+'\n\n'+('굳은살 ').repeat(100)};
 const full=R.report(stuffed,options,{relevanceEvidence:evidence()});assert(full.score<100);assert(full.suggestions.some(t=>t.includes('반복')));
});
test('document edits discard semantic evidence from earlier versions without altering stored content',()=>{
 const d={current_version:2,current:{title:writer.title,article:writer.article,data:{writer},digest:'new'},data:{options,research:options.researchTitleResult,writer},reviews:[{version:1,digest:'old',data:{relevanceEvidence:evidence()}}]};
 const before=JSON.stringify(d);assert.equal(R.documentReport(d).score,null);assert.equal(JSON.stringify(d),before);
 d.reviews.unshift({version:2,digest:'new',data:{relevanceEvidence:evidence()}});assert.equal(R.documentReport(d).score,100);
 d.current.data.writer={...writer,tags:['변경한태그']};assert.equal(R.documentReport(d).score,null);
});
test('relevance planning and evidence ride existing prompts, without adding browsing or a scoring model',()=>{
 const P=require('../src/lib/generationPrompts'),o={...options,jobDir:'/tmp/relevance',writerResult:writer};
 assert(P.researchPrompt(o).includes('writerContract.relevancePlan'));assert(P.writerPrompt(o).includes('제목 전체·키워드를 반복해 점수를 채우지'));
 assert(P.reviewPrompt(o).includes('relevanceEvidence:'));assert(P.reviewPrompt(o).includes('NDEX의 외부 계산식'));
});
test('review binding invalidates changed tags or prompt context even when the quoted examples still exist',()=>{
 const review={relevanceEvidence:evidence(),relevanceInputHash:R.inputHash(writer)};
 assert.equal(R.report(writer,options,review).score,100);
 assert.equal(R.report({...writer,tags:[...writer.tags,'무관한변경태그']},options,review).score,null);
 assert.equal(R.report({...writer,article:writer.article+' 다른 의미를 추가한 문장입니다.'},options,review).score,null);
});
