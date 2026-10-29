"use strict";
const S = require("./store"),
  { day, normal } = require("./market");
const shift = (d, n) =>
  new Date(Date.parse(d + "T00:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
function windowSummary(rows, start, end, field) {
  const entries = rows.filter(
      (r) => r.date >= start && r.date <= end && r[field] != null,
    ),
    values = new Map(entries.map((r) => [r.date, r[field]])),
    days = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1,
    total = [...values.values()].reduce((s, n) => s + n, 0);
  return {
    start,
    end,
    measuredDays: values.size,
    expectedDays: days,
    total: values.size ? total : null,
    average: values.size ? total / values.size : null,
    complete: values.size === days,
  };
}
function report(db, account, history = [], reference = day()) {
  const rows = S.rows(db, account, "performance").filter(
      (r) => r.date <= reference,
    ),
    groups = new Map();
  for (const r of rows.filter(
    (r) => r.scope === "daily" && r.metricType === "daily",
  )) {
    const k = r._platform + "|" + r.definition;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const platforms = [...groups.entries()].map(([k, g]) => {
    const [platform, ...definition] = k.split("|");
    const metrics = {};
    for (const field of ["visitors", "views", "searchInflow"]) {
      const make = (n, offset = 0) =>
        windowSummary(
          g,
          shift(reference, -n + 1 - offset),
          shift(reference, -offset),
          field,
        );
      const current30 = make(30),
        previous30 = make(30, 30),
        current90 = make(90),
        previous90 = make(90, 90);
      metrics[field] = {
        today: windowSummary(g, reference, reference, field),
        last7: make(7),
        last30: current30,
        previous30,
        last90: current90,
        previous90,
        change30:
          current30.complete && previous30.complete && previous30.total > 0
            ? (current30.total - previous30.total) / previous30.total
            : null,
        change90:
          current90.complete && previous90.complete && previous90.total > 0
            ? (current90.total - previous90.total) / previous90.total
            : null,
      };
    }
    return {
      platform,
      definition: definition.join("|"),
      metrics,
      sourceIds: [...new Set(g.map((r) => r._dataset))],
    };
  });
  const posts = new Map();
  for (const r of rows.filter((r) => r.scope !== "daily")) {
    const key = [r._platform, r.postId || r.url, r.definition].join("|");
    if (!posts.has(key))
      posts.set(key, {
        platform: r._platform,
        id: r.postId,
        url: r.url,
        title: r.title,
        category: r.category,
        publishedAt: r.publishedAt,
        definition: r.definition,
        rows: [],
      });
    const post = posts.get(key);
    for (const field of ["url", "title", "category", "publishedAt"])
      if (!post[field] && r[field]) post[field] = r[field];
    post.rows.push(r);
  }
  const content = [...posts.values()].map((p) => {
    const daily = p.rows.filter(
        (r) => r.scope === "post" && r.metricType === "daily",
      ),
      published = p.publishedAt;
    const views = windowSummary(
        daily,
        shift(reference, -29),
        reference,
        "views",
      ),
      search = windowSummary(
        daily,
        shift(reference, -29),
        reference,
        "searchInflow",
      );
    const cumulative = p.rows
      .filter((r) => r.metricType === "cumulative" && r.scope === "post")
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    return {
      platform: p.platform,
      id: p.id,
      url: p.url,
      title: p.title,
      category: p.category,
      definition: p.definition,
      views30: views,
      search30: search,
      latestCumulative: cumulative
        ? {
            date: cumulative.date,
            views: cumulative.views,
            searchInflow: cumulative.searchInflow,
          }
        : null,
      after7: published
        ? {
            views: windowSummary(
              daily,
              published,
              shift(published, 6),
              "views",
            ),
            searchInflow: windowSummary(
              daily,
              published,
              shift(published, 6),
              "searchInflow",
            ),
          }
        : null,
      after28: published
        ? {
            views: windowSummary(
              daily,
              published,
              shift(published, 27),
              "views",
            ),
            searchInflow: windowSummary(
              daily,
              published,
              shift(published, 27),
              "searchInflow",
            ),
          }
        : null,
      queries: p.rows
        .filter((r) => r.scope === "query")
        .map((r) => ({
          query: r.query,
          engine: r.engine || "미분류",
          date: r.date,
          searchInflow: r.searchInflow,
          metricType: r.metricType,
          sourceId: r._id,
        })),
    };
  });
  const docs = db
      .prepare(
        "SELECT id,status,current_version,approved_version FROM ops_documents WHERE account=?",
      )
      .all(account),
    events = db
      .prepare("SELECT type,data,created_at FROM ops_events WHERE account=?")
      .all(account),
    byJob = new Map();
  for (const h of history) {
    if (!byJob.has(h.id)) byJob.set(h.id, h);
  }
  const modelEvents = events
    .filter((e) => e.type === "model_usage")
    .map((e) => JSON.parse(e.data));
  const totalTokens =
      [...byJob.values()].reduce(
        (s, h) => s + (Number.isFinite(h.token_total) ? h.token_total : 0),
        0,
      ) + modelEvents.reduce((s, e) => s + (e.total || 0), 0),
    approved = docs.filter((d) => d.approved_version != null).length;
  const categoryGroups = new Map();
  for (const p of content) {
    const k = [p.platform, p.definition, p.category || "미분류"].join("|");
    if (!categoryGroups.has(k))
      categoryGroups.set(k, {
        platform: p.platform,
        definition: p.definition,
        category: p.category || "미분류",
        views: null,
        searchInflow: null,
        measuredPosts: 0,
      });
    const g = categoryGroups.get(k);
    if (p.views30.total != null || p.search30.total != null) g.measuredPosts++;
    if (p.views30.total != null) g.views = (g.views ?? 0) + p.views30.total;
    if (p.search30.total != null)
      g.searchInflow = (g.searchInflow ?? 0) + p.search30.total;
  }
  const insights = content.map((p) => ({
    platform: p.platform,
    title: p.title,
    url: p.url,
    searchInflow: p.search30.total,
    measuredDays: p.search30.measuredDays,
    action:
      p.search30.total > 0
        ? "유입 검색어에서 새 세부 질문을 검토하세요. 같은 핵심 질문을 반복 발행하지 마세요."
        : "검색 수요·제목의 질문·정보 부족·경쟁·중복·발행 경과를 먼저 확인하세요. 측정 누락과 낮은 성과를 구분합니다.",
  }));
  content.sort(
    (a, b) =>
      (b.search30.total ?? -1) - (a.search30.total ?? -1) ||
      (b.views30.total ?? -1) - (a.views30.total ?? -1),
  );
  const agents = {};
  for (const h of byJob.values())
    for (const [name, n] of Object.entries(h.token_agents || {}))
      agents[name] = (agents[name] || 0) + n;
  for (const e of modelEvents)
    if (e.agent) agents[e.agent] = (agents[e.agent] || 0) + (e.total || 0);
  return {
    referenceDate: reference,
    platforms,
    posts: content,
    categories: [...categoryGroups.values()],
    insights,
    usage: {
      totalTokens,
      hasMeasurements:
        [...byJob.values()].some((h) => Number.isFinite(h.token_total)) ||
        modelEvents.length > 0,
      agents,
      generatedDrafts: docs.length,
      approvedDrafts: approved,
      approvalRate: docs.length ? approved / docs.length : null,
      tokensPerApproved: approved ? totalTokens / approved : null,
      rewriteAttempts:
        [...byJob.values()].reduce(
          (n, h) =>
            n +
            (h.attempts || []).reduce(
              (sum, a) =>
                sum +
                Math.max(
                  0,
                  (a.steps || []).filter((s) => s.agent === "writer" && !['image_layout','tags'].includes(s.kind)).length -
                    1,
                ),
              0,
            ),
          0,
        ) + modelEvents.filter((e) => e.agent === "writer").length,
      userRevisions: events.filter((e) => e.type === "revision_saved").length,
      apiAttempts: events.filter((e) => e.type === "api_request").length,
      apiFailures: events.filter((e) => e.type === "api_failure").length,
      failures: [...byJob.values()].filter((h) =>
        ["failed", "codex_exec_failed", "codex_usage_limit"].includes(h.status),
      ).length,
      modelFailures: events.filter((e) => e.type === "model_failure").length,
      editingSeconds: events.some(
        (e) =>
          e.type === "revision_saved" &&
          Number.isFinite(JSON.parse(e.data).editingSeconds),
      )
        ? events
            .filter((e) => e.type === "revision_saved")
            .map((e) => JSON.parse(e.data).editingSeconds)
            .filter((n) => Number.isFinite(n))
            .reduce((s, n) => s + n, 0)
        : null,
      definitions:
        "승인 비율=현재 승인 원고/등록 원고(대기 포함). 토큰은 로컬 작업 이력과 추가 검수 사용량. 편집시간은 입력 간격을 최대 30초까지 합산한 추정값이며 미수집 시간은 포함하지 않음.",
    },
    weekly: {
      from: shift(reference, -6),
      to: reference,
      insights,
      approvalEvents: events.filter(
        (e) =>
          e.type === "approved" &&
          day(Date.parse(e.created_at)) >= shift(reference, -6),
      ).length,
    },
    note: "플랫폼·지표 정의를 구분합니다. 미측정은 null, 실제 0은 0. 불완전한 기간은 측정 일수와 함께 표시하고 증감률을 계산하지 않습니다. 게시 후 7/28일은 게시일을 포함한 달력 일수입니다. 누적값을 일별 값과 합산하지 않습니다.",
  };
}
module.exports = { report, windowSummary, shift };
