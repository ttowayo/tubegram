function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing env: ${name}`);
  return v;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  get supabaseUrl() { return req("SUPABASE_URL"); },
  get supabaseServiceKey() { return req("SUPABASE_SERVICE_ROLE_KEY"); },
  get geminiApiKey() { return req("GEMINI_API_KEY"); },
  get geminiModel() { return req("GEMINI_MODEL", "gemini-3.5-flash-lite"); },
  /** 영상 입력 프레임 수(초당). 낮출수록 토큰 절약 (0.2 ≈ 초당 46토큰) */
  get geminiVideoFps() { return num("GEMINI_VIDEO_FPS", 0.2); },
  /** 무료 등급 분당 토큰 한도 (Flash/Flash Lite 250K) */
  get geminiTpmLimit() { return num("GEMINI_TPM_LIMIT", 250_000); },
  /** 무료 등급 분당 요청 한도 (Flash 5, Flash Lite 15) */
  get geminiRpmLimit() { return num("GEMINI_RPM_LIMIT", 15); },
  get youtubeApiKey(): string { return process.env.YOUTUBE_API_KEY ?? ""; },
  get telegramBotToken() { return req("TELEGRAM_BOT_TOKEN"); },
  get telegramWebhookSecret() { return req("TELEGRAM_WEBHOOK_SECRET"); },
  get allowedChatIds(): number[] {
    return (process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isFinite(n));
  },
  get ownerChatId(): number | null { return this.allowedChatIds[0] ?? null; },
  get cronSecret() { return req("CRON_SECRET"); },
  get registerToken() { return req("REGISTER_TOKEN"); },
  get appUrl(): string {
    const explicit = process.env.APP_URL;
    if (explicit) return explicit.replace(/\/$/, "");
    const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    return vercel ? `https://${vercel}` : "";
  },
  get maxVideoMinutes() { return num("MAX_VIDEO_MINUTES", 90); },
  get minVideoSeconds() { return num("MIN_VIDEO_SECONDS", 60); },
  get dailyVideoMinutesBudget() { return num("DAILY_VIDEO_MINUTES_BUDGET", 420); },
};
