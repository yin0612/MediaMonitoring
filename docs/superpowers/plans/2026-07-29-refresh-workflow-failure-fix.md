# 自動刷新工作流程失敗修正 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除自動資料刷新造成的偶發前端測試失敗通知，同時保留 push 與人工 dispatch 的完整測試。

**Architecture:** 以專用 `repository_dispatch` 事件 `scheduled-refresh` 作為 GitHub Actions 的排程刷新契約；Cloudflare Worker 只有在 `scheduled` 路徑送出此事件，人工 `workflow_dispatch` 沒有跳過測試的輸入。另將前端 Pages 備援測試的時間資料改為單一基準時間，確保測試穩定且仍驗證最新文章優先排序。

**Tech Stack:** GitHub Actions YAML、Cloudflare Worker JavaScript、Node.js test runner、React/Vitest、Python/Pytest、PyYAML。

## Global Constraints

- 不修改正式新聞搜尋排序、資料契約、刷新頻率或 Cloudflare KV 行為。
- 不關閉 GitHub Actions 失敗通知。
- 不移除 GitHub `schedule` 備援。
- `push` 與人工 `workflow_dispatch` 必須繼續執行完整測試。
- 只有 GitHub `schedule` 與 Worker `scheduled` 送出的 `repository_dispatch: scheduled-refresh` 可以跳過重複測試。
- GitHub 官方文件確認 `repository_dispatch` 可用 `types` 限定事件，且工作流程從 default branch 執行。

---

### Task 1: 修正 Pages 備援測試的時間不確定性

**Files:**
- Modify: `web/src/api/search.test.ts:58-92`
- Test: `web/src/api/search.test.ts`

**Interfaces:**
- Consumes: `searchNews(query, range)` 既有「依 `publishedAt` 由新到舊排序」契約。
- Produces: 不依賴執行毫秒邊界的固定測試資料。

- [ ] **Step 1: 保留遠端失敗作為既有 RED 證據**

確認 Actions run `30435472747` 的失敗為：

```text
AssertionError: expected [ 'pages-2', 'pages-1' ]
to deeply equal [ 'pages-1', 'pages-2' ]
```

這是測試資料不確定性，不是正式搜尋程式缺陷，因此本 Task 不修改 production code。

- [ ] **Step 2: 將測試資料改成單一基準時間**

把 `article` helper 與呼叫改為：

```ts
const now = Date.now();
const article = (id: string, publishedAt: number) => ({
  id,
  source: 'cna',
  title: `台積電新聞 ${id}`,
  excerpt: '',
  publishedAt: new Date(publishedAt).toISOString(),
  url: `https://example.com/${id}`,
  sentiment: null,
});
```

Worker 備援假資料使用：

```ts
data: { items: [article('worker-truncated', now - 180_000)] },
```

Pages 假資料使用：

```ts
data: {
  items: [
    article('pages-1', now - 120_000),
    article('pages-2', now - 60_000),
  ],
},
```

排序斷言改為：

```ts
expect(result.data.items.map((item) => item.id)).toEqual(['pages-2', 'pages-1']);
```

- [ ] **Step 3: 執行前端目標測試**

Run:

```powershell
npm --prefix web test -- --run src/api/search.test.ts
```

Expected: `1 passed` test file、`12 passed` tests。

- [ ] **Step 4: 提交測試修正**

```powershell
git add -- web/src/api/search.test.ts
git commit -m "test: stabilize Pages fallback ordering"
```

---

### Task 2: 讓 Worker 排程 dispatch 明確標記自動刷新

**Files:**
- Modify: `worker/test/routes.test.js:30-68,311-342`
- Modify: `worker/src/index.js:438-461`
- Test: `worker/test/routes.test.js`

**Interfaces:**
- Consumes: GitHub workflow dispatch body `{ ref }` 與 repository dispatch body `{ event_type }`。
- Produces: `triggerGitHubActions(env, automatedRefresh = false)`；人工刷新使用預設 `false`，Worker `scheduled` 使用 `true`。

- [ ] **Step 1: 先修改排程 dispatch 測試**

在人工刷新測試的 `calls` 中找出 GitHub dispatch，確認它仍使用 workflow endpoint：

```js
const dispatch = calls.find(({ url }) => url.includes('api.github.com'));
assert.ok(dispatch, 'expected a manual GitHub Actions dispatch');
assert.equal(
  dispatch.url,
  'https://api.github.com/repos/ChunYu8866/MediaMonitoringDB/actions/workflows/deploy-web.yml/dispatches',
);
assert.deepEqual(JSON.parse(dispatch.init.body), { ref: 'main' });
```

將排程測試的 endpoint 與 body 斷言改為：

```js
assert.equal(
  dispatch.url,
  'https://api.github.com/repos/ChunYu8866/MediaMonitoringDB/dispatches',
);
assert.deepEqual(JSON.parse(dispatch.init.body), { event_type: 'scheduled-refresh' });
```

- [ ] **Step 2: 執行 Worker 測試並確認 RED**

Run:

```powershell
npm --prefix worker test
```

Expected: `scheduled dispatches GitHub Actions when a token is configured` 失敗，received endpoint 仍是 workflow dispatch。

- [ ] **Step 3: 實作最小 dispatch 差異**

將函式簽名與 body 改為：

```js
async function triggerGitHubActions(env, automatedRefresh = false) {
  if (!env.GITHUB_TOKEN) return { ok: false, reason: 'NOT_CONFIGURED' };
  try {
    const endpoint = automatedRefresh
      ? `https://api.github.com/repos/${GITHUB_REPO}/dispatches`
      : `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${GITHUB_WORKFLOW}/dispatches`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'MediaMonitoringDemo-Worker/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(automatedRefresh
        ? { event_type: 'scheduled-refresh' }
        : { ref: 'main' }),
    });
    return response.ok ? { ok: true } : { ok: false, reason: `HTTP_${response.status}` };
  } catch {
    return { ok: false, reason: 'NETWORK_ERROR' };
  }
}
```

Worker 排程改為：

```js
async scheduled(event, env, ctx) {
  ctx.waitUntil(buildSnapshot(env).catch(() => {}));
  ctx.waitUntil(triggerGitHubActions(env, true));
},
```

`handleRefresh` 保持 `triggerGitHubActions(env)`，確保人工刷新仍跑完整測試。

- [ ] **Step 4: 執行 Worker 測試並確認 GREEN**

Run:

```powershell
npm --prefix worker test
```

Expected: 全部 Worker tests 通過，`fail 0`。

- [ ] **Step 5: 提交 Worker 契約**

```powershell
git add -- worker/src/index.js worker/test/routes.test.js
git commit -m "fix: mark scheduled workflow refreshes"
```

---

### Task 3: GitHub Actions 只對自動刷新跳過重複測試

**Files:**
- Create: `tests/test_deploy_web_workflow.py`
- Modify: `.github/workflows/deploy-web.yml:14-85`
- Test: `tests/test_deploy_web_workflow.py`

**Interfaces:**
- Consumes: Worker 的 `repository_dispatch: scheduled-refresh` 事件。
- Produces: 無輸入的人工 `workflow_dispatch`、專用 `repository_dispatch` 與五個測試步驟的統一執行條件。

- [ ] **Step 1: 新增工作流程契約測試**

建立 `tests/test_deploy_web_workflow.py`：

```python
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "deploy-web.yml"
FULL_TEST_STEPS = {
    "Python 測試",
    "安裝 Worker 相依套件",
    "Worker 核心測試",
    "前端單元測試",
    "型別檢查",
}
FULL_TEST_CONDITION = (
    "github.event_name != 'schedule' && github.event_name != 'repository_dispatch'"
)


def load_workflow() -> dict:
    return yaml.load(WORKFLOW.read_text(encoding="utf-8"), Loader=yaml.BaseLoader)


def test_workflow_has_dedicated_automated_refresh_event() -> None:
    workflow = load_workflow()

    assert not workflow["on"]["workflow_dispatch"]
    assert workflow["on"]["repository_dispatch"]["types"] == ["scheduled-refresh"]


def test_only_automated_refresh_skips_full_test_steps() -> None:
    workflow = load_workflow()
    steps = {
        step["name"]: step
        for step in workflow["jobs"]["build"]["steps"]
        if "name" in step
    }

    assert FULL_TEST_STEPS <= steps.keys()
    for name in FULL_TEST_STEPS:
        assert steps[name]["if"] == FULL_TEST_CONDITION
```

- [ ] **Step 2: 執行契約測試並確認 RED**

Run:

```powershell
python -X utf8 -m pytest tests/test_deploy_web_workflow.py -q
```

Expected: 第一個測試因 `workflow_dispatch` 仍有 input 且缺少 `repository_dispatch` 失敗；第二個測試因條件仍依賴 input 失敗。

- [ ] **Step 3: 宣告專用自動刷新事件**

保留空的人工 `workflow_dispatch`，另增加專用事件：

```yaml
  workflow_dispatch:
  repository_dispatch:
    types: [scheduled-refresh]
```

- [ ] **Step 4: 更新完整測試步驟條件**

下列五個步驟的 `if` 全部改為：

```yaml
if: github.event_name != 'schedule' && github.event_name != 'repository_dispatch'
```

步驟名稱：

```text
Python 測試
安裝 Worker 相依套件
Worker 核心測試
前端單元測試
型別檢查
```

- [ ] **Step 5: 執行契約測試並確認 GREEN**

Run:

```powershell
python -X utf8 -m pytest tests/test_deploy_web_workflow.py -q
```

Expected: `2 passed`。

- [ ] **Step 6: 提交工作流程契約**

```powershell
git add -- .github/workflows/deploy-web.yml tests/test_deploy_web_workflow.py
git commit -m "fix: skip repeated tests during scheduled refresh"
```

---

### Task 4: 完整本機驗證

**Files:**
- Verify: repository-wide tests and build

**Interfaces:**
- Consumes: Tasks 1-3 的全部提交。
- Produces: 可發布分支與零失敗驗證證據。

- [ ] **Step 1: 執行 Python 測試**

```powershell
python -X utf8 -m pytest -q
```

Expected: 全部通過，`failed` 為 0。

- [ ] **Step 2: 執行 Worker 測試**

```powershell
npm --prefix worker test
```

Expected: 全部通過，`fail 0`。

- [ ] **Step 3: 執行 Web 測試、型別檢查與建置**

```powershell
npm --prefix web test
npm --prefix web run typecheck
npm --prefix web run build
```

Expected: 所有 Vitest tests 通過；TypeScript 與 Vite build exit code 均為 0。

- [ ] **Step 4: 檢查差異與工作樹**

```powershell
git diff --check
git status --short
git log --oneline -4
```

Expected: `git diff --check` 無輸出；工作樹乾淨；最近提交只包含設計、測試與最小修正。

---

### Task 5: 發布並驗證 GitHub Actions 與正式網站

**Files:**
- Publish: branch `codex/fix-refresh-workflow-notifications`
- Verify: GitHub Actions and `https://chunyu8866.github.io/MediaMonitoringDB/`

**Interfaces:**
- Consumes: 已通過全部本機驗證的分支。
- Produces: main 上的修正、成功的完整 push run、成功且測試 skipped 的 scheduled-refresh run、HTTP 200 正式頁面。

- [ ] **Step 1: 推送分支並建立 PR**

```powershell
git push -u origin codex/fix-refresh-workflow-notifications
```

建立 PR，標題：

```text
fix: stabilize scheduled Pages refresh
```

- [ ] **Step 2: 確認 PR checks 後合併**

確認完整測試成功後，以 squash merge 合併至 `main`。若任何 check 失敗，先讀取該 run 完整日誌並停止合併。

- [ ] **Step 3: 監看 main 的 push 工作流程**

```powershell
gh run list --workflow deploy-web.yml --branch main --event push --limit 1
gh run watch <push-run-id> --exit-status
```

Expected: build 與 deploy 均為 success，完整測試步驟均執行。

- [ ] **Step 4: 觸發並監看 scheduled-refresh 工作流程**

```powershell
gh api --method POST repos/ChunYu8866/MediaMonitoringDB/dispatches -f event_type=scheduled-refresh
gh run list --workflow deploy-web.yml --branch main --event repository_dispatch --limit 1
gh run watch <refresh-run-id> --exit-status
gh run view <refresh-run-id> --json jobs
```

Expected: build 與 deploy success；`Python 測試`、`安裝 Worker 相依套件`、`Worker 核心測試`、`前端單元測試`、`型別檢查` 的 conclusion 均為 `skipped`。

- [ ] **Step 5: 驗證正式網站**

```powershell
curl.exe -L --fail --silent --show-error -o NUL -w "%{http_code}" "https://chunyu8866.github.io/MediaMonitoringDB/"
```

Expected: `200`。
