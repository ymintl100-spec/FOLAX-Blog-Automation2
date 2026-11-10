'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {naverTargetEditorUrl,naverLoginReturnUrl}=require('../extension/naver-login');
const editor='https://blog.naver.com/trafle/postwrite';
test('known read-only Naver login landings return to the exact requested editor',()=>{
 for(const url of ['https://blog.naver.com/trafle','https://blog.naver.com/trafle/','https://blog.naver.com/trafle/123','https://blog.naver.com/PostList.naver?blogId=trafle','https://blog.naver.com/MyBlog.naver','https://m.blog.naver.com/trafle','https://www.naver.com/'])assert.equal(naverLoginReturnUrl(url,'trafle'),editor,url);
 for(const url of [editor,'https://blog.naver.com/PostWriteForm.naver?blogId=trafle'])assert(naverTargetEditorUrl(url,'trafle'));
});
test('editors, login/challenge pages, other blogs and unrelated destinations are never navigated',()=>{
 for(const url of [editor,'https://blog.naver.com/PostWriteForm.naver?blogId=trafle','https://blog.naver.com/PostUpdateForm.naver?blogId=trafle&logNo=1','https://nid.naver.com/nidlogin.login','https://nid.naver.com/captcha','https://blog.naver.com/other','https://blog.naver.com/PostView.naver?blogId=other','https://www.naver.com/other','https://example.org/','http://blog.naver.com/trafle','https://user@blog.naver.com/trafle','https://blog.naver.com:444/trafle','chrome-extension://test/connect.html'])assert.equal(naverLoginReturnUrl(url,'trafle'),'',url);
 assert.equal(naverLoginReturnUrl('https://www.naver.com/','../other'),'');assert.equal(naverTargetEditorUrl('https://blog.naver.com/PostWriteForm.naver?blogId=other','trafle'),false);
});
async function harness({url='https://blog.naver.com/trafle',extra=[],inspect,closed=false}={}){
 const data={},tabs=new Map([[1,{id:1,windowId:1,url,status:'complete'}],...extra.map(t=>[t.id,{windowId:1,status:'complete',...t}])]),calls=[],listener={addListener(){}},results=[];
 if(closed)tabs.delete(1);
 const chrome={storage:{local:{get:async()=>structuredClone(data),set:async value=>Object.assign(data,structuredClone(value)),remove:async keys=>{for(const k of [].concat(keys))delete data[k];}}},tabs:{get:async id=>{if(!tabs.has(id))throw Error('Tab closed');return structuredClone(tabs.get(id));},query:async()=>[...tabs.values()].filter(t=>t.url.startsWith('https://blog.naver.com/')).map(t=>structuredClone(t)),update:async(id,change)=>{calls.push({kind:'navigate',id,...change});Object.assign(tabs.get(id),change);return structuredClone(tabs.get(id));},create:async change=>{const t={id:10,windowId:1,status:'complete',...change};tabs.set(t.id,t);calls.push({kind:'create',...change});return structuredClone(t);},onUpdated:listener},windows:{update:async()=>{}},alarms:{create(){},onAlarm:listener},action:{onClicked:listener},runtime:{onStartup:listener,onInstalled:listener,onMessage:listener,getURL:s=>s},scripting:{executeScript:async args=>{
  const tab=tabs.get(args.target.tabId),command=args.args[0];calls.push({kind:'script',command,id:tab.id});
  if(command==='inspect')return [{frameId:0,result:inspect?inspect(tab):naverTargetEditorUrl(tab.url,'trafle')?{status:'valid',hasContent:false}:{status:tab.url.includes('nid.naver.com')?'expired':'unknown',reason:'로그인을 완료해 주세요.'}}];
  return [{frameId:0,result:{ok:true}}];
 }}};
 const context=vm.createContext({chrome,URL,Date,Number,String,Boolean,Error,JSON,Map,Set,Promise,structuredClone,AbortSignal,crypto:require('node:crypto').webcrypto,editorCommand(){},importScripts(){},withEditorDeadline:fn=>fn(),setInterval:()=>1,clearInterval(){},setTimeout:fn=>{queueMicrotask(fn);return 1;},clearTimeout(){},fetch:async(url,args)=>{
  const route=new URL(url).pathname,body=JSON.parse(args.body);calls.push({kind:'api',route,body});if(route==='/result')results.push(body);
  return {ok:true,json:async()=>route==='/task/status'?{state:'running'}:{ok:true,task:null}};
 }});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/naver-login.js'),'utf8'),context);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/background.js'),'utf8')+'\nglobalThis.sessionTest={resume,recoverLoginTab,prepareFreshNaver,pump};',context);
 await new Promise(resolve=>setImmediate(resolve));
 data.connection={platform:'naver',blogId:'trafle',token:'test-token'};data.editorTab=1;
 const task={id:'task',platform:'naver',blogId:'trafle',type:'session',tabId:1,stage:'waiting_login',payload:{interactive:true}};data.activeTask=structuredClone(task);
 return {data,tabs,calls,results,task,api:context.sessionTest};
}
test('the reported blog-home waiting session navigates once, verifies the editor and completes without authoring',async()=>{
 const h=await harness();await h.api.resume(h.task);assert.equal(h.tabs.get(1).url,editor);assert.equal(h.results.length,1);assert.equal(h.results[0].result.status,'valid');assert.equal(h.data.session.status,'valid');assert.equal(h.data.activeTask,undefined);assert.equal(h.calls.filter(c=>c.kind==='navigate').length,1);assert(!h.calls.some(c=>c.kind==='script'&&!['inspect'].includes(c.command)));
});
test('login opening a new editor tab reuses that tab and leaves the original landing page intact',async()=>{
 const h=await harness({extra:[{id:2,url:editor}]});await h.api.resume(h.task);assert.equal(h.task.tabId,2);assert.equal(h.data.editorTab,2);assert.equal(h.results[0].result.status,'valid');assert(!h.calls.some(c=>['navigate','create'].includes(c.kind)));
});
test('closing the login tab can recover an existing target editor without creating duplicate tabs',async()=>{
 const h=await harness({closed:true,extra:[{id:2,url:editor}]});await h.api.resume(h.task);assert.equal(h.results[0].result.status,'valid');assert.equal(h.task.tabId,2);assert(!h.calls.some(c=>c.kind==='create'));
});
test('an old login tab can hand off to a verified new editor without closing or navigating the login page',async()=>{
 const h=await harness({url:'https://nid.naver.com/nidlogin.login',extra:[{id:2,url:editor}]});await h.api.resume(h.task);assert.equal(h.task.tabId,2);assert.equal(h.results[0].result.status,'valid');assert.equal(h.tabs.get(1).url,'https://nid.naver.com/nidlogin.login');assert(!h.calls.some(c=>['navigate','create'].includes(c.kind)));
});
test('another editor tab cannot bypass an authentication challenge or account mismatch',async()=>{
 for(const status of ['security_check','account_mismatch']){
  const h=await harness({url:'https://nid.naver.com/nidlogin.login',extra:[{id:2,url:editor}],inspect:tab=>({status:tab.id===1?status:'valid',reason:'사용자 확인 필요'})});await h.api.resume(h.task);assert.equal(h.task.tabId,1);assert.equal(h.results.length,0);assert.equal(h.data.session.status,status);assert(!h.calls.some(c=>['navigate','create'].includes(c.kind)));
 }
 const h=await harness({url:'https://nid.naver.com/nidlogin.login',extra:[{id:2,url:editor}],inspect:tab=>({status:tab.id===1?'expired':'account_mismatch',reason:'다른 계정'})});await h.api.resume(h.task);assert.equal(h.task.tabId,1);assert.equal(h.results.length,0);
});
for(const status of ['expired','security_check','account_mismatch'])test(`a ${status} result cannot become a valid login or trigger writing`,async()=>{
 const h=await harness({url:status==='account_mismatch'?editor:'https://nid.naver.com/nidlogin.login',inspect:()=>({status,reason:'사용자 확인 필요'})});await h.api.resume(h.task);assert.equal(h.results.length,0);assert.equal(h.data.activeTask.stage,'waiting_login');assert.equal(h.data.session.status,status);assert(!h.calls.some(c=>['navigate','create'].includes(c.kind)));assert(h.calls.some(c=>c.route==='/waiting'&&c.body.status===status));
});
test('fresh preflight after login stores the verified popup status and preserves an existing draft',async()=>{
 for(const hasContent of [false,true]){
  const h=await harness({extra:[{id:2,url:editor}],inspect:()=>({status:'valid',hasContent})});h.task.payload.preflightTitle=true;h.task.editorResetStarted=true;
  await h.api.resume(h.task);assert.equal(h.calls.filter(c=>c.kind==='navigate').length,0);
  if(hasContent){assert.match(h.results[0].error,/이전 내용/);assert(!h.calls.some(c=>c.kind==='script'&&c.command==='preflightTitle'));}
  else{assert.equal(h.results[0].result.status,'valid');assert.equal(h.data.session.status,'valid');assert(h.calls.some(c=>c.kind==='script'&&c.command==='preflightTitle'));}
 }
});
test('starting fresh authoring creates a separate tab and never navigates an existing unfinished editor',async()=>{
 const h=await harness({url:editor,inspect:tab=>({status:'valid',hasContent:tab.id===1})});h.task.payload.preflightTitle=true;await h.api.resume(h.task);assert.equal(h.results[0].result.status,'valid');assert.equal(h.task.tabId,10);assert.equal(h.tabs.get(1).url,editor);assert.equal(h.calls.filter(c=>c.kind==='create').length,1);assert(!h.calls.some(c=>c.kind==='navigate'&&c.id===1));
});
test('repeated login redirects stop after three returns with a visible reason and no publication',async()=>{
 const h=await harness();h.task.loginReturnAttempts=3;await h.api.resume(h.task);assert.equal(h.results[0].code,'NAVER_LOGIN_REDIRECT');assert.equal(h.data.session.status,'unknown');assert.match(h.data.session.reason,/글쓰기 권한/);assert.equal(h.data.activeTask,undefined);assert(!h.calls.some(c=>['navigate','create','script'].includes(c.kind)));
});
