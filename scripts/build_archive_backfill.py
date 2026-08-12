"""Fetch reproducible public metadata for missing archive dates."""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from opinion_pipeline.archive import dedupe_items, item_to_public  # noqa: E402
from opinion_pipeline.archive_backfill import (  # noqa: E402
    historical_google_news_url,
    parse_historical_feed,
)
from opinion_pipeline.sources import load_sources  # noqa: E402


USER_AGENT = "MediaMonitoring/1.0 public-archive-backfill"


def fetch_historical_items(
    source: dict, target_day: date, *, timeout: int = 15, max_items: int = 5
):
    """Fetch one source/day from Google News RSS, retaining only exact UTC dates."""
    domain = (source.get("domains") or [""])[0]
    if not domain:
        return []
    response = requests.get(
        historical_google_news_url(domain, target_day),
        headers={"User-Agent": USER_AGENT},
        timeout=timeout,
    )
    response.raise_for_status()
    return parse_historical_feed(response.content, source, target_day, max_items=max_items)


def _date_range(start: date, end: date) -> list[date]:
    if end < start:
        raise ValueError("END_DATE_BEFORE_START_DATE")
    return [start + timedelta(days=offset) for offset in range((end - start).days + 1)]


def build_backfill(sources: list[dict], dates: list[date], *, timeout: int, max_items: int):
    collected = []
    failures = []
    for source in sources:
        for target_day in dates:
            try:
                collected.extend(
                    fetch_historical_items(source, target_day, timeout=timeout, max_items=max_items)
                )
            except requests.RequestException as exc:
                failures.append({"source": source["id"], "date": target_day.isoformat(), "error": str(exc)})
    return dedupe_items(collected), failures


def write_backfill(
    output: Path,
    items: list,
    *,
    dates: list[date],
    source_ids: list[str],
    failures: list[dict],
) -> None:
    retrieved_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    metadata = {
        "schemaVersion": "1.0",
        "retrievedAt": retrieved_at,
        "method": "google-news-rss-historical-query",
        "provenance": "public metadata only; Google News wrapper URLs retained",
        "dates": [value.isoformat() for value in dates],
        "sourceIds": source_ids,
        "itemCount": len(items),
        "failedQueries": failures,
    }
    rows = [json.dumps({"_meta": metadata}, ensure_ascii=False)]
    rows.extend(json.dumps(item_to_public(item), ensure_ascii=False) for item in items)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(rows) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="config/sources.yml")
    parser.add_argument("--output", default="config/archive_backfill.jsonl")
    parser.add_argument("--from-date", required=True, type=date.fromisoformat)
    parser.add_argument("--to-date", required=True, type=date.fromisoformat)
    parser.add_argument("--source-id", action="append", dest="source_ids")
    parser.add_argument("--timeout", type=int, default=15)
    parser.add_argument("--max-items-per-source-day", type=int, default=5)
    args = parser.parse_args()

    sources = load_sources(Path(args.config))
    selected = set(args.source_ids or [])
    if selected:
        unknown = selected - {source["id"] for source in sources}
        if unknown:
            parser.error(f"UNKNOWN_SOURCE_ID:{','.join(sorted(unknown))}")
        sources = [source for source in sources if source["id"] in selected]
    dates = _date_range(args.from_date, args.to_date)
    items, failures = build_backfill(
        sources,
        dates,
        timeout=args.timeout,
        max_items=args.max_items_per_source_day,
    )
    write_backfill(
        Path(args.output),
        items,
        dates=dates,
        source_ids=[source["id"] for source in sources],
        failures=failures,
    )
    print(json.dumps({"items": len(items), "failedQueries": len(failures)}, ensure_ascii=False))
    return 0 if items else 2


if __name__ == "__main__":
    raise SystemExit(main())
