import {
  VALIDATOR_VERSION,
  computeExcerptSimilarity,
  hasNumericOrNegationConflict,
  normalizeVnText
} from "./validator-core.mjs";

const DOC_ALIAS_MAP = [
  [/luật\s+hải\s+quan(?:\s+2014)?/i, "54/2014/QH13"],
  [/luật\s+thuế\s+(?:xk|nk|xuất\s+khẩu)/i, "107/2016/QH13"],
  [/luật\s+quản\s+lý\s+ngoại\s+thương/i, "05/2017/QH14"],
  [/luật\s+thương\s+mại/i, "36/2005/QH11"],
  [/luật\s+quản\s+lý\s+thuế/i, "38/2019/QH14"],
  [/nghị\s+định\s+128\s*\/\s*2020/i, "128/2020/NĐ-CP"],
  [/nghị\s+định\s+127\s*\/\s*2013/i, "127/2013/NĐ-CP"],
  [/nghị\s+định\s+31\s*\/\s*2018/i, "31/2018/NĐ-CP"],
  [/nghị\s+định\s+08\s*\/\s*2015/i, "08/2015/NĐ-CP"],
  [/nghị\s+định\s+43\s*\/\s*2017/i, "43/2017/NĐ-CP"],
  [/thông\s+tư\s+38\s*\/\s*2015/i, "38/2015/TT-BTC"],
  [/thông\s+tư\s+39\s*\/\s*2018/i, "39/2018/TT-BTC"]
];

export function parseFactcheckInput(rawText, explicitPayload = null) {
  if (explicitPayload && typeof explicitPayload === "object") {
    const doc = String(explicitPayload.document || "").trim();
    const art = String(explicitPayload.article || "").trim();
    const cl = String(explicitPayload.clause || "").trim();
    const ex = String(explicitPayload.excerpt || "").trim();
    if (doc || art || cl || ex) {
      return {
        document: doc,
        article: art,
        clause: cl || (art ? "1" : ""),
        excerpt: ex,
        hasExplicitArticle: Boolean(art)
      };
    }
  }

  const text = String(rawText || "").trim();
  let document = "";
  const docCodeMatch = text.match(/\b(\d{1,4}\s*\/\s*\d{4}\s*\/\s*[A-ZĐ0-9-]+)\b/i);
  if (docCodeMatch) {
    document = docCodeMatch[1].replace(/\s+/g, "").toUpperCase();
  } else {
    for (const [pattern, mappedId] of DOC_ALIAS_MAP) {
      if (pattern.test(text)) {
        document = mappedId;
        break;
      }
    }
  }

  const artMatch = text.match(/điều\s+(\d+[a-z]?)/i);
  const clauseMatch = text.match(/khoản\s+(\d+)/i);
  const article = artMatch ? artMatch[1] : "";
  const clause = clauseMatch ? clauseMatch[1] : article ? "1" : "";

  let excerpt = "";
  const quotedMatch = text.match(/["“]([^"”]{10,})["”]/);
  if (quotedMatch) {
    excerpt = quotedMatch[1].trim();
  } else {
    const colonIdx = text.indexOf(":");
    if (colonIdx !== -1 && text.slice(colonIdx + 1).trim().split(/\s+/).length >= 6) {
      excerpt = text.slice(colonIdx + 1).trim();
    } else {
      const stripped = text
        .replace(/^(kiểm\s*chứng|xác\s*minh|check)\s*[:\-]?\s*/i, "")
        .trim();
      if (stripped.split(/\s+/).length >= 10 && !/có\s+tồn\s+tại\s+không/i.test(stripped)) {
        excerpt = stripped;
      }
    }
  }

  return {
    document,
    article,
    clause,
    excerpt,
    hasExplicitArticle: Boolean(article)
  };
}

function buildMismatchDetail(excerpt, sourceText) {
  const normEx = normalizeVnText(excerpt);
  const normSrc = normalizeVnText(sourceText);
  const exNums = Array.from(new Set(normEx.match(/\b\d+\b/g) || []));
  const srcNums = Array.from(new Set(normSrc.match(/\b\d+\b/g) || []));
  const unexpectedNums = exNums.filter((n) => !srcNums.includes(n));

  const details = [];
  if (unexpectedNums.length > 0) {
    details.push(
      `Sai lệch số liệu so với văn bản gốc: đầu vào ghi [${unexpectedNums.join(", ")}], trong khi văn bản gốc ghi [${srcNums.join(", ") || "không có"}].`
    );
  }
  if (hasNumericOrNegationConflict(normEx, normSrc) && unexpectedNums.length === 0) {
    details.push("Đoạn đầu vào có sai lệch về từ phủ định / nghĩa vụ pháp lý so với nguyên văn.");
  }
  if (details.length === 0) {
    details.push("Nội dung đoạn trích đầu vào không khớp nguyên văn (độ tương đồng < 90%) với quy định gốc.");
  }
  return details.join(" ");
}

export function runDeterministicFactcheck({
  questionId,
  rawInput,
  factcheckPayload,
  corpusEntries,
  corpusSha256
}) {
  const parsed = parseFactcheckInput(rawInput, factcheckPayload);

  if (!parsed.document && !parsed.article) {
    return {
      question_id: questionId,
      tier: "factcheck",
      mode: "factcheck",
      answer:
        "Không đủ dữ liệu có cấu trúc để kiểm chứng. Vui lòng ghi rõ Số hiệu văn bản (ví dụ: 54/2014/QH13 hoặc 128/2020/NĐ-CP), Điều/Khoản và đoạn trích cần kiểm tra. Hệ thống tuyệt đối không tự thay thế bằng một điều khoản khác.",
      citations: [],
      validation: {
        passed: false,
        verdict: "UNVERIFIED_REFUND",
        settlement_eligible: false,
        corpus_status: "DEMO_UNVERIFIED",
        validator_version: VALIDATOR_VERSION,
        corpus_sha256: corpusSha256,
        overall_score: 0,
        citation_checks: [],
        fail_reason: "INSUFFICIENT_STRUCTURED_CITATION"
      },
      demo: true
    };
  }

  const targetDocId = parsed.document
    ? parsed.document.toUpperCase().replace(/\s+/g, "")
    : "";
  const targetArticle = parsed.article || "";
  const targetClause = parsed.clause || "";

  let docExists = false;
  let matchedRec = null;

  if (targetDocId) {
    docExists = corpusEntries.some(
      (e) => e.doc_id.toUpperCase().replace(/\s+/g, "") === targetDocId
    );
    matchedRec =
      corpusEntries.find(
        (e) =>
          e.doc_id.toUpperCase().replace(/\s+/g, "") === targetDocId &&
          String(e.article) === targetArticle &&
          String(e.clause) === targetClause
      ) || null;
  } else {
    // Only article/clause provided (e.g. "Điều 999 khoản 9 có tồn tại không"): check across corpus without substituting another article
    matchedRec =
      corpusEntries.find(
        (e) => String(e.article) === targetArticle && String(e.clause) === targetClause
      ) || null;
    docExists = Boolean(matchedRec);
  }

  const artClauseExists = Boolean(matchedRec);
  const isInForce = Boolean(matchedRec && matchedRec.status === "ACTIVE");
  const isExistenceOnlyQuery =
    !parsed.excerpt || parsed.excerpt.trim().split(/\s+/).length < 10;

  let similarity = 0;
  let failReason = null;
  let mismatchNote = "";

  if (!targetDocId && !matchedRec) {
    failReason = "ARTICLE_OR_CLAUSE_NOT_FOUND";
  } else if (!docExists) {
    failReason = "DOCUMENT_NOT_IN_CORPUS";
  } else if (!artClauseExists) {
    failReason = "ARTICLE_OR_CLAUSE_NOT_FOUND";
  } else if (!isInForce) {
    failReason = "DOCUMENT_EXPIRED_OR_REPLACED";
  } else if (isExistenceOnlyQuery) {
    // Existence / status verification succeeded (e.g. "Điều 25 khoản 1 Luật 54/2014/QH13 có tồn tại không?")
    similarity = 1.0;
  } else {
    similarity = computeExcerptSimilarity(parsed.excerpt, matchedRec.raw_text);
    if (similarity < 0.9) {
      mismatchNote = buildMismatchDetail(parsed.excerpt, matchedRec.raw_text);
      failReason = `EXCERPT_MISMATCH (${(similarity * 100).toFixed(1)}% < 90%)`;
    }
  }

  const passed = failReason === null;
  const itemScore =
    (docExists ? 25 : 0) +
    (artClauseExists ? 25 : 0) +
    (isInForce ? 20 : 0) +
    30 * similarity;

  const displayDoc = matchedRec ? matchedRec.doc_id : targetDocId || "CHƯA_XÁC_ĐỊNH_VB";
  const displayTitle = matchedRec ? matchedRec.doc_title : "Văn bản cần kiểm chứng";
  const displayedExcerpt =
    parsed.excerpt || (matchedRec ? matchedRec.raw_text : String(rawInput || "").trim());

  let answer = "";
  if (passed) {
    answer = isExistenceOnlyQuery
      ? `XÁC NHẬN TỒN TẠI & CÒN HIỆU LỰC: Điều ${targetArticle}, Khoản ${targetClause} (${displayDoc} — ${displayTitle}) có thật trong kho dữ liệu và đang ở trạng thái ACTIVE.`
      : `TRÍCH DẪN KHỚP NGUYÊN VĂN: Đoạn trích kiểm chứng hoàn toàn khớp với Điều ${targetArticle}, Khoản ${targetClause} (${displayDoc} — ${displayTitle}) và văn bản đang còn hiệu lực.`;
  } else if (failReason === "DOCUMENT_NOT_IN_CORPUS") {
    answer = `KHÔNG TÌM THẤY VĂN BẢN: Mã văn bản "${displayDoc}" không tồn tại trong kho dữ liệu hiện tại. Hệ thống giữ nguyên đối tượng kiểm chứng và từ chối thay thế bằng điều khoản khác.`;
  } else if (failReason === "ARTICLE_OR_CLAUSE_NOT_FOUND") {
    answer = `KHÔNG TỒN TẠI ĐIỀU/KHOẢN: Không tìm thấy Điều ${targetArticle}${
      targetClause ? `, Khoản ${targetClause}` : ""
    }${targetDocId ? ` trong văn bản ${targetDocId}` : " trong kho văn bản pháp luật"}. Hệ thống giữ nguyên đối tượng kiểm chứng và không thay thế bằng điều khác.`;
  } else if (failReason === "DOCUMENT_EXPIRED_OR_REPLACED") {
    answer = `VĂN BẢN ĐÃ HẾT HIỆU LỰC: Điều ${targetArticle}, Khoản ${targetClause} (${displayDoc}) tồn tại nhưng văn bản này đang ở trạng thái HẾT HIỆU LỰC (EXPIRED).`;
  } else {
    answer = `KHÔNG KHỚP NGUYÊN VĂN: Đoạn đầu vào cho Điều ${targetArticle}, Khoản ${targetClause} (${displayDoc}) KHÔNG ĐẠT chuẩn kiểm chứng.\n\nChi tiết sai lệch: ${mismatchNote}`;
  }

  const citation = {
    document: displayDoc,
    document_title: displayTitle,
    article: targetArticle || "?",
    clause: targetClause || "?",
    excerpt: displayedExcerpt
  };

  return {
    question_id: questionId,
    tier: "factcheck",
    mode: "factcheck",
    answer,
    citations: [citation],
    validation: {
      passed,
      verdict: passed ? "VERIFIED_RELEASE" : "UNVERIFIED_REFUND",
      settlement_eligible: false,
      corpus_status: "DEMO_UNVERIFIED",
      validator_version: VALIDATOR_VERSION,
      corpus_sha256: corpusSha256,
      overall_score: Number(itemScore.toFixed(2)),
      citation_checks: [
        {
          document: displayDoc.toUpperCase().replace(/\s+/g, ""),
          article: targetArticle || "?",
          clause: targetClause || "?",
          doc_exists: docExists,
          article_clause_exists: artClauseExists,
          is_in_force: isInForce,
          excerpt_similarity: similarity,
          threshold_required: 0.9,
          raw_text: matchedRec ? matchedRec.raw_text : "",
          status: passed ? "PASS" : "FAIL",
          fail_reason: failReason
        }
      ],
      ...(failReason ? { fail_reason: failReason } : {}),
      ...(mismatchNote ? { mismatch_detail: mismatchNote } : {})
    },
    demo: true
  };
}
