import { after } from "next/server";
import { db, type ChannelRow } from "@/lib/supabase";
import { parseFeedXml } from "@/lib/youtube";
import { channelIdFromTopic, verifySignature } from "@/lib/websub";
import { enqueueNewEntries } from "@/lib/poll";
import { processQueue } from "@/lib/pipeline";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** 허브의 구독 확인 (challenge echo) */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const topic = url.searchParams.get("hub.topic") ?? "";
  const challenge = url.searchParams.get("hub.challenge");
  const lease = Number(url.searchParams.get("hub.lease_seconds") ?? "0");
  const channelId = channelIdFromTopic(topic);

  if (!challenge || !channelId) return new Response("bad request", { status: 400 });

  const { data } = await db().from("channels").select("id, is_active").eq("channel_id", channelId).maybeSingle();
  if (!data) return new Response("unknown topic", { status: 404 });

  if (mode === "subscribe") {
    const expires = new Date(Date.now() + (lease > 0 ? lease : 864000) * 1000).toISOString();
    await db().from("channels").update({ websub_lease_expires_at: expires }).eq("id", data.id);
  } else if (mode === "unsubscribe") {
    await db().from("channels").update({ websub_lease_expires_at: null }).eq("id", data.id);
  }
  return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

/** 새 영상 푸시 알림 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature"))) {
    return new Response("invalid signature", { status: 403 });
  }

  let entries;
  try {
    entries = parseFeedXml(raw);
  } catch {
    return new Response("ok", { status: 200 });
  }
  if (entries.length === 0) return new Response("ok", { status: 200 });

  const channelIds = [...new Set(entries.map((e) => e.channelId).filter(Boolean))];
  const { data: channels } = await db().from("channels").select("*").in("channel_id", channelIds).eq("is_active", true);

  let enqueued = 0;
  for (const ch of (channels ?? []) as ChannelRow[]) {
    enqueued += await enqueueNewEntries(ch, entries.filter((e) => e.channelId === ch.channel_id));
  }

  if (enqueued > 0) {
    after(async () => {
      try {
        await processQueue();
      } catch (e) {
        console.error("[websub] processQueue failed:", e);
      }
    });
  }
  return new Response("ok", { status: 200 });
}
