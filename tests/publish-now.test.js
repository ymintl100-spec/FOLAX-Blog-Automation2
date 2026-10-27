const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const script=fs.readFileSync(require.resolve('../extension/editor.js'),'utf8');
async function settings({missing=false,unresponsive=false}={}){
 const clicks=[];const visibilityRadio={checked:false},nowRadio={checked:false},reservedRadio={checked:true};
 const element=(text,radio,click)=>({textContent:text,htmlFor:'',getClientRects:()=>[{}],getAttribute:()=>null,querySelector:()=>radio,click(){clicks.push(text);click?.();},closest(){return this;}});
 const title=element('fixture title'),publicLabel=element('전체공개',visibilityRadio,()=>{visibilityRadio.checked=true;}),nowLabel=element('현재',nowRadio,()=>{if(!unresponsive){nowRadio.checked=true;reservedRadio.checked=false;}});
 const document={body:{innerText:''},querySelectorAll(selector){if(selector.startsWith('.se-title-text'))return [title];if(selector==='button,label,[role="button"],a')return missing?[publicLabel]:[publicLabel,nowLabel];return [];},getElementById:()=>null};
 const context=vm.createContext({document,getComputedStyle:()=>({visibility:'visible'}),setTimeout:fn=>{fn();return 0;}});
 const result=await vm.runInContext(script+'\neditorCommand("settings",{publishVisibility:"public",publishScheduleMode:"now",tags:[]})',context);
 return {result,clicks,nowRadio,reservedRadio};
}
test('Naver immediately selects and verifies current time instead of reusing a reserved radio',async()=>{
 const r=await settings();assert.equal(r.result.ok,true);assert.equal(r.nowRadio.checked,true);assert.equal(r.reservedRadio.checked,false);assert.deepEqual(r.clicks,['전체공개','현재']);
});
test('missing or ineffective current-time control stops before publication',async()=>{
 for(const options of [{missing:true},{unresponsive:true}]){const r=await settings(options);assert.equal(r.result.ok,false);assert.match(r.result.error,/예약 상태로 발행하지 않았습니다/);assert.equal(r.reservedRadio.checked,true);}
});
