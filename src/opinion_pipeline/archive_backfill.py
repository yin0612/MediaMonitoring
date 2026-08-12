"""可重現的公開歷史新聞 metadata 回填工具。

回填只保存標題、摘要、發布時間、來源與公開連結；Google News wrapper URL
本身不是新聞來源，因此所有資料都會保留 `method` provenance，供前端與審查者辨識。
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import quote

import feedparser

from .archive import public_to_item
from .connectors.google_news import strip_publisher_suffix
from .connectors.rss import _clean, _parse_time
from .models import NormalizedItem


def historical_google_news_url(domain: str, target_day: date) -> str:
    """Build a Google News RSS query bounded to one calendar day."""
    next_day = target_day + timedelta(days=1)
    query = quote(
        f"site:{domain} after:{target_day.isoformat()} before:{next_day.isoformat()}"
    )
    return f"https://news.google.com/rss/search?q={query}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant"


def parse_historical_feed(
    raw: bytes, source: dict, target_day: date, *, max_items: int = 5
) -> list[NormalizedItem]:
    """Parse a bounded feed and keep entries published on the requested UTC day."""
    items: list[NormalizedItem] = []
    for entry in (feedparser.parse(raw).get("entries") or []):
        link = str(entry.get("link") or "").strip()
        title = strip_publisher_suffix(_clean(entry.get("title", ""), limit=200), source)
        published_at = _parse_time(entry)
        if not link or not title or published_at is None or published_at.date() != target_day:
            continue
        items.append(
            NormalizedItem(
                source=str(source["id"]),
                source_item_id=str(entry.get("id") or link).strip(),
                title=title,
                excerpt="",
                url=link,
                published_at=published_at,
            )
        )
        if len(items) >= max_items:
            break
    return items


def load_archive_backfill(path: Path) -> tuple[list[NormalizedItem], dict[str, object]]:
    """Load JSONL backfill rows and return valid items plus computed provenance."""
    if not path.exists():
        return [], {"loadedItems": 0}

    metadata: dict[str, object] = {}
    items: list[NormalizedItem] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict) and isinstance(value.get("_meta"), dict):
            metadata.update(value["_meta"])
            continue
        if isinstance(value, dict):
            item = public_to_item(value)
            if item is not None:
                items.append(item)
    metadata["loadedItems"] = len(items)
    return items, metadata
