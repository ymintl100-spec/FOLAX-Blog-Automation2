// Whitespace-only layout. Never rewrite words, quantities or qualifications.
const clamp=(value,fallback,min,max)=>Number.isFinite(Number(value))&&Number(value)>0?Math.min(max,Math.max(min,Math.round(Number(value)))):fallback;
function settings(guide,style){return {lineTarget:clamp(style?.typicalLineCharacters,guide?.surface?.lineTarget||22,14,64),paragraphTarget:clamp(style?.typicalParagraphCharacters,guide?.surface?.paragraphTarget||80,35,240)};}
function wrap(line,target){
 const words=line.trim().split(/\s+/);const out=[];let current='';
 for(let i=0;i<words.length;i++){
  let word=words[i];
  if(/^\d+(?:[.,]\d+)*$/.test(word)&&/^(?:%|kg|g|mg|ml|mL|cm|km|분|초|시간|회|세|원|명|년|개월|일)(?:[.,!?])?$/.test(words[i+1]||''))word+=' '+words[++i];
  if(current&&[...current+' '+word].length>target){out.push(current);current=word;}else current+=(current?' ':'')+word;
 }
 if(current)out.push(current);return out.join('\n');
}
function paragraph(value,limits){
 const existing=value.split('\n');
 if(existing.length>1&&existing.every(s=>s.trim().length<=limits.lineTarget+12))return value;
 const parts=[];let start=0;
 for(const match of value.matchAll(/[.!?。！？][”’"']*\s+/g)){
  const end=match.index+match[0].length,part=value.slice(start,end).trim();
  if(/^\d+\.$/.test(part))continue;
  parts.push(part);start=end;
 }
 if(value.slice(start).trim())parts.push(value.slice(start).trim());
 const groups=[];let current='';
 for(const sentence of parts){
  if(current&&(current+' '+sentence).length>limits.paragraphTarget){groups.push(current);current=sentence;}else current+=(current?' ':'')+sentence;
 }
 if(current)groups.push(current);
 return groups.map(part=>wrap(part,limits.lineTarget)).join('\n\n');
}
function apply(article,guide,style){
 if(!(guide?.version>=3))return String(article||'');
 const limits=settings(guide,style);let references=false;const out=[],pending=[];
 const flush=()=>{if(pending.length){out.push(paragraph(pending.join('\n'),limits));pending.length=0;}};
 for(const line of String(article||'').replace(/\r\n?/g,'\n').split('\n')){
  if(/^\[SECTION\s*-\s*참고자료\]/.test(line))references=true;
  if(references||/^\s*\[(?:SECTION|IMAGE\s+INSERT)\b/i.test(line)||/^https?:\/\/\S+$/.test(line.trim())){flush();out.push(line);}
  else if(!line.trim()){flush();out.push('');}else pending.push(line);
 }
 flush();const result=out.join('\n');
 if(result.replace(/\s/g,'')!==String(article||'').replace(/\s/g,''))throw new Error('줄바꿈 조정에서 본문 내용이 달라져 원고를 보존했습니다.');
 return result;
}
module.exports={apply,settings};
