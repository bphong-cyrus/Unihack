# Kiểm tra bản mới — 17/11/2026

Commit: https://github.com/bphong-cyrus/Unihack/commit/395ff8f39510adc9fdfcabde5d89022bb5e0b9c7
Web kiểm tra: https://askpay-virid.vercel.app/
Đây là kết quả của bản đang deploy trước khi áp dụng ZIP. Không có giao dịch ví thật được ký trong lượt kiểm tra.

| Ca trên web | Quan sát |
|---|---|
| Máy tiện cũ từ Nhật, năm 2012, để bán lại, thiếu HS | Đã trả đúng máy móc thay vì hoàn thuế. Vẫn diễn đạt như nước sản xuất là Nhật; cần nêu rõ chưa đủ dữ kiện và mâu thuẫn mục đích bán lại |
| Kiểm chứng Điều 999 khoản 9 | Giữ nguyên Điều 999, không đổi thành Điều 25 — đạt |
| Thay 30 ngày bằng 60 ngày | Báo sai số liệu 60 so với 30 — đạt |
| 01/11/2026 → 17/11/2026, mốc 30 ngày | Đã qua 16, còn 14 — đạt phép tính; cần ghi giả định tính ngày |
| 128/2020 còn hiệu lực tại 17/11/2026? | Vẫn trả mức phạt cũ và “Đủ điều kiện giải ngân” — chưa đạt |
| Thuê trọ giữ cọc | Từ chối do ngoài phạm vi, không thu phí — đạt |

Lịch sử cũ đã có nhãn dữ liệu mô phỏng chưa xác minh. Nguồn được đặt trong bảng có thể đóng/mở, bớt chiếm màn hình. Không kiểm chứng lại luồng login vì phiên trình duyệt đang ở workspace demo.

## Payment: lỗi tái hiện trong code baseline

`app/api/ask-and-settle/x402-protocol.mjs`:
- Authorization đầy đủ trường nhưng signature toàn 0, không có tx, vẫn `ok:true`: helper chỉ kiểm tra regex, không recover signer.
- `verifyOnchainX402Receipt` chấp nhận receipt success có `to=USDC` và logs rỗng trong mock. Chưa yêu cầu calldata đặt cọc/event/Transfer/amount/payer tương ứng. Một lời gọi approve thành công không tự chứng minh đã trả phí.
- Route chỉ gọi kiểm RPC khi proof có txHash và cấu hình escrow. Nhánh authorization-only không chứng minh thanh toán.
- Cache Map trong một process không bảo vệ đa instance; cache lookup ở trước payment verification cũng cần xem lại.

**Chưa chứng minh rút được tiền escrow trái phép.** Guard vẫn đối chiếu trạng thái/request. Không đánh đồng lỗ hổng xác minh proof với exploit rút tiền đã thực nghiệm.

Route mới `canSettleCuratedProxy` tự đổi eligibility false thành true chỉ vì local record có `verified` và `ACTIVE`, không đối chiếu point/date/source version/excerpt. `build_corpus.py` còn tự đánh dấu 49 record cũ `verified=True`. Nhãn đó không phải bằng chứng đã đối chiếu nguồn hiện hành.

## Nguồn pháp lý quan trọng cần cập nhật

NĐ 169/2026, Điều 38: hiệu lực từ 01/07/2026; NĐ 128/2020 hết hiệu lực. Điều 39 quy định chuyển tiếp, không thể chỉ thay mã văn bản cho mọi tình huống lịch sử.
- https://chinhphu.vn/?docid=218154&pageid=27160
- https://baochinhphu.vn/nhieu-quy-dinh-moi-ve-xu-phat-vi-pham-hanh-chinh-trong-linh-vuc-hai-quan-102260521151606327.htm

Máy móc: bổ sung QĐ 02/2026 (Điều 2 sửa thủ tục Điều 9 QĐ 18/2019), không chỉ dừng ở QĐ 28/2022.
- https://chinhphu.vn/?docid=216568&pageid=27160

## Kết quả chạy cục bộ

Baseline: 20 Node tests, 76 Python tests, Next build thành công.
Bản vá: 40 Node tests/subtests (gồm local EVM), 89 Python tests, 8 HTTP smoke checks, Next build thành công.
Các con số là bằng chứng kiểm tra kỹ thuật, không phải tỷ lệ đúng của tư vấn pháp lý hoặc xác nhận thanh toán Fuji end-to-end.
