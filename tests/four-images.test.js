const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const policy=require('../src/lib/imageCountPolicy'),r=require('../src/lib/codexRunner')._private,prompts=require('../src/lib/generationPrompts');
const options={jobDir:'/tmp/four-images-fixture',minimumImageCount:4,includeTitleImage:true,maxBodyImages:3,formatGuidance:{version:4,id:'explanation'},articleLengthPolicy:1};
function writer(count=3){return {status:'success',title:'검증용 원고',titleImagePrompt:'지원되는 핵심 내용을 시각화',titleImageText:['검증용 원고'],bodyImages:Array.from({length:count},(_,i)=>({sequence:i+1,sectionHeading:'조건을 살펴보기',prompt:'서로 다른 실제 조건 '+(i+1)})),article:'도입\n\n[SECTION - 조건을 살펴보기]\n'+Array.from({length:count},(_,i)=>'조건 '+(i+1)+' 설명\n[IMAGE INSERT - '+(i+1)+']').join('\n\n')};}
test('new image jobs reserve at least four slots independently of body length; explicit image-off stays off',()=>{
 assert.deepEqual(policy.forNewJob({includeTitleImage:true,maxBodyImages:2}),{minimumImageCount:4,maxBodyImages:3});
 assert.deepEqual(policy.forNewJob({includeTitleImage:false,maxBodyImages:2}),{minimumImageCount:4,maxBodyImages:4});
 assert.deepEqual(policy.forNewJob({includeTitleImage:false,maxBodyImages:0}),{minimumImageCount:0,maxBodyImages:0});
 assert.equal(policy.forNewJob({maxBodyImages:10}).maxBodyImages,10);
 for(const fn of [prompts.researchPrompt,prompts.writerPrompt,prompts.reviewPrompt]){const text=fn(options);assert(text.includes('총 최소 4장'));assert(text.includes('1000~1200자'));}
});
test('one section may contain three distinct images without adding headings or allowing omissions to reduce the minimum',()=>{
 const w=writer();assert.equal(r.writerImageContractIssueReason(w,options),'');
 assert.match(r.writerImageContractIssueReason({...writer(1),imageOmissions:[{sectionHeading:'조건을 살펴보기',reason:'짧은 글'}]},options),/최소 4장/);
 assert.match(r.writerImageContractIssueReason(w,{...options,minimumImageCount:undefined}),/중복/);
 assert.match(r.buildImageWorkerPrompt({...options,runtimeRoot:'/tmp',writerResult:w}),/Keep each supplied visual distinct/);
});
test('four verified files are required and partial retry requests only missing or reused images',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'folax-four-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const files=Array.from({length:4},(_,i)=>{const f=path.join(root,i+'.png');fs.writeFileSync(f,'file-existence fixture '+i);return f;});
 const w=writer(),complete={status:'success',titleImagePath:files[0],titleImageVerified:true,bodyImages:w.bodyImages.map((b,i)=>({...b,path:files[i+1],summaryVerified:true}))};
 assert.equal(r.imageWorkerContractIssueReason(complete,w,options),'');
 const noTitle={...options,includeTitleImage:false,maxBodyImages:4};
 const fourBodies={status:'success',bodyImages:writer(4).bodyImages.map((b,i)=>({...b,path:files[i],summaryVerified:true}))};
 assert.equal(r.writerImageContractIssueReason(writer(4),noTitle),'');assert.equal(r.imageWorkerContractIssueReason(fourBodies,writer(4),noTitle),'');
 const partial={...complete,status:'partial',bodyImages:complete.bodyImages.slice(0,1)};
 assert(r.imageWorkerContractIssueReason(partial,w,options));assert.deepEqual(r.pendingImageWriterResult(w,partial,options).bodyImages.map(i=>i.sequence),[2,3]);
 const reused={...complete,bodyImages:complete.bodyImages.map((b,i)=>({...b,path:i===2?files[1]:b.path}))};
 assert.match(r.imageWorkerContractIssueReason(reused,w,options),/같은 파일/);assert.deepEqual(r.pendingImageWriterResult(w,reused,options).bodyImages.map(i=>i.sequence),[3]);
 fs.unlinkSync(files[3]);assert.match(r.imageWorkerContractIssueReason(complete,w,options),/찾지 못/);
});
