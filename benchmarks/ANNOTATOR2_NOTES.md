# annotator2 二度審查守則（依 benchmarks/ANNOTATION_GUIDE.md）

與第一輪（annotator1）的三處規格差異，本輪一律以官方指南為準：

## 1. topics — 只有 7 類
`finance` / `politics` / `society` / `weather` / `international` / `entertainment` / `other`
- 第一輪自創的 `technology`、`sports` 不存在 → 科技產業/企業/財報歸 `finance`；純科研、天文、生活科技歸 `other`；體育歸 `other`（指南未列體育，娛樂指影劇演藝）。

## 2. textTone — 四值，含 uncertain
`positive` / `neutral` / `negative` / `uncertain`
- 雜訊題（關鍵字頁、UUID、`第N頁-相關新聞`、站名、部落格詩文）語氣無法判定 → `uncertain`（第一輪誤填 neutral）。
- `neutral` 保留給真實而中性陳述的新聞（預報、法說會、營收公告）。

## 3. entities — 只收 PERSON／ORG canonical 名稱
- 刪除：國家（台灣/中國/美國）、縣市地名（台北市/新北市）、颱風名（白海豚颱風）、概念詞（AI/健康）。
- 採 `config/entities.yml` 的 canonical 寫法：氣象署→中央氣象署、北市府→台北市政府、TSMC→台積電、桃機→桃園機場、衛生福利部→衛福部。
- 政府機關、政黨、公司、球團、媒體、基金會皆算 ORG。市政府算 ORG（`台北市政府`），但「台北市」這個地名不算。

## 4. eventCluster — 具體事件，不可只按大類合併
第一輪把 164 筆全掛 `typhoon-baihaitun`，違反「只有大類相同不可合併」。本輪拆為具體事件：
| slug | 範圍 |
|---|---|
| baihaitun-forecast | 路徑、強度、特報、海警發布解除 |
| baihaitun-closures | 各縣市停班停課決定與公告 |
| baihaitun-taipei-dayoff-row | 台北市未放假爭議（蔣萬安遭批） |
| baihaitun-damage | 各地風災災情統計與個案 |
| baihaitun-tamsui-tornado | 淡水龍捲風 |
| baihaitun-keelung-flood | 基隆海水倒灌與補償 |
| baihaitun-transport | 航班、橋梁、道路、水門管制 |
| baihaitun-cpbl | 中職延賽 |
| baihaitun-overseas | 沖繩、浙江、上海等境外影響 |

其餘沿用第一輪 slug（`tzuchi-vaccine-fraud`、`hanguang-drill-2026` 等），並在本輪新增必要的具體事件 slug。

## 5. target / targetStance — 收緊
指南：「只有文本明確針對對象時標註；資料不足填 uncertain」。
- 標題對特定人／組織表達評價、歸因或指控時才填 target。
- 純災情、預報、事故通報、無名當事人 → `uncertain` / `uncertain`（第一輪常填地名，本輪改掉）。

## 輸出行格式
`idx|eventCluster|topics|entities|textTone|target|targetStance`（entities 空填 `-`）
