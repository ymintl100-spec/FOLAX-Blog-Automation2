const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=path.resolve(__dirname,'..');
const {runCodexTask,_private}=require(root+'/src/lib/codexRunner');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'blogauto-output-'));
test.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
let sequence=0;
async function run(model,agent='image',extra={}){
 const jobDir=path.join(temp,String(++sequence));fs.mkdirSync(jobDir);
 const resultFileName=agent==='imageStyle'?'image-style-result.json':agent==='main'?'main-result.json':'image-worker-result.json';
 if(model==='fixture-empty')fs.writeFileSync(path.join(jobDir,resultFileName),JSON.stringify({status:'success',titleImagePath:'stale.png',bodyImages:[]}));
 fs.writeFileSync(path.join(jobDir,'exec'),fs.readFileSync(path.join(__dirname,'fake-codex.js')));
 const options={jobDir,runtimeRoot:temp,codexCmdPath:process.execPath,codexModel:model,...extra};
 const prompt=agent==='image'?_private.buildImageWorkerPrompt({...options,maxBodyImages:0,writerResult:{title:'제목',article:'본문',titleImagePrompt:'A desk with books'}}):'Inspect the supplied sample image with tools.\nOutput JSON path: ignored\n- Write a UTF-8 JSON file at the exact Output JSON path.\n- Print one final line after writing the file: BLOGAUTO_RESULT_READY';
 const logs=[];
 try {const result=await runCodexTask({options,prompt,promptFileName:'prompt.txt',resultFileName,agent,log:(...a)=>logs.push(a)});return {result,jobDir,invocation:JSON.parse(fs.readFileSync(path.join(jobDir,'invocation.json'))),logs};}
 catch(e){e.jobDir=jobDir;throw e;}
}
test('image final JSON is saved by the application without model file writes',async()=>{
 const {result,jobDir,invocation}=await run('fixture-json');assert.equal(result.titleImagePath,'generated-title.png');
 assert.equal(JSON.parse(fs.readFileSync(path.join(jobDir,'image-worker-result.json'))).status,'success');
 assert(invocation.args.includes('--output-last-message'));assert(invocation.args.some(a=>a.endsWith('.last-message.txt')));
 assert(!invocation.input.includes('do not use tools'));assert(!invocation.input.includes('Write a UTF-8 JSON file'));assert(invocation.input.includes('Use the tools needed'));
});
test('image tool failure returns the actual failure reason rather than missing-file error',async()=>{
 const {result,logs}=await run('fixture-failed');assert(logs.some(a=>a[0].includes('이미지 생성 도구')));assert.equal(result.status,'failed');assert.match(result.failureReason,/画像|이미지 생성 도구/);assert.equal(result.titleImagePath,'');
});
test('completed assistant event recovers JSON when CLI does not save its last-message file',async()=>{
 const {result,jobDir}=await run('fixture-event');assert.equal(result.status,'success');assert(fs.existsSync(path.join(jobDir,'image-worker-result.json.last-message.txt')));
});
test('legacy model-written result survives a final completion marker',async()=>{
 const {result}=await run('fixture-legacy');assert.equal(result.titleImagePath,'generated-title.png');
});
test('fenced JSON is accepted without extracting unrelated prose',async()=>{assert.equal((await run('fixture-fenced')).result.status,'success')});
test('unstructured failure preserves a diagnostic and redacts credential-like strings',async()=>{
 await assert.rejects(run('fixture-plain'),e=>{assert.equal(e.code,'IMAGE_RESULT_UNAVAILABLE');assert.match(e.message,/이미지 생성 도구/);assert(!e.message.includes('abc123'));assert(!e.message.includes('secret-value'));assert(fs.existsSync(path.join(e.jobDir,'image-worker-result.json.last-message.txt')));return true});
});
test('missing output cannot reuse a previous result or pretend images succeeded',async()=>{
 await assert.rejects(run('fixture-empty'),e=>{assert.equal(e.code,'IMAGE_RESULT_UNAVAILABLE');assert(!fs.existsSync(path.join(e.jobDir,'image-worker-result.json')));return true});
});
test('style analysis still permits tools and saves final JSON',async()=>{const {result,invocation}=await run('fixture-style','imageStyle');assert.equal(result.imageStylePrompt,'soft natural lighting');assert(!invocation.input.includes('do not use tools'))});
test('existing text-stage output remains direct JSON',async()=>{const {result,invocation}=await run('fixture-json','main');assert.equal(result.status,'success');assert(invocation.input.includes('do not use tools'));assert(invocation.args.some(a=>a.endsWith('main-result.json')))});
test('xhigh fallback discards the failed attempt output',async()=>{const {result,invocation}=await run('fixture-fallback','image',{agentModels:{image:'xhigh'}});assert.equal(result.titleImagePath,'generated-title.png');assert(invocation.args.includes('model_reasoning_effort=high'))});
