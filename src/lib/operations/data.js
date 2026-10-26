"use strict";
const S = require("./store"),
  T = require("./tabular");
const CATEGORIES = [
  "건강·신체 상식",
  "신발·깔창 가이드",
  "걷기·운동·아웃도어",
  "스트레칭·홈트레이닝",
  "일상 건강·웰니스",
  "직장·여행·생활 건강",
  "가족·연령별 건강",
  "생활 속 선택·비교",
];
const seeds = [
  [
    "발이 쉽게 피로할 때 살펴볼 생활 조건",
    "오래 서 있을 때 발이 불편한 이유",
    "운동 후 근육통과 통증은 어떻게 구분할까",
    "몸의 좌우 움직임이 다를 때 확인할 점",
  ],
  [
    "운동화 깔창은 언제 교체해야 할까",
    "기존 깔창 위에 새 깔창을 넣어도 될까",
    "신발이 클 때 깔창을 추가해도 될까",
    "쿠션형과 아치 지지형 깔창은 어떻게 다를까",
  ],
  [
    "걷기 전에 신발 끈은 어떻게 조절할까",
    "걷기 운동을 처음 시작할 때 준비할 것",
    "비 오는 날 걷기에서 확인할 안전 조건",
    "오래 걸을 때 쉬는 시점은 어떻게 정할까",
  ],
  [
    "종아리 스트레칭 중 불편하면 언제 멈출까",
    "오래 앉아 있다 일어날 때 준비할 움직임",
    "홈트레이닝 전에 공간은 어떻게 준비할까",
    "스트레칭 강도는 어떻게 조절할까",
  ],
  [
    "잠들기 전 몸을 편안하게 쉬게 하는 방법",
    "생활 속 활동량은 어떻게 기록할까",
    "운동 습관이 끊겼을 때 다시 시작하는 방법",
    "쉬는 날과 움직이는 날은 어떻게 나눌까",
  ],
  [
    "출장 갈 때 걷기 편한 신발을 고르는 기준",
    "오래 서서 일할 때 쉴 공간을 준비하는 방법",
    "장거리 이동 중 움직일 때 확인할 조건",
    "여행 중 발이 피로할 때 일정 조절 방법",
  ],
  [
    "부모님과 산책할 때 속도를 맞추는 방법",
    "아이 운동화를 고를 때 확인할 공간",
    "가족과 함께 걷기 코스를 정하는 기준",
    "나이에 따라 운동 강도를 정할 때 확인할 점",
  ],
  [
    "운동화는 가벼울수록 좋을까",
    "푹신한 신발과 단단한 신발의 선택 기준",
    "실내 운동과 야외 걷기는 어떻게 선택할까",
    "신발 사이즈와 발볼은 어떻게 함께 볼까",
  ],
];
const baseKeywords = [
  "발 피로",
  "깔창",
  "걷기 운동",
  "스트레칭",
  "건강 습관",
  "생활 건강",
  "가족 산책",
  "신발 선택",
];
function inferCategory(keyword) {
  const patterns = [
    /통증|근육|관절|신체|발\s*피로/,
    /깔창|신발|발볼|운동화/,
    /걷기|산책|등산|러닝|아웃도어/,
    /스트레칭|홈트|자세/,
    /수면|습관|웰니스|휴식/,
    /직장|여행|출장|오래\s*서/,
    /가족|부모|아이|노년|연령/,
    /비교|선택|차이/,
  ];
  const index = patterns.findIndex((p) => p.test(keyword));
  return index < 0 ? "미분류" : CATEGORIES[index];
}
function normalise(kind, row, meta) {
  const g = (...names) => T.get(row, ...names),
    observed = T.date(
      g("observedDate", "기준일", "수집일", "조회일") || meta.observedDate,
    );
  if (observed > new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10))
    throw Error("미래 수집일은 사용할 수 없습니다.");
  const category = g("category", "카테고리") || "";
  if (category && !CATEGORIES.includes(category))
    throw Error("카테고리는 지정된 8개 중 하나를 사용하세요.");
  if (kind === "keywords") {
    const keyword = g("keyword", "키워드", "연관키워드", "검색어");
    if (!keyword || keyword.length > 100)
      throw Error("키워드가 필요합니다(100자 이내).");
    const pc = T.count(
        g("monthlyPcQcCnt", "pc", "월간PC검색수", "월간검색수PC", "PC 검색수"),
      ),
      mobile = T.count(
        g(
          "monthlyMobileQcCnt",
          "mobile",
          "월간모바일검색수",
          "월간검색수모바일",
          "모바일 검색수",
        ),
      );
    const total = T.number(
      g("monthlySearches", "total", "월간통합검색수", "월간검색량"),
      { integer: true },
    );
    if (
      pc.value == null &&
      mobile.value == null &&
      pc.upperBound == null &&
      mobile.upperBound == null &&
      total == null
    )
      throw Error(
        "PC·모바일 또는 통합 검색량이 필요합니다. 미확인 숫자를 만들어 넣지 마세요.",
      );
    if (
      pc.value != null &&
      mobile.value != null &&
      total != null &&
      pc.value + mobile.value !== total
    )
      throw Error("PC+모바일 검색량과 통합 검색량이 다릅니다.");
    return {
      keyword,
      category: category || inferCategory(keyword),
      categoryBasis: category ? "사용자 분류" : "키워드 기반 임시 분류",
      pc,
      mobile,
      monthlySearches:
        pc.value != null && mobile.value != null
          ? pc.value + mobile.value
          : total,
      adCompetition: g("compIdx", "광고경쟁도", "경쟁정도"),
      monthlyPcClicks: T.number(
        g("monthlyAvePcClkCnt", "월간평균클릭수PC", "월평균클릭수PC"),
      ),
      monthlyMobileClicks: T.number(
        g(
          "monthlyAveMobileClkCnt",
          "월간평균클릭수모바일",
          "월평균클릭수모바일",
        ),
      ),
      observedDate: observed,
    };
  }
  if (kind === "trends") {
    const keyword = g("keyword", "키워드", "검색어"),
      date = T.date(g("date", "period", "날짜", "기간")),
      ratio = T.number(g("ratio", "상대지수", "검색지수"));
    if (!keyword || ratio == null || ratio > 100)
      throw Error("키워드와 0~100 상대지수가 필요합니다.");
    return {
      keyword,
      date,
      ratio,
      normalizationId: meta.normalizationId || meta.digest,
      observedDate: observed,
    };
  }
  if (kind === "competition") {
    const keyword = g("keyword", "키워드"),
      url = T.http(g("url", "URL", "주소")),
      title = g("title", "제목"),
      excerpt = g("excerpt", "본문발췌", "분석근거");
    if (!keyword || !url || !title)
      throw Error("경쟁 분석에는 키워드·제목·URL이 필요합니다.");
    const score = (name, max) => {
      const n = T.number(g(name));
      if (n != null && n > max)
        throw Error(name + " 최대 " + max + "점입니다.");
      return n;
    };
    const opportunity = score("opportunityScore", 20),
      intent = score("intentScore", 15),
      originality = score("originalityScore", 15),
      reason = g("reason", "판단근거", "추천근거"),
      gap = g("gap", "부족한정보");
    if (
      [opportunity, intent, originality].some((n) => n != null) &&
      (!reason || !excerpt)
    )
      throw Error("점수에는 실제 발췌와 판단 근거가 필요합니다.");
    return {
      keyword,
      url,
      title,
      excerpt: excerpt.slice(0, 6000),
      contentType: g("contentType", "콘텐츠유형") || "미확인",
      publishedDate: g("publishedDate", "게시일"),
      depth: g("depth", "설명깊이"),
      hasPhotos: g("hasPhotos", "실제사진") || "미확인",
      hasSources: g("hasSources", "근거자료") || "미확인",
      gap,
      reason,
      opportunityScore: opportunity,
      intentScore: intent,
      originalityScore: originality,
      observedDate: observed,
    };
  }
  if (kind === "content") {
    const title = g("title", "제목"),
      url = T.http(g("url", "URL", "게시글주소")),
      postId = g("postId", "게시글ID") || url;
    if (!title || !postId)
      throw Error("기존 글 제목과 게시글 ID 또는 URL이 필요합니다.");
    return {
      title,
      url,
      postId,
      question: g("question", "핵심질문"),
      intent: g("intent", "검색의도"),
      answer: g("answer", "핵심답변"),
      status: g("status", "상태") || "public",
      category,
      publishedAt: g("publishedAt", "발행일"),
      observedDate: observed,
    };
  }
  if (kind === "performance") {
    const date = T.date(g("date", "날짜"));
    if (date > new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10))
      throw Error("미래 성과는 등록할 수 없습니다.");
    const scope = g("scope", "구분") || "daily",
      metricType = g("metricType", "측정방식") || "daily";
    if (
      !["daily", "post", "query"].includes(scope) ||
      !["daily", "cumulative"].includes(metricType)
    )
      throw Error(
        "scope: daily/post/query, metricType: daily/cumulative를 확인하세요.",
      );
    const postId = g("postId", "게시글ID"),
      url = T.http(g("url", "게시글주소")),
      query = g("query", "유입검색어");
    if (scope !== "daily" && !postId && !url)
      throw Error("게시글·검색어 통계에는 게시글 ID/URL이 필요합니다.");
    if (scope === "query" && !query) throw Error("유입검색어가 필요합니다.");
    const visitors = T.number(g("visitors", "방문자", "방문자수"), {
        integer: true,
      }),
      views = T.number(g("views", "조회수"), { integer: true }),
      searchInflow = T.number(g("searchInflow", "검색유입", "검색유입수"), {
        integer: true,
      });
    if ([visitors, views, searchInflow].every((v) => v == null))
      throw Error("적어도 하나의 측정값이 필요합니다.");
    return {
      date,
      scope,
      metricType,
      postId,
      url,
      query,
      engine: g("engine", "검색엔진") || "미분류",
      title: g("title", "제목"),
      category,
      publishedAt: g("publishedAt", "발행일")
        ? T.date(g("publishedAt", "발행일"))
        : "",
      visitors,
      views,
      searchInflow,
      definition:
        g("definition", "지표정의") ||
        meta.definition ||
        "관리자 내보내기 정의",
      observedDate: observed,
    };
  }
  throw Error("가져오기 유형을 확인하세요.");
}
function recordKey(kind, r) {
  return {
    keywords: () => r.keyword,
    trends: () => [r.keyword, r.date, r.normalizationId].join("|"),
    competition: () => [r.keyword, r.url].join("|"),
    content: () => r.postId,
    performance: () =>
      [
        r.date,
        r.scope,
        r.metricType,
        r.postId || r.url,
        r.query,
        r.scope === "query" ? r.engine : "",
        r.definition,
      ].join("|"),
  }[kind]();
}
function preview(buffer, name, kind, platform, metadata = {}) {
  if (!["naver", "tistory"].includes(platform))
    throw Error("플랫폼을 선택하세요.");
  if (["keywords", "trends"].includes(kind) && platform !== "naver")
    throw Error(
      "검색광고·데이터랩은 네이버 측정 자료입니다. 플랫폼에서 네이버를 선택하세요.",
    );
  const table = T.parse(buffer, name),
    digest = S.hash(buffer),
    meta = {
      ...metadata,
      digest,
      fileName: name,
      sourceType: "사용자 업로드",
      sourceUrl: T.http(metadata.sourceUrl || ""),
      observedDate: T.date(metadata.observedDate),
    };
  const rows = [],
    errors = [],
    seen = new Set();
  for (const row of table.rows) {
    try {
      const r = normalise(kind, row, meta),
        key = recordKey(kind, r);
      if (seen.has(key)) throw Error("같은 키의 행이 중복됩니다.");
      seen.add(key);
      rows.push(r);
    } catch (e) {
      errors.push({ row: row._row, message: e.message });
    }
  }
  return {
    kind,
    platform,
    meta,
    rows,
    errors,
    sheet: table.sheet,
    total: table.rows.length,
  };
}
function commit(db, account, p) {
  if (p.errors?.length)
    throw Error(
      "오류 행을 수정한 뒤 다시 가져오세요. 부분 가져오기는 하지 않습니다.",
    );
  if (!p.rows.length) throw Error("가져올 데이터가 없습니다.");
  const existing = db
    .prepare(
      "SELECT id FROM ops_datasets WHERE account=? AND kind=? AND platform=? AND digest=?",
    )
    .get(account, p.kind, p.platform, p.meta.digest);
  if (existing) return { id: existing.id, duplicate: true, count: 0 };
  return S.transaction(db, () => {
    const id = S.id(),
      at = S.now();
    db.prepare("INSERT INTO ops_datasets VALUES (?,?,?,?,?,?,?)").run(
      id,
      account,
      p.kind,
      p.platform,
      p.meta.digest,
      at,
      JSON.stringify(p.meta),
    );
    const insert = db.prepare(
      "INSERT INTO ops_observations VALUES (?,?,?,?,?,?,?,?)",
    );
    for (const r of p.rows)
      insert.run(
        S.id(),
        id,
        account,
        p.kind,
        p.platform,
        recordKey(p.kind, r),
        r.observedDate || at,
        JSON.stringify(r),
      );
    S.event(db, account, id, "import", { kind: p.kind, count: p.rows.length });
    return { id, count: p.rows.length, duplicate: false };
  });
}
function ensureSeeds(db, account) {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO ops_topics VALUES (?,?,?,?,?,?,?,?,?)",
  );
  for (let i = 0; i < CATEGORIES.length; i++)
    for (const title of seeds[i]) {
      const at = S.now(),
        keyword = baseKeywords[i],
        data = {
          origin: "question_template",
          questionVerified: false,
          type: "question",
          evergreen: true,
        };
      insert.run(
        S.hash(account + "|" + title).slice(0, 32),
        account,
        keyword,
        title,
        CATEGORIES[i],
        "candidate",
        at,
        at,
        JSON.stringify(data),
      );
    }
  for (const r of S.rows(db, account, "keywords", "naver")) {
    const at = S.now();
    insert.run(
      S.hash(account + "|keyword|" + r.keyword).slice(0, 32),
      account,
      r.keyword,
      r.keyword,
      r.category,
      "candidate",
      at,
      at,
      JSON.stringify({
        origin: "measured_keyword",
        questionVerified: true,
        type: /까|방법|언제|어떻게|왜|차이|\?/.test(r.keyword)
          ? "question"
          : "keyword",
        evergreen: false,
      }),
    );
  }
}
const templates = {
  keywords: "keyword,pc,mobile,category,observedDate,광고경쟁도",
  trends: "keyword,date,ratio,observedDate",
  competition:
    "keyword,title,url,excerpt,contentType,publishedDate,gap,reason,opportunityScore,intentScore,originalityScore,observedDate",
  content:
    "postId,title,url,question,intent,answer,status,category,publishedAt,observedDate",
  performance:
    "date,scope,metricType,postId,url,title,query,engine,category,publishedAt,visitors,views,searchInflow,definition,observedDate",
};
module.exports = {
  CATEGORIES,
  inferCategory,
  normalise,
  recordKey,
  preview,
  commit,
  ensureSeeds,
  templates,
};
