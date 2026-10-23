const fs = require('node:fs');
const path = require('node:path');

const isImageStage = agent => agent === 'image' || agent === 'imageStyle';
const lastMessageName = fileName => fileName + '.last-message.txt';

function responsePrompt(prompt) {
  return String(prompt)
    .replace(/^Output JSON path:.*$/gm, 'Return the result JSON in your final response; the application saves it.')
    .replace(/^- Write a UTF-8 JSON file at the exact Output JSON path\.$/gm, '')
    .replace(/^- Print one final line after writing the file: BLOGAUTO_RESULT_READY$/gm, '')
    + '\nUse the tools needed for this image task. Return exactly one JSON object as your final response, without Markdown fences or a completion marker. The application saves the JSON; do not write the result JSON file yourself. If image generation or inspection is unavailable or fails, still return the required JSON with status "failed", empty image paths, and the actual reason in failureReason and notes. Never invent image paths or report unavailable images as generated.';
}

function parseResult(raw, agent) {
  const text = String(raw || '').replace(/^\uFEFF/, '').trim();
  const fence = /^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```$/i.exec(text);
  const result = JSON.parse(fence ? fence[1] : text);
  if (!result || typeof result !== 'object' || Array.isArray(result)
      || !['success', 'partial', 'failed'].includes(result.status)) {
    throw new Error('Invalid image result object');
  }
  if (agent === 'image' && result.status !== 'failed'
      && (typeof result.titleImagePath !== 'string' || !Array.isArray(result.bodyImages))) {
    throw new Error('Image paths are missing from the result');
  }
  if (agent === 'imageStyle' && result.status === 'success'
      && !String(result.imageStylePrompt || '').trim()) {
    throw new Error('Image style prompt is empty');
  }
  return result;
}

function diagnosticText(raw) {
  return String(raw || '').replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\b(?:github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{8,})\b/g, '[redacted]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/((?:api[_-]?key|password|access[_-]?token)\s*[=:]\s*)\S+/gi, '$1[redacted]')
    .replace(/\s+/g, ' ').trim().slice(0, 600);
}

function saveResult(jobDir, fileName, agent, assistantText = '') {
  const capturePath = path.join(jobDir, lastMessageName(fileName));
  let captured = fs.existsSync(capturePath) ? fs.readFileSync(capturePath, 'utf8') : '';
  if (!captured.trim() && assistantText.trim()) {
    captured = assistantText;
    fs.writeFileSync(capturePath, captured, 'utf8');
  }
  const resultPath = path.join(jobDir, fileName);
  // Older CLI/tool flows may have already saved a valid result. Never confuse
  // that JSON with a final completion marker written by --output-last-message.
  for (const raw of [captured, fs.existsSync(resultPath) ? fs.readFileSync(resultPath, 'utf8') : '']) {
    if (!raw.trim()) continue;
    try {
      const result = parseResult(raw, agent);
      fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), 'utf8');
      return result;
    } catch (error) {
      if (error.code) throw error; // Preserve filesystem failures.
    }
  }
  const summary = diagnosticText(captured);
  const error = new Error('이미지 작업의 결과 JSON을 받지 못했습니다. '
    + (summary ? 'Codex 마지막 응답: ' + summary : 'Codex가 마지막 응답을 남기지 않았습니다.')
    + ' 이미지 생성 도구 제공 여부를 확인해 주세요. 진단 파일: ' + capturePath);
  error.code = 'IMAGE_RESULT_UNAVAILABLE';
  throw error;
}

module.exports = {isImageStage, lastMessageName, responsePrompt, saveResult, diagnosticText};
