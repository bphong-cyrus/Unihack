"""Fetch missing official sources without silently trusting changed bytes."""
import hashlib,json
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import urlopen
ROOT=Path(__file__).resolve().parents[1]/'corpus/demo-v1/sources'
for record in json.loads((ROOT/'downloads.json').read_text()):
    path=ROOT/record['file']
    if path.name!=record['file']: raise ValueError('Invalid file name')
    if path.exists(): data=path.read_bytes()
    else:
        url=record['url'];host=urlparse(url).hostname
        if urlparse(url).scheme!='https' or host not in {'datafiles.chinhphu.vn','congbaocdn.chinhphu.vn'}: raise ValueError('Unexpected source host')
        with urlopen(url,timeout=30) as response: data=response.read(20_000_001)
    if len(data)>20_000_000 or not data.startswith(b'%PDF') or hashlib.sha256(data).hexdigest()!=record['sha256']:
        raise ValueError('Source changed or invalid: '+record['file']+'; requires review, not automatic replacement')
    if not path.exists(): path.write_bytes(data)
    print('OK',record['file'])
