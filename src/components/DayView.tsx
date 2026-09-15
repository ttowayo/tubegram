import Link from "next/link";
import {
  countSummariesByMonth,
  listRecentSummaryDates,
  listSummariesByDate,
  type DayCount,
  type SummaryWithVideo,
} from "@/lib/queries";
import { formatDayLabel, formatDayShort, kstDate, monthOf, shiftDate } from "@/lib/date";
import { Calendar } from "./Calendar";
import { SummaryCard } from "./SummaryCard";

const PAGE_SIZE = 12;

interface Props {
  date: string;
  month?: string;
  page?: number;
}

export async function DayView({ date, month, page = 1 }: Props) {
  const today = kstDate();
  const calMonth = month ?? monthOf(date);
  const [items, counts, recent] = await Promise.all([
    listSummariesByDate(date),
    countSummariesByMonth(calMonth),
    listRecentSummaryDates(8),
  ]);
  const prev = shiftDate(date, -1);
  const next = shiftDate(date, 1);

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), totalPages);
  const pageItems = items.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const groups = groupByChannel(pageItems);
  const pageHref = (p: number) => `/d/${date}?p=${p}${month ? `&m=${month}` : ""}#list`;

  return (
    <div className="dash">
      <aside className="rail">
        <Calendar month={calMonth} selected={date} today={today} counts={counts} />
        {recent.length > 0 && (
          <section className="panel">
            <div className="panel-head"><span className="panel-title">최근 요약</span></div>
            <div className="panel-body recent-list">
              {recent.map((r) => (
                <Link
                  key={r.date}
                  href={`/d/${r.date}`}
                  className="recent-item"
                  aria-current={r.date === date ? "true" : undefined}
                >
                  <span>{formatDayLabel(r.date)}</span>
                  <span className="n">{r.count}건</span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </aside>

      <div id="list">
        <div className="day-head">
          <div>
            <h1>{date === today ? "오늘의 요약" : formatDayLabel(date)}</h1>
            <p className="sub">
              {date} · <b>{items.length}</b>건
              {totalPages > 1 && <> · {current}/{totalPages} 페이지</>}
            </p>
          </div>
          <div className="day-nav">
            <Link href={`/d/${prev}`} className="icon-btn" aria-label="이전 날">‹</Link>
            {next <= today
              ? <Link href={`/d/${next}`} className="icon-btn" aria-label="다음 날">›</Link>
              : <span className="icon-btn disabled" aria-hidden="true">›</span>}
          </div>
        </div>

        {items.length === 0 ? (
          <EmptyDay recent={recent} />
        ) : (
          groups.map((g) => (
            <section key={g.key} className="channel-group">
              <h2 className="channel-title">
                {g.channelId
                  ? <Link href={`/c/${g.channelId}`}>{g.title}</Link>
                  : <span>{g.title}</span>}
                <span className="n">{g.items.length}</span>
                <span className="rule" aria-hidden="true" />
              </h2>
              <div className="card-list">
                {g.items.map((s) => (
                  <SummaryCard
                    key={s.id}
                    video={s.videos}
                    content={s.content}
                    backTo={pageHref(current)}
                    hideChannel
                  />
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
      </div>
    </div>
  );
}

/** 요약이 없는 날: 빈 문장 대신 요약이 있는 날로 바로 갈 수 있게 */
function EmptyDay({ recent }: { recent: DayCount[] }) {
  return (
    <div className="empty">
      <p className="empty-title">이 날짜에는 저장된 요약이 없습니다.</p>
      {recent.length > 0 ? (
        <>
          <p className="empty-hint">요약이 있는 날로 이동해 보세요.</p>
          <div className="chip-row">
            {recent.slice(0, 6).map((r) => (
              <Link key={r.date} href={`/d/${r.date}`} className="chip">
                {formatDayShort(r.date)}
                <span className="n">{r.count}</span>
              </Link>
            ))}
          </div>
        </>
      ) : (
        <p className="empty-hint">
          아직 요약이 없습니다. <Link href="/c">채널을 등록</Link>하면 새 영상이 올라올 때 자동으로 쌓입니다.
        </p>
      )}
    </div>
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
