import { env } from "./env";
import { db, type ChannelRow } from "./supabase";
import { kstDate, formatKst } from "./date";
import { escapeHtml, sendMessage, formatSummaryMessage, type TelegramUpdate } from "./telegram";
import { extractVideoId, fetchChannelUploads, parseChannelRef, resolveChannel } from "./youtube";
import { enqueueVideo, getSummary } from "./pipeline";
import { websubRequest } from "./websub";
import { queueTodayUploads } from "./today";

const HELP = `<b>tubegram 봇 사용법</b>

유튜브 URL 을 보내면 바로 요약합니다.

/subscribe &lt;채널&gt; - 채널 구독 (새 영상 자동 요약)
/unsubscribe &lt;채널&gt; - 구독 해지
/list - 구독 목록
/latest &lt;채널&gt; - 채널 최신 영상 1편 요약
/today [채널] - 구독 채널에서 오늘 올라온 영상 모두 요약
/pause - 알림 일시정지
/resume - 알림 재개
/status - 큐/사용량 현황

채널은 @핸들, 채널 URL, 채널 ID, 또는 그 채널 영상 URL 로 지정할 수 있습니다.`;

/** 텔레그램 업데이트 처리. process=true 면 호출자가 큐 처리를 트리거해야 함 */
export async function handleUpdate(update: TelegramUpdate): Promise<{ process: boolean }> {
  const msg = update.message ?? update.edited_message;
  const text = msg?.text?.trim();
  if (!msg || !text) return { process: false };

  const chatId = msg.chat.id;
  if (!env.allowedChatIds.includes(chatId)) {
    await sendMessage(chatId, `이 봇은 허용된 사용자만 쓸 수 있습니다.\n당신의 chat_id: <code>${chatId}</code>`);
    return { process: false };
  }
  await ensureChat(chatId, msg.chat.title ?? msg.from?.first_name ?? msg.from?.username ?? null);

  const [rawCmd, ...rest] = text.split(/\s+/);
  const arg = rest.join(" ").trim();
  const cmd = rawCmd.startsWith("/") ? rawCmd.toLowerCase().replace(/@[\w]+$/, "") : "";

  try {
    switch (cmd) {
      case "/start":
      case "/help":
        await sendMessage(chatId, HELP, { disablePreview: true });
        return { process: false };
      case "/subscribe":
      case "/sub":
        await subscribe(chatId, arg);
        return { process: false };
      case "/unsubscribe":
      case "/unsub":
        await unsubscribe(chatId, arg);
        return { process: false };
      case "/list":
        await list(chatId);
        return { process: false };
      case "/latest":
        return { process: await latest(chatId, arg) };
      case "/today":
        return { process: await today(chatId, arg) };
      case "/pause":
        await db().from("chats").update({ is_active: false }).eq("chat_id", chatId);
        await sendMessage(chatId, "⏸ 채널 알림을 일시정지했습니다. /resume 으로 재개합니다. (직접 보낸 URL 요약은 계속 동작)");
        return { process: false };
      case "/resume":
        await db().from("chats").update({ is_active: true }).eq("chat_id", chatId);
        await sendMessage(chatId, "▶️ 채널 알림을 재개했습니다.");
        return { process: false };
      case "/status":
        await status(chatId);
        return { process: false };
      case "":
        return { process: await manualUrl(chatId, text) };
      default:
        await sendMessage(chatId, `모르는 명령입니다.\n\n${HELP}`, { disablePreview: true });
        return { process: false };
    }
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.error("[bot]", m);
    await sendMessage(chatId, `⚠️ 오류: ${escapeHtml(m.slice(0, 300))}`);
    return { process: false };
  }
}

async function ensureChat(chatId: number, name: string | null): Promise<void> {
  const s = db();
  const { data } = await s.from("chats").select("chat_id").eq("chat_id", chatId).maybeSingle();
  if (!data) await s.from("chats").insert({ chat_id: chatId, name });
}

async function manualUrl(chatId: number, text: string): Promise<boolean> {
  const videoId = extractVideoId(text);
  if (!videoId) {
    await sendMessage(chatId, `유튜브 URL 을 인식하지 못했습니다.\n\n${HELP}`, { disablePreview: true });
    return false;
  }
  const { video, created } = await enqueueVideo({ youtubeId: videoId, source: "manual", requestedByChatId: chatId });

  if (video.status === "done") {
    const summary = await getSummary(video.id);
    if (summary) {
      await sendMessage(chatId, formatSummaryMessage(video, summary.content));
      await db().from("deliveries").upsert({ video_id: video.id, chat_id: chatId }, { onConflict: "video_id,chat_id", ignoreDuplicates: true });
      return false;
    }
  }
  if (video.status === "processing") {
    await sendMessage(chatId, "⏳ 이미 요약 중입니다. 완료되면 보내드릴게요.");
    return false;
  }
  await sendMessage(chatId, created ? "📥 접수했습니다. 요약이 끝나면 보내드릴게요. (보통 1~3분)" : "📥 대기열에 있습니다. 곧 처리됩니다.");
  return true;
}

async function subscribe(chatId: number, arg: string): Promise<void> {
  const ref = parseChannelRef(arg);
  if (!ref) {
    await sendMessage(chatId, "사용법: /subscribe @채널핸들 또는 채널 URL");
    return;
  }
  const info = await resolveChannel(ref);
  if (!info) {
    await sendMessage(chatId, "채널을 찾지 못했습니다. @핸들이나 채널 URL 을 확인해 주세요.");
    return;
  }

  const s = db();
  const { data: existing } = await s.from("channels").select("*").eq("channel_id", info.channelId).maybeSingle();
  let channel = existing as ChannelRow | null;

  if (!channel) {
    // 기준선: 현재 최신 영상 시각. 과거 영상은 요약하지 않음
    let baseline = new Date().toISOString();
    try {
      const feed = await fetchChannelUploads(info.channelId);
      const latestTs = Math.max(...feed.map((e) => Date.parse(e.publishedAt)).filter(Number.isFinite));
      if (Number.isFinite(latestTs) && latestTs > 0) baseline = new Date(latestTs).toISOString();
    } catch { /* RSS 실패 시 now 기준 */ }

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
  } else if (!channel.is_active) {
    await s.from("channels").update({ is_active: true, baseline_published_at: new Date().toISOString() }).eq("id", channel.id);
  }

  const { error: subErr } = await s
    .from("subscriptions")
    .upsert({ chat_id: chatId, channel_id: channel.channel_id }, { onConflict: "chat_id,channel_id", ignoreDuplicates: true });
  if (subErr) throw new Error(subErr.message);

  const pushed = await websubRequest(channel.channel_id, "subscribe");
  await sendMessage(
    chatId,
    `✅ 구독: <b>${escapeHtml(channel.title)}</b>${channel.handle ? ` (${escapeHtml(channel.handle)})` : ""}\n` +
      `이후 올라오는 새 영상을 요약해서 보내드립니다.${pushed ? "" : "\n(15분 주기 확인)"}`,
    { disablePreview: true },
  );
}

async function unsubscribe(chatId: number, arg: string): Promise<void> {
  const s = db();
  const target = await findSubscribedChannel(chatId, arg);
  if (!target) {
    await sendMessage(chatId, "구독 목록에서 해당 채널을 찾지 못했습니다. /list 로 확인해 주세요.");
    return;
  }
  await s.from("subscriptions").delete().eq("chat_id", chatId).eq("channel_id", target.channel_id);

  const { count } = await s.from("subscriptions").select("*", { count: "exact", head: true }).eq("channel_id", target.channel_id);
  if (!count) {
    await s.from("channels").update({ is_active: false }).eq("channel_id", target.channel_id);
    await websubRequest(target.channel_id, "unsubscribe");
  }
  await sendMessage(chatId, `🗑 구독 해지: <b>${escapeHtml(target.title)}</b>`);
}

/** 구독 중인 채널을 번호, @핸들, 제목, URL 로 찾기 */
async function findSubscribedChannel(chatId: number, arg: string): Promise<ChannelRow | null> {
  const channels = await subscribedChannels(chatId);
  if (channels.length === 0 || !arg) return null;

  if (/^\d+$/.test(arg)) return channels[Number(arg) - 1] ?? null;

  const lower = arg.toLowerCase();
  const byText = channels.find(
    (c) => c.handle?.toLowerCase() === lower || c.title.toLowerCase() === lower || c.channel_id === arg,
  );
  if (byText) return byText;

  const ref = parseChannelRef(arg);
  if (!ref) return null;
  if (ref.kind === "id") return channels.find((c) => c.channel_id === ref.value) ?? null;
  if (ref.kind === "handle") return channels.find((c) => c.handle?.toLowerCase() === ref.value.toLowerCase()) ?? null;
  const info = await resolveChannel(ref).catch(() => null);
  return info ? channels.find((c) => c.channel_id === info.channelId) ?? null : null;
}

async function subscribedChannels(chatId: number): Promise<ChannelRow[]> {
  const s = db();
  const { data: subs } = await s.from("subscriptions").select("channel_id").eq("chat_id", chatId).order("created_at");
  const ids = (subs ?? []).map((x) => x.channel_id as string);
  if (ids.length === 0) return [];
  const { data: channels } = await s.from("channels").select("*").in("channel_id", ids);
  const byId = new Map(((channels ?? []) as ChannelRow[]).map((c) => [c.channel_id, c]));
  return ids.map((id) => byId.get(id)).filter((c): c is ChannelRow => Boolean(c));
}

async function list(chatId: number): Promise<void> {
  const channels = await subscribedChannels(chatId);
  if (channels.length === 0) {
    await sendMessage(chatId, "구독 중인 채널이 없습니다. /subscribe @채널핸들 로 추가하세요.");
    return;
  }
  const lines = channels.map((c, i) => {
    const handle = c.handle ? ` ${escapeHtml(c.handle)}` : "";
    const checked = c.last_checked_at ? ` · 확인 ${formatKst(c.last_checked_at)}` : "";
    return `${i + 1}. <a href="https://www.youtube.com/channel/${c.channel_id}">${escapeHtml(c.title)}</a>${handle}${checked}`;
  });
  await sendMessage(chatId, `<b>구독 채널 (${channels.length})</b>\n${lines.join("\n")}\n\n해지: /unsubscribe 번호`, { disablePreview: true });
}

async function latest(chatId: number, arg: string): Promise<boolean> {
  let channelId: string | null = null;
  const subscribed = arg ? await findSubscribedChannel(chatId, arg) : null;
  if (subscribed) channelId = subscribed.channel_id;
  else {
    const ref = parseChannelRef(arg);
    if (!ref) {
      await sendMessage(chatId, "사용법: /latest @채널핸들 (또는 /list 의 번호)");
      return false;
    }
    const info = await resolveChannel(ref);
    if (!info) {
      await sendMessage(chatId, "채널을 찾지 못했습니다.");
      return false;
    }
    channelId = info.channelId;
  }

  const feed = await fetchChannelUploads(channelId);
  if (feed.length === 0) {
    await sendMessage(chatId, "이 채널에서 영상을 찾지 못했습니다.");
    return false;
  }
  const e = feed[0];
  await sendMessage(chatId, `📥 최신 영상 접수: ${escapeHtml(e.title)}`, { disablePreview: true });
  return manualUrl(chatId, e.videoId);
}

/** 구독 채널(또는 지정 채널)에서 오늘(KST) 올라온 영상을 모두 큐에 넣음 */
async function today(chatId: number, arg: string): Promise<boolean> {
  let channels: ChannelRow[];
  if (arg) {
    const one = await findSubscribedChannel(chatId, arg);
    if (!one) {
      await sendMessage(chatId, "구독 목록에서 해당 채널을 찾지 못했습니다. /list 로 확인해 주세요.");
      return false;
    }
    channels = [one];
  } else {
    channels = await subscribedChannels(chatId);
    if (channels.length === 0) {
      await sendMessage(chatId, "구독 중인 채널이 없습니다. /subscribe @채널핸들 로 추가하세요.");
      return false;
    }
  }

  const r = await queueTodayUploads(channels, chatId);
  const lines = r.channels.map((c) =>
    c.error ? `⚠️ ${escapeHtml(c.title)}: 피드를 읽지 못했습니다` : `• ${escapeHtml(c.title)}: ${c.count}편`,
  );

  if (lines.length === 0) {
    await sendMessage(chatId, `오늘(${r.date}) 올라온 영상이 없습니다.`);
    return false;
  }
  await sendMessage(
    chatId,
    `📅 오늘(${r.date}) 올라온 영상\n${lines.join("\n")}\n\n` +
      `새로 접수 ${r.queued}편${r.already ? `, 이미 요약된 ${r.already}편은 바로 전송` : ""}` +
      (r.queued ? "\n요약이 끝나는 대로 보내드립니다. 쇼츠/라이브는 건너뜁니다." : ""),
    { disablePreview: true },
  );
  return r.queued > 0;
}

async function status(chatId: number): Promise<void> {
  const s = db();
  const count = async (st: string) =>
    (await s.from("videos").select("*", { count: "exact", head: true }).eq("status", st)).count ?? 0;
  const [pending, processing, failed] = await Promise.all([count("pending"), count("processing"), count("failed")]);
  const { data: usage } = await s.from("usage_daily").select("*").eq("day", kstDate()).maybeSingle();
  const usedMin = Math.round(((usage?.video_seconds as number | undefined) ?? 0) / 60);
  await sendMessage(
    chatId,
    `<b>현황</b>\n대기 ${pending} · 처리중 ${processing} · 실패 ${failed}\n` +
      `오늘 사용: ${usedMin}분 / ${env.dailyVideoMinutesBudget}분 (요청 ${(usage?.requests as number | undefined) ?? 0}회)`,
  );
}
