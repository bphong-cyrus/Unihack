"""Create resumable, unreviewed OCR records linked to an original PDF."""
import argparse
import hashlib
import json
import os
import subprocess
import tempfile
from pathlib import Path

ENGINE = 'EasyOCR vi+en'


class BatchError(ValueError):
    """An OCR checkpoint is incompatible with the requested source or settings."""


def run_batch(source, output, document_id, page_count, recognize, dpi=150, engine=ENGINE,
              engine_metadata=None):
    source, output = Path(source).resolve(), Path(output).resolve()
    if not document_id.strip() or page_count < 1 or dpi < 1:
        raise BatchError('invalid document, page count or resolution')
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    output.mkdir(parents=True, exist_ok=True)
    relative = os.path.relpath(source, output)
    expected = {'document_id': document_id, 'source_file': relative,
                'source_sha256': digest, 'page_count': page_count,
                'render_dpi': dpi, 'engine': engine, 'review_status': 'UNREVIEWED'}
    engine_metadata = engine_metadata or {}
    if set(expected).intersection(engine_metadata):
        raise BatchError('engine metadata cannot override page identity')
    expected.update(engine_metadata)
    allowed = {f'page-{page:03}.json' for page in range(1, page_count + 1)}
    if any(path.name not in allowed for path in output.glob('page-*.json')):
        raise BatchError('unexpected page checkpoint')
    for page in range(1, page_count + 1):
        checkpoint = output / f'page-{page:03}.json'
        if checkpoint.exists():
            try:
                record = json.loads(checkpoint.read_text(encoding='utf-8'))
                if any(record.get(key) != value for key, value in expected.items()) or record.get('page') != page or not isinstance(record.get('lines'), list):
                    raise BatchError(f'incompatible checkpoint: {checkpoint}')
            except (OSError, ValueError, AttributeError) as error:
                raise BatchError(f'invalid checkpoint: {checkpoint}') from error
    for page in range(1, page_count + 1):
        checkpoint = output / f'page-{page:03}.json'
        if checkpoint.exists():
            continue
        record = {**expected, 'page': page, 'lines': recognize(source, page, dpi)}
        if not isinstance(record['lines'], list):
            raise BatchError(f'invalid recognition result for page {page}')
        with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=output, delete=False) as temporary:
            try:
                json.dump(record, temporary, ensure_ascii=False, indent=2)
                temporary.write('\n')
                temporary.flush()
                os.replace(temporary.name, checkpoint)
            finally:
                if os.path.exists(temporary.name):
                    os.unlink(temporary.name)
        print(f'page {page}/{page_count}', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--document-id', required=True)
    parser.add_argument('--dpi', type=int, default=150)
    parser.add_argument('--threads', type=int, default=4)
    args = parser.parse_args()
    if args.threads < 1:
        parser.error('--threads must be positive')
    try:
        os.environ['OMP_NUM_THREADS'] = str(args.threads)
        os.environ['MKL_NUM_THREADS'] = str(args.threads)
        import torch
        import easyocr
        from pypdf import PdfReader
        torch.set_num_threads(args.threads)
        page_count = len(PdfReader(args.source).pages)
        reader = easyocr.Reader(['vi', 'en'], gpu=False, download_enabled=False, verbose=False)

        def recognize(source, page, dpi):
            with tempfile.TemporaryDirectory(prefix='askpay-ocr-') as tmp:
                image = Path(tmp) / 'page.png'
                subprocess.run(['mutool', 'draw', '-q', '-r', str(dpi), '-F', 'png', '-o', str(image), str(source), str(page)],
                               check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
                return [{'bbox': [[float(x), float(y)] for x, y in box], 'text': text, 'confidence': float(confidence)}
                        for box, text, confidence in reader.readtext(str(image), detail=1, paragraph=False)]

        run_batch(args.source, args.output, args.document_id, page_count, recognize, args.dpi)
    except (BatchError, OSError, ImportError, subprocess.SubprocessError) as error:
        parser.exit(1, f'OCR failed: {error}\n')


if __name__ == '__main__':
    main()
