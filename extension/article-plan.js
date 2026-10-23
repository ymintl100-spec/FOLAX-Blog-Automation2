// Mechanical layout only. Keep every text line; move a section's images before its body.
function articlePlan(article,{preserveParagraphs=false}={}) {
  const groups=[[]];
  let paragraph=[];
  const flush=()=>{if(paragraph.length){groups.at(-1).push({type:'paragraph',text:paragraph.join('\n')});paragraph=[];}};
  for(const raw of String(article || '').split(/\r?\n/)){
    const text=raw.trim();if(!text){if(preserveParagraphs)flush();continue;}
    const section=text.match(/^\[SECTION\s*-\s*(.+)\]$/i);
    const image=text.match(/^\[IMAGE INSERT\s*-\s*(\d+)\]$/i);
    if(section){flush();groups.push([{type:'section',text:section[1],style:'quotation_line'}]);}
    else if(image){flush();groups.at(-1).push({type:'image',sequence:Number(image[1])});}
    else if(preserveParagraphs&&!/^https?:\/\/\S+$/.test(text))paragraph.push(text);
    else {flush();groups.at(-1).push({type:'paragraph',text});}
  }
  flush();
  return groups.flatMap((group,i)=>i===0?group:[group[0],...group.slice(1).filter(b=>b.type==='image'),...group.slice(1).filter(b=>b.type!=='image')]);
}
if(typeof module!=='undefined')module.exports={articlePlan};
