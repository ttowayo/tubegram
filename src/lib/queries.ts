import { db, type ChannelRow, type SummaryRow, type VideoRow } from "./supabase";

export interface VideoWithSummary extends VideoRow {
  summaries: SummaryRow | null;
}

export interface SummaryWithVideo extends SummaryRow {
  videos: VideoRow;
}

export async function listSummariesByDate(date: string): Promise<SummaryWithVideo[]> {
  const { data } = await db()
    .from("summaries")
    .select("*, videos(*)")
    .eq("summary_date", date)
    .order("created_at", { ascending: false });
  return ((data ?? []) as unknown as SummaryWithVideo[]).filter((s) => s.videos);
}

export interface ChannelSummary extends ChannelRow {
  subscribers: number;
  videoCount: number;
}

export async function listChannels(): Promise<ChannelSummary[]> {
  const s = db();
  const [{ data: channels }, { data: subs }, { data: vids }] = await Promise.all([
    s.from("channels").select("*").order("title"),
    s.from("subscriptions").select("channel_id"),
    s.from("videos").select("channel_id").eq("status", "done"),
  ]);
  const subCount = new Map<string, number>();
  for (const r of subs ?? []) subCount.set(r.channel_id, (subCount.get(r.channel_id) ?? 0) + 1);
  const vidCount = new Map<string, number>();
  for (const r of vids ?? []) if (r.channel_id) vidCount.set(r.channel_id, (vidCount.get(r.channel_id) ?? 0) + 1);
  return ((channels ?? []) as ChannelRow[]).map((c) => ({
    ...c,
    subscribers: subCount.get(c.channel_id) ?? 0,
    videoCount: vidCount.get(c.channel_id) ?? 0,
  }));
}

export async function getChannel(channelId: string): Promise<ChannelRow | null> {
  const { data } = await db().from("channels").select("*").eq("channel_id", channelId).maybeSingle();
  return (data as ChannelRow | null) ?? null;
}

export async function listVideosByChannel(channelId: string, limit = 100): Promise<VideoWithSummary[]> {
  const { data } = await db()
    .from("videos")
    .select("*, summaries(*)")
    .eq("channel_id", channelId)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  return (data ?? []) as unknown as VideoWithSummary[];
}

export async function getVideoByYoutubeId(youtubeId: string): Promise<VideoWithSummary | null> {
  const { data } = await db().from("videos").select("*, summaries(*)").eq("youtube_id", youtubeId).maybeSingle();
  return (data as unknown as VideoWithSummary | null) ?? null;
}

export async function listRecentVideos(limit = 50): Promise<VideoWithSummary[]> {
  const { data } = await db()
    .from("videos")
    .select("*, summaries(*)")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as VideoWithSummary[];
}

/** 특정 월(YYYY-MM)의 날짜별 요약 개수 */
export async function countSummariesByMonth(month: string): Promise<Map<string, number>> {
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = `${month}-${String(lastDay).padStart(2, "0")}`;
  const { data } = await db()
    .from("summaries")
    .select("summary_date")
    .gte("summary_date", first)
    .lte("summary_date", last);
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const d = row.summary_date as string;
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return counts;
}
