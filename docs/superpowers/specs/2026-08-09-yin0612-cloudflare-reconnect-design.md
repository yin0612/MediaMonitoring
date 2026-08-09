# yin0612 GitHub 與 Cloudflare Worker 重新接線設計

日期：2026-08-09

## 目標

把 `yin0612/MediaMonitoring` 的 GitHub Pages 前端重新連到目前可管理的 Cloudflare Worker，讓瀏覽器能通過 CORS 讀取即時資料，並將本機領先遠端的三個既有 commit 安全推送到 `main`。

## 已確認狀態

- 本機 `main` 工作樹乾淨，較 `origin/main` 領先三個 commit。
- GitHub remote 為 `https://github.com/yin0612/MediaMonitoring.git`；登入者 `yin0612` 對倉庫有 Admin 權限。
- GitHub Pages 正常，但仍由遠端 `main` 的 `1c63a9b` 建置。
- Repository variable `VITE_API_BASE_URL` 指向 `media-monitoring-demo.media-monitoring-worker.workers.dev`。
- 該 Worker 仍允許 `https://shueisha0612.github.io`，因此 `https://yin0612.github.io` 的瀏覽器請求會被 CORS 阻擋。
- 本機 Wrangler 登入的 Cloudflare 帳號可管理 `media-monitoring-demo.chunyu8866-media-monitoring.workers.dev`。該 Worker 的既有 `SNAPSHOT` binding 使用 KV namespace `7b3cce6f054f4918bf5a27dc5386a322`，並已有 `GITHUB_TOKEN` secret。
- 倉庫的 `worker/wrangler.toml` 目前引用另一個帳號的 KV namespace `7f726665db69456aba1da52ddeeeb563`，不能直接部署到目前登入的帳號。

## 修正範圍

1. 只把 `worker/wrangler.toml` 的 `SNAPSHOT` namespace ID 改成目前 Cloudflare 帳號既有的 namespace。
2. 保留 Worker 名稱 `media-monitoring-demo`、Cron、現有 secret 與既有 KV 資料。
3. 以目前本機程式部署 Worker；程式中既有的 `ALLOWED_ORIGIN`、`ARCHIVE_BASE_URL` 與 GitHub repository 常數已是 `yin0612`／`MediaMonitoring`。
4. Worker 驗證通過後，把 GitHub repository variable `VITE_API_BASE_URL` 改為：
   `https://media-monitoring-demo.chunyu8866-media-monitoring.workers.dev`
5. 將修正 branch 快轉回本機 `main`，再推送 `main`；不強制推送、不改寫遠端歷史。

## 資料流

```text
yin0612.github.io/MediaMonitoring
  -> VITE_API_BASE_URL
  -> media-monitoring-demo.chunyu8866-media-monitoring.workers.dev
  -> SNAPSHOT KV
  -> yin0612/MediaMonitoring refresh-data.yml（需要既有 GITHUB_TOKEN）
```

Worker 網址中的舊字樣只是 Cloudflare 帳號的 workers.dev 子網域，不參與 GitHub 身分或 repository 授權判定。實際整合由 CORS Origin、Pages archive URL、GitHub repository 常數與 Token 權限決定。

## 失敗處理

- 若本機完整測試失敗，不部署、不更新 GitHub variable、不推送。
- 若 Worker 部署失敗，保留目前 GitHub variable，不讓 Pages 指向尚未驗證的端點。
- 若 Worker 部署成功但 health、CORS 或資料端點驗證失敗，不更新 GitHub variable，並停止發布。
- 若 GitHub Actions 失敗，保留已推送 commit，讀取失敗 job 的完整 log，針對根因修正後再重跑；不盲目重試。
- 若 Worker 的 `GITHUB_TOKEN` 無法觸發目前 repository，快速更新仍可用；深度更新會明確標示 unavailable，再另外更新該 secret。

## 驗證

發布前：

- Python：`$env:PYTHONPATH='src'; python -X utf8 -m pytest -q`
- Worker：`npm.cmd test`
- Web：`npm.cmd test -- --run`
- Web typecheck：`npm.cmd run typecheck`
- Web build：分別驗證 Worker URL 模式與允許靜態模式

部署後：

- Worker `/api/health` 為 HTTP 200 且 `data.status=ok`。
- 從 `Origin: https://yin0612.github.io` 預檢時，`Access-Control-Allow-Origin` 必須精確等於該 Origin。
- `/api/data?name=meta` 與 `/api/search` 回傳結構化資料。
- `POST /api/refresh` 僅測試一次，確認 fast/deep 狀態；若觸發 Actions，追蹤該次 run。
- GitHub `origin/main` 等於預期本機 commit，CI 與 `Refresh data and deploy` 成功。
- Pages `source-main-sha.txt` 等於新 `main` SHA，正式頁面與資料端點回 HTTP 200。

## 非目標

- 不搬移或重建 Cloudflare 帳號。
- 不嘗試控制目前指向 `shueisha0612.github.io` 的另一個 Worker。
- 不更名 Cloudflare workers.dev 帳號子網域。
- 不重構與本次重新接線無關的應用程式功能。
