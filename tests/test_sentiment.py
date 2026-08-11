"""詞典法情緒判讀的行為測試（含否定、平手與彙總）。"""
from pathlib import Path

from opinion_pipeline.sentiment import aggregate, build_target_stances, classify, classify_target, load_sentiment_lexicon

LEXICON = load_sentiment_lexicon(Path("config/sentiment.yml"))


def test_positive_and_negative_are_detected_with_evidence():
    positive = classify("台股大漲創新高", LEXICON)
    assert positive["label"] == "positive"
    assert positive["score"] > 0
    # 命中詞就是前端顯示的「依據」，必須回傳
    assert {entry["term"] for entry in positive["matched"]} & {"大漲", "新高"}

    negative = classify("死亡車禍造成傷亡", LEXICON)
    assert negative["label"] == "negative"
    assert negative["score"] < 0
    assert negative["matched"]


def test_negation_flips_polarity():
    """「不看好」必須判為負向，否則詞典法會把否定句判反。"""
    result = classify("分析師不看好後市", LEXICON)
    assert result["label"] == "negative"


def test_weather_escalation_is_negative_even_when_escalation_word_is_positive():
    """災害語境中的「升級」描述風險，不應被一般正向詞誤判。"""
    result = classify("雨彈升級！豪大雨擴大7縣市", LEXICON)
    assert result["label"] == "negative"
    assert {entry["term"] for entry in result["matched"]} & {"雨彈", "豪大雨"}


def test_text_without_lexicon_terms_is_neutral():
    result = classify("行政院召開例行會議", LEXICON)
    assert result == {"label": "neutral", "score": 0.0, "matched": []}


def test_equal_scores_fall_back_to_neutral():
    result = classify("股價大漲後又大跌", LEXICON)
    assert result["label"] == "neutral"


def test_aggregate_ratios_always_sum_to_one():
    for labels in (
        ["positive", "negative", "neutral"],
        ["positive"] * 7 + ["negative"] * 3,
        ["neutral"] * 3,
    ):
        ratios = aggregate(labels)
        assert abs(sum(ratios.values()) - 1.0) < 1e-9


def test_aggregate_handles_empty_input():
    assert aggregate([]) == {"positive": 0.0, "neutral": 1.0, "negative": 0.0}


def test_targeted_sentiment_only_uses_context_around_named_target():
    text = "市場大漲創新高，但分析師不看好台積電後市，認為需求下滑。"
    result = classify_target(text, "台積電", ["TSMC"], LEXICON)
    assert result["target"] == "台積電"
    assert result["label"] == "negative"
    assert result["evidence"]


def test_targeted_sentiment_is_uncertain_without_target_or_evidence():
    assert classify_target("市場大漲", "台積電", [], LEXICON)["label"] == "uncertain"
    assert classify_target("台積電召開例行會議", "台積電", [], LEXICON)["label"] == "uncertain"


def test_build_target_stances_aggregates_traceable_target_evidence():
    items = [
        type("Item", (), {"source": "cna", "title": "台積電獲利創新高", "excerpt": "台積電表現亮眼", "search_text": "台積電獲利創新高 台積電表現亮眼", "url": "https://example.com/1"})(),
        type("Item", (), {"source": "ltn", "title": "分析師不看好台積電", "excerpt": "市場擔心台積電", "search_text": "分析師不看好台積電 市場擔心台積電", "url": "https://example.com/2"})(),
    ]
    stances = build_target_stances(
        items,
        [{"name": "台積電", "aliases": ["TSMC"], "type": "ORG"}],
        LEXICON,
    )
    assert stances[0]["target"] == "台積電"
    assert stances[0]["mentionCount"] == 2
    assert stances[0]["sourceCount"] == 2
    assert stances[0]["label"] == "neutral"
    assert len(stances[0]["evidence"]) == 2
