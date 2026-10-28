# 雲端局部延伸：既有設計核對

核對日期：2026-10-28（Asia/Taipei）。範圍是既有 React／Vite 閱讀系統的手動追蹤、來源回查、文章收藏說明與整理預算設定。此文件記錄成品來源與延伸方式，不代表使用者批准新品牌或全站設計變更。

## 判定與依據

本次屬於 ordinary extension。既有世界由 commit `447b3a2c76e1435b8ce81a57f3b03ac0dd749dd0` 的實作確立，並由 [產品背景](../PRODUCT.md) 與 [局部延伸 brief](deploy-surface.md) 指定沿用。沒有替換視覺世界、approved comp 或新增 shipping raster。

已比較基準版本與本次工作目錄的 `src/style.css`：基準版本共 1,040 行，是目前檔案逐字不變的前綴；新增樣式全部接在其後。這是既有系統獲保留的程式來源證據，不等同於跨裝置視覺或互動測試通過。

已讀取 `reference/document.md` 與 `reference/new-work.md`。後者對 ordinary extension 要求「比較成品與既有系統、保留系統檔案、回報檢查證據」，並將必須產出 token-bearing `DESIGN.md` 及 `.impeccable/design.json` 的情況限定於新世界或已批准的系統變更。本案沒有這兩種變更，因此只新增本核對文件。原本沒有 `DESIGN.md` 與 sidecar 是既有文件缺口，沒有據此虛構品牌北極星、色階或使用者批准紀錄。

## 既有視覺事實

以下是從基準與現有 CSS 抽取的觀察，方便核對此次加入的區域；不是將所有舊樣式升格成未來設計規則。

| 面向 | 既有來源與數值 | 此次延伸關係 |
| --- | --- | --- |
| 基底與文字 | `--paper: #faf9f5`、`--ink: #203f36`、`--line: #e0e3da`、`--accent: #426c52`；根文字色 `#263b34` | 保留紙白基底、墨綠操作色與淡灰綠分隔線。來源：[CSS 根設定](../src/style.css#L2)。 |
| 次要文字 | 根 `--muted: #717970` | 根值保留；僅本次新增區域局部覆寫，見下節。 |
| 字體 | Noto Sans TC 正文、Noto Serif TC 標題；h1 原始 `clamp(26px, 2.5vw, 38px)`，既有 compact 頁標題 23px；h2 21px | 沿用已載入字體與層級。新增追蹤數字使用 22px、等寬數字排版，未引入新字型。來源：[字體與標題](../src/style.css#L1)、[既有 compact 版型](../src/style.css#L1011)。 |
| 按鈕與表單 | 主要按鈕為墨綠底、白字、5px 圓角、11px 17px 內距；次要按鈕為透明底與細框；輸入框為紙白底、4px 圓角 | 手動新增、儲存、復原與確認皆重用既有 `primary`；表單重用原輸入元件。來源：[按鈕](../src/style.css#L250)、[欄位](../src/style.css#L346)。 |
| 容器與對話框 | 設定區與追蹤卡為細框、5px 圓角；報告卡已有 12px 圓角；原生 dialog 為紙白底、8px 圓角、最大 88vh、內容可捲動 | 新預算沿用設定區；選取摘錄用既有報告卡同級的 12px 圓角；追蹤建立與刪除使用原生 dialog。來源：[設定區](../src/style.css#L519)、[追蹤卡](../src/style.css#L557)、[dialog](../src/style.css#L682)、[報告卡](../src/style.css#L1020)。 |
| 狀態與互動 | 原有 alert／error／notice 色系、disabled 降透明、全域 3px 金色 focus-visible、0.18s 顏色轉場與 reduced-motion 停用 | 新錯誤狀態重用原樣式與原生控制項；沒有新增動畫語言。來源：[全域互動](../src/style.css#L35)、[訊息樣式](../src/style.css#L611)、[減少動態](../src/style.css#L957)。 |

## 新增區域與資料呈現

| 區域 | 實作觀察 | 來源 |
| --- | --- | --- |
| 手動入口、狀態篩選與回收區 | 入口使用既有主要按鈕、tabs、track-card 與 empty。清空與單筆刪除先進確認框；說明移到可復原回收區，文章與收藏保留。 | [追蹤列表](../src/main.tsx#L630)、[刪除確認](../src/main.tsx#L1075) |
| 選取文字與文章主題 | AI 摘要與取得的來源文字分別標示；選取區展示使用者實際摘錄，超過 2,000 字時停用建立。觸控選取監聽 `selectionchange`。選取色為淡灰綠底與既有墨綠文字。 | [ArticleExcerpt](../src/tracking.tsx#L12)、[局部樣式](../src/style.css#L1058)、[選取色](../src/style.css#L1163) |
| 起始報告與來源回查 | 報告入口攜帶報告、研究方向及證據識別；建立框顯示原始摘要與來源。追蹤詳情依起始報告與研究方向回查報告標題、發布時間及起始來源連結；資料不在目前集合時顯示缺口。 | [報告入口](../src/reports.tsx#L214)、[建立框來源](../src/main.tsx#L960)、[追蹤來源回查](../src/tracking.tsx#L144) |
| 目前變化與近七日統計 | 使用定義列表呈現後續報導、來源網站、分析更新與近七日新增；每日資料使用有 caption、表頭與列標題的表格。說明起始資料不計入後續報導、日期按首次關聯日且非市場熱度。沒有新圖表或裝飾性插畫。 | [TrackSummary](../src/tracking.tsx#L113)、[統計樣式](../src/style.css#L1082) |
| 刪除失敗與重試 | 失敗時確認框內用既有 `alert error` 與 `role="alert"` 顯示錯誤，保留「重試移到回收區」；執行中按鈕停用。此處記錄程式狀態，不取代獨立測試證據。 | [刪除流程](../src/main.tsx#L249)、[確認框](../src/main.tsx#L1075) |
| 收藏說明 | 用純文字說明收藏是稍後閱讀書籤，不啟動 AI 追蹤；移出收藏不影響延續追蹤。 | [收藏說明](../src/main.tsx#L440)、[局部文字樣式](../src/style.css#L1054) |
| 整理預算 | 使用既有設定區、details、定義列表與表單。預算、實際回報、未知用量分開；沒有紀錄時明示未知。是否支援由執行端版本回報判斷。 | [BudgetSettings](../src/budget.tsx#L11)、[局部預算樣式](../src/style.css#L1127) |

新增區域的次要文字局部使用 `--muted: #596457`，涵蓋手動入口、選取說明、選取摘錄、追蹤總覽、收藏說明與預算設定；沒有改動全域 `--muted`。預算區的重要 alert 文字另沿用 `--ink`。來源：[局部覆寫](../src/style.css#L1042)、[總覽／摘錄／收藏覆寫](../src/style.css#L1131)。這是本次可讀性修正，未將原有低對比值定義為新規則。

## 手機與桌面規則

- 保留桌面側欄與現有內容區；既有 1150px 斷點縮小側欄與內距，追蹤卡由三欄變兩欄。
- 保留 760px 以下的頂部橫向可捲導覽、內容左右 20px 內距，以及設定／追蹤卡單欄。原生 dialog 仍以 `min(700px, calc(100% - 30px))` 與可捲動內容限制在視窗內。
- 新增 680px 以下規則：追蹤統計由四欄變兩欄；預算欄位由兩欄變單欄；預算定義列表由標籤／數值雙欄變單欄；手動入口說明獨占一列。
- 摘錄保留換行並允許長字串折行。每日統計維持日期與篇數兩欄；沒有強加寬圖表。
- brief 指定桌面 1440×1000、手機 390×844。此文件核對 CSS 與元件，沒有另開視覺審查或產生新截圖；五張本機 review 截圖仍由既有審查流程處理。

來源：[既有響應式規則](../src/style.css#L755)、[新 680px 規則](../src/style.css#L1167)、[brief](deploy-surface.md)。

## 有意保留的既有問題與邊界

- 根 `--muted: #717970` 與未納入此次範圍的既有次要文字對比問題保留，沒有因為被文件記錄而成為推薦規格。
- 報告重點區的 3px 左框、背景與不對稱圓角在 `447b3a2` 已存在，本次未新增或修正。來源：[既有 report-overview](../src/style.css#L980)。
- 原有 glyph 導覽圖示、eyebrow／kicker、小字與混合圓角仍是既有實作；本文件不將其升格成新頁面必須複製的設計規則。
- 雲端保存預算設定，不代表家用執行端已套用限制。版本未回報支援時，畫面明示仍需更新主機程式；本核對不宣稱 Mac mini 已生效。來源：[支援狀態](../src/budget.tsx#L25)。
- 本文不包含真實新聞內容、個人追蹤資料、執行數據或截圖。`.impeccable/review/` 已列入 [gitignore](../.gitignore)，本次沒有 shipping raster，因此沒有新增影像 provenance 或上傳工作。

## 證據與結果範圍

本次實際檢查：`PRODUCT.md`、`.impeccable/deploy-surface.md`、`src/style.css`、`src/main.tsx`、`src/tracking.tsx`、`src/budget.tsx`、`src/reports.tsx`、`.gitignore`，以及 `git show 447b3a2:src/style.css` 與相對該版本的 CSS 差異。技能依據位於 `/Users/ngss/.agents/skills/impeccable/reference/document.md` 與同目錄 `new-work.md`。

ordinary extension 核對結果：既有 CSS 世界完整保留；新增區域重用既有視覺原件，局部規則、手機佈局與執行端限制已有來源可回查。本文件只完成設計文件核對，不宣告 reviewer 的最終 disposition，不取代互動驗證或部署驗證。
