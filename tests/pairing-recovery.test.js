'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ExtensionBridge}=require('../src/lib/extensionBridge');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'folax-pair-recovery-')),bridge=new ExtensionBridge(root,0),token='fixture-old-token';
 bridge.clients.set(token,{token,accountId:'a',blogId:'fixture',platform:'naver',deviceId:'fixture-device-123456789',status:'checking'});bridge.lastSeen.set(token,Date.now());bridge.save();
 t.after(()=>{bridge.stop();fs.rmSync(root,{recursive:true,force:true});});
 return {root,bridge,token};
}
const observe=p=>p.then(value=>({value}),error=>({error}));
test('pairing remains possible while a disconnected login check is waiting and preserves browser data',async t=>{
 const {root,bridge,token}=fixture(t),cookie=path.join(root,'cookie-fixture');fs.writeFileSync(cookie,'untouched existing login');
 const pending=observe(bridge.request('a','session',{interactive:true})),task=[...bridge.tasks.values()][0];task.state='running';task.waiting=true;bridge.lastSeen.set(token,Date.now()-80000);
 assert.equal(bridge.snapshot('a').connected,false);assert.equal(bridge.snapshot('a').busy,true);assert.equal(bridge.snapshot('a').taskType,'session');assert.equal(bridge.snapshot('a').pairingAllowed,true);
 const code=bridge.pairCode('a','fixture','검증 계정');assert.match(code.code,/^[A-F0-9]{10}$/);assert.equal((await pending).error.code,'SESSION_CHECK_REPLACED');
 assert.equal(bridge.snapshot('a').busy,false);assert.equal(bridge.snapshot('a').status,'disconnected');assert.equal(bridge.clients.get(token).status,'checking');assert.equal(fs.readFileSync(cookie,'utf8'),'untouched existing login');
 assert.equal(JSON.parse(fs.readFileSync(bridge.journal)).find(t=>t.id===task.id).state,'cancelled');
});
test('code issuance and redemption both preserve active authoring and final publication tasks',async t=>{
 const {bridge,token}=fixture(t);await bridge.start();const code=bridge.pairCode('a','fixture','계정');
 const pending=observe(bridge.request('a','publish',{title:'저장 원고',article:'보존할 원고 본문'})),task=[...bridge.tasks.values()][0];task.state='running';task.stage='final_publish';bridge.saveTasks();
 assert.equal(bridge.snapshot('a').pairingAllowed,false);assert.throws(()=>bridge.pairCode('a','fixture','계정'),e=>e.code==='ACCOUNT_BUSY');
 const response=await fetch('http://127.0.0.1:'+bridge.port+'/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:code.code,deviceId:'new-device-1234567890123456'})});
 assert.equal(response.status,409);assert.equal(task.state,'running');assert(bridge.clients.has(token));assert(bridge.codes.has(code.code));assert.equal(bridge.waiters.size,1);
 bridge.cancelAccount('a');assert.equal((await pending).error.code,'PUBLISH_UNCERTAIN');assert.equal(task.stage,'final_publish');
});
test('read-only session timeout releases unclaimed and offline waiting tasks but preserves a live login wait',async t=>{
 const {bridge,token}=fixture(t),now=Date.now(),events=[];bridge.on('status',(_id,s)=>events.push(s));
 for(const scenario of ['queued','running','offline-waiting']){
  bridge.lastSeen.set(token,scenario==='offline-waiting'?now-80000:now);
  // A check is queued while the heartbeat is fresh, then loses its connection.
  if(scenario==='offline-waiting')bridge.lastSeen.set(token,now);
  const pending=observe(bridge.request('a','session',{})),task=[...bridge.tasks.values()].at(-1);
  task.state=scenario==='queued'?'queued':'running';task.waiting=scenario==='offline-waiting';task.createdAt=new Date(now-150000).toISOString();task.claimedAt=task.state==='running'?task.createdAt:undefined;
  if(scenario==='offline-waiting')bridge.lastSeen.set(token,now-80000);
  bridge.checkDisconnectedTasks(now);assert.equal((await pending).error.code,'EXTENSION_DISCONNECTED');assert.equal(bridge.snapshot('a').busy,false);assert.equal(events.at(-1).busy,false);
 }
 bridge.lastSeen.set(token,now);const pending=observe(bridge.request('a','session',{})),task=[...bridge.tasks.values()].at(-1);task.state='running';task.waiting=true;task.createdAt=new Date(now-600000).toISOString();
 bridge.checkDisconnectedTasks(now);assert.equal(task.state,'running');assert.equal(bridge.snapshot('a').busy,true);bridge.cancelAccount('a');await pending;
});
test('reconnecting cannot mistake a cancelled old check for a successful fresh login',async t=>{
 const {bridge,token}=fixture(t);await bridge.start();const pending=observe(bridge.request('a','session',{})),task=[...bridge.tasks.values()][0],pair=bridge.pairCode('a','fixture','계정');await pending;
 const send=async(route,body,auth)=>fetch('http://127.0.0.1:'+bridge.port+route,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{})},body:JSON.stringify(body)});
 assert.equal((await send('/result',{id:task.id,result:{status:'valid',checkedAt:new Date().toISOString()}},token)).status,200);assert.notEqual(bridge.clients.get(token).status,'valid');
 const response=await send('/pair',{code:pair.code,deviceId:'fixture-device-123456789'});assert.equal(response.status,200);const connection=await response.json();assert.equal(bridge.clients.has(token),false);assert.equal(bridge.snapshot('a').status,'unknown');
 const next=observe(bridge.request('a','session',{})),fresh=[...bridge.tasks.values()].at(-1);
 await send('/result',{id:fresh.id,result:{status:'valid',editorBuild:'20261106.1'}},connection.token);assert.equal((await next).value.status,'valid');assert.equal(bridge.snapshot('a').status,'valid');
});
test('a stalled publish remains recorded and is never silently released as a login-only check',async t=>{
 const {bridge,token}=fixture(t),pending=observe(bridge.request('a','publish',{title:'기존 제목',article:'보존 원고'})),task=[...bridge.tasks.values()][0];task.state='running';task.stage='final_publish';task.waiting=true;bridge.lastSeen.set(token,Date.now()-600000);
 bridge.checkDisconnectedTasks();assert.equal(task.state,'running');assert.equal(bridge.snapshot('a').pairingAllowed,false);bridge.cancelAccount('a');await pending;
});
