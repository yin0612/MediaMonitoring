from __future__ import annotations

import html
import json
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urljoin
from urllib.robotparser import RobotFileParser

import requests

from ..models import NormalizedItem, SourceResult
from ..timeutil import normalize_published


CRAWL_INTERVAL = timedelta(hours=6)
_JSON_LD_RE = re.compile(
    r"<script[^>]+type=[\"']application/ld\+json[\"'][^>]*>([\s\S]*?)</script>",
    re.IGNORECASE,
)
_ARTICLE_TYPES = {"Article", "NewsArticle", "ReportageNewsArticle"}
_USER_AGENT = "MediaMonitoringDemo/1.0 (+https://chunyu8866.github.io/MediaMonitoringDB/)"
_ANCHOR_RE = re.compile(r"<a\b[^>]*href=[\"']([^\"']+)[\"'][^>]*>([\s\S]*?)</a>", re.IGNORECASE)


def crawl_due(last_crawl_at: datetime | str | None, now: datetime) -> bool:
    if last_crawl_at is None:
        return True
    if isinstance(last_crawl_at, str):
        try:
            last_crawl_at = datetime.fromisoformat(last_crawl_at.replace("Z", "+00:00"))
        except ValueError:
            return True
    return now - last_crawl_at >= CRAWL_INTERVAL


def robots_allowed(robots_text: str, page_url: str, user_agent: str) -> bool:
    parser = RobotFileParser()
    parser.set_url(urljoin(page_url, "/robots.txt"))
    parser.parse(robots_text.splitlines())
    return parser.can_fetch(user_agent, page_url)


def _walk(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk(child)


def _published_at(value: str) -> datetime | None:
    """台灣新聞網站的 JSON-LD/meta 時間若缺時區，一律視為台北時間，避免 +8 小時的未來偏移。"""
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        return None
    return normalize_published(parsed)


def parse_listing_html(raw: bytes, source_id: str, base_url: str) -> list[NormalizedItem]:
    document = raw.decode("utf-8", errors="replace")
    items: list[NormalizedItem] = []
    seen: set[str] = set()
    for block in _JSON_LD_RE.findall(document):
        try:
            payload = json.loads(html.unescape(block.strip()))
        except (json.JSONDecodeError, TypeError):
            continue
        for entry in _walk(payload):
            raw_type = entry.get("@type")
            types = set(raw_type if isinstance(raw_type, list) else [raw_type])
            if not types.intersection(_ARTICLE_TYPES):
                continue
            title = str(entry.get("headline") or entry.get("name") or "").strip()
            raw_url = entry.get("url") or entry.get("mainEntityOfPage")
            if isinstance(raw_url, dict):
                raw_url = raw_url.get("@id") or raw_url.get("url")
            url = urljoin(base_url, str(raw_url or "").strip())
            published = _published_at(str(entry.get("datePublished") or entry.get("dateModified") or ""))
            if not title or not url.startswith("http") or not published or url in seen:
                continue
            seen.add(url)
            description = re.sub(r"\s+", " ", str(entry.get("description") or "")).strip()[:140]
            items.append(
                NormalizedItem(
                    source=source_id,
                    source_item_id=url,
                    title=title[:200],
                    excerpt=description,
                    url=url,
                    published_at=published.astimezone(timezone.utc),
                )
            )
    return items


def discover_listing_links(raw: bytes, base_url: str, pattern: str, limit: int = 8) -> list[tuple[str, str]]:
    document = raw.decode("utf-8", errors="replace")
    matcher = re.compile(pattern, re.IGNORECASE)
    links: list[tuple[str, str]] = []
    seen: set[str] = set()
    for href, inner in _ANCHOR_RE.findall(document):
        url = urljoin(base_url, html.unescape(href))
        title = re.sub(r"<[^>]+>", " ", inner)
        title = re.sub(r"\s+", " ", html.unescape(title)).strip()
        if not matcher.search(url) or url in seen or len(title) < 6:
            continue
        seen.add(url)
        links.append((url, title[:200]))
        if len(links) >= limit:
            break
    return links


def _meta_content(document: str, key: str) -> str:
    escaped = re.escape(key)
    patterns = (
        rf"<meta[^>]+(?:property|name)=[\"']{escaped}[\"'][^>]+content=[\"']([^\"']+)[\"']",
        rf"<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+(?:property|name)=[\"']{escaped}[\"']",
    )
    for pattern in patterns:
        match = re.search(pattern, document, re.IGNORECASE)
        if match:
            return html.unescape(match.group(1)).strip()
    return ""


def parse_article_html(raw: bytes, source_id: str, article_url: str, fallback_title: str = "") -> NormalizedItem | None:
    structured = parse_listing_html(raw, source_id, article_url)
    if structured:
        return structured[0]
    document = raw.decode("utf-8", errors="replace")
    title = _meta_content(document, "og:title") or fallback_title
    description = _meta_content(document, "og:description") or _meta_content(document, "description")
    published = (
        _meta_content(document, "article:published_time")
        or _meta_content(document, "pubdate")
        or _meta_content(document, "publishdate")
    )
    published_at = _published_at(published)
    url = _meta_content(document, "og:url") or article_url
    if not published_at:
        url_date = re.search(r"/(20\d{2}-\d{2}-\d{2})/", url)
        if url_date:
            # 只有日期精度：以 UTC 午夜表示，維持 .date() 穩定；normalize 只負責擋未來日期。
            published_at = normalize_published(datetime.fromisoformat(url_date.group(1)).replace(tzinfo=timezone.utc))
    if not title or not published_at or not url.startswith("http"):
        return None
    return NormalizedItem(
        source=source_id,
        source_item_id=url,
        title=re.sub(r"\s+", " ", title).strip()[:200],
        excerpt=re.sub(r"\s+", " ", description).strip()[:140],
        url=url,
        published_at=published_at.astimezone(timezone.utc),
    )


def fetch_listing_source(source: dict, timeout: int, max_items: int) -> SourceResult:
    source_id, name = source["id"], source["name"]
    crawl = source.get("crawl") or {}
    page_url = str(crawl.get("url") or "")
    if not crawl.get("enabled") or not page_url:
        return SourceResult(id=source_id, name=name, enabled=False, ok=False, error_code="DISABLED")

    headers = {"User-Agent": _USER_AGENT, "Accept": "text/html,application/xhtml+xml"}
    robots_url = urljoin(page_url, "/robots.txt")
    try:
        robots_response = requests.get(robots_url, timeout=timeout, headers=headers)
        if robots_response.status_code < 400 and not robots_allowed(robots_response.text, page_url, _USER_AGENT):
            return SourceResult(id=source_id, name=name, enabled=True, ok=False, error_code="ROBOTS_DISALLOWED")
        if robots_response.status_code in {401, 403}:
            return SourceResult(id=source_id, name=name, enabled=True, ok=False, error_code="ROBOTS_UNAVAILABLE")
        response = requests.get(page_url, timeout=timeout, headers=headers)
        response.raise_for_status()
    except requests.Timeout:
        return SourceResult(id=source_id, name=name, enabled=True, ok=False, error_code="TIMEOUT")
    except requests.RequestException as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        code = f"HTTP_{status}" if status else "CONN_ERROR"
        return SourceResult(id=source_id, name=name, enabled=True, ok=False, error_code=code)

    items = parse_listing_html(response.content, source_id, page_url)[:max_items]
    pattern = str(crawl.get("article_url_pattern") or "")
    if not items and pattern:
        for article_url, fallback_title in discover_listing_links(response.content, page_url, pattern, min(max_items, 8)):
            if robots_response.status_code < 400 and not robots_allowed(robots_response.text, article_url, _USER_AGENT):
                continue
            try:
                article_response = requests.get(article_url, timeout=timeout, headers=headers)
                article_response.raise_for_status()
            except requests.RequestException:
                continue
            item = parse_article_html(article_response.content, source_id, article_url, fallback_title)
            if item:
                items.append(item)
    if not items:
        return SourceResult(id=source_id, name=name, enabled=True, ok=False, error_code="NO_STRUCTURED_ARTICLES")
    return SourceResult(id=source_id, name=name, enabled=True, ok=True, items=items)
