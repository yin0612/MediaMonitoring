# 台灣新聞輿情監測系統

這是免費、公開的新聞資料分析網站，不是商業 SaaS。正式入口為首頁 `#/`；新聞搜尋位於 `#/search`，另提供近期新聞、進階分析、資料總覽、關鍵字熱度、事件與主題、人物與組織、方法與狀態等頁面。首頁先說明資料涵蓋、更新狀態與研究限制，再提供可追溯的新聞與分析入口。

台灣新聞輿情監測：合併官方 RSS、各媒體的 Google News RSS（`site:官方網域`）與每 6 小時官網 metadata 快照，提供關鍵字搜尋、真實關鍵字熱度、來源分布、組織共現網絡與原文連結；首頁另顯示台灣 Google Trends「熱門搜尋」官方 RSS 摘要。

## 目前可用功能

- 新聞關鍵字搜尋：`1h`、`6h`、`24h`、`7d`。
- 關鍵字熱度（真實資料）：由近 24 小時新聞重算 `100 × (0.50V + 0.33A + 0.17D)`，其中 `V = log1p(命中數) / log1p(當期最大值)`、`D = 來源分布熵 / ln(來源數)`；人工監測詞來自 `config/watch_terms.yml`，自動熱詞由標題 n-gram 統計（跨 ≥3 家媒體才入榜）。
- 搜尋結果的熱度是**另一套分量定義**：權重相同，但 `V = 命中數 / 來源數`、`D = 命中來源數 / 來源數`，且統計在取前 100 筆之後計算。因此搜尋頁的 `聲量` 上限為 100，命中數達 37 篇後 `V` 即飽和為 1.0，熱門詞之間的熱度差異有限。Worker 與離線 fallback 使用完全相同的公式與切片，數字不會因 Worker 是否可用而改變。
- 近期升溫關鍵字：以最近 90 分鐘與前一個 90 分鐘為兩個半開時間窗，列出出現至少 2 篇且頻率增加的既有關鍵字；這是描述性頻率訊號，不等於趨勢預測、因果判斷或完整全網監測。
- 人物與組織共現網絡（真實資料）：以 `config/entities.yml` 的公眾人物／ORG 詞典比對近 24 小時新聞，同篇共現建邊；共現不代表支持、反對或因果。
- 實驗性詞典情緒：由管線填入逐篇 `label`、`score`、`matched`，主題頁顯示正負代表文章與命中詞；未達 macro-F1 0.70 前只視為 baseline。已知限制：每個情緒詞只採計第一次出現的位置，否定判斷也只看該位置，因此同詞多次且極性不一致的句子只會反映第一次的判讀（Python 與 Worker 兩端行為一致）。
- 台灣 Google Trends RSS：熱門字、約略搜尋量、發布時間與相關新聞。
- 個別來源失敗時顯示 `partial`；Worker 離線時改讀 GitHub Pages 最後快照並標示 `stale`。
- 搜尋結果不使用共用快取，搜尋後每 30 秒自動刷新；儀表板頁面每 90 秒自動刷新快照；Google Trends 每 2 分鐘檢查，Worker 最多快取 60 秒。
- 進階分析工作台：最多三主題比較，支援 `AND`、`OR`、`NOT`、`-排除詞` 與雙引號精準詞，包含聲量、來源、實驗性情緒、關聯詞與文章篩選。
- 時間正規化單一規則（`timeutil.py`）：無時區時間視為台北時間；台灣時間誤標 GMT 的未來時間自動校正；無法解析或仍為未來的時間直接捨棄，並在來源狀態頁顯示捨棄統計。
- 熱度排行的數字只在排行欄顯示一次；熱度條本身只呈現視覺比例，避免手機版重複數字造成跑版。

來源固定為 37 家指定媒體（實際數量以 `config/sources.yml` 為準，前端顯示的數量由該清單推導）。官方 RSS 可用時優先使用；同一媒體可合併多個官方分類 RSS（目前中央社使用政治、地方、社會、財經、科技與生活健康 feed），不可用時才改用該媒體官方網域的 Google News RSS 補充，部分媒體另有遵守 robots.txt 的低頻官網 metadata 擷取。來源狀態會隨每次更新顯示，不會把失敗來源偽裝成成功。

## 架構

資料新鮮度主要靠 Cloudflare Worker 的 Cron Trigger（每 5 分鐘），GitHub Actions 則負責 CI、前端部署與離線備援快照。

```text
瀏覽器（GitHub Pages 前端）
  ├─ 儀表板資料：先讀 Worker /api/data?name=…（每 5 分鐘更新），失敗改讀 Pages public/data
  ├─ 新聞搜尋：Worker /api/search（即時）；失敗時 24h 內先讀 recent，7d 按 manifest 讀日分檔
  └─ Google Trends：Worker /api/trends（快取 60 秒），失敗改讀 Pages trends

Cloudflare Worker（免費層）
  ├─ Cron */5：抓 37 家來源 → 合併近 24 小時工作集 → 重算逐篇輕量情緒與 sources/meta → 寫入 KV
  ├─ keywords/entities/topics：搬運 Actions/Python 公開快照，避免 Free Cron 的 10 ms CPU 上限
  ├─ /api/data：從 KV 取儀表板各檔（新鮮度 ≤5 分鐘）
  ├─ /api/search、/api/trends、/api/health
  └─ 分析邏輯（analysis.js）與 config 由 config/*.yml 於部署前產生（gen-config），與 Python 端同一套規則

GitHub Actions（每 5 分鐘 best effort，作為備援；排程觸發跳過重複測試以縮短延遲）
  ├─ Python 管線 → public/data/*.json（含熱詞、人物／組織、主題次事件與逐篇情緒）
  ├─ archive → 完整相容檔 + news-archive-index.json + UTC 日分檔
  ├─ Google News RSS 補充 → 官方 RSS 不可用的來源每次執行都有新資料
  └─ 官網 metadata 管線 → 每個來源最多每 6 小時一次
```

新聞僅保存來源、標題、最多 140 字短摘要、發布時間與原文 URL；不保存或重製全文與圖片。7 天搜尋僅涵蓋已啟用來源的快照，不代表完整全網新聞。

## 一鍵執行與持續更新

本專案已配置一鍵同步與啟動腳本：

```bash
# 1. 立即同步與更新最新新聞輿情資料 (擷取 37 家媒體 RSS 與 Google Trends)
./scripts/sync_data.sh

# 2. 啟動 Web 前端儀表板
./start_dev.sh
```

## 本機執行

需要 Python 3.11+ 與 Node.js 22+。

```powershell
python -m pip install -r requirements.txt
$env:PYTHONIOENCODING = 'utf-8'
python -m pytest -q
$env:PYTHONPATH = 'src'
python -m opinion_pipeline.cli

Set-Location web
npm install
npm test
npm run dev
```

若 Worker 搜尋不可用，前端直接以 Pages 的 `recent.json`（最長 24 小時）或
`news-archive-index.json`＋日分檔（7 天）搜尋最後快照；完整
`news-archive.json` 只保留給舊部署相容。要使用即時 Worker，複製
`web/.env.example` 為 `web/.env.local` 並設定：

```text
VITE_API_BASE_URL=https://your-worker.workers.dev
```

## Cloudflare Worker

```powershell
Set-Location worker
npm install
npm test
npx wrangler login
npm run deploy
```

部署後將 Worker 網址填入 `web/.env.local`。公開部署可在 GitHub Actions 建置步驟透過 repository variable 注入。系統不需要付費新聞 API Secret；免費服務都有額度與 CPU／請求限制，程式不會自動升級付費方案。

### UI 手動更新

頁首的「立即更新」按鈕會呼叫 Worker 的 `POST /api/refresh`。Worker 將 GitHub Token 留在伺服器端，觸發 `refresh-data.yml`，並在背景重建 KV 快照。端點只接受設定的 Pages Origin，且每個用戶端 IP 五分鐘內只能觸發一次（超過時回 `429` 與剩餘秒數）。

更新分兩段回報，兩段互不阻擋：

- **fast**：Worker 立即重抓來源並重建 KV 快照，數十秒內就能看到新新聞。
- **deep**：觸發 GitHub Actions 重算關鍵字、人物組織與主題，完成後前端再同步一次。未設定 `GITHUB_TOKEN` 時 deep 會回報 `unavailable`，fast 仍照常完成。

**未設定 `VITE_API_BASE_URL`（沒有部署 Worker）時**，按鈕會退化為繞過快取重讀 Pages 上最新的已發布快照，並明確告知資料每 5 分鐘由排程更新——不會靜默失敗，但也不會即時重抓來源。要有真正的即時更新，必須部署 Worker 並設定該變數。

部署 Worker 前，請先將可觸發 GitHub Actions 的 Token 設為 Worker Secret：

```powershell
Set-Location worker
npx wrangler secret put GITHUB_TOKEN
```

Token 必須具備觸發該 repository workflow 的權限；同時將 `web/.env.local` 與 `refresh-data.yml` 使用的 GitHub repository variable `VITE_API_BASE_URL` 設為已部署的 Worker 網址。

## GitHub Pages

1. Repository `Settings → Pages → Source` 選擇 **Deploy from a branch**，分支選 `gh-pages`、路徑 `/`。
   `refresh-data.yml` 會把建置結果強制推到 `gh-pages`，再由 GitHub 自動發布；**不要**選 GitHub Actions，否則這條部署路徑不會生效。
2. 推送至 `main`，或手動執行 `Refresh data and deploy`。
3. 排程每 5 分鐘嘗試更新一次；GitHub 對 `schedule` 事件會依負載大量延後或合併，實際間隔可能遠大於 5 分鐘，故 UI 一律顯示實際資料時間。部署 Worker 後由 Worker 的 Cron 主動觸發，時間才會穩定。
4. `VITE_API_BASE_URL` 未設定時仍會照常建置與部署（靜態快照模式），只是沒有即時更新能力。

正式站點：<https://yin0612.github.io/MediaMonitoring/>

## 資料來源

| 來源 | 狀態與用途 |
|---|---|
| TVBS、東森、三立、民視、中天、年代、壹電視、公視新聞、台視新聞、華視新聞 | 官方 RSS優先；Google News 補充；允許者每 6 小時低頻擷取 metadata |
| UDN、自由時報、中央社、經濟日報 | 中央社使用多分類官方 RSS；UDN 與經濟日報不直接擷取官網，改用可用的 Google News 補充 |
| 工商時報、鉅亨網、財訊、商業週刊 | 商業週刊使用官方 RSS；其餘官方 RSS 優先；Google News 補充；允許者低頻擷取 metadata |
| 關鍵評論網、報導者、新頭殼、NOWNEWS、壹蘋新聞網、ETtoday | 官方 RSS優先；Google News 補充；允許者低頻擷取 metadata |
| Google Trends TW | 官方 Trending Now RSS；僅作熱門搜尋摘要 |

## 驗證指令

```powershell
python -m pytest -q

Set-Location worker
npm test

Set-Location ../web
npm test
npm run typecheck
npm run build
# 另於 web 目錄執行：npm run test -- ../web/test/route-smoke.test.tsx
```

官方 RSS 來源、驗證結果與使用限制整理於
[docs/official-rss-sources.md](docs/official-rss-sources.md)。根目錄 README 是目前功能、架構、執行方式與部署流程的單一維護入口。
