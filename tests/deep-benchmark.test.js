const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const formats=require('../src/lib/blogFormatProfiles'),rhythm=require('../src/lib/readingRhythm'),layout=require('../src/lib/blogLayout'),quality=require('../src/lib/naverQuality'),memory=require('../src/lib/writingMemory');
const {articlePlan}=require('../extension/article-plan'),{tistoryDocument}=require('../extension/tistory-writer');
test('auto chooses genre inside existing research and never invents an essay from style samples',()=>{
 const auto=formats.guidance('balanced');assert.equal(auto.catalog.length,4);
 for(const id of ['explanation','practical','comparison','essay'])assert.equal(formats.resolve(auto,{writerContract:{articleFormat:id}},'실제 경험 메모').id,id);
 assert.equal(formats.resolve(auto,{writerContract:{articleFormat:'essay'}},'').id,'explanation');
 assert.equal(formats.resolve(formats.guidance('comparison'),{writerContract:{articleFormat:'practical'}},'').id,'comparison');
 assert.equal(formats.resolve({version:2,id:'balanced'},{},'').version,2);
});
test('reading rhythm preserves words, numbers with units, URLs, markers and references and is idempotent',()=>{
 const source='평소 사용하는 물건의 자리를 바꾸기 전에 자주 쓰는 순서와 놓을 공간을 함께 살펴봅니다. 정리를 서두르기보다는 어떤 물건을 자주 찾는지 먼저 기록합니다.\n\n[SECTION - 실제로 쓰는 순서]\n용기의 무게는 10 kg 이고 길이는 2.5 cm 입니다. 이 수치는 예시의 기록으로 그대로 보존합니다.\n[IMAGE INSERT - 1]\nhttps://example.com/a?x=2.5&value=10\n\n[SECTION - 참고자료]\n참고 1: 긴 자료명을 원래 그대로 보존하는 실제 링크\nhttps://example.com/document?id=10';
 const guide=formats.guidance('explanation'),result=rhythm.apply(source,guide);
 assert.equal(result.replace(/\s/g,''),source.replace(/\s/g,''));assert(result.includes('10 kg'));assert(result.includes('2.5 cm'));assert(result.includes('https://example.com/a?x=2.5&value=10'));
 assert.equal(result.split('[SECTION - 참고자료]')[1],source.split('[SECTION - 참고자료]')[1]);assert.equal(rhythm.apply(result,guide),result);
 assert(result.split('\n').length>source.split('\n').length);assert.equal(rhythm.settings(guide,{typicalLineCharacters:35}).lineTarget,35);
});
test('essay can retain a scene and closing without artificial headings or advice',()=>{
 const article='출근길에 늘 지나치던 골목을 오늘은 천천히 걸었습니다.\n\n사진을 남기려고 멈췄는데 평소 보지 못한 표지판이 보였습니다.\n\n돌아오는 길에는 다음에도 이 골목을 지나고 싶다는 생각이 들었습니다.';
 const guide=formats.guidance('essay'),writer={article};assert.equal(layout.issue(writer,{formatGuidance:guide}),'');
 const review={status:'PASS',naturalnessPass:true,naverReadabilityPass:true,benchmarkFormatPass:true,readerValueAssessment:{openingAnswer:article.split('\n\n')[0],decisionHelp:article.split('\n\n')[2]},benchmarkFormatEvidence:{openingQuote:article.split('\n\n')[0],closingQuote:article.split('\n\n')[2],arcQuote:article.split('\n\n')[1],sectionHeadings:[]}};
 assert.equal(quality.reviewEvidenceIssue(review,writer,{formatGuidance:guide}),'');assert.match(quality.reviewEvidenceIssue({...review,benchmarkFormatEvidence:{...review.benchmarkFormatEvidence,arcQuote:'원고에 없는 새로운 생각을 검수에서 작성합니다.'}},writer,{formatGuidance:guide}),/arcQuote/);
});
test('v3 publication preserves in-section image position and the selected visible style',()=>{
 const article='도입\n\n[SECTION - 첫 번째 부분]\n먼저 이 장면을 설명합니다.\n\n[IMAGE INSERT - 1]\n\n사진 다음에 필요한 조건을 설명합니다.';
 const presentation={...formats.guidance('practical').surface,preserveImageOrder:true};
 const plan=articlePlan(article,{preserveParagraphs:true,presentation});assert.equal(plan[1].style,'quotation_underline');assert.equal(plan[2].type,'paragraph');assert.equal(plan[3].type,'image');assert.equal(plan[4].type,'paragraph');
 const html=tistoryDocument('제목',plan,{1:'<img src="test.png">'},presentation).html;assert(html.indexOf('먼저 이 장면')<html.indexOf('<img'));assert(html.indexOf('<img')<html.indexOf('사진 다음'));assert(html.includes('text-align:center'));assert(!html.includes('<blockquote'));
});
test('approved middle and final edits survive compact memory and account directions remain isolated',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'blogauto-deep-memory-'));try{
  const chunks=Array.from({length:12},(_,i)=>'문단 '+i+'에서는 '+('같은 조건과 쓰임을 살펴보는 설명입니다. ').repeat(3));
  const edited=chunks.slice();edited[5]='중간 수정은 익숙한 말로 풀고 이유를 바로 옆에 놓아요. '+('중간 문장의 리듬을 바꾸었어요. ').repeat(3);edited[11]='마지막 수정은 처음의 장면을 다시 떠올리며 끝내요. '+('행동 목록으로 끝내지 않는 글이에요. ').repeat(3);
  memory.add(root,'a',{source:'edited',approved:true,title:'승인한 글',originalArticle:chunks.join('\n\n'),article:edited.join('\n\n')});
  const guidance=memory.guidance(root,'a');assert(guidance.approvedEdits.some(e=>e.after.includes('중간 수정')));assert(guidance.approvedEdits.some(e=>e.after.includes('마지막 수정')));assert(JSON.stringify(guidance).length<2500);
  memory.savePreferences(root,'a',{enabled:true,avoidPhrases:[],direction:'건강과 일상을 연결하는 내 블로그',formatProfile:'essay'});assert.equal(memory.direction(root,'a'),'건강과 일상을 연결하는 내 블로그');assert.notEqual(memory.direction(root,'b'),memory.direction(root,'a'));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('published research contains 40 public sampling records and no copied paragraphs',()=>{
 const source=require('../docs/blog-benchmark-samples.json');assert.equal(source.samples.length,40);
 for(const blogId of ['doctorkidney','yogawarm'])assert.equal(source.samples.filter(s=>s.blogId===blogId).length,20);
 assert(source.samples.every(s=>s.url.startsWith('https://blog.naver.com/')&&!Object.hasOwn(s,'opening')&&!Object.hasOwn(s,'components')));
});
test('short real-life writing is not padded to the old informational length',()=>{
 const lengths=require('../src/lib/articleRequirements');const source='일상의 장면과 그때 했던 선택을 사실 그대로 남기는 문장입니다. '.repeat(24);
 assert.equal(lengths.articleLengthIssue({article:source},{formatGuidance:formats.guidance('essay')}),'');assert.match(lengths.articleLengthIssue({article:source}),/1800/);
});
test('hero placement follows the genre and stays consistent with the shared article plan',()=>{
 const {articleWithHero}=require('../extension/article-plan');const plan=articlePlan('첫 장면\n\n[SECTION - 본론]\n본문 설명');const hero={type:'hero'};
 assert.deepEqual(articleWithHero(plan,hero,formats.guidance('explanation').surface.heroPosition).map(b=>b.type),['paragraph','hero','section','paragraph']);
 assert.equal(articleWithHero(plan,hero,formats.guidance('practical').surface.heroPosition)[0].type,'hero');
});
