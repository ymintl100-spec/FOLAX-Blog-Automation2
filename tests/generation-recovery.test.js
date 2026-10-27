const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {imageEvidenceContext}=require('../src/lib/generationRecovery');
const {retryPlan}=require('../src/lib/historyRetry');
test('legacy image recovery selects the final retrieval of the saved attempt without inventing sources',()=>{
 const source={sourceId:'saved',url:'https://example.org/saved',excerpt:'actual saved fixture excerpt'};
 const recovery={attemptNumber:1,generationOptions:{searchResults:[]},retrievals:{'1:2':{searchResults:[]},'1:10':{searchResults:[source]},'2:1':{searchResults:[{sourceId:'other-attempt'}]}}};
 const before=JSON.stringify(recovery);assert.deepEqual(imageEvidenceContext(recovery).searchResults,[source]);assert.equal(JSON.stringify(recovery),before);
 recovery.imageCheckpoint={evidenceContext:{searchResults:[]}};assert.deepEqual(imageEvidenceContext(recovery).searchResults,[]);
});
test('the reported zero-token citation rejection keeps the approved image checkpoint; real writer rejections still revise text',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'folax-history-image-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const imageCheckpoint={version:1,title:'기존 제목',writer:{article:'기존 승인 본문'},review:{status:'PASS'}};
 const checkpoint={version:2,attemptNumber:1,steps:{'1:research-title-prompt.txt':{status:'PASS'},'1:prompt.txt':{article:'기존 승인 본문'}},retrievals:{},imageCheckpoint};
 const item={id:'job_100',account_id:'a',blog_id:'fixture-blog',category:'기존 분류',title:'기존 제목',status:'failed',failure_phase:'writer',failure_kind:'quality',token_total:0,reason:'본문 보완 중단 · 본문 출처가 전달한 원문과 일치하지 않습니다. 제공된 sourceId와 URL을 사용하세요.'};
 const accounts=[{id:'a',blogId:'fixture-blog',categories:[{id:'c',name:'기존 분류'}]}];
 const settings={pendingGenerationDraft:{jobId:item.id,checkpoint}};
 const before=JSON.stringify(settings);const plan=retryPlan(root,item,[item],settings,accounts);
 assert.equal(plan.allowed,true);assert.equal(plan.mode,'checkpoint');assert.deepEqual(plan.checkpoint.imageCheckpoint,imageCheckpoint);assert.equal(JSON.stringify(settings),before);
 const folder=path.join(root,'jobs',item.id);fs.mkdirSync(folder,{recursive:true});
 const file=path.join(folder,'generation-checkpoint.json'),bytes=JSON.stringify(checkpoint);fs.writeFileSync(file,bytes);
 const diskPlan=retryPlan(root,item,[item],{},accounts);
 assert.equal(diskPlan.allowed,true);assert.equal(diskPlan.mode,'checkpoint');assert.deepEqual(diskPlan.checkpoint.imageCheckpoint,imageCheckpoint);assert.equal(fs.readFileSync(file,'utf8'),bytes);
 for(const change of [{token_total:10},{reason:'본문의 필수 내용이 부족합니다.'}]){
  const rejected={...item,...change},p=retryPlan(root,rejected,[rejected],settings,accounts);assert.equal(p.mode,'writer');assert.equal(p.checkpoint.imageCheckpoint,undefined);
 }
});
