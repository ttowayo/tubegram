/**
 * 환경 점검: 각 외부 서비스 연결과 DB 스키마를 확인합니다.
 *   npm run check
 */
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { env } from "../src/lib/env";
import { db } from "../src/lib/supabase";
import { tg } from "../src/lib/telegram";
import { fetchVideoDetails } from "../src/lib/youtube";

const TABLES = ["chats", "channels", "subscriptions", "videos", "summaries", "deliveries", "usage_daily"];
let failed = 0;

function ok(label: string, detail = "") {
  console.log(`  OK   ${label}${detail ? "  " + detail : ""}`);
}
function bad(label: string, detail: string) {
  failed++;
  console.log(`  FAIL ${label}  ${detail}`);
}

async function checkSupabase() {
  console.log("Supabase");
  if (/xxxx\.supabase\.co/.test(process.env.SUPABASE_URL ?? "")) {
    bad("SUPABASE_URL", "아직 예시값입니다. Project Settings > API > Project URL 값을 넣으세요.");
    return;
  }
  for (const t of TABLES) {
    const { error } = await db().from(t).select("*").limit(1);
    if (error) bad(`table ${t}`, error.message + " (supabase/schema.sql 실행 여부 확인)");
    else ok(`table ${t}`);
  }
  const { error } = await db().rpc("add_usage", { p_day: "2000-01-01", p_seconds: 0 });
  if (error) bad("function add_usage", error.message);
  else {
    ok("function add_usage");
    await db().from("usage_daily").delete().eq("day", "2000-01-01");
  }
}

async function checkTelegram() {
  console.log("Telegram");
  try {
    const me = await tg<{ username: string }>("getMe", {});
    ok("bot token", `@${me.username}`);
  } catch (e) {
    bad("bot token", String(e instanceof Error ? e.message : e));
    return;
  }
  if (env.allowedChatIds.length === 0) bad("TELEGRAM_ALLOWED_CHAT_IDS", "비어 있음");
  else ok("allowed chat ids", env.allowedChatIds.join(", "));
  try {
    const info = await tg<{ url?: string }>("getWebhookInfo", {});
    ok("webhook", info.url || "(미등록: 배포 후 npm run webhook)");
  } catch (e) {
    bad("webhook info", String(e instanceof Error ? e.message : e));
  }
}

async function checkGemini() {
  console.log("Gemini");
  try {
    const ai = new GoogleGenAI({ apiKey: env.geminiApiKey });
    const res = await ai.models.generateContent({
      model: env.geminiModel,
      contents: "한 단어로 답하세요: 안녕",
    });
    ok(`model ${env.geminiModel}`, JSON.stringify(res.text ?? "").slice(0, 40));
  } catch (e) {
    bad(`model ${env.geminiModel}`, String(e instanceof Error ? e.message : e).slice(0, 300));
  }
}

async function checkYoutube() {
  console.log("YouTube Data API");
  if (!env.youtubeApiKey) {
    ok("api key", "(없음: RSS/oEmbed/스크래핑으로 동작)");
    return;
  }
  try {
    const d = (await fetchVideoDetails(["dQw4w9WgXcQ"])).get("dQw4w9WgXcQ");
    if (d?.durationSec) ok("videos.list", `${d.title} (${d.durationSec}s)`);
    else bad("videos.list", "응답에 길이 정보가 없습니다");
  } catch (e) {
    bad("videos.list", String(e instanceof Error ? e.message : e).slice(0, 300));
  }
}

async function main() {
  console.log("Config");
  ok("APP_URL", env.appUrl || "(비어 있음: 배포 후 설정)");
  await checkSupabase();
  await checkTelegram();
  await checkGemini();
  await checkYoutube();
  console.log(failed === 0 ? "\n모든 점검 통과" : `\n${failed}개 항목 실패`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
