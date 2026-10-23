#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const args=process.argv.slice(2),model=args[args.indexOf('--model')+1];
const index=args.indexOf('--output-last-message');
let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{
 fs.writeFileSync(path.join(process.cwd(),'invocation.json'),JSON.stringify({args,input}));
 if(index<0){console.error('Missing output-last-message');process.exitCode=1;return}
 const target=args[index+1];
 const good={status:'success',titleImagePath:'generated-title.png',titleImageVerified:true,bodyImages:[],notes:[]};
 const failed={status:'failed',titleImagePath:'',bodyImages:[],failureReason:'이미지 생성 도구를 사용할 수 없습니다.',notes:[]};
 if(model==='fixture-fallback'&&args.some(a=>a==='model_reasoning_effort=xhigh')){
  fs.writeFileSync(target,JSON.stringify({...good,titleImagePath:'stale-first-attempt.png'}));
  console.error('unsupported reasoning_effort xhigh');process.exitCode=1;return;
 }
 if(model==='fixture-event'){
  console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(good)}}));return;
 }
 if(model==='fixture-legacy'){
  fs.writeFileSync(path.join(process.cwd(),'image-worker-result.json'),JSON.stringify(good));
  fs.writeFileSync(target,'BLOGAUTO_RESULT_READY');return;
 }
 if(model==='fixture-plain'){
  fs.writeFileSync(target,'이미지 생성 도구를 사용할 수 없습니다. access_token=abc123 Bearer secret-value');return;
 }
 if(model==='fixture-empty')return;
 const result=model==='fixture-failed'?failed:model==='fixture-style'?{status:'success',imageStylePrompt:'soft natural lighting',notes:[]}:good;
 fs.writeFileSync(target,model==='fixture-fenced'?'```json\n'+JSON.stringify(result)+'\n```':JSON.stringify(result));
 console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:5,output_tokens:3}}));
});
