const {referenceParts}=require('./publicationFormat');
const MIN_ARTICLE_CHARACTERS=1800;
const MAX_ARTICLE_CHARACTERS=3000;
function articleCharacterCount(article) {
  const body=referenceParts(article).body
    .replace(/^\[SECTION\s*-\s*(.+?)\]\s*$/gm,'$1')
    .replace(/\[IMAGE INSERT[^\]]*\]/g,'')
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g,'$1')
    .replace(/https?:\/\/[^\s<>\[\]]+/g,'')
    .replace(/\s/gu,'');
  return [...body].length;
}
function limits(options={}){
 // Legacy policies stay readable; the current advisory policy can be requested
 // explicitly when resuming an older checkpoint without changing its text.
 if(options.articleLengthPolicy===4)return {target:2000,enforced:false};
 if(options.articleLengthPolicy===3)return {min:1400,max:1600,target:1500};
 if(options.articleLengthPolicy===2)return {min:1000,max:1500,target:1300};
 if(options.articleLengthPolicy===1)return {min:1000,max:1200,target:1100};
 const id=options.formatGuidance?.version>=3?options.formatGuidance.id:'';
 if(options.compactWriting===true||options.formatGuidance?.version>=4){
  const base=({explanation:{min:400,max:1000,target:700},practical:{min:500,max:1200,target:850},comparison:{min:450,max:1100,target:800},essay:{min:200,max:700,target:450}})[id]||{min:400,max:1000,target:700};
  const approved=Number(options.writingGuidance?.typicalArticleCharacters);
  const min=approved>0?Math.min(base.min,Math.max(200,Math.round(approved*.65))):base.min;
  return {...base,min,target:approved>0?Math.max(min,Math.min(base.max-100,Math.round(approved))):base.target};
 }
 return ({explanation:{min:1200,max:2800},practical:{min:1400,max:3200},comparison:{min:1200,max:3000},essay:{min:400,max:2200}})[id]||{min:MIN_ARTICLE_CHARACTERS,max:MAX_ARTICLE_CHARACTERS};
}
function articleLengthIssue(writer,options={}) {
  if(options.articleLengthPolicy===4)return '';
  const count=articleCharacterCount(writer?.article);
  const {min,max}=limits(options);
  if(count>=min && count<=max)return '';
  return `본문 분량은 공백 제외 ${min}~${max}자여야 합니다. 현재 ${count}자입니다. 제목·참고자료·이미지 표식·링크 주소는 제외하고 소제목과 링크 표시 문구는 포함합니다. ${count<min?'기존 근거나 경험 메모 안에서 설명을 보완하세요. 사실·경험·감정을 창작하거나 같은 내용을 반복하지 마세요.':'핵심 사실·조건·예외는 보존하고 반복과 군더더기를 줄이세요.'}`;
}
const articleLengthInstruction=`본문은 반드시 공백 제외 ${MIN_ARTICLE_CHARACTERS}~${MAX_ARTICLE_CHARACTERS}자로 작성한다. 제목·참고자료·이미지 표식·링크 주소는 제외하고 소제목과 링크 표시 문구는 포함한다. 분량은 필수 조건이다. 근거가 있는 조건·이유·비교·절차를 충분히 설명하되 반복·허구로 분량을 채우지 않는다. 앱이 실제 글자수를 검증한다.`;
const softInstruction='본문 목표는 공백 제외 약 2000자다. 이는 권장 목표이며 최소·최대 글자수 제한이 아니다. 제목·참고자료·이미지 표식·URL은 제외하고 소제목과 링크 표시 문구는 포함해 실제 분량을 안내한다. 첫 작성은 원문 전체와 작성 요청의 서로 다른 정보를 충분히 활용해 약 2000자로 구성한다. 짧은 핵심 요약만으로 목표를 대신하지 않는다. 근거를 모두 활용한 뒤에도 2000자에 못 미치거나 넘어도 그대로 다음 단계로 진행한다. 과거 계약·검수·승인 예시의 분량 제한은 현재 지침으로 대체한다. 분량만을 이유로 검색·보완·재시도·REVISION·BLOCK·failed를 요청하지 않는다. 억지 반복·불필요한 정의·주제 확장·허구의 사실이나 경험으로 글자수를 채우지 않는다. 자료가 짧으면 근거 있는 핵심만 자연스럽게 마무리하고 분량 차이는 notes에 안내한다. 핵심 답의 근거 부족·사실 오류·내용 중복 등 실제 품질 문제는 계속 검수한다.';
function instruction(options){const {min,max,target}=limits(options);if(options?.articleLengthPolicy===4)return softInstruction;if([1,2,3].includes(options?.articleLengthPolicy))return `본문은 공백 제외 ${min}~${max}자로 작성한다. 목표는 ${target}자이며 앱이 실제 글자수를 검사한다. 제목·참고자료·이미지 표식·링크 주소는 제외하고 소제목과 링크 표시 문구는 포함한다. 모든 글 형식에 이 분량을 적용하며 과거 조사 계약·승인 예시의 전체 분량보다 현재 기준이 우선한다. 승인 문체의 문단·도입·마무리 리듬은 참고한다. 한 질문 또는 실제 경험을 필요한 이유·조건·구체적인 선택으로 설명하되 반복·참고자료 목록은 넣지 않는다. 글자수를 맞추려고 같은 주의사항·부정·연구 해석을 반복하거나 사실·경험·효과를 창작하지 않는다. 부족한 부분은 기존 근거 안의 차이·이유·조건을 쉬운 말로 구체화한다. 근거·경험이 부족하면 부족한 부분을 밝히고 중지한다.`;if(target)return `짧은 본문: 공백 제외 ${target}자 안팎을 목표로 하고 ${min}~${max}자 범위로 쓴다. 상한까지 채우지 않는다. 승인 글의 전체 분량·소제목·도입·마무리 리듬을 이 범위 안에서 참고한다. 한 글에서 한 질문에 답한다. 이유·조건·예외는 관련 설명 옆에 남기고 주변 상식·반복 결론·참고자료는 빼라. 오래된 조사 계약의 긴 분량·목차보다 이 기준이 우선한다. 분량을 채우려고 사실·경험을 만들지 않는다.`;return `현재 글의 역할에 맞는 본문 분량은 공백 제외 ${min}~${max}자다. 제목·참고자료·이미지 표식·링크 주소는 제외한다. 조사 구성안의 일반 분량보다 현재 형식의 분량을 우선한다. 일상형은 분량을 채우기 위해 없는 장면·감정·대화를 만들지 않는다. 충분한 경험이 없으면 보존 가능한 원고와 부족한 자료를 설명하고 중지한다.`;}
function advisoryReview(review,options){
 if(review?.writingRequestReview?.pass===false)return review;
 if(options?.articleLengthPolicy!==4||review?.lengthOnlyIssue!==true||!['REVISION','BLOCK'].includes(review.status))return review;
 const required=['articleAnswersTitle','topicPreserved','factualityPass','sourceUsePass','riskExpressionPass','naturalnessPass','naverReadabilityPass'];
 if(required.some(k=>review[k]!==true)||['inputCoveragePass','inputScopePass','benchmarkFormatPass'].some(k=>review[k]===false)||review.meaningChecks!=null&&!Array.isArray(review.meaningChecks)||(review.meaningChecks||[]).some(c=>c.meaningPreserved===false))return review;
 // Only the model's explicit length-only classification may be advisory. All
 // independent source, image, relevance and quotation checks still run later.
 return {...review,status:'PASS',publishable:true,failureReason:'',issues:[],revisionInstructions:[],lengthAdvisory:{originalStatus:review.status,reason:review.failureReason,issues:review.issues,revisionInstructions:review.revisionInstructions}};
}
module.exports={articleCharacterCount,articleLengthIssue,articleLengthInstruction,limits,instruction,advisoryReview};
