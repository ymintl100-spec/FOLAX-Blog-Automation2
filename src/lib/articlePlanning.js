'use strict';
function enabled(options){return options?.articleLengthPolicy===4;}
const instruction='2000자 구성 우선: 목표를 면제하는 것과 처음부터 짧은 요약을 쓰는 것은 다르다. 이번 주제와 작성 요청 안에서 원문 전체의 서로 다른 정보를 먼저 수집하고, 도입·제품/대상의 특징·구체적인 활용 순서·선택 이유와 생활 속 활용·관리/주의 중 실제 자료가 있는 역할을 배치한다. 고정 목차는 아니며 없는 정보는 제외한다. writerContract.coveragePlan에는 각 역할의 {role,points:[{fact,sourceIds}],approxCharacters}를 간단히 기록한다. 자료가 충분하면 합계 약 2000자(도입 약 150자, 서로 다른 본문 설명 합계 약 1700자, 마무리 약 150자)를 목표로 첫 응답부터 충분히 설명한다. 이 숫자는 배분 참고치이고 통과 하한이 아니다. 보통 4~6개 내용 역할을 자연스러운 소제목으로 묶되 같은 조언을 쪼개거나 이미지를 위해 목차를 만들지 않는다. 원문에 있는 사용법·구조·이점·비교·세척/건조를 짧은 두 절로 요약하며 누락하지 않는다. 각 역할은 독자가 따라 할 순서·조건·선택 차이를 쉬운 문장으로 풀며 다른 절의 내용을 재설명하지 않는다. 구체적인 생활 장면은 제안으로만 쓰고 실제 경험으로 주장하지 않는다. 작성 요청의 강조점과 출처가 겹치는 내용을 우선한다. 기존 2~3개 질문·1~3개 소제목·한 가지 이유만 남기는 초단문 구성이나 승인 예시의 짧은 전체 분량보다 이 구성이 우선한다. Writer는 반환 전 coveragePlan과 본문을 대조해 아직 쓰지 않은 관련 원문 정보가 있으면 같은 응답 안에서 반영한다. 정보가 실제로 부족하면 짧게 끝내고 내부 notes에 빠진 자료를 알린다. 분량 숫자만을 이유로 새 검색·추가 모델 호출·보완·반려·작업 중단을 요구하지 않는다. 근거 없는 효능·새 사양·허구 경험·반복 설명으로 채우지 않는다.';
function formatGuide(options){
  const guide=options.formatGuidance;
  if(!guide||!enabled(options))return guide;
  return {...guide,editing:{...guide.editing,focus:'입력 주제와 작성 요청에 충실하게 원문의 서로 다른 정보를 충분히 설명한다.',sections:'자료가 있는 4~6개 내용 역할을 적절한 소제목으로 묶는다. 개수는 권장치다.',cuts:'중복·추상적 해석은 덜고 관련 사용법·특징·선택 이유·관리 정보를 보존한다.'}};
}
module.exports={enabled,instruction,formatGuide};
