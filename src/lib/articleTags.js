'use strict';
const crypto=require('node:crypto');
const COUNT=30;
function normalize(values,limit=COUNT){
  const seen=new Set(),tags=[];
  for(const value of Array.isArray(values)?values:[]){
    if(typeof value!=='string')continue;
    const tag=value.normalize('NFKC').replace(/^#+/,'').replace(/\s+/g,'').replace(/[^\p{L}\p{N}]/gu,'');
    const key=tag.toLocaleLowerCase('ko-KR');
    if(!tag || [...tag].length>30 || seen.has(key))continue;
    seen.add(key);tags.push(tag);if(tags.length>=limit)break;
  }
  return tags;
}
function issue(writer,options={}){
  if(options.tagCount!==COUNT)return '';
  const count=normalize(writer?.tags).length;
  return count===COUNT?'':`주제 관련 태그가 ${count}개입니다. 중복 없는 태그 30개가 필요합니다.`;
}
function instruction(options={}){
  return options.tagCount===COUNT
    ?'태그는 tags 배열에 정확히 30개 작성한다. # 없이 태그마다 30자 이내, 공백·중복 없이 쓴다. 중요도가 높은 핵심 주제어부터 구체적인 질문·조건·생활 상황·본문에서 실제 다룬 연관어 순으로 정리한다. 서로 다른 의미의 검색어를 선택하고 같은 단어의 표기만 바꿔 장수를 채우지 않는다. 무관한 인기 검색어·지역·상표·인물·치료 효과·허위 체험·홍보 문구를 넣지 않는다. 본문과 소제목에 태그 목록을 붙이지 않고 JSON tags에만 반환한다. 글은 기존 분량을 유지한다. 티스토리는 이 후보 중 앞 10개만 발행하며 네이버는 30개를 전달한다.'
    :'Tags는 필요할 때만 최대 10개.';
}
const fingerprint=writer=>crypto.createHash('sha256').update(JSON.stringify([writer.title,writer.article])).digest('hex').slice(0,16);
function repairPrompt(writer){
  return ['기존 원고의 태그만 정리한다. 제목·본문·출처·이미지를 다시 쓰거나 검색하지 않는다.',instruction({tagCount:COUNT}),
    '응답 JSON: {status:"success",fingerprint:string,tags:string[]}. 전달된 fingerprint를 그대로 반환한다. 관련 태그가 부족하면 status:"failed"와 failureReason을 반환하고 무관한 단어로 채우지 않는다.',
    JSON.stringify({fingerprint:fingerprint(writer),title:writer.title,article:writer.article,tags:normalize(writer.tags)})].join('\n');
}
function applyRepair(writer,result){
  if(result?.status!=='success'||result.fingerprint!==fingerprint(writer))throw Error('태그 보완 응답이 현재 원고와 일치하지 않습니다.');
  const tags=normalize(result.tags),reason=issue({tags},{tagCount:COUNT});
  if(reason)throw Error(reason);
  return {...writer,tags};
}
function forPlatform(values,platform){return normalize(values,platform==='tistory'?10:COUNT);}
module.exports={COUNT,normalize,issue,instruction,repairPrompt,applyRepair,forPlatform};
