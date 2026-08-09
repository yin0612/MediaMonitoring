# yin0612 專屬身分遷移設計

日期：2026-08-09

## 目標

將目前有效的程式碼、文件、Git 設定、GitHub repository 設定與 Cloudflare Worker 網址統一歸屬 `yin0612`，同時保留 Worker、KV 資料、排程、Secrets 與 Git 歷史。

## 已確認狀態

- GitHub repository 已是 `yin0612/MediaMonitoring`，本機 origin 亦正確。
- Cloudflare 帳號內只有 `media-monitoring-demo` 一支 Worker，可安全變更帳號層級 workers.dev 子網域。
- Worker 名稱、KV namespace、Cron 與 Secrets 都不需重建。
- GitHub repository variable 仍指向變更前的 Worker 網址。
- 本機另存有停用的舊 GitHub 登入，全域 Git 作者名稱也尚未統一。
- 已發布的 API 與 Pages 資料內容不含舊身分字串。

## 選定方案

使用 Cloudflare 帳號層級 subdomain API，把 workers.dev 子網域改成 `yin0612-media-monitoring`。Worker 名稱維持 `media-monitoring-demo`，因此新 API base URL 為：

`https://media-monitoring-demo.yin0612-media-monitoring.workers.dev`

這比另建 Worker 或另建 Cloudflare 帳號更能保留既有 KV、Secrets、排程與部署版本，也直接消除有效網址中的舊身分。

## 遷移順序

1. 新增 repository 身分防回歸測試，清理目前樹狀內容中的舊身分。
2. 完成本機測試並提交可稽核的變更。
3. 變更 Cloudflare 帳號子網域，立即驗證新 Worker URL、CORS、health 與資料端點。
4. 將 GitHub `VITE_API_BASE_URL` 更新到已驗證的新 URL。
5. 推送 `main` 觸發 Pages 重建，確認部署資產嵌入新 URL。
6. 清除停用的舊 GitHub 登入，將全域 Git 作者名稱與信箱統一為 `yin0612`。

## 風險控制

- 帳號子網域是帳號層級設定；只有在確認帳號內沒有其他 Worker 後才變更。
- 不先更新 GitHub variable，避免 Pages 在 Cloudflare 新 URL 尚未生效時指向不存在的端點。
- 不重建 KV 或 Worker，避免資料與 Secrets 遺失。
- 不改寫既有 Git commit 歷史；歷史是稽核紀錄，不屬於目前有效設定或發布資料。

## 完成條件

- repository 身分測試、Python、Worker、Web 測試與 build 全部通過。
- Cloudflare account subdomain 與 GitHub variable 都是 `yin0612` 專屬值。
- 新 Worker health、CORS、meta、sources 與 search 端點通過。
- Pages 最新來源 SHA 等於 `origin/main`，頁面資產不再包含變更前的 Worker 網址。
- 本機 Git/GitHub 有效身分只保留 `yin0612`。
