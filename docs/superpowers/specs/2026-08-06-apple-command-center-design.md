# MediaMonitoring Apple 式決策工作台設計規格

**日期：** 2026-08-06
**狀態：** 已由使用者授權自行決策並一次完成
**產品定位：** 個人研究者／管理者使用的台灣新聞輿情決策工作台，同時維持公開展示與研究可追溯性

## 1. 問題定義

現有系統已具備九條路由、24 個公開新聞來源、關鍵字熱度、事件分類、實體共現、進階布林搜尋、資料新鮮度與 Worker fallback。核心缺口不是資料或圖表不足，而是能力尚未被組織成一條能快速完成判讀的流程：

1. 首頁呈現多個資料區塊，但沒有先回答「今天最值得注意的是什麼」。
2. 數值缺少相對前期變化與可讀結論，使用者需要自行跨頁推論。
3. 行動導覽只露出群組第一頁，名稱與實際目的地不一致，其他頁面不易發現。
4. 進階分析功能完整，但初次使用缺少語法引導與可直接執行的分析範例。
5. 全站已有玻璃、圓角與深淺色，但 emoji、重複 CSS 規則、狀態重量與互動回饋不一致。

## 2. 方案比較

### 方案 A：純視覺換皮

只修改顏色、圓角、陰影、字體與間距。

- 優點：速度快、程式風險低。
- 缺點：不改善決策效率、行動導覽與分析學習成本。
- 結論：不採用，無法滿足「強化整個系統、功能」。

### 方案 B：決策工作台重構（採用）

保留既有資料契約與分析能力，新增決策摘要、完整行動導覽、分析範例與一致的 Apple 式設計系統。

- 優點：直接提升可用性與功能價值，不需重寫可靠的資料管線。
- 缺點：需同時修改共用元件、首頁、分析頁、導覽與 CSS。
- 結論：採用。這是價值、風險與交付速度的最佳平衡。

### 方案 C：完整團隊 SaaS 平台

新增登入、共享監測清單、通知、案件管理、資料庫與權限。

- 優點：長期產品化能力最強。
- 缺點：需要持久化、身份、隱私與營運成本，超出目前公開靜態站架構。
- 結論：本輪不採用；先建立可擴充的決策工作台邊界。

## 3. 設計原則

### 3.1 清晰優先

- 首屏先呈現決策摘要，再呈現原始指標。
- 每個數字同時提供語意、比較或限制，不把使用者丟在無上下文的 KPI 前。
- `stale`、`partial`、`experimental` 與 fallback 必須明示，不能為了簡潔而隱藏。

### 3.2 內容優先、材質退後

- Apple 式材質用在 app bar、sidebar、sheet 與卡片層級，不使用過度發光或彩色玻璃。
- 主要背景採中性霧面；藍色只用於主要動作、選取與資訊連結。
- 漸層只出現在首頁 hero 的低對比背景，不進入資料圖表。

### 3.3 漸進揭露

- 手機只保留四個一級控制：首頁、搜尋、總覽、更多。
- 「更多」以 bottom sheet 顯示全部九條路由，依探索、分析、資料說明分組。
- 進階語法預設收斂成範例 chips 與說明，使用者仍可直接輸入完整布林式。

### 3.4 一致與可及

- 所有結構性圖示使用同一家族的 SVG，不使用 emoji。
- 觸控目標至少 44×44 CSS px。
- 所有互動具有 hover、focus-visible、pressed、disabled 與 reduced-motion 狀態。
- 行動版主要內容不得水平捲動；長表格可在明確容器內橫向捲動。

## 4. 資訊架構

### 4.1 桌機

- 頂列：品牌、單一資料狀態摘要、立即更新、主題切換。
- 側欄：保留完整九條路由與三個語意群組。
- 主內容：最大閱讀寬度 1440px，首頁使用決策優先佈局，分析頁使用工具列與資料面板。

### 4.2 手機

- 頂列：品牌、資料狀態、更新、主題。
- 底部 tab bar：首頁、搜尋、總覽、更多。
- 更多 sheet：近期新聞、進階分析、關鍵字、事件與主題、人物與組織、方法與狀態；同時列出四個主入口以建立完整心智模型。
- sheet 開啟時鎖定背景捲動，Escape、遮罩與選取路由皆可關閉。

## 5. 功能強化

### 5.1 首頁「今日決策摘要」

新增純函式 `buildDecisionBrief(input)`，只使用現有快照資料，不新增後端契約。

輸出：

- `headline`：以最高熱度關鍵字、近期升溫詞或來源狀態形成一句可讀標題。
- `summary`：說明最高熱度、近期變化、主要事件與資料可信度。
- `signals`：最多三張訊號卡，類型固定為 `momentum`、`topic`、`coverage`。
- `primaryAction`：指向最能解釋摘要的既有路由。
- `confidence`：`good | attention | limited`，由來源健康度與 stale/experimental 狀態決定。

計算規則：

1. 以 `getRisingKeywords(recent.items, keywords, generatedAt)` 取得 90 分鐘近期升溫詞。
2. 有升溫詞時優先以升溫幅度作 headline；沒有時使用最高熱度關鍵字。
3. coverage 以健康來源數／啟用來源數呈現；異常比例低於 20% 時只做低權重提示。
4. topics 或 keywords stale 時，摘要明示資料受限且不產生確定性語句。
5. 無資料時顯示可操作的空狀態，連到搜尋或方法頁。

### 5.2 系統狀態呈現

- 頂列把「狀態 badge + 更新時間」合併成單一 `SystemStatus` 控制。
- 首頁不再因少量來源異常顯示高重量整頁 banner；改由決策摘要 coverage signal 呈現。
- `error` 或 `stateRestoreFailed` 才使用高權重 banner。
- 手動更新成功後顯示非阻塞 toast/inline status，失敗時保留既有錯誤訊息與自動更新說明。

### 5.3 進階分析啟動器

- 提供三組一鍵範例：品牌比較、政策議題、排除雜訊。
- 每個範例完整定義最多三個 `TopicInput` 與時間範圍。
- 點擊範例只填入表單，不自動送出網路請求，避免意外耗用與失去控制。
- 顯示 AND、OR、NOT、`-排除詞`、`"精準詞"` 的短語法說明。

### 5.4 全站狀態元件

- `LoadingState`、`ErrorState`、`EmptyState`、`Banner` 與 `StatTile` 全部改用統一 SVG icon。
- Card 支援 `tone="default|elevated|subtle"`，不改變既有呼叫的預設行為。
- 按鈕、輸入框、select、chip、badge 與表格共用相同半徑、focus ring 與動效 token。

## 6. 元件與檔案邊界

- `web/src/lib/decisionBrief.ts`：決策摘要純函式與型別，無 React 依賴。
- `web/src/components/DecisionBrief.tsx`：首頁摘要呈現，不自行讀資料。
- `web/src/components/MobileNavigation.tsx`：底部 tab bar、更多 sheet 與關閉互動。
- `web/src/lib/analysisPresets.ts`：固定分析範例資料，無副作用。
- `web/src/components/AnalysisLauncher.tsx`：範例與語法說明。
- `web/src/components/Icon.tsx`：擴充一致圖示名稱與 path。
- `web/src/styles/apple.css`：Apple 式 token、shell、共用元件與響應式覆寫；只覆寫共用視覺，不複製頁面專屬資料樣式。
- `web/src/index.css`：保留現有頁面結構樣式並引入 `styles/apple.css`；後續可分階段拆檔，本輪不做與目標無關的大規模搬移。

## 7. 資料流

```text
既有 useData hooks
  ├─ meta / sources / keywords / recent / topics / entities
  └─ 保留 envelope、stale、experimental
             │
             ▼
      buildHomeSnapshot（既有）
             │
             ├─ buildDecisionBrief（新增純函式）
             │      └─ DecisionBrief（只呈現）
             └─ 現有首頁卡片與列表
```

進階分析範例只更新本地 React state；送出後仍使用既有 `searchNews`、Worker 與靜態 fallback，API 不變。

## 8. 錯誤處理

- 決策摘要任一資料集缺失時以其餘資料降級，不拋出 UI 錯誤。
- 所有比率避免除以零；沒有啟用來源時 confidence 為 `limited`。
- sheet 不依賴 `dialog.showModal()`，使用 React state 與語意 `role="dialog"`，避免舊瀏覽器行為差異。
- 分析範例資料為只讀常數；套用時建立新陣列，避免修改共享狀態。
- 所有新功能都不寫入伺服器、不新增 cookie、不傳輸個人資料。

## 9. 測試策略

### 9.1 單元測試

- 決策摘要：升溫詞、無升溫詞、stale、來源異常、全空資料。
- 分析範例：每組 topic 數量、query 非空、時間範圍合法、套用時不可變。

### 9.2 元件測試

- MobileNavigation：四個 tab、sheet 開關、全部九條路由、選取後關閉、Escape 關閉。
- DecisionBrief：headline、confidence、主要動作與訊號卡語意。
- AnalysisLauncher：點擊 preset 後回傳正確 topics/range，不自動分析。
- Layout：桌機導覽完整、手機更多控制存在、狀態與主題控制可存取。

### 9.3 回歸與建置

- Python：`python -X utf8 -m pytest -q`
- Worker：`npm test`
- Web：`npm test`、`npm run typecheck`、`npm run build`
- copy policy：不得新增手動 `<br>`、GitHub UI 連結或未受控結構性 emoji。

### 9.4 瀏覽器驗收

- 九條路由於 1440×900、1024×768、390×844。
- 文件不得水平溢出；表格容器例外但需明確可捲動。
- 所有行動版路由可由四個 tab 或更多 sheet 到達。
- 觸控控制最小 44×44px。
- 深色、淺色、system 與 reduced-motion 不破版。
- 首頁第一屏必須同時看到 headline、摘要、至少一個訊號與主要行動。

## 10. 非目標

- 不新增登入、團隊共享、推播通知或持久化資料庫。
- 不修改 Python/Worker 的分析公式與既有 API schema。
- 不聲稱詞典情緒等同民意、立場或模型推論。
- 不複製 Apple 商標、產品頁內容、SF Symbols 資產或專有視覺素材。

## 11. 完成標準

以下條件全部有當輪證據才算完成：

1. 首頁可直接提供決策摘要、變化訊號與下一步行動。
2. 行動版可發現並到達全部九條路由，且無主要內容水平溢出。
3. 進階分析具一鍵範例與語法指引，既有布林功能不退化。
4. 結構性 emoji 被統一 SVG icon 取代。
5. 全站套用 Apple 式 token、材質、focus、動效與深淺色。
6. 既有 envelope、stale、experimental、Worker fallback 與 API 契約維持不變。
7. 全套自動測試、型別檢查、正式建置與多尺寸瀏覽器驗收通過。
8. 經驗證的版本完成提交、發布並在正式站重新驗證。
