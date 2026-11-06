'use strict';
const E=require('./researchEvidence');
const enabled=o=>o?.inputScopePolicy===1&&o.inputBrief?.mode==='mixed';
const normalized=s=>String(s||'').replace(/\s+/g,'').trim();
const contains=(whole,quote)=>typeof quote==='string'&&normalized(quote).length>=8&&normalized(quote).length<=300&&normalized(whole).includes(normalized(quote));
const linkSource=(sources,item)=>sources.find(s=>s.sourceId===item?.sourceId&&s.inputKind==='link'&&s.inputValue===item?.url&&String(s.excerpt||'').trim());
function instruction(options,stage='research'){
 if(!enabled(options))return '';
 const base='혼합 작성의 중심은 입력 링크의 실제 주제·대상·사용 목적·핵심 설명이다. 입력 키워드는 이 내용과 연결하고 부족한 설명을 보충하는 검색어로 사용한다. 원문과 비슷한 주제·설명 범위의 글을 새 문장으로 쓴다. 문장·고유 경험·사진을 복제하거나 원저자의 체험·자격을 자기 것으로 쓰지 않는다. 원문의 특정 제품·대상·상황에 관한 조언을 모든 사람에게 적용되는 의학적 기준·치료효과로 넓히지 않는다. 예를 들어 지압매트를 편안한 강도로 사용하는 조언은 그 사용 방법 안에서 설명하며, 모든 발바닥 자가 지압의 통증·중단 기준을 새 필수 주장으로 만들어 증명하려고 하지 않는다. 근거가 없는 확장은 제외하고 원문의 제한·위험·불확실성과 상업적 공개는 보존한다. 실제 핵심이 틀리거나 뒷받침되지 않으면 반려하며 무조건 통과시키지 않는다. 키워드와 원문을 연결할 수 없으면 이유를 밝힌다.';
 if(stage==='research')return base+' 혼합 방식의 초기 자료 수집은 링크 우선이며 키워드 검색은 필요한 경우에만 앱이 실행한다. inputAnalysis.keywords에는 원문과 키워드의 관련성을 설명하고 검색했다고 가장하지 않는다. 같은 조사 응답에 linkScope:{articleScope,links:[{url,sourceId,subject,purpose,quote}],gaps:[{keyword,question}]}를 반환한다. links는 모든 입력 링크 각각의 실제 sourceId와 원문 연속 구절(8~300자)을 사용한다. articleScope는 링크가 실제 다루는 범위로 정한다. 필요한 내용이 이미 있으면 gaps:[], searchNeed:skip, PASS로 작성에 넘긴다. 부족할 때만 gaps에 입력한 keyword와 그 범위 안의 구체적인 질문을 최대 2개 적고 REVISION으로 요청한다. 앱이 해당 keyword와 원문 subject를 포함해 검색한다. 선택적 효과·임상 기준을 새로 추가하려고 검색하지 않는다. 보강 자료가 대상·시행 환경·사용 목적이 다르면 적용하지 말고 그 자료 때문에 주제를 바꾸지 않는다. 원문 범위로 제목·계약·factChecks를 좁힐 수 있으면 이전 provisional 제목·필수 주장을 수정한다. 삭제한 확장 주장을 essential로 남기거나 뒤의 Writer/Main에 요구하지 않는다. 사실 판단은 제공된 발췌에 근거하며 searchNeed:skip으로 출처 검사를 생략하지 않는다.';
 if(stage==='main')return base+' 원고와 생성된 제목끼리의 일치뿐 아니라 원래 링크 범위도 검수한다. inputScopePass:boolean을 반환한다. PASS일 때 inputScopeEvidence:[{url,sourceId,sourceQuote,articleQuote}]에 모든 입력 링크 각각의 실제 원문 구절과 해당 내용을 설명한 원고 구절을 8~300자로 짧게 대조한다. 원문 조언에 충실한 글에 새로운 보편적 임상 기준을 추가하도록 요구하지 않는다. 원문보다 일반화·과장·주제 이탈했으면 inputScopePass:false와 구체적인 REVISION을 반환한다. 실제 사실성·가독성·근거 검사는 유지한다.';
 return base+' 전달된 research.linkScope를 기준으로 원문 주제의 설명 순서·사용 상황·핵심 내용을 재구성한다. 검색 결과는 부족했던 설명만 보충하고 새로운 중심 주제로 쓰지 않는다. 기존 계약에 원문 밖의 필수 주장이 있으면 현재 linkScope 안에서 근거 있는 내용만 사용한다.';
}
function planIssue(research,options){
 if(!enabled(options))return '';
 const plan=research.linkScope,sources=options.searchResults||[];
 if(!plan||typeof plan.articleScope!=='string'||!plan.articleScope.trim()||plan.articleScope.length>400||!Array.isArray(plan.links)||plan.links.length!==options.inputBrief.urls.length)return '입력 링크의 원문 주제·사용 목적을 연결한 linkScope 기획이 필요합니다.';
 const seen=new Set();for(const item of plan.links){const source=linkSource(sources,item);if(!options.inputBrief.urls.includes(item.url)||seen.has(item.url)||!source||!contains(source.excerpt,item.quote)||!String(item.subject||'').trim()||!String(item.purpose||'').trim()||String(item.subject).length>100||String(item.purpose).length>200)return 'linkScope의 입력 링크·출처 ID·원문 구절·대상·사용 목적이 실제 원문과 일치해야 합니다.';seen.add(item.url);}
 if(!Array.isArray(plan.gaps)||plan.gaps.length>2||plan.gaps.some(g=>!options.inputBrief.keywords.includes(g?.keyword)||typeof g.question!=='string'||!g.question.trim()||g.question.length>140))return '보충 질문은 입력 키워드에 연결해 최대 2개로 정리하세요.';
 return '';
}
function queryRequest(research,options){
 if(!enabled(options))return research;
 const subjects=[...new Set((research.linkScope?.links||[]).map(l=>l.subject))].join(' ').slice(0,80);
 const queries=(research.linkScope?.gaps||[]).map(g=>{const room=138-g.keyword.length,subject=subjects.slice(0,Math.min(40,Math.floor(room/3))),question=g.question.slice(0,room-subject.length);return [g.keyword,subject,question].filter(Boolean).join(' ').slice(0,140);});
 return {...research,searchQueries:queries,verificationQueries:[],searchNeed:'light'};
}
function reviewEvidenceIssue(review,writer,options){
 if(!enabled(options)||review.status!=='PASS')return '';
 if(typeof review.inputScopePass!=='boolean')return '원래 입력 링크의 범위에 충실한지 inputScopePass 판정이 필요합니다.';
 if(!review.inputScopePass)return '';
 const list=review.inputScopeEvidence;if(!Array.isArray(list)||list.length!==options.inputBrief.urls.length)return '모든 입력 링크의 원문과 실제 원고를 연결한 inputScopeEvidence가 필요합니다.';
 const seen=new Set();for(const item of list){const source=linkSource(options.searchResults||[],item);if(!options.inputBrief.urls.includes(item.url)||seen.has(item.url)||!source||!contains(source.excerpt,item.sourceQuote)||!contains(writer.article,item.articleQuote))return '입력 범위 검수의 원문·원고 구절이 실제 전달된 내용과 일치하지 않습니다.';seen.add(item.url);}return '';
}
const reviewIssue=(review,options)=>enabled(options)&&review.inputScopePass===false?'원고가 입력 링크의 주제·대상·사용 목적을 벗어났습니다. 원문 범위 안에서 보완하세요.':'';
// Explicit history retry re-plans from saved text; completed drafts/images and
// their approval state are never migrated to a different editorial policy.
function recover(checkpoint,force=false){
 const o=checkpoint.generationOptions||{};
 if(o.inputBrief?.mode!=='mixed'||(!force&&o.inputScopePolicy===1)||checkpoint.imageCheckpoint||checkpoint.articleCheckpoint||Object.keys(checkpoint.steps||{}).some(k=>/:(?:prompt|prompt-retry-\d+)\.txt$/.test(k)))return null;
 const inputs=E.cachedInputs(checkpoint);if(!inputs.some(s=>s.inputKind==='link'))return null;
 const next=JSON.parse(JSON.stringify(checkpoint)),prior=Object.values(next.retrievals||{}).flatMap(p=>p.searchResults||[]);
 next.generationOptions={...o,inputScopePolicy:1,searchResults:E.merge(inputs,[...prior,...(o.searchResults||[])])};
 next.inputScopePriorRetrievals={...(next.inputScopePriorRetrievals||{}),...(next.retrievals||{})};next.retrievals={};
 next.priorQueries=[...new Set([...(next.priorQueries||[]),...Object.values(next.retrievalQueries||{}).flat()])];next.retrievalQueries={};
 for(const key of Object.keys(next.steps||{}))if(key.includes('research-title')||key.includes('research-input-'))delete next.steps[key];
 return next;
}
module.exports={enabled,instruction,planIssue,queryRequest,reviewEvidenceIssue,reviewIssue,recover};
