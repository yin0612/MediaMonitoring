from scripts.build_benchmark import build_candidates
from scripts.build_annotation_machine_draft import build_machine_draft


def test_benchmark_is_deterministic_stratified_and_reserves_double_annotations():
    items = [
        {"id": str(index), "source": f"s{index % 5}", "publishedAt": f"2026-08-{index % 10 + 1:02d}T00:00:00Z", "title": f"t{index}", "url": f"https://e/{index}"}
        for index in range(100)
    ]
    first = build_candidates(items, 80)
    second = build_candidates(list(reversed(items)), 80)
    assert first == second
    assert len(first) == 80
    assert len({row["sampleId"] for row in first}) == 80
    assert sum(row["doubleAnnotation"] for row in first) == 8
    assert {row["split"] for row in first} == {"train", "dev", "test"}
    assert all(row["annotations"]["annotator1"] is None for row in first)


def test_machine_draft_is_explicitly_provisional_and_does_not_fill_annotations():
    candidates = build_candidates([
        {
            "id": "1",
            "source": "cna",
            "publishedAt": "2026-08-01T00:00:00Z",
            "title": "台灣政府宣布新政策",
            "excerpt": "政府表示政策將改善社會服務。",
            "url": "https://example.test/1",
        },
    ], 1)
    archive_items = [{
        "source": "cna",
        "title": "台灣政府宣布新政策",
        "excerpt": "政府表示政策將改善社會服務。",
        "url": "https://example.test/1",
        "sentiment": "positive",
    }]
    draft = build_machine_draft(
        candidates,
        archive_items,
        {"政府": {"type": "ORG", "aliases": []}},
    )
    assert draft[0]["machineSuggested"]["textTone"] == "positive"
    assert draft[0]["machineSuggested"]["entities"] == ["政府"]
    assert draft[0]["provenance"]["kind"] == "machine-draft"
    assert draft[0]["provenance"]["humanVerified"] is False
    assert all(value in (None, []) for value in draft[0]["annotations"].values())
