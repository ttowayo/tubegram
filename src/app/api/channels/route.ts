import { env } from "@/lib/env";
import { redirectWithAuth, siteAuthorized } from "@/lib/auth";
import { ChannelError, ensureChat, subscribeChannel, unsubscribeChannel } from "@/lib/channels";

export const maxDuration = 60;

/**
 * 사이트에서 채널 구독/해지. form 또는 JSON.
 *   action=subscribe   input=@핸들|URL
 *   action=unsubscribe channel_id=UC...
 * 인증: token 필드 또는 쿠키 (성공 시 쿠키 저장)
 */
export async function POST(req: Request) {
  const ct = req.headers.get("content-type") ?? "";
  let body: Record<string, string> = {};
  let isForm = false;
  if (ct.includes("application/json")) {
    body = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, string>;
  } else {
    isForm = true;
    const f = await req.formData();
    for (const [k, v] of f.entries()) body[k] = String(v);
  }

  const token = body.token || null;
  if (!(await siteAuthorized(token, req))) {
    return isForm ? redirectWithAuth(req, "/c?error=token", false) : Response.json({ error: "invalid token" }, { status: 403 });
  }
  const setCookie = Boolean(token);

  const owner = env.ownerChatId;
  if (!owner) {
    return isForm ? redirectWithAuth(req, "/c?error=owner", setCookie) : Response.json({ error: "TELEGRAM_ALLOWED_CHAT_IDS not set" }, { status: 500 });
  }
  await ensureChat(owner, "owner");

  const action = body.action ?? "subscribe";
  try {
    if (action === "unsubscribe") {
      const channelId = body.channel_id ?? "";
      const ch = await unsubscribeChannel(owner, channelId);
      if (!ch) return isForm ? redirectWithAuth(req, "/c?error=notfound", setCookie) : Response.json({ error: "channel not found" }, { status: 404 });
      return isForm
        ? redirectWithAuth(req, `/c?ok=unsubscribed&title=${encodeURIComponent(ch.title)}`, setCookie)
        : Response.json({ ok: true, action, channel: ch });
    }

    const r = await subscribeChannel(owner, body.input ?? "");
    return isForm
      ? redirectWithAuth(req, `/c?ok=subscribed&title=${encodeURIComponent(r.channel.title)}&push=${r.pushed ? 1 : 0}`, setCookie)
      : Response.json({ ok: true, action, ...r });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isForm) {
      const code = e instanceof ChannelError ? "notfound" : "server";
      return redirectWithAuth(req, `/c?error=${code}&msg=${encodeURIComponent(msg.slice(0, 200))}`, setCookie);
    }
    return Response.json({ error: msg }, { status: e instanceof ChannelError ? 400 : 500 });
  }
}
