from datetime import datetime, timedelta, timezone
from pathlib import Path

from opinion_pipeline.archive import coverage_window, dedupe_items, filter_items, item_to_public, public_to_item
from opinion_pipeline import cli
from opinion_pipeline.connectors.trends import parse_trends_feed
from opinion_pipeline.connectors import rss
from opinion_pipeline.models import NormalizedItem
from opinion_pipeline.sentiment import load_sentiment_lexicon


NOW = datetime(2026, 7, 22, 12, 0, tzinfo=timezone.utc)


def item(source: str, item_id: str, title: str, age_hours: int, url: str | None = None) -> NormalizedItem:
    return NormalizedItem(
        source=source,
        source_item_id=item_id,
        title=title,
        excerpt="短摘要",
        url=url or f"https://example.com/{item_id}",
        published_at=NOW - timedelta(hours=age_hours),
    )


def test_dedupe_prefers_newer_item_with_same_canonical_url():
    old = item("cna", "old", "舊標題", 5, "https://example.com/story?utm_source=rss")
    new = item("ltn", "new", "新標題", 1, "https://example.com/story")

    result = dedupe_items([old, new])

    assert len(result) == 1
    assert result[0].title == "新標題"


def test_filter_items_matches_title_or_excerpt_and_enforces_range():
    recent = item("cna", "1", "台積電法說會", 2)
    old = item("ltn", "2", "台積電歷史回顧", 30)
    unrelated = item("tvbs", "3", "氣象快訊", 1)

    result = filter_items([recent, old, unrelated], "台積電", "24h", NOW)

    assert [entry.source_item_id for entry in result] == ["1"]


def test_coverage_window_reports_actual_dates_and_requires_full_retention():
    values = [item("cna", "old", "old", 29 * 24), item("ltn", "new", "new", 1)]

    result = coverage_window(values, NOW, days=30)

    assert result["actualFrom"] == (NOW - timedelta(days=29)).isoformat().replace("+00:00", "Z")
    assert result["actualTo"] == (NOW - timedelta(hours=1)).isoformat().replace("+00:00", "Z")
    assert result["complete"] is True


def test_coverage_window_marks_short_archive_incomplete():
    result = coverage_window([item("cna", "new", "new", 3 * 24)], NOW, days=30)

    assert result["complete"] is False


def test_public_item_never_contains_full_content_field():
    public = item_to_public(item("cna", "1", "測試新聞", 1))

    assert set(public) == {"id", "source", "title", "excerpt", "publishedAt", "url", "sentiment"}
    assert len(public["excerpt"]) <= 141


def test_public_item_carries_pipeline_sentiment_with_traceable_matches():
    lexicon = load_sentiment_lexicon(Path("config/sentiment.yml"))
    public = item_to_public(item("cna", "1", "台股創新高", 1), lexicon)

    assert public["sentiment"]["label"] == "positive"
    assert public["sentiment"]["score"] > 0
    assert public["sentiment"]["matched"]


def test_archive_is_written_as_daily_chunks_with_a_manifest(tmp_path):
    lexicon = load_sentiment_lexicon(Path("config/sentiment.yml"))
    items = [
        item("cna", "1", "台股創新高", 1),
        item("ltn", "2", "颱風警報", 25),
    ]

    cli.write_archive_files(
        tmp_path,
        items,
        "2026-07-22T12:00:00Z",
        status="ok",
        stale=False,
        lexicon=lexicon,
    )

    manifest = __import__("json").loads((tmp_path / "news-archive-index.json").read_text(encoding="utf-8"))
    assert manifest["data"]["totalItems"] == 2
    assert [day["date"] for day in manifest["data"]["days"]] == ["2026-07-22", "2026-07-21"]
    assert (tmp_path / "news-archive" / "2026-07-22.json").exists()
    newest = __import__("json").loads(
        (tmp_path / "news-archive" / "2026-07-22.json").read_text(encoding="utf-8")
    )
    assert newest["data"]["items"][0]["sentiment"]["label"] == "positive"


def test_archive_keeps_30_days_and_removes_only_expired_daily_chunks(tmp_path):
    lexicon = load_sentiment_lexicon(Path("config/sentiment.yml"))
    archive_dir = tmp_path / "news-archive"
    archive_dir.mkdir()
    (archive_dir / "2026-06-01.json").write_text("{}", encoding="utf-8")
    (archive_dir / "README.txt").write_text("preserve", encoding="utf-8")
    items = [
        item("cna", "recent", "recent", 29 * 24),
        item("ltn", "expired", "expired", 31 * 24),
    ]

    cli.write_archive_files(
        tmp_path,
        items,
        "2026-07-22T12:00:00Z",
        status="ok",
        stale=False,
        lexicon=lexicon,
    )

    manifest = __import__("json").loads((tmp_path / "news-archive-index.json").read_text(encoding="utf-8"))
    assert manifest["data"]["retentionDays"] == 30
    assert manifest["data"]["totalItems"] == 1
    assert (archive_dir / "2026-06-23.json").exists()
    assert not (archive_dir / "2026-06-01.json").exists()
    assert (archive_dir / "README.txt").read_text(encoding="utf-8") == "preserve"


def test_rss_time_parser_does_not_invent_the_current_time():
    assert rss._parse_time({}) is None


def test_rss_time_parser_corrects_plausible_taiwan_time_mislabeled_as_utc():
    entry = {"published_parsed": (2026, 7, 22, 21, 43, 0, 0, 0, 0)}
    now = datetime(2026, 7, 22, 15, 0, tzinfo=timezone.utc)
    assert rss._parse_time(entry, now) == datetime(2026, 7, 22, 13, 43, tzinfo=timezone.utc)


def test_restored_snapshot_corrects_plausible_taiwan_time_mislabeled_as_utc():
    value = {
        "id": "old",
        "source": "setn",
        "title": "委內瑞拉雙震",
        "url": "https://example.com/story",
        "publishedAt": "2026-07-22T21:43:00Z",
    }
    now = datetime(2026, 7, 22, 15, 0, tzinfo=timezone.utc)
    restored = public_to_item(value, now)
    assert restored is not None
    assert restored.published_at == datetime(2026, 7, 22, 13, 43, tzinfo=timezone.utc)


def test_parse_google_trends_tw_rss():
    raw = Path("tests/fixtures/google_trends_tw.xml").read_bytes()

    items = parse_trends_feed(raw)

    assert items[0]["title"] == "台灣颱風"
    assert items[0]["approximateTraffic"] == "20,000+"
    assert items[0]["news"][0]["source"] == "中央社"
    assert items[0]["news"][0]["url"] == "https://example.com/news/1"


def test_google_trends_removes_spaces_inserted_between_chinese_characters():
    raw = b'''<rss xmlns:ht="https://trends.google.com/trending/rss"><channel><item>
      <title>&#31461;&#23376; &#36066;</title><ht:approx_traffic>200+</ht:approx_traffic>
      <pubDate>Wed, 22 Jul 2026 08:00:00 GMT</pubDate>
    </item></channel></rss>'''

    assert parse_trends_feed(raw)[0]["title"] == "童子賢"


def test_trends_related_news_is_preserved_even_outside_requested_publishers():
    items = [{"title": "熱門", "news": [
        {"title": "保留", "url": "https://news.tvbs.com.tw/politics/1"},
        {"title": "移除", "url": "https://example.com/news/2"},
    ]}]

    filtered = cli.prepare_trends_items(items)

    assert len(filtered[0]["news"]) == 2


def test_one_rss_failure_is_returned_as_source_error(monkeypatch):
    def fail(*_args, **_kwargs):
        raise rss.requests.Timeout("timeout")

    monkeypatch.setattr(rss, "_fetch_bytes", fail)
    result = rss.fetch_source(
        {"id": "cna", "name": "中央通訊社", "enabled": True, "url": "https://example.com/rss"},
        timeout=1,
        max_items=20,
    )

    assert result.ok is False
    assert result.error_code == "TIMEOUT"
    assert result.items == []


def test_rss_source_accepts_the_shared_registry_rss_url(monkeypatch):
    raw = """<?xml version="1.0"?><rss><channel><item>
      <guid>story-1</guid><title>台積電新聞</title>
      <link>https://example.com/story-1</link>
      <pubDate>Wed, 22 Jul 2026 08:00:00 GMT</pubDate>
    </item></channel></rss>""".encode("utf-8")
    monkeypatch.setattr(rss, "_fetch_bytes", lambda *_args, **_kwargs: raw)

    result = rss.fetch_source(
        {"id": "cna", "name": "中央社", "rss_url": "https://example.com/rss"},
        timeout=1,
        max_items=20,
    )

    assert result.enabled is True
    assert result.ok is True
    assert result.items[0].title == "台積電新聞"


def test_rss_source_merges_multiple_official_feeds_for_one_publisher(monkeypatch):
    def feed(url):
        title = "政治快訊" if url.endswith("politics") else "地方快訊"
        return f"""<?xml version="1.0"?><rss><channel><item>
          <guid>{title}</guid><title>{title}</title>
          <link>https://cna.com.tw/{title}</link>
          <pubDate>Wed, 22 Jul 2026 08:00:00 GMT</pubDate>
        </item></channel></rss>""".encode("utf-8")

    monkeypatch.setattr(rss, "_fetch_bytes", lambda url, *_args, **_kwargs: feed(url))
    result = rss.fetch_source(
        {
            "id": "cna",
            "name": "中央社",
            "rss_urls": ["https://feeds.example/politics", "https://feeds.example/local"],
        },
        timeout=1,
        max_items=20,
    )

    assert result.ok is True
    assert {item.title for item in result.items} == {"政治快訊", "地方快訊"}


def test_restore_items_returns_empty_list_when_snapshot_is_unavailable(monkeypatch):
    monkeypatch.setattr(cli.requests, "get", lambda *_args, **_kwargs: (_ for _ in ()).throw(cli.requests.ConnectionError()))

    assert cli.restore_items("https://pages.example") == []


def test_restore_items_loads_manifest_daily_chunks_before_compat_snapshot(monkeypatch):
    values = {
        "https://pages.example/data/news-archive-index.json": {
            "data": {
                "days": [
                    {"file": "news-archive/2026-07-22"},
                    {"file": "news-archive/2026-07-21"},
                ]
            }
        },
        "https://pages.example/data/news-archive/2026-07-22.json": {
            "data": {"items": [{"id": "new", "source": "cna", "title": "new", "url": "https://example.com/new", "publishedAt": "2026-07-22T08:00:00Z"}]}
        },
        "https://pages.example/data/news-archive/2026-07-21.json": {
            "data": {"items": [{"id": "old", "source": "ltn", "title": "old", "url": "https://example.com/old", "publishedAt": "2026-07-21T08:00:00Z"}]}
        },
    }

    class Response:
        def __init__(self, payload):
            self.payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self.payload

    calls = []

    def fake_get(url, **_kwargs):
        calls.append(url)
        if url not in values:
            raise AssertionError(f"unexpected restore URL: {url}")
        return Response(values[url])

    monkeypatch.setattr(cli.requests, "get", fake_get)

    restored = cli.restore_items("https://pages.example")

    assert {entry.source_item_id for entry in restored} == {"new", "old"}
    assert calls == [
        "https://pages.example/data/news-archive-index.json",
        "https://pages.example/data/news-archive/2026-07-22.json",
        "https://pages.example/data/news-archive/2026-07-21.json",
    ]


def test_restore_items_falls_back_to_compat_snapshot_when_manifest_is_unavailable(monkeypatch):
    compat_url = "https://pages.example/data/news-archive.json"

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {"data": {"items": [{"id": "compat", "source": "cna", "title": "compat", "url": "https://example.com/compat", "publishedAt": "2026-07-22T08:00:00Z"}]}}

    def fake_get(url, **_kwargs):
        if url.endswith("news-archive-index.json"):
            raise cli.requests.ConnectionError()
        assert url == compat_url
        return Response()

    monkeypatch.setattr(cli.requests, "get", fake_get)

    restored = cli.restore_items("https://pages.example")

    assert [entry.source_item_id for entry in restored] == ["compat"]


def test_restored_items_are_restricted_to_current_source_allowlist():
    allowed = item("tvbs", "1", "保留", 1)
    removed = item("mirror", "2", "移除", 1)

    assert cli.keep_allowed_sources([allowed, removed], {"tvbs"}) == [allowed]
