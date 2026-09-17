import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "De Stijl Studio | 生成式構圖實驗",
  description: "以格線、色彩配額與可重現亂數探索風格派的生成式設計工具。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-Hant"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
