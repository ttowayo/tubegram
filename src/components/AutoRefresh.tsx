"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

interface Props {
  /** 다시 확인하는 간격(ms) */
  intervalMs?: number;
}

/**
 * 요약이 끝날 때까지 서버 컴포넌트만 주기적으로 다시 받아온다.
 * router.refresh() 는 스크롤 위치와 클라이언트 상태를 유지한 채 교체하므로
 * meta refresh 처럼 화면이 깜빡이거나 스크롤이 맨 위로 튀지 않는다.
 * 요약이 끝나면 서버가 이 컴포넌트를 더는 렌더링하지 않으므로 폴링도 같이 멈춘다.
 */
export function AutoRefresh({ intervalMs = 15_000 }: Props) {
  const router = useRouter();

  useEffect(() => {
    // 배경 탭에서는 요청하지 않고, 탭으로 돌아오면 즉시 한 번 확인한다
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, intervalMs]);

  return null;
}
