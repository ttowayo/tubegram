/**
 * 로컬 파이프라인 검증 스크립트 (DB 불필요).
 *   npx tsx scripts/summarize-once.ts <유튜브URL> [--send]
 * --send 를 붙이면 TELEGRAM_ALLOWED_CHAT_IDS 의 첫 chat 으로 전송.
 */
import "dotenv/config";
import { extractVideoId, fetchVideoDetails } from "../src/lib/youtube";
import { summarizeYoutubeVideo } from "../src/lib/gemini";
import { formatSummaryMessage, sendMessage } from "../src/lib/telegram";
import { env } from "../src/lib/env";
import type { VideoRow } from "../src/lib/supabase";

async function main() {
  const [url, ...flags] = process.argv.slice(2);
  if (!url) {
    console.error("usage: npx tsx scripts/summarize-once.ts <youtube-url> [--send]");
    process.exit(1);
  }
  const youtubeId = extractVideoId(url);
  if (!youtubeId) throw new Error("유튜브 URL 을 인식하지 못했습니다.");

  console.log(`video: ${youtubeId}`);
  const details = (await fetchVideoDetails([youtubeId])).get(youtubeId);
  console.log("details:", details ?? "(none)");

  console.time("gemini");
  const result = await summarizeYoutubeVideo({
    youtubeId,
    title: details?.title,
    channelTitle: details?.channelTitle,
  });
  console.timeEnd("gemini");
  console.log(`model: ${result.model} / chunks: ${result.chunks} / prompt tokens: ${result.promptTokens}`);
  console.log("\n" + result.summaryMd + "\n");

  if (flags.includes("--send")) {
    const chatId = env.ownerChatId;
    if (!chatId) throw new Error("TELEGRAM_ALLOWED_CHAT_IDS 가 비어 있습니다.");
    const now = new Date().toISOString();
    const video: VideoRow = {
      id: 0,
      youtube_id: youtubeId,
      channel_id: details?.channelId ?? null,
      channel_title: details?.channelTitle ?? null,
      source: "manual",
      title: details?.title ?? null,
      thumbnail_url: details?.thumbnailUrl ?? null,
      published_at: details?.publishedAt ?? null,
      duration_sec: details?.durationSec ?? null,
      status: "done",
      locked_at: null,
      attempts: 1,
      error: null,
      requested_by_chat_id: chatId,
      created_at: now,
      updated_at: now,
    };
    await sendMessage(chatId, formatSummaryMessage(video, result.content));
    console.log(`sent to ${chatId}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
