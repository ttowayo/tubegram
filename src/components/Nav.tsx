"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "오늘" },
  { href: "/c", label: "채널" },
  { href: "/today", label: "오늘 영상" },
  { href: "/register", label: "등록" },
];

/** 현재 경로에 해당하는 항목을 표시하는 헤더 내비게이션 */
export function Nav() {
  const pathname = usePathname();

  // 로그인 화면에서는 갈 곳도 나갈 것도 없다
  if (pathname === "/login") return null;

  return (
    <nav>
      {LINKS.map(({ href, label }) => {
        const active = href === "/"
          ? pathname === "/" || pathname.startsWith("/d/")
          : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined}>
            {label}
          </Link>
        );
      })}
      <form method="post" action="/api/logout" className="logout-form">
        <button type="submit" className="logout-btn">로그아웃</button>
      </form>
    </nav>
  );
}
