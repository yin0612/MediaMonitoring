import json

from scripts.evaluate_annotations import evaluate_rows


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
