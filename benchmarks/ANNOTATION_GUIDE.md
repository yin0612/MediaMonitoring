# 人工評測標註指南

此資料集只保存既有公開新聞 metadata（標題、短摘要、來源、時間與原文連結），不用全文。

- `eventCluster`：同一具體事件使用相同 ID；只有大類相同不可合併。
- `topics`：可多選財經、政治、社會、天氣、國際、娛樂或其他。
- `entities`：列出可明確辨識的 PERSON／ORG canonical 名稱，不猜測同名。
- `textTone`：positive／neutral／negative／uncertain，描述文本語氣，不代表民意。
- `target`、`targetStance`：只有文本明確針對對象時標註；資料不足填 `uncertain`。
- `doubleAnnotation=true` 必須由兩位不同標註者獨立完成，之後計算 Cohen's kappa／一致率。
- `test` split 在模型與 threshold 固定前不可查看或調參。

人工標註完成前，產品中的事件、情緒、實體與敘事分析一律維持「實驗性」。
