import Link from "next/link";
import { monthGrid, shiftMonth } from "@/lib/date";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

interface Props {
  month: string;              // YYYY-MM
  selected: string;           // YYYY-MM-DD
  today: string;              // YYYY-MM-DD
  counts: Map<string, number>;
}

export function Calendar({ month, selected, today, counts }: Props) {
  const [y, m] = month.split("-");
  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const thisMonth = today.slice(0, 7);

  return (
    <section className="calendar">
      <div className="cal-head">
        <Link href={`/d/${selected}?m=${prev}`} className="cal-nav" aria-label="이전 달">‹</Link>
        <div className="cal-title">
          <strong>{y}년 {Number(m)}월</strong>
          <span className="muted"> · 요약 {total}건</span>
        </div>
        {next <= thisMonth
          ? <Link href={`/d/${selected}?m=${next}`} className="cal-nav" aria-label="다음 달">›</Link>
          : <span className="cal-nav disabled">›</span>}
      </div>
      {month !== thisMonth && (
        <div className="cal-today-link"><Link href="/">오늘로</Link></div>
      )}
      <div className="cal-grid">
        {WEEKDAYS.map((w, i) => (
          <div key={w} className={`cal-weekday${i === 0 ? " sun" : i === 6 ? " sat" : ""}`}>{w}</div>
        ))}
        {monthGrid(month).map((date, i) => {
          if (!date) return <div key={`e${i}`} className="cal-cell empty" />;
          const count = counts.get(date) ?? 0;
          const cls = [
            "cal-cell",
            date === selected ? "selected" : "",
            date === today ? "today" : "",
            date > today ? "future" : "",
            count > 0 ? "has" : "",
            i % 7 === 0 ? "sun" : i % 7 === 6 ? "sat" : "",
          ].filter(Boolean).join(" ");
          const inner = (
            <>
              <span className="day">{Number(date.slice(8))}</span>
              {count > 0 && <span className="count">{count}</span>}
            </>
          );
          return date > today
            ? <div key={date} className={cls}>{inner}</div>
            : <Link key={date} href={`/d/${date}`} className={cls}>{inner}</Link>;
        })}
      </div>
    </section>
  );
}
