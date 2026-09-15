const KST = "Asia/Seoul";

/** YYYY-MM-DD in KST */
export function kstDate(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function formatKst(iso: string | null | undefined, withTime = true): string {
  if (!iso) return "";
  const d = new Date(iso);
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: KST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  }).format(d);
}

export function shiftDate(yyyyMmDd: string, days: number): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

export function formatDuration(sec: number | null | undefined): string {
  if (!sec || sec <= 0) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

/** "1:23:45" | "12:34" -> seconds */
export function timestampToSeconds(ts: string): number | null {
  const parts = ts.trim().split(":").map((p) => Number(p));
  if (parts.length === 0 || parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

/** "2026-09-14" -> "9월 14일 (월)" */
export function formatDayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const w = WEEKDAY_KO[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}월 ${d}일 (${w})`;
}

/** "2026-09-14" -> "9/14" */
export function formatDayShort(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${m}/${d}`;
}

/** "YYYY-MM-DD" -> "YYYY-MM" */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function isValidMonth(s: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** 달력 셀 목록: 앞뒤 빈칸(null) 포함, 일요일 시작 */
export function monthGrid(month: string): (string | null)[] {
  const [y, m] = month.split("-").map(Number);
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = Array(firstWeekday).fill(null);
  for (let d = 1; d <= days; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export interface TimeWindow {
  startMin: number;
  endMin: number;
}

/** KST 기준 자정부터 지난 분 (0~1439) */
export function kstMinuteOfDay(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: KST,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return get("hour") * 60 + get("minute");
}

const WINDOW_RE = /^(\d{1,2})(?::?(\d{2}))?\s*[-~]\s*(\d{1,2})(?::?(\d{2}))?$/;

/** "07:00-09:00" | "0700-0900" | "7-9" | "22:00~02:00" -> KST 분 구간. 인식 실패 시 null */
export function parseTimeWindow(s: string): TimeWindow | null {
  const m = WINDOW_RE.exec(s.trim());
  if (!m) return null;
  const toMin = (h: string, mm?: string) => {
    const hour = Number(h);
    const min = Number(mm ?? "0");
    if (hour > 24 || min > 59) return null;
    const total = hour * 60 + min;
    return total > 1440 ? null : total % 1440; // 24:00 == 00:00
  };
  const startMin = toMin(m[1], m[2]);
  const endMin = toMin(m[3], m[4]);
  if (startMin === null || endMin === null || startMin === endMin) return null;
  return { startMin, endMin };
}

/** 분 구간을 "07:00-09:00" 으로. 끝이 자정이면 24:00 으로 적어 구간을 알아보기 쉽게 한다 */
export function formatTimeWindow(startMin: number, endMin: number): string {
  const hhmm = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
  return `${hhmm(startMin)}-${hhmm(endMin === 0 ? 1440 : endMin)}`;
}

/**
 * iso 시각이 KST 기준 [start, end) 안에 드는지.
 * 구간이 없으면(null) 항상 true, start > end 면 자정을 넘는 구간으로 본다.
 */
export function withinTimeWindow(
  iso: string | null | undefined,
  startMin: number | null,
  endMin: number | null,
): boolean {
  if (startMin === null || endMin === null) return true;
  const t = Date.parse(iso ?? "");
  if (!Number.isFinite(t)) return false;
  const m = kstMinuteOfDay(new Date(t));
  return startMin < endMin ? m >= startMin && m < endMin : m >= startMin || m < endMin;
}
