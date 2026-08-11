from datetime import datetime, timedelta, timezone

from opinion_pipeline.models import NormalizedItem
from opinion_pipeline.quality import assess_source_quality


NOW = datetime(2026, 8, 11, 12, 0, tzinfo=timezone.utc)


def article(hours: int, excerpt: str = "摘要") -> NormalizedItem:
    return NormalizedItem("cna", str(hours), "標題", excerpt, "https://example.com/a", NOW - timedelta(hours=hours))


def test_quality_marks_transport_success_without_articles_empty():
    value = assess_source_quality(True, [], "official-rss", NOW, latency_ms=120)
    assert value["status"] == "empty"
    assert value["transportOk"] is True
    assert value["qualityScore"] < 0.5


def test_quality_exposes_recomputable_freshness_excerpt_and_fallback_parts():
    value = assess_source_quality(True, [article(2), article(4, "")], "google-news", NOW, latency_ms=830)
    assert value["status"] == "degraded"
    assert value["fallbackUsed"] is True
    assert value["excerptRate"] == 0.5
    assert value["newestItemAt"] == "2026-08-11T10:00:00Z"
    assert value["fallbackItemCount"] == 2
    assert value["officialItemCount"] == 0
    assert set(value["qualityComponents"]) == {"availability", "freshness", "excerpt", "access"}
