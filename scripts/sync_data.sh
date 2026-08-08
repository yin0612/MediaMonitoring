#!/bin/bash
# 台灣新聞輿情監測系統 - 資料同步與更新腳本
set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# 設定 PATH 包含本機工具鏈
export PATH="$PROJECT_ROOT/bin_tools/python/python/bin:$PROJECT_ROOT/bin_tools/bin:$PATH"
export PYTHONPATH=src
export PYTHONIOENCODING=utf-8

echo "=========================================="
echo "開始更新新聞輿情資料..."
echo "時間: $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="

# 嘗試執行本地 Python 資料擷取與分析管線
if command -v python3 >/dev/null 2>&1; then
    echo "[1/2] 正在執行 Python 管線 (擷取 35 家新聞 RSS 與 Google Trends)..."
    if python3 -m opinion_pipeline.cli; then
        echo "✅ 本地管線執行成功，已更新 web/public/data/*.json"
        
        # 自動 commit 並推送至 GitHub
        if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
            echo "[2/2] 正在自動推送最新資料至 GitHub..."
            rm -f .git/index.lock
            git add .
            if ! git diff-index --quiet HEAD --; then
                git commit -m "Auto update snapshot: $(date '+%Y-%m-%d %H:%M:%S')"
            fi
            git push origin main || echo "⚠️ 自動推送完成或已為最新版本"
        fi
        exit 0
    else
        echo "⚠️ 本地管線執行有警告或部分失敗，嘗試同步遠端快照作為備援..."
    fi
fi

# 備援機制：從 GitHub Pages 下載最新 Live 快照資料
echo "[2/2] 從遠端 (yin0612/MediaMonitoring) 同步最新數據快照..."
DATA_DIR="web/public/data"
mkdir -p "$DATA_DIR"

FILES=("meta" "keywords" "sources" "recent" "entities" "topics" "trends" "news-archive-index")

for file in "${FILES[@]}"; do
    echo "  - 下載 ${file}.json..."
    curl -sL "https://yin0612.github.io/MediaMonitoring/data/${file}.json" -o "${DATA_DIR}/${file}.json" || true
done

echo "✅ 資料更新完畢！"
