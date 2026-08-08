from __future__ import annotations

from pathlib import Path

import yaml


SOURCE_IDS = (
    "tvbs", "ebc", "setn", "ftv", "cti", "era", "nexttv", "pts", "ttv", "cts", "udn",
    "ltn", "cna", "moneyudn", "ctee", "anue", "wealth", "businessweekly", "thenewslens",
    "reporter", "newtalk", "nownews", "nextapple", "ettoday", "rti", "technews",
    "taipeitimes", "coolloud", "tfc", "moneydj", "businesstoday", "bnext", "managertoday",
    "chinatimes", "ctwant", "mnews", "mirrormedia",
)


def load_sources(path: Path) -> list[dict]:
    config = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    sources = config.get("sources") or []
    ids = tuple(source.get("id") for source in sources)
    if ids != SOURCE_IDS:
        raise ValueError("SOURCE_REGISTRY_MISMATCH")
    for source in sources:
        source.setdefault("aliases", [])
        source.setdefault("rss_url", "")
        source.setdefault("rss_urls", [])
        source.setdefault("crawl", {"enabled": False, "url": ""})
        if not source.get("domains"):
            raise ValueError(f"SOURCE_DOMAINS_MISSING:{source['id']}")
    return sources
