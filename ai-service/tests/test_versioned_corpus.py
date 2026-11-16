import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from legal_corpus import CorpusError, load_snapshot
from versioned_validator import validate_snapshot_citations


class VersionedCorpusContract(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.directory = Path(self.tmp.name)
        self.source = b'Original document bytes'
        (self.directory / 'source.bin').write_bytes(self.source)
        self.manifest = {
            'snapshot_id': 'fixture-v1',
            'documents': [{
                'document_id': 'TEST/2020', 'title': 'Fixture',
                'source_url': 'https://example.gov.vn/law',
                'source_file': 'source.bin', 'source_sha256': hashlib.sha256(self.source).hexdigest(),
                'retrieved_at': '2025-01-01T00:00:00+00:00',
                'provisions': [
                    {'article': '1', 'clause': '1', 'point': '', 'text': 'Văn bản cũ', 'status': 'ACTIVE', 'review_status': 'VERIFIED',
                     'effective_from': '2020-01-01', 'effective_until': '2022-01-01',
                     'reviewed_by': 'reviewer', 'reviewed_at': '2025-01-01T00:00:00+00:00',
                     'status_evidence_url': 'https://example.gov.vn/status', 'verified_through': '2025-01-01'},
                    {'article': '1', 'clause': '1', 'point': '', 'text': 'Văn bản mới', 'status': 'ACTIVE', 'review_status': 'VERIFIED',
                     'effective_from': '2022-01-01', 'effective_until': None,
                     'reviewed_by': 'reviewer', 'reviewed_at': '2025-01-01T00:00:00+00:00',
                     'status_evidence_url': 'https://example.gov.vn/status', 'verified_through': '2025-01-01'},
                    {'article': '1', 'clause': '2', 'point': '', 'text': 'Khoản khác', 'status': 'ACTIVE', 'review_status': 'UNREVIEWED',
                     'effective_from': '2020-01-01', 'effective_until': None,
                     'reviewed_by': None, 'reviewed_at': None,
                     'status_evidence_url': None},
                ]}]
        }

    def load(self):
        path = self.directory / 'manifest.json'
        path.write_text(json.dumps(self.manifest, ensure_ascii=False), encoding='utf-8')
        return load_snapshot(path)

    def test_lookup_uses_inclusive_start_and_exclusive_end(self):
        corpus = self.load()
        self.assertEqual(corpus.lookup(' test/2020 ', '1', '1', '', date(2021, 12, 31)).text, 'Văn bản cũ')
        self.assertEqual(corpus.lookup('TEST/2020', '1', '1', '', date(2022, 1, 1)).text, 'Văn bản mới')
        self.assertIsNone(corpus.lookup('TEST/2020', '1', '1', '', date(2019, 12, 31)))

    def test_lookup_does_not_promote_unreviewed_provision(self):
        corpus = self.load()
        self.assertIsNone(corpus.lookup('TEST/2020', '1', '2', '', date(2023, 1, 1)))
        self.assertEqual(corpus.document_count, 1)
        self.assertEqual(corpus.provision_count, 3)
        self.assertEqual(corpus.reviewed_count, 2)

    def test_review_does_not_cover_dates_after_verified_through(self):
        corpus = self.load()
        self.assertIsNotNone(corpus.lookup('TEST/2020', '1', '1', '', date(2025, 1, 1)))
        self.assertIsNone(corpus.lookup('TEST/2020', '1', '1', '', date(2025, 1, 2)))

    def test_review_without_verified_through_is_rejected(self):
        del self.manifest['documents'][0]['provisions'][0]['verified_through']
        with self.assertRaises(CorpusError):
            self.load()

    def test_review_cannot_assert_verification_after_review_date(self):
        self.manifest['documents'][0]['provisions'][1]['verified_through'] = '2025-01-02'
        with self.assertRaises(CorpusError):
            self.load()

    def test_tampered_source_is_rejected(self):
        (self.directory / 'source.bin').write_bytes(b'changed')
        with self.assertRaises(CorpusError):
            self.load()

    def test_overlapping_versions_are_rejected_even_when_unreviewed(self):
        self.manifest['documents'][0]['provisions'][1]['effective_from'] = '2021-12-31'
        with self.assertRaises(CorpusError):
            self.load()

    def test_partial_review_or_invalid_interval_is_rejected(self):
        for mutate in ('partial_review', 'invalid_interval'):
            with self.subTest(mutate=mutate):
                item = self.manifest['documents'][0]['provisions'][2]
                before = dict(item)
                if mutate == 'partial_review':
                    item['reviewed_by'] = 'reviewer'
                else:
                    item['effective_until'] = '2020-01-01'
                with self.assertRaises(CorpusError):
                    self.load()
                item.update(before)

    def test_validator_checks_versions_and_rejects_mixed_or_unreviewed_citations(self):
        item = self.manifest['documents'][0]['provisions'][1]
        item['text'] = 'Doanh nghiệp phải nộp đầy đủ hồ sơ hải quan theo quy định hiện hành'
        snapshot = self.load()
        valid = {'document': 'TEST/2020', 'article': '1', 'clause': '1', 'excerpt': item['text']}
        passed = validate_snapshot_citations([valid], snapshot, date(2023, 1, 1))
        self.assertTrue(passed['passed'])
        self.assertEqual(passed['snapshot_id'], 'fixture-v1')
        self.assertFalse(validate_snapshot_citations([valid], snapshot, date(2021, 1, 1))['passed'])
        unreviewed = dict(valid, clause='2')
        mixed = validate_snapshot_citations([valid, unreviewed], snapshot, date(2023, 1, 1))
        self.assertFalse(mixed['passed'])
        self.assertEqual(mixed['citation_checks'][1]['fail_reason'], 'NO_REVIEWED_VERSION_FOR_DATE')
        self.assertFalse(validate_snapshot_citations([], snapshot, date(2023, 1, 1))['passed'])

    def test_cli_reports_snapshot_and_rejects_tampering(self):
        self.load()
        command = [sys.executable, str(Path(__file__).resolve().parents[1] / 'corpus_cli.py'), 'check', str(self.directory / 'manifest.json')]
        success = subprocess.run(command, capture_output=True, text=True, check=False)
        self.assertEqual(success.returncode, 0, success.stderr)
        report = json.loads(success.stdout)
        self.assertEqual((report['snapshot_id'], report['documents'], report['reviewed_provisions']), ('fixture-v1', 1, 2))
        (self.directory / 'source.bin').write_bytes(b'tampered')
        failure = subprocess.run(command, capture_output=True, text=True, check=False)
        self.assertNotEqual(failure.returncode, 0)
        self.assertIn('SHA-256', failure.stderr)

    def test_parent_path_and_non_https_sources_are_rejected(self):
        document = self.manifest['documents'][0]
        for field, value in [('source_file', '../source.bin'), ('source_url', 'http://example.gov.vn')]:
            with self.subTest(field=field):
                old = document[field]
                document[field] = value
                with self.assertRaises(CorpusError):
                    self.load()
                document[field] = old


if __name__ == '__main__':
    unittest.main()
