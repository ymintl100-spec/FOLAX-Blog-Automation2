"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {detectCodexInstallation,managedCodexInvocation}=require('./codexPlatform');
const NODE_INDEX='https://nodejs.org/dist/index.json';
const CODEX_METADATA='https://registry.npmjs.org/@openai%2Fcodex/latest';
function ps(env){return path.join(env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');}
function commandPlan(command,args,options={}){
  const env={...(options.env||process.env)},platform=options.platform||process.platform;
  if(platform!=='win32'||! /\.(cmd|bat)$/i.test(command))return {file:command,args,env};
  const managed=managedCodexInvocation(command,args,{platform,env});if(managed)return managed;
  if(!['--version','login status'].includes(args.join(' ')))throw Error('지원하지 않는 Codex 명령입니다.');
  return {file:ps(env),args:['-NoLogo','-NoProfile','-NonInteractive','-Command',`& $env:FOLAX_CODEX_COMMAND ${args.join(' ')}; exit $LASTEXITCODE`],env:{...env,FOLAX_CODEX_COMMAND:command}};
}
function run(file,args,{env=process.env,cwd,timeout=30000}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(file,args,{env,cwd,windowsHide:true,shell:false});let stdout='',stderr='',settled=false;
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(result);};
    const timer=setTimeout(()=>{child.kill();finish(Error('명령 실행 시간이 초과됐습니다. 인터넷 연결을 확인하고 다시 시도하세요.'));},timeout);
    child.stdout.on('data',b=>{stdout=(stdout+b).slice(-16000);});child.stderr.on('data',b=>{stderr=(stderr+b).slice(-16000);});
    child.once('error',()=>finish(Error('설치 도구를 실행하지 못했습니다. Windows 보안 설정과 설치 경로를 확인하세요.')));
    child.once('close',code=>finish(null,{code,stdout,stderr}));
  });
}
async function download(fetcher,url,target,expected,progress){
  const response=await fetcher(url,{signal:AbortSignal.timeout(15*60*1000)});
  if(!response.ok)throw Error('Node.js 다운로드 실패 (HTTP '+response.status+')');
  const hash=crypto.createHash('sha256'),fd=fs.openSync(target,'wx');let bytes=0,last=0;
  try{
    for await(const chunk of response.body){
      const data=Buffer.from(chunk);bytes+=data.length;if(bytes>120*1024*1024)throw Error('설치 파일의 크기를 확인할 수 없습니다.');
      hash.update(data);fs.writeFileSync(fd,data);
      if(bytes-last>=5*1024*1024){last=bytes;progress('Node.js 다운로드 · '+Math.round(bytes/1024/1024)+'MB');}
    }
  }finally{fs.closeSync(fd);}
  if(hash.digest('hex')!==expected)throw Error('Node.js 설치 파일 검증에 실패했습니다. 파일을 실행하지 않았습니다. 다시 설치를 눌러주세요.');
}
class CodexSetup{
  constructor(root,hooks={},deps={}){
    this.root=root;this.hooks=hooks;this.platform=deps.platform||process.platform;this.arch=deps.arch||process.arch;
    this.env=deps.env||process.env;this.fetch=deps.fetch||fetch;this.run=deps.run||run;
    this.detect=deps.detect||detectCodexInstallation;this.extract=deps.extract||this.unpack.bind(this);this.launch=deps.launch||this.openLogin.bind(this);
    this.installing=false;this.phase='';this.loginChild=null;this.loginPending=null;
  }
  installation(){return this.detect(this.hooks.settings?.().codexCmdPath);}
  progress(message){this.phase=message;this.hooks.progress?.({busy:this.installing,message});}
  async status(){
    const installation=this.installation();
    const result={supported:this.platform==='win32',busy:this.installing,message:this.phase,installation,login:'not_installed',loginWindowOpen:Boolean(this.loginChild)};
    if(!installation.installed||this.installing)return result;
    try{
      const plan=commandPlan(installation.path,['login','status'],{platform:this.platform,env:this.env});
      const status=await this.run(plan.file,plan.args,{env:plan.env,cwd:this.root});
      // Never send CLI output (including API key identifiers) to the renderer.
      result.login=status.code===0?'authenticated':/not logged in|not authenticated/i.test(status.stdout+' '+status.stderr)?'not_authenticated':'unknown';
    }catch{result.login='unknown';}
    return result;
  }
  async json(url){
    const r=await this.fetch(url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('설치 정보 조회 실패 (HTTP '+r.status+')');
    const text=await r.text();if(Buffer.byteLength(text)>5*1024*1024)throw Error('설치 정보 크기가 올바르지 않습니다.');return JSON.parse(text);
  }
  async unpack(archive,destination){
    const env={...this.env,FOLAX_NODE_ARCHIVE:archive,FOLAX_NODE_DESTINATION:destination};
    const result=await this.run(ps(env),['-NoLogo','-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath $env:FOLAX_NODE_ARCHIVE -DestinationPath $env:FOLAX_NODE_DESTINATION -Force"],{env,cwd:this.root,timeout:180000});
    if(result.code!==0)throw Error('설치 파일 압축 해제에 실패했습니다. 폴더 쓰기 권한을 확인하세요.');
  }
  async install(){
    if(this.platform!=='win32'||!['x64','arm64'].includes(this.arch))throw Error('자동 설치는 Windows 64비트에서 사용할 수 있습니다.');
    if(this.installing)return {busy:true,message:this.phase};
    if(this.hooks.isBusy?.())throw Error('진행 중인 글 작업이 끝난 뒤 Codex를 설치하세요.');
    const existing=this.installation();if(existing.installed)return this.status();
    this.installing=true;let stage;
    try{
      this.progress('설치 정보 확인 중 · 관리자 권한이나 별도 Node.js 설치가 필요 없습니다.');
      const [releases,pkg]=await Promise.all([this.json(NODE_INDEX),this.json(CODEX_METADATA)]);
      const release=Array.isArray(releases)&&releases.find(r=>/^v24\.\d+\.\d+$/.test(r.version)&&r.lts&&r.files?.includes('win-'+this.arch+'-zip'));
      if(!release||pkg.name!=='@openai/codex'||!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(pkg.version))throw Error('공식 설치 정보를 확인하지 못했습니다. 잠시 후 다시 시도하세요.');
      const name='node-'+release.version+'-win-'+this.arch,base='https://nodejs.org/dist/'+release.version+'/';
      const response=await this.fetch(base+'SHASUMS256.txt',{signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw Error('Node.js 검증 정보를 가져오지 못했습니다.');
      const sums=await response.text();const expected=sums.split(/\r?\n/).map(s=>s.trim().split(/\s+/)).find(row=>row[1]===name+'.zip')?.[0];
      if(!/^[a-f0-9]{64}$/.test(expected||''))throw Error('Node.js 파일 검증 정보가 올바르지 않습니다.');
      stage=path.join(this.root,'codex-installations',crypto.randomUUID());fs.mkdirSync(stage,{recursive:true});
      const archive=path.join(stage,'node.zip');this.progress('Node.js 다운로드 시작');
      await download(this.fetch,base+name+'.zip',archive,expected,m=>this.progress(m));
      this.progress('다운로드 검증 완료 · 설치 파일 준비 중');await this.extract(archive,stage);
      const directory=path.join(stage,name),node=path.join(directory,'node.exe'),npm=path.join(directory,'node_modules','npm','bin','npm-cli.js');
      if(!fs.existsSync(node)||!fs.existsSync(npm))throw Error('Node.js 실행 파일을 찾지 못했습니다.');
      fs.unlinkSync(archive);this.progress('Codex 설치 중 · 인터넷 속도에 따라 몇 분 걸릴 수 있습니다.');
      // Separate npm's own modules from the installation prefix: npm may prune
      // extraneous modules in its prefix while installing a package.
      const cliDirectory=path.join(directory,'cli');fs.mkdirSync(cliDirectory);
      try{fs.linkSync(node,path.join(cliDirectory,'node.exe'));}catch{fs.copyFileSync(node,path.join(cliDirectory,'node.exe'));}
      const env={...this.env,PATH:path.dirname(node)+path.delimiter+(this.env.PATH||this.env.Path||'')};
      const result=await this.run(node,[npm,'install','--prefix',cliDirectory,'--registry=https://registry.npmjs.org/','--no-audit','--no-fund','@openai/codex@'+pkg.version],{env,cwd:directory,timeout:15*60*1000});
      if(result.code!==0)throw Error('Codex 설치 실패 (종료 코드 '+result.code+'). 인터넷 연결과 폴더 쓰기 권한을 확인하고 다시 시도하세요.');
      const command=path.join(cliDirectory,'codex.cmd'),cli=path.join(cliDirectory,'node_modules','@openai','codex','bin','codex.js');
      const installed=JSON.parse(fs.readFileSync(path.join(cliDirectory,'node_modules','@openai','codex','package.json'),'utf8'));
      if(installed.version!==pkg.version||!fs.existsSync(command)||!fs.existsSync(cli))throw Error('Codex 설치 파일 확인에 실패했습니다.');
      const version=await this.run(node,[cli,'--version'],{env,cwd:directory});
      if(version.code!==0)throw Error('설치한 Codex를 실행하지 못했습니다. Windows 보안 설정을 확인하세요.');
      // Keep all previous installations and credentials intact. Select the new
      // command only after the real CLI has executed successfully.
      this.hooks.select?.(command);stage=null;
      this.progress('Codex 설치 완료 · 이제 ChatGPT 로그인을 눌러주세요.');
    }catch(error){if(stage)try{fs.rmSync(stage,{recursive:true,force:true});}catch{}this.progress('설치 실패 · '+error.message);throw error;}
    finally{this.installing=false;this.hooks.progress?.({busy:false,message:this.phase});}
    return this.status();
  }
  async openLogin(command){
    const env={...this.env,FOLAX_CODEX_COMMAND:command};
    return new Promise((resolve,reject)=>{
      const child=spawn(ps(env),['-NoLogo','-NoProfile','-NoExit','-Command',"& $env:FOLAX_CODEX_COMMAND login; Write-Host ''; Write-Host 'Return to FOLAX and click Check status.'"],{env,cwd:this.root,detached:true,windowsHide:false,stdio:'ignore',shell:false});
      child.once('error',()=>reject(Error('로그인 창을 열지 못했습니다. Windows 보안 설정을 확인하세요.')));
      child.once('spawn',()=>{child.unref();resolve(child);});
    });
  }
  async login(){
    if(this.platform!=='win32')throw Error('이 로그인 버튼은 Windows에서 사용할 수 있습니다.');
    if(this.installing)throw Error('설치가 끝난 뒤 로그인하세요.');
    if(this.hooks.isBusy?.())throw Error('진행 중인 글 작업이 끝난 뒤 로그인하세요.');
    const installation=this.installation();if(!installation.installed)throw Error('먼저 Codex 설치 버튼을 눌러주세요.');
    if(!this.loginChild){
      if(!this.loginPending)this.loginPending=this.launch(installation.path).then(child=>{this.loginChild=child;child.once?.('close',()=>{this.loginChild=null;});return child;}).finally(()=>{this.loginPending=null;});
      await this.loginPending;
    }
    this.progress('로그인 창을 열었습니다. 브라우저에서 ChatGPT 계정으로 로그인한 뒤 상태 확인을 눌러주세요.');
    return {started:true,message:this.phase};
  }
}
module.exports={CodexSetup,commandPlan,download};
