const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { zipSync, strToU8 } = require("fflate");
const S = require("../src/lib/operations/store"),
  T = require("../src/lib/operations/tabular"),
  D = require("../src/lib/operations/data"),
  M = require("../src/lib/operations/market"),
  A = require("../src/lib/operations/analytics"),
  { Operations } = require("../src/lib/operations/service");
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "folax-data-"));
  const ops = new Operations(root, {
    accounts: () => [
      { id: "a", blogId: "trafle" },
      { id: "b", blogId: "other" },
    ],
    settings: () => ({ publicationMode: "approval" }),
    history: () => [],
  });
  t.after(() => {
    S.close(root);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, ops, db: ops.db };
}
const meta = { observedDate: "2026-02-01" };
test("CSV handles quoted multiline Korean, UTF16 and CP949 without converting unknown counts into zero", () => {
  const csv =
    '키워드,월간검색수PC,월간검색수모바일,기준일\r\n"깔창, 교체",<10,20,2026-02-01\r\n"걷기\n운동",0,0,2026-02-01\r\n';
  const p = D.preview(Buffer.from(csv), "data.csv", "keywords", "naver", meta);
  assert.equal(p.errors.length, 0);
  assert.equal(p.rows[0].pc.value, null);
  assert.equal(p.rows[0].pc.upperBound, 10);
  assert.equal(p.rows[0].monthlySearches, null);
  assert.equal(p.rows[1].monthlySearches, 0);
  assert.equal(
    T.parse(
      Buffer.concat([Buffer.from([255, 254]), Buffer.from(csv, "utf16le")]),
      "x.csv",
    ).rows.length,
    2,
  );
  assert.equal(T.decode(Buffer.from("bec8b3e7", "hex")), "안녕");
  assert.throws(() => T.csv('a,b\n"bad'), /따옴표/);
});
test("XLSX uses workbook first-sheet order, shared and inline text, numeric Excel dates; rejects formulas", () => {
  const sheet = (formula = false) =>
    `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>pc</t></is></c><c r="C1" t="inlineStr"><is><t>mobile</t></is></c><c r="D1" t="inlineStr"><is><t>observedDate</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>깔창 &amp; 선택</t></is></c><c r="B2">${formula ? "<f>SUM(1,2)</f>" : ""}<v>0</v></c><c r="C2"><v>20</v></c><c r="D2" s="1"><v>46054</v></c></row></sheetData></worksheet>`;
  const make = (f) =>
    Buffer.from(
      zipSync({
        "xl/workbook.xml": strToU8(
          '<workbook><sheets><sheet name="첫 시트" r:id="rId2"/></sheets></workbook>',
        ),
        "xl/_rels/workbook.xml.rels": strToU8(
          '<Relationships><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
        ),
        "xl/sharedStrings.xml": strToU8("<sst><si><t>keyword</t></si></sst>"),
        "xl/styles.xml": strToU8(
          '<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
        ),
        "xl/worksheets/sheet1.xml": strToU8("<worksheet/>"),
        "xl/worksheets/sheet2.xml": strToU8(sheet(f)),
      }),
    );
  const p = D.preview(make(false), "x.xlsx", "keywords", "naver", meta);
  assert.deepEqual(p.errors, []);
  assert.equal(p.rows[0].keyword, "깔창 & 선택");
  assert.equal(p.rows[0].monthlySearches, 20);
  assert.match(p.rows[0].observedDate, /^2026-/);
  assert.throws(() => T.parse(make(true), "x.xlsx"), /수식/);
});
test("imports are transactional, account scoped, restart safe and same-file idempotent", (t) => {
  const { root, ops, db } = setup(t),
    buffer = Buffer.from("keyword,pc,mobile\n깔창,10,20\n걷기,5,15");
  const p = ops.stage("a", buffer, "valid.csv", "keywords", "naver", meta);
  assert.equal(ops.import("a", p.token).count, 2);
  const again = ops.stage("a", buffer, "valid.csv", "keywords", "naver", meta);
  assert.equal(ops.import("a", again.token).duplicate, true);
  assert.equal(S.rows(db, "b", "keywords").length, 0);
  const wrong = ops.stage("a", buffer, "valid.csv", "keywords", "naver", meta);
  assert.throws(() => ops.import("b", wrong.token), /미리보기/);
  const bad = ops.stage(
    "a",
    Buffer.from("keyword,pc,mobile\n다른,1,2\n오류,not-a-number,1"),
    "bad.csv",
    "keywords",
    "naver",
    meta,
  );
  assert.throws(() => ops.import("a", bad.token), /오류 행/);
  assert.equal(S.rows(db, "a", "keywords").length, 2);
  S.close(root);
  assert.equal(S.rows(S.open(root), "a", "keywords").length, 2);
});
test("no-data recommendations remain unverified proposals; measured TOP10 and partial scores retain provenance", (t) => {
  const { ops, db } = setup(t),
    cold = ops.snapshot("a");
  assert(cold.topics.total >= 20);
  assert.equal(cold.topics.top10.length, 0);
  assert(
    cold.topics.candidates.every((t) => t.score === null && t.demand === null),
  );
  const csv =
    "keyword,pc,mobile,category\n" +
    Array.from(
      { length: 20 },
      (_, i) =>
        "측정키워드" +
        i +
        "," +
        (i + 10) +
        "," +
        (i + 100) +
        ",신발·깔창 가이드",
    ).join("\n");
  const p = ops.stage(
    "a",
    Buffer.from(csv),
    "demand.csv",
    "keywords",
    "naver",
    meta,
  );
  ops.import("a", p.token);
  const result = ops.snapshot("a").topics;
  assert.equal(result.top10.length, 10);
  for (const item of result.top10) {
    assert.equal(item.assessedMax, 40);
    assert(item.score <= 40);
    assert.equal(
      item.demand.monthlySearches,
      item.demand.pc.value + item.demand.mobile.value,
    );
    assert.equal(item.dataDate, meta.observedDate);
    assert(item.parts.every((p) => p.evidence.length));
  }
  const top = result.top10[0];
  ops.setTopic("a", top.id, "excluded");
  assert(!ops.snapshot("a").topics.top10.some((t) => t.id === top.id));
  assert.equal(
    db.prepare("SELECT status FROM ops_topics WHERE id=?").get(top.id).status,
    "excluded",
  );
});
test("trends keep one normalization scope and never masquerade as absolute monthly demand", (t) => {
  const { db } = setup(t);
  const p = D.preview(
    Buffer.from(
      "keyword,date,ratio\n깔창,2025-11-01,10\n깔창,2025-12-01,20\n깔창,2026-01-01,40",
    ),
    "trend.csv",
    "trends",
    "naver",
    meta,
  );
  D.commit(db, "a", p);
  const trend = M.trend(S.rows(db, "a", "trends"), "깔창");
  assert.equal(trend.label, "상승");
  assert.equal(trend.points, 3);
  assert(trend.periods[3].mean > 0);
  assert.equal(trend.monthlySearches, undefined);
  const second = D.preview(
    Buffer.from("keyword,date,ratio\n깔창,2026-01-01,2"),
    "new.csv",
    "trends",
    "naver",
    { observedDate: "2026-02-02" },
  );
  D.commit(db, "a", second);
  const next = M.trend(S.rows(db, "a", "trends"), "깔창");
  assert.equal(next.points, 1);
  assert.equal(next.label, "미확인");
});
test("performance separates platforms and definitions, preserves real zero and missing days, distinguishes cumulative data", (t) => {
  const { db } = setup(t),
    csv =
      "date,scope,metricType,postId,publishedAt,visitors,views,searchInflow,definition\n2026-02-01,daily,daily,,,0,2,0,관리자 방문자\n2026-02-02,daily,daily,,,10,15,4,관리자 방문자\n2026-02-03,daily,daily,,,,2,,관리자 방문자\n2026-02-01,post,daily,p1,2026-02-01,,3,1,게시글 조회\n2026-02-02,post,cumulative,p1,2026-02-01,,20,5,게시글 조회";
  D.commit(
    db,
    "a",
    D.preview(Buffer.from(csv), "stats.csv", "performance", "naver", meta),
  );
  D.commit(
    db,
    "a",
    D.preview(
      Buffer.from(
        "date,scope,visitors,definition\n2026-02-03,daily,5,티스토리 방문자",
      ),
      "t.csv",
      "performance",
      "tistory",
      meta,
    ),
  );
  const report = A.report(db, "a", [], "2026-02-03"),
    naver = report.platforms.find((p) => p.platform === "naver");
  assert.equal(naver.metrics.visitors.last7.average, 5);
  assert.equal(naver.metrics.visitors.last7.measuredDays, 2);
  assert.equal(naver.metrics.visitors.change30, null);
  assert.equal(report.platforms.length, 2);
  assert.equal(report.posts[0].views30.total, 3);
  assert.equal(report.posts[0].latestCumulative.views, 20);
  assert.equal(report.posts[0].after7.views.measuredDays, 1);
  assert.equal(report.usage.editingSeconds, null);
});
test("official API requests use signed fixed endpoints; daily identical requests reuse persisted data and failures keep source dates", async (t) => {
  const { ops } = setup(t);
  let count = 0;
  ops.hooks.vault = {
    status: () => ({}),
    read: (p) =>
      p === "searchad"
        ? { apiKey: "fixture-api", secret: "fixture-secret", customerId: "123" }
        : { clientId: "fixture-client", clientSecret: "fixture-secret" },
  };
  ops.hooks.fetch = async (url, init) => {
    count++;
    assert(url.startsWith("https://api.searchad.naver.com/keywordstool"));
    assert(init.headers["X-Signature"]);
    assert.equal(init.headers["X-Customer"], "123");
    return {
      ok: true,
      text: async () =>
        JSON.stringify({
          keywordList: [
            {
              relKeyword: "깔창",
              monthlyPcQcCnt: "<10",
              monthlyMobileQcCnt: 20,
              compIdx: "높음",
            },
          ],
        }),
    };
  };
  const first = await ops.refresh("a", {
      provider: "searchad",
      hints: ["깔창"],
    }),
    next = await ops.refresh("a", { provider: "searchad", hints: ["깔창"] });
  assert.equal(count, 1);
  assert.equal(first.reused, false);
  assert.equal(next.reused, true);
  const source = ops.snapshot("a").topics.top10[0].demand;
  assert.equal(source.monthlySearches, null);
  assert.equal(source.adCompetition, "높음");
  const before = source.observedDate;
  ops.hooks.fetch = async () => ({ ok: false, status: 429 });
  await assert.rejects(
    () => ops.refresh("a", { provider: "searchad", hints: ["다른키워드"] }),
    /429/,
  );
  assert.equal(ops.snapshot("a").topics.top10[0].demand.observedDate, before);
  let payload;
  await M.dataLab(
    { clientId: "a", clientSecret: "b" },
    ["깔창"],
    async (url, init) => {
      payload = JSON.parse(init.body);
      assert(url.endsWith("/v1/datalab/search"));
      return { ok: true, text: async () => '{"results":[]}' };
    },
  );
  assert.equal(payload.keywordGroups.length, 1);
  assert.equal(payload.timeUnit, "month");
});
test("recommendation feedback uses recent Naver search inflow of one definition and never sums Tistory or stale traffic", (t) => {
  const { db } = setup(t),
    today = M.day();
  const upload = (platform, definition, value, date = today) =>
    D.commit(
      db,
      "a",
      D.preview(
        Buffer.from(
          "date,scope,metricType,postId,query,searchInflow,definition\n" +
            date +
            ",query,daily,p1,깔창," +
            value +
            "," +
            definition,
        ),
        platform + definition + ".csv",
        "performance",
        platform,
        { observedDate: today },
      ),
    );
  upload("naver", "기존 정의", 5);
  upload("tistory", "다른 플랫폼", 900);
  upload("naver", "최신 정의", 7);
  upload("naver", "최신 정의", 300, "2020-01-01");
  D.commit(
    db,
    "a",
    D.preview(
      Buffer.from("keyword,pc,mobile\n깔창,10,20"),
      "keyword.csv",
      "keywords",
      "naver",
      { observedDate: today },
    ),
  );
  const tpc = M.recommend(db, "a").top10.find((t) => t.keyword === "깔창");
  assert.equal(tpc.performanceSignal.searchInflow, 7);
  assert.equal(tpc.performanceSignal.platform, "naver");
  assert.equal(tpc.performanceSignal.definition, "최신 정의");
});
