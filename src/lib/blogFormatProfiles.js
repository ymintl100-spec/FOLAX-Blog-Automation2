// Editorial patterns observed across 100 public posts; see docs/blog-benchmark-2026-10-23.md.
// Source prose and photographs are not model context or writing-memory examples.
const profiles={
 balanced:{label:'자동 · 건강 정보와 일상',purpose:'주제·근거·실제 경험 메모에 맞는 글의 역할 선택'},
 explanation:{label:'건강 설명 · 오해에서 선택 기준으로',purpose:'일상의 질문과 흔한 해석을 이유·조건으로 풀어주는 글',arc:['독자가 마주한 구체적인 상황','자연스럽게 생기는 질문','흔한 해석과 달라지는 조건','이유를 쉬운 말과 일상 예로 연결','처음의 고민으로 돌아오는 선택 기준'],title:'독자가 실제로 물을 질문과 달라지는 조건을 제목에 담는다. 의사·전문가 자격과 진료 경험을 빌리지 않는다.',closing:'도입의 걱정을 다시 보며 적용할 작은 기준 하나를 남긴다.',surface:{headingStyle:'quotation_line',alignment:'left',heroPosition:'after-opening',lineTarget:22,paragraphTarget:50,minSections:1}},
 practical:{label:'실행·루틴 · 이해에서 따라 하는 순서로',purpose:'준비·실행 순서와 쉬운 대안을 근거 안에서 설명하는 글',arc:['대상과 불편한 상황','움직임이나 방법이 필요한 짧은 이유','준비·시작 조건','실제 순서와 해당 단계의 설명·이미지','어려울 때 대안과 필요한 주의점','생활에 넣을 작은 실행'],title:'대상·상황·방법을 명확히 한다. 시간·횟수·효과는 근거가 있을 때만 약속한다.',closing:'완벽하게 수행하라는 요구보다 가능한 범위와 지속할 조건을 남긴다.',surface:{headingStyle:'quotation_underline',alignment:'center',heroPosition:'before-opening',lineTarget:24,paragraphTarget:65,minSections:1}},
 comparison:{label:'선택·비교 · 같은 기준으로 살펴보기',purpose:'같은 비교 축으로 조건별 선택을 돕는 글',arc:['선택을 어렵게 하는 상황','비교할 공통 기준','같은 기준에서 보는 차이','조건에 따라 선택이 바뀌는 지점','독자가 확인할 한 가지'],title:'무엇과 무엇을 어떤 상황에서 비교하는지 드러낸다. 근거 없는 승자·우월성을 만들지 않는다.',closing:'누구에게나 같은 정답을 주지 않고 선택이 달라지는 조건을 정리한다.',surface:{headingStyle:'quotation_line',alignment:'left',heroPosition:'after-opening',lineTarget:24,paragraphTarget:65,minSections:1}},
 essay:{label:'일상·경험 · 장면에서 여운으로',purpose:'사용자가 제공한 이번 경험을 장면·선택·변화로 잇는 글',arc:['경험 메모에 있는 한 장면','그때의 생각과 선택','작은 사건이나 변화','지금 돌아보는 의미','첫 장면을 떠올리는 여운'],title:'이번 경험 메모에 실제로 있는 장면·선택·질문을 제목으로 삼는다. 허구의 성취·증상·장소·대화는 만들지 않는다.',closing:'정의·원인·방법·요약으로 마무리하지 않고 시작의 장면을 다시 비추며 끝낸다.',surface:{headingStyle:'quotation_line',alignment:'left',heroPosition:'after-opening',lineTarget:22,paragraphTarget:50,minSections:0}}
};
const DEFAULT_DIRECTION='건강 정보와 일상·경험을 함께 기록하며, 몸과 일상을 쉽게 이해하고 무리 없이 이어갈 선택을 돕는다.';
function normalizeProfile(value){return value==='off'||Object.hasOwn(profiles,value)?value:'balanced';}
function guidance(value){
 const id=normalizeProfile(value);if(id==='off')return null;
 const p=profiles[id];
 return {version:4,id,label:p.label,...(id==='balanced'?{catalog:Object.entries(profiles).filter(([k])=>k!=='balanced').map(([id,p])=>({id,purpose:p.purpose}))}:{arc:p.arc,title:p.title,closing:p.closing,surface:p.surface}),
  flow:p.arc?.join(' → ')||'기존 조사 응답에서 글의 역할을 선택한다',
  editing:{focus:'한 글은 한 질문 또는 한 장면만 다룬다. 전개 단계 하나를 소제목 하나로 늘리지 않는다.',sections:'정보형 소제목은 보통 1~3개, 일상형은 0~2개. 승인 글의 실제 구성을 우선한다.',opening:'인사·목차 소개 없이 짧은 상황과 질문으로 들어간다. 배경 지식 강의는 생략한다.',ending:'끝맺음은 1~2문장. 이미 한 말을 요약·체크리스트·댓글 요청으로 반복하지 않는다.',cuts:'도입과 본론에서 같은 결론을 반복하지 않는다. 정의·효능·원인·방법을 모두 담지 말고 이번 질문에 필요한 이유 하나와 구체적 선택만 남긴다.'},
  layout:'한 가지 의미를 짧은 줄과 작은 문단으로 전달한다. 승인 문체·줄·문단 리듬을 우선한다. 이미지는 설명 가까이 설정 예산 안에서 배치한다.',
  boundaries:'참고 블로그의 문장·인물·자격·경험·의학 주장·사진은 재사용하지 않는다. 문체 예시는 사실 자료가 아니다. 소제목 수·FAQ·요약·인사를 기계적으로 반복하지 않는다.'};
}
function resolve(guide,research={},experienceNotes=''){
 if(!guide||!(guide.version>=3))return guide;
 let id=guide.id==='balanced'?research.writerContract?.articleFormat:guide.id;
 if(!Object.hasOwn(profiles,id)||id==='balanced')id='explanation';
 if(id==='essay'&&!String(experienceNotes).trim())id='explanation';
 // Completed steps in a v3 checkpoint must keep the original length/layout policy.
 if(guide.version===3){
  const {editing,...legacy}=guidance(id);
  return {...legacy,version:3,surface:guide.id===id&&guide.surface?guide.surface:{...legacy.surface,minSections:id==='essay'?0:2,paragraphTarget:['explanation','essay'].includes(id)?80:90}};
 }
 return guidance(id);
}
module.exports={normalizeProfile,guidance,resolve,DEFAULT_DIRECTION};
