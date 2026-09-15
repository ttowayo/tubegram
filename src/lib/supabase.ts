import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

export type VideoStatus = "pending" | "processing" | "done" | "failed" | "skipped";
export type VideoSource = "channel" | "manual";

export interface ChatRow {
  chat_id: number;
  name: string | null;
  is_active: boolean;
  created_at: string;
}

export interface ChannelRow {
  id: number;
  channel_id: string;
  title: string;
  handle: string | null;
  thumbnail_url: string | null;
  uploads_playlist_id: string | null;
  baseline_published_at: string;
  /** 요약 시간대 필터: KST 자정 기준 분, [start, end). 둘 다 null 이면 전체 */
  window_start_min: number | null;
  window_end_min: number | null;
  last_checked_at: string | null;
  websub_lease_expires_at: string | null;
  is_active: boolean;
  created_at: string;
}

export interface SubscriptionRow {
  chat_id: number;
  channel_id: string;
  created_at: string;
}

export interface VideoRow {
  id: number;
  youtube_id: string;
  channel_id: string | null;
  channel_title: string | null;
  source: VideoSource;
  title: string | null;
  thumbnail_url: string | null;
  published_at: string | null;
  duration_sec: number | null;
  status: VideoStatus;
  locked_at: string | null;
  attempts: number;
  error: string | null;
  requested_by_chat_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface SummaryContent {
  one_liner: string;
  key_points: string[];
  timeline: { timestamp: string; text: string }[];
  conclusion: string;
}

export interface SummaryRow {
  id: number;
  video_id: number;
  summary_md: string;
  content: SummaryContent;
  model: string | null;
  summary_date: string;
  created_at: string;
}

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
