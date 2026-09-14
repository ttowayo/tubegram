/**
 * 텔레그램 웹훅과 명령 목록 등록.
 *   npx tsx scripts/set-webhook.ts            # APP_URL 기준으로 등록
 *   npx tsx scripts/set-webhook.ts --delete   # 웹훅 해제
 *   npx tsx scripts/set-webhook.ts --info     # 현재 상태 확인
 */
import "dotenv/config";
import { env } from "../src/lib/env";
import { tg } from "../src/lib/telegram";

async function main() {
  const flag = process.argv[2];

  if (flag === "--info") {
    console.log(JSON.stringify(await tg("getWebhookInfo", {}), null, 2));
    return;
  }
  if (flag === "--delete") {
    console.log(await tg("deleteWebhook", { drop_pending_updates: false }));
    return;
  }

  if (!env.appUrl) throw new Error("APP_URL 이 필요합니다.");
  const url = `${env.appUrl}/api/telegram/webhook`;
  console.log("setWebhook ->", url);
  console.log(await tg("setWebhook", {
    url,
    secret_token: env.telegramWebhookSecret,
    allowed_updates: ["message"],
    drop_pending_updates: true,
  }));

  console.log(await tg("setMyCommands", {
    commands: [
      { command: "subscribe", description: "채널 구독 (@핸들 또는 URL)" },
      { command: "unsubscribe", description: "구독 해지" },
      { command: "list", description: "구독 목록" },
      { command: "latest", description: "채널 최신 영상 요약" },
      { command: "today", description: "구독 채널의 오늘 영상 모두 요약" },
      { command: "status", description: "큐/사용량 현황" },
      { command: "pause", description: "알림 일시정지" },
      { command: "resume", description: "알림 재개" },
      { command: "help", description: "도움말" },
    ],
  }));
  console.log(JSON.stringify(await tg("getWebhookInfo", {}), null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
