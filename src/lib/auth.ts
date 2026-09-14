import { env } from "./env";

/** 크론/폴링 엔드포인트 인증: Authorization: Bearer CRON_SECRET 또는 ?secret= */
export function cronAuthorized(req: Request): boolean {
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${env.cronSecret}`) return true;
  const url = new URL(req.url);
  return url.searchParams.get("secret") === env.cronSecret;
}
