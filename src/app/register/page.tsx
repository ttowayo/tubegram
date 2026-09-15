import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { AUTH_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "영상 등록" };

const ERRORS: Record<string, string> = {
  token: "등록 토큰이 올바르지 않습니다.",
  url: "유튜브 URL 을 인식하지 못했습니다.",
};

export default async function RegisterPage({ searchParams }: PageProps<"/register">) {
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? ERRORS[sp.error] : undefined;
  const authed = (await cookies()).get(AUTH_COOKIE)?.value === env.registerToken;

  return (
    <div className="narrow">
        <h1>영상 등록</h1>
        <p className="muted">유튜브 URL 을 등록하면 요약해서 저장하고, 오너 텔레그램으로 전송합니다.</p>
        {error && <p className="error">{error}</p>}
        <form className="register" method="post" action="/api/videos">
          <label>
            유튜브 URL
            <input name="url" type="url" placeholder="https://www.youtube.com/watch?v=..." required autoFocus />
          </label>
          {!authed && (
            <label>
              등록 토큰
              <input name="token" type="password" placeholder="REGISTER_TOKEN" required />
            </label>
          )}
          <button type="submit">요약 요청</button>
        </form>
    </div>
  );
}
