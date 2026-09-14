import { env } from "./env";

/** 크론/폴링 엔드포인트 인증: Authorization: Bearer CRON_SECRET 또는 ?secret= */
export function cronAuthorized(req: Request): boolean {
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${env.cronSecret}`) return true;
  const url = new URL(req.url);
  return url.searchParams.get("secret") === env.cronSecret;
}

export const AUTH_COOKIE = "tg_token";

/** 사이트 쓰기 작업 인증: 폼/JSON 의 token 또는 쿠키 */
export function siteAuthorized(token: string | null | undefined, req: Request): boolean {
  if (token && token === env.registerToken) return true;
  return cookieToken(req.headers.get("cookie")) === env.registerToken;
}

export function cookieToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === AUTH_COOKIE) return decodeURIComponent(v.join("="));
  }
  return null;
}

/** 인증 성공 시 7일짜리 쿠키 저장 */
export function authCookieHeader(req: Request): string {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `${AUTH_COOKIE}=${encodeURIComponent(env.registerToken)}; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax${secure}`;
}

/** 303 리다이렉트 + (인증 성공 시) 쿠키 설정 */
export function redirectWithAuth(req: Request, path: string, setCookie: boolean): Response {
  const headers = new Headers({ Location: new URL(path, req.url).toString() });
  if (setCookie) headers.append("Set-Cookie", authCookieHeader(req));
  return new Response(null, { status: 303, headers });
}
