import Link from "next/link";
import { listChannels } from "@/lib/queries";
import { formatKst } from "@/lib/date";

export const dynamic = "force-dynamic";
export const metadata = { title: "채널" };

export default async function ChannelsPage() {
  const channels = await listChannels();
  return (
    <>
      <h1>구독 채널</h1>
      <p className="muted">텔레그램 봇에서 /subscribe 로 추가합니다.</p>
      {channels.length === 0 ? (
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
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.channel_id}>
                  <td>
                    <Link href={`/c/${c.channel_id}`}>{c.title}</Link>
                    {c.handle && <span className="muted"> {c.handle}</span>}
                  </td>
                  <td>{c.videoCount}</td>
                  <td>{c.subscribers}</td>
                  <td className="muted">{formatKst(c.last_checked_at) || "-"}</td>
                  <td>{c.is_active ? "활성" : "비활성"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
