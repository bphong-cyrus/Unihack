"""Extract candidate article boundaries from a DOCX for manual legal review."""
from collections import Counter
from hashlib import sha256
from pathlib import Path
import re
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile

_NAMESPACE = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
_ARTICLE = re.compile(r'^\s*Điều\s+(\d+[a-zA-Z]?)\s*[.:]', re.IGNORECASE)
_MAX_XML = 20_000_000


class ExtractionError(ValueError):
    """The input is not a supported Word document."""


def extract_document(path):
    path = Path(path)
    try:
        source = path.read_bytes()
        with ZipFile(path) as archive:
            info = archive.getinfo('word/document.xml')
            if info.file_size > _MAX_XML:
                raise ExtractionError('document XML exceeds size limit')
            xml = archive.read(info)
        root = ElementTree.fromstring(xml)
    except (OSError, BadZipFile, KeyError, ElementTree.ParseError) as error:
        raise ExtractionError('cannot read Word document XML') from error

    paragraphs = []
    for paragraph in root.iter(_NAMESPACE + 'p'):
        parts = []
        for node in paragraph.iter():
            if node.tag == _NAMESPACE + 't':
                parts.append(node.text or '')
            elif node.tag == _NAMESPACE + 'tab':
                parts.append('\t')
            elif node.tag in (_NAMESPACE + 'br', _NAMESPACE + 'cr'):
                parts.append('\n')
        text = ''.join(parts)
        if text.strip():
            paragraphs.append(text)

    preamble = []
    articles = []
    current = None
    for text in paragraphs:
        match = _ARTICLE.match(text)
        if match:
            current = {'article': match.group(1), 'paragraphs': []}
            articles.append(current)
        if current is None:
            preamble.append(text)
        else:
            current['paragraphs'].append(text)
    counts = Counter(item['article'] for item in articles)
    return {'docx_sha256': sha256(source).hexdigest(), 'review_status': 'UNREVIEWED',
            'preamble': preamble, 'articles': articles,
            'duplicate_articles': sorted(number for number, count in counts.items() if count > 1),
            'limitations': 'Text from document.xml only; article boundaries are heuristic and require manual review.'}
