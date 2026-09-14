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
}

export function SummaryCard({ video, content, backTo }: Props) {
  const thumb = video.thumbnail_url ?? `https://i.ytimg.com/vi/${video.youtube_id}/mqdefault.jpg`;
  const href = backTo ? `/v/${video.youtube_id}?from=${encodeURIComponent(backTo)}` : `/v/${video.youtube_id}`;
  const meta = [
    video.channel_title
      ? video.channel_id
        ? <Link key="ch" href={`/c/${video.channel_id}`}>{video.channel_title}</Link>
        : <span key="ch">{video.channel_title}</span>
      : null,
    video.duration_sec ? <span key="dur">{formatDuration(video.duration_sec)}</span> : null,
    video.published_at ? <span key="pub">{formatKst(video.published_at, false)}</span> : null,
  ].filter(Boolean);

  return (
    <article className="card">
      <Link href={href}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={thumb} alt="" loading="lazy" />
      </Link>
      <div>
        <h3 className="title">
          <Link href={href}>{video.title ?? video.youtube_id}</Link>
          {video.status !== "done" && <> <span className="status">{STATUS_LABEL[video.status] ?? video.status}</span></>}
        </h3>
        <div className="muted">
          {meta.map((m, i) => (
            <span key={i}>{i > 0 && " · "}{m}</span>
          ))}
        </div>
        {content?.one_liner && <p className="one-liner">{content.one_liner}</p>}
        {content && content.key_points.length > 0 && (
          <ul>
            {content.key_points.slice(0, 3).map((p, i) => <li key={i}>{p}</li>)}
            {content.key_points.length > 3 && (
              <li className="muted"><Link href={href}>+ {content.key_points.length - 3}개 더 보기</Link></li>
            )}
          </ul>
        )}
      </div>
    </article>
  );
}
