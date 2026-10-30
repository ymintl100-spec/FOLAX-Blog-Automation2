const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(){
 const nodes=new Map(),events={},callbacks={};let initialReads=0,stateReads=0;
 class Element{
  constructor(id=''){this.id=id;this.dataset={};this.value='';this.checked=false;this.open=false;this.scrollTop=0;this.children=[];this.events={};this.classList={toggle(){}};this.textContent='';this.writes=0;}
  set innerHTML(value){this.html=value;this.writes++;if(this.id==='opsTopicDetail'){
   for(const m of value.matchAll(/<(input|textarea|select)\b[^>]*\bid="([^"]+)"[^>]*>/g)){const el=new Element(m[2]);el.checked=/\bchecked\b/.test(m[0]);el.value=m[1]==='select'?'naver':'';nodes.set(m[2],el);}
  }}
  get innerHTML(){return this.html||'';}
  addEventListener(type,fn){this.events[type]=fn;}
  replaceChildren(){this.children=[];this.value='';}
  append(el){this.children.push(el);if(this.id==='opsAccount'&&(el.selected||this.children.length===1))this.value=el.value;}
  querySelectorAll(selector){return this.id==='opsTopicDialog'&&selector==='input,textarea,select'?[...nodes.values()].filter(el=>el.id.startsWith('opsComp')||el.id.startsWith('opsGenerate')||el.id==='opsExperience'):[];}
  showModal(){this.open=true;this.opens=(this.opens||0)+1;}
  close(){this.open=false;this.events.close?.();}
  focus(options){this.focusOptions=options;}
 }
 for(const id of ['opsAccount','opsContent','opsStatus','opsTopicStatus','opsTopicDialog','opsTopicDetail','opsTopicClose','opsReload','operationsPanel','operationsNav','workspace'])nodes.set(id,new Element(id));
 const document={querySelector:s=>s==='.workspace'?nodes.get('workspace'):s.startsWith('#')&&!s.includes(' ')?nodes.get(s.slice(1))||null:null,querySelectorAll:()=>[],getElementById:id=>nodes.get(id),createElement:()=>new Element(),addEventListener:(type,fn)=>{events[type]=fn;}};
 const store={selectedAccountId:'a',accounts:[{id:'a',label:'검증용 계정',blogId:'fixture_a',tistoryBlogId:''}]};
 const topic={id:'topic-1',title:'검증용 주제',keyword:'검증',origin:'user_proposal',reasons:[],parts:[],trend:{periods:{},label:'미확인'},competition:[],duplicate:{status:'new'}};
 const snapshot=()=>({account:{...store.accounts.find(a=>a.id===nodes.get('opsAccount').value)},publicationMode:'approval',analytics:{platforms:[]},documents:[],savedTopics:[],categories:['건강·신체 상식'],topics:{top10:[],candidates:[topic],total:1,coverage:{note:''},scoreNote:''}});
 const api={getInitialData:async()=>{initialReads++;return {accountStore:structuredClone(store)};},getOperations:async()=>{stateReads++;return snapshot();},onAccountsUpdate:fn=>callbacks.accounts=fn,onComplete:fn=>callbacks.complete=fn,operationsAction:async()=>({})};
 const context=vm.createContext({document,window:{blogAuto:api},CSS:{escape:s=>s},console});
 let source=fs.readFileSync(require.resolve('../src/renderer/operations.js'),'utf8');
 source=source.replace('  init().catch((e) => message(e.message, true));', '  globalThis.subject={init,detail,refresh,showTab};');vm.runInContext(source,context);
 return {nodes,store,callbacks,events,subject:context.subject,reads:()=>({initialReads,stateReads}),settle:()=>new Promise(r=>setImmediate(r))};
}
test('connection-only account updates do not rebuild an open detail or erase its entered values',async()=>{
 const f=fixture();await f.subject.init();f.subject.detail('topic-1');
 f.nodes.get('opsExperience').value='저장 전 실제 경험 메모';f.nodes.get('opsGenerateImages').checked=false;
 const before=f.reads(),writes=f.nodes.get('opsContent').writes;
 for(let i=0;i<4;i++)f.callbacks.accounts({...f.store,accounts:f.store.accounts.map(a=>({...a,sessionStatus:'valid',sessionCheckedAt:String(i),connection:{checkedAt:i}}))});
 await f.settle();assert.deepEqual(f.reads(),before);assert.equal(f.nodes.get('opsContent').writes,writes);assert.equal(f.nodes.get('opsTopicDialog').open,true);assert.equal(f.nodes.get('opsExperience').value,'저장 전 실제 경험 메모');assert.equal(f.nodes.get('opsGenerateImages').checked,false);
});
test('background completion refresh and explicit detail refresh preserve the separate dialog and form',async()=>{
 const f=fixture();await f.subject.init();f.subject.detail('topic-1');const experience=f.nodes.get('opsExperience');experience.value='유지할 메모';f.nodes.get('opsTopicDetail').scrollTop=240;
 f.callbacks.complete({});await f.settle();assert.equal(f.nodes.get('opsTopicDialog').open,true);assert.equal(f.nodes.get('opsExperience'),experience);assert.equal(experience.value,'유지할 메모');
 f.subject.detail('topic-1');assert.equal(f.nodes.get('opsExperience').value,'유지할 메모');assert.equal(f.nodes.get('opsTopicDetail').scrollTop,240);assert.equal(f.nodes.get('opsTopicDialog').opens,1);
});
test('tab changes and a changed account target close the old account detail',async()=>{
 const f=fixture();await f.subject.init();f.subject.detail('topic-1');f.subject.showTab('drafts');assert.equal(f.nodes.get('opsTopicDialog').open,false);
 f.subject.showTab('overview');f.subject.detail('topic-1');f.store.accounts[0].blogId='changed_target';f.callbacks.accounts(f.store);await f.settle();assert.equal(f.nodes.get('opsTopicDialog').open,false);
});
