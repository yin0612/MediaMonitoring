# yin0612 專屬身分遷移實作計畫

日期：2026-08-09

**目標：** 將目前有效的 repository、Pages、Worker URL 與本機 Git/GitHub 身分統一為 `yin0612`。

### Task 1：Repository 防回歸與文件清理

- [x] 建立 `tests/test_repository_identity.py`，掃描 Git 納管與待納管文字檔。
- [x] 先執行測試並確認會列出殘留文件。
- [x] 更新文件中的 repository、Pages、Worker URL 與專案名稱。
- [x] 執行身分測試並確認通過。

### Task 2：本機完整驗證與提交

- [x] 執行 Python 測試。
- [x] 執行 Worker 測試。
- [x] 執行 Web 測試、型別檢查與 Worker URL 模式 build。
- [x] 執行 `git diff --check` 並提交精確檔案。

### Task 3：Cloudflare workers.dev 子網域遷移

- [x] 再次確認帳號內只有 `media-monitoring-demo`。
- [x] 將帳號 subdomain 設為 `yin0612-media-monitoring`。
- [x] 驗證新 URL 的 health、CORS、meta、sources 與 search。
- [x] 確認變更前 URL 已不再作為有效服務端點。

### Task 4：GitHub 與 Pages 發布

- [x] 將 `VITE_API_BASE_URL` 設為新 Worker URL。
- [x] 設定 repository homepage 與說明。
- [x] 快轉合併至 `main` 並推送。
- [x] 監看 CI 與 Refresh data and deploy 成功。
- [x] 驗證 Pages 的來源 SHA、靜態資產與 API 串接。

### Task 5：本機身分清理與最終稽核

- [x] 移除停用的舊 GitHub 登入。
- [x] 將全域 Git user name/email 改為 `yin0612` 專屬值。
- [x] 搜尋 repository、Git 設定、GitHub 設定、Cloudflare 設定與線上回傳資料。
- [x] 確認工作樹乾淨、origin/main 與 Pages 均指向同一版本。
