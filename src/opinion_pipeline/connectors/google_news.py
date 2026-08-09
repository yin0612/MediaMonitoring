"""Google News RSS 補充連接器。

規格允許的第二取得路徑：官方 RSS 不可用時，以 `site:<官方網域>` 查詢
Google News RSS，只會取得該白名單媒體自己網域的內容。
連結為 Google News 轉址 URL（點擊仍導向原文），僅保留標題與時間 metadata。
"""
from __future__ import annotations

from urllib.parse import quote

import feedparser

from ..models import NormalizedItem, SourceResult
# 時間解析與 RSS 連接器共用同一份實作（它已委派 timeutil.normalize_published），
# 避免兩個連接器各留一份會分歧的複本。
from .rss import _clean, _error_code, _fetch_bytes, _parse_time, is_feed_document


def google_news_url(domain: str) -> str:
    query = quote(f"site:{domain} when:1d")
    return f"https://news.google.com/rss/search?q={query}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant"


def strip_publisher_suffix(title: str, source: dict) -> str:
    """移除 Google News 附加的「 - 媒體名」尾綴；只在尾綴確實是該媒體名稱時移除。"""
    head, sep, tail = title.rpartition(" - ")
    if not sep:
        return title
    names = {source.get("name", ""), *source.get("aliases", [])}
    return head if tail.strip() in names else title


def fetch_google_news(source: dict, timeout: int, max_items: int) -> SourceResult:
    sid, name = source["id"], source["name"]
    domain = (source.get("domains") or [""])[0]
    if not domain:
        return SourceResult(id=sid, name=name, enabled=True, ok=False, error_code="NO_DOMAIN")

    try:
        raw = _fetch_bytes(google_news_url(domain), timeout)
    except Exception as exc:  # noqa: BLE001 - 交由上層記錄來源錯誤
        return SourceResult(id=sid, name=name, enabled=True, ok=False, error_code=_error_code(exc))
    return parse_google_news(raw, source, max_items)


def parse_google_news(raw: bytes, source: dict, max_items: int) -> SourceResult:
    sid, name = source["id"], source["name"]
    parsed = feedparser.parse(raw)
    entries = parsed.get("entries") or []
    if not entries:
        if is_feed_document(parsed):
            return SourceResult(id=sid, name=name, enabled=True, ok=True)
        return SourceResult(id=sid, name=name, enabled=True, ok=False, error_code="EMPTY_OR_BAD_FEED")

    items: list[NormalizedItem] = []
    drops: dict[str, int] = {}
    for entry in entries[:max_items]:
        link = (entry.get("link") or "").strip()
        title = strip_publisher_suffix(_clean(entry.get("title", ""), limit=200), source)
        if not link or not title:
            drops["no_link_or_title"] = drops.get("no_link_or_title", 0) + 1
            continue
        published_at = _parse_time(entry)
        if published_at is None:
            drops["invalid_time"] = drops.get("invalid_time", 0) + 1
            continue
        items.append(
            NormalizedItem(
                source=sid,
                source_item_id=(entry.get("id") or link).strip(),
                title=title,
                # Google News 的 description 是連結列表雜訊，不當作摘要。
                excerpt="",
                url=link,
                published_at=published_at,
            )
        )

    if not items:
        return SourceResult(
            id=sid, name=name, enabled=True, ok=False, error_code="NO_VALID_ITEMS", drop_reasons=drops
        )
    return SourceResult(id=sid, name=name, enabled=True, ok=True, items=items, drop_reasons=drops)
