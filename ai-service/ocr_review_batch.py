"""Create read-only OCR review pages and an index from a set of OCR records."""
import argparse
import html
from pathlib import Path
from ocr_review import ReviewError, render_review


def render_batch(records_dir, output_dir):
    records, output = Path(records_dir), Path(output_dir)
    files = sorted(records.glob('page-*.json'))
    if not files:
        raise ReviewError('no OCR page records found')
    if output.exists():
        raise ReviewError('output directory already exists')
    pages = [(path.stem + '.html', render_review(path, output / (path.stem + '.html'))) for path in files]
    links = ''.join(f'<li><a href="{html.escape(name, quote=True)}">{html.escape(name)}</a></li>' for name, _ in pages)
    index = ('<!doctype html><html lang="vi"><meta charset="utf-8"><title>Rà soát OCR</title>'
             '<h1>OCR chưa duyệt</h1><p>Đối chiếu từng trang với bản gốc; kết quả không xác nhận hiệu lực pháp luật.</p>'
             f'<ul>{links}</ul></html>')
    output.mkdir(parents=True)
    for name, content in pages:
        (output / name).write_text(content, encoding='utf-8')
    (output / 'index.html').write_text(index, encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('records')
    parser.add_argument('output')
    args = parser.parse_args()
    try:
        render_batch(args.records, args.output)
    except (ReviewError, OSError) as error:
        parser.exit(1, f'{error}\n')


if __name__ == '__main__':
    main()
