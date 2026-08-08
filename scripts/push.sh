#!/bin/bash
# 台灣新聞輿情監測系統 - 自動 Commit 與 Push 腳本
set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "=========================================="
echo "準備推送最新修訂至 GitHub..."
echo "時間: $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="

git add .
if git diff-index --quiet HEAD --; then
    echo "沒有未 commit 的變更。"
else
    git commit -m "更新數據與介面：$(date '+%Y-%m-%d %H:%M:%S')"
fi

echo "正在推送到 GitHub (origin main)..."
git push origin main

echo "✅ 已成功推送到 GitHub！GitHub Actions 將自動發布最新網頁。"
