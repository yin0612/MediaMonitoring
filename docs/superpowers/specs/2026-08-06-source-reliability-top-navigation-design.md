# MediaMonitoring 來源可靠性與 Apple 式頂部導覽設計

**日期：** 2026-08-06
**狀態：** 使用者已授權自行決策並一次完成

## 1. 問題與目標

目前來源狀態把「有效 feed 暫時沒有新文章」和「HTTP、XML 或時間資料真的失敗」混為一談。年代新聞與財訊依賴 Google News 補充，查詢回傳有效但零篇的 RSS 時，系統會誤標為錯誤；Worker 又只用最近 24 小時是否有文章判定無官方 RSS 的來源健康度，使零篇來源在 Pages 與 Worker 顯示不同結果。

介面雖已採 Apple 式材質，但桌機仍以左側欄作主要導覽，與使用者提供的 Apple Store 參考圖不一致。本次目標是：

- 真正故障才標示錯誤，零篇不製造假警報。
- 新增 5 個已以實際 RSS 內容驗證的台灣媒體來源。
- 移除桌機左側欄，改成頂部全域導覽；窄螢幕同樣由頂部進入完整選單。
- 保留免費、公開 metadata、無憑證的既有架構。

## 2. 方案比較

### 方案 A：只隱藏錯誤徽章

改動最少，但資料契約仍錯誤，搜尋、摘要與 Worker 狀態仍會互相矛盾，不採用。

### 方案 B：來源健康度與內容量分離（採用）

有效 RSS 即使零篇也代表取得路徑正常；HTTP、無法解析的 XML、所有項目時間無效才是錯誤。Worker 讀取 Pages 的來源健康快照，無官方 RSS 的來源不再單靠 24 小時文章量判定。此方案不增加伺服器成本，且可用測試固定契約。

### 方案 C：建立自有新聞資料庫與長駐抓取服務

控制力最高，但引入伺服器、儲存、監控與持續費用，不符合目前免費部署邊界，不採用。

## 3. 來源健康模型

### 3.1 Python Actions 管線

- Google News／官方 RSS 回傳可辨識的 RSS 或 Atom 文件但沒有 `<item>`／`<entry>`：來源取得成功，`status=ok`、`itemCount=0`。
- Feed 有項目，但所有項目因缺標題、連結或有效時間被淘汰：`NO_VALID_ITEMS`，仍屬資料品質錯誤。
- HTTP、逾時、連線或無法辨識為 RSS／Atom：保留既有錯誤代碼。
- 官方 RSS 失敗時仍依序使用 Google News 與允許的官網 metadata listing 備援。

### 3.2 Cloudflare Worker

- Worker 繼續直接擷取官方 RSS，控制免費層 subrequest 數量。
- 對無官方 RSS 的來源，Worker 同時讀取 Pages `sources.json`；Pages 已證實來源可達時，即使最近 24 小時零篇也顯示正常。
- Pages 明確回報失敗或快照無來源證據時，才依 Worker 最近資料判為 stale／error。
- `itemCount` 只表達目前合併資料量，不再兼任健康探針。

## 4. 新增來源

所有 feed 已於 2026-08-06 以 HTTP 200、可解析項目與有效發布時間實測：

| ID | 媒體 | 官方 feed |
|---|---|---|
| `rti` | 中央廣播電臺 | `https://www.rti.org.tw/rss` |
| `technews` | 科技新報 | `https://technews.tw/feed/` |
| `taipeitimes` | Taipei Times | `https://www.taipeitimes.com/xml/index.rss` |
| `coolloud` | 苦勞網 | `https://www.coolloud.org.tw/rss.xml` |
| `tfc` | 台灣事實查核中心 | `https://tfc-taiwan.org.tw/feed/` |

來源登錄須同步 Python YAML、Worker、Web 型別與顯示 metadata；測試固定總數為 29，防止漏改其中一層。

## 5. Apple 式頂部導覽

### 5.1 桌機

- 頂列依序為品牌、9 個主要路由、系統狀態、更新與主題控制。
- 導覽使用短標籤、44px 最小操作高度、半透明模糊材質與黏附頂部。
- 當前路由以低對比膠囊底色與 accent 文字標示，不使用厚重側欄選取塊。
- 移除 `<aside class="sidebar">`，內容區置中並使用更完整的水平空間。

### 5.2 平板與手機

- 1100px 以下隱藏完整水平導覽，顯示位於頂列下方的「首頁／搜尋／總覽／更多」四個入口。
- 四個入口不固定在畫面底部，改為頂部黏附列，符合使用者指定的導覽位置。
- 「更多」從頂部展開完整 9 路由面板，保留初始焦點、Tab 鎖定、Escape、背景 inert、焦點還原及跨斷點關閉。
- 內容底部不再預留舊底部 tabbar 空間。

## 6. 錯誤與可理解性

- 狀態頁以「正常但目前 0 篇」呈現有效空 feed，不顯示錯誤色。
- 真實錯誤保留可診斷的 `errorCode`、最後成功時間與存取方式。
- 首頁可信度仍依來源健康度，而不是總文章數判斷。
- 新來源不保證每次都有文章，但 feed 可用性必須由自動測試與部署快照證明。

## 7. 測試與完成條件

- Python：有效空 RSS 測試先失敗後修正；無效文件仍失敗；29 來源一致性測試通過。
- Worker：Pages 來源正常但最近零篇時仍顯示 ok；Pages 來源失敗且零篇時顯示 error。
- Web：桌機存在頂部主導覽且沒有 sidebar；窄螢幕頂部四入口與完整 9 路由面板通過可及性測試。
- 全量 Python、Worker、Web、TypeScript 與 production build 通過。
- 9 路由在 1440、1024、390 寬度無水平溢出、具單一 main/h1；正式站與 Worker 完成 live verification。

## 8. 非目標

- 不擷取或保存新聞全文。
- 不繞過付費牆、robots 或需授權 API。
- 不建立付費常駐後端。
- 不複製 Apple 商標、產品圖或官方網站內容。
