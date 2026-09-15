import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, sessionValid } from "@/lib/auth";

/** 로그인 없이 접근할 수 있는 경로 */
const PUBLIC = ["/login"];

/**
 * 로그인하지 않은 방문자를 /login 으로 보낸다.
 *
 * /api 는 제외한다. 크론·텔레그램 웹훅·WebSub 는 각자 시크릿으로 인증하고,
 * 사이트 쓰기 API(/api/channels, /api/videos, /api/today)는 siteAuthorized 로
 * 요청마다 따로 검사하므로 여기서 막지 않아도 통과되지 않는다.
 */
export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  if (await sessionValid(req.cookies.get(AUTH_COOKIE)?.value)) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  // 로그인 후 원래 보려던 곳으로 돌려보내기 위해 경로를 남긴다
  if (pathname !== "/") url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    /*
     * 아래를 제외한 모든 경로:
     * - api        (자체 시크릿으로 인증)
     * - _next      (빌드 산출물)
     * - 정적 파일  (favicon 등 확장자가 있는 것)
     */
    "/((?!api/|_next/|.*\\.[\\w]+$).*)",
  ],
};
