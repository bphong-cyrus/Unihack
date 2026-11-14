# AskPay research and prototype status

`askpay-bibliography.bib` preserves the bibliography supplied for the project. Its entries and URLs have not been independently verified; inclusion is not evidence that a method is implemented or that a paper supports a particular claim.

The existing Python service is a keyword-based demonstration, not a LegalIR/LegalQA model. Its seven sample records lack authoritative provenance and current clause-level legal status. They cannot establish the accuracy of legal advice or authorize real settlement. The validator compares text only against those samples; passing it does not verify that an answer follows from a citation or that a law is in force. The web route forwards to the Python service and fails when it is unavailable; wallet settlement is disabled while the corpus is unverified. Do not use this prototype for real funds or legal decisions.

Before production, ingest authoritative source text and versioned effective dates for the required corpus, independently review each clause and amendment, integrate and evaluate the retrieval and QA components, reconcile the two validators, and validate the escrow and oracle workflow end to end. The requested 30-document corpus and models were not supplied.

Run the API with `python -m uvicorn main:app --app-dir ai-service` after installing `ai-service/requirements.txt`. Run contract tests with `python -m unittest discover -s ai-service/tests -v`. The standalone validator accepts `POST /api/v1/legal/validate` with a JSON object containing a `citations` array. The corpus endpoint marks the current data `DEMO_UNVERIFIED`.

## Kiểm kê bản nghiên cứu

`paper-index.json` ghi đối chiếu bước đầu 100 mục trong BibTeX với kết quả tải truy cập mở: 81 PDF đã tải, 5 mã chưa tải được và 14 mục không có DOI/arXiv trong dữ liệu đầu vào. PDF được lưu cục bộ tại thư mục `../AskPay-Papers/` tính từ thư mục dự án cha (`/home/hvusynh2/nguyenduong/AskPay-Papers` trong môi trường thu thập), không nằm trong Git để tránh giả định quyền phân phối lại. Chỉ mục Git lưu liên kết nguồn và SHA-256. Tình trạng truy cập có thể thay đổi.

Trường `title_review: CHECK` đánh dấu sự khác nhau theo phép so chuỗi, không tự xác định bài đúng hay sai; các mục chưa trả metadata cũng cần kiểm tra. Tên trong BibTeX có thể chứa cú pháp LaTeX và cách chuẩn hóa hiện tại chỉ phục vụ kiểm kê. Cần đối chiếu thủ công tên bài, tác giả, năm, định danh và giấy phép trước khi trích dẫn hoặc chia sẻ. Các mục `NO_IDENTIFIER` gồm cả bộ dữ liệu/tài liệu kỹ thuật, không mặc định là bài báo. Không sử dụng nguồn bị chặn hoặc truy cập tổ chức khi chưa được cấp quyền.

Đợt tìm theo tiêu đề tiếp theo tìm được thêm hai PDF có tiêu đề gần khớp, được gắn `DOWNLOADED_TITLE_MATCH_REVIEW`; cần đối chiếu năm và metadata trước khi dùng. Một ứng viên ViDRILL có độ tin cậy thấp và tên bài khác đã bị loại khỏi kết quả phù hợp. Các mục còn lại chưa tìm được PDF phù hợp bằng quy trình này; trạng thái và kết quả tìm được giữ trong `title_resolution`.

Tiếp theo, tám PDF từ URL công khai của tác giả/hội nghị trong danh mục đã được tải và kiểm tra trang đầu; chúng mang trạng thái `DOWNLOADED_DIRECT_REVIEW` vì vẫn cần rà soát đầy đủ metadata và giấy phép. Một URL trả HTTP 403 được ghi lại, không dùng kỹ thuật vượt chặn. Số liệu theo từng trạng thái trong `paper-index.json` là nguồn cập nhật nhất.
