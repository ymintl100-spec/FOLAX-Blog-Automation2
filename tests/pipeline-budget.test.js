const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {generate}=require('../src/lib/generationPipeline');
const prompts=require('../src/lib/generationPrompts');
const runner=require('../src/lib/codexRunner')._private;
const root=fs.mkdtempSync(path.join(os.tmpdir(),'blogauto-budget-'));test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
const title='작업 책상을 정리할 때 무엇부터 남기면 좋을까';
const opening='책상을 정리할 때는 매일 쓰는 물건부터 손이 닿는 곳에 두고 나머지는 쓰임에 따라 나누는 편이 좋습니다.';
const help='같은 역할의 도구를 한곳에 모아두면 필요할 때 찾는 순서가 단순해집니다.';
const article=opening+'\n\n[SECTION - 실제로 쓰는 물건]\n'+help+'\n\n'+Array.from({length:10},(_,i)=>'기준 '+i+'에서는 '+('물건의 쓰임과 놓을 공간을 함께 살펴보고 겹치는 역할은 구분해 설명합니다. ').repeat(4)).join('\n\n');
const writer={status:'success',title,article,citations:[],tags:[],bodyImages:[],titleImagePrompt:'',titleImageText:[],titleImagePath:'',imageOmissions:[]};
const goodReview=()=>({status:'PASS',failureReason:'',articleAnswersTitle:true,topicPreserved:true,factualityPass:true,sourceUsePass:true,riskExpressionPass:true,publishable:true,naturalnessPass:true,naverReadabilityPass:true,readerValueAssessment:{openingAnswer:opening,decisionHelp:help},humanizerDecisions:[],revisionInstructions:[],issues:[]});
let index=0;
function harness({review,blockResearch=false,options={},writerResult=writer}={}){
 const calls=[],checkpoints=[];let reviews=0;
 const opts={jobDir:path.join(root,String(++index)),topicMode:'auto',includeTitleImage:false,maxBodyImages:0,...options,onGenerationCheckpoint:c=>checkpoints.push(JSON.parse(JSON.stringify(c)))};
 const deps={
  runTask:async args=>{calls.push(args);let result;
   if(args.agent==='research')result=blockResearch?{status:'BLOCK',failureReason:'핵심 원문 미확보',factBased:true,factChecks:[]}:{status:'PASS',finalTitle:title,novelty:{duplicate:false,reason:'새로운 구체적 질문'},factBased:false,factChecks:[],searchNeed:'skip'};
   else if(args.agent==='writer')result=writerResult;
   else if(args.agent==='humanizer')result={status:'success',edits:[]};
   else if(args.agent==='main')result=review?review(++reviews):goodReview();
   else throw Error('Unexpected extra model stage: '+args.agent);
   return {...result,tokenUsage:{total:10,inputTokens:8,outputTokens:2,promptCharacters:args.prompt.length}};
  },bodyImageLimit:()=>0,researchPrompt:prompts.researchPrompt,researchRetry:prompts.researchPrompt,writerPrompt:prompts.writerPrompt,writerRetry:prompts.writerPrompt,reviewPrompt:prompts.reviewPrompt,writerIssue:()=>'',imagePromptIssue:()=>'',reviewIssue:runner.mainReviewPassIssueReason,imageIssue:()=>'',pendingImages:()=>{},applyImages:w=>w
 };
 return {calls,checkpoints,opts,deps,run:()=>generate(opts,()=>{},deps)};
}
test('token-saving mode removes only the separate humanizer call and keeps final review',async()=>{
 const lean=harness(),legacy=harness({options:{tokenSaving:false}});
 const a=await lean.run(),b=await legacy.run();assert.equal(a.publishable,true);assert.equal(b.publishable,true);
 assert.deepEqual(lean.calls.map(c=>c.agent),['research','writer','main']);
 assert.deepEqual(legacy.calls.map(c=>c.agent),['research','writer','humanizer','main']);
 assert.equal(a.tokenUsage.total,30);assert.equal(b.tokenUsage.total,40);
});
test('poor naturalness gets one targeted writer correction and remains unpublished if not fixed',async()=>{
 const h=harness({review:()=>({...goodReview(),status:'REVISION',naturalnessPass:false,publishable:false,failureReason:'동일 결론 반복',revisionInstructions:['반복 문단을 근거 있는 구체 설명으로 보완하세요.']})});
 const r=await h.run();assert.equal(r.status,'failed');assert.equal(r.failurePhase,'main_review');assert.equal(h.calls.filter(c=>c.agent==='writer').length,2);assert(!h.calls.some(c=>c.agent==='image'));
});
test('invalid review evidence retries only review on resume and freezes the original style snapshot',async()=>{
 const h=harness({options:{writingGuidance:{fingerprint:'style-before',styleFragments:['차분한 설명']},formatGuidance:{id:'explanation',flow:'고민에서 판단으로'}},review:n=>n===1?{...goodReview(),readerValueAssessment:{openingAnswer:'원고에 없는 검수 인용을 새로 작성합니다.',decisionHelp:help}}:goodReview()});
 const first=await h.run();assert.equal(first.failureKind,'execution');assert.equal(first.failurePhase,'main_review');
 const checkpoint=h.checkpoints.at(-1);h.calls.length=0;
 const second=await generate({...h.opts,generationCheckpoint:checkpoint,writingGuidance:{fingerprint:'style-after'},formatGuidance:{id:'practical'},experienceNotes:'다음 새 글에만 쓰려던 경험',experienceNotesId:'next-job-memo',compactWriting:true,articleLengthPolicy:1},()=>{},h.deps);
 assert.equal(second.publishable,true);assert.deepEqual(h.calls.map(c=>c.agent),['main']);assert.equal(h.calls[0].options.writingGuidance.fingerprint,'style-before');assert.equal(h.calls[0].options.formatGuidance.id,'explanation');assert.equal(h.calls[0].options.experienceNotes,undefined);assert.equal(h.calls[0].options.experienceNotesId,undefined);assert.equal(h.calls[0].options.compactWriting,undefined);
 assert.equal(h.calls[0].options.articleLengthPolicy,undefined);
});
test('the new length policy is checkpointed and retained across image-only resume',async()=>{
 const expected={sequence:1,sectionHeading:'실제로 쓰는 물건',prompt:'정리 순서를 나타내는 장면'};
 const h=harness({writerResult:{...writer,bodyImages:[expected]},options:{maxBodyImages:1,articleLengthPolicy:1}});
 h.deps.bodyImageLimit=Number;h.deps.imagePrompt=runner.buildImageWorkerPrompt;h.deps.mergeImages=runner.mergeImageWorkerAttempts;h.deps.applyImages=(w,images)=>({...w,bodyImages:images.bodyImages});
 const original=h.deps.runTask;
 h.deps.runTask=async args=>{if(args.agent==='image')throw Error('fixture interruption');assert.equal(args.options.articleLengthPolicy,1);assert(args.prompt.includes('1000~1200자'));return original(args);};
 await h.run();const checkpoint=h.checkpoints.at(-1);assert.equal(checkpoint.generationOptions.articleLengthPolicy,1);
 h.deps.runTask=async args=>{assert.equal(args.agent,'image');assert.equal(args.options.articleLengthPolicy,1);return {status:'success',bodyImages:[]};};
 const resumed=await generate({...h.opts,articleLengthPolicy:undefined,generationCheckpoint:checkpoint},()=>{},h.deps);assert.equal(resumed.publishable,true);assert.equal(resumed.writingApplication.lengthBudget.min,1000);assert.equal(resumed.writingApplication.lengthBudget.max,1200);
});
test('a 1000–1200 character article produces four verified image files and reuses accepted files on resume',async()=>{
 const w={...writer,titleImagePrompt:'제목의 핵심 내용을 보여주는 장면',titleImageText:['정리 기준'],bodyImages:[1,2,3].map(sequence=>({sequence,sectionHeading:'실제로 쓰는 물건',prompt:'각기 다른 배치 조건 '+sequence}))};
 const paragraphs=[...article.split('\n\n')];
 w.article=paragraphs.slice(0,9).map((p,i)=>p+(i>=3&&i<=5?'\n[IMAGE INSERT - '+(i-2)+']':'')).join('\n\n').trim();
 const count=require('../src/lib/articleRequirements').articleCharacterCount(w.article);assert(count>=1000&&count<=1200,'fixture length: '+count);
 const h=harness({writerResult:w,options:{includeTitleImage:true,maxBodyImages:3,minimumImageCount:4,articleLengthPolicy:1}});
 Object.assign(h.deps,{bodyImageLimit:Number,writerIssue:runner.writerOutputIssueReason,imagePromptIssue:runner.writerImageContractIssueReason,imagePrompt:runner.buildImageWorkerPrompt,imageIssue:runner.imageWorkerContractIssueReason,pendingImages:runner.pendingImageWriterResult,mergeImages:runner.mergeImageWorkerAttempts,applyImages:(w,i)=>({...w,...i})});
 const original=h.deps.runTask;let images=0;
 const file=n=>{const f=path.join(h.opts.jobDir,n+'.png');fs.writeFileSync(f,'file fixture '+n);return f;};
 h.deps.runTask=async args=>{if(args.agent!=='image')return original(args);h.calls.push(args);images++;
  if(images===1)return {status:'partial',titleImagePath:file('title'),titleImageVerified:true,bodyImages:[{...w.bodyImages[0],path:file('body-1'),summaryVerified:true}]};
  const handoff=JSON.parse(args.prompt.split('Writer Agent image handoff:\n')[1].split('\nRequired output:')[0]);assert.deepEqual(handoff.bodyImages.map(b=>b.sequence),[2,3]);assert.equal(handoff.titleImagePrompt,'');assert(args.prompt.includes('Do not generate a title image.'));
  return {status:'success',titleImagePath:'',titleImageVerified:false,bodyImages:w.bodyImages.slice(1).map(b=>({...b,path:file('body-'+b.sequence),summaryVerified:true}))};};
 const result=await h.run();assert.equal(result.publishable,true,result.failureReason);assert.equal(result.bodyImages.length,3);assert(result.titleImagePath);assert.equal(result.article,w.article);
 assert.deepEqual(h.calls.map(c=>c.agent),['research','writer','main','image','image']);
 const checkpoint=h.checkpoints.at(-1);assert.equal(checkpoint.generationOptions.minimumImageCount,4);h.calls.length=0;
 h.deps.runTask=async()=>{throw Error('No new model call expected for complete images');};
 const resumed=await generate({...h.opts,generationCheckpoint:checkpoint},()=>{},h.deps);assert.equal(resumed.publishable,true);assert.equal(resumed.article,result.article);assert.equal(resumed.bodyImages.length,3);
});
for(const invalidFirst of [false,true])test(`marker mismatch repairs placement only and preserves cached prose across retry (invalidFirst=${invalidFirst})`,async()=>{
 const L=require('../src/lib/imageLayout');
 const w={...writer,titleImagePrompt:'핵심 내용을 보여주는 장면',titleImageText:['정리 기준'],bodyImages:[1,1,3].map((sequence,i)=>({sequence,sectionHeading:'실제로 쓰는 물건',prompt:'서로 다른 조건 '+(i+1)}))};
 w.article=article.split('\n\n').slice(0,9).map((p,i)=>p+(i>=3&&i<=5?'\n[IMAGE INSERT - '+(i-2)+']':'')).join('\n\n').trim();
 const before=JSON.stringify(w),h=harness({writerResult:w,options:{includeTitleImage:true,maxBodyImages:3,minimumImageCount:4,articleLengthPolicy:1}});
 Object.assign(h.deps,{bodyImageLimit:Number,writerIssue:runner.writerOutputIssueReason,imagePromptIssue:runner.writerImageContractIssueReason,imagePrompt:runner.buildImageWorkerPrompt,imageIssue:runner.imageWorkerContractIssueReason,pendingImages:runner.pendingImageWriterResult,mergeImages:runner.mergeImageWorkerAttempts,applyImages:(w,i)=>({...w,...i})});
 const original=h.deps.runTask;let repairs=0;
 h.deps.runTask=async args=>{
   if(args.promptFileName.startsWith('image-layout-repair-')){h.calls.push(args);repairs++;const c=L.context(w);return {status:'success',fingerprint:invalidFirst&&repairs===1?'wrong':c.fingerprint,placements:c.images.map((_,i)=>({imageIndex:i+1,afterParagraphId:c.paragraphs[i].id})),tokenUsage:{total:5}};}
   if(args.agent==='image'){h.calls.push(args);const file=n=>{const f=path.join(h.opts.jobDir,n+'.png');fs.writeFileSync(f,'fixture '+n);return f;};return {status:'success',titleImagePath:file('title'),titleImageVerified:true,bodyImages:[1,2,3].map(sequence=>({sequence,sectionHeading:'실제로 쓰는 물건',path:file('body'+sequence),summaryVerified:true})),tokenUsage:{total:5}};}
   return original(args);
 };
 let result=await h.run();
 if(invalidFirst){assert.equal(result.failurePhase,'image_layout');assert.equal(result.failureKind,'execution');assert.equal(result.article,w.article);const checkpoint=h.checkpoints.at(-1);assert(checkpoint.steps['1:prompt.txt']);assert(!checkpoint.steps['1:image-layout-repair-1.txt']);h.calls.length=0;result=await generate({...h.opts,generationCheckpoint:checkpoint},()=>{},h.deps);assert.deepEqual(h.calls.map(c=>c.agent),['writer','main','image']);}
 else{assert.deepEqual(h.calls.map(c=>c.agent),['research','writer','writer','main','image']);assert.equal(h.calls.filter(c=>c.promptFileName==='prompt.txt').length,1);assert.equal(result.attempts[0].steps.filter(s=>s.kind==='image_layout').length,1);}
 assert.equal(result.publishable,true,result.failureReason);assert.equal(result.bodyImages.length,3);assert(result.titleImagePath);
 const text=s=>s.replace(/\[IMAGE INSERT[^\]]*\]/g,'').replace(/\s/gu,'');assert.equal(text(result.article),text(w.article));assert.equal(result.title,title);assert.deepEqual(result.citations,w.citations);assert.equal(JSON.stringify(w),before);
});
test('missing essential evidence stops before writer and token-saving mode avoids whole-topic retries',async()=>{
 const h=harness({blockResearch:true});const r=await h.run();assert.equal(r.status,'failed');assert.deepEqual(h.calls.map(c=>c.agent),['research']);
 const legacy=harness({blockResearch:true,options:{tokenSaving:false}});await legacy.run();assert.equal(legacy.calls.length,3);
});
test('review evidence is checked after restoring meaning-changing humanizer edits',async()=>{
 const {makeRequest}=require('../packages/blog-humanizer');
 const block=makeRequest({article,title}).blocks.find(b=>!b.locked&&b.text.includes(opening));assert(block);
 const h=harness({options:{tokenSaving:false}}),original=h.deps.runTask;
 h.deps.runTask=async args=>{
  if(args.agent==='humanizer'){h.calls.push(args);return {status:'success',edits:[{id:block.id,text:block.text.replace('매일','자주')}],tokenUsage:{total:10}};}
  if(args.agent==='main'){h.calls.push(args);return {...goodReview(),humanizerDecisions:[{id:block.id,action:'restore'}],tokenUsage:{total:10}};}
  return original(args);
 };
 const r=await h.run();assert.equal(r.publishable,true);assert(r.article.includes(opening));
});
const benchmarkGuide=require('../src/lib/blogFormatProfiles').guidance('balanced');
const closing='매일 쓰는 도구를 가까이 두고 며칠 사용해 본 뒤 불편했던 자리부터 조정해 보세요.';
const headings=['자주 쓰는 도구부터 남기는 이유','공간과 쓰임을 함께 나누는 방법','사용한 뒤 바꿀 자리'];
const benchmarkWriter={...writer,article:opening+'\n\n'+headings.map((h,i)=>'[SECTION - '+h+']\n'+help+'\n\n'+(i===2?closing:'분류 기준 '+i+'에서는 물건을 꺼내고 돌려놓는 위치를 함께 살펴봅니다.')).join('\n\n')};
const benchmarkReview=()=>({...goodReview(),benchmarkFormatPass:true,benchmarkFormatEvidence:{openingQuote:opening,sectionHeadings:headings,closingQuote:closing,arcQuote:help,reason:'고민의 답과 판단 기준, 적용 순서가 실제 원고에 있습니다.'}});
test('benchmark mode stops an old unsegmented template before publishing within the existing correction budget',async()=>{
 const h=harness({writerResult:{...writer,article:article.replace(/^\[SECTION[^\]]+\]\s*$/gm,'')},options:{formatGuidance:benchmarkGuide}});const result=await h.run();
 assert.equal(result.status,'failed');assert.equal(result.failurePhase,'writer');assert.match(result.failureReason,/벤치마크 형식/);
 assert.equal(h.calls.filter(c=>c.agent==='writer').length,2);assert(!h.calls.some(c=>c.agent==='image'));
});
test('real benchmark structure and evidence pass with three calls and report the settings actually used',async()=>{
 const applied=[];const h=harness({writerResult:benchmarkWriter,review:benchmarkReview,options:{formatGuidance:benchmarkGuide,writingGuidance:{exampleCount:2,typicalParagraphCharacters:80},onWritingApplication:a=>applied.push(a)}});
 const result=await h.run();assert.equal(result.publishable,true);assert.deepEqual(h.calls.map(c=>c.agent),['research','writer','main']);
 assert.equal(result.writingApplication.profileId,'explanation');assert.equal(result.writingApplication.guideVersion,4);assert.equal(result.writingApplication.sectionCount,3);assert.equal(result.writingApplication.approvedExamples,2);assert.equal(applied[0].approvedExamples,2);
 assert(h.calls[0].prompt.includes('formatGuide'));assert(h.calls[1].prompt.includes('작은 문단'));
});
test('missing benchmark verdict preserves writer and retries only the review on resume',async()=>{
 const h=harness({writerResult:benchmarkWriter,review:n=>n===1?goodReview():benchmarkReview(),options:{formatGuidance:benchmarkGuide}});
 const first=await h.run();assert.equal(first.failureKind,'execution');assert.match(first.failureReason,/벤치마크 형식 검수/);
 h.calls.length=0;const second=await generate({...h.opts,generationCheckpoint:h.checkpoints.at(-1)},()=>{},h.deps);
 assert.equal(second.publishable,true);assert.deepEqual(h.calls.map(c=>c.agent),['main']);
});
test('a failed benchmark flow gets one targeted correction even when generic quality booleans pass',async()=>{
 const h=harness({writerResult:benchmarkWriter,review:()=>({...benchmarkReview(),benchmarkFormatPass:false,revisionInstructions:['도입의 고민과 소제목별 설명을 연결하세요.']}),options:{formatGuidance:benchmarkGuide}});
 const result=await h.run();assert.equal(result.status,'failed');assert.equal(result.failurePhase,'main_review');assert.equal(h.calls.filter(c=>c.agent==='writer').length,2);
});
test('explicit essay without this-job experience stops without a model call',async()=>{
 const h=harness({options:{formatGuidance:require('../src/lib/blogFormatProfiles').guidance('essay')}});const result=await h.run();assert.equal(result.failurePhase,'input');assert.match(result.failureReason,/실제 경험/);assert.equal(h.calls.length,0);
});
test('actual experience and selected genre are checkpointed before the one-shot memo is consumed',async()=>{
 const order=[],notes='오늘은 평소 지나치던 골목에 잠시 멈춰 표지판을 읽었습니다.';
 const source='출근길에 늘 지나치던 골목을 오늘은 천천히 걸었습니다.\n\n사진을 남기려고 멈췄는데 평소 보지 못한 표지판이 보였습니다.\n\n돌아오는 길에는 다음에도 이 골목을 지나고 싶다는 생각이 들었습니다.';
 const parts=source.split('\n\n');const review={...goodReview(),readerValueAssessment:{openingAnswer:parts[0],decisionHelp:parts[2]},benchmarkFormatPass:true,benchmarkFormatEvidence:{openingQuote:parts[0],closingQuote:parts[2],arcQuote:parts[1],sectionHeadings:[]}};
 const h=harness({writerResult:{...writer,article:source},review:()=>review,options:{formatGuidance:require('../src/lib/blogFormatProfiles').guidance('essay'),experienceNotes:notes,experienceNotesId:'one-shot-memo',onWritingApplication:a=>order.push({event:'consumed',id:a.experienceNotesId})}});
 const save=h.opts.onGenerationCheckpoint;h.opts.onGenerationCheckpoint=c=>{order.push({event:'saved',notes:c.generationOptions.experienceNotes});return save(c)};
 const result=await h.run();assert.equal(result.publishable,true);assert.deepEqual(h.calls.map(c=>c.agent),['research','writer','main']);assert.equal(order[0].event,'saved');assert.equal(order[0].notes,notes);assert.equal(order[1].id,'one-shot-memo');assert.equal(result.writingApplication.profileId,'essay');
});

for(const partial of [false,true])test(`image interruption survives disk restart without regenerating text (partial=${partial})`,async()=>{
 const expected=[1,2].map(sequence=>({sequence,sectionHeading:'실제로 쓰는 물건',prompt:'도구 배치의 구체적인 단계 '+sequence}));
 const h=harness({writerResult:{...writer,bodyImages:expected},options:{maxBodyImages:2}});
 Object.assign(h.deps,{bodyImageLimit:Number,imagePrompt:runner.buildImageWorkerPrompt,
  imageIssue:runner.imageWorkerContractIssueReason,pendingImages:runner.pendingImageWriterResult,
  mergeImages:runner.mergeImageWorkerAttempts,applyImages:(w,images)=>({...w,bodyImages:images.bodyImages||[]})});
 const originalTask=h.deps.runTask;let imageCalls=0;
 const image=sequence=>{const file=path.join(h.opts.jobDir,`fixture-${sequence}.png`);fs.writeFileSync(file,Buffer.from('isolated file-existence fixture, not a generated image'));return {...expected[sequence-1],path:file,summaryVerified:true};};
 h.deps.runTask=async args=>{
  if(args.agent!=='image')return originalTask(args);
  h.calls.push(args);imageCalls++;
  if(partial&&imageCalls===1)return {status:'partial',bodyImages:[image(1)]};
  throw new Error('fixture image tool interruption');
 };
 const first=await h.run();assert.equal(first.publishable,false);assert.equal(first.article,article.trim());
 const checkpoint=h.checkpoints.at(-1);assert.equal(checkpoint.imageCheckpoint.writer.article,first.article);
 assert.equal(checkpoint.imageCheckpoint.review.status,'PASS');
 const checkpointPath=path.join(h.opts.jobDir,'generation-checkpoint.json');fs.writeFileSync(checkpointPath,JSON.stringify(checkpoint));
 const bytes=fs.readFileSync(checkpointPath);h.calls.length=0;
 const item={id:'job_100',account_id:'fixture-account',blog_id:'fixture-blog',category:'기존 분류',title,status:'failed',failure_phase:'image',failure_kind:'execution',create_at:'2026-10-26T00:00:00Z'};
 const accounts=[{id:item.account_id,blogId:item.blog_id,categories:[{id:'category-a',name:item.category}]}];
 const settings={blogId:item.blog_id,maxBodyImages:2,pendingGenerationDraft:{accountId:item.account_id,blogId:item.blog_id,category:item.category,jobId:item.id,checkpoint:JSON.parse(bytes)}};
 const savedFiles={'user-settings.json':JSON.stringify(settings),'account-categories.json':JSON.stringify({selectedAccountId:item.account_id,accounts}),'blog_history.jsonl':JSON.stringify(item)+'\n','existing-draft.json':JSON.stringify({title,article:first.article})};
 for(const [file,data] of Object.entries(savedFiles))fs.writeFileSync(path.join(h.opts.jobDir,file),data);
 const diskSettings=require('../src/lib/settings').readSettings(h.opts.jobDir);
 const diskHistory=require('../src/lib/history').readHistory(h.opts.jobDir);
 const diskAccounts=require('../src/lib/accountStore').readAccountStore(h.opts.jobDir,diskSettings).accounts;
 const plan=require('../src/lib/historyRetry').retryPlan(h.opts.jobDir,diskHistory[0],diskHistory,diskSettings,diskAccounts);
 assert.equal(plan.allowed,true);assert.equal(plan.mode,'checkpoint');assert.equal(plan.checkpoint.imageCheckpoint.writer.article,first.article);
 h.deps.runTask=async args=>{h.calls.push(args);assert.equal(args.agent,'image');
  assert.equal(args.options.imageCheckpoint.writer.article,first.article);
  assert.deepEqual(args.prompt.includes('fixture'),false);
  const handoff=JSON.parse(args.prompt.split('Writer Agent image handoff:\n')[1].split('\nRequired output:')[0]);
  assert.deepEqual(handoff.bodyImages.map(x=>x.sequence),partial?[2]:[1,2]);
  return {status:'success',bodyImages:handoff.bodyImages.map(x=>image(x.sequence)),tokenUsage:{total:7}};
 };
 const second=await generate({...h.opts,jobDir:path.join(h.opts.jobDir,'after-restart'),generationCheckpoint:plan.checkpoint},()=>{},h.deps);
 assert.equal(second.publishable,true);assert.equal(second.article,first.article);assert.equal(second.title,title);
 assert.deepEqual(h.calls.map(c=>c.agent),['image']);assert.equal(second.tokenUsage.total,7);
 assert.deepEqual(second.bodyImages.map(x=>x.sequence),[1,2]);assert.deepEqual(fs.readFileSync(checkpointPath),bytes);
 for(const [file,data] of Object.entries(savedFiles))assert.equal(fs.readFileSync(path.join(h.opts.jobDir,file),'utf8'),data);
 if(partial)assert.equal(second.bodyImages[0].path,checkpoint.imageCheckpoint.images.bodyImages[0].path);
});

for(const legacy of [false,true])test(`source-backed article resumes images with the original retrieved evidence (legacy=${legacy})`,async()=>{
 const source={sourceId:'fixture-original-source',url:'https://example.org/original',excerpt:help,title:'검증 전용 원문'};
 const expected=[{sequence:1,sectionHeading:'실제로 쓰는 물건',prompt:'도구의 배치 조건을 보여주는 그림'}];
 let sourcedArticle=article;
 while(require('../src/lib/articleRequirements').articleCharacterCount(sourcedArticle)<2000)sourcedArticle+='\n\n'+help;
 const w={...writer,article:sourcedArticle,citations:[{sourceId:source.sourceId,url:source.url}],bodyImages:expected};
 const h=harness({writerResult:w,options:{maxBodyImages:1,onSearchNeeded:async()=>({searchResults:[source],sourceQuality:{status:'ready'}})}});
 Object.assign(h.deps,{bodyImageLimit:Number,writerIssue:runner.writerOutputIssueReason,imagePrompt:runner.buildImageWorkerPrompt,imageIssue:runner.imageWorkerContractIssueReason,pendingImages:runner.pendingImageWriterResult,mergeImages:runner.mergeImageWorkerAttempts,applyImages:(w,images)=>({...w,bodyImages:images.bodyImages||[]})});
 const original=h.deps.runTask;let researchCalls=0;
 h.deps.runTask=async args=>{
  if(args.agent==='research'){h.calls.push(args);return {status:++researchCalls===1?'REVISION':'PASS',finalTitle:title,searchNeed:'required',searchQueries:['검증용 원문'],factBased:true,factChecks:[{claim:help,essential:true,supported:true,sourceIds:[source.sourceId]}]};}
  if(args.agent==='image'){h.calls.push(args);throw Error('fixture style verification interruption');}
  return original(args);
 };
 const first=await h.run();assert.equal(first.publishable,false);assert.equal(first.article,sourcedArticle.trim());
 const checkpoint=JSON.parse(JSON.stringify(h.checkpoints.at(-1)));
 if(legacy)delete checkpoint.imageCheckpoint.evidenceContext;
 else assert.deepEqual(checkpoint.imageCheckpoint.evidenceContext.searchResults,[source]);
 h.calls.length=0;
 h.deps.runTask=async args=>{h.calls.push(args);assert.equal(args.agent,'image');assert.deepEqual(args.options.searchResults,[source]);
  const file=path.join(h.opts.jobDir,'source-backed-fixture.png');fs.writeFileSync(file,'file-existence fixture, not a real generated image');
  return {status:'success',titleImagePath:'',bodyImages:[{...expected[0],path:file,summaryVerified:true}]};};
 const second=await generate({...h.opts,generationCheckpoint:checkpoint,searchResults:[{sourceId:'unrelated',url:'https://example.org/other',excerpt:'무관한 새 자료'}]},()=>{},h.deps);
 assert.equal(second.publishable,true,second.failureReason);assert.equal(second.article,first.article);assert.deepEqual(h.calls.map(c=>c.agent),['image']);
});

for(const rejectAgain of [false,true])test(`title style failure gets one correction and preserves accepted body images (rejectAgain=${rejectAgain})`,async()=>{
 const body={sequence:1,sectionHeading:'실제로 쓰는 물건',prompt:'책상 위 도구의 배치'};
 const h=harness({writerResult:{...writer,titleImagePrompt:'도구를 고르는 장면',titleImageText:['도구 정리'],bodyImages:[body]},options:{includeTitleImage:true,maxBodyImages:1}});
 Object.assign(h.deps,{bodyImageLimit:Number,imagePrompt:runner.buildImageWorkerPrompt,imageIssue:runner.imageWorkerContractIssueReason,pendingImages:runner.pendingImageWriterResult,mergeImages:runner.mergeImageWorkerAttempts,applyImages:(w,images)=>({...w,...images})});
 const original=h.deps.runTask;let images=0;const defect='대표 이미지가 실사 사진 조건을 충족하지 못했습니다.';
 h.deps.runTask=async args=>{
  if(args.agent!=='image')return original(args);
  h.calls.push(args);images++;
  const file=path.join(h.opts.jobDir,`candidate-${images}.png`);fs.writeFileSync(file,'fixture, not a generated image');
  if(images===1){assert(!args.prompt.includes('application-authorized correction'));return {status:'partial',titleImagePath:file,titleImageVerified:false,bodyImages:[{...body,path:file,summaryVerified:true}],notes:[defect]};}
  assert(args.prompt.includes(defect));assert(args.prompt.includes('application-authorized correction'));
  const handoff=JSON.parse(args.prompt.split('Writer Agent image handoff:\n')[1].split('\nRequired output:')[0]);assert.deepEqual(handoff.bodyImages,[]);
  return {status:rejectAgain?'partial':'success',titleImagePath:file,titleImageVerified:!rejectAgain,bodyImages:[],notes:rejectAgain?[defect]:[]};
 };
 const r=await h.run();assert.equal(r.publishable,!rejectAgain);assert.equal(images,2);assert.equal(r.bodyImages.length,1);
 if(rejectAgain){assert.equal(r.failurePhase,'image');assert.equal(r.failureKind,'execution');}
 assert(r.bodyImages[0].path.endsWith('candidate-1.png'));assert(r.titleImagePath.endsWith(rejectAgain?'candidate-1.png':'candidate-2.png'));
});

test('image-resume evidence mismatch preserves the draft as an execution problem and never calls the writer',async()=>{
 const h=harness();const checkpoint={version:2,steps:{},retrievals:{},attemptNumber:1,generationOptions:{includeTitleImage:false,maxBodyImages:1},imageCheckpoint:{version:1,title,writer,research:{status:'PASS'},review:goodReview()}};
 h.deps.writerIssue=()=> '본문 출처가 전달한 원문과 일치하지 않습니다. 제공된 sourceId와 URL을 사용하세요.';
 const r=await generate({...h.opts,generationCheckpoint:checkpoint},()=>{},h.deps);
 assert.equal(r.failureKind,'execution');assert.equal(r.failurePhase,'image_resume');assert.equal(r.article,article.trim());assert.equal(h.calls.length,0);assert(h.checkpoints.at(-1).imageCheckpoint);
});
