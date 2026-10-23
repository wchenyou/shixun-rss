# v5 實作對照
來源：https://app.notion.com/p/3ff9d64f640e8028aae2c4b2cc6501cc

| 規格 | 程式 |
| --- | --- |
| 私人線上閱讀與管理 | src/main.tsx、src/data.ts |
| 登入、擁有者隔離 | owners、RLS、Supabase Auth |
| 雲端設定為準 | worker/cloud.py、Runner.cycle |
| RSS/Atom、穩定 ID | worker/core.py |
| 全網即時搜尋、工具證據校驗、網頁擷取 | worker/search.py、worker/codex.py |
| Codex 結構化分析與驗證 | worker/codex.py、result.schema.json、validate_result |
| 設定快照、重啟續跑 | SQLite jobs / articles / state |
| 單一執行鎖 | flock，共用 .data/worker.lock |
| 額度查詢與補跑 | quota_state、--monitor |
| 本機待上傳、原子冪等發布 | upload_pending、publish_batch SQL |
| 使用者欄位與 AI 分離 | article_states、track_notes、evaluations |
| 候選需確認、追蹤歷史 | tracks.status、evaluations |
| 手機與電腦 | CSS responsive layout |
| 來源缺口、發布／主機時間 | runs.source_results、nodes |
| Vercel | vercel.json、Git integration；GitHub Actions 驗證 |

## 資料權限
前端 publishable key 是公開識別，不是機密。資料權限由登入 JWT、owners admission、owner_id RLS 控制。
主機使用 service_role，具高權限並可略過 RLS。憑證只在 .env.worker；這是可信任個人主機架構，非多租戶隔離執行環境。
SQL publication RPC 拒絕 anon/authenticated 執行；只允許 service_role。
分析文字不可由前端改寫；收藏、已讀與筆記採獨立表。

## 發布與版本
publish_batch 是單一 Postgres 交易，文章、分析、候選、歷史全數成功才設定 published_at。
重傳已發布 run_id 回傳同一 ID。資料庫複合外鍵拒絕跨 owner 關聯。
追蹤狀態與目的版本在發布時再比對；過期結果保留歷史、標示不適用，不覆寫使用者操作。

## 已知工程限制
- 全網模式：本機新版 Codex CLI 呼叫 OpenAI 即時搜尋，挑選的網址須存在於實際工具結果；Python 擷取原頁，失敗明確標示搜尋摘要。分析與搜尋分開執行。
- 預設 web 模式不要求 RSS；hybrid 才附加訂閱。設定與搜尋結果會快取，額度檢查先於任何搜尋／分析。
- 文章每輪 40 篇，分析文字 2,400 字元；一次最多 40 個正式追蹤。
- 候選採目的＋正規化問題的穩定 ID，尚無完整跨措辭語意合併。
- 網站逐頁載入已存資料，適合個人初期資料量；大規模使用需增加伺服端搜尋與 UI 分頁。
- 主機排程生成器僅產出 plist，未自動啟用排程；恢復監控每五分鐘檢查，但模型呼叫依 next_retry_at 節流。
- 主機抓取失敗保存本機原因；目前雲端來源詳細狀態來自最近發布批次。
