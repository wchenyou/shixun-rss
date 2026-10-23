# 拾訊 Shixun
私人智慧情報閱讀器：搜尋公開網路 → 理解 → 延續追蹤。

## 架構
- React + TypeScript + Vite，部署 Vercel；瀏覽器只讀取已發布的 Supabase 分析。
- Supabase Auth Magic Link，僅預先授權帳號；所有私人資料以 RLS 隔離。
- Python 3.9+ 執行端負責 RSS/Atom、SQLite 暫存、Codex CLI 分析、驗證及原子發布。
- 主機只主動連出，不需固定 IP 或公開家用主機連接埠。

## 全網搜尋
預設執行 `python3 -m worker.runner --once --collection web`，依所有啟用的研究方向與正式追蹤搜尋公開網路，不受 RSS 清單限制。
每輪最多選 30 個網址，必須能在實際搜尋工具結果找到；Python 擷取公開原頁，失敗則保留工具回傳的搜尋摘要並標示非全文。出版日期無法確認時保持空值，不把搜尋時間當作出版時間。

實際路徑：本機 Python → 本機 Codex CLI → OpenAI 雲端模型及即時網路搜尋 → Supabase → Vercel。
使用 Codex 的 ChatGPT 登入，不操作使用者原本的 ChatGPT 對話，不自動改用付費 API。
macOS 優先選用 ChatGPT.app 內附的新版 CLI；可透過 CODEX_BIN 覆寫。預設模型為 gpt-5.6-terra，推理強度 medium；可由 CODEX_MODEL 與 CODEX_REASONING_EFFORT 覆寫。

`COLLECTION_MODE=web` 為預設；`hybrid` 附加 RSS（每源最多 10 篇）；`rss` 保留原訂閱模式。
搜尋結果與設定雜湊會存入本機 SQLite，預設六小時內重用，設定變更時重新搜尋，避免恢復監控重複消耗模型額度。
`WEB_SEARCH_INTERVAL_SECONDS=21600` 控制重新搜尋間距，並非排程。網站上記錄的監控時間也不會自行建立 launchd 排程。
主機必須開機連網；Vercel 不會喚醒這台電腦。公開搜尋仍受搜尋索引、付費牆及網站存取限制，並非涵蓋所有網頁。

## Codex 額度不足備援
正常使用 Codex Terra medium；只有確定 Codex 額度不足（配額已滿或產生結構化 quota error）才改用本機 Claude Code 的 `claude-haiku-5-5`，搜尋與整理都支援切換。
登入失敗、額度未知、無效輸出與其他程式錯誤不會誤觸備援。若搜尋後整理才遇到額度不足，沿用已收集的文章；上傳失敗只重傳，不呼叫模型重做。
執行紀錄會保存搜尋與分析各自的模型，包含混用情況。已知 Codex 重置時間會保存，重置前不反覆呼叫 Codex，到期後重新檢查並優先切回。

安裝官方 CLI（固定本次驗證版本），再使用 Claude 訂閱登入：
```sh
npm install --prefix .data/claude-cli --no-audit --no-fund @anthropic-ai/claude-code@2.1.309
.data/claude-cli/node_modules/.bin/claude auth login --claudeai
```
設定 `CLAUDE_FALLBACK_ENABLED=1`，可用 `CLAUDE_BIN` 指定其他安裝位置。
僅接受 first-party Claude 訂閱登入，不讀取 ANTHROPIC_API_KEY 或自動切換付費 API。
模型明確固定為 Haiku 5.5，並核對回傳的 modelUsage，不默默升級其他 Claude 模型。
Claude 搜尋僅開放 WebSearch／WebFetch，整理時關閉工具；停用使用者／專案自訂、MCP、hooks 及會話保存，不把 Supabase 憑證傳入模型程序。
兩邊都無法執行時保存本機工作，等待補跑，不發布未驗證內容。所有 CLI 都在本機啟動，AI 搜尋與運算由各供應商雲端執行。

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
全網模式另有一次搜尋模型呼叫，再進行每批一次分析；同一主機正常工作與恢復監控共用 flock，額度等待會釋放鎖。
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
尚未介接專用即時行情／籌碼 API；公開網頁可能提供行情或估值，必須保留時點與缺口。不提供交易執行、多用戶協作、通知寄送或離線閱讀。
RSS 是可選補充來源；研究設定存在私人 Supabase，不公開到 GitHub。

規格來源：[Notion AI RSS v5](https://app.notion.com/p/3ff9d64f640e8028aae2c4b2cc6501cc)
官方技術依據：[Codex App Server](https://learn.chatgpt.com/docs/app-server)、[Codex non-interactive](https://learn.chatgpt.com/docs/non-interactive-mode)、[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、[Email login](https://supabase.com/docs/guides/auth/auth-email-passwordless)。
