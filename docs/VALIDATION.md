# 驗證紀錄

2026-10-23（Asia/Taipei）。此版本依 Notion v5 從空目錄重建。

## 全網版最新驗證（2026-10-23 22:43）
- 後續加入 Claude Haiku 5.5 quota-only 備援：官方 Claude Code 2.1.309，確認 Claude Pro 訂閱登入，真實搜尋取得 5 個來源、2 篇整理通過既有輸出與引用驗證。這是獨立測試，未假裝正式 Codex 額度耗盡或寫入正式新聞。
- 新增切換前／中途額度不足、非配額不切換、額度未知不切換、Claude 未登入／額度不足保留工作、Codex 重置後恢復優先及上傳不重做等測試；總共 35 項 Python 測試通過，另驗證 API 登入拒絕、憑證環境隔離及禁止未指定模型的輸出發布。
- 後續依使用者指定，搜尋與分析均改為 gpt-5.6-terra，明確傳入 medium 推理強度；真實即時搜尋及停用搜尋的結構化輸出呼叫均通過。以下 18 篇首次發布仍是當時 gpt-6.1-sol 的歷史執行紀錄，不改寫舊批次模型。
- 修正本機使用舊版 Homebrew CLI 的相容性問題；改用 ChatGPT.app 內附 Codex CLI 0.163.0-alpha.11.2，gpt-6.1-sol 實際呼叫成功。
- 修正 App Server 的 stdout 緩衝造成通知與回應同批到達時額度查詢逾時；以無緩衝串流重驗查詢成功。
- 實際依五組研究方向完成即時搜尋，網址均來自工具事件的真實結果；全網模式本輪沒有讀 RSS。
- 已完成一次真實 Codex 分析與 Supabase 發布：18 篇資料、18 份摘要、8 筆追蹤評估，發布狀態 complete。資料是私人帳號的正式資料，未提交 GitHub。
- 22 項 Python 測試通過：包含拒絕不存在於搜尋工具結果的網址、沒有執行搜尋就宣稱完成、遺漏研究方向、原頁失敗時摘要降級、正文擷取、配額阻擋搜尋、跨輪快取與搜尋失敗退避。
- TypeScript／正式建置與 5 項登入瀏覽器測試通過。Vercel 正式部署 READY。
- 每日自動排程仍未啟用；本次驗證是單次手動觸發。以下早期「模型拒絕／尚未完成 AI」紀錄已由本節驗證取代。

## 已通過
- TypeScript 靜態檢查、Vite production build、GitHub Pages 子路徑建置。
- 13 項 Python 測試：RSS/Atom、URL 去重、引用拒絕、XML entity 拒絕、設定讀取失敗、無效輸出不發布、第二批額度不足、重啟續跑、未知重置退避、多視窗最晚重置、上傳重試不重分析、登入錯誤分類、跨程序工作鎖。
- 真實 Supabase 整合：不同使用者不能讀取對方文章、瀏覽器不能寫 AI 分析、同批重傳不重複、無效引用使整批回滾、分析期間暫停追蹤不會重啟。
- 真實瀏覽器 → Supabase → 再載入：收藏、個人筆記、研究方向新增、追蹤狀態切換。
- 桌面與 390px 手機版視覺檢查；沒有水平溢位或瀏覽器 JavaScript 錯誤。
- 登入首頁與私人資料分離。公開註冊關閉，指定 Email 已建立並加入 owners。
- 真實本機 Codex App Server 登入／額度查詢可用；查詢未產生模型內容。

測試帳號與測試文章已清除。測試截圖及憑證都在 gitignore 路徑，不公開。

## 查核與修正
- 瀏覽器整合測試發現「標記已讀」與「儲存筆記」可能互相覆寫，已改成資料庫 set_article_state 原子欄位更新並重驗通過。
- 本機 Codex CLI 預設 gpt-5.5 被帳號拒絕；已加入 CODEX_MODEL 配置，避免依賴失效預設。
- Supabase security advisor 無資料表／RLS 問題。另提示未啟用 leaked password protection；此網站使用 Email Magic Link、不提供密碼設定。可依方案在 Auth 設定啟用。

## 未宣稱完成
- 使用者實際收取登入 Email 及從個人裝置開啟連結。
- 另一台正式 Mac mini 的安裝、開機恢復、睡眠、登入與實體手機外網測試。
- 正式排程頻率、通知管道與正式 RSS 清單尚未指定，未安裝常駐服務。
- 舊 SQLite 匯入（使用者要求重新開發）、多日真實追蹤、完整語意事件合併與相似候選合併。
- 自動測試中額度耗盡、重啟與網路故障使用可控替身，不代表真實帳號額度被耗盡。

## 重現
詳見 README。Live integration 測試會自行建立／刪除隔離測試帳號，需要本機 .env.worker。

## Vercel 切換
- 正式網站：https://shixun-rss.vercel.app/ ，Production 部署狀態 READY，HTTP 200。
- GitHub Pages 已停用，GitHub 僅保存原始碼與執行 CI。
- Supabase Auth Site URL 和 redirect allow list 已切換至 Vercel。
- Vercel 環境變數 API 權限不足，改用版本控管的公開 publishable 連線設定；高權限憑證仍未提交。
- 真實 RSS 抓取可用，但本機 Codex 生成測試被帳號以模型不支援拒絕（包含 CLI 宣告可用的模型）。尚未完成真實 AI 分析；不能將替身測試稱為真實模型端到端成功。需另核對正式主機 CLI／帳號可用模型，無排程已啟用。
- 正式 Vercel 網站測試通過：桌面／手機登入首頁，以及真實 Supabase 測試帳號的閱讀、收藏、筆記重載、方向新增與追蹤狀態操作。
- 修正 Supabase CLI 將 auth.email.enable_signup 映射為 Email provider 啟用設定的問題；遠端確認 external.email=true、disable_signup=true。

## 2026-10-23 詳細報告與摘要延續追蹤
- 43 項 Python 測試通過，含報告來源驗證、表格維度、報告階段重啟續跑及整批原子發布。
- TypeScript 與正式建置通過。
- 真實 Supabase 隔離帳號整合測試通過：報告閱讀、引用、比較表、摘要建立 active 追蹤、重載後問題與原始來源筆記保留，以及收藏、筆記、設定與狀態切換。
- 390px 手機版無頁面水平溢位，瀏覽器無 JavaScript 錯誤。整合測試資料皆有標示並於測試後清除。
- 報告搜尋沒有結果時不再顯示前一份報告。建立追蹤不會立即呼叫模型，等待下一輪主機分析。
- 早期章節中模型不可用及登入尚未驗證等紀錄為當時狀態；現已完成本機 Codex Terra medium、Claude Haiku 5.5 實際搜尋整理及使用者登入。排程仍未啟用。
- 正式 Vercel 部署 6efdbac 為 READY；正式網域真實 Supabase 瀏覽器整合測試通過，測試帳號已清除。
- 本機實際模型完成 5 份方向報告與 35 篇來源分析，已於 2026-10-23 23:11（台北）原子發布至私人 Supabase。

## Claude 作為主要分析模型
- 46 項 Python 測試及 TypeScript／正式建置通過，新增 Codex 搜尋與 Claude 分析分離、報告固定路由、Claude 失敗保留工作三項驗證。
- 本機 .env.worker 已指定 ANALYSIS_PROVIDER=claude、claude-haiku-5-5、medium；公開範例與 CLI 預設一致。現有已發布報告保留原始模型紀錄，新一輪分析套用 Claude。

## 2026-10-24 完全免登入
- 依使用者明確選擇移除網站 Email 驗證、登入表單、session 檢查與登出；既有 owner 與工作端模型登入保留。
- workspace_access 配置指定單一公開空間，RLS 限制 anon 只能讀寫此空間。已發布 AI 分析可讀，AI 表、工作端狀態、配置表與發布 RPC 不可由 anon 改寫。
- 真實 Supabase 隔離帳號測試通過：其他 owner 不可被 anon 讀寫、配置不可改寫、AI 插入與發布遭拒；原子發布、冪等與追蹤暫停保護仍通過。
- 46 項 Python 測試通過。瀏覽器新增免登入載入、錯誤重試與手機版驗證；live 讀寫需 TEST_ALLOW_WRITES=1 明確啟用，會清除測試追蹤並還原收藏。
- 歷史章節的私人登入權限描述只反映當時版本，現以本節與架構文件為準。

## 2026-10-24 每日排程、Claude 預設與回到頂端
- 53 項 Python 測試通過，涵蓋台北日期換日、分項時間、暫停、同日冪等、時間變更、失敗不記成功、部分來源失敗重試、Claude 搜尋不呼叫 Codex 額度查詢。
- 真實 Supabase 瀏覽器驗證通過：新增來源每日時間儲存、重載顯示、手機一鍵回到頂端，以及既有免登入閱讀與追蹤；測試來源與追蹤已清除，收藏已還原。
- 本機 SEARCH_PROVIDER 與 ANALYSIS_PROVIDER 均為 claude，模型 Haiku 5.5 medium。
- 已載入每分鐘 launchd 服務；首次 Documents 路徑無法載入 worker，已改為安裝到 Application Support/Shixun。背景服務實際進入 claude_searching，無啟動錯誤。尚未驗證重新開機／睡眠恢復的實體行為。

## 摘要卡片與精簡分類頁
- 移除跨頁標語、導讀文案與閱讀頁統計；統計只在運作狀態顯示，排程說明收合。
- 每個研究方向以最新報告摘要卡片呈現，點擊開啟全文；歷史版本、引用、延續追蹤保留於詳情。
- 4 項瀏覽器測試通過：卡片去除同方向舊版本重複、搜尋、詳情焦點、引用、歷史版本、返回保留條件、無結果、手機首張卡片於首屏顯示、既有真實雲端儲存與排程設定。
- 手機視覺檢查通過，390px 無水平溢位；截圖為明確標示的測試資料，非正式新聞。
