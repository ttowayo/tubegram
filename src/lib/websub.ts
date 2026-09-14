import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";
import { db, type ChannelRow } from "./supabase";
import { feedUrl } from "./youtube";

export const HUB_URL = "https://pubsubhubbub.appspot.com/subscribe";
export const LEASE_SECONDS = 10 * 24 * 3600;
const RENEW_BEFORE_MS = 2 * 24 * 3600 * 1000;

export function topicUrl(channelId: string): string {
  return feedUrl(channelId);
}

export function callbackUrl(): string {
  return `${env.appUrl}/api/websub`;
}

export function channelIdFromTopic(topic: string): string | null {
  try {
    const id = new URL(topic).searchParams.get("channel_id");
    return id && /^UC[A-Za-z0-9_-]{22}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** 허브에 구독/해지 요청. APP_URL 이 없으면 아무것도 하지 않음 */
export async function websubRequest(channelId: string, mode: "subscribe" | "unsubscribe"): Promise<boolean> {
  if (!env.appUrl) return false;
  const body = new URLSearchParams({
    "hub.callback": callbackUrl(),
    "hub.topic": topicUrl(channelId),
    "hub.mode": mode,
    "hub.verify": "async",
    "hub.lease_seconds": String(LEASE_SECONDS),
    "hub.secret": env.cronSecret,
  });
  try {
    const res = await fetch(HUB_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (res.status !== 202 && res.status !== 204) {
      console.warn(`[websub] ${mode} ${channelId} -> ${res.status} ${await res.text().catch(() => "")}`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn(`[websub] ${mode} ${channelId} error:`, e);
    return false;
  }
}

export function verifySignature(rawBody: string, header: string | null): boolean {
  if (!header) return false;
  const [algo, sig] = header.split("=");
  if (algo !== "sha1" || !sig) return false;
  const expected = createHmac("sha1", env.cronSecret).update(rawBody).digest("hex");
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 만료 임박한 구독 갱신. 갱신 요청 수 반환 */
export async function renewWebsubLeases(): Promise<number> {
  if (!env.appUrl) return 0;
  const s = db();
  const { data: channels } = await s.from("channels").select("*").eq("is_active", true);
  const { data: subs } = await s.from("subscriptions").select("channel_id");
  const subscribed = new Set((subs ?? []).map((x) => x.channel_id as string));
  const threshold = Date.now() + RENEW_BEFORE_MS;

  let n = 0;
  for (const ch of (channels ?? []) as ChannelRow[]) {
    if (!subscribed.has(ch.channel_id)) continue;
    const exp = ch.websub_lease_expires_at ? Date.parse(ch.websub_lease_expires_at) : 0;
    if (exp > threshold) continue;
    if (await websubRequest(ch.channel_id, "subscribe")) n++;
  }
  return n;
}
