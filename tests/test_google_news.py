from opinion_pipeline.connectors.google_news import (
    google_news_url,
    parse_google_news,
    strip_publisher_suffix,
)


SOURCE = {"id": "ttv", "name": "台視新聞", "domains": ["news.ttv.com.tw"], "aliases": ["台視新聞網", "台視"]}


def feed(items_xml: str) -> bytes:
    return f'<rss version="2.0"><channel>{items_xml}</channel></rss>'.encode("utf-8")


def test_google_news_url_is_scoped_to_the_official_domain():
    url = google_news_url("news.ttv.com.tw")

    assert "news.google.com/rss/search" in url
    assert "site%3Anews.ttv.com.tw" in url
    assert "ceid=TW%3Azh-Hant" in url or "ceid=TW:zh-Hant" in url


def test_publisher_suffix_is_stripped_only_when_it_matches_the_source():
    assert strip_publisher_suffix("颱風要來了 - 台視新聞網", SOURCE) == "颱風要來了"
    assert strip_publisher_suffix("進口車 - 出口統計", SOURCE) == "進口車 - 出口統計"


def test_parse_google_news_normalizes_items_without_inventing_excerpts():
    raw = feed(
        """<item><guid>a</guid><title>台視獨家報導 - 台視新聞網</title>
        <link>https://news.google.com/rss/articles/a</link>
        <pubDate>Wed, 22 Jul 2026 08:00:00 GMT</pubDate>
        <description>&lt;a href="https://x"&gt;雜訊連結&lt;/a&gt;</description></item>"""
    )

    result = parse_google_news(raw, SOURCE, max_items=20)

    assert result.ok is True
    assert result.items[0].title == "台視獨家報導"
    assert result.items[0].excerpt == ""
    assert result.items[0].source == "ttv"


def test_parse_google_news_reports_drop_reasons_instead_of_faking_times():
    raw = feed(
        """<item><guid>a</guid><title>沒有時間的新聞</title>
        <link>https://news.google.com/rss/articles/a</link></item>"""
    )

    result = parse_google_news(raw, SOURCE, max_items=20)

    assert result.ok is False
    assert result.error_code == "NO_VALID_ITEMS"
    assert result.drop_reasons == {"invalid_time": 1}


def test_valid_empty_google_news_feed_is_healthy():
    raw = b'<?xml version="1.0"?><rss version="2.0"><channel><title>empty</title></channel></rss>'

    result = parse_google_news(raw, SOURCE, max_items=10)

    assert result.ok is True
    assert result.items == []


def test_non_feed_google_news_document_remains_an_error():
    result = parse_google_news(b"<html>blocked</html>", SOURCE, max_items=10)

    assert result.ok is False
    assert result.error_code == "EMPTY_OR_BAD_FEED"


def test_malformed_empty_google_news_feed_remains_an_error():
    raw = b'<rss version="2.0"><channel><title>truncated</title>'

    result = parse_google_news(raw, SOURCE, max_items=10)

    assert result.ok is False
    assert result.error_code == "EMPTY_OR_BAD_FEED"
