# v5 實作對照
來源：https://app.notion.com/p/3ff9d64f640e8028aae2c4b2cc6501cc

| 規格 | 程式 |
| --- | --- |
| 免登入線上閱讀與管理 | src/main.tsx、src/data.ts |
| 單一公開閱讀空間、擁有者隔離 | workspace_access、owners、anon RLS |
| 雲端設定為準 | worker/cloud.py、Runner.cycle |
| RSS/Atom、穩定 ID | worker/core.py |
| 全網即時搜尋、工具證據校驗、網頁擷取 | worker/search.py、worker/codex.py |
| Codex 配額備援、Claude Haiku 5.5 | worker/claude.py、Runner.invoke／activate_fallback |
| Codex 結構化分析與驗證 | worker/codex.py、result.schema.json、validate_result |
| 依方向詳細整合報告、引用驗證 | worker/reports.py、report.schema.json、src/reports.tsx |
| 從摘要建立追蹤、保留原始脈絡 | ReportReader.onTrack、tracks、track_notes |
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
Claude 使用官方本機 CLI 的訂閱授權，與 Codex 一樣不取得 Supabase 憑證。只允許指定的搜尋工具，無 Bash／本機檔案工具；原頁擷取仍由受控 Python 程序驗證公開網址。
前端只使用 publishable key 與 anon 角色，不建立 session。workspace_access 選定唯一可公開讀寫的 owner_id，瀏覽器不能修改配置。anon RLS 只開放該擁有者的設定／追蹤／筆記及已發布分析；其他擁有者仍隔離。AI 表、主機狀態、發布 RPC 仍拒絕 anon 寫入。公開閱讀空間內的內容不再保密，所有訪客共享收藏和筆記。
主機使用 service_role，具高權限並可略過 RLS。憑證只在 .env.worker；這是可信任個人主機架構，非多租戶隔離執行環境。
SQL publication RPC 拒絕 anon/authenticated 執行；只允許 service_role。
分析文字不可由前端改寫；收藏、已讀與筆記採獨立表。

## 發布與版本
publish_batch 是單一 Postgres 交易，文章、分析、候選、歷史全數成功才設定 published_at。
重傳已發布 run_id 回傳同一 ID。資料庫複合外鍵拒絕跨 owner 關聯。
追蹤狀態與目的版本在發布時再比對；過期結果保留歷史、標示不適用，不覆寫使用者操作。

## 報告與追蹤
預設 ANALYSIS_PROVIDER=claude：文章分析、候選／追蹤評估與方向報告固定使用 Claude Haiku 5.5 medium。SEARCH_PROVIDER=claude 預設使用 Claude 搜尋，無 Codex 額度依賴；顯式使用 Codex 才保留額度備援。Claude 分析失敗保留待辦，不悄悄改用 Codex。
每批分析後進入 reporting 階段，逐個方向整理報告，已完成內容存於本機 SQLite。完整結果連同 purpose_reports 放入 runs.config_snapshot，由既有 publish_batch 原子發布。
報告只引用本批已驗證的 article ID；前端依文章表產生原文連結，不信任模型生成的 URL。各節包含段落、條列、表格與引用，缺口需明示。
使用者從報告段落、後續觀察點或文章摘要建立 active 追蹤，編輯名稱與問題，原始內容存 track_notes。追蹤及筆記分兩次寫入；重試沿用同一 UUID，避免重複建立，全部成功才關閉表單。同方向完全相同的問題導向既有追蹤。

## 已知工程限制
- 全網模式：本機 Claude Code CLI 呼叫 Anthropic 即時搜尋，挑選的網址須存在於實際工具結果；Python 擷取原頁，失敗明確標示搜尋摘要。分析與搜尋分開執行。
- 預設 web 模式不要求 RSS；hybrid 才附加訂閱。設定與搜尋結果會快取，額度檢查先於任何搜尋／分析。
- 文章每輪 40 篇，分析文字 2,400 字元；一次最多 40 個正式追蹤。
- 候選採目的＋正規化問題的穩定 ID，尚無完整跨措辭語意合併。
- 網站逐頁載入已存資料，適合個人初期資料量；大規模使用需增加伺服端搜尋與 UI 分頁。
- com.shixun.daily 每分鐘執行 --scheduled；DailySchedule 以台北日期、項目 ID 和每日時間記帳，成功才標記當日完成。失敗來源保留到期狀態，未完成工作優先恢復，模型依 next_retry_at 節流。執行端另安裝至 Application Support/Shixun。
- 主機抓取失敗保存本機原因；目前雲端來源詳細狀態來自最近發布批次。
