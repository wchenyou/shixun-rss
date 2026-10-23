# 拾訊 Shixun
私人智慧 RSS 閱讀器：收集 → 理解 → 延續追蹤。

## 架構
- React + TypeScript + Vite，部署 Vercel；瀏覽器只讀取已發布的 Supabase 分析。
- Supabase Auth Magic Link，僅預先授權帳號；所有私人資料以 RLS 隔離。
- Python 3.9+ 執行端負責 RSS/Atom、SQLite 暫存、Codex CLI 分析、驗證及原子發布。
- 主機只主動連出，不需固定 IP 或公開家用主機連接埠。

## 網站發布
正式網址：https://shixun-rss.vercel.app/
GitHub main 推送後由 Vercel Git integration 自動部署。GitHub Actions 執行測試與建置。
前端公開連線設定在 src/public-config.json，可用 VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY 覆寫。
publishable key 可公開，私人資料由 Supabase Auth 與 RLS 控制；service_role 不可公開。

## 本機網站
```sh
npm ci
cp .env.example .env.local
# 填入 VITE_SUPABASE_URL、VITE_SUPABASE_PUBLISHABLE_KEY
npm run dev
npm run build
npm test
```
登入連結由網站登入表單發送。Supabase Auth 的 Site URL/redirect allow list 必須包含網站網址。
未授權帳號即使在 Supabase 完成驗證，也不能建立資料；必須由管理者加入 owners 表。

## 執行端
1. 在正式主機安裝 Python 3.9+ 與 Codex CLI，執行 `codex login`，使用自己的 ChatGPT 登入。
2. 複製專案、建立僅主機可讀的 `.env.worker`（chmod 600），填入 `.env.example` 的 worker 欄位。
3. `python3 -m worker.runner --once`：收集一次，最多分析 40 篇、每篇 2,400 字元。
4. `python3 -m worker.runner --monitor`：恢復未完成工作；沒有積壓工作時不啟動新分析。
5. `python3 -m worker.install --interval-minutes 60` 只產生 launchd 檔案，請依輸出確認時間後安裝。

`.env.worker` 與 `.data` 禁止提交。服務金鑰略過 RLS，是受控主機的高權限憑證；不能放進 VITE_ 變數或網頁。
目前設定為每批一個模型呼叫；同一主機正常工作與恢復監控共用 flock，額度等待會釋放鎖。
未指定正式主機及排程前，不會自行安裝常駐服務。

## 可靠性
- 啟動分析前讀取雲端設定，失敗即停止新分析。
- 每批先保存文章、設定快照、執行 ID。驗證成功才進入 upload_pending。
- 網路失敗只重傳已保存 payload；publish_batch 在單一資料庫交易內發布，重傳具冪等性。
- 主機不覆蓋筆記、收藏或追蹤狀態。發布時重新比對追蹤和目的版本，過期評估標示不適用。
- 額度檢查透過本機 Codex App Server，監控不使用模型。多個阻擋視窗取最晚重置；未知時間用 15/30/60 分鐘退避。
- 登入、一般失敗與額度未知分開。重置不保證恢復，不購買額度、不使用重置券、不改用付費 API。
- 原始 RSS 文字是外部資料；不擷取付費全文，分析程式在隔離暫存目錄、read-only、無 shell 工具及無 Supabase 憑證的環境執行。

## 測試
```sh
npm test
npm run build
npx playwright install chromium
npm run dev
npm run test:e2e
# 可選：真實雲端整合測試（需要 .env.worker；自建、清除隔離測試帳號）
python3 -m tests.integration
```
測試替身驗證額度不足與上傳中斷，不刻意耗盡真實額度。
實際完成與尚待驗證範圍見 [VALIDATION.md](docs/VALIDATION.md)。

## 範圍與限制
這是依 Notion v5 重新開發的版本，不含舊 SQLite 資料搬移。
URL 正規化與穩定 ID 防止同文重複；尚不包含完整語意事件聚類。
候選以「目的＋正規化研究問題」穩定識別；改寫措辭的相似問題仍可能形成不同候選，需人工判斷。
最多帶入 40 個正式追蹤，完整候選身份與最近歷史一起提供上下文。此上限不代表所有項目均已評估。
沒有股價、估值、交易、多用戶協作、付費服務、通知寄送或離線閱讀。
來源是使用者自行設定；初始資料保持空白，不把測試資訊當正式新聞。

規格來源：[Notion AI RSS v5](https://app.notion.com/p/3ff9d64f640e8028aae2c4b2cc6501cc)
官方技術依據：[Codex App Server](https://learn.chatgpt.com/docs/app-server)、[Codex non-interactive](https://learn.chatgpt.com/docs/non-interactive-mode)、[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、[Email login](https://supabase.com/docs/guides/auth/auth-email-passwordless)。
