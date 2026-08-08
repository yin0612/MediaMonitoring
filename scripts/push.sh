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

# 1. 編譯前端網站
echo "[1/3] 正在編譯最新前端網頁與數據..."
cd "$PROJECT_ROOT/web"
npm run build
cd "$PROJECT_ROOT"

# 2. 推送源碼至 main 分支
echo "[2/3] 正在推送到 main 分支..."
rm -f .git/index.lock
git add .
if ! git diff-index --quiet HEAD --; then
    git commit -m "Auto update source: $(date '+%Y-%m-%d %H:%M:%S')"
fi
git push origin main || true

# 3. 直推已編譯靜態檔至 gh-pages 分支
echo "[3/3] 正在發布已編譯網頁至 gh-pages 分支..."
cd "$PROJECT_ROOT/web/dist"
rm -rf .git
git init
git branch -M gh-pages
git remote add origin "$REMOTE_URL"
git config user.name "yin0612"
git config user.email "yin0612@users.noreply.github.com"
git add .
git commit -m "Deploy web dist: $(date '+%Y-%m-%d %H:%M:%S')"
git push origin gh-pages --force

echo "=========================================="
echo "✅ 發布完成！已成功將最新網頁直接部署至 GitHub Pages。"
echo "=========================================="
