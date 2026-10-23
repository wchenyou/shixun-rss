import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import { supabase, emptyData, fetchAll } from "./data";
import type { Dataset, Track, Article, Purpose, Source } from "./types";
import "./style.css";

const labels: Record<string, string> = {
  candidate: "待確認",
  active: "追蹤中",
  paused: "已暫停",
  archived: "已封存",
  idle: "待命",
  running: "分析中",
  searching: "全網搜尋中",
  search_failed: "網路搜尋失敗",
  model_failed: "模型執行失敗",
  fallback_searching: "Claude 備援搜尋中",
  fallback_running: "Claude 備援整理中",
  fallback_unavailable: "Claude CLI 尚未就緒",
  fallback_auth_required: "Claude 需要登入",
  fallback_model_failed: "Claude 備援執行失敗",
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
  const [session, setSession] = useState<Session | null>(null),
    [ready, setReady] = useState(false);
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
  const [editing, setEditing] = useState<{
    kind: "purposes" | "sources";
    value?: Purpose | Source;
  } | null>(null);
  const reload = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setData(await fetchAll());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    if (!supabase) {
      setReady(true);
      return;
    }
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) setError(error.message);
      setSession(data.session);
      setReady(true);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) setData(emptyData);
    });
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (session) void reload();
  }, [session, reload]);
  async function write(
    table: string,
    value: Record<string, unknown>,
    id?: string,
    conflict?: string,
  ) {
    if (!supabase || !session) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const q = id
        ? supabase.from(table).update(value).eq("id", id)
        : supabase
            .from(table)
            .upsert(
              { ...value, owner_id: session.user.id },
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
  const tracks = data.tracks.filter(
    (t) => filter === "all" || t.status === filter,
  );
  const navigate = (p: string) => {
    setPage(p);
    setFilter("all");
    setQuery("");
    setTrack(null);
    setSelected(null);
  };
  const heading: Record<string, string> = {
    read: "留意新訊，延續思考。",
    saved: "把值得重讀的，留下來。",
    tracks: "讓問題，持續有進展。",
    settings: "為你的好奇，設定方向。",
    status: "每一份更新，都有跡可循。",
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
          個人閱讀空間 <span>PRIVATE</span>
        </div>
        <nav aria-label="主要導覽">
          {[
            ["read", "◫", "閱讀"],
            ["saved", "◇", "收藏"],
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
                <b>{data.tracks.filter((t) => t.status === "active").length}</b>
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
              {session?.user.email || "你的私人情報筆記"}
              {session && (
                <button onClick={() => supabase?.auth.signOut()}>登出</button>
              )}
            </div>
          </div>
        </div>
      </aside>
      <main id="main">
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
                    ? "收藏"
                    : "所有資訊"}
          </span>
          <span>
            ASIA / TAIPEI <i>✳</i>
          </span>
        </header>
        <div className="content">
          <div className="eyebrow">YOUR DAILY SIGNAL</div>
          <div className="title-row">
            <h1>{heading[page]}</h1>
            <button
              className="secondary"
              disabled={!session || busy}
              onClick={() => void reload()}
            >
              ↻ {busy ? "讀取中" : "重新整理"}
            </button>
          </div>
          <p className="intro">從每天的資訊裡，拾起與你有關的線索。</p>
          {error && (
            <div className="alert error" role="alert">
              {error}{" "}
              <button onClick={() => void reload()} disabled={!session}>
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
            <div className="empty">正在確認登入狀態…</div>
          ) : !session ? (
            <Login configured={!!supabase} />
          ) : (
            <>
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
                    {data.tracks.filter((t) => t.status === "active").length}
                    <small> 項</small>
                  </strong>
                </div>
                <p>
                  {node?.status === "waiting_quota"
                    ? "額度等待中，先前成果仍可閱讀。"
                    : last
                      ? "閱讀已發布內容，主機完成搜尋與分析後會發布新內容。"
                      : "設定研究方向，等待主機搜尋並發布第一份內容。"}
                </p>
              </section>
              {stale && (
                <div className="alert">
                  設定已更新，等待下次分析。以下報告保留原有設定版本。
                </div>
              )}
              {(page === "read" || page === "saved") && (
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
                        <div className="section-heading">
                          <h2>值得延續的問題</h2>
                          <span>↗</span>
                        </div>
                        {data.tracks
                          .filter((t) => t.status === "candidate")
                          .slice(0, 3)
                          .map((t) => (
                            <button
                              className="candidate-link"
                              key={t.id}
                              onClick={() => {
                                navigate("tracks");
                                setTrack(t);
                              }}
                            >
                              {t.title}
                              <span>查看候選 →</span>
                            </button>
                          ))}
                        {!data.tracks.some((t) => t.status === "candidate") && (
                          <p>
                            AI 提出的議題會先放在候選區，由你決定是否開始追蹤。
                          </p>
                        )}
                      </section>
                    </aside>
                  </div>
                </>
              )}
              {page === "tracks" && (
                <>
                  <div className="toolbar">
                    <div className="tabs">
                      {["all", "candidate", "active", "paused", "archived"].map(
                        (s) => (
                          <button
                            className={filter === s ? "chosen" : ""}
                            key={s}
                            onClick={() => setFilter(s)}
                          >
                            {labels[s] || "全部"}
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                  <div className="track-grid">
                    {tracks.map((t) => {
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
                      text="閱讀之後，AI 會建議值得持續關注的研究問題。確認加入後，下一輪會延續同一項目。"
                    />
                  )}
                </>
              )}
              {page === "settings" && (
                <>
                  <div className="alert">
                    拾訊會依研究方向主動搜尋公開網路，不限於下列 RSS 網站。RSS
                    是可選的補充來源，需主機啟用混合模式才會讀取。搜尋與分析優先由本機
                    Codex 執行，額度不足時改用本機 Claude Haiku 5.5。
                    電腦需要開機並連網；原監控時間的文字紀錄不會自動建立排程。
                  </div>
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
                                {item.enabled ? "啟用中" : "已暫停"}
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
                        本機執行端優先使用 Codex Terra；額度不足時改用 Claude
                        Haiku 5.5，完成搜尋與分析後寫入 Supabase。
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
                        <dt>額度檢查</dt>
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
          <h3>摘要</h3>
          <p className="preserve">
            {analyses.get(selected.id)?.summary || "尚未分析"}
          </p>
          <h3>RSS 提供內容</h3>
          <p className="preserve">{selected.content || "僅取得標題"}</p>
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
      {track && (
        <Modal title={track.title} close={() => setTrack(null)}>
          <p>{track.question}</p>
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
              {["candidate", "active", "paused", "archived"].map((s) => (
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
function Login({ configured }: { configured: boolean }) {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="welcome">
      <div>
        <span className="eyebrow">A QUIETER WAY TO STAY INFORMED</span>
        <h2>
          資訊會過去。
          <br />
          好的問題，值得留下。
        </h2>
        <p>
          搜尋你關心的議題，整理有依據的摘要，
          <br />
          再讓每一個值得追蹤的問題持續累積。
        </p>
        <div className="welcome-steps">
          <span>01 收集</span>
          <i>→</i>
          <span>02 理解</span>
          <i>→</i>
          <span>03 延續</span>
        </div>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!supabase) return;
          setBusy(true);
          setMessage("");
          const f = new FormData(e.currentTarget);
          let timeout: ReturnType<typeof setTimeout> | undefined;
          try {
            const { error } = await Promise.race([
              supabase.auth.signInWithOtp({
                email: String(f.get("email")).trim(),
                options: {
                  shouldCreateUser: false,
                  emailRedirectTo: new URL(
                    import.meta.env.BASE_URL,
                    window.location.origin,
                  ).href,
                },
              }),
              new Promise<never>((_, reject) => {
                timeout = setTimeout(
                  () => reject(new Error("login_timeout")),
                  20000,
                );
              }),
            ]);
            if (error) {
              const messages: Record<string, string> = {
                signup_disabled:
                  "此信箱尚未啟用。首次登入請先點擊管理員寄出的邀請信；已啟用的帳號請確認 Email 是否正確。",
                over_email_send_rate_limit:
                  "登入信寄送次數已達上限，請稍後再試，並先檢查收件匣與垃圾郵件。",
                over_request_rate_limit: "操作太頻繁，請稍候再試。",
                email_address_not_authorized:
                  "寄信服務尚未授權此信箱，請聯絡管理員。",
                email_provider_disabled:
                  "Email 登入服務尚未啟用，請聯絡管理員。",
              };
              setMessage(
                messages[
                  error.code ||
                    (/signups not allowed/i.test(error.message)
                      ? "signup_disabled"
                      : error.status === 429
                        ? "over_email_send_rate_limit"
                        : "")
                ] || "無法寄送登入信：" + error.message,
              );
            } else {
              setMessage(
                "登入信寄送請求已受理。請查看收件匣與垃圾郵件，點擊最新一封信中的連結返回拾訊；不需要輸入密碼。",
              );
            }
          } catch {
            setMessage(
              "連線未完成，請檢查網路並先查看信箱；若沒有收到信，請稍候再試。",
            );
          } finally {
            clearTimeout(timeout);
            setBusy(false);
          }
        }}
      >
        <span className="tag">私人閱讀空間</span>
        <h2>歡迎回到拾訊</h2>
        <p>
          {configured
            ? "輸入已授權的 Email，我們會寄送免密碼登入連結。首次使用請先開啟邀請信。"
            : "雲端尚未完成設定，完成後即可登入。"}
        </p>
        <label>
          Email
          <input
            type="email"
            name="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
            disabled={!configured}
          />
        </label>
        <button className="primary" disabled={!configured || busy}>
          {busy ? "寄送中…" : "寄送登入連結 →"}
        </button>
        {message && (
          <p className="login-message" role="status" aria-live="polite">
            {message}
          </p>
        )}
        <small>
          送出後請到信箱點擊連結，才會進入閱讀空間。僅限已授權帳號，未開放公開註冊。
        </small>
      </form>
    </section>
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
