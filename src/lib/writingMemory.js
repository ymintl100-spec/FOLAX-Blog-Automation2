const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const MAX_EXAMPLES=12;
const formats=require('./blogFormatProfiles');
const {inspect}=require('./blogLayout');
const {articleCharacterCount}=require('./articleRequirements');
const normalize=value=>value.normalize('NFC').replace(/^\[SECTION\s*-\s*([^\]]+)\]\s*$/gm,'$1').replace(/\[IMAGE INSERT[^\]]*\]/g,'').replace(/[\s\u200b]+/g,'');
const digest=value=>crypto.createHash('sha256').update(normalize(value)).digest('hex');
const layoutText=value=>value.normalize('NFC').replace(/\r\n?/g,'\n').replace(/[\u200b\ufeff]/g,'').split('\n').map(line=>line.replace(/[^\S\n]+/g,' ').trim()).join('\n').replace(/\n{3,}/g,'\n\n').trim();
const layoutDigest=value=>crypto.createHash('sha256').update(layoutText(value)).digest('hex');
function eligible(example){
 if(example.source!=='edited'||typeof example.approvedAt!=='string'||!Number.isFinite(Date.parse(example.approvedAt)))return false;
 const expected=example.approvalVersion===3?layoutDigest(example.article):digest(example.article);
 return [2,3].includes(example.approvalVersion)&&typeof example.originalHash==='string'&&/^[a-f0-9]{64}$/.test(example.originalHash)&&example.originalHash!==expected&&example.approvedHash===expected;
}
function accountFile(root,id){
 if(typeof id!=='string' || !id || id.length>200)throw new Error('문체 학습 계정을 확인하세요.');
 return path.join(root,'writing-memory',crypto.createHash('sha256').update(id).digest('hex')+'.json');
}
function read(root,id){
 const file=accountFile(root,id);
 if(!fs.existsSync(file))return {version:1,enabled:true,avoidPhrases:[],examples:[]};
 const data=JSON.parse(fs.readFileSync(file,'utf8'));
 if(data.version!==1 || !Array.isArray(data.examples) || data.examples.length>MAX_EXAMPLES || data.examples.some(e=>!e||typeof e.id!=='string'||typeof e.title!=='string'||typeof e.article!=='string'||e.article.length>12000) || (data.avoidPhrases!==undefined && (!Array.isArray(data.avoidPhrases)||data.avoidPhrases.some(p=>typeof p!=='string'))))throw new Error('문체 학습 파일 형식이 올바르지 않습니다. 원본 파일은 보존했습니다.');
 return data;
}
function write(root,id,data){
 const file=accountFile(root,id);fs.mkdirSync(path.dirname(file),{recursive:true});
 const temporary=file+'.'+crypto.randomUUID()+'.tmp';
 try{fs.writeFileSync(temporary,JSON.stringify(data,null,2),{mode:0o600});fs.renameSync(temporary,file);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
function summary(data){return {enabled:data.enabled!==false,formatProfile:formats.normalizeProfile(data.formatProfile),direction:typeof data.direction==='string'?data.direction:formats.DEFAULT_DIRECTION,avoidPhrases:data.avoidPhrases || [],eligibleCount:data.examples.filter(eligible).length,examples:data.examples.map(e=>({id:e.id,title:e.title,source:e.source,createdAt:e.createdAt,characters:e.article.length,eligible:eligible(e)}))};}
function list(root,id){return summary(read(root,id));}
function savePreferences(root,id,input){
 if(typeof input?.enabled!=='boolean' || !Array.isArray(input.avoidPhrases) || input.avoidPhrases.length>12 || input.avoidPhrases.some(p=>typeof p!=='string'||p.length>50))throw new Error('문체 적용 여부와 피할 표현(최대 12개, 각 50자)을 확인하세요.');
 if(input.formatProfile!==undefined&&!['balanced','explanation','practical','comparison','essay','off'].includes(input.formatProfile))throw new Error('형식 설정을 확인하세요.');
 if(input.direction!==undefined&&(typeof input.direction!=='string'||input.direction.length>400))throw new Error('블로그 운영 방향은 400자 이내로 입력하세요.');
 const data=read(root,id);data.enabled=input.enabled;if(input.formatProfile!==undefined)data.formatProfile=input.formatProfile;if(input.direction!==undefined)data.direction=input.direction.trim();data.avoidPhrases=[...new Set(input.avoidPhrases.map(p=>p.trim()).filter(Boolean))];write(root,id,data);return summary(data);
}
function add(root,id,input){
 if(input?.approved!==true)throw new Error('직접 검토·승인한 글만 문체 학습에 추가할 수 있습니다.');
 if(typeof input.article!=='string'||input.article.trim().length<200||input.article.length>12000)throw new Error('학습용 글을 200~12,000자로 입력하세요.');
 if(typeof input.title!=='string'||input.title.length>120)throw new Error('예시 제목은 120자 이내로 입력하세요.');
 if(input.source!=='edited')throw new Error('수정·승인한 글 종류만 학습할 수 있습니다.');
 if(typeof input.originalArticle!=='string'||input.originalArticle.trim().length<200||input.originalArticle.length>12000)throw new Error('수정 전 원고도 200~12,000자로 입력하세요.');
 const article=input.article.trim(),original=input.originalArticle.trim(),hash=layoutDigest(article),originalHash=layoutDigest(original);
 if(hash===originalHash)throw new Error('수정 전후의 내용과 문단 형식이 같습니다. 표현 또는 의미 있는 줄바꿈·문단 구성을 수정하세요.');
 const data=read(root,id);
 const existing=data.examples.find(e=>layoutDigest(e.article)===hash);
 if(existing&&eligible(existing))return {...summary(data),savedExampleId:existing.id,duplicate:true};
 if(!existing&&data.examples.length>=MAX_EXAMPLES)throw new Error('계정당 예시는 최대 12개입니다. 이전 예시를 삭제한 뒤 추가하세요.');
 const now=new Date().toISOString();
 const example={id:existing?.id||crypto.randomUUID(),title:input.title.trim()||'수정·승인 예시',article,hash,source:'edited',createdAt:existing?.createdAt||now,approvalVersion:3,originalHash,approvedHash:hash,approvedAt:now,editComparison:editComparison(original,article),editComparisons:distributedEdits(original,article)};
 if(existing)data.examples[data.examples.indexOf(existing)]=example;else data.examples.push(example);
 write(root,id,data);return {...summary(data),savedExampleId:example.id,duplicate:false};
}
function remove(root,id,exampleId){
 if(typeof exampleId!=='string')throw new Error('삭제할 예시를 확인하세요.');
 const data=read(root,id);data.examples=data.examples.filter(e=>e.id!==exampleId);write(root,id,data);return summary(data);
}
function cleanExcerpt(value){return layoutText(referenceBody(value).replace(/\[IMAGE INSERT[^\]]*\]/g,'').replace(/https?:\/\/\S+/g,'[링크]').replace(/\d[\d,./:%~-]*/g,'[숫자]'));}
function referenceBody(value){return require('./publicationFormat').referenceParts(value).body;}
function editComparison(original,article){
 const before=cleanExcerpt(original),after=cleanExcerpt(article);let start=0,end=0;
 while(start<Math.min(before.length,after.length)&&before[start]===after[start])start++;
 if(start===before.length&&start===after.length)return null;
 while(end<Math.min(before.length,after.length)-start&&before[before.length-1-end]===after[after.length-1-end])end++;
 const from=Math.max(0,start-60);
 return {before:before.slice(from,Math.min(before.length-end+60,from+220)),after:after.slice(from,Math.min(after.length-end+60,from+220))};
}
function distributedEdits(original,article){
 const before=cleanExcerpt(original).split(/\n\s*\n/),after=cleanExcerpt(article).split(/\n\s*\n/),known=new Set(before);
 const changed=after.map((text,index)=>({text,index})).filter(e=>!known.has(e.text));
 if(!changed.length){const one=editComparison(original,article);return one?[one]:[];}
 const selected=[...new Set([0,Math.floor(changed.length/2),changed.length-1])].map(i=>{
  const item=changed[i],old=before[Math.min(before.length-1,Math.round(item.index*Math.max(0,before.length-1)/Math.max(1,after.length-1)))];
  return {before:old.slice(0,120),after:item.text.slice(0,120)};
 });
 return [...new Map(selected.map(e=>[JSON.stringify(e),e])).values()];
}
function median(values){const v=values.slice().sort((a,b)=>a-b);return v.length?Math.round((v[Math.floor((v.length-1)/2)]+v[Math.floor(v.length/2)])/2):0;}
function guidance(root,id){
 const data=read(root,id);if(data.enabled===false)return null;
 const approved=data.examples.filter(eligible),chosen=approved.slice(-3);if(!chosen.length && !(data.avoidPhrases||[]).length)return null;
 const layouts=approved.map(e=>inspect(e.article));
 const paragraphs=layouts.flatMap(l=>l.paragraphs);
 const mean=median(paragraphs.map(p=>p.replace(/\s/g,'').length));
 // Only compact style fragments are sent; full articles stay in local memory.
 const examples=chosen.slice(-2).flatMap(e=>{const value=cleanExcerpt(e.article);return [value.slice(0,130),value.slice(-130)];});
 const edits=chosen.flatMap(e=>Array.isArray(e.editComparisons)?e.editComparisons:e.editComparison?[e.editComparison]:[]);
 const approvedEdits=edits.slice(-3).filter(e=>e&&typeof e.before==='string'&&typeof e.after==='string').map(e=>({before:cleanExcerpt(e.before).slice(0,120),after:cleanExcerpt(e.after).slice(0,120)}));
 const result={version:5,exampleCount:approved.length,typicalArticleCharacters:median(approved.map(e=>articleCharacterCount(e.article))),typicalSectionCount:median(layouts.map(l=>l.sections.length)),typicalOpeningCharacters:median(layouts.map(l=>articleCharacterCount(l.sections.length?l.opening:l.paragraphs[0]))),typicalClosingCharacters:median(layouts.map(l=>articleCharacterCount(l.paragraphs.at(-1)))),typicalParagraphCharacters:mean,typicalLineCharacters:median(approved.flatMap(e=>referenceBody(e.article).split('\n').filter(s=>s.trim()&&!/^\[(?:SECTION|IMAGE)/.test(s)).map(s=>s.trim().length))),avoidPhrases:(data.avoidPhrases||[]).slice(0,12),styleFragments:examples,approvedEdits};
 while(JSON.stringify(result).length>2300){
  const edit=result.approvedEdits.find(e=>e.before.length>60||e.after.length>60);
  if(edit){edit.before=edit.before.slice(0,Math.max(60,edit.before.length-20));edit.after=edit.after.slice(0,Math.max(60,edit.after.length-20));}
  else if(result.styleFragments.length>1)result.styleFragments.shift();else break;
 }
 result.fingerprint=crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex');
 return result;
}
function formatGuidance(root,id){return formats.guidance(read(root,id).formatProfile);}
function direction(root,id){return summary(read(root,id)).direction;}
module.exports={list,add,remove,savePreferences,guidance,formatGuidance,direction};
