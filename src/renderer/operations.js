/* Content operations stays separate from the existing account and generation UI. */
(() => {
  const $ = (s) => document.querySelector(s),
    api = window.blogAuto,
    esc = (s) =>
      String(s ?? "").replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      );
  const fmt = (n) =>
      n == null
        ? "미측정"
        : Number(n).toLocaleString("ko-KR", { maximumFractionDigits: 1 }),
    status = (s) =>
      ({
        candidate: "후보",
        selected: "선택",
        draft: "초안",
        user_review: "사용자 검수",
        revision: "수정·재검수",
        approved: "최종 승인",
        publish_prepared: "발행 준비",
        published: "발행 기록 있음",
        archived: "보관",
        excluded: "제외",
      })[s] || s;
  let tab = "overview",
    snapshot = null,
    doc = null,
    topic = null,
    filters = { excludeDuplicate: true },
    pendingImport = null,
    busy = 0,
    lastTyping = 0,
    editingSeconds = 0,
    sequence = 0;
  const account = () => $("#opsAccount").value;
  const button = (action, label, id = "", cls = "ghost small") =>
    `<button type="button" class="${cls}" data-action="${action}" data-id="${esc(id)}">${esc(label)}</button>`;
  const options = (values, selected = "", blank = "전체") =>
    (blank !== null ? `<option value="">${blank}</option>` : "") +
    values
      .map(
        (v) =>
          `<option value="${esc(v)}" ${v === selected ? "selected" : ""}>${esc(v)}</option>`,
      )
      .join("");
  const date = () =>
    new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const sourceLink = (url) =>
    url
      ? `<button class="ops-source" type="button" data-source="${esc(url)}">${esc(url)}</button>`
      : "";
  const notes = (value) =>
    `<pre class="ops-notes">${esc(typeof value === "string" ? value : JSON.stringify(value, null, 2))}</pre>`;
  function message(text, error = false) {
    $("#opsStatus").textContent = text;
    $("#opsStatus").classList.toggle("ops-error", error);
    const progress=$('#opsPublishProgress');
    if(progress){progress.textContent=text;progress.classList.toggle('ops-error',error);}
  }
  async function run(fn) {
    busy++;
    document
      .querySelectorAll("#operationsPanel button")
      .forEach((b) => (b.disabled = true));
    try {
      message("작업 중…");
      const result = await fn();
      if ($("#opsStatus").textContent === "작업 중…") message("완료");
      return result;
    } catch (e) {
      message(e.message, true);
      return undefined;
    } finally {
      busy--;
      if (!busy)
        document
          .querySelectorAll("#operationsPanel button")
          .forEach((b) => (b.disabled = false));
    }
  }
  const action = (action, payload = {}) =>
    api.operationsAction({ accountId: account(), action, payload });
  async function refresh() {
    if (!account()) return renderEmpty();
    const request = ++sequence,
      selected = account();
    const data = await api.getOperations({ accountId: selected, filters });
    if (request !== sequence || selected !== account()) return;
    snapshot = data;
    render();
  }
  function renderEmpty() {
    $("#opsContent").innerHTML =
      '<p class="ops-empty">먼저 ‘계정 · 기존 작업’에서 Blog ID와 계정을 등록하세요. 기존 계정·카테고리는 자동 변경하지 않습니다.</p>';
  }
  function metric(title, value, extra = "") {
    return `<div class="ops-metric"><span>${esc(title)}</span><strong>${esc(value)}</strong><small>${esc(extra)}</small></div>`;
  }
  function publicationNotice() {
    return `<div class="ops-notice"><b>${snapshot.publicationMode === "approval" ? "사용자 최종 승인 모드" : "이전 자동 발행 설정 유지 중"}</b><p>${snapshot.publicationMode === "approval" ? "AI 검수 후 사용자 검수에서 멈춥니다. 승인과 발행 실행은 별도 작업입니다." : "기존 발행 설정은 변경하지 않았습니다. 추천 화면에서 시작한 새 원고는 항상 사용자 승인 대기로 저장합니다."}</p><label>기존 작업 전체에 적용할 발행 정책<select id="opsPublicationMode"><option value="approval" ${snapshot.publicationMode === "approval" ? "selected" : ""}>사용자 최종 승인 후 발행</option><option value="legacy_auto" ${snapshot.publicationMode === "legacy_auto" ? "selected" : ""}>이전 자동 발행 방식 유지</option></select></label>${button("publicationMode", "선택한 정책 저장")}</div>`;
  }
  function overview() {
    const a = snapshot.analytics,
      docs = snapshot.documents,
      measured = a.platforms[0]?.metrics.visitors.last7;
    const top = snapshot.topics.top10;
    $("#opsContent").innerHTML =
      `${publicationNotice()}<div class="ops-metrics">${metric("검수·수정 대기", docs.filter((d) => ["user_review", "revision", "draft"].includes(d.status)).length)}${metric("최종 승인", docs.filter((d) => d.approved_version === d.current_version).length)}${metric("최근 7일 평균 방문자", fmt(measured?.average), measured ? `${a.platforms[0].platform} · 측정 ${measured.measuredDays}/7일` : "관리자 통계 업로드 필요")}${metric("계획 후보", snapshot.topics.total, "검색 수요 검증 여부 별도")}</div>
  <div class="ops-heading"><div><h2>오늘의 추천 검색 주제 TOP 10</h2><p class="hint">${esc(snapshot.topics.scoreNote)}</p></div>${button("refreshCache", "수집 자료로 추천 갱신")}</div>
  <div class="ops-filters"><label>카테고리<select id="opsCategory">${options(snapshot.categories, filters.category)}</select></label><label>검색 추세<select id="opsTrend">${options(["상승", "유지", "하락", "계절형", "미확인"], filters.trend)}</select></label><label>후보 유형<select id="opsType"><option value="">전체</option><option value="question" ${filters.type === "question" ? "selected" : ""}>질문형</option><option value="seasonal" ${filters.type === "seasonal" ? "selected" : ""}>계절형</option><option value="evergreen" ${filters.type === "evergreen" ? "selected" : ""}>장기 정보형 제안</option></select></label><label>최소 월 검색량<input id="opsVolume" type="number" min="0" value="${esc(filters.minVolume || "")}" /></label><label>정렬<select id="opsSort"><option value="score">확인 점수순</option><option value="volume" ${filters.sort === "volume" ? "selected" : ""}>검색량순</option><option value="new" ${filters.sort === "new" ? "selected" : ""}>신규 후보순</option></select></label><label class="compact-check"><input id="opsNoDuplicate" type="checkbox" ${filters.excludeDuplicate ? "checked" : ""}/>유사·기존 글 제외</label>${button("filter", "적용")}</div>
  ${!top.length ? '<p class="ops-empty">조건에 맞는 검색량 확인 자료가 없습니다. 검색 데이터를 가져오거나 공식 API로 조회하세요. 미검증 질문을 인기 주제로 표시하지 않습니다.</p>' : topicTable(top, true)}
  <p class="hint">월 검색량은 핵심 키워드의 PC·모바일 통합 수치입니다. 질문 제안 문장 자체의 검색량과 구분합니다. ${esc(snapshot.topics.coverage.note)}</p>
  <details><summary>전체 후보 ${snapshot.topics.candidates.length}개 · 미검증 질문 포함</summary>${topicTable(snapshot.topics.candidates.slice(0, 100), false)}</details>
  <details><summary>보관·제외한 주제 ${snapshot.savedTopics.length}개</summary>${snapshot.savedTopics.map((t) => `<p>${esc(t.title)} · ${esc(status(t.status))} ${button("restoreTopic", "후보로 복원", t.id)}</p>`).join("") || "<p>없음</p>"}</details>
  <details><summary>계정 운영 카테고리</summary><p>기존 카테고리·설정은 유지하고 누락된 운영 카테고리만 선택 해제 상태로 추가합니다.</p>${button("installCategories", "누락된 운영 카테고리 추가")}</details><details><summary>주제 직접 등록</summary><div class="ops-grid"><label>제목·핵심 질문<input id="opsNewTitle" maxlength="160" /></label><label>핵심 키워드<input id="opsNewKeyword" maxlength="100"/></label><label>카테고리<select id="opsNewCategory">${options(snapshot.categories, snapshot.categories[0], null)}</select></label>${button("addTopic", "미검증 후보로 등록")}</div></details><div id="opsTopicDetail"></div>`;
  }
  function topicTable(rows, rank) {
    return `<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>${rank ? "순위" : "구분"}</th><th>주제 · 핵심 키워드</th><th>핵심 키워드 월 검색량</th><th>추세</th><th>경쟁 환경</th><th>내부 점수</th><th>카테고리 · 중복</th><th>기준일 · 상태</th><th>작업</th></tr></thead><tbody>${rows.map((t) => `<tr><td>${rank ? t.rank : t.demand ? "검색량 확인" : "질문 제안"}</td><td><b>${esc(t.title)}</b><small>${esc(t.keyword)}${t.origin !== "measured_keyword" ? " · 질문 문장 검색량 미확인" : ""}</small></td><td>${esc(t.demand ? volume(t.demand) : "미확인")}</td><td>${esc(t.trend.label)}</td><td>${t.competition.length ? esc(t.competition.length + "건 · 근거 확인 필요") : "미확인"}</td><td>${t.score == null ? "미평가" : t.score + "/100"}<small>평가 배점 ${t.assessedMax}/100 · 신뢰 ${esc(t.confidence)}</small></td><td>${esc(t.category)}<small>${esc({ new: "신규(확인 범위 내)", similar: "유사", existing: "기존" }[t.duplicate.status])}</small></td><td>${esc(t.dataDate || "미확인")}<small>${esc(status(t.status))}</small></td><td>${button("detail", "상세 분석", t.id)}${button("generateOptions", "원고 작성", t.id)}${button("archive", "보관", t.id)}${button("exclude", "제외", t.id)}</td></tr>`).join("")}</tbody></table></div>`;
  }
  function volume(d) {
    if (d.monthlySearches != null) return fmt(d.monthlySearches);
    const pc = d.pc,
      m = d.mobile;
    if (pc?.upperBound && m?.upperBound)
      return "<" + fmt(pc.upperBound + m.upperBound) + " (구간)";
    return "통합 미확인";
  }
  function detail(id, generate = false) {
    topic = snapshot.topics.candidates.find((t) => t.id === id);
    if (!topic) return;
    const t = topic,
      d = t.demand;
    $("#opsTopicDetail").innerHTML =
      `<section class="ops-detail"><h2>${esc(t.title)}</h2><p>${esc(t.reasons.join(" / "))}</p><p>핵심 키워드: ${esc(t.keyword)} · 질문 자체 수요 ${t.questionVerified ? "키워드와 동일" : "미확인"}</p>
  ${d ? `<p>PC ${esc(d.pc.raw || "미확인")} / 모바일 ${esc(d.mobile.raw || "미확인")} / 통합 ${esc(volume(d))} · 광고 경쟁도 ${esc(d.adCompetition || "미확인")} (블로그 경쟁도와 다름)</p><p class="hint">수집 ${esc(d.observedDate)} · ${esc(d._source.sourceType)} ${sourceLink(d._source.sourceUrl)}</p>` : "<p>검색량 미확인 · 자동 생성된 숫자를 사용하지 않습니다.</p>"}
  <details><summary>점수별 판단 근거</summary>${notes(t.parts)}</details><h3>검색 관심도 · 상대지수</h3><div class="ops-metrics">${[1, 3, 6, 12].map((n) => metric(n + "개월", fmt(t.trend.periods[n]?.mean), (t.trend.periods[n]?.points || 0) + "개 관측점 · " + (t.trend.periods[n]?.label || "미확인"))).join("")}</div><p class="hint">${esc(t.trend.definition || "자료 미확인. 서로 다른 조회 묶음의 상대지수를 합치지 않습니다.")}</p>
  <h3>경쟁 콘텐츠</h3>${button("collectCompetition", "선택 키워드 검색 결과 수집", id)}<p class="hint">최대 검색 2회·문서 5개, 24시간 캐시. 순위나 사진·원문 깊이는 자동 추정하지 않습니다.</p>${t.competition.map((c) => `<article class="ops-competitor"><b>${esc(c.title)}</b>${sourceLink(c.url)}<p>${esc(c.excerpt || "본문 미확인")}</p><small>${esc(c.contentType)} · 게시일 ${esc(c.publishedDate || "미확인")} · 수집 ${esc(c.observedDate)} · 사진 ${esc(c.hasPhotos)}</small></article>`).join("") || "<p>분석 자료가 없습니다.</p>"}
  <details><summary>확인한 경쟁 분석·편집 점수 기록</summary><div class="ops-grid"><label>콘텐츠 제목<input id="opsCompTitle"/></label><label>실제 URL<input id="opsCompUrl" type="url"/></label><label class="ops-wide">확인한 원문 발췌<textarea id="opsCompExcerpt" maxlength="6000"></textarea></label><label>부족한 정보<textarea id="opsCompGap"></textarea></label><label>판단 근거<textarea id="opsCompReason"></textarea></label><label>콘텐츠 기회 0~20<input id="opsCompOpportunity" type="number" min="0" max="20"/></label><label>검색 의도 0~15<input id="opsCompIntent" type="number" min="0" max="15"/></label><label>독창적 설명 0~15<input id="opsCompOriginality" type="number" min="0" max="15"/></label></div>${button("saveCompetition", "근거와 점수 저장", id)}</details>
  <p>중복 점검: ${esc(t.duplicate.status)} ${esc(t.duplicate.title || "")} · ${esc(snapshot.topics.coverage.note)}</p>
  ${snapshot.documents
    .filter((d) => d.topic_id === id)
    .map(
      (d) =>
        `<p>연결 원고: ${esc(d.title)} · ${esc(status(d.status))} ${button("reviewTopicDocument", "검수 요청", d.id)}${button("openDocument", "발행 준비 · 원고 열기", d.id)}</p>`,
    )
    .join(
      "",
    )}<div class="ops-notice"><h3>선택한 주제만 작성</h3><label>원고 플랫폼<select id="opsGeneratePlatform"><option value="naver">네이버</option><option value="tistory">티스토리(등록 계정)</option></select></label><label class="compact-check"><input id="opsGenerateImages" type="checkbox"/>설명에 필요한 이미지도 생성(추가 사용량)</label><label>이번 글의 실제 경험 메모<textarea id="opsExperience" maxlength="2000" placeholder="직접 겪은 사실만 입력. 없으면 1인칭 경험을 만들지 않습니다."></textarea></label>${button("generate", "이 주제로 원고 작성 · 사용자 검수 대기", id, "primary")}</div></section>`;
    $("#opsTopicDetail").scrollIntoView({ behavior: "smooth", block: "start" });
    if (generate) $("#opsExperience").focus();
  }
  function dataPage() {
    const prefs = snapshot.preferences;
    $("#opsContent").innerHTML =
      `<h2>검색 데이터 · 기존 글 · 관리자 통계 가져오기</h2><p>CSV 또는 XLSX 첫 번째 시트를 미리 확인한 뒤 저장합니다. UTF-8·UTF-16·한국어 CSV를 지원합니다. 수식 셀은 값으로 저장해 주세요.</p><div class="ops-grid"><label>자료 종류<select id="opsImportKind"><option value="keywords">검색광고 키워드 검색량</option><option value="trends">데이터랩 상대지수</option><option value="competition">경쟁 콘텐츠·판단 근거</option><option value="content">기존 공개·임시저장·예약·기획 글</option><option value="performance">관리자 방문자·게시글·검색유입 통계</option></select></label><label>플랫폼<select id="opsImportPlatform"><option value="naver">네이버</option><option value="tistory">티스토리</option></select></label><label>자료 기준일<input id="opsImportDate" type="date" value="${date()}"/></label><label>출처 URL (선택)<input id="opsImportSource" type="url"/></label><label class="ops-wide">통계 지표 정의<input id="opsDefinition" placeholder="예: 네이버 관리자 일별 방문자, 게시글 조회수 / 서로 다른 정의는 구분"/></label></div><div class="button-row">${button("importPreview", "CSV / XLSX 파일 선택")}${button("template", "빈 업로드 양식 저장")}</div><p class="hint">빈 칸은 미측정, 0은 실제 0으로 취급합니다. 검색량 ‘&lt;10’은 정확한 수치로 바꾸지 않습니다. 성과 scope: daily/post/query, metricType: daily/cumulative. 일별·누적은 구분합니다.</p><div id="opsImportPreview"></div>
 <h3>공식 API 조회</h3><div class="ops-grid"><label>조회 종류<select id="opsProvider"><option value="searchad">네이버 검색광고 키워드 도구</option><option value="datalab">네이버 데이터랩</option><option value="cache">저장된 데이터만 재사용</option></select></label><label>키워드 1~5개(쉼표 구분)<input id="opsHints" placeholder="깔창, 걷기 운동"/></label>${button("fetchApi", "선택 키워드 조회")}</div><p class="hint">검색광고: 실제 월간 수요·광고 경쟁. 데이터랩: 12개월 상대지수(실제 검색횟수 아님). 두 API는 네이버 데이터이며 Google 검색량을 뜻하지 않습니다. 같은 날·같은 요청은 재사용합니다.</p>
 <details><summary>API 자격 증명 설정 · 키는 이 채팅에 보내지 마세요</summary><p class="hint">운영체제 암호 저장소로 보관하며 다시 화면에 표시하지 않습니다. 암호 저장소가 없으면 파일 업로드를 사용하세요.</p><div class="ops-grid"><label>검색광고 API Key<input id="opsAdKey" type="password" autocomplete="off"/></label><label>검색광고 Secret<input id="opsAdSecret" type="password" autocomplete="off"/></label><label>검색광고 Customer ID<input id="opsCustomer" autocomplete="off"/></label>${button("saveSearchAd", "검색광고 키 저장·교체")}<label>데이터랩 Client ID<input id="opsLabId" type="password" autocomplete="off"/></label><label>데이터랩 Client Secret<input id="opsLabSecret" type="password" autocomplete="off"/></label>${button("saveDataLab", "데이터랩 키 저장·교체")}</div><p>검색광고 ${snapshot.api.searchad?.configured ? "설정됨" : "미설정"} / 데이터랩 ${snapshot.api.datalab?.configured ? "설정됨" : "미설정"}</p>${sourceLink("https://naver.github.io/searchad-apidoc/")}${sourceLink("https://developers.naver.com/docs/serviceapi/datalab/search/search.md")}</details>
 <h3>하루 한 번 갱신</h3><div class="ops-grid"><label class="compact-check"><input id="opsScheduleEnabled" type="checkbox" ${prefs.scheduleEnabled ? "checked" : ""}/>앱 실행 중 자동 갱신</label><label>한국 시간<input id="opsScheduleTime" type="time" value="${esc(prefs.scheduleTime || "09:00")}"/></label><label>공급자<select id="opsScheduleProvider"><option value="cache">기존 자료 재사용</option><option value="searchad" ${prefs.provider === "searchad" ? "selected" : ""}>검색광고 API</option><option value="datalab" ${prefs.provider === "datalab" ? "selected" : ""}>데이터랩 API</option></select></label><label>키워드 최대 5개<input id="opsScheduleHints" value="${esc((prefs.hints || []).join(", "))}"/></label>${button("schedule", "갱신 일정 저장")}</div><p class="hint">앱을 종료하면 수집하지 않습니다. 실패해도 이전 수치를 최신으로 표시하지 않습니다.</p>
 <h3>가져오기 이력</h3>${snapshot.datasets.map((d) => `<p>${esc(d.kind)} · ${esc(d.platform)} · ${esc(d.meta.fileName || d.meta.sourceType)} · 기준 ${esc(d.meta.observedDate)} · 등록 ${esc(d.created_at)} ${sourceLink(d.meta.sourceUrl)}</p>`).join("") || "<p>등록한 데이터가 없습니다.</p>"}`;
  }
  function drafts() {
    $("#opsContent").innerHTML =
      `<div class="ops-heading"><h2>원고 · 최종 승인 · 플랫폼별 발행</h2><span class="hint">AI 통과와 사용자 승인은 별도 상태입니다.</span></div><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>원고</th><th>플랫폼</th><th>현재 버전</th><th>상태</th><th>작업</th></tr></thead><tbody>${snapshot.documents.map((d) => `<tr><td>${esc(d.title)}</td><td>${esc(d.platform)}</td><td>v${d.current_version}${d.approved_version === d.current_version ? " · 최종 승인" : ""}</td><td>${esc(status(d.status))}</td><td>${button("openDocument", "수정·검수·발행", d.id)}</td></tr>`).join("")}</tbody></table></div><div id="opsDocument"></div>`;
    if (doc && snapshot.documents.some((d) => d.id === doc.id))
      renderDocument();
  }
  function renderDocument() {
    const d = doc;
    if (!d) return;
    editingSeconds = 0;
    lastTyping = 0;
    $("#opsDocument").innerHTML =
      `<section class="ops-detail"><h2>${esc(d.platform)} 원고 · v${d.current_version}</h2><p class="hint">수정 후 저장하면 이전 승인·AI 검수가 해제됩니다. 최초 AI 원고와 이전 버전은 보존합니다. 로컬 원고 수정·승인 취소는 이미 게시한 글을 변경하지 않습니다.</p><label>제목<input id="opsDocTitle" maxlength="200" value="${esc(d.current.title)}"/></label><label>현재 원고<textarea id="opsDocArticle" class="ops-article" maxlength="30000">${esc(d.current.article)}</textarea></label><div class="button-row">${button("saveDocument", "수정본 저장", d.id, "primary")}${button("review", "현재 버전 AI 검수 요청", d.id)}${button("repair", "선택 문단만 AI 보완", d.id)}${button("variant", d.platform === "naver" ? "티스토리 별도 원고 작성" : "네이버 별도 원고 작성", d.id)}</div><label>선택 문단 수정 요청<input id="opsRepairInstruction" maxlength="1000" placeholder="수정할 문단을 원고에서 선택하고 요청을 적어주세요."/></label><p class="hint">AI 부분 보완은 선택 문단만 바꾸며 최종 승인 전 다시 검수합니다. 플랫폼별 별도 원고도 각각 검수·승인해야 합니다.</p>
 <div class="ops-document-preview" id="opsDocPreview"></div><div class="ops-images">${(d.current.data.images || []).map((i) => `<figure><img src="${esc(i.url)}" alt="${esc(i.role)} 이미지"/><figcaption>${esc(i.role)} ${esc(i.sequence)}</figcaption></figure>`).join("")}</div>
 <details><summary>최초 AI 원고</summary><pre class="ops-notes">${esc(d.original.title + "\n\n" + d.original.article)}</pre></details><details><summary>최초 원고와 현재 수정본 차이</summary>${d.diff.paragraphs.map((p) => `<div class="ops-diff ${esc(p.type)}"><small>${{ added: "추가", removed: "삭제", same: "유지" }[p.type]}</small><p>${esc(p.text)}</p></div>`).join("")}${d.diff.truncated ? "<p>비교 화면은 앞 200문단까지만 표시합니다. 원문 버전은 보존합니다.</p>" : ""}</details>
 <details><summary>이전 버전 ${d.versions.length}개</summary>${d.versions.map((v) => `<p>v${v.version} · ${esc(v.created_at)} · ${esc(v.data.source)} ${button("restoreVersion", "이 버전을 새 수정본으로 복원", v.version)}</p>`).join("")}</details><details><summary>사용자 승인·취소 이력</summary>${d.approvalHistory.map((e) => `<p>${esc(e.type === "approved" ? "최종 승인" : "승인 취소")} · v${e.data.version ?? "?"} · ${esc(e.created_at)}</p>`).join("") || "<p>기록 없음</p>"}</details><h3>AI 검수 기록</h3>${
   d.reviews
     .slice(0, 5)
     .map(
       (r) =>
         `<details><summary>v${r.version} · ${esc(r.status)} · ${esc(r.created_at)}</summary>${notes({ reason: r.data.failureReason, issues: r.data.issues, revisionInstructions: r.data.revisionInstructions, readerEvidence: r.data.readerValueAssessment })}</details>`,
     )
     .join("") || "<p>현재 원고의 검수를 요청하세요.</p>"
 }
 <div class="ops-notice"><label class="compact-check"><input id="opsFinalApproval" type="checkbox"/>현재 버전의 사실·중복·허위 경험·무단 복제·과장된 효능·제품 홍보 제한을 직접 확인했고 최종 승인합니다.</label><label class="compact-check"><input id="opsImagesConfirmed" type="checkbox"/>이미지와 설명을 직접 확인했습니다(이미지 있는 원고).</label>${button("approve", "현재 버전 최종 승인", d.id, "primary")}${button("revoke", "승인 취소", d.id)}<p>현재 상태: ${esc(status(d.status))} · 승인 버전 ${d.approved_version == null ? "없음" : "v" + d.approved_version}</p></div>
 <h3>발행 준비</h3><div class="ops-grid"><label>공개 범위<select id="opsVisibility"><option value="private">비공개</option><option value="public">공개</option>${d.platform === "naver" ? '<option value="draft">네이버 임시저장</option>' : ""}</select></label><label>발행 시점<select id="opsPublishWhen"><option value="now">지금 바로 발행</option><option value="reserve">예약 발행</option></select></label><label id="opsReserveLabel" hidden>몇 시간 뒤<input id="opsReserve" type="number" min="1" value="3"/></label>${button("prepare", "승인 원고 발행 준비", d.id)}</div>${button("publish", "지금 바로 발행", d.id, "primary")}<p id="opsPublishSummary" class="hint"></p><p id="opsPublishProgress" role="status" aria-live="polite"></p><p class="hint">현재 선택한 공개 범위와 발행 시점으로 연결된 Chrome에 발행을 요청합니다. 네이버와 티스토리는 각각 실행합니다. 결과 불확실 시 자동 재시도하지 않습니다.</p>
 <h3>플랫폼별 발행 기록</h3>${d.publications.map((p) => `<div><b>${esc(p.platform)} v${p.version} · ${esc(p.state)}</b><p>${esc(p.updated_at)} · ${esc(p.data.visibility || "")} · ${esc(p.data.scheduleMode || "")}</p>${sourceLink(p.data.url || p.data.result?.url || "")}${p.state === "uncertain" ? `<label>Chrome에서 확인한 결과<select id="opsResolveDecision"><option value="published">이미 발행·예약됨</option><option value="not_published">미발행임을 직접 확인</option></select></label><label>실제 게시글 주소<input id="opsResolveUrl" type="url"/></label><label class="compact-check"><input id="opsResolveConfirmed" type="checkbox"/>공개·예약·임시저장 목록에서 직접 확인했습니다.</label>${button("resolvePublication", "확인 결과 기록", p.id)}` : ""}</div>`).join("") || "<p>아직 발행 요청이 없습니다.</p>"}</section>`;
    const prepared=d.publications.find(p=>p.version===d.current_version && p.state==='prepared');
    if(prepared){
      $('#opsVisibility').value=prepared.data.visibility;
      $('#opsPublishWhen').value=prepared.data.scheduleMode;
      $('#opsReserve').value=prepared.data.reserveAfterHours || 3;
    }
    for(const selector of ['#opsVisibility','#opsPublishWhen','#opsReserve'])$(selector).addEventListener('change',updatePublicationControls);
    updatePublicationControls();
    $("#opsDocArticle").addEventListener("input", () => {
      const now = Date.now();
      if (lastTyping) editingSeconds += Math.min(30, (now - lastTyping) / 1000);
      lastTyping = now;
      $("#opsFinalApproval").checked = false;
    });
    api
      .getWritingPreview({
        article: d.current.article,
        presentation: d.data.writingApplication?.presentation,
      })
      .then((result) => {
        if (!$("#opsDocPreview") || doc?.id !== d.id) return;
        const container = $("#opsDocPreview");
        container.replaceChildren();
        for (const b of result.blocks) {
          const el = document.createElement(b.type === "section" ? "h4" : "p");
          el.textContent =
            b.type === "image" ? "[이미지 " + b.sequence + "]" : b.text;
          container.append(el);
        }
      })
      .catch(() => {});
  }
  function publicationSelection() {
    const visibility=$('#opsVisibility').value;
    const scheduleMode=visibility==='public'?$('#opsPublishWhen').value:'now';
    return {version:doc.current_version,visibility,scheduleMode,reserveAfterHours:scheduleMode==='reserve'?Number($('#opsReserve').value):0};
  }
  function updatePublicationControls() {
    const visibility=$('#opsVisibility').value;
    if(visibility!=='public')$('#opsPublishWhen').value='now';
    $('#opsPublishWhen').disabled=visibility!=='public';
    const reserved=$('#opsPublishWhen').value==='reserve';
    $('#opsReserveLabel').hidden=!reserved;
    const label=visibility==='draft'?'지금 임시저장':visibility==='private'?'지금 비공개 저장':reserved?'예약 발행':'지금 바로 발행';
    $('#opsDocument [data-action="publish"]').textContent=label;
    $('#opsPublishSummary').textContent=reserved?'공개 · '+$('#opsReserve').value+'시간 뒤 예약 발행':'선택한 공개 범위로 예약 시간 없이 지금 처리합니다.';
  }
  function style() {
    const p = snapshot.profile,
      b = snapshot.benchmarks;
    $("#opsContent").innerHTML =
      `<h2>승인 편집 프로필</h2><p>직접 수정·최종 승인한 원고만 반영합니다. 승인본 1개는 참고 사례로 취급하고 여러 원고의 관찰값과 명시 지침을 구분합니다.</p><label>사용자 필수 작성 지침(최대 2,000자)<textarea id="opsRequiredInstructions" maxlength="2000">${esc(p.instructions)}</textarea></label><label class="compact-check"><input id="opsStyleEnabled" type="checkbox" ${p.enabled ? "checked" : ""}/>승인 편집 프로필 적용</label><label>명시 편집 규칙(줄마다 하나, 최대 8개)<textarea id="opsExplicitRules" maxlength="1800">${esc(p.explicitRules.join("\n"))}</textarea></label>${button("saveProfile", "편집 프로필 저장")}<p class="hint">정확성·저작권 → 필수 작성 지침 → 승인 편집 기준 → 검색 의도 → 카테고리 → 벤치마크 순서입니다. 필수 지침은 문체 적용을 꺼도 유지합니다.</p>
 ${p.rules.map((r) => `<p><b>${esc(r.rule)} ${fmt(r.value)}</b> · ${esc(r.confidence)}</p><small>근거 ${r.basis.map((b) => esc(b.documentId) + " v" + b.version).join(", ")}</small>`).join("") || "<p>새 승인 원고가 쌓이면 형식 관찰값을 표시합니다. 기존 문체 학습 자료는 유지합니다.</p>"}
 <details><summary>기존 PR #2 단일 승인 예시 보존 상태</summary><p>${snapshot.legacyApproval.approved ? "승인 표시 있음" : "승인 표시 없음"} · ${esc(snapshot.legacyApproval.approvedAt || "날짜 미확인")}</p><pre class="ops-notes">${esc(snapshot.legacyApproval.sample || "등록 자료 없음")}</pre><p class="hint">수정 전 원고가 없는 이전 자료는 새 승인 버전으로 꾸미지 않습니다. 승인된 자료의 일반적인 형식 관찰만 참고할 수 있습니다.</p></details>
 <h2>벤치마킹 관리</h2><p>${esc(b.builtIn.method)}</p>${b.builtIn.sources.map(sourceLink).join("")}<details><summary>확인한 공개 게시글 ${b.builtIn.posts.length}편 · 관찰일 ${esc(b.builtIn.observedAt)}</summary>${b.builtIn.posts.map((p) => `<p><b>${esc(p.title)}</b>${sourceLink(p.url)}<small>줄 ${fmt(p.lines)}자 · 문단 ${fmt(p.paragraphs)}자 · 인용 블록 ${p.quotes}개 · 이미지 ${p.images}개(권장 개수가 아님)</small></p>`).join("")}</details>
 <h3>사용자 확인 자료 등록</h3><div class="ops-grid"><label>원문 주소<input id="opsBenchmarkUrl" type="url"/></label><label>적용할 일반 형식<select id="opsBenchmarkProfile"><option value="balanced">자동</option><option value="explanation">건강 설명</option><option value="practical">실행·루틴</option><option value="comparison">선택·비교</option><option value="essay">일상·경험</option><option value="off">적용 끄기</option></select></label><label class="ops-wide">직접 확보한 본문 텍스트<textarea id="opsBenchmarkText" maxlength="30000"></textarea></label><label class="ops-wide">확인 메모<textarea id="opsBenchmarkNotes" maxlength="1000"></textarea></label></div>${button("addBenchmark", "텍스트 구조 계측·등록")}${button("benchmarkCapture", "캡처 등록 후 선택 분석")}
 <p class="hint">텍스트는 형식 계측 후 전문을 저장하거나 모델에 전달하지 않습니다. 캡처는 로컬에만 보관합니다. 등록만으로 분석된 것으로 처리하지 않으며 선택한 캡처만 별도 AI 관찰을 요청할 수 있습니다.</p>${b.registered.map((r) => `<article class="ops-competitor">${sourceLink(r.url)}<b>${esc(r.status)}</b><p>${esc(r.notes)}</p>${r.summary ? notes(r.summary) : ""}${r.formatObservation ? notes(r.formatObservation) : ""}${r.capturePath ? button("analyzeCapture", "캡처 형식 AI 분석 · 추가 사용량", r.id) : ""}${button("applyBenchmark", "선택 형식 적용", r.profile)}</article>`).join("")}`;
  }
  function analytics() {
    const a = snapshot.analytics;
    $("#opsContent").innerHTML =
      `<div class="ops-heading"><h2>실제 방문 성과 · 사용량</h2>${button("weeklyReport", "주간 운영 리포트 저장")}</div><p class="hint">${esc(a.note)}</p>${a.platforms.map((p) => `<h3>${esc(p.platform)} · ${esc(p.definition)}</h3><div class="ops-metrics">${metric("오늘 방문자", fmt(p.metrics.visitors.today.total))}${metric("7일 평균 방문자", fmt(p.metrics.visitors.last7.average), p.metrics.visitors.last7.measuredDays + "/7일 측정")}${metric("30일 평균 방문자", fmt(p.metrics.visitors.last30.average), p.metrics.visitors.last30.measuredDays + "/30일 측정")}${metric("30일 검색 유입", fmt(p.metrics.searchInflow.last30.total), p.metrics.searchInflow.last30.measuredDays + "/30일 측정")}</div><details><summary>30일·이전 30일 / 90일·이전 90일 비교</summary>${notes(p.metrics)}</details>`).join("") || '<p class="ops-empty">측정한 관리자 통계가 없습니다. 검색 데이터 메뉴에서 네이버·티스토리별 CSV/XLSX를 등록하세요.</p>'}
 <h3>게시글별 성과</h3><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>게시글 · 플랫폼</th><th>30일 조회</th><th>30일 검색 유입</th><th>7일·28일 관측</th></tr></thead><tbody>${a.posts.map((p) => `<tr><td>${esc(p.title || p.id)} · ${esc(p.platform)}${sourceLink(p.url)}</td><td>${fmt(p.views30.total)}<small>${p.views30.measuredDays}/30일</small></td><td>${fmt(p.search30.total)}<small>${p.search30.measuredDays}/30일</small></td><td>${p.after7 ? fmt(p.after7.views.total) + " / " + fmt(p.after28.views.total) : "발행일 미확인"}<details><summary>검색어·측정 범위</summary>${notes({ queries: p.queries, after7: p.after7, after28: p.after28, latestCumulative: p.latestCumulative })}</details></td></tr>`).join("")}</tbody></table></div><h3>카테고리별 관측 성과</h3>${notes(a.categories)}<h3>다음 주 기획에 반영할 관찰</h3>${a.insights.map((i) => `<p><b>${esc(i.title || i.url)}</b> · 검색 유입 ${fmt(i.searchInflow)} (${i.measuredDays}일 관측)</p><p>${esc(i.action)}</p>`).join("") || "<p>실제 유입 자료가 쌓이면 세부 질문 확장·보완 항목을 제안합니다. 성과가 낮다고 삭제하거나 재발행하지 않습니다.</p>"}
 <h3>AI 사용량 · 승인 현황</h3><div class="ops-metrics">${metric("측정 토큰", a.usage.hasMeasurements ? fmt(a.usage.totalTokens) : "미측정")}${metric("현재 승인 비율", a.usage.approvalRate == null ? "미측정" : fmt(a.usage.approvalRate * 100) + "%", a.usage.approvedDrafts + "/" + a.usage.generatedDrafts + "건, 검수 대기 포함")}${metric("승인 원고당 토큰", fmt(a.usage.tokensPerApproved))}${metric("활성 편집 시간", a.usage.editingSeconds == null ? "미측정" : fmt(a.usage.editingSeconds) + "초", "30초 이상 유휴 제외")}</div>${notes(a.usage)}<p class="hint">외부 통계 자동 로그인 수집은 사용하지 않습니다. 공식적으로 내보낸 실제 관리자 자료와 로컬 작업 이력만 분석합니다.</p>`;
  }
  function render() {
    if (!snapshot) return;
    if (tab === "overview") overview();
    else if (tab === "data") dataPage();
    else if (tab === "drafts") drafts();
    else if (tab === "style") style();
    else if (tab === "analytics") analytics();
  }
  async function openDocument(id) {
    doc = await action("document", { id });
    tab = "drafts";
    showTab("drafts");
    render();
    $("#opsDocument")?.scrollIntoView({ block: "start" });
  }
  function showTab(next) {
    tab = next;
    const legacy = next === "legacy";
    $("#operationsPanel").hidden = legacy;
    $(".workspace").hidden = !legacy;
    document
      .querySelectorAll("#operationsNav button")
      .forEach((b) =>
        b.setAttribute("aria-current", String(b.dataset.opsTab === next)),
      );
    if (!legacy) render();
  }
  async function updatedDocument(value) {
    if (value) {
      doc = value;
      await refresh();
      if (tab !== "drafts") {
        tab = "drafts";
        showTab("drafts");
      }
      renderDocument();
      if (value.learningWarning)
        message(
          "승인은 저장했습니다. 문체 학습 확인 필요: " + value.learningWarning,
          true,
        );
    }
  }
  const split = (s) =>
    s
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  async function handle(actionName, id) {
    const val = (id) => $(id)?.value || "";
    if (actionName === "filter") {
      filters = {
        category: val("#opsCategory"),
        trend: val("#opsTrend"),
        type: val("#opsType"),
        minVolume: val("#opsVolume"),
        sort: val("#opsSort"),
        excludeDuplicate: $("#opsNoDuplicate").checked,
      };
      return refresh();
    }
    if (actionName === "detail" || actionName === "generateOptions")
      return detail(id, actionName === "generateOptions");
    if (
      actionName === "archive" ||
      actionName === "exclude" ||
      actionName === "restoreTopic"
    ) {
      await action("topicState", {
        id,
        status: {
          archive: "archived",
          exclude: "excluded",
          restoreTopic: "candidate",
        }[actionName],
      });
      return refresh();
    }
    if (actionName === "refreshCache") {
      await action("refresh", { provider: "cache" });
      return refresh();
    }
    if (actionName === "installCategories") {
      await action("installCategories");
      return refresh();
    }
    if (actionName === "addTopic") {
      await action("addTopic", {
        title: val("#opsNewTitle"),
        keyword: val("#opsNewKeyword"),
        category: val("#opsNewCategory"),
      });
      return refresh();
    }
    if (actionName === "generate") {
      const result = await action("generate", {
        id,
        platform: val("#opsGeneratePlatform"),
        images: $("#opsGenerateImages").checked,
        experienceNotes: val("#opsExperience"),
      });
      if (result?.documentId) return openDocument(result.documentId);
      throw Error(
        result?.reason ||
          "원고가 저장되지 않았습니다. 기존 작업의 진행 기록을 확인하세요.",
      );
    }
    if (actionName === "collectCompetition") {
      await action("competition", { id });
      await refresh();
      return detail(id);
    }
    if (actionName === "saveCompetition") {
      await action("annotateCompetition", {
        id,
        title: val("#opsCompTitle"),
        url: val("#opsCompUrl"),
        excerpt: val("#opsCompExcerpt"),
        reason: val("#opsCompReason"),
        gap: val("#opsCompGap"),
        opportunityScore: val("#opsCompOpportunity"),
        intentScore: val("#opsCompIntent"),
        originalityScore: val("#opsCompOriginality"),
      });
      await refresh();
      return detail(id);
    }
    if (actionName === "publicationMode") {
      await action("publicationMode", { mode: val("#opsPublicationMode") });
      return refresh();
    }
    if (actionName === "template")
      return action("template", { kind: val("#opsImportKind") });
    if (actionName === "importPreview") {
      const preview = await action("importPreview", {
        kind: val("#opsImportKind"),
        platform: val("#opsImportPlatform"),
        metadata: {
          observedDate: val("#opsImportDate"),
          sourceUrl: val("#opsImportSource"),
          definition: val("#opsDefinition"),
        },
      });
      if (!preview) return;
      pendingImport = preview.token;
      $("#opsImportPreview").innerHTML =
        `<h3>가져오기 전 확인</h3><p>전체 ${preview.total}행 · 유효 ${preview.valid}행 · 오류 ${preview.errors.length}개 ${esc(preview.sheet || "")}</p>${notes(preview.sample)}${preview.errors.length ? notes(preview.errors) : button("importCommit", "확인한 데이터 저장")}`;
      return;
    }
    if (actionName === "importCommit") {
      const result = await action("importCommit", { token: pendingImport });
      await refresh();
      message(
        result.duplicate
          ? "같은 파일이 이미 등록되어 재사용했습니다."
          : result.count + "행을 저장했습니다.",
      );
      return;
    }
    if (actionName === "fetchApi") {
      const result = await action("refresh", {
        provider: val("#opsProvider"),
        hints: split(val("#opsHints")),
      });
      await refresh();
      message(
        result.reused
          ? "같은 요청의 저장 결과를 재사용했습니다."
          : "공식 API 자료를 저장했습니다.",
      );
      return;
    }
    if (actionName === "saveSearchAd" || actionName === "saveDataLab") {
      const provider = actionName === "saveSearchAd" ? "searchad" : "datalab",
        values =
          provider === "searchad"
            ? {
                apiKey: val("#opsAdKey"),
                secret: val("#opsAdSecret"),
                customerId: val("#opsCustomer"),
              }
            : {
                clientId: val("#opsLabId"),
                clientSecret: val("#opsLabSecret"),
              };
      await action("credential", { provider, values });
      return refresh();
    }
    if (actionName === "schedule") {
      await action("preferences", {
        scheduleEnabled: $("#opsScheduleEnabled").checked,
        scheduleTime: val("#opsScheduleTime"),
        provider: val("#opsScheduleProvider"),
        hints: split(val("#opsScheduleHints")),
      });
      return refresh();
    }
    if (actionName === "reviewTopicDocument") {
      await action("review", { id });
      return openDocument(id);
    }
    if (actionName === "openDocument") return openDocument(id);
    if (actionName === "saveDocument")
      return updatedDocument(
        await action("saveDocument", {
          id,
          expectedVersion: doc.current_version,
          title: val("#opsDocTitle"),
          article: val("#opsDocArticle"),
          editingSeconds: lastTyping ? editingSeconds : null,
        }),
      );
    if (
      ["review", "repair", "variant", "approve", "prepare", "publish"].includes(
        actionName,
      ) &&
      doc &&
      (val("#opsDocArticle") !== doc.current.article ||
        val("#opsDocTitle") !== doc.current.title)
    )
      throw Error("수정본을 먼저 저장하세요.");
    if (
      actionName === "review" ||
      actionName === "variant" ||
      actionName === "revoke"
    )
      return updatedDocument(await action(actionName, { id }));
    if (actionName === "repair") {
      const field = $("#opsDocArticle"),
        before = field.value.slice(field.selectionStart, field.selectionEnd);
      return updatedDocument(
        await action("repair", {
          id,
          version: doc.current_version,
          before,
          instruction: val("#opsRepairInstruction"),
        }),
      );
    }
    if (actionName === "restoreVersion")
      return updatedDocument(
        await action("restoreVersion", { id: doc.id, version: Number(id) }),
      );
    if (actionName === "approve")
      return updatedDocument(
        await action("approve", {
          id,
          version: doc.current_version,
          confirmed: $("#opsFinalApproval").checked,
          imagesConfirmed: $("#opsImagesConfirmed").checked,
        }),
      );
    if (actionName === "prepare")
      return updatedDocument(
        await action("prepare", {
          id,
          platform: doc.platform,
          visibility: val("#opsVisibility"),
          scheduleMode: val("#opsPublishWhen"),
          reserveAfterHours: Number(val("#opsReserve")),
          confirmed: true,
        }),
      );
    if (actionName === "publish")
      return updatedDocument(
        await action("publish", {
          id,
          preparation: publicationSelection(),
        }),
      );
    if (actionName === "resolvePublication")
      return updatedDocument(
        await action("resolvePublication", {
          id: doc.id,
          publicationId: id,
          decision: val("#opsResolveDecision"),
          url: val("#opsResolveUrl"),
          confirmed: $("#opsResolveConfirmed").checked,
        }),
      );
    if (actionName === "saveProfile") {
      await action("profile", {
        enabled: $("#opsStyleEnabled").checked,
        instructions: val("#opsRequiredInstructions"),
        rules: val("#opsExplicitRules")
          .split("\n")
          .filter((s) => s.trim()),
      });
      return refresh();
    }
    if (actionName === "addBenchmark" || actionName === "benchmarkCapture") {
      await action(
        actionName === "addBenchmark" ? "benchmark" : "benchmarkCapture",
        {
          url: val("#opsBenchmarkUrl"),
          text: val("#opsBenchmarkText"),
          notes: val("#opsBenchmarkNotes"),
          profile: val("#opsBenchmarkProfile"),
        },
      );
      return refresh();
    }
    if (actionName === "analyzeCapture") {
      await action("analyzeCapture", { id });
      return refresh();
    }
    if (actionName === "applyBenchmark") {
      await action("applyBenchmark", { profile: id });
      message("선택 형식을 저장했습니다. 다음 새 원고부터 적용합니다.");
      return;
    }
    if (actionName === "weeklyReport") return action("weeklyReport");
  }
  document.addEventListener("click", (event) => {
    const nav = event.target.closest("[data-ops-tab]");
    if (nav) {
      showTab(nav.dataset.opsTab);
      if (tab !== "legacy") run(refresh);
      return;
    }
    const source = event.target.closest("[data-source]");
    if (source) {
      event.preventDefault();
      run(() => action("openSource", { url: source.dataset.source }));
      return;
    }
    const target = event.target.closest("#opsContent [data-action]");
    if (target && !busy)
      run(() => handle(target.dataset.action, target.dataset.id));
  });
  $("#opsReload").addEventListener("click", () => run(refresh));
  $("#opsAccount").addEventListener("change", () => {
    sequence++;
    doc = null;
    topic = null;
    filters = { excludeDuplicate: true };
    if (typeof selectAccount === "function") selectAccount(account());
    run(refresh);
  });
  api.onOperationsProgress?.((p) => {if(!p.accountId || p.accountId===account())message(p.message, p.level === "error");});
  api.onComplete(() => {
    if (
      doc &&
      $("#opsDocArticle") &&
      $("#opsDocArticle").value !== doc.current.article
    ) {
      message("새 작업 기록이 있습니다. 수정본을 저장한 뒤 새로고침하세요.");
      return;
    }
    if (tab !== "legacy" && account())
      refresh().catch((e) => message(e.message, true));
  });
  async function init() {
    const initial = await api.getInitialData(),
      accounts = initial.accountStore?.accounts || [],
      selected =
        $("#opsAccount").value || initial.accountStore?.selectedAccountId;
    $("#opsAccount").replaceChildren();
    for (const a of accounts) {
      const option = document.createElement("option");
      option.value = a.id;
      option.textContent = (a.label || a.blogId) + " · " + a.blogId;
      option.selected = a.id === selected;
      $("#opsAccount").append(option);
    }
    showTab(tab);
    if (accounts.length) {
      await refresh();
      message("준비됨");
    } else renderEmpty();
  }
  api.onAccountsUpdate(() => {
    if (!busy) init().catch((e) => message(e.message, true));
  });
  init().catch((e) => message(e.message, true));
})();
