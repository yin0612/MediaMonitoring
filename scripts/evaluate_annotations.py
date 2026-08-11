"""Evaluate completed human annotation rows without mutating the gold labels."""
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any


CATEGORICAL_FIELDS = ("eventCluster", "textTone", "target", "targetStance")
REQUIRED_DOUBLE_ANNOTATION_ROWS = 100
VALID_LABELS = {
    "textTone": {"positive", "neutral", "negative", "uncertain"},
    "targetStance": {"positive", "neutral", "negative", "uncertain"},
}


def attach_machine_suggestions(rows: list[dict], drafts: list[dict]) -> list[dict]:
    """Return evaluation rows with matched machine outputs and untouched human labels."""
    drafts_by_id: dict[str, dict] = {}
    for draft in drafts:
        sample_id = _value(draft.get("sampleId"))
        suggestion = draft.get("machineSuggested")
        if not sample_id or not isinstance(suggestion, dict):
            raise ValueError("machine draft rows require sampleId and machineSuggested")
        if sample_id in drafts_by_id:
            raise ValueError(f"duplicate machine draft sampleId: {sample_id}")
        drafts_by_id[sample_id] = suggestion

    attached: list[dict] = []
    seen_ids: set[str] = set()
    for row in rows:
        sample_id = _value(row.get("sampleId"))
        if not sample_id:
            raise ValueError("human annotation rows require sampleId")
        if sample_id in seen_ids:
            raise ValueError(f"duplicate human annotation sampleId: {sample_id}")
        seen_ids.add(sample_id)
        if sample_id not in drafts_by_id:
            raise ValueError(f"missing machine draft for sampleId: {sample_id}")
        attached.append({**row, "machineSuggested": dict(drafts_by_id[sample_id])})

    unexpected = sorted(set(drafts_by_id) - seen_ids)
    if unexpected:
        raise ValueError(f"machine draft has unexpected sampleId: {unexpected[0]}")
    return attached


def _value(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _gold(row: dict, field: str) -> str | None:
    annotations = row.get("annotations") or {}
    direct = _value(annotations.get(field))
    if direct:
        return direct
    annotator1 = annotations.get("annotator1") or {}
    annotator2 = annotations.get("annotator2") or {}
    first = _value(annotator1.get(field)) if isinstance(annotator1, dict) else None
    second = _value(annotator2.get(field)) if isinstance(annotator2, dict) else None
    return first if first and first == second else None


def _annotator_value(row: dict, annotator: str, field: str) -> str | None:
    annotations = row.get("annotations") or {}
    value = annotations.get(annotator) or {}
    return _value(value.get(field)) if isinstance(value, dict) else None


def _kappa(left: list[str], right: list[str]) -> float | None:
    if not left or len(left) != len(right):
        return None
    n = len(left)
    observed = sum(a == b for a, b in zip(left, right)) / n
    labels = sorted(set(left) | set(right))
    expected = sum(Counter(left)[label] * Counter(right)[label] for label in labels) / (n * n)
    if expected == 1:
        return 1.0 if observed == 1 else 0.0
    return round((observed - expected) / (1 - expected), 6)


def _macro_f1(predicted: list[str], actual: list[str]) -> float | None:
    if not predicted or len(predicted) != len(actual):
        return None
    labels = sorted(set(predicted) | set(actual))
    scores = []
    for label in labels:
        tp = sum(p == label and a == label for p, a in zip(predicted, actual))
        fp = sum(p == label and a != label for p, a in zip(predicted, actual))
        fn = sum(p != label and a == label for p, a in zip(predicted, actual))
        denominator = 2 * tp + fp + fn
        scores.append((2 * tp / denominator) if denominator else 0.0)
    return round(sum(scores) / len(scores), 6) if scores else None


def evaluate_rows(rows: list[dict]) -> dict:
    human_rows = [row for row in rows if any(_gold(row, field) for field in CATEGORICAL_FIELDS)]
    held_out_rows = [row for row in human_rows if row.get("split") == "test"]
    required_double_rows = [row for row in rows if row.get("doubleAnnotation") is True]
    completed_double_rows = [
        row
        for row in required_double_rows
        if all(_annotator_value(row, annotator, field) for annotator in ("annotator1", "annotator2") for field in CATEGORICAL_FIELDS)
    ]
    metrics = {}
    for field in CATEGORICAL_FIELDS:
        pairs = [
            (_annotator_value(row, "annotator1", field), _annotator_value(row, "annotator2", field))
            for row in required_double_rows
        ]
        pairs = [(a, b) for a, b in pairs if a and b]
        actual_pred = [
            (_gold(row, field), _value((row.get("machineSuggested") or {}).get(field)))
            for row in held_out_rows
        ]
        actual_pred = [(a, p) for a, p in actual_pred if a and p]
        kappa_ready = (
            len(required_double_rows) == REQUIRED_DOUBLE_ANNOTATION_ROWS
            and len(pairs) == REQUIRED_DOUBLE_ANNOTATION_ROWS
        )
        metrics[field] = {
            "doubleAnnotatedRows": len(pairs),
            "cohenKappa": _kappa([a for a, _ in pairs], [b for _, b in pairs]) if kappa_ready else None,
            "machineEvaluatedRows": len(actual_pred),
            "machineMacroF1": _macro_f1([p for _, p in actual_pred], [a for a, _ in actual_pred]),
        }
    status = "ok" if human_rows else "insufficient_labels"
    return {
        "status": status,
        "totalRows": len(rows),
        "humanLabelRows": len(human_rows),
        "heldOutHumanLabelRows": len(held_out_rows),
        "missingHumanLabels": len(rows) - len(human_rows),
        "requiredDoubleAnnotationRows": len(required_double_rows),
        "doubleAnnotatedRows": len(completed_double_rows),
        "metrics": metrics,
    }


def _load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=Path("benchmarks/annotation-machine-draft.jsonl"))
    parser.add_argument("--machine-draft", type=Path)
    args = parser.parse_args()
    rows = _load_jsonl(args.input)
    if args.machine_draft:
        rows = attach_machine_suggestions(rows, _load_jsonl(args.machine_draft))
    report = evaluate_rows(rows)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["status"] == "ok" else 2


if __name__ == "__main__":
    raise SystemExit(main())
