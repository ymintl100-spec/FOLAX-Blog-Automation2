const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const S = require("../src/lib/operations/store"),
  { Operations } = require("../src/lib/operations/service"),
  { readSettings } = require("../src/lib/settings"),
  accounts = require("../src/lib/accountStore");
function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "folax-compat-"));
  t.after(() => {
    S.close(root);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}
test("fresh installations default to approval; legacy publication settings and PR2 approved sample are not overwritten", (t) => {
  const fresh = temp(t);
  assert.equal(readSettings(fresh).publicationMode, "approval");
  const root = temp(t),
    legacy = {
      publishVisibility: "public",
      publishScheduleMode: "reserve",
      reserveAfterHours: 5,
      tokenSaving: false,
    };
  fs.writeFileSync(
    path.join(root, "user-settings.json"),
    JSON.stringify(legacy),
  );
  const sample =
      "이전 PR #2에서 직접 등록하고 승인한 예시의 형식입니다.\n\n".repeat(10),
    store = {
      selectedAccountId: "a",
      accounts: [
        {
          id: "a",
          blogId: "trafle",
          label: "발편한 생활노트",
          approvedArticleSample: sample,
          approvedArticleApproved: true,
          approvedArticleApprovedAt: "2026-10-26T00:00:00Z",
          categories: [
            {
              id: "existing",
              name: "기존 분류",
              keyword: "기존 키워드",
              checked: true,
            },
          ],
        },
      ],
    };
  fs.writeFileSync(
    path.join(root, "account-categories.json"),
    JSON.stringify(store),
  );
  const files = ["user-settings.json", "account-categories.json"],
    before = files.map((n) => fs.readFileSync(path.join(root, n), "utf8"));
  const settings = readSettings(root);
  assert.equal(settings.publicationMode, "legacy_auto");
  assert.equal(settings.publishVisibility, "public");
  assert.equal(settings.reserveAfterHours, 5);
  const current = accounts.readAccountStore(root, settings);
  assert.equal(current.accounts[0].approvedArticleSample, sample);
  assert.equal(current.accounts[0].approvedArticleApproved, true);
  const ops = new Operations(root, {
    accounts: () => current.accounts,
    settings: () => settings,
    history: () => [],
  });
  assert.equal(ops.snapshot("a").legacyApproval.sample, sample);
  assert(ops.promptProfile("a").legacyFormat.includes("승인 예시"));
  assert.deepEqual(
    files.map((n) => fs.readFileSync(path.join(root, n), "utf8")),
    before,
  );
});
test("corrupt operations data is preserved rather than reset or silently replaced", (t) => {
  const root = temp(t),
    file = path.join(root, "content-operations.sqlite"),
    bytes = Buffer.from("corrupt fixture bytes, never real user data");
  fs.writeFileSync(file, bytes);
  assert.throws(() => S.open(root));
  assert.deepEqual(fs.readFileSync(file), bytes);
});
test("same-day concurrent API refreshes share one request and unclassified keywords are not recommended as brand expertise", async (t) => {
  const root = temp(t),
    ops = new Operations(root, {
      accounts: () => [{ id: "a", blogId: "trafle" }],
      settings: () => ({}),
      history: () => [],
      vault: {
        status: () => ({}),
        read: () => ({ apiKey: "fixture", secret: "fixture", customerId: "1" }),
      },
    });
  let calls = 0,
    release;
  const gate = new Promise((r) => (release = r));
  ops.hooks.fetch = async () => {
    calls++;
    await gate;
    return {
      ok: true,
      text: async () =>
        JSON.stringify({
          keywordList: [
            {
              relKeyword: "비트코인",
              monthlyPcQcCnt: 100,
              monthlyMobileQcCnt: 100,
            },
          ],
        }),
    };
  };
  const a = ops.refresh("a", { provider: "searchad", hints: ["비트코인"] }),
    b = ops.refresh("a", { provider: "searchad", hints: ["비트코인"] });
  release();
  await Promise.all([a, b]);
  assert.equal(calls, 1);
  const state = ops.snapshot("a");
  assert.equal(state.topics.top10.length, 0);
  const offTopic = state.topics.candidates.find(
    (t) => t.keyword === "비트코인",
  );
  assert.equal(offTopic.category, "미분류");
  assert(!offTopic.parts.some((p) => p.key === "relevance"));
});
