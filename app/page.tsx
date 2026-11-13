"use client";

import React, { useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  keccak256,
  parseEther,
  toBytes
} from "viem";
import { avalancheFuji } from "viem/chains";

const ESCROW_ABI = [
  {
    name: "askQuestion",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "questionId", type: "bytes32" },
      { name: "tier", type: "uint8" },
      { name: "questionHash", type: "bytes32" }
    ],
    outputs: []
  }
] as const;

const COMMON_SITUATIONS = [
  "Khai sai mã HS khi kiểm tra sau thông quan bị xử lý thế nào?",
  "Thủ tục đăng ký hồ sơ thương nhân xin cấp C/O lần đầu",
  "Điều kiện hoàn thuế nhập khẩu đối với hàng tái xuất",
  "Thời hạn nộp tờ khai hải quan đối với hàng hóa nhập khẩu"
];

const LEGAL_DOCUMENTS_LIST = [
  {
    code: "Luật số 54/2014/QH13",
    title: "Luật Hải quan quy định về thủ tục, kiểm tra, giám sát hải quan",
    status: "Đang có hiệu lực"
  },
  {
    code: "Luật số 107/2016/QH13",
    title: "Luật Thuế xuất khẩu, thuế nhập khẩu",
    status: "Đang có hiệu lực"
  },
  {
    code: "Luật số 05/2017/QH14",
    title: "Luật Quản lý ngoại thương",
    status: "Đang có hiệu lực"
  },
  {
    code: "Luật số 38/2019/QH14",
    title: "Luật Quản lý thuế",
    status: "Đang có hiệu lực"
  },
  {
    code: "Nghị định 08/2015/NĐ-CP & 59/2018/NĐ-CP",
    title: "Quy định chi tiết và biện pháp thi hành Luật Hải quan về thủ tục, kiểm tra, giám sát hải quan",
    status: "Đang có hiệu lực"
  },
  {
    code: "Nghị định 128/2020/NĐ-CP",
    title: "Quy định xử phạt vi phạm hành chính trong lĩnh vực hải quan",
    status: "Đang có hiệu lực"
  },
  {
    code: "Nghị định 134/2016/NĐ-CP & 18/2021/NĐ-CP",
    title: "Quy định chi tiết một số điều và biện pháp thi hành Luật Thuế xuất khẩu, thuế nhập khẩu",
    status: "Đang có hiệu lực"
  },
  {
    code: "Nghị định 69/2018/NĐ-CP",
    title: "Quy định chi tiết một số điều của Luật Quản lý ngoại thương (danh mục hàng hóa XNK có điều kiện)",
    status: "Đang có hiệu lực"
  },
  {
    code: "Nghị định 31/2018/NĐ-CP",
    title: "Quy định chi tiết Luật Quản lý ngoại thương về xuất xứ hàng hóa (C/O)",
    status: "Đang có hiệu lực"
  },
  {
    code: "Nghị định 43/2017/NĐ-CP & 111/2021/NĐ-CP",
    title: "Quy định về nhãn hàng hóa và nhãn phụ hàng hóa nhập khẩu",
    status: "Đang có hiệu lực"
  },
  {
    code: "Thông tư 38/2015/TT-BTC & 39/2018/TT-BTC",
    title: "Quy định về thủ tục hải quan; kiểm tra, giám sát hải quan; thuế xuất khẩu, thuế nhập khẩu",
    status: "Đang có hiệu lực"
  },
  {
    code: "Thông tư 14/2015/TT-BTC & 17/2021/TT-BTC",
    title: "Hướng dẫn về phân loại hàng hóa, phân tích để phân loại mã số HS",
    status: "Đang có hiệu lực"
  }
];

export default function AskPayPage() {
  const [account, setAccount] = useState<string>("");
  const [question, setQuestion] = useState<string>("");
  const [tier, setTier] = useState<"quick" | "deep">("quick");
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [showDocsModal, setShowDocsModal] = useState<boolean>(false);
  const [showReceiptDetail, setShowReceiptDetail] = useState<boolean>(false);

  const escrowAddress = process.env.NEXT_PUBLIC_ESCROW_ADDRESS || "";

  async function ensureFujiChain(eth: any) {
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0xa869" }]
      });
    } catch (switchError: any) {
      if (switchError.code === 4902) {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: "0xa869",
              chainName: "Avalanche Fuji",
              nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
              rpcUrls: ["https://api.avax-test.network/ext/bc/C/rpc"],
              blockExplorerUrls: ["https://testnet.snowtrace.io"]
            }
          ]
        });
      }
    }
  }

  async function connectWallet(): Promise<string> {
    setErrorMsg("");
    const eth = (window as any).avalanche || (window as any).ethereum;
    if (!eth) {
      setErrorMsg("Vui lòng cài đặt tiện ích ví trên trình duyệt để kết nối tài khoản thanh toán.");
      return "";
    }
    try {
      const accounts = await eth.request({ method: "eth_requestAccounts" });
      const selected = accounts?.[0] || "";
      setAccount(selected);
      if (selected) {
        await ensureFujiChain(eth);
      }
      return selected;
    } catch (err: any) {
      setErrorMsg(err.message || "Không thể kết nối ví.");
      return "";
    }
  }

  async function handleAsk(customQuestion?: string) {
    const queryText = (customQuestion ?? question).trim();
    if (!queryText) {
      setErrorMsg("Vui lòng nhập tình huống hoặc câu hỏi pháp lý bạn cần tra cứu.");
      return;
    }

    setErrorMsg("");
    setLoading(true);
    setResult(null);
    setShowReceiptDetail(false);

    try {
      const eth = typeof window !== "undefined" ? (window as any).avalanche || (window as any).ethereum : null;
      let activeAccount = account;

      // Nếu hợp đồng đã deploy và trình duyệt có ví nhưng user quên bấm "Kết nối ví" trước -> tự mở kết nối luôn
      if (!activeAccount && eth && escrowAddress && escrowAddress.startsWith("0x")) {
        activeAccount = await connectWallet();
      }

      const asker = activeAccount || "0x0000000000000000000000000000000000000001";
      const questionId = keccak256(toBytes(`${asker}-${Date.now()}-${queryText}`));
      const questionHash = keccak256(toBytes(queryText));
      let escrowTxHash = keccak256(toBytes(`PAYMENT_${questionId}`));

      if (activeAccount && eth && escrowAddress && escrowAddress.startsWith("0x")) {
        await ensureFujiChain(eth);
        const fujiRpc =
          process.env.NEXT_PUBLIC_FUJI_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc";
        const publicClient = createPublicClient({
          chain: avalancheFuji,
          transport: http(fujiRpc)
        });
        const walletClient = createWalletClient({
          chain: avalancheFuji,
          transport: custom(eth)
        });

        const depositValue = tier === "quick" ? parseEther("0.005") : parseEther("0.02");
        const txHash = await walletClient.writeContract({
          chain: avalancheFuji,
          account: activeAccount as `0x${string}`,
          address: escrowAddress as `0x${string}`,
          abi: ESCROW_ABI,
          functionName: "askQuestion",
          args: [questionId, tier === "quick" ? 0 : 1, questionHash],
          value: depositValue
        });
        await publicClient.waitForTransactionReceipt({ hash: txHash });
        escrowTxHash = txHash;
      }

      const res = await fetch("/api/ask-and-settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId,
          question: queryText,
          tier,
          askerAddress: asker,
          escrowTxHash
        })
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Không thể xử lý câu hỏi lúc này.");
      }

      setResult({ ...data, escrowTxHash, questionId, askedQuestion: queryText });
    } catch (err: any) {
      setErrorMsg(err.message || "Đã có lỗi xảy ra, vui lòng thử lại.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* A. Thanh điều hướng (Header) tinh gọn */}
      <header className="header-clean">
        <div
          style={{
            maxWidth: 920,
            margin: "0 auto",
            padding: "16px 24px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 16
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 11,
                background: "linear-gradient(135deg, #1d5b96 0%, #56a3e1 100%)",
                color: "#ffffff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 800,
                fontSize: 19,
                flexShrink: 0
              }}
            >
              §
            </div>
            <div>
              <div
                style={{
                  fontSize: 17.5,
                  fontWeight: 800,
                  color: "#0f2942",
                  letterSpacing: "-0.01em"
                }}
              >
                Trợ Lý Pháp Luật Hải Quan &amp; XNK
              </div>
              <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 2 }}>
                Tra cứu thủ tục hải quan, mã HS, C/O và thuế XNK chính xác theo văn bản pháp luật hiện hành
              </div>
            </div>
          </div>

          <button onClick={connectWallet} className="btn-connect">
            {account ? `Đã kết nối (${account.slice(0, 6)}...${account.slice(-4)})` : "Kết nối ví"}
          </button>
        </div>
      </header>

      {/* Nội dung trung tâm */}
      <main
        style={{
          flex: 1,
          maxWidth: 820,
          width: "100%",
          margin: "0 auto",
          padding: "44px 24px 56px"
        }}
      >
        {/* B. Khu vực trung tâm - Đặt câu hỏi (Hero Section) */}
        <section style={{ textAlign: "center", marginBottom: 28 }}>
          <h1
            style={{
              fontSize: 28,
              fontWeight: 800,
              color: "#0f2942",
              margin: "0 0 10px 0",
              letterSpacing: "-0.02em"
            }}
          >
            Bạn cần tra cứu quy định Xuất Nhập Khẩu nào hôm nay?
          </h1>
          <p style={{ fontSize: 15, color: "#64748b", margin: 0 }}>
            Giải đáp nhanh chóng kèm trích dẫn chính xác Điều, Khoản từ văn bản pháp luật Việt Nam
          </p>
        </section>

        {/* Khung nhập câu hỏi & Lựa chọn mức độ tư vấn */}
        <section className="search-box-card" style={{ padding: 20, marginBottom: 14 }}>
          <textarea
            rows={3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !loading) {
                e.preventDefault();
                handleAsk();
              }
            }}
            placeholder="Nhập tình huống hải quan, mã HS hoặc thủ tục XNK bạn cần tra cứu..."
            style={{
              width: "100%",
              border: "none",
              outline: "none",
              resize: "vertical",
              fontSize: 15.5,
              lineHeight: 1.6,
              color: "#0f2942",
              background: "transparent",
              marginBottom: 14,
              fontFamily: "inherit"
            }}
          />

          {/* D. Lựa chọn mức độ tư vấn */}
          <div
            className="tier-row"
            style={{
              display: "flex",
              gap: 10,
              marginBottom: 16
            }}
          >
            <button
              type="button"
              onClick={() => setTier("quick")}
              className={`tier-tab ${tier === "quick" ? "active" : ""}`}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 700, fontSize: 13.5, color: "#0f2942" }}>
                  Tra cứu nhanh
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#1d5b96",
                    background: "#e3f2fd",
                    padding: "2px 8px",
                    borderRadius: 999
                  }}
                >
                  0.05 USDC
                </span>
              </div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                Giải đáp trực tiếp điều khoản, mã HS, mức phạt hành chính
              </div>
            </button>

            <button
              type="button"
              onClick={() => setTier("deep")}
              className={`tier-tab ${tier === "deep" ? "active" : ""}`}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 700, fontSize: 13.5, color: "#0f2942" }}>
                  Phân tích chuyên sâu
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#0f2942",
                    background: "#d8ecfc",
                    padding: "2px 8px",
                    borderRadius: 999
                  }}
                >
                  0.20 USDC
                </span>
              </div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                Đối chiếu đa văn bản (Luật, Nghị định, Thông tư) cho tình huống phức tạp
              </div>
            </button>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 12,
              paddingTop: 12,
              borderTop: "1px solid #f1f5f9"
            }}
          >
            <div style={{ fontSize: 13, color: "#1d5b96", fontWeight: 500 }}>
              ✓ Trích dẫn đúng điều khoản luật hiện hành • Hoàn tiền 100% nếu không tìm thấy căn cứ pháp lý
            </div>

            <button
              type="button"
              onClick={() => handleAsk()}
              disabled={loading}
              className="btn-ask"
              title={`Thanh toán đảm bảo cho câu trả lời (${
                tier === "quick" ? "0.05 USDC ~ 0.005 AVAX" : "0.20 USDC ~ 0.02 AVAX"
              })`}
            >
              {loading
                ? "Đang tra cứu văn bản pháp luật..."
                : `Tra cứu ngay (${tier === "quick" ? "0.05 USDC" : "0.20 USDC"})`}
            </button>
          </div>
        </section>

        {/* C. Gợi ý tình huống thường gặp */}
        <section style={{ marginTop: 24, marginBottom: 32 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#64748b",
              marginBottom: 10
            }}
          >
            Tình huống thường gặp:
          </div>
          <div
            className="suggestions-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10
            }}
          >
            {COMMON_SITUATIONS.map((text, idx) => (
              <button
                key={idx}
                type="button"
                disabled={loading}
                className="suggestion-chip"
                onClick={() => {
                  setQuestion(text);
                  handleAsk(text);
                }}
              >
                <span style={{ color: "#56a3e1", marginRight: 6, fontWeight: 700 }}>→</span>
                {text}
              </button>
            ))}
          </div>
        </section>

        {loading && (
          <section className="answer-card" style={{ padding: 28, marginTop: 8 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: "#1d5b96", marginBottom: 14 }}>
              Đang tìm kiếm và đối chiếu điều khoản trong kho văn bản pháp luật...
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="skeleton-line" style={{ width: "92%" }} />
              <div className="skeleton-line" style={{ width: "84%" }} />
              <div className="skeleton-line" style={{ width: "68%" }} />
            </div>
          </section>
        )}

        {errorMsg && (
          <div
            style={{
              background: "#fff1f2",
              border: "1px solid #fecdd3",
              color: "#9f1239",
              padding: "14px 18px",
              borderRadius: 12,
              fontSize: 14,
              marginBottom: 24
            }}
          >
            {errorMsg}
          </div>
        )}

        {/* E. Hiển thị câu trả lời thân thiện, dễ đọc */}
        {result && (
          <section className="answer-card" style={{ padding: 28, marginTop: 8 }}>
            {result.askedQuestion && (
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: "#0f2942",
                  marginBottom: 14
                }}
              >
                “{result.askedQuestion}”
              </div>
            )}

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 10,
                paddingBottom: 16,
                marginBottom: 20,
                borderBottom: "1px solid #f1f5f9"
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  background: result.validation?.passed ? "#ecfdf5" : "#fffbeb",
                  color: result.validation?.passed ? "#065f46" : "#92400e",
                  border: `1px solid ${result.validation?.passed ? "#a7f3d0" : "#fde68a"}`,
                  padding: "6px 12px",
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 600
                }}
              >
                {result.validation?.passed
                  ? "✓ Đã đối chiếu chính xác với văn bản pháp luật hiện hành"
                  : "↺ Chưa đủ căn cứ pháp lý xác thực — Đã hoàn trả 100% phí tra cứu"}
              </span>

              <span style={{ fontSize: 12.5, color: "#64748b" }}>
                Phí tư vấn:{" "}
                <strong style={{ color: "#0f2942" }}>
                  {result.validation?.passed
                    ? (result.tier || tier) === "quick"
                      ? "0.05 USDC"
                      : "0.20 USDC"
                    : "0.00 USDC (Đã hoàn phí)"}
                </strong>
              </span>
            </div>

            {/* Nội dung giải đáp */}
            <div style={{ marginBottom: 24 }}>
              <h3 style={{ margin: "0 0 10px 0", fontSize: 16, fontWeight: 700, color: "#0f2942" }}>
                Giải đáp chi tiết
              </h3>
              <div
                style={{
                  fontSize: 15.5,
                  lineHeight: 1.7,
                  color: "#1e293b",
                  whiteSpace: "pre-line"
                }}
              >
                {result.answer}
              </div>
            </div>

            {/* Căn cứ pháp lý trích dẫn */}
            {(result.citations || []).length > 0 && (
              <div>
                <h3
                  style={{
                    margin: "0 0 12px 0",
                    fontSize: 15,
                    fontWeight: 700,
                    color: "#0f2942"
                  }}
                >
                  Căn cứ pháp lý trích dẫn
                </h3>

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {(result.citations || []).map((cit: any, idx: number) => {
                    const chk = result.validation?.citation_checks?.[idx];
                    const isActive = chk ? chk.is_in_force : true;
                    return (
                      <div key={idx} className="citation-box">
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            flexWrap: "wrap",
                            gap: 8,
                            marginBottom: 8
                          }}
                        >
                          <div style={{ fontWeight: 700, fontSize: 14, color: "#0f2942" }}>
                            Điều {cit.article}, Khoản {cit.clause} — Văn bản số{" "}
                            <span style={{ color: "#1d5b96" }}>{cit.document}</span>
                          </div>
                          <span
                            style={{
                              fontSize: 11.5,
                              fontWeight: 600,
                              padding: "2px 8px",
                              borderRadius: 999,
                              background: isActive ? "#e6f6fe" : "#fff1f2",
                              color: isActive ? "#1d5b96" : "#9f1239"
                            }}
                          >
                            {isActive ? "Đang có hiệu lực" : "Hết hiệu lực"}
                          </span>
                        </div>

                        {cit.document_title && (
                          <div style={{ fontSize: 12.5, color: "#64748b", marginBottom: 8 }}>
                            {cit.document_title}
                          </div>
                        )}

                        <div
                          style={{
                            fontSize: 14,
                            color: "#334155",
                            fontStyle: "italic",
                            lineHeight: 1.6
                          }}
                        >
                          &ldquo;{cit.excerpt}&rdquo;
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Biên lai thu gọn cho người muốn đối soát */}
            <div
              style={{
                marginTop: 20,
                paddingTop: 14,
                borderTop: "1px solid #f1f5f9",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: 12.5,
                color: "#64748b"
              }}
            >
              <span>Cam kết bảo vệ người hỏi bằng biên lai điện tử tự động</span>
              <button
                type="button"
                onClick={() => setShowReceiptDetail(!showReceiptDetail)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#1d5b96",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontSize: 12.5
                }}
              >
                {showReceiptDetail ? "Ẩn mã đối soát ▲" : "Xem mã đối soát giao dịch ▼"}
              </button>
            </div>

            {showReceiptDetail && (
              <div
                style={{
                  marginTop: 10,
                  padding: 12,
                  background: "#f8fafc",
                  borderRadius: 10,
                  fontSize: 12,
                  color: "#475569",
                  lineHeight: 1.7,
                  wordBreak: "break-all"
                }}
              >
                <div>Mã tra cứu: {result.questionId}</div>
                <div>Mã giao dịch thanh toán: {result.onchain?.fujiSettlementTxHash}</div>
                <div>Mã biên lai lưu trữ: {result.onchain?.l1ReceiptTxHash}</div>
              </div>
            )}
          </section>
        )}
      </main>

      {/* F. Chân trang / Nguồn dữ liệu (Footer tối giản) */}
      <footer
        style={{
          borderTop: "1px solid #e2e8f0",
          background: "#ffffff",
          padding: "18px 24px",
          fontSize: 13,
          color: "#64748b"
        }}
      >
        <div
          style={{
            maxWidth: 920,
            margin: "0 auto",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12
          }}
        >
          <span>
            Nguồn dữ liệu: Tổng hợp từ 30+ Luật, Nghị định và Thông tư Hải quan – XNK đang có hiệu lực
          </span>
          <button
            type="button"
            onClick={() => setShowDocsModal(true)}
            style={{
              background: "#f0f8ff",
              color: "#1d5b96",
              border: "1px solid #cfe6fa",
              padding: "6px 14px",
              borderRadius: 999,
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer"
            }}
          >
            Xem danh sách văn bản
          </button>
        </div>
      </footer>

      {/* Modal hiển thị danh sách văn bản pháp luật khi người dùng bấm xem */}
      {showDocsModal && (
        <div className="modal-backdrop" onClick={() => setShowDocsModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 16,
                paddingBottom: 12,
                borderBottom: "1px solid #e2e8f0"
              }}
            >
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: "#0f2942" }}>
                Danh mục Văn bản Pháp luật Hải quan &amp; XNK tiêu biểu
              </h3>
              <button
                type="button"
                onClick={() => setShowDocsModal(false)}
                style={{
                  background: "#f1f5f9",
                  border: "none",
                  borderRadius: 8,
                  padding: "6px 12px",
                  cursor: "pointer",
                  fontWeight: 600,
                  color: "#334155"
                }}
              >
                Đóng
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {LEGAL_DOCUMENTS_LIST.map((doc, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: "12px 14px",
                    borderRadius: 10,
                    border: "1px solid #e2e8f0",
                    background: "#f8fafc"
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 4
                    }}
                  >
                    <strong style={{ fontSize: 13.5, color: "#1d5b96" }}>{doc.code}</strong>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: "#065f46",
                        background: "#ecfdf5",
                        padding: "2px 8px",
                        borderRadius: 999
                      }}
                    >
                      {doc.status}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: "#334155" }}>{doc.title}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
