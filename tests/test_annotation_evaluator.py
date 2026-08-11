import json

import pytest

from scripts.evaluate_annotations import attach_machine_suggestions, evaluate_rows


def test_annotation_evaluator_reports_insufficient_human_labels():
    report = evaluate_rows([
        {"sampleId": "a", "annotations": {"annotator1": None, "annotator2": None}, "machineSuggested": {"textTone": "neutral"}},
    ])
    assert report["status"] == "insufficient_labels"
    assert report["humanLabelRows"] == 0
    assert report["missingHumanLabels"] == 1


def test_annotation_evaluator_uses_only_held_out_rows_and_gates_incomplete_kappa():
    rows = [
        {"sampleId": "a", "split": "train", "doubleAnnotation": True, "annotations": {"textTone": "positive", "annotator1": {"textTone": "positive"}, "annotator2": {"textTone": "positive"}}, "machineSuggested": {"textTone": "negative"}},
        {"sampleId": "b", "split": "test", "doubleAnnotation": True, "annotations": {"textTone": "negative", "annotator1": {"textTone": "negative"}, "annotator2": {"textTone": "positive"}}, "machineSuggested": {"textTone": "negative"}},
        {"sampleId": "c", "split": "test", "doubleAnnotation": True, "annotations": {"textTone": "neutral", "annotator1": {"textTone": "neutral"}, "annotator2": {"textTone": "neutral"}}, "machineSuggested": {"textTone": "neutral"}},
    ]
    report = evaluate_rows(rows)
    assert report["status"] == "ok"
    assert report["humanLabelRows"] == 3
    assert report["heldOutHumanLabelRows"] == 2
    assert report["requiredDoubleAnnotationRows"] == 3
    assert report["metrics"]["textTone"]["doubleAnnotatedRows"] == 3
    assert report["metrics"]["textTone"]["cohenKappa"] is None
    assert report["metrics"]["textTone"]["machineMacroF1"] == 1.0


def test_annotation_evaluator_emits_kappa_only_after_all_100_required_pairs_complete():
    rows = [
        {
            "sampleId": str(index),
            "split": "test",
            "doubleAnnotation": True,
            "annotations": {
                "textTone": "positive",
                "annotator1": {"textTone": "positive"},
                "annotator2": {"textTone": "positive"},
            },
            "machineSuggested": {"textTone": "positive"},
        }
        for index in range(100)
    ]

    report = evaluate_rows(rows)

    assert report["requiredDoubleAnnotationRows"] == 100
    assert report["metrics"]["textTone"]["doubleAnnotatedRows"] == 100
    assert report["metrics"]["textTone"]["cohenKappa"] == 1.0


def test_machine_draft_is_attached_by_sample_id_without_mutating_human_labels():
    rows = [
        {"sampleId": "a", "split": "test", "annotations": {"textTone": "positive"}},
        {"sampleId": "b", "split": "test", "annotations": {"textTone": "negative"}},
    ]
    drafts = [
        {"sampleId": "a", "machineSuggested": {"textTone": "positive"}},
        {"sampleId": "b", "machineSuggested": {"textTone": "positive"}},
    ]

    combined = attach_machine_suggestions(rows, drafts)

    assert "machineSuggested" not in rows[0]
    assert combined[0]["annotations"] == {"textTone": "positive"}
    assert combined[1]["machineSuggested"] == {"textTone": "positive"}
    assert evaluate_rows(combined)["metrics"]["textTone"]["machineMacroF1"] == 0.333333


def test_machine_draft_requires_one_matching_row_for_every_human_row():
    with pytest.raises(ValueError, match="missing machine draft"):
        attach_machine_suggestions(
            [{"sampleId": "human", "annotations": {"textTone": "positive"}}],
            [{"sampleId": "other", "machineSuggested": {"textTone": "positive"}}],
        )
