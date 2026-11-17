"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  ChatMessage,
  EXPERT_LAWYERS,
  ExpertLawyer,
  buildFormalMemoHtml
} from "../data/legalWorkspaceData";
import {
  CheckCircleIcon,
  CloseXIcon,
  DownloadIcon,
  FileTextIcon,
  SearchIcon,
  StarIcon,
  UsersIcon
} from "./Icons";

export type RightTab = "document" | "experts" | "citation";

interface RightPanelProps {
  isOpen: boolean;
  activeTab: RightTab;
  onChangeTab: (tab: RightTab) => void;
  onClose: () => void;
  activeQuestion: string;
  activeAssistantMsg: ChatMessage | null;
  selectedCitationIdx: number;
  onSelectCitationIdx: (idx: number) => void;
  onConnectExpert: (lawyer: ExpertLawyer) => void;
}

function renderHighlightedLawText(rawText: string, excerpt: string, passed: boolean) {
  if (!rawText) return null;
  const cleanExcerpt = (excerpt || "").trim();
  if (!cleanExcerpt) return <span>{rawText}</span>;

  const idx = rawText.toLowerCase().indexOf(cleanExcerpt.toLowerCase());
  if (idx !== -1) {
    const before = rawText.slice(0, idx);
    const match = rawText.slice(idx, idx + cleanExcerpt.length);
    const after = rawText.slice(idx + cleanExcerpt.length);
    return (
      <>
        <span>{before}</span>
        <mark
          style={{
            background: passed ? "#fef08a" : "#fed7aa",
            color: "#0a1c2e",
            fontWeight: 600,
            padding: "1px 3px",
            borderRadius: 3
          }}
        >
          {match}
        </mark>
        <span>{after}</span>
      </>
    );
  }

  return <span>{rawText}</span>;
}

export default function RightPanel({
  isOpen,
  activeTab,
  onChangeTab,
  onClose,
  activeQuestion,
  activeAssistantMsg,
  selectedCitationIdx,
  onSelectCitationIdx,
  onConnectExpert
}: RightPanelProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastMemoKeyRef = useRef<string>("");
  const [copiedMemo, setCopiedMemo] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen || activeTab !== "document" || !editorRef.current) return;
    const memoKey = `${activeAssistantMsg?.id || "none"}::${activeQuestion}`;
    if (lastMemoKeyRef.current !== memoKey || !editorRef.current.innerHTML.trim()) {
      editorRef.current.innerHTML = buildFormalMemoHtml(activeQuestion, activeAssistantMsg);
      lastMemoKeyRef.current = memoKey;
    }
  }, [activeQuestion, activeAssistantMsg, isOpen, activeTab]);

  if (!isOpen) return null;

  const citations = activeAssistantMsg?.citations || [];
  const checks = activeAssistantMsg?.validation?.citation_checks || [];
  const safeIdx = Math.min(selectedCitationIdx, Math.max(0, citations.length - 1));
  const currentCit = citations[safeIdx];
  const currentCheck = checks[safeIdx];
  const passed = Boolean(activeAssistantMsg?.validation?.passed);

  function applyFormat(cmd: string) {
    if (typeof document !== "undefined") {
      document.execCommand(cmd, false);
    }
  }

  function handleCopyMemo() {
    const text = editorRef.current?.innerText || "";
    if (text && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedMemo(true);
      setTimeout(() => setCopiedMemo(false), 1800);
    }
  }

  return (
    <aside className="panel-right" aria-label="Bảng đối chiếu và tiện ích">
      {/* 3-Tab Header */}
      <div className="right-tabs-header">
        <div className="right-tabs-row">
          <button
            type="button"
            onClick={() => onChangeTab("document")}
            className={`tab-btn ${activeTab === "document" ? "active" : ""}`}
          >
            <FileTextIcon size={15} />
            Văn bản
          </button>
          <button
            type="button"
            onClick={() => onChangeTab("experts")}
            className={`tab-btn ${activeTab === "experts" ? "active" : ""}`}
          >
            <UsersIcon size={15} />
            Chuyên gia
          </button>
          <button
            type="button"
            onClick={() => onChangeTab("citation")}
            className={`tab-btn ${activeTab === "citation" ? "active" : ""}`}
          >
            <SearchIcon size={15} />
            Trích dẫn
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="icon-btn"
          style={{ marginBottom: 6, minWidth: 36, minHeight: 36 }}
          title="Đóng bảng nguồn luật"
          aria-label="Đóng bảng nguồn luật"
        >
          <CloseXIcon size={16} />
        </button>
      </div>

      {/* Tab Content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* TAB 1: TRÍCH DẪN (CORE ASKPAY VERIFICATION) */}
        {activeTab === "citation" && (
          <>
            <div className="custom-scrollbar" style={{ flex: 1, overflowY: "auto", padding: 16 }}>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  marginBottom: 12
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span className="section-micro-label">NGUỒN LUẬT ĐỐI CHIẾU</span>

                  {activeAssistantMsg ? (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        padding: "3px 9px",
                        borderRadius: 999,
                        fontSize: 11.5,
                        fontWeight: 700,
                        background: passed ? "#ecfdf5" : "#fffbeb",
                        color: passed ? "#047857" : "#b45309",
                        border: `1px solid ${passed ? "#a7f3d0" : "#fde68a"}`
                      }}
                    >
                      {passed ? "✔ Đoạn trích khớp nguồn" : "! Chưa khớp nguồn"}
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: 11,
                        color: "#64748b",
                        background: "#f1f5f9",
                        padding: "3px 8px",
                        borderRadius: 999
                      }}
                    >
                      Chờ tra cứu
                    </span>
                  )}
                </div>
                {activeAssistantMsg && (
                  <div style={{ fontSize: 11.5, color: "#64748b", lineHeight: 1.45 }}>
                    {activeAssistantMsg.validation?.corpus_status === "REVIEW_ASSERTED"
                      ? "Nguồn từ snapshot đã gắn ngày rà soát. Việc áp dụng còn phụ thuộc tình huống cụ thể."
                      : "Nguồn trong bộ dữ liệu thử nghiệm · Cần kiểm tra hiệu lực trước khi áp dụng."}
                  </div>
                )}
              </div>

              {/* Citation selector pills if >1 citation */}
              {citations.length > 1 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                  {citations.map((c, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => onSelectCitationIdx(idx)}
                      style={{
                        padding: "4px 9px",
                        borderRadius: 7,
                        fontSize: 11.5,
                        fontWeight: 600,
                        cursor: "pointer",
                        border:
                          safeIdx === idx ? "1px solid #102a43" : "1px solid #e2e8f0",
                        background: safeIdx === idx ? "#102a43" : "#f8fafc",
                        color: safeIdx === idx ? "#ffffff" : "#475569"
                      }}
                    >
                      Đ{c.article}.K{c.clause}{c.point ? `.Điểm ${c.point}` : ""} · {c.document}
                    </button>
                  ))}
                </div>
              )}

              {currentCit ? (
                <>
                  <div style={{ marginBottom: 12 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                        flexWrap: "wrap"
                      }}
                    >
                      <h3
                        style={{
                          margin: 0,
                          fontSize: 15,
                          fontWeight: 700,
                          color: "#0a1c2e"
                        }}
                      >
                        Điều {currentCit.article}, Khoản {currentCit.clause}{currentCit.point ? `, Điểm ${currentCit.point}` : ""}
                      </h3>
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: 999,
                          background:
                            currentCheck && !currentCheck.is_in_force ? "#fee2e2" : "#ecfdf5",
                          color:
                            currentCheck && !currentCheck.is_in_force ? "#991b1b" : "#047857"
                        }}
                      >
                        {currentCheck && !currentCheck.is_in_force
                          ? "Hết hiệu lực"
                          : "Đang có hiệu lực"}
                      </span>
                    </div>

                    <div style={{ fontSize: 12.5, color: "#475569", marginTop: 3, fontWeight: 500 }}>
                      {currentCit.document}
                      {currentCit.document_title ? ` — ${currentCit.document_title}` : ""}
                    </div>
                  </div>

                  {currentCheck?.source_url && currentCheck.source_url.startsWith("https://") && (
                    <p style={{ fontSize: 12, margin: "0 0 12px" }}>
                      <a href={currentCheck.source_url} target="_blank" rel="noreferrer">Xem nguồn văn bản gốc ↗</a>
                      {activeAssistantMsg?.validation?.as_of && ` · Ngày tra cứu: ${activeAssistantMsg.validation.as_of}`}
                    </p>
                  )}

                  {/* Authentic Raw Text Card */}
                  <div className="law-paper-box">
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#64748b",
                        marginBottom: 6,
                        textTransform: "uppercase"
                      }}
                    >
                      Trích lục văn bản pháp luật:
                    </div>
                    {currentCheck?.raw_text ? (
                      <div>
                        {renderHighlightedLawText(
                          currentCheck.raw_text,
                          currentCit.excerpt,
                          currentCheck.status === "PASS"
                        )}
                      </div>
                    ) : (
                      <div>&ldquo;{currentCit.excerpt}&rdquo;</div>
                    )}

                    {currentCheck &&
                      currentCheck.excerpt_similarity < 0.9 &&
                      currentCit.excerpt && (
                        <div
                          style={{
                            marginTop: 10,
                            paddingTop: 8,
                            borderTop: "1px dashed #e2e8f0",
                            fontSize: 12,
                            color: "#991b1b"
                          }}
                        >
                          <strong>Đoạn AI đã trích (Không khớp):</strong> &ldquo;{currentCit.excerpt}
                          &rdquo;
                        </div>
                      )}
                  </div>

                  <p style={{ marginTop: 10, fontSize: 11.5, color: "#64748b", lineHeight: 1.5 }}>
                    Kiểm tra khớp văn bản &amp; hiệu lực nguồn; không thay thế ý kiến tư vấn pháp lý.
                  </p>
                </>
              ) : (
                <div
                  style={{
                    border: "1px dashed #cbd5e1",
                    borderRadius: 12,
                    padding: 20,
                    textAlign: "center",
                    fontSize: 13,
                    color: "#64748b",
                    background: "#f8fafc"
                  }}
                >
                  {activeAssistantMsg
                    ? activeAssistantMsg.onchain?.mode === "LIVE_AVALANCHE"
                      ? "Không tìm thấy trích dẫn phù hợp hoặc văn bản đã hết hiệu lực — Escrow đang xử lý hoàn cọc theo quy tắc."
                      : "Chưa tìm thấy trích dẫn phù hợp hoặc văn bản đã hết hiệu lực (Chế độ mô phỏng — không phát sinh thu phí)."
                    : "Chọn một câu hỏi hoặc gửi tra cứu mới để đối chiếu trích dẫn pháp luật tại đây."}
                </div>
              )}
            </div>
          </>
        )}

        {/* TAB 2: VĂN BẢN (FORMAL MEMO & PDF EXPORT) */}
        {activeTab === "document" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div className="doc-toolbar">
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <button
                  type="button"
                  className="format-btn"
                  onClick={() => applyFormat("bold")}
                  title="In đậm"
                >
                  B
                </button>
                <button
                  type="button"
                  className="format-btn"
                  onClick={() => applyFormat("italic")}
                  title="In nghiêng"
                  style={{ fontStyle: "italic" }}
                >
                  I
                </button>
                <button
                  type="button"
                  className="format-btn"
                  onClick={() => applyFormat("underline")}
                  title="Gạch chân"
                  style={{ textDecoration: "underline" }}
                >
                  U
                </button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button
                  type="button"
                  onClick={handleCopyMemo}
                  style={{
                    padding: "5px 9px",
                    borderRadius: 7,
                    border: "1px solid #e2e8f0",
                    background: "#f8fafc",
                    color: "#334155",
                    fontSize: 11.5,
                    fontWeight: 600,
                    cursor: "pointer"
                  }}
                >
                  {copiedMemo ? "Đã sao chép" : "Sao chép"}
                </button>
                <button
                  type="button"
                  onClick={() => typeof window !== "undefined" && window.print()}
                  style={{
                    padding: "5px 10px",
                    borderRadius: 7,
                    border: "none",
                    background: "#102a43",
                    color: "#ffffff",
                    fontSize: 11.5,
                    fontWeight: 600,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    cursor: "pointer"
                  }}
                >
                  <DownloadIcon size={13} />
                  Xuất PDF
                </button>
              </div>
            </div>

            <div
              className="custom-scrollbar"
              style={{ flex: 1, overflowY: "auto", padding: 14, background: "#f8fafc" }}
            >
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                className="doc-paper"
              />
            </div>
          </div>
        )}

        {/* TAB 3: CHUYÊN GIA (TIER 3 ESCALATION MARKETPLACE) */}
        {activeTab === "experts" && (
          <div className="custom-scrollbar" style={{ flex: 1, overflowY: "auto", padding: 16 }}>
            <div style={{ marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#0a1c2e" }}>
                Chuyên gia Hải quan &amp; Luật sư
              </h3>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "#64748b", lineHeight: 1.45 }}>
                Dành cho ca phức tạp cần rà soát hồ sơ thực tế (Roadmap Tier 3). Phí tư vấn giữ qua
                Escrow đến khi hoàn tất.
              </p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {EXPERT_LAWYERS.map((lawyer) => (
                <div key={lawyer.id} className="lawyer-card">
                  {lawyer.topRated && <div className="top-rated-ribbon">TOP RATED</div>}

                  <div style={{ display: "flex", gap: 12 }}>
                    <div
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 999,
                        background: lawyer.avatarBg,
                        color: "#ffffff",
                        fontWeight: 700,
                        fontSize: 15,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        border: "2px solid #f1f5f9"
                      }}
                    >
                      {lawyer.initials}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: 14,
                          color: "#0f172a",
                          display: "flex",
                          alignItems: "center",
                          gap: 5
                        }}
                      >
                        <span>{lawyer.name}</span>
                        <CheckCircleIcon size={14} color="#10b981" />
                      </div>
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                        {lawyer.barAssociation} • {lawyer.experienceYears} năm KN
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          marginTop: 5,
                          marginBottom: 8
                        }}
                      >
                        <StarIcon size={13} />
                        <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>
                          {lawyer.rating} ({lawyer.reviews} reviews)
                        </span>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                        {lawyer.tags.map((tag) => (
                          <span
                            key={tag}
                            style={{
                              fontSize: 10.5,
                              background: "#f1f5f9",
                              color: "#475569",
                              padding: "2px 7px",
                              borderRadius: 5,
                              fontWeight: 500
                            }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: 14,
                      paddingTop: 12,
                      borderTop: "1px solid #f1f5f9",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase" }}>
                        Phí dự kiến (Roadmap)
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: "#0a1c2e" }}>
                        {lawyer.escrowFeeUsdc} USDC
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onConnectExpert(lawyer)}
                      style={{
                        background: "#102a43",
                        color: "#ffffff",
                        border: "none",
                        borderRadius: 8,
                        padding: "9px 13px",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer"
                      }}
                    >
                      Xem cách gửi yêu cầu tư vấn
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
