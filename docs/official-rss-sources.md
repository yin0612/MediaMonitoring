# 台灣官方 RSS 來源與媒體評估

本專案目前維護 37 家台灣新聞媒體固定白名單（35 家為早期版本的歷史數字）。資料管線優先讀取媒體公開的官方 RSS；只有官方 RSS 暫時失敗或未提供時，才使用該媒體官方網域的 Google News RSS 補充或官網低頻 metadata 擷取。公開資料只保存標題、短摘要、發布時間、來源與原文連結，不重製全文或圖片。

## 媒體審查與產量評估表

| 媒體 | 30 篇+/日判定 | 官方 RSS 狀態 | RSS / 官方入口 |
| --- | --- | --- | --- |
| **NOWnews 今日新聞** | **明確確認**（每日產製逾 600 則新聞） | ❌ 未查到公開官方 RSS | [NOWnews 關於我們](https://www.nownews.com/aboutus)（Google News 補充 / 官網低頻） |
| **中央社 CNA** | **明確確認**（即時頁單日密集更新） | ✅ 官方 RSS 啟用 | [中央社 RSS 目錄](https://www.cna.com.tw/about/rss.aspx)（合併政治、地方、社會、產經、科技、生活） |
| **聯合新聞網 UDN** | **明確高於門檻** | ⚠️ 入口較老，採 Google News 補充 | [聯合新聞網即時](https://udn.com/news/breaknews/1) |
| **Newtalk 新頭殼** | **明確確認**（單日上午密集多頁） | ✅ 官方 RSS 啟用 | [Newtalk 全部新聞 RSS](https://newtalk.tw/rss/all/) ／ [RSS 目錄](https://www.newtalk.tw/rss/index/) |
| **自由時報** | **高信心超過 30** | ✅ 官方 RSS 啟用 | [自由時報即時 RSS](https://news.ltn.com.tw/rss/all.xml) ／ [RSS 服務](https://service.ltn.com.tw/RSS) |
| **ETtoday 新聞雲** | **高信心超過 30** | ⚠️ FeedBurner RSS 啟用 | [ETtoday Realtime Feed](https://feeds.feedburner.com/ettoday/realtime) |
| **TVBS 新聞網** | **明確高於門檻** | ❌ 未查到公開官方 RSS | [TVBS 即時總覽](https://news.tvbs.com.tw/realtime)（Google News 補充 / 官網低頻） |
| **東森新聞 EBC** | **高信心超過 30** | ❌ 未查到公開官方 RSS | [東森新聞即時](https://news.ebc.net.tw/realtime)（Google News 補充 / 官網低頻） |
| **中時新聞網** | **高信心超過 30**（新加入來源） | ⚠️ 無穩定官方 RSS（採 Google News 補充） | [中時新聞網即時](https://www.chinatimes.com/realtimenews/) |
| **CTWANT** | **明確確認**（周刊王/即時新聞） | ⚠️ 無穩定官方 RSS（採 Google News 補充） | [CTWANT 官網](https://www.ctwant.com/) |

## 本次補充與擴充

| ID | 媒體 | 官方 RSS | 備註 |
|---|---|---|---|
| `cna` | 中央社 | [RSS 說明頁](https://www.cna.com.tw/about/rss.aspx) | 管線合併政治、地方、社會、產經證券、科技、生活健康六個分類 feed |
| `businessweekly` | 商業周刊 | [RSS 訂閱頁](https://www.businessweekly.com.tw/RSS.aspx) | 使用最新網站文章 feed |
| `newtalk` | 新頭殼 | [官方 RSS](https://newtalk.tw/rss/all/) | 新頭殼全站即時新聞 feed |
| `chinatimes` | 中時新聞網 | 官方網域 Google News 補充 | 新增媒體來源白名單，支援即時比對與官網 metadata 擷取 |
| `ctwant` | CTWANT | 官方網域 Google News 補充 | 新增媒體來源白名單，支援即時比對與官網 metadata 擷取 |
| `mnews` | 鏡新聞 | 官方網域 Google News 補充 | 新增媒體來源白名單，支援即時比對與官網 metadata 擷取 |
| `mirrormedia` | 鏡週刊 | 官方網域 Google News 補充 | 新增媒體來源白名單，支援即時比對與官網 metadata 擷取 |
| `rti` | 中央廣播電臺 | [官方 RSS](https://www.rti.org.tw/rss) | 央廣公開新聞 feed |
| `technews` | 科技新報 | [官方 RSS](https://technews.tw/feed/) | 科技與產業新聞 feed |
| `taipeitimes` | Taipei Times | [官方 RSS](https://www.taipeitimes.com/xml/index.rss) | 英文新聞索引 feed |
| `coolloud` | 苦勞網 | [官方 RSS](https://www.coolloud.org.tw/rss.xml) | 勞動與社會議題新聞 feed |
| `tfc` | 台灣事實查核中心 | [官方 RSS](https://tfc-taiwan.org.tw/feed/) | 事實查核文章 feed |

## 既有官方 RSS

- [自由時報 RSS](https://service.ltn.com.tw/RSS)
- [公視新聞 RSS](https://news.pts.org.tw/xml/newsfeed.xml)
- [壹電視 RSS](https://www.nexttv.com.tw/nRSS.xml)
- [中天新聞 RSS](https://ctinews.com/rss/google-news.xml)
- [經濟日報 RSS](https://money.udn.com/rssfeed/news/1001/5590?ch=money)
- [鉅亨網 RSS](https://news.cnyes.com/rss/v1/news/category/headline)
- [關鍵評論網 RSS](https://www.thenewslens.com/feed/feedly)
- [報導者 RSS](https://www.twreporter.org/a/rss2.xml)
- [壹蘋新聞網 RSS](https://news.nextapple.com/api/rss/category/latest)
- [ETtoday RSS](https://feeds.feedburner.com/ettoday/realtime)

UDN 的公開 RSS 端點目前回傳空白 placeholder，未列入官方 RSS 啟用清單，避免把無效資料算入熱度；它仍透過官方網域 Google News RSS 補充。RSS 端點會變動，來源健康狀態以每次快照的 `sources.json` 為準。若個別 feed 失敗，該媒體會標示 `partial`／`stale`，不會阻擋其他媒體更新。
