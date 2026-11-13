"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  createPublicClient,
  formatEther,
  http,
  keccak256,
  toBytes
} from "viem";
import { avalancheFuji } from "viem/chains";
import RightPanel, { RightTab } from "./components/RightPanel";
import {
  BranchIcon,
  ChatBubbleIcon,
  CheckCircleIcon,
  CloseXIcon,
  FileTextIcon,
  GearIcon,
  LightningIcon,
  MenuIcon,
  PaperclipIcon,
  PlusIcon,
  RobotIcon,
  ScalesIcon,
  SendIcon,
  ShieldCheckIcon,
  SidebarIcon,
  UndoIcon,
  UsersIcon
} from "./components/Icons";
import {
  COMMON_SITUATIONS,
  ChatMessage,
  ChatSession,
  ExpertLawyer,
  LEGAL_DOCUMENTS_LIST,
  TierMode
} from "./data/legalWorkspaceData";

const INITIAL_SESSIONS: ChatSession[] = [{ id: "demo-new", title: "Tra cứu mới", group: "today", status: "draft", messages: [] }];

const STORAGE_KEY = "askpay_xnk_sessions_demo_v3";

function formatNowLabel(): string {
  try {
    return new Date().toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return "Vừa xong";
  }
}

export default function AskPayWorkspacePage() {
  const [sessions, setSessions] = useState<ChatSession[]>(INITIAL_SESSIONS);
  const [activeSessionId, setActiveSessionId] = useState<string>(INITIAL_SESSIONS[0].id);

  // Wallet & On-chain states
  const [account, setAccount] = useState<string>("");
  const [avaxBalance, setAvaxBalance] = useState<string>("");

  // Composer & Demo states
  const [questionInput, setQuestionInput] = useState<string>("");
  const [mode, setMode] = useState<TierMode>("quick");
  const [demoFault, setDemoFault] = useState<"normal" | "hallucination" | "expired">("normal");
  const [loadingStep, setLoadingStep] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");

  // Follow-up inline state keyed by message id
  const [followUpText, setFollowUpText] = useState<Record<string, string>>({});

  // Layout & Right Panel states
  const [rightOpen, setRightOpen] = useState<boolean>(true);
  const [rightTab, setRightTab] = useState<RightTab>("citation");
  const [selectedCitationIdx, setSelectedCitationIdx] = useState<number>(0);
  const [focusedAssistantId, setFocusedAssistantId] = useState<string>("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);

  // Modals
  const [showDocsModal, setShowDocsModal] = useState<boolean>(false);
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [selectedExpert, setSelectedExpert] = useState<ExpertLawyer | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);

  const escrowAddress = process.env.NEXT_PUBLIC_ESCROW_ADDRESS || "";
  const receiptAddress = process.env.NEXT_PUBLIC_RECEIPT_LOG_ADDRESS || "";
  const fujiRpc =
    process.env.NEXT_PUBLIC_FUJI_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc";

  // Hydrate persisted sessions & adjust panel visibility for small screens
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSessions(parsed);
          setActiveSessionId(parsed[0].id);
        }
      }
    } catch {
      // ignore storage errors
    }

    if (typeof window !== "undefined" && window.innerWidth < 1120) {
      setRightOpen(false);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    } catch {
      // ignore quota errors
    }
  }, [sessions]);

  const activeSession =
    sessions.find((s) => s.id === activeSessionId) || sessions[0] || null;

  const assistantMessages = (activeSession?.messages || []).filter(
    (m) => m.role === "assistant"
  );
  const activeAssistantMsg =
    assistantMessages.find((m) => m.id === focusedAssistantId) ||
    assistantMessages[assistantMessages.length - 1] ||
    null;

  const lastUserForActiveAssistant = (() => {
    const msgs = activeSession?.messages || [];
    if (!activeAssistantMsg) return "";
    const idx = msgs.findIndex((m) => m.id === activeAssistantMsg.id);
    for (let i = idx - 1; i >= 0; i--) {
      if (msgs[i].role === "user") return msgs[i].content;
    }
    return msgs[0]?.content || "";
  })();

  async function refreshBalance(addr: string) {
    if (!addr) return;
    try {
      const client = createPublicClient({
        chain: avalancheFuji,
        transport: http(fujiRpc)
      });
      const bal = await client.getBalance({ address: addr as `0x${string}` });
      setAvaxBalance(Number(formatEther(bal)).toFixed(4));
    } catch {
      setAvaxBalance("");
    }
  }

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
    const eth =
      typeof window !== "undefined"
        ? (window as any).avalanche || (window as any).ethereum
        : null;
    if (!eth) {
      setErrorMsg(
        "Chưa phát hiện ví Core Wallet / MetaMask trên trình duyệt. Bạn vẫn có thể tra cứu ở chế độ Preview."
      );
      return "";
    }
    try {
      const accounts = await eth.request({ method: "eth_requestAccounts" });
      const selected = accounts?.[0] || "";
      setAccount(selected);
      if (selected) {
        await ensureFujiChain(eth);
        await refreshBalance(selected);
      }
      return selected;
    } catch (err: any) {
      setErrorMsg(err?.message || "Không thể kết nối ví.");
      return "";
    }
  }

  function handleStartNewSession() {
    const newId = `session-${Date.now()}`;
    const blank: ChatSession = {
      id: newId,
      title: "Tra cứu pháp luật mới",
      group: "today",
      status: "draft",
      messages: []
    };
    setSessions((prev) => [blank, ...prev]);
    setActiveSessionId(newId);
    setFocusedAssistantId("");
    setQuestionInput("");
    setErrorMsg("");
    setMobileMenuOpen(false);
  }

  function handleSelectSession(sessionId: string) {
    setActiveSessionId(sessionId);
    setFocusedAssistantId("");
    setSelectedCitationIdx(0);
    setErrorMsg("");
    setMobileMenuOpen(false);
  }

  function handleInspectCitation(assistantMsgId: string, citIdx: number) {
    setFocusedAssistantId(assistantMsgId);
    setSelectedCitationIdx(citIdx);
    setRightTab("citation");
    setRightOpen(true);
  }

  async function handleAsk(customPrompt?: string, customMode?: TierMode) {
    const queryText = (customPrompt ?? questionInput).trim();
    if (!queryText) {
      setErrorMsg("Vui lòng nhập tình huống Hải quan hoặc điều khoản XNK cần tra cứu.");
      return;
    }

    const activeMode = customMode ?? mode;
    const isDeep = activeMode === "deep";
    const apiTier = isDeep ? "deep" : "quick";


    setErrorMsg("");
    setLoadingStep("Đang chuẩn bị giao dịch & kết nối...");

    const targetSessionId = activeSession?.id || INITIAL_SESSIONS[0].id;
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      timestampLabel: formatNowLabel(),
      content: queryText
    };

    // Immediately show user bubble in active chat
    setSessions((prev) =>
      prev.map((s) =>
        s.id === targetSessionId
          ? {
              ...s,
              title: s.messages.length === 0 ? queryText : s.title,
              messages: [...s.messages, userMsg]
            }
          : s
      )
    );
    if (!customPrompt) setQuestionInput("");

    setTimeout(() => {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 60);

    try {
      // The current corpus has not been verified; do not request a wallet transaction.
      const activeAccount = account;
      const asker = activeAccount || "0x0000000000000000000000000000000000000001";
      const questionId = keccak256(toBytes(`${asker}-${Date.now()}-${queryText}`));
      const escrowTxHash = "";

      setLoadingStep("Đang kiểm tra dữ liệu mẫu...");

      const res = await fetch("/api/ask-and-settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId,
          question: queryText,
          tier: apiTier,
          askerAddress: asker,
          escrowTxHash,
          simulateHallucination: demoFault === "hallucination",
          simulateExpiredLaw: demoFault === "expired"
        })
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Không thể xử lý câu hỏi lúc này.");
      }

      const passed = Boolean(data?.validation?.passed);
      const assistantMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: "assistant",
        timestampLabel: formatNowLabel(),
        mode: activeMode,
        feeLabel: "Bản thử nghiệm · không thu phí",
        questionId,
        content: data.answer || "",
        citations: data.citations || [],
        validation: data.validation
      };

      setSessions((prev) =>
        prev.map((s) =>
          s.id === targetSessionId
            ? {
                ...s,
                status: passed ? "verified" : "refunded",
                messages: [...s.messages, assistantMsg]
              }
            : s
        )
      );

      setFocusedAssistantId(assistantMsg.id);
      setSelectedCitationIdx(0);
      setRightTab("citation");
      if (typeof window !== "undefined" && window.innerWidth >= 1120) {
        setRightOpen(true);
      }

      if (activeAccount) {
        await refreshBalance(activeAccount);
      }

      setTimeout(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 80);
    } catch (err: any) {
      setErrorMsg(err?.message || "Đã có lỗi xảy ra khi xử lý giao dịch.");
    } finally {
      setLoadingStep("");
    }
  }

  function handleResetDemoData() {
    setSessions(INITIAL_SESSIONS);
    setActiveSessionId(INITIAL_SESSIONS[0].id);
    setFocusedAssistantId("");
    setSelectedCitationIdx(0);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  const todaySessions = sessions.filter((s) => s.group === "today");
  const weekSessions = sessions.filter((s) => s.group === "week");

  // Gather transaction history items across sessions
  const txHistory = sessions.flatMap((s) =>
    s.messages
      .filter((m) => m.role === "assistant" && m.onchain)
      .map((m) => ({
        sessionId: s.id,
        title: s.title,
        timestamp: m.timestampLabel,
        feeLabel: m.feeLabel || "",
        passed: Boolean(m.validation?.passed),
        score: m.validation?.overall_score ?? 0,
        onchain: m.onchain!
      }))
  );

  return (
    <div className="workspace-shell">
      {/* =========================================================
          COLUMN 1: LEFT NAVIGATION, WALLET & SESSION HISTORY
         ========================================================= */}
      <aside className={`sidebar-left ${mobileMenuOpen ? "mobile-open" : ""}`}>
        {/* Brand Header */}
        <div className="brand-bar">
          <div className="brand-mark">
            <div className="brand-icon">
              <ScalesIcon size={18} />
            </div>
            <div>
              <div className="brand-name">AskPay XNK</div>
              <div style={{ fontSize: 10.5, color: "#64748b", fontWeight: 500 }}>
                Legal AI • Avalanche
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleStartNewSession}
            className="btn-new-chat"
            title="Tạo phiên tra cứu mới"
          >
            <PlusIcon size={13} />
            Mới
          </button>
        </div>

        {/* Web3 Wallet & Assurance Section */}
        <div className="wallet-section">
          <div className="wallet-header-row">
            <span className="section-micro-label">Ví của bạn</span>
            <button
              type="button"
              onClick={() => setShowHistoryModal(true)}
              className="link-subtle"
            >
              Lịch sử GD
            </button>
          </div>

          <div className="wallet-card">
            <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
              <div className="usdc-emblem">$</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11.5, color: "#64748b", lineHeight: 1.2 }}>
                  {account ? `${account.slice(0, 6)}...${account.slice(-4)}` : "Ví Fuji Testnet"}
                </div>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 14,
                    color: "#0a1c2e",
                    lineHeight: 1.3,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis"
                  }}
                >
                  {account
                    ? `${avaxBalance || "..."} AVAX`
                    : "Chưa kết nối"}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                if (account) {
                  setShowSettingsModal(true);
                } else {
                  connectWallet();
                }
              }}
              className="btn-wallet-plus"
              title={account ? "Xem địa chỉ contract & Faucet Testnet" : "Kết nối Core Wallet / MetaMask"}
            >
              <PlusIcon size={15} />
            </button>
          </div>

          {/* Zero-Risk Escrow Promo Card */}
          <button
            type="button"
            onClick={() => setShowSettingsModal(true)}
            className="promo-card"
          >
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "#78350f" }}>
                Bản thử nghiệm AskPay
              </div>
              <div style={{ fontSize: 10.5, color: "#b45309" }}>
                Mô phỏng kiểm tra trích dẫn
              </div>
            </div>
            <span className="promo-pill">DEMO</span>
          </button>
        </div>

        {/* Sessions List */}
        <div className="history-list custom-scrollbar">
          <div style={{ marginBottom: 16 }}>
            <div className="history-group-label">Hôm nay</div>
            {todaySessions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => handleSelectSession(s.id)}
                className={`history-item ${s.id === activeSession?.id ? "active" : ""}`}
              >
                <ChatBubbleIcon
                  size={14}
                  color={s.id === activeSession?.id ? "#285380" : "#94a3b8"}
                />
                <span className="history-item-title">{s.title}</span>
                {s.status === "verified" && (
                  <span title="Đã xác thực nguyên văn ≥90%">
                    <CheckCircleIcon size={15} color="#10b981" />
                  </span>
                )}
                {s.status === "refunded" && (
                  <span title="Trích dẫn mẫu không đạt">
                    <UndoIcon size={14} color="#f59e0b" />
                  </span>
                )}
              </button>
            ))}
          </div>

          {weekSessions.length > 0 && (
            <div>
              <div className="history-group-label">7 ngày trước</div>
              {weekSessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => handleSelectSession(s.id)}
                  className={`history-item ${s.id === activeSession?.id ? "active" : ""}`}
                >
                  <ChatBubbleIcon
                    size={14}
                    color={s.id === activeSession?.id ? "#285380" : "#94a3b8"}
                  />
                  <span className="history-item-title">{s.title}</span>
                  {s.status === "verified" && (
                    <span title="Đã xác thực">
                      <CheckCircleIcon size={15} color="#10b981" />
                    </span>
                  )}
                  {s.status === "refunded" && (
                    <span title="Trích dẫn mẫu không đạt">
                      <UndoIcon size={14} color="#f59e0b" />
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Bottom User Profile & Contract Footer */}
        <div
          className="user-footer"
          onClick={() => setShowSettingsModal(true)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter") setShowSettingsModal(true);
          }}
        >
          <div className="user-avatar">
            {account ? account.slice(2, 4).toUpperCase() : "DN"}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#0f172a",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis"
              }}
            >
              {account ? `${account.slice(0, 6)}...${account.slice(-4)}` : "Doanh nghiệp XNK"}
            </div>
            <div style={{ fontSize: 11, color: "#64748b" }}>
              Fuji C-Chain • Own L1 (663010)
            </div>
          </div>
          <GearIcon size={17} color="#94a3b8" />
        </div>
      </aside>

      {/* Mobile backdrop for Left Sidebar */}
      {mobileMenuOpen && (
        <div
          onClick={() => setMobileMenuOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(10, 28, 46, 0.4)",
            zIndex: 40
          }}
        />
      )}

      {/* =========================================================
          COLUMN 2: MIDDLE CONVERSATION & COMPOSER
         ========================================================= */}
      <main className="chat-column">
        {/* Session Header */}
        <header className="chat-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <button
              type="button"
              className="icon-btn mobile-only-btn"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Mở thanh điều hướng"
            >
              <MenuIcon size={19} />
            </button>

            <div style={{ minWidth: 0 }}>
              <h1 className="chat-header-title">
                {activeSession?.title || "Trợ Lý Pháp Luật Hải Quan & XNK"}
              </h1>
              <p
                className="chat-header-status"
                style={{
                  color:
                    activeSession?.status === "refunded" ? "#d97706" : "#059669"
                }}
              >
                <ShieldCheckIcon
                  size={14}
                  color={activeSession?.status === "refunded" ? "#d97706" : "#059669"}
                />
                {activeSession?.status === "refunded"
                  ? "Dữ liệu mẫu không đạt kiểm tra trích dẫn · không có giao dịch"
                  : "Bản thử nghiệm · dữ liệu mẫu chưa xác minh · không có giao dịch"}
              </p>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              onClick={() => setShowDocsModal(true)}
              style={{
                padding: "5px 10px",
                borderRadius: 8,
                border: "1px solid #e2e8f0",
                background: "#f8fafc",
                color: "#334155",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer"
              }}
            >
              Dữ liệu mẫu XNK
            </button>

            <button
              type="button"
              onClick={() => setRightOpen(!rightOpen)}
              className="icon-btn"
              title="Đóng/Mở bảng đối chiếu bên phải"
            >
              <SidebarIcon size={19} />
            </button>
          </div>
        </header>

        {/* Scrollable Chat Stream */}
        <div className="chat-stream custom-scrollbar">
          {/* Welcome Empty State when clicking "+ Mới" */}
          {(!activeSession || activeSession.messages.length === 0) && (
            <div style={{ maxWidth: 680, margin: "24px auto", width: "100%" }}>
              <div
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: 16,
                  padding: "22px 24px"
                }}
              >
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    color: "#0a1c2e",
                    marginBottom: 6
                  }}
                >
                  Bạn cần tra cứu quy định Hải quan &amp; Xuất Nhập Khẩu nào?
                </div>
                <p style={{ margin: 0, fontSize: 13.5, color: "#64748b", lineHeight: 1.55 }}>
                  Mọi câu trả lời đều phải vượt qua <strong>4 chốt chặn kiểm định nguyên văn</strong>{" "}
                  (tồn tại văn bản, đúng Điều/Khoản, hiệu lực <code>ACTIVE</code>, khớp{" "}
                  <code>≥ 90%</code>). Dữ liệu hiện tại chỉ để minh họa, không dùng làm căn cứ pháp lý.
                </p>

                <div className="welcome-grid">
                  {COMMON_SITUATIONS.map((sit, i) => (
                    <button
                      key={i}
                      type="button"
                      disabled={Boolean(loadingStep)}
                      onClick={() => handleAsk(sit)}
                      className="welcome-chip"
                    >
                      <span style={{ color: "#285380", fontWeight: 700, marginRight: 6 }}>→</span>
                      {sit}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Render Messages */}
          {(activeSession?.messages || []).map((msg) => {
            if (msg.role === "user") {
              return (
                <div key={msg.id} className="msg-user-wrap">
                  <div className="msg-meta">
                    <span style={{ fontSize: 11.5, color: "#94a3b8" }}>
                      {msg.timestampLabel}
                    </span>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: "#334155" }}>
                      Bạn
                    </span>
                  </div>
                  <div className="msg-user-bubble">{msg.content}</div>
                </div>
              );
            }

            const passed = msg.validation?.passed !== false;
            const citations = msg.citations || [];
            const inlineText = followUpText[msg.id] || "";

            return (
              <div key={msg.id} className="msg-ai-wrap">
                <div className="msg-meta">
                  <div className="ai-avatar-badge">
                    <RobotIcon size={14} />
                  </div>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: "#0a1c2e" }}>
                    AskPay AI
                  </span>
                  {msg.feeLabel && <span className="tier-tag-badge">{msg.feeLabel}</span>}
                </div>

                <div className={`msg-ai-card ${passed ? "" : "refunded"}`}>
                  {/* Refund Alert Banner if Validation Failed */}
                  {!passed && (
                    <div
                      style={{
                        background: "#fef3c7",
                        border: "1px solid #fde68a",
                        color: "#92400e",
                        borderRadius: 10,
                        padding: "9px 12px",
                        fontSize: 12.5,
                        fontWeight: 600,
                        marginBottom: 12,
                        display: "flex",
                        alignItems: "center",
                        gap: 8
                      }}
                    >
                      <UndoIcon size={15} color="#b45309" />
                      <span>
                        Không đạt kiểm tra dữ liệu mẫu ({msg.validation?.overall_score ?? 0}%). Không có giao dịch thanh toán.
                      </span>
                    </div>
                  )}

                  {/* Body */}
                  <div className="ai-body-text">{msg.content}</div>

                  {/* Clickable Yellow-Highlighted Statutory Citations */}
                  {citations.length > 0 && (
                    <div
                      style={{
                        marginTop: 12,
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 8,
                        alignItems: "center"
                      }}
                    >
                      <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>
                        Căn cứ trích dẫn:
                      </span>
                      {citations.map((cit, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => handleInspectCitation(msg.id, idx)}
                          className="citation-hl"
                          title="Bấm để đối chiếu nguyên văn ở bảng bên phải"
                        >
                          Điều {cit.article}, Khoản {cit.clause} ({cit.document})
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Gợi ý bước tiếp theo */}
                  <div className="next-steps-box">
                    <div
                      className="section-micro-label"
                      style={{ marginBottom: 8, fontSize: 10.5 }}
                    >
                      Gợi ý bước tiếp theo
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => {
                          setFocusedAssistantId(msg.id);
                          setRightTab("document");
                          setRightOpen(true);
                        }}
                        className="next-step-btn primary"
                      >
                        <FileTextIcon size={14} />
                        Soạn Phiếu / Công văn
                        <span
                          style={{
                            fontSize: 10,
                            background: "rgba(255,255,255,0.65)",
                            color: "#102a43",
                            padding: "1px 6px",
                            borderRadius: 5,
                            fontWeight: 700
                          }}
                        >
                          Văn bản
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setFocusedAssistantId(msg.id);
                          setRightTab("experts");
                          setRightOpen(true);
                        }}
                        className="next-step-btn secondary"
                      >
                        <UsersIcon size={14} />
                        Nhờ Chuyên gia rà soát
                        <span
                          style={{
                            fontSize: 10,
                            background: "#f1f5f9",
                            color: "#475569",
                            padding: "1px 6px",
                            borderRadius: 5,
                            border: "1px solid #e2e8f0",
                            fontWeight: 600
                          }}
                        >
                          Escrow
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Inline Quick Follow-up Bar */}
                  <div className="inline-followup-box">
                    <span style={{ color: "#94a3b8", fontSize: 14 }}>↳</span>
                    <input
                      type="text"
                      value={inlineText}
                      onChange={(e) =>
                        setFollowUpText((prev) => ({ ...prev, [msg.id]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && inlineText.trim() && !loadingStep) {
                          e.preventDefault();
                          const txt = inlineText.trim();
                          setFollowUpText((prev) => ({ ...prev, [msg.id]: "" }));
                          handleAsk(txt, "quick");
                        }
                      }}
                      placeholder="Hỏi thêm về câu trả lời này..."
                      className="inline-followup-input"
                    />
                    <span
                      className="font-mono"
                      style={{ fontSize: 10.5, color: "#94a3b8", whiteSpace: "nowrap" }}
                    >
                      Miễn phí (demo)
                    </span>
                    <button
                      type="button"
                      disabled={!inlineText.trim() || Boolean(loadingStep)}
                      onClick={() => {
                        const txt = inlineText.trim();
                        if (!txt) return;
                        setFollowUpText((prev) => ({ ...prev, [msg.id]: "" }));
                        handleAsk(txt, "quick");
                      }}
                      style={{
                        border: "none",
                        background: "transparent",
                        color: inlineText.trim() ? "#102a43" : "#cbd5e1",
                        cursor: inlineText.trim() ? "pointer" : "default",
                        padding: 4,
                        display: "flex"
                      }}
                    >
                      <SendIcon size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Loading Progress Bubble */}
          {loadingStep && (
            <div className="msg-ai-wrap">
              <div className="msg-meta">
                <div className="ai-avatar-badge">
                  <RobotIcon size={14} />
                </div>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: "#0a1c2e" }}>
                  AskPay AI
                </span>
              </div>
              <div className="msg-ai-card">
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#285380",
                    marginBottom: 10
                  }}
                >
                  {loadingStep}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div className="skeleton-line" style={{ width: "88%" }} />
                  <div className="skeleton-line" style={{ width: "74%" }} />
                  <div className="skeleton-line" style={{ width: "56%" }} />
                </div>
              </div>
            </div>
          )}

          {/* Error Banner */}
          {errorMsg && (
            <div
              style={{
                background: "#fff1f2",
                border: "1px solid #fecdd3",
                color: "#9f1239",
                borderRadius: 12,
                padding: "11px 14px",
                fontSize: 13,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10
              }}
            >
              <span>{errorMsg}</span>
              <button
                type="button"
                onClick={() => setErrorMsg("")}
                style={{
                  background: "none",
                  border: "none",
                  color: "#9f1239",
                  cursor: "pointer",
                  fontWeight: 700
                }}
              >
                ✕
              </button>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Sticky Bottom Prompt Composer (Zero Overlap!) */}
        <footer className="composer-footer">
          <div className="composer-inner">
            {/* Mode Selector Pills */}
            <div className="mode-pills-row">
              <div className="mode-pills-left">
                <button
                  type="button"
                  onClick={() => setMode("quick")}
                  className={`mode-pill ${mode === "quick" ? "active-quick" : ""}`}
                >
                  <LightningIcon size={13} />
                  Hỏi Nhanh
                  <span style={{ fontSize: 10, opacity: 0.75 }}>Demo</span>
                </button>

                <button
                  type="button"
                  onClick={() => setMode("deep")}
                  className={`mode-pill ${mode === "deep" ? "active-deep" : ""}`}
                >
                  <BranchIcon size={13} />
                  Tình Huống
                  <span style={{ fontSize: 10, opacity: 0.75 }}>Demo</span>
                </button>

                <button
                  type="button"
                  onClick={() => setMode("factcheck")}
                  className={`mode-pill ${mode === "factcheck" ? "active-factcheck" : ""}`}
                >
                  <ShieldCheckIcon size={13} />
                  Kiểm Chứng Luật
                  <span style={{ fontSize: 10, opacity: 0.75 }}>Demo</span>
                </button>
              </div>

              {/* Subtle Demo Fault Selector for Hackathon Live Testing */}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <label
                  htmlFor="demo-fault-select"
                  style={{ fontSize: 11, color: "#64748b", fontWeight: 500 }}
                >
                  Tình huống mẫu:
                </label>
                <select
                  id="demo-fault-select"
                  value={demoFault}
                  onChange={(e) =>
                    setDemoFault(e.target.value as "normal" | "hallucination" | "expired")
                  }
                  style={{
                    fontSize: 11.5,
                    border: "1px solid #e2e8f0",
                    borderRadius: 8,
                    padding: "3px 8px",
                    background: demoFault === "normal" ? "#ffffff" : "#fef3c7",
                    color: demoFault === "normal" ? "#475569" : "#92400e",
                    fontWeight: 600,
                    outline: "none",
                    cursor: "pointer"
                  }}
                >
                  <option value="normal">Bình thường</option>
                  <option value="hallucination">Giả lập AI bịa luật</option>
                  <option value="expired">Giả lập Luật hết hạn</option>
                </select>
              </div>
            </div>

            {/* Rounded Prompt Input Card */}
            <div className="composer-box">
              <textarea
                rows={2}
                value={questionInput}
                onChange={(e) => setQuestionInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !loadingStep) {
                    e.preventDefault();
                    handleAsk();
                  }
                }}
                placeholder={
                  mode === "factcheck"
                    ? "Dán đoạn tư vấn từ ChatGPT/Gemini hoặc điều khoản XNK cần kiểm chứng..."
                    : "Nhập vấn đề Hải quan, mã HS, C/O hoặc thủ tục XNK bạn cần tra cứu..."
                }
                className="composer-textarea custom-scrollbar"
              />

              <div className="composer-toolbar">
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setShowDocsModal(true)}
                    className="icon-btn"
                    title="Xem danh mục văn bản dự kiến"
                  >
                    <PaperclipIcon size={16} />
                  </button>
                  <span style={{ fontSize: 11.5, color: "#64748b" }}>
                    Bản thử nghiệm · không thu phí
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 11.5, color: "#94a3b8" }}>Enter để gửi</span>
                  <button
                    type="button"
                    disabled={Boolean(loadingStep)}
                    onClick={() => handleAsk()}
                    className="btn-send"
                  >
                    {loadingStep ? "Đang xử lý..." : "Gửi"}
                    <SendIcon size={13} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </footer>
      </main>

      {/* =========================================================
          COLUMN 3: RIGHT UTILITY & PROOF PANEL
         ========================================================= */}
      <RightPanel
        isOpen={rightOpen}
        activeTab={rightTab}
        onChangeTab={setRightTab}
        onClose={() => setRightOpen(false)}
        activeQuestion={lastUserForActiveAssistant || activeSession?.title || ""}
        activeAssistantMsg={activeAssistantMsg}
        selectedCitationIdx={selectedCitationIdx}
        onSelectCitationIdx={setSelectedCitationIdx}
        onConnectExpert={(lawyer) => setSelectedExpert(lawyer)}
      />

      {/* =========================================================
          MODALS
         ========================================================= */}

      {/* 1. Legal Corpus Modal */}
      {showDocsModal && (
        <div className="modal-backdrop" onClick={() => setShowDocsModal(false)}>
          <div className="modal-card custom-scrollbar" onClick={(e) => e.stopPropagation()}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                paddingBottom: 12,
                marginBottom: 14,
                borderBottom: "1px solid #e2e8f0"
              }}
            >
              <h3 style={{ margin: 0, fontSize: 16.5, fontWeight: 700, color: "#0a1c2e" }}>
                Danh mục văn bản dự kiến · chưa xác minh
              </h3>
              <button
                type="button"
                onClick={() => setShowDocsModal(false)}
                className="icon-btn"
              >
                <CloseXIcon size={17} />
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {LEGAL_DOCUMENTS_LIST.map((doc, idx) => {
                const isExpired = doc.status.includes("Hết");
                return (
                  <div
                    key={idx}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid #e2e8f0",
                      background: isExpired ? "#fffbeb" : "#f8fafc"
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 3
                      }}
                    >
                      <strong style={{ fontSize: 13.5, color: "#102a43" }}>{doc.code}</strong>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "2px 8px",
                          borderRadius: 999,
                          background: isExpired ? "#fee2e2" : "#dcfce7",
                          color: isExpired ? "#991b1b" : "#166534"
                        }}
                      >
                        Chưa xác minh
                      </span>
                    </div>
                    <div style={{ fontSize: 12.5, color: "#475569" }}>{doc.title}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 2. Transaction History Modal */}
      {showHistoryModal && (
        <div className="modal-backdrop" onClick={() => setShowHistoryModal(false)}>
          <div className="modal-card custom-scrollbar" onClick={(e) => e.stopPropagation()}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                paddingBottom: 12,
                marginBottom: 14,
                borderBottom: "1px solid #e2e8f0"
              }}
            >
              <h3 style={{ margin: 0, fontSize: 16.5, fontWeight: 700, color: "#0a1c2e" }}>
                Lịch sử mẫu
              </h3>
              <button
                type="button"
                onClick={() => setShowHistoryModal(false)}
                className="icon-btn"
              >
                <CloseXIcon size={17} />
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {txHistory.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: 11,
                    padding: "11px 13px",
                    background: "#f8fafc"
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 4
                    }}
                  >
                    <strong style={{ fontSize: 13.5, color: "#0a1c2e" }}>{item.title}</strong>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: item.passed ? "#ecfdf5" : "#fef3c7",
                        color: item.passed ? "#047857" : "#b45309"
                      }}
                    >
                      {item.passed ? "Giải ngân" : "Hoàn tiền 100%"}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>
                    {item.timestamp} • {item.feeLabel} • Điểm kiểm định: {item.score}%
                  </div>
                  <div className="font-mono" style={{ fontSize: 11, color: "#475569" }}>
                    L1 Receipt: {item.onchain.l1ReceiptTxHash.slice(0, 18)}...
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 3. Settings, Wallet & Contract Info Modal */}
      {showSettingsModal && (
        <div className="modal-backdrop" onClick={() => setShowSettingsModal(false)}>
          <div className="modal-card custom-scrollbar" onClick={(e) => e.stopPropagation()}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                paddingBottom: 12,
                marginBottom: 14,
                borderBottom: "1px solid #e2e8f0"
              }}
            >
              <h3 style={{ margin: 0, fontSize: 16.5, fontWeight: 700, color: "#0a1c2e" }}>
                Cấu hình Web3 &amp; Cơ chế Bảo chứng AskPay
              </h3>
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="icon-btn"
              >
                <CloseXIcon size={17} />
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 13 }}>
              <div
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: 12,
                  padding: 14
                }}
              >
                <div style={{ fontWeight: 700, color: "#0a1c2e", marginBottom: 8 }}>
                  Tài khoản Ví Avalanche Fuji Testnet
                </div>
                {account ? (
                  <div>
                    <div className="font-mono" style={{ fontSize: 12, color: "#334155" }}>
                      Địa chỉ: {account}
                    </div>
                    <div style={{ marginTop: 4, color: "#047857", fontWeight: 600 }}>
                      Số dư hiện tại: {avaxBalance || "..."} AVAX (Testnet)
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={connectWallet}
                    style={{
                      background: "#102a43",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: 8,
                      padding: "8px 14px",
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: "pointer"
                    }}
                  >
                    Kết nối Core Wallet / MetaMask
                  </button>
                )}

                <p>Thanh toán và ký escrow đang tạm tắt trong bản thử nghiệm.</p>
              </div>

              <div
                style={{
                  background: "#f0f5fa",
                  border: "1px solid #dce6f2",
                  borderRadius: 12,
                  padding: 14
                }}
              >
                <div style={{ fontWeight: 700, color: "#0a1c2e", marginBottom: 6 }}>
                  Cấu hình hợp đồng (chưa xác minh triển khai)
                </div>
                <div className="font-mono" style={{ fontSize: 11.5, color: "#334155", lineHeight: 1.7 }}>
                  <div>
                    • Fuji Escrow (43113):{" "}
                    {escrowAddress || "Chưa cấu hình"}
                  </div>
                  <div>
                    • AskPay Own L1 (663010):{" "}
                    {receiptAddress || "Chưa cấu hình"}
                  </div>
                </div>
                <div style={{ marginTop: 8, fontSize: 12, color: "#475569" }}>
                  Mỗi câu trả lời phải đạt đủ 4 chốt chặn: Tồn tại văn bản (25%) + Đúng Điều/Khoản
                  (25%) + Trạng thái ACTIVE (20%) + Khớp nguyên văn ≥90% (30%).
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <a
                  href="https://core.app/tools/testnet-faucet/?subnet=c&token=c"
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#285380", fontWeight: 600, textDecoration: "none" }}
                >
                  Nhận AVAX Fuji miễn phí tại Core Faucet ↗
                </a>
                <button
                  type="button"
                  onClick={() => {
                    handleResetDemoData();
                    setShowSettingsModal(false);
                  }}
                  style={{
                    border: "1px solid #e2e8f0",
                    background: "#ffffff",
                    color: "#475569",
                    borderRadius: 8,
                    padding: "6px 12px",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer"
                  }}
                >
                  Khôi phục dữ liệu mẫu
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. Tier 3 Expert Connect Modal */}
      {selectedExpert && (
        <div className="modal-backdrop" onClick={() => setSelectedExpert(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                paddingBottom: 12,
                marginBottom: 14,
                borderBottom: "1px solid #e2e8f0"
              }}
            >
              <h3 style={{ margin: 0, fontSize: 16.5, fontWeight: 700, color: "#0a1c2e" }}>
                Chuyển tiếp Chuyên gia (Roadmap Tier 3)
              </h3>
              <button
                type="button"
                onClick={() => setSelectedExpert(null)}
                className="icon-btn"
              >
                <CloseXIcon size={17} />
              </button>
            </div>

            <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "#334155" }}>
              <p style={{ marginTop: 0 }}>
                Bạn đang chọn chuyển hồ sơ tra cứu sang <strong>{selectedExpert.name}</strong> (
                {selectedExpert.barAssociation}).
              </p>
              <div
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  padding: 12,
                  marginBottom: 14
                }}
              >
                <div>
                  <strong>Phí khóa cọc Escrow:</strong> {selectedExpert.escrowFeeUsdc} USDC
                </div>
                <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 4 }}>
                  Hệ thống sẽ đính kèm toàn bộ lịch sử chat, trích dẫn và mã băm biên lai L1 để
                  chuyên gia rà soát trực tiếp.
                </div>
              </div>
              <div
                style={{
                  background: "#fffbeb",
                  border: "1px solid #fde68a",
                  color: "#92400e",
                  padding: "10px 12px",
                  borderRadius: 9,
                  fontSize: 12.5,
                  marginBottom: 14
                }}
              >
                Lưu ý: Kết nối chuyên gia thật là tính năng thuộc <strong>Giai đoạn Roadmap</strong>{" "}
                sau MVP Hackathon (hiện đang ở chế độ minh họa luồng Escrow).
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => setSelectedExpert(null)}
                  style={{
                    background: "#102a43",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: 8,
                    padding: "8px 16px",
                    fontWeight: 600,
                    cursor: "pointer"
                  }}
                >
                  Đã hiểu
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
