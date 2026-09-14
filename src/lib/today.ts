import { db, type ChannelRow } from "./supabase";
import { kstDate } from "./date";
import { fetchChannelUploads } from "./youtube";
import { deliverSummary, enqueueVideo, getSummary } from "./pipeline";

export interface TodayChannelResult {
  channelId: string;
  title: string;
  count: number;
  error?: string;
}

export interface TodayResult {
  date: string;
  channels: TodayChannelResult[];
  queued: number;
  already: number;
}

/** 구독자가 한 명 이상 있는 활성 채널 */
export async function subscribedChannelsAll(): Promise<ChannelRow[]> {
  const s = db();
  const [{ data: channels }, { data: subs }] = await Promise.all([
    s.from("channels").select("*").eq("is_active", true).order("title"),
    s.from("subscriptions").select("channel_id"),
  ]);
  const subscribed = new Set((subs ?? []).map((x) => x.channel_id as string));
  return ((channels ?? []) as ChannelRow[]).filter((c) => subscribed.has(c.channel_id));
}

/**
 * 채널들의 RSS 에서 오늘(KST) 올라온 영상을 큐에 넣는다.
 * 이미 요약된 영상은 requestedByChatId 에게 (미전송이면) 바로 전송.
 * 반환값의 queued > 0 이면 호출자가 processQueue 를 돌려야 한다.
 */
export async function queueTodayUploads(channels: ChannelRow[], requestedByChatId: number | null): Promise<TodayResult> {
  const date = kstDate();
  const result: TodayResult = { date, channels: [], queued: 0, already: 0 };

  for (const ch of channels) {
    let entries;
    try {
      entries = await fetchChannelUploads(ch.channel_id);
    } catch (e) {
      result.channels.push({ channelId: ch.channel_id, title: ch.title, count: 0, error: e instanceof Error ? e.message : String(e) });
      continue;
    }
    const todays = entries.filter((e) => kstDate(new Date(e.publishedAt)) === date);
    if (todays.length === 0) continue;

    for (const e of todays) {
      const { video } = await enqueueVideo({
        youtubeId: e.videoId,
        source: "channel",
        channelId: ch.channel_id,
        channelTitle: ch.title,
        title: e.title,
        publishedAt: e.publishedAt,
        requestedByChatId,
      });
      if (video.status === "done") {
        const summary = await getSummary(video.id);
        if (summary) await deliverSummary(video, summary.content);
        result.already++;
      } else if (video.status === "pending") {
        result.queued++;
      }
    }
    result.channels.push({ channelId: ch.channel_id, title: ch.title, count: todays.length });
  }
  return result;
}
