import { db, type ChannelRow } from "./supabase";
import { fetchChannelUploads, parseChannelRef, resolveChannel } from "./youtube";
import { websubRequest } from "./websub";

export class ChannelError extends Error {}

export interface SubscribeResult {
  channel: ChannelRow;
  created: boolean;
  pushed: boolean;
}

/** chat 이 없으면 생성 */
export async function ensureChat(chatId: number, name: string | null): Promise<void> {
  const s = db();
  const { data } = await s.from("chats").select("chat_id").eq("chat_id", chatId).maybeSingle();
  if (!data) await s.from("chats").insert({ chat_id: chatId, name });
}

/** @핸들 / 채널 URL / 채널 ID / 영상 URL 로 채널을 찾아 chat 에 구독 등록 */
export async function subscribeChannel(chatId: number, input: string): Promise<SubscribeResult> {
  const ref = parseChannelRef(input);
  if (!ref) throw new ChannelError("채널을 인식하지 못했습니다. @핸들이나 채널 URL 을 입력하세요.");
  const info = await resolveChannel(ref);
  if (!info) throw new ChannelError("채널을 찾지 못했습니다. @핸들이나 채널 URL 을 확인해 주세요.");

  const s = db();
  const { data: existing } = await s.from("channels").select("*").eq("channel_id", info.channelId).maybeSingle();
  let channel = existing as ChannelRow | null;
  let created = false;

  if (!channel) {
    // 기준선: 현재 최신 영상 시각. 과거 영상은 요약하지 않음
    let baseline = new Date().toISOString();
    try {
      const feed = await fetchChannelUploads(info.channelId);
      const latestTs = Math.max(...feed.map((e) => Date.parse(e.publishedAt)).filter(Number.isFinite));
      if (Number.isFinite(latestTs) && latestTs > 0) baseline = new Date(latestTs).toISOString();
    } catch { /* 피드 실패 시 now 기준 */ }

    const { data, error } = await s
      .from("channels")
      .insert({
        channel_id: info.channelId,
        title: info.title,
        handle: info.handle,
        thumbnail_url: info.thumbnailUrl,
        uploads_playlist_id: info.uploadsPlaylistId,
        baseline_published_at: baseline,
        is_active: true,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    channel = data as ChannelRow;
    created = true;
  } else if (!channel.is_active) {
    await s.from("channels").update({ is_active: true, baseline_published_at: new Date().toISOString() }).eq("id", channel.id);
    channel = { ...channel, is_active: true };
  }

  const { error: subErr } = await s
    .from("subscriptions")
    .upsert({ chat_id: chatId, channel_id: channel.channel_id }, { onConflict: "chat_id,channel_id", ignoreDuplicates: true });
  if (subErr) throw new Error(subErr.message);

  const pushed = await websubRequest(channel.channel_id, "subscribe");
  return { channel, created, pushed };
}

/** 구독 해지. 마지막 구독자였으면 채널 비활성화 + WebSub 해지 */
export async function unsubscribeChannel(chatId: number, channelId: string): Promise<ChannelRow | null> {
  const s = db();
  const { data } = await s.from("channels").select("*").eq("channel_id", channelId).maybeSingle();
  const channel = data as ChannelRow | null;
  if (!channel) return null;

  await s.from("subscriptions").delete().eq("chat_id", chatId).eq("channel_id", channelId);
  const { count } = await s.from("subscriptions").select("*", { count: "exact", head: true }).eq("channel_id", channelId);
  if (!count) {
    await s.from("channels").update({ is_active: false }).eq("channel_id", channelId);
    await websubRequest(channelId, "unsubscribe");
  }
  return channel;
}

/** chat 이 구독 중인 채널 (구독 순) */
export async function subscribedChannels(chatId: number): Promise<ChannelRow[]> {
  const s = db();
  const { data: subs } = await s.from("subscriptions").select("channel_id").eq("chat_id", chatId).order("created_at");
  const ids = (subs ?? []).map((x) => x.channel_id as string);
  if (ids.length === 0) return [];
  const { data: channels } = await s.from("channels").select("*").in("channel_id", ids);
  const byId = new Map(((channels ?? []) as ChannelRow[]).map((c) => [c.channel_id, c]));
  return ids.map((id) => byId.get(id)).filter((c): c is ChannelRow => Boolean(c));
}
