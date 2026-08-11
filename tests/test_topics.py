from datetime import datetime, timezone

from opinion_pipeline import cli
from opinion_pipeline.models import NormalizedItem


NOW = datetime(2026, 7, 22, 14, 0, tzinfo=timezone.utc)


def article(source: str, title: str, excerpt: str, url: str) -> NormalizedItem:
    return NormalizedItem(
        source=source,
        source_item_id=url,
        title=title,
        excerpt=excerpt,
        url=url,
        published_at=NOW,
    )


def test_topics_use_real_archive_text_and_urls_for_traceable_sentences():
    source_excerpt = "立法院今日審查預算，朝野立委進行質詢。"
    source_url = "https://news.ltn.com.tw/news/politics/breakingnews/1234567"

    topics = cli.build_topics([
        article("ltn", "立法院審查年度預算", source_excerpt, source_url),
    ])

    assert len(topics) == 1
    assert topics[0]["summarySentences"] == [
        {"text": source_excerpt, "source": "ltn", "url": source_url}
    ]
    assert topics[0]["articles"][0]["url"] == source_url
    assert "sample" not in topics[0]["articles"][0]["url"]


def test_topics_deprioritize_stock_ticker_boilerplate_in_summaries():
    noise = article("anue", "盤中速報 台積電急拉", "近5分K漲跌速、三大法人買賣超、融資融券增減。", "https://news.cnyes.com/news/id/1")
    real = article("cna", "台積電法說會展望樂觀", "台積電看好下半年產業需求。", "https://www.cna.com.tw/news/2")

    topics = cli.build_topics([noise, real])

    assert topics[0]["summarySentences"][0]["url"] == "https://www.cna.com.tw/news/2"
    assert topics[0]["articles"][0]["url"] == "https://www.cna.com.tw/news/2"


def test_topics_fall_back_to_exact_source_title_when_excerpt_is_empty():
    title = "颱風海上警報最新動態"
    url = "https://www.ettoday.net/news/20260722/1234567.htm"

    topics = cli.build_topics([article("ettoday", title, "", url)])

    assert topics[0]["summarySentences"][0]["text"] == title
    assert topics[0]["summarySentences"][0]["url"] == url


def test_topics_include_daily_timeline_and_time_window_event_subclusters():
    items = [
        NormalizedItem(
            source="cna",
            source_item_id="1",
            title="台積電半導體投資創新高",
            excerpt="台積電擴大先進製程投資。",
            url="https://example.com/1",
            published_at=datetime(2026, 7, 22, 10, 0, tzinfo=timezone.utc),
        ),
        NormalizedItem(
            source="ltn",
            source_item_id="2",
            title="台積電法說會看好半導體",
            excerpt="台積電公布展望。",
            url="https://example.com/2",
            published_at=datetime(2026, 7, 22, 8, 0, tzinfo=timezone.utc),
        ),
        NormalizedItem(
            source="udn",
            source_item_id="3",
            title="股市反映經濟成長",
            excerpt="台股上漲。",
            url="https://example.com/3",
            published_at=datetime(2026, 7, 21, 9, 0, tzinfo=timezone.utc),
        ),
    ]

    finance = cli.build_topics(items)[0]

    assert finance["timeline"] == [
        {"date": "2026-07-21", "mentions": 1},
        {"date": "2026-07-22", "mentions": 2},
    ]
    assert finance["terms"][0] == "台積電"
    assert finance["events"][0]["date"] == "2026-07-22"
    assert finance["events"][0]["size"] == 2
    assert finance["events"][0]["terms"][0] == "台積電"


def test_topic_event_exposes_source_timeline_and_concentration_without_stance_labels():
    items = [
        article("cna", "台積電半導體投資創新高", "", "https://example.com/event-1"),
        article("ltn", "台積電法說會看好半導體", "", "https://example.com/event-2"),
    ]
    finance = cli.build_topics(items)[0]
    event = finance["events"][0]
    assert event["sourceCounts"] == {"cna": 1, "ltn": 1}
    assert event["sourceConcentration"] == 0.5
    assert event["sourceTimeline"] == {
        "cna": [{"date": "2026-07-22", "mentions": 1}],
        "ltn": [{"date": "2026-07-22", "mentions": 1}],
    }


def test_topics_include_conservative_target_stance_evidence_when_entity_lexicon_is_enabled():
    items = [
        article("cna", "台積電獲利創新高", "台積電表現亮眼。", "https://example.com/target-1"),
        article("ltn", "分析師不看好台積電", "市場擔心台積電需求。", "https://example.com/target-2"),
    ]
    topics = cli.build_topics(
        items,
        cli.SentimentLexicon(positive={"創新高": 1, "看好": 1}),
        [{"name": "台積電", "aliases": [], "type": "ORG"}],
    )
    stance = topics[0]["targetStances"][0]
    assert stance["target"] == "台積電"
    assert stance["mentionCount"] == 2
    assert stance["label"] == "neutral"
    assert stance["evidence"]
