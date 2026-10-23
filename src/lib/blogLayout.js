const {referenceParts}=require('./publicationFormat');
function inspect(article){
 const body=referenceParts(String(article||'')).body.replace(/\[IMAGE INSERT[^\]]*\]/g,'').trim();
 const matches=[...body.matchAll(/^\[SECTION\s*-\s*([^\]]+)\]\s*$/gm)];
 const opening=body.slice(0,matches[0]?.index??body.length).trim();
 const sections=matches.map((m,i)=>({heading:m[1].trim(),body:body.slice(m.index+m[0].length,matches[i+1]?.index??body.length).trim()}));
 const prose=body.replace(/^\[SECTION[^\]]*\]\s*$/gm,'\n\n');
 const paragraphs=prose.split(/\n\s*\n/).map(p=>p.trim()).filter(Boolean);
 const lines=prose.split(/\n/).map(p=>p.trim()).filter(Boolean);
 const mean=values=>values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length):0;
 return {opening,sections,closing:sections.at(-1)?.body||paragraphs.slice(-2).join('\n\n'),paragraphs,
  stats:{sectionCount:sections.length,paragraphCount:paragraphs.length,typicalParagraphCharacters:mean(paragraphs.map(p=>p.replace(/\s/g,'').length)),typicalLineCharacters:mean(lines.map(p=>p.length)),longestParagraphCharacters:Math.max(0,...paragraphs.map(p=>p.replace(/\s/g,'').length))}};
}
function required(options){return options.formatGuidance?.version>=2;}
function issue(writer,options={}){
 if(!required(options))return '';
 const layout=inspect(writer?.article);
 if(!layout.opening)return '벤치마크 형식: 첫 소제목 앞에 독자의 상황과 핵심 답을 연결하는 짧은 도입이 필요합니다.';
 const minimum=options.formatGuidance?.version>=3?options.formatGuidance.surface?.minSections??2:2;
 if(layout.sections.length<minimum||layout.sections.some(s=>!s.heading||!s.body))return `벤치마크 형식: 해당 글의 역할에 맞는 소제목 ${minimum}개 이상과 각 소제목의 본문이 필요합니다. 참고자료는 제외합니다.`;
 const approved=Number(options.writingGuidance?.typicalParagraphCharacters)||0;
 const limit=Math.min(600,Math.max(300,Math.round(approved*2.5)));
 if(layout.stats.longestParagraphCharacters>limit)return `벤치마크 형식: 빈 줄 없이 이어진 ${layout.stats.longestParagraphCharacters}자 문단이 있습니다. 내용·조건을 보존하고 한 의미의 짧은 문단으로 나누세요 (현재 기준 ${limit}자).`;
 return '';
}
function report(writer,options={}){
 const layout=inspect(writer?.article);
 return {profileId:options.formatGuidance?.id||'off',label:options.formatGuidance?.label||options.formatGuidance?.id||'벤치마크 끔',guideVersion:options.formatGuidance?.version||0,approvedExamples:options.writingGuidance?.exampleCount||0,titleImagePlanned:options.includeTitleImage!==false,presentation:options.formatGuidance?.version>=3?{...options.formatGuidance.surface,...require('./readingRhythm').settings(options.formatGuidance,options.writingGuidance),preserveImageOrder:true}:null,...layout.stats};
}
module.exports={inspect,required,issue,report};
