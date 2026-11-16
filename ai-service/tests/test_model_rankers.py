import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from model_rankers import configured_rankers, DenseRanker, CrossEncoderRanker, RankerConfigurationError

class ModelRankerTests(unittest.TestCase):
    def test_rankers_order_candidates_using_model_scores(self):
        items = [SimpleNamespace(text='một'), SimpleNamespace(text='hai')]
        class Dense:
            def encode(self, texts, **kwargs):
                return [[1, 0], [0, 1], [1, 0]]
        class Cross:
            def predict(self, pairs, **kwargs):
                return [0.1, 0.9]
        self.assertEqual(DenseRanker(Dense()).rank('câu hỏi', items), [1, 0])
        self.assertEqual(CrossEncoderRanker(Cross()).rank('câu hỏi', items), [1, 0])

    def test_missing_configured_path_fails_instead_of_downloading(self):
        with patch.dict(os.environ, {'ASKPAY_EMBEDDING_MODEL': '/path/that/does/not/exist'}, clear=True):
            with self.assertRaises(RankerConfigurationError):
                configured_rankers()

    def test_no_configuration_keeps_lexical_mode(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(configured_rankers(), (None, None))
