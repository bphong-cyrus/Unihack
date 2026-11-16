"""Deterministic Vietnamese excerpt matching shared by validators."""
import re
import unicodedata
from rapidfuzz import fuzz

VALIDATOR_VERSION = "1.1.0-deterministic"


def normalize_vn_text(text: str) -> str:
    if not text:
        return ""
    text = unicodedata.normalize("NFC", text).lower()
    text = re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def has_numeric_or_negation_conflict(norm_excerpt: str, norm_source: str) -> bool:
    """Catch small character-level edits that swap numbers/durations or legal polarity."""
    excerpt_nums = set(re.findall(r"\b\d+\b", norm_excerpt))
    source_nums = set(re.findall(r"\b\d+\b", norm_source))
    if excerpt_nums - source_nums:
        return True

    polarity_pairs = (
        ("không được", "được"),
        ("không phải", "phải"),
        ("không bị", "bị phạt"),
        ("không bị", "bị xử phạt"),
    )
    for neg_phrase, pos_token in polarity_pairs:
        if neg_phrase in norm_source and neg_phrase not in norm_excerpt and pos_token in norm_excerpt:
            return True
        if neg_phrase in norm_excerpt and neg_phrase not in norm_source:
            return True

    if "bắt buộc" in norm_source and "không bắt buộc" in norm_excerpt:
        return True

    for immunity in ("miễn phạt", "không bị phạt"):
        if immunity in norm_excerpt and immunity not in norm_source:
            return True

    return False


def compute_excerpt_similarity(excerpt: str, source_text: str) -> float:
    norm_excerpt = normalize_vn_text(excerpt)
    norm_source = normalize_vn_text(source_text)

    if len(norm_excerpt.split()) < 10 or not norm_source:
        return 0.0

    if norm_excerpt in norm_source:
        return 1.0

    # partial_ratio is symmetric: when the excerpt is longer it can score only
    # the source substring and ignore invented trailing text. Bound the score by
    # the fraction of excerpt that could be covered by the source.
    coverage_bound = min(1.0, len(norm_source) / len(norm_excerpt))
    raw_similarity = min(fuzz.partial_ratio(norm_excerpt, norm_source) / 100.0, coverage_bound)

    if has_numeric_or_negation_conflict(norm_excerpt, norm_source):
        return min(raw_similarity, 0.75)

    return raw_similarity

