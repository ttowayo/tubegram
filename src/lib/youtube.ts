import { XMLParser } from "fast-xml-parser";
import { env } from "./env";

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;

// ---------- URL parsing ----------

export function extractVideoId(input: string): string | null {
  const s = input.trim();
  if (ID_RE.test(s)) return s;
  const url = toUrl(s);
  if (!url) return null;
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return ID_RE.test(id) ? id : null;
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const v = url.searchParams.get("v");
    if (v && ID_RE.test(v)) return v;
    const m = url.pathname.match(/^\/(shorts|live|embed|v)\/([A-Za-z0-9_-]{11})/);
    if (m) return m[2];
  }
  return null;
}

export type ChannelRef =
  | { kind: "id"; value: string }
  | { kind: "handle"; value: string }
  | { kind: "username"; value: string }
  | { kind: "custom"; value: string }
  | { kind: "video"; value: string };

export function parseChannelRef(input: string): ChannelRef | null {
  const s = input.trim();
  if (!s) return null;
  if (CHANNEL_ID_RE.test(s)) return { kind: "id", value: s };
  if (/^@[\w.\-]+$/.test(s)) return { kind: "handle", value: s };
  const videoId = extractVideoId(s);
  if (videoId) return { kind: "video", value: videoId };
  const url = toUrl(s);
  if (!url) return null;
  const host = url.hostname.replace(/^(www|m)\./, "");
  if (host !== "youtube.com") return null;
  const path = decodeURIComponent(url.pathname).replace(/\/+$/, "");
  let m = path.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})/);
  if (m) return { kind: "id", value: m[1] };
  m = path.match(/^\/(@[\w.\-]+)/);
  if (m) return { kind: "handle", value: m[1] };
  m = path.match(/^\/user\/([^/]+)/);
  if (m) return { kind: "username", value: m[1] };
  m = path.match(/^\/c\/([^/]+)/);
  if (m) return { kind: "custom", value: m[1] };
  m = path.match(/^\/([^/@]+)$/);
  if (m) return { kind: "custom", value: m[1] };
  return null;
}

function toUrl(s: string): URL | null {
  try {
    return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
}

// ---------- Channel resolution ----------

export interface ChannelInfo {
  channelId: string;
  title: string;
  handle: string | null;
  thumbnailUrl: string | null;
  uploadsPlaylistId: string | null;
}

export async function resolveChannel(ref: ChannelRef): Promise<ChannelInfo | null> {
  const key = env.youtubeApiKey;

  if (ref.kind === "video") {
    const details = await fetchVideoDetails([ref.value]);
    const d = details.get(ref.value);
    if (d?.channelId) return resolveChannel({ kind: "id", value: d.channelId });
    const scraped = await scrapeChannelFromPage(`https://www.youtube.com/watch?v=${ref.value}`);
    return scraped ? resolveChannel({ kind: "id", value: scraped.channelId }) : null;
  }

  if (key) {
    const params: Record<string, string> = { part: "snippet,contentDetails" };
    if (ref.kind === "id") params.id = ref.value;
    else if (ref.kind === "handle") params.forHandle = ref.value;
    else if (ref.kind === "username") params.forUsername = ref.value;
    else params.forHandle = ref.value; // custom URL 은 핸들과 같은 경우가 많음
    const data = await ytApi<{ items?: YtChannelItem[] }>("channels", params);
    const item = data.items?.[0];
    if (item) return channelItemToInfo(item);
    if (ref.kind === "id") return null;
  }

  // API 키가 없거나 조회 실패: 채널 페이지 스크래핑
  const pagePath =
    ref.kind === "id" ? `/channel/${ref.value}`
    : ref.kind === "handle" ? `/${ref.value}`
    : ref.kind === "username" ? `/user/${ref.value}`
    : `/c/${ref.value}`;
  const scraped = await scrapeChannelFromPage(`https://www.youtube.com${pagePath}`);
  if (!scraped) return null;
  if (key && ref.kind !== "id") {
    const byId = await resolveChannel({ kind: "id", value: scraped.channelId });
    if (byId) return byId;
  }
  return {
    channelId: scraped.channelId,
    title: scraped.title,
    handle: ref.kind === "handle" ? ref.value : null,
    thumbnailUrl: null,
    uploadsPlaylistId: null,
  };
}

interface YtChannelItem {
  id: string;
  snippet: { title: string; customUrl?: string; thumbnails?: Record<string, { url: string }> };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
}

function channelItemToInfo(item: YtChannelItem): ChannelInfo {
  const thumbs = item.snippet.thumbnails ?? {};
  return {
    channelId: item.id,
    title: item.snippet.title,
    handle: item.snippet.customUrl ?? null,
    thumbnailUrl: thumbs.medium?.url ?? thumbs.default?.url ?? null,
    uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads ?? null,
  };
}

async function scrapeChannelFromPage(url: string): Promise<{ channelId: string; title: string } | null> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      "Accept-Language": "ko,en;q=0.8",
      Cookie: "CONSENT=YES+1",
    },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const idMatch =
    html.match(/"channelId":"(UC[A-Za-z0-9_-]{22})"/) ??
    html.match(/<meta itemprop="identifier" content="(UC[A-Za-z0-9_-]{22})"/) ??
    html.match(/channel\/(UC[A-Za-z0-9_-]{22})/);
  if (!idMatch) return null;
  const titleMatch =
    html.match(/<meta property="og:title" content="([^"]+)"/) ??
    html.match(/<title>([^<]+)<\/title>/);
  const title = (titleMatch?.[1] ?? idMatch[1]).replace(/ - YouTube$/, "").trim();
  return { channelId: idMatch[1], title: decodeEntities(title) };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// ---------- RSS feed ----------

export interface FeedEntry {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  updatedAt: string;
}

export function feedUrl(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}

export async function fetchChannelFeed(channelId: string): Promise<FeedEntry[]> {
  const res = await fetch(feedUrl(channelId), {
    headers: { "User-Agent": "tubegram/1.0" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`RSS fetch failed (${res.status}) for ${channelId}`);
  return parseFeedXml(await res.text());
}

/**
 * 채널 최신 영상 목록. RSS 를 2회 시도하고, 실패하면 Data API 업로드 재생목록으로 대체.
 * (유튜브 RSS 가 간헐적으로 404 를 반환함)
 */
export async function fetchChannelUploads(channelId: string): Promise<FeedEntry[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fetchChannelFeed(channelId);
    } catch (e) {
      lastError = e;
    }
  }
  if (env.youtubeApiKey) {
    try {
      return await fetchUploadsViaApi(channelId);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchUploadsViaApi(channelId: string): Promise<FeedEntry[]> {
  const playlistId = "UU" + channelId.slice(2);
  const data = await ytApi<{ items?: YtPlaylistItem[] }>("playlistItems", {
    part: "snippet,contentDetails",
    playlistId,
    maxResults: "15",
  });
  return (data.items ?? [])
    .map((it) => ({
      videoId: it.contentDetails?.videoId ?? "",
      title: it.snippet?.title ?? "",
      channelId,
      channelTitle: it.snippet?.channelTitle ?? "",
      publishedAt: it.contentDetails?.videoPublishedAt ?? it.snippet?.publishedAt ?? "",
      updatedAt: it.snippet?.publishedAt ?? "",
    }))
    .filter((e) => ID_RE.test(e.videoId) && e.publishedAt);
}

interface YtPlaylistItem {
  snippet?: { title?: string; channelTitle?: string; publishedAt?: string };
  contentDetails?: { videoId?: string; videoPublishedAt?: string };
}

export function parseFeedXml(xml: string): FeedEntry[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const doc = parser.parse(xml) as { feed?: { entry?: unknown } };
  const raw = doc.feed?.entry;
  if (!raw) return [];
  const list = (Array.isArray(raw) ? raw : [raw]) as Record<string, unknown>[];
  return list
    .map((e) => {
      const author = (e.author ?? {}) as Record<string, unknown>;
      return {
        videoId: String(e["yt:videoId"] ?? ""),
        title: String(e.title ?? ""),
        channelId: String(e["yt:channelId"] ?? ""),
        channelTitle: String(author.name ?? ""),
        publishedAt: String(e.published ?? ""),
        updatedAt: String(e.updated ?? ""),
      };
    })
    .filter((e) => ID_RE.test(e.videoId));
}

// ---------- Video details ----------

export interface VideoDetails {
  videoId: string;
  title: string;
  channelId: string | null;
  channelTitle: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  durationSec: number | null;
  /** "none" | "upcoming" | "live" */
  liveBroadcastContent: string;
}

export async function fetchVideoDetails(ids: string[]): Promise<Map<string, VideoDetails>> {
  const out = new Map<string, VideoDetails>();
  if (ids.length === 0) return out;

  if (env.youtubeApiKey) {
    const data = await ytApi<{ items?: YtVideoItem[] }>("videos", {
      part: "snippet,contentDetails,liveStreamingDetails",
      id: ids.join(","),
    });
    for (const item of data.items ?? []) {
      const thumbs = item.snippet.thumbnails ?? {};
      out.set(item.id, {
        videoId: item.id,
        title: item.snippet.title,
        channelId: item.snippet.channelId ?? null,
        channelTitle: item.snippet.channelTitle ?? null,
        thumbnailUrl: thumbs.medium?.url ?? thumbs.default?.url ?? null,
        publishedAt: item.snippet.publishedAt ?? null,
        durationSec: parseIsoDuration(item.contentDetails?.duration),
        liveBroadcastContent: item.snippet.liveBroadcastContent ?? "none",
      });
    }
    return out;
  }

  for (const id of ids) {
    const o = await fetchOembed(id);
    if (o) out.set(id, o);
  }
  return out;
}

interface YtVideoItem {
  id: string;
  snippet: {
    title: string;
    channelId?: string;
    channelTitle?: string;
    publishedAt?: string;
    liveBroadcastContent?: string;
    thumbnails?: Record<string, { url: string }>;
  };
  contentDetails?: { duration?: string };
}

export async function fetchOembed(videoId: string): Promise<VideoDetails | null> {
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const j = (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string; author_url?: string };
  return {
    videoId,
    title: j.title ?? videoId,
    channelId: null,
    channelTitle: j.author_name ?? null,
    thumbnailUrl: j.thumbnail_url ?? null,
    publishedAt: null,
    durationSec: null,
    liveBroadcastContent: "none",
  };
}

/** 쇼츠 URL 이 리다이렉트 없이 200 이면 쇼츠 */
export async function isShort(videoId: string): Promise<boolean> {
  try {
    const res = await fetch(`https://www.youtube.com/shorts/${videoId}`, {
      method: "HEAD",
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

export function parseIsoDuration(iso?: string): number | null {
  if (!iso) return null;
  const m = iso.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const [, d, h, mi, s] = m.map((x) => (x ? Number(x) : 0));
  return d * 86400 + h * 3600 + mi * 60 + s;
}

async function ytApi<T>(resource: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams({ ...params, key: env.youtubeApiKey });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/${resource}?${qs}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`YouTube API ${resource} failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export function watchUrl(videoId: string, seconds?: number | null): string {
  return seconds && seconds > 0
    ? `https://youtu.be/${videoId}?t=${seconds}`
    : `https://youtu.be/${videoId}`;
}
