"""GitHub Actions 使用的免費新聞快照產生器。

每次執行：
1. 每個來源依序嘗試官方 RSS → Google News RSS（site:官方網域）→ 到期的官網 metadata 擷取。
2. 與上一版公開快照合併、去重、過濾未來時間，保留 7 天。
3. 從真實 items 重算 keywords.json（監測詞＋自動熱詞）與 entities.json（ORG 詞典共現）。
"""
from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
import yaml
from time import monotonic

from .analysis import build_entities, build_keywords, cluster_events, load_entity_lexicon, load_watch_config
from .archive import coverage_window, dedupe_items, item_to_public, public_to_item
from .connectors.google_news import fetch_google_news
from .connectors.html_listing import crawl_due, fetch_listing_source
from .connectors.rss import _fetch_bytes, fetch_source
from .sentiment import SentimentLexicon, aggregate, build_target_stances, classify, load_sentiment_lexicon
from .connectors.trends import fetch_realtime_web_trends, parse_trends_feed
from .models import SourceResult
from .quality import assess_source_quality
from .sources import load_sources
from .timeutil import FUTURE_TOLERANCE


SCHEMA_VERSION = "2.1.0"
TRENDS_URL = "https://trends.google.com/trending/rss?geo=TW&hl=zh-TW"
FAST_SCHEDULE_MINUTES = 5
DEEP_SCHEDULE_MINUTES = 15
RECENT_ITEMS_CAP = 800

TOPIC_DEFINITIONS = (
    ("finance", "財經與產業", ("台積電", "半導體", "股市", "經濟", "產業")),
    ("weather", "天氣與防災", ("颱風", "豪雨", "氣象", "地震", "防災")),
    ("politics", "政治與公共政策", ("立法院", "立委", "行政院", "總統", "預算", "政黨")),
    ("society", "社會與生活", ("社會", "交通", "醫療", "健康", "教育", "食安")),
    ("world", "國際與兩岸", ("美國", "中國", "國際", "兩岸", "日本", "歐洲")),
    ("entertainment", "娛樂與影視", ("娛樂", "明星", "藝人", "演唱會", "影視", "電影", "金曲", "八卦", "韓流", "劇集", "男星", "女星", "歌王", "歌后", "票房", "追劇", "節目", "主持人", "金馬", "金鐘")),
)


def envelope(data: dict, generated_at: str) -> dict:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": generated_at,
        "pipeline": "deep-github",
        "window": {"actualFrom": None, "actualTo": generated_at},
        "quality": {"status": data.get("status", "experimental")},
        "provenance": {"method": "public-metadata-only", "reproducible": True},
        "data": data,
    }


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
        source_counts = Counter(item.source for item in event_items)
        source_timeline: dict[str, list[dict]] = {}
        for source in sorted(source_counts):
            by_source_day = Counter(
                item.published_at.astimezone(timezone.utc).date().isoformat()
                for item in event_items
                if item.source == source
            )
            source_timeline[source] = [
                {"date": source_date, "mentions": by_source_day[source_date]}
                for source_date in sorted(by_source_day)
            ]
        source_concentration = round(
            sum((count / len(event_items)) ** 2 for count in source_counts.values()),
            3,
        )
        events.append(
            {
                "id": f"{topic_id}-{date}-{terms.index(anchor) + 1}",
                "date": date,
                "label": anchor,
                "size": len(event_items),
                "terms": event_terms,
                "sourceCounts": dict(sorted(source_counts.items())),
                "sourceConcentration": source_concentration,
                "sourceTimeline": source_timeline,
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


def build_topics(
    items: list,
    lexicon: SentimentLexicon | None = None,
    entity_lexicon: list[dict] | None = None,
) -> list[dict]:
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

        topic = {
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
        if entity_lexicon is not None:
            topic["targetStances"] = build_target_stances(matched, entity_lexicon, lexicon)
        topics.append(topic)
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
    retention_days = 30
    reference_time = datetime.fromisoformat(generated_at.replace("Z", "+00:00"))
    cutoff = reference_time - timedelta(days=retention_days)
    retained_items = [entry for entry in items if cutoff <= entry.published_at <= reference_time + FUTURE_TOLERANCE]
    public_items = [item_to_public(entry, lexicon) for entry in retained_items]
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
    archive_dir = output_dir / "news-archive"
    retained_files = {f"{date}.json" for date in by_day}
    if archive_dir.exists():
        for path in archive_dir.glob("????-??-??.json"):
            if path.name not in retained_files:
                path.unlink()
    write_json(
        output_dir / "news-archive-index.json",
        envelope(
            {
                "status": status,
                "stale": stale,
                "totalItems": len(public_items),
                "retentionDays": retention_days,
                "days": days,
                **coverage_window(retained_items, reference_time, days=retention_days),
            },
            generated_at,
        ),
    )


def restore_items(base_url: str) -> list:
    if not base_url:
        return []
    base = base_url.rstrip("/")

    def fetch_values(url: str) -> list[dict]:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        payload = response.json()
        values = payload.get("data", {}).get("items", []) if isinstance(payload, dict) else []
        return values if isinstance(values, list) else []

    # Prefer the manifest's daily chunks so a large archive is not silently
    # reduced to the legacy compatibility file on every scheduled rebuild.
    try:
        index_response = requests.get(f"{base}/data/news-archive-index.json", timeout=10)
        index_response.raise_for_status()
        index_payload = index_response.json()
        days = index_payload.get("data", {}).get("days", []) if isinstance(index_payload, dict) else []
        values: list[dict] = []
        for day in days if isinstance(days, list) else []:
            file_name = day.get("file") if isinstance(day, dict) else None
            if not isinstance(file_name, str) or not re.fullmatch(r"news-archive/\d{4}-\d{2}-\d{2}", file_name):
                continue
            try:
                values.extend(fetch_values(f"{base}/data/{file_name}.json"))
            except (requests.RequestException, ValueError, TypeError):
                continue
        restored = [entry for value in values if (entry := public_to_item(value)) is not None]
        if restored:
            return restored
    except (requests.RequestException, ValueError, TypeError):
        pass

    # Keep compatibility with older deployments that publish only this file.
    try:
        values = fetch_values(f"{base}/data/news-archive.json")
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
    started_at = monotonic()
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
        "latencyMs": round((monotonic() - started_at) * 1000),
    }


# 抓取全是網路等待，不吃 CPU，所以用執行緒池併發。
# 序列版本的最壞情況：單一 URL 逾時 20 秒 × 4 次重試再加 2/5/12 秒退避 ≈ 99 秒，
# 每家來源最多還會依序試官方 RSS → Google News → 官網爬取三條路徑，
# 37 家跑完可超過 20 分鐘，遠高於 5 分鐘的排程間隔，導致排程互相堆積。
# 併發數刻意保守：失敗來源會集中回退到同一個 news.google.com，
# 併發過高只會換來 429 與更多重試。
MAX_FETCH_WORKERS = 6


def collect_sources(
    sources: list[dict],
    restored_states: dict[str, dict],
    now: datetime,
    timeout: int,
    max_items: int,
) -> list[dict]:
    """併發取得所有來源，並保持與 `sources` 相同的輸出順序。

    順序必須穩定，否則 sources.json 每輪的來源排列都會變動。
    """
    if not sources:
        return []
    with ThreadPoolExecutor(max_workers=min(MAX_FETCH_WORKERS, len(sources))) as pool:
        # ThreadPoolExecutor.map 依輸入順序回傳結果，與序列版本一致。
        return list(
            pool.map(
                lambda source: collect_source(
                    source, restored_states.get(source["id"]), now, timeout, max_items
                ),
                sources,
            )
        )


def source_status_record(
    run_: dict,
    now: datetime,
    generated_at: str,
    restored_state: dict | None = None,
) -> dict:
    """Build quality evidence only from this fetch run's declared 24-hour window."""
    window_start = now - timedelta(hours=24)
    window_items = [
        item for item in run_["items"]
        if item.source == run_["id"] and item.published_at >= window_start
    ]
    restored_state = restored_state or {}
    return {
        "id": run_["id"],
        "displayName": run_["name"],
        **assess_source_quality(
            run_["ok"], window_items, run_["accessMode"], now, latency_ms=run_["latencyMs"]
        ),
        "lastAttemptAt": generated_at,
        "lastSuccessAt": generated_at if run_["ok"] else restored_state.get("lastSuccessAt"),
        "lastCrawlAt": generated_at if run_["crawlAttempted"] else restored_state.get("lastCrawlAt"),
        "errorCode": run_["errorCode"],
        "stale": not run_["ok"],
        "itemCount": len(window_items),
        "accessMode": run_["accessMode"],
        "dropped": run_["dropped"],
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
    runs = collect_sources(sources, restored_states, now, timeout, max_items)

    current_items = [entry for run_ in runs for entry in run_["items"]]
    restored_items = keep_allowed_sources(restore_items(restore_base_url), set(sources_by_id))
    cutoff = now - timedelta(days=30)
    future_limit = now + FUTURE_TOLERANCE
    items = [
        entry
        for entry in dedupe_items(current_items + restored_items)
        if cutoff <= entry.published_at <= future_limit
    ]
    archive_coverage = coverage_window(items, now, days=30)
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
    recent_items = [entry for entry in items if entry.published_at >= day_cut][:RECENT_ITEMS_CAP]
    write_json(
        output_dir / "recent.json",
        envelope({"items": [item_to_public(entry, sentiment_lexicon) for entry in recent_items]}, generated_at),
    )
    entity_lexicon = load_entity_lexicon(entities_config_path)
    topics = build_topics(items, sentiment_lexicon, entity_lexicon)
    write_json(
        output_dir / "topics.json",
        envelope({"stale": stale, "experimental": True, "topics": topics}, generated_at),
    )
    event_cutoff = now - timedelta(days=7)
    events = cluster_events([entry for entry in items if entry.published_at >= event_cutoff])
    write_json(
        output_dir / "events.json",
        envelope(
            {
                "stale": stale,
                "experimental": True,
                "method": "title-3gram-jaccard-v1",
                "events": events[:100],
            },
            generated_at,
        ),
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
                    source_status_record(
                        run_, now, generated_at, restored_states.get(run_["id"])
                    )
                    for run_ in runs
                ]
            },
            generated_at,
        ),
    )

    trends_stale = False
    try:
        realtime_items = fetch_realtime_web_trends("TW", timeout)
        rss_items = parse_trends_feed(_fetch_bytes(TRENDS_URL, timeout))
        for item in realtime_items:
            item["isRealtime"] = True
        for item in rss_items:
            item["isRealtime"] = False
        merged = realtime_items[:15] + rss_items[:15]
        trends_items = prepare_trends_items(merged)
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
                "source": "google-trends-realtime-and-rss",
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
                # 前端會把這個字串解析成「算法 v4 · N 家媒體」顯示給使用者，
                # 所以數量必須由實際來源清單推導，不能寫死。
                "methodVersion": f"news-heat-v4-{len(sources)}-sources",
                "scheduleDaysUntilPause": None,
                "coverage": {
                    "keywordWindowHours": 24,
                    "trendBucketMinutes": 60,
                    "fastScheduleMinutes": FAST_SCHEDULE_MINUTES,
                    "deepScheduleMinutes": DEEP_SCHEDULE_MINUTES,
                    "archiveDays": 30,
                    "recentCap": RECENT_ITEMS_CAP,
                    "sourceCount": len(sources),
                    **archive_coverage,
                },
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
