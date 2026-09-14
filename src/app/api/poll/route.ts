import { after } from "next/server";
import { cronAuthorized } from "@/lib/auth";
import { pollChannels } from "@/lib/poll";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * 외부 크론(cron-job.org 등)이 15분마다 호출. Authorization: Bearer CRON_SECRET 또는 ?secret=
 * 기본은 즉시 202 로 응답하고 실제 폴링/요약은 응답 이후에 실행 (외부 크론의 짧은 타임아웃 대응).
 * ?sync=1 을 붙이면 완료까지 기다렸다가 결과를 반환 (디버깅용).
 */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response("unauthorized", { status: 401 });
  const sync = new URL(req.url).searchParams.get("sync") === "1";

  if (sync) {
    const started = Date.now();
    const result = await pollChannels(200_000);
    return Response.json({ ...result, ms: Date.now() - started });
  }

  after(async () => {
    try {
      const r = await pollChannels(200_000);
      console.log("[poll]", JSON.stringify(r));
    } catch (e) {
      console.error("[poll] failed:", e);
    }
  });
  return Response.json({ accepted: true }, { status: 202 });
}
