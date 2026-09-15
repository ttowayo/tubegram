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

export interface GeminiModelConfig {
  model: string;
  /** 분당 요청 한도 */
  rpm: number;
  /** 분당 토큰 한도 */
  tpm: number;
}

/**
 * 무료 등급 기본 체인. 일일 요청 한도(RPD)가 큰 순서.
 * gemini-2.5-* 는 신규 사용자에게 404 라 제외했습니다.
 */
const DEFAULT_MODELS: GeminiModelConfig[] = [
  { model: "gemini-3.5-flash-lite", rpm: 15, tpm: 250_000 }, // RPD 500
  { model: "gemini-3.1-flash-lite", rpm: 15, tpm: 250_000 }, // RPD 500
  { model: "gemini-3.8-flash", rpm: 5, tpm: 250_000 },       // RPD 20
  { model: "gemini-3.7-flash", rpm: 5, tpm: 250_000 },
  { model: "gemini-3.6-flash", rpm: 5, tpm: 250_000 },
  { model: "gemini-3.5-flash", rpm: 5, tpm: 250_000 },
  { model: "gemini-3-flash-preview", rpm: 5, tpm: 250_000 },
];

/** "모델:RPM:TPM" 목록을 파싱. RPM/TPM 을 생략하면 기본 체인 값 또는 5/250K */
function parseModels(): GeminiModelConfig[] {
  const raw = (process.env.GEMINI_MODELS ?? "").trim();
  const chain = raw
    ? raw.split(",").map((s) => s.trim()).filter(Boolean).map((entry) => {
        const [model, rpm, tpm] = entry.split(":").map((x) => x.trim());
        const preset = DEFAULT_MODELS.find((m) => m.model === model);
        return {
          model,
          rpm: Number(rpm) || preset?.rpm || 5,
          tpm: Number(tpm) || preset?.tpm || 250_000,
        };
      }).filter((m) => m.model)
    : [...DEFAULT_MODELS];

  // 기존 GEMINI_MODEL 설정을 존중: 체인 맨 앞으로 끌어올림
  const head = (process.env.GEMINI_MODEL ?? "").trim();
  if (head && !raw) {
    const preset = chain.find((m) => m.model === head);
    const rest = chain.filter((m) => m.model !== head);
    return [preset ?? { model: head, rpm: 5, tpm: 250_000 }, ...rest];
  }
  return chain;
}

export const env = {
  get supabaseUrl() { return req("SUPABASE_URL"); },
  get supabaseServiceKey() { return req("SUPABASE_SERVICE_ROLE_KEY"); },
  get geminiApiKey() { return req("GEMINI_API_KEY"); },
  /**
   * 한도에 걸리면 앞에서부터 차례로 넘어가는 모델 체인.
   * "모델:RPM:TPM" 을 쉼표로 구분. GEMINI_MODEL 만 설정되어 있으면 그 모델이 맨 앞에 옵니다.
   */
  get geminiModels(): GeminiModelConfig[] { return parseModels(); },
  /** 영상 입력 프레임 수(초당). 낮출수록 토큰 절약 (0.2 ≈ 초당 46토큰) */
  get geminiVideoFps() { return num("GEMINI_VIDEO_FPS", 0.2); },
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
  /** 하루 처리량 상한(영상 분량). Gemini 한도가 아니라 폭주 방어용 */
  get dailyVideoMinutesBudget() { return num("DAILY_VIDEO_MINUTES_BUDGET", 600); },
};
