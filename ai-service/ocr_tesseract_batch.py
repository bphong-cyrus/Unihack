"""Create source-linked OCR page records with the Tesseract command-line engine."""
import argparse
import csv
import hashlib
import io
import os
import re
import subprocess
import tempfile
from pathlib import Path

from pypdf import PdfReader

from ocr_batch import BatchError, run_batch


TSV_COLUMNS = {
    'level', 'page_num', 'block_num', 'par_num', 'line_num', 'word_num',
    'left', 'top', 'width', 'height', 'conf', 'text',
}


def parse_tesseract_tsv(contents):
    reader = csv.DictReader(io.StringIO(contents), delimiter='\t')
    if not reader.fieldnames or not TSV_COLUMNS.issubset(reader.fieldnames):
        raise BatchError('Tesseract TSV is missing required columns')
    grouped = {}
    try:
        for row in reader:
            if int(row['level']) != 5:
                continue
            text = (row.get('text') or '').strip()
            if not text:
                continue
            confidence = float(row['conf'])
            left, top = int(row['left']), int(row['top'])
            width, height = int(row['width']), int(row['height'])
            if width <= 0 or height <= 0 or not 0 <= confidence <= 100:
                raise BatchError('Tesseract TSV contains invalid word geometry or confidence')
            key = tuple(int(row[name]) for name in ('page_num', 'block_num', 'par_num', 'line_num'))
            line = grouped.setdefault(key, {
                'words': [], 'left': left, 'top': top, 'right': left + width,
                'bottom': top + height, 'confidences': [],
            })
            line['words'].append((int(row['word_num']), text))
            line['left'] = min(line['left'], left)
            line['top'] = min(line['top'], top)
            line['right'] = max(line['right'], left + width)
            line['bottom'] = max(line['bottom'], top + height)
            line['confidences'].append(confidence)
    except (KeyError, TypeError, ValueError) as error:
        if isinstance(error, BatchError):
            raise
        raise BatchError('Tesseract TSV contains an invalid word row') from error

    lines = []
    for key in sorted(grouped):
        line = grouped[key]
        left, top, right, bottom = (line[name] for name in ('left', 'top', 'right', 'bottom'))
        lines.append({
            'bbox': [[float(left), float(top)], [float(right), float(top)],
                     [float(right), float(bottom)], [float(left), float(bottom)]],
            'text': ' '.join(word for _, word in sorted(line['words'])),
            'confidence': sum(line['confidences']) / len(line['confidences']) / 100,
        })
    return lines


def tesseract_version(binary):
    result = subprocess.run([str(binary), '--version'], check=True, capture_output=True,
                            text=True, encoding='utf-8', timeout=30)
    first_line = result.stdout.splitlines()[0] if result.stdout.splitlines() else ''
    match = re.match(r'tesseract\s+(\S+)', first_line, re.IGNORECASE)
    if not match:
        raise BatchError('unable to identify Tesseract version')
    return match.group(1)


def model_hashes(tessdata_dir, languages):
    hashes = {}
    for language in languages.split('+'):
        path = Path(tessdata_dir) / f'{language}.traineddata'
        if not path.is_file():
            raise BatchError(f'missing Tesseract model: {path}')
        hashes[language] = hashlib.sha256(path.read_bytes()).hexdigest()
    return hashes


def make_recognizer(binary, tessdata_dir, mutool, languages, oem, psm, threads):
    binary, tessdata_dir = str(binary), Path(tessdata_dir).resolve()

    def recognize(source, page, dpi):
        with tempfile.TemporaryDirectory(prefix='askpay-tesseract-') as temporary:
            image = Path(temporary) / 'page.png'
            subprocess.run(
                [mutool, 'draw', '-q', '-r', str(dpi), '-F', 'png', '-o', str(image),
                 str(source), str(page)],
                check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60,
            )
            environment = os.environ.copy()
            environment['OMP_THREAD_LIMIT'] = str(threads)
            output = subprocess.run(
                [binary, str(image), 'stdout', '--tessdata-dir', str(tessdata_dir),
                 '-l', languages, '--oem', str(oem), '--psm', str(psm), 'tsv'],
                check=True, capture_output=True, text=True, encoding='utf-8',
                env=environment, timeout=180,
            )
            return parse_tesseract_tsv(output.stdout)

    return recognize


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--document-id', required=True)
    parser.add_argument('--tesseract', default=os.environ.get('TESSERACT_BIN', 'tesseract'))
    parser.add_argument('--tessdata-dir', required=True, type=Path)
    parser.add_argument('--mutool', default='mutool')
    parser.add_argument('--languages', default='vie+eng')
    parser.add_argument('--dpi', type=int, default=150)
    parser.add_argument('--threads', type=int, default=2)
    parser.add_argument('--oem', type=int, default=1)
    parser.add_argument('--psm', type=int, default=3)
    args = parser.parse_args()
    if args.threads < 1 or args.dpi < 1 or args.oem not in range(4) or args.psm not in range(14):
        parser.error('invalid thread, DPI, OEM or PSM value')
    try:
        version = tesseract_version(args.tesseract)
        hashes = model_hashes(args.tessdata_dir, args.languages)
        metadata = {
            'tesseract_version': version,
            'languages': args.languages.split('+'),
            'traineddata_sha256': hashes,
            'ocr_engine_mode': args.oem,
            'page_segmentation_mode': args.psm,
            'thread_limit': args.threads,
        }
        engine = f'Tesseract {version} ({args.languages}; OEM {args.oem}; PSM {args.psm})'
        recognize = make_recognizer(
            args.tesseract, args.tessdata_dir, args.mutool, args.languages,
            args.oem, args.psm, args.threads,
        )
        run_batch(
            args.source, args.output, args.document_id,
            len(PdfReader(args.source).pages), recognize, args.dpi,
            engine=engine, engine_metadata=metadata,
        )
    except (BatchError, OSError, ValueError, subprocess.SubprocessError) as error:
        parser.exit(1, f'OCR failed: {error}\n')


if __name__ == '__main__':
    main()
