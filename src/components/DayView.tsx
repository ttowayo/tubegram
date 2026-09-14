import Link from "next/link";
import { listSummariesByDate, listSummaryDates } from "@/lib/queries";
import { kstDate, shiftDate } from "@/lib/date";
import { SummaryCard } from "./SummaryCard";

export async function DayView({ date }: { date: string }) {
  const today = kstDate();
  const [items, dates] = await Promise.all([listSummariesByDate(date), listSummaryDates()]);
  const prev = shiftDate(date, -1);
  const next = shiftDate(date, 1);

  return (
    <>
      <h1>{date === today ? "오늘의 요약" : `${date} 요약`}</h1>
      <p className="muted">{date} · {items.length}건</p>

      <div className="date-nav">
        <Link href={`/d/${prev}`}>← {prev}</Link>
        {next <= today ? <Link href={`/d/${next}`}>{next} →</Link> : <span className="muted">{next} →</span>}
        {date !== today && <Link href="/">오늘</Link>}
      </div>

      {items.length === 0 ? (
        <div className="empty">이 날짜에 저장된 요약이 없습니다.</div>
      ) : (
        <div className="card-list">
          {items.map((s) => <SummaryCard key={s.id} video={s.videos} content={s.content} />)}
        </div>
      )}

      {dates.length > 0 && (
        <>
          <h2>요약이 있는 날</h2>
          <div className="chip-row">
            {dates.map((d) => (
              <Link key={d.date} href={`/d/${d.date}`} className="chip">{d.date} ({d.count})</Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}
