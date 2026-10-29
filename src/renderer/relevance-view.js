/* Internal diagnostics are independent from NDEX results. */
window.blogRelevanceView={render(host,report){
  if(!host)return;
  host.replaceChildren();host.hidden=!report;if(!report)return;
  const add=(tag,text,parent=host)=>{const el=document.createElement(tag);el.textContent=text;parent.append(el);return el;};
  add('h3','연관성 점검 · '+(report.score==null?'의미 검수 전':report.score+'/100')+' · 내부 목표 95 이상');
  add('p','핵심어: '+(report.primaryKeyword||'미선정')+' · 본문 '+report.mentions+'회 · 제목 '+report.titleCharacters+'자');
  add('p','NDEX 점수: 미측정 · 이 점수는 앱의 공개된 내부 점검 기준입니다. 포스팅 지수·검색 순위를 뜻하지 않습니다.').className='hint';
  const table=add('table','');table.className='ops-table';
  const head=add('tr','',table);for(const value of ['점검 항목','점수','계산·검수 근거'])add('th',value,head);
  for(const c of report.components||[]){const row=add('tr','',table);add('td',c.label,row);add('td',c.max===0?'해당 없음':c.points==null?'미측정':c.points+'/'+c.max,row);add('td',c.detail,row);}
  add('p','측정한 배점 '+report.assessed+'/'+report.max+' · 모든 적용 항목을 측정한 뒤 100점 기준으로 환산합니다. 이미지 항목은 생성 계획·설명만 대조합니다.').className='hint';
  if(report.concepts?.length){const details=add('details','');add('summary','관련 개념의 실제 설명 근거',details);for(const c of report.concepts)add('p',(c.matched?'확인 · ':'보완 · ')+c.term+(c.quote?' — '+c.quote:''),details);}
  for(const tip of report.suggestions||[])add('p',tip);
}};
