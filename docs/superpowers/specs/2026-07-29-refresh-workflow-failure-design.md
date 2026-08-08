# 自動刷新工作流程失敗修正設計

## 目標

消除 `Update news snapshot and deploy Pages` 每日偶發失敗通知，同時保留程式碼變更與人工執行時的完整測試保護。

## 已確認根因

1. `web/src/api/search.test.ts` 的 Pages 備援測試為每篇文章分別呼叫 `new Date().toISOString()`。兩次呼叫跨毫秒時，產品程式會依既有契約把較新的 `pages-2` 排在 `pages-1` 前面，但測試固定期待原始輸入順序，造成偶發失敗。
2. Cloudflare Worker 每 5 分鐘以 `workflow_dispatch` 觸發 `deploy-web.yml`。工作流程目前無法區分人工執行與自動刷新，因此每次自動刷新都會執行完整測試，一天最多放大為 288 次測試機會。
3. GitHub Actions 近期失敗紀錄均停在同一個前端測試；RSS 更新、Python 測試與 Worker 測試均已成功。

## 設計

### 穩定測試資料

- Pages 備援測試改用明確、固定且不同的 `publishedAt`。
- 斷言維持產品的「最新文章優先」排序契約。
- 不修改正式搜尋排序程式。

### 分離自動刷新事件

- `deploy-web.yml` 保留無輸入的人工 `workflow_dispatch`，另增加專用 `repository_dispatch` 事件類型 `scheduled-refresh`。
- Worker 的 `scheduled` 處理器呼叫 repository dispatch endpoint，傳送 `event_type: "scheduled-refresh"`。
- 人工刷新按鈕沿用 workflow dispatch endpoint；GitHub 人工執行介面沒有任何跳過測試的選項。

### 測試執行條件

- `push`：執行 Python、Worker、Web 測試與型別檢查，再建置部署。
- 人工 `workflow_dispatch`：維持完整測試，再建置部署。
- GitHub `schedule` 與 Worker `repository_dispatch`：透過事件名稱條件跳過重複測試，只更新快照、建置與部署。
- 建置或部署的真正錯誤仍維持失敗狀態與 GitHub 通知。

## 驗證

1. 先修改測試契約，使現有 Worker dispatch body 測試失敗，證明測試能攔截未標記的排程刷新。
2. 修改 Worker dispatch body 後確認 Worker 測試通過。
3. 以靜態工作流程測試確認人工 dispatch 無輸入、專用 `scheduled-refresh` 事件與測試步驟條件存在。
4. 執行 Python、Worker、Web 全部測試、Web 型別檢查與正式建置。
5. 合併後觸發一次 `scheduled-refresh` repository dispatch，確認 build 與 deploy 成功，且測試步驟為 skipped。
6. 確認 GitHub Pages 正式網址回應 HTTP 200。

## 不在範圍內

- 不關閉 GitHub Actions 失敗通知。
- 不變更新聞排序、資料契約、刷新頻率或 Cloudflare KV 行為。
- 不移除 GitHub `schedule` 備援。
