# 本機人工標註工具

這個頁面只在你的電腦瀏覽器中運作。候選資料、機器建議與人工標註都不會傳送到 Cloudflare、GitHub 或其他服務；只有你按「下載更新後 JSONL」時才會產生檔案。

## 啟動（Windows PowerShell）

```powershell
$repo = 'C:\Users\LIN CHUN YU\Documents\程式碼\10_輿論V2\新聞輿論平台'
Set-Location "$repo\tools\annotation-app"
python -m http.server 8765
```

保留這個 PowerShell 視窗開啟，再在瀏覽器開啟：

```text
http://127.0.0.1:8765/
```

停止工具時，回到 PowerShell 按 `Ctrl+C`。

## 一般標註

1. 在「待標註資料」載入 `benchmarks/annotation-candidates.jsonl`。
2. 「機器建議」可選擇載入 `benchmarks/annotation-machine-draft.jsonl`。它僅供比對，不會自動改寫標註。
3. 預設使用「共識／正式標註」，逐筆填寫星號欄位、主題與實體後按儲存。
4. 定期按「下載更新後 JSONL」備份；下載的檔案才是要交回專案評估的檔案。

## 雙人標註

`doubleAnnotation=true` 的 100 筆資料必須由兩人獨立判斷。

1. 兩人各自從相同的原始 `annotation-candidates.jsonl` 開始。
2. 第一人選「標註者 1」、第二人選「標註者 2」，各自下載 JSONL。
3. 以安全合併指令把兩份獨立欄位合回原始檔；這只會合併 `annotator1`、`annotator2`，不會覆寫正式共識欄位：

```powershell
Set-Location 'C:\Users\LIN CHUN YU\Documents\程式碼\10_輿論V2\新聞輿論平台'
python scripts\merge_annotation_exports.py `
  --base benchmarks\annotation-candidates.jsonl `
  --annotator1 benchmarks\annotator1-reviewed.jsonl `
  --annotator2 benchmarks\annotator2-reviewed.jsonl `
  --output benchmarks\annotation-double-reviewed.jsonl
```

4. 載入合併檔並選「共識／正式標註」，處理歧見後寫入最後決定。

第二位標註者不需要是 GitHub 協作者，也不需要登入任何帳號。

## 評估

把最後下載完成的共識檔放回 `benchmarks` 後執行：

```powershell
Set-Location 'C:\Users\LIN CHUN YU\Documents\程式碼\10_輿論V2\新聞輿論平台'
python scripts/evaluate_annotations.py --input benchmarks\annotation-candidates-reviewed.jsonl
```

要解除「人工標註尚未提供」的發布阻擋，結果必須至少顯示：

```text
humanLabelRows: 1000
missingHumanLabels: 0
doubleAnnotatedRows: 100
```
