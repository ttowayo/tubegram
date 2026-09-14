import { after } from "next/server";
import { env } from "@/lib/env";
import { processQueue } from "@/lib/pipeline";
import { queueTodayUploads, subscribedChannelsAll } from "@/lib/today";

export const maxDuration = 300;

/** 사이트에서 "오늘 영상 요약" 실행. body: { token, channel? } (form 또는 JSON) */
export async function POST(req: Request) {
  const ct = req.headers.get("content-type") ?? "";
  let token = "";
  let channelId = "";
  let isForm = false;

  if (ct.includes("application/json")) {
    const j = (await req.json().catch(() => ({}))) as { token?: string; channel?: string };
    token = j.token ?? "";
    channelId = j.channel ?? "";
  } else {
    isForm = true;
    const f = await req.formData();
    token = String(f.get("token") ?? "");
    channelId = String(f.get("channel") ?? "");
  }

  if (token !== env.registerToken) {
    return isForm ? redirect(req, "/today?error=token") : Response.json({ error: "invalid token" }, { status: 403 });
  }

  let channels = await subscribedChannelsAll();
  if (channelId) channels = channels.filter((c) => c.channel_id === channelId);
  if (channels.length === 0) {
    return isForm ? redirect(req, "/today?error=nochannel") : Response.json({ error: "no subscribed channel" }, { status: 400 });
  }

  const result = await queueTodayUploads(channels, env.ownerChatId);
  if (result.queued > 0) {
    after(async () => {
      try {
        await processQueue();
      } catch (e) {
        console.error("[today] processQueue failed:", e);
      }
    });
  }

  if (isForm) {
    const q = new URLSearchParams({
      queued: String(result.queued),
      already: String(result.already),
      found: String(result.channels.reduce((n, c) => n + c.count, 0)),
      errors: String(result.channels.filter((c) => c.error).length),
    });
    return redirect(req, `/today?${q}`);
  }
  return Response.json(result);
}

function redirect(req: Request, path: string): Response {
  return Response.redirect(new URL(path, req.url), 303);
}
