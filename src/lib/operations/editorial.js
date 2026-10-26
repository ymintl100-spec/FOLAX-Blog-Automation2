"use strict";
const fs = require("node:fs"),
  S = require("./store"),
  { inspect } = require("../blogLayout"),
  { articleCharacterCount } = require("../articleRequirements");
const { omitReferences } = require("../publicationFormat");
const textHash = (title, article) => S.hash(title + "\n" + article);
function owned(db, account, id) {
  const d = db
    .prepare("SELECT * FROM ops_documents WHERE id=? AND account=?")
    .get(id, account);
  if (!d) throw Error("이 계정의 원고를 선택하세요.");
  return { ...d, data: JSON.parse(d.data) };
}
function versions(db, document) {
  return db
    .prepare(
      "SELECT * FROM ops_versions WHERE document=? ORDER BY version DESC",
    )
    .all(document)
    .map((v) => ({ ...v, data: JSON.parse(v.data) }));
}
function read(db, account, id) {
  const d = owned(db, account, id);
  d.versions = versions(db, id);
  d.current = d.versions.find((v) => v.version === d.current_version);
  d.reviews = db
    .prepare(
      "SELECT * FROM ops_reviews WHERE document=? ORDER BY created_at DESC,rowid DESC",
    )
    .all(id)
    .map((r) => ({ ...r, data: JSON.parse(r.data) }));
  d.publications = db
    .prepare(
      "SELECT * FROM ops_publications WHERE document=? ORDER BY created_at DESC,rowid DESC",
    )
    .all(id)
    .map((r) => ({ ...r, data: JSON.parse(r.data) }));
  d.approvalHistory = db
    .prepare(
      "SELECT type,created_at,data FROM ops_events WHERE entity=? AND type IN ('approved','approval_revoked') ORDER BY created_at DESC,rowid DESC",
    )
    .all(id)
    .map((e) => ({ ...e, data: JSON.parse(e.data) }));
  d.original = d.versions.at(-1);
  d.diff = diff(d.original?.article || "", d.current.article);
  return d;
}
function list(db, account) {
  return db
    .prepare(
      "SELECT d.id,d.account,d.topic_id,d.platform,d.status,d.current_version,d.approved_version,d.created_at,d.updated_at,v.title,v.digest,json_extract(d.data,'$.question') AS question,json_extract(d.data,'$.category') AS category,json_extract(d.data,'$.jobId') AS jobId FROM ops_documents d JOIN ops_versions v ON v.document=d.id AND v.version=d.current_version WHERE d.account=? ORDER BY d.updated_at DESC",
    )
    .all(account)
    .map((r) => ({
      ...r,
      data: {
        question: r.question || "",
        category: r.category || "",
        jobId: r.jobId || "",
      },
    }));
}
function create(
  db,
  account,
  {
    topicId = null,
    platform = "naver",
    title,
    article,
    data = {},
    review = null,
  },
) {
  if (!["naver", "tistory"].includes(platform))
    throw Error("플랫폼을 확인하세요.");
  validate(title, article);
  article = omitReferences(article);
  const document = S.id(),
    at = S.now(),
    digest = textHash(title, article);
  return S.transaction(db, () => {
    db.prepare("INSERT INTO ops_documents VALUES (?,?,?,?,?,?,?,?,?,?)").run(
      document,
      account,
      topicId,
      platform,
      review ? "user_review" : "draft",
      1,
      null,
      at,
      at,
      JSON.stringify(data),
    );
    db.prepare("INSERT INTO ops_versions VALUES (?,?,?,?,?,?,?,?)").run(
      S.id(),
      document,
      1,
      digest,
      title,
      article,
      at,
      JSON.stringify({
        source: "ai",
        images: data.images || [],
        writer: data.writer || {},
        editingSeconds: null,
      }),
    );
    if (review)
      saveReview(db, account, document, 1, digest, review, { initial: true });
    S.event(db, account, document, "draft_created", { platform, topicId });
    if (topicId)
      db.prepare(
        "UPDATE ops_topics SET status=?,updated_at=? WHERE id=? AND account=?",
      ).run("user_review", at, topicId, account);
    return read(db, account, document);
  });
}
function validate(title, article) {
  if (
    typeof title !== "string" ||
    !title.trim() ||
    title.length > 200 ||
    typeof article !== "string" ||
    !article.trim() ||
    article.length > 30000
  )
    throw Error("제목(1~200자)과 원고(최대 30,000자)를 확인하세요.");
}
function save(
  db,
  account,
  id,
  { title, article, editingSeconds = null, expectedVersion },
) {
  validate(title, article);
  article = omitReferences(article);
  const d = read(db, account, id);
  if (Number(expectedVersion) !== d.current_version)
    throw Error("다른 화면에서 원고가 변경됐습니다. 다시 불러오세요.");
  if (d.publications.some((p) => ["running", "uncertain"].includes(p.state)))
    throw Error("발행 결과를 확인하기 전에는 원고를 수정하지 마세요.");
  const digest = textHash(title, article);
  if (digest === d.current.digest) return d;
  const markers = new Set(
      [...article.matchAll(/\[IMAGE INSERT\s*-\s*(\d+)\]/g)].map((m) =>
        Number(m[1]),
      ),
    ),
    writer = { ...d.current.data.writer };
  if (Array.isArray(writer.bodyImages))
    writer.bodyImages = writer.bodyImages
      .filter((i) => markers.has(Number(i.sequence)))
      .map((i) => {
        const index = article.indexOf("[IMAGE INSERT - " + i.sequence + "]"),
          headings = [
            ...article
              .slice(0, index)
              .matchAll(/^\[SECTION\s*-\s*([^\]]+)\]\s*$/gm),
          ];
        return { ...i, sectionHeading: headings.at(-1)?.[1]?.trim() || "본문" };
      });
  const images = (d.current.data.images || []).filter(
    (i) => i.role === "title" || markers.has(Number(i.sequence)),
  );
  if (
    editingSeconds !== null &&
    (!Number.isFinite(editingSeconds) ||
      editingSeconds < 0 ||
      editingSeconds > 86400)
  )
    throw Error("편집 시간을 확인하세요.");
  return S.transaction(db, () => {
    const n = d.current_version + 1,
      at = S.now();
    db.prepare("INSERT INTO ops_versions VALUES (?,?,?,?,?,?,?,?)").run(
      S.id(),
      id,
      n,
      digest,
      title,
      article,
      at,
      JSON.stringify({
        ...d.current.data,
        writer,
        images,
        source: "user_edit",
        editingSeconds,
      }),
    );
    db.prepare(
      "UPDATE ops_documents SET current_version=?,approved_version=NULL,status=?,updated_at=? WHERE id=?",
    ).run(n, "revision", at, id);
    S.event(db, account, id, "revision_saved", {
      version: n,
      editingSeconds,
      previousVersion: d.current_version,
    });
    return read(db, account, id);
  });
}
function saveReview(db, account, id, version, digest, review, meta = {}) {
  const d = owned(db, account, id);
  if (d.current_version !== version)
    throw Error(
      "검수 중 원고가 바뀌었습니다. 검수 결과는 현재 원고에 적용하지 않습니다.",
    );
  const v = versions(db, id).find((v) => v.version === version);
  if (v.digest !== digest) throw Error("검수 원고 해시가 다릅니다.");
  const pass = review.status === "PASS" && review.publishable === true;
  db.prepare("INSERT INTO ops_reviews VALUES (?,?,?,?,?,?,?)").run(
    S.id(),
    id,
    version,
    digest,
    pass ? "PASS" : review.status || "BLOCK",
    S.now(),
    JSON.stringify({ ...review, ...meta }),
  );
  db.prepare(
    "UPDATE ops_documents SET status=?,approved_version=NULL,updated_at=? WHERE id=?",
  ).run(pass ? "user_review" : "revision", S.now(), id);
  S.event(db, account, id, "ai_reviewed", {
    version,
    status: pass ? "PASS" : review.status,
  });
  return pass;
}
function assetHashes(document) {
  const writer = document.current.data.writer || document.data.writer || {},
    paths = [
      ...(document.current.data.images || []).map((i) => i.path),
      writer.titleImagePath,
      ...(writer.bodyImages || []).map((i) => i.path),
    ].filter(Boolean);
  return [...new Set(paths)].sort().map((file) => {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile())
      throw Error(
        "이미지 파일이 없습니다. 이미지를 복구한 뒤 다시 승인하세요.",
      );
    if (fs.statSync(file).size > 64 * 1024 * 1024)
      throw Error("이미지는 파일당 64MB 이내여야 합니다.");
    return {
      path: file,
      size: fs.statSync(file).size,
      sha256: S.hash(fs.readFileSync(file)),
    };
  });
}
function approve(db, account, id, { version, confirmed, imagesConfirmed }) {
  const d = read(db, account, id);
  if (confirmed !== true) throw Error("사용자 최종 승인 확인이 필요합니다.");
  if (version !== d.current_version)
    throw Error("현재 버전을 다시 확인하세요.");
  const review = d.reviews.find(
    (r) => r.version === version && r.digest === d.current.digest,
  );
  if (!review || review.status !== "PASS")
    throw Error("현재 수정본의 AI 검수를 먼저 통과해야 합니다.");
  const assets = assetHashes(d);
  if (assets.length && imagesConfirmed !== true)
    throw Error("현재 버전의 이미지와 설명을 직접 확인하세요.");
  d.data.approvedAssets = assets;
  db.prepare(
    "UPDATE ops_documents SET approved_version=?,status=?,updated_at=?,data=? WHERE id=?",
  ).run(version, "approved", S.now(), JSON.stringify(d.data), id);
  S.event(db, account, id, "approved", {
    version,
    digest: d.current.digest,
    assets,
    imagesConfirmed: imagesConfirmed === true,
  });
  return read(db, account, id);
}
function revoke(db, account, id) {
  const d = read(db, account, id);
  if (d.publications.some((p) => ["running", "uncertain"].includes(p.state)))
    throw Error("발행 결과 확인이 먼저 필요합니다.");
  db.prepare(
    "UPDATE ops_documents SET approved_version=NULL,status=?,updated_at=? WHERE id=?",
  ).run("user_review", S.now(), id);
  S.event(db, account, id, "approval_revoked", { version: d.approved_version });
  return read(db, account, id);
}
function diff(before, after) {
  const a = String(before)
      .split(/\n\s*\n/)
      .slice(0, 200),
    b = String(after)
      .split(/\n\s*\n/)
      .slice(0, 200),
    dp = Array.from(
      { length: a.length + 1 },
      () => new Uint16Array(b.length + 1),
    );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] =
        a[i] === b[j]
          ? 1 + dp[i + 1][j + 1]
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let i = 0,
    j = 0;
  const out = [];
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push({ type: "same", text: a[i++] });
      j++;
    } else if (j < b.length && (i === a.length || dp[i][j + 1] >= dp[i + 1][j]))
      out.push({ type: "added", text: b[j++] });
    else out.push({ type: "removed", text: a[i++] });
  }
  return {
    paragraphs: out,
    truncated:
      before.split(/\n\s*\n/).length > 200 ||
      after.split(/\n\s*\n/).length > 200,
  };
}
const median = (nums) => {
  const a = nums.sort((a, b) => a - b);
  return a.length
    ? Math.round(
        (a[Math.floor((a.length - 1) / 2)] + a[Math.floor(a.length / 2)]) / 2,
      )
    : null;
};
function profile(db, account) {
  const prefs = S.meta(db, "style:" + account, {
      enabled: true,
      instructions: "",
      rules: [],
    }),
    approved = db
      .prepare(
        "SELECT d.id,d.current_version,v.title,v.article,v.digest,o.digest AS original_digest FROM ops_documents d JOIN ops_versions v ON v.document=d.id AND v.version=d.current_version JOIN ops_versions o ON o.document=d.id AND o.version=1 WHERE d.account=? AND d.approved_version=d.current_version",
      )
      .all(account)
      .filter((d) => d.original_digest !== d.digest);
  const examples = approved.map((d) => ({
    id: d.id,
    version: d.current_version,
    title: d.title,
    article: d.article,
    layout: inspect(d.article),
  }));
  const evidence = examples.map((e) => ({
    id: e.id,
    version: e.version,
    characters: articleCharacterCount(e.article),
    sections: e.layout.sections.length,
    paragraphs: e.layout.stats.paragraphCount,
    lineCharacters: e.layout.stats.typicalLineCharacters,
    paragraphCharacters: e.layout.stats.typicalParagraphCharacters,
    faq: /FAQ|자주\s*묻는\s*질문/i.test(e.article),
    checklist: /체크리스트|☑|✔/.test(e.article),
    openingCharacters: articleCharacterCount(
      e.layout.sections.length ? e.layout.opening : e.layout.paragraphs[0],
    ),
    closingCharacters: articleCharacterCount(e.layout.paragraphs.at(-1)),
    sentenceCharacters: median(
      omitReferences(e.article)
        .replace(/\[(?:SECTION|IMAGE)[^\]]*\]/g, "")
        .split(/[.!?。]\s|\n/)
        .map((s) => s.replace(/\s/g, "").length)
        .filter((n) => n > 0),
    ),
    images: [...e.article.matchAll(/\[IMAGE INSERT/g)].length,
  }));
  const rule = (name, field) => ({
    rule: name,
    value: median(evidence.map((e) => e[field])),
    basis: evidence.map((e) => ({ documentId: e.id, version: e.version })),
    confidence:
      evidence.length >= 2 ? "여러 승인본 관찰" : "한 승인본 참고 사례",
  });
  return {
    enabled: prefs.enabled !== false,
    instructions: prefs.instructions || "",
    explicitRules: prefs.rules || [],
    exampleCount: examples.length,
    rules: evidence.length
      ? [
          rule("전체 분량", "characters"),
          rule("소제목 수", "sections"),
          rule("문단 길이", "paragraphCharacters"),
          rule("줄 길이", "lineCharacters"),
          rule("문장 길이", "sentenceCharacters"),
          rule("도입 길이", "openingCharacters"),
          rule("마무리 길이", "closingCharacters"),
        ]
      : [],
    observations: evidence.map(({ faq, checklist, images, ...r }) => ({
      ...r,
      faq,
      checklist,
      images,
    })),
    faqSupport: evidence.filter((e) => e.faq).map((e) => e.id),
    checklistSupport: evidence.filter((e) => e.checklist).map((e) => e.id),
    boundaries:
      "관찰값은 검색 공식이나 고정 개수가 아니다. 사실·경험·수치 수정은 일반 문체 규칙으로 만들지 않는다. 명시 지침과 반복 관찰을 구분한다.",
  };
}
function saveProfile(db, account, input) {
  if (
    typeof input.enabled !== "boolean" ||
    typeof input.instructions !== "string" ||
    input.instructions.length > 2000 ||
    !Array.isArray(input.rules) ||
    input.rules.length > 8 ||
    input.rules.some((r) => typeof r !== "string" || r.length > 220)
  )
    throw Error("지침은 2,000자, 명시 규칙은 8개·각 220자 이내입니다.");
  S.setMeta(db, "style:" + account, {
    enabled: input.enabled,
    instructions: input.instructions.trim(),
    rules: input.rules.filter((s) => s.trim()),
  });
  return profile(db, account);
}
function prepare(
  db,
  account,
  id,
  {
    platform,
    visibility = "private",
    scheduleMode = "now",
    reserveAfterHours = 3,
    confirmed,
  },
) {
  const d = read(db, account, id);
  if (confirmed !== true || d.approved_version !== d.current_version)
    throw Error("현재 원고를 최종 승인하고 발행 준비를 확인하세요.");
  if (d.platform !== platform)
    throw Error("이 플랫폼의 별도 원고를 선택하세요.");
  if (
    !["public", "private", "draft"].includes(visibility) ||
    !["now", "reserve"].includes(scheduleMode)
  )
    throw Error("발행 방식을 확인하세요.");
  if (platform === "tistory" && visibility === "draft")
    throw Error("티스토리는 비공개로 준비하세요.");
  if (
    scheduleMode === "reserve" &&
    (visibility !== "public" ||
      !Number.isFinite(reserveAfterHours) ||
      reserveAfterHours <= 0)
  )
    throw Error("예약은 공개·0보다 큰 시간으로 설정하세요.");
  const related = list(db, account).filter(
    (other) => other.id !== id && other.platform !== d.platform,
  );
  for (const other of related) {
    const v = read(db, account, other.id).current;
    if (normalArticle(v.article) === normalArticle(d.current.article))
      throw Error(
        "네이버·티스토리 본문이 같습니다. 플랫폼별 별도 원고를 작성·승인하세요.",
      );
  }
  if (d.publications.some((p) => p.state === "confirmed"))
    throw Error(
      "이미 발행한 원고를 다시 게시하지 않습니다. 기존 게시글 보강 여부를 직접 검토하세요.",
    );
  const existing = db
    .prepare("SELECT * FROM ops_publications WHERE document=? AND version=?")
    .all(id, d.current_version);
  if (
    existing.some((p) =>
      ["running", "uncertain", "confirmed"].includes(p.state),
    )
  )
    throw Error(
      "이미 발행했거나 결과 확인이 필요한 원고입니다. 중복 요청을 중지했습니다.",
    );
  const key = S.hash(id + "|" + d.current_version + "|" + platform),
    at = S.now(),
    payload = {
      platform,
      visibility,
      scheduleMode,
      reserveAfterHours,
      digest: d.current.digest,
      title: d.current.title,
      article: d.current.article,
    };
  db.prepare(
    "INSERT INTO ops_publications VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(idempotency_key) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at,data=excluded.data",
  ).run(
    S.id(),
    id,
    d.current_version,
    platform,
    "prepared",
    key,
    at,
    at,
    JSON.stringify(payload),
  );
  db.prepare("UPDATE ops_documents SET status=?,updated_at=? WHERE id=?").run(
    "publish_prepared",
    at,
    id,
  );
  S.event(db, account, id, "publish_prepared", {
    version: d.current_version,
    platform,
    visibility,
    scheduleMode,
  });
  return read(db, account, id);
}
function normalArticle(s) {
  return omitReferences(s)
    .replace(/\[IMAGE INSERT[^\]]*\]/g, "")
    .replace(/\s/g, "");
}
module.exports = {
  textHash,
  assetHashes,
  owned,
  read,
  list,
  create,
  save,
  saveReview,
  approve,
  revoke,
  diff,
  profile,
  saveProfile,
  prepare,
  normalArticle,
};
