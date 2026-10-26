"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { approvedFormatSummary, editorialFormatDirective } = require("../src/lib/editorialFormat");

test("only explicitly approved and sufficiently long samples affect the format", () => {
  const sample = "[SECTION - 상황 확인]\n" + "걷기 전에는 신발의 상태를 확인해요. ".repeat(14) +
    "\n\n[SECTION - 선택 기준]\n" + "신발 내부의 여유와 착용감을 관찰해 보세요. ".repeat(14) +
    "\n\n[SECTION - 참고자료]\nhttps://example.org/reference";
  const blocked = editorialFormatDirective({editorialReference:{approved:false,article:sample}});
  const allowed = editorialFormatDirective({editorialReference:{approved:true,article:sample}});
  assert.match(blocked, /승인 원고 원문이 설정되지 않았거나/);
  assert.match(allowed, /승인 예시의 소제목은 2개/);
  assert.ok(!allowed.includes("걷기 전에는 신발의 상태를 확인해요"));
  assert.ok(!allowed.includes("https://example.org/reference"));
});

test("empty and short samples never become an approved reference", () => {
  assert.equal(approvedFormatSummary("짧은 메모"), "");
  assert.match(editorialFormatDirective({}), /기본 편집 형식/);
});

test("FAQ and checklist hints only describe the format, not mandatory SEO counts", () => {
  const sample = "[SECTION - 첫째 질문]\n" + "관련 정보를 구체적으로 안내합니다. ".repeat(15) +
    "\n\n자주 묻는 질문\nQ. 무엇을 확인하나요?\n신발과 발의 공간을 확인하세요.";
  const guidance = approvedFormatSummary(sample);
  assert.match(guidance, /실제 추가 질문이 있을 때만/);
  assert.match(guidance, /검색 순위 공식 아님/);
});
