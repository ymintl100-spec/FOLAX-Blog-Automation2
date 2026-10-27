'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {reviewDraft,assertFolaxPublishable}=require('./folaxPublishGate');
const {lookupEvidence,buildReviewBrief}=require('./folaxEvidence');
const {publishSequence}=require('./publishSequence');
test('article-only FOLAX mention must be blocked',()=>assert.equal(reviewDraft({title:'걷기',article:'포렉스 하이볼륨 깔창'}).allow,false));
test('FOLAX image path must be blocked',()=>assert.equal(reviewDraft({article:'일반 정보',bodyImages:[{path:'/images/FOLAX_highvolume.jpg'}]}).allow,false));
test('topic-only FOLAX mention must be blocked',()=>assert.equal(reviewDraft({topic:'포렉스 슬림업',article:'정보'}).allow,false));
test('neutral educational post unaffected',()=>assert.equal(reviewDraft({title:'발 관리',article:'개인 차이가 있습니다.'}).allow,true));
test('invalid draft blocked',()=>assert.equal(reviewDraft(null).allow,false));
test('block has a machine-readable reason',()=>assert.throws(()=>assertFolaxPublishable({article:'FOLAX'}),{code:'FOLAX_REVIEW_REQUIRED'}));
test('publishSequence does not save or post blocked FOLAX drafts',async()=>{
 let writes=0,posts=0;
 await assert.rejects(publishSequence({title:'걸음',article:'포렉스 슬림업',publications:{}},{save:async()=>writes++,naver:async()=>posts++}),{code:'FOLAX_REVIEW_REQUIRED'});
 assert.equal(writes,0);assert.equal(posts,0);
});
test('unrelated publication still follows original Naver flow',async()=>{
 let writes=0,posts=0;
 const result=await publishSequence({title:'정보',article:'하루 걷기',publications:{}},{save:async()=>writes++,naver:async()=>{posts++;return {published:true,url:'https://example.com/post/1'};}});
 assert.equal(writes,2);assert.equal(posts,1);assert.equal(result.publications.naver.status,'done');
});
test('missing KB cannot be mistaken for an approved source',()=>{
 const r=lookupEvidence({runtimeRoot:'/nonexistent-folax-runtime',query:'하이볼륨'});
 assert.equal(r.status,'INDEX_NOT_INSTALLED');assert.equal(r.approval,false);
});
test('neutral topic injects no private product evidence',()=>assert.equal(buildReviewBrief({topic:'일상 걷기',keyword:'보행'}),undefined));
test('brand topic without KB describes the omission',()=>assert.equal(buildReviewBrief({runtimeRoot:'/nonexistent-folax-runtime',topic:'포렉스 하이볼륨'}).status,'INDEX_NOT_INSTALLED'));
test('corrupted local data fails closed',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'folax-unit-')),f=path.join(dir,'folax');
 fs.mkdirSync(f);fs.writeFileSync(path.join(f,'evidence.jsonl'),'{}\n');
 try{assert.throws(()=>lookupEvidence({runtimeRoot:dir,query:'포렉스'}),/count mismatch/);}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
