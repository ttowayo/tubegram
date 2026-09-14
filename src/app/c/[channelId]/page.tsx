import Link from "next/link";
import { notFound } from "next/navigation";
import { getChannel, listVideosByChannel } from "@/lib/queries";
import { SummaryCard } from "@/components/SummaryCard";
import { formatKst } from "@/lib/date";

export const dynamic = "force-dynamic";

export default async function ChannelPage({ params }: PageProps<"/c/[channelId]">) {
  const { channelId } = await params;
  const channel = await getChannel(channelId);
  if (!channel) notFound();
  const videos = await listVideosByChannel(channelId);

  return (
    <>
      <nav className="back-bar">
        <Link href="/c">‹ 채널 목록</Link>
        <Link href="/">오늘의 요약</Link>
      </nav>
      <h1>{channel.title}</h1>
      <p className="muted">
        {channel.handle && <>{channel.handle} · </>}
        <a href={`https://www.youtube.com/channel/${channel.channel_id}`} target="_blank" rel="noreferrer">유튜브에서 보기</a>
        {" · "}구독 시작 {formatKst(channel.created_at, false)}
      </p>
      {videos.length === 0 ? (
        <div className="empty">아직 요약된 영상이 없습니다. 구독 이후 올라오는 새 영상부터 요약됩니다.</div>
      ) : (
        <div className="card-list">
          {videos.map((v) => (
            <SummaryCard key={v.id} video={v} content={v.summaries?.content ?? null} backTo={`/c/${channelId}`} />
          ))}
        </div>
      )}
    </>
  );
}
