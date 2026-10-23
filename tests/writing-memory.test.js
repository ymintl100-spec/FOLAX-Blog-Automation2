const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const memory=require('../src/lib/writingMemory');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'blogauto-learning-'));test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
const sample=(extra='')=>({title:'직접 쓴 설명',source:'own',approved:true,article:('선택할 때 먼저 필요한 조건을 따져보는 편이에요. 이유가 다른 부분은 문단을 나눠 설명해요.\n\n').repeat(8)+extra});
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
 memory.add(root,'corrupt',sample());const files=fs.readdirSync(path.join(root,'writing-memory'));
 const crypto=require('node:crypto');const file=path.join(root,'writing-memory',crypto.createHash('sha256').update('corrupt').digest('hex')+'.json');
 fs.writeFileSync(file,'broken-data');assert.throws(()=>memory.list(root,'corrupt'));assert.equal(fs.readFileSync(file,'utf8'),'broken-data');
});
