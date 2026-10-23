// Manually observed public post structure, 2026-10-23. No source prose or images.
// Sampling links and limitations are documented in README.md.
const profiles={
 balanced:{label:'공통 형식 · 주제에 맞게',flow:'독자의 고민 또는 상황 → 핵심 답 → 이유·판단 기준 → 필요한 실행 방법 → 구체적인 마무리. 설명형 글과 절차형 글 중 주제에 맞는 전개를 선택한다.'},
 explanation:{label:'설명 중심 · 고민에서 판단 기준으로',flow:'독자가 혼동하기 쉬운 상황 → 핵심 답 → 왜 그런지 설명 → 조건별 차이와 판단 기준 → 적용할 한 가지. 사례는 제공된 실제 자료나 가정임을 밝힌 예시만 쓴다.'},
 practical:{label:'실행 중심 · 원리에서 순서로',flow:'독자의 고민과 얻을 도움 → 필요한 원리 → 실행 순서 또는 비교 기준 → 해당 단계의 주의점 → 다음 행동. 실제 순서가 있는 내용에만 번호를 붙인다.'}
};
function normalizeProfile(value){return value==='off'||Object.hasOwn(profiles,value)?value:'balanced';}
function guidance(value){
 const id=normalizeProfile(value);if(id==='off')return null;
 return {version:1,id,flow:profiles[id].flow,
  layout:'도입에서 제목의 답을 짧게 제시한다. 내용이 바뀌는 지점에 짧고 구체적인 소제목을 둔다. 문단은 한 가지 의미와 1~3문장을 기본으로 하되 승인 문체와 내용에 맞춘다. 설명이 필요한 곳에만 이미지 계획을 배치하고 설정한 이미지 최대치를 지킨다. 마지막은 같은 요약을 반복하지 않고 독자에게 필요한 판단이나 행동으로 끝낸다.',
  boundaries:'참고한 것은 전개와 배치뿐이다. 참고 블로그의 문장·고유 인사·전문가 자격·경험·건강 주장·광고 문구·사진은 재사용하지 않는다. 문체와 표현은 사용자가 수정·승인한 예시를 우선하며 근거·주제·필수 조건을 보존한다. 목차·FAQ·소제목 수·짧은 줄바꿈을 기계적으로 강제하지 않는다.'};
}
module.exports={normalizeProfile,guidance};
