# MediaMonitoring 最終分析與完整強化計畫

> 稽核基準：2026-08-09 23:30（Asia/Taipei）  
> GitHub：`yin0612/MediaMonitoring`  
> 正式站：`https://yin0612.github.io/MediaMonitoring/`  
> 正式 Worker：`https://media-monitoring-demo.media-monitoring-worker.workers.dev`

## 1. 最終結論

目前系統已經是**可運作的公開新聞監測 MVP**，不是需要重寫的失敗專案：

- GitHub、Pages、新 Cloudflare Worker、KV、Secret 名稱、CORS 與五分鐘 Cron 已接通。
- 新 Worker 每五分鐘成功觸發 `repository_dispatch`，最新 Actions、Pages 與 live API 都能正常回應。
- Python、Worker、Web 測試與 production build 均通過。
- 37 家媒體、即時搜尋、趨勢、關鍵字、主題、情緒、實體與跨裝置 UI 已形成完整產品骨架。

但目前仍有三個 P0 正確性問題，修好前不能把網站描述成「完整的 30 日深度輿情系統」：

1. **30 日搜尋不是真的 30 日**：線上 Worker 的 30 日查詢只讀 recent，實測「台積電」回 8 篇；Pages 的 7 日資料已有 17 篇。
2. **手動更新狀態機失效**：三筆正式 KV 狀態都永久停在 `fast=running / deep=queued`，即使 Actions 已成功。
3. **「資料完整」判斷過度樂觀**：只要來源請求成功就算健康；零篇來源、摘要缺漏與 fallback 比例都沒有進入信心判斷。

因此正確策略是：**先修正確性與安全，再擴成 30–90 日可查資料層，最後升級事件、情緒、實體與敘事分析。**

## 2. 現況總表

| 領域 | 現況 | 判定 |
|---|---|---|
| GitHub repository | 公開、`main`、最新 SHA `a45c79d` | 正常 |
| GitHub Pages | `gh-pages` legacy branch，HTTPS，最新部署成功 | 正常但發布方式可改善 |
| GitHub Actions | CI、refresh、Pages build 均成功 | 正常但排程重複 |
| Cloudflare Worker | 新帳號版本 18、正確 vars/KV/secret | 正常 |
| Cloudflare Cron | 新 Worker 每 5 分鐘持續觸發 | 正常 |
| 舊 Worker | 仍可回應，snapshot 已停止更新 | 過渡備援，待退場 |
| 即時資料 | Worker 約 2 小時工作集；Pages 為 7 日深度資料 | 可用但語意需拆清楚 |
| 30 日搜尋 | UI/API 有選項，實際沒有 30 日資料 | **P0 錯誤** |
| 手動更新 | 動作可觸發，但狀態不會完成 | **P0 錯誤** |
| 資料品質 | 37 家皆回應；仍有零篇來源與高摘要缺漏 | 需改品質模型 |
| 分析能力 | 詞典、規則、固定主題、共現、Boolean 比較 | 可解釋 baseline |
| 深度分析 | 尚無事件去重、語意分群、目標式情緒、異常基準 | 需擴充 |
| 前端 | 桌面／手機可用、路由 lazy load | 正常 |
| 前端效能 | ECharts 379.44 kB gzip | 需瘦身 |
| 供應鏈 | npm 有 high/moderate；Dependabot/CodeQL 未啟用 | **P0 安全工作** |

### 2.1 GitHub 已驗證設定

| 設定 | 目前值／狀態 |
|---|---|
| Repository | `yin0612/MediaMonitoring`，public |
| Default branch / HEAD | `main` / `a45c79d14c8fa968250d7b2d5bf3c504f50fb5ec` |
| Pages URL | `https://yin0612.github.io/MediaMonitoring/` |
| Pages source | legacy `gh-pages` branch、root |
| Repository variable | `VITE_API_BASE_URL=https://media-monitoring-demo.media-monitoring-worker.workers.dev` |
| Repository secret 名稱 | `CLOUDFLARE_API_TOKEN`；目前 workflow 沒有引用 |
| Actions 預設權限 | read；不允許 Actions 建立／核准 PR |
| Branch/ruleset | `main`、`gh-pages` 無保護，repository ruleset 為空 |
| 安全功能 | secret scanning / push protection 已開；Dependabot alerts/security updates 與 CodeQL 未開 |

### 2.2 Cloudflare 已驗證設定

| 設定 | 目前值／狀態 |
|---|---|
| Account ID | `c9b5a889cfd03a2438593d110a4939ad` |
| Worker / URL | `media-monitoring-demo` / `https://media-monitoring-demo.media-monitoring-worker.workers.dev` |
| 目前 deployment | 100% `bca8995d-2f18-4823-b070-16afc4fd3ec2` |
| KV binding | `SNAPSHOT` → `7f726665db69456aba1da52ddeeeb563` |
| Plaintext vars | `ALLOWED_ORIGIN=https://yin0612.github.io`；`ARCHIVE_BASE_URL=https://yin0612.github.io/MediaMonitoring` |
| Secret 名稱 | `GITHUB_TOKEN`；值未讀取、未輸出 |
| Cron | `*/5 * * * *`，線上 dispatch 與 snapshot 證實持續執行 |
| CORS | Pages origin 回 `Access-Control-Allow-Origin: https://yin0612.github.io`；preflight 204 |
| 舊環境 | 舊 KV `7b3cce6f054f4918bf5a27dc5386a322` 與 Worker 暫留 rollback；snapshot/dispatch 已停止 |
| 尚待人工核對 | 舊帳號 Dashboard 的 Trigger 列表【資料不足,無法確認】 |

## 3. 程式與資料架構盤點

### 3.1 Python 深度管線

主要檔案：

- `src/opinion_pipeline/cli.py`：來源協調、7 日合併、主題、趨勢與公開 JSON。
- `connectors/rss.py`：RSS/Atom、重試、429、時間與結構驗證。
- `connectors/google_news.py`：官方網域 Google News fallback。
- `connectors/html_listing.py`：robots-aware 低頻官網 metadata 擷取。
- `connectors/trends.py`：Google Trends 網頁即時榜與 RSS。
- `archive.py`：canonical URL、去重、時間範圍、公開欄位。
- `analysis.py`：監測詞、自動 n-gram 熱詞、熱度、ORG/PERSON 共現。
- `sentiment.py`：詞典式三分類與可追溯 matched terms。

優點是免費、可重算、可追溯；限制是 substring、固定詞典與固定主題無法處理語境、同名、反諷、新人物與新事件。

### 3.2 Cloudflare Worker 快管線

`worker/src/index.js` 目前同時負責：

- CORS、router、health、search、trends、snapshot、KV。
- 來源 RSS 抓取、Pages fallback、即時情緒與來源狀態。
- Cron、GitHub dispatch、公開手動 refresh、refresh status。

單檔約 700 行且責任過多；可靠性問題集中在 KV 狀態協調、同步扇出搜尋、空 catch 與缺少結構化遙測。

### 3.3 React/Vite 前端

已包含首頁、搜尋、近期、進階比較、總覽、關鍵字、主題、實體與方法頁；頁面使用 `React.lazy`，手機 375×812 無水平溢出，行動導覽可操作。

主要限制：

- Worker/Pages 每次雙抓後只以 `generatedAt` 選較新者，沒有比較資料窗與品質。
- `useData` 無 AbortController、共享 cache 或 in-flight dedupe。
- 進階分析各主題各打一輪 API，沒有跨主題事件去重與統計不確定性。
- ECharts 整包進單一 1.14 MB minified chunk。

### 3.4 GitHub 與發布

- `ci.yml`：Python、Worker、Web、typecheck、build。
- `refresh-data.yml`：Python 更新、Web build、force push `gh-pages`。
- Worker Cron 與 GitHub `schedule */5` 同時存在；最近 100 次紀錄已有 25 次 Worker dispatch 與 3 次 GitHub schedule，證實重複執行。
- 每次 refresh force push `gh-pages` 後又觸發 Pages legacy build，形成兩段 workflow。
- `main`、`gh-pages` 無 branch protection/ruleset。
- Secret scanning/push protection 已開；Dependabot alerts/security updates 與 CodeQL 未開。

## 4. 實際資料來源與品質基準

本機稽核快照與線上最新快照會持續變動，以下數字只作本次修改基準：

- 登錄來源：37。
- 設定能力：20 家有 RSS、12 家有 HTML listing、2 家兩者皆有、7 家完全依賴 Google News fallback。
- 7 日本機 archive：1,554 篇、34 個實際有內容來源。
- 本機 recent：800 篇、31 個來源；受上限影響只覆蓋約 9 小時 43 分，不保證完整 24 小時。
- recent 無摘要：461/800（57.6%）；archive 無摘要：960/1,554（61.8%）。
- recent 情緒：中立 576、負向 157、正向 67；沒有人工標註前不可解讀為媒體立場。
- URL/ID 無重複；跨來源相同標題仍有 10–11 筆，代表事件聲量尚未去轉載。
- 關鍵字：24 個監測詞＋30 個自動詞。
- 主題：6 個固定大類；同篇可跨類，泛詞會造成錯分。
- 實體：37 節點、28 邊，其中 19 個孤立；共現不代表關係。
- Trends：20 筆，10 筆為網頁即時榜，6 筆附相關新聞。
- 9 個已不在 manifest 的舊日分檔仍留在目錄，約 2.97 MB。

### 4.1 現行信心判斷的根本問題

現在的 `37/37 正常` 只回答「來源請求是否成功」，沒有回答：

- 是否真的有新聞；
- 最新一篇距今多久；
- 摘要是否存在；
- 是官方 RSS、官網 listing 或 Google News fallback；
- 本輪遺失多少筆；
- 是否被單一來源或同一事件大量轉載支配。

所以 UI 顯示「資料完整」並不等同內容完整。這應由新的 `quality` 契約解決，而不是只改文案。

## 5. P0：先修正確性、安全與維運（1–3 天）

### P0-1：立刻停止假 30 日搜尋

**修改位置**

- `web/src/pages/SearchPage.tsx`
- `web/src/pages/AdvancedAnalysisPage.tsx`
- `web/src/types/contracts.ts`
- `web/src/api/search.ts`
- `worker/src/index.js`
- `worker/src/core.js`

**修改方法**

1. 在 D1/30 日 archive 完成前，先從兩個 UI 移除 `30d`，或顯示 disabled「建置中」。
2. `SearchRange` 暫時只保留真正支援的範圍。
3. Worker `archiveItems()` 不得再讓 `30d` 走 `recent.json`。
4. 加一個跨 30 日 fixture：第 1、8、20 天各有命中；若資料層只回近 24 小時，測試必須失敗。

**完成條件**

- 使用者看不到系統無法兌現的時間範圍。
- Worker 與 Pages fallback 對所有可見 range 的資料窗一致。

### P0-2：重做 manual refresh 狀態機

**修改位置**

- `worker/src/index.js`，之後拆到 `routes/refresh.js`、`services/refresh-state.js`
- `.github/workflows/refresh-data.yml`
- `web/src/api/client.ts`
- `web/src/components/Layout.tsx`
- Worker/Web refresh tests

**修改方法**

不要再對同一 KV key 做並行 read-modify-write。改成不可互相覆蓋的事件鍵：

```text
refresh:{id}:meta   -> requestedAt, requester hash
refresh:{id}:fast   -> running/completed/failed
refresh:{id}:deep   -> queued/completed/failed/unavailable
```

`handleRefreshStatus()` 用 `Promise.all()` 讀三個鍵後組裝回應。fast/deep 任務直接覆寫自己的鍵，不先讀初始狀態。

Deep 完成必須有真實回報，推薦作法：

1. Manual refresh 改送 `repository_dispatch: manual-refresh`，`client_payload` 帶 `refreshId`。
2. GitHub workflow 最後向 `/api/internal/refresh-complete` 回報成功／失敗與 `generatedAt`。
3. GitHub 與 Worker 各存同一個 `REFRESH_CALLBACK_SECRET`；callback 比對 secret digest，端點不接受瀏覽器 CORS。
4. Workflow 使用 `if: always()` 回報結論，避免失敗時永遠 queued。
5. 前端改成 2、3、5、8 秒漸進退避，最多等 180 秒；離開頁面後不阻塞，完成時再全域刷新。

**替代方案**

若不想新增 callback secret，status endpoint 可抓 Pages `meta.json`，當 `lastDeepAt >= requestedAt` 時推導 completed；但這只能證明新深度快照發布，不能精準對應特定 workflow。推薦 callback。

**完成條件**

- fast 在測試與 staging 會到 completed/failed。
- deep 在 Actions 結束後 10 秒內到 completed/failed。
- 兩個併行任務不會互相回退狀態。

### P0-3：只保留一個主排程

**修改位置**

- `worker/wrangler.toml`
- `worker/src/index.js`
- `.github/workflows/refresh-data.yml`

**修改方法**

將「快資料」與「深度部署」拆頻率：

```toml
[triggers]
crons = ["*/5 * * * *", "2,17,32,47 * * * *"]
```

- `*/5`：只跑 Worker fast snapshot。
- 每 15 分鐘：只 dispatch GitHub deep workflow。
- GitHub 原生 `schedule */5` 改為每小時第 23 分鐘一次的備援，例如 `23 * * * *`。
- 備援 workflow 先檢查 Pages `lastDeepAt`；未超過 25 分鐘就 no-op。
- 保留 `concurrency`，但將 group 分成 `refresh-deep` 與 `deploy-pages`，避免無關工作互相取消。

Cloudflare Cron 變更可能需數分鐘、最長約 15 分鐘傳播；發布時用 run history 與 Worker meta 交叉驗證。[Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)

**完成條件**

- 每小時約 12 次 fast、4 次 deep，不再每五分鐘跑完整 Python/build/deploy。
- 連續一小時沒有重複的同分鐘 deep run。

### P0-4：保護公開 refresh

**修改位置**

- `web/src/components/Layout.tsx`
- `web/src/api/client.ts`
- `worker/src/index.js`
- Worker secrets/variables

**修改方法**

1. 加 Cloudflare Turnstile managed widget。
2. Web 傳 `turnstileToken`；Worker 必須呼叫 Siteverify 驗證，不能只相信 client widget。
3. Token 驗證成功後才檢查 cooldown、建立 refresh 與 dispatch。
4. 保留 IP cooldown 作第二層，但不要把 KV cooldown描述成原子安全控制。
5. 公開按鈕預設只做 fast；deep manual dispatch 可要求第二個更嚴格的 server-side rate limit，或只開給管理者。
6. 新增 `Content-Type: application/json`、body 大小上限、hostname/action 驗證。

Turnstile token 有效 300 秒且單次使用，server-side Siteverify 是必要步驟。[Cloudflare Turnstile validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)

### P0-5：修補依賴與 Actions 供應鏈

**修改位置**

- `web/package.json`、`web/package-lock.json`
- `worker/package.json`、`worker/package-lock.json`
- `.github/workflows/*.yml`
- 新增 `.github/dependabot.yml`

**修改方法**

在專用分支逐項升級，不使用 `npm audit fix --force`：

```powershell
Set-Location web
npm.cmd install react-router-dom@^7.18.2 vite@^8.2.1
npm.cmd test
npm.cmd run typecheck
npm.cmd audit

Set-Location ..\worker
npm.cmd install --save-dev wrangler@^4.120.0 js-yaml@^5.2.3
npm.cmd test
npm.cmd audit
```

React Router 6→7 要依 migration guide 檢查 HashRouter future flags、navigation type 與 tests，不能只改版本號。

本次查到的官方 Actions release 可固定為完整 SHA：

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
- uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
- uses: actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97 # v7.0.0
```

GitHub 建議把 Actions 固定到完整 commit SHA，避免 tag 被移動。[GitHub supply-chain guidance](https://docs.github.com/en/code-security/tutorials/secure-your-organization/protect-against-threats)

同時：

- 啟用 Dependabot alerts、security updates、version updates。
- `dependabot.yml` 監控 `/web` npm、`/worker` npm、root pip、GitHub Actions。
- 啟用 CodeQL default setup；Python、JavaScript/TypeScript 都納入。
- CI 加 `npm audit --omit=dev`、完整 npm audit high/critical gate、`PYTHONUTF8=1 uvx pip-audit -r requirements.txt`。

[GitHub Dependabot quickstart](https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/dependabot-quickstart)

### P0-6：修正文案與單一設定來源

**修改位置**

- `web/src/pages/MethodPage.tsx`
- `web/src/pages/SearchPage.tsx`
- `web/src/types/contracts.ts`
- `docs/official-rss-sources.md`
- README 與正式方法文件

**修改方法**

- 「約每 15 分鐘」改成從 meta 的實際 pipeline schedule 顯示，不再硬編碼。
- 搜尋頁的 35、型別註解的 29、文件的 35 全部改由 generated source config 產生。
- `meta.coverage` 新增 `fastScheduleMinutes`、`deepScheduleMinutes`、`archiveDays`、`recentCap`。
- 歷史設計文件可保留 29/35，但標上「歷史規格，不代表現況」。

### P0-7：讓 health 真正檢查依賴

**修改位置**

- Worker health route
- 新增 `worker/src/services/health.js`

**回應契約**

```json
{
  "status": "ok | degraded | error",
  "checks": {
    "kv": "ok",
    "snapshotAgeSeconds": 240,
    "sourceHealthy": 35,
    "sourceTotal": 37,
    "lastDeepAgeSeconds": 720,
    "lastDispatch": "ok"
  }
}
```

- 沒有 snapshot 或 fast age > 15 分鐘：503。
- 有零篇／部分錯誤但仍可服務：200 degraded。
- 不回傳 token、內部 binding ID 或 stack trace。

## 6. P1：建立真正 30–90 天資料層（第 1–2 週）

### P1-1：D1 作搜尋索引，KV 只作快取

目前 KV 適合讀多寫少的 snapshot，不適合原子協調。Workers KV 是 eventual consistency，跨地區可能 60 秒以上才看到新值，也不適合交易／原子操作。[Cloudflare KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/)

推薦新增 D1：

```sql
CREATE TABLE articles (
  id TEXT PRIMARY KEY,
  canonical_url TEXT NOT NULL,
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  published_at INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  access_mode TEXT NOT NULL,
  sentiment_label TEXT,
  sentiment_score REAL,
  provenance_json TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_articles_url ON articles(canonical_url);
CREATE INDEX idx_articles_time ON articles(published_at DESC);
CREATE INDEX idx_articles_source_time ON articles(source_id, published_at DESC);

CREATE TABLE article_terms (
  article_id TEXT NOT NULL,
  term TEXT NOT NULL,
  PRIMARY KEY(article_id, term)
);
CREATE INDEX idx_article_terms_term ON article_terms(term);
```

搜尋流程：

1. Worker Cron 把新 metadata 用 batch `INSERT ... ON CONFLICT DO UPDATE` 寫 D1。
2. 刪除超過 90 日資料；UI 初期開 30 日，驗證後再開 90 日。
3. Boolean query 先解析成 AST，再以 `article_terms`＋時間／來源 index 查候選，最後在 Worker精確驗證 phrase/NOT。
4. D1 支援 FTS5；先在 staging 測試繁中文 tokenize 品質。若 trigram tokenizer 可用且查詢成本較低，可取代 `article_terms`；未實測前不直接假設。[Cloudflare D1 SQL/FTS5](https://developers.cloudflare.com/d1/sql-api/sql-statements/)
5. 回傳 `coverage.actualFrom/actualTo`，UI 顯示實際資料窗。

D1 Free 每日 500 萬 rows read、10 萬 rows written、5 GB 總儲存；目前數量級足以先行驗證。[Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)

### P1-2：R2 保存不可變日分檔

用途不是即時查詢，而是：

- 可重算歷史分析；
- 保存 schema/version/provenance；
- 從 D1 或 Pages 損壞時回復；
- 避免把大量歷史 JSON 永久塞入 git branch。

建議 key：

```text
archive/v2/YYYY/MM/DD/articles.json.gz
archive/v2/YYYY/MM/DD/manifest.json
```

manifest 包含 SHA-256、筆數、來源數、資料窗、schema/method version。R2 Standard Free 為 10 GB-month、100 萬 Class A、1,000 萬 Class B/月且無 egress 費，可容納此規模的 metadata archive。[Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)

### P1-3：重新定義 source status 與 quality

**新狀態**

```text
ok        成功且有新鮮可用資料
empty     transport 成功但指定窗為零篇
degraded  有資料但使用 fallback、摘要過低或最新文章過舊
error     本輪不可用且 last-good 已過期
disabled  人工停用
```

**每來源新增欄位**

```json
{
  "windowHours": 24,
  "newestItemAt": "...",
  "transportOk": true,
  "fallbackUsed": true,
  "officialItemCount": 10,
  "fallbackItemCount": 15,
  "excerptRate": 0.42,
  "latencyMs": 830,
  "qualityScore": 0.71
}
```

`qualityScore` 不做神祕 AI 分數，直接由可公開重算的四部分組成：可用性、內容新鮮度、摘要完整度、取得方式；UI 同時顯示分量。

### P1-4：逐檔品質仲裁，不再只做 newer-wins

修改 `web/src/api/client.ts`：

- `recent`：Worker＋Pages 合併後依 canonical URL/source-title 去重，不二選一。
- `sources`：分別顯示 `fast 24h` 與 `deep 7/30d` 的 window，不互相覆蓋。
- `topics/entities`：比較 `lastDeepAt`／upstreamGeneratedAt，不用 fast envelope 時間冒充深度資料時間。
- `meta`：組合 fast/deep health，而不是只取一份。
- 每個 envelope 加 `pipeline`、`window`、`quality`、`provenance`。

### P1-5：強化現有 37 家，而不是只追求數量

優先處理完全沒有 RSS/listing 的 7 家：華視、UDN、工商時報、MoneyDJ、今周刊、鏡新聞、鏡週刊。

方法：

1. 重新查核公開官方 RSS、JSON Feed、sitemap news、JSON-LD listing。
2. 有官方 feed 才列官方；找不到就維持 Google News，不虛構 URL。
3. 官網 metadata 擷取遵守 robots.txt、`crawl_interval_hours`、ETag/Last-Modified 與低頻率。
4. 只保存標題、短摘要、時間、來源與原文連結，不重製全文／圖片。
5. 每個 connector 加固定 fixture、合法空 feed、429、redirect、HTML 變更測試。
6. PTT、Dcard、Facebook、Threads 等若沒有合法官方 API/授權，不直接爬取；要加入必須另列授權、保存範圍與刪除政策。

另可新增「政府公開資訊／事實查核／官方聲明」頻道，但必須與新聞媒體分開，不能混進 37 家媒體分母，避免把機關發布量當成媒體聲量。

### P1-6：跨來源事件去重

先做可解釋、低成本版本：

1. 標題正規化，移除媒體尾碼、空白、標點與即時更新樣板。
2. 同 48 小時內才產生候選 pair。
3. 計算中文字 3-gram Jaccard、共同實體、共同關鍵詞。
4. 超過已用人工樣本校正的 threshold 才合併 event cluster。
5. UI 同時顯示「報導 23 篇／事件 7 件／來源 12 家」。
6. 後續 embedding 只處理規則無法決定的邊界案例，控制成本。

### P1-7：清理 archive 生命週期

- `write_archive_files()` 寫完後刪除超過 retention 且不在 manifest 的日分檔。
- 清理只限 `web/public/data/news-archive/YYYY-MM-DD.json` pattern，先列出再刪，禁止對廣泛路徑遞迴刪除。
- 30 日上線後，manifest 必須含真正 30 個自然日資料窗；不足時 UI 顯示 actual coverage。

## 7. P2：讓分析模型更深入且仍可驗證（第 3–4 週）

### P2-1：先建立人工評測集

沒有 benchmark 就不能知道「模型更強」還是更會產生漂亮圖表。

1. 依來源類型、主題、日期分層抽 800–1,200 篇。
2. 標註：事件 cluster、主題、ORG/PERSON、文本語氣、目標實體與立場。
3. 至少 10% 雙人標註；計算 Cohen's kappa 或一致率。
4. 固定 train/dev/test，資料與方法版本化，不把 test 拿去調 threshold。
5. 情緒未達 held-out macro-F1 0.70、各類 recall 0.60 前維持「實驗性」。

### P2-2：把「固定主題」拆成事件與分類

- **事件層**：依時間、標題相似度、實體與關鍵詞形成動態 clusters。
- **分類層**：財經、政治、社會等只是 cluster 的標籤，可多標籤。
- 每個事件產生：代表標題、時間線、報導數、來源數、關鍵實體、證據文章。
- 摘要先用 extractive：從來源不同的代表文章各取一個可追溯句；沒有證據就不生成結論。

### P2-3：升溫與異常改用基準期

目前「近期篇數－前期篇數」很容易被樣本小與發稿時段誤導。改成：

```text
burst = (current - median(baseline buckets)) / max(1, 1.4826 × MAD)
```

- baseline 至少 7 日，按同一小時／星期幾比較。
- current < 5 篇或來源 < 3 家時不標示爆量。
- 顯示原始篇數、來源數、baseline、burst score，不只顯示箭頭。
- 自動詞排序使用 log-odds／文件頻率與跨來源門檻，不只 raw n-gram count。

### P2-4：情緒改為「文本語氣」與「目標式立場」兩層

1. 保留現有 lexicon 作 baseline 與 evidence。
2. 離線 deep pipeline 評測 2–3 個授權相容的繁中模型；以人工 test set 決定，不先指定勝者。
3. 模型輸出低於 confidence threshold 時標 `uncertain`，不強迫三分類。
4. 「新聞整體文本語氣」不能直接叫「民意」或「媒體立場」。
5. 要分析對特定人物／政策的正負，必須做 target extraction＋targeted sentiment，不能沿用整篇 label。
6. UI 顯示方法版本、樣本數、信心與 evidence terms/sentences。

### P2-5：實體正規化與關係強度

- 為每個實體建立 canonical ID、type、aliases、ambiguity rules。
- 詞典命中後再加 NER candidate；新 candidate 不自動併入，需 alias QA。
- 邊權重除 raw co-occurrence 外，增加 Jaccard/normalized PMI 與 minimum support。
- 顯示「共同出現」而不是「關係」；不推論支持、反對或因果。
- 允許點選實體查看原始文章、時間變化、共現來源與資料缺口。

### P2-6：跨來源敘事比較

每個事件提供：

- 各來源報導時間與篇數；
- 標題關鍵詞差異；
- 最常被引用的行動者／機關；
- 目標式語氣分布；
- 同一事件的來源集中度；
- 所有判讀都能點回原文。

不要自動貼「偏藍／偏綠／假新聞」等標籤；若未有明確、可審查研究設計，應顯示【資料不足,無法確認】。

## 8. P3：前端產品與體驗強化（第 4–5 週）

### P3-1：首頁改成真正的事件決策摘要

現在只取最高熱詞＋最大固定主題。改成：

- 近 90 分鐘異常事件；
- 跨來源事件數與報導數；
- 來源覆蓋／摘要覆蓋；
- 主要實體與新增實體；
- 「為何值得注意」只引用可重算訊號，不做因果斷言。

信心等級改由 data quality、樣本數、來源數、baseline 與 analysis version 決定；零篇來源時不可顯示「資料完整」。

### P3-2：進階分析工作台

- 查詢保存於 localStorage，可命名、複製與匯出，不上傳個資。
- 支援來源、來源類型、日期、事件、實體、文本語氣篩選。
- 比較「報導篇數、事件數、來源數、normalized share、burst」而不是只有 raw mentions。
- 文章在多個主題命中時顯示一次，附多個 topic tags。
- 匯出 CSV/JSON 時帶 generatedAt、actual window、schema/method version 與 filters。

### P3-3：圖表效能與可存取性

修改 `Chart.tsx` 與 ECharts imports，只註冊使用到的 Line/Bar/Graph、Tooltip、Legend、Grid、CanvasRenderer；不要 import 全套 ECharts。

目標：

- chart chunk < 250 kB gzip；
- 首頁初始 JS 不載入 ECharts；
- 所有圖表有相同資料的表格／文字摘要；
- prefers-reduced-motion 下停用動畫。

### P3-4：資料快取與取消

- `fetchData` 加 module-level in-flight map：同檔同時只送一批 Worker/Pages。
- 30–60 秒 TTL cache；manual bypass 明確清除。
- `useData` 使用 AbortController；effect cleanup 取消請求。
- interval、visibility、manual refresh 共用 coordinator，避免同秒重疊。
- 以單元測試模擬 slow Worker、快 Pages、unmount 與多個元件共讀。

### P3-5：文案與視覺細節

- Hero H1 加 `text-wrap: balance`，調整 desktop clamp，避免最後一個字孤行。
- 所有「即時」改成「最近更新 X 分鐘前」＋ pipeline badge。
- 來源表加入 window、最新文章、fallback、摘要率、quality 分量。
- 30 日只在 actual coverage 達標後啟用。
- 375、768、1024、1440 四個 viewport 加 Playwright screenshot/overflow tests。

### P3-6：安全標頭

GitHub Pages 無法完整自訂 response headers：

- 短期在 `index.html` 加嚴格 meta CSP、referrer meta，限制 script/connect/img/font 來源。
- 不使用 inline script；若必須，使用 build-time nonce/hash。
- 中期若需要完整 CSP、Permissions-Policy、frame-ancestors 與自訂網域，可把靜態前端移至新帳號的 Cloudflare Pages；GitHub 仍是唯一 source repository。

## 9. Worker 重構方法

建議目錄：

```text
worker/src/
  index.js                 # composition root only
  router.js
  routes/
    health.js
    data.js
    search.js
    trends.js
    refresh.js
  services/
    snapshot-builder.js
    search-service.js
    refresh-state.js
    source-health.js
  clients/
    github.js
    pages.js
    turnstile.js
  repositories/
    kv-snapshot.js
    d1-articles.js
  telemetry.js
  core.js
  analysis.js
```

重構原則：先用現有 tests 鎖住行為，再逐模組搬移；每次 commit 只移一個責任，不在同一 commit 同時改演算法。

所有空 catch 改成「可降級但要記錄」：

```js
log({
  event: 'source_fetch_failed',
  sourceId,
  mode,
  durationMs,
  errorCode,
  requestId,
});
```

`wrangler.toml` 明文化：

```toml
[observability]
enabled = true
head_sampling_rate = 0.1
```

低流量 staging 可用 1.0，正式站平常 0.1；嚴重錯誤另以明確 structured log 記錄。Workers Logs Free 包含每日 20 萬 log events、保留 3 天。[Cloudflare Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)

若用 Analytics Engine，每個來源每次 Cron 寫一個 datapoint，37×288＝10,656/day，低於 Free 100,000/day；記錄 latency、itemCount、error、accessMode、freshness。[Analytics Engine pricing](https://developers.cloudflare.com/analytics/analytics-engine/pricing/)

## 10. GitHub 與 Cloudflare 設定修改

### 10.1 GitHub

1. `main` 加 ruleset：禁止 force push/delete、要求 CI `test` 成功、要求分支最新。
2. 單人維護可先不要求他人 approval，但所有正式修改仍走 PR。
3. Actions 預設 read 保留；只有 deploy job 給 `pages: write`、`id-token: write`。
4. `refresh` 抓資料／build job 只用 `contents: read`。
5. Actions allowed list 改 GitHub 官方＋明確允許；所有 uses 固定 SHA。
6. 把 legacy `gh-pages` force push 改 GitHub Pages official artifact deployment：

```yaml
permissions:
  contents: read
  pages: write
  id-token: write

- uses: actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9 # v5.0.0
  with:
    path: web/dist

- uses: actions/deploy-pages@cd2ce8fcbc39b97be8ca5fce6e763baed58fa128 # v5.0.0
```

7. GitHub Pages source 改為 GitHub Actions；驗證後才封存／刪除舊 `gh-pages` branch。
8. `CLOUDFLARE_API_TOKEN` 目前未被 workflow 使用；先查權限與用途。若確定不用，撤銷 token 後再刪 repository secret，不能只刪 secret 留著有效 token。

GitHub schedule 在高負載時可能延遲，甚至丟棄 queued job，因此它只適合低頻備援，不應和 Worker 都作每五分鐘主排程。[GitHub scheduled events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)

### 10.2 Cloudflare

1. 新增 staging Worker、獨立 staging KV/D1/R2/Turnstile，正式資源不得共用。
2. vars、bindings、crons、observability 全部寫入 Wrangler config；Secret 只用 `wrangler secret put`。
3. `ALLOWED_ORIGIN=https://yin0612.github.io` 正確，因瀏覽器 Origin 不含 `/MediaMonitoring` path。
4. `ARCHIVE_BASE_URL=https://yin0612.github.io/MediaMonitoring` 正確，因它是實際資源 base path。
5. Worker deploy 後固定檢查 version、bindings、health、CORS、meta age、一次搜尋與一次 scheduled dry run/staging。
6. 保留舊 Worker 24–48 小時 rollback；期間不可再有 Cron。
7. 觀察期通過後依序：撤銷舊 PAT → 刪舊 Worker secret → 停 workers.dev → 再刪舊 Worker/KV。
8. Wrangler 4.113 沒有 read-only trigger list；舊 Cron 是否為空仍應在 Dashboard 再做一次人工核對。直接 UI 狀態【資料不足,無法確認】，但舊 snapshot 與 dispatch 已停止更新。

## 11. 測試與驗收矩陣

| 層次 | 必加測試 | 驗收條件 |
|---|---|---|
| Python | 30/90 日 retention、source quality、event clustering、trend partial | fixture 可重算且不受目前日期影響 |
| Worker | KV event keys、callback auth、Turnstile、D1 range、health stale | manual refresh 必到終態 |
| Contract | JSON Schema/OpenAPI、Python/Worker/Web parity | schema drift 直接讓 CI 失敗 |
| Web | quality arbitration、Abort/dedupe、actual coverage、30d | Worker/Pages 切換不改變資料語意 |
| E2E | 375/768/1024/1440、九條 route、搜索/篩選/更多選單 | 無 overflow、無不可操作 route |
| Security | npm audit、pip-audit、CodeQL、secret scan | 0 critical/high；moderate 有明確接受紀錄 |
| Performance | ECharts chunk、search p95、D1 rows read、Worker CPU/subrequests | chart <250 kB gzip；p95 目標 <2 秒 |
| Data QA | URL、時間、duplicate、excerpt、source coverage | 所有快照有 quality/provenance |
| Live | Pages、Worker health、CORS、meta age、Actions run | 發布後 15 分鐘持續正常 |

目前已完成基準：

- Python clean HEAD：82/82。
- Worker：79/79。
- Web：83/83。
- TypeScript：通過。
- production build：通過。
- 手機 375×812：無水平 overflow，行動選單可操作。

注意：identity test 目前會掃未追蹤檔。本次稽核工作檔包含 Cloudflare 遷移資訊，因此在 dirty worktree 會誤判；正式 tracked HEAD 測試全綠。可把 identity test 改成只掃 tracked files，另設 pre-commit 檢查 staged files。

## 12. 發布與回滾流程

### 每一階段的標準流程

1. 從已同步的 `origin/main` 建分支；本機 `main` 目前指標落後，先 fast-forward。
2. 先寫失敗測試，再修改。
3. 跑 Python/Worker/Web/typecheck/build/audit。
4. 部署 staging Worker 與 staging Pages。
5. 在 staging 驗證 30d、refresh 終態、CORS、health、source quality。
6. PR 合併後部署 production。
7. 監看 15–30 分鐘 Worker metrics、Actions、meta age 與 API。
8. 通過後才做不可逆清理。

### 回滾

- Worker：部署上一個已知良好 version。
- D1：保留 migration 前 export；migration 使用 additive schema，先不 drop 欄位。
- Pages：保留上一個 deployment artifact／commit。
- Source config：新來源逐家 feature flag，可單獨 disable。
- 分析：`methodVersion` 可回切 baseline；舊 JSON schema 至少相容一個版本。

## 13. 建議時程與優先順序

| 時間 | 交付 |
|---|---|
| 第 1–3 天 | 移除假 30d、修 refresh 狀態、單一排程、依賴修補、文案一致 |
| 第 4–7 天 | source quality、health、observability、Worker 模組化第一階段 |
| 第 2 週 | D1 30 日搜尋、逐檔品質仲裁、archive lifecycle、R2 staging |
| 第 3 週 | 事件去重、burst baseline、動態事件 UI |
| 第 4 週 | 人工評測集、情緒/實體候選模型 benchmark、跨來源敘事 |
| 第 5 週 | ECharts 瘦身、匯出、E2E、正式發布與舊帳號退場 |

## 14. 最終 Definition of Done

完成下列全部條件，網站才可稱為「更完整的新聞輿情分析平台」：

- UI 宣告的所有 range 都由真實 actual coverage 支援。
- manual refresh 的 fast/deep 有可靠終態與失敗原因。
- 只有一個五分鐘主排程，沒有重複 deep deploy。
- 零篇、fallback、摘要缺漏與過期會降低 quality/confidence。
- 30 日搜尋由 D1/index 執行，不靠 recent 假裝。
- 同一事件的「報導篇數」與「事件數」分開。
- 升溫有 baseline、最低樣本與來源門檻。
- 情緒、主題、實體都有人工 benchmark 與版本。
- 每個分析結論可追到來源文章與方法。
- npm/pip/CodeQL/Dependabot、branch rules、Action SHA pinning 到位。
- Worker 有結構化 logs、source metrics、dependency health 與 staging。
- 375/768/1024/1440 無 overflow，chart 有文字／表格替代。
- 舊 Cloudflare PAT、secret、Worker/KV 在觀察期後安全退場。

這份計畫的核心不是「再加更多圖表」，而是依序建立：**可信資料窗 → 可量化品質 → 事件層 → 經評測的分析 → 可追溯決策介面**。只有這個順序能讓功能變多時，可信度也同步提高。
