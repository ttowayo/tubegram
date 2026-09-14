import { after } from "next/server";
import { env } from "@/lib/env";
import { handleUpdate } from "@/lib/bot";
import { processQueue } from "@/lib/pipeline";
import type { TelegramUpdate } from "@/lib/telegram";

export const maxDuration = 300;

export async function POST(req: Request) {
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (secret !== env.telegramWebhookSecret) {
    return new Response("forbidden", { status: 403 });
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return new Response("bad request", { status: 400 });
  }

  // 빠른 응답 (접수/명령 처리) 후, 무거운 요약은 응답 이후에 실행
  const { process } = await handleUpdate(update);
  if (process) {
    after(async () => {
      try {
        await processQueue();
      } catch (e) {
        console.error("[webhook] processQueue failed:", e);
      }
    });
  }
  return Response.json({ ok: true });
}
