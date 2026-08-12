# 30 日歷史覆蓋回填

`config/archive_backfill.jsonl` 是可重現的公開 metadata 回填檔。它只包含來源 ID、標題、發布時間與公開連結，不保存文章全文或圖片；連結若是 Google News wrapper，會在 `_meta.provenance` 明確標示。

pipeline 每次執行都會載入這個檔案，再和即時資料、Pages 上一輪快照合併。因此下一次 refresh 不會把回填資料刪掉。回填資料仍會通過 30 日 cutoff、來源 allowlist、URL/title 去重與 `coverage_window`，資料不足時不會宣稱完整。

## 重新產生

在 repository 根目錄執行：

```powershell
$env:PYTHONPATH = 'src'
python scripts/build_archive_backfill.py `
  --from-date 2026-07-15 `
  --to-date 2026-07-28 `
  --source-id cna `
  --source-id ltn `
  --source-id udn `
  --source-id setn `
  --source-id newtalk `
  --source-id ettoday `
  --source-id pts `
  --source-id technews `
  --max-items-per-source-day 5 `
  --timeout 20
```

查詢使用 `site:<domain> after:<date> before:<next-date>`，並以 RSS 的 UTC `publishedAt` 再做一次日期過濾。外部 RSS 暫時失敗時，腳本會記錄 `_meta.failedQueries`；只有可解析的 rows 會寫入輸出。

## 驗證

```powershell
$env:PYTHONPATH = 'src'
python -m pytest tests/test_archive_backfill.py -q
```

查看每一天與每個來源的數量：

```powershell
$env:PYTHONPATH = 'src'
@'
from collections import Counter
from pathlib import Path
from opinion_pipeline.archive_backfill import load_archive_backfill
items, meta = load_archive_backfill(Path('config/archive_backfill.jsonl'))
print(meta)
print(Counter(item.published_at.date().isoformat() for item in items))
'@ | python -
```
