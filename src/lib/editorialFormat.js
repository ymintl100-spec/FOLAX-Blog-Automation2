"use strict";

// Editorial layout guidance only: never copy third-party prose or masquerade as
// the author of a benchmark blog. User-approved samples stay in local settings.
const FORMAT_GUIDE = [
  "편집 형식: 질문이 분명한 제목 → 독자가 공감할 상황 또는 핵심 답 → 읽기 쉬운 소제목 → 근거와 구체적 판단 기준 → 필요한 실천 정보 → 간결한 마무리를 기본 선택지로 삼는다.",
  "생활 사례로 도입할 수 있지만 실제로 경험하지 않은 진료, 환자, 운동, 여행, 가족 경험을 꾸미지 않는다. 전문 자격이나 의료인의 관점을 빌려 말하지 않는다.",
  "기본 참고 형식은 발편한 생활노트의 공개 정보글에서 확인된 답변 선배치·선택 기준·조건별 설명·필요 시 체크리스트/FAQ·출처이다. 모든 글에 같은 순서나 항목 개수를 강제하지 않는다.",
  "벤치마킹 블로그는 표현·내용 복제의 출처가 아니다. 형식의 특징(짧은 문단, 구체적 소제목, 핵심 문장, 사실과 활용의 연결)만 일반화하여 독립적인 글을 작성한다.",
  "이미지와 영상은 설명을 더 명확하게 할 때만 배치한다. 보유하지 않은 현장 사진, 실측 또는 체험 영상이 있다고 꾸미지 않는다.",
  "도입과 결론, 소제목의 개수와 전개 순서는 검색 의도에 맞춰 다양화한다. 똑같은 인사·감탄·FAQ·마무리 문구를 모든 글에 반복하지 않는다.",
  "사용자가 최종 수정하여 승인한 원고가 있다면 타 블로그보다 그 원고의 구성적 특징을 우선 적용한다. 어투 복제보다 제목과 실제 답의 일치, 명확성, 사실성, 읽기 편함을 우선한다.",
  "현재 포렉스 초기 정보 축적 단계에서는 승인 없는 제품명·가격·구매 링크·광고성 문구를 넣지 않는다. 기존 상업적 관계 공개 의무는 유지한다.",
];

function approvedFormatSummary(article) {
  const value = String(article || "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (value.length < 200) return "";
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const sectionLines = lines.filter(
    (line) =>
      /^\[SECTION\s*-\s*[^\]]+\]$/i.test(line) || /^#{1,4}\s+/.test(line),
  );
  const paragraphs = value
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^\[SECTION\s*-/.test(part));
  const sentenceLike = paragraphs.filter((part) => part.length > 30);
  const meanParagraphLength = sentenceLike.length
    ? Math.round(
        sentenceLike.reduce((sum, part) => sum + part.length, 0) /
          sentenceLike.length,
      )
    : 0;
  const headingCount = sectionLines.filter(
    (line) => !/참고자료|출처/.test(line),
  ).length;
  const traits = [
    `승인 예시의 소제목은 ${headingCount}개입니다. 동일한 개수를 무조건 맞추지 말고 해당 주제에 맞춰 조정하세요.`,
    `승인 예시의 본문 문단 평균 길이는 약 ${meanParagraphLength}자입니다(형식 관찰값, 검색 순위 공식 아님).`,
    /자주 묻는 질문|\bFAQ\b|\bQ[.\s]/i.test(value)
      ? "승인 예시에는 FAQ 또는 질문형 설명이 있습니다. 실제 추가 질문이 있을 때만 적용하세요."
      : "FAQ를 형식상 강제로 추가하지 마세요.",
    /\b1[.)]\s|☑|✔|체크리스트|확인할/.test(value)
      ? "승인 예시에는 순서 또는 확인 항목이 있습니다. 실제로 단계 구분이 필요한 글에서만 활용하세요."
      : "필요 없는 번호 매기기·체크리스트를 자동 삽입하지 마세요.",
    /https?:\/\//.test(value)
      ? "승인 예시에 링크가 있지만 이 링크를 복사하지 말고 현재 원고에 실제 필요한 근거·게시글 링크만 확인해서 넣으세요."
      : "출처가 필요한 주장은 별도로 확인하세요.",
  ];
  return traits.join("\n");
}

function editorialFormatDirective(options = {}) {
  const editorial = options.editorialReference || {};
  const base = FORMAT_GUIDE.join("\n");
  const approved =
    editorial.approved === true ? approvedFormatSummary(editorial.article) : "";
  if (!approved)
    return (
      base +
      "\n승인 원고 원문이 설정되지 않았거나 승인이 표시되지 않았습니다. 외부 블로그의 문체를 흉내 내지 말고 기본 편집 형식을 사용하세요."
    );
  return (
    base +
    "\n[사용자가 승인한 원고에서 추출한 형식 특징 — 실제 문장 복사 금지]\n" +
    approved
  );
}

module.exports = { approvedFormatSummary, editorialFormatDirective };
