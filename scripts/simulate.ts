/**
 * 웹훅 없이 봇 명령을 로컬에서 실행합니다. 결과 메시지는 실제 텔레그램으로 전송됩니다.
 *   npm run bot -- "/subscribe @GoogleDevelopers"
 *   npm run bot -- "/list"
 *   npm run bot -- "https://youtu.be/XXXXXXXXXXX"     # 수동 요약 (큐 처리까지 수행)
 *   npm run bot -- --poll                              # 채널 폴링 1회
 */
import "dotenv/config";
import { env } from "../src/lib/env";
import { handleUpdate } from "../src/lib/bot";
import { processQueue } from "../src/lib/pipeline";
import { pollChannels } from "../src/lib/poll";

async function main() {
  const text = process.argv.slice(2).join(" ").trim();
  if (!text) {
    console.error('usage: npm run bot -- "/list"  |  npm run bot -- --poll');
    process.exit(1);
  }
  if (text === "--poll") {
    console.log(await pollChannels());
    return;
  }
  const chatId = env.ownerChatId;
  if (!chatId) throw new Error("TELEGRAM_ALLOWED_CHAT_IDS 가 비어 있습니다.");

  const { process: shouldProcess } = await handleUpdate({
    update_id: Date.now(),
    message: {
      message_id: 1,
      text,
      chat: { id: chatId, type: "private", first_name: "local" },
      from: { id: chatId, first_name: "local" },
    },
  });
  console.log("handled; process =", shouldProcess);
  if (shouldProcess) {
    console.time("processQueue");
    console.log(await processQueue());
    console.timeEnd("processQueue");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
