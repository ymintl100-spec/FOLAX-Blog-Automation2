const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const C=require('../src/lib/reviewContract'),{retryPlan}=require('../src/lib/historyRetry');
const reported='본문과 이미지 계획은 검수 기준에 부합하지만, 필수 이미지 4장의 생성 결과가 제공되지 않아 발행 준비 완료로 판정할 수 없습니다.';
test('pre-image review distinguishes missing generated results from genuine plan and factual defects',()=>{
 for(const failureReason of [reported,'Generated image files are missing.','이미지 파일이 없어 확인할 수 없습니다.'])assert(C.violation({status:'REVISION',publishable:false,failureReason}));
 for(const failureReason of ['본문 이미지 계획이 2장뿐입니다.','이미지 프롬프트의 필수 문구가 누락됐습니다.','Generated image prompts are missing.','생성된 이미지 설명이 누락됐습니다.','핵심 주장에 원문 근거가 없습니다.'])assert.equal(C.violation({status:'REVISION',publishable:false,failureReason}),'',failureReason);
 assert(C.violation({status:'PASS',publishable:true,failureReason:reported}));
 assert.equal(C.violation({status:'PASS',publishable:true,notes:['이미지 파일이 아직 없습니다. 이후 생성하세요.']}),'');
 const prompt=require('../src/lib/generationPrompts').reviewPrompt({jobDir:'/tmp/review',writerResult:{}});assert(prompt.includes('"generatedImagesExpected":false'));assert(prompt.includes('직접 생성하도록 지시하지'));
});
test('legacy scope rejection reuses the latest writer and source retrieval without changing files or settings',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'folax-review-contract-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const checkpoint={version:2,attemptNumber:1,generationOptions:{articleLengthPolicy:1,relevancePolicy:1,minimumImageCount:4,tagCount:30},retrievals:{'1:1':{searchResults:[{sourceId:'saved',excerpt:'수집한 근거 유지'}]}},steps:{'1:research-title-prompt.txt':{status:'PASS',finalTitle:'저장 제목'},'1:prompt.txt':{status:'success',title:'저장 제목',article:'939자였던 이전 원고'},'1:prompt-retry-2.txt':{status:'success',title:'저장 제목',article:'1038자였던 마지막 원고'},'1:tags-repair-2.txt':{status:'success',tags:['기존 태그']},'1:main-review-2.txt':{status:'REVISION',failureReason:reported}}};
 const item={id:'job_100',account_id:'a',blog_id:'fixture',category:'건강',status:'failed',failure_phase:'main_review',failure_kind:'quality',reason:'앱 내부 연관성 87/100 · 목표 95 이상.'},accounts=[{id:'a',blogId:'fixture',categories:[{id:'c',name:'건강'}]}],settings={pendingGenerationDraft:{jobId:item.id,checkpoint}};
 const directory=path.join(root,'jobs',item.id);fs.mkdirSync(directory,{recursive:true});const file=path.join(directory,'generation-checkpoint.json');fs.writeFileSync(file,JSON.stringify(checkpoint));const before=fs.readFileSync(file),settingsBefore=JSON.stringify(settings);
 const result=retryPlan(root,item,[item],settings,accounts);assert.equal(result.mode,'checkpoint');assert.match(result.reason,/마지막 본문 재사용/);assert.equal(result.checkpoint.steps['1:prompt.txt'].article,'1038자였던 마지막 원고');assert(result.checkpoint.steps['1:tags-repair-1.txt']);assert(!result.checkpoint.steps['1:main-review-2.txt']);assert.deepEqual(result.checkpoint.retrievals,checkpoint.retrievals);assert.equal(result.checkpoint.generationOptions.minimumImageCount,4);assert.equal(JSON.stringify(settings),settingsBefore);assert.deepEqual(fs.readFileSync(file),before);
 const disk=retryPlan(root,item,[item],{},accounts);assert.equal(disk.checkpoint.steps['1:prompt.txt'].article,'1038자였던 마지막 원고');
 const genuine=structuredClone(checkpoint);genuine.steps['1:main-review-2.txt']={status:'BLOCK',failureReason:'본문의 필수 주장에 사실 근거가 없습니다.'};const notRecovered=retryPlan(root,item,[item],{pendingGenerationDraft:{jobId:item.id,checkpoint:genuine}},accounts);assert.equal(notRecovered.mode,'writer');assert.equal(C.recover({...checkpoint,imageCheckpoint:{version:1}},'main_review'),null);
});
