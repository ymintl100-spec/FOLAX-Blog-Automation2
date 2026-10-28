const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {omitReferences}=require('../src/lib/publicationFormat');
const {articlePlan}=require('../extension/article-plan');
const {runWriter,matchingWriterPrefix}=require('../extension/writer');
test('a silent editor command times out once and cannot trigger an overlapping retry',async()=>{
 const {withEditorDeadline}=require('../extension/writer');let calls=0;
 const steps=[{type:'title',text:'원고'}],snapshot={title:'',blocks:[]};
 await assert.rejects(runWriter({steps,read:async()=>snapshot,save:async()=>{},checkCancelled:async()=>{},apply:()=>withEditorDeadline(()=>{calls++;return new Promise(()=>{});},'본문 입력',10)}),error=>error.code==='EDITOR_RESPONSE_TIMEOUT' && /응답이/.test(error.message));
 assert.equal(calls,1);
 assert.equal(await withEditorDeadline(async()=>({ok:true}),'본문 입력',100).then(x=>x.ok),true);
});
test('only the requested standalone operator footer is removed from public text and the shared editor plan',()=>{
 const body='협찬받아 작성했습니다.\n\n[SECTION - 적용 조건]\n조건과 예외를 확인하세요.';
 for(const suffix of ['운영: FOLAX(포렉스) / YM INTL Co., Ltd.','운영: FOLAX(포렉스) / YM INTL\nCo., Ltd.','운영： FOLAX (포렉스) / YM INTL\r\nCo., Ltd.\n']){
  const source=body+'\n\n'+suffix,clean=omitReferences(source);
  assert.equal(clean,body);assert(!articlePlan(source).some(x=>x.text?.includes('운영:')||x.text?.includes('Co., Ltd.')));
  assert.equal(articlePlan(source)[0].text,'협찬받아 작성했습니다.');
 }
 const legitimate='회사 이름 YM INTL Co., Ltd.를 확인했습니다.\n운영 주체와 실제 광고 관계는 설명에 필요합니다.';
 assert.equal(omitReferences(legitimate),legitimate);assert.equal(omitReferences('운영: 다른 회사'), '운영: 다른 회사');
 assert.equal(omitReferences(body+'\n\n운영: FOLAX(포렉스) / YM INTL Co., Ltd.\n\n[SECTION - 참고자료]\n자료 링크'),body);
});
test('snapshot uses the name recorded for the uploaded image when Naver changes its alt text',async()=>{
 const title={value:'저장할 원고',getClientRects:()=>[{}],matches:s=>s==='input,textarea'};
 const image={id:'own-image',matches:s=>s==='.se-image',getAttribute:k=>k==='data-blogauto-asset-name'?'blog_img_title.png':null,querySelector:()=>({getAttribute:()=>''})};
 const document={body:{innerText:''},querySelectorAll:s=>s.startsWith('.se-title-text')?[title]:s==='.se-component'?[image]:[]};
 const context=vm.createContext({document,getComputedStyle:()=>({visibility:'visible'})});
 const snapshot=await vm.runInContext(fs.readFileSync(require.resolve('../extension/editor.js'),'utf8')+'\neditorCommand("snapshot")',context);
 assert.equal(snapshot.blocks[0].name,'blog_img_title.png');
 const steps=[{type:'title',text:'저장할 원고'},{type:'image',name:'blog_img_title.png'},{type:'paragraph',text:'이미지 뒤 본문'}];
 assert.equal(matchingWriterPrefix(snapshot,steps),2);
});
test('title and hero image are followed by every paragraph before the draft can be considered complete',async()=>{
 const steps=[{type:'title',text:'임시저장 검증용'}, {type:'image',name:'blog_img_title.png'}, {type:'paragraph',text:'대표 이미지 뒤 첫 본문'}, {type:'quote',text:'확인할 조건',style:'quotation_line'}, {type:'paragraph',text:'실제 설명과 예외 조건'}];
 let snapshot={title:'',blocks:[]};const stages=[],saved=[];
 const result=await runWriter({steps,requireEmpty:true,read:async()=>JSON.parse(JSON.stringify(snapshot)),checkCancelled:async()=>{},save:async s=>saved.push(s),onBeforeStep:async(n,total,type)=>stages.push([n,type]),apply:async step=>{if(step.type==='title')snapshot.title=step.text;else snapshot.blocks.push({id:'node-'+snapshot.blocks.length,...step});}});
 assert.equal(result.complete,true);assert.equal(result.cursor,steps.length);assert.equal(matchingWriterPrefix(snapshot,steps),steps.length);
 assert.deepEqual(stages.map(s=>s[1]),['title','image','paragraph','quote','paragraph']);assert.equal(saved.at(-1).cursor,steps.length);
});
