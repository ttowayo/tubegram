import Link from "next/link";
import { kstDate } from "@/lib/date";
import { subscribedChannelsAll } from "@/lib/today";

export const dynamic = "force-dynamic";
export const metadata = { title: "오늘 영상 요약" };

const ERRORS: Record<string, string> = {
  token: "등록 토큰이 올바르지 않습니다.",
  nochannel: "구독 중인 채널이 없습니다. 텔레그램 봇에서 /subscribe 로 먼저 추가하세요.",
};

export default async function TodayPage({ searchParams }: PageProps<"/today">) {
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const error = str("error") ? ERRORS[str("error")!] ?? "오류가 발생했습니다." : undefined;
  const found = str("found") !== undefined ? Number(str("found")) : null;
  const queued = Number(str("queued") ?? 0);
  const already = Number(str("already") ?? 0);
  const errors = Number(str("errors") ?? 0);
  const channels = await subscribedChannelsAll();
  const today = kstDate();

  return (
    <>
      <nav className="back-bar">
        <Link href="/">‹ 오늘의 요약</Link>
        <Link href="/c">채널 목록</Link>
      </nav>
      <h1>오늘 올라온 영상 요약</h1>
      <p className="muted">
        구독 채널에서 오늘({today}) 올라온 영상을 모두 찾아 요약합니다. 이미 요약된 영상은 다시 처리하지 않고,
        완료된 요약은 오너 텔레그램으로도 전송됩니다.
      </p>

      {error && <p className="error">{error}</p>}

      {found !== null && !error && (
        <div className="notice">
          {found === 0 ? (
            <p>오늘 올라온 영상이 없습니다.</p>
          ) : (
            <>
              <p>
                오늘 올라온 영상 <b>{found}편</b>을 찾았습니다.
                새로 접수 <b>{queued}편</b>{already > 0 && <>, 이미 요약된 {already}편</>}
                {errors > 0 && <>, 피드를 읽지 못한 채널 {errors}개</>}.
              </p>
              {queued > 0 && <p className="muted">요약은 보통 편당 10초~1분 걸립니다. 잠시 후 오늘의 요약 페이지를 새로고침해 주세요.</p>}
              <p><Link href="/">오늘의 요약 보기 →</Link></p>
            </>
          )}
        </div>
      )}

      {channels.length === 0 ? (
        <div className="empty">구독 중인 채널이 없습니다. 텔레그램 봇에서 /subscribe 로 추가하세요.</div>
      ) : (
        <form className="register" method="post" action="/api/today">
          <label>
            대상 채널
            <select name="channel" defaultValue="">
              <option value="">구독 채널 전체 ({channels.length}개)</option>
              {channels.map((c) => (
                <option key={c.channel_id} value={c.channel_id}>{c.title}</option>
              ))}
            </select>
          </label>
          <label>
            등록 토큰
            <input name="token" type="password" placeholder="REGISTER_TOKEN" required />
          </label>
          <button type="submit">오늘 영상 요약 실행</button>
        </form>
      )}
    </>
  );
}
