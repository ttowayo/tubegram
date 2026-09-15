import Link from "next/link";
import { monthGrid, shiftMonth } from "@/lib/date";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 건수를 0~4단계 농도로 */
function level(count: number): string {
  if (count <= 0) return "";
  if (count <= 2) return " lv1";
  if (count <= 5) return " lv2";
  if (count <= 10) return " lv3";
  return " lv4";
}

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
    <section className="panel calendar">
      <div className="cal-head">
        <Link href={`/d/${selected}?m=${prev}`} className="icon-btn" aria-label="이전 달">‹</Link>
        <div className="cal-title">
          {y}년 {Number(m)}월 <span className="muted">· {total}건</span>
        </div>
        {next <= thisMonth
          ? <Link href={`/d/${selected}?m=${next}`} className="icon-btn" aria-label="다음 달">›</Link>
          : <span className="icon-btn disabled" aria-hidden="true">›</span>}
      </div>

      <div className="cal-grid">
        {WEEKDAYS.map((w, i) => (
          <div key={w} className={`cal-weekday${i === 0 ? " sun" : i === 6 ? " sat" : ""}`}>{w}</div>
        ))}
        {monthGrid(month).map((date, i) => {
          if (!date) return <div key={`e${i}`} className="cal-cell blank" />;
          const count = counts.get(date) ?? 0;
          const cls = [
            "cal-cell",
            date === selected ? "selected" : level(count).trim(),
            date === today ? "today" : "",
            date > today ? "future" : "",
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
            : (
              <Link
                key={date}
                href={`/d/${date}`}
                className={cls}
                aria-label={`${date} 요약 ${count}건`}
                aria-current={date === selected ? "date" : undefined}
              >
                {inner}
              </Link>
            );
        })}
      </div>

      {month !== thisMonth && (
        <div className="cal-foot"><Link href="/" className="chip">오늘로 이동</Link></div>
      )}
    </section>
  );
}
