"""Optional local Vietnamese legal models; no network model downloads."""
from functools import lru_cache
from pathlib import Path
import os


class RankerConfigurationError(RuntimeError):
    pass


class DenseRanker:
    def __init__(self, model):
        self.model = model

    def rank(self, question, items):
        vectors = self.model.encode([question] + [item.text for item in items],
                                    normalize_embeddings=True, show_progress_bar=False)
        query = vectors[0]
        scores = [sum(float(a) * float(b) for a, b in zip(query, vector)) for vector in vectors[1:]]
        return sorted(range(len(items)), key=lambda index: (-scores[index], index))


class CrossEncoderRanker:
    def __init__(self, model):
        self.model = model

    def rank(self, question, items):
        scores = self.model.predict([(question, item.text) for item in items], show_progress_bar=False)
        return sorted(range(len(items)), key=lambda index: (-float(scores[index]), index))


@lru_cache(maxsize=2)
def _load_models(embedding_path, reranker_path, device):
    for path in (embedding_path, reranker_path):
        if path and not Path(path).is_dir():
            raise RankerConfigurationError('Đường dẫn mô hình truy xuất không tồn tại.')
    if not embedding_path and not reranker_path:
        return None, None
    try:
        from sentence_transformers import SentenceTransformer, CrossEncoder
        dense = DenseRanker(SentenceTransformer(embedding_path, device=device, local_files_only=True,
                                                trust_remote_code=False)) if embedding_path else None
        reranker = CrossEncoderRanker(CrossEncoder(reranker_path, device=device, local_files_only=True,
                                                   trust_remote_code=False)) if reranker_path else None
        return dense, reranker
    except Exception as error:
        raise RankerConfigurationError('Không thể tải mô hình truy xuất cục bộ.') from error


def configured_rankers():
    return _load_models(os.environ.get('ASKPAY_EMBEDDING_MODEL', ''),
                        os.environ.get('ASKPAY_RERANKER_MODEL', ''),
                        os.environ.get('ASKPAY_MODEL_DEVICE', 'cpu'))
