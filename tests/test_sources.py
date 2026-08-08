from datetime import datetime, timedelta, timezone
from pathlib import Path

from opinion_pipeline.connectors import html_listing
from opinion_pipeline.connectors import rss
from opinion_pipeline.connectors.html_listing import (
    crawl_due,
    discover_listing_links,
    fetch_listing_source,
    parse_article_html,
    parse_listing_html,
    robots_allowed,
)
from opinion_pipeline.sources import SOURCE_IDS, load_sources


EXPECTED_SOURCE_IDS = (
    "tvbs",
    "ebc",
    "setn",
    "ftv",
    "cti",
    "era",
    "nexttv",
    "pts",
    "ttv",
    "cts",
    "udn",
    "ltn",
    "cna",
    "moneyudn",
    "ctee",
    "anue",
    "wealth",
    "businessweekly",
    "thenewslens",
    "reporter",
    "newtalk",
    "nownews",
    "nextapple",
    "ettoday",
    "rti",
    "technews",
    "taipeitimes",
    "coolloud",
    "tfc",
    "moneydj",
    "businesstoday",
    "bnext",
    "managertoday",
    "chinatimes",
    "ctwant",
)


def test_registry_contains_exactly_the_requested_35_news_sources():
    sources = load_sources(Path("config/sources.yml"))

    assert SOURCE_IDS == EXPECTED_SOURCE_IDS
    assert tuple(source["id"] for source in sources) == EXPECTED_SOURCE_IDS
    assert len({domain for source in sources for domain in source["domains"]}) >= 24
    assert not {"mirror", "currents", "bluesky"}.intersection(SOURCE_IDS)


def test_worker_and_frontend_source_registries_stay_in_sync_with_the_yaml():
    """三處來源清單（Python/Worker/前端）必須一致，避免加來源時漏改。"""
    import re

    worker_js = Path("worker/src/sources.js").read_text(encoding="utf-8")
    worker_ids = tuple(re.findall(r"\{ id: '([a-z]+)'", worker_js))

    web_ts = Path("web/src/lib/sources.ts").read_text(encoding="utf-8")
    web_ids = tuple(re.findall(r"^  (\w+): \{ id: '\w+'", web_ts, flags=re.MULTILINE))

    contracts_ts = Path("web/src/types/contracts.ts").read_text(encoding="utf-8")
    contract_block = contracts_ts.split("export type SourceId =", 1)[1].split(";", 1)[0]
    contract_ids = tuple(re.findall(r"'(\w+)'", contract_block))

    assert worker_ids == SOURCE_IDS
    assert web_ids == SOURCE_IDS
    assert contract_ids == SOURCE_IDS


def test_udn_properties_never_enable_direct_listing_crawl():
    sources = {source["id"]: source for source in load_sources(Path("config/sources.yml"))}

    assert sources["udn"]["crawl"]["enabled"] is False
    assert sources["moneyudn"]["crawl"]["enabled"] is False


def test_taiwan_official_rss_sources_are_enabled_in_registry():
    sources = {source["id"]: source for source in load_sources(Path("config/sources.yml"))}

    assert len(sources["cna"]["rss_urls"]) == 6
    assert sources["businessweekly"]["rss_url"].startswith("https://www.businessweekly.com.tw/feedsec.aspx")


def test_new_taiwan_rss_sources_are_enabled_and_metadata_only():
    sources = {source["id"]: source for source in load_sources(Path("config/sources.yml"))}

    expected = {
        "rti": ("https://www.rti.org.tw/rss", ["rti.org.tw", "www.rti.org.tw"]),
        "technews": ("https://technews.tw/feed/", ["technews.tw", "finance.technews.tw"]),
        "taipeitimes": ("https://www.taipeitimes.com/xml/index.rss", ["taipeitimes.com", "www.taipeitimes.com"]),
        "coolloud": ("https://www.coolloud.org.tw/rss.xml", ["coolloud.org.tw", "www.coolloud.org.tw"]),
        "tfc": ("https://tfc-taiwan.org.tw/feed/", ["tfc-taiwan.org.tw", "www.tfc-taiwan.org.tw"]),
    }

    for source_id, (rss_url, domains) in expected.items():
        source = sources[source_id]
        assert source["rss_url"] == rss_url
        assert source["domains"] == domains
        assert source["crawl"] == {"enabled": False, "url": ""}


def test_product_source_count_copy_and_method_versions_match_the_35_source_registry():
    assert "35 個公開新聞來源" in Path("web/src/pages/HomePage.tsx").read_text(encoding="utf-8")
    assert "35 家媒體" in Path("web/src/pages/SearchPage.tsx").read_text(encoding="utf-8")
    assert Path("web/index.html").read_text(encoding="utf-8").count("35 個台灣公開新聞來源") == 3
    assert "news-heat-v4-35-sources" in Path("src/opinion_pipeline/cli.py").read_text(encoding="utf-8")
    worker_index = Path("worker/src/index.js").read_text(encoding="utf-8")
    assert "news-heat-v4-35-sources-worker" in worker_index


def test_rss_source_with_a_valid_empty_feed_is_healthy(monkeypatch):
    source = {"id": "empty", "name": "Empty", "rss_url": "https://example.com/feed.xml"}
    monkeypatch.setattr(
        rss,
        "_fetch_bytes",
        lambda _url, _timeout: b'<rss version="2.0"><channel><title>empty</title></channel></rss>',
    )

    result = rss.fetch_source(source, timeout=2, max_items=10)

    assert result.ok is True
    assert result.items == []


def test_rss_source_with_a_non_feed_document_remains_an_error(monkeypatch):
    source = {"id": "blocked", "name": "Blocked", "rss_url": "https://example.com/feed.xml"}
    monkeypatch.setattr(rss, "_fetch_bytes", lambda _url, _timeout: b"<html>blocked</html>")

    result = rss.fetch_source(source, timeout=2, max_items=10)

    assert result.ok is False
    assert result.error_code == "EMPTY_OR_BAD_FEED"


def test_rss_source_with_a_malformed_empty_feed_remains_an_error(monkeypatch):
    source = {"id": "truncated", "name": "Truncated", "rss_url": "https://example.com/feed.xml"}
    monkeypatch.setattr(
        rss,
        "_fetch_bytes",
        lambda _url, _timeout: b'<rss version="2.0"><channel><title>truncated</title>',
    )

    result = rss.fetch_source(source, timeout=2, max_items=10)

    assert result.ok is False
    assert result.error_code == "EMPTY_OR_BAD_FEED"


def test_listing_crawl_is_due_only_after_six_hours():
    now = datetime(2026, 7, 22, 12, 0, tzinfo=timezone.utc)

    assert crawl_due(None, now) is True
    assert crawl_due(now - timedelta(hours=5, minutes=59), now) is False
    assert crawl_due(now - timedelta(hours=6), now) is True


def test_robots_parser_blocks_disallowed_listing_path():
    robots = "User-agent: *\nDisallow: /private/\nAllow: /\n"

    assert robots_allowed(robots, "https://example.com/news", "MediaMonitoringDemo/1.0") is True
    assert robots_allowed(robots, "https://example.com/private/news", "MediaMonitoringDemo/1.0") is False


def test_listing_parser_keeps_metadata_only():
    raw = """
    <html><head><script type="application/ld+json">
    {"@context":"https://schema.org","@type":"NewsArticle","headline":"台積電最新消息",
     "url":"/news/123","datePublished":"2026-07-22T10:00:00+08:00",
     "description":"公開短摘要","articleBody":"不得輸出的完整正文"}
    </script></head></html>
    """.encode("utf-8")

    items = parse_listing_html(raw, "setn", "https://www.setn.com/")

    assert len(items) == 1
    assert items[0].source == "setn"
    assert items[0].title == "台積電最新消息"
    assert items[0].excerpt == "公開短摘要"
    assert items[0].url == "https://www.setn.com/news/123"
    assert "完整正文" not in items[0].search_text


def test_listing_fetch_checks_robots_then_returns_public_metadata(monkeypatch):
    page = """<script type="application/ld+json">
    {"@type":"NewsArticle","headline":"台積電追蹤","url":"/news/9",
     "datePublished":"2026-07-22T10:00:00+08:00","description":"短摘要"}
    </script>""".encode("utf-8")
    calls: list[str] = []

    class Response:
        def __init__(self, url: str):
            self.url = url
            self.status_code = 200
            self.text = "User-agent: *\nAllow: /\n"
            self.content = page if not url.endswith("robots.txt") else self.text.encode()

        def raise_for_status(self):
            return None

    def fake_get(url, **_kwargs):
        calls.append(url)
        return Response(url)

    monkeypatch.setattr(html_listing.requests, "get", fake_get)

    result = fetch_listing_source(
        {"id": "setn", "name": "三立新聞", "crawl": {"enabled": True, "url": "https://www.setn.com/"}},
        timeout=2,
        max_items=10,
    )

    assert calls == ["https://www.setn.com/robots.txt", "https://www.setn.com/"]
    assert result.ok is True
    assert result.items[0].title == "台積電追蹤"


def test_listing_link_discovery_and_article_meta_fallback_are_metadata_only():
    listing = '<a href="/news/123"><h2>台積電重大消息</h2></a>'.encode("utf-8")
    links = discover_listing_links(
        listing,
        "https://news.example.com/",
        r"^https://news\.example\.com/news/\d+$",
        limit=5,
    )
    article = """<html><head>
      <meta property="og:title" content="台積電重大消息">
      <meta property="og:description" content="公開摘要">
      <meta property="article:published_time" content="2026-07-22T10:00:00+08:00">
      <meta property="og:url" content="https://news.example.com/news/123">
    </head><body>不得輸出的完整正文</body></html>""".encode("utf-8")

    item = parse_article_html(article, "ebc", links[0][0], links[0][1])

    assert links == [("https://news.example.com/news/123", "台積電重大消息")]
    assert item is not None
    assert item.excerpt == "公開摘要"
    assert "完整正文" not in item.search_text


def test_article_parser_can_use_the_publication_date_in_the_official_url():
    article = """<meta property="og:title" content="年代新聞標題">
    <meta property="og:description" content="年代短摘要">""".encode("utf-8")

    item = parse_article_html(
        article,
        "era",
        "https://www.eracom.com.tw/EraNews/Home/HotNews/2026-07-22/2414187.html",
    )

    assert item is not None
    assert item.published_at.date().isoformat() == "2026-07-22"
