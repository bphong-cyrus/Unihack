"""Conservative topic and exact-provision checks before citing evidence."""
import re
import unicodedata


def _normal(text):
    return unicodedata.normalize('NFC', str(text or '')).lower()


def evidence_relevant(question, article, title, text):
    query = _normal(question)
    source = _normal(f'{title} {text}')
    requested_articles = re.findall(r'\bđiều\s+(\d+[a-z]?)\b', query)
    if requested_articles and _normal(article) not in requested_articles:
        return False
    machinery = any(term in query for term in ('máy tiện', 'máy móc', 'máy móc thiết bị', 'máy công cụ', 'thiết bị công nghiệp'))
    used = any(term in query for term in ('đã qua sử dụng', 'đã sử dụng', 'hàng cũ', 'máy cũ', 'tiện cũ', 'thiết bị cũ'))
    if machinery and used:
        has_machinery = any(term in source for term in ('máy móc', 'máy tiện', 'máy công cụ', 'thiết bị công nghiệp'))
        has_used = any(term in source for term in ('đã qua sử dụng', 'đã sử dụng', 'máy cũ', 'thiết bị cũ'))
        if not (has_machinery and has_used):
            return False
    return True
