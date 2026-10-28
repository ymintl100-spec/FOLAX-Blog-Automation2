// Mechanical layout only. Keep every text line; move a section's images before its body.
function stripOperatorFooter(article){
  return String(article || '').replace(/(?:^|\r?\n)[ \t]*운영\s*[:：]\s*FOLAX\s*\(\s*포렉스\s*\)\s*\/\s*YM\s+INTL\s+Co\.\s*,?\s*Ltd\.?\s*$/iu,'');
}
function articlePlan(article,{preserveParagraphs=false,presentation={}}={}) {
  const groups=[[]];
  let paragraph=[],inReferences=false;
  const flush=()=>{if(paragraph.length){groups.at(-1).push({type:'paragraph',text:paragraph.join('\n')});paragraph=[];}};
  const textWithoutFooter=stripOperatorFooter(article);
  for(const raw of textWithoutFooter.split(/\r?\n/)){
    const text=raw.trim();if(!text){if(preserveParagraphs)flush();continue;}
    const section=text.match(/^\[SECTION\s*-\s*(.+)\]$/i);
    if(/^(?:\[SECTION\s*-\s*(?:참고\s*자료|참고\s*문헌|출처(?:\s*및\s*참고자료)?|References|Sources)\]|(?:#{1,6}\s*)?(?:참고\s*자료|참고\s*문헌|출처|References|Sources)\s*[:：]?)$/i.test(text)){flush();inReferences=true;continue;}
    if(inReferences){if(!section)continue;inReferences=false;}
    const image=text.match(/^\[IMAGE INSERT\s*-\s*(\d+)\]$/i);
    if(section){flush();groups.push([{type:'section',text:section[1],style:presentation.headingStyle==='quotation_underline'?'quotation_underline':'quotation_line'}]);}
    else if(image){flush();groups.at(-1).push({type:'image',sequence:Number(image[1])});}
    else if(preserveParagraphs&&!/^https?:\/\/\S+$/.test(text))paragraph.push(text);
    else {flush();groups.at(-1).push({type:'paragraph',text});}
  }
  flush();
  return presentation.preserveImageOrder?groups.flat():groups.flatMap((group,i)=>i===0?group:[group[0],...group.slice(1).filter(b=>b.type==='image'),...group.slice(1).filter(b=>b.type!=='image')]);
}
function articleWithHero(plan,hero,position){
  if(!hero)return plan;
  const firstSection=plan.findIndex(b=>b.type==='section');
  const index=position==='after-opening'?(firstSection<0?Math.min(1,plan.length):firstSection):0;
  return [...plan.slice(0,index),hero,...plan.slice(index)];
}
if(typeof module!=='undefined')module.exports={articlePlan,articleWithHero,stripOperatorFooter};
