"""詞典法情緒判讀的行為測試（含否定、平手與彙總）。"""
from pathlib import Path

from opinion_pipeline.sentiment import aggregate, classify, load_sentiment_lexicon

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
