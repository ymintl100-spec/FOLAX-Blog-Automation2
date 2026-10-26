"use strict";
const crypto = require("node:crypto"),
  S = require("./store"),
  D = require("./data");
const day = (now = Date.now()) =>
  new Date(now + 9 * 3600000).toISOString().slice(0, 10);
const normal = (s) =>
  String(s || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
function overlap(a, b) {
  a = normal(a);
  b = normal(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (s) =>
      new Set(
        Array.from({ length: Math.max(0, s.length - 2) }, (_, i) =>
          s.slice(i, i + 3),
        ),
      ),
    x = grams(a),
    y = grams(b);
  if (!x.size || !y.size) return 0;
  return [...x].filter((v) => y.has(v)).length / Math.max(x.size, y.size);
}
function duplicate(topic, known) {
  let best = null;
  for (const item of known) {
    if (item.id === topic.id) continue;
    const value = Math.max(
      overlap(topic.title, item.question || item.title),
      overlap(topic.question || topic.title, item.question || ""),
    );
    if (value > 0.65 && (!best || value > best.similarity))
      best = {
        id: item.id,
        title: item.title,
        similarity: value,
        status: value >= 0.95 ? "existing" : "similar",
        source: item.source || "기획 DB",
      };
  }
  return best || { status: "new", similarity: null };
}
function trend(rows, keyword) {
  const raw = rows.filter((r) => normal(r.keyword) === normal(keyword));
  if (!raw.length) return { label: "미확인", periods: {}, points: 0 };
  const latest = raw[0];
  const series = raw
    .filter(
      (r) =>
        r._dataset === latest._dataset &&
        r.normalizationId === latest.normalizationId,
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  const periods = {};
  for (const months of [1, 3, 6, 12]) {
    const date = new Date(series.at(-1).date + "T00:00:00Z");
    date.setUTCMonth(date.getUTCMonth() - months);
    const p = series.filter((r) => r.date > date.toISOString().slice(0, 10));
    periods[months] = {
      label:
        p.length >= 3
          ? p.at(-1).ratio > p[0].ratio * 1.2
            ? "상승"
            : p.at(-1).ratio < p[0].ratio * 0.8
              ? "하락"
              : "유지"
          : "미확인",
      mean: p.length ? p.reduce((s, r) => s + r.ratio, 0) / p.length : null,
      points: p.length,
      from: p[0]?.date || null,
      to: p.at(-1)?.date || null,
    };
  }
  if (series.length < 3)
    return {
      label: "미확인",
      periods,
      points: series.length,
      source: latest._source,
      normalizationId: latest.normalizationId,
    };
  const n = Math.max(1, Math.floor(series.length / 3)),
    mean = (x) => x.reduce((s, r) => s + r.ratio, 0) / x.length,
    first = mean(series.slice(0, n)),
    last = mean(series.slice(-n)),
    change = first > 0 ? (last - first) / first : null;
  let label =
    change == null
      ? last > 0
        ? "상승"
        : "미확인"
      : change > 0.2
        ? "상승"
        : change < -0.2
          ? "하락"
          : "유지";
  const monthly = new Map(series.map((r) => [r.date.slice(0, 7), r.ratio])),
    months = [...monthly.keys()]
      .slice(-24)
      .map((s) => Number(s.slice(0, 4)) * 12 + Number(s.slice(5)));
  if (
    monthly.size >= 24 &&
    months.every((n, i) => !i || n === months[i - 1] + 1)
  ) {
    const v = [...monthly.values()].slice(-24),
      a = v.slice(0, 12),
      b = v.slice(12),
      ma = a.reduce((s, n) => s + n, 0) / 12,
      mb = b.reduce((s, n) => s + n, 0) / 12;
    const cov = a.reduce((s, n, i) => s + (n - ma) * (b[i] - mb), 0),
      va = a.reduce((s, n) => s + (n - ma) ** 2, 0),
      vb = b.reduce((s, n) => s + (n - mb) ** 2, 0);
    if (
      va &&
      vb &&
      cov / Math.sqrt(va * vb) > 0.65 &&
      Math.sqrt(vb / 12) > mb * 0.25
    )
      label = "계절형";
  }
  return {
    label,
    periods,
    points: series.length,
    change,
    source: latest._source,
    observedDate: latest.observedDate,
    normalizationId: latest.normalizationId,
    definition: "한 수집 묶음 안의 상대지수 변화. 실제 검색횟수가 아님.",
  };
}
function recommend(db, account, { known = [], filters = {} } = {}) {
  D.ensureSeeds(db, account);
  const keywords = S.rows(db, account, "keywords", "naver"),
    trends = S.rows(db, account, "trends", "naver"),
    competition = S.rows(db, account, "competition"),
    perf = S.rows(db, account, "performance");
  const topics = db
    .prepare("SELECT * FROM ops_topics WHERE account=?")
    .all(account)
    .map((r) => ({ ...r, ...JSON.parse(r.data) }));
  const candidates = topics
    .filter((t) => !["excluded", "archived", "published"].includes(t.status))
    .map((t) => {
      const demand = keywords.find(
          (k) => normal(k.keyword) === normal(t.keyword),
        ),
        related = competition.filter(
          (c) => normal(c.keyword) === normal(t.keyword),
        ),
        trendInfo = trend(trends, t.keyword),
        dup = duplicate(t, known),
        parts = [];
      if (demand?.monthlySearches != null) {
        const n = demand.monthlySearches,
          points =
            n >= 10000
              ? 20
              : n >= 1000
                ? 16
                : n >= 100
                  ? 12
                  : n >= 10
                    ? 8
                    : n > 0
                      ? 4
                      : 0;
        parts.push({
          key: "demand",
          points,
          max: 20,
          reason: "핵심 키워드 실제 월간 검색량 구간에 따른 내부 편집 배점",
          evidence: [demand._id],
        });
      }
      const evidence = related.find(
        (c) => c.excerpt && c.reason && c.opportunityScore != null,
      );
      if (evidence)
        parts.push({
          key: "opportunity",
          points: evidence.opportunityScore,
          max: 20,
          reason: evidence.reason,
          evidence: [evidence._id],
        });
      if (demand && D.CATEGORIES.includes(demand.category))
        parts.push({
          key: "relevance",
          points: 20,
          max: 20,
          reason: demand.categoryBasis + ": " + demand.category,
          evidence: [demand._id],
        });
      for (const [key, field, max] of [
        ["intent", "intentScore", 15],
        ["originality", "originalityScore", 15],
      ]) {
        const row = related.find(
          (c) => c.excerpt && c.reason && c[field] != null,
        );
        if (row)
          parts.push({
            key,
            points: row[field],
            max,
            reason: row.reason,
            evidence: [row._id],
          });
      }
      if (trendInfo.points >= 3 && trendInfo.label !== "미확인")
        parts.push({
          key: "trend",
          points:
            trendInfo.label === "상승"
              ? 10
              : trendInfo.label === "유지"
                ? 8
                : trendInfo.label === "계절형"
                  ? 6
                  : 3,
          max: 10,
          reason: trendInfo.definition,
          evidence: [trendInfo.normalizationId],
        });
      const score = parts.length
          ? parts.reduce((s, p) => s + p.points, 0)
          : null,
        assessedMax = parts.reduce((s, p) => s + p.max, 0),
        measured = perf.filter(
          (p) =>
            p.scope === "query" &&
            p.metricType === "daily" &&
            p._platform === "naver" &&
            p.date >=
              new Date(Date.parse(day() + "T00:00:00Z") - 29 * 86400000)
                .toISOString()
                .slice(0, 10) &&
            p.date <= day() &&
            p.searchInflow != null &&
            normal(p.query) === normal(t.keyword),
        ),
        signal = measured.filter(
          (p) => p.definition === measured[0]?.definition,
        );
      return {
        ...t,
        demand: demand || null,
        trend: trendInfo,
        competition: related,
        duplicate: dup,
        score,
        assessedMax,
        confidence:
          assessedMax >= 80 ? "높음" : assessedMax >= 50 ? "중간" : "낮음",
        parts,
        performanceSignal: signal.length
          ? {
              platform: "naver",
              definition: signal[0].definition,
              window: "최근 30일의 실제 관측일",
              searchInflow: signal.reduce((s, p) => s + p.searchInflow, 0),
              observations: signal.length,
              sourceIds: signal.map((p) => p._id),
            }
          : null,
        reasons: parts
          .map((p) => p.reason)
          .concat(
            !demand
              ? ["검색 수요 미확인: 질문 제안이며 검증된 인기 주제가 아닙니다."]
              : t.origin === "question_template"
                ? [
                    "검색량은 핵심 키워드 기준이며 질문 문장 자체의 검색량은 미확인입니다.",
                  ]
                : [],
            dup.status !== "new"
              ? [
                  "기존 콘텐츠와 " +
                    (dup.status === "existing" ? "중복" : "유사") +
                    " 가능성",
                ]
              : [],
          ),
        dataDate: demand?.observedDate || null,
      };
    });
  let selected = candidates.filter(
    (t) =>
      (!filters.category || t.category === filters.category) &&
      (!filters.trend || t.trend.label === filters.trend) &&
      (!filters.type ||
        t.type === filters.type ||
        (filters.type === "evergreen" && t.evergreen) ||
        (filters.type === "seasonal" && t.trend.label === "계절형")) &&
      (!filters.excludeDuplicate || t.duplicate.status === "new") &&
      (!filters.minVolume ||
        (t.demand?.monthlySearches != null &&
          t.demand.monthlySearches >= Number(filters.minVolume))),
  );
  selected.sort((a, b) =>
    filters.sort === "volume"
      ? (b.demand?.monthlySearches ?? -1) - (a.demand?.monthlySearches ?? -1)
      : filters.sort === "new"
        ? b.created_at.localeCompare(a.created_at)
        : (b.score ?? -1) - (a.score ?? -1) ||
          b.assessedMax - a.assessedMax ||
          (b.performanceSignal?.searchInflow ?? -1) -
            (a.performanceSignal?.searchInflow ?? -1) ||
          a.title.localeCompare(b.title),
  );
  return {
    top10: selected
      .filter((t) => t.demand && D.CATEGORIES.includes(t.category))
      .slice(0, 10)
      .map((t, i) => ({ ...t, rank: i + 1 })),
    candidates: selected,
    total: candidates.length,
    coverage: {
      importedContent: S.rows(db, account, "content").length,
      localKnown: known.length,
      note: "등록·가져오기한 자료만 비교합니다. 미연결 공개글·임시저장·예약글 전체를 확인한 것이 아닙니다.",
    },
    generatedAt: S.now(),
    rubric: {
      demand: 20,
      opportunity: 20,
      relevance: 20,
      intent: 15,
      originality: 15,
      trend: 10,
    },
    scoreNote:
      "확인한 항목의 점수 합 / 100, 평가한 배점 별도 표시. 미평가를 0점으로 단정하거나 100점으로 환산하지 않음. 신뢰 표시는 평가 항목의 자료 충족도이며 출처 진실성·검색 순위의 보장이 아님.",
  };
}
async function jsonFetch(url, init = {}, fetcher = fetch) {
  const r = await fetcher(url, { ...init, signal: AbortSignal.timeout(25000) });
  if (!r.ok)
    throw Error(
      "공식 API 요청 실패 (HTTP " +
        r.status +
        "). 이전 수치를 최신으로 바꾸지 않습니다.",
    );
  const text = await r.text();
  if (text.length > 3e6) throw Error("API 응답이 너무 큽니다.");
  return JSON.parse(text);
}
async function searchAd(keys, hints, fetcher) {
  if (!keys.apiKey || !keys.secret || !/^\d+$/.test(keys.customerId || ""))
    throw Error("검색광고 API 키·비밀키·고객 ID를 설정하세요.");
  if (
    !Array.isArray(hints) ||
    hints.length < 1 ||
    hints.length > 5 ||
    hints.some((s) => typeof s !== "string" || s.length > 80)
  )
    throw Error("검색광고 키워드는 한 번에 1~5개입니다.");
  const timestamp = String(Date.now()),
    uri = "/keywordstool";
  return jsonFetch(
    "https://api.searchad.naver.com" +
      uri +
      "?" +
      new URLSearchParams({
        hintKeywords: hints.map((s) => s.replace(/\s/g, "")).join(","),
        showDetail: "1",
      }),
    {
      headers: {
        "X-Timestamp": timestamp,
        "X-API-KEY": keys.apiKey,
        "X-Customer": keys.customerId,
        "X-Signature": crypto
          .createHmac("sha256", keys.secret)
          .update(timestamp + ".GET." + uri)
          .digest("base64"),
      },
    },
    fetcher,
  );
}
async function dataLab(keys, keywords, fetcher) {
  if (!keys.clientId || !keys.clientSecret)
    throw Error("데이터랩 애플리케이션 Client ID·Secret을 설정하세요.");
  if (!Array.isArray(keywords) || !keywords.length || keywords.length > 5)
    throw Error("데이터랩은 한 번에 1~5개 키워드를 선택하세요.");
  const end = day(),
    start = new Date(end + "T00:00:00Z");
  start.setUTCMonth(start.getUTCMonth() - 12);
  return jsonFetch(
    "https://openapi.naver.com/v1/datalab/search",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Naver-Client-Id": keys.clientId,
        "X-Naver-Client-Secret": keys.clientSecret,
      },
      body: JSON.stringify({
        startDate: start.toISOString().slice(0, 10),
        endDate: end,
        timeUnit: "month",
        keywordGroups: keywords.map((k) => ({ groupName: k, keywords: [k] })),
      }),
    },
    fetcher,
  );
}
module.exports = {
  day,
  normal,
  overlap,
  duplicate,
  trend,
  recommend,
  jsonFetch,
  searchAd,
  dataLab,
};
