"use strict";
const { unzipSync } = require("fflate");
const { XMLParser } = require("fast-xml-parser");
const MAX_BYTES = 8 * 1024 * 1024,
  MAX_ROWS = 10000,
  MAX_COLUMNS = 80;
function csv(text) {
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  const push = () => {
    row.push(cell);
    cell = "";
    if (row.length > MAX_COLUMNS) throw Error("열은 최대 80개입니다.");
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted || !cell) quoted = !quoted;
      else cell += c;
    } else if (c === "," && !quoted) push();
    else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      push();
      if (row.some((s) => s.trim())) rows.push(row);
      row = [];
      if (rows.length > MAX_ROWS + 1)
        throw Error("한 파일은 최대 10,000행입니다.");
    } else cell += c;
    if (cell.length > 50000) throw Error("셀 내용이 너무 깁니다.");
  }
  if (quoted) throw Error("CSV 따옴표가 닫히지 않았습니다.");
  if (cell || row.length) {
    push();
    if (row.some((s) => s.trim())) rows.push(row);
  }
  return rows;
}
function decode(buffer) {
  if (buffer[0] === 255 && buffer[1] === 254)
    return new TextDecoder("utf-16le").decode(buffer).replace(/^\uFEFF/, "");
  try {
    return new TextDecoder("utf-8", { fatal: true })
      .decode(buffer)
      .replace(/^\uFEFF/, "");
  } catch {
    return new TextDecoder("euc-kr", { fatal: true }).decode(buffer);
  }
}
const list = (value) =>
  value == null ? [] : Array.isArray(value) ? value : [value];
function xlsx(buffer) {
  let total = 0;
  const files = unzipSync(buffer, {
    filter: (f) => {
      total += f.originalSize;
      if (f.originalSize > 16 * 1024 * 1024 || total > 24 * 1024 * 1024)
        throw Error("엑셀 압축 해제 크기가 너무 큽니다.");
      return /^(?:xl\/(?:worksheets\/sheet\d+\.xml|sharedStrings\.xml|styles\.xml|workbook\.xml|_rels\/workbook\.xml.rels))$/.test(
        f.name,
      );
    },
  });
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    parseTagValue: false,
    processEntities: false,
  });
  const xml = (name) =>
    files[name] ? parser.parse(decode(files[name])) : null;
  const value = (node) =>
    String(typeof node === "string" ? node : node?.["#text"] || "").replace(
      /&(amp|lt|gt|quot|apos);/g,
      (_, n) => ({ amp: "&", lt: "<", gt: ">", quot: '\"', apos: "'" })[n],
    );
  const strings = list(xml("xl/sharedStrings.xml")?.sst?.si).map((s) =>
    s.t !== undefined
      ? value(s.t)
      : list(s.r)
          .map((r) => value(r.t))
          .join(""),
  );
  const sheets = Object.keys(files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort();
  const workbook = xml("xl/workbook.xml")?.workbook,
    first = list(workbook?.sheets?.sheet)[0],
    rel = list(
      xml("xl/_rels/workbook.xml.rels")?.Relationships?.Relationship,
    ).find((r) => r["@Id"] === first?.["@r:id"]);
  const target = String(rel?.["@Target"] || "")
    .replace(/^\//, "")
    .replace(/^xl\//, "");
  if (/^worksheets\/sheet\d+\.xml$/.test(target) && files["xl/" + target])
    sheets.unshift("xl/" + target);
  const styles = xml("xl/styles.xml")?.styleSheet,
    formats = new Map(
      list(styles?.numFmts?.numFmt).map((f) => [
        Number(f["@numFmtId"]),
        f["@formatCode"],
      ]),
    ),
    dateStyles = list(styles?.cellXfs?.xf).map((x) => {
      const n = Number(x["@numFmtId"]),
        code = String(formats.get(n) || "").replace(/\"[^\"]*\"/g, "");
      return (n >= 14 && n <= 22) || /[yd]/i.test(code);
    }),
    epoch =
      workbook?.workbookPr?.["@date1904"] === "1"
        ? Date.UTC(1904, 0, 1)
        : Date.UTC(1899, 11, 30);
  if (!sheets.length)
    throw Error("엑셀 시트를 찾을 수 없습니다. CSV 또는 XLSX로 저장하세요.");
  // Import the first worksheet only, explicitly reported in preview.
  const rows = list(xml(sheets[0])?.worksheet?.sheetData?.row)
    .map((r) => {
      const row = [];
      for (const c of list(r.c)) {
        const ref = String(c["@r"] || "A").match(/^[A-Z]+/)?.[0] || "A";
        let col = 0;
        for (const ch of ref) col = col * 26 + ch.charCodeAt(0) - 64;
        col--;
        if (col >= MAX_COLUMNS) throw Error("엑셀은 최대 80열입니다.");
        if (c.f !== undefined)
          throw Error("수식 셀은 가져오지 않습니다. 값만 붙여넣어 저장하세요.");
        row[col] =
          c["@t"] === "s"
            ? strings[Number(c.v)] || ""
            : c["@t"] === "inlineStr"
              ? value(c.is?.t) ||
                list(c.is?.r)
                  .map((r) => value(r.t))
                  .join("")
              : String(c.v ?? "");
        if (
          dateStyles[Number(c["@s"])] &&
          c.v !== undefined &&
          !["s", "inlineStr"].includes(c["@t"])
        ) {
          const n = Number(c.v);
          if (Number.isFinite(n) && n >= 0 && n < 3000000)
            row[col] = new Date(epoch + Math.floor(n) * 86400000)
              .toISOString()
              .slice(0, 10);
        }
      }
      return Array.from({ length: row.length }, (_, i) => row[i] || "");
    })
    .filter((r) => r.some((s) => s.trim()));
  return rows;
}
function parse(buffer, name) {
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_BYTES)
    throw Error("파일은 최대 8MB입니다.");
  const excel = /\.xlsx$/i.test(name);
  if (!excel && !/\.csv$/i.test(name))
    throw Error(
      "CSV 또는 XLSX 파일을 선택하세요. XLS는 XLSX/CSV로 저장해 주세요.",
    );
  const table = excel ? xlsx(buffer) : csv(decode(buffer));
  if (table.length < 2) throw Error("제목 행과 데이터 행이 필요합니다.");
  if (table.length > MAX_ROWS + 1) throw Error("최대 10,000행입니다.");
  const headerIndex = table
    .slice(0, 20)
    .findIndex(
      (r) =>
        r.length >= 2 &&
        r.some((s) =>
          /^(?:keyword|키워드|연관키워드|검색어|date|날짜|postId|게시글ID|title|제목)$/i.test(
            s.trim(),
          ),
        ),
    );
  if (headerIndex < 0)
    throw Error("열 제목을 확인하세요. 제공 양식의 제목 행을 사용하세요.");
  const headers = table[headerIndex].map((s) => s.trim());
  if (new Set(headers).size !== headers.length)
    throw Error("중복된 열 제목이 있습니다.");
  return {
    headers,
    rows: table
      .slice(headerIndex + 1)
      .map((r, i) => ({
        ...Object.fromEntries(headers.map((h, j) => [h, r[j] || ""])),
        _row: i + headerIndex + 2,
      })),
    headerRow: headerIndex + 1,
    sheet: excel ? "첫 번째 워크시트" : null,
  };
}
const key = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[\s_()\[\]·/\-]/g, "");
function get(row, ...names) {
  for (const name of names) {
    const found = Object.keys(row).find((k) => key(k) === key(name));
    if (found && String(row[found]).trim() !== "")
      return String(row[found]).trim();
  }
  return "";
}
function number(value, { integer = false } = {}) {
  if (
    value === "" ||
    value == null ||
    /^(?:-|n\/?a|미측정|미확인|null)$/i.test(String(value))
  )
    return null;
  const n = Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0 || (integer && !Number.isSafeInteger(n)))
    throw Error("0 이상의 숫자를 확인하세요: " + String(value).slice(0, 40));
  return n;
}
function count(value) {
  const s = String(value ?? "").trim();
  if (/^<\s*\d+$/.test(s))
    return { value: null, upperBound: Number(s.replace(/\D/g, "")), raw: s };
  return { value: number(s, { integer: true }), upperBound: null, raw: s };
}
function date(value, required = true) {
  const m = String(value || "")
    .trim()
    .match(/^(\d{4})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})(?:일)?$/);
  if (!m) {
    if (!required && !value) return "";
    throw Error("날짜는 YYYY-MM-DD 형식이어야 합니다.");
  }
  const s = m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");
  if (new Date(s + "T00:00:00Z").toISOString().slice(0, 10) !== s)
    throw Error("유효하지 않은 날짜입니다.");
  return s;
}
function http(value) {
  if (!value) return "";
  let u;
  try {
    u = new URL(value);
  } catch {
    throw Error("URL 형식을 확인하세요.");
  }
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
    throw Error("HTTP/HTTPS URL만 허용합니다.");
  return u.href;
}
module.exports = {
  parse,
  csv,
  decode,
  get,
  number,
  count,
  date,
  http,
  MAX_BYTES,
};
