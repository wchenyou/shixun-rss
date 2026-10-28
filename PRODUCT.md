# 拾訊：雲端智慧閱讀與手動延續追蹤

## Platform
web
## Stack
既有 React／TypeScript／Vite，Vercel Git 部署，Supabase 資料與 RPC，家用執行端另以 Python 呼叫既有 CLI。
## Users and purpose
Aaron 自用，手機與電腦在外閱讀已發布資訊，手動選取值得持續觀察的問題。
## Operating context
正式網址 shixun-rss.vercel.app；本次沿用已存在的 wchenyou/shixun-rss。原本本機 Python 網站是另一份實作，不能視為雲端版本已更新。
## Confirmed constraints
使用者要求全部清除舊追蹤、手動選字／主題加入、查看變化與統計、釐清收藏，以及節省 AI 用量。本次明確要求透過本機 Git 部署。
## Principles
AI 不新增追蹤；來源與 AI 摘錄分開；沒有資料不假造變化；預估與實際用量分開。保留既有公開單一閱讀空間權限，不在本次改變存取方式。
## Working assumptions
刪除採可復原回收區；2026-10-27 之前舊追蹤清空列表，保留文章與收藏。網站／資料庫可獨立部署；家用執行端需要另套用程式，未回報新版本前清楚顯示限制。
