# AskPay XNK

Ứng dụng thử nghiệm tra cứu pháp luật xuất nhập khẩu, gồm giao diện Next.js và dịch vụ FastAPI. Dữ liệu demo chưa được xác minh; kiểm tra độ khớp trích dẫn không chứng minh câu trả lời đúng hay văn bản còn hiệu lực. Không có thanh toán hoặc hoàn tiền thật trong luồng giao diện hiện tại.

## Chạy cục bộ

Yêu cầu Node.js, npm và Python 3. Cài các phụ thuộc được khai báo trong dự án:

```bash
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r ai-service/requirements.txt
```

Trong một terminal, chạy dịch vụ AI từ thư mục dự án:

```bash
cd ai-service
../.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Trong terminal khác, chạy giao diện:

```bash
npm run dev
```

Mở địa chỉ được Next.js in ra, thông thường là `http://localhost:3000`. Mặc định giao diện gọi dịch vụ tại `http://127.0.0.1:8000/api/v1/legal/ask`. Nếu chạy dịch vụ ở địa chỉ khác, đặt `LEGAL_RAG_API_URL` cho tiến trình Next.js. Khi địa chỉ này không kết thúc bằng `/ask`, đặt thêm `LEGAL_CORPUS_API_URL` đến endpoint corpus.

Không cấu hình snapshot thì API dùng các ví dụ demo. Để dùng snapshot riêng, đặt `ASKPAY_CORPUS_MANIFEST` cho tiến trình FastAPI và kiểm tra manifest theo [hướng dẫn kho luật](docs/KHO_LUAT_PHIEN_BAN.md). Snapshot cần được người có thẩm quyền đối chiếu thực tế; các trường ghi nhận duyệt và hash tự chúng không xác nhận tính chính xác hoặc hiệu lực.

## Kiểm tra

```bash
.venv/bin/python -m unittest discover -s ai-service/tests -q
PYTHON=.venv/bin/python node --test tests/legal-proxy.test.mjs tests/memo.test.cjs
npm run build
```

Danh mục và nguồn văn bản đã thu thập nằm tại [research/DANH_MUC_NGUON_LUAT.md](research/DANH_MUC_NGUON_LUAT.md); các kết quả OCR nằm trong `research/extracted/` và chưa được kiểm duyệt. Thiết kế, giới hạn và công việc còn lại được mô tả tại [docs/KE_HOACH_THIET_KE.md](docs/KE_HOACH_THIET_KE.md).
