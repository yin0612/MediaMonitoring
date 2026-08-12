from datetime import date, datetime, timezone
from pathlib import Path

from opinion_pipeline.archive_backfill import (
    historical_google_news_url,
    load_archive_backfill,
    parse_historical_feed,
)
from opinion_pipeline import cli
from opinion_pipeline.models import NormalizedItem
from scripts.build_archive_backfill import fetch_historical_items


def _item(source: str, item_id: str, published_at: datetime) -> NormalizedItem:
    return NormalizedItem(
        source=source,
        source_item_id=item_id,
        title=item_id,
        excerpt="",
        url=f"https://example.com/{item_id}",
        published_at=published_at,
    )


def test_historical_google_news_url_encodes_exact_day_query():
    url = historical_google_news_url("news.example.com", date(2026, 7, 15))

    assert "site%3Anews.example.com" in url
    assert "after%3A2026-07-15" in url
    assert "before%3A2026-07-16" in url


def test_parse_historical_feed_keeps_only_requested_utc_day():
    raw = b"""<?xml version="1.0" encoding="UTF-8"?>
    <rss><channel>
      <item><guid>keep-1</guid><title>Keep story - Publisher</title>
        <link>https://news.example.com/keep</link>
        <pubDate>Wed, 15 Jul 2026 08:00:00 GMT</pubDate></item>
      <item><guid>drop-1</guid><title>Wrong day</title>
        <link>https://news.example.com/drop</link>
        <pubDate>Thu, 16 Jul 2026 08:00:00 GMT</pubDate></item>
    </channel></rss>"""
    source = {"id": "example", "name": "Publisher", "aliases": [], "domains": ["news.example.com"]}

    items = parse_historical_feed(raw, source, date(2026, 7, 15), max_items=10)

    assert len(items) == 1
    assert items[0].source == "example"
    assert items[0].source_item_id == "keep-1"
    assert items[0].published_at == datetime(2026, 7, 15, 8, tzinfo=timezone.utc)
    assert items[0].title == "Keep story"


def test_load_archive_backfill_reports_metadata_and_skips_invalid_rows(tmp_path: Path):
    path = tmp_path / "archive-backfill.jsonl"
    path.write_text(
        "\n".join(
            [
                '{"_meta":{"retrievedAt":"2026-08-12T10:00:00Z","method":"google-news-rss-historical-query"}}',
                '{"id":"1","source":"cna","title":"A","excerpt":"","publishedAt":"2026-07-15T08:00:00Z","url":"https://example.com/a"}',
                '{"id":"bad","source":"cna","title":"missing url"}',
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    items, meta = load_archive_backfill(path)

    assert len(items) == 1
    assert items[0].source == "cna"
    assert meta["method"] == "google-news-rss-historical-query"
    assert meta["loadedItems"] == 1


def test_load_archive_backfill_missing_file_is_empty(tmp_path: Path):
    items, meta = load_archive_backfill(tmp_path / "missing.jsonl")

    assert items == []
    assert meta == {"loadedItems": 0}


def test_merge_retained_items_includes_allowlisted_historical_backfill():
    now = datetime(2026, 8, 12, 12, tzinfo=timezone.utc)
    current = [_item("cna", "current", now)]
    restored = [_item("cna", "restored", datetime(2026, 8, 1, tzinfo=timezone.utc))]
    backfill = [_item("cna", "backfill", datetime(2026, 7, 15, tzinfo=timezone.utc))]
    disallowed = [_item("unknown", "ignored", datetime(2026, 7, 15, tzinfo=timezone.utc))]

    result = cli.merge_retained_items(current, restored, backfill + disallowed, now, {"cna"})

    assert [entry.source_item_id for entry in result] == ["current", "restored", "backfill"]


def test_fetch_historical_items_uses_public_feed_and_returns_day_filtered_items(monkeypatch):
    raw = b"""<rss><channel><item><guid>one</guid><title>One</title>
      <link>https://news.example.com/one</link>
      <pubDate>Wed, 15 Jul 2026 08:00:00 GMT</pubDate></item></channel></rss>"""
    calls = []

    class Response:
        content = raw

        def raise_for_status(self):
            return None

    def fake_get(url, **kwargs):
        calls.append((url, kwargs))
        return Response()

    monkeypatch.setattr("scripts.build_archive_backfill.requests.get", fake_get)
    source = {"id": "example", "name": "Publisher", "aliases": [], "domains": ["news.example.com"]}

    items = fetch_historical_items(source, date(2026, 7, 15), timeout=9, max_items=3)

    assert len(items) == 1
    assert calls[0][1]["timeout"] == 9
    assert "after%3A2026-07-15" in calls[0][0]
