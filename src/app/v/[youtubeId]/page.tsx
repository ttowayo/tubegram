import Link from "next/link";
import { notFound } from "next/navigation";
import { getVideoByYoutubeId } from "@/lib/queries";
import { formatDuration, formatKst, timestampToSeconds } from "@/lib/date";
import { watchUrl } from "@/lib/youtube";
import { AutoRefresh } from "@/components/AutoRefresh";

export const dynamic = "force-dynamic";

const STATUS_TEXT: Record<string, string> = {
  pending: "대기 중입니다. 곧 요약이 시작됩니다.",
  processing: "요약 중입니다. 보통 1~3분 걸립니다.",
  failed: "요약에 실패했습니다.",
  skipped: "요약 대상에서 제외되었습니다.",
};

export default async function VideoPage({ params, searchParams }: PageProps<"/v/[youtubeId]">) {
  const [{ youtubeId }, sp] = await Promise.all([params, searchParams]);
  if (!/^[A-Za-z0-9_-]{11}$/.test(youtubeId)) notFound();
  const video = await getVideoByYoutubeId(youtubeId);
  if (!video) notFound();
  const content = video.summaries?.content ?? null;
  const inProgress = video.status === "pending" || video.status === "processing";

  // 목록으로 돌아갈 경로: ?from=(내부 경로) > 요약 날짜 > 홈
  const from = typeof sp.from === "string" && /^\/(?!\/)/.test(sp.from) ? sp.from : null;
  const dayPath = video.summaries ? `/d/${video.summaries.summary_date}` : null;
  const backHref = from ?? dayPath ?? "/";
  const backLabel = from?.startsWith("/c/") ? "채널 목록으로"
    : from?.startsWith("/d/") || (!from && dayPath) ? `${(from ?? dayPath)!.slice(3).split(/[?#]/)[0]} 목록으로`
    : "오늘의 요약으로";

  return (
    <div className="narrow">
        {inProgress && <AutoRefresh />}
        <nav className="back-bar">
          <Link href={backHref}>‹ {backLabel}</Link>
          {dayPath && dayPath !== backHref && <Link href={dayPath}>{dayPath.slice(3)} 요약</Link>}
          {video.channel_id && <Link href={`/c/${video.channel_id}`}>채널 이력</Link>}
        </nav>
        <h1>{video.title ?? youtubeId}</h1>
        <p className="muted">
          {video.channel_title && (
            video.channel_id
              ? <Link href={`/c/${video.channel_id}`}>{video.channel_title}</Link>
              : <span>{video.channel_title}</span>
          )}
          {video.duration_sec ? <> · 영상길이 {formatDuration(video.duration_sec)}</> : null}
          {video.published_at ? <> · 게시일 {formatKst(video.published_at)}</> : null}
          {" · "}<a href={watchUrl(youtubeId)} target="_blank" rel="noreferrer">유튜브에서 보기</a>
        </p>

        <div className="video-embed">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${youtubeId}`}
            title={video.title ?? youtubeId}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>

        {video.status !== "done" && (
          <div className="summary">
            <p><span className="status">{video.status}</span> {STATUS_TEXT[video.status] ?? ""}</p>
            {video.error && <p className="muted">{video.error}</p>}
            {inProgress && <p className="muted">요약이 끝나면 이 화면에 자동으로 나타납니다.</p>}
          </div>
        )}

        {content && (
          <div className="summary">
            {content.key_points.length > 0 && (
              <>
                <h2>핵심 요점</h2>
                <ul>{content.key_points.map((p, i) => <li key={i}>{p}</li>)}</ul>
              </>
            )}

            {content.timeline.length > 0 && (
              <>
                <h2>타임라인</h2>
                <ul className="timeline">
                  {content.timeline.map((t, i) => {
                    const sec = timestampToSeconds(t.timestamp);
                    return (
                      <li key={i}>
                        <span className="ts">
                          {sec !== null
                            ? <a href={watchUrl(youtubeId, sec)} target="_blank" rel="noreferrer">{t.timestamp}</a>
                            : t.timestamp}
                        </span>
                        <span>{t.text}</span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            {content.conclusion && (
              <>
                <h2>결론</h2>
                <p>{content.conclusion}</p>
              </>
            )}

            <p className="muted">작성일 {formatKst(video.summaries?.created_at)}</p>
          </div>
        )}
    </div>
  );
}
