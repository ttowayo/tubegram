import { after } from "next/server";
import { env } from "@/lib/env";
import { extractVideoId } from "@/lib/youtube";
import { enqueueVideo, processQueue } from "@/lib/pipeline";

export const maxDuration = 300;

/** 사이트 등록 폼 / JSON API. body: { url, token } */
export async function POST(req: Request) {
  const ct = req.headers.get("content-type") ?? "";
  let url = "";
  let token = "";
  let isForm = false;

  if (ct.includes("application/json")) {
    const j = (await req.json().catch(() => ({}))) as { url?: string; token?: string };
    url = j.url ?? "";
    token = j.token ?? "";
  } else {
    isForm = true;
    const f = await req.formData();
    url = String(f.get("url") ?? "");
    token = String(f.get("token") ?? "");
  }

  if (token !== env.registerToken) {
    return isForm ? redirect(req, "/register?error=token") : Response.json({ error: "invalid token" }, { status: 403 });
  }
  const youtubeId = extractVideoId(url);
  if (!youtubeId) {
    return isForm ? redirect(req, "/register?error=url") : Response.json({ error: "invalid youtube url" }, { status: 400 });
  }

  const { video, created } = await enqueueVideo({
    youtubeId,
    source: "manual",
    requestedByChatId: env.ownerChatId,
  });

  if (video.status === "pending") {
    after(async () => {
      try {
        await processQueue();
      } catch (e) {
        console.error("[videos] processQueue failed:", e);
      }
    });
  }

  if (isForm) return redirect(req, `/v/${youtubeId}`);
  return Response.json({ youtubeId, status: video.status, created });
}

function redirect(req: Request, path: string): Response {
  return Response.redirect(new URL(path, req.url), 303);
}
