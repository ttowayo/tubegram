import { clearCookieHeader } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** 로그아웃: 쿠키를 지우고 로그인 화면으로 (폼 POST 로 호출) */
export async function POST(req: Request) {
  const headers = new Headers({ Location: new URL("/login", req.url).toString() });
  headers.append("Set-Cookie", clearCookieHeader(req));
  return new Response(null, { status: 303, headers });
}
