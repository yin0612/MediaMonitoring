#!/bin/bash
# 台灣新聞輿情監測系統 - 全自動部署與 GitHub 推送腳本
set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# 設定 PATH 包含本機工具鏈
export PATH="$PROJECT_ROOT/bin_tools/python/python/bin:$PROJECT_ROOT/bin_tools/bin:$PATH"

REMOTE_URL="$(git remote get-url origin)"

echo "=========================================="
echo "開始編譯並自動推送至 GitHub (gh-pages & main)..."
echo "時間: $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="

# 1. 先跑測試再推。曾經有一次 web/package.json 被改成非法 JSON 就直接推上 main，
#    整條 CI 與資料更新管線因此全掛；這道門檔的就是這種事。
echo "[1/4] 正在執行測試..."
PYTHONPATH=src PYTHONIOENCODING=utf-8 python -m pytest -q
(cd "$PROJECT_ROOT/worker" && npm test)
(cd "$PROJECT_ROOT/web" && npm test)

# 2. 編譯前端網站
echo "[2/4] 正在編譯最新前端網頁與數據..."
cd "$PROJECT_ROOT/web"
npm run build
cd "$PROJECT_ROOT"

# 3. 推送源碼至 main 分支
echo "[3/4] 正在推送到 main 分支..."
rm -f .git/index.lock
git add .
if ! git diff-index --quiet HEAD --; then
    git commit -m "Auto update source: $(date '+%Y-%m-%d %H:%M:%S')"
fi
# 推送失敗必須讓使用者知道，不能靜默當成成功。
git push origin main

# 4. gh-pages 部署交由 GitHub Actions refresh-data.yml 處理，不在本機直推。
echo "[4/4] 已推送 main；gh-pages 由 refresh-data.yml 自動部署。"

echo "=========================================="
echo "✅ 已推送至 main。GitHub Actions 會接手建置並部署 gh-pages，"
echo "   線上生效時間請以網站顯示的資料時間為準。"
echo "=========================================="
