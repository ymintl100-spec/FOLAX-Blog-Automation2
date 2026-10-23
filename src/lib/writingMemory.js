const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const MAX_EXAMPLES=12;
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
function summary(data){return {enabled:data.enabled!==false,avoidPhrases:data.avoidPhrases || [],examples:data.examples.map(e=>({id:e.id,title:e.title,source:e.source,createdAt:e.createdAt,characters:e.article.length}))};}
function list(root,id){return summary(read(root,id));}
function savePreferences(root,id,input){
 if(typeof input?.enabled!=='boolean' || !Array.isArray(input.avoidPhrases) || input.avoidPhrases.length>12 || input.avoidPhrases.some(p=>typeof p!=='string'||p.length>50))throw new Error('문체 적용 여부와 피할 표현(최대 12개, 각 50자)을 확인하세요.');
 const data=read(root,id);data.enabled=input.enabled;data.avoidPhrases=[...new Set(input.avoidPhrases.map(p=>p.trim()).filter(Boolean))];write(root,id,data);return summary(data);
}
function add(root,id,input){
 if(input?.approved!==true)throw new Error('직접 검토·승인한 글만 문체 학습에 추가할 수 있습니다.');
 if(typeof input.article!=='string'||input.article.trim().length<200||input.article.length>12000)throw new Error('학습용 글을 200~12,000자로 입력하세요.');
 if(typeof input.title!=='string'||input.title.length>120)throw new Error('예시 제목은 120자 이내로 입력하세요.');
 if(!['own','edited'].includes(input.source))throw new Error('직접 쓴 글 또는 검토·수정한 글을 선택하세요.');
 const article=input.article.trim(),hash=crypto.createHash('sha256').update(article.normalize('NFC').replace(/\s+/g,' ')).digest('hex');
 const data=read(root,id);
 if(data.examples.some(e=>e.hash===hash))return {...summary(data),duplicate:true};
 if(data.examples.length>=MAX_EXAMPLES)throw new Error('계정당 예시는 최대 12개입니다. 이전 예시를 삭제한 뒤 추가하세요.');
 data.examples.push({id:crypto.randomUUID(),title:input.title.trim()||'문체 예시',article,hash,source:input.source,createdAt:new Date().toISOString()});
 write(root,id,data);return {...summary(data),duplicate:false};
}
function remove(root,id,exampleId){
 if(typeof exampleId!=='string')throw new Error('삭제할 예시를 확인하세요.');
 const data=read(root,id);data.examples=data.examples.filter(e=>e.id!==exampleId);write(root,id,data);return summary(data);
}
function cleanExcerpt(value){return value.replace(/^\[SECTION[^\]]*\]\s*/gm,'').replace(/\[IMAGE INSERT[^\]]*\]/g,'').replace(/https?:\/\/\S+/g,'[링크]').replace(/\d[\d,./:%~-]*/g,'[숫자]').replace(/\s+/g,' ').trim();}
function guidance(root,id){
 const data=read(root,id);if(data.enabled===false)return null;
 const chosen=data.examples.slice(-3);if(!chosen.length && !(data.avoidPhrases||[]).length)return null;
 const paragraphs=chosen.flatMap(e=>e.article.split(/\n\s*\n/).map(p=>p.trim()).filter(p=>p.length>20&&!p.startsWith('[SECTION')));
 const mean=paragraphs.length?Math.round(paragraphs.reduce((n,p)=>n+p.length,0)/paragraphs.length):0;
 // Only compact style fragments are sent; full articles stay in local memory.
 const examples=chosen.slice(-2).map(e=>cleanExcerpt(e.article).slice(0,420));
 const result={version:1,exampleCount:data.examples.length,typicalParagraphCharacters:mean,avoidPhrases:(data.avoidPhrases||[]).slice(0,12),styleFragments:examples};
 result.fingerprint=crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex');
 return result;
}
module.exports={list,add,remove,savePreferences,guidance};
