import Link from "next/link";
import { countSummariesByMonth, listSummariesByDate, type SummaryWithVideo } from "@/lib/queries";
import { kstDate, monthOf, shiftDate } from "@/lib/date";
import { Calendar } from "./Calendar";
import { SummaryCard } from "./SummaryCard";

const PAGE_SIZE = 5;

interface Props {
  date: string;
  month?: string;
  page?: number;
}

export async function DayView({ date, month, page = 1 }: Props) {
  const today = kstDate();
  const calMonth = month ?? monthOf(date);
  const [items, counts] = await Promise.all([listSummariesByDate(date), countSummariesByMonth(calMonth)]);
  const prev = shiftDate(date, -1);
  const next = shiftDate(date, 1);

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), totalPages);
  const pageItems = items.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const groups = groupByChannel(pageItems);
  const pageHref = (p: number) => `/d/${date}?p=${p}${month ? `&m=${month}` : ""}#list`;

  return (
    <>
      <Calendar month={calMonth} selected={date} today={today} counts={counts} />

      <div className="day-head" id="list">
        <Link href={`/d/${prev}`} className="day-nav" aria-label="이전 날">‹</Link>
        <div>
          <h1>{date === today ? "오늘의 요약" : `${date} 요약`}</h1>
          <p className="muted">
            {date} · {items.length}건
            {totalPages > 1 && <> · {current}/{totalPages} 페이지</>}
          </p>
        </div>
        {next <= today
          ? <Link href={`/d/${next}`} className="day-nav" aria-label="다음 날">›</Link>
          : <span className="day-nav disabled">›</span>}
      </div>

      {items.length === 0 ? (
        <div className="empty">이 날짜에 저장된 요약이 없습니다. 달력에서 숫자가 표시된 날을 눌러 보세요.</div>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="channel-group">
            <h2 className="channel-title">
              {g.channelId
                ? <Link href={`/c/${g.channelId}`}>{g.title}</Link>
                : g.title}
              <span className="muted"> {g.items.length}</span>
            </h2>
            <div className="card-list">
              {g.items.map((s) => (
                <SummaryCard key={s.id} video={s.videos} content={s.content} backTo={pageHref(current)} />
              ))}
            </div>
          </section>
        ))
      )}

      {totalPages > 1 && (
        <nav className="pagination" aria-label="페이지">
          {current > 1
            ? <Link href={pageHref(current - 1)} className="page-link">‹ 이전</Link>
            : <span className="page-link disabled">‹ 이전</span>}
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) =>
            p === current
              ? <span key={p} className="page-link current" aria-current="page">{p}</span>
              : <Link key={p} href={pageHref(p)} className="page-link">{p}</Link>,
          )}
          {current < totalPages
            ? <Link href={pageHref(current + 1)} className="page-link">다음 ›</Link>
            : <span className="page-link disabled">다음 ›</span>}
        </nav>
      )}
    </>
  );
}

interface Group {
  key: string;
  title: string;
  channelId: string | null;
  items: SummaryWithVideo[];
}

function groupByChannel(items: SummaryWithVideo[]): Group[] {
  const map = new Map<string, Group>();
  for (const s of items) {
    const v = s.videos;
    const key = v.channel_id ?? v.channel_title ?? "_manual";
    let g = map.get(key);
    if (!g) {
      g = { key, title: v.channel_title ?? "직접 등록", channelId: v.channel_id, items: [] };
      map.set(key, g);
    }
    g.items.push(s);
  }
  return [...map.values()].sort((a, b) => b.items.length - a.items.length || a.title.localeCompare(b.title, "ko"));
}
