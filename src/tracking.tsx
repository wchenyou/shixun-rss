import { useEffect, useRef, useState } from "react";
import type { Article, Dataset, Track } from "./types";
import type { TrackingSelection } from "./reports";

const date = (value: string) =>
  new Date(value).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
const day = (value: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
export function ArticleExcerpt({
  article,
  summary,
  purpose,
  onTrack,
}: {
  article: Article;
  summary: string;
  purpose: string;
  onTrack: (s: TrackingSelection) => void;
}) {
  const area = useRef<HTMLDivElement>(null);
  const [quote, setQuote] = useState<{ text: string; kind: string } | null>(
    null,
  );
  const capture = () => {
    const selected = window.getSelection();
    if (!selected?.rangeCount || selected.isCollapsed) return;
    const range = selected.getRangeAt(0);
    let element = range.commonAncestorContainer;
    if (element.nodeType === Node.TEXT_NODE) element = element.parentElement!;
    const region = (element as Element).closest<HTMLElement>("[data-excerpt]");
    if (!region || !area.current?.contains(region)) return;
    setQuote({
      text: selected.toString().trim(),
      kind: region.dataset.excerpt!,
    });
  };
  useEffect(() => {
    // Native touch selection handles do not always emit mouseup/keyup.
    let timer: ReturnType<typeof setTimeout>;
    const settledSelection = () => {
      clearTimeout(timer);
      timer = setTimeout(capture, 350);
    };
    document.addEventListener("selectionchange", settledSelection);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", settledSelection);
    };
  }, []);
  const start = (text: string, kind: string) =>
    onTrack({
      purpose_id: purpose,
      article_id: article.id,
      origin_kind: kind,
      title: kind === "article_title" ? article.title : text.slice(0, 70),
      excerpt: text,
      report: article.title,
      published_at: article.collected_at,
      evidence_ids: [article.id],
    });
  return (
    <div ref={area} onMouseUp={capture} onKeyUp={capture}>
      <div className="tracking-selection-help">
        <p>
          選取摘要或來源文字，再按「追蹤選取文字」；也可追蹤整篇文章主題。儲存後才會加入列表。
        </p>
        <button
          className="primary small"
          disabled={!purpose}
          onClick={() => start(article.title, "article_title")}
        >
          追蹤文章主題
        </button>
      </div>
      {quote && (
        <div className="tracking-selection" role="status">
          <p>
            已選取 {quote.text.length} 字 ·{" "}
            {quote.kind === "ai_summary" ? "AI 摘要" : "來源文字"}
          </p>
          <blockquote>{quote.text}</blockquote>
          <button
            className="primary"
            disabled={!purpose || quote.text.length > 2000}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => start(quote.text, quote.kind)}
          >
            追蹤選取文字
          </button>
          {quote.text.length > 2000 && (
            <p>一次最多 2,000 字，請縮小選取範圍。</p>
          )}
        </div>
      )}
      <h3>AI 摘要</h3>
      <p className="preserve" data-excerpt="ai_summary">
        {summary || "尚未分析"}
      </p>
      <h3>取得的來源文字</h3>
      <p className="preserve" data-excerpt="article_body">
        {article.content || "來源僅提供標題"}
      </p>
    </div>
  );
}

export function TrackSummary({ track, data }: { track: Track; data: Dataset }) {
  const events = data.evaluations
    .filter((e) => e.track_id === track.id && e.applicable)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const origin = new Set(track.origin_evidence_ids || []);
  if (track.origin_article_id) origin.add(track.origin_article_id);
  const seen = new Set(origin);
  const first = new Map<string, string>();
  for (const event of events)
    for (const id of event.evidence_ids)
      if (!seen.has(id)) {
        seen.add(id);
        first.set(id, day(event.created_at));
      }
  const articles = data.articles.filter((a) => seen.has(a.id));
  const sites = new Set(
    articles.map((a) => {
      try {
        return new URL(a.url).hostname;
      } catch {
        return a.source_name;
      }
    }),
  );
  const days = Array.from({ length: 7 }, (_, i) =>
    day(new Date(Date.now() - (6 - i) * 86400000).toISOString()),
  );
  const recent = Array.from(first.values()).filter((d) =>
    days.includes(d),
  ).length;
  const latest = events[events.length - 1];
  const sources = data.articles.filter((a) => origin.has(a.id));
  const originRun = data.runs.find((r) => r.id === track.origin_report_id);
  const originReport = originRun?.config_snapshot.purpose_reports?.find(
    (r) => r.purpose_id === track.purpose_id,
  );
  return (
    <section className="tracking-overview">
      <p className="meta">手動建立 · {date(track.created_at)}</p>
      <h3>目前變化</h3>
      <p>{latest?.change || "等待相關新證據"}</p>
      <p>{latest?.summary || "尚無後續分析；建立追蹤不會立即執行 AI。"}</p>
      {latest && <p className="meta">最近分析 {date(latest.created_at)}</p>}
      <dl className="tracking-facts">
        <div>
          <dt>後續報導</dt>
          <dd>{first.size}</dd>
        </div>
        <div>
          <dt>來源網站</dt>
          <dd>{sites.size}</dd>
        </div>
        <div>
          <dt>分析更新</dt>
          <dd>{events.length}</dd>
        </div>
        <div>
          <dt>近 7 日新增報導</dt>
          <dd>{recent}</dd>
        </div>
      </dl>
      <p className="meta">
        依已關聯文章統計；後續報導不含起始資料，近 7
        日依首次關聯日計算，不代表市場熱度。
      </p>
      <details>
        <summary>近 7 日資料變化</summary>
        <table className="tracking-daily">
          <caption>每日首次關聯的後續文章，台北時間</caption>
          <thead>
            <tr>
              <th>日期</th>
              <th>篇數</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d}>
                <th scope="row">{d}</th>
                <td>
                  {Array.from(first.values()).filter((v) => v === d).length}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      {track.origin_excerpt && (
        <details open>
          <summary>起始摘錄與來源</summary>
          <p className="meta">
            {(
              {
                ai_summary: "AI 摘要",
                article_body: "RSS／網頁來源文字",
                article_title: "文章標題",
                report: "AI 分析報告",
              } as Record<string, string>
            )[track.origin_kind || ""] || "手動設定"}
          </p>
          <blockquote>{track.origin_excerpt}</blockquote>
          {track.origin_report_id && <p>
            原報告：{originReport?.title || "原報告未包含在目前資料中"}
            {originRun && <span className="meta"> · {date(originRun.published_at!)}</span>}
          </p>}
          {sources.map((source) => <p key={source.id}>
            <a href={/^https?:\/\//i.test(source.url) ? source.url : "#"} target="_blank" rel="noreferrer">
              {source.title} ↗
            </a>
          </p>)}
          {!sources.length && origin.size > 0 && <p>起始來源未包含在目前資料中。</p>}
        </details>
      )}
    </section>
  );
}
