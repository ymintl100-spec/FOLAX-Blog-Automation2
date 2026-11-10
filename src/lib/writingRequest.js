'use strict';
function normalize(value=''){
  if(typeof value!=='string'||value.length>2000)throw Error('작성 요청은 2,000자 이내로 입력하세요.');
  return value.trim();
}
function instruction(options={},stage='writer'){
  if(!normalize(options.writingRequest||''))return '';
  const common='이번 글의 writingRequest는 사용자 작성 요청이다. 주제·제품·독자·강조점·말투·구성 요청을 조사와 본문에 반영한다. 실제 경험이나 사실의 증거가 아니므로 요청만으로 직접 사용한 후기·효능·제품 사양을 만들지 않는다. 사용자 필수 요청을 기본 카테고리의 일반적인 제품 언급 자제나 짧은 글 선호보다 우선하되 사실·저작권은 지킨다. 제품 장점 강조 요청은 원문에 있는 구조·사용 편의·관리 등 구체적인 이점을 설명하는 뜻이며 치료효과·우월성·사용 경험을 창작하는 뜻이 아니다. 지원되지 않는 세부 요청은 제외 사유를 내부 notes에 알리고 지원 가능한 나머지는 작성한다.';
  if(stage==='research')return common+' writerContract.requestPlan에 요청 항목별 {requirement,sourceIds,coverage,limitation}을 간단히 설계한다. 요청한 제품 활용 글을 임의의 질환·효능 검증 질문으로 바꾸지 않는다.';
  if(stage==='main')return common+' writingRequestReview:{pass:boolean,reason:string,evidence:[{requirement:string,articleQuote:string}],omissions:[{request:string,reason:string}]}를 같은 검수 JSON에 포함한다. 지원 가능한 핵심 요청이 실제 본문에 구현됐는지 확인한다. evidence는 본문의 실제 연속 구절을 인용한다. 반영 가능한 요청이 빠졌으면 pass:false와 구체적인 보완 지시를 반환한다. 근거 없는 효능·허구 경험을 제외한 것만으로 실패시키지 않는다.';
  return common+' research.writerContract.requestPlan의 지원 가능한 항목을 실제 문단으로 구현한다. 최종 응답 전 요청과 본문을 대조하고, 제품명만 끼워 넣는 대신 요청한 활용법과 근거 있는 장점을 직접 설명한다.';
}
const comparable=s=>String(s||'').normalize('NFKC').replace(/\s/gu,'');
function evidenceIssue(review,writer,options={}){
  if(!options.writingRequest?.trim()||review?.status!=='PASS')return '';
  const result=review?.writingRequestReview;
  if(!result||typeof result.pass!=='boolean'||!String(result.reason||'').trim())return '작성 요청 반영 검수 결과가 누락됐습니다. 본문은 보존하고 writingRequestReview를 반환하세요.';
  if(result.pass===true&&(!Array.isArray(result.evidence)||!result.evidence.length||result.evidence.some(e=>!String(e.requirement||'').trim()||comparable(e.articleQuote).length<8||!comparable(writer?.article).includes(comparable(e.articleQuote)))))return '작성 요청 반영 근거는 현재 본문의 실제 구절이어야 합니다.';
  return '';
}
function reviewIssue(review,options={}){
  return options.writingRequest?.trim()&&review?.writingRequestReview?.pass===false?'작성 요청 보완: '+review.writingRequestReview.reason:'';
}
module.exports={normalize,instruction,evidenceIssue,reviewIssue};
