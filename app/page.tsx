"use client";

import React, { useEffect, useRef, useState } from "react";
import { paymentContext, requestHash, paymentProofMessage, PAYMENT_SCHEME } from "./lib/payment-request.mjs";
import {
  createPublicClient,
  createWalletClient,
  custom,
  formatEther,
  http,
  keccak256,
  parseEther,
  toBytes
} from "viem";
import { avalancheFuji } from "viem/chains";
import RightPanel, { RightTab } from "./components/RightPanel";
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
  ChatMessage,
  ChatSession,
  ExpertLawyer,
  INITIAL_SESSIONS,
  SITUATION_CARDS,
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
  accountMode?: "demo" | "account";
}

function normalizeEnvValue(val?: string): string {
  return String(val || "").trim();
}

function isValidEvmAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr.trim());
}

function isDemoProfile(user: UserProfile | null): boolean {
  if (!user) return true;
  if (user.accountMode === "demo") return true;
  if (user.accountMode === "account") return false;
  return user.email === "doanhnghiep@askpay.vn" || user.email === "admin@askpay.vn";
}

const FUJI_USDC_ADDRESS =
  normalizeEnvValue(process.env.NEXT_PUBLIC_USDC_ADDRESS) ||
  "0x5425890298aed601595a70AB815c96711a31Bc65";

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
  },
  {
    name: "askQuestionUsdc",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "questionId", type: "bytes32" },
      { name: "tier", type: "uint8" },
      { name: "questionHash", type: "bytes32" },
      { name: "amount", type: "uint256" }
    ],
    outputs: []
  },
  {
    name: "claimTimeoutRefund",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "questionId", type: "bytes32" }],
    outputs: []
  }
] as const;

interface PendingPaidAttempt {
  questionId: string;
  queryText: string;
  activeMode: TierMode;
  apiTier: "quick" | "deep";
  escrowTxHash: string;
  xPaymentHeader: string;
  asOf?: string;
  priceLabel: string;
  targetSessionId: string;
}

const ERC20_USDC_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }]
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" }
    ],
    outputs: [{ type: "uint256" }]
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: [{ type: "bool" }]
  }
] as const;

function sanitizeLegacySessions(list: ChatSession[]): ChatSession[] {
  return list.map((session) => {
    let changedFromLegacyRefund = false;
    const sanitizedMessages = (session.messages || []).map((msg) => {
      if (msg.role !== "assistant") return msg;
      const mode = msg.onchain?.mode;
      const isLegacyMock =
        mode === "SAMPLE_SHOWCASE" ||
        mode === "SIMULATED_PREVIEW" ||
        (mode !== "LIVE_AVALANCHE" && !msg.onchain?.escrowTxHash && !msg.onchain?.fujiSettlementTxHash);
      if (!isLegacyMock) return msg;

      if (session.status === "refunded") changedFromLegacyRefund = true;
      return {
        ...msg,
        feeLabel:
          msg.feeLabel && (msg.feeLabel.includes("Hoàn") || msg.feeLabel.includes("USDC"))
            ? "Dữ liệu mô phỏng phiên bản trước — chưa xác minh giao dịch"
            : msg.feeLabel || "Bản dùng thử — Không thu phí",
        onchain: msg.onchain
          ? {
              ...msg.onchain,
              mode: "SIMULATED_NO_ESCROW" as const,
              l1ReceiptTxHash: "",
              fujiSettlementTxHash: "",
              settlementStatus: "NO_ESCROW_DEPOSIT" as const
            }
          : undefined
      };
    });

    return {
      ...session,
      status: changedFromLegacyRefund ? "draft" : session.status,
      messages: sanitizedMessages
    };
  });
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
  const [showLoginForm, setShowLoginForm] = useState<boolean>(true);
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
  const [usdcBalance, setUsdcBalance] = useState<string>("");
  const [useOnchainWallet, setUseOnchainWallet] = useState<boolean>(false);
  const [paymentAsset, setPaymentAsset] = useState<"USDC" | "AVAX">("USDC");

  // Composer & Backend states
  const [questionInput, setQuestionInput] = useState<string>("");
  const [lastFailedPrompt, setLastFailedPrompt] = useState<string>("");
  const [pendingPaidAttempt, setPendingPaidAttempt] = useState<PendingPaidAttempt | null>(null);
  const [claimingTimeoutId, setClaimingTimeoutId] = useState<string>("");
  const [mode, setMode] = useState<TierMode>("quick");
  const [demoFault, setDemoFault] = useState<"normal" | "hallucination" | "expired">("normal");
  const [loadingStep, setLoadingStep] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [corpus, setCorpus] = useState<CorpusInventory | null>(null);
  const [corpusError, setCorpusError] = useState<string>("");
  const [asOf, setAsOf] = useState<string>("");

  // Layout & Right Panel states (Nguồn luật mặc định đóng; mở khi bấm vào căn cứ)
  const [rightOpen, setRightOpen] = useState<boolean>(false);
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const escrowAddress = normalizeEnvValue(process.env.NEXT_PUBLIC_ESCROW_ADDRESS);
  const receiptAddress = normalizeEnvValue(process.env.NEXT_PUBLIC_RECEIPT_LOG_ADDRESS);
  const fujiRpc =
    normalizeEnvValue(process.env.NEXT_PUBLIC_FUJI_RPC_URL) ||
    "https://api.avax-test.network/ext/bc/C/rpc";

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
    const normalizedUser: UserProfile = {
      ...user,
      accountMode: isDemoProfile(user) ? "demo" : "account"
    };
    setCurrentUser(normalizedUser);
    setUseOnchainWallet(normalizedUser.accountMode === "account");
    setActiveView("chat");
    try {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(normalizedUser));
      const savedSessions = localStorage.getItem(sessionsKeyForUser(normalizedUser.email));
      if (savedSessions) {
        const parsed = JSON.parse(savedSessions);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const cleanParsed = sanitizeLegacySessions(parsed);
          setSessions(cleanParsed);
          setActiveSessionId(cleanParsed[0].id);
        } else {
          const empty = createEmptySession();
          setSessions([empty]);
          setActiveSessionId(empty.id);
        }
      } else {
        const empty = createEmptySession();
        setSessions([empty]);
        setActiveSessionId(empty.id);
      }

      const savedCount = Number(localStorage.getItem(loyaltyKeyForUser(normalizedUser.email)) || "0");
      setQuestionCount(Number.isFinite(savedCount) && savedCount >= 0 ? savedCount : 0);
    } catch {
      const empty = createEmptySession();
      setSessions([empty]);
      setActiveSessionId(empty.id);
    }
  }

  // Silently sync already-authorized browser wallet when signed into account mode
  useEffect(() => {
    if (!currentUser || isDemoProfile(currentUser) || typeof window === "undefined") return;
    const eth = (window as any).avalanche || (window as any).ethereum;
    if (!eth) return;

    let cancelled = false;
    eth
      .request({ method: "eth_accounts" })
      .then((accounts: string[]) => {
        if (cancelled || !Array.isArray(accounts) || !accounts[0]) return;
        setAccount(accounts[0]);
        refreshBalance(accounts[0]);
      })
      .catch(() => {
        // ignore passive wallet check errors
      });

    const handleAccountsChanged = (accounts: string[]) => {
      const next = Array.isArray(accounts) && accounts[0] ? accounts[0] : "";
      setAccount(next);
      if (next) {
        refreshBalance(next);
      } else {
        setAvaxBalance("");
        setUsdcBalance("");
      }
    };
    eth.on?.("accountsChanged", handleAccountsChanged);
    return () => {
      cancelled = true;
      eth.removeListener?.("accountsChanged", handleAccountsChanged);
    };
  }, [currentUser]);

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
        company: authCompany.trim() || "Doanh nghiệp XNK",
        accountMode: "account"
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
      company: isAdminEmail ? "AskPay Operations" : "Tài khoản Doanh nghiệp",
      accountMode: isAdminEmail ? "demo" : "account"
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
            company: "AskPay System Admin",
            accountMode: "demo"
          }
        : {
            name: "Nguyễn Minh Anh",
            email: "doanhnghiep@askpay.vn",
            role: "user",
            company: "Công ty XNK Thái Bình Dương",
            accountMode: "demo"
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
      company: "Avalanche Fuji Wallet",
      accountMode: "account"
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
    setUseOnchainWallet(false);
    setAccount("");
    setAvaxBalance("");
    setUsdcBalance("");
    setPendingPaidAttempt(null);
    setClaimingTimeoutId("");
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
    if (!isValidEvmAddress(addr)) return;
    try {
      const client = createPublicClient({
        chain: avalancheFuji,
        transport: http(fujiRpc)
      });
      const bal = await client.getBalance({ address: addr as `0x${string}` });
      setAvaxBalance(Number(formatEther(bal)).toFixed(4));
      if (isValidEvmAddress(FUJI_USDC_ADDRESS)) {
        try {
          const usdcRaw = (await client.readContract({
            address: FUJI_USDC_ADDRESS as `0x${string}`,
            abi: ERC20_USDC_ABI,
            functionName: "balanceOf",
            args: [addr as `0x${string}`],
            authorizationList: undefined
          })) as bigint;
          setUsdcBalance((Number(usdcRaw) / 1e6).toFixed(2));
        } catch {
          setUsdcBalance("");
        }
      }
    } catch {
      setAvaxBalance("");
      setUsdcBalance("");
    }
  }

  async function ensureFujiChain(eth: any) {
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0xa869" }]
      });
    } catch (switchError: any) {
      if (switchError?.code === 4902) {
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
      } else if (switchError?.code === 4001) {
        throw new Error("Bạn đã hủy chuyển sang mạng Avalanche Fuji Testnet trên ví.");
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
    if (mode === "factcheck") setMode("quick");
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

    const normalized = rawLower
      .replace(/[?!.,;:'"()[\]{}…]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!normalized) return null;

    if (
      [
        "tất cả những gì bạn biết",
        "những gì bạn biết",
        "bạn biết những gì",
        "bạn biết gì",
        "cho tôi biết bạn làm được gì",
        "hỗ trợ những lĩnh vực nào",
        "tra cứu được gì"
      ].some((phrase) => normalized.includes(phrase))
    ) {
      return (
        "Mình là Lorx — trợ lý tra cứu và đối chiếu pháp luật Hải quan & Xuất Nhập Khẩu dựa trên kho văn bản đối chiếu.\n\n" +
        "Các nhóm nghiệp vụ bạn có thể hỏi ngay:\n" +
        "1. Chuẩn bị nhập hàng / xuất hàng (hồ sơ hải quan, tờ khai VNACCS, hóa đơn, vận đơn, nhãn phụ tiếng Việt, giấy phép XNK).\n" +
        "2. Thời hạn nộp & khai bổ sung tờ khai (mốc 30 ngày, phân luồng Xanh/Vàng/Đỏ, tính ngày còn lại giữa 2 mốc ngày).\n" +
        "3. Xuất xứ hàng hóa C/O (hồ sơ thương nhân lần đầu, mẫu D/ATIGA, mẫu E/ACFTA, EUR.1/EVFTA, CPTPP).\n" +
        "4. Thuế XNK, trị giá hải quan, hoàn thuế tái xuất, gia công/SXXK, và xử phạt sai mã HS (128/2020/NĐ-CP).\n" +
        "5. Nhập khẩu máy móc, thiết bị đã qua sử dụng (18/2019/QĐ-TTg & 28/2022/QĐ-TTg, chứng thư giám định, tuổi thiết bị).\n" +
        "6. Kiểm chứng nguồn: đối chiếu chính xác văn bản, Điều/Khoản và nguyên văn đoạn trích.\n\n" +
        "Tin nhắn giới thiệu này hoàn toàn miễn phí (không gọi ví). Bạn đang cần tra cứu lô hàng nhập khẩu hay xuất khẩu cụ thể nào?"
      );
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

    if (normalized.split(" ").length > 8) {
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
      "chào lorx",
      "chào hệ thống",
      "chào trợ lý",
      "hi askpay",
      "hi lorx",
      "hello askpay",
      "hello lorx",
      "hi bạn",
      "hello bạn",
      "good morning",
      "good afternoon",
      "good evening"
    ]);
    const isGreetingRegex =
      /^(hi|hello|helo|hey|alo|a lô|xin chào|chào)(\s+(bạn|ad|askpay|lorx|nhé|nha|ơi|ạ|em|anh|chị|there|everyone))?$/i.test(
        normalized
      );

    if (greetings.has(normalized) || isGreetingRegex) {
      return (
        "Xin chào! Mình là trợ lý pháp lý Lorx chuyên về Hải quan và Xuất Nhập Khẩu.\n\n" +
        "Tin nhắn chào hỏi này hoàn toàn miễn phí (không gọi ví hay trừ cọc). Bạn có thể nhập ngay câu hỏi nghiệp vụ (ví dụ: thời hạn nộp tờ khai nhập khẩu, nhập khẩu máy móc đã qua sử dụng, hiệu lực NĐ 128/2020 vs 169/2026...) để Lorx tra cứu và đối chiếu trực tiếp từ nguồn chính thức."
      );
    }

    const helpSet = new Set([
      "bạn là ai",
      "askpay là gì",
      "lorx là gì",
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
        "Mình là Lorx — trợ lý tra cứu và đối chiếu pháp luật Hải quan & Xuất Nhập Khẩu.\n\n" +
        "• Tra cứu nhanh (0.05 USDC): Một vấn đề cụ thể, câu trả lời ngắn gọn kèm căn cứ.\n" +
        "• Phân tích tình huống (0.20 USDC): Xem các điều kiện áp dụng, ngoại lệ và thông tin còn thiếu.\n" +
        "• Kiểm chứng nguồn: Đối chiếu số hiệu văn bản, Điều/Khoản và nguyên văn đoạn trích.\n\n" +
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
    const isAccountMode = !isDemoProfile(currentUser);
    const isFreeRewardTurn = questionCount > 0 && questionCount % 10 === 9;
    const isFactcheckFree = activeMode === "factcheck";
    const requiresWalletFlow = !isFreeRewardTurn && !isFactcheckFree && (useOnchainWallet || isAccountMode);

    let activeAccount = account;
    if (requiresWalletFlow && !activeAccount) {
      activeAccount = await connectWallet();
      if (!activeAccount) {
        setLastFailedPrompt(queryText);
        setErrorMsg(
          "Tài khoản đã đăng nhập sử dụng luồng thanh toán có cam kết trích dẫn. Vui lòng kết nối Core Wallet / MetaMask để tiếp tục (hoặc đăng xuất để Dùng thử demo miễn phí)."
        );
        setShowSettingsModal(true);
        return;
      }
    }

    if (requiresWalletFlow && !isValidEvmAddress(escrowAddress)) {
      setLastFailedPrompt(queryText);
      setErrorMsg(
        "Cấu hình địa chỉ hợp đồng Escrow (NEXT_PUBLIC_ESCROW_ADDRESS) chưa hợp lệ."
      );
      return;
    }

    const eth =
      typeof window !== "undefined"
        ? (window as any).avalanche || (window as any).ethereum
        : null;

    if (requiresWalletFlow && !eth) {
      setLastFailedPrompt(queryText);
      setErrorMsg(
        "Chưa phát hiện ví Core Wallet / MetaMask trên trình duyệt để ký tạm giữ khoản tiền."
      );
      setShowSettingsModal(true);
      return;
    }

    const isWalletPaymentActive = Boolean(
      requiresWalletFlow && activeAccount && eth && isValidEvmAddress(escrowAddress)
    );
    const priceLabel = isFactcheckFree
      ? "Kiểm chứng nguồn · Miễn phí"
      : isFreeRewardTurn
      ? "Miễn phí (Ưu đãi 10 tặng 1)"
      : !isWalletPaymentActive
      ? "Miễn phí trong bản dùng thử"
      : paymentAsset === "USDC"
      ? isDeep
        ? "Phân tích tình huống - 0.20 USDC"
        : "Tra cứu nhanh - 0.05 USDC"
      : isDeep
      ? "Phân tích tình huống - 0.02 AVAX testnet"
      : "Tra cứu nhanh - 0.005 AVAX testnet";

    setErrorMsg("");
    setLastFailedPrompt("");
    setPendingPaidAttempt(null);
    setLoadingStep("Mình đang tìm căn cứ liên quan đến câu hỏi của bạn...");

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

    let escrowTxHash = "";
    let usedX402Usdc = false;
    let builtXPaymentHeader = "";
    let builtAsOf: string | undefined =
      corpus?.corpus_status === "REVIEW_ASSERTED" && asOf ? asOf : undefined;
    let currentQuestionId = "";
    try {
      const asker = activeAccount || "0x0000000000000000000000000000000000000001";
      const questionId = keccak256(toBytes(`${asker}-${Date.now()}-${queryText}`));
      currentQuestionId = questionId;
      let questionHash = keccak256(toBytes(queryText));
      const isDemoMode = !corpus || corpus.corpus_status === "DEMO_UNVERIFIED";

      const basePayload = {
        questionId,
        question: queryText,
        tier: apiTier,
        mode: activeMode,
        ...(builtAsOf ? { asOf: builtAsOf } : {}),
        askerAddress: asker,
        simulateHallucination: isDemoMode && demoFault === "hallucination",
        simulateExpiredLaw: isDemoMode && demoFault === "expired"
      };

      const requestHeaders: Record<string, string> = {
        "Content-Type": "application/json"
      };

      if (isWalletPaymentActive && activeAccount && eth) {
        await ensureFujiChain(eth);
        const publicClient = createPublicClient({
          chain: avalancheFuji,
          transport: http(fujiRpc)
        });
        const walletClient = createWalletClient({
          chain: avalancheFuji,
          transport: custom(eth)
        });

        if (paymentAsset !== "USDC") throw new Error("Bản vá proof chỉ hỗ trợ USDC. Chọn USDC hoặc dùng demo miễn phí.");
        if (paymentAsset === "USDC") {
          // Step 1: Request escrow challenge
          setLoadingStep("Đang lấy thông tin tạm giữ khoản tiền...");
          const challengeRes = await fetch("/api/ask-and-settle", {
            method: "POST",
            headers: requestHeaders,
            body: JSON.stringify({ ...basePayload, requireX402: true })
          });
          const challengeData = await challengeRes.json();
          if (challengeRes.status !== 402) {
            throw new Error(challengeData?.error || "Không thể khởi tạo phiên thanh toán escrow.");
          }
          const accept = challengeData?.accepts?.[0];
          const challengeAmount = String(accept?.maxAmountRequired || (isDeep ? "200000" : "50000"));
          const challengeAsset = normalizeEnvValue(String(accept?.asset || FUJI_USDC_ADDRESS));
          const offeredContext = accept?.extra?.context;
          if (accept?.scheme !== PAYMENT_SCHEME || !offeredContext) throw new Error("Challenge không hợp lệ.");
          const boundContext = paymentContext(basePayload, {
            chainId: 43113, escrowAddress, usdcAddress: FUJI_USDC_ADDRESS,
            corpusHash: offeredContext.corpusHash, asOf: offeredContext.asOf
          });
          questionHash = requestHash(boundContext);
          if (questionHash !== accept.extra.requestHash || challengeAmount !== boundContext.amount ||
              challengeAsset.toLowerCase() !== boundContext.asset) throw new Error("Challenge không khớp yêu cầu.");
          basePayload.asOf = boundContext.asOf;
          builtAsOf = boundContext.asOf;
          if (!isValidEvmAddress(challengeAsset)) {
            throw new Error("Địa chỉ token USDC thanh toán trên Fuji chưa hợp lệ.");
          }

          // Step 2: Pre-check balances & execute USDC Escrow deposit
          setLoadingStep(`Đang kiểm tra số dư và tạm giữ ${isDeep ? "0.20" : "0.05"} USDC...`);
          try {
            const requiredUsdc = BigInt(challengeAmount);
            const [nativeBal, currentUsdcBal] = await Promise.all([
              publicClient.getBalance({ address: activeAccount as `0x${string}` }),
              publicClient.readContract({
                address: challengeAsset as `0x${string}`,
                abi: ERC20_USDC_ABI,
                functionName: "balanceOf",
                args: [activeAccount as `0x${string}`],
                authorizationList: undefined
              }) as Promise<bigint>
            ]);

            if (currentUsdcBal < requiredUsdc) {
              throw new Error(
                `Ví hiện có ${(Number(currentUsdcBal) / 1e6).toFixed(2)} USDC trên Fuji (cần ${
                  isDeep ? "0.20" : "0.05"
                } USDC). Hãy nạp thêm USDC Fuji hoặc dùng demo miễn phí.`
              );
            }
            if (nativeBal === 0n) {
              throw new Error("Ví cần một ít AVAX testnet để trả phí gas trên Avalanche Fuji.");
            }

            const currentAllowance = (await publicClient.readContract({
              address: challengeAsset as `0x${string}`,
              abi: ERC20_USDC_ABI,
              functionName: "allowance",
              args: [activeAccount as `0x${string}`, escrowAddress as `0x${string}`],
              authorizationList: undefined
            })) as bigint;

            if (currentAllowance < requiredUsdc) {
              setLoadingStep("Đang cấp quyền USDC (Approve) cho hợp đồng tạm giữ...");
              const approveTx = await walletClient.writeContract({
                chain: avalancheFuji,
                account: activeAccount as `0x${string}`,
                address: challengeAsset as `0x${string}`,
                abi: ERC20_USDC_ABI,
                functionName: "approve",
                args: [escrowAddress as `0x${string}`, requiredUsdc]
              });
              const approval = await publicClient.waitForTransactionReceipt({ hash: approveTx });
              if (approval.status !== "success") throw new Error("Approve USDC thất bại.");
            }

            setLoadingStep(`Đang khóa ${isDeep ? "0.20" : "0.05"} USDC vào AskPayEscrow...`);
            const txHash = await walletClient.writeContract({
              chain: avalancheFuji,
              account: activeAccount as `0x${string}`,
              address: escrowAddress as `0x${string}`,
              abi: ESCROW_ABI,
              functionName: "askQuestionUsdc",
              args: [questionId, isDeep ? 1 : 0, questionHash, requiredUsdc]
            });
            escrowTxHash = txHash;
            const depositReceipt = await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 2 });
            if (depositReceipt.status !== "success") throw new Error("Giao dịch đặt cọc đã revert; kiểm tra explorer.");
          } catch (walletErr: any) {
            throw new Error(
              walletErr?.shortMessage ||
                walletErr?.message ||
                "Chưa thu tiền: Giao dịch tạm giữ qua ví đã bị hủy hoặc chưa đủ số dư."
            );
          }

          // Step 3: Attach X-PAYMENT proof header for authenticated retry
          setLoadingStep("Ký xác nhận yêu cầu đã đặt cọc (không chuyển thêm tiền)...");
          const signature = await walletClient.signMessage({ account: activeAccount as `0x${string}`,
            message: paymentProofMessage(boundContext, escrowTxHash) });
          const xPaymentPayload = { version: 2, scheme: PAYMENT_SCHEME, chainId: 43113,
            asset: boundContext.asset, escrow: boundContext.escrow,
            requestHash: questionHash, txHash: escrowTxHash, signature };
          builtXPaymentHeader = btoa(JSON.stringify(xPaymentPayload));
          requestHeaders["X-PAYMENT"] = builtXPaymentHeader;
          usedX402Usdc = true;
          setPendingPaidAttempt({
            questionId,
            queryText,
            activeMode,
            apiTier,
            escrowTxHash,
            xPaymentHeader: builtXPaymentHeader,
            asOf: builtAsOf,
            priceLabel,
            targetSessionId
          });
        }
        await refreshBalance(activeAccount);
      }

      setLoadingStep("Mình đang tìm căn cứ liên quan đến câu hỏi của bạn...");

      const res = await fetch("/api/ask-and-settle", {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({
          ...basePayload,
          escrowTxHash,
          ...(escrowTxHash && usedX402Usdc ? { requireX402: true } : {})
        })
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(
          data.error ||
            "Chưa nhận được câu trả lời. Câu hỏi của bạn vẫn được giữ lại để thử lại."
        );
      }

      const settledAttempt = commitAssistantResult({
        data,
        questionId,
        targetSessionId,
        activeMode,
        priceLabel,
        escrowTxHash,
        isFreeRewardTurn
      });

      if (settledAttempt !== "PENDING_RECONCILIATION") {
        setPendingPaidAttempt(null);
      }

      if (activeAccount) {
        await refreshBalance(activeAccount);
      }

      setTimeout(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 80);
    } catch (err: any) {
      if (!escrowTxHash) {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === targetSessionId
              ? { ...s, messages: s.messages.filter((m) => m.id !== userMsg.id) }
              : s
          )
        );
      } else if (currentQuestionId && builtXPaymentHeader) {
        setPendingPaidAttempt({
          questionId: currentQuestionId,
          queryText,
          activeMode,
          apiTier,
          escrowTxHash,
          xPaymentHeader: builtXPaymentHeader,
          asOf: builtAsOf,
          priceLabel,
          targetSessionId
        });
      }
      if (!customPrompt) setQuestionInput(queryText);
      setLastFailedPrompt(queryText);
      const baseMsg =
        err?.message || "Chưa nhận được câu trả lời. Câu hỏi của bạn vẫn được giữ lại để thử lại.";
      setErrorMsg(
        escrowTxHash
          ? `Đã tạm giữ khoản tiền (Tx: ${escrowTxHash.slice(0, 12)}...), nhưng ${baseMsg}`
          : baseMsg
      );
    } finally {
      setLoadingStep("");
    }
  }

  function commitAssistantResult({
    data,
    questionId,
    targetSessionId,
    activeMode,
    priceLabel,
    escrowTxHash,
    isFreeRewardTurn
  }: {
    data: any;
    questionId: string;
    targetSessionId: string;
    activeMode: TierMode;
    priceLabel: string;
    escrowTxHash: string;
    isFreeRewardTurn: boolean;
  }): string {
    const passed = Boolean(data?.validation?.passed);
    const settlementStatus = data.onchain?.settlementStatus || "NO_ESCROW_DEPOSIT";
    const isLiveOnchain =
      data.onchain?.mode === "LIVE_AVALANCHE" &&
      Boolean(data.onchain?.fujiSettlementTxHash);
    const hasEscrowDeposit = Boolean(escrowTxHash) || isLiveOnchain;

    const computedFeeLabel =
      activeMode === "factcheck"
        ? "Kiểm chứng nguồn · Miễn phí"
        : isFreeRewardTurn
        ? "Miễn phí (Ưu đãi 10 tặng 1)"
        : !hasEscrowDeposit
        ? "Miễn phí trong bản dùng thử"
        : settlementStatus === "AUTO_REFUNDED_TO_USER"
        ? "Đã hoàn tiền tạm giữ 100%"
        : settlementStatus === "SETTLEMENT_BLOCKED_INELIGIBLE"
        ? "Tạm dừng giải ngân (Chưa đủ điều kiện)"
        : settlementStatus === "PENDING_RECONCILIATION"
        ? "Đang kiểm tra trạng thái thanh toán"
        : priceLabel;

    const assistantMsg: ChatMessage = {
      id: `a-${Date.now()}`,
      role: "assistant",
      timestampLabel: formatNowLabel(),
      mode: activeMode,
      feeLabel: computedFeeLabel,
      answerStatus: data.answer_status,
      reviewLevel: data.validation?.review_level,
      questionId,
      content: data.answer || "",
      citations: data.citations || [],
      validation: data.validation,
      hashes: data.hashes,
      x402Trace: data.x402Trace,
      onchain: {
        mode: data.onchain?.mode || "SIMULATED_NO_ESCROW",
        escrowTxHash: escrowTxHash || data.onchain?.escrowTxHash || undefined,
        l1ReceiptTxHash: data.onchain?.l1ReceiptTxHash || "",
        fujiSettlementTxHash: data.onchain?.fujiSettlementTxHash || "",
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
    return settlementStatus;
  }

  async function handleRetryPendingAttempt(attempt: PendingPaidAttempt) {
    if (loadingStep) return;
    setErrorMsg("");
    setLoadingStep("Đang gửi lại yêu cầu đã đặt cọc (không tạo cọc mới)...");
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(attempt.xPaymentHeader ? { "X-PAYMENT": attempt.xPaymentHeader } : {})
      };
      const res = await fetch("/api/ask-and-settle", {
        method: "POST",
        headers,
        body: JSON.stringify({
          questionId: attempt.questionId,
          question: attempt.queryText,
          tier: attempt.apiTier,
          mode: attempt.activeMode,
          ...(attempt.asOf ? { asOf: attempt.asOf } : {}),
          askerAddress: account || "0x0000000000000000000000000000000000000001",
          escrowTxHash: attempt.escrowTxHash,
          requireX402: true
        })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Chưa thể đối soát yêu cầu đã đặt cọc.");
      }
      const status = commitAssistantResult({
        data,
        questionId: attempt.questionId,
        targetSessionId: attempt.targetSessionId,
        activeMode: attempt.activeMode,
        priceLabel: attempt.priceLabel,
        escrowTxHash: attempt.escrowTxHash,
        isFreeRewardTurn: false
      });
      if (status !== "PENDING_RECONCILIATION") {
        setPendingPaidAttempt(null);
      }
      if (account) await refreshBalance(account);
    } catch (err: any) {
      setErrorMsg(
        `Đã tạm giữ khoản tiền (Tx: ${attempt.escrowTxHash.slice(0, 12)}...), nhưng ${
          err?.message || "chưa thể hoàn tất xử lý."
        }`
      );
    } finally {
      setLoadingStep("");
    }
  }

  async function handleClaimTimeoutRefund(targetQuestionId: string, msgId?: string) {
    if (!targetQuestionId || claimingTimeoutId) return;
    setErrorMsg("");
    setClaimingTimeoutId(targetQuestionId);
    try {
      const eth =
        typeof window !== "undefined"
          ? (window as any).avalanche || (window as any).ethereum
          : null;
      if (!eth) throw new Error("Chưa phát hiện ví Core Wallet / MetaMask.");
      const activeAddr = account || (await connectWallet());
      if (!activeAddr) throw new Error("Vui lòng kết nối ví đã đặt cọc để rút lại tiền.");
      if (!isValidEvmAddress(escrowAddress)) throw new Error("Địa chỉ hợp đồng Escrow chưa hợp lệ.");

      await ensureFujiChain(eth);
      const publicClient = createPublicClient({
        chain: avalancheFuji,
        transport: http(fujiRpc)
      });
      const walletClient = createWalletClient({
        chain: avalancheFuji,
        transport: custom(eth)
      });
      const refundTx = await walletClient.writeContract({
        chain: avalancheFuji,
        account: activeAddr as `0x${string}`,
        address: escrowAddress as `0x${string}`,
        abi: ESCROW_ABI,
        functionName: "claimTimeoutRefund",
        args: [targetQuestionId as `0x${string}`]
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: refundTx });
      if (receipt.status !== "success") throw new Error("Giao dịch rút lại cọc timeout đã revert.");

      await refreshBalance(activeAddr);
      if (pendingPaidAttempt?.questionId === targetQuestionId) {
        setPendingPaidAttempt(null);
      }
      if (msgId) {
        setSessions((prev) =>
          prev.map((s) => ({
            ...s,
            status: s.messages.some((m) => m.id === msgId) ? "refunded" : s.status,
            messages: s.messages.map((m) =>
              m.id === msgId
                ? {
                    ...m,
                    feeLabel: "Đã rút lại cọc sau timeout (100%)",
                    onchain: m.onchain
                      ? {
                          ...m.onchain,
                          settlementStatus: "AUTO_REFUNDED_TO_USER",
                          fujiSettlementTxHash: refundTx
                        }
                      : undefined
                  }
                : m
            )
          }))
        );
      }
    } catch (err: any) {
      const msgText = String(err?.shortMessage || err?.message || "");
      if (msgText.toLowerCase().includes("timeout not reached")) {
        setErrorMsg("Chưa đủ thời hạn chờ 5 phút của hợp đồng Escrow; vui lòng thử lại sau ít phút.");
      } else if (msgText.toLowerCase().includes("not pending")) {
        setErrorMsg("Khoản cọc cho câu hỏi này đã được xử lý hoặc hoàn trả trước đó.");
      } else {
        setErrorMsg(msgText || "Không thể rút lại cọc timeout.");
      }
    } finally {
      setClaimingTimeoutId("");
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
          <span style={{ fontWeight: 700, fontSize: 18 }}>Lorx</span>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="auth-shell">
        <div className="auth-card" style={{ maxWidth: showLoginForm ? 440 : 480 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <AskPayLogo size={40} />
              <div>
                <div
                  style={{
                    fontSize: 21,
                    fontWeight: 800,
                    color: "#0a1c2e",
                    letterSpacing: "-0.02em",
                    lineHeight: 1.15
                  }}
                >
                  Lorx
                </div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                  Bản dùng thử · Tra cứu pháp luật XNK
                </div>
              </div>
            </div>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "3px 9px",
                borderRadius: 999,
                background: "#f0f5fa",
                color: "#285380",
                border: "1px solid #bfd3ea"
              }}
            >
              Bản dùng thử
            </span>
          </div>

          {!showLoginForm ? (
            <div>
              <h1
                style={{
                  margin: "0 0 8px",
                  fontSize: 22,
                  fontWeight: 800,
                  color: "#0a1c2e",
                  lineHeight: 1.3
                }}
              >
                Tra cứu pháp luật xuất nhập khẩu
              </h1>
              <p style={{ margin: "0 0 20px", fontSize: 15, color: "#475569", lineHeight: 1.6 }}>
                Nhập câu hỏi của bạn. Lorx sẽ tìm căn cứ để bạn đối chiếu.
              </p>

              <button
                type="button"
                onClick={() => handleQuickDemoLogin("user")}
                className="auth-submit-btn"
                style={{ fontSize: 15, padding: "13px 18px" }}
              >
                Dùng thử demo (Miễn phí)
              </button>

              <p style={{ margin: "12px 0 18px", fontSize: 12.5, color: "#64748b", textAlign: "center", lineHeight: 1.5 }}>
                Bản dùng thử miễn phí, không cần kết nối ví. Hoặc đăng nhập tài khoản để kết nối ví thanh toán on-chain.
              </p>

              <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 14, display: "flex", justifyContent: "center" }}>
                <button
                  type="button"
                  onClick={() => setShowLoginForm(true)}
                  className="link-subtle"
                  style={{ fontSize: 13, fontWeight: 600, color: "#285380" }}
                >
                  Đăng nhập tài khoản / Kết nối ví
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#0a1c2e" }}>
                  Đăng nhập tài khoản (Kết nối ví)
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setAuthError("");
                    handleQuickDemoLogin("user");
                  }}
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    padding: "6px 12px",
                    borderRadius: 999,
                    border: "1px solid #bfd3ea",
                    background: "#eef4fa",
                    color: "#285380",
                    cursor: "pointer"
                  }}
                >
                  Dùng thử demo (Free)
                </button>
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
                  {authTab === "login" ? "Đăng nhập" : "Tạo tài khoản & Bắt đầu"}
                </button>
              </form>

              <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                <button
                  type="button"
                  onClick={handleWalletLogin}
                  className="auth-quick-btn"
                >
                  <ShieldCheckIcon size={14} color="#1d4ed8" />
                  Đăng nhập bằng Core Wallet / MetaMask
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickDemoLogin("admin")}
                  className="link-subtle"
                  style={{ fontSize: 11.5, color: "#94a3b8", textAlign: "center", paddingTop: 4 }}
                >
                  Lối vào kiểm tra kỹ thuật (Quản trị)
                </button>
              </div>
            </div>
          )}
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
              <div className="brand-name">Lorx</div>
              <div style={{ fontSize: 10.5, color: "#64748b", fontWeight: 500 }}>
                {isDemoProfile(currentUser)
                  ? "Bản dùng thử · Pháp lý XNK"
                  : "Tài khoản Web3 · Pháp lý XNK"}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleStartNewSession}
            className="btn-new-chat"
            title="Bắt đầu câu hỏi mới"
          >
            <PlusIcon size={13} />
            Câu hỏi mới
          </button>
        </div>

        {/* Compact Sidebar Utilities: Thư viện văn bản (chỉ Admin) & Thanh toán */}
        <div style={{ padding: "10px 14px 6px", display: "flex", flexDirection: "column", gap: 6 }}>
          {currentUser.role === "admin" && (
            <button
              type="button"
              onClick={() => setShowDocsModal(true)}
              className="history-item"
              style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}
            >
              <FileTextIcon size={14} color="#285380" />
              <span className="history-item-title" style={{ fontWeight: 600, color: "#0a1c2e" }}>
                Thư viện văn bản
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowSettingsModal(true)}
            className="history-item"
            style={{
              background: !isDemoProfile(currentUser) && !account ? "#fffbeb" : "#ffffff",
              border: !isDemoProfile(currentUser) && !account ? "1px solid #fde68a" : "1px solid #e2e8f0"
            }}
          >
            <ShieldCheckIcon
              size={14}
              color={
                useOnchainWallet && account
                  ? "#059669"
                  : !isDemoProfile(currentUser)
                  ? "#b45309"
                  : "#64748b"
              }
            />
            <span
              className="history-item-title"
              style={{
                fontSize: 12.5,
                color: !isDemoProfile(currentUser) && !account ? "#b45309" : undefined,
                fontWeight: !isDemoProfile(currentUser) && !account ? 600 : undefined
              }}
            >
              {useOnchainWallet && account
                ? `Thanh toán (${paymentAsset})`
                : !isDemoProfile(currentUser)
                ? "Kết nối ví để thanh toán"
                : "Thanh toán (Dùng thử miễn phí)"}
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
                {currentUser.role === "admin" ? "Quản trị viên • Lorx" : currentUser.company}
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
                <h1 className="chat-header-title">Lorx Admin — Hệ thống Kiểm định &amp; Vận hành</h1>
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
                    {activeSession?.title || "Trợ Lý Pháp Luật Lorx"}
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
                  className="next-step-btn secondary"
                  style={{ padding: "6px 11px", fontSize: 12 }}
                  title="Đóng/Mở bảng nguồn luật đối chiếu"
                >
                  <SidebarIcon size={16} />
                  <span>{rightOpen ? "Ẩn nguồn" : "Nguồn luật"}</span>
                </button>
              </div>
            </header>

            {/* Scrollable Chat Stream */}
            <div className="chat-stream custom-scrollbar">
              {/* Welcome Empty State */}
              {(!activeSession || activeSession.messages.length === 0) && (
                <div style={{ maxWidth: 680, margin: "20px auto", width: "100%" }}>
                  <div
                    style={{
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      borderRadius: 16,
                      padding: "24px"
                    }}
                  >
                    <h2
                      style={{
                        fontSize: 20,
                        fontWeight: 700,
                        color: "#0a1c2e",
                        margin: "0 0 8px"
                      }}
                    >
                      Bạn muốn hỏi gì về xuất nhập khẩu?
                    </h2>
                    <p style={{ margin: 0, fontSize: 15, color: "#475569", lineHeight: 1.65 }}>
                      Nhập câu hỏi của bạn. Lorx sẽ tìm căn cứ để bạn đối chiếu — hoặc bấm một tình huống bên dưới để điền nhanh trước khi gửi.
                    </p>

                    <div className="welcome-grid" style={{ marginTop: 18 }}>
                      {SITUATION_CARDS.map((card) => (
                        <button
                          key={card.id}
                          type="button"
                          disabled={Boolean(loadingStep)}
                          onClick={() => {
                            if (card.id === "factcheck-demo") {
                              setMode("factcheck");
                            } else if (mode === "factcheck") {
                              setMode("deep");
                            }
                            setQuestionInput(card.prefill);
                            setErrorMsg("");
                            setTimeout(() => {
                              textareaRef.current?.focus();
                            }, 20);
                          }}
                          className="welcome-chip"
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "flex-start",
                            gap: 4,
                            padding: "13px 14px"
                          }}
                        >
                          <span style={{ fontWeight: 700, fontSize: 14, color: "#0a1c2e" }}>
                            {card.title}
                          </span>
                          <span style={{ fontSize: 12.5, color: "#64748b", lineHeight: 1.45 }}>
                            {card.description}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Render Messages */}
              {(activeSession?.messages || []).map((msg, msgIdx, msgArr) => {
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
                const precedingUserPrompt =
                  msgArr
                    .slice(0, msgIdx)
                    .reverse()
                    .find((m) => m.role === "user")?.content || "";
                const showSwitchToLookupBtn =
                  msg.mode === "factcheck" &&
                  msg.validation?.fail_reason === "INSUFFICIENT_STRUCTURED_CITATION" &&
                  Boolean(precedingUserPrompt);

                return (
                  <div key={msg.id} className="msg-ai-wrap">
                    <div className="msg-meta">
                      <div className="ai-avatar-badge">
                        <RobotIcon size={14} />
                      </div>
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: "#0a1c2e" }}>
                        Lorx
                      </span>
                      {msg.feeLabel && <span className="tier-tag-badge">{msg.feeLabel}</span>}
                    </div>

                    <div className={`msg-ai-card ${passed ? "" : "refunded"}`}>
                      {/* Separated Citation, Answer Status, and Payment/Escrow Status */}
                      {msg.validation && (
                        <div
                          style={{
                            background: passed
                              ? "#f0fdf4"
                              : msg.onchain?.mode === "LIVE_AVALANCHE"
                              ? "#fef3c7"
                              : "#f8fafc",
                            border: `1px solid ${
                              passed
                                ? "#bbf7d0"
                                : msg.onchain?.mode === "LIVE_AVALANCHE"
                                ? "#fde68a"
                                : "#cbd5e1"
                            }`,
                            color: passed
                              ? "#166534"
                              : msg.onchain?.mode === "LIVE_AVALANCHE"
                              ? "#92400e"
                              : "#475569",
                            borderRadius: 10,
                            padding: "9px 12px",
                            fontSize: 12.5,
                            marginBottom: 14,
                            display: "flex",
                            flexDirection: "column",
                            gap: 5
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              flexWrap: "wrap",
                              gap: 8
                            }}
                          >
                            <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                              {passed ? (
                                <>
                                  <CheckCircleIcon size={15} color="#059669" />
                                  <span>Nguồn trích dẫn: Khớp đoạn đối chiếu</span>
                                </>
                              ) : (
                                <>
                                  <UndoIcon size={15} color="#b45309" />
                                  <span>Nguồn trích dẫn: Chưa khớp hoặc chưa đủ điều kiện</span>
                                </>
                              )}
                            </div>

                            {msg.answerStatus && (
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 700,
                                  padding: "2px 8px",
                                  borderRadius: 999,
                                  background:
                                    msg.answerStatus === "NEEDS_CLARIFICATION"
                                      ? "#fef3c7"
                                      : msg.answerStatus === "INSUFFICIENT_EVIDENCE"
                                      ? "#e2e8f0"
                                      : "#e0f2fe",
                                  color:
                                    msg.answerStatus === "NEEDS_CLARIFICATION"
                                      ? "#92400e"
                                      : msg.answerStatus === "INSUFFICIENT_EVIDENCE"
                                      ? "#334155"
                                      : "#075985"
                                }}
                              >
                                {msg.answerStatus === "NEEDS_CLARIFICATION"
                                  ? "Cần bổ sung dữ kiện"
                                  : msg.answerStatus === "INSUFFICIENT_EVIDENCE"
                                  ? "Chưa đủ căn cứ trong kho demo"
                                  : msg.answerStatus === "FACTCHECK"
                                  ? "Kiểm chứng nguyên văn"
                                  : "Đã đối chiếu theo dữ kiện"}
                              </span>
                            )}
                          </div>

                          <div style={{ fontSize: 11.5, color: "#475569", fontWeight: 500 }}>
                            {msg.onchain?.settlementStatus === "RELEASED_TO_TREASURY"
                              ? `Thanh toán: Đã giải ngân phí${
                                  msg.onchain?.fujiSettlementTxHash
                                    ? ` (Tx: ${msg.onchain.fujiSettlementTxHash.slice(0, 12)}...)`
                                    : ""
                                }`
                              : msg.onchain?.settlementStatus === "AUTO_REFUNDED_TO_USER"
                              ? `Thanh toán: Đã hoàn trả khoản tiền tạm giữ${
                                  msg.onchain?.fujiSettlementTxHash
                                    ? ` (Tx: ${msg.onchain.fujiSettlementTxHash.slice(0, 12)}...)`
                                    : ""
                                }`
                              : msg.onchain?.settlementStatus === "PENDING_RECONCILIATION"
                              ? `Thanh toán: Đang giữ cọc / Chờ đối soát trên chuỗi${
                                  msg.onchain?.escrowTxHash
                                    ? ` (Deposit: ${msg.onchain.escrowTxHash.slice(0, 12)}...)`
                                    : ""
                                }`
                              : msg.onchain?.settlementStatus === "SETTLEMENT_BLOCKED_INELIGIBLE"
                              ? "Thanh toán: Chưa mở giải ngân cho demo (đi theo nhánh hoàn cọc nếu có đặt cọc)."
                              : "Thanh toán: Không phát sinh giao dịch đặt cọc (chế độ dùng thử miễn phí)."}
                          </div>

                          <div style={{ fontSize: 11.5, color: "#64748b", fontWeight: 500 }}>
                            {msg.validation.corpus_status === "REVIEW_ASSERTED"
                              ? "Nguồn có ngày đối chiếu · Demo chưa được rà soát chuyên môn, chưa đủ điều kiện giải ngân."
                              : msg.validation.corpus_status === "VERIFIED_CURATED"
                              ? "Đoạn trích đã được đối chiếu nguồn · Xem trạng thái thanh toán riêng."
                              : "Nguồn tách tự động / thử nghiệm (chưa rà soát từng điều) · Chưa mở giải ngân."}
                          </div>

                          {msg.onchain?.settlementStatus === "PENDING_RECONCILIATION" &&
                            msg.questionId &&
                            msg.onchain?.escrowTxHash && (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                                {pendingPaidAttempt &&
                                  pendingPaidAttempt.questionId === msg.questionId && (
                                    <button
                                      type="button"
                                      disabled={Boolean(loadingStep)}
                                      onClick={() => handleRetryPendingAttempt(pendingPaidAttempt)}
                                      style={{
                                        border: "1px solid #cbd5e1",
                                        background: "#ffffff",
                                        color: "#0a1c2e",
                                        borderRadius: 7,
                                        padding: "4px 9px",
                                        fontSize: 11.5,
                                        fontWeight: 600,
                                        cursor: "pointer"
                                      }}
                                    >
                                      Thử đối soát lại (Không trừ cọc mới)
                                    </button>
                                  )}
                                <button
                                  type="button"
                                  disabled={claimingTimeoutId === msg.questionId}
                                  onClick={() =>
                                    handleClaimTimeoutRefund(msg.questionId!, msg.id)
                                  }
                                  style={{
                                    border: "1px solid #f59e0b",
                                    background: "#fffbeb",
                                    color: "#92400e",
                                    borderRadius: 7,
                                    padding: "4px 9px",
                                    fontSize: 11.5,
                                    fontWeight: 600,
                                    cursor: "pointer"
                                  }}
                                >
                                  {claimingTimeoutId === msg.questionId
                                    ? "Đang gửi giao dịch rút cọc..."
                                    : "Rút lại cọc sau timeout (claimTimeoutRefund)"}
                                </button>
                              </div>
                            )}
                        </div>
                      )}

                      {/* Body */}
                      <div className="ai-body-text">{msg.content}</div>

                      {/* Clickable Statutory Citations */}
                      {citations.length > 0 && (
                        <div
                          style={{
                            marginTop: 14,
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 8,
                            alignItems: "center"
                          }}
                        >
                          <span style={{ fontSize: 12.5, color: "#64748b", fontWeight: 600 }}>
                            Căn cứ để đối chiếu:
                          </span>
                          {citations.map((cit, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => handleInspectCitation(msg.id, idx)}
                              className="citation-hl"
                              title="Bấm để mở nguồn luật đối chiếu"
                            >
                              Điều {cit.article}, Khoản {cit.clause}
                              {cit.point ? `, Điểm ${cit.point}` : ""} ({cit.document})
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Bạn muốn làm tiếp điều gì? */}
                      {msg.validation && (
                        <div className="next-steps-box">
                          <div
                            className="section-micro-label"
                            style={{ marginBottom: 8, fontSize: 10.5 }}
                          >
                            Bạn muốn làm tiếp điều gì?
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                            {showSwitchToLookupBtn && (
                              <button
                                type="button"
                                onClick={() => {
                                  setMode("deep");
                                  handleAsk(precedingUserPrompt, "deep");
                                }}
                                className="next-step-btn primary"
                              >
                                Chuyển sang Phân tích tình huống &amp; gửi lại
                              </button>
                            )}
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
                              Tạo bản nháp từ câu trả lời
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
                              Xem cách gửi yêu cầu tư vấn
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
                      Lorx
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

              {/* Error Banner with Retry & Kept Draft */}
              {errorMsg && (
                <div
                  style={{
                    background: "#fff1f2",
                    border: "1px solid #fecdd3",
                    color: "#9f1239",
                    borderRadius: 12,
                    padding: "12px 14px",
                    fontSize: 13.5,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 10
                  }}
                >
                  <span>{errorMsg}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {pendingPaidAttempt ? (
                      <>
                        <button
                          type="button"
                          disabled={Boolean(loadingStep)}
                          onClick={() => handleRetryPendingAttempt(pendingPaidAttempt)}
                          style={{
                            background: "#9f1239",
                            color: "#ffffff",
                            border: "none",
                            borderRadius: 8,
                            padding: "6px 12px",
                            fontSize: 12.5,
                            fontWeight: 600,
                            cursor: "pointer"
                          }}
                        >
                          Thử lại yêu cầu đã đặt cọc (Không trừ cọc mới)
                        </button>
                        <button
                          type="button"
                          disabled={claimingTimeoutId === pendingPaidAttempt.questionId}
                          onClick={() => handleClaimTimeoutRefund(pendingPaidAttempt.questionId)}
                          style={{
                            background: "#fffbeb",
                            color: "#92400e",
                            border: "1px solid #f59e0b",
                            borderRadius: 8,
                            padding: "6px 12px",
                            fontSize: 12.5,
                            fontWeight: 600,
                            cursor: "pointer"
                          }}
                        >
                          {claimingTimeoutId === pendingPaidAttempt.questionId
                            ? "Đang gửi giao dịch..."
                            : "Rút lại cọc sau timeout (claimTimeoutRefund)"}
                        </button>
                      </>
                    ) : (
                      lastFailedPrompt && (
                        <button
                          type="button"
                          onClick={() => handleAsk(lastFailedPrompt)}
                          style={{
                            background: "#9f1239",
                            color: "#ffffff",
                            border: "none",
                            borderRadius: 8,
                            padding: "6px 12px",
                            fontSize: 12.5,
                            fontWeight: 600,
                            cursor: "pointer"
                          }}
                        >
                          Thử lại
                        </button>
                      )
                    )}
                    <button
                      type="button"
                      onClick={() => setErrorMsg("")}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#9f1239",
                        cursor: "pointer",
                        fontWeight: 700,
                        padding: "4px 6px"
                      }}
                      aria-label="Đóng thông báo lỗi"
                    >
                      ✕
                    </button>
                  </div>
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
                      Tra cứu nhanh
                    </button>

                    <button
                      type="button"
                      onClick={() => setMode("deep")}
                      className={`mode-pill ${mode === "deep" ? "active-deep" : ""}`}
                    >
                      <BranchIcon size={13} />
                      Phân tích tình huống
                    </button>

                    <button
                      type="button"
                      onClick={() => setMode("factcheck")}
                      className={`mode-pill ${mode === "factcheck" ? "active-factcheck" : ""}`}
                    >
                      <ShieldCheckIcon size={13} />
                      Kiểm chứng nguồn
                    </button>
                  </div>

                  <span
                    style={{
                      fontSize: 11.5,
                      fontWeight: 600,
                      color:
                        mode === "factcheck"
                          ? "#075985"
                          : useOnchainWallet && account
                          ? "#047857"
                          : !isDemoProfile(currentUser)
                          ? "#b45309"
                          : "#475569",
                      background:
                        mode === "factcheck"
                          ? "#e0f2fe"
                          : useOnchainWallet && account
                          ? "#ecfdf5"
                          : !isDemoProfile(currentUser)
                          ? "#fef3c7"
                          : "#f1f5f9",
                      padding: "3px 9px",
                      borderRadius: 999
                    }}
                  >
                    {mode === "factcheck"
                      ? "Kiểm chứng nguồn · Miễn phí"
                      : !isDemoProfile(currentUser) && !account
                      ? "Cần kết nối ví Core / MetaMask"
                      : !useOnchainWallet || !account
                      ? "Miễn phí trong bản dùng thử"
                      : nextIsFree
                      ? "Miễn phí lượt thứ 10 (10 tặng 1)"
                      : paymentAsset === "USDC"
                      ? `Tạm giữ ${mode === "deep" ? "0.20" : "0.05"} USDC (Fuji)`
                      : `Tạm giữ ${mode === "deep" ? "0.02" : "0.005"} AVAX testnet`}
                  </span>
                </div>

                {/* 1-line description for active mode */}
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8, padding: "0 4px" }}>
                  {mode === "quick"
                    ? "Một vấn đề cụ thể, câu trả lời ngắn gọn kèm căn cứ."
                    : mode === "deep"
                    ? "Xem các điều kiện áp dụng, ngoại lệ và thông tin còn thiếu."
                    : "Kiểm tra số hiệu văn bản, Điều/Khoản hoặc đoạn trích cụ thể mà bạn nhập vào."}
                </div>

                {/* Rounded Prompt Input Card */}
                <div className="composer-box">
                  <textarea
                    ref={textareaRef}
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
                        ? "Ví dụ: Kiểm chứng Điều 25 Khoản 1 Luật 54/2014/QH13: Đối với hàng hóa nhập khẩu, nộp trong thời hạn 60 ngày..."
                        : "Nhập câu hỏi về thủ tục hải quan, xuất xứ C/O hoặc thuế xuất nhập khẩu..."
                    }
                    className="composer-textarea custom-scrollbar"
                  />

                  <div className="composer-toolbar">
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() => setShowDocsModal(true)}
                        className="icon-btn"
                        title="Mở thư viện văn bản pháp luật"
                      >
                        <PaperclipIcon size={16} />
                      </button>
                      {useOnchainWallet && account ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5 }}>
                          <span style={{ color: "#047857", fontWeight: 600 }}>
                            Ví {account.slice(0, 6)}...{account.slice(-4)}
                          </span>
                          <select
                            value={paymentAsset}
                            onChange={(e) => setPaymentAsset(e.target.value as "USDC" | "AVAX")}
                            aria-label="Chọn loại tiền thanh toán"
                            style={{
                              fontSize: 11.5,
                              padding: "2px 6px",
                              borderRadius: 6,
                              border: "1px solid #cbd5e1",
                              background: "#f8fafc",
                              color: "#0a1c2e"
                            }}
                          >
                            <option value="USDC">USDC (Fuji)</option>
                            <option value="AVAX" disabled>
                              AVAX testnet (Tạm khóa — chỉ nhận USDC proof v2)
                            </option>
                          </select>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={async () => {
                            if (!isDemoProfile(currentUser)) {
                              const connected = await connectWallet();
                              if (!connected) setShowSettingsModal(true);
                            } else {
                              setShowSettingsModal(true);
                            }
                          }}
                          className="link-subtle"
                          style={{
                            fontSize: 11.5,
                            color: !isDemoProfile(currentUser) ? "#b45309" : "#64748b",
                            fontWeight: !isDemoProfile(currentUser) ? 600 : 400
                          }}
                        >
                          {!isDemoProfile(currentUser)
                            ? "Kết nối ví Fuji (USDC / AVAX) để tiếp tục"
                            : "Bật thanh toán ví Fuji (USDC / AVAX)"}
                        </button>
                      )}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 11.5, color: "#94a3b8" }}>Enter để gửi</span>
                      <button
                        type="button"
                        disabled={Boolean(loadingStep)}
                        onClick={() => handleAsk()}
                        className="btn-send"
                      >
                        {loadingStep ? "Đang tìm..." : "Gửi"}
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
                Với mỗi <strong>10 câu hỏi</strong> thực hiện trên Lorx, hệ thống tự động tặng bạn{" "}
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
                Hồ sơ Tài khoản Lorx
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
                      Số dư Testnet: {avaxBalance || "..."} AVAX • {usdcBalance || "0.00"} USDC
                    </div>
                    {usdcBalance === "0.00" && (
                      <div style={{ marginTop: 6, fontSize: 12, color: "#b45309", lineHeight: 1.45 }}>
                        Ví hiện chưa có USDC Fuji. Luồng trả phí v2 hiện chỉ xác minh cọc{" "}
                        <strong>USDC (Fuji)</strong>; bạn có thể nạp thêm USDC testnet hoặc chuyển sang{" "}
                        <strong>Dùng thử demo miễn phí</strong>.
                      </div>
                    )}
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

                {isDemoProfile(currentUser) ? (
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
                    <span>Bật thanh toán ví Web3 trong bản dùng thử</span>
                  </label>
                ) : (
                  <div
                    style={{
                      marginTop: 10,
                      paddingTop: 10,
                      borderTop: "1px dashed #cbd5e1",
                      display: "flex",
                      flexDirection: "column",
                      gap: 8
                    }}
                  >
                    <div style={{ fontSize: 12, color: "#334155", lineHeight: 1.5 }}>
                      Luồng <strong>Tài khoản đã đăng nhập</strong> mặc định tạm giữ cọc qua ví Web3 (chỉ giải ngân khi trích dẫn đạt chuẩn, sai tự hoàn tiền).
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowSettingsModal(false);
                        handleQuickDemoLogin("user");
                      }}
                      style={{
                        alignSelf: "flex-start",
                        border: "1px solid #cbd5e1",
                        background: "#ffffff",
                        color: "#285380",
                        borderRadius: 8,
                        padding: "6px 11px",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer"
                      }}
                    >
                      Chuyển sang Dùng thử demo miễn phí
                    </button>
                  </div>
                )}
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
