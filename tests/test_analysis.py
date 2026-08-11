from datetime import datetime, timedelta, timezone
from pathlib import Path

from opinion_pipeline.analysis import (
    build_entities,
    build_keywords,
    cluster_events,
    robust_burst_score,
    extract_auto_terms,
    load_entity_lexicon,
    load_watch_config,
)
from opinion_pipeline.models import NormalizedItem
from opinion_pipeline.timeutil import normalize_published


NOW = datetime(2026, 7, 22, 12, 0, tzinfo=timezone.utc)
# 熱度的 diversity 分母。測試必須明講，否則熱度會隨預設值悄悄改變。
ENABLED_SOURCES = 24

WATCH_CONFIG = {
    "watch_terms": [
        {"id": "tsmc", "display": "台積電", "any_of": ["台積電", "TSMC"], "exclude": []},
        {"id": "typhoon", "display": "颱風", "any_of": ["颱風"], "exclude": []},
    ],
    "auto_terms": {"max_terms": 5, "min_docs": 2, "min_length": 2, "stopwords": ["快訊"]},
}


def item(source: str, title: str, age_hours: float, excerpt: str = "") -> NormalizedItem:
    return NormalizedItem(
        source=source,
        source_item_id=f"{source}-{title}-{age_hours}",
        title=title,
        excerpt=excerpt,
        url=f"https://example.com/{source}/{abs(hash(title + str(age_hours)))}",
        published_at=NOW - timedelta(hours=age_hours),
    )


def test_keywords_are_computed_from_real_items_with_bounded_heat():
    items = [
        item("tvbs", "台積電法說會登場", 1),
        item("cna", "台積電資本支出上修", 2),
        item("ltn", "TSMC 擴廠進度", 3),
        item("udn", "天氣晴朗", 5),
    ]

    keywords = build_keywords(items, WATCH_CONFIG, NOW, enabled_source_count=24)
    tsmc = next(k for k in keywords if k["term"] == "台積電")

    assert tsmc["kind"] == "manual"
    assert tsmc["mentions24h"] == 3
    assert 0 <= tsmc["heat"] <= 100
    assert len(tsmc["trend"]) == 24
    assert sum(point["mentions"] for point in tsmc["trend"]) == 3
    assert abs(sum(tsmc["sourceShare"].values()) - 1) < 0.01
    assert tsmc["components"]["weights"] == {"volume": 0.5, "acceleration": 0.33, "diversity": 0.17}


def test_watch_terms_stay_visible_at_zero_heat_without_matches():
    keywords = build_keywords(
        [item("tvbs", "無關新聞", 1)], WATCH_CONFIG, NOW, enabled_source_count=ENABLED_SOURCES
    )
    typhoon = next(k for k in keywords if k["term"] == "颱風")

    assert typhoon["heat"] == 0
    assert typhoon["mentions24h"] == 0
    assert typhoon["sourceShare"] == {}


def test_keywords_only_count_the_last_24_hours():
    items = [item("tvbs", "台積電舊聞", 30), item("cna", "台積電新訊", 2)]
    keywords = build_keywords(items, WATCH_CONFIG, NOW, enabled_source_count=ENABLED_SOURCES)
    tsmc = next(k for k in keywords if k["term"] == "台積電")

    assert tsmc["mentions24h"] == 1


def test_keyword_burst_uses_seven_prior_days_at_the_same_hour_and_exposes_evidence():
    items = [
        *[item(source, f"台積電當期{index}", 0.5) for index, source in enumerate(["cna", "ltn", "udn", "tvbs", "pts"])],
        *[item("cna", f"台積電基線{day}", day * 24 + 0.5) for day in range(1, 8)],
        item("cna", "歷史涵蓋證據", 7 * 24 + 1.5),
    ]

    tsmc = next(
        keyword for keyword in build_keywords(items, WATCH_CONFIG, NOW, enabled_source_count=ENABLED_SOURCES)
        if keyword["term"] == "台積電"
    )

    assert tsmc["burstCurrent"] == 5
    assert tsmc["burstSourceCount"] == 5
    assert tsmc["burstBaseline"] == [1, 1, 1, 1, 1, 1, 1]
    assert tsmc["burstBaselineMedian"] == 1
    assert tsmc["burstScore"] == 4


def test_auto_terms_prefer_longer_ngrams_and_skip_stopwords_and_watch_terms():
    items = [
        item("tvbs", "快訊 電價調漲方案出爐", 1),
        item("cna", "電價調漲衝擊產業", 2),
        item("ltn", "電價調漲今拍板", 3),
        item("udn", "台積電營收創高", 1),
    ]

    terms = extract_auto_terms(items, WATCH_CONFIG["watch_terms"], WATCH_CONFIG["auto_terms"])

    assert "電價調漲" in terms
    assert all("快訊" not in term for term in terms)
    assert all("台積電" not in term and term not in "台積電" for term in terms)


def test_entities_cooccurrence_counts_documents_not_inferences():
    lexicon = [
        {"name": "台積電", "aliases": ["TSMC"]},
        {"name": "經濟部", "aliases": []},
        {"name": "行政院", "aliases": []},
    ]
    items = [
        item("cna", "經濟部與台積電討論電價", 1),
        item("ltn", "經濟部再會 TSMC", 2),
        item("udn", "行政院無關新聞", 3),
        item("tvbs", "行政院討論預算", 4),
    ]

    graph = build_entities(items, lexicon)
    names = {node["name"]: node for node in graph["nodes"]}

    assert names["台積電"]["mentions"] == 2
    assert names["經濟部"]["mentions"] == 2
    assert names["行政院"]["mentions"] == 2
    tsmc_id = names["台積電"]["id"]
    moea_id = names["經濟部"]["id"]
    assert any(
        {edge["source"], edge["target"]} == {tsmc_id, moea_id} and edge["weight"] == 2 for edge in graph["edges"]
    )
    edge = next(edge for edge in graph["edges"] if {edge["source"], edge["target"]} == {tsmc_id, moea_id})
    assert edge["jaccard"] == 1.0
    assert edge["npmi"] > 0
    assert all("範例" not in node["name"] for node in graph["nodes"])


def test_entity_lexicon_and_watch_config_files_load():
    lexicon = load_entity_lexicon(Path("config/entities.yml"))
    watch = load_watch_config(Path("config/watch_terms.yml"))

    assert any(entry["name"] == "台積電" for entry in lexicon)
    assert any(entry.get("display") == "颱風" for entry in watch["watch_terms"])


def test_naive_timestamps_are_taipei_not_utc():
    naive_taipei_evening = datetime(2026, 7, 22, 19, 0)  # now = 台北 20:00
    normalized = normalize_published(naive_taipei_evening, NOW)

    assert normalized == datetime(2026, 7, 22, 11, 0, tzinfo=timezone.utc)


def test_future_timestamps_are_corrected_or_dropped():
    mislabeled = datetime(2026, 7, 22, 19, 0, tzinfo=timezone.utc)  # 台灣時間誤標 GMT
    assert normalize_published(mislabeled, NOW) == datetime(2026, 7, 22, 11, 0, tzinfo=timezone.utc)

    far_future = datetime(2026, 7, 23, 12, 0, tzinfo=timezone.utc)
    assert normalize_published(far_future, NOW) is None


def test_promote_resolves_multi_step_fragments():
    """「無人」應升級為完整詞「無人機」，而非留下沒有語意的碎片。"""
    from datetime import datetime, timezone

    from opinion_pipeline.analysis import extract_auto_terms
    from opinion_pipeline.models import NormalizedItem

    sources = ["cna", "ltn", "ettoday", "tvbs"]
    # 每篇「無人機」後接不同詞，模擬真實新聞：無人機本身高頻，更長的延伸則分散
    suffixes = ["擾台", "越界", "偵察", "升空", "墜毀", "採購", "編隊", "訓練"]
    items = [
        NormalizedItem(
            source=sources[index % len(sources)],
            source_item_id=str(index),
            title=f"共軍無人機{suffix}",
            excerpt="",
            url=f"https://example.com/{index}",
            published_at=datetime(2026, 7, 25, tzinfo=timezone.utc),
        )
        for index, suffix in enumerate(suffixes)
    ]
    terms = extract_auto_terms(items, [], {"max_terms": 5, "min_docs": 3, "min_sources": 3, "min_length": 2})

    assert "無人" not in terms, f"碎片詞不應出現：{terms}"
    assert any("無人機" in term for term in terms), f"應升級為無人機：{terms}"


def test_build_keywords_refuses_to_guess_the_enabled_source_count():
    """來源數是 diversity 的分母。先前預設 24（實際 37），沿用預設值會靜默偏高。

    這個測試防止預設值被重新加回來。
    """
    import pytest

    with pytest.raises(TypeError):
        build_keywords([item("tvbs", "台積電", 1)], WATCH_CONFIG, NOW)  # type: ignore[call-arg]


def test_event_clustering_groups_similar_cross_source_titles_within_48_hours():
    items = [
        item("cna", "台積電法說會：今年資本支出上修", 1),
        item("ltn", "台積電法說會 今年資本支出上修", 2),
        item("tvbs", "颱風海上警報發布", 3),
    ]
    events = cluster_events(items, threshold=0.6)
    assert events[0]["articleCount"] == 2
    assert events[0]["sourceCount"] == 2
    assert events[0]["sourceConcentration"] == 0.5
    assert events[0]["sourceTimeline"] == {
        "cna": [{"date": "2026-07-22", "mentions": 1}],
        "ltn": [{"date": "2026-07-22", "mentions": 1}],
    }
    assert events[0]["articles"][0]["url"].startswith("https://example.com/")


def test_robust_burst_uses_median_and_mad_and_requires_support():
    assert robust_burst_score(12, [2, 3, 3, 4, 3, 2, 3], source_count=4) > 5
    assert robust_burst_score(4, [0, 0, 0, 0, 0, 0, 0], source_count=4) is None
    assert robust_burst_score(12, [2, 3, 3, 4, 3, 2, 3], source_count=2) is None
