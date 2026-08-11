"""Python 與 Worker 分析實作的共用 fixture parity 測試。"""
from __future__ import annotations

import json
import subprocess
from datetime import datetime
from pathlib import Path

from opinion_pipeline.analysis import build_entities, build_keywords, load_entity_lexicon, load_watch_config
from opinion_pipeline.cli import build_topics, envelope
from opinion_pipeline.models import NormalizedItem
from opinion_pipeline.sentiment import load_sentiment_lexicon


FIXTURE = Path("tests/fixtures/analysis-parity.json")


def test_deep_envelope_reports_actual_item_window():
    result = envelope(
        {
            "items": [
                {"publishedAt": "2026-08-10T03:00:00Z"},
                {"publishedAt": "2026-08-11T03:00:00Z"},
            ]
        },
        "2026-08-11T04:00:00Z",
    )

    assert result["window"] == {
        "actualFrom": "2026-08-10T03:00:00Z",
        "actualTo": "2026-08-11T03:00:00Z",
    }


def _python_output() -> dict:
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    items = [
        NormalizedItem(
            source=value["source"],
            source_item_id=value["id"],
            title=value["title"],
            excerpt=value["excerpt"],
            url=value["url"],
            published_at=datetime.fromisoformat(value["publishedAt"].replace("Z", "+00:00")),
        )
        for value in fixture["items"]
    ]
    now = datetime.fromisoformat(fixture["now"].replace("Z", "+00:00"))
    return {
        "keywords": build_keywords(
            items,
            load_watch_config(Path("config/watch_terms.yml")),
            now,
            enabled_source_count=fixture["enabledSourceCount"],
        ),
        "entities": build_entities(items, load_entity_lexicon(Path("config/entities.yml"))),
        "topics": build_topics(items, load_sentiment_lexicon(Path("config/sentiment.yml"))),
    }


def test_python_and_worker_analysis_outputs_are_identical():
    result = subprocess.run(
        ["node", "worker/scripts/parity-output.mjs", str(FIXTURE)],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    assert json.loads(result.stdout) == _python_output()
