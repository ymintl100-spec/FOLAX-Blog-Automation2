const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const memory=require('../src/lib/writingMemory');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'blogauto-learning-'));test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
const sample=(extra='')=>({title:'직접 쓴 설명',source:'edited',approved:true,originalArticle:('원래 원고는 필요한 조건을 먼저 확인하여 선택하여야 한다는 내용을 반복적으로 설명하고 있습니다.\n\n').repeat(8),article:('선택할 때 먼저 필요한 조건을 따져보는 편이에요. 이유가 다른 부분은 문단을 나눠 설명해요.\n\n').repeat(8)+extra});
test('learning requires explicit review and does not create a sample from an unapproved draft',()=>{assert.throws(()=>memory.add(root,'unapproved',{...sample(),approved:false}),/승인/);assert.equal(memory.list(root,'unapproved').examples.length,0)});
test('samples are isolated by account, deduplicated, and deleted without affecting another account',()=>{
 const a=memory.add(root,'account-a',sample()),b=memory.add(root,'account-b',sample('다른 글'));
 assert.equal(a.examples.length,1);assert.equal(memory.add(root,'account-a',sample()).duplicate,true);
 memory.remove(root,'account-a',a.examples[0].id);assert.equal(memory.list(root,'account-a').examples.length,0);assert.equal(memory.list(root,'account-b').examples[0].id,b.examples[0].id);
});
test('style context is bounded and masks URLs and numbers instead of borrowing example facts',()=>{
 memory.add(root,'bounded',{...sample(),article:('2026년 3월 100,000원 https://example.com/test 조건을 확인해요. '+('문장 리듬을 살려 설명해요. '.repeat(20))+'\n\n').repeat(10)});
 memory.savePreferences(root,'bounded',{enabled:true,avoidPhrases:Array.from({length:12},(_,i)=>String(i)+'가'.repeat(48))});
 const guide=memory.guidance(root,'bounded');assert(JSON.stringify(guide).length<2500);assert(!guide.styleFragments.join('').includes('100,000'));assert(!guide.styleFragments.join('').includes('https://'));assert.equal(guide.exampleCount,1);
 memory.savePreferences(root,'bounded',{enabled:false,avoidPhrases:[]});assert.equal(memory.guidance(root,'bounded'),null);
});
test('untrusted input cannot grow memory indefinitely or supply an unsupported source',()=>{
 assert.throws(()=>memory.add(root,'limits',{...sample(),source:'automatic'}),/종류|선택/);
 for(let i=0;i<12;i++)memory.add(root,'limits',sample('예시 '+i));
 assert.throws(()=>memory.add(root,'limits',sample('추가')),/12개/);
 assert.throws(()=>memory.savePreferences(root,'limits',{enabled:true,avoidPhrases:['x'.repeat(51)]}),/50자/);
});
test('corrupt memory is reported and preserved rather than silently reset',()=>{
 memory.add(root,'corrupt',sample());
 const crypto=require('node:crypto');const file=path.join(root,'writing-memory',crypto.createHash('sha256').update('corrupt').digest('hex')+'.json');
 fs.writeFileSync(file,'broken-data');assert.throws(()=>memory.list(root,'corrupt'));assert.equal(fs.readFileSync(file,'utf8'),'broken-data');
});
test('learning requires actual edits and rejects unedited, whitespace-only, and missing originals',()=>{
 const input=sample();
 assert.throws(()=>memory.add(root,'edits',{...input,originalArticle:undefined}),/수정 전/);
 assert.throws(()=>memory.add(root,'edits',{...input,originalArticle:input.article}),/같습니다/);
 assert.throws(()=>memory.add(root,'edits',{...input,originalArticle:input.article.replace(/ /g,'  ')}),/같습니다/);
 assert.throws(()=>memory.add(root,'edits',{...input,source:'own'}),/수정·승인/);
 assert.equal(memory.guidance(root,'edits'),null);
 const saved=memory.add(root,'edits',input);assert.equal(saved.eligibleCount,1);
 const guide=memory.guidance(root,'edits');assert.equal(guide.approvedEdits.length,1);assert.notEqual(guide.approvedEdits[0].before,guide.approvedEdits[0].after);
});
test('legacy samples stay stored but are excluded until their before/after edit is explicitly approved',()=>{
 const crypto=require('node:crypto');const input=sample();memory.add(root,'legacy',input);
 const file=path.join(root,'writing-memory',crypto.createHash('sha256').update('legacy').digest('hex')+'.json');
 const data=JSON.parse(fs.readFileSync(file));data.examples[0].source='own';delete data.examples[0].approvalVersion;
 fs.writeFileSync(file,JSON.stringify(data));
 assert.equal(memory.guidance(root,'legacy'),null);assert.equal(memory.list(root,'legacy').examples.length,1);assert.equal(memory.list(root,'legacy').eligibleCount,0);
 const reapproved=memory.add(root,'legacy',input);assert.equal(reapproved.examples.length,1);assert.equal(reapproved.eligibleCount,1);
 const changed=JSON.parse(fs.readFileSync(file));changed.examples[0].article+='승인 후 몰래 변경한 내용';fs.writeFileSync(file,JSON.stringify(changed));
 assert.equal(memory.guidance(root,'legacy'),null);
});
test('benchmark format is account-specific and independent of approved style application',()=>{
 assert.equal(memory.formatGuidance(root,'format-a').id,'balanced');
 memory.savePreferences(root,'format-a',{enabled:false,avoidPhrases:[],formatProfile:'practical'});
 assert.equal(memory.guidance(root,'format-a'),null);assert.equal(memory.formatGuidance(root,'format-a').id,'practical');
 assert.equal(memory.formatGuidance(root,'format-b').id,'balanced');
 memory.add(root,'format-a',sample());memory.savePreferences(root,'format-a',{enabled:true,avoidPhrases:[],formatProfile:'off'});
 assert.equal(memory.formatGuidance(root,'format-a'),null);assert.equal(memory.guidance(root,'format-a').exampleCount,1);
 assert.throws(()=>memory.savePreferences(root,'format-a',{enabled:true,avoidPhrases:[],formatProfile:'unknown'}),/형식/);
});
test('approved paragraph-only edits retain line breaks and headings in compact guidance',()=>{
 const first='자주 쓰는 도구를 먼저 한쪽에 모아 둡니다. 찾을 때 필요한 순서가 분명해지기 때문입니다.';
 const second='물건을 옮기기 전에는 실제로 손이 닿는지 살펴봅니다. 공간에 맞춰 기준을 조정할 수 있습니다.';
 const original=first+' '+second+' '+first+' '+second+' '+first;
 const article=first+'\n\n[SECTION - 도구를 놓는 기준]\n'+second+'\n\n'+first+'\n\n[SECTION - 공간에 맞춰 바꾸기]\n'+second+'\n\n'+first;
 const saved=memory.add(root,'layout-only',{...sample(),originalArticle:original,article});assert.equal(saved.eligibleCount,1);
 const guide=memory.guidance(root,'layout-only');assert(guide.styleFragments[0].includes('\n\n'));assert(guide.styleFragments[0].includes('[SECTION - 도구를 놓는 기준]'));
 assert(guide.typicalParagraphCharacters<original.length/2);assert(guide.typicalLineCharacters>0);assert(guide.styleFragments.some(s=>s.includes('\n')));
 assert.equal(memory.add(root,'layout-only',{...sample(),originalArticle:original,article:article.replace(/ /g,'  ')}).duplicate,true);
 const reflowed=original.replaceAll('. ','.\n\n');assert.equal(reflowed.replace(/\s/g,''),original.replace(/\s/g,''));
 assert.equal(memory.add(root,'line-break-only',{...sample(),originalArticle:original,article:reflowed}).eligibleCount,1);
 assert(memory.guidance(root,'line-break-only').typicalParagraphCharacters<original.length/2);
});
