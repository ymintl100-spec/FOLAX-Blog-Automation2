'use strict';
// Main reviews text and image plans. Image Worker and the app own asset checks.
const scope={stage:'text_and_image_plan',generatedImagesExpected:false,assetVerification:'image_worker_and_app_after_text_pass',publicationDecision:'not_in_scope'};
const instruction='현재 단계는 본문·이미지 계획의 텍스트 검수다. 신규 생성에서 Image Worker는 이 검수를 통과한 뒤 별도로 실행된다. 이미 이미지가 있는 저장 원고도 Main은 전달된 설명의 정합성만 검수하고 실제 파일·픽셀 검증은 담당하지 않는다. 여기서 publishable은 본문과 이미지 계획을 다음 생성 단계로 넘길 수 있다는 뜻이며 실제 발행 완료/준비 완료 판정이 아니다. 아직 생성되지 않은 이미지 파일·경로·생성 결과·사진의 실사 품질·이미지 속 글자를 요구하거나 미제공을 이유로 반려하지 않는다. Main/Writer가 이미지를 직접 생성하도록 지시하지 않는다. 이미지 최소 장수·sequence·마커·설명 정합성은 계획으로 검수하고 실제 파일·픽셀·장수·문구 검증은 이후 Image Worker와 앱이 수행한다. 사용자 최종 승인과 발행 실행도 앱의 후속 단계이며 이 검수에서 승인 완료를 요구하지 않는다. 본문 사실·의미·연관성과 이미지 계획 자체의 누락/오류는 기존 기준으로 엄격히 검수한다.';
function violation(review){
  if(!review||review.status==='PASS'&&review.publishable!==false&&!String(review.failureReason||'').trim())return '';
  const messages=[review.failureReason,...(Array.isArray(review.issues)?review.issues:[]),...(Array.isArray(review.revisionInstructions)?review.revisionInstructions:[])];
  const asset=/(?:이미지[^.!?\n]{0,45}생성\s*결과|생성된\s*(?:이미지(?!의?\s*(?:설명|계획|프롬프트))|파일)|실제\s*이미지\s*(?:파일|결과)|이미지\s*파일|generated\s+images?\b(?!\s+(?:prompts?|plans?|descriptions?))|image\s+(?:files?|generation\s+results?))/i;
  const missing=/(?:없|미제공|제공되지|제공하지\s*않|미생성|누락|missing|not\s+(?:provided|generated|available)|unavailable)/i;
  for(const text of messages){
    if(typeof text!=='string')continue;
    for(const sentence of text.split(/[.!?\n]/)){
      const match=asset.exec(sentence);
      if(match&&missing.test(sentence.slice(match.index+match[0].length)))return '이미지 생성 전 검수에서 아직 생성하지 않은 이미지 파일/결과를 요구했습니다.';
    }
  }
  return '';
}
function recover(checkpoint,phase){
  if(phase!=='main_review'||checkpoint.imageCheckpoint)return null;
  const prefix=checkpoint.attemptNumber+':';
  const reviews=Object.entries(checkpoint.steps).filter(([key])=>key.startsWith(prefix)&&/:main-review-(?:scope-)?\d+\.txt$/.test(key));
  const latest=reviews.at(-1);
  if(!latest||!violation(latest[1]))return null;
  const attempt=Number(latest[0].match(/(\d+)\.txt$/)[1]);
  const sourceKey=prefix+(attempt===1?'prompt.txt':`prompt-retry-${attempt}.txt`),writer=checkpoint.steps[sourceKey];
  if(!writer?.article||writer.status!=='success')return null;
  const steps=Object.fromEntries(Object.entries(checkpoint.steps).filter(([key])=>key.includes('research-title')));
  steps[prefix+'prompt.txt']=writer;
  for(const kind of ['tags-repair','image-layout-repair','humanizer-prompt']){
    const result=checkpoint.steps[prefix+`${kind}-${attempt}.txt`];if(result)steps[prefix+`${kind}-1.txt`]=result;
  }
  return {...checkpoint,steps,reviewContractRecovery:{version:1,sourceWriterKey:sourceKey,stage:scope.stage}};
}
module.exports={scope,instruction,violation,recover};
