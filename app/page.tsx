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
import { paidAsk } from "./lib/paid-ask.mjs";
import { signFujiPayment } from "./lib/x402.mjs";
import { migrateLegacySessions } from "./data/history-migration.mjs";
import {
  AskPayLogo,
  BranchIcon,
  ChatBubbleIcon,
  CheckCircleIcon,
  CloseXIcon,
  FileTextIcon,
  GearIcon,
  GiftIcon,
  LightningIcon,
  LockIcon,
  LogOutIcon,
  MenuIcon,
  PaperclipIcon,
  PlusIcon,
  RobotIcon,
  SendIcon,
  ShieldCheckIcon,
  SidebarIcon,
  SlidersIcon,
  UndoIcon,
  UserIcon,
  UsersIcon
} from "./components/Icons";
import {
  COMMON_SITUATIONS,
  ChatMessage,
  ChatSession,
  ExpertLawyer,
  INITIAL_SESSIONS,
  TierMode
} from "./data/legalWorkspaceData";

type CorpusRecord = {
  doc_id: string;
  doc_title?: string;
  source_url?: string;
  total_versions?: number;
  reviewed_versions?: number;
};
type CorpusInventory = {
  total_documents: number;
  total_chunks: number;
  corpus_status: string;
  snapshot_id?: string;
  records: CorpusRecord[];
};

interface UserProfile {
  name: string;
  email: string;
  role: "user" | "admin";
  company: string;
}

const AUTH_STORAGE_KEY = "askpay_auth_user_v1";
const ACCOUNTS_STORAGE_KEY = "askpay_registered_accounts_v1";

function sessionsKeyForUser(email: string): string {
  return `askpay_sessions_v5_${email.toLowerCase()}`;
}

function loyaltyKeyForUser(email: string): string {
  return `askpay_loyalty_v1_${email.toLowerCase()}`;
}

function createEmptySession(): ChatSession {
  return {
    id: `session-${Date.now()}`,
    title: "Cuộc trò chuyện mới",
    group: "today",
    status: "draft",
    messages: []
  };
}

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
  // Authentication states
  const [authChecked, setAuthChecked] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [authTab, setAuthTab] = useState<"login" | "register">("login");
  const [authName, setAuthName] = useState<string>("");
  const [authCompany, setAuthCompany] = useState<string>("");
  const [authEmail, setAuthEmail] = useState<string>("");
  const [authPassword, setAuthPassword] = useState<string>("");
  const [authError, setAuthError] = useState<string>("");

  // Workspace vs Admin Console view (role-separated)
  const [activeView, setActiveView] = useState<"chat" | "admin">("chat");

  // Per-user Sessions (never exposed before login)
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>("");

  // Loyalty: Hỏi 10 câu tặng 1 câu
  const [questionCount, setQuestionCount] = useState<number>(0);

  // Wallet & On-chain states
  const [account, setAccount] = useState<string>("");
  const [avaxBalance, setAvaxBalance] = useState<string>("");
  const [useOnchainWallet, setUseOnchainWallet] = useState<boolean>(true);

  // Composer & Backend states
  const [questionInput, setQuestionInput] = useState<string>("");
  const [factDocument, setFactDocument] = useState("");
  const [factArticle, setFactArticle] = useState("");
  const [factClause, setFactClause] = useState("");
  const [factPoint, setFactPoint] = useState("");
  const [mode, setMode] = useState<TierMode>("quick");
  const [demoFault, setDemoFault] = useState<"normal" | "hallucination" | "expired">("normal");
  const [loadingStep, setLoadingStep] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [corpus, setCorpus] = useState<CorpusInventory | null>(null);
  const [corpusError, setCorpusError] = useState<string>("");
  const [asOf, setAsOf] = useState<string>("");

  // Layout & Right Panel states
  const [rightOpen, setRightOpen] = useState<boolean>(true);
  const [rightTab, setRightTab] = useState<RightTab>("citation");
  const [selectedCitationIdx, setSelectedCitationIdx] = useState<number>(0);
  const [focusedAssistantId, setFocusedAssistantId] = useState<string>("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);

  // Settings Dropdown & Modals
  const [showUserMenu, setShowUserMenu] = useState<boolean>(false);
  const [showDocsModal, setShowDocsModal] = useState<boolean>(false);
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);
  const [showProfileModal, setShowProfileModal] = useState<boolean>(false);
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [showLoyaltyModal, setShowLoyaltyModal] = useState<boolean>(false);
  const [selectedExpert, setSelectedExpert] = useState<ExpertLawyer | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const escrowAddress = process.env.NEXT_PUBLIC_ANSWER_ESCROW_ADDRESS || "";
  const receiptAddress = process.env.NEXT_PUBLIC_RECEIPT_LOG_ADDRESS || "";
  const fujiRpc =
    process.env.NEXT_PUBLIC_FUJI_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc";

  // Hydrate authenticated user & screen layout on mount
  useEffect(() => {
    try {
      const savedUser = localStorage.getItem(AUTH_STORAGE_KEY);
      if (savedUser) {
        const parsedUser: UserProfile = JSON.parse(savedUser);
        if (parsedUser && parsedUser.email) {
          hydrateUserWorkspace(parsedUser);
        }
      }
    } catch {
      // ignore storage errors
    } finally {
      setAuthChecked(true);
    }

    if (typeof window !== "undefined" && window.innerWidth < 1120) {
      setRightOpen(false);
    }
  }, []);

  // Close settings dropdown on outside click
  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    }
    if (showUserMenu) {
      document.addEventListener("mousedown", handleOutsideClick);
      return () => document.removeEventListener("mousedown", handleOutsideClick);
    }
  }, [showUserMenu]);

  // Fetch legal corpus when authenticated
  useEffect(() => {
    if (!currentUser) return;
    const controller = new AbortController();
    fetch("/api/legal-corpus", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Không tải được kho dữ liệu.");
        const data: CorpusInventory = await response.json();
        setCorpus(data);
        setCorpusError("");
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setCorpus(null);
          setCorpusError("Không tải được kho dữ liệu.");
        }
      });
    return () => controller.abort();
  }, [currentUser, showDocsModal, activeView]);

  // Persist sessions per authenticated user
  useEffect(() => {
    if (!currentUser || sessions.length === 0) return;
    try {
      localStorage.setItem(sessionsKeyForUser(currentUser.email), JSON.stringify(sessions));
    } catch {
      // ignore quota errors
    }
  }, [sessions, currentUser]);

  // Persist question count per user
  useEffect(() => {
    if (!currentUser) return;
    try {
      localStorage.setItem(loyaltyKeyForUser(currentUser.email), String(questionCount));
    } catch {
      // ignore
    }
  }, [questionCount, currentUser]);

  function hydrateUserWorkspace(user: UserProfile) {
    setCurrentUser(user);
    setActiveView("chat");
    try {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
      const savedSessions = localStorage.getItem(sessionsKeyForUser(user.email));
      if (savedSessions) {
        let parsed = JSON.parse(savedSessions);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const schemaKey = `${sessionsKeyForUser(user.email)}:history-schema`;
          if (localStorage.getItem(schemaKey) !== '2') {
            parsed = migrateLegacySessions(parsed);
            try {
              localStorage.setItem(sessionsKeyForUser(user.email), JSON.stringify(parsed));
              localStorage.setItem(schemaKey, '2');
            } catch {
              // Keep the migrated view even if local storage is full.
            }
          }
          setSessions(parsed);
          setActiveSessionId(parsed[0].id);
        } else {
          const empty = createEmptySession();
          setSessions([empty]);
          setActiveSessionId(empty.id);
        }
      } else {
        localStorage.setItem(`${sessionsKeyForUser(user.email)}:history-schema`, '2');
        const empty = createEmptySession();
        setSessions([empty]);
        setActiveSessionId(empty.id);
      }

      const savedCount = Number(localStorage.getItem(loyaltyKeyForUser(user.email)) || "0");
      setQuestionCount(Number.isFinite(savedCount) && savedCount >= 0 ? savedCount : 0);
    } catch {
      const empty = createEmptySession();
      setSessions([empty]);
      setActiveSessionId(empty.id);
    }
  }

  function handleAuthSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAuthError("");
    const email = authEmail.trim().toLowerCase();
    const password = authPassword.trim();

    if (!email || !email.includes("@")) {
      setAuthError("Vui lòng nhập địa chỉ email hợp lệ.");
      return;
    }
    if (password.length < 4) {
      setAuthError("Mật khẩu phải có ít nhất 4 ký tự.");
      return;
    }

    if (authTab === "register") {
      if (!authName.trim()) {
        setAuthError("Vui lòng nhập họ và tên.");
        return;
      }
      const newUser: UserProfile = {
        name: authName.trim(),
        email,
        role: "user",
        company: authCompany.trim() || "Doanh nghiệp XNK"
      };
      try {
        const existingRaw = localStorage.getItem(ACCOUNTS_STORAGE_KEY);
        const existing: Record<string, { profile: UserProfile; password: string }> = existingRaw
          ? JSON.parse(existingRaw)
          : {};
        existing[email] = { profile: newUser, password };
        localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(existing));
      } catch {
        // ignore
      }
      hydrateUserWorkspace(newUser);
      setAuthPassword("");
      return;
    }

    // Login mode
    try {
      const existingRaw = localStorage.getItem(ACCOUNTS_STORAGE_KEY);
      const existing: Record<string, { profile: UserProfile; password: string }> = existingRaw
        ? JSON.parse(existingRaw)
        : {};
      if (existing[email]) {
        if (existing[email].password !== password) {
          setAuthError("Email hoặc mật khẩu chưa chính xác.");
          return;
        }
        hydrateUserWorkspace(existing[email].profile);
        setAuthPassword("");
        return;
      }
    } catch {
      // ignore
    }

    const isAdminEmail = email === "admin@askpay.vn" || email.startsWith("admin@");
    const profile: UserProfile = {
      name: isAdminEmail
        ? "Quản trị viên AskPay"
        : email.split("@")[0].replace(/[._]/g, " "),
      email,
      role: isAdminEmail ? "admin" : "user",
      company: isAdminEmail ? "AskPay Operations" : "Tài khoản Doanh nghiệp"
    };
    hydrateUserWorkspace(profile);
    setAuthPassword("");
  }

  function handleQuickDemoLogin(role: "user" | "admin") {
    setAuthError("");
    const profile: UserProfile =
      role === "admin"
        ? {
            name: "Admin AskPay",
            email: "admin@askpay.vn",
            role: "admin",
            company: "AskPay System Admin"
          }
        : {
            name: "Nguyễn Minh Anh",
            email: "doanhnghiep@askpay.vn",
            role: "user",
            company: "Công ty XNK Thái Bình Dương"
          };
    hydrateUserWorkspace(profile);
  }

  async function handleWalletLogin() {
    setAuthError("");
    const selected = await connectWallet();
    if (!selected) {
      setAuthError("Chưa phát hiện ví Core Wallet / MetaMask hoặc bạn đã hủy kết nối.");
      return;
    }
    const shortAddr = `${selected.slice(0, 6)}...${selected.slice(-4)}`;
    hydrateUserWorkspace({
      name: `Ví ${shortAddr}`,
      email: `${selected.toLowerCase()}@wallet.askpay`,
      role: "user",
      company: "Avalanche Fuji Wallet"
    });
  }

  function handleLogout() {
    setShowUserMenu(false);
    setShowDocsModal(false);
    setShowHistoryModal(false);
    setShowProfileModal(false);
    setShowSettingsModal(false);
    setShowLoyaltyModal(false);
    setSelectedExpert(null);
    setActiveView("chat");
    setFocusedAssistantId("");
    setErrorMsg("");
    try {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    } catch {
      // ignore
    }
    setCurrentUser(null);
    setSessions([]);
    setActiveSessionId("");
  }

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
      } else {
        throw switchError;
      }
    }
    const chainId = await eth.request({ method: "eth_chainId" });
    if (String(chainId).toLowerCase() !== "0xa869") throw new Error("Ví chưa kết nối Avalanche Fuji.");
  }

  async function connectWallet(): Promise<string> {
    setErrorMsg("");
    const eth =
      typeof window !== "undefined"
        ? (window as any).avalanche || (window as any).ethereum
        : null;
    if (!eth) {
      setErrorMsg(
        "Chưa phát hiện ví Core Wallet / MetaMask trên trình duyệt. Bạn vẫn có thể sử dụng chế độ Preview."
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
    const blank = createEmptySession();
    setSessions((prev) => [blank, ...prev]);
    setActiveSessionId(blank.id);
    setFocusedAssistantId("");
    setQuestionInput("");
    setErrorMsg("");
    setActiveView("chat");
    setMobileMenuOpen(false);
  }

  function handleSelectSession(sessionId: string) {
    setActiveSessionId(sessionId);
    setFocusedAssistantId("");
    setSelectedCitationIdx(0);
    setErrorMsg("");
    setActiveView("chat");
    setMobileMenuOpen(false);
  }

  function getConversationalReply(input: string): string | null {
    const rawLower = input.normalize("NFC").trim().toLowerCase();
    if (!rawLower) return null;

    if (/\d+\s*\/\s*\d{4}/.test(rawLower) || rawLower.includes("c/o")) {
      return null;
    }

    const xnkKeywords = [
      "thuế",
      "hải quan",
      "nhập khẩu",
      "xuất khẩu",
      "tờ khai",
      "mã hs",
      "phạt",
      "thông tư",
      "nghị định",
      "luật",
      "cảng",
      "container",
      "nhãn",
      "trị giá",
      "tạm nhập",
      "tái xuất",
      "xuất xứ",
      "kiểm tra",
      "xuất cảnh",
      "gia công",
      "sxxk",
      "tntx",
      "bcqt",
      "ecosys",
      "evfta",
      "atiga",
      "cptpp",
      "acfta",
      "gsp",
      "aeo",
      "bổ sung",
      "phân luồng",
      "thông quan"
    ];
    if (xnkKeywords.some((kw) => rawLower.includes(kw))) {
      return null;
    }

    const normalized = rawLower
      .replace(/[?!.,;:'"()[\]{}…]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!normalized || normalized.split(" ").length > 8) {
      return null;
    }

    const greetings = new Set([
      "hi",
      "hello",
      "helo",
      "hê lô",
      "hế lô",
      "hey",
      "yo",
      "alo",
      "a lô",
      "chào",
      "xin chào",
      "chào bạn",
      "chào ad",
      "chào askpay",
      "chào hệ thống",
      "chào trợ lý",
      "hi askpay",
      "hello askpay",
      "hi bạn",
      "hello bạn",
      "good morning",
      "good afternoon",
      "good evening"
    ]);
    const isGreetingRegex =
      /^(hi|hello|helo|hey|alo|a lô|xin chào|chào)(\s+(bạn|ad|askpay|nhé|nha|ơi|ạ|em|anh|chị|there|everyone))?$/i.test(
        normalized
      );

    if (greetings.has(normalized) || isGreetingRegex) {
      return (
        "Xin chào! Mình là trợ lý pháp lý AskPay chuyên về Hải quan và Xuất Nhập Khẩu.\n\n" +
        "Tin nhắn chào hỏi này hoàn toàn miễn phí (không gọi ví hay trừ cọc). Bạn có thể nhập ngay câu hỏi nghiệp vụ (ví dụ: thời hạn nộp tờ khai nhập khẩu, xử phạt khai sai mã HS, thủ tục C/O mẫu E/D/EUR.1, hoàn thuế hàng tái xuất...) để AskPay tra cứu và đối chiếu trực tiếp từ 43 văn bản pháp luật chính thức."
      );
    }

    const helpSet = new Set([
      "bạn là ai",
      "askpay là gì",
      "bạn làm được gì",
      "web này làm gì",
      "ứng dụng này làm gì",
      "hướng dẫn",
      "hướng dẫn sử dụng",
      "cách dùng",
      "cách sử dụng",
      "giúp tôi",
      "giúp mình",
      "help",
      "tư vấn giúp",
      "cho mình hỏi",
      "cho tôi hỏi",
      "mình muốn hỏi",
      "tôi muốn hỏi",
      "có ai ở đó không"
    ]);
    if (helpSet.has(normalized)) {
      return (
        "Mình là AskPay — trợ lý tra cứu và đối chiếu pháp luật Hải quan & Xuất Nhập Khẩu.\n\n" +
        "• Hỏi Nhanh (0.05 USDC): Tra cứu ngắn gọn kết luận và Điều/Khoản áp dụng.\n" +
        "• Tình Huống (0.20 USDC): Phân tích chuyên sâu đa văn bản, kèm hướng dẫn hồ sơ & lưu ý thực tế.\n" +
        "• Cam kết hoàn phí: Nếu không tìm thấy căn cứ hợp lệ hoặc văn bản đã hết hiệu lực, hệ thống tự động hoàn trả 100% chi phí.\n\n" +
        "Hãy nhập tình huống XNK cụ thể của bạn để bắt đầu nhé!"
      );
    }

    const thanksSet = new Set([
      "cảm ơn",
      "cám ơn",
      "cảm ơn bạn",
      "cảm ơn nhiều",
      "cám ơn nhiều",
      "cảm ơn ạ",
      "thanks",
      "thank you",
      "thank",
      "tks",
      "ty",
      "ok",
      "oke",
      "okay",
      "ok bạn",
      "được rồi",
      "tốt quá",
      "tuyệt vời",
      "hay quá",
      "tạm biệt",
      "bye",
      "bye bye",
      "goodbye"
    ]);
    if (thanksSet.has(normalized)) {
      return "Rất vui được hỗ trợ bạn! Nếu có thêm vướng mắc về tờ khai, mã HS, C/O hay quy định hải quan, bạn cứ nhắn câu hỏi bất cứ lúc nào nhé.";
    }

    return null;
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
      setErrorMsg("Vui lòng nhập tình huống Hải quan hoặc câu hỏi pháp luật cần tra cứu.");
      return;
    }

    if ((customMode ?? mode) === "factcheck") {
      if (!factDocument.trim() || !factArticle.trim() || !factClause.trim()) {
        setErrorMsg("Nhập số văn bản, Điều và Khoản cần kiểm chứng; dùng Khoản 0 nếu Điều không chia khoản.");
        return;
      }
      setErrorMsg("");
      setLoadingStep("Đang kiểm chứng điều khoản được chỉ định...");
      try {
        const response = await fetch('/api/legal-factcheck', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ document: factDocument, article: factArticle, clause: factClause,
            point: factPoint, excerpt: queryText, ...(asOf ? { as_of: asOf } : {}) })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Không thể kiểm chứng điều khoản.');
        const differences = data.differences.map((item: { input: string; source: string }) =>
          `“${item.input}” trong đoạn nhập khác “${item.source}” trong nguồn.`).join('\n');
        const answer = data.passed ? 'Đoạn trích khớp điều khoản đã chỉ định.' :
          `Không xác nhận được đoạn trích tại điều khoản đã chỉ định. ${data.fail_reason || ''}`;
        const messages: ChatMessage[] = [
          { id: `u-${Date.now()}`, role: 'user', timestampLabel: formatNowLabel(), content: queryText },
          { id: `a-${Date.now()}`, role: 'assistant', timestampLabel: formatNowLabel(), mode: 'factcheck',
            feeLabel: 'Kiểm chứng · Không thu phí', content: `${answer}${differences ? `\n${differences}` : ''}`,
            citations: [data.citation], validation: data.validation }
        ];
        const fallback = createEmptySession();
        const sessionId = activeSession?.id || fallback.id;
        setSessions(prev => (prev.length ? prev : [fallback]).map(s => s.id === sessionId ?
          { ...s, messages: [...s.messages, ...messages], status: data.passed ? 'verified' : 'draft' } : s));
        setFocusedAssistantId(messages[1].id);
        setRightTab('citation');
        if (!customPrompt) setQuestionInput('');
      } catch (error: any) {
        setErrorMsg(error?.message || 'Không thể kiểm chứng điều khoản.');
      } finally {
        setLoadingStep('');
      }
      return;
    }

    const freeConversationalReply = getConversationalReply(queryText);
    if (freeConversationalReply) {
      setErrorMsg("");
      const fallbackSession = createEmptySession();
      const targetSessionId = activeSession?.id || fallbackSession.id;
      const nowLabel = formatNowLabel();
      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        timestampLabel: nowLabel,
        content: queryText
      };
      const freeAssistantMsg: ChatMessage = {
        id: `a-${Date.now() + 1}`,
        role: "assistant",
        timestampLabel: nowLabel,
        feeLabel: "Hỗ trợ trực tuyến · Miễn phí",
        content: freeConversationalReply,
        citations: []
      };

      setSessions((prev) => {
        const base = prev.length > 0 ? prev : [fallbackSession];
        return base.map((s) =>
          s.id === targetSessionId
            ? {
                ...s,
                title: s.messages.length === 0 ? queryText : s.title,
                messages: [...s.messages, userMsg, freeAssistantMsg]
              }
            : s
        );
      });
      if (!customPrompt) setQuestionInput("");
      setFocusedAssistantId(freeAssistantMsg.id);
      setTimeout(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 60);
      return;
    }

    const activeMode = customMode ?? mode;
    const isDeep = activeMode === "deep";
    const apiTier = isDeep ? "deep" : "quick";
    const isFreeRewardTurn = questionCount > 0 && questionCount % 10 === 9;
    const priceLabel = isFreeRewardTurn
      ? "Miễn phí (Ưu đãi 10 tặng 1)"
      : isDeep
      ? "Phân tích sâu - 0.20 USDC"
      : activeMode === "factcheck"
      ? "Kiểm chứng - 0.05 USDC"
      : "Hỏi nhanh - 0.05 USDC";

    setErrorMsg("");
    setLoadingStep("Đang kết nối hệ thống tra cứu...");

    const fallbackSession = createEmptySession();
    const targetSessionId = activeSession?.id || fallbackSession.id;
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      timestampLabel: formatNowLabel(),
      content: queryText
    };

    setSessions((prev) => {
      const base = prev.length > 0 ? prev : [fallbackSession];
      return base.map((s) =>
        s.id === targetSessionId
          ? {
              ...s,
              title: s.messages.length === 0 ? queryText : s.title,
              messages: [...s.messages, userMsg]
            }
          : s
      );
    });
    if (!customPrompt) setQuestionInput("");

    setTimeout(() => {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 60);

    try {
      const eth =
        typeof window !== "undefined"
          ? (window as any).avalanche || (window as any).ethereum
          : null;
      let activeAccount = account;

      const paid = !isFreeRewardTurn && useOnchainWallet;
      if (paid && (!eth || !escrowAddress)) {
        throw new Error("Chưa cấu hình AnswerEscrow Fuji hoặc chưa có ví. Hãy chuyển sang chế độ preview nếu cần.");
      }
      if (paid && !activeAccount) activeAccount = await connectWallet();
      if (paid && !activeAccount) throw new Error("Cần kết nối ví để thanh toán USDC.");
      const asker = activeAccount || "0x0000000000000000000000000000000000000001";
      const questionId = keccak256(toBytes(`${asker}-${Date.now()}-${queryText}`));
      let escrowTxHash = "";
      let res: Response;
      if (paid) {
        await ensureFujiChain(eth);
        setLoadingStep("Đang kiểm tra yêu cầu thanh toán USDC...");
        const publicUrl = `${window.location.origin}/api/v1/legal/ask`;
        const requestBody = { question_id: questionId, question: queryText, tier: apiTier,
          ...(asOf ? { as_of: asOf } : {}) };
        res = await paidAsk('/api/v1/legal/ask', requestBody, async (challenge: string) => {
          setLoadingStep("Vui lòng kiểm tra và ký thanh toán USDC trong ví...");
          return signFujiPayment(challenge, apiTier, questionId, queryText, activeAccount,
                                 escrowAddress, publicUrl, eth);
        });
      } else {
        setLoadingStep("AskPay đang phân tích và đối chiếu văn bản pháp luật...");
        const isDemoMode = !corpus || corpus.corpus_status === "DEMO_UNVERIFIED";
        res = await fetch("/api/ask-and-settle", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId, question: queryText, tier: apiTier,
            ...(corpus?.corpus_status === "REVIEW_ASSERTED" && asOf ? { asOf } : {}),
            askerAddress: asker, escrowTxHash,
            simulateHallucination: isDemoMode && demoFault === "hallucination",
            simulateExpiredLaw: isDemoMode && demoFault === "expired" })
        });
      }

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Không thể xử lý câu hỏi lúc này.");
      }

      const passed = Boolean(data?.validation?.passed);
      const settledTx = data.onchain?.tx_hash || data.onchain?.fujiSettlementTxHash || "";
      const paidStatus = data.onchain?.status;
      escrowTxHash = data.onchain?.payment_tx_hash || data.payment_tx_hash || "";
      const settlementStatus = paid ?
        (paidStatus === "RELEASED" && settledTx ? "RELEASED_TO_TREASURY" :
         paidStatus === "AUTO-REFUNDED" && settledTx ? "AUTO_REFUNDED_TO_USER" : "PENDING_RECONCILIATION") :
        (data.onchain?.settlementStatus || "NO_ESCROW_DEPOSIT");
      const isLiveOnchain = paid ? Boolean(settledTx && paidStatus !== "PENDING") :
        data.onchain?.mode === "LIVE_AVALANCHE" && Boolean(data.onchain?.fujiSettlementTxHash);
      const hasEscrowDeposit = paid || Boolean(escrowTxHash) || isLiveOnchain;

      const computedFeeLabel = !hasEscrowDeposit
        ? "Mô phỏng — Không thu phí (0 USDC)"
        : settlementStatus === "AUTO_REFUNDED_TO_USER"
        ? "Đã hoàn cọc 100% (On-chain)"
        : settlementStatus === "SETTLEMENT_BLOCKED_INELIGIBLE"
        ? "Chặn giải ngân (Chưa đủ điều kiện)"
        : settlementStatus === "PENDING_RECONCILIATION"
        ? "Chờ đối soát giao dịch"
        : priceLabel;

      const assistantMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: "assistant",
        timestampLabel: formatNowLabel(),
        mode: activeMode,
        feeLabel: computedFeeLabel,
        questionId,
        content: data.answer || (paid ? `Thanh toán đang chờ đối soát. Mã câu hỏi: ${questionId}` : ""),
        citations: data.citations || [],
        validation: data.validation,
        hashes: data.hashes,
        x402Trace: data.x402Trace,
        onchain: {
          mode: isLiveOnchain ? "LIVE_AVALANCHE" : (paid ? "PENDING_AVALANCHE" : (data.onchain?.mode || "SIMULATED_NO_ESCROW")),
          escrowTxHash: escrowTxHash || data.onchain?.escrowTxHash || undefined,
          l1ReceiptTxHash: data.onchain?.l1ReceiptTxHash || "",
          fujiSettlementTxHash: settledTx,
          settlementStatus,
          guardReason: data.onchain?.guardReason
        }
      };

      const nextSessionStatus =
        isLiveOnchain && settlementStatus === "AUTO_REFUNDED_TO_USER"
          ? "refunded"
          : passed
          ? "verified"
          : "draft";

      setSessions((prev) =>
        prev.map((s) =>
          s.id === targetSessionId
            ? {
                ...s,
                status: nextSessionStatus,
                messages: [...s.messages, assistantMsg]
              }
            : s
        )
      );

      setQuestionCount((prev) => prev + 1);
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
      setErrorMsg(err?.message || "Đã có lỗi xảy ra khi xử lý yêu cầu.");
    } finally {
      setLoadingStep("");
    }
  }

  function handleLoadSampleSessionsForTesting() {
    setSessions(INITIAL_SESSIONS);
    setActiveSessionId(INITIAL_SESSIONS[0].id);
    setFocusedAssistantId("");
    setSelectedCitationIdx(0);
  }

  function handleClearSessions() {
    const fresh = createEmptySession();
    setSessions([fresh]);
    setActiveSessionId(fresh.id);
    setFocusedAssistantId("");
    setSelectedCitationIdx(0);
  }

  const todaySessions = sessions.filter((s) => s.group === "today");
  const weekSessions = sessions.filter((s) => s.group === "week");

  const txHistory = sessions.flatMap((s) =>
    s.messages
      .filter(
        (m) =>
          m.role === "assistant" &&
          m.onchain &&
          m.onchain.mode === "LIVE_AVALANCHE" &&
          Boolean(m.onchain.fujiSettlementTxHash || m.onchain.escrowTxHash)
      )
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

  // Loyalty progress ("Hỏi 10 câu tặng 1 câu")
  const cycleProgress = questionCount % 10;
  const freeTurnsEarned = Math.floor(questionCount / 10);
  const nextIsFree = questionCount > 0 && questionCount % 10 === 9;

  // =========================================================
  // AUTHENTICATION GATE (MUST LOGIN BEFORE WORKSPACE)
  // =========================================================
  if (!authChecked) {
    return (
      <div className="auth-shell">
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#0a1c2e" }}>
          <AskPayLogo size={36} />
          <span style={{ fontWeight: 700, fontSize: 18 }}>AskPay</span>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
            <AskPayLogo size={42} />
            <div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: "#0a1c2e",
                  letterSpacing: "-0.02em",
                  lineHeight: 1.15
                }}
              >
                AskPay
              </div>
              <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 2 }}>
                Trợ lý Pháp lý &amp; Hải quan Xuất Nhập Khẩu
              </div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: 10,
              padding: "9px 12px",
              marginBottom: 16,
              fontSize: 12.5,
              color: "#475569"
            }}
          >
            <LockIcon size={15} color="#285380" />
            <span>Đăng nhập tài khoản để truy cập không gian tra cứu và lịch sử cá nhân.</span>
          </div>

          <div className="auth-tabs">
            <button
              type="button"
              onClick={() => {
                setAuthTab("login");
                setAuthError("");
              }}
              className={`auth-tab-btn ${authTab === "login" ? "active" : ""}`}
            >
              Đăng nhập
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthTab("register");
                setAuthError("");
              }}
              className={`auth-tab-btn ${authTab === "register" ? "active" : ""}`}
            >
              Đăng ký mới
            </button>
          </div>

          <form onSubmit={handleAuthSubmit}>
            {authTab === "register" && (
              <>
                <div className="auth-field">
                  <label className="auth-label" htmlFor="auth-name">
                    Họ và tên
                  </label>
                  <input
                    id="auth-name"
                    type="text"
                    value={authName}
                    onChange={(e) => setAuthName(e.target.value)}
                    placeholder="Nguyễn Minh Anh"
                    className="auth-input"
                  />
                </div>
                <div className="auth-field">
                  <label className="auth-label" htmlFor="auth-company">
                    Doanh nghiệp / Tổ chức (tùy chọn)
                  </label>
                  <input
                    id="auth-company"
                    type="text"
                    value={authCompany}
                    onChange={(e) => setAuthCompany(e.target.value)}
                    placeholder="Công ty TNHH XNK Thái Bình Dương"
                    className="auth-input"
                  />
                </div>
              </>
            )}

            <div className="auth-field">
              <label className="auth-label" htmlFor="auth-email">
                Email
              </label>
              <input
                id="auth-email"
                type="email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="ten@doanhnghiep.vn"
                className="auth-input"
              />
            </div>

            <div className="auth-field">
              <label className="auth-label" htmlFor="auth-password">
                Mật khẩu
              </label>
              <input
                id="auth-password"
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder="••••••••"
                className="auth-input"
              />
            </div>

            {authError && (
              <div
                style={{
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  color: "#b91c1c",
                  borderRadius: 9,
                  padding: "8px 10px",
                  fontSize: 12.5,
                  marginBottom: 10
                }}
              >
                {authError}
              </div>
            )}

            <button type="submit" className="auth-submit-btn">
              {authTab === "login" ? "Đăng nhập vào AskPay" : "Tạo tài khoản & Bắt đầu"}
            </button>
          </form>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              margin: "18px 0 12px",
              fontSize: 11.5,
              color: "#94a3b8"
            }}
          >
            <div style={{ flex: 1, height: 1, background: "#e2e8f0" }} />
            <span>TRUY CẬP NHANH</span>
            <div style={{ flex: 1, height: 1, background: "#e2e8f0" }} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button
              type="button"
              onClick={() => handleQuickDemoLogin("user")}
              className="auth-quick-btn"
            >
              <UserIcon size={14} />
              Khách hàng (User)
            </button>
            <button
              type="button"
              onClick={() => handleQuickDemoLogin("admin")}
              className="auth-quick-btn"
            >
              <SlidersIcon size={14} />
              Quản trị (Admin)
            </button>
          </div>

          <button
            type="button"
            onClick={handleWalletLogin}
            className="auth-quick-btn"
            style={{ marginTop: 8 }}
          >
            <ShieldCheckIcon size={14} color="#1d4ed8" />
            Đăng nhập bằng Core Wallet / MetaMask
          </button>
        </div>
      </div>
    );
  }

  const userInitials = currentUser.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "AP";

  const activeChecks = activeAssistantMsg?.validation?.citation_checks || [];

  return (
    <div className="workspace-shell">
      {/* =========================================================
          COLUMN 1: LEFT NAVIGATION, WALLET, LOYALTY & HISTORY
         ========================================================= */}
      <aside className={`sidebar-left ${mobileMenuOpen ? "mobile-open" : ""}`}>
        {/* Brand Header */}
        <div className="brand-bar">
          <div className="brand-mark">
            <AskPayLogo size={34} />
            <div>
              <div className="brand-name">AskPay</div>
              <div style={{ fontSize: 10.5, color: "#64748b", fontWeight: 500 }}>
                Trợ lý Pháp lý Thông minh
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleStartNewSession}
            className="btn-new-chat"
            title="Tạo cuộc trò chuyện mới"
          >
            <PlusIcon size={13} />
            Mới
          </button>
        </div>

        {/* Wallet & Loyalty Section */}
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
                  {account ? `${avaxBalance || "..."} AVAX` : "Chưa kết nối"}
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
              title={
                account
                  ? "Xem cấu hình ví & Faucet Testnet"
                  : "Kết nối Core Wallet / MetaMask"
              }
            >
              <PlusIcon size={15} />
            </button>
          </div>

          {/* Loyalty Promo Card ("Hỏi 10 câu tặng 1 câu") */}
          <button
            type="button"
            onClick={() => setShowLoyaltyModal(true)}
            className="promo-card"
          >
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "#78350f" }}>
                Hỏi 10 câu tặng 1 câu
              </div>
              <div style={{ fontSize: 10.5, color: "#b45309" }}>
                {nextIsFree
                  ? "Lượt hỏi tiếp theo của bạn miễn phí!"
                  : "Tích lũy câu hỏi nhận lượt miễn phí"}
              </div>
            </div>
            <span className="promo-pill">
              {nextIsFree ? "🎁 0đ" : `${cycleProgress}/10`}
            </span>
          </button>
        </div>

        {/* Sessions List (Per-user isolated history) */}
        <div className="history-list custom-scrollbar">
          <div style={{ marginBottom: 16 }}>
            <div className="history-group-label">Hôm nay</div>
            {todaySessions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => handleSelectSession(s.id)}
                className={`history-item ${
                  activeView === "chat" && s.id === activeSession?.id ? "active" : ""
                }`}
              >
                <ChatBubbleIcon
                  size={14}
                  color={activeView === "chat" && s.id === activeSession?.id ? "#285380" : "#94a3b8"}
                />
                <span className="history-item-title">{s.title}</span>
                {s.status === "verified" && (
                  <span title="Đã đối chiếu nguồn văn bản">
                    <CheckCircleIcon size={15} color="#10b981" />
                  </span>
                )}
                {s.status === "refunded" && (
                  <span title="Không tìm thấy căn cứ — Đã hoàn phí">
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
                  className={`history-item ${
                    activeView === "chat" && s.id === activeSession?.id ? "active" : ""
                  }`}
                >
                  <ChatBubbleIcon
                    size={14}
                    color={
                      activeView === "chat" && s.id === activeSession?.id ? "#285380" : "#94a3b8"
                    }
                  />
                  <span className="history-item-title">{s.title}</span>
                  {s.status === "verified" && (
                    <span title="Đã đối chiếu nguồn">
                      <CheckCircleIcon size={15} color="#10b981" />
                    </span>
                  )}
                  {s.status === "refunded" && (
                    <span title="Đã hoàn phí">
                      <UndoIcon size={14} color="#f59e0b" />
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Bottom User Profile & Settings Dropdown Menu */}
        <div className="user-footer-wrap" ref={userMenuRef}>
          {showUserMenu && (
            <div className="settings-dropdown" role="menu" aria-label="Menu tài khoản và cài đặt">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setShowProfileModal(true);
                  setShowUserMenu(false);
                }}
                className="settings-dropdown-item"
              >
                <UserIcon size={15} color="#475569" />
                <span>Hồ sơ cá nhân</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setShowLoyaltyModal(true);
                  setShowUserMenu(false);
                }}
                className="settings-dropdown-item"
              >
                <GiftIcon size={15} color="#d97706" />
                <span>Ưu đãi (Hỏi 10 tặng 1)</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setShowSettingsModal(true);
                  setShowUserMenu(false);
                }}
                className="settings-dropdown-item"
              >
                <SlidersIcon size={15} color="#475569" />
                <span>Tùy chỉnh &amp; Ví thanh toán</span>
              </button>

              {currentUser.role === "admin" && (
                <>
                  <div className="settings-dropdown-divider" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setActiveView(activeView === "admin" ? "chat" : "admin");
                      setShowUserMenu(false);
                      setMobileMenuOpen(false);
                    }}
                    className="settings-dropdown-item"
                    style={{ color: "#1d4ed8", fontWeight: 600 }}
                  >
                    <ShieldCheckIcon size={15} color="#1d4ed8" />
                    <span>
                      {activeView === "admin" ? "Quay lại Tra cứu (User)" : "Trang Quản trị (Admin)"}
                    </span>
                  </button>
                </>
              )}

              <div className="settings-dropdown-divider" />
              <button
                type="button"
                role="menuitem"
                onClick={handleLogout}
                className="settings-dropdown-item danger"
              >
                <LogOutIcon size={15} color="#b91c1c" />
                <span>Đăng xuất</span>
              </button>
            </div>
          )}

          <div
            className="user-footer"
            onClick={() => setShowUserMenu((prev) => !prev)}
            role="button"
            tabIndex={0}
            aria-expanded={showUserMenu}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setShowUserMenu((prev) => !prev);
              }
            }}
          >
            <div className="user-avatar">{userInitials}</div>
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
                {currentUser.name}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: currentUser.role === "admin" ? "#1d4ed8" : "#64748b",
                  fontWeight: currentUser.role === "admin" ? 600 : 400,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis"
                }}
              >
                {currentUser.role === "admin" ? "Quản trị viên • AskPay" : currentUser.company}
              </div>
            </div>
            <GearIcon size={17} color={showUserMenu ? "#1d4ed8" : "#94a3b8"} />
          </div>
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
          COLUMN 2: EITHER END-USER CHAT OR ADMIN CONSOLE
         ========================================================= */}
      {activeView === "admin" && currentUser.role === "admin" ? (
        <main className="chat-column" style={{ borderRight: "none" }}>
          <header className="chat-header">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                type="button"
                className="icon-btn mobile-only-btn"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Mở thanh điều hướng"
              >
                <MenuIcon size={19} />
              </button>
              <div>
                <h1 className="chat-header-title">AskPay Admin — Hệ thống Kiểm định &amp; Vận hành</h1>
                <p className="chat-header-status" style={{ color: "#1d4ed8" }}>
                  <ShieldCheckIcon size={14} color="#1d4ed8" />
                  Giám sát Deterministic Validator, Nhật ký L1/Fuji &amp; Kiểm thử dữ liệu
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setActiveView("chat")}
              style={{
                padding: "7px 13px",
                borderRadius: 9,
                border: "1px solid #e2e8f0",
                background: "#102a43",
                color: "#ffffff",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer"
              }}
            >
              Về giao diện Tra cứu
            </button>
          </header>

          <div className="chat-stream custom-scrollbar" style={{ background: "#f8fafc" }}>
            <div style={{ maxWidth: 920, width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>
              {/* Admin Section 1: 4 Chốt chặn Deterministic Validator Inspector */}
              <section
                style={{
                  background: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 16,
                  padding: 20
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <h2 style={{ margin: 0, fontSize: 15.5, color: "#0a1c2e" }}>
                    1. 4 Chốt chặn Deterministic Validator (Phiên đang chọn)
                  </h2>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#285380" }}>
                    Điểm tổng: {activeAssistantMsg?.validation?.overall_score ?? 0}%
                  </span>
                </div>

                {activeChecks.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {activeChecks.map((check, i) => (
                      <div
                        key={i}
                        style={{
                          background: "#f8fafc",
                          border: "1px solid #e2e8f0",
                          borderRadius: 11,
                          padding: "12px 14px"
                        }}
                      >
                        <div style={{ fontWeight: 700, fontSize: 13, color: "#0a1c2e", marginBottom: 8 }}>
                          {check.document} — Điều {check.article}, Khoản {check.clause} ({check.status})
                        </div>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
                            gap: 8,
                            fontSize: 12.5
                          }}
                        >
                          <div style={{ color: check.doc_exists ? "#047857" : "#b91c1c" }}>
                            {check.doc_exists ? "✓" : "✕"} Tồn tại VB (25%)
                          </div>
                          <div style={{ color: check.article_clause_exists ? "#047857" : "#b91c1c" }}>
                            {check.article_clause_exists ? "✓" : "✕"} Đúng Điều/Khoản (25%)
                          </div>
                          <div style={{ color: check.is_in_force ? "#047857" : "#b91c1c" }}>
                            {check.is_in_force ? "✓" : "✕"} Hiệu lực văn bản (20%)
                          </div>
                          <div style={{ color: check.excerpt_similarity >= 0.9 ? "#047857" : "#b91c1c" }}>
                            {check.excerpt_similarity >= 0.9 ? "✓" : "✕"} Nguyên văn{" "}
                            {Math.round(check.excerpt_similarity * 100)}% (≥90%)
                          </div>
                        </div>
                        {check.fail_reason && (
                          <div
                            className="font-mono"
                            style={{
                              marginTop: 8,
                              fontSize: 11.5,
                              color: "#991b1b",
                              background: "#fef2f2",
                              padding: "5px 8px",
                              borderRadius: 6
                            }}
                          >
                            Lý do từ chối: {check.fail_reason}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
                    Chưa có kết quả kiểm định nào trong phiên hiện tại. Bạn có thể bấm &ldquo;Nạp 3 tình huống mẫu&rdquo; bên dưới hoặc đặt câu hỏi trong giao diện Chat.
                  </p>
                )}
              </section>

              {/* Admin Section 2: On-chain Audit Log (L1 Node 663010 & Avalanche Fuji) */}
              <section
                style={{
                  background: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 16,
                  padding: 20
                }}
              >
                <h2 style={{ margin: "0 0 12px", fontSize: 15.5, color: "#0a1c2e" }}>
                  2. Nhật ký On-chain (Avalanche Fuji 43113 &amp; AskPay L1 663010)
                </h2>
                <div
                  className="font-mono"
                  style={{
                    background: "#0f172a",
                    color: "#e2e8f0",
                    borderRadius: 11,
                    padding: 14,
                    fontSize: 12,
                    lineHeight: 1.7
                  }}
                >
                  <div>• Fuji Escrow Contract: {escrowAddress || "0xb4fc756871c6e1694f13d7692c8f714c47142108"}</div>
                  <div>• AskPay L1 Receipt Contract: {receiptAddress || "0xb4fc756871c6e1694f13d7692c8f714c47142108"}</div>
                  {activeAssistantMsg?.validation && (
                    <>
                      <div style={{ marginTop: 8, color: "#93c5fd" }}>
                        • Validator: {activeAssistantMsg.validation.validator_version || "1.1.0-deterministic"} • corpus_status: {activeAssistantMsg.validation.corpus_status || "DEMO_UNVERIFIED"} • settlement_eligible: {String(Boolean(activeAssistantMsg.validation.settlement_eligible))}
                      </div>
                      {activeAssistantMsg.hashes && (
                        <>
                          <div>• question_hash: {activeAssistantMsg.hashes.question_hash}</div>
                          <div>• answer_hash: {activeAssistantMsg.hashes.answer_hash}</div>
                          <div>• citations_hash: {activeAssistantMsg.hashes.citations_hash}</div>
                          <div>• validator_hash: {activeAssistantMsg.hashes.validator_hash}</div>
                          <div>• corpus_hash: {activeAssistantMsg.hashes.corpus_hash}</div>
                        </>
                      )}
                    </>
                  )}
                  {activeAssistantMsg?.onchain && (
                    <>
                      <div style={{ marginTop: 8, color: activeAssistantMsg.onchain.mode === "LIVE_AVALANCHE" ? "#34d399" : "#fbbf24" }}>
                        • Mode gần nhất: {activeAssistantMsg.onchain.mode} ({activeAssistantMsg.onchain.settlementStatus})
                        {activeAssistantMsg.onchain.guardReason ? ` — Reason: ${activeAssistantMsg.onchain.guardReason}` : ""}
                      </div>
                      <div>• L1 Receipt Tx: {activeAssistantMsg.onchain.l1ReceiptTxHash || "Chưa phát sinh Tx (Chế độ mô phỏng không đặt cọc)"}</div>
                      <div>• Fuji Settlement Tx: {activeAssistantMsg.onchain.fujiSettlementTxHash || "Chưa phát sinh Tx (Chế độ mô phỏng không đặt cọc)"}</div>
                    </>
                  )}
                </div>
              </section>

              {/* Admin Section 3: Fault Injection & Test Data Tools */}
              <section
                style={{
                  background: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 16,
                  padding: 20
                }}
              >
                <h2 style={{ margin: "0 0 12px", fontSize: 15.5, color: "#0a1c2e" }}>
                  3. Cấu hình Kiểm thử Hệ thống &amp; Kho Dữ liệu
                </h2>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#334155" }}>
                    Chế độ giả lập lỗi Validator:{" "}
                    <select
                      value={demoFault}
                      onChange={(e) =>
                        setDemoFault(e.target.value as "normal" | "hallucination" | "expired")
                      }
                      style={{
                        marginLeft: 6,
                        padding: "6px 10px",
                        borderRadius: 8,
                        border: "1px solid #cbd5e1",
                        fontSize: 12.5
                      }}
                    >
                      <option value="normal">Bình thường</option>
                      <option value="hallucination">Giả lập AI bịa luật</option>
                      <option value="expired">Giả lập Luật hết hạn</option>
                    </select>
                  </label>

                  {corpus?.corpus_status === "REVIEW_ASSERTED" && (
                    <label style={{ fontSize: 13, color: "#334155" }}>
                      Ngày hiệu lực (as_of):{" "}
                      <input
                        type="date"
                        value={asOf}
                        onChange={(e) => setAsOf(e.target.value)}
                        style={{ padding: "5px 8px", borderRadius: 7, border: "1px solid #cbd5e1" }}
                      />
                    </label>
                  )}
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 16 }}>
                  <button
                    type="button"
                    onClick={() => setShowDocsModal(true)}
                    className="next-step-btn primary"
                  >
                    Xem Kho văn bản Corpus ({corpus?.total_documents ?? "..."})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      handleLoadSampleSessionsForTesting();
                      setActiveView("chat");
                    }}
                    className="next-step-btn secondary"
                  >
                    Nạp 3 tình huống mẫu để kiểm thử
                  </button>
                  <button
                    type="button"
                    onClick={handleClearSessions}
                    className="next-step-btn secondary"
                    style={{ color: "#b91c1c" }}
                  >
                    Xóa toàn bộ lịch sử phiên
                  </button>
                </div>
              </section>
            </div>
          </div>
        </main>
      ) : (
        <>
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
                    {activeSession?.title || "Trợ Lý Pháp Luật AskPay"}
                  </h1>
                  <p
                    className="chat-header-status"
                    style={{
                      color:
                        activeSession?.status === "refunded"
                          ? "#d97706"
                          : activeSession?.status === "draft" && activeAssistantMsg?.validation && !activeAssistantMsg.validation.passed
                          ? "#64748b"
                          : "#059669"
                    }}
                  >
                    <ShieldCheckIcon
                      size={14}
                      color={
                        activeSession?.status === "refunded"
                          ? "#d97706"
                          : activeSession?.status === "draft" && activeAssistantMsg?.validation && !activeAssistantMsg.validation.passed
                          ? "#64748b"
                          : "#059669"
                      }
                    />
                    {activeSession?.status === "refunded"
                      ? "Giao dịch cọc đã được hoàn trả theo kết quả kiểm định"
                      : activeSession?.status === "draft" && activeAssistantMsg?.validation && !activeAssistantMsg.validation.passed
                      ? "Chế độ mô phỏng không thu phí · Chưa tìm thấy trích dẫn đủ điều kiện"
                      : "Phiên làm việc tra cứu · Đối chiếu trích dẫn theo nguồn văn bản"}
                  </p>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
              {/* Welcome Empty State */}
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
                      Xin chào {currentUser.name}, bạn cần AskPay hỗ trợ tra cứu vấn đề gì?
                    </div>
                    <p style={{ margin: 0, fontSize: 13.5, color: "#64748b", lineHeight: 1.55 }}>
                      Đặt câu hỏi về thủ tục Hải quan, mã HS, C/O hoặc thuế Xuất Nhập Khẩu. Mọi
                      câu trả lời đều đi kèm trích dẫn văn bản pháp luật rõ ràng để bạn đối chiếu
                      và xuất công văn ngay.
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
                          <span style={{ color: "#285380", fontWeight: 700, marginRight: 6 }}>
                            →
                          </span>
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

                return (
                  <div key={msg.id} className="msg-ai-wrap">
                    <div className="msg-meta">
                      <div className="ai-avatar-badge">
                        <RobotIcon size={14} />
                      </div>
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: "#0a1c2e" }}>
                        AskPay
                      </span>
                      {msg.feeLabel && <span className="tier-tag-badge">{msg.feeLabel}</span>}
                    </div>

                    <div className={`msg-ai-card ${passed ? "" : "refunded"}`}>
                      {/* Validation / Settlement Status Banner */}
                      {!passed && (
                        <div
                          style={{
                            background: msg.onchain?.mode === "LIVE_AVALANCHE" ? "#fef3c7" : "#f8fafc",
                            border: `1px solid ${msg.onchain?.mode === "LIVE_AVALANCHE" ? "#fde68a" : "#cbd5e1"}`,
                            color: msg.onchain?.mode === "LIVE_AVALANCHE" ? "#92400e" : "#475569",
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
                          <UndoIcon size={15} color={msg.onchain?.mode === "LIVE_AVALANCHE" ? "#b45309" : "#64748b"} />
                          <span>
                            {msg.onchain?.mode === "LIVE_AVALANCHE" &&
                            msg.onchain?.settlementStatus === "AUTO_REFUNDED_TO_USER" &&
                            msg.onchain?.fujiSettlementTxHash
                              ? `Không tìm thấy căn cứ hợp lệ hoặc văn bản đã hết hiệu lực — Giao dịch cọc đã hoàn trả 100% (Tx: ${msg.onchain.fujiSettlementTxHash.slice(0, 12)}...).`
                              : msg.onchain?.settlementStatus === "PENDING_RECONCILIATION"
                              ? "Đã ghi nhận kiểm định, giao dịch hoàn cọc trên blockchain đang chờ đối soát."
                              : "Chưa tìm thấy trích dẫn đủ điều kiện hoặc văn bản đã hết hiệu lực — Chế độ mô phỏng không thu phí (chưa phát sinh giao dịch đặt cọc)."}
                          </span>
                        </div>
                      )}

                      {/* Body */}
                      <div className="ai-body-text">{msg.content}</div>

                      {/* Clickable Statutory Citations */}
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
                              title="Bấm để đối chiếu văn bản ở bảng bên phải"
                            >
                              Điều {cit.article}, Khoản {cit.clause}
                              {cit.point ? `, Điểm ${cit.point}` : ""} ({cit.document})
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Gợi ý bước tiếp theo */}
                      {msg.validation && (
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
                      )}
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
                      AskPay
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

            {/* Single Sticky Bottom Prompt Composer */}
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
                      <span style={{ fontSize: 10, opacity: 0.75 }}>
                        {nextIsFree ? "0$" : "0.05$"}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setMode("deep")}
                      className={`mode-pill ${mode === "deep" ? "active-deep" : ""}`}
                    >
                      <BranchIcon size={13} />
                      Tình Huống
                      <span style={{ fontSize: 10, opacity: 0.75 }}>
                        {nextIsFree ? "0$" : "0.20$"}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setMode("factcheck")}
                      className={`mode-pill ${mode === "factcheck" ? "active-factcheck" : ""}`}
                    >
                      <ShieldCheckIcon size={13} />
                      Kiểm Chứng Luật
                      <span style={{ fontSize: 10, opacity: 0.75 }}>
                        {nextIsFree ? "0$" : "0.05$"}
                      </span>
                    </button>
                  </div>

                  {nextIsFree && (
                    <span
                      style={{
                        fontSize: 11.5,
                        fontWeight: 700,
                        color: "#b45309",
                        background: "#fef3c7",
                        padding: "3px 9px",
                        borderRadius: 999
                      }}
                    >
                      🎁 Lượt hỏi miễn phí (10 tặng 1)
                    </span>
                  )}
                </div>

                {/* Rounded Prompt Input Card */}
                <div className="composer-box">
                  {mode === 'factcheck' && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '10px 12px' }}>
                    <input aria-label="Số văn bản" placeholder="Số văn bản" value={factDocument} onChange={e => setFactDocument(e.target.value)} />
                    <input aria-label="Điều" placeholder="Điều" value={factArticle} onChange={e => setFactArticle(e.target.value)} />
                    <input aria-label="Khoản" placeholder="Khoản (0 nếu không chia)" value={factClause} onChange={e => setFactClause(e.target.value)} />
                    <input aria-label="Điểm" placeholder="Điểm (nếu có)" value={factPoint} onChange={e => setFactPoint(e.target.value)} />
                  </div>}
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
                        ? "Dán đoạn tư vấn hoặc điều khoản XNK bạn cần AskPay kiểm chứng..."
                        : "Nhập câu hỏi Hải quan, mã HS, C/O hoặc thủ tục XNK..."
                    }
                    className="composer-textarea custom-scrollbar"
                  />

                  <div className="composer-toolbar">
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => setShowDocsModal(true)}
                        className="icon-btn"
                        title="Xem danh mục văn bản pháp luật"
                      >
                        <PaperclipIcon size={16} />
                      </button>
                      <span style={{ fontSize: 11.5, color: "#64748b" }}>
                        {useOnchainWallet && account
                          ? `Ví Fuji sẵn sàng (${mode === "deep" ? "0.02" : "0.005"} AVAX)`
                          : "Đối chiếu văn bản pháp luật chính thức"}
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
              COLUMN 3: RIGHT UTILITY & CITATION PANEL
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
        </>
      )}

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
                Danh mục Văn bản Pháp luật
              </h3>
              <button
                type="button"
                onClick={() => setShowDocsModal(false)}
                className="icon-btn"
              >
                <CloseXIcon size={17} />
              </button>
            </div>

            {corpusError && <p role="alert">{corpusError}</p>}
            {!corpus && !corpusError && <p>Đang tải kho dữ liệu...</p>}
            {corpus && (
              <>
                <p style={{ fontSize: 12, color: "#64748b" }}>
                  {corpus.total_documents} văn bản · {corpus.total_chunks} điều khoản được cập nhật.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {Array.from(
                    new Map(
                      corpus.records
                        .filter((doc) => typeof doc.doc_id === "string")
                        .map((doc) => [doc.doc_id, doc])
                    ).values()
                  ).map((doc) => (
                    <div
                      key={doc.doc_id}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1px solid #e2e8f0",
                        background: "#f8fafc"
                      }}
                    >
                      <strong style={{ fontSize: 13.5, color: "#102a43" }}>{doc.doc_id}</strong>
                      <div style={{ fontSize: 12.5, color: "#475569", marginTop: 3 }}>
                        {doc.doc_title}
                      </div>
                      {doc.source_url?.startsWith("https://") && (
                        <a
                          href={doc.source_url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ fontSize: 12 }}
                        >
                          Xem nguồn văn bản ↗
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
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
                Lịch sử giao dịch của bạn
              </h3>
              <button
                type="button"
                onClick={() => setShowHistoryModal(false)}
                className="icon-btn"
              >
                <CloseXIcon size={17} />
              </button>
            </div>

            {txHistory.length === 0 ? (
              <p style={{ fontSize: 13, color: "#64748b", margin: 0, lineHeight: 1.55 }}>
                Chưa có giao dịch đặt cọc On-chain nào được ghi nhận trong tài khoản này (các lượt tra cứu ở chế độ mô phỏng không thu phí sẽ không ghi thành giao dịch hoàn tiền).
              </p>
            ) : (
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
                        {item.passed ? "Hoàn tất" : "Hoàn phí 100%"}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: "#64748b" }}>
                      {item.timestamp} • {item.feeLabel}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. Loyalty Promo Modal ("Hỏi 10 câu tặng 1 câu") */}
      {showLoyaltyModal && (
        <div className="modal-backdrop" onClick={() => setShowLoyaltyModal(false)}>
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
                Chương trình Hỏi 10 câu tặng 1 câu
              </h3>
              <button
                type="button"
                onClick={() => setShowLoyaltyModal(false)}
                className="icon-btn"
              >
                <CloseXIcon size={17} />
              </button>
            </div>

            <div style={{ fontSize: 13.5, color: "#334155", lineHeight: 1.6 }}>
              <div
                style={{
                  background: "linear-gradient(90deg, #fef3c7 0%, #fffbeb 100%)",
                  border: "1px solid #fde68a",
                  borderRadius: 12,
                  padding: 16,
                  marginBottom: 16
                }}
              >
                <div style={{ fontWeight: 700, color: "#78350f", fontSize: 15 }}>
                  Tiến độ chu kỳ hiện tại: {cycleProgress}/10 câu hỏi
                </div>
                <div style={{ fontSize: 12.5, color: "#b45309", marginTop: 4 }}>
                  Tổng số câu bạn đã tra cứu: <strong>{questionCount}</strong> câu • Số lượt tặng đã
                  đạt: <strong>{freeTurnsEarned}</strong> lượt miễn phí.
                </div>

                <div
                  style={{
                    marginTop: 12,
                    height: 10,
                    background: "#ffffff",
                    borderRadius: 999,
                    overflow: "hidden",
                    border: "1px solid #fde68a"
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(100, cycleProgress * 10)}%`,
                      height: "100%",
                      background: "linear-gradient(90deg, #f59e0b 0%, #d97706 100%)",
                      transition: "width 0.3s ease"
                    }}
                  />
                </div>
              </div>

              <p style={{ margin: "0 0 14px", color: "#475569" }}>
                Với mỗi <strong>10 câu hỏi</strong> thực hiện trên AskPay, hệ thống tự động tặng bạn{" "}
                <strong>1 lượt hỏi miễn phí (0 USDC)</strong> cho câu thứ 10 (áp dụng cho cả Hỏi
                Nhanh và Phân Tích Tình Huống).
              </p>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => setShowLoyaltyModal(false)}
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
                  Đóng
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. Profile Modal */}
      {showProfileModal && (
        <div className="modal-backdrop" onClick={() => setShowProfileModal(false)}>
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
                Hồ sơ Tài khoản AskPay
              </h3>
              <button
                type="button"
                onClick={() => setShowProfileModal(false)}
                className="icon-btn"
              >
                <CloseXIcon size={17} />
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 13.5 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div className="user-avatar" style={{ width: 48, height: 48, fontSize: 16 }}>
                  {userInitials}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "#0a1c2e" }}>
                    {currentUser.name}
                  </div>
                  <div style={{ fontSize: 12.5, color: "#64748b" }}>{currentUser.email}</div>
                </div>
              </div>

              <div
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: 12,
                  padding: 14,
                  lineHeight: 1.75
                }}
              >
                <div>
                  <strong>Đơn vị:</strong> {currentUser.company}
                </div>
                <div>
                  <strong>Vai trò:</strong>{" "}
                  {currentUser.role === "admin" ? "Quản trị viên hệ thống (Admin)" : "Khách hàng doanh nghiệp"}
                </div>
                <div>
                  <strong>Tổng lượt hỏi tích lũy:</strong> {questionCount} câu ({cycleProgress}/10 chu
                  kỳ thưởng)
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. User Wallet & Preferences Modal */}
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
                Tùy chỉnh &amp; Kết nối Ví Thanh toán
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
                  Ví Avalanche Fuji Testnet (Kiểm thử không mất phí thật)
                </div>
                {account ? (
                  <div>
                    <div className="font-mono" style={{ fontSize: 12, color: "#334155" }}>
                      Địa chỉ ví: {account}
                    </div>
                    <div style={{ marginTop: 4, color: "#047857", fontWeight: 600 }}>
                      Số dư Testnet: {avaxBalance || "..."} AVAX
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

                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginTop: 10,
                    cursor: "pointer",
                    color: "#334155"
                  }}
                >
                  <input
                    type="checkbox"
                    checked={useOnchainWallet}
                    onChange={(e) => setUseOnchainWallet(e.target.checked)}
                  />
                  <span>Thanh toán qua ví Web3 khi gửi câu hỏi</span>
                </label>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <a
                  href="https://core.app/tools/testnet-faucet/?subnet=c&token=c"
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#285380", fontWeight: 600, textDecoration: "none" }}
                >
                  Nhận AVAX Testnet miễn phí tại Core Faucet ↗
                </a>
                <button
                  type="button"
                  onClick={() => {
                    handleClearSessions();
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
                  Tạo mới lịch sử chat
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. Tier 3 Expert Connect Modal */}
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
                Kết nối Chuyên gia Tư vấn
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
                  <strong>Phí tư vấn giữ qua Escrow:</strong> {selectedExpert.escrowFeeUsdc} USDC
                </div>
                <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 4 }}>
                  Hệ thống sẽ đính kèm toàn bộ nội dung tra cứu và trích dẫn pháp luật để chuyên
                  gia rà soát trực tiếp.
                </div>
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
                  Xác nhận gửi yêu cầu
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
