const crypto=require('node:crypto');
const TOKEN=/\[\s*IMAGE\s+INSERT\s*[-–—:：]\s*([0-9０-９]+)\s*\]/gi;
const ANY_TOKEN=/\[\s*IMAGE\s+INSERT[^\]]{0,100}\]/gi;
const tokenNumber=s=>Number(String(s).normalize('NFKC'));
const prose=s=>String(s||'').replace(ANY_TOKEN,'').replace(/\s/gu,'');
function normalize(writer,{renumber=true}={}){
 if(!writer||typeof writer.article!=='string')return writer;
 const original=writer.article;
 let article=original.replace(TOKEN,(token,n,offset)=>{
   const before=offset>0&&original[offset-1]!=='\n'?'\n':'';
   const after=offset+token.length<original.length&&original[offset+token.length]!=='\n'?'\n':'';
   return before+'[IMAGE INSERT - '+tokenNumber(n)+']'+after;
 });
 let images=writer.bodyImages;
 const markers=[...article.matchAll(/\[IMAGE INSERT - (\d+)\]/g)].map(m=>Number(m[1]));
 if(renumber&&Array.isArray(images)&&images.length){
   const ids=images.map(i=>tokenNumber(i.sequence));
   if(ids.every(n=>Number.isInteger(n)&&n>=0)&&new Set(ids).size===ids.length&&markers.length===ids.length&&new Set(markers).size===markers.length&&markers.every(n=>ids.includes(n))){
     const order=new Map(markers.map((n,i)=>[n,i+1]));
     article=article.replace(/\[IMAGE INSERT - (\d+)\]/g,(_,n)=>'[IMAGE INSERT - '+order.get(Number(n))+']');
     images=images.map(i=>({...i,sequence:order.get(tokenNumber(i.sequence))})).sort((a,b)=>a.sequence-b.sequence);
   }
 }
 if(prose(article)!==prose(original))throw Error('이미지 마커 정리에서 본문이 달라져 원고를 보존했습니다.');
 return {...writer,article,bodyImages:images};
}
function context(writer){
 const article=String(writer.article||'').replace(ANY_TOKEN,'').replace(/\r\n?/g,'\n');
 const paragraphs=[];let offset=0,start=null,end=0,heading='본문',hasSections=false,inSection=false;
 const flush=()=>{if(start!==null){const raw=article.slice(start,end),text=raw.trim();if(text){const leading=raw.indexOf(text);paragraphs.push({id:'p'+(paragraphs.length+1),sectionHeading:heading,text,start:start+leading,end:start+leading+text.length,inSection});}start=null;}};
 for(const line of article.split('\n')){
   const section=line.match(/^\[SECTION\s*-\s*(.+?)\]\s*$/i);
   if(section){flush();heading=section[1].trim();hasSections=true;inSection=true;}
   else if(!line.trim())flush();
   else{if(start===null)start=offset;end=offset+line.length;}
   offset+=line.length+1;
 }
 flush();
 const candidates=hasSections?paragraphs.filter(p=>p.inSection):paragraphs;
 const images=Array.isArray(writer.bodyImages)?writer.bodyImages:[];
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify([article,images])).digest('hex').slice(0,16);
 return {article,paragraphs:candidates,images,fingerprint};
}
function repairPrompt(writer,options={}){
 const c=context(writer);
 return [
  'Repair image placement metadata only. Do not rewrite the title, article, citations, facts, image prompts, or style. Do not search or generate images.',
  'Choose exactly one afterParagraphId for each supplied imageIndex. Each ID must come from the paragraph list. Respect an image’s existing parent section when that section exists. Spread images near the explanation they illustrate when possible; do not add headings or prose.',
  'The app inserts canonical image markers. Return JSON only: '+JSON.stringify({status:'success',fingerprint:c.fingerprint,placements:c.images.map((_,i)=>({imageIndex:i+1,afterParagraphId:'<existing paragraph ID>'}))}),
  'Existing image plans: '+JSON.stringify(c.images.map((i,n)=>({imageIndex:n+1,sectionHeading:i.sectionHeading,prompt:i.prompt}))),
  'Read-only paragraphs: '+JSON.stringify(c.paragraphs.map(({id,sectionHeading,text})=>({id,sectionHeading,text}))),
  'Return exactly '+c.images.length+' body-image placements. The title image is handled separately, has no marker, and is not a placement in this list. Never merge or omit an existing image item.'
 ].join('\n');
}
function applyRepair(writer,result,options={}){
 const c=context(writer),count=c.images.length;
 const required=require('./imageCountPolicy').bodyMinimum(options);
 if(!count||count<required||count>Number(options.maxBodyImages??3)||c.images.some(i=>!String(i.prompt||'').trim()))throw Error('본문은 보존했습니다. 유효한 이미지 설명과 장수 계획을 먼저 확인하세요.');
 if(result?.status!=='success'||result.fingerprint!==c.fingerprint||!Array.isArray(result.placements)||result.placements.length!==count)throw Error('이미지 배치 응답이 현재 원고·이미지 계획과 일치하지 않습니다. 본문은 보존했습니다.');
 const seen=new Set(),placements=[];
 for(const p of result.placements){
   const n=p.imageIndex;
   if(!Number.isInteger(n)||n<1||n>count||seen.has(n))throw Error('이미지 배치 응답의 imageIndex가 중복·누락됐습니다.');
   const paragraph=c.paragraphs.find(x=>x.id===p.afterParagraphId),image=c.images[n-1];
   if(!paragraph)throw Error('이미지 배치에 원고에 없는 문단이 지정됐습니다.');
   const key=s=>String(s||'').normalize('NFC').replace(/\s+/g,' ').trim();
   const existingParent=c.paragraphs.some(x=>key(x.sectionHeading)===key(image.sectionHeading));
   if(existingParent&&key(paragraph.sectionHeading)!==key(image.sectionHeading))throw Error('이미지를 원래 소제목과 다른 설명으로 이동하지 않았습니다.');
   seen.add(n);placements.push({paragraph,image,sourceIndex:n});
 }
 placements.sort((a,b)=>a.paragraph.end-b.paragraph.end||a.sourceIndex-b.sourceIndex);
 const bodyImages=placements.map((p,i)=>({...p.image,sequence:i+1,sectionHeading:p.paragraph.sectionHeading}));
 let article=c.article;
 const inserts=new Map();placements.forEach((p,i)=>inserts.set(p.paragraph.end,(inserts.get(p.paragraph.end)||'')+'\n[IMAGE INSERT - '+(i+1)+']'));
 for(const [offset,value] of [...inserts].sort((a,b)=>b[0]-a[0]))article=article.slice(0,offset)+value+article.slice(offset);
 if(prose(article)!==prose(writer.article))throw Error('이미지 배치 보완에서 본문이 달라져 원고를 보존했습니다.');
 return {...writer,article,bodyImages};
}
function diagnostic(writer){
 const planned=(writer.bodyImages||[]).map(i=>i.sequence),markers=[...String(writer.article||'').matchAll(TOKEN)].map(m=>tokenNumber(m[1]));
 return `이미지 번호와 마커 불일치: 계획 [${planned.join(', ')}] / 본문 [${markers.join(', ')}]. 각 본문 이미지에 서로 다른 번호와 마커 1개가 필요합니다.`;
}
module.exports={normalize,context,repairPrompt,applyRepair,diagnostic};
