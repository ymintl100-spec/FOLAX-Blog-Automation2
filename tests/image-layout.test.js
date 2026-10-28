const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const L=require('../src/lib/imageLayout'),r=require('../src/lib/codexRunner')._private,{retryPlan}=require('../src/lib/historyRetry');
const options={includeTitleImage:true,maxBodyImages:3,minimumImageCount:4,formatGuidance:{version:4,id:'explanation'}};
const images=()=>[1,2,3].map(sequence=>({sequence,sectionHeading:'확인할 조건',prompt:'원고에 있는 서로 다른 조건 '+sequence,path:''}));
function fixture(){return {title:'원래 제목',titleImagePrompt:'제목에 맞는 장면',citations:[{sourceId:'existing',url:'https://example.org/original'}],bodyImages:images(),article:'도입의 답입니다.\n\n[SECTION - 확인할 조건]\n첫 번째 조건입니다.\n[IMAGE INSERT - 1]\n\n두 번째 조건입니다.\n[IMAGE INSERT - 2]\n\n세 번째 조건입니다.\n[IMAGE INSERT - 3]'};}
const words=s=>s.replace(/\[\s*IMAGE\s+INSERT[^\]]*\]/gi,'').replace(/\s/gu,'');
test('marker spelling, indentation, unicode separators and zero-based IDs normalize without changing prose or prompts',()=>{
 const w=fixture();w.bodyImages=w.bodyImages.map((i,n)=>({...i,sequence:n}));
 w.article=w.article.replace('[IMAGE INSERT - 1]','  [image insert — ０]  ').replace('[IMAGE INSERT - 2]','[IMAGE\nINSERT: 1]').replace('[IMAGE INSERT - 3]','뒤 설명 [IMAGE INSERT - 2]');
 const before=JSON.stringify(w),fixed=L.normalize(w);assert(r.writerImageContractIssueReason(w,options));assert.equal(r.writerImageContractIssueReason(fixed,options),'');
 assert.equal(words(fixed.article),words(w.article));assert.deepEqual(fixed.bodyImages.map(i=>i.prompt),w.bodyImages.map(i=>i.prompt));assert.equal(JSON.stringify(w),before);assert.deepEqual(L.normalize(fixed),fixed);
 const restored=L.normalize({...fixture(),bodyImages:images().map(i=>({...i,sequence:i.sequence+4})),article:fixture().article.replace(/INSERT - (\d)/g,(_,n)=>'INSERT - '+(Number(n)+4))},{renumber:false});assert.deepEqual(restored.bodyImages.map(i=>i.sequence),[5,6,7]);
});
test('image-only placement repair handles duplicate metadata IDs while preserving every word, title and citation',()=>{
 const w=fixture();w.bodyImages[1].sequence=1;const before=JSON.stringify(w),c=L.context(w);
 const result={status:'success',fingerprint:c.fingerprint,placements:c.images.map((_,i)=>({imageIndex:i+1,afterParagraphId:c.paragraphs[i].id})),article:'This untrusted field is never used'};
 const fixed=L.applyRepair(w,result,options);assert.equal(r.writerImageContractIssueReason(fixed,options),'');assert.equal(words(fixed.article),words(w.article));assert.equal(fixed.title,w.title);assert.deepEqual(fixed.citations,w.citations);assert.equal(JSON.stringify(w),before);
 assert.deepEqual(fixed.bodyImages.map(i=>i.sequence),[1,2,3]);assert.match(L.diagnostic(w),/계획 \[1, 1, 3\]/);
});
test('stale, incomplete or nonexistent paragraph placements stop without altering the original article',()=>{
 const w=fixture(),c=L.context(w),placements=c.images.map((_,i)=>({imageIndex:i+1,afterParagraphId:c.paragraphs[i].id})),before=JSON.stringify(w);
 for(const bad of [{fingerprint:'stale',placements},{fingerprint:c.fingerprint,placements:placements.slice(1)},{fingerprint:c.fingerprint,placements:placements.map((p,i)=>i? p:{...p,afterParagraphId:'not-in-article'})}])assert.throws(()=>L.applyRepair(w,bad,options));
 assert.equal(JSON.stringify(w),before);
 const generic={...w,article:w.article.replace('확인할 조건','본문'),bodyImages:w.bodyImages.map(i=>({...i,sectionHeading:'본문'}))};assert.equal(L.context(generic).paragraphs.length,3);
});
test('legacy marker failures reuse the last saved writer rather than rewriting it or replaying an older review',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'folax-marker-history-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const item={id:'job_100',account_id:'a',blog_id:'fixture-blog',category:'건강',status:'failed',failure_phase:'writer',failure_kind:'quality',reason:'본문 보완 중단 · 이미지 번호가 중복되었거나 본문 마커와 일치하지 않습니다.'};
 const checkpoint={version:2,attemptNumber:1,generationOptions:{},retrievals:{},steps:{'1:research-title-prompt.txt':{status:'PASS'},'1:prompt.txt':{article:'이전 첫 원고'},'1:prompt-retry-2.txt':{...fixture(),article:fixture().article+'\n마지막 원고의 끝입니다.'},'1:main-review-1.txt':{status:'REVISION'}}};
 const file=path.join(root,'jobs',item.id,'generation-checkpoint.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(checkpoint));const before=fs.readFileSync(file,'utf8');
 const p=retryPlan(root,item,[item],{},[{id:'a',blogId:'fixture-blog',categories:[{id:'c',name:'건강'}]}]);assert.equal(p.allowed,true);assert.equal(p.mode,'checkpoint');assert.match(p.reason,/마지막 본문 재사용/);
 assert.equal(p.checkpoint.steps['1:prompt.txt'].article,checkpoint.steps['1:prompt-retry-2.txt'].article);assert.equal(p.checkpoint.steps['1:main-review-1.txt'],undefined);assert.equal(fs.readFileSync(file,'utf8'),before);
});
