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
function harness({review,blockResearch=false,options={}}={}){
 const calls=[],checkpoints=[];let reviews=0;
 const opts={jobDir:path.join(root,String(++index)),topicMode:'auto',includeTitleImage:false,maxBodyImages:0,...options,onGenerationCheckpoint:c=>checkpoints.push(JSON.parse(JSON.stringify(c)))};
 const deps={
  runTask:async args=>{calls.push(args);let result;
   if(args.agent==='research')result=blockResearch?{status:'BLOCK',failureReason:'핵심 원문 미확보',factBased:true,factChecks:[]}:{status:'PASS',finalTitle:title,novelty:{duplicate:false,reason:'새로운 구체적 질문'},factBased:false,factChecks:[],searchNeed:'skip'};
   else if(args.agent==='writer')result=writer;
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
