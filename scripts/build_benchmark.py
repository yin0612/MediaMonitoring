"""Build a deterministic, stratified human-annotation candidate set."""
from __future__ import annotations

import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path


def _digest(value: dict) -> str:
    return hashlib.sha256(f"{value.get('source')}:{value.get('id')}:{value.get('url')}".encode()).hexdigest()


def build_candidates(items: list[dict], size: int = 1000) -> list[dict]:
    unique = {str(item.get("url") or item.get("id")): item for item in items if item.get("title") and item.get("source")}
    buckets: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for item in unique.values():
        buckets[(str(item["source"]), str(item.get("publishedAt", ""))[:10])].append(item)
    ordered: list[dict] = []
    while buckets and len(ordered) < size:
        empty = []
        for key in sorted(buckets):
            bucket = buckets[key]
            bucket.sort(key=_digest)
            ordered.append(bucket.pop(0))
            if not bucket:
                empty.append(key)
            if len(ordered) >= size:
                break
        for key in empty:
            buckets.pop(key, None)
    selected = ordered[: min(size, len(ordered))]
    output = []
    for index, item in enumerate(selected):
        ratio = index / max(1, len(selected))
        split = "train" if ratio < 0.7 else "dev" if ratio < 0.85 else "test"
        output.append({
            "sampleId": _digest(item)[:20],
            "split": split,
            "doubleAnnotation": index < max(1, round(len(selected) * 0.1)),
            "source": item["source"],
            "publishedAt": item.get("publishedAt"),
            "title": item["title"],
            "excerpt": item.get("excerpt", ""),
            "url": item.get("url"),
            "annotations": {
                "eventCluster": None,
                "topics": [],
                "entities": [],
                "textTone": None,
                "target": None,
                "targetStance": None,
                "annotator1": None,
                "annotator2": None,
            },
        })
    return output


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=Path("web/public/data/news-archive.json"))
    parser.add_argument("--output", type=Path, default=Path("benchmarks/annotation-candidates.jsonl"))
    parser.add_argument("--size", type=int, default=1000)
    args = parser.parse_args()
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    candidates = build_candidates(payload.get("data", {}).get("items", []), args.size)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in candidates), encoding="utf-8")
    print(f"wrote {len(candidates)} candidates to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
