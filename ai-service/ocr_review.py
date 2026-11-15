"""Render an offline, read-only comparison of one OCR page with its source PDF."""
import argparse
import hashlib
import html
import json
import os
from pathlib import Path
from urllib.parse import quote


class ReviewError(ValueError):
    """The OCR record or its source does not pass integrity checks."""


def render_review(record_path, output_path):
    path = Path(record_path).resolve()
    try:
        record = json.loads(path.read_text(encoding='utf-8'))
        source = (path.parent / record['source_file']).resolve()
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        page, total = record['page'], record['page_count']
        if digest != record['source_sha256'] or not isinstance(page, int) or not 1 <= page <= total:
            raise ReviewError('source hash or page is invalid')
        if record['review_status'] != 'UNREVIEWED' or not isinstance(record['lines'], list):
            raise ReviewError('expected an unreviewed OCR page')
        rows = []
        for index, line in enumerate(record['lines'], 1):
            confidence = float(line['confidence'])
            if not 0 <= confidence <= 1:
                raise ReviewError('invalid OCR confidence')
            text = html.escape(line['text'])
            rows.append(f'<tr><td>{index}</td><td>{confidence:.1%}</td><td>{text}</td></tr>')
        relative = Path(os.path.relpath(source, Path(output_path).resolve().parent)).as_posix()
        pdf_url = quote(relative, safe='/') + f'#page={page}'
        title = html.escape(str(record['document_id']))
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        if isinstance(error, ReviewError):
            raise
        raise ReviewError('invalid OCR record or source') from error
    return f'''<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Rà soát OCR {title}</title>
<style>body{{font:14px system-ui;margin:0;color:#1e293b}}header{{padding:12px;background:#fef3c7}}
main{{display:grid;grid-template-columns:1fr 1fr;height:calc(100vh - 65px)}}iframe{{width:100%;height:100%;border:0}}
section{{overflow:auto;padding:12px}}table{{border-collapse:collapse;width:100%}}td,th{{border-bottom:1px solid #ddd;padding:6px;text-align:left;vertical-align:top}}
@media(max-width:800px){{main{{display:block;height:auto}}iframe{{height:60vh}}}}</style></head>
<body><header><strong>CHƯA DUYỆT</strong> · {title} · trang {page}/{total} · OCR có thể sai; đối chiếu bản gốc</header>
<main><iframe title="PDF gốc" src="{html.escape(pdf_url, quote=True)}"></iframe>
<section><p>Độ tin cậy là điểm OCR, không phải độ chính xác pháp lý. Bảng này chỉ để xem.</p>
<table><thead><tr><th>Dòng</th><th>Điểm OCR</th><th>Nội dung nhận dạng</th></tr></thead>
<tbody>{''.join(rows)}</tbody></table></section></main></body></html>'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('record')
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    try:
        output = render_review(args.record, args.out)
        Path(args.out).write_text(output, encoding='utf-8')
    except (ReviewError, OSError) as error:
        parser.exit(1, f'{error}\n')


if __name__ == '__main__':
    main()
