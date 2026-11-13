import React from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter"
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono"
});

export const metadata = {
  title: "AskPay XNK — Trợ lý Pháp luật Hải quan & Xuất Nhập Khẩu On-chain",
  description:
    "Tra cứu pháp luật Hải quan, mã HS, C/O và thuế XNK theo mô hình Pay-per-Answer bảo chứng bằng Smart Contract Escrow trên Avalanche."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
