import { db, type ChannelRow } from "./supabase";
import { withinTimeWindow } from "./date";
import { fetchChannelUploads, type FeedEntry } from "./youtube";
import { enqueueVideo, processQueue, requeueFinishedLives } from "./pipeline";

export interface PollResult {
  channels: number;
  enqueued: number;
  requeued: number;
  processed: number;
  stopped: string | null;
  errors: string[];
}

/** 구독 중인 채널의 RSS 를 읽어 새 영상을 큐에 넣고, 끝난 라이브를 되살린 뒤 큐를 처리 */
export async function pollChannels(budgetMs?: number): Promise<PollResult> {
  const s = db();
  const { data: channels } = await s.from("channels").select("*").eq("is_active", true);
  const { data: subs } = await s.from("subscriptions").select("channel_id");
  const subscribed = new Set((subs ?? []).map((x) => x.channel_id as string));

  let enqueued = 0;
  let checked = 0;
  const errors: string[] = [];

  for (const ch of (channels ?? []) as ChannelRow[]) {
    if (!subscribed.has(ch.channel_id)) continue;
    checked++;
    try {
      const entries = await fetchChannelUploads(ch.channel_id);
      enqueued += await enqueueNewEntries(ch, entries);
      await s.from("channels").update({ last_checked_at: new Date().toISOString() }).eq("id", ch.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${ch.title}: ${msg}`);
      console.error(`[poll] ${ch.channel_id}:`, msg);
    }
  }

  let requeued = 0;
  try {
    requeued = await requeueFinishedLives();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`requeue: ${msg}`);
    console.error("[poll] requeue failed:", msg);
  }

  const { processed, stopped } = await processQueue(budgetMs);
  return { channels: checked, enqueued, requeued, processed, stopped, errors };
}

/** 기준선 이후에 게시되고, 채널의 요약 시간대에 들며, DB 에 없는 항목만 큐에 추가 */
export async function enqueueNewEntries(ch: ChannelRow, entries: FeedEntry[]): Promise<number> {
  const baseline = Date.parse(ch.baseline_published_at);
  const fresh = entries.filter((e) => {
    const t = Date.parse(e.publishedAt);
    if (!Number.isFinite(t) || t <= baseline) return false;
    return withinTimeWindow(e.publishedAt, ch.window_start_min, ch.window_end_min);
  });
  if (fresh.length === 0) return 0;

  const { data: existing } = await db()
    .from("videos")
    .select("youtube_id")
    .in("youtube_id", fresh.map((e) => e.videoId));
  const have = new Set((existing ?? []).map((x) => x.youtube_id as string));

  let n = 0;
  for (const e of fresh) {
    if (have.has(e.videoId)) continue;
    await enqueueVideo({
      youtubeId: e.videoId,
      source: "channel",
      channelId: ch.channel_id,
      channelTitle: ch.title,
      title: e.title,
      publishedAt: e.publishedAt,
    });
    n++;
  }
  return n;
}
