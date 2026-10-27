// Restore only evidence that was actually delivered to this saved attempt.
// Never reconstruct sources from citations or fetch replacement material here.
function approvedImageCheckpoint(value) {
  return value?.version === 1 && value.review?.status === 'PASS'
    && Boolean(value.title && value.writer?.article);
}
function imageEvidenceContext(recovery) {
  const saved = recovery.imageCheckpoint?.evidenceContext;
  if (saved && Array.isArray(saved.searchResults)) return saved;
  const attempt = Number(recovery.attemptNumber || 1);
  const entries = Object.entries(recovery.retrievals || {})
    .filter(([key, value]) => new RegExp('^' + attempt + ':\\d+$').test(key)
      && Array.isArray(value?.searchResults))
    .sort(([a], [b]) => Number(b.split(':')[1]) - Number(a.split(':')[1]));
  const payload = entries[0]?.[1];
  if (payload) return {searchResults: payload.searchResults, sourceQuality: payload.sourceQuality};
  return {searchResults: recovery.generationOptions?.searchResults || [], sourceQuality: recovery.generationOptions?.sourceQuality};
}
function legacyImageResumeFailure(item, checkpoint, phase) {
  return approvedImageCheckpoint(checkpoint?.imageCheckpoint)
    && phase === 'writer' && Number(item.token_total) === 0
    && /본문 출처가 전달한 원문과 일치하지 않습니다/.test(String(item.reason || ''));
}
module.exports = {approvedImageCheckpoint, imageEvidenceContext, legacyImageResumeFailure};
