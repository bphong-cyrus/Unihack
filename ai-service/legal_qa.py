"""Strict-JSON LegalQA adapter with evidence-bound, verbatim citations."""
from dataclasses import dataclass
import json
import os
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class LegalQAConfigurationError(RuntimeError):
    """The selected model tier is not configured."""


class LegalQAResponseError(RuntimeError):
    """The model response is not valid strict JSON or cites unsupported text."""


@dataclass(frozen=True)
class TierConfig:
    tier: str
    fee_usdc: str
    top_k: int
    model: str


def _field(item, key):
    return item.get(key) if isinstance(item, dict) else getattr(item, key)


def resolve_tier_config(tier, environ=None):
    environment = os.environ if environ is None else environ
    if tier not in {'quick', 'deep'}:
        raise LegalQAConfigurationError('tier must be quick or deep')
    if not (environment.get('LLM_API_KEY') or environment.get('OPENAI_API_KEY')):
        raise LegalQAConfigurationError('LLM_API_KEY or OPENAI_API_KEY is not configured')
    model = (environment.get(f'LLM_{tier.upper()}_MODEL') or environment.get(f'ASKPAY_{tier.upper()}_MODEL')
             or environment.get('LLM_MODEL') or environment.get('ASKPAY_LLM_MODEL'))
    if not model:
        raise LegalQAConfigurationError(f'ASKPAY_{tier.upper()}_MODEL is not configured')
    return TierConfig(tier, '0.05' if tier == 'quick' else '0.20', 3 if tier == 'quick' else 8, model)


def strict_response_schema():
    return {
        'name': 'askpay_legal_answer',
        'strict': True,
        'schema': {
            'type': 'object',
            'additionalProperties': False,
            'required': ['answer', 'citations'],
            'properties': {
                'answer': {'type': 'string', 'minLength': 1},
                'citations': {
                    'type': 'array',
                    'items': {
                        'type': 'object',
                        'additionalProperties': False,
                        'required': ['doc_id', 'article', 'clause', 'excerpt'],
                        'properties': {
                            'doc_id': {'type': 'string', 'minLength': 1},
                            'article': {'type': 'string', 'minLength': 1},
                            'clause': {'type': 'string', 'minLength': 1},
                            'excerpt': {'type': 'string', 'minLength': 1},
                        },
                    },
                },
            },
        },
    }


def build_request_payload(question, evidence, tier, model):
    evidence_payload = [{
        'doc_id': _field(item, 'document_id') if not isinstance(item, dict) else item['doc_id'],
        'article': _field(item, 'article'),
        'clause': _field(item, 'clause'),
        'point': _field(item, 'point') if (not isinstance(item, dict) or 'point' in item) else '',
        'status': _field(item, 'status'),
        'raw_text': _field(item, 'text') if not isinstance(item, dict) else item['raw_text'],
    } for item in evidence]
    system_prompt = (
        'Bạn là bộ tổng hợp LegalQA cho pháp luật XNK Việt Nam. Chỉ dựa vào evidence được cung cấp; '
        'không suy đoán hoặc thêm quy định ngoài evidence. Trả lời bằng tiếng Việt, nêu rõ khi evidence '
        'chưa đủ. Citation phải khớp doc_id/article/clause trong evidence. Trường excerpt phải chép '
        'nguyên văn liên tiếp tối thiểu 10 từ từ raw_text, giữ nguyên dấu và chữ; không diễn giải, '
        'không ghép các đoạn rời. Nếu không có căn cứ trực tiếp, trả citations rỗng và nói rõ chưa tìm thấy '
        'căn cứ đã VERIFIED. Chỉ xuất JSON theo schema.'
    )
    user_prompt = json.dumps({
        'question': question,
        'tier': tier,
        'evidence': evidence_payload,
        'requirements': {
            'citation_excerpt_minimum_words': 10,
            'citation_excerpt_must_be_verbatim_substring_of_raw_text': True,
            'citation_must_reference_an_evidence_record': True,
            'excerpt_instruction': 'Chép nguyên văn liên tiếp ít nhất 10 từ từ raw_text, không diễn giải hoặc sửa chính tả.',
        },
    }, ensure_ascii=False)
    return {
        'model': model,
        'messages': [
            {'role': 'system', 'content': system_prompt},
            {'role': 'user', 'content': user_prompt},
        ],
        'response_format': {'type': 'json_schema', 'json_schema': strict_response_schema()},
    }


def _no_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise LegalQAResponseError('duplicate JSON field')
        result[key] = value
    return result


def parse_structured_answer(body, evidence):
    try:
        result = json.loads(body, object_pairs_hook=_no_duplicate_keys)
    except LegalQAResponseError:
        raise
    except (TypeError, json.JSONDecodeError) as error:
        raise LegalQAResponseError('model response is not valid JSON') from error
    if not isinstance(result, dict) or set(result) != {'answer', 'citations'}:
        raise LegalQAResponseError('model response does not match the strict answer schema')
    if not isinstance(result['answer'], str) or not result['answer'].strip() or not isinstance(result['citations'], list):
        raise LegalQAResponseError('answer and citations have invalid types')

    evidence_index = {}
    for item in evidence:
        key = ((_field(item, 'document_id') if not isinstance(item, dict) else item['doc_id']).upper(),
               str(_field(item, 'article')), str(_field(item, 'clause')))
        evidence_index.setdefault(key, []).append(item)
    citations = []
    for citation in result['citations']:
        if not isinstance(citation, dict) or set(citation) != {'doc_id', 'article', 'clause', 'excerpt'}:
            raise LegalQAResponseError('citation does not match the strict citation schema')
        if any(not isinstance(citation[key], str) or not citation[key].strip()
               for key in ('doc_id', 'article', 'clause', 'excerpt')):
            raise LegalQAResponseError('citation fields must be non-empty strings')
        doc_id = unicodedata.normalize('NFC', ''.join(citation['doc_id'].upper().split()))
        key = (doc_id, citation['article'].strip(), citation['clause'].strip())
        candidates = [item for item in evidence_index.get(key, []) if _field(item, 'status') == 'ACTIVE']
        if not candidates:
            raise LegalQAResponseError('citation is not a retrieved ACTIVE evidence record')
        excerpt = unicodedata.normalize('NFC', citation['excerpt'].strip())
        source = next((item for item in candidates if excerpt in unicodedata.normalize(
            'NFC', _field(item, 'text') if not isinstance(item, dict) else item['raw_text'])), None)
        if len(excerpt.split()) < 10 or source is None:
            raise LegalQAResponseError('citation excerpt must copy at least 10 words verbatim from raw_text')
        citations.append({
            'doc_id': _field(source, 'document_id') if not isinstance(source, dict) else source['doc_id'],
            'article': str(_field(source, 'article')),
            'clause': str(_field(source, 'clause')),
            'excerpt': excerpt,
        })
    return {'answer': result['answer'].strip(), 'citations': citations}


def _post_json(url, headers, payload, timeout):
    request = Request(url, data=json.dumps(payload).encode('utf-8'), headers=headers, method='POST')
    with urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode('utf-8'))


def generate_answer(question, evidence, tier, environ=None, post_json=None):
    environment = os.environ if environ is None else environ
    config = resolve_tier_config(tier, environment)
    if not evidence:
        return {'answer': 'Chưa tìm thấy căn cứ đã VERIFIED phù hợp trong corpus.', 'citations': []}, config
    base_url = environment.get('ASKPAY_OPENAI_BASE_URL', 'https://api.openai.com/v1').rstrip('/')
    request_payload = build_request_payload(question, evidence, tier, config.model)
    headers = {
        'Authorization': f"Bearer {environment.get('LLM_API_KEY') or environment['OPENAI_API_KEY']}",
        'Content-Type': 'application/json',
    }
    try:
        response = (post_json or _post_json)(
            f'{base_url}/chat/completions', headers, request_payload, 45,
        )
    except (HTTPError, URLError, TimeoutError, OSError) as error:
        raise LegalQAResponseError('LLM provider request failed') from error
    try:
        body = response['choices'][0]['message']['content']
    except (KeyError, IndexError, TypeError) as error:
        raise LegalQAResponseError('LLM provider response is incomplete') from error
    return parse_structured_answer(body, evidence), config
