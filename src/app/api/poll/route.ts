import { cronAuthorized } from "@/lib/auth";
import { pollChannels } from "@/lib/poll";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** 외부 크론(cron-job.org 등)이 15분마다 호출. Authorization: Bearer CRON_SECRET 또는 ?secret= */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response("unauthorized", { status: 401 });
  const started = Date.now();
  const result = await pollChannels(200_000);
  return Response.json({ ...result, ms: Date.now() - started });
}
