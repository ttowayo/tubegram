export const dynamic = "force-dynamic";
export const metadata = { title: "로그인" };

const ERRORS: Record<string, string> = {
  token: "암호가 올바르지 않습니다.",
  missing: "암호를 입력해 주세요.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? (ERRORS[sp.error] ?? "로그인하지 못했습니다.") : undefined;
  // 열린 리다이렉트를 막기 위해 같은 사이트의 절대경로만 허용한다
  const next = typeof sp.next === "string" && /^\/(?!\/)/.test(sp.next) ? sp.next : "/";

  return (
    <div className="login">
      <div className="panel login-card">
        <div className="login-brand">
          <span className="brand-mark" aria-hidden="true">▶</span>tubegram
        </div>
        <p className="login-lead">요약을 보려면 암호를 입력하세요.</p>

        {error && <p className="error login-error">{error}</p>}

        <form className="register" method="post" action="/api/login">
          <input type="hidden" name="next" value={next} />
          <label>
            암호
            <input
              name="token"
              type="password"
              autoComplete="current-password"
              required
              autoFocus
            />
          </label>
          <button type="submit">로그인</button>
        </form>
      </div>
    </div>
  );
}
