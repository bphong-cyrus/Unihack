"""Bounded, reproducible demo API. RULE_BASED_DEMO, never a paid legal verdict.
Run: python -m uvicorn demo_api:app --port 8000 --app-dir ai-service
Keep LegalIR/LegalQA adapters in legal_pipeline.py for general questions.
"""
from datetime import date,datetime,timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
import hashlib,json,os,re,unicodedata
from fastapi import FastAPI,HTTPException
from pydantic import BaseModel,Field
from legal_corpus import load_snapshot
from versioned_validator import validate_snapshot_citations
from release_policy import POLICY_HASH, POLICY_VERSION, evaluate_release_policy
from snapshot_api import corpus_response

MANIFEST=Path(os.environ.get('ASKPAY_CORPUS_MANIFEST',str(Path(__file__).resolve().parents[1]/'corpus/demo-v1/manifest.json')))
SNAPSHOT=load_snapshot(MANIFEST)
app=FastAPI(title='AskPay bounded source-backed demo',version='2026.11.17')
class Ask(BaseModel):
    question_id:str=Field(min_length=1,max_length=100)
    question:str=Field(min_length=1,max_length=12000)
    tier:str='quick'
    mode:str='quick'
    as_of:date|None=None
    factcheck_payload:dict|None=None
    simulate_hallucination:bool=False
    simulate_expired_law:bool=False

def fold(s):
    return ''.join(x for x in unicodedata.normalize('NFD',s.lower().replace('đ','d')) if unicodedata.category(x)!='Mn')
def citation(p):
    return dict(document=p.document_id,document_title=p.document_title,article=p.article,clause=p.clause,point=p.point,excerpt=p.text)
def lookup(doc,art,clause,point,asof): return SNAPSHOT.lookup(doc,str(art),str(clause),point,asof)
def result(req,asof,answer,citations,status,extra=None):
    validation=validate_snapshot_citations(citations,SNAPSHOT,asof)
    policy=evaluate_release_policy(
        question=req.question,mode=req.mode,as_of=asof,answer_status=status,
        citations=citations,validation=validation,
        snapshot_id=SNAPSHOT.snapshot_id,snapshot_sha256=SNAPSHOT.snapshot_sha256,
    )
    validation.update(
        verdict='CITATIONS_MATCH' if validation['passed'] else 'UNVERIFIED',
        settlement_eligible=policy['settlement_eligible'],
        policy_version=policy['policy_version'],
        policy_hash=policy['policy_hash'],
        whitelist_id=policy['whitelist_id'],
        policy_reason=policy['policy_reason'],
        review_level='AI_ASSISTED_SOURCE_CHECK_ONLY',
    )
    obj=dict(question_id=req.question_id,tier=req.tier,answer=answer,citations=citations,validation=validation,
        answer_status=status,answer_method='RULE_BASED_DEMO',snapshot_id=SNAPSHOT.snapshot_id,
        snapshot_sha256=SNAPSHOT.snapshot_sha256,as_of=asof.isoformat(),payment_status='DISABLED',latency_ms=0,
        policy_version=policy['policy_version'],policy_hash=policy['policy_hash'])
    if extra: obj.update(extra)
    def h(x): return '0x'+hashlib.sha256(json.dumps(x,ensure_ascii=False,sort_keys=True).encode()).hexdigest()
    obj['hashes']=dict(question_hash=h(req.question),answer_hash=h(answer),citations_hash=h(citations),
                      validator_hash=h(validation),corpus_hash='0x'+SNAPSHOT.snapshot_sha256)
    return obj

def factcheck(req,asof):
    p=req.factcheck_payload or {};q=req.question
    def found(pattern):
        m=re.search(pattern,q,re.I);return m.group(1) if m else ''
    doc=p.get('document') or found(r'(\d+/\d{4}/(?:QH\d+|NĐ-CP|QĐ-TTg|TT-[A-ZĐ]+))')
    art=p.get('article') or found(r'Điều\s+(\d+[a-z]?)')
    cl=p.get('clause') or found(r'Khoản\s+(\d+)')
    pt=p.get('point') or found(r'Điểm\s+([a-zđ])\b')
    excerpt=p.get('excerpt')
    if excerpt is None: excerpt=q.split(':',1)[1].strip() if ':' in q else ''
    if any(not isinstance(v,str) for v in [doc,art,cl,pt,excerpt]): raise HTTPException(400,'Invalid citation target')
    if not all([doc,art,cl]):
        return result(req,asof,'Cần số hiệu văn bản, Điều và Khoản cần kiểm chứng. Đối tượng kiểm chứng sẽ được giữ nguyên.',[],'NEEDS_CLARIFICATION')
    target=dict(document=doc,article=art,clause=cl,point=pt,excerpt=excerpt)
    original=next((x for x in SNAPSHOT.provisions if (x.document_id,x.article,x.clause,x.point)==(''.join(doc.upper().split()),art,cl,pt)),None)
    valid=lookup(doc,art,cl,pt,asof)
    if original is None:
        answer=f'Không tìm thấy Điều {art}, Khoản {cl}, Điểm {pt or "—"} của {doc} trong corpus demo. Không thay bằng điều khác; corpus này không bao phủ toàn bộ văn bản.'
    elif valid is None:
        answer='Điều khoản có trong dữ liệu nhưng không đủ điều kiện hiệu lực/rà soát cho ngày áp dụng. Không xác nhận dùng làm căn cứ hiện hành.'
    elif not excerpt:
        answer='Tìm thấy đúng Điều/Khoản trong corpus. Chưa kiểm tra nguyên văn vì bạn chưa gửi đoạn trích.'
    else:
        v=validate_snapshot_citations([target],SNAPSHOT,asof)
        if v['passed']: answer='Đoạn trích khớp nguồn tại đúng đối tượng bạn yêu cầu. Việc áp dụng cho tình huống vẫn cần được đánh giá riêng.'
        else:
            wrong=sorted(set(re.findall(r'\d+',excerpt))-set(re.findall(r'\d+',valid.text)))
            source_numbers=sorted(set(re.findall(r'\d+',valid.text)))
            answer='Đoạn trích không khớp nguyên văn. '+(f'Số ở đầu vào không có trong nguồn: {wrong}; các số trong nguồn: {source_numbers}.' if wrong else 'Xem đoạn nguồn để đối chiếu từng từ và điều kiện.')
    return result(req,asof,answer,[target],'FACTCHECK',{'factcheck_target':target,'source_excerpt':original.text if original else None})

@app.get('/api/v1/legal/corpus')
def corpus():
    return {**corpus_response(SNAPSHOT),'review_level':'AI_ASSISTED_SOURCE_CHECK_ONLY','coverage':'SELECTED_DEMO_PROVISIONS','settlement_eligible':False,'policy_version':POLICY_VERSION,'policy_hash':POLICY_HASH}
@app.get('/health')
def health(): return {'status':'ok','snapshot_sha256':SNAPSHOT.snapshot_sha256,'payment_enabled':False}
@app.post('/api/v1/legal/ask')
def ask(req:Ask):
    if req.tier not in ('quick','deep'): raise HTTPException(400,'Invalid tier')
    if req.simulate_hallucination or req.simulate_expired_law: raise HTTPException(400,'Use explicit factcheck input instead of simulated corruption')
    asof=req.as_of or datetime.now(ZoneInfo('Asia/Ho_Chi_Minh')).date();q=fold(req.question)
    if req.mode=='factcheck' or 'kiem chung' in q: return factcheck(req,asof)
    if asof>date(2026,11,17):
        return result(req,asof,'Corpus chưa được rà soát đến ngày yêu cầu. Cần cập nhật nguồn trước khi trả lời.',[],'INSUFFICIENT_EVIDENCE')
    keys=[];status='ANSWERED'
    if '128/2020' in q or '169/2026' in q or '127/2013' in q:
        if asof<date(2026,7,1):
            return result(req,asof,'Đây là câu hỏi lịch sử; cần đối chiếu ngày vi phạm, ngày quyết định và văn bản sửa đổi. Bộ demo chưa đủ để kết luận mức phạt.',[],'NEEDS_CLARIFICATION')
        keys=[('169/2026/NĐ-CP',38,1,''),('169/2026/NĐ-CP',38,2,''),('169/2026/NĐ-CP',39,1,'')]
        answer='Nghị định 128/2020/NĐ-CP hết hiệu lực từ 01/07/2026 theo Điều 38 Nghị định 169/2026/NĐ-CP. Không dùng mức phạt cũ cho một hành vi mới vào tháng 11/2026. Vụ việc cũ còn phải đối chiếu Điều 39 về chuyển tiếp; cần ngày hành vi và ngày quyết định.'
        if '127/2013' in q: answer='Nghị định 127/2013 đã hết hiệu lực từ 10/12/2020 (Điều 35 Nghị định 128/2020; xem PDF lịch sử kèm corpus). '+answer
    elif '18/2019' in q and ('khoan 1 dieu 6' in q or 'dieu 6' in q) and ('tuoi thiet bi' in q or '10 nam' in q) and not any(w in q for w in ['ban lai','may cua toi','co duoc nhap','nhap tu nhat','nam 20']):
        keys=[('18/2019/QĐ-TTG',6,1,'')]
        answer='Theo Khoản 1 Điều 6 Quyết định 18/2019/QĐ-TTg, quy tắc chung là tuổi thiết bị không vượt quá 10 năm; một số lĩnh vực cụ thể áp dụng giới hạn riêng tại Phụ lục I.'
    elif '18/2019' in q and ('khoan 3 dieu 8' in q or 'diem b khoan 3 dieu 8' in q) and any(t in q for t in ['chung thu giam dinh','bao quan','30 ngay']) and not any(w in q for w in ['ban lai','may cua toi','nhap tu nhat']):
        keys=[('18/2019/QĐ-TTG',8,3,'b')]
        answer='Theo Điểm b Khoản 3 Điều 8 Quyết định 18/2019/QĐ-TTg, trong thời hạn không quá 30 ngày kể từ ngày đưa máy móc, thiết bị về bảo quản, doanh nghiệp phải nộp Cơ quan hải quan chứng thư giám định.'
    elif any(x in q for x in ['may tien','may moc','thiet bi da qua su dung','may cu']):
        status='NEEDS_CLARIFICATION';keys=[('18/2019/QĐ-TTG',4,3,''),('18/2019/QĐ-TTG',6,1,''),('18/2019/QĐ-TTG',8,1,'')]
        answer=('Chưa đủ căn cứ để kết luận được nhập. Cần xác nhận mã HS và công dụng kỹ thuật, năm sản xuất/năm nhập, nước sản xuất, mục đích sử dụng và giấy xác nhận của nhà sản xuất hoặc chứng thư giám định. '
                'Nhập từ Nhật không tự chứng minh máy được sản xuất tại Nhật. Nếu chỉ nhập để bán lại, cần làm rõ điều kiện phục vụ trực tiếp hoạt động sản xuất tại Khoản 3 Điều 4, chưa thể kết luận đáp ứng. '
                'Quy tắc chung là tuổi thiết bị không quá 10 năm, có nhóm ngoại lệ ở Phụ lục I. Không tự gán HS 84.58 chỉ từ tên “máy tiện”.')
        if req.tier=='deep':
            keys += [('28/2022/QĐ-TTG','Phụ lục I','1.6',''),('18/2019/QĐ-TTG',8,3,''),('54/2014/QH13',26,1,'')]
            answer+=(' Nếu hồ sơ xác nhận đúng máy tiện bóc tách kim loại thuộc nhóm 84.58, Mục 1.6 Phụ lục I QĐ 28/2022 nêu giới hạn 20 năm; đây chỉ là một tiêu chí. '
                     'Khi thiếu giấy xác nhận/chứng thư, việc đưa về bảo quản có điều kiện đăng ký giám định và thời hạn nộp chứng thư tại Khoản 3 Điều 8. QĐ 02/2026 sửa thủ tục trường hợp khác ở Điều 9; không dùng mẫu cũ để nộp hồ sơ.')
    elif (('khoan 2' in q and 'dieu 25' in q) or '15 ngay' in q or 'gia tri lam thu tuc' in q) and ('to khai' in q or '54/2014' in q or 'dieu 25' in q):
        keys=[('54/2014/QH13',25,2,'')]
        answer='Theo Khoản 2 Điều 25 Luật Hải quan 54/2014/QH13, tờ khai hải quan có giá trị làm thủ tục hải quan trong thời hạn 15 ngày kể từ ngày đăng ký.'
    elif ('30 ngay' in q or 'to khai' in q) and any(x in q for x in ['thoi han','bao lau','con bao nhieu','ngay','nop']):
        keys=[('54/2014/QH13',25,1,'b')]
        dates=re.findall(r'\b(\d{2}/\d{2}/\d{4})\b',req.question)
        if len(dates)==2:
            try: start,reference=[datetime.strptime(x,'%d/%m/%Y').date() for x in dates]
            except ValueError: raise HTTPException(400,'Ngày không hợp lệ')
            elapsed=(reference-start).days;remaining=30-elapsed
            if elapsed<0: answer='Ngày đối chiếu đứng trước ngày hàng đến. Cần xác nhận lại hai mốc.';status='NEEDS_CLARIFICATION'
            else: answer=f'Từ {dates[0]} đến {dates[1]} đã qua {elapsed} ngày; '+(f'còn {remaining} ngày' if remaining>=0 else f'đã vượt mốc 30 ngày {-remaining} ngày')+'. Đây là phép trừ ngày lịch, lấy ngày thứ nhất làm ngày hàng đến và không tính ngày bắt đầu; chưa kết luận hạn pháp lý cuối cùng hay xử lý ngày nghỉ.'
        else:
            answer='Đối với hàng nhập khẩu: nộp trước ngày hàng đến cửa khẩu hoặc trong 30 ngày kể từ ngày hàng đến cửa khẩu (Điểm b Khoản 1 Điều 25). Cần ngày hàng đến để tính khoảng thời gian còn lại.'
        if req.tier=='deep':
            keys.append(('54/2014/QH13',25,2,''));answer+=' Phân biệt với thời hạn 15 ngày có giá trị làm thủ tục của tờ khai kể từ ngày đăng ký; đó là mốc khác.'
    else:
        return result(req,asof,'Bộ demo chưa có đủ căn cứ cho câu hỏi này. Hiện hỗ trợ thời hạn tờ khai nhập khẩu, kiểm chứng trích dẫn, máy cũ và hiệu lực nghị định xử phạt. Không suy đoán từ một điều khoản có từ khóa gần giống.',[],'INSUFFICIENT_EVIDENCE')
    items=[lookup(*k,asof) for k in keys]
    if any(x is None for x in items): return result(req,asof,'Thiếu phiên bản nguồn phù hợp ngày áp dụng. Chưa đủ căn cứ để trả lời.',[],'INSUFFICIENT_EVIDENCE')
    return result(req,asof,answer,[citation(x) for x in items],status)
