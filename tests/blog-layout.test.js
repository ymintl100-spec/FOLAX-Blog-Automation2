const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const layout=require('../src/lib/blogLayout'),{guidance}=require('../src/lib/blogFormatProfiles'),quality=require('../src/lib/naverQuality');
const {articlePlan}=require('../extension/article-plan'),{tistoryDocument}=require('../extension/tistory-writer');
const opening='물건을 정리할 때는 자주 쓰는 도구의 위치부터 정하면 찾기 편합니다.';
const body='매일 사용하는 물건은 손에 닿는 곳에 두고, 드물게 사용하는 물건은 별도로 보관합니다.';
const closing='직접 사용해 본 뒤 자주 찾게 되는 물건의 자리부터 조금씩 조정해 보세요.';
const article=opening+'\n\n[SECTION - 쓰임에 맞춰 나누기]\n'+body+'\n그 이유도 함께 설명합니다.\n\n[IMAGE INSERT - 1]\n\n[SECTION - 사용하며 조정하기]\n'+closing+'\n\n[SECTION - 참고자료]\n참고 1: 실제 자료\nhttps://example.com/source';
const options={formatGuidance:guidance('balanced')};
test('format inspection excludes references and detects missing opening, sections, and giant paragraphs',()=>{
 const result=layout.inspect(article);assert.equal(result.sections.length,2);assert.equal(result.opening,opening);assert.equal(result.closing,closing);
 assert.equal(layout.issue({article},options),'');assert.match(layout.issue({article:body.repeat(20)},options),/소제목/);
 assert.match(layout.issue({article:article.replace(body,body.repeat(20))},options),/빈 줄/);
 assert.equal(layout.issue({article:body.repeat(20)},{formatGuidance:null}),'');
});
test('benchmark evidence must cite real opening, closing, and distinct actual headings',()=>{
 const review={status:'PASS',naturalnessPass:true,naverReadabilityPass:true,readerValueAssessment:{openingAnswer:opening,decisionHelp:body},benchmarkFormatPass:true,benchmarkFormatEvidence:{openingQuote:opening,closingQuote:closing,sectionHeadings:['쓰임에 맞춰 나누기','사용하며 조정하기']}};
 assert.equal(quality.reviewEvidenceIssue(review,{article},options),'');
 assert.match(quality.reviewEvidenceIssue({...review,benchmarkFormatEvidence:{...review.benchmarkFormatEvidence,closingQuote:body}},{article},options),/마무리/);
 assert.match(quality.reviewEvidenceIssue({...review,benchmarkFormatEvidence:{...review.benchmarkFormatEvidence,sectionHeadings:['없는 소제목','사용하며 조정하기']}},{article},options),/소제목/);
});
test('authoring plan keeps approved lines together and preserves text and URLs without generating content',()=>{
 const plan=articlePlan(article,{preserveParagraphs:true});
 assert(plan.some(p=>p.type==='paragraph'&&p.text===body+'\n그 이유도 함께 설명합니다.'));
 assert.equal(plan.filter(p=>p.type==='section').length,3);
 const source=article.replace(/^\[SECTION\s*-\s*([^\]]+)\]\s*$/gm,'$1').replace(/\[IMAGE INSERT[^\]]*\]/g,'').replace(/\s/g,'');
 assert.equal(plan.filter(p=>p.type!=='image').map(p=>p.text).join('').replace(/\s/g,''),source);
 const doc=tistoryDocument('새 글',plan,{1:'<img src="own-image.png">'});assert(doc.html.includes('<br>그 이유도 함께 설명합니다.'));assert(doc.html.includes('https://example.com/source'));
 const legacy=articlePlan(article);assert(legacy.some(p=>p.type==='paragraph'&&p.text==='그 이유도 함께 설명합니다.'));
});
test('publish payload transports paragraph preservation and blocks old extensions before new generation',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'blogauto-publish-layout-'));
 const bridge=require('../src/lib/extensionBridge').configureBridge(root);const sent=[];
 bridge.request=async(id,type,payload)=>{sent.push(payload);return {published:true,url:'https://example.com/published'}};
 try{
  const naver=require('../src/lib/naverPublisher');
  await naver.publishToNaver({accountId:'test-account',article,title:'테스트 원고',preserveParagraphs:true});
  await require('../src/lib/tistoryPublisher').publishToTistory({tistoryBlogId:'test-blog',article,title:'테스트 원고',preserveParagraphs:true});
  for(const payload of sent){assert.equal(payload.article,article);assert.equal(payload.preserveParagraphs,true);assert.equal(payload.breakSentencesInBody,false);}
  assert.throws(()=>naver.requireCompatibleEditor({status:'valid',editorBuild:'20261007.2'},'test-blog'),/구버전/);
  assert.doesNotThrow(()=>naver.requireCompatibleEditor({status:'valid',editorBuild:'20261023.1'},'test-blog'));
 }finally{bridge.stop();fs.rmSync(root,{recursive:true,force:true});}
});
