import { authCookieHeader, passwordValid } from "@/lib/auth";

export const dynamic = "force-dynamic";

function redirect(req: Request, path: string, cookie?: string): Response {
  const headers = new Headers({ Location: new URL(path, req.url).toString() });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

/** 같은 사이트의 절대경로만 허용 (열린 리다이렉트 방지) */
function safeNext(value: FormDataEntryValue | null): string {
  const s = typeof value === "string" ? value : "";
  return /^\/(?!\/)/.test(s) ? s : "/";
}

/** 로그인 */
export async function POST(req: Request) {
  const form = await req.formData();
  const token = form.get("token");
  const next = safeNext(form.get("next"));

  if (typeof token !== "string" || token.length === 0) {
    return redirect(req, `/login?error=missing&next=${encodeURIComponent(next)}`);
  }
  if (!passwordValid(token)) {
    return redirect(req, `/login?error=token&next=${encodeURIComponent(next)}`);
  }
  return redirect(req, next, await authCookieHeader(req));
}
