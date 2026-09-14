import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "tubegram", template: "%s · tubegram" },
  description: "구독 채널의 새 유튜브 영상을 요약해서 텔레그램으로 보내고, 일자별로 모아 보는 사이트",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko">
      <body>
        <header className="site-header">
          <div className="container header-inner">
            <Link href="/" className="brand">▶ tubegram</Link>
            <nav>
              <Link href="/">오늘</Link>
              <Link href="/c">채널</Link>
              <Link href="/today">오늘 영상</Link>
              <Link href="/register">등록</Link>
            </nav>
          </div>
        </header>
        <main className="container">{children}</main>
        <footer className="container site-footer">유튜브 영상 요약 · 텔레그램 알림</footer>
      </body>
    </html>
  );
}
