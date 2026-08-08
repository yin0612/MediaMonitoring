"""GitHub Actions 使用的免費新聞快照產生器。

每次執行：
1. 每個來源依序嘗試官方 RSS → Google News RSS（site:官方網域）→ 到期的官網 metadata 擷取。
2. 與上一版公開快照合併、去重、過濾未來時間，保留 7 天。
3. 從真實 items 重算 keywords.json（監測詞＋自動熱詞）與 entities.json（ORG 詞典共現）。
"""
from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
import yaml

from .analysis import build_entities, build_keywords, load_entity_lexicon, load_watch_config
from .archive import dedupe_items, item_to_public, public_to_item
from .connectors.google_news import fetch_google_news
from .connectors.html_listing import crawl_due, fetch_listing_source
from .connectors.rss import _fetch_bytes, fetch_source
from .sentiment import SentimentLexicon, aggregate, classify, load_sentiment_lexicon
from .connectors.trends import parse_trends_feed
from .models import SourceResult
from .sources import load_sources
from .timeutil import FUTURE_TOLERANCE


SCHEMA_VERSION = "2.1.0"
TRENDS_URL = "https://trends.google.com/trending/rss?geo=TW&hl=zh-TW"

TOPIC_DEFINITIONS = (
    ("finance", "財經與產業", ("台積電", "半導體", "股市", "經濟", "產業")),
    ("weather", "天氣與防災", ("颱風", "豪雨", "氣象", "地震", "防災")),
    ("politics", "政治與公共政策", ("立法院", "立委", "行政院", "總統", "預算", "政黨")),
    ("society", "社會與生活", ("社會", "交通", "醫療", "健康", "教育", "食安")),
    ("world", "國際與兩岸", ("美國", "中國", "國際", "兩岸", "日本", "歐洲")),
    ("entertainment", "娛樂與影視", ("娛樂", "明星", "藝人", "演唱會", "影視", "電影", "金曲", "八卦", "韓流", "劇集", "男星", "女星", "歌王", "歌后", "票房", "追劇", "節目", "主持人", "金馬", "金鐘")),
)


def envelope(data: dict, generated_at: str) -> dict:
    return {"schemaVersion": SCHEMA_VERSION, "generatedAt": generated_at, "data": data}


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def keep_allowed_sources(items: list, source_ids: set[str]) -> list:
    """Avoid restoring publishers that are no longer in the configured allowlist."""
    return [item for item in items if item.source in source_ids]


def prepare_trends_items(items: list[dict]) -> list[dict]:
    """Keep Google Trends related-news metadata separate from the allowlisted-source analysis."""
    return items


# 自動產生的個股行情播報樣板，對主題摘要無資訊價值，優先略過。
_TICKER_NOISE = ("盤中速報", "盤後速報", "近5分K", "三大法人買賣超", "融資融券增減")


def _is_ticker_noise(item) -> bool:
    text = item.search_text
    return any(marker in text for marker in _TICKER_NOISE)


def _topic_breakdown(topic_id: str, terms: tuple[str, ...], matched: list) -> tuple[list[str], list[dict], list[dict]]:
    """把固定大類拆成「日期 × 主要命中詞」事件，並提供每日聲量。

    每篇只歸入一個次事件，避免同一篇在同一大類內被重複計數。主要詞依該大類
    的實際文件命中數排序，再以設定順序作穩定 tie-break。
    """
    term_counts = {
        term: sum(1 for item in matched if term.casefold() in item.search_text.casefold())
        for term in terms
    }
    ranked_terms = sorted(
        (term for term in terms if term_counts[term] > 0),
        key=lambda term: (-term_counts[term], terms.index(term)),
    )
    daily = Counter(
        item.published_at.astimezone(timezone.utc).date().isoformat()
        for item in matched
    )
    timeline = [{"date": date, "mentions": daily[date]} for date in sorted(daily)]

    buckets: dict[tuple[str, str], list] = defaultdict(list)
    for item in matched:
        haystack = item.search_text.casefold()
        anchor = next((term for term in ranked_terms if term.casefold() in haystack), ranked_terms[0])
        date = item.published_at.astimezone(timezone.utc).date().isoformat()
        buckets[(date, anchor)].append(item)

    events = []
    for (date, anchor), event_items in buckets.items():
        event_term_counts = {
            term: sum(1 for item in event_items if term.casefold() in item.search_text.casefold())
            for term in ranked_terms
        }
        event_terms = sorted(
            (term for term in ranked_terms if event_term_counts[term] > 0),
            key=lambda term: (-event_term_counts[term], ranked_terms.index(term)),
        )[:3]
        preferred = [item for item in event_items if not _is_ticker_noise(item)] or event_items
        preferred = sorted(preferred, key=lambda item: item.published_at, reverse=True)
        events.append(
            {
                "id": f"{topic_id}-{date}-{terms.index(anchor) + 1}",
                "date": date,
                "label": anchor,
                "size": len(event_items),
                "terms": event_terms,
                "articles": [
                    {
                        "title": item.title,
                        "source": item.source,
                        "url": item.url,
                        "publishedAt": item.published_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
                    }
                    for item in preferred[:3]
                ],
            }
        )
    events.sort(key=lambda event: (event["date"], event["size"], event["label"]), reverse=True)
    return ranked_terms, timeline, events[:8]


def build_topics(items: list, lexicon: SentimentLexicon | None = None) -> list[dict]:
    """Build transparent keyword groups from real archive metadata only."""
    lexicon = lexicon or SentimentLexicon()
    topics = []
    for topic_id, label, terms in TOPIC_DEFINITIONS:
        matched = [item for item in items if any(term.casefold() in item.search_text.casefold() for term in terms)]
        if not matched:
            continue
        # 摘要與代表內容偏好非樣板新聞；全是樣板時才退回原順序。
        preferred = [item for item in matched if not _is_ticker_noise(item)] or matched
        summaries = []
        for item in preferred:
            text = item.excerpt.strip() or item.title.strip()
            if text:
                summaries.append({"text": text, "source": item.source, "url": item.url})
            if len(summaries) == 2:
                break
        # 逐篇判讀情緒，彙總成主題分布，並保留正／負向代表文章作為依據
        judged = [(item, classify(item.search_text, lexicon)) for item in matched]
        ranked_terms, timeline, events = _topic_breakdown(topic_id, terms, matched)
        evidence: dict[str, list[dict]] = {"positive": [], "negative": []}
        for item, verdict in judged:
            bucket = verdict["label"]
            if bucket in evidence and len(evidence[bucket]) < 3 and verdict["matched"]:
                evidence[bucket].append(
                    {
                        "title": item.title,
                        "source": item.source,
                        "url": item.url,
                        "terms": [entry["term"] for entry in verdict["matched"][:3]],
                    }
                )

        topics.append(
            {
                "id": topic_id,
                "label": label,
                "terms": ranked_terms,
                "size": len(matched),
                "sentiment": aggregate([verdict["label"] for _, verdict in judged]),
                "evidence": evidence,
                "timeline": timeline,
                "events": events,
                "summarySentences": summaries,
                "articles": [
                    {
                        "title": item.title,
                        "source": item.source,
                        "url": item.url,
                        "publishedAt": item.published_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
                    }
                    for item in preferred[:5]
                ],
            }
        )
    return topics


def write_archive_files(
    output_dir: Path,
    items: list,
    generated_at: str,
    *,
    status: str,
    stale: bool,
    lexicon: SentimentLexicon,
) -> None:
    """同時保留完整 archive，並產生日分檔 manifest 供瀏覽器按範圍載入。"""
    public_items = [item_to_public(entry, lexicon) for entry in items]
    write_json(
        output_dir / "news-archive.json",
        envelope({"status": status, "stale": stale, "items": public_items}, generated_at),
    )

    by_day: dict[str, list[dict]] = defaultdict(list)
    for value in public_items:
        by_day[value["publishedAt"][:10]].append(value)
    days = []
    for date in sorted(by_day, reverse=True):
        values = by_day[date]
        name = f"news-archive/{date}"
        write_json(
            output_dir / f"{name}.json",
            envelope({"status": status, "stale": stale, "date": date, "items": values}, generated_at),
        )
        days.append({"date": date, "count": len(values), "file": name})
    write_json(
        output_dir / "news-archive-index.json",
        envelope(
            {
                "status": status,
                "stale": stale,
                "totalItems": len(public_items),
                "days": days,
            },
            generated_at,
        ),
    )


def restore_items(base_url: str) -> list:
    if not base_url:
        return []
    try:
        response = requests.get(f"{base_url.rstrip('/')}/data/news-archive.json", timeout=10)
        response.raise_for_status()
        values = response.json().get("data", {}).get("items", [])
        return [entry for value in values if (entry := public_to_item(value)) is not None]
    except (requests.RequestException, ValueError, TypeError):
        return []


def restore_source_states(base_url: str) -> dict[str, dict]:
    if not base_url:
        return {}
    try:
        response = requests.get(f"{base_url.rstrip('/')}/data/sources.json", timeout=10)
        response.raise_for_status()
        values = response.json().get("data", {}).get("sources", [])
        return {value["id"]: value for value in values if isinstance(value, dict) and value.get("id")}
    except (requests.RequestException, ValueError, TypeError):
        return {}


def collect_source(source: dict, state: dict | None, now: datetime, timeout: int, max_items: int) -> dict:
    """單一來源的完整取得流程；回傳 items、狀態與實際使用的取得方式。"""
    has_rss = bool(source.get("rss_url") or source.get("rss_urls"))
    rss_result = fetch_source(source, timeout, max_items) if has_rss else None
    google_result: SourceResult | None = None
    listing_result: SourceResult | None = None
    crawl_attempted = False
    if rss_result is None or not rss_result.ok:
        google_result = fetch_google_news(source, timeout, max_items)
        crawl = source.get("crawl") or {}
        if crawl.get("enabled") and crawl_due(state.get("lastCrawlAt") if state else None, now):
            crawl_attempted = True
            listing_result = fetch_listing_source(source, timeout, max_items)

    attempts = [result for result in (rss_result, google_result, listing_result) if result is not None]
    ok_attempts = [result for result in attempts if result.ok]
    items = [entry for result in ok_attempts for entry in result.items]
    if rss_result is not None and rss_result.ok:
        access_mode = "official-rss"
    elif google_result is not None and google_result.ok:
        access_mode = "google-news"
    elif listing_result is not None and listing_result.ok:
        access_mode = "site-listing"
    else:
        access_mode = "google-news" if not has_rss else "official-rss"
    drops: dict[str, int] = {}
    for result in attempts:
        for reason, count in result.drop_reasons.items():
            drops[reason] = drops.get(reason, 0) + count
    error_code = None if ok_attempts else next((result.error_code for result in attempts if result.error_code), None)
    return {
        "id": source["id"],
        "name": source["name"],
        "ok": bool(ok_attempts),
        "items": items,
        "accessMode": access_mode,
        "errorCode": error_code,
        "dropped": drops,
        "crawlAttempted": crawl_attempted,
    }


def run(
    config_path: Path,
    output_dir: Path,
    restore_base_url: str = "",
    watch_config_path: Path = Path("config/watch_terms.yml"),
    entities_config_path: Path = Path("config/entities.yml"),
    sentiment_config_path: Path = Path("config/sentiment.yml"),
) -> int:
    now = datetime.now(timezone.utc)
    generated_at = now.isoformat().replace("+00:00", "Z")
    config = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    sources = load_sources(config_path)
    sources_by_id = {source["id"]: source for source in sources}
    fetch_cfg = config.get("fetch", {})
    timeout = int(fetch_cfg.get("timeout_seconds", 10))
    max_items = int(fetch_cfg.get("max_items_per_source", 20))

    restored_states = restore_source_states(restore_base_url)
    runs = [collect_source(source, restored_states.get(source["id"]), now, timeout, max_items) for source in sources]

    current_items = [entry for run_ in runs for entry in run_["items"]]
    restored_items = keep_allowed_sources(restore_items(restore_base_url), set(sources_by_id))
    cutoff = now - timedelta(days=7)
    future_limit = now + FUTURE_TOLERANCE
    items = [
        entry
        for entry in dedupe_items(current_items + restored_items)
        if cutoff <= entry.published_at <= future_limit
    ]
    ok_count = sum(1 for run_ in runs if run_["ok"])
    archive_status = "ok" if ok_count == len(runs) else ("partial" if ok_count else "stale")
    stale = not current_items and bool(restored_items)

    sentiment_lexicon = (
        load_sentiment_lexicon(sentiment_config_path) if sentiment_config_path.exists() else SentimentLexicon()
    )
    write_archive_files(
        output_dir,
        items,
        generated_at,
        status=archive_status,
        stale=stale,
        lexicon=sentiment_lexicon,
    )
    # recent.json 供前端「近期內容」與 Worker cron 補齊非 RSS 來源；取近 24 小時、上限 800 筆。
    day_cut = now - timedelta(hours=24)
    recent_items = [entry for entry in items if entry.published_at >= day_cut][:800]
    write_json(
        output_dir / "recent.json",
        envelope({"items": [item_to_public(entry, sentiment_lexicon) for entry in recent_items]}, generated_at),
    )
    topics = build_topics(items, sentiment_lexicon)
    write_json(
        output_dir / "topics.json",
        envelope({"stale": stale, "experimental": True, "topics": topics}, generated_at),
    )

    keywords = build_keywords(items, load_watch_config(watch_config_path), now, enabled_source_count=len(sources))
    write_json(output_dir / "keywords.json", envelope({"stale": stale, "keywords": keywords}, generated_at))

    day_ago = now - timedelta(hours=24)
    entity_graph = build_entities(
        [entry for entry in items if entry.published_at >= day_ago], load_entity_lexicon(entities_config_path)
    )
    write_json(
        output_dir / "entities.json",
        envelope({"stale": stale, "experimental": True, **entity_graph}, generated_at),
    )

    write_json(
        output_dir / "sources.json",
        envelope(
            {
                "sources": [
                    {
                        "id": run_["id"],
                        "displayName": run_["name"],
                        "status": "ok" if run_["ok"] else "error",
                        "lastAttemptAt": generated_at,
                        "lastSuccessAt": (
                            generated_at if run_["ok"] else restored_states.get(run_["id"], {}).get("lastSuccessAt")
                        ),
                        "lastCrawlAt": (
                            generated_at
                            if run_["crawlAttempted"]
                            else restored_states.get(run_["id"], {}).get("lastCrawlAt")
                        ),
                        "errorCode": run_["errorCode"],
                        "stale": not run_["ok"],
                        "itemCount": sum(1 for item in items if item.source == run_["id"]),
                        "accessMode": run_["accessMode"],
                        "dropped": run_["dropped"],
                    }
                    for run_ in runs
                ]
            },
            generated_at,
        ),
    )

    trends_stale = False
    try:
        trends_items = prepare_trends_items(parse_trends_feed(_fetch_bytes(TRENDS_URL, timeout))[:20])
    except Exception:  # noqa: BLE001 - 趨勢失敗不阻擋新聞部署
        trends_items = []
        previous = output_dir / "trends.json"
        if previous.exists():
            try:
                trends_items = json.loads(previous.read_text(encoding="utf-8"))["data"]["items"]
            except (KeyError, TypeError, ValueError):
                trends_items = []
        trends_stale = True
    write_json(
        output_dir / "trends.json",
        envelope(
            {
                "geo": "TW",
                "status": "stale" if trends_stale else "ok",
                "stale": trends_stale,
                "source": "google-trends-rss",
                "sourceUrl": TRENDS_URL,
                "items": trends_items,
            },
            generated_at,
        ),
    )
    write_json(
        output_dir / "meta.json",
        envelope(
            {
                "status": archive_status,
                "lastFastAt": generated_at if current_items else None,
                "lastDeepAt": generated_at if topics else None,
                "methodVersion": "news-heat-v4-37-sources",
                "scheduleDaysUntilPause": None,
                "coverage": {"keywordWindowHours": 24, "trendBucketMinutes": 60, "archiveDays": 7},
                "stateRestoreFailed": not bool(current_items or restored_items) and bool(restore_base_url),
            },
            generated_at,
        ),
    )
    return 0 if current_items else 2


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="config/sources.yml")
    parser.add_argument("--output", default="web/public/data")
    parser.add_argument("--restore-base-url", default="")
    parser.add_argument("--watch-config", default="config/watch_terms.yml")
    parser.add_argument("--entities-config", default="config/entities.yml")
    args = parser.parse_args()
    return run(
        Path(args.config),
        Path(args.output),
        args.restore_base_url,
        Path(args.watch_config),
        Path(args.entities_config),
    )


if __name__ == "__main__":
    raise SystemExit(main())
