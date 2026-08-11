import pytest

from scripts.merge_annotation_exports import merge_reviewer_exports


def row(sample_id: str, *, double: bool, annotations=None):
    return {
        "sampleId": sample_id,
        "doubleAnnotation": double,
        "title": sample_id,
        "annotations": annotations or {
            "eventCluster": None,
            "topics": [],
            "entities": [],
            "textTone": None,
            "target": None,
            "targetStance": None,
            "annotator1": None,
            "annotator2": None,
        },
    }


def reviewer_labels(tone: str):
    return {
        "eventCluster": "event-1",
        "topics": ["politics"],
        "entities": ["川普"],
        "textTone": tone,
        "target": "川普",
        "targetStance": tone,
    }


def test_merge_reviewer_exports_only_copies_nested_labels_for_double_rows():
    base = [
        row("double", double=True, annotations={**row("x", double=True)["annotations"], "eventCluster": "consensus-event"}),
        row("single", double=False, annotations={**row("x", double=False)["annotations"], "eventCluster": "already-final"}),
    ]
    reviewer1 = [
        row("double", double=True, annotations={"annotator1": reviewer_labels("negative")}),
        row("single", double=False, annotations={"annotator1": reviewer_labels("positive")}),
    ]
    reviewer2 = [
        row("double", double=True, annotations={"annotator2": reviewer_labels("neutral")}),
        row("single", double=False, annotations={"annotator2": reviewer_labels("positive")}),
    ]

    merged = merge_reviewer_exports(base, reviewer1, reviewer2)

    assert merged[0]["annotations"]["eventCluster"] == "consensus-event"
    assert merged[0]["annotations"]["annotator1"]["textTone"] == "negative"
    assert merged[0]["annotations"]["annotator2"]["textTone"] == "neutral"
    assert merged[1]["annotations"]["eventCluster"] == "already-final"
    assert merged[1]["annotations"]["annotator1"] is None
    assert merged[1]["annotations"]["annotator2"] is None


def test_merge_reviewer_exports_rejects_a_file_with_different_sample_ids():
    base = [row("expected", double=True)]
    reviewer1 = [row("unexpected", double=True, annotations={"annotator1": reviewer_labels("positive")})]
    reviewer2 = [row("expected", double=True, annotations={"annotator2": reviewer_labels("positive")})]

    with pytest.raises(ValueError, match="sampleId mismatch"):
        merge_reviewer_exports(base, reviewer1, reviewer2)
