#!/bin/bash
# 啟動台灣新聞輿情監測平台 Web 前端服務
set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

export PATH="$PROJECT_ROOT/bin_tools/python/python/bin:$PROJECT_ROOT/bin_tools/bin:$PATH"

echo "=========================================="
echo "啟動 台灣新聞輿情監測平台 Web 服務"
echo "=========================================="

cd web
npm run dev
