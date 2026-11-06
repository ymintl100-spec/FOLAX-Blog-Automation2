"use strict";
const fs = require("node:fs"), path = require("node:path");
const { readJob, jobFile } = require("../historyRetry");
const phases = new Set(["writer", "main_review", "article_revision", "image", "image_layout", "tags", "humanizer"]);
const terminal = new Set(["success", "generated", "draft_saved", "awaiting_approval", "publish_uncertain"]);
const rootId = h => h.retry_root_id || h.id;
const sameAccount = (h, a) => h.account_id ? h.account_id === a.id : h.blog_id === a.blogId;

// Only generation failures are imported. Publication attempts retain their
// existing document/draft and outcome checks; cloning them could publish twice.
function candidates(root, account, history) {
  const rows = history.filter(h => sameAccount(h, account));
  const groups = new Map();
  for (const h of rows) {
    const key = rootId(h), group = groups.get(key) || [];
    group.push(h); groups.set(key, group);
  }
  return [...groups.values()].flatMap(group => {
    if (group.some(h => terminal.has(h.status))) return [];
    const latest = group.slice().sort((a,b) => String(b.create_at).localeCompare(String(a.create_at)))[0];
    if (!/^job_\d+$/.test(latest.id) || latest.blog_id !== account.blogId) return [];
    if (group.some(h => { const file=jobFile(root,h.id,"publish-draft.json"); return file && fs.existsSync(file); })) return [];
    const last = readJob(root, latest.id, "attempts.json");
    const phase = latest.failure_phase || (Array.isArray(last) && last.at(-1)?.phase);
    if (!phases.has(phase) || !["failed", "codex_exec_failed", "codex_usage_limit"].includes(latest.status)) return [];
    return [{...latest, phase}];
  });
}
function saved(root, history) {
  const cp = readJob(root, history.id, "generation-checkpoint.json");
  if (!cp) return null;
  const prefix = Number(cp.attemptNumber || 1) + ":";
  const entries = Object.entries(cp.steps || {}).filter(([k,v]) => k.startsWith(prefix) && /:(?:prompt|prompt-retry-\d+)\.txt$/.test(k) && v?.article)
    .sort(([a],[b]) => Number(a.match(/retry-(\d+)/)?.[1] || 1) - Number(b.match(/retry-(\d+)/)?.[1] || 1));
  const stage = cp.imageCheckpoint?.writer?.article ? cp.imageCheckpoint : cp.articleCheckpoint?.writer?.article ? cp.articleCheckpoint : cp.articleResume?.writer?.article ? cp.articleResume : {};
  const writer = stage.writer || entries.at(-1)?.[1];
  if (typeof writer?.article !== 'string' || !writer.article.trim() || typeof (writer.title || stage.title || history.title) !== 'string' || !(writer.title || stage.title || history.title).trim()) return null;
  const attempt = entries.at(-1)?.[0].match(/retry-(\d+)/)?.[1] || 1;
  return {cp, stage, writer, review:stage.review || cp.steps?.[prefix + `main-review-scope-${attempt}.txt`] || cp.steps?.[prefix + `main-review-${attempt}.txt`]};
}
function list(root, account, history, documents) {
  const linked = new Set(documents.map(d => d.data.jobId));
  const linkedRoots = new Set(history.filter(h=>linked.has(h.id)).map(rootId));
  return candidates(root, account, history).flatMap(h => {
    if (linked.has(h.id) || linkedRoots.has(rootId(h))) return [];
    const value = saved(root,h);
    return value ? [{jobId:h.id, title:value.writer.title || value.stage.title || h.title,
      reason:h.reason || value.review?.failureReason || "생성 단계 실패", phase:h.phase, createdAt:h.create_at}] : [];
  });
}
function load(root, account, history, jobId) {
  const h = candidates(root, account, history).find(h => h.id === jobId);
  const value = h && saved(root, h);
  if (!value) throw Error("이 계정의 저장된 생성 실패 원고가 없습니다. 발행 시도 기록은 기존 발행 화면에서 확인하세요.");
  const {cp,stage} = value, dir = path.join(root,"jobs",jobId);
  const exists = file => { try { return fs.statSync(file).isFile(); } catch { return false; } };
  const resolve = file => file ? path.resolve(dir,file) : "";
  const result = {...value.writer,title:value.writer.title || stage.title || h.title};
  const generated = cp.imageCheckpoint?.images || result;
  result.titleImagePath = exists(resolve(generated.titleImagePath)) ? resolve(generated.titleImagePath) : "";
  const images = new Map((generated.bodyImages || []).map(i => [Number(i.sequence),i]));
  result.bodyImages = (result.bodyImages || []).flatMap(plan => {
    const image = {...plan,...images.get(Number(plan.sequence))};
    const file = resolve(image.path);
    return exists(file) ? [{...image,path:file}] : [];
  });
  const available = new Set(result.bodyImages.map(i => Number(i.sequence)));
  let removedMarkers = 0;
  result.article = result.article.replace(/\[IMAGE INSERT\s*-\s*(\d+)\]/g, (marker,n) => {
    if (available.has(Number(n))) return marker;
    removedMarkers++; return "";
  });
  result.researchTitleResult = stage.research || cp.revisionEvidenceContext?.research || cp.steps?.[prefixFor(cp)+"research-title-prompt.txt"];
  result.autoRetry = cp.autoRetry;
  // AI PASS belongs to the exact text reviewed. Restoring a working copy with
  // missing image markers removed must not attach that PASS to changed content.
  const failure = {reason:h.reason || value.review?.failureReason || "생성 단계 실패", phase:h.phase,
    sourceJobId:jobId, retryRootId:rootId(h), originalReview:value.review || null, removedImageMarkers:removedMarkers,
    availableImages:result.bodyImages.length + Number(Boolean(result.titleImagePath))};
  result.mainReviewResult = null;
  return {result,failure,history:h};
}
function prefixFor(cp) { return Number(cp.attemptNumber || 1) + ":"; }
module.exports = {list,load};
