"""Google Trends 台灣 Trending Now RSS 與網頁即時榜解析器。"""
from __future__ import annotations

from datetime import timezone
from email.utils import parsedate_to_datetime
import json
import re
from xml.etree import ElementTree
import requests


_HT = "https://trends.google.com/trending/rss"
_CJK_SPACE = re.compile(r"([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])")


def _text(node: ElementTree.Element, path: str) -> str:
    child = node.find(path)
    return (child.text or "").strip() if child is not None else ""


def parse_trends_feed(raw: bytes) -> list[dict]:
    """將官方 Trending Now RSS 轉為可公開的精簡欄位。"""
    root = ElementTree.fromstring(raw)
    output: list[dict] = []
    for entry in root.findall("./channel/item"):
        title = _CJK_SPACE.sub(r"\1", _text(entry, "title"))
        if not title:
            continue
        published_raw = _text(entry, "pubDate")
        try:
            published = parsedate_to_datetime(published_raw).astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        except (TypeError, ValueError):
            published = ""
        news = []
        for node in entry.findall(f"{{{_HT}}}news_item"):
            url = _text(node, f"{{{_HT}}}news_item_url")
            news_title = _text(node, f"{{{_HT}}}news_item_title")
            if url and news_title:
                news.append(
                    {
                        "title": news_title,
                        "source": _text(node, f"{{{_HT}}}news_item_source"),
                        "url": url,
                    }
                )
        output.append(
            {
                "title": title,
                "approximateTraffic": _text(entry, f"{{{_HT}}}approx_traffic"),
                "publishedAt": published,
                "news": news,
            }
        )
    return output


def fetch_realtime_web_trends(geo: str = "TW", timeout: int = 10) -> list[dict]:
    """解析 Google Trends 網頁版當前最即時熱搜榜（與網頁版同步）。"""
    url = f"https://trends.google.com/trending?geo={geo}&hl=zh-TW"
    headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}
    try:
        response = requests.get(url, headers=headers, timeout=timeout)
        if response.status_code != 200:
            return []
        matches = [m for m in re.findall(r"AF_initDataCallback\((.*?)\);", response.text, re.DOTALL) if "ds:0" in m]
        if not matches:
            return []
        match_str = matches[0]
        data_match = re.search(r"data:\s*(.*?), sideChannel:", match_str, re.DOTALL)
        if not data_match:
            return []
        data = json.loads(data_match.group(1))
        items = data[1] if len(data) > 1 and isinstance(data[1], list) else []
        output = []
        for item in items:
            if not isinstance(item, list) or not item:
                continue
            raw_title = item[0] if isinstance(item[0], str) else ""
            clean_title = _CJK_SPACE.sub(r"\1", raw_title.replace(" ", "")).strip()
            if not clean_title:
                continue
            traffic_num = item[6] if len(item) > 6 and isinstance(item[6], int) else 0
            traffic_str = f"{traffic_num:,}+" if traffic_num >= 1000 else (f"{traffic_num}+" if traffic_num > 0 else "")
            output.append(
                {
                    "title": clean_title,
                    "approximateTraffic": traffic_str,
                    "publishedAt": "",
                    "isRealtime": True,
                    "news": [],
                }
            )
        return output
    except Exception:
        return []
