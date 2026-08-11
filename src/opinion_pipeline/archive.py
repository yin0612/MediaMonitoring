"""新聞快照的去重、篩選與公開 JSON 序列化。"""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from .models import NormalizedItem
from .sentiment import SentimentLexicon, classify
from .timeutil import normalize_published


RANGE_HOURS = {"1h": 1, "6h": 6, "24h": 24, "7d": 24 * 7, "30d": 24 * 30}
_TRACKING_KEYS = {"fbclid", "gclid", "ref", "source"}


def coverage_window(items: list, now: datetime, *, days: int = 30) -> dict[str, object]:
    """Return a truthful archive window instead of equating retention with coverage."""
    timestamps = sorted(
        item.published_at
        for item in items
        if getattr(item, "published_at", None) is not None
        and item.published_at <= now
    )
    actual_from = timestamps[0] if timestamps else None
    actual_to = timestamps[-1] if timestamps else None
    requested_from = now - timedelta(days=days)
    covered_dates = {
        value.date()
        for value in timestamps
        if requested_from <= value <= now
    }
    complete = (
        bool(timestamps)
        and len(covered_dates) >= days
        and actual_from <= requested_from + timedelta(days=1)
        and actual_to >= now - timedelta(days=1)
    )
    iso = lambda value: value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if value else None
    return {
        "actualFrom": iso(actual_from),
        "actualTo": iso(actual_to),
        "coveredDays": len(covered_dates),
        "complete": complete,
    }


def canonical_url(url: str) -> str:
    parts = urlsplit(url.strip())
    query = [
        (key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=True)
        if not key.lower().startswith("utm_") and key.lower() not in _TRACKING_KEYS
    ]
    path = parts.path.rstrip("/") or "/"
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, urlencode(query), ""))


def _title_key(entry: NormalizedItem) -> tuple[str, str]:
    return entry.source, "".join(entry.title.split()).casefold()


def _is_original_url(entry: NormalizedItem) -> bool:
    return "news.google.com" not in entry.url


def dedupe_items(items: list[NormalizedItem]) -> list[NormalizedItem]:
    """兩層去重：先依 canonical URL，再依（來源, 標題）。

    同一篇新聞可能同時出現 Google News 轉址 URL 與原文 URL，
    標題層去重時偏好原文 URL 的版本。
    """
    by_url: dict[str, NormalizedItem] = {}
    for entry in sorted(items, key=lambda value: value.published_at, reverse=True):
        by_url.setdefault(canonical_url(entry.url), entry)

    by_title: dict[tuple[str, str], NormalizedItem] = {}
    for entry in by_url.values():
        key = _title_key(entry)
        kept = by_title.get(key)
        if kept is None or (_is_original_url(entry) and not _is_original_url(kept)):
            by_title[key] = entry
    return sorted(by_title.values(), key=lambda value: value.published_at, reverse=True)


def filter_items(
    items: list[NormalizedItem], query: str, range_name: str, now: datetime | None = None
) -> list[NormalizedItem]:
    now = now or datetime.now(timezone.utc)
    if range_name not in RANGE_HOURS:
        raise ValueError("INVALID_RANGE")
    needle = query.strip().casefold()
    if len(needle) < 2 or len(needle) > 50:
        raise ValueError("INVALID_QUERY")
    cutoff = now - timedelta(hours=RANGE_HOURS[range_name])
    return [
        entry
        for entry in items
        if entry.published_at >= cutoff and needle in entry.search_text.casefold()
    ]


def item_to_public(entry: NormalizedItem, lexicon: SentimentLexicon | None = None) -> dict:
    digest = hashlib.sha256(f"{entry.source}:{entry.source_item_id}".encode("utf-8")).hexdigest()[:20]
    published = entry.published_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return {
        "id": digest,
        "source": entry.source,
        "title": entry.title,
        "excerpt": entry.excerpt[:140] + ("…" if len(entry.excerpt) > 140 else ""),
        "publishedAt": published,
        "url": entry.url,
        # 情緒只在管線端計算一次；matched 保留判讀依據，前端不得另建第二套詞典。
        "sentiment": classify(entry.search_text, lexicon) if lexicon and lexicon.size else None,
    }


def public_to_item(value: dict, now: datetime | None = None) -> NormalizedItem | None:
    """把公開 JSON 還原成內部項目；時間一律交給 timeutil 正規化。

    這裡原本自行複製了一份 5 分鐘／8 小時校正邏輯（與 timeutil、rss 共三份）。
    改為委派後，帶時區的輸入行為完全相同，而缺時區的輸入會依規則視為台北時間，
    不再因為 naive 與 aware 無法比較而被整筆丟棄。
    """
    try:
        published = normalize_published(
            datetime.fromisoformat(str(value["publishedAt"]).replace("Z", "+00:00")), now
        )
        if published is None:
            return None
        return NormalizedItem(
            source=str(value["source"]),
            source_item_id=str(value.get("id") or value["url"]),
            title=str(value["title"]),
            excerpt=str(value.get("excerpt") or "")[:140],
            url=str(value["url"]),
            published_at=published,
        )
    except (KeyError, TypeError, ValueError):
        return None
