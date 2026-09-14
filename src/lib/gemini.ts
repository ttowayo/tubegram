import { GoogleGenAI, ApiError, MediaResolution, type Part } from "@google/genai";
import { env } from "./env";
import type { SummaryContent } from "./supabase";

export class GeminiRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiRateLimitError";
  }
}

const SYSTEM_PROMPT = `당신은 유튜브 영상을 한국어로 요약하는 전문가입니다.
영상을 처음부터 끝까지 본 뒤, 요청된 JSON 형식으로만 답하세요.

- one_liner: 이 영상이 무엇을 다루는지 소개하는 한 문장 (예: "~를 소개하는 영상", "~하는 방법을 설명하는 영상"). 결론을 쓰지 말고 주제만 알려주세요.
- key_points: 핵심 요점 3~7개. 각 항목은 한두 문장으로 구체적으로.
- timeline: 영상 흐름을 시간순으로 4~10개 구간. timestamp 는 "mm:ss" 또는 "h:mm:ss" 형식. text 는 그 구간에서 다룬 내용 요약.
- conclusion: 영상 전체를 보고 난 뒤 시청자가 얻어갈 결론이나 실행 제안 한두 문장. one_liner 와 같은 문장을 반복하지 마세요.

규칙:
- 영상에 나오지 않은 내용을 지어내지 마세요.
- 숫자, 고유명사, 제품명은 영상에서 말한 그대로 쓰세요.
- 영상 언어가 무엇이든 결과는 자연스러운 한국어로 작성하세요.`;

const CHUNK_PROMPT = `당신은 유튜브 영상의 일부 구간을 한국어로 정리하는 전문가입니다.
주어진 구간만 보고 요청된 JSON 형식으로만 답하세요.

- key_points: 이 구간의 핵심 요점 3~6개. 한두 문장씩 구체적으로.
- timeline: 이 구간의 흐름을 시간순으로 3~6개. timestamp 는 "mm:ss" 형식이며 **주어진 구간의 시작을 00:00 으로** 계산하세요.

규칙: 영상에 나오지 않은 내용을 지어내지 말고, 숫자와 고유명사는 그대로 쓰세요. 결과는 한국어로 작성하세요.`;

const MERGE_PROMPT = `당신은 긴 유튜브 영상을 구간별로 정리한 메모를 하나의 요약으로 합치는 편집자입니다.
아래 구간별 메모(JSON)를 바탕으로 요청된 JSON 형식으로만 답하세요.

- one_liner: 영상이 무엇을 다루는지 소개하는 한 문장. 결론은 쓰지 마세요.
- key_points: 전체 영상의 핵심 요점 3~7개. 구간 메모의 요점을 중복 없이 통합하세요.
- timeline: 전체 흐름을 대표하는 4~10개 항목. **timestamp 는 메모에 있는 값을 그대로 사용**하고 새로 만들지 마세요.
- conclusion: 시청자가 얻어갈 결론이나 실행 제안 한두 문장. one_liner 와 같은 문장을 반복하지 마세요.

메모에 없는 내용을 지어내지 마세요. 한국어로 작성하세요.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    one_liner: { type: "string" },
    key_points: { type: "array", items: { type: "string" } },
    timeline: {
      type: "array",
      items: {
        type: "object",
        properties: { timestamp: { type: "string" }, text: { type: "string" } },
        required: ["timestamp", "text"],
      },
    },
    conclusion: { type: "string" },
  },
  required: ["one_liner", "key_points", "timeline", "conclusion"],
} as const;

const CHUNK_SCHEMA = {
  type: "object",
  properties: {
    key_points: { type: "array", items: { type: "string" } },
    timeline: {
      type: "array",
      items: {
        type: "object",
        properties: { timestamp: { type: "string" }, text: { type: "string" } },
        required: ["timestamp", "text"],
      },
    },
  },
  required: ["key_points", "timeline"],
} as const;

export interface SummarizeInput {
  youtubeId: string;
  title?: string | null;
  channelTitle?: string | null;
  durationSec?: number | null;
}

export interface SummarizeResult {
  content: SummaryContent;
  summaryMd: string;
  model: string;
  /** 실제 사용한 프롬프트 토큰 합계 */
  promptTokens: number;
  chunks: number;
}

// ---------- 토큰 추정 / 속도 조절 ----------

/** 저해상도 영상 입력의 초당 토큰 추정치 (오디오 ≈ 32 + 프레임 66 × fps, 여유 포함) */
export function estimateVideoTokens(durationSec: number, fps = env.geminiVideoFps): number {
  return Math.ceil(durationSec * (37 + 66 * fps)) + 600;
}

/** 한 요청에 담을 최대 토큰: 분당 한도의 80% */
function chunkTokenBudget(): number {
  return Math.floor(env.geminiTpmLimit * 0.8);
}

const ledger: { at: number; tokens: number }[] = [];
let lastRequestAt = 0;

/** 분당 토큰/요청 한도를 넘지 않도록 필요하면 대기 */
async function reserve(tokens: number): Promise<void> {
  const windowMs = 60_000;
  const minGapMs = Math.ceil(windowMs / env.geminiRpmLimit) + 300;

  for (;;) {
    const now = Date.now();
    while (ledger.length && ledger[0].at < now - windowMs) ledger.shift();
    const used = ledger.reduce((a, b) => a + b.tokens, 0);
    const gapWait = lastRequestAt + minGapMs - now;
    const tpmWait = used + tokens > env.geminiTpmLimit && ledger.length ? ledger[0].at + windowMs - now + 500 : 0;
    const wait = Math.max(gapWait, tpmWait);
    if (wait <= 0) break;
    await new Promise((r) => setTimeout(r, Math.min(wait, windowMs)));
  }
  lastRequestAt = Date.now();
  ledger.push({ at: lastRequestAt, tokens });
}

// ---------- 요약 ----------

export async function summarizeYoutubeVideo(input: SummarizeInput): Promise<SummarizeResult> {
  const ai = new GoogleGenAI({ apiKey: env.geminiApiKey });
  const model = env.geminiModel;
  const url = `https://www.youtube.com/watch?v=${input.youtubeId}`;
  const meta = [
    input.title ? `제목: ${input.title}` : null,
    input.channelTitle ? `채널: ${input.channelTitle}` : null,
  ].filter(Boolean).join("\n");

  const duration = input.durationSec && input.durationSec > 0 ? input.durationSec : null;
  const est = estimateVideoTokens(duration ?? 600);
  const budget = chunkTokenBudget();

  // 한 번에 처리 가능한 길이면 단일 요청
  if (!duration || est <= budget) {
    await reserve(est);
    const { data, usage } = await generateJson<Partial<SummaryContent>>(ai, model, SYSTEM_PROMPT, RESPONSE_SCHEMA, [
      videoPart(url),
      { text: `${meta ? meta + "\n\n" : ""}이 영상을 요약해 주세요.` },
    ]);
    const content = normalize(data);
    return { content, summaryMd: toMarkdown(content), model, promptTokens: usage, chunks: 1 };
  }

  // 긴 영상: 구간별 요약 후 병합
  const chunks = Math.ceil(est / budget);
  const chunkLen = Math.ceil(duration / chunks);
  const notes: { start: number; end: number; key_points: string[]; timeline: { timestamp: string; text: string }[] }[] = [];
  let usedTokens = 0;

  for (let i = 0; i < chunks; i++) {
    const start = i * chunkLen;
    const end = Math.min(duration, (i + 1) * chunkLen);
    await reserve(estimateVideoTokens(end - start));
    const { data, usage } = await generateJson<{ key_points?: string[]; timeline?: { timestamp?: string; text?: string }[] }>(
      ai, model, CHUNK_PROMPT, CHUNK_SCHEMA, [
        videoPart(url, start, end),
        { text: `${meta ? meta + "\n\n" : ""}이 영상의 ${fmt(start)} ~ ${fmt(end)} 구간(${i + 1}/${chunks})입니다. 이 구간을 정리해 주세요.` },
      ],
    );
    usedTokens += usage;
    notes.push({
      start,
      end,
      key_points: (data.key_points ?? []).map(String).filter(Boolean),
      timeline: (data.timeline ?? [])
        .map((t) => ({ timestamp: shiftTimestamp(String(t?.timestamp ?? ""), start), text: String(t?.text ?? "").trim() }))
        .filter((t) => t.text),
    });
  }

  const notesText = notes
    .map((n) => JSON.stringify({ range: `${fmt(n.start)}~${fmt(n.end)}`, key_points: n.key_points, timeline: n.timeline }))
    .join("\n");
  await reserve(Math.ceil(notesText.length / 2) + 2000);
  const { data, usage } = await generateJson<Partial<SummaryContent>>(ai, model, MERGE_PROMPT, RESPONSE_SCHEMA, [
    { text: `${meta ? meta + "\n\n" : ""}영상 길이: ${fmt(duration)}\n\n구간별 메모:\n${notesText}` },
  ]);
  usedTokens += usage;
  const content = normalize(data);
  return { content, summaryMd: toMarkdown(content), model, promptTokens: usedTokens, chunks };
}

function videoPart(url: string, startSec?: number, endSec?: number): Part {
  const videoMetadata: NonNullable<Part["videoMetadata"]> = { fps: env.geminiVideoFps };
  if (startSec !== undefined) videoMetadata.startOffset = `${startSec}s`;
  if (endSec !== undefined) videoMetadata.endOffset = `${endSec}s`;
  return { fileData: { fileUri: url, mimeType: "video/*" }, videoMetadata };
}

async function generateJson<T>(
  ai: GoogleGenAI,
  model: string,
  systemInstruction: string,
  schema: unknown,
  parts: Part[],
): Promise<{ data: T; usage: number }> {
  let text: string | undefined;
  let usage = 0;
  try {
    const res = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseJsonSchema: schema,
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
        temperature: 0.3,
      },
    });
    text = res.text;
    usage = res.usageMetadata?.promptTokenCount ?? 0;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 429 || e.status === 503)) {
      throw new GeminiRateLimitError(`Gemini ${e.status}: ${e.message.slice(0, 300)}`);
    }
    throw e;
  }
  if (!text) throw new Error("Gemini returned empty response");
  return { data: JSON.parse(stripFence(text)) as T, usage };
}

// ---------- 유틸 ----------

function fmt(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** 구간 기준 "mm:ss" 를 영상 전체 기준으로 이동 */
function shiftTimestamp(ts: string, offsetSec: number): string {
  const parts = ts.trim().split(":").map(Number);
  if (parts.length === 0 || parts.some((n) => !Number.isFinite(n))) return ts;
  const rel = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : parts.length === 2 ? parts[0] * 60 + parts[1]
    : parts[0];
  return fmt(rel + offsetSec);
}

function stripFence(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function normalize(c: Partial<SummaryContent>): SummaryContent {
  return {
    one_liner: String(c.one_liner ?? "").trim(),
    key_points: (c.key_points ?? []).map((s) => String(s).trim()).filter(Boolean),
    timeline: (c.timeline ?? [])
      .map((t) => ({ timestamp: String(t?.timestamp ?? "").trim(), text: String(t?.text ?? "").trim() }))
      .filter((t) => t.text),
    conclusion: String(c.conclusion ?? "").trim(),
  };
}

export function toMarkdown(c: SummaryContent): string {
  const lines: string[] = [];
  if (c.one_liner) lines.push(`**${c.one_liner}**`, "");
  if (c.key_points.length) {
    lines.push("## 핵심 요점");
    for (const p of c.key_points) lines.push(`- ${p}`);
    lines.push("");
  }
  if (c.timeline.length) {
    lines.push("## 타임라인");
    for (const t of c.timeline) lines.push(`- ${t.timestamp} ${t.text}`);
    lines.push("");
  }
  if (c.conclusion) lines.push("## 결론", c.conclusion);
  return lines.join("\n").trim();
}
