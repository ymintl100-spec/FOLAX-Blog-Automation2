'use strict';
const enabled=o=>o?.allowDuplicateTopics===true;
const instruction=o=>enabled(o)?'사용자가 기존 발행 소재의 재사용을 허용했다. 같은 소재·핵심 질문·제목이라는 이유로 중단하거나 다른 주제를 선택하지 않는다. novelty는 참고 정보이며 필수 판정이 아니다. novelty.duplicate:true여도 실제 근거·작성 기획이 충분하면 PASS한다. 이전 글의 문장·개인 경험을 그대로 복제하거나 사실·새 경험을 만들지 말고 이번 입력과 실제 근거로 새 원고를 작성한다. 중복을 피하려고 주제·조건을 바꾸지 않는다. 근거 부족·사실성·원문 범위·가독성·분량·이미지 검수는 그대로 수행한다.':'';
function recover(checkpoint){
 if(!checkpoint||checkpoint.version!==2)return null;
 const next=JSON.parse(JSON.stringify(checkpoint));next.generationOptions={...next.generationOptions,allowDuplicateTopics:true};return next;
}
module.exports={enabled,instruction,recover};
