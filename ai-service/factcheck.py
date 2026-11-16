"""Check the exact provision supplied by a user against one reviewed snapshot."""
from difflib import SequenceMatcher
import re
import unicodedata

from versioned_validator import validate_snapshot_citations


def check_claim(snapshot, document, article, clause, point, excerpt, as_of):
    citation = {'document': document, 'article': article, 'clause': clause, 'point': point, 'excerpt': excerpt}
    validation = validate_snapshot_citations([citation], snapshot, as_of)
    check = validation['citation_checks'][0]
    source = check.get('raw_text') or ''
    differences = []
    if source:
        input_tokens = re.findall(r'\w+|[^\w\s]', unicodedata.normalize('NFC', excerpt), re.UNICODE)
        source_tokens = re.findall(r'\w+|[^\w\s]', unicodedata.normalize('NFC', source), re.UNICODE)
        for operation, i1, i2, j1, j2 in SequenceMatcher(None, input_tokens, source_tokens, autojunk=False).get_opcodes():
            if operation == 'replace':
                old = ' '.join(input_tokens[i1:i2])
                new = ' '.join(source_tokens[j1:j2])
                if old and new:
                    differences.append({'input': old, 'source': new})
    return {'citation': citation, 'passed': validation['passed'], 'fail_reason': check['fail_reason'],
            'differences': differences, 'validation': validation, 'source_text': source}
