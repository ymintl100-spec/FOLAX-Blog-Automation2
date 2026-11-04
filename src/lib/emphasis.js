'use strict';
const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
function select(writer={},review,options={}){
  if(options.emphasisPolicy!==1)return [];
  const body=String(writer.article||''),plain=norm(body),out=[];
  const add=s=>{const q=norm(s);if(q.length>=12&&q.length<=180&&plain.includes(q)&&!q.includes('[SECTION')&&!q.includes('[IMAGE')&&!out.includes(q))out.push(q);};
  for(const s of Array.isArray(writer.boldSentences)?writer.boldSentences:[])add(s);
  for(const q of [review?.readerValueAssessment?.openingAnswer,review?.readerValueAssessment?.decisionHelp])if(q){
    const paragraphs=body.split(/\n\s*\n/).map(norm);
    const p=paragraphs.find(p=>p.includes(norm(q))&&!p.includes('[SECTION')&&!p.includes('[IMAGE'));
    const sentence=p?.match(/[^.!?。]+[.!?。]/g)?.find(s=>norm(s).includes(norm(q)))||q;add(sentence);
  }
  if(!out.length){const p=body.split(/\n\s*\n/).map(norm).find(p=>p&&!p.startsWith('['));add(p?.match(/[^.!?。]+[.!?。]/)?.[0]);}
  return out.slice(0,3);
}
module.exports={select,instruction:'제목의 핵심 답·중요한 조건 등 본문에 실제 존재하는 핵심 문장 1~3개를 boldSentences:string[]에 그대로 반환한다. 본문에 별표나 HTML을 넣지 않는다. 앱이 해당 문장만 굵게 표시한다. 전체 문단이나 본문 대부분을 강조하지 않는다.'};
