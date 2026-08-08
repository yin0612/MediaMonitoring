"""輸出 Python 分析結果，供 Worker 的跨語言 parity 測試呼叫。"""
from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

from opinion_pipeline.analysis import build_entities, build_keywords, load_entity_lexicon, load_watch_config
from opinion_pipeline.cli import build_topics
from opinion_pipeline.models import NormalizedItem
from opinion_pipeline.sentiment import load_sentiment_lexicon

REPO_ROOT = Path(__file__).resolve().parents[1]


def parity_output(path: Path) -> dict:
    fixture = json.loads(path.read_text(encoding="utf-8"))
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
            load_watch_config(REPO_ROOT / "config/watch_terms.yml"),
            now,
            fixture["enabledSourceCount"],
        ),
        "entities": build_entities(items, load_entity_lexicon(REPO_ROOT / "config/entities.yml")),
        "topics": build_topics(items, load_sentiment_lexicon(REPO_ROOT / "config/sentiment.yml")),
    }


if __name__ == "__main__":
    print(json.dumps(parity_output(Path(sys.argv[1])), ensure_ascii=False))
