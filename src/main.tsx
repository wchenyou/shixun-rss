import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { supabase, emptyData, fetchAll, fetchWorkspaceOwner } from "./data";
import type { Dataset, Track, Article, Purpose, Source } from "./types";
import "./style.css";
import { ReportReader, type TrackingSelection } from "./reports";
import { ArticleExcerpt, TrackSummary } from "./tracking";
import { BudgetSettings } from "./budget";

const labels: Record<string, string> = {
  candidate: "待確認",
  active: "追蹤中",
  paused: "已暫停",
  archived: "已封存",
  idle: "待命",
  running: "分析中",
  claude_running: "Claude 分析整理中",
  searching: "全網搜尋中",
  claude_searching: "Claude 全網搜尋中",
  search_failed: "網路搜尋失敗",
  model_failed: "模型執行失敗",
  fallback_searching: "Claude 備援搜尋中",
  fallback_running: "Claude 整理中",
  fallback_unavailable: "Claude CLI 尚未就緒",
  fallback_auth_required: "Claude 需要登入",
  fallback_model_failed: "Claude 執行失敗",
  fallback_waiting_quota: "等待 Claude 額度",
  complete: "完成",
  partial: "部分完成",
  failed: "執行失敗",
  waiting_quota: "等待額度",
  upload_pending: "等待上傳",
  no_new: "沒有新文章",
  auth_required: "需要重新登入",
  quota_unknown: "額度狀態未知",
};
const time = (s: string | null | undefined) =>
  s
    ? new Date(s).toLocaleString("zh-TW", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Taipei",
      })
    : "尚無紀錄";
const safeUrl = (s: string) => (/^https?:\/\//i.test(s) ? s : "#");
function App() {
  const [readingMode, setReadingMode] = useState("reports");
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<Dataset>(emptyData),
    [page, setPage] = useState("read");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [query, setQuery] = useState(""),
    [purpose, setPurpose] = useState("all"),
    [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<Article | null>(null),
    [track, setTrack] = useState<Track | null>(null);
  const [trackingDraft, setTrackingDraft] = useState<
    | (TrackingSelection & {
        id: string;
        question: string;
      })
    | null
  >(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const beginDelete = (id: string) => {
    setDeleteError("");
    setConfirmDelete(id);
  };
  const [trackingSaving, setTrackingSaving] = useState(false);
  const [trackingError, setTrackingError] = useState("");
  function startTracking(selection: TrackingSelection) {
    setTrackingError("");
    setSelected(null);
    setTrackingDraft({
      ...selection,
      id: crypto.randomUUID(),
      question: `持續追蹤「${selection.title}」的最新進展、影響與需要驗證的變化。`,
    });
  }
  async function saveTracking() {
    if (!trackingDraft || !supabase || !ownerId) return;
    const draft = trackingDraft;
    const title = draft.title.trim(),
      question = draft.question.trim();
    if (!title || !question) return;
    const existing = data.tracks.find(
      (t) =>
        !t.deleted_at &&
        t.purpose_id === draft.purpose_id &&
        t.question.trim() === question &&
        t.id !== draft.id,
    );
    if (existing) {
      setTrackingDraft(null);
      navigate("tracks");
      setTrack(existing);
      setNotice("這個問題已在延續追蹤中");
      return;
    }
    setTrackingSaving(true);
    setTrackingError("");
    try {
      const { error } = await supabase.rpc("create_manual_track", {
        p_id: draft.id,
        p_purpose: draft.purpose_id,
        p_title: title,
        p_question: question,
        p_excerpt: draft.excerpt.slice(0, 2000),
        p_article_id: draft.article_id || null,
        p_report_id: draft.run_id || null,
        p_kind: draft.origin_kind || (draft.run_id ? "report" : "manual"),
        p_evidence_ids: draft.evidence_ids,
      });
      if (error) throw error;
      await reload();
      setTrackingDraft(null);
      setNotice("已加入延續追蹤；下一輪分析會依這個問題搜尋並更新進展。");
    } catch (e) {
      setTrackingError((e as Error).message);
    } finally {
      setTrackingSaving(false);
    }
  }
  const [editing, setEditing] = useState<{
    kind: "purposes" | "sources";
    value?: Purpose | Source;
  } | null>(null);
  const reload = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setOwnerId(await fetchWorkspaceOwner());
      setData(await fetchAll());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void reload().finally(() => setReady(true));
  }, [reload]);
  async function write(
    table: string,
    value: Record<string, unknown>,
    id?: string,
    conflict?: string,
  ) {
    if (!supabase || !ownerId) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const q = id
        ? supabase.from(table).update(value).eq("id", id)
        : supabase
            .from(table)
            .upsert(
              { ...value, owner_id: ownerId },
              { onConflict: conflict || "id" },
            );
      const { error } = await q;
      if (error) throw error;
      setNotice("已儲存到雲端");
      await reload();
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function articleState(id: string, patch: Record<string, unknown>) {
    if (!supabase) return;
    const { error } = await supabase.rpc("set_article_state", {
      p_article_id: id,
      ...Object.fromEntries(
        Object.entries(patch).map(([k, v]) => ["p_" + k, v]),
      ),
    });
    if (error) {
      setError(error.message);
      throw error;
    }
    await reload();
  }
  const runs = [...data.runs].sort((a, b) =>
    (b.published_at || "").localeCompare(a.published_at || ""),
  );
  const last = runs[0],
    node = data.nodes[0];
  const stale =
    last &&
    data.purposes.some(
      (p) =>
        !last.config_snapshot.purposes.some(
          (old) => old.id === p.id && old.version === p.version,
        ),
    );
  const analyses = new Map(data.analyses.map((a) => [a.article_id, a]));
  const shown = data.articles
    .filter(
      (a) =>
        (!query ||
          (
            a.title +
            " " +
            a.content +
            " " +
            (analyses.get(a.id)?.summary || "")
          )
            .toLowerCase()
            .includes(query.toLowerCase())) &&
        (purpose === "all" ||
          analyses.get(a.id)?.purpose_ids.includes(purpose)) &&
        (page !== "saved" ||
          data.article_states.some((s) => s.article_id === a.id && s.saved)) &&
        (filter !== "unread" ||
          !data.article_states.some((s) => s.article_id === a.id && s.read)),
    )
    .sort((a, b) => b.collected_at.localeCompare(a.collected_at));
  const visibleTracks = data.tracks.filter((t) => !t.deleted_at);
  const tracks =
    filter === "trash"
      ? data.tracks.filter((t) => !!t.deleted_at)
      : visibleTracks.filter((t) => filter === "all" || t.status === filter);
  const manualTracking = () => {
    if (!data.purposes.length) {
      setError("請先新增一個研究方向，再建立追蹤。");
      return;
    }
    startTracking({
      purpose_id: data.purposes[0].id,
      title: "",
      excerpt: "",
      report: "手動新增",
      origin_kind: "manual",
      published_at: null,
      evidence_ids: [],
    });
  };
  const deleteTracking = async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError("");
    const ids =
      confirmDelete === "all"
        ? visibleTracks.map((t) => t.id)
        : [confirmDelete!];
    try {
    const { error } = await supabase!.rpc("delete_manual_tracks", {
      p_ids: ids,
    });
    if (error) {
      throw error;
    }
    setConfirmDelete(null);
    setTrack(null);
    await reload();
    setNotice("已移到回收區，文章與收藏保留。");
    } catch (e) {
      setDeleteError("無法刪除追蹤：" + (e as Error).message + "。請再試一次。");
    } finally {
      setDeleting(false);
    }
  };
  const restoreTracking = async (id: string) => {
    const { error } = await supabase!.rpc("restore_manual_track", { p_id: id });
    if (error) {
      setError(error.message);
      return;
    }
    await reload();
    setNotice("已由你手動復原追蹤。");
  };
  const navigate = (p: string) => {
    setPage(p);
    setFilter("all");
    setQuery("");
    setTrack(null);
    setSelected(null);
  };
  const heading: Record<string, string> = {
    read: "閱讀",
    saved: "文章收藏",
    tracks: "延續追蹤",
    settings: "方向與來源",
    status: "運作狀態",
  };
  return (
    <div className="shell">
      <a className="skip" href="#main">
        跳到主要內容
      </a>
      <aside className="sidebar">
        <a
          className="brand"
          href={import.meta.env.BASE_URL}
          aria-label="拾訊首頁"
        >
          <span className="brand-mark">拾</span>
          <div>
            拾訊<small>SHIXUN / READER</small>
          </div>
        </a>
        <div className="workspace">
          個人閱讀空間 <span>PERSONAL</span>
        </div>
        <nav aria-label="主要導覽">
          {[
            ["read", "◫", "閱讀"],
            ["saved", "◇", "文章收藏"],
            ["tracks", "⌁", "延續追蹤"],
            ["settings", "☷", "方向與來源"],
            ["status", "◷", "運作狀態"],
          ].map(([id, icon, name]) => (
            <button
              key={id}
              className={page === id ? "nav active" : "nav"}
              onClick={() => navigate(id)}
            >
              <span>{icon}</span>
              {name}
              {id === "tracks" && (
                <b>
                  {
                    data.tracks.filter(
                      (t) => !t.deleted_at && t.status === "active",
                    ).length
                  }
                </b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="status-dot" />
          {node ? labels[node.status] || node.status : "等待主機連線"}
          <p>最後回報 {time(node?.last_seen)}</p>
          <div className="profile">
            <span>A</span>
            <div>
              你的情報閱讀空間
              <small>直接進入 · 免登入</small>
            </div>
          </div>
        </div>
      </aside>
      <main id="main" tabIndex={-1}>
        <header className="topbar">
          <span>
            閱讀 /{" "}
            {page === "tracks"
              ? "延續追蹤"
              : page === "settings"
                ? "方向與來源"
                : page === "status"
                  ? "運作狀態"
                  : page === "saved"
                    ? "文章收藏"
                    : "所有資訊"}
          </span>
          <span>
            ASIA / TAIPEI <i>✳</i>
          </span>
        </header>
        <div className="content compact-content">
          <div className="title-row">
            <h1>{heading[page]}</h1>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void reload()}
            >
              ↻ {busy ? "讀取中" : "重新整理"}
            </button>
          </div>
          {error && (
            <div className="alert error" role="alert">
              {error}{" "}
              <button onClick={() => void reload()} disabled={busy}>
                重試
              </button>
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              {notice}
            </div>
          )}
          {!ready ? (
            <div className="empty">正在讀取閱讀空間…</div>
          ) : !ownerId ? (
            <div className="empty">
              閱讀空間尚未載入，請按「重新整理」重試。
            </div>
          ) : (
            <>
              {page === "status" && (
                <section className="summary-bar" aria-label="資料狀態">
                  <div>
                    <span>最近成功發布</span>
                    <strong>{time(last?.published_at)}</strong>
                  </div>
                  <div>
                    <span>未分析文章</span>
                    <strong>
                      {node?.pending_articles ?? 0}
                      <small> 篇</small>
                    </strong>
                  </div>
                  <div>
                    <span>正式追蹤</span>
                    <strong>
                      {
                        data.tracks.filter(
                          (t) => !t.deleted_at && t.status === "active",
                        ).length
                      }
                      <small> 項</small>
                    </strong>
                  </div>
                </section>
              )}
              {stale && page === "status" && (
                <div className="alert">
                  設定已更新，等待下次分析。以下報告保留原有設定版本。
                </div>
              )}
              {(page === "read" || page === "saved") && (
                <>
                  {page === "saved" && (
                    <p className="bookmark-help">
                      文章收藏是稍後閱讀的書籤，不會啟動 AI
                      追蹤；移出收藏不影響延續追蹤。
                    </p>
                  )}
                  {page === "read" && (
                    <label className="reading-view-select">
                      <span className="sr-only">閱讀內容</span>
                      <select
                        aria-label="閱讀內容"
                        value={readingMode}
                        onChange={(e) => setReadingMode(e.target.value)}
                      >
                        <option value="reports">分析摘要</option>
                        <option value="sources">來源資料</option>
                      </select>
                    </label>
                  )}
                  {page === "read" && readingMode === "reports" ? (
                    <ReportReader
                      runs={runs}
                      purposes={data.purposes}
                      articles={data.articles}
                      onTrack={startTracking}
                    />
                  ) : (
                    <>
                      <div className="toolbar">
                        <div className="tabs">
                          <button
                            className={filter === "all" ? "chosen" : ""}
                            onClick={() => setFilter("all")}
                          >
                            {page === "saved" ? "所有收藏" : "所有資訊"}
                          </button>
                          <button
                            className={filter === "unread" ? "chosen" : ""}
                            onClick={() => setFilter("unread")}
                          >
                            未讀
                          </button>
                        </div>
                        <div className="searches">
                          <select
                            aria-label="篩選研究方向"
                            value={purpose}
                            onChange={(e) => setPurpose(e.target.value)}
                          >
                            <option value="all">所有方向</option>
                            {data.purposes.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                          <input
                            aria-label="搜尋文章"
                            placeholder="搜尋標題、摘要或內容…"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                          />
                        </div>
                      </div>
                      <div className="reading-layout">
                        <section className="article-list">
                          <div className="list-label">
                            <span>
                              {page === "saved"
                                ? "SAVED FOR LATER"
                                : "YOUR READING LIST"}
                            </span>
                            <span>{shown.length} 篇資訊</span>
                          </div>
                          {shown.length ? (
                            shown.map((a, i) => {
                              const ai = analyses.get(a.id),
                                state = data.article_states.find(
                                  (s) => s.article_id === a.id,
                                );
                              return (
                                <article className="article" key={a.id}>
                                  <span className="article-number">
                                    {String(i + 1).padStart(2, "0")}
                                  </span>
                                  <div>
                                    <div className="meta">
                                      {a.source_name}
                                      <span>·</span>
                                      {time(a.published_at || a.collected_at)}
                                      <span className="tag">
                                        {ai ? "AI 已整理" : "尚未分析"}
                                      </span>
                                      {state?.read && <span>已讀</span>}
                                    </div>
                                    <button
                                      className="article-title"
                                      onClick={() => {
                                        setSelected(a);
                                        void articleState(a.id, {
                                          read: true,
                                        }).catch(() => {});
                                      }}
                                    >
                                      {a.title}
                                    </button>
                                    <p>
                                      {ai?.summary ||
                                        a.content.slice(0, 180) ||
                                        "來源只提供標題，請開啟原文閱讀。"}
                                    </p>
                                    {ai?.relevance && (
                                      <div className="relevance">
                                        ↳ {ai.relevance}
                                      </div>
                                    )}
                                    <div className="article-actions">
                                      <a
                                        href={safeUrl(a.url)}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        閱讀原文 ↗
                                      </a>
                                      <button
                                        aria-label={
                                          state?.saved ? "取消收藏" : "收藏文章"
                                        }
                                        onClick={() =>
                                          void articleState(a.id, {
                                            saved: !state?.saved,
                                          }).catch(() => {})
                                        }
                                      >
                                        {state?.saved ? "◆ 已收藏" : "◇ 收藏"}
                                      </button>
                                    </div>
                                  </div>
                                </article>
                              );
                            })
                          ) : (
                            <Empty
                              title={
                                query
                                  ? "沒有符合的資訊"
                                  : "留一點空間，給值得讀的資訊。"
                              }
                              text={
                                query
                                  ? "試試其他關鍵字或方向。"
                                  : "先加入你關心的研究方向。主機完成全網搜尋與分析後，內容就會出現在這裡。"
                              }
                              action={() => navigate("settings")}
                              button="設定方向與來源"
                            />
                          )}
                        </section>
                        <aside className="reading-side">
                          <section className="digest">
                            <span className="eyebrow">THE BIG PICTURE</span>
                            <h2>這一輪的綜合筆記</h2>
                            <p className="preserve">
                              {last?.report ||
                                "把分散的消息連成脈絡。第一輪分析完成後，這裡會整理新線索、矛盾與值得再看的問題。"}
                            </p>
                            <small>資料截止 {time(last?.data_cutoff)}</small>
                          </section>
                          <section className="side-tracks">
                            <h2>我的延續追蹤</h2>
                            <p>只有你手動儲存的問題會加入，AI 不再新增候選。</p>
                            {visibleTracks.slice(0, 3).map((t) => (
                              <button
                                className="candidate-link"
                                key={t.id}
                                onClick={() => {
                                  navigate("tracks");
                                  setTrack(t);
                                }}
                              >
                                {t.title}
                                <span>查看變化 →</span>
                              </button>
                            ))}
                          </section>
                        </aside>
                      </div>
                    </>
                  )}
                </>
              )}
              {page === "tracks" && (
                <>
                  <div className="manual-tracking-actions">
                    <p>選取文章文字或主題後，手動建立你想持續觀察的問題。</p>
                    <button className="primary" onClick={manualTracking}>
                      手動新增追蹤
                    </button>
                    {visibleTracks.length > 0 && (
                      <button onClick={() => beginDelete("all")}>
                        清空全部追蹤
                      </button>
                    )}
                  </div>
                  <div className="toolbar">
                    <div className="tabs">
                      {["all", "active", "paused", "archived", "trash"].map(
                        (s) => (
                          <button
                            className={filter === s ? "chosen" : ""}
                            key={s}
                            onClick={() => setFilter(s)}
                          >
                            {s === "trash" ? "回收區" : labels[s] || "全部"}
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                  <div className="track-grid">
                    {tracks.map((t) => {
                      if (t.deleted_at)
                        return (
                          <section className="track-card" key={t.id}>
                            <span className="tag">回收區</span>
                            <h2>{t.title}</h2>
                            <p>{t.question}</p>
                            <button
                              className="primary small"
                              onClick={() => void restoreTracking(t.id)}
                            >
                              復原追蹤
                            </button>
                          </section>
                        );
                      const ev = data.evaluations
                        .filter((e) => e.track_id === t.id)
                        .sort((a, b) =>
                          b.created_at.localeCompare(a.created_at),
                        )[0];
                      return (
                        <button
                          className="track-card"
                          key={t.id}
                          onClick={() => setTrack(t)}
                        >
                          <span className="tag">{labels[t.status]}</span>
                          <h2>{t.title}</h2>
                          <p>{t.question}</p>
                          <div>{ev?.change || "等待新證據"}</div>
                          <small>查看分析與歷史 ↗</small>
                        </button>
                      );
                    })}
                  </div>
                  {!tracks.length && (
                    <Empty
                      title="從一個好問題開始。"
                      text="從文章選取文字或主題，或按「手動新增追蹤」。AI 只更新你建立的項目。"
                    />
                  )}
                </>
              )}
              {(page === "settings" || page === "status") && (
                <BudgetSettings
                  value={data.reader_settings?.[0]}
                  node={node}
                  save={(value) =>
                    write(
                      "reader_settings",
                      value as unknown as Record<string, unknown>,
                      undefined,
                      "owner_id",
                    )
                  }
                />
              )}
              {page === "settings" && (
                <>
                  <details className="settings-help">
                    <summary>排程說明</summary>
                    <p>
                      各項目依台北時間觸發，搜尋與分析使用 Claude Haiku
                      5.5。主機需開機、登入及連網。
                    </p>
                  </details>
                  <div className="settings-grid">
                    {(["purposes", "sources"] as const).map((kind) => (
                      <section className="settings-section" key={kind}>
                        <div className="section-heading">
                          <h2>
                            {kind === "purposes" ? "研究方向" : "RSS 來源"}
                          </h2>
                          <button
                            className="primary"
                            onClick={() => setEditing({ kind })}
                          >
                            ＋ 新增
                          </button>
                        </div>
                        <p>
                          {kind === "purposes"
                            ? "告訴拾訊，你想從資訊裡理解什麼。"
                            : "可選的 RSS / Atom 補充來源；全網搜尋不受此清單限制。"}
                        </p>
                        {data[kind].map((item) => (
                          <div className="setting-item" key={item.id}>
                            <div>
                              <strong>{item.name}</strong>
                              <p>
                                {"description" in item
                                  ? item.description
                                  : item.url}
                              </p>
                              <small>
                                v{item.version} ·{" "}
                                {item.enabled ? "啟用中" : "已暫停"} · 每日{" "}
                                {item.daily_time?.slice(0, 5) || "09:00"}
                                （台北）
                              </small>
                            </div>
                            <button
                              onClick={() => setEditing({ kind, value: item })}
                            >
                              編輯
                            </button>
                          </div>
                        ))}
                        {!data[kind].length && (
                          <div className="small-empty">
                            尚未新增{kind === "purposes" ? "研究方向" : "來源"}
                          </div>
                        )}
                      </section>
                    ))}
                  </div>
                </>
              )}
              {page === "status" && (
                <>
                  <div className="settings-grid">
                    <section className="settings-section">
                      <h2>執行節點</h2>
                      <p>
                        本機執行端預設使用 Claude Haiku 5.5 搜尋與分析，
                        依每日時間觸發，完成後寫入 Supabase。
                      </p>
                      {last?.config_snapshot._execution && (
                        <p>
                          最近批次：
                          {last.config_snapshot._execution.web_search
                            ? "全網搜尋"
                            : "RSS"}{" "}
                          · {last.config_snapshot._execution.model}
                        </p>
                      )}
                      <p>{node?.id || "尚無主機回報"}</p>
                      <dl>
                        <dt>狀態</dt>
                        <dd>
                          {labels[node?.status || "idle"] || node?.status}
                        </dd>
                        <dt>最近回報</dt>
                        <dd>{time(node?.last_seen)}</dd>
                        <dt>執行檢查</dt>
                        <dd>{time(node?.last_check_at)}</dd>
                        <dt>預計再次檢查</dt>
                        <dd>
                          {node?.next_retry_at
                            ? time(node.next_retry_at)
                            : "未知／尚未排定"}
                        </dd>
                        <dt>待上傳批次</dt>
                        <dd>{node?.pending_uploads ?? 0}</dd>
                      </dl>
                      {node?.error && <div className="alert">{node.error}</div>}
                      <small>
                        最近沒有回報不代表主機已關機。時間均為台北時間。
                      </small>
                    </section>
                    <section className="settings-section">
                      <h2>來源涵蓋</h2>
                      {last?.source_results.map((s, i) => (
                        <div className="setting-item" key={i}>
                          <div>
                            <span>{s.name}</span>
                            {s.note && <p>{s.note}</p>}
                          </div>
                          <span>
                            {s.ok ? s.count + " 篇" : s.error || "抓取失敗"}
                          </span>
                        </div>
                      ))}
                      {!last && <p>尚無發布紀錄，來源涵蓋仍待確認。</p>}
                    </section>
                  </div>
                  <h2>發布歷史</h2>
                  {runs.map((r) => (
                    <details className="run" key={r.id}>
                      <summary>
                        {time(r.published_at)}{" "}
                        <span className="tag">
                          {labels[r.status] || r.status}
                        </span>
                      </summary>
                      <p className="preserve">
                        {r.report || "本輪沒有可發布的綜合筆記。"}
                      </p>
                      <small>
                        批次 {r.id} · 資料截止 {time(r.data_cutoff)}
                      </small>
                    </details>
                  ))}
                </>
              )}
            </>
          )}
          {(page === "read" || page === "saved") && ownerId && (
            <button
              className="back-to-top"
              aria-label="回到頂端"
              onClick={() => {
                window.scrollTo({
                  top: 0,
                  behavior: window.matchMedia(
                    "(prefers-reduced-motion: reduce)",
                  ).matches
                    ? "instant"
                    : "smooth",
                });
                document.getElementById("main")?.focus({ preventScroll: true });
              }}
            >
              ↑ 回到頂端
            </button>
          )}
          <footer>
            <span>拾訊 SHIXUN</span>
            <span>讀到資訊，也讀出脈絡。</span>
          </footer>
        </div>
      </main>
      {selected && (
        <Modal title={selected.title} close={() => setSelected(null)}>
          <p className="meta">
            {selected.source_name} · {time(selected.published_at)}
          </p>
          <ArticleExcerpt
            article={selected}
            summary={analyses.get(selected.id)?.summary || ""}
            purpose={
              analyses.get(selected.id)?.purpose_ids[0] ||
              data.purposes[0]?.id ||
              ""
            }
            onTrack={startTracking}
          />
          <a href={safeUrl(selected.url)} target="_blank" rel="noreferrer">
            開啟原文 ↗
          </a>
          <Note
            value={
              data.article_states.find((s) => s.article_id === selected.id)
                ?.note || ""
            }
            save={(note) => articleState(selected.id, { note })}
          />
        </Modal>
      )}
      {trackingDraft && (
        <Modal
          title="加入延續追蹤"
          close={() => {
            if (!trackingSaving) setTrackingDraft(null);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveTracking();
            }}
          >
            <p>保留你感興趣的內容，下一輪分析會依追蹤問題尋找新進展。</p>
            <label>
              追蹤名稱
              <input
                required
                maxLength={200}
                value={trackingDraft.title}
                onChange={(e) =>
                  setTrackingDraft({ ...trackingDraft, title: e.target.value })
                }
              />
            </label>
            <label>
              想持續關注的問題
              <textarea
                required
                rows={4}
                maxLength={3000}
                value={trackingDraft.question}
                onChange={(e) =>
                  setTrackingDraft({
                    ...trackingDraft,
                    question: e.target.value,
                  })
                }
              />
            </label>
            {trackingDraft.origin_kind !== "report" ? <label>
              研究方向
              <select value={trackingDraft.purpose_id} onChange={(e) =>
                setTrackingDraft({ ...trackingDraft, purpose_id: e.target.value })}>
                {data.purposes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label> : <p className="meta">
              研究方向：
              {data.purposes.find((p) => p.id === trackingDraft.purpose_id)
                ?.name || "歷史研究方向"}
            </p>}
            <details>
              <summary>原始摘要與來源</summary>
              <p>{trackingDraft.report}</p>
              <p className="preserve">{trackingDraft.excerpt}</p>
              {trackingDraft.evidence_ids.map((id) => {
                const a = data.articles.find((a) => a.id === id);
                return a ? (
                  <p key={id}>
                    <a href={safeUrl(a.url)} target="_blank" rel="noreferrer">
                      {a.title} ↗
                    </a>
                  </p>
                ) : null;
              })}
            </details>
            {trackingError && <p role="alert">{trackingError}</p>}
            <button
              className="primary"
              type="submit"
              disabled={
                trackingSaving ||
                !trackingDraft.title.trim() ||
                !trackingDraft.question.trim()
              }
            >
              {trackingSaving ? "儲存中…" : "開始追蹤"}
            </button>
          </form>
        </Modal>
      )}
      {track && (
        <Modal title={track.title} close={() => setTrack(null)}>
          <p>{track.question}</p>
          <TrackSummary
            track={data.tracks.find((t) => t.id === track.id) || track}
            data={data}
          />
          <button
            className="danger-action"
            onClick={() => beginDelete(track.id)}
          >
            刪除這個追蹤
          </button>
          <label>
            追蹤狀態
            <select
              value={
                data.tracks.find((t) => t.id === track.id)?.status ||
                track.status
              }
              onChange={(e) =>
                void write(
                  "tracks",
                  { status: e.target.value },
                  track.id,
                ).catch(() => {})
              }
            >
              {["active", "paused", "archived"].map((s) => (
                <option value={s} key={s}>
                  {labels[s]}
                </option>
              ))}
            </select>
          </label>
          <Note
            value={
              data.track_notes.find((n) => n.track_id === track.id)?.note || ""
            }
            save={(note) =>
              write(
                "track_notes",
                { track_id: track.id, note },
                undefined,
                "owner_id,track_id",
              )
            }
          />
          <h3>分析歷史</h3>
          {data.evaluations
            .filter((e) => e.track_id === track.id)
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .map((ev) => (
              <section className="evaluation" key={ev.id}>
                <small>
                  {time(ev.created_at)} · {ev.change}
                </small>
                {!ev.applicable && (
                  <div className="alert">這份分析適用於先前設定／狀態。</div>
                )}
                <p>{ev.summary}</p>
                <h4>反證與缺口</h4>
                <p>{ev.counter_evidence}</p>
                <h4>下一個觀測點</h4>
                <p>{ev.next_question}</p>
                <h4>來源證據</h4>
                {ev.evidence_ids.map((id) => {
                  const a = data.articles.find((a) => a.id === id);
                  return a ? (
                    <a
                      className="evidence"
                      key={id}
                      href={safeUrl(a.url)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {a.title} ↗
                    </a>
                  ) : (
                    <p key={id}>來源 {id}</p>
                  );
                })}
              </section>
            ))}
        </Modal>
      )}
      {confirmDelete && (
        <Modal
          title={
            confirmDelete === "all" ? "清空全部延續追蹤？" : "刪除這個追蹤？"
          }
          close={() => { if (!deleting) setConfirmDelete(null); }}
        >
          <p>追蹤會移到回收區，可以復原。文章、來源與文章收藏會保留。</p>
          {deleteError && <p className="alert error" role="alert">{deleteError}</p>}
          <button className="primary" disabled={deleting} onClick={() => void deleteTracking()}>
            {deleting ? "刪除中…" : deleteError ? "重試移到回收區" : "確認移到回收區"}
          </button>
        </Modal>
      )}
      {editing && (
        <Modal
          title={
            (editing.value ? "編輯" : "新增") +
            (editing.kind === "purposes" ? "研究方向" : "RSS 來源")
          }
          close={() => setEditing(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                await write(
                  editing.kind,
                  {
                    name: f.get("name"),
                    [editing.kind === "purposes" ? "description" : "url"]:
                      f.get("detail"),
                    enabled: f.get("enabled") === "on",
                    daily_time: f.get("daily_time"),
                  },
                  editing.value?.id,
                );
                setEditing(null);
              } catch {
                /* error displayed globally */
              }
            }}
          >
            <label>
              名稱
              <input
                name="name"
                required
                maxLength={120}
                defaultValue={editing.value?.name}
              />
            </label>
            <label>
              {editing.kind === "purposes"
                ? "希望理解的問題與情境"
                : "RSS / Atom 網址"}
              {editing.kind === "purposes" ? (
                <textarea
                  name="detail"
                  required
                  rows={5}
                  defaultValue={
                    editing.value && "description" in editing.value
                      ? editing.value.description
                      : ""
                  }
                />
              ) : (
                <input
                  name="detail"
                  type="url"
                  required
                  pattern="https?://.+"
                  defaultValue={
                    editing.value && "url" in editing.value
                      ? editing.value.url
                      : ""
                  }
                />
              )}
            </label>
            <label>
              每日觸發時間（台北）
              <input
                name="daily_time"
                type="time"
                required
                step="60"
                defaultValue={editing.value?.daily_time?.slice(0, 5) || "09:00"}
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={editing.value?.enabled ?? true}
              />
              啟用
            </label>
            <button className="primary" disabled={busy}>
              儲存設定
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
function Empty({
  title,
  text,
  action,
  button,
}: {
  title: string;
  text: string;
  action?: () => void;
  button?: string;
}) {
  return (
    <div className="empty">
      <div className="empty-symbol">⌁</div>
      <h2>{title}</h2>
      <p>{text}</p>
      {action && (
        <button className="secondary" onClick={action}>
          {button} →
        </button>
      )}
    </div>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog ref={ref} onCancel={close}>
      <div className="dialog-heading">
        <h2>{title}</h2>
        <button aria-label="關閉" onClick={close}>
          ✕
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Note({
  value,
  save,
}: {
  value: string;
  save: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState(value),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="note"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
          await save(note);
          setError("已儲存");
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setSaving(false);
        }
      }}
    >
      <label>
        我的筆記
        <textarea
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="寫下你的判斷，下一輪分析會參考…"
        />
      </label>
      <button className="secondary" disabled={saving}>
        {saving ? "儲存中" : "儲存筆記"}
      </button>
      <small role="status">{error}</small>
    </form>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
