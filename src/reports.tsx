import { useEffect, useRef, useState } from "react";
import type { Article, Purpose, PurposeReport, Run } from "./types";

const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })
    : "日期未確認";
const href = (value: string) => (/^https?:\/\//i.test(value) ? value : "#");
export type TrackingSelection = {
  purpose_id: string;
  title: string;
  excerpt: string;
  report: string;
  published_at: string | null;
  evidence_ids: string[];
};
type Entry = { report: PurposeReport; run: Run };

export function ReportReader({
  runs,
  purposes,
  articles,
  onTrack,
}: {
  runs: Run[];
  purposes: Purpose[];
  articles: Article[];
  onTrack: (selection: TrackingSelection) => void;
}) {
  const [direction, setDirection] = useState("");
  const [version, setVersion] = useState("");
  const [query, setQuery] = useState("");
  const entries: Entry[] = runs.flatMap((run) =>
    (run.config_snapshot.purpose_reports || []).map((report) => ({
      report,
      run,
    })),
  );
  const choices = [...new Set(entries.map((e) => e.report.purpose_id))];
  const names = new Map(purposes.map((p) => [p.id, p.name]));
  for (const run of runs)
    for (const p of run.config_snapshot.purposes)
      if (!names.has(p.id)) names.set(p.id, p.name);
  const sourceMap = new Map(articles.map((a) => [a.id, a]));
  const results = choices.filter(
    (id) =>
      !query ||
      entries.some(
        (e) =>
          e.report.purpose_id === id &&
          JSON.stringify(e.report).toLowerCase().includes(query.toLowerCase()),
      ) ||
      names.get(id)?.includes(query),
  );
  const selected = direction;
  const versions = entries.filter((e) => e.report.purpose_id === selected);
  const current = versions.find((e) => e.run.id === version) || versions[0];
  const listScroll = useRef(0);
  const detailTitle = useRef<HTMLHeadingElement>(null);
  const opened = useRef(false);
  const openedId = useRef("");
  useEffect(() => {
    if (direction) {
      opened.current = true;
      window.scrollTo({ top: 0, behavior: "instant" });
      detailTitle.current?.focus({ preventScroll: true });
    } else if (opened.current) {
      window.scrollTo({ top: listScroll.current, behavior: "instant" });
      document
        .getElementById("report-card-" + openedId.current)
        ?.focus({ preventScroll: true });
    }
  }, [direction]);
  if (!entries.length)
    return (
      <section className="empty">
        <h2>方向分析報告準備中</h2>
        <p>
          主機會依每個研究方向整合多個來源，發布詳細分析、風險與後續觀察。既有文章仍可在「來源資料」閱讀。
        </p>
      </section>
    );
  if (!current)
    return (
      <section className="report-reader" aria-label="分析摘要卡片">
        <label className="report-search">
          <span className="sr-only">搜尋方向與報告</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋摘要…"
          />
        </label>
        <div className="report-card-grid">
          {results.map((id) => {
            const entry = entries.find((e) => e.report.purpose_id === id)!;
            return (
              <article className="report-card" key={id}>
                <button
                  id={"report-card-" + id}
                  aria-label={`閱讀報告：${names.get(id) || entry.report.title}`}
                  onClick={() => {
                    listScroll.current = window.scrollY;
                    openedId.current = id;
                    setDirection(id);
                    setVersion("");
                  }}
                >
                  <span className="report-card-direction">
                    {names.get(id) || "歷史研究方向"}
                  </span>
                  <span className="report-card-title">
                    {entry.report.title}
                  </span>
                  <span className="report-card-summary">
                    {entry.report.overview}
                  </span>
                  <span className="report-card-footer">
                    <time dateTime={entry.run.published_at || undefined}>
                      {date(entry.run.published_at)}
                    </time>
                    <span>閱讀詳情 ↗</span>
                  </span>
                </button>
              </article>
            );
          })}
        </div>
        {!results.length && <p className="empty">沒有符合的摘要。</p>}
      </section>
    );
  return (
    <div className="report-reader">
      <button className="report-back" onClick={() => setDirection("")}>
        ← 返回摘要
      </button>
      {current && (
        <article className="research-report" aria-label="方向分析報告">
          <header>
            <div className="meta">
              {names.get(selected)} · 發布 {date(current.run.published_at)}
            </div>
            <h2 tabIndex={-1} ref={detailTitle}>
              {current.report.title}
            </h2>
            <div className="report-version">
              <span>資料收集截止 {date(current.run.data_cutoff)}</span>
              <label>
                報告版本
                <select
                  value={current.run.id}
                  onChange={(e) => setVersion(e.target.value)}
                >
                  {versions.map((e) => (
                    <option key={e.run.id} value={e.run.id}>
                      {date(e.run.published_at)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </header>
          <section className="report-overview">
            <span className="eyebrow">本輪重點</span>
            <p>{current.report.overview}</p>
          </section>
          {current.report.sections.map((section, index) => (
            <section className="report-section" key={index}>
              <h3>
                <span>{String(index + 1).padStart(2, "0")}</span>
                {section.heading}
              </h3>
              {section.paragraphs.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
              {!!section.bullets.length && (
                <ul>
                  {section.bullets.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              )}
              {section.tables.map((table, i) => (
                <div
                  className="report-table"
                  key={i}
                  role="region"
                  aria-label={section.heading + "比較表"}
                  tabIndex={0}
                >
                  <table>
                    <thead>
                      <tr>
                        {table.headers.map((h, n) => (
                          <th scope="col" key={n}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.map((row, n) => (
                        <tr key={n}>
                          {row.map((cell, j) => (
                            <td key={j}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
              <button
                className="track-from-report"
                aria-label={`延續追蹤：${section.heading}`}
                onClick={() =>
                  onTrack({
                    purpose_id: current.report.purpose_id,
                    title: section.heading,
                    excerpt: [
                      ...section.paragraphs,
                      ...section.bullets,
                      ...section.tables.flatMap((t) =>
                        t.rows.map((row) => row.join("／")),
                      ),
                    ].join("\n"),
                    report: current.report.title,
                    published_at: current.run.published_at,
                    evidence_ids: section.evidence_ids,
                  })
                }
              >
                ＋ 加入延續追蹤
              </button>
              {!!section.evidence_ids.length && (
                <div className="report-citations">
                  本節依據{" "}
                  {section.evidence_ids.map((id) => (
                    <a
                      key={id}
                      href={`#source-${current.run.id}-${selected}-${id}`}
                    >
                      [{current.report.evidence_ids.indexOf(id) + 1}]{" "}
                      {sourceMap.get(id)?.source_name || "來源"}
                    </a>
                  ))}
                </div>
              )}
            </section>
          ))}
          <section className="report-section report-conclusion">
            <h3>綜合判斷</h3>
            <p>{current.report.conclusion}</p>
          </section>
          {!!current.report.next_steps.length && (
            <section className="report-section">
              <h3>接下來值得觀察</h3>
              <ul>
                {current.report.next_steps.map((step, i) => (
                  <li key={i}>
                    {step}{" "}
                    <button
                      aria-label={`延續追蹤：${step}`}
                      onClick={() =>
                        onTrack({
                          purpose_id: current.report.purpose_id,
                          title: step,
                          excerpt: step,
                          report: current.report.title,
                          published_at: current.run.published_at,
                          evidence_ids: current.report.evidence_ids,
                        })
                      }
                    >
                      ＋ 延續追蹤
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!!current.report.limitations.length && (
            <section className="report-limitations">
              <h3>資料缺口與分析限制</h3>
              <ul>
                {current.report.limitations.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </section>
          )}
          <section className="report-sources">
            <h3>來源與延伸閱讀</h3>
            <ol>
              {current.report.evidence_ids.map((id) => {
                const a = sourceMap.get(id);
                return (
                  <li
                    id={`source-${current.run.id}-${selected}-${id}`}
                    key={id}
                  >
                    {a ? (
                      <>
                        <a href={href(a.url)} target="_blank" rel="noreferrer">
                          {a.title} ↗
                        </a>
                        <small>
                          {a.source_name} ·{" "}
                          {a.published_at
                            ? "發布 " + date(a.published_at)
                            : "發布日期未確認"}{" "}
                          · 收集 {date(a.collected_at)}
                        </small>
                        <small>
                          {a.content.startsWith(
                            "資料類型：即時網路搜尋結果摘要",
                          )
                            ? "僅取得搜尋結果摘要，未取得全文"
                            : "已取得來源文字"}
                        </small>
                      </>
                    ) : (
                      <span>此來源資料目前無法取得</span>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        </article>
      )}
    </div>
  );
}
