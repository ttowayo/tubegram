import { GoogleGenAI, ApiError } from "@google/genai";
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

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    one_liner: { type: "string" },
    key_points: { type: "array", items: { type: "string" } },
    timeline: {
      type: "array",
      items: {
        type: "object",
        properties: {
          timestamp: { type: "string" },
          text: { type: "string" },
        },
        required: ["timestamp", "text"],
      },
    },
    conclusion: { type: "string" },
  },
  required: ["one_liner", "key_points", "timeline", "conclusion"],
} as const;

export interface SummarizeInput {
  youtubeId: string;
  title?: string | null;
  channelTitle?: string | null;
}

export interface SummarizeResult {
  content: SummaryContent;
  summaryMd: string;
  model: string;
}

export async function summarizeYoutubeVideo(input: SummarizeInput): Promise<SummarizeResult> {
  const ai = new GoogleGenAI({ apiKey: env.geminiApiKey });
  const model = env.geminiModel;
  const url = `https://www.youtube.com/watch?v=${input.youtubeId}`;
  const meta = [
    input.title ? `제목: ${input.title}` : null,
    input.channelTitle ? `채널: ${input.channelTitle}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  let text: string | undefined;
  try {
    const res = await ai.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            { fileData: { fileUri: url, mimeType: "video/*" } },
            { text: `${meta ? meta + "\n\n" : ""}이 영상을 요약해 주세요.` },
          ],
        },
      ],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseJsonSchema: RESPONSE_SCHEMA,
        temperature: 0.3,
      },
    });
    text = res.text;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 429 || e.status === 503)) {
      throw new GeminiRateLimitError(`Gemini ${e.status}: ${e.message}`);
    }
    throw e;
  }

  if (!text) throw new Error("Gemini returned empty response");
  const content = normalize(JSON.parse(stripFence(text)) as Partial<SummaryContent>);
  return { content, summaryMd: toMarkdown(content), model };
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
