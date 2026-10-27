const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const formats=require('../src/lib/blogFormatProfiles'),lengths=require('../src/lib/articleRequirements'),publication=require('../src/lib/publicationFormat'),prompts=require('../src/lib/generationPrompts'),memory=require('../src/lib/writingMemory'),layout=require('../src/lib/blogLayout');
const {articlePlan}=require('../extension/article-plan'),runner=require('../src/lib/codexRunner')._private;
test('new article policy enforces 1000–1200 characters across genres and approved samples',()=>{
 for(const id of ['balanced','explanation','practical','comparison','essay','off']){
  const options={jobDir:'/tmp/length-policy-test',articleLengthPolicy:1,formatGuidance:formats.guidance(id),writingGuidance:{typicalArticleCharacters:250}};
  assert.deepEqual(lengths.limits(options),{min:1000,max:1200,target:1100});
  for(const count of [1000,1100,1200])assert.equal(lengths.articleLengthIssue({article:'가'.repeat(count)},options),'');
  for(const count of [999,1201])assert.match(lengths.articleLengthIssue({article:'가'.repeat(count)},options),/1000~1200자/);
  for(const prompt of [prompts.researchPrompt(options),prompts.writerPrompt(options),prompts.reviewPrompt(options)])assert(prompt.includes('1000~1200자'));
 }
 assert.equal(lengths.articleCharacterCount('제 목\n\n[SECTION - 소제목]\n본 문\n[IMAGE INSERT - 1]\n[자료](https://example.org/source)'),'제목소제목본문자료'.length);
});
test('short new writing stays within genre budgets and a long legacy article needs explicit rewriting',()=>{
 for(const [id,max] of [['explanation',1000],['practical',1200],['comparison',1100],['essay',700]]){
  const options={formatGuidance:formats.guidance(id)},limit=lengths.limits(options);
  assert.equal(limit.max,max);assert(limit.target<limit.max);
  assert.equal(lengths.articleLengthIssue({article:'가'.repeat(limit.target)},options),'');
  assert.match(lengths.articleLengthIssue({article:'가'.repeat(max+1)},options),/반복과 군더더기/);
 }
 assert.equal(lengths.limits({compactWriting:true,formatGuidance:null}).max,1000);
 assert.equal(lengths.articleCharacterCount('본문 링크 https://example.com/document?id=7 뒤 설명'),lengths.articleCharacterCount('본문 링크 뒤 설명'));
 assert.equal(lengths.limits({formatGuidance:{version:3,id:'practical'}}).max,3200);
});
test('all public references disappear while body conditions, attribution, disclosure and useful links survive',()=>{
 const body='지원받아 작성한 글입니다. 기관의 설명에 따르면 대상 조건이 다릅니다.\n\n신청 주소 https://example.com/apply?id=3 는 필요합니다.\n\n[SECTION - 조건에 맞는 선택]\n모든 사람에게 같은 방법이 맞는 것은 아닙니다.';
 for(const label of ['[SECTION - 참고자료]','[SECTION - 출처]','## 참고 문헌','References:','출처:']){
  const raw=body+'\n\n'+label+'\n참고 1: 실제 사용한 자료\nhttps://example.com/evidence';
  const original={article:raw,citations:[{sourceId:'a',url:'https://example.com/evidence?utm_source=test&doc=7'}]},clean=publication.cleanPublicationUrls(original);
  assert.equal(clean.article,body);assert.equal(original.article,raw);assert.equal(clean.citations[0].url,'https://example.com/evidence?doc=7');
  const plan=articlePlan(raw,{preserveParagraphs:true,presentation:{preserveImageOrder:true}});
  assert(!plan.some(b=>b.text?.includes('example.com/evidence')));assert(plan.some(b=>b.text?.includes('apply?id=3')));
 }
 const old=body+'\n\n[SECTION - 참고자료]\n자료 링크\nhttps://example.com/evidence\n\n[SECTION - 추가 설명]\n예외 조건은 여기에도 남습니다.';
 assert(publication.omitReferences(old).includes('예외 조건은 여기에도 남습니다.'));assert(articlePlan(old).some(b=>b.text==='예외 조건은 여기에도 남습니다.'));
});
test('internal evidence remains mandatory even when public bibliography is absent',()=>{
 const article='가'.repeat(700),options={formatGuidance:formats.guidance('explanation'),researchTitleResult:{factBased:true,factChecks:[{sourceIds:['a'],essential:true}]},searchResults:[{sourceId:'a',url:'https://example.com/evidence',excerpt:'실제 원문'}]};
 const writer={status:'success',article,citations:[{sourceId:'a',url:'https://example.com/evidence'}]};
 assert.equal(runner.writerOutputIssueReason(writer,options),'');
 assert.match(runner.writerOutputIssueReason({...writer,citations:[]},options),/내부 citations/);
 assert.match(runner.writerOutputIssueReason({...writer,citations:[{sourceId:'a',url:'https://example.com/wrong'}]},options),/일치/);
});
test('approved whole-article size, section count, opening and ending guide the next brief within short limits',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'blogauto-short-memory-'));
 try{
  const originalArticle='원래 글을 길게 반복하며 설명하던 내용입니다. '.repeat(45);
  const opening='자주 쓰는 도구를 꺼내 놓은 뒤 필요한 순서를 살펴봤어요. '.repeat(3);
  const ending='물건을 더 사기 전에 지금 쓰는 도구의 위치를 바꿔보려 해요. '.repeat(3);
  const article=opening+'\n\n[SECTION - 손에 닿는 자리]\n'+('자주 찾는 도구를 먼저 가까운 곳에 두었어요. '.repeat(8))+'\n\n'+ending;
  assert.throws(()=>memory.add(root,'a',{approved:false,source:'edited',title:'수정본',originalArticle,article}),/승인/);
  memory.add(root,'a',{approved:true,source:'edited',title:'수정본',originalArticle,article});
  const guide=memory.guidance(root,'a');assert.equal(guide.typicalArticleCharacters,lengths.articleCharacterCount(article));assert.equal(guide.typicalSectionCount,1);assert(guide.typicalOpeningCharacters>0);assert(guide.typicalClosingCharacters>0);
  const options={jobDir:root,formatGuidance:formats.guidance('explanation'),writingGuidance:guide};
  assert.equal(lengths.limits(options).target,guide.typicalArticleCharacters);
  assert(prompts.writerPrompt(options).includes('typicalSectionCount'));assert(JSON.stringify(guide).length<2500);
  assert.equal(lengths.limits({...options,writingGuidance:{typicalArticleCharacters:5000}}).target,900);
  assert.equal(memory.guidance(root,'b'),null);
  const essayArticle=opening+'\n\n'+ending;memory.add(root,'essay',{approved:true,source:'edited',title:'짧은 일상',originalArticle,article:essayArticle});const essayGuide=memory.guidance(root,'essay');assert.equal(essayGuide.typicalSectionCount,0);assert.equal(essayGuide.typicalOpeningCharacters,lengths.articleCharacterCount(opening));assert.equal(essayGuide.typicalClosingCharacters,lengths.articleCharacterCount(ending));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('research, writing and final review agree on compact scope and hidden references without new stages',()=>{
 const options={jobDir:'/tmp/test',compactWriting:true,formatGuidance:formats.guidance('explanation')};
 for(const prompt of [prompts.researchPrompt(options),prompts.writerPrompt(options),prompts.reviewPrompt(options)]){assert(prompt.includes('700자'));assert(prompt.includes('한 질문'));assert(!prompt.includes('참고자료] 하나만 두고'));}
 assert(prompts.writerPrompt(options).includes('공개 원고에는 참고자료·출처 목록'));
 assert(prompts.reviewPrompt(options).includes('공개 링크가 없다는 이유로 반려하지 않는다'));
 const article='독자의 상황을 짧게 설명하는 첫 문단입니다.\n\n'+Array.from({length:4},(_,i)=>`[SECTION - 설명 ${i}]\n필요한 조건을 여기에서 이어서 설명합니다.`).join('\n\n');
 assert.match(layout.issue({article},options),/최대 3개/);
 const report=layout.report({article:'가'.repeat(700)},options);assert.equal(report.articleCharacters,700);assert.equal(report.lengthBudget.max,1000);assert.equal(report.referencesVisible,false);
});
test('resolving saved v3 auto and fixed formats retains their original length and presentation policy',()=>{
 const auto=formats.resolve({version:3,id:'balanced'},{writerContract:{articleFormat:'explanation'}});
 assert.equal(auto.version,3);assert.equal(auto.surface.minSections,2);assert.equal(auto.surface.paragraphTarget,80);assert.equal(auto.editing,undefined);assert.equal(lengths.limits({formatGuidance:auto}).max,2800);
 const surface={minSections:2,paragraphTarget:90,lineTarget:24,alignment:'center'},fixed=formats.resolve({version:3,id:'practical',surface});
 assert.deepEqual(fixed.surface,surface);assert.equal(fixed.version,3);assert.equal(lengths.limits({formatGuidance:fixed}).max,3200);
 assert.equal(formats.resolve(formats.guidance('balanced'),{writerContract:{articleFormat:'explanation'}}).version,4);
});
