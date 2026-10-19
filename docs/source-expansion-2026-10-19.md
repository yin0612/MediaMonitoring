# 2026-10-19 截圖來源收錄核對

兩張截圖共 36 個網站／頻道：11 個已收錄、25 個新增。保留原有來源，登錄總數由 37 增至 62。Python、Worker、前端名稱與來源 ID 已同步。

自由財經（`ec.ltn.com.tw`）沿用 `ltn`，聯合新聞網沿用 `udn`；三立新聞網沿用 `setn`。財富自由是 `stock.ltn.com.tw`，新增獨立頻道；旺得富是 `wantrich.chinatimes.com`，新增獨立頻道。Worker 的來源辨識優先採最明確的子網域，避免被父網域先匹配走。

## 截圖中原本已有收錄

| 截圖名稱 | 來源 ID |
| --- | --- |
| MoneyDJ理財網 | moneydj |
| ETtoday | ettoday |
| 鉅亨網 | anue |
| 經濟日報 | moneyudn |
| 中央社 | cna |
| 中時新聞網 | chinatimes |
| 工商時報 | ctee |
| 自由財經 | ltn |
| 聯合新聞網 | udn |
| 壹蘋新聞網 | nextapple |
| 三立新聞網 | setn |

## 新增來源及抓取驗證

以下為本機實際透過正式管線 `collect_source` 測試的結果，每來源最多取 20 筆。驗證的是當時傳輸與解析結果，不保證所有文章完整收錄；文章日期需以各快照為準。

查詢時間（UTC）：`2026-10-19T08:28:15.722083+00:00`。

| 新增來源 | ID | 官方網域 | 本次取得方式 | 回傳筆數 |
| --- | --- | --- | --- | --- |
| 財訊快報 | `investor` | [investor.com.tw](https://investor.com.tw/) | Google News RSS 補充 | 20 |
| 旺得富 | `wantrich` | [wantrich.chinatimes.com](https://wantrich.chinatimes.com/) | Google News RSS 補充 | 20 |
| 富聯網 | `moneylink` | [money-link.com.tw](https://money-link.com.tw/) | Google News RSS 補充 | 20 |
| 觀傳媒 | `watchmedia` | [watchmedia01.com](https://watchmedia01.com/) | 官方 RSS | 20 |
| 臺灣時報 | `taiwantimes` | [taiwantimes.com.tw](https://taiwantimes.com.tw/) | Google News RSS 補充 | 0 |
| 翻報 | `turnnews` | [turnnewsapp.com](https://turnnewsapp.com/) | Google News RSS 補充 | 20 |
| 中華日報 | `cdns` | [cdns.com.tw](https://cdns.com.tw/) | 官方 RSS | 20 |
| 是新聞 YesMedia | `yesmedia` | [yesmedia.com.tw](https://yesmedia.com.tw/) | Google News RSS 補充 | 20 |
| 敗家達人 | `gbyhn` | [gbyhn.com.tw](https://gbyhn.com.tw/) | 官方 RSS | 1 |
| 新頭條 | `thehubnews` | [thehubnews.net](https://thehubnews.net/) | 官方 RSS | 20 |
| 優分析 | `uanalyze` | [uanalyze.com.tw](https://uanalyze.com.tw/) | Google News RSS 補充 | 20 |
| nStock | `nstock` | [nstock.tw](https://nstock.tw/) | Google News RSS 補充 | 20 |
| 樂聯網 | `leho` | [leho.com.tw](https://leho.com.tw/) | 官方 RSS | 20 |
| 財富自由 | `stockltn` | [stock.ltn.com.tw](https://stock.ltn.com.tw/) | Google News RSS 補充 | 20 |
| 短傳媒 | `renews` | [re-news.tw](https://re-news.tw/) | Google News RSS 補充 | 1 |
| 科技島 | `technice` | [technice.com.tw](https://technice.com.tw/) | 官方 RSS | 10 |
| XFastest | `xfastest` | [news.xfastest.com](https://news.xfastest.com/) | 官方 RSS | 10 |
| 卡優新聞網 | `cardu` | [cardu.com.tw](https://cardu.com.tw/) | 官方 RSS | 2 |
| 知新聞 | `knews` | [knews.com.tw](https://knews.com.tw/) | Google News RSS 補充 | 20 |
| LINE TODAY | `linetoday` | [today.line.me](https://today.line.me/) | Google News RSS 補充 | 20 |
| Yahoo新聞 | `yahoonews` | [tw.news.yahoo.com](https://tw.news.yahoo.com/) | 官方 RSS | 20 |
| Yahoo股市 | `yahoostock` | [tw.stock.yahoo.com](https://tw.stock.yahoo.com/) | 官方 RSS | 20 |
| PChome新聞 | `pchomenews` | [news.pchome.com.tw](https://news.pchome.com.tw/) | Google News RSS 補充 | 20 |
| PChome股市 | `pchomestock` | [stock.pchome.com.tw](https://stock.pchome.com.tw/) | Google News RSS 補充 | 20 |
| 蕃新聞 yamNews | `yam` | [n.yam.com](https://n.yam.com/) | Google News RSS 補充 | 20 |

25 個新增來源全部成功取得並解析回應，24 個有文章；臺灣時報本次的近 24 小時 Google News RSS 為有效空清單，仍列入來源並依後續快照呈現實際狀態，不捏造新聞。

## 取得方式與部署

- 可用官方 RSS 已寫入 `config/sources.yml`；未提供、被拒絕或暫時失效時，依既有流程改用官方網域 Google News RSS。
- PChome 股市同時查詢 `stock.pchome.com.tw` 與舊的 `pchome.megatime.com.tw`；同一網域下的重複 www 名稱會先合併，避免重複查詢。
- Yahoo 新聞、Yahoo 股市、PChome 新聞的官方 feed 由 Actions 收集，Worker 以 Pages 快照整合（`viaPages`），避免新增來源後直接請求超出免費層的預留額度。搜尋仍可透過 Google News／Pages 找到其文章。
- Worker 於 Pages 證據不足時的官方 RSS 請求，每個 URL 僅一次，包含 Pages 讀取的測試總數不超過原有 40 次預留門檻。
- GitHub 推送會啟動資料刷新及 Pages 部署；Worker 來源清單須另行部署。D1 schema 無變動，新來源沿既有儲存流程寫入。
- 聚合平台可能轉載同一新聞，這些來源數不等於獨立原創媒體數；目前去重規則仍以原有 URL／同來源標題規則為準。歷史資料不會因新增來源而自動完整回填。

## 本次驗證

- Python：128 項測試通過。
- Worker：108 項測試通過，涵蓋全部 36 個截圖名稱、子網域來源歸屬及請求額度。
- 前端：96 項測試通過；TypeScript 與正式版建置成功。
- Playwright：40 項測試通過，涵蓋 9 個頁面及 375／768／1024／1440 像素視窗。
- 新增來源：25 個實際連線與解析成功，24 個取得文章、1 個有效空清單。
- PR 必要安全檢查使用的前端與 Worker 鎖定檔已在既有版本範圍內更新修補；兩端 npm audit 均回報 0 個弱點，未修改直接依賴版本範圍。
