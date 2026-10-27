const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const S = require("../src/lib/operations/store"),
  E = require("../src/lib/operations/editorial"),
  { Operations } = require("../src/lib/operations/service"),
  memory = require("../src/lib/writingMemory");
const opening =
  "책상에서 자주 쓰는 도구를 찾기 어렵다면 쓰는 순서부터 살펴보는 편이 좋습니다.";
const help =
  "손에 자주 닿는 도구와 드물게 사용하는 도구를 구분하면 놓을 자리를 정하기 쉽습니다.";
const article =
  opening +
  "\n\n[SECTION - 도구를 두는 기준]\n" +
  help +
  "\n\n" +
  Array.from(
    { length: 12 },
    (_, i) =>
      `${i + 1}번 도구는 사용한 뒤 돌아갈 자리를 먼저 정합니다. 자리가 정해져 있으면 꺼내는 순서와 돌려놓는 동작을 함께 살펴볼 수 있습니다.`,
  ).join("\n\n") +
  "\n\n자주 찾는 도구부터 놓아보고 실제로 손이 닿는지 확인해 보세요.";
const review = () => ({
  status: "PASS",
  articleAnswersTitle: true,
  topicPreserved: true,
  factualityPass: true,
  sourceUsePass: true,
  riskExpressionPass: true,
  publishable: true,
  naturalnessPass: true,
  naverReadabilityPass: true,
  readerValueAssessment: { openingAnswer: opening, decisionHelp: help },
  issues: [],
  revisionInstructions: [],
  humanizerDecisions: [],
});
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "folax-edit-")),
    calls = [];
  const ops = new Operations(root, {
    accounts: () => [
      { id: "a", blogId: "trafle", tistoryBlogId: "fixture-tistory" },
      { id: "b", blogId: "b" },
    ],
    settings: () => ({ publicationMode: "approval" }),
    history: () => [],
    checkSession: async () => ({ status: "valid" }),
    publish: async (platform, options) => {
      calls.push({ platform, options });
      return { published: true, url: "https://blog.naver.com/trafle/123" };
    },
    runTask: async (args) => {
      calls.push({ agent: args.agent, prompt: args.prompt });
      return { ...review(), tokenUsage: { total: 12 } };
    },
  });
  t.after(() => {
    S.close(root);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, ops, db: ops.db, calls };
}
function document(ops, extra = {}) {
  return E.create(ops.db, "a", {
    title: "도구를 두는 기준",
    article,
    data: {
      category: "생활 속 선택·비교",
      keyword: "도구 정리",
      options: { compactWriting: true, formatGuidance: null },
      research: { factBased: false, searchNeed: "skip" },
      writer: {
        status: "success",
        title: "도구를 두는 기준",
        article,
        citations: [],
        bodyImages: [],
        titleImagePrompt: "",
        titleImageText: [],
        imageOmissions: [],
      },
      ...extra,
    },
    review: review(),
  });
}
test("AI PASS is not human approval; stale approvals, unreviewed edits and wrong-account actions are rejected", async (t) => {
  const { ops, db, calls } = setup(t),
    d = document(ops);
  assert.equal(d.status, "user_review");
  assert.equal(d.approved_version, null);
  assert.throws(
    () => ops.prepare("a", d.id, { platform: "naver", confirmed: true }),
    /승인/,
  );
  assert.throws(() => ops.document("b", d.id), /이 계정/);
  assert.equal(calls.length, 0);
  const approved = ops.approve("a", d.id, { version: 1, confirmed: true });
  assert.equal(approved.approved_version, 1);
  assert.equal(memory.list(ops.root, "a").eligibleCount, 0);
  const saved = ops.save("a", d.id, {
    expectedVersion: 1,
    title: d.current.title,
    article: article.replace("좋습니다", "좋아요"),
    editingSeconds: 3,
  });
  assert.equal(saved.current_version, 2);
  assert.equal(saved.approved_version, null);
  assert.throws(
    () => ops.approve("a", d.id, { version: 2, confirmed: true }),
    /AI 검수/,
  );
  assert.throws(
    () =>
      ops.save("a", d.id, { expectedVersion: 1, title: "이전 화면", article }),
    /다른 화면/,
  );
  assert.equal(E.read(db, "a", d.id).original.article, article);
  assert.equal(calls.length, 0);
});
test("edited review calls only Main once, approval learns actual edited version and revoke removes owned sample", async (t) => {
  const { ops, calls, root } = setup(t),
    d = document(ops);
  ops.save("a", d.id, {
    expectedVersion: 1,
    title: d.current.title,
    article: article.replace("정합니다", "정해요"),
    editingSeconds: 2,
  });
  const result = await ops.review("a", d.id);
  assert.equal(result.status, "user_review");
  assert.deepEqual(
    calls.map((c) => c.agent),
    ["main"],
  );
  assert.equal(E.profile(ops.db, "a").exampleCount, 0);
  const approved = ops.approve("a", d.id, { version: 2, confirmed: true });
  assert.equal(approved.approved_version, 2);
  assert.equal(memory.list(root, "a").eligibleCount, 1);
  const profile = E.profile(ops.db, "a");
  assert.equal(profile.exampleCount, 1);
  assert(
    profile.rules.every(
      (r) =>
        r.basis[0].documentId === d.id && r.confidence.includes("한 승인본"),
    ),
  );
  assert(!JSON.stringify(profile).includes("책상에서 자주 쓰는 도구"));
  ops.revoke("a", d.id);
  assert.equal(memory.list(root, "a").eligibleCount, 0);
  assert.equal(E.profile(ops.db, "a").exampleCount, 0);
  S.close(root);
  assert.equal(E.read(S.open(root), "a", d.id).versions.length, 2);
});
test("diffs retain original and edited paragraphs and facts do not become reusable style rules", (t) => {
  const { ops } = setup(t),
    d = document(ops),
    modified = article.replace("1번 도구", "2개 도구");
  const saved = ops.save("a", d.id, {
    expectedVersion: 1,
    title: d.current.title,
    article: modified,
  });
  assert(saved.diff.paragraphs.some((p) => p.type === "removed"));
  assert(saved.diff.paragraphs.some((p) => p.type === "added"));
  assert.equal(E.profile(ops.db, "a").exampleCount, 0);
});
test("partial repair changes only selected literal paragraph, charges one Writer call and invalidates approval", async (t) => {
  const { ops, calls } = setup(t),
    d = document(ops);
  ops.hooks.runTask = async (args) => {
    calls.push({ agent: args.agent });
    return {
      after: help.replace("쉽습니다", "편합니다"),
      tokenUsage: { total: 9 },
    };
  };
  const repaired = await ops.repair("a", d.id, {
    version: 1,
    before: help,
    instruction: "마지막 표현만 단정하게",
  });
  assert.equal(repaired.current_version, 2);
  assert.equal(
    repaired.current.article,
    article.replace(help, help.replace("쉽습니다", "편합니다")),
  );
  assert.deepEqual(
    calls.map((c) => c.agent),
    ["writer"],
  );
  assert.equal(repaired.approved_version, null);
});
test("platform variants must have different body, separate review and separate human approval", async (t) => {
  const { ops } = setup(t),
    original = document(ops),
    sourceArticle=article+'\n\n'+'문'.repeat(1100-require('../src/lib/articleRequirements').articleCharacterCount(article)),
    d=ops.save('a',original.id,{expectedVersion:1,title:original.current.title,article:sourceArticle});
  ops.hooks.runTask = async () => ({
    ...d.data.writer,
    status: "success",
    article:sourceArticle,
    title: "제목만 다름",
    tokenUsage: { total: 5 },
  });
  await assert.rejects(() => ops.variant("a", d.id), /본문이 동일/);
  ops.hooks.runTask=async args=>{
    assert.equal(args.options.articleLengthPolicy,1);assert(args.prompt.includes('1000~1200자'));
    return {...d.data.writer,status:'success',article:sourceArticle.replace('좋습니다','좋아요'),title:'플랫폼별 별도 제목'};
  };
  const variant=await ops.variant('a',d.id);
  assert.equal(variant.data.options.articleLengthPolicy,1);assert.equal(variant.approved_version,null);
  const other = E.create(ops.db, "a", {
    platform: "tistory",
    title: "다른 제목",
    article:sourceArticle,
    data: d.data,
    review: review(),
  });
  ops.approve("a", other.id, { version: 1, confirmed: true });
  assert.throws(
    () => ops.prepare("a", other.id, { platform: "tistory", confirmed: true }),
    /본문이 같습니다/,
  );
  assert.equal(E.read(ops.db, "a", d.id).approved_version, null);
});
test("publication requires approval, prepared current digest and typed confirmation; one platform executes only once", async (t) => {
  const { ops, calls } = setup(t),
    d = document(ops);
  await assert.rejects(
    () => ops.publish("a", d.id, { confirmation: d.current.title }),
    /발행 준비/,
  );
  ops.approve("a", d.id, { version: 1, confirmed: true });
  ops.prepare("a", d.id, {
    platform: "naver",
    visibility: "private",
    confirmed: true,
  });
  await assert.rejects(
    () => ops.publish("a", d.id, { confirmation: "잘못된 제목" }),
    /제목/,
  );
  assert.equal(calls.length, 0);
  const published = await ops.publish("a", d.id, {
    confirmation: d.current.title,
  });
  assert.equal(published.status, "published");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].platform, "naver");
  assert.equal(calls[0].options.publishVisibility, "private");
  await assert.rejects(
    () => ops.publish("a", d.id, { confirmation: d.current.title }),
    /발행 준비/,
  );
  assert.throws(
    () => ops.prepare("a", d.id, { platform: "naver", confirmed: true }),
    /이미 발행/,
  );
});
test("uncertain results are never automatically retried and manual resolution is recorded separately", async (t) => {
  const { ops, calls } = setup(t),
    d = document(ops);
  ops.approve("a", d.id, { version: 1, confirmed: true });
  ops.prepare("a", d.id, {
    platform: "naver",
    visibility: "public",
    confirmed: true,
  });
  ops.hooks.publish = async () => {
    calls.push("publish");
    throw Error("연결 끊김");
  };
  await assert.rejects(
    () => ops.publish("a", d.id, { confirmation: d.current.title }),
    /불확실/,
  );
  const current = ops.document("a", d.id);
  assert.equal(current.publications[0].state, "uncertain");
  await assert.rejects(
    () => ops.publish("a", d.id, { confirmation: d.current.title }),
    /발행 준비/,
  );
  assert.equal(calls.length, 1);
  assert.throws(
    () =>
      ops.resolve("a", d.id, {
        publicationId: current.publications[0].id,
        decision: "published",
        url: "https://example.com/anything",
        confirmed: true,
      }),
    /플랫폼/,
  );
  const resolved = ops.resolve("a", d.id, {
    publicationId: current.publications[0].id,
    decision: "published",
    url: "https://blog.naver.com/trafle/123",
    confirmed: true,
  });
  assert.equal(resolved.status, "published");
  assert.equal(resolved.publications[0].data.result.userConfirmed, true);
});
test("recommendation generation forwards only selected topic in manual approval mode and no other topics", async (t) => {
  const { ops, calls } = setup(t),
    candidate = ops.snapshot("a").topics.candidates[0];
  ops.hooks.startJob = async (form) => {
    calls.push(form);
    return { status: "awaiting_approval", documentId: "fixture" };
  };
  const result = await ops.generate("a", candidate.id);
  assert.equal(result.status, "awaiting_approval");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].topic, candidate.title);
  assert.equal(calls[0].topicMode, "manual");
  assert.equal(calls[0].requireApproval, true);
  assert.equal(calls[0].publishAfterGenerate, false);
  assert.equal(calls[0].maxBodyImages, 0);
});
test("benchmark registration stores numeric format observations, never source prose or an approval sample", (t) => {
  const { ops } = setup(t),
    source =
      "실제 사용자 등록 텍스트의 단어가 재사용되는지 확인하는 고유한 문장입니다.\n\n".repeat(
        8,
      );
  const result = ops.addBenchmark("a", {
    url: "https://example.com/benchmark",
    text: source,
    profile: "essay",
  });
  assert.equal(result.status, "사용자 제공 텍스트 계측");
  assert(!JSON.stringify(result).includes("고유한 문장입니다"));
  assert.equal(memory.list(ops.root, "a").eligibleCount, 0);
  assert.equal(ops.snapshot("a").benchmarks.registered.length, 1);
  assert.equal(ops.snapshot("b").benchmarks.registered.length, 0);
});
test("approved images cannot be replaced on disk before publication without another human approval", async (t) => {
  const { ops, calls, root } = setup(t),
    file = path.join(root, "own-fixture.png");
  fs.writeFileSync(file, "fixture image bytes");
  const d = document(ops, {
    images: [{ role: "title", path: file }],
    writer: { status: "success", titleImagePath: file, bodyImages: [] },
  });
  assert.throws(
    () => ops.approve("a", d.id, { version: 1, confirmed: true }),
    /이미지/,
  );
  ops.approve("a", d.id, {
    version: 1,
    confirmed: true,
    imagesConfirmed: true,
  });
  ops.prepare("a", d.id, { platform: "naver", confirmed: true });
  fs.writeFileSync(file, "changed fixture image bytes");
  await assert.rejects(
    () => ops.publish("a", d.id, { confirmation: d.current.title }),
    /이미지 파일이 바뀌/,
  );
  assert.equal(calls.length, 0);
});
test("capture analysis is explicit, cached by image hash and stores only bounded layout observations", async (t) => {
  const { ops, calls, root } = setup(t),
    image = path.join(root, "capture.png");
  fs.writeFileSync(image, "test fixture, not a real screenshot");
  const entry = ops.addBenchmark("a", {
    url: "https://example.com/screen",
    capturePath: image,
  });
  assert.match(entry.status, /미확인/);
  assert.equal(calls.length, 0);
  ops.hooks.runTask = async (args) => {
    calls.push(args.agent);
    return {
      status: "success",
      imageStylePrompt: "편집 형식 관찰 전용",
      formatObservation: {
        readable: true,
        alignment: "center",
        headingCount: 2,
        paragraphCount: 6,
        features: ["소제목 사이에 짧은 문단이 있음"],
        limitations: ["캡처 바깥은 미확인"],
      },
      tokenUsage: { total: 7 },
    };
  };
  const observed = await ops.analyzeCapture("a", entry.id);
  assert.equal(observed.formatObservation.headingCount, 2);
  assert.equal((await ops.analyzeCapture("a", entry.id)).reused, true);
  assert.deepEqual(calls, ["imageStyle"]);
  assert.equal(E.profile(ops.db, "a").exampleCount, 0);
  assert.equal(memory.list(root, "a").eligibleCount, 0);
});
