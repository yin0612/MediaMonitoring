# MediaMonitoring 自動更新與「立即更新」同步修改計畫書

## 一、目標

本次修改目標是確保 `MediaMonitoring`：

1. 整個網站的新聞與分析欄位可以持續自動更新。
2. 右上角「立即更新」按鈕按下後，會真正觸發最新新聞資料同步。
3. 使用者不需要重新整理頁面，首頁、資料總覽、近期新聞、關鍵字、主題、組織、搜尋、Google Trends、進階分析等畫面都能同步取得新資料。
4. 系統能明確區分：
   - 快速新聞更新
   - 深度分析更新
5. 即使 GitHub Actions、Cloudflare Worker 或部分新聞來源失敗，系統仍能降級運作，而不是整個更新流程失效。

---

## 二、目前架構盤點

目前專案主要由以下部分構成：

```text
GitHub Pages
└─ React / Vite 前端

Cloudflare Worker
├─ Cron 每 5 分鐘
├─ /api/data
├─ /api/search
├─ /api/trends
├─ /api/refresh
└─ KV Snapshot

Python Pipeline
├─ RSS / Google News
├─ 關鍵字分析
├─ Topic 分析
├─ Entity 分析
├─ Archive
└─ JSON Snapshot

GitHub / gh-pages
└─ 正式網站與靜態資料備援
```

目前一般儀表板資料會透過 `useData()` 定期重新取得。

既有更新頻率：

- 一般資料頁：約每 90 秒刷新
- 搜尋結果：約每 30 秒刷新
- Google Trends：約每 120 秒刷新
- Cloudflare Worker Cron：約每 5 分鐘執行

---

# 三、目前發現的主要問題

## P0-1：「立即更新」目前呼叫已不存在的 Workflow

目前 Worker 的：

```text
POST /api/refresh
```

會嘗試呼叫：

```text
.github/workflows/deploy-web.yml
```

但是目前 `main` branch 已經移除該 workflow。

因此目前鏈路可能變成：

```text
立即更新
↓
POST /api/refresh
↓
Worker
↓
dispatch deploy-web.yml
↓
Workflow 不存在
↓
更新失敗
```

### 修改方向

新增正式的資料刷新 Workflow：

```text
.github/workflows/refresh-data.yml
```

並讓 Worker 改為呼叫此 Workflow。

---

## P0-2：GitHub 更新失敗會阻止 Worker 快速更新

目前 `/api/refresh` 的邏輯是：

```text
先呼叫 GitHub Actions
↓
成功
↓
才執行 buildSnapshot()
```

這代表：

> GitHub Actions 掛掉時，即使 Cloudflare Worker 本身還能抓新聞，也不會重新建立即時快照。

### 修改後

改成：

```text
POST /api/refresh
↓
產生 refreshId
↓
├─ Worker Fast Refresh
│  └─ 立即更新 recent / sources / meta
│
└─ GitHub Deep Refresh
   └─ 更新 keywords / topics / entities / archive
```

兩條流程互相獨立。

---

## P0-3：「立即更新」沒有確認資料真的更新完成

目前前端成功呼叫 `/api/refresh` 後，只是：

```text
等待固定約 5 秒
↓
重新抓資料
```

這不能保證：

- Worker 已完成更新
- GitHub Actions 已完成
- Pages 已部署
- keywords 已重算
- topics 已重算
- entities 已重算

### 修改方向

新增：

```text
GET /api/refresh/status?id=<refreshId>
```

讓前端實際確認資料版本或 `generatedAt` 已經前進。

---

## P0-4：正式站 Worker URL 必須強制設定

Production build 必須確保：

```text
VITE_API_BASE_URL
```

已正確設定。

例如：

```text
VITE_API_BASE_URL=https://xxxxxxxx.workers.dev
```

若 Production build 沒有 Worker URL，應直接：

```text
Build Failed
```

而不是默默部署一個只能讀靜態資料、沒有「立即更新」功能的網站。

建議加入例外參數：

```text
ALLOW_STATIC_ONLY=true
```

只有刻意部署純靜態模式時才允許。

---

# 四、建議的新更新架構

```text
                       自動 Cron 每 5 分鐘
                              │
                              ▼
                     Cloudflare Worker
                              │
                       Fast Snapshot
                              │
              ┌───────────────┴──────────────┐
              ▼                              ▼
         recent / sources                meta
              │                              │
              └────────────── KV ────────────┘


Worker
  │
  └─ repository_dispatch
             │
             ▼
     GitHub refresh-data.yml
             │
             ▼
        Python Pipeline
             │
     ┌───────┼─────────┬──────────┐
     ▼       ▼         ▼          ▼
 keywords  topics   entities   archive
     │
     ▼
   Build Web
     │
     ▼
  gh-pages


使用者按下「立即更新」
              │
              ▼
       POST /api/refresh
              │
       產生 refreshId
              │
       ┌──────┴───────┐
       ▼              ▼
 Fast Refresh     Deep Refresh
       │              │
       └──────┬───────┘
              ▼
 /api/refresh/status
              │
              ▼
      前端確認新版本
              │
              ▼
 Global Refresh Event
              │
 ┌────────────┼──────────────┐
 ▼            ▼              ▼
首頁        搜尋頁          進階分析
總覽        Trends          Topics
近期新聞                    Keywords
Entities
```

---

# 五、Fast / Deep 兩階段更新

## Fast Refresh

由 Worker 執行。

更新：

```text
recent
sources
meta.lastFastAt
```

目標：

```text
數秒內完成
```

主要用途：

- 最新新聞
- 來源狀態
- 即時新聞清單

---

## Deep Refresh

由 GitHub Actions + Python Pipeline 執行。

更新：

```text
keywords
topics
entities
archive
trends snapshot
meta.lastDeepAt
```

主要用途：

- 關鍵字熱度
- 主題分類
- 組織／人物
- 歷史封存
- 深度分析資料

---

# 六、修改 Worker `/api/refresh`

修改：

```text
worker/src/index.js
```

---

## 新增 Refresh ID

收到更新請求：

```text
POST /api/refresh
```

產生：

```json
{
  "status": "accepted",
  "refreshId": "uuid",
  "requestedAt": "2026-08-09T15:40:00+08:00",
  "fast": "running",
  "deep": "queued"
}
```

---

## 新增 Refresh Status API

```text
GET /api/refresh/status?id=<refreshId>
```

回傳：

```json
{
  "refreshId": "uuid",
  "fast": {
    "status": "completed",
    "generatedAt": "..."
  },
  "deep": {
    "status": "running",
    "generatedAt": null
  }
}
```

完成：

```json
{
  "refreshId": "uuid",
  "fast": {
    "status": "completed",
    "generatedAt": "..."
  },
  "deep": {
    "status": "completed",
    "generatedAt": "..."
  }
}
```

---

# 七、GitHub Actions 重構

建議拆成兩個 Workflow。

## 1. CI

新增：

```text
.github/workflows/ci.yml
```

負責：

```text
Python tests
Worker tests
Frontend tests
TypeScript typecheck
Production build validation
```

觸發：

```text
push
pull_request
workflow_dispatch
```

---

## 2. Data Refresh

新增：

```text
.github/workflows/refresh-data.yml
```

觸發：

```yaml
workflow_dispatch:

repository_dispatch:
  types:
    - scheduled-refresh

schedule:
  - cron: "*/5 * * * *"
```

工作：

```text
checkout
↓
Python environment
↓
抓取新聞
↓
更新 JSON
↓
更新 keywords
↓
更新 topics
↓
更新 entities
↓
更新 archive
↓
npm build
↓
部署 gh-pages
```

---

# 八、正式網站只允許 main 作為唯一 Source of Truth

目前需要避免：

```text
main code
≠
gh-pages deployed code
```

最終要求：

> 所有正式網站檔案，都必須由某個 `main` commit 可以重新產生。

gh-pages 每次部署應留下：

```text
sourceMainSha
dataGeneratedAt
buildAt
```

例如：

```json
{
  "sourceMainSha": "abcdef123",
  "dataGeneratedAt": "2026-08-09T15:40:00+08:00",
  "buildAt": "2026-08-09T15:41:00+08:00"
}
```

---

# 九、前端建立全站 Refresh Coordinator

建議新增：

```text
web/src/api/refreshCoordinator.ts
```

或：

```text
web/src/providers/RefreshProvider.tsx
```

所有頁面都只依賴同一套 Refresh Lifecycle。

---

## Refresh Event

事件資料：

```ts
{
  reason: 'manual' | 'interval' | 'visibility',
  refreshId?: string,
  requestedAt: string,
  bypassCache: boolean
}
```

---

# 十、修改 `useData()`

修改：

```text
web/src/api/useData.ts
```

目前保留：

```text
90 秒 interval
```

另外加入：

```text
visibilitychange
```

當：

```text
document.visibilityState === 'visible'
```

立刻重新抓資料。

這樣使用者切回頁面時，不需要最多再等 90 秒。

---

# 十一、搜尋頁同步更新

修改：

```text
web/src/pages/SearchPage.tsx
```

現在搜尋本身會 30 秒 refresh。

但按全站「立即更新」時，也必須：

```text
重新執行目前 Query
```

例如目前搜尋：

```text
台積電
```

使用者按：

```text
立即更新
```

完成後自動：

```text
searchNews("台積電")
```

不需要再按一次搜尋。

---

## Google Trends

收到全站 Refresh Event：

```text
fetchTrends()
```

直接重抓。

---

# 十二、進階分析同步更新

修改：

```text
web/src/pages/AdvancedAnalysisPage.tsx
```

如果目前分析：

```text
台積電
聯發科
NVIDIA
```

按「立即更新」後：

```text
runAnalysis(true)
```

自動重新分析同一組條件。

---

# 十三、「立即更新」按鈕 UX

目前不要再使用：

```text
送出成功
↓
等 5 秒
↓
假設更新完成
```

建議 UI：

```text
立即更新
↓
正在更新新聞…
↓
新聞已更新
↓
正在同步分析…
↓
全部資料已更新
```

完成後：

```text
全部資料已更新
更新時間：15:45:23
```

---

## 部分失敗

若 Worker 成功、Deep Refresh 失敗：

```text
新聞已更新
部分分析資料更新延遲
```

而不是：

```text
更新失敗
```

---

# 十四、按鈕錯誤恢復

目前如果更新失敗，不應永久 disabled。

---

## HTTP 429

顯示：

```text
請 120 秒後再試
```

倒數完成後：

```text
立即更新
```

重新啟用。

---

## HTTP 503 / Network Error

顯示：

```text
手動更新服務暫時無法連線
系統仍會自動更新
```

幾秒後重新允許使用者操作。

---

# 十五、資料 Envelope 改造

目前建議升級：

```text
schemaVersion: 2.2.0
```

每個 JSON 增加：

```json
{
  "schemaVersion": "2.2.0",
  "snapshotId": "uuid",
  "generatedAt": "...",
  "stage": "fast",
  "data": {}
}
```

Deep：

```json
{
  "stage": "deep"
}
```

---

## meta 新增

```json
{
  "lastFastAt": "...",
  "lastDeepAt": "...",
  "fastSnapshotId": "...",
  "deepSnapshotId": "..."
}
```

UI 才能明確表示：

```text
最新新聞：15:45 更新
深度分析：15:43 更新
```

---

# 十六、Worker / Pages 使用 newer-wins

所有資料：

```text
meta
keywords
sources
recent
entities
topics
```

讀取時同時比較：

```text
Worker.generatedAt
Pages.generatedAt
```

規則：

```text
Worker 比較新
→ Worker

Pages 比較新
→ Pages
```

不能固定認為 Worker 一定最新。

---

# 十七、手動更新加入 Cache Busting

手動更新完成後重新抓 Pages：

```text
/data/meta.json?v=<refreshId>
```

例如：

```text
/data/keywords.json?v=abc123
```

避免：

```text
Browser Cache
CDN Cache
GitHub Pages Cache
```

仍回傳上一版 JSON。

---

# 十八、移除來源數量硬編碼

目前不要再寫：

```text
29 家
35 家
37 家
```

應由程式自動產生。

新增：

```json
meta.data.coverage.sourceCount
```

來源：

```ts
NEWS_SOURCE_IDS.length
```

UI：

```tsx
{meta.coverage.sourceCount} 個公開新聞來源
```

以後新增新聞來源時所有頁面會自動同步。

---

# 十九、建議修改檔案

## GitHub

```text
.github/workflows/ci.yml
.github/workflows/refresh-data.yml
```

---

## Worker

```text
worker/src/index.js
worker/test/routes.test.js
worker/wrangler.toml
```

---

## Frontend API

```text
web/src/api/client.ts
web/src/api/useData.ts
web/src/api/refreshCoordinator.ts
```

---

## Frontend Components

```text
web/src/components/Layout.tsx
```

---

## Pages

```text
web/src/pages/HomePage.tsx
web/src/pages/SearchPage.tsx
web/src/pages/AdvancedAnalysisPage.tsx
web/src/pages/OverviewPage.tsx
web/src/pages/RecentPage.tsx
web/src/pages/KeywordsPage.tsx
web/src/pages/TopicsPage.tsx
web/src/pages/EntitiesPage.tsx
```

---

## Types

```text
web/src/types/contracts.ts
```

---

## Scripts

```text
scripts/sync_data.sh
scripts/push.sh
```

---

## Documentation

```text
README.md
```

---

# 二十、實作優先順序

## Phase 1 — P0 修復

必須先完成：

```text
refresh-data.yml
Worker /api/refresh
VITE_API_BASE_URL
```

目標：

> 讓「立即更新」真正可以運作。

---

## Phase 2 — 全站同步

建立：

```text
RefreshCoordinator
```

接入：

```text
首頁
資料總覽
近期新聞
關鍵字
主題
組織
搜尋
Google Trends
進階分析
```

---

## Phase 3 — 資料版本管理

增加：

```text
snapshotId
lastFastAt
lastDeepAt
newer-wins
cache-busting
```

---

## Phase 4 — 架構清理

處理：

```text
main / gh-pages 漂移
來源數量硬編碼
README
scripts
部署流程
```

---

# 二十一、驗收標準

## 1. 自動更新

Cloudflare Worker：

```text
每 5 分鐘執行
```

如果：

```text
資料 > 10 分鐘
```

自動標記：

```text
stale
```

---

## 2. 一般頁面

```text
每 90 秒重新讀取
```

---

## 3. 搜尋

```text
每 30 秒重新執行
```

---

## 4. Google Trends

```text
每 120 秒重新取得
```

---

## 5. Visibility Refresh

使用者切回瀏覽器分頁：

```text
立即 refresh
```

---

## 6. Fast Refresh

按「立即更新」後：

```text
lastFastAt >= requestedAt
```

才可以宣告：

```text
新聞已更新
```

---

## 7. Deep Refresh

必須：

```text
lastDeepAt >= requestedAt
```

才可以宣告：

```text
分析已更新
```

---

## 8. 搜尋同步

目前 Query：

```text
台積電
```

立即更新後：

```text
自動重新搜尋台積電
```

---

## 9. 進階分析同步

目前分析條件保留。

立即更新完成後：

```text
自動重新分析
```

---

## 10. 部分故障

GitHub Actions 掛掉：

```text
Worker 新聞仍可更新
```

UI：

```text
新聞已更新
分析資料延遲
```

---

## 11. Production Worker URL

如果：

```text
VITE_API_BASE_URL=""
```

正式 Production build 必須：

```text
Fail
```

---

## 12. 正式版本可追溯

每個 gh-pages build 必須可以找到：

```text
source main SHA
```

---

# 二十二、最終完成定義

此次修改不能只定義成：

> 「立即更新 API 可以回 202。」

真正完成條件必須是：

```text
使用者按一次「立即更新」
↓
Worker 取得新新聞
↓
產生新的 Fast Snapshot
↓
GitHub / Python 更新深度分析
↓
產生新的 Deep Snapshot
↓
前端確認 generatedAt 已前進
↓
首頁重新讀取
↓
總覽重新讀取
↓
近期新聞重新讀取
↓
關鍵字重新讀取
↓
Topics 重新讀取
↓
Entities 重新讀取
↓
搜尋結果重新查詢
↓
Google Trends 重新取得
↓
進階分析重新計算
↓
UI 顯示實際更新完成時間
```

只有達成以上流程，才算真正完成「全站自動更新＋立即更新同步」。

---

# 二十三、具體修改方法與實作方式

本章將前述計畫轉換成可直接執行的修改步驟。

---

## A. 建立新的資料刷新 Workflow

### 修改檔案

新增：

```text
.github/workflows/refresh-data.yml
```

### 修改方法

建立一個專門負責「資料更新＋建置＋部署」的 Workflow，不再讓 Worker 指向已不存在的 `deploy-web.yml`。

建議內容：

```yaml
name: Refresh data and deploy

on:
  workflow_dispatch:

  repository_dispatch:
    types:
      - scheduled-refresh
      - manual-refresh

  schedule:
    - cron: "*/5 * * * *"

permissions:
  contents: write

concurrency:
  group: media-monitoring-refresh
  cancel-in-progress: false

jobs:
  refresh:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.12"
          cache: pip

      - name: Install Python dependencies
        run: pip install -r requirements.txt

      - name: Refresh news data
        run: python -m opinion_pipeline.cli --restore-base-url https://yin0612.github.io/MediaMonitoring
        env:
          PYTHONPATH: src
          PYTHONIOENCODING: utf-8

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
          cache-dependency-path: web/package-lock.json

      - name: Install frontend dependencies
        working-directory: web
        run: npm ci

      - name: Validate production Worker URL
        run: |
          if [ -z "${VITE_API_BASE_URL}" ]; then
            echo "VITE_API_BASE_URL is required for production"
            exit 1
          fi
        env:
          VITE_API_BASE_URL: ${{ vars.VITE_API_BASE_URL }}

      - name: Build frontend
        working-directory: web
        run: npm run build
        env:
          VITE_API_BASE_URL: ${{ vars.VITE_API_BASE_URL }}

      - name: Deploy to gh-pages
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

          rm -rf /tmp/media-monitoring-dist
          cp -R web/dist /tmp/media-monitoring-dist

          git checkout --orphan gh-pages-temp
          git rm -rf .

          cp -R /tmp/media-monitoring-dist/. .

          echo "${GITHUB_SHA}" > source-main-sha.txt
          echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" > build-at.txt

          git add .
          git commit -m "Deploy web dist: $(date '+%Y-%m-%d %H:%M:%S')"
          git push origin HEAD:gh-pages --force
```

### 注意事項

如果目前 gh-pages 有其他專用部署腳本，可以保留原方式，但必須符合：

```text
main
→ refresh-data.yml
→ Python data
→ Vite build
→ gh-pages
```

不能再直接從本機產生 gh-pages 而沒有來源 SHA。

---

## B. 建立獨立 CI Workflow

### 新增

```text
.github/workflows/ci.yml
```

### 修改方法

CI 不負責資料更新，只負責驗證程式。

建議：

```yaml
name: CI

on:
  push:
    branches:
      - main

  pull_request:

  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - run: pip install -r requirements.txt

      - name: Python tests
        run: python -m pytest -q
        env:
          PYTHONPATH: src

      - uses: actions/setup-node@v4
        with:
          node-version: "22"

      - name: Worker install
        working-directory: worker
        run: npm ci

      - name: Worker tests
        working-directory: worker
        run: npm test

      - name: Frontend install
        working-directory: web
        run: npm ci

      - name: Frontend tests
        working-directory: web
        run: npm test

      - name: Typecheck
        working-directory: web
        run: npm run typecheck

      - name: Build
        working-directory: web
        run: npm run build
```

這樣可避免：

```text
資料刷新失敗
=
CI 失敗
```

或反過來：

```text
測試失敗
=
完全無法更新新聞
```

---

# 二十四、Worker `/api/refresh` 具體修改方法

## 修改檔案

```text
worker/src/index.js
```

---

## A. 不再讓 GitHub Dispatch 阻塞 Fast Refresh

目前應避免：

```js
const dispatch = await triggerGitHubActions(env);

if (!dispatch.ok) {
  return error;
}

await buildSnapshot(env);
```

改為：

```js
const fastPromise = buildSnapshot(env);
const deepPromise = triggerGitHubActions(env, false);
```

然後：

```js
ctx.waitUntil(fastPromise.catch(() => {}));
ctx.waitUntil(deepPromise.catch(() => {}));
```

兩者獨立。

---

## B. 建立 refreshId

新增：

```js
function createRefreshId() {
  return crypto.randomUUID();
}
```

處理：

```js
async function handleRefresh(request, env, ctx) {
  if (!isAllowedOrigin(request, env)) {
    return json(request, env, { error: 'ORIGIN_NOT_ALLOWED' }, 403);
  }

  if (!env.SNAPSHOT) {
    return json(request, env, { error: 'SNAPSHOT_NOT_CONFIGURED' }, 503);
  }

  const refreshId = createRefreshId();
  const requestedAt = new Date().toISOString();

  const state = {
    refreshId,
    requestedAt,
    fast: {
      status: 'running',
      generatedAt: null,
      error: null,
    },
    deep: {
      status: env.GITHUB_TOKEN ? 'queued' : 'unavailable',
      generatedAt: null,
      error: env.GITHUB_TOKEN ? null : 'GITHUB_TOKEN_NOT_CONFIGURED',
    },
  };

  await env.SNAPSHOT.put(
    `refresh:${refreshId}`,
    JSON.stringify(state),
    { expirationTtl: 3600 },
  );

  const fastJob = runFastRefresh(env, refreshId);
  const deepJob = runDeepRefresh(env, refreshId);

  ctx.waitUntil(fastJob);
  ctx.waitUntil(deepJob);

  return json(
    request,
    env,
    {
      status: 'accepted',
      refreshId,
      requestedAt,
      fast: state.fast.status,
      deep: state.deep.status,
    },
    202,
  );
}
```

---

## C. Fast Refresh 狀態更新

新增：

```js
async function runFastRefresh(env, refreshId) {
  try {
    const files = await buildSnapshot(env);

    const generatedAt =
      files?.meta?.generatedAt ||
      new Date().toISOString();

    await patchRefreshState(env, refreshId, {
      fast: {
        status: 'completed',
        generatedAt,
        error: null,
      },
    });
  } catch (error) {
    await patchRefreshState(env, refreshId, {
      fast: {
        status: 'failed',
        generatedAt: null,
        error: error?.message || 'FAST_REFRESH_FAILED',
      },
    });
  }
}
```

---

## D. Deep Refresh 狀態更新

GitHub Workflow Dispatch 成功只代表「已排隊」，不是完成。

因此建議分成：

```text
queued
running
completed
failed
```

最簡單第一版可以：

```js
async function runDeepRefresh(env, refreshId) {
  if (!env.GITHUB_TOKEN) return;

  const result = await triggerGitHubActions(
    env,
    false,
    refreshId,
  );

  if (!result.ok) {
    await patchRefreshState(env, refreshId, {
      deep: {
        status: 'failed',
        generatedAt: null,
        error: result.reason,
      },
    });
    return;
  }

  await patchRefreshState(env, refreshId, {
    deep: {
      status: 'queued',
      generatedAt: null,
      error: null,
    },
  });
}
```

然後由 GitHub Workflow 完成後呼叫 Worker：

```text
POST /api/refresh/complete
```

或由前端透過 `meta.lastDeepAt >= requestedAt` 判斷完成。

若想降低複雜度，建議第一版採：

```text
Frontend Poll /api/data?name=meta
→ 比較 lastDeepAt
```

不用新增 callback secret。

---

# 二十五、新增 `/api/refresh/status`

## Worker Router

加入：

```js
if (
  request.method === 'GET' &&
  url.pathname === '/api/refresh/status'
) {
  return handleRefreshStatus(request, env, url);
}
```

實作：

```js
async function handleRefreshStatus(request, env, url) {
  const refreshId = url.searchParams.get('id');

  if (!refreshId) {
    return json(
      request,
      env,
      { error: 'REFRESH_ID_REQUIRED' },
      400,
    );
  }

  const raw = await env.SNAPSHOT.get(
    `refresh:${refreshId}`,
  );

  if (!raw) {
    return json(
      request,
      env,
      { error: 'REFRESH_NOT_FOUND' },
      404,
    );
  }

  return json(
    request,
    env,
    JSON.parse(raw),
    200,
  );
}
```

---

# 二十六、修改 GitHub Dispatch

## Worker

把：

```js
const GITHUB_WORKFLOW = 'deploy-web.yml';
```

改成：

```js
const GITHUB_WORKFLOW = 'refresh-data.yml';
```

人工：

```text
workflow_dispatch
```

Worker Cron：

```text
repository_dispatch
```

例如：

```js
async function triggerGitHubActions(
  env,
  automatedRefresh = false,
  refreshId = null,
) {
  const endpoint = automatedRefresh
    ? `https://api.github.com/repos/${GITHUB_REPO}/dispatches`
    : `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${GITHUB_WORKFLOW}/dispatches`;

  const body = automatedRefresh
    ? {
        event_type: 'scheduled-refresh',
        client_payload: {
          refreshId,
        },
      }
    : {
        ref: 'main',
        inputs: refreshId
          ? {
              refresh_id: refreshId,
            }
          : {},
      };

  // fetch ...
}
```

若採用 `inputs`，`refresh-data.yml` 需要：

```yaml
workflow_dispatch:
  inputs:
    refresh_id:
      required: false
      type: string
```

---

# 二十七、前端 Client API 修改方法

## 修改檔案

```text
web/src/api/client.ts
```

---

## A. Manual Refresh Response

改成：

```ts
export interface ManualRefreshResponse {
  status: 'accepted';
  refreshId: string;
  requestedAt: string;
  fast: 'running' | 'completed' | 'failed';
  deep:
    | 'queued'
    | 'running'
    | 'completed'
    | 'failed'
    | 'unavailable';
}
```

---

## B. 新增 Refresh Status

```ts
export interface RefreshStatus {
  refreshId: string;
  requestedAt: string;

  fast: {
    status:
      | 'running'
      | 'completed'
      | 'failed';

    generatedAt: string | null;
    error: string | null;
  };

  deep: {
    status:
      | 'queued'
      | 'running'
      | 'completed'
      | 'failed'
      | 'unavailable';

    generatedAt: string | null;
    error: string | null;
  };
}
```

新增：

```ts
export async function fetchRefreshStatus(
  refreshId: string,
): Promise<RefreshStatus> {
  const base =
    (import.meta.env.VITE_API_BASE_URL || '')
      .replace(/\/$/, '');

  const response = await fetch(
    `${base}/api/refresh/status?id=${encodeURIComponent(refreshId)}`,
    {
      cache: 'no-store',
    },
  );

  if (!response.ok) {
    throw new DataFetchError(
      'refresh',
      `無法取得更新狀態（HTTP ${response.status}）`,
    );
  }

  return response.json();
}
```

---

# 二十八、建立 `RefreshCoordinator`

## 新增

```text
web/src/api/refreshCoordinator.ts
```

建議：

```ts
export const DATA_REFRESH_EVENT =
  'media-monitoring:refresh';

export interface RefreshEventDetail {
  reason:
    | 'manual'
    | 'interval'
    | 'visibility';

  refreshId?: string;

  requestedAt?: string;

  bypassCache?: boolean;
}

export function dispatchGlobalRefresh(
  detail: RefreshEventDetail,
) {
  window.dispatchEvent(
    new CustomEvent<RefreshEventDetail>(
      DATA_REFRESH_EVENT,
      {
        detail,
      },
    ),
  );
}
```

這樣所有頁面共用一種事件格式。

---

# 二十九、修改 `useData()`

## 修改檔案

```text
web/src/api/useData.ts
```

---

## A. Manual Refresh Event

不要只有：

```ts
window.addEventListener(
  DATA_REFRESH_EVENT,
  onManualRefresh,
);
```

改成讀取 detail：

```ts
const onRefresh = (
  event: Event,
) => {
  const custom =
    event as CustomEvent<RefreshEventDetail>;

  load(
    true,
    Boolean(
      custom.detail?.bypassCache,
    ),
  );
};
```

---

## B. Visibility Refresh

加入：

```ts
const onVisibility = () => {
  if (
    document.visibilityState === 'visible'
  ) {
    load(true);
  }
};

document.addEventListener(
  'visibilitychange',
  onVisibility,
);
```

cleanup：

```ts
document.removeEventListener(
  'visibilitychange',
  onVisibility,
);
```

---

# 三十、修改 `fetchData()` 支援 Cache Busting

## `client.ts`

函式改成：

```ts
export async function fetchData<T>(
  name: string,
  options?: {
    bypassCache?: boolean;
  },
): Promise<Envelope<T>> {
```

Pages URL：

```ts
function pagesUrl(
  name: string,
  bypassCache = false,
): string {
  const base =
    import.meta.env.BASE_URL || '/';

  const sep =
    base.endsWith('/')
      ? ''
      : '/';

  const version =
    bypassCache
      ? `?v=${Date.now()}`
      : '';

  return `${base}${sep}data/${name}.json${version}`;
}
```

手動 refresh 後：

```text
bypassCache = true
```

自動 90 秒 refresh：

```text
bypassCache = false
```

---

# 三十一、Worker / Pages newer-wins

不要：

```text
Worker 成功
→ 一律 Worker
```

改成：

```ts
const worker = await tryWorker();
const pages = await tryPages();

if (worker && pages) {
  return Date.parse(worker.generatedAt)
    >= Date.parse(pages.generatedAt)
    ? worker
    : pages;
}

return worker ?? pages;
```

可寫成：

```ts
function newestEnvelope<T>(
  worker: Envelope<T> | null,
  pages: Envelope<T> | null,
): Envelope<T> {
  if (worker && pages) {
    const workerTime =
      Date.parse(worker.generatedAt) || 0;

    const pagesTime =
      Date.parse(pages.generatedAt) || 0;

    return workerTime >= pagesTime
      ? worker
      : pages;
  }

  if (worker) return worker;
  if (pages) return pages;

  throw new DataFetchError(
    'data',
    'Worker 與 Pages 均無可用資料',
  );
}
```

---

# 三十二、修改右上角「立即更新」

## 修改檔案

```text
web/src/components/Layout.tsx
```

目前不要再：

```ts
setTimeout(..., 5000);
```

改成：

```text
1. POST /api/refresh
2. 取得 refreshId
3. Poll refresh status
4. Fast 完成 → 全站先 refresh 一次
5. Deep 完成 → 全站再 refresh 一次
```

---

## 建議程式流程

```ts
async function refresh() {
  if (busy) return;

  setBusy(true);

  try {
    const request =
      await requestManualRefresh();

    setMessage('正在更新新聞…');

    let fastDone = false;
    let deepDone = false;

    for (
      let attempt = 0;
      attempt < 30;
      attempt += 1
    ) {
      const status =
        await fetchRefreshStatus(
          request.refreshId,
        );

      if (
        status.fast.status === 'completed' &&
        !fastDone
      ) {
        fastDone = true;

        setMessage(
          '新聞已更新，正在同步分析…',
        );

        dispatchGlobalRefresh({
          reason: 'manual',
          refreshId:
            request.refreshId,
          requestedAt:
            request.requestedAt,
          bypassCache: true,
        });
      }

      if (
        status.deep.status === 'completed'
      ) {
        deepDone = true;

        dispatchGlobalRefresh({
          reason: 'manual',
          refreshId:
            request.refreshId,
          requestedAt:
            request.requestedAt,
          bypassCache: true,
        });

        break;
      }

      if (
        status.deep.status === 'failed'
      ) {
        break;
      }

      await new Promise(
        (resolve) =>
          window.setTimeout(
            resolve,
            2000,
          ),
      );
    }

    if (fastDone && deepDone) {
      setMessage(
        '全部資料已更新',
      );
    } else if (fastDone) {
      setMessage(
        '新聞已更新，部分分析資料仍在同步',
      );
    } else {
      setMessage(
        '更新未完成，系統仍會自動重試',
      );
    }
  } catch (error) {
    setMessage(
      (error as Error).message,
    );
  } finally {
    setBusy(false);
  }
}
```

---

# 三十三、搜尋頁同步方法

## 修改檔案

```text
web/src/pages/SearchPage.tsx
```

加入：

```ts
useEffect(() => {
  const refresh = () => {
    void loadTrends();

    if (
      result &&
      result.data.query
    ) {
      void runSearch(
        result.data.query,
        selectedTrend,
        true,
      );
    }
  };

  window.addEventListener(
    DATA_REFRESH_EVENT,
    refresh,
  );

  return () => {
    window.removeEventListener(
      DATA_REFRESH_EVENT,
      refresh,
    );
  };
}, [
  loadTrends,
  result,
  runSearch,
  selectedTrend,
]);
```

這樣：

```text
按立即更新
→ 搜尋結果重新執行
→ Trends 同步重抓
```

---

# 三十四、進階分析同步方法

## 修改檔案

```text
web/src/pages/AdvancedAnalysisPage.tsx
```

加入：

```ts
useEffect(() => {
  const refresh = () => {
    if (
      results.length > 0
    ) {
      void runAnalysis(true);
    }
  };

  window.addEventListener(
    DATA_REFRESH_EVENT,
    refresh,
  );

  return () => {
    window.removeEventListener(
      DATA_REFRESH_EVENT,
      refresh,
    );
  };
}, [
  results.length,
  runAnalysis,
]);
```

---

# 三十五、Meta / Snapshot 契約修改方法

## 修改

```text
web/src/types/contracts.ts
```

新增：

```ts
export interface Meta {
  status:
    | 'ok'
    | 'partial'
    | 'stale'
    | 'error';

  lastFastAt: string | null;

  lastDeepAt: string | null;

  fastSnapshotId?: string | null;

  deepSnapshotId?: string | null;

  methodVersion: string;

  coverage: {
    keywordWindowHours: number;
    trendBucketMinutes: number;
    archiveDays: number;
    sourceCount: number;
  };

  stateRestoreFailed: boolean;
}
```

---

# 三十六、Python Pipeline 加入 `sourceCount`

## 修改檔案

```text
src/opinion_pipeline/cli.py
```

或實際產生 `meta.json` 的位置。

不要：

```python
"methodVersion": "news-heat-v4-37-sources"
```

把來源數量藏在版本字串。

應：

```python
"coverage": {
    "keywordWindowHours": 24,
    "trendBucketMinutes": 60,
    "archiveDays": 7,
    "sourceCount": len(sources),
}
```

`methodVersion` 僅表示方法版本：

```text
news-heat-v5
```

---

# 三十七、首頁移除硬編碼來源數

## 修改檔案

```text
web/src/pages/HomePage.tsx
```

原本：

```tsx
<strong>
  35 個公開新聞來源
</strong>
```

改成：

```tsx
<strong>
  {snapshot.meta?.coverage.sourceCount ?? snapshot.sourceCount}
  {' '}個公開新聞來源
</strong>
```

---

# 三十八、README 與 Script 修改方法

## `scripts/push.sh`

目前不要再顯示：

```text
GitHub Actions 將自動發布最新網頁
```

除非確實由 Workflow 發布。

改成：

```text
已推送 main。
正式站將由 refresh-data workflow 或指定部署流程更新。
```

---

## `scripts/sync_data.sh`

不要：

```text
35 家新聞 RSS
```

改成：

```text
依 config/sources.yml 啟用來源更新新聞資料
```

避免未來來源增減時文件過期。

---

# 三十九、Production Build Guard

## 新增檔案

```text
web/scripts/check-production-env.mjs
```

內容：

```js
const apiBase =
  process.env.VITE_API_BASE_URL || '';

const allowStatic =
  process.env.ALLOW_STATIC_ONLY === 'true';

if (
  !apiBase &&
  !allowStatic
) {
  console.error(
    'Production build requires VITE_API_BASE_URL',
  );

  process.exit(1);
}
```

---

## 修改 `web/package.json`

例如：

```json
{
  "scripts": {
    "check:prod-env": "node scripts/check-production-env.mjs",
    "build": "npm run check:prod-env && vite build"
  }
}
```

若本機需要純靜態 build：

```bash
ALLOW_STATIC_ONLY=true npm run build
```

---

# 四十、測試修改方法

## Worker Tests

修改：

```text
worker/test/routes.test.js
```

至少新增：

### Case 1

```text
POST /api/refresh
→ 202
→ refreshId 存在
```

### Case 2

```text
GitHub dispatch 失敗
→ Fast Refresh 仍然執行
```

### Case 3

```text
GET /api/refresh/status
→ 返回目前狀態
```

### Case 4

```text
錯誤 Origin
→ 403
```

### Case 5

```text
沒有 Worker KV
→ 503
```

### Case 6

```text
GitHub Token 不存在
→ Fast Refresh 可執行
→ Deep 狀態 unavailable
```

---

## Frontend Tests

修改：

```text
web/src/components/Layout.test.tsx
```

測：

```text
按立即更新
→ requestManualRefresh
→ poll
→ dispatch refresh event
```

---

## Search Tests

新增：

```text
manual refresh event
→ rerun current search
```

---

## Advanced Analysis Tests

新增：

```text
manual refresh event
→ rerun current analysis
```

---

# 四十一、建議的實際實作順序

依序修改，避免一次改太多導致難以定位問題。

## Step 1

先新增：

```text
.github/workflows/refresh-data.yml
```

並確認：

```text
workflow_dispatch
```

能成功更新 gh-pages。

---

## Step 2

修改：

```text
worker/src/index.js
```

把：

```text
deploy-web.yml
```

改為：

```text
refresh-data.yml
```

---

## Step 3

將 Fast Refresh 和 GitHub Dispatch 解耦。

確認：

```text
GitHub 掛掉
```

時：

```text
recent
sources
meta
```

仍會更新。

---

## Step 4

加入：

```text
refreshId
/api/refresh/status
```

---

## Step 5

修改：

```text
Layout.tsx
```

移除固定 5 秒。

改成：

```text
poll 真實更新狀態
```

---

## Step 6

建立：

```text
refreshCoordinator.ts
```

---

## Step 7

將：

```text
useData
SearchPage
AdvancedAnalysisPage
```

全部接上 Refresh Coordinator。

---

## Step 8

把：

```text
fetchData()
```

改成：

```text
Worker / Pages newer-wins
```

---

## Step 9

加入：

```text
cache busting
```

---

## Step 10

加入：

```text
sourceCount
snapshotId
lastFastAt
lastDeepAt
```

---

## Step 11

清理：

```text
README
sync_data.sh
push.sh
硬編碼來源數
```

---

## Step 12

執行完整驗證：

```bash
python -m pytest -q

cd worker
npm test

cd ../web
npm test
npm run typecheck
npm run build
```

---

# 四十二、人工驗收流程

完成程式修改後，正式站應用以下流程實測。

## 測試 1：一般自動刷新

1. 開啟首頁。
2. 記錄「最近更新」時間。
3. 保持頁面開啟。
4. Worker 完成下一輪 Cron 後確認時間前進。
5. 不手動 F5。

Expected：

```text
頁面資料自行更新。
```

---

## 測試 2：立即更新

1. 記錄目前 `lastFastAt`。
2. 點右上角「立即更新」。
3. UI 顯示：

```text
正在更新新聞…
```

4. Worker 完成後顯示：

```text
新聞已更新，正在同步分析…
```

5. `lastFastAt` 必須大於按鈕點擊時間。
6. Deep 完成後：

```text
全部資料已更新
```

7. `lastDeepAt` 也必須前進。

---

## 測試 3：目前搜尋同步

1. 搜尋：

```text
台積電
```

2. 保持搜尋結果畫面。
3. 點「立即更新」。
4. 完成後搜尋結果自動重新執行。

Expected：

```text
不用再次按搜尋。
```

---

## 測試 4：進階分析同步

1. 建立三組分析主題。
2. 執行分析。
3. 點立即更新。
4. 更新後自動重新執行目前三組主題。

---

## 測試 5：GitHub 故障

暫時讓 GitHub dispatch 回失敗。

Expected：

```text
Fast Refresh 仍完成。
```

UI：

```text
新聞已更新
分析資料同步失敗或延遲
```

不得顯示整站更新完全失敗。

---

## 測試 6：Worker 故障

讓 Worker 無法使用。

Expected：

```text
前端退回 GitHub Pages last-good。
```

畫面顯示：

```text
stale / 資料延遲
```

不能白屏。

---

# 四十三、完成後的標準資料流

最終系統應符合：

```text
Worker Cron
→ Fast Snapshot
→ KV
→ 前端自動 refresh

Worker Cron
→ repository_dispatch
→ GitHub Deep Pipeline
→ gh-pages
→ 前端 newer-wins

立即更新
→ refreshId
→ Fast Refresh
→ Deep Refresh
→ status poll
→ Global Refresh Event
→ 全頁面同步
```

此架構能確保：

- 自動更新不依賴使用者。
- 手動更新不依賴固定秒數猜測。
- GitHub 故障不會拖垮 Worker 即時新聞。
- Worker 故障仍可退回 Pages。
- 所有頁面共用同一套 Refresh Lifecycle。
- 正式資料版本可追蹤。
- 後續增加新聞來源不需要手動修改 UI 數字。
