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
    sourceArticle=article+'\n\n'+'문'.repeat(1500-require('../src/lib/articleRequirements').articleCharacterCount(article)),
    d=ops.save('a',original.id,{expectedVersion:1,title:original.current.title,article:sourceArticle});
  ops.hooks.runTask = async () => ({
    ...d.data.writer,
    status: "success",
    tags:Array.from({length:30},(_,i)=>"주제태그"+i),
    article:sourceArticle,
    title: "제목만 다름",
    tokenUsage: { total: 5 },
  });
  await assert.rejects(() => ops.variant("a", d.id), /본문이 동일/);
  ops.hooks.runTask=async args=>{
    assert.equal(args.options.tagCount,15);assert.equal(args.options.articleLengthPolicy,3);assert(args.prompt.includes('1400~1600자'));
    return {...d.data.writer,status:'success',tags:Array.from({length:30},(_,i)=>'주제태그'+i),article:sourceArticle.replace('좋습니다','좋아요'),title:'플랫폼별 별도 제목'};
  };
  const variant=await ops.variant('a',d.id);
  assert.equal(variant.data.options.articleLengthPolicy,3);assert.equal(variant.current.data.writer.tags.length,15);assert.equal(variant.approved_version,null);
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
test("publication requires approval and prepared current digest without title retyping; one platform executes only once", async (t) => {
  const { ops, calls } = setup(t),
    d = document(ops);
  await assert.rejects(
    () => ops.publish("a", d.id, {}),
    /발행 준비/,
  );
  ops.approve("a", d.id, { version: 1, confirmed: true });
  ops.prepare("a", d.id, {
    platform: "naver",
    visibility: "private",
    confirmed: true,
  });
  assert.equal(calls.length, 0);
  const published = await ops.publish("a", d.id);
  assert.equal(published.status, "published");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].platform, "naver");
  assert.equal(calls[0].options.publishVisibility, "private");
  await assert.rejects(
    () => ops.publish("a", d.id, {}),
    /발행 준비/,
  );
  assert.throws(
    () => ops.prepare("a", d.id, { platform: "naver", confirmed: true }),
    /이미 발행/,
  );
});
test('switching a prepared reservation to publish now uses the current choice and no delay',async t=>{
 const {ops,calls}=setup(t),d=document(ops);
 ops.approve('a',d.id,{version:1,confirmed:true});
 ops.prepare('a',d.id,{platform:'naver',visibility:'public',scheduleMode:'reserve',reserveAfterHours:3,confirmed:true});
 const preparation={version:1,visibility:'public',scheduleMode:'now',reserveAfterHours:3};
 assert.equal(ops.document('a',d.id).publications[0].data.scheduleMode,'reserve');
 await assert.rejects(()=>ops.publish('a',d.id,{preparation:{...preparation,version:0}}),/버전/);
 await ops.publish('a',d.id,{preparation});
 assert.equal(calls.length,1);assert.equal(calls[0].options.publishScheduleMode,'now');assert.equal(calls[0].options.reserveAfterHours,0);assert.equal(calls[0].options.publishVisibility,'public');
 assert.equal(ops.document('a',d.id).publications[0].data.scheduleMode,'now');
 await assert.rejects(()=>ops.publish('a',d.id,{preparation}),/이미 발행/);assert.equal(calls.length,1);
});
test('publish choice preserves reservations and still blocks an unapproved document',async t=>{
 const {ops,calls}=setup(t),d=document(ops),preparation={version:1,visibility:'public',scheduleMode:'reserve',reserveAfterHours:5};
 await assert.rejects(()=>ops.publish('a',d.id,{preparation}),/승인/);assert.equal(calls.length,0);
 ops.approve('a',d.id,{version:1,confirmed:true});await ops.publish('a',d.id,{preparation});
 assert.equal(calls[0].options.publishScheduleMode,'reserve');assert.equal(calls[0].options.reserveAfterHours,5);
});
test('publishing a legacy draft removes only the operator footer without rewriting its stored version',async t=>{
 const {ops,calls,db}=setup(t),d=document(ops);
 const raw=article+'\n\n운영: FOLAX(포렉스) / YM INTL\nCo., Ltd.';
 const digest=S.hash(d.current.title+'\n'+raw);
 db.prepare('UPDATE ops_versions SET article=?,digest=? WHERE document=? AND version=?').run(raw,digest,d.id,1);
 E.saveReview(db,'a',d.id,1,digest,review());ops.approve('a',d.id,{version:1,confirmed:true});
 ops.prepare('a',d.id,{platform:'naver',visibility:'draft',confirmed:true});
 await ops.publish('a',d.id);
 assert.equal(calls[0].options.article,article);assert.equal(calls[0].options.publishVisibility,'draft');
 assert.equal(ops.document('a',d.id).current.article,raw);
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
    () => ops.publish("a", d.id, {}),
    /불확실/,
  );
  const current = ops.document("a", d.id);
  assert.equal(current.publications[0].state, "uncertain");
  await assert.rejects(
    () => ops.publish("a", d.id, {}),
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
  await ops.generate('a',candidate.id,{images:true});
  assert.equal(calls[1].includeTitleImage,true);assert.equal(calls[1].maxBodyImages,3);assert.equal(calls[1].minimumImageCount,4);
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
    () => ops.publish("a", d.id, {}),
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

test('approved Naver publication receives all 30 tags and the stored version remains unchanged',async t=>{
 const {ops,calls}=setup(t),tags=Array.from({length:30},(_,i)=>'정리태그'+i);
 const d=document(ops,{writer:{status:'success',tags,bodyImages:[],titleImagePath:''}});
 ops.approve('a',d.id,{version:1,confirmed:true});
 await ops.publish('a',d.id,{preparation:{version:1,visibility:'public',scheduleMode:'now'}});
 assert.deepEqual(calls[0].options.tags,tags);
 assert.deepEqual(ops.document('a',d.id).current.data.writer.tags,tags);
});

test('explicit relevance analysis uses one current-version review, preserves text, and clears stale approval',async t=>{
 const {ops,calls}=setup(t),d=document(ops,{writer:{status:'success',tags:['도구정리'],bodyImages:[],titleImagePrompt:''}});
 ops.approve('a',d.id,{version:1,confirmed:true});const before=d.current.article;
 ops.hooks.runTask=async args=>{calls.push({agent:args.agent,prompt:args.prompt});assert.equal(args.options.relevancePolicy,1);return {...review(),relevanceEvidence:{primaryKeyword:'도구',answerAligned:true,answerQuote:opening,conceptChecks:[{term:'자리',quote:help,relevant:true}],tagsAligned:true,tagExamples:[{tag:'도구정리',quote:opening}],imagesAligned:true,imageChecks:[],naturalUsage:true}};};
 const result=await ops.review('a',d.id,{analyzeRelevance:true});
 assert.equal(result.current.article,before);assert.equal(result.current_version,1);assert.equal(result.approved_version,null);assert.equal(result.relevanceReport.score,100);assert.equal(calls.length,1);assert.equal(calls[0].agent,'main');
 const edited=ops.save('a',d.id,{expectedVersion:1,title:result.current.title,article:before+'\n\n수정본은 새로운 검수를 받아야 합니다.'});assert.equal(edited.relevanceReport.score,null);
});
for(const repeat of [false,true])test(`saved-document review corrects only the invalid review scope once (repeat=${repeat})`,async t=>{
 const {ops,calls}=setup(t),d=document(ops);let count=0;
 const bad={...review(),status:'REVISION',publishable:false,failureReason:'필수 이미지 4장의 생성 결과가 제공되지 않아 발행 준비 완료로 판정할 수 없습니다.'};
 ops.hooks.runTask=async args=>{calls.push(args);return ++count===1||repeat?bad:review();};
 if(repeat)await assert.rejects(()=>ops.review('a',d.id),/이미지 생성 전 검수/);
 else{const result=await ops.review('a',d.id);assert.equal(result.status,'user_review');assert.equal(result.approved_version,null);}
 assert.equal(count,2);assert(calls.every(c=>c.agent==='main'));const stored=ops.document('a',d.id);assert.equal(stored.current_version,1);assert.equal(stored.current.article,d.current.article);
});

test('explicit simplification uses one Writer call, keeps source/images/tags and stores a new unapproved version',async t=>{
 const {ops,calls}=setup(t);
 const base=article+'\n\n2025년 기록을 읽고 필요한 물건을 구분합니다.\n[IMAGE INSERT - 1]';
 const length=require('../src/lib/articleRequirements').articleCharacterCount(base),body=base+'\n\n'+'설'.repeat(1100-length);
 const d=E.create(ops.db,'a',{title:'도구를 두는 기준',article:body,data:{options:{articleLengthPolicy:1},writer:{title:'도구를 두는 기준',article:body,tags:['도구정리'],citations:[{sourceId:'kept-source'}],bodyImages:[{sequence:1,sectionHeading:'도구를 두는 기준',prompt:'보존할 그림 설명',path:'existing-fixture.png'}]},images:[]}});
 ops.hooks.runTask=async args=>{calls.push(args);assert.equal(args.agent,'writer');assert(args.prompt.includes('한 문장에는 핵심 뜻 하나'));assert(args.prompt.includes('1000~1200자'));return {after:body.replace('도구를 찾기 어렵다면','도구를 찾기 힘들다면'),reason:'쉬운 표현으로 수정'};};
 const result=await ops.simplify('a',d.id,{version:1});assert.equal(calls.length,1);assert.equal(result.current_version,2);assert.equal(result.approved_version,null);assert.equal(result.original.article,body);assert(result.current.article.includes('도구를 찾기 힘들다면'));assert.equal(result.current.data.writer.bodyImages[0].path,'existing-fixture.png');assert.deepEqual(result.current.data.writer.tags,['도구정리']);assert.deepEqual(result.current.data.writer.citations,[{sourceId:'kept-source'}]);assert.equal(result.reviews.length,0);
 await assert.rejects(()=>ops.simplify('a',d.id,{version:1}),/저장한 원고/);assert.equal(calls.length,1);
});
test('prose simplification merges definition/filler into direct action while retaining the 1500-character job and assets',async t=>{
 const {ops,calls}=setup(t),L=require('../src/lib/articleRequirements');
 const redundant='체중 조절은 발에 싣는 몸의 무게를 바꿔 자극을 맞추는 거예요.';
 const action='발을 천천히 올리고 편한 만큼만 체중을 실어 보세요.';
 const base=action+'\n\n'+redundant+'\n\n'+article+'\n\n[IMAGE INSERT - 1]';
 // Length padding is fixture data; this test checks routing/version/asset preservation, not live model prose quality.
 const body=base+'\n\n'+'검'.repeat(1500-L.articleCharacterCount(base)),after=body.replace(redundant+'\n\n','');
 const tags=Array.from({length:15},(_,i)=>'태그'+i),images=[{sequence:1,sectionHeading:'도구를 두는 기준',prompt:'보존할 설명',path:'existing-prose-fixture.png'}];
 const d=E.create(ops.db,'a',{title:'기존 제목',article:body,data:{options:{articleLengthPolicy:3,tagCount:15,maxAutoRetries:5},writer:{title:'기존 제목',article:body,tags,citations:[{sourceId:'preserved-source',url:'https://example.org/source'}],bodyImages:images}}});
 ops.hooks.runTask=async args=>{calls.push(args);assert.equal(args.agent,'writer');assert(args.prompt.includes('앞에 이미 그 행동이 있으면 정의 문장만 삭제한다'));assert(args.prompt.includes('1400~1600자'));assert(args.prompt.includes('원고에 이미 있는 정보만 사용'));return {after,reason:'행동 뒤의 불필요한 정의를 삭제'};};
 const updated=await ops.simplify('a',d.id,{version:1});
 assert.equal(calls.length,1);assert.equal(updated.current_version,2);assert.equal(updated.current.title,'기존 제목');assert.equal(updated.current.article,after);assert.equal(updated.original.article,body);assert.equal(updated.approved_version,null);
 assert.deepEqual(updated.current.data.writer.tags,tags);assert.deepEqual(updated.current.data.writer.bodyImages,images);assert.equal(updated.current.data.writer.citations[0].sourceId,'preserved-source');assert.equal(updated.data.options.articleLengthPolicy,3);assert.equal(updated.data.options.maxAutoRetries,5);assert.equal(L.articleLengthIssue(updated.current,{articleLengthPolicy:3}),'');
});
for(const defect of ['marker','number','length'])test(`simplification preserves the original draft when ${defect} is changed`,async t=>{
 const {ops,calls}=setup(t),body=article+'\n\n2025년 기록을 확인해 설명합니다.\n[IMAGE INSERT - 1]',d=E.create(ops.db,'a',{title:'도구를 두는 기준',article:body,data:{options:{compactWriting:true},writer:{bodyImages:[]}}});
 ops.hooks.runTask=async args=>{calls.push(args);return {after:defect==='marker'?body.replace('[IMAGE INSERT - 1]',''):defect==='number'?body.replace('2025','2026'):'[SECTION - 도구를 두는 기준]\n[IMAGE INSERT - 1]\n'+(body.replace(/\[(?:SECTION|IMAGE INSERT)[^\]]*\]/g,'').match(/\d+(?:[.,:/-]\d+)*/g)||[]).join(' ')};};
 await assert.rejects(()=>ops.simplify('a',d.id,{version:1}),/보존|분량/);const stored=ops.document('a',d.id);assert.equal(stored.current_version,1);assert.equal(stored.current.article,body);assert.equal(calls.length,1);
});
