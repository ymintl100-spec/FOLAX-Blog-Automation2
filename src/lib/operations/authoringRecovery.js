"use strict";
const fs=require('node:fs'),path=require('node:path'),S=require('./store');
// Older apps marked every input error uncertain. Correct only a single matching
// durable task that proves failure before final_publish; never infer from text.
function recover(db,root,account,document){
  if(document.platform!=='naver'||!document.publications.some(p=>p.state==='uncertain'))return false;
  let tasks;try{tasks=JSON.parse(fs.readFileSync(path.join(root,'extension-tasks.json'),'utf8'));}catch{return false;}
  if(!Array.isArray(tasks))return false;
  let changed=false;
  for(const p of document.publications.filter(p=>p.state==='uncertain')){
    const version=document.versions.find(v=>v.version===p.version);
    const begin=Date.parse(p.created_at),end=Date.parse(p.updated_at);
    if(!version||!Number.isFinite(begin)||!Number.isFinite(end)||!p.data.error)continue;
    const related=tasks.filter(t=>t.type==='publish'&&t.platform==='naver'&&t.accountId===account.id&&t.blogId===account.blogId&&
      t.payload?.title===version.title&&t.payload?.article===require('../publicationFormat').omitReferences(version.article)&&
      t.payload?.publishVisibility===p.data.visibility&&t.payload?.publishScheduleMode===p.data.scheduleMode&&
      Date.parse(t.createdAt)>=begin&&Date.parse(t.createdAt)<=end);
    if(related.length!==1)continue;
    const task=related[0];
    if(task.state!=='failed'||task.stage!=='writing'||task.code!=='AUTHORING_FAILED'||task.error!==p.data.error)continue;
    const proof={previousState:'uncertain',bridgeTaskId:task.id,publicationStage:'writing',verifiedAt:S.now()};
    db.prepare('UPDATE ops_publications SET state=?,updated_at=?,data=? WHERE id=? AND state=?').run('failed',S.now(),JSON.stringify({...p.data,code:task.code,publicationStage:'writing',bridgeTaskId:task.id,authoringRecovery:proof}),p.id,'uncertain');
    S.event(db,account.id,document.id,'authoring_failure_verified',proof);changed=true;
  }
  return changed;
}
module.exports={recover};
