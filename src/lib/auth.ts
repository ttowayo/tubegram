import { env } from "./env";

/** 크론/폴링 엔드포인트 인증: Authorization: Bearer CRON_SECRET 또는 ?secret= */
export function cronAuthorized(req: Request): boolean {
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${env.cronSecret}`) return true;
  const url = new URL(req.url);
  return url.searchParams.get("secret") === env.cronSecret;
}

export const AUTH_COOKIE = "tg_token";
/** 로그인 유지 기간 (7일) */
const MAX_AGE = 604800;

/** 길이가 같을 때 비교 시간이 값에 의존하지 않도록 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 입력한 암호가 REGISTER_TOKEN 과 맞는지 */
export function passwordValid(input: string | null | undefined): boolean {
  return !!input && safeEqual(input, env.registerToken);
}

/**
 * 쿠키에 담을 값. 원문 토큰 대신 해시를 저장해, 쿠키가 어딘가에 기록되더라도
 * REGISTER_TOKEN 자체는 새어 나가지 않는다.
 * Web Crypto 만 사용하므로 proxy(Edge)와 서버 양쪽에서 동작한다.
 */
export async function sessionValue(): Promise<string> {
  const bytes = new TextEncoder().encode(`tubegram:v1:${env.registerToken}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 세션 쿠키 값이 유효한지 */
export async function sessionValid(value: string | null | undefined): Promise<boolean> {
  return !!value && safeEqual(value, await sessionValue());
}

export function cookieToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === AUTH_COOKIE) return decodeURIComponent(v.join("="));
  }
  return null;
}

/** 사이트 쓰기 작업 인증: 폼/JSON 의 token 또는 로그인 쿠키 */
export async function siteAuthorized(token: string | null | undefined, req: Request): Promise<boolean> {
  if (passwordValid(token)) return true;
  return sessionValid(cookieToken(req.headers.get("cookie")));
}

function secureFlag(req: Request): string {
  return new URL(req.url).protocol === "https:" ? "; Secure" : "";
}

/** 로그인 성공 시 심을 쿠키 */
export async function authCookieHeader(req: Request): Promise<string> {
  const value = await sessionValue();
  return `${AUTH_COOKIE}=${value}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; SameSite=Lax${secureFlag(req)}`;
}

/** 로그아웃: 쿠키 즉시 만료 */
export function clearCookieHeader(req: Request): string {
  return `${AUTH_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secureFlag(req)}`;
}

/** 303 리다이렉트 + (인증 성공 시) 쿠키 설정 */
export async function redirectWithAuth(req: Request, path: string, setCookie: boolean): Promise<Response> {
  const headers = new Headers({ Location: new URL(path, req.url).toString() });
  if (setCookie) headers.append("Set-Cookie", await authCookieHeader(req));
  return new Response(null, { status: 303, headers });
}
