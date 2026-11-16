/**
 * Shared deterministic Vietnamese citation validator mirroring ai-service/citation_text.py.
 * Implements Unicode NFC normalization, character-level partial Indel similarity (partial_ratio),
 * length coverage bounding, and numeric / negation polarity conflict checks.
 */

export const VALIDATOR_VERSION = "1.1.0-deterministic";

export function normalizeVnText(text) {
  if (!text) return "";
  return String(text)
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasNumericOrNegationConflict(normExcerpt, normSource) {
  const excerptNums = normExcerpt.match(/\b\d+\b/g) || [];
  const sourceNums = new Set(normSource.match(/\b\d+\b/g) || []);
  for (const num of excerptNums) {
    if (!sourceNums.has(num)) return true;
  }

  const polarityPairs = [
    ["không được", "được"],
    ["không phải", "phải"],
    ["không bị", "bị phạt"],
    ["không bị", "bị xử phạt"]
  ];

  for (const [negPhrase, posToken] of polarityPairs) {
    if (normSource.includes(negPhrase) && !normExcerpt.includes(negPhrase) && normExcerpt.includes(posToken)) {
      return true;
    }
    if (normExcerpt.includes(negPhrase) && !normSource.includes(negPhrase)) {
      return true;
    }
  }

  if (normSource.includes("bắt buộc") && normExcerpt.includes("không bắt buộc")) {
    return true;
  }

  for (const immunity of ["miễn phạt", "không bị phạt"]) {
    if (normExcerpt.includes(immunity) && !normSource.includes(immunity)) {
      return true;
    }
  }

  return false;
}

function lcsLength(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return 0;
  let prev = new Uint16Array(n + 1);
  let curr = new Uint16Array(n + 1);
  for (let i = 1; i <= m; i++) {
    const chA = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      if (chA === b.charCodeAt(j - 1)) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = curr[j - 1] > prev[j] ? curr[j - 1] : prev[j];
      }
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
    curr.fill(0);
  }
  return prev[n];
}

function indelRatio(a, b) {
  const totalLen = a.length + b.length;
  if (totalLen === 0) return 1.0;
  return (2 * lcsLength(a, b)) / totalLen;
}

/**
 * Compute partial Indel similarity (equivalent to rapidfuzz.fuzz.partial_ratio / 100.0).
 */
export function computePartialRatio(a, b) {
  if (!a || !b) return 0;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  const m = shorter.length;
  const n = longer.length;
  if (longer.includes(shorter)) return 1.0;

  let best = indelRatio(shorter, longer.slice(0, m));
  const windows = new Set(["0:" + m, Math.max(0, n - m) + ":" + n]);

  const anchorStep = Math.max(1, Math.floor(m / 8));
  for (let offset = 0; offset < m; offset += anchorStep) {
    const token = shorter.slice(offset, Math.min(m, offset + 4));
    if (token.length < 2) continue;
    let searchFrom = 0;
    while (searchFrom < n) {
      const idx = longer.indexOf(token, searchFrom);
      if (idx === -1) break;
      const winStart = Math.max(0, idx - offset);
      const winEnd = Math.min(n, idx - offset + m);
      if (winEnd > winStart) {
        windows.add(`${winStart}:${winEnd}`);
      }
      const clampedStart = Math.max(0, Math.min(n - m, idx - offset));
      windows.add(`${clampedStart}:${Math.min(n, clampedStart + m)}`);
      searchFrom = idx + 1;
    }
  }

  for (const key of windows) {
    const [startStr, endStr] = key.split(":");
    const start = Number(startStr);
    const endLimit = Number(endStr);
    const fullScore = indelRatio(shorter, longer.slice(start, endLimit));
    if (fullScore > best) best = fullScore;

    // Mirror RapidFuzz partial_ratio edge-trimmed optimal substring alignment
    if (start === 0 || endLimit === n) {
      let commonPrefix = 0;
      const maxWin = endLimit - start;
      while (commonPrefix < maxWin && shorter[commonPrefix] === longer[start + commonPrefix]) {
        commonPrefix++;
      }
      if (commonPrefix >= Math.floor(m * 0.5) && commonPrefix < maxWin) {
        const prefixScore = (2 * commonPrefix) / (m + commonPrefix);
        if (prefixScore > best) best = prefixScore;
      }

      let commonSuffix = 0;
      while (
        commonSuffix < maxWin &&
        shorter[m - 1 - commonSuffix] === longer[endLimit - 1 - commonSuffix]
      ) {
        commonSuffix++;
      }
      if (commonSuffix >= Math.floor(m * 0.5) && commonSuffix < maxWin) {
        const suffixScore = (2 * commonSuffix) / (m + commonSuffix);
        if (suffixScore > best) best = suffixScore;
      }
    }

    if (best >= 0.9999) break;
  }

  return best;
}

export function computeExcerptSimilarity(excerpt, sourceText) {
  const normExcerpt = normalizeVnText(excerpt);
  const normSource = normalizeVnText(sourceText);

  const words = normExcerpt ? normExcerpt.split(" ").filter(Boolean) : [];
  if (words.length < 10 || !normSource) return 0.0;

  if (normSource.includes(normExcerpt)) return 1.0;

  const coverageBound = Math.min(1.0, normSource.length / normExcerpt.length);
  const rawSimilarity = Math.min(computePartialRatio(normExcerpt, normSource), coverageBound);

  if (hasNumericOrNegationConflict(normExcerpt, normSource)) {
    return Number(Math.min(rawSimilarity, 0.75).toFixed(4));
  }

  return Number(rawSimilarity.toFixed(4));
}
