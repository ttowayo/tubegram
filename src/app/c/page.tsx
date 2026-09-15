import Link from "next/link";
import { listChannels } from "@/lib/queries";
import { formatKst } from "@/lib/date";

export const dynamic = "force-dynamic";
export const metadata = { title: "채널" };

const ERRORS: Record<string, string> = {
  token: "등록 토큰이 올바르지 않습니다.",
  owner: "서버에 오너 chat_id 가 설정되어 있지 않습니다.",
  notfound: "채널을 찾지 못했습니다.",
  server: "처리 중 오류가 발생했습니다.",
};

export default async function ChannelsPage({ searchParams }: PageProps<"/c">) {
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const channels = await listChannels();
  const active = channels.filter((c) => c.is_active);
  const inactive = channels.filter((c) => !c.is_active);

  const error = str("error") ? `${ERRORS[str("error")!] ?? "오류"}${str("msg") ? ` (${str("msg")})` : ""}` : undefined;
  const ok = str("ok");
  const title = str("title");

  return (
    <>
      <h1>구독 채널</h1>
      <p className="muted">여기서 추가한 채널의 새 영상은 오너 텔레그램으로 전송됩니다. 텔레그램 봇의 /subscribe 와 동일합니다.</p>

      {error && <p className="error">{error}</p>}
      {ok === "subscribed" && (
        <div className="notice">
          <p>✅ <b>{title}</b> 구독을 시작했습니다. 이후 올라오는 새 영상부터 요약합니다.{str("push") === "0" && " (15분 주기 확인)"}</p>
        </div>
      )}
      {ok === "unsubscribed" && (
        <div className="notice"><p>🗑 <b>{title}</b> 구독을 해지했습니다.</p></div>
      )}

      <form className="register inline" method="post" action="/api/channels">
        <input type="hidden" name="action" value="subscribe" />
        <label>
          채널 추가
          <input name="input" type="text" placeholder="@핸들, 채널 URL, 또는 그 채널 영상 URL" required />
        </label>
        <button type="submit">구독</button>
      </form>

      {active.length === 0 ? (
        <div className="empty">아직 구독 중인 채널이 없습니다.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>채널</th>
                <th>요약</th>
                <th>구독자</th>
                <th>마지막 확인</th>
                <th>실시간</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {active.map((c) => (
                <tr key={c.channel_id}>
                  <td>
                    <Link href={`/c/${c.channel_id}`}>{c.title}</Link>
                    {c.handle && <span className="muted"> {c.handle}</span>}
                  </td>
                  <td>{c.videoCount}</td>
                  <td>{c.subscribers}</td>
                  <td className="muted">{formatKst(c.last_checked_at) || "-"}</td>
                  <td className="muted">{c.websub_lease_expires_at && Date.parse(c.websub_lease_expires_at) > Date.now() ? "푸시" : "폴링"}</td>
                  <td>
                    <form method="post" action="/api/channels" className="inline-form">
                      <input type="hidden" name="action" value="unsubscribe" />
                      <input type="hidden" name="channel_id" value={c.channel_id} />
                      <button type="submit" className="btn-small">해지</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {inactive.length > 0 && (
        <>
          <h2>해지된 채널</h2>
          <p className="muted">이력은 남아 있습니다. 다시 구독하면 그 시점부터 새 영상을 요약합니다.</p>
          <div className="chip-row">
            {inactive.map((c) => (
              <Link key={c.channel_id} href={`/c/${c.channel_id}`} className="chip">{c.title} ({c.videoCount})</Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}
