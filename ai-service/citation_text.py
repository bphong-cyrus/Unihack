"""Deterministic Vietnamese excerpt matching shared by validators."""
import re
import unicodedata
from rapidfuzz import fuzz


def normalize_vn_text(text: str) -> str:
    if not text:
        return ""
    text = unicodedata.normalize("NFC", text).lower()
    text = re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def compute_excerpt_similarity(excerpt: str, source_text: str) -> float:
    norm_excerpt = normalize_vn_text(excerpt)
    norm_source = normalize_vn_text(source_text)

    if len(norm_excerpt.split()) < 10 or not norm_source:
        return 0.0

    if norm_excerpt in norm_source:
        return 1.0

    return fuzz.partial_ratio(norm_excerpt, norm_source) / 100.0

