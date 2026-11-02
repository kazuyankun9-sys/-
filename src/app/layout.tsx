import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "サイトカルテAI｜URLを入れるだけのホームページ診断と営業メモ",
  description:
    "見込み客のホームページのURLを入れるだけで、スマホ対応・検索対策・問い合わせ導線を自動で診断。社長に渡せる改善レポートと、商談で使える営業メモをAIが作ります。",
  openGraph: {
    title: "サイトカルテAI",
    description: "URLを入れるだけで、ホームページの診断レポートと営業メモを30秒で。",
    type: "website",
    locale: "ja_JP",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#141b28" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
