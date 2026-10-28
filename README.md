# 拾訊 Shixun
個人智慧情報閱讀器：搜尋公開網路 → 理解 → 延續追蹤。

## 架構
- React + TypeScript + Vite，部署 Vercel；瀏覽器只讀取已發布的 Supabase 分析。
- 網站完全免登入，使用 Supabase anon 權限讀寫指定的單一閱讀空間；RLS 仍限制資料範圍與 AI 發布權限。
- Python 3.9+ 執行端負責 RSS/Atom、SQLite 暫存、Codex／Claude CLI 搜尋分析、驗證及原子發布。
- 主機只主動連出，不需固定 IP 或公開家用主機連接埠。

## 全網搜尋
預設執行 `python3 -m worker.runner --once --collection web`，依所有啟用的研究方向與正式追蹤搜尋公開網路，不受 RSS 清單限制。
每輪最多選 30 個網址，必須能在實際搜尋工具結果找到；Python 擷取公開原頁，失敗則保留工具回傳的搜尋摘要並標示非全文。出版日期無法確認時保持空值，不把搜尋時間當作出版時間。

實際路徑：本機 Python → 本機 Claude Code CLI → Anthropic 雲端模型及即時網路搜尋 → Supabase → Vercel。
預設使用 Claude 訂閱登入，不自動改用付費 API。只有顯式設定 SEARCH_PROVIDER=codex 才使用 Codex 的 ChatGPT 登入。
macOS 優先選用 ChatGPT.app 內附的新版 CLI；可透過 CODEX_BIN 覆寫。Codex 選用設定為 gpt-5.6-terra、medium；Claude 預設為 claude-haiku-5-5、medium。

`COLLECTION_MODE=web` 為預設；`hybrid` 附加 RSS（每源最多 10 篇）；`rss` 保留原訂閱模式。
搜尋結果與設定雜湊會存入本機 SQLite，預設六小時內重用，設定變更時重新搜尋，避免恢復監控重複消耗模型額度。
`WEB_SEARCH_INTERVAL_SECONDS=21600` 控制重新搜尋間距，並非排程。每日觸發由獨立的 --scheduled 模式依 daily_time 執行。
主機必須開機連網；Vercel 不會喚醒這台電腦。公開搜尋仍受搜尋索引、付費牆及網站存取限制，並非涵蓋所有網頁。

## 分析模型與搜尋備援
分析、延續追蹤評估及詳細報告預設使用本機 Claude Code 的 `claude-haiku-5-5`，推理強度 medium，使用 Claude 訂閱登入。`ANALYSIS_PROVIDER=claude` 控制此設定；設為 `codex` 可恢復跟隨搜尋端模型。
搜尋與分析預設均為 Claude Haiku 5.5 medium，分別由 SEARCH_PROVIDER=claude、ANALYSIS_PROVIDER=claude 控制。只有顯式改為 Codex 搜尋時才啟用既有 Codex 額度不足備援機制。Claude 模式不查詢 Codex 額度。
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
publishable key 可公開；service_role 不可公開。任何知道網站網址的人均可讀取已發布內容、編輯方向／來源／追蹤與筆記；AI 分析、執行紀錄及 workspace_access 配置仍只允許主機或管理員寫入。

## 閱讀與延續追蹤
開啟網站預設顯示「分析摘要」卡片，每項整理內容呈現最新報告標題、簡短摘要與更新時間。點擊卡片後才閱讀完整分析、比較表、風險、引用來源與延續追蹤；返回摘要保留搜尋條件及捲動位置。上方下拉選單可切換「來源資料」，保留逐篇摘要、原頁文字及收藏。
各分類頁採簡短標題，不再顯示大段標語與跨頁統計；執行統計集中於「運作狀態」，排程說明預設收合。
在報告段落或「接下來值得觀察」按「延續追蹤」，修改名稱和希望持續關注的問題後按「開始追蹤」。逐篇摘要也有同樣入口。
新項目直接進入追蹤中，將摘錄、來源類型、文章／報告 ID 和證據保存在獨立欄位，不占用個人筆記；「延續追蹤」頁用來管理狀態與查看後續評估。下一次主機分析才會更新結果，按鈕不會即時啟動本機模型。
詳細報告與來源證據一起原子發布；中斷後從尚未完成的方向續跑。需要用已存來源重製詳細報告時執行 `python3 -m worker.runner --once --refresh-reports`。

## 本機網站
```sh
npm ci
cp .env.example .env.local
# 填入 VITE_SUPABASE_URL、VITE_SUPABASE_PUBLISHABLE_KEY
npm run dev
npm run build
npm test
```
網站不寄送 Email、不建立登入 session，也不讀取瀏覽器舊登入紀錄。管理員在 workspace_access 寫入 singleton=true 與既有 owners 的 owner_id，指定公開的閱讀空間；此列不能由瀏覽器修改。既有 Auth 擁有者 ID 保留供主機關聯資料使用。

## 執行端
1. 在正式主機安裝 Python 3.9+、Claude Code CLI，完成 Claude 訂閱登入。Codex CLI 為可選。
2. 複製專案、建立僅主機可讀的 `.env.worker`（chmod 600），填入 `.env.example` 的 worker 欄位。
3. `python3 -m worker.runner --once`：收集一次；新版預設每批最多 20 篇、每篇 1,200 字元，依雲端預算與篩選設定處理。
4. `python3 -m worker.runner --monitor`：恢復未完成工作；沒有積壓工作時不啟動新分析。
5. `python3 -m worker.install --daily --enable` 安裝每日排程：每分鐘讀取雲端 daily_time，執行到期方向的全網搜尋與到期 RSS 收集；同日成功項目不重複執行。
6. `python3 -m worker.runner --schedule-preview` 只列出到期項目數，不呼叫模型。

`.env.worker` 與 `.data` 禁止提交。服務金鑰略過 RLS，是受控主機的高權限憑證；不能放進 VITE_ 變數或網頁。
全網模式先呼叫搜尋，再進行批次分析及每個啟用方向各一次詳細報告整理；同一主機正常工作與恢復監控共用 flock，額度等待會釋放鎖。
本機已啟用 com.shixun.daily。執行程式、CLI、資料與私密環境設定安裝至 ~/Library/Application Support/Shixun，避免背景程序不能存取 Documents 的問題。更新 worker 後需在沒有工作執行時重新安裝；原始碼推送不會更新這台主機的安裝副本。

## 每日時間與閱讀操作
「方向與來源」的每個項目均可編輯每日觸發時間（Asia/Taipei）。未指定項目預設 09:00；既有研究方向沿用已知的 08:00、08:30、09:30、21:30。RSS 每個來源各自到期才抓取，不要求手動啟用 hybrid；手動 --once 仍遵守 COLLECTION_MODE。
主機需開機、登入及連網；恢復後補跑當天已到期項目，不補跑所有歷史日期。工作依序處理，前一輪未結束可能延後新項目。失敗保存工作並退避重試；部分成功不會將失敗來源標成完成。
閱讀頁右下角「↑ 回到頂端」可一鍵返回頁首，並遵循減少動畫偏好。

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
# 可選：免登入讀寫驗證；新追蹤會清除，收藏狀態會還原
TEST_ALLOW_WRITES=1 npm run test:e2e
# 可選：真實雲端整合測試（需要 .env.worker；自建、清除隔離測試帳號）
python3 -m tests.integration
```
測試替身驗證額度不足與上傳中斷，不刻意耗盡真實額度。
實際完成與尚待驗證範圍見 [VALIDATION.md](docs/VALIDATION.md)。

## 範圍與限制
這是依 Notion v5 重新開發的版本，不含舊 SQLite 資料搬移。
URL 正規化與穩定 ID 防止同文重複；尚不包含完整語意事件聚類。
延續追蹤由使用者手動建立，AI 不自動新增候選。每批最多帶入 8 個文字相關的有效追蹤與精簡歷史；文字篩選可能漏掉同義詞，不代表所有項目均已評估。
尚未介接專用即時行情／籌碼 API；公開網頁可能提供行情或估值，必須保留時點與缺口。不提供交易執行、多用戶協作、通知寄送或離線閱讀。
RSS 是可選補充來源；研究設定存在 Supabase，不提交 GitHub；網站採完全免登入存取。

規格來源：[Notion AI RSS v5](https://app.notion.com/p/3ff9d64f640e8028aae2c4b2cc6501cc)
官方技術依據：[Codex App Server](https://learn.chatgpt.com/docs/app-server)、[Codex non-interactive](https://learn.chatgpt.com/docs/non-interactive-mode)、[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)。

## 2026-10-28 版本與發布邊界
- 文章內選取摘要／來源文字或文章主題，可手動建立延續追蹤；起始摘錄由雲端核對原資料。追蹤提供後續文章、來源網站、分析次數與近七日新增統計。
- 舊追蹤依使用者清空要求移入可還原回收區。刪除追蹤不刪文章或收藏。文章收藏只供稍後閱讀，不會啟動監控。
- 新執行端支援每日預算 60,000 Token、最多 4 次 AI 呼叫；所有搜尋、摘要與詳細報告合併計算。這是啟動前的軟上限，實際單次用量仍可能超出預估，不代表供應商剩餘額度。
- CLI 回報用量優先；未知用量保留預估，程序中斷也保留預估。一日兩次失敗即等待翌日；一次失敗至少等一小時。台北午夜重新歸帳，未完成工作續跑，不丟棄文章。
- 成功摘要／詳細報告 checkpoint 重用。詳細報告以本輪已保存摘要與證據連結統整；超出預算時不同方向可能跨日完成，不保證每天每方向都有新報告。
- 關鍵字篩選在本機完成，排除優先，文章仍保存。調整預算不使成功摘要失效；更改研究方向或筆記仍會重新核對分析。
- 發布端接受原始 JSON 並清除非法 NUL，已修復舊執行端 PDF 資料造成的上傳阻塞；新執行端另防止將 PDF 二進位誤讀為網頁全文。
- **Git 推送只更新網站；不會更新 Mac mini 已安裝的程式。** 網站讀取節點 `agent_version`，只有主機回報 `2026-10-28` 才顯示新整理限制已支援。尚未更新時設定照常保存，畫面明示待更新，不宣稱已限制模型用量。
- 2026-10-28 已實際觀察舊 Mac mini 積壓批次重新發布、待上傳歸零；本次不透過本機 Git 擅自更換主機模型設定。
