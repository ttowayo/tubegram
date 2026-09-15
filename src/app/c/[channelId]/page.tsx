import Link from "next/link";
import { notFound } from "next/navigation";
import { getChannel, listVideosByChannel } from "@/lib/queries";
import { SummaryCard } from "@/components/SummaryCard";
import { formatKst } from "@/lib/date";

export const dynamic = "force-dynamic";

/** 한 번에 보여줄 영상 수. 이보다 많으면 안내를 띄운다 */
const LIMIT = 100;

export default async function ChannelPage({ params }: PageProps<"/c/[channelId]">) {
  const { channelId } = await params;
  const channel = await getChannel(channelId);
  if (!channel) notFound();
  const videos = await listVideosByChannel(channelId, LIMIT);

  return (
    <div className="narrow">
      <nav className="back-bar">
        <Link href="/c">‹ 채널 목록</Link>
        <Link href="/">오늘의 요약</Link>
      </nav>
      <h1>{channel.title}</h1>
      <p className="muted">
        {channel.handle && <>{channel.handle} · </>}
        <a href={`https://www.youtube.com/channel/${channel.channel_id}`} target="_blank" rel="noreferrer">유튜브에서 보기</a>
        {" · "}구독 시작 {formatKst(channel.created_at, false)}
        {videos.length > 0 && <> · {videos.length}편</>}
      </p>
      {videos.length === 0 ? (
        <div className="empty">
          <p className="empty-title">아직 요약된 영상이 없습니다.</p>
          <p className="empty-hint">구독 이후 올라오는 새 영상부터 요약됩니다.</p>
        </div>
      ) : (
        <>
          <div className="card-list">
            {videos.map((v) => (
              <SummaryCard
                key={v.id}
                video={v}
                content={v.summaries?.content ?? null}
                backTo={`/c/${channelId}`}
                hideChannel
              />
            ))}
          </div>
          {videos.length === LIMIT && (
            <p className="muted list-note">최근 {LIMIT}편만 표시합니다. 더 이전 영상은 날짜별 목록에서 볼 수 있습니다.</p>
          )}
        </>
      )}
    </div>
  );
}
