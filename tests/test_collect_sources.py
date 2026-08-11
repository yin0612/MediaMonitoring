"""來源抓取必須併發，否則每 5 分鐘的排程根本跑不完一輪。

背景：37 家來源原本逐一序列抓取。單一 URL 最壞情況約 99 秒（20 秒逾時 ×
4 次重試，外加 2/5/12 秒退避），每家最多還會依序試官方 RSS → Google News →
官網爬取，實測 GitHub runner 上整輪超過 20 分鐘，排程因此互相堆積。
"""
import time
from datetime import datetime, timedelta, timezone

from opinion_pipeline import cli
from opinion_pipeline.models import NormalizedItem, SourceResult


def _sources(count: int) -> list[dict]:
    return [{"id": f"s{i}", "name": f"Source {i}"} for i in range(count)]


def test_collect_sources_preserves_source_order(monkeypatch):
    """順序必須穩定，否則 sources.json 每輪的來源排列都會跳動。"""
    monkeypatch.setattr(
        cli,
        "collect_source",
        lambda source, _state, _now, _timeout, _max: {"id": source["id"], "ok": True},
    )

    result = cli.collect_sources(_sources(12), {}, datetime.now(timezone.utc), 20, 20)

    assert [entry["id"] for entry in result] == [f"s{i}" for i in range(12)]


def test_collect_sources_runs_concurrently(monkeypatch):
    """六家各等 0.2 秒的來源，併發後總時間必須遠低於序列的 1.2 秒。"""
    delay = 0.2
    count = 6

    def slow_collect(source, _state, _now, _timeout, _max):
        time.sleep(delay)
        return {"id": source["id"], "ok": True}

    monkeypatch.setattr(cli, "collect_source", slow_collect)

    started = time.monotonic()
    result = cli.collect_sources(_sources(count), {}, datetime.now(timezone.utc), 20, 20)
    elapsed = time.monotonic() - started

    assert len(result) == count
    sequential = delay * count
    assert elapsed < sequential / 2, f"看起來仍是序列執行：{elapsed:.2f}s（序列約 {sequential:.2f}s）"


def test_collect_sources_passes_restored_state_for_each_source(monkeypatch):
    """每家來源要拿到自己的上次狀態，官網爬取的頻率限制才會正確。"""
    seen = {}

    def record(source, state, _now, _timeout, _max):
        seen[source["id"]] = state
        return {"id": source["id"], "ok": True}

    monkeypatch.setattr(cli, "collect_source", record)
    restored = {"s1": {"lastCrawlAt": "2026-08-09T00:00:00Z"}}

    cli.collect_sources(_sources(3), restored, datetime.now(timezone.utc), 20, 20)

    assert seen["s1"] == restored["s1"]
    assert seen["s0"] is None
    assert seen["s2"] is None


def test_collect_sources_handles_an_empty_registry():
    assert cli.collect_sources([], {}, datetime.now(timezone.utc), 20, 20) == []


def test_collect_source_uses_one_successful_access_mode_for_items_and_quality(monkeypatch):
    """不同 fallback 管道不能混入同一份、卻只標一個 accessMode。"""
    now = datetime(2026, 8, 11, 12, tzinfo=timezone.utc)
    source = {
        "id": "demo",
        "name": "Demo",
        "domains": ["demo.example"],
        "crawl": {"enabled": True, "url": "https://demo.example/news"},
    }
    google_item = NormalizedItem(
        "demo", "google-1", "Google article", "摘要", "https://demo.example/google", now - timedelta(hours=1)
    )
    listing_item = NormalizedItem(
        "demo", "listing-1", "Listing article", "摘要", "https://demo.example/listing", now - timedelta(hours=2)
    )
    monkeypatch.setattr(
        cli,
        "fetch_google_news",
        lambda *_args: SourceResult("demo", "Demo", True, True, items=[google_item]),
    )
    monkeypatch.setattr(
        cli,
        "fetch_listing_source",
        lambda *_args: SourceResult("demo", "Demo", True, True, items=[listing_item]),
    )

    result = cli.collect_source(source, None, now, 5, 20)

    assert result["ok"] is True
    assert result["accessMode"] == "google-news"
    assert result["items"] == [google_item]
    assert result["crawlAttempted"] is False
