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


def test_annotation_evaluator_computes_kappa_and_machine_macro_f1():
    rows = [
        {"sampleId": "a", "annotations": {"textTone": "positive", "annotator1": {"textTone": "positive"}, "annotator2": {"textTone": "positive"}}, "machineSuggested": {"textTone": "positive"}},
        {"sampleId": "b", "annotations": {"textTone": "negative", "annotator1": {"textTone": "negative"}, "annotator2": {"textTone": "positive"}}, "machineSuggested": {"textTone": "positive"}},
        {"sampleId": "c", "annotations": {"textTone": "neutral", "annotator1": {"textTone": "neutral"}, "annotator2": {"textTone": "neutral"}}, "machineSuggested": {"textTone": "negative"}},
    ]
    report = evaluate_rows(rows)
    assert report["status"] == "ok"
    assert report["humanLabelRows"] == 3
    assert report["doubleAnnotatedRows"] == 3
    assert report["metrics"]["textTone"]["cohenKappa"] == 0.5
    assert report["metrics"]["textTone"]["machineMacroF1"] > 0.2


def test_machine_draft_is_attached_by_sample_id_without_mutating_human_labels():
    rows = [
        {"sampleId": "a", "annotations": {"textTone": "positive"}},
        {"sampleId": "b", "annotations": {"textTone": "negative"}},
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
