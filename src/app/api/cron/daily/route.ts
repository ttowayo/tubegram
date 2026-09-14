import { cronAuthorized } from "@/lib/auth";
import { env } from "@/lib/env";
import { kstDate, shiftDate } from "@/lib/date";
import { renewWebsubLeases } from "@/lib/websub";
import { pollChannels } from "@/lib/poll";
import { escapeHtml, sendMessage } from "@/lib/telegram";
import { listSummariesByDate } from "@/lib/queries";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Vercel Cron (하루 1회). WebSub 갱신 + 폴링 + 전일 다이제스트. Supabase keep-alive 역할도 겸함 */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response("unauthorized", { status: 401 });

  const renewed = await renewWebsubLeases();
  const poll = await pollChannels(150_000);
  const digest = await sendDigest();
  return Response.json({ renewed, poll, digest });
}

async function sendDigest(): Promise<{ date: string; count: number; sent: boolean }> {
  const yesterday = shiftDate(kstDate(), -1);
  const items = await listSummariesByDate(yesterday);
  const owner = env.ownerChatId;
  if (!owner || items.length === 0) return { date: yesterday, count: items.length, sent: false };

  const lines = items.slice(0, 30).map((s) => {
    const v = s.videos;
    const title = escapeHtml(v.title ?? v.youtube_id);
    const ch = v.channel_title ? ` — ${escapeHtml(v.channel_title)}` : "";
    return `• <a href="https://youtu.be/${v.youtube_id}">${title}</a>${ch}`;
  });
  const site = env.appUrl ? `\n<a href="${env.appUrl}/d/${yesterday}">사이트에서 보기</a>` : "";
  await sendMessage(owner, `📅 <b>${yesterday} 요약 ${items.length}건</b>\n${lines.join("\n")}${site}`, { disablePreview: true });
  return { date: yesterday, count: items.length, sent: true };
}
