import { env } from "./env";
import { db, type ChannelRow } from "./supabase";
import { kstDate, formatKst, formatTimeWindow, parseTimeWindow, type TimeWindow } from "./date";
import { escapeHtml, sendMessage, formatSummaryMessage, type TelegramUpdate } from "./telegram";
import { extractVideoId, fetchChannelUploads, parseChannelRef, resolveChannel } from "./youtube";
import { enqueueVideo, getSummary } from "./pipeline";
import { queueTodayUploads } from "./today";
import { ChannelError, ensureChat, subscribeChannel, subscribedChannels, unsubscribeChannel } from "./channels";

const HELP = `<b>tubegram 봇 사용법</b>

유튜브 URL 을 보내면 바로 요약합니다.

/subscribe &lt;채널&gt; [시간대] - 채널 구독 (새 영상 자동 요약)
/unsubscribe &lt;채널&gt; - 구독 해지
/list - 구독 목록
/latest &lt;채널&gt; - 채널 최신 영상 1편 요약
/today [채널] - 구독 채널에서 오늘 올라온 영상 모두 요약
/pause - 알림 일시정지
/resume - 알림 재개
/status - 큐/사용량 현황

채널은 @핸들, 채널 URL, 채널 ID, 또는 그 채널 영상 URL 로 지정할 수 있습니다.

<b>시간대 필터</b>
/subscribe @채널 07:00-09:00 처럼 뒤에 시간을 붙이면 그 시간(KST)에 올라온 영상만 요약합니다.
자정을 넘겨도 됩니다 (22:00-02:00). 구독 중인 채널에 다시 쓰면 시간대만 바뀌고,
/subscribe @채널 종일 로 해제합니다.`;

const WINDOW_OFF = ["종일", "전체", "해제", "all", "off"];

/** 인자 끝에 붙은 시간대를 떼어낸다. window 가 undefined 면 변경 없음, null 이면 해제 */
function splitWindowArg(arg: string): { ref: string; window?: TimeWindow | null } {
  const parts = arg.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { ref: arg.trim() };
  const last = parts[parts.length - 1];
  const ref = parts.slice(0, -1).join(" ");

  if (WINDOW_OFF.includes(last.toLowerCase())) return { ref, window: null };
  const window = parseTimeWindow(last);
  if (window) return { ref, window };
  // 시간대처럼 생겼는데 못 읽으면 채널 이름의 일부로 넘기지 않고 알려준다
  if (/^[\d:]+\s*[-~]\s*[\d:]+$/.test(last)) {
    throw new ChannelError(`시간대를 인식하지 못했습니다: ${last}\n07:00-09:00 형식으로 입력하세요.`);
  }
  return { ref: arg.trim() };
}

/** 채널 행의 시간대를 사람이 읽는 한 줄로 */
function windowLabel(c: ChannelRow): string | null {
  return c.window_start_min !== null && c.window_end_min !== null
    ? formatTimeWindow(c.window_start_min, c.window_end_min)
    : null;
}

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
  if (!arg) {
    await sendMessage(chatId, "사용법: /subscribe @채널핸들 [07:00-09:00]");
    return;
  }
  let r;
  try {
    const { ref, window } = splitWindowArg(arg);
    r = await subscribeChannel(chatId, ref, window);
  } catch (e) {
    if (e instanceof ChannelError) {
      await sendMessage(chatId, escapeHtml(e.message));
      return;
    }
    throw e;
  }
  const { channel, pushed } = r;
  const win = windowLabel(channel);
  const body = win
    ? `KST <b>${win}</b> 에 올라온 새 영상만 요약해서 보내드립니다.`
    : "이후 올라오는 새 영상을 요약해서 보내드립니다.";
  await sendMessage(
    chatId,
    `✅ 구독: <b>${escapeHtml(channel.title)}</b>${channel.handle ? ` (${escapeHtml(channel.handle)})` : ""}\n` +
      `${body}${pushed ? "" : "\n(15분 주기 확인)"}`,
    { disablePreview: true },
  );
}

async function unsubscribe(chatId: number, arg: string): Promise<void> {
  const target = await findSubscribedChannel(chatId, arg);
  if (!target) {
    await sendMessage(chatId, "구독 목록에서 해당 채널을 찾지 못했습니다. /list 로 확인해 주세요.");
    return;
  }
  await unsubscribeChannel(chatId, target.channel_id);
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


async function list(chatId: number): Promise<void> {
  const channels = await subscribedChannels(chatId);
  if (channels.length === 0) {
    await sendMessage(chatId, "구독 중인 채널이 없습니다. /subscribe @채널핸들 로 추가하세요.");
    return;
  }
  const lines = channels.map((c, i) => {
    const handle = c.handle ? ` ${escapeHtml(c.handle)}` : "";
    const win = windowLabel(c);
    const window = win ? ` · ⏱ ${win}` : "";
    const checked = c.last_checked_at ? ` · 확인 ${formatKst(c.last_checked_at)}` : "";
    return `${i + 1}. <a href="https://www.youtube.com/channel/${c.channel_id}">${escapeHtml(c.title)}</a>${handle}${window}${checked}`;
  });
  await sendMessage(chatId, `<b>구독 채널 (${channels.length})</b>\n${lines.join("\n")}\n\n해지: /unsubscribe 번호\n시간대 변경: /subscribe @채널 07:00-09:00`, { disablePreview: true });
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
