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
 return {version:2,id,label:profiles[id].label,flow:profiles[id].flow,
  layout:'소제목 없는 짧은 도입에서 독자의 상황과 핵심 답을 연결한다. 본론은 서로 다른 질문을 해결하는 소제목 3~5개를 보통 사용하며 내용에 맞춰 조정하되 2개 이상으로 나눈다. 소제목은 목차 항목 나열 대신 해당 부분에서 알게 될 차이·이유·방법을 구체적으로 표현한다. 한 문단에 한 가지 의미와 1~3문장을 담고 문단 사이를 빈 줄로 구분한다. 긴 문장은 의미 단위 줄바꿈을 허용하며 승인 예시의 문단·줄 길이를 우선한다. 설명 주변에 설정 최대치 안에서 이미지를 배치한다. 마지막은 소제목 뒤의 짧은 적용 기준 또는 행동으로 끝내며 같은 요약을 반복하지 않는다.',
  boundaries:'참고한 것은 전개와 배치뿐이다. 참고 블로그의 문장·고유 인사·전문가 자격·경험·건강 주장·광고 문구·사진은 재사용하지 않는다. 문체와 표현은 사용자가 수정·승인한 예시를 우선하며 근거·주제·필수 조건을 보존한다. 목차·FAQ·소제목 수·짧은 줄바꿈을 기계적으로 강제하지 않는다.'};
}
module.exports={normalizeProfile,guidance};
