# 驗證紀錄

2026-10-23（Asia/Taipei）。此版本依 Notion v5 從空目錄重建。

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
