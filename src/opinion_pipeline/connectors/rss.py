"""通用 RSS/Atom 連接器。負責擷取、驗證與正規化，單一來源失敗不影響其他來源。"""
from __future__ import annotations

import html
import re
import time
from datetime import datetime, timedelta, timezone

import feedparser
import requests

from ..models import NormalizedItem, SourceResult

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def is_feed_document(parsed: dict) -> bool:
    return not parsed.get("bozo") and bool(parsed.get("version")) and isinstance(parsed.get("feed"), dict)


def _clean(text: str, limit: int = 140) -> str:
    """移除 HTML 標籤、還原字元實體、壓縮空白並截斷（避免重製全文）。"""
    if not text:
        return ""
    text = _TAG_RE.sub("", text)
    text = html.unescape(text)
    text = _WS_RE.sub(" ", text).strip()
    if len(text) > limit:
        text = text[:limit].rstrip() + "…"
    return text


def _parse_time(entry, now: datetime | None = None) -> datetime | None:
    current = now or datetime.now(timezone.utc)
    for key in ("published_parsed", "updated_parsed"):
        tm = entry.get(key)
        if tm:
            published = datetime(*tm[:6], tzinfo=timezone.utc)
            if published > current + timedelta(minutes=5):
                corrected = published - timedelta(hours=8)
                if corrected <= current + timedelta(minutes=5):
                    published = corrected
            return published if published <= current + timedelta(minutes=5) else None
    return None


def _fetch_bytes(url: str, timeout: int) -> bytes:
    """帶重試的 HTTP 擷取。可重試錯誤最多 3 次；429 遵守 Retry-After。"""
    waits = [2, 5, 12]
    last_exc: Exception | None = None
    for attempt in range(len(waits) + 1):
        try:
            resp = requests.get(
                url,
                timeout=timeout,
                headers={"User-Agent": _UA, "Accept": "application/rss+xml, application/xml, text/xml, */*"},
            )
            if resp.status_code == 429:
                retry_after = resp.headers.get("Retry-After")
                wait = int(retry_after) if (retry_after or "").isdigit() else waits[min(attempt, len(waits) - 1)]
                if attempt < len(waits) and wait <= 30:
                    time.sleep(wait)
                    continue
                raise requests.HTTPError("HTTP_429")
            resp.raise_for_status()
            return resp.content
        except Exception as exc:  # noqa: BLE001 - 交由上層記錄來源錯誤
            last_exc = exc
            if attempt < len(waits):
                time.sleep(waits[attempt])
            else:
                raise
    raise last_exc  # pragma: no cover


def _error_code(exc: Exception) -> str:
    if isinstance(exc, requests.HTTPError):
        resp = getattr(exc, "response", None)
        if resp is not None:
            return f"HTTP_{resp.status_code}"
        return str(exc) or "HTTP_ERROR"
    if isinstance(exc, requests.Timeout):
        return "TIMEOUT"
    if isinstance(exc, requests.ConnectionError):
        return "CONN_ERROR"
    return type(exc).__name__


def fetch_source(source: dict, timeout: int, max_items: int) -> SourceResult:
    """擷取單一 RSS 來源並回傳正規化結果。任何例外都被隔離為該來源的錯誤。"""
    sid, name = source["id"], source["name"]
    urls = source.get("rss_urls") or []
    if isinstance(urls, str):
        urls = [urls]
    if not urls:
        single_url = source.get("rss_url") or source.get("url") or ""
        urls = [single_url] if single_url else []
    urls = [url for url in urls if isinstance(url, str) and url]
    enabled = bool(source.get("enabled", bool(urls)))
    if not enabled or not urls:
        return SourceResult(id=sid, name=name, enabled=enabled, ok=False, error_code="DISABLED")

    items: list[NormalizedItem] = []
    drops: dict[str, int] = {}
    errors: list[str] = []
    saw_valid_empty_feed = False
    for url in urls:
        if len(items) >= max_items:
            break
        try:
            raw = _fetch_bytes(url, timeout)
            parsed = feedparser.parse(raw)
            entries = parsed.get("entries") or []
            if not entries:
                if is_feed_document(parsed):
                    saw_valid_empty_feed = True
                else:
                    errors.append("EMPTY_OR_BAD_FEED")
                continue
        except Exception as exc:  # noqa: BLE001
            errors.append(_error_code(exc))
            continue

        for entry in entries[: max_items - len(items)]:
            link = (entry.get("link") or "").strip()
            title = _clean(entry.get("title", ""), limit=200)
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
                    excerpt=_clean(entry.get("summary", ""), limit=140),
                    url=link,
                    published_at=published_at,
                )
            )

    if not items:
        if saw_valid_empty_feed and not drops:
            return SourceResult(id=sid, name=name, enabled=True, ok=True)
        return SourceResult(
            id=sid,
            name=name,
            enabled=True,
            ok=False,
            error_code=errors[0] if errors else "NO_VALID_ITEMS",
            drop_reasons=drops,
        )
    return SourceResult(id=sid, name=name, enabled=True, ok=True, items=items, drop_reasons=drops)
