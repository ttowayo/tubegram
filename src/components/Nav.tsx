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
    </nav>
  );
}
