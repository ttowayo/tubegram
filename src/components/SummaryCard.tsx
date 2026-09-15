import Link from "next/link";
import type { SummaryContent, VideoRow } from "@/lib/supabase";
import { formatDuration, formatKst } from "@/lib/date";

const STATUS_LABEL: Record<string, string> = {
  pending: "대기 중",
  processing: "요약 중",
  failed: "실패",
  skipped: "건너뜀",
};

interface Props {
  video: VideoRow;
  content: SummaryContent | null;
  /** 상세 페이지에서 "목록으로" 가 돌아갈 경로 */
  backTo?: string;
  /** 채널명을 감출지 (채널별로 묶인 목록에서는 중복이라 숨김) */
  hideChannel?: boolean;
}

export function SummaryCard({ video, content, backTo, hideChannel }: Props) {
  const thumb = video.thumbnail_url ?? `https://i.ytimg.com/vi/${video.youtube_id}/mqdefault.jpg`;
  const href = backTo ? `/v/${video.youtube_id}?from=${encodeURIComponent(backTo)}` : `/v/${video.youtube_id}`;
  const duration = formatDuration(video.duration_sec);

  const meta: React.ReactNode[] = [];
  if (!hideChannel && video.channel_title) {
    meta.push(
      video.channel_id
        ? <Link key="ch" href={`/c/${video.channel_id}`}>{video.channel_title}</Link>
        : <span key="ch">{video.channel_title}</span>,
    );
  }
  if (video.published_at) meta.push(<span key="pub">게시일 {formatKst(video.published_at)}</span>);

  return (
    <article className="card">
      <Link href={href} className="thumb" tabIndex={-1} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={thumb} alt="" loading="lazy" />
        {duration && <span className="dur">{duration}</span>}
      </Link>
      <div className="card-body">
        <h3 className="title">
          <Link href={href}>{video.title ?? video.youtube_id}</Link>
          {video.status !== "done" && <> <span className="status">{STATUS_LABEL[video.status] ?? video.status}</span></>}
        </h3>
        {meta.length > 0 && (
          <div className="meta">
            {meta.map((m, i) => (
              <span key={i}>
                {i > 0 && <span className="dot">· </span>}
                {m}
              </span>
            ))}
          </div>
        )}
        {content?.conclusion && <p className="one-liner">{content.conclusion}</p>}
      </div>
    </article>
  );
}
