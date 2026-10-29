const test=require('node:test'),assert=require('node:assert/strict');
const tags=require('../src/lib/articleTags');
test('tag cleanup deduplicates Unicode, spacing, punctuation and Latin case without adding filler',()=>{
  const input=['#걷기 운동','걷기운동','###발 건강!','FOOT','ｆｏｏｔ',null,4,{},' '.repeat(3),'가'.repeat(31)];
  assert.deepEqual(tags.normalize(input),['걷기운동','발건강','FOOT']);
  assert.equal(input[0],'#걷기 운동');
  assert.match(tags.issue({tags:input},{tagCount:30}),/3개/);
  assert.equal(tags.issue({tags:input},{}),'');
});
test('a tag-only response cannot replace prose, citations, images or another article',()=>{
  const writer={title:'발 건강',article:'원문 그대로 보존합니다.',tags:['걷기'],citations:[{sourceId:'s1'}],bodyImages:[{path:'existing.png'}]},before=JSON.stringify(writer);
  const prompt=tags.repairPrompt(writer),fingerprint=JSON.parse(prompt.split('\n').at(-1)).fingerprint;
  const candidates=Array.from({length:30},(_,i)=>'검증용태그'+i);
  const result=tags.applyRepair(writer,{status:'success',fingerprint,tags:candidates,article:'무시할 변경',title:'무시'});
  assert.deepEqual(result,{...writer,tags:candidates});assert.equal(JSON.stringify(writer),before);
  assert.throws(()=>tags.applyRepair(writer,{status:'success',fingerprint:'stale',tags:candidates}),/일치/);
  assert.throws(()=>tags.applyRepair(writer,{status:'success',fingerprint,tags:['중복','중복']}),/30개/);
  assert.equal(tags.forPlatform(candidates,'naver').length,30);
  assert.deepEqual(tags.forPlatform(candidates,'tistory'),candidates.slice(0,10));
});

test('publisher bridge payload keeps 30 Naver tags and only the priority 10 for Tistory',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const candidates=Array.from({length:30},(_,i)=>'주제태그'+i);
 for(const platform of ['naver','tistory']){
  const file=require.resolve('../src/lib/'+platform+'Publisher'),calls=[],module={exports:{}};
  const bridge={request:async(id,type,payload)=>{calls.push({id,type,payload});return {published:true,url:'https://example.test/post'};}};
  vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,exports:module.exports,Date,Number,String,Error,Boolean,require:name=>name==='./extensionBridge'?{getBridge:()=>bridge}:require(path.resolve(path.dirname(file),name))},{filename:file});
  const publish=platform==='naver'?module.exports.publishToNaver:module.exports.publishToTistory;
  await publish({accountId:'fixture',blogId:'fixture',tistoryBlogId:'fixture',title:'제목',article:'본문',tags:candidates});
  assert.deepEqual(Array.from(calls[0].payload.tags),candidates.slice(0,platform==='naver'?30:10));
 }
});
