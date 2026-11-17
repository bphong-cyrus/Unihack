"""Reproduce selected demo clauses from pinned official PDFs. Requires PyMuPDF.
No LLM paraphrases; no professional-review/settlement assertion.
"""
from pathlib import Path
import hashlib,json,re
import fitz
ROOT=Path(__file__).resolve().parents[1]/'corpus/demo-v1'
SOURCES={x['file']:x for x in json.loads((ROOT/'sources/downloads.json').read_text())}
REVIEW={'reviewed_by':'AI-assisted source cross-check; NOT professional legal review',
'reviewed_at':'2026-11-17T13:00:00+07:00','verified_through':'2026-11-17'}
def text(file,start=0,end=None):
    d=fitz.open(ROOT/'sources'/file);pages=[]
    for page in list(d)[start:end]:
        lines=page.get_text().splitlines()
        # Only page furniture; preserve legal text and point labels.
        lines=[s for s in lines if not re.match(r'^\s*(CÔNG BÁO/|Ký bởi:|Người ký:|Email:|Cơ quan:|Thời gian ký:|\d+\s*$)',s)]
        pages.append('\n'.join(lines))
    return '\n'.join(pages)
def norm(s): return re.sub(r'\s+',' ',s).strip()
def article(t,n):
    m=re.search(r'^\s*Điều '+re.escape(str(n))+r'\.\s',t,re.M)
    assert m,('missing article',n)
    tail=t[m.end():];end=re.search(r'^\s*Điều \d+[a-z]?\.',tail,re.M)
    return tail[:end.start()] if end else tail

def clause(t,n):
    m=re.search(r'^\s*'+str(n)+r'\.\s',t,re.M);assert m,('missing clause',n)
    tail=t[m.end():];end=re.search(r'^\s*\d+\.\s',tail,re.M)
    return norm(tail[:end.start()] if end else tail)

def point(t,p):
    m=re.search(r'(?:^|\s)'+re.escape(p)+r'\)\s',t);assert m
    tail=t[m.end():];end=re.search(r'\s[abcdeđghiklmnpqrs]\)\s',tail)
    return norm(tail[:end.start()] if end else tail)

def document(id,title,file,url,eff,selections,end=None,page_start=0,page_end=None):
    t=text(file,page_start,page_end);records=[]
    for a,c,pt in selections:
        value=clause(article(t,a),c)
        if pt: value=point(value,pt)
        # Do not include signatures/next chapter after last clause.
        value=re.split(r' Chương [IVX]+ | TM\. CHÍNH PHỦ| KT\. THỦ TƯỚNG',value)[0].strip()
        records.append(dict(article=str(a),clause=str(c),point=pt,text=value,
          effective_from=eff,effective_until=end,**REVIEW,status_evidence_url=url,
          extraction_method='PYMUPDF_SELECTED_PROVISION',review_scope='source text and selected amendment chain; not legal advice'))
    return dict(document_id=id,title=title,source_url=url,retrieved_at='2026-11-17T13:00:00+07:00',
      source_file='sources/'+file,source_sha256=SOURCES[file]['sha256'],provisions=records)
D=[]
D.append(document('54/2014/QH13','Luật Hải quan — đối chiếu VBHN 54/VBHN-VPQH ngày 23/03/2026','customs-2026.pdf','https://chinhphu.vn/?docid=217294&pageid=27160','2015-01-01',[(24,1,''),(24,2,''),(25,1,''),(25,1,'b'),(25,2,''),(26,1,'')]))
D.append(document('18/2019/QĐ-TTG','Nhập khẩu máy móc, thiết bị đã qua sử dụng — điều khoản được chọn','used-machinery-2019.pdf','https://vanban.chinhphu.vn/?docid=196855&pageid=27160','2019-06-15',[(1,1,''),(1,2,''),(3,4,''),(4,3,''),(6,1,''),(6,2,''),(8,1,''),(8,1,'b'),(8,1,'c'),(8,2,''),(8,3,''),(8,3,'a'),(8,3,'b'),(9,1,'')]))
D.append(document('28/2022/QĐ-TTG','Sửa đổi QĐ 18/2019; phụ lục tuổi thiết bị','used-machinery-2022.pdf','https://vanban.chinhphu.vn/?docid=207040&pageid=27160','2023-03-01',[(2,1,'')]))
# Table cell from page 7; retain a table locator rather than invent an Article.
pages=fitz.open(ROOT/'sources/used-machinery-2022.pdf');raw=norm(pages[6].get_text());m=re.search(r'1\.6 (.*?) 1\.7 ',raw);assert m
D[-1]['provisions'].append(dict(article='Phụ lục I',clause='1.6',point='',text=m.group(1),effective_from='2023-03-01',effective_until=None,**REVIEW,status_evidence_url=D[-1]['source_url'],source_pdf_pages=[7]))
D.append(document('02/2026/QĐ-TTG','Sửa đổi thủ tục thuộc Bộ KH&CN; Điều 2 sửa QĐ 18/2019','machinery-amendment-2026.pdf','https://chinhphu.vn/?docid=216568&pageid=27160','2026-01-08',[(2,1,''),(2,2,''),(2,3,''),(7,1,'')]))
D.append(document('169/2026/NĐ-CP','Xử phạt vi phạm hành chính trong lĩnh vực hải quan','penalties-2026-congbao.pdf','https://chinhphu.vn/?docid=218154&pageid=27160','2026-07-01',[(38,1,''),(38,2,''),(39,1,''),(39,2,'')],page_start=26,page_end=80))
D.append(document('128/2020/NĐ-CP','Xử phạt hải quan — văn bản lịch sử, hết hiệu lực từ 01/07/2026','penalties-2020.pdf','https://chinhphu.vn/?docid=201401&pageid=27160','2020-12-10',[(35,1,''),(35,2,''),(36,1,''),(36,2,'')],end='2026-07-01'))
D[-1]['provisions'][1]['status_evidence_url']=D[-2]['source_url']
manifest={'snapshot_id':'askpay-demo-source-checked-2026-11-17','review_level':'AI_ASSISTED_SOURCE_CHECK_ONLY','settlement_eligible':False,'coverage':'SELECTED_DEMO_PROVISIONS_NOT_FULL_LEGAL_CORPUS','documents':D,
'amendment_notes':{'18/2019/QĐ-TTG':'Reviewed selected Articles 1,3,4,6,8,9(1) against 28/2022 and 02/2026. Do not use original Annex I or old Article 9(2)(b),9(3)(c).','54/2014/QH13':'Source is 54/VBHN-VPQH dated 23/03/2026; publication date is not an effective date. Only listed unchanged provisions included.','128/2020/NĐ-CP':'Historical only; Article 38 of 169/2026 ends effect 01/07/2026; Article 39 transition rules require case dates.'}}
raw=(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode();(ROOT/'manifest.json').write_bytes(raw)
(ROOT/'manifest.sha256').write_text(hashlib.sha256(raw).hexdigest()+'\n')
print(len(D),'documents',sum(len(d['provisions']) for d in D),'selected provisions',hashlib.sha256(raw).hexdigest())
