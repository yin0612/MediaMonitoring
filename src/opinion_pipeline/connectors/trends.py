"""Google Trends 台灣 Trending Now RSS 解析器。"""
from __future__ import annotations

from datetime import timezone
from email.utils import parsedate_to_datetime
import re
from xml.etree import ElementTree


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
