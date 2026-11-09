(()=>{
  const $=s=>document.querySelector(s),layer=$('#codexSetupLayer');
  let pending=false,state=null,previousFocus=null;
  function controls(){
    $('#installCodexButton').disabled=pending||state?.busy||state?.installation?.installed||state?.supported===false;
    $('#loginCodexButton').disabled=pending||state?.busy||!state?.installation?.installed||state?.supported===false;
    $('#checkCodexSetup').disabled=pending;
  }
  function render(value){
    state=value;
    $('#codexSetupInstallation').textContent=value.installation?.installed?'설치: 완료':'설치: 필요';
    $('#codexSetupLogin').textContent='로그인: '+({authenticated:'완료 · 글 작업을 시작할 수 있습니다.',not_authenticated:'필요 · ChatGPT 로그인 버튼을 눌러주세요.',not_installed:'설치 후 진행',unknown:'확인하지 못했습니다. 로그인 후 다시 확인하세요.'}[value.login]||'확인 중');
    if(typeof renderCodexInstallation==='function')renderCodexInstallation(value.installation);
    $('#codexSetupMessage').textContent=value.supported===false?'자동 설치·로그인은 Windows에서 사용할 수 있습니다.':value.login==='authenticated'?'Codex 설치와 로그인이 완료됐습니다. 닫고 글 작업을 시작하세요.':value.message||'';
    controls();
  }
  async function action(kind){
    if(pending)return;pending=true;controls();
    try{
      $('#codexSetupMessage').textContent={status:'설치·로그인 상태 확인 중…',install:'설치 준비 중…',login:'로그인 창을 여는 중…'}[kind];
      const result=await window.blogAuto[{status:'getCodexSetup',install:'installCodex',login:'loginCodex'}[kind]]();
      if(kind==='login')$('#codexSetupMessage').textContent=result.message;
      else render(result);
      if(kind==='install'&&result.installation?.installed&&typeof refreshCodexCatalog==='function')void refreshCodexCatalog();
    }catch(error){$('#codexSetupMessage').textContent=String(error.message||error);}
    finally{pending=false;controls();}
  }
  $('#openCodexSetup').addEventListener('click',()=>{previousFocus=document.activeElement;layer.hidden=false;$('#closeCodexSetup').focus();void action('status');});
  function close(){layer.hidden=true;previousFocus?.focus();}
  $('#closeCodexSetup').addEventListener('click',close);
  layer.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();close();}
    if(event.key==='Tab'){
      const buttons=[...layer.querySelectorAll('button')].filter(b=>!b.disabled),first=buttons[0],last=buttons.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
  });
  $('#installCodexButton').addEventListener('click',()=>void action('install'));
  $('#loginCodexButton').addEventListener('click',()=>void action('login'));
  $('#checkCodexSetup').addEventListener('click',()=>void action('status'));
  window.blogAuto.onCodexSetupProgress(value=>{
    state={...state,busy:value.busy};$('#codexSetupMessage').textContent=value.message;controls();
  });
  window.addEventListener('focus',()=>{if(!layer.hidden&&!pending&&!state?.busy)void action('status');});
})();
