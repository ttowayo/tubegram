/** 날짜 이동 시 즉시 보이는 자리표시자. 실제 데이터가 오면 교체된다 */
export default function Loading() {
  return (
    <div className="dash">
      <aside className="rail">
        <section className="panel calendar">
          <div className="skeleton sk-cal-head" />
          <div className="cal-grid">
            {Array.from({ length: 42 }, (_, i) => (
              <div key={i} className="skeleton sk-cal-cell" />
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-body">
            <div className="skeleton sk-panel-body" />
          </div>
        </section>
      </aside>

      <div>
        <div className="day-head">
          <div>
            <div className="skeleton sk-title" />
            <div className="skeleton sk-sub" />
          </div>
        </div>

        <div className="skeleton sk-group" />
        <div className="card-list">
          {Array.from({ length: 4 }, (_, i) => (
            <article key={i} className="card">
              <div className="thumb skeleton" />
              <div className="card-body">
                <div className="skeleton sk-line w90" />
                <div className="skeleton sk-line w35" />
                <div className="skeleton sk-line w90" />
                <div className="skeleton sk-line w60" />
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
