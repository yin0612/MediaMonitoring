"""Build clearly-labelled, provisional annotation suggestions.

This helper never writes the human ``annotations`` fields.  It is intentionally
conservative: anything that cannot be derived from an existing archive label or
an exact configured entity match is marked ``uncertain``.
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from urllib.parse import urldefrag, urlsplit, urlunsplit

import yaml


TOPIC_KEYWORDS = {
    "politics": ("政府", "總統", "立法院", "選舉", "政黨", "外交", "國會", "政策"),
    "finance": ("股", "金融", "央行", "Fed", "利率", "投資", "市場", "經濟", "企業"),
    "society": ("社會", "警", "犯罪", "事故", "教育", "醫療", "勞工", "捐款"),
    "weather": ("地震", "颱風", "豪雨", "氣象", "災害", "淹水"),
    "international": ("美國", "中國", "日本", "歐洲", "全球", "國際", "外交"),
    "entertainment": ("電影", "影劇", "藝人", "歌手", "演唱會", "娛樂"),
}


def canonical_url(value: str | None) -> str:
    """Match archive and candidate URLs without query/fragment noise."""
    if not value:
        return ""
    value, _ = urldefrag(str(value).strip())
    parts = urlsplit(value)
    path = parts.path.rstrip("/") or "/"
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, "", ""))


def _entity_terms(config: dict) -> list[tuple[str, str, str]]:
    if not isinstance(config, dict):
        return []
    if "orgs" in config or "persons" in config:
        entries = [("ORG", entry) for entry in config.get("orgs") or []]
        entries += [("PERSON", entry) for entry in config.get("persons") or []]
    else:
        entries = [(str(value.get("type", "ORG")), {"name": name, "aliases": value.get("aliases", [])})
                   for name, value in config.items() if isinstance(value, dict)]
    terms: list[tuple[str, str, str]] = []
    for kind, entry in entries:
        name = str(entry.get("name", "")).strip()
        if not name:
            continue
        for term in [name, *(str(alias).strip() for alias in entry.get("aliases") or [])]:
            if term:
                terms.append((name, kind, term))
    return terms


def _entity_matches(text: str, entity_config: dict) -> list[str]:
    found: dict[str, int] = {}
    for canonical, _kind, term in _entity_terms(entity_config):
        if term in text:
            found[canonical] = found.get(canonical, 0) + 1
    return sorted(found)


def _topic_matches(text: str) -> list[str]:
    return [topic for topic, terms in TOPIC_KEYWORDS.items() if any(term in text for term in terms)] or ["other"]


def _tone(value: object) -> str:
    if isinstance(value, dict):
        value = value.get("label")
    return value if value in {"positive", "neutral", "negative"} else "uncertain"


def build_machine_draft(
    candidates: list[dict],
    archive_items: list[dict],
    entity_config: dict,
) -> list[dict]:
    """Return candidate rows with provisional suggestions and untouched annotations."""
    archive_by_url = {
        canonical_url(item.get("url")): item
        for item in archive_items
        if canonical_url(item.get("url"))
    }
    output: list[dict] = []
    for candidate in candidates:
        title = str(candidate.get("title") or "")
        excerpt = str(candidate.get("excerpt") or "")
        text = f"{title} {excerpt}"
        archive = archive_by_url.get(canonical_url(candidate.get("url")), {})
        tone = _tone(archive.get("sentiment"))
        entities = _entity_matches(text, entity_config)
        target = entities[0] if len(entities) == 1 else "uncertain"
        stance = tone if tone in {"positive", "negative"} and target != "uncertain" else "uncertain"
        row = dict(candidate)
        # Defensive copy: this function must never mutate or populate official labels.
        row["annotations"] = dict(candidate.get("annotations") or {})
        row["machineSuggested"] = {
            "eventCluster": "uncertain",
            "topics": _topic_matches(text),
            "entities": entities,
            "textTone": tone,
            "target": target,
            "targetStance": stance,
        }
        row["provenance"] = {
            "kind": "machine-draft",
            "method": "existing archive sentiment + entities.yml literal matching + transparent topic keywords",
            "humanVerified": False,
        }
        output.append(row)
    return output


def _load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidates", type=Path, default=Path("benchmarks/annotation-candidates.jsonl"))
    parser.add_argument("--archive", type=Path, default=Path("web/public/data/news-archive.json"))
    parser.add_argument("--entities", type=Path, default=Path("config/entities.yml"))
    parser.add_argument("--jsonl", type=Path, default=Path("benchmarks/annotation-machine-draft.jsonl"))
    parser.add_argument("--csv", type=Path, default=Path("benchmarks/annotation-machine-draft.csv"))
    args = parser.parse_args()

    candidates = _load_jsonl(args.candidates)
    archive = json.loads(args.archive.read_text(encoding="utf-8"))
    entity_config = yaml.safe_load(args.entities.read_text(encoding="utf-8")) or {}
    rows = build_machine_draft(candidates, archive.get("data", {}).get("items", []), entity_config)

    args.jsonl.parent.mkdir(parents=True, exist_ok=True)
    args.jsonl.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")
    columns = [
        "sampleId", "split", "doubleAnnotation", "source", "publishedAt", "title", "excerpt", "url",
        "eventCluster", "topics", "entities", "textTone", "target", "targetStance", "humanVerified", "method",
    ]
    with args.csv.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            suggestion = row["machineSuggested"]
            writer.writerow({
                "sampleId": row.get("sampleId"), "split": row.get("split"),
                "doubleAnnotation": row.get("doubleAnnotation"), "source": row.get("source"),
                "publishedAt": row.get("publishedAt"), "title": row.get("title"),
                "excerpt": row.get("excerpt"), "url": row.get("url"),
                "eventCluster": suggestion["eventCluster"], "topics": "|".join(suggestion["topics"]),
                "entities": "|".join(suggestion["entities"]), "textTone": suggestion["textTone"],
                "target": suggestion["target"], "targetStance": suggestion["targetStance"],
                "humanVerified": row["provenance"]["humanVerified"], "method": row["provenance"]["method"],
            })
    print(json.dumps({"rows": len(rows), "jsonl": str(args.jsonl), "csv": str(args.csv)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
