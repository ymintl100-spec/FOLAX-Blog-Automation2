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
 const second=await generate({...h.opts,generationCheckpoint:checkpoint,writingGuidance:{fingerprint:'style-after'},formatGuidance:{id:'practical'}},()=>{},h.deps);
 assert.equal(second.publishable,true);assert.deepEqual(h.calls.map(c=>c.agent),['main']);assert.equal(h.calls[0].options.writingGuidance.fingerprint,'style-before');assert.equal(h.calls[0].options.formatGuidance.id,'explanation');
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
 const h=harness({options:{formatGuidance:benchmarkGuide}});const result=await h.run();
 assert.equal(result.status,'failed');assert.equal(result.failurePhase,'writer');assert.match(result.failureReason,/벤치마크 형식/);
 assert.equal(h.calls.filter(c=>c.agent==='writer').length,2);assert(!h.calls.some(c=>c.agent==='image'));
});
test('real benchmark structure and evidence pass with three calls and report the settings actually used',async()=>{
 const applied=[];const h=harness({writerResult:benchmarkWriter,review:benchmarkReview,options:{formatGuidance:benchmarkGuide,writingGuidance:{exampleCount:2,typicalParagraphCharacters:80},onWritingApplication:a=>applied.push(a)}});
 const result=await h.run();assert.equal(result.publishable,true);assert.deepEqual(h.calls.map(c=>c.agent),['research','writer','main']);
 assert.equal(result.writingApplication.profileId,'explanation');assert.equal(result.writingApplication.guideVersion,3);assert.equal(result.writingApplication.sectionCount,3);assert.equal(result.writingApplication.approvedExamples,2);assert.equal(applied[0].approvedExamples,2);
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
