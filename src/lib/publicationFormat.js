// Mechanical publication formatting only. Agents retain factual/style decisions.
function cleanSourceUrl(value) {
  const original=String(value || '');
  try {
    const url=new URL(original);
    if(!['http:','https:'].includes(url.protocol))return original;
    let changed=false;
    for(const key of [...url.searchParams.keys()]) {
      if(/^utm_|^(?:fbclid|gclid|dclid|msclkid)$/i.test(key)) {
        url.searchParams.delete(key);changed=true;
      }
    }
    return changed ? url.toString() : original;
  } catch { return original; }
}
function cleanPublicationUrls(writer) {
  if(!writer || typeof writer!=='object')return writer;
  return {...writer,
    article:typeof writer.article==='string' ? omitReferences(writer.article).replace(/https?:\/\/[^\s<>"\[\]]+/g,match=>{
      const suffix=match.match(/[).,;!?]+$/)?.[0] || '';
      return cleanSourceUrl(suffix ? match.slice(0,-suffix.length) : match)+suffix;
    }) : writer.article,
    ...(Array.isArray(writer.citations)?{citations:writer.citations.map(c=>({...c,url:cleanSourceUrl(c.url)}))}:{})
  };
}
function isBlogCitation(citation) {
  if(citation?.sourceKind==='blog')return true;
  try{const host=new URL(citation?.url).hostname.toLowerCase();return /(^|\.)(blog\.naver\.com|tistory\.com|blogspot\.com|wordpress\.com|velog\.io|brunch\.co\.kr)$/.test(host);}catch{return false;}
}
function referenceParts(article) {
  const text=String(article || '');
  const headings=[...text.matchAll(/^(?:\[SECTION\s*-\s*(?:참고\s*자료|참고\s*문헌|출처(?:\s*및\s*참고자료)?|References|Sources)\]|(?:#{1,6}\s*)?(?:참고\s*자료|참고\s*문헌|출처|References|Sources)\s*[:：]?)\s*$/gmi)];
  const heading=headings[0];
  // A legacy checkpoint can contain prose after its reference block. Keep it.
  const next=heading?text.slice(heading.index+heading[0].length).search(/^\[SECTION\s*-/mi):-1;
  const end=heading&&next>=0?heading.index+heading[0].length+next:text.length;
  return {body:heading?text.slice(0,heading.index)+text.slice(end):text,
    references:heading?text.slice(heading.index+heading[0].length,end):'',count:headings.length};
}
function omitReferences(article){
  let text=String(article||'');
  for(let i=0;i<20;i++){const parts=referenceParts(text);if(!parts.count)break;text=parts.body;}
  return text.trimEnd();
}
module.exports={cleanSourceUrl,cleanPublicationUrls,referenceParts,isBlogCitation,omitReferences};
