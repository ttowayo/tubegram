import { env } from "./env";
import { formatDuration, formatKstWithLabel, timestampToSeconds } from "./date";
import { watchUrl } from "./youtube";
import type { SummaryContent, VideoRow } from "./supabase";

const MAX_LEN = 4000;

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

export interface TelegramMessage {
  message_id: number;
  text?: string;
  chat: { id: number; type: string; title?: string; username?: string; first_name?: string };
  from?: { id: number; first_name?: string; username?: string };
}

export async function tg<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${env.telegramBotToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) throw new Error(`Telegram ${method} failed: ${json.description ?? res.status}`);
  return json.result as T;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 4096자 제한 대응: 줄 단위로 분할 */
export function splitMessage(text: string, limit = MAX_LEN): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (line.length > limit) {
      if (cur) { chunks.push(cur); cur = ""; }
      for (let i = 0; i < line.length; i += limit) chunks.push(line.slice(i, i + limit));
      continue;
    }
    if ((cur + "\n" + line).length > limit) {
      chunks.push(cur);
      cur = line;
    } else {
      cur = cur ? cur + "\n" + line : line;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** HTML 메시지 전송. 첫 메시지의 message_id 반환 */
export async function sendMessage(
  chatId: number,
  html: string,
  opts: { disablePreview?: boolean } = {},
): Promise<number | undefined> {
  let first: number | undefined;
  for (const chunk of splitMessage(html)) {
    const r = await tg<{ message_id: number }>("sendMessage", {
      chat_id: chatId,
      text: chunk,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: opts.disablePreview ?? false },
    });
    first ??= r.message_id;
  }
  return first;
}

export function formatSummaryMessage(video: VideoRow, c: SummaryContent): string {
  const id = video.youtube_id;
  const title = escapeHtml(video.title ?? id);
  const lines: string[] = [];

  lines.push(`🎬 <b><a href="${watchUrl(id)}">${title}</a></b>`);
  const metaBits = [
    video.channel_title ? escapeHtml(video.channel_title) : null,
    video.duration_sec ? `영상 ${formatDuration(video.duration_sec)}` : null,
    video.published_at ? `게시 ${formatKstWithLabel(video.published_at, "업로드")}` : null,
  ].filter(Boolean);
  if (metaBits.length) lines.push(metaBits.join(" · "));
  lines.push("");

  if (c.one_liner) lines.push(`<i>${escapeHtml(c.one_liner)}</i>`, "");

  if (c.key_points.length) {
    lines.push("<b>핵심 요점</b>");
    for (const p of c.key_points) lines.push(`• ${escapeHtml(p)}`);
    lines.push("");
  }

  if (c.timeline.length) {
    lines.push("<b>타임라인</b>");
    for (const t of c.timeline) {
      const sec = timestampToSeconds(t.timestamp);
      const ts = sec !== null
        ? `<a href="${watchUrl(id, sec)}">${escapeHtml(t.timestamp)}</a>`
        : escapeHtml(t.timestamp);
      lines.push(`${ts} ${escapeHtml(t.text)}`);
    }
    lines.push("");
  }

  if (c.conclusion) lines.push(`<b>결론</b>`, escapeHtml(c.conclusion), "");

  if (env.appUrl) lines.push(`<a href="${env.appUrl}/v/${id}">사이트에서 보기</a>`);
  return lines.join("\n").trim();
}
