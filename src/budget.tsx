import { useEffect, useState } from "react";
import type { NodeStatus, ReaderSettings } from "./types";
export const defaults: ReaderSettings = {
  daily_budget: 60000,
  daily_calls: 4,
  batch_articles: 20,
  body_chars: 1200,
  include_terms: "",
  exclude_terms: "",
};
export function BudgetSettings({
  value,
  node,
  save,
}: {
  value?: ReaderSettings;
  node?: NodeStatus;
  save: (v: ReaderSettings) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ReaderSettings>({ ...defaults, ...value });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft({ ...defaults, ...value }), [value?.version]);
  const usage = node?.usage_summary;
  const supported = node?.agent_version === "2026-10-28";
  const number = (n: number) => n.toLocaleString("zh-TW");
  return (
    <section className="settings-section budget-section">
      <h2>AI 整理預算與篩選</h2>
      <p>成功摘要保存重用；超出預算或暫未納入的文章保留，後續可以繼續處理。</p>
      <p className={supported ? "meta" : "alert"}>
        {supported
          ? "主機已回報支援此版本設定。"
          : "設定會保存到雲端。家裡執行端尚未回報支援新版本，需更新主機程式後才會套用這些限制。"}
      </p>
      <dl className="budget-facts">
        <dt>每日整理預算</dt>
        <dd>
          {number(value?.daily_budget || defaults.daily_budget)} Token（軟上限）
        </dd>
        <dt>目前回報用量</dt>
        <dd>
          {usage
            ? `${usage.day} · 已計入 ${number(usage.accounted_tokens)}／實際回報 ${number(usage.reported_tokens)} Token`
            : "尚無新版本用量紀錄；不把未知當作零。"}
        </dd>
        {usage && (
          <>
            <dt>執行／未知用量</dt>
            <dd>
              {usage.calls} 次／{usage.unknown_runs} 次用量未知
            </dd>
            <dt>待處理／暫未納入</dt>
            <dd>
              {usage.pending}／{usage.filtered} 篇
            </dd>
          </>
        )}
      </dl>
      <details>
        <summary>調整預算與關鍵字</summary>
        <form
          className="budget-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            setError("");
            try {
              await save(draft);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        >
          <div className="budget-fields">
            {(
              [
                ["daily_budget", "每日預算（Token）", 10000, 1000000],
                ["daily_calls", "每日最多 AI 呼叫", 1, 20],
                ["batch_articles", "每批最多文章", 1, 40],
                ["body_chars", "每篇最多字元", 300, 2400],
              ] as const
            ).map(([key, label, min, max]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  min={min}
                  max={max}
                  required
                  value={draft[key]}
                  onChange={(e) =>
                    setDraft({ ...draft, [key]: Number(e.target.value) })
                  }
                />
              </label>
            ))}
          </div>
          <label>
            納入關鍵字（選填）
            <textarea
              value={draft.include_terms}
              maxLength={1000}
              placeholder="例如：AI，人工智慧，能源"
              onChange={(e) =>
                setDraft({ ...draft, include_terms: e.target.value })
              }
            />
          </label>
          <p className="meta">
            任一詞符合即納入；留白保留不確定內容。文字比對可能漏掉同義詞。
          </p>
          <label>
            排除關鍵字（選填）
            <textarea
              value={draft.exclude_terms}
              maxLength={1000}
              placeholder="例如：徵才，優惠碼"
              onChange={(e) =>
                setDraft({ ...draft, exclude_terms: e.target.value })
              }
            />
          </label>
          <p className="meta">以逗號或換行分隔，排除優先，文章不會被刪除。</p>
          <p className="meta">
            預算用來決定是否啟動下一次 AI
            呼叫，單次實際用量可能超出預估。用量未知時保留預估；所有搜尋、摘要與詳細報告合併計算，台北午夜重新歸帳。
          </p>
          {error && (
            <p className="alert error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={saving}>
            {saving ? "儲存中…" : "儲存整理設定"}
          </button>
        </form>
      </details>
    </section>
  );
}
