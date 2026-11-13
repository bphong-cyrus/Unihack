import React from "react";
import "./globals.css";

export const metadata = {
  title: "Trợ Lý Pháp Luật Hải Quan & XNK — Tra cứu chính xác theo quy định hiện hành",
  description:
    "Tra cứu thủ tục hải quan, mã HS, C/O và thuế XNK chính xác theo văn bản pháp luật hiện hành."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
