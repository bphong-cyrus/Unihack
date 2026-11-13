import fs from "fs";
import path from "path";
import solc from "solc";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { avalancheFuji } from "viem/chains";

// Đọc biến môi trường từ .env.local nếu có
function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}

function saveEnvVar(key, value) {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  let content = fs.readFileSync(envPath, "utf8");
  const regex = new RegExp(`^${key}=.*$`, "m");
  if (regex.test(content)) {
    content = content.replace(regex, `${key}="${value}"`);
  } else {
    content += `\n${key}="${value}"\n`;
  }
  fs.writeFileSync(envPath, content, "utf8");
  process.env[key] = value;
}

function compileContracts() {
  const escrowSource = fs.readFileSync(path.resolve("contracts/AskPayEscrow.sol"), "utf8");
  const receiptSource = fs.readFileSync(path.resolve("contracts/AskPayReceiptLog.sol"), "utf8");

  const input = {
    language: "Solidity",
    sources: {
      "AskPayEscrow.sol": { content: escrowSource },
      "AskPayReceiptLog.sol": { content: receiptSource }
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"]
        }
      }
    }
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  if (output.errors) {
    const fatalErrors = output.errors.filter((e) => e.severity === "error");
    for (const err of output.errors) {
      console.log(err.formattedMessage);
    }
    if (fatalErrors.length > 0) {
      process.exit(1);
    }
  }

  const artifactsDir = path.resolve("contracts/artifacts");
  fs.mkdirSync(artifactsDir, { recursive: true });

  const escrowContract = output.contracts["AskPayEscrow.sol"]["AskPayEscrow"];
  const receiptContract = output.contracts["AskPayReceiptLog.sol"]["AskPayReceiptLog"];

  const escrowArtifact = {
    contractName: "AskPayEscrow",
    abi: escrowContract.abi,
    bytecode: `0x${escrowContract.evm.bytecode.object}`
  };

  const receiptArtifact = {
    contractName: "AskPayReceiptLog",
    abi: receiptContract.abi,
    bytecode: `0x${receiptContract.evm.bytecode.object}`
  };

  fs.writeFileSync(
    path.join(artifactsDir, "AskPayEscrow.json"),
    JSON.stringify(escrowArtifact, null, 2)
  );
  fs.writeFileSync(
    path.join(artifactsDir, "AskPayReceiptLog.json"),
    JSON.stringify(receiptArtifact, null, 2)
  );

  console.log("✅ Đã biên dịch thành công 2 Smart Contracts vào contracts/artifacts/!");
  return { escrowArtifact, receiptArtifact };
}

async function main() {
  loadEnvLocal();
  const { escrowArtifact, receiptArtifact } = compileContracts();

  if (process.argv.includes("--compile-only")) {
    return;
  }

  const pk = process.env.ORACLE_PRIVATE_KEY;
  if (!pk || pk === "0x_DÁN_PRIVATE_KEY_VÍ_SERVER_CỦA_BẠN_VÀO_ĐÂY") {
    console.log(
      "\n⚠️ Chưa cấu hình ORACLE_PRIVATE_KEY trong file .env.local nên chỉ biên dịch (Compile)."
    );
    console.log(
      "👉 Hãy dán Private Key ví Server (đã xin AVAX tại team1vn.xyz/faucet.html) vào .env.local rồi chạy lại: npm run deploy:contracts"
    );
    return;
  }

  const formattedPk = pk.startsWith("0x") ? pk : `0x${pk}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(formattedPk)) {
    console.error(
      "\n❌ ORACLE_PRIVATE_KEY trong .env.local không hợp lệ (có vẻ bạn đang dán Địa chỉ ví 42 ký tự thay vì Private Key 66 ký tự)."
    );
    console.error(
      "👉 Hãy mở Core Wallet -> Show/Export Private Key (chuỗi 64 ký tự hex) và dán lại vào ORACLE_PRIVATE_KEY trong .env.local."
    );
    process.exit(1);
  }
  const account = privateKeyToAccount(formattedPk);
  const fujiRpc =
    process.env.NEXT_PUBLIC_FUJI_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc";

  console.log(`\n🚀 Đang dùng ví Deployer/Oracle: ${account.address}`);

  let escrowAddress = process.env.NEXT_PUBLIC_ESCROW_ADDRESS || "";
  if (!escrowAddress || process.argv.includes("--force")) {
    console.log(`🌐 Đang deploy AskPayEscrow lên Avalanche Fuji C-Chain (${fujiRpc})...`);

    const fujiPublic = createPublicClient({ chain: avalancheFuji, transport: http(fujiRpc) });
    const fujiWallet = createWalletClient({
      account,
      chain: avalancheFuji,
      transport: http(fujiRpc)
    });

    const escrowTxHash = await fujiWallet.deployContract({
      abi: escrowArtifact.abi,
      bytecode: escrowArtifact.bytecode,
      args: [account.address, account.address] // (_aiOracle, _treasury)
    });

    const escrowReceipt = await fujiPublic.waitForTransactionReceipt({ hash: escrowTxHash });
    escrowAddress = escrowReceipt.contractAddress;
    saveEnvVar("NEXT_PUBLIC_ESCROW_ADDRESS", escrowAddress);
    console.log(`✅ AskPayEscrow deployed tại: ${escrowAddress} (đã lưu vào .env.local)`);
  } else {
    console.log(`✅ AskPayEscrow đã tồn tại tại: ${escrowAddress} (bỏ qua deploy lại)`);
  }

  const l1Rpc = process.env.ASKPAY_L1_RPC_URL || fujiRpc;
  const l1ChainId = Number(process.env.ASKPAY_L1_CHAIN_ID || 43113);

  const l1Chain = defineChain({
    id: l1ChainId,
    name: "AskPay Audit L1",
    nativeCurrency: { name: "ASK", symbol: "ASK", decimals: 18 },
    rpcUrls: { default: { http: [l1Rpc] } }
  });

  let receiptAddress = process.env.NEXT_PUBLIC_RECEIPT_LOG_ADDRESS || "";
  if (!receiptAddress || process.argv.includes("--force")) {
    const l1Public = createPublicClient({ chain: l1Chain, transport: http(l1Rpc) });
    const l1Balance = await l1Public.getBalance({ address: account.address });
    if (l1Balance === 0n) {
      console.log(
        `\n⏳ Ví Server (${account.address}) đang có 0 ASK trên L1 (Chain ID ${l1ChainId}).`
      );
      console.log(
        "👉 Hãy gửi 100 ASK từ tiện ích Core Wallet (bấm trực tiếp vào token ASK -> Send) sang địa chỉ trên rồi chạy lại: npm run deploy:contracts"
      );
      return;
    }

    console.log(`\n🌐 Đang deploy AskPayReceiptLog lên L1 (Chain ID ${l1ChainId} - ${l1Rpc})...`);
    const l1Wallet = createWalletClient({ account, chain: l1Chain, transport: http(l1Rpc) });

    const receiptTxHash = await l1Wallet.deployContract({
      abi: receiptArtifact.abi,
      bytecode: receiptArtifact.bytecode,
      args: [account.address] // (_oracleWriter)
    });

    const receiptDeployReceipt = await l1Public.waitForTransactionReceipt({ hash: receiptTxHash });
    receiptAddress = receiptDeployReceipt.contractAddress;
    saveEnvVar("NEXT_PUBLIC_RECEIPT_LOG_ADDRESS", receiptAddress);
    console.log(`✅ AskPayReceiptLog deployed tại: ${receiptAddress} (đã lưu vào .env.local)`);
  } else {
    console.log(`✅ AskPayReceiptLog đã tồn tại tại: ${receiptAddress}`);
  }

  console.log("\n=======================================================");
  console.log("🎉 HOÀN TẤT DEPLOY! CẤU HÌNH TRONG .env.local:");
  console.log(`NEXT_PUBLIC_ESCROW_ADDRESS="${escrowAddress}"`);
  console.log(`NEXT_PUBLIC_RECEIPT_LOG_ADDRESS="${receiptAddress}"`);
  console.log("=======================================================\n");
}

main().catch((err) => {
  console.error("❌ Lỗi:", err.message || err);
  process.exit(1);
});
