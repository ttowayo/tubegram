import { db, type SummaryContent, type SummaryRow, type VideoRow, type VideoSource } from "./supabase";
import { env } from "./env";
import { kstDate } from "./date";
import { fetchVideoDetails, isShort } from "./youtube";
import { GeminiRateLimitError, summarizeYoutubeVideo, type SummarizeResult } from "./gemini";
import { escapeHtml, formatSummaryMessage, sendMessage } from "./telegram";

const STALE_LOCK_MIN = 15;
const MAX_ATTEMPTS = 3;
const UNKNOWN_DURATION_SEC = 600;

/** 나중에 끝나면 다시 요약할 수 있는 skip 사유 */
const SKIP_UPCOMING = "예정된 라이브/프리미어";
const SKIP_LIVE = "진행 중인 라이브";
/** 이보다 오래된 라이브는 다시 확인하지 않는다 (삭제/비공개로 영영 안 끝나는 항목 제외) */
const LIVE_RECHECK_DAYS = 7;

export interface EnqueueArgs {
  youtubeId: string;
  source: VideoSource;
  channelId?: string | null;
  channelTitle?: string | null;
  title?: string | null;
  publishedAt?: string | null;
  requestedByChatId?: number | null;
}

export async function enqueueVideo(a: EnqueueArgs): Promise<{ video: VideoRow; created: boolean }> {
  const s = db();
  const { data: existing } = await s.from("videos").select("*").eq("youtube_id", a.youtubeId).maybeSingle();

  if (existing) {
    const v = existing as VideoRow;
    const patch: Partial<VideoRow> = {};
    if (a.requestedByChatId && !v.requested_by_chat_id) patch.requested_by_chat_id = a.requestedByChatId;
    const retry = v.status === "failed" || (v.status === "skipped" && a.source === "manual");
    if (retry) {
      Object.assign(patch, { status: "pending", attempts: 0, error: null, locked_at: null });
      if (a.source === "manual") patch.source = "manual";
    }
    if (Object.keys(patch).length) {
      patch.updated_at = new Date().toISOString();
      await s.from("videos").update(patch).eq("id", v.id);
    }
    return { video: { ...v, ...patch }, created: false };
  }

  const row = {
    youtube_id: a.youtubeId,
    source: a.source,
    channel_id: a.channelId ?? null,
    channel_title: a.channelTitle ?? null,
    title: a.title ?? null,
    published_at: a.publishedAt ?? null,
    requested_by_chat_id: a.requestedByChatId ?? null,
    status: "pending" as const,
  };
  const { data, error } = await s.from("videos").insert(row).select().single();
  if (error) {
    // 동시 삽입 경합: 다시 조회
    if (error.code === "23505") {
      const { data: again } = await s.from("videos").select("*").eq("youtube_id", a.youtubeId).single();
      return { video: again as VideoRow, created: false };
    }
    throw new Error(`insert video failed: ${error.message}`);
  }
  return { video: data as VideoRow, created: true };
}

/**
 * 라이브/프리미어라서 건너뛴 항목 중 방송이 끝난 것을 다시 큐에 넣는다.
 * RSS 푸시는 방송이 예약되는 순간 오므로 그때는 길이도 내용도 없다. 끝난 뒤 한 번 더 봐야 요약할 수 있다.
 * 아직 진행 중이거나 조회되지 않는 항목은 그대로 두고 다음 폴링에서 다시 본다.
 */
export async function requeueFinishedLives(limit = 20): Promise<number> {
  const s = db();
  const since = new Date(Date.now() - LIVE_RECHECK_DAYS * 86_400_000).toISOString();
  const { data } = await s
    .from("videos")
    .select("id, youtube_id")
    .eq("status", "skipped")
    .in("error", [SKIP_UPCOMING, SKIP_LIVE])
    .gte("published_at", since)
    .order("published_at", { ascending: false })
    .limit(limit);

  const rows = (data ?? []) as Pick<VideoRow, "id" | "youtube_id">[];
  if (rows.length === 0) return 0;

  const details = await fetchVideoDetails(rows.map((r) => r.youtube_id));
  let n = 0;
  for (const r of rows) {
    const d = details.get(r.youtube_id);
    // 길이가 잡혀야 방송이 실제로 끝난 것
    if (!d || d.liveBroadcastContent !== "none" || !d.durationSec) continue;
    const { data: updated } = await s
      .from("videos")
      .update({
        status: "pending",
        attempts: 0,
        error: null,
        locked_at: null,
        title: d.title ?? undefined,
        duration_sec: d.durationSec,
        updated_at: now(),
      })
      .eq("id", r.id)
      .eq("status", "skipped")
      .select("id")
      .maybeSingle();
    if (updated) n++;
  }
  if (n > 0) console.log(`[pipeline] requeued ${n} finished live(s)`);
  return n;
}

/** pending 또는 오래된 processing 항목을 하나 잠그고 반환 */
export async function claimNextVideo(): Promise<VideoRow | null> {
  const s = db();
  const stale = new Date(Date.now() - STALE_LOCK_MIN * 60_000).toISOString();
  const { data } = await s
    .from("videos")
    .select("*")
    .or(`status.eq.pending,and(status.eq.processing,locked_at.lt.${stale})`)
    .order("created_at", { ascending: true })
    .limit(5);

  for (const c of (data ?? []) as VideoRow[]) {
    if (c.attempts >= MAX_ATTEMPTS) {
      await s.from("videos").update({
        status: "failed",
        error: c.error ?? "처리 시간 초과 (재시도 한도 도달)",
        updated_at: new Date().toISOString(),
      }).eq("id", c.id).eq("attempts", c.attempts);
      await notifyFailure({ ...c, status: "failed" });
      continue;
    }
    const { data: claimed } = await s
      .from("videos")
      .update({
        status: "processing",
        locked_at: new Date().toISOString(),
        attempts: c.attempts + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", c.id)
      .eq("attempts", c.attempts)
      .select()
      .maybeSingle();
    if (claimed) return claimed as VideoRow;
  }
  return null;
}

/** 시간 예산 안에서 큐를 순차 처리 */
export async function processQueue(budgetMs = 200_000): Promise<{ processed: number; stopped: string | null }> {
  const deadline = Date.now() + budgetMs;
  let processed = 0;
  while (Date.now() < deadline) {
    const video = await claimNextVideo();
    if (!video) break;
    const r = await processVideo(video);
    processed++;
    if (r.stop) return { processed, stopped: r.stop };
  }
  return { processed, stopped: null };
}

export async function processVideo(input: VideoRow): Promise<{ stop: string | null }> {
  const s = db();
  let video = input;
  try {
    const enriched = await enrich(video);
    video = enriched.video;

    const skipReason = await shouldSkip(video, enriched.liveBroadcastContent);
    if (skipReason) {
      await s.from("videos").update({ status: "skipped", error: skipReason, locked_at: null, updated_at: now() }).eq("id", video.id);
      if (video.requested_by_chat_id) {
        await sendMessage(video.requested_by_chat_id, `⏭ 건너뜀: ${escapeHtml(video.title ?? video.youtube_id)}\n사유: ${escapeHtml(skipReason)}`);
      }
      return { stop: null };
    }

    const dur = video.duration_sec ?? UNKNOWN_DURATION_SEC;
    const used = await usageTodaySeconds();
    if (used + dur > env.dailyVideoMinutesBudget * 60) {
      await release(video);
      return { stop: "daily-budget" };
    }

    const result = await summarizeYoutubeVideo({
      youtubeId: video.youtube_id,
      title: video.title,
      channelTitle: video.channel_title,
      durationSec: video.duration_sec,
    });
    console.log(`[pipeline] ${video.youtube_id} summarized: ${result.chunks} chunk(s), ${result.promptTokens} prompt tokens`);
    const summary = await saveSummary(video, result);
    await s.rpc("add_usage", { p_day: kstDate(), p_seconds: dur });
    await s.from("videos").update({ status: "done", error: null, locked_at: null, updated_at: now() }).eq("id", video.id);
    video = { ...video, status: "done" };
    await deliverSummary(video, summary.content);
    return { stop: null };
  } catch (e) {
    if (e instanceof GeminiRateLimitError) {
      console.warn(`[pipeline] rate limited on ${video.youtube_id}: ${e.message}`);
      if (video.attempts >= MAX_ATTEMPTS) {
        const msg = `Gemini 한도 초과가 반복되어 중단했습니다. URL 을 다시 보내면 재시도합니다. (${e.message.slice(0, 200)})`;
        await s.from("videos").update({ status: "failed", error: msg, locked_at: null, updated_at: now() }).eq("id", video.id);
        await notifyFailure({ ...video, status: "failed", error: msg });
        return { stop: "rate-limit" };
      }
      await release(video, { keepAttempt: true, error: e.message.slice(0, 300) });
      return { stop: "rate-limit" };
    }
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    console.error(`[pipeline] ${video.youtube_id} attempt ${video.attempts} failed: ${msg}`);
    if (video.attempts >= MAX_ATTEMPTS) {
      await s.from("videos").update({ status: "failed", error: msg, locked_at: null, updated_at: now() }).eq("id", video.id);
      await notifyFailure({ ...video, status: "failed", error: msg });
    } else {
      // processing 상태로 두면 STALE_LOCK_MIN 후 자동 재시도
      await s.from("videos").update({ error: msg, updated_at: now() }).eq("id", video.id);
    }
    return { stop: null };
  }
}

/**
 * 큐로 되돌림. keepAttempt=true 면 시도 횟수를 유지해 같은 이유로 무한 재시도되지 않게 함
 * (429 가 3회 반복되면 실패 처리되고 알림이 감)
 */
async function release(video: VideoRow, opts: { keepAttempt?: boolean; error?: string } = {}): Promise<void> {
  await db().from("videos").update({
    status: "pending",
    locked_at: null,
    attempts: opts.keepAttempt ? video.attempts : Math.max(0, video.attempts - 1),
    error: opts.error ?? null,
    updated_at: now(),
  }).eq("id", video.id);
}

async function enrich(video: VideoRow): Promise<{ video: VideoRow; liveBroadcastContent: string }> {
  const details = (await fetchVideoDetails([video.youtube_id])).get(video.youtube_id);
  if (!details) return { video, liveBroadcastContent: "none" };
  const patch: Partial<VideoRow> = {
    title: details.title ?? video.title,
    channel_id: video.channel_id ?? details.channelId,
    channel_title: details.channelTitle ?? video.channel_title,
    thumbnail_url: details.thumbnailUrl ?? video.thumbnail_url,
    published_at: video.published_at ?? details.publishedAt,
    duration_sec: details.durationSec ?? video.duration_sec,
    updated_at: now(),
  };
  await db().from("videos").update(patch).eq("id", video.id);
  return { video: { ...video, ...patch }, liveBroadcastContent: details.liveBroadcastContent };
}

async function shouldSkip(video: VideoRow, live: string): Promise<string | null> {
  if (live === "upcoming") return SKIP_UPCOMING;
  if (live === "live") return SKIP_LIVE;
  const dur = video.duration_sec;
  if (dur && dur > env.maxVideoMinutes * 60) return `영상 길이 초과 (${Math.round(dur / 60)}분 > ${env.maxVideoMinutes}분)`;
  if (video.source === "channel") {
    if (dur && dur < env.minVideoSeconds) return "쇼츠/짧은 영상";
    if (!dur && (await isShort(video.youtube_id))) return "쇼츠";
  }
  return null;
}

async function usageTodaySeconds(): Promise<number> {
  const { data } = await db().from("usage_daily").select("video_seconds").eq("day", kstDate()).maybeSingle();
  return (data?.video_seconds as number | undefined) ?? 0;
}

/** 요약 날짜는 영상 게시일(KST) 기준. 게시일을 모르면 처리 시각으로 대체 */
function summaryDateFor(video: VideoRow): string {
  const t = video.published_at ? Date.parse(video.published_at) : NaN;
  return Number.isFinite(t) ? kstDate(new Date(t)) : kstDate();
}

async function saveSummary(video: VideoRow, r: SummarizeResult): Promise<SummaryRow> {
  const { data, error } = await db()
    .from("summaries")
    .upsert(
      {
        video_id: video.id,
        summary_md: r.summaryMd,
        content: r.content,
        model: r.model,
        summary_date: summaryDateFor(video),
      },
      { onConflict: "video_id" },
    )
    .select()
    .single();
  if (error) throw new Error(`save summary failed: ${error.message}`);
  return data as SummaryRow;
}

export async function getSummary(videoId: number): Promise<SummaryRow | null> {
  const { data } = await db().from("summaries").select("*").eq("video_id", videoId).maybeSingle();
  return (data as SummaryRow | null) ?? null;
}

/** 요청자 + 채널 구독자에게 전송 (중복 방지) */
export async function deliverSummary(video: VideoRow, content: SummaryContent): Promise<number> {
  const s = db();
  const recipients = new Set<number>();
  if (video.requested_by_chat_id) recipients.add(video.requested_by_chat_id);

  if (video.source === "channel" && video.channel_id) {
    const { data: subs } = await s.from("subscriptions").select("chat_id").eq("channel_id", video.channel_id);
    const ids = (subs ?? []).map((x) => x.chat_id as number);
    if (ids.length) {
      const { data: chats } = await s.from("chats").select("chat_id").in("chat_id", ids).eq("is_active", true);
      for (const c of chats ?? []) recipients.add(c.chat_id as number);
    }
  }
  if (recipients.size === 0) return 0;

  const { data: done } = await s.from("deliveries").select("chat_id").eq("video_id", video.id);
  const already = new Set((done ?? []).map((d) => d.chat_id as number));

  const html = formatSummaryMessage(video, content);
  let sent = 0;
  for (const chatId of recipients) {
    if (already.has(chatId)) continue;
    try {
      const messageId = await sendMessage(chatId, html, { disablePreview: false });
      await s.from("deliveries").insert({ video_id: video.id, chat_id: chatId, telegram_message_id: messageId ?? null });
      sent++;
    } catch (e) {
      console.error(`[deliver] to ${chatId} failed:`, e);
    }
  }
  return sent;
}

async function notifyFailure(video: VideoRow): Promise<void> {
  const target = video.requested_by_chat_id ?? env.ownerChatId;
  if (!target) return;
  try {
    await sendMessage(
      target,
      `❌ 요약 실패: ${escapeHtml(video.title ?? video.youtube_id)}\nhttps://youtu.be/${video.youtube_id}\n${escapeHtml(video.error ?? "")}`,
      { disablePreview: true },
    );
  } catch (e) {
    console.error("[notifyFailure]", e);
  }
}

function now(): string {
  return new Date().toISOString();
}
