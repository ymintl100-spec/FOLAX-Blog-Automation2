const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const MAX_EXAMPLES=12;
const formats=require('./blogFormatProfiles');
const normalize=value=>value.normalize('NFC').replace(/^\[SECTION\s*-\s*([^\]]+)\]\s*$/gm,'$1').replace(/\[IMAGE INSERT[^\]]*\]/g,'').replace(/[\s\u200b]+/g,'');
const digest=value=>crypto.createHash('sha256').update(normalize(value)).digest('hex');
function eligible(example){return example.source==='edited' && example.approvalVersion===2 && typeof example.originalHash==='string' && /^[a-f0-9]{64}$/.test(example.originalHash) && example.originalHash!==digest(example.article) && example.approvedHash===digest(example.article) && typeof example.approvedAt==='string' && Number.isFinite(Date.parse(example.approvedAt));}
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
function summary(data){return {enabled:data.enabled!==false,formatProfile:formats.normalizeProfile(data.formatProfile),avoidPhrases:data.avoidPhrases || [],eligibleCount:data.examples.filter(eligible).length,examples:data.examples.map(e=>({id:e.id,title:e.title,source:e.source,createdAt:e.createdAt,characters:e.article.length,eligible:eligible(e)}))};}
function list(root,id){return summary(read(root,id));}
function savePreferences(root,id,input){
 if(typeof input?.enabled!=='boolean' || !Array.isArray(input.avoidPhrases) || input.avoidPhrases.length>12 || input.avoidPhrases.some(p=>typeof p!=='string'||p.length>50))throw new Error('문체 적용 여부와 피할 표현(최대 12개, 각 50자)을 확인하세요.');
 if(input.formatProfile!==undefined&&!['balanced','explanation','practical','off'].includes(input.formatProfile))throw new Error('형식 설정을 확인하세요.');
 const data=read(root,id);data.enabled=input.enabled;if(input.formatProfile!==undefined)data.formatProfile=input.formatProfile;data.avoidPhrases=[...new Set(input.avoidPhrases.map(p=>p.trim()).filter(Boolean))];write(root,id,data);return summary(data);
}
function add(root,id,input){
 if(input?.approved!==true)throw new Error('직접 검토·승인한 글만 문체 학습에 추가할 수 있습니다.');
 if(typeof input.article!=='string'||input.article.trim().length<200||input.article.length>12000)throw new Error('학습용 글을 200~12,000자로 입력하세요.');
 if(typeof input.title!=='string'||input.title.length>120)throw new Error('예시 제목은 120자 이내로 입력하세요.');
 if(input.source!=='edited')throw new Error('수정·승인한 글 종류만 학습할 수 있습니다.');
 if(typeof input.originalArticle!=='string'||input.originalArticle.trim().length<200||input.originalArticle.length>12000)throw new Error('수정 전 원고도 200~12,000자로 입력하세요.');
 const article=input.article.trim(),original=input.originalArticle.trim(),hash=digest(article),originalHash=digest(original);
 if(hash===originalHash)throw new Error('수정 전후의 내용이 같습니다. 공백·줄바꿈 변경만으로는 학습하지 않습니다.');
 const data=read(root,id);
 const existing=data.examples.find(e=>digest(e.article)===hash);
 if(existing&&eligible(existing))return {...summary(data),duplicate:true};
 if(!existing&&data.examples.length>=MAX_EXAMPLES)throw new Error('계정당 예시는 최대 12개입니다. 이전 예시를 삭제한 뒤 추가하세요.');
 const now=new Date().toISOString();
 const example={id:existing?.id||crypto.randomUUID(),title:input.title.trim()||'수정·승인 예시',article,hash,source:'edited',createdAt:existing?.createdAt||now,approvalVersion:2,originalHash,approvedHash:hash,approvedAt:now,editComparison:editComparison(original,article)};
 if(existing)data.examples[data.examples.indexOf(existing)]=example;else data.examples.push(example);
 write(root,id,data);return {...summary(data),duplicate:false};
}
function remove(root,id,exampleId){
 if(typeof exampleId!=='string')throw new Error('삭제할 예시를 확인하세요.');
 const data=read(root,id);data.examples=data.examples.filter(e=>e.id!==exampleId);write(root,id,data);return summary(data);
}
function cleanExcerpt(value){return value.replace(/^\[SECTION[^\]]*\]\s*/gm,'').replace(/\[IMAGE INSERT[^\]]*\]/g,'').replace(/https?:\/\/\S+/g,'[링크]').replace(/\d[\d,./:%~-]*/g,'[숫자]').replace(/\s+/g,' ').trim();}
function editComparison(original,article){
 const before=cleanExcerpt(original),after=cleanExcerpt(article);let start=0,end=0;
 while(start<Math.min(before.length,after.length)&&before[start]===after[start])start++;
 if(start===before.length&&start===after.length)return null;
 while(end<Math.min(before.length,after.length)-start&&before[before.length-1-end]===after[after.length-1-end])end++;
 const from=Math.max(0,start-60);
 return {before:before.slice(from,Math.min(before.length-end+60,from+220)),after:after.slice(from,Math.min(after.length-end+60,from+220))};
}
function guidance(root,id){
 const data=read(root,id);if(data.enabled===false)return null;
 const approved=data.examples.filter(eligible),chosen=approved.slice(-3);if(!chosen.length && !(data.avoidPhrases||[]).length)return null;
 const paragraphs=chosen.flatMap(e=>e.article.split(/\n\s*\n/).map(p=>p.trim()).filter(p=>p.length>20&&!p.startsWith('[SECTION')));
 const mean=paragraphs.length?Math.round(paragraphs.reduce((n,p)=>n+p.length,0)/paragraphs.length):0;
 // Only compact style fragments are sent; full articles stay in local memory.
 const examples=chosen.slice(-2).map(e=>cleanExcerpt(e.article).slice(0,260));
 const approvedEdits=chosen.slice(-2).map(e=>e.editComparison).filter(e=>e&&typeof e.before==='string'&&typeof e.after==='string').map(e=>({before:cleanExcerpt(e.before).slice(0,220),after:cleanExcerpt(e.after).slice(0,220)}));
 const result={version:2,exampleCount:approved.length,typicalParagraphCharacters:mean,avoidPhrases:(data.avoidPhrases||[]).slice(0,12),styleFragments:examples,approvedEdits};
 result.fingerprint=crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex');
 return result;
}
function formatGuidance(root,id){return formats.guidance(read(root,id).formatProfile);}
module.exports={list,add,remove,savePreferences,guidance,formatGuidance};
