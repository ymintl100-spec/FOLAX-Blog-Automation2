const {referenceParts}=require('./publicationFormat');
function plain(article){return referenceParts(String(article||'')).body.replace(/^\[SECTION\s*-\s*([^\]]+)\]\s*$/gm,'$1').replace(/\[IMAGE INSERT[^\]]*\]/g,'').normalize('NFC').replace(/\s+/g,' ').trim();}
function articleIssue(writer){
 const body=referenceParts(String(writer?.article||'')).body;
 const seen=new Set();
 for(const p of body.split(/\n\s*\n/)){
  const value=p.replace(/\[IMAGE INSERT[^\]]*\]/g,'').replace(/\s+/g,' ').trim();
  if(value.length<100)continue;
  if(seen.has(value))return '같은 긴 문단이 반복되었습니다. 새 사실을 만들지 말고 중복 문단을 줄여 독자의 질문을 구체적으로 설명하세요.';
  seen.add(value);
 }
 if(/\[(?:TODO|여기에\s*(?:본문|내용|설명))\]/i.test(body))return '본문에 작성용 임시 표식이 남았습니다. 실제 근거가 있는 설명으로 완성하세요.';
 return '';
}
function reviewEvidenceIssue(review,writer){
 if(!['PASS','REVISION','BLOCK'].includes(review?.status))return '최종 검수 응답의 상태가 올바르지 않습니다.';
 if(typeof review.naturalnessPass!=='boolean'||typeof review.naverReadabilityPass!=='boolean')return '최종 검수의 자연스러움·모바일 가독성 판정이 누락됐습니다. 본문은 보존했습니다.';
 if(review.status!=='PASS')return '';
 const body=plain(writer.article),assessment=review.readerValueAssessment||{};
 for(const [key,label] of [['openingAnswer','도입의 핵심 답'],['decisionHelp','독자에게 주는 구체적인 도움']]){
  if(typeof assessment[key]!=='string')return '검수 근거가 누락됐습니다: '+label;
  const quote=assessment[key].normalize('NFC').replace(/\s+/g,' ').trim();
  if(quote.length<12||quote.length>200||!body.includes(quote))return '검수 근거가 실제 본문의 짧은 연속 구절과 일치하지 않습니다: '+label;
  if(key==='openingAnswer'&&!body.slice(0,700).includes(quote))return '도입의 핵심 답에 대한 검수 인용이 본문 초반에 없습니다.';
 }
 return '';
}
function verdictIssue(review){
 if(review?.status!=='PASS')return '';
 if(review.naturalnessPass!==true)return '반복되는 상투 표현·기계적인 문장 전개를 실제 문제 문장에 맞춰 보완하세요.';
 if(review.naverReadabilityPass!==true)return '네이버 모바일 독자가 읽고 이해하기 쉽도록 실제 문제 문단을 보완하세요.';
 return '';
}
module.exports={articleIssue,reviewEvidenceIssue,verdictIssue};
