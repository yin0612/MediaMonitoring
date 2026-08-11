"""Merge two independent reviewer exports into the candidate JSONL safely."""
from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
from typing import Any


def _index_rows(rows: list[dict[str, Any]], label: str) -> dict[str, dict[str, Any]]:
    indexed: dict[str, dict[str, Any]] = {}
    for row in rows:
        sample_id = str(row.get("sampleId") or "").strip()
        if not sample_id or sample_id in indexed:
            raise ValueError(f"{label} has a missing or duplicate sampleId.")
        indexed[sample_id] = row
    return indexed


def _ensure_same_sample_ids(base: dict[str, Any], candidate: dict[str, Any], label: str) -> None:
    if set(base) != set(candidate):
        missing = sorted(set(base) - set(candidate))
        unexpected = sorted(set(candidate) - set(base))
        raise ValueError(
            f"sampleId mismatch for {label}: missing={missing[:3]}, unexpected={unexpected[:3]}"
        )


def _nested_annotation(row: dict[str, Any], reviewer: str) -> dict[str, Any] | None:
    annotations = row.get("annotations")
    value = annotations.get(reviewer) if isinstance(annotations, dict) else None
    return copy.deepcopy(value) if isinstance(value, dict) else None


def merge_reviewer_exports(
    base_rows: list[dict[str, Any]],
    annotator1_rows: list[dict[str, Any]],
    annotator2_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Copy only independent nested labels into matching double-annotation rows.

    The base file remains authoritative for canonical fields such as
    ``eventCluster`` and is never replaced with values from a reviewer export.
    """
    base_by_id = _index_rows(base_rows, "base")
    annotator1_by_id = _index_rows(annotator1_rows, "annotator1")
    annotator2_by_id = _index_rows(annotator2_rows, "annotator2")
    _ensure_same_sample_ids(base_by_id, annotator1_by_id, "annotator1")
    _ensure_same_sample_ids(base_by_id, annotator2_by_id, "annotator2")

    merged = copy.deepcopy(base_rows)
    for row in merged:
        if row.get("doubleAnnotation") is not True:
            continue
        sample_id = str(row["sampleId"])
        annotations = row.get("annotations")
        if not isinstance(annotations, dict):
            annotations = {}
            row["annotations"] = annotations
        annotations["annotator1"] = _nested_annotation(annotator1_by_id[sample_id], "annotator1")
        annotations["annotator2"] = _nested_annotation(annotator2_by_id[sample_id], "annotator2")
    return merged


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, required=True, help="Candidate or consensus JSONL")
    parser.add_argument("--annotator1", type=Path, required=True, help="First independent reviewer export")
    parser.add_argument("--annotator2", type=Path, required=True, help="Second independent reviewer export")
    parser.add_argument("--output", type=Path, required=True, help="Merged JSONL to create")
    args = parser.parse_args()

    merged = merge_reviewer_exports(
        _load_jsonl(args.base),
        _load_jsonl(args.annotator1),
        _load_jsonl(args.annotator2),
    )
    _write_jsonl(args.output, merged)
    print(json.dumps({
        "output": str(args.output),
        "rows": len(merged),
        "doubleAnnotatedRows": sum(row.get("doubleAnnotation") is True for row in merged),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
